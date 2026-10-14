from fastapi import FastAPI, Depends, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from psycopg2.extras import RealDictCursor
from psycopg2 import errors as psycopg2_errors
from passlib.context import CryptContext
from fastapi import UploadFile, File, Form
from fastapi import Response
import uuid
import json
import datetime
import os
import zipfile
import tempfile
from fastapi.responses import FileResponse
import re
import unicodedata
from apscheduler.schedulers.background import BackgroundScheduler
import requests
from urllib.parse import quote
from fastapi.responses import StreamingResponse
import io
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
import secrets
from app.email_utils import enviar_correo, plantilla_base, enviar_correo_con_adjunto
from app.file_compress_utils import comprimir_imagen, comprimir_pdf
from decimal import Decimal

from app.database import get_db
from app.security import obtener_usuario_actual, crear_token

# El servidor (Railway) corre con reloj en UTC, no en hora de Ecuador. Para
# cualquier "¿qué día es hoy?" que se muestre o compare como fecha de
# calendario (no como una duración en horas), hay que usar esto en vez de
# datetime.date.today() / datetime.datetime.now() — si no, pasadas las
# 7pm aprox. hora de Ecuador, el servidor ya cree que es el día siguiente
# (mismo bug ya corregido antes en la validación de invitaciones y en los
# horarios del programador de tareas).
#
# Se usa un desfase fijo de -5 horas en vez de ZoneInfo("America/Guayaquil")
# a propósito: Ecuador no tiene horario de verano, así que -5 es siempre
# correcto, y evita depender de que el servidor tenga los datos de zonas
# horarias (tzdata) instalados — el programador de tareas sí los necesita
# (usa el nombre de la zona para que su librería calcule el horario), pero
# aquí basta con la resta y es más robusto.
ZONA_ECUADOR = datetime.timezone(datetime.timedelta(hours=-5))


def hoy_ecuador() -> datetime.date:
    return datetime.datetime.now(ZONA_ECUADOR).date()




# =========================
# GENERAR RECORDATORIOS
# =========================
def generar_recordatorios_citas():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # Se le pasan las fechas calculadas en Python (hora de Ecuador) en
        # vez de usar CURRENT_DATE de Postgres, porque CURRENT_DATE depende
        # de la zona horaria configurada en la base de datos — y si esa
        # quedó en UTC, correría el mismo riesgo de "creer que ya es
        # mañana" que tenían los otros puntos de este archivo.
        hoy = hoy_ecuador()
        manana = hoy + datetime.timedelta(days=1)

        cur.execute("""
            SELECT
                ct.id,
                ct.proceso_id,
                ct.fecha,
                ct.hora,
                ct.estado,
                ct.usuario_id,
                ct.sucursal_id,
                cd.nombre || ' ' || cd.apellido AS demandante,
                cdd.nombre || ' ' || cdd.apellido AS demandado,
                s.nombre AS sucursal,
                ci.nombre AS ciudad
            FROM citas ct
            JOIN clientes cd ON ct.cliente_demandante_id = cd.id
            JOIN clientes cdd ON ct.cliente_demandado_id = cdd.id
            JOIN sucursales s ON ct.sucursal_id = s.id
            JOIN ciudades ci ON s.ciudad_id = ci.id
            WHERE ct.estado IN ('pendiente', 'reagendada')
              AND ct.fecha IN (%s, %s)
        """, (hoy, manana))

        citas = cur.fetchall()

        for cita in citas:
            if str(cita["fecha"]) == str(hoy):
                titulo = "Invitación para hoy"
            else:
                titulo = "Invitación para mañana"

            mensaje = (
                f"{cita['demandante']} vs {cita['demandado']} | "
                f"{cita['ciudad']} - {cita['sucursal']} | "
                f"{cita['fecha']} {cita['hora']}"
            )

            usuarios_destino = [cita["usuario_id"]]

            cur.execute("""
                SELECT id
                FROM usuarios
                WHERE rol = 'administrador'
                  AND activo = true
            """)

            admins = cur.fetchall()

            for admin in admins:
                usuarios_destino.append(admin["id"])

            for usuario_id in set(usuarios_destino):
                # Se compara también el mensaje (trae fecha y hora de la
                # invitación): así un mismo proceso con una segunda
                # invitación otro día sí recibe su propio recordatorio,
                # y esta misma no se repite aunque corra varias veces.
                cur.execute("""
                    SELECT id
                    FROM notificaciones
                    WHERE usuario_id = %s
                      AND referencia_tipo = 'proceso_mediacion'
                      AND referencia_id = %s
                      AND titulo = %s
                      AND mensaje = %s
                """, (
                    usuario_id,
                    cita["proceso_id"],
                    titulo,
                    mensaje
                ))

                existe = cur.fetchone()

                if existe:
                    continue

                # referencia_tipo/referencia_id apuntan al proceso (no a la
                # cita) para que el frontend pueda llevar directo al
                # proceso con un clic en la notificación.
                crear_notificacion(
                    cur,
                    usuario_id,
                    titulo,
                    mensaje,
                    "recordatorio",
                    "proceso_mediacion",
                    cita["proceso_id"]
                )

        conn.commit()

    except Exception as e:
        conn.rollback()
        print("Error generando recordatorios:", e)

    finally:
        cur.close()
        conn.close()

# =========================
# GENERAR NOTIFICACIONES
# =========================
def crear_notificacion(
    cur,
    usuario_id: int,
    titulo: str,
    mensaje: str,
    tipo: str = "sistema",
    referencia_tipo: str = None,
    referencia_id: int = None
):
    cur.execute("""
        INSERT INTO notificaciones (
            usuario_id,
            titulo,
            mensaje,
            tipo,
            referencia_tipo,
            referencia_id
        )
        VALUES (%s, %s, %s, %s, %s, %s)
    """, (
        usuario_id,
        titulo,
        mensaje,
        tipo,
        referencia_tipo,
        referencia_id
    ))


# =========================
# GENERAR CODIGO CORTO
# =========================

def generar_codigo_corto_sucursal(nombre: str) -> str:
    texto = nombre.strip().upper()

    texto = unicodedata.normalize("NFD", texto)
    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")

    partes = texto.split()

    numero = None
    if partes and partes[-1].isdigit():
        numero = partes[-1]
        texto_base = " ".join(partes[:-1])
    else:
        texto_base = texto

    limpio = re.sub(r"[^A-Z0-9]", "", texto_base)

    if numero:
        return (limpio[:2] + numero)[:10]

    return limpio[:3]


# =========================
# GENERAR SLUG
# =========================
def generar_slug(texto: str):
    texto = unicodedata.normalize("NFKD", texto)
    texto = texto.encode("ascii", "ignore").decode("ascii")
    texto = texto.lower()
    texto = re.sub(r"[^a-z0-9]+", "-", texto)
    texto = texto.strip("-")
    return texto

# =========================
# VALIDAR CEDULA
# =========================

def validar_cedula_ecuatoriana(cedula: str) -> bool:
    if not cedula:
        return False

    cedula = cedula.strip()

    if len(cedula) != 10:
        return False

    if not cedula.isdigit():
        return False

    provincia = int(cedula[:2])
    if provincia < 1 or provincia > 24:
        return False

    tercer_digito = int(cedula[2])
    if tercer_digito >= 6:
        return False

    coeficientes = [2, 1, 2, 1, 2, 1, 2, 1, 2]
    suma = 0

    for i in range(9):
        valor = int(cedula[i]) * coeficientes[i]
        if valor >= 10:
            valor -= 9
        suma += valor

    digito_verificador = (10 - (suma % 10)) % 10

    return digito_verificador == int(cedula[9])


# =========================
# UNA CÉDULA = UNA PERSONA (entre usuarios y clientes)
# =========================

def _normalizar_nombre_persona(nombre: str, apellido: str) -> str:
    """Nombre completo sin tildes ni mayúsculas, con las palabras ordenadas,
    para comparar si dos registros hablan de la misma persona aunque estén
    escritos en distinto orden ("Pérez Juan" = "juan perez")."""
    import unicodedata
    texto = f"{nombre or ''} {apellido or ''}".lower()
    texto = unicodedata.normalize("NFD", texto)
    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
    return " ".join(sorted(texto.split()))


def verificar_cedula_misma_persona(cur, cedula: str, nombre: str, apellido: str, buscar_en: str):
    """Una cédula puede estar en usuarios Y en clientes (una persona con dos
    papeles), pero solo si el nombre coincide. Si la misma cédula aparece en
    la otra lista con un nombre distinto, se bloquea."""
    if buscar_en == "usuarios":
        cur.execute("SELECT nombre, apellido FROM usuarios WHERE cedula = %s", (cedula,))
        donde = "usuario del sistema"
    else:
        cur.execute("SELECT nombre, apellido FROM clientes WHERE cedula = %s", (cedula,))
        donde = "cliente"

    for fila in cur.fetchall():
        if _normalizar_nombre_persona(fila["nombre"], fila["apellido"]) != \
                _normalizar_nombre_persona(nombre, apellido):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Esa cédula ya está registrada como {donde} a nombre de "
                    f"{fila['nombre']} {fila['apellido']}. Una cédula solo puede "
                    f"pertenecer a una persona."
                )
            )

import re

def validar_email(email: str) -> bool:
    if not email:
        return False

    patron = r"^[\w\.-]+@[\w\.-]+\.\w{2,}$"
    return re.match(patron, email.strip()) is not None


def validar_password(password: str) -> bool:
    if not password:
        return False

    return len(password) >= 8

app = FastAPI()


_origenes_permitidos = [
    origen.strip()
    for origen in os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:3000").split(",")
    if origen.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origenes_permitidos,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# =========================
# RESPALDO DIARIO DE LA BASE DE DATOS
# =========================
# El plan de Supabase en uso no incluye respaldos automáticos, así que este
# job hace su propio respaldo: exporta todas las filas de todas las tablas
# a JSON, lo comprime en un .zip y lo manda por correo al administrador.
# No respalda los PDFs de actas/comprobantes (esos viven en Supabase
# Storage, no en la base de datos) — solo los datos de las tablas.
def _valor_serializable(valor):
    """Convierte tipos que json.dumps no entiende (fechas, Decimal, etc.)
    a algo que sí pueda escribir en el respaldo."""
    if isinstance(valor, (datetime.date, datetime.datetime)):
        return valor.isoformat()
    if isinstance(valor, Decimal):
        return float(valor)
    if isinstance(valor, (bytes, bytearray)):
        return None  # no debería haber columnas binarias, pero por si acaso
    return str(valor)


def _generar_y_enviar_respaldo() -> dict:
    """
    Hace el trabajo real de armar el zip y enviarlo por correo. Devuelve un
    diccionario con el detalle de qué pasó (ok/False y el motivo), para que
    tanto el job automático de las 3am como el botón de "enviar respaldo
    ahora" en el panel puedan mostrar exactamente por qué falló algo, en vez
    de un simple "no llegó el correo" sin más pistas.
    """
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_type = 'BASE TABLE'
            ORDER BY table_name
        """)

        tablas = [fila["table_name"] for fila in cur.fetchall()]

        buffer_zip = io.BytesIO()

        with zipfile.ZipFile(buffer_zip, "w", zipfile.ZIP_DEFLATED) as zf:
            resumen = []

            for tabla in tablas:
                cur.execute(f'SELECT * FROM "{tabla}"')
                filas = cur.fetchall()

                contenido = json.dumps(
                    filas, default=_valor_serializable, ensure_ascii=False, indent=2
                )

                zf.writestr(f"{tabla}.json", contenido)
                resumen.append(f"{tabla}: {len(filas)} filas")

            zf.writestr(
                "LEEME.txt",
                "Respaldo automático diario de la base de datos de NUMA/SIGM.\n"
                "No incluye los archivos PDF de actas ni comprobantes de pago "
                "(esos se guardan en Supabase Storage, no en la base de datos).\n\n"
                + "\n".join(resumen)
            )

        contenido_zip = buffer_zip.getvalue()
        fecha_hoy = hoy_ecuador().isoformat()
        tamano_mb = len(contenido_zip) / (1024 * 1024)

        # A quién se le manda: BACKUP_EMAIL si está configurado, o si no,
        # el correo del administrador activo.
        destinatario = os.getenv("BACKUP_EMAIL")
        origen_destinatario = "BACKUP_EMAIL"

        if not destinatario:
            cur.execute("""
                SELECT email FROM usuarios
                WHERE rol = 'administrador' AND activo = true
                LIMIT 1
            """)
            admin = cur.fetchone()
            destinatario = admin["email"] if admin else None
            origen_destinatario = "administrador activo"

        if not destinatario:
            return {
                "ok": False,
                "motivo": (
                    "Se generó el respaldo pero no hay a quién enviarlo: no está "
                    "configurada la variable BACKUP_EMAIL en Railway y no se "
                    "encontró ningún administrador activo con correo."
                ),
                "tamano_mb": round(tamano_mb, 2),
                "tablas": len(tablas),
            }

        if not os.getenv("SMTP_USER") or not os.getenv("SMTP_PASSWORD"):
            return {
                "ok": False,
                "motivo": (
                    "Se generó el respaldo pero no se pudo enviar: faltan las "
                    "variables SMTP_USER y/o SMTP_PASSWORD en Railway (el mismo "
                    "correo que usa el sistema para las demás notificaciones)."
                ),
                "tamano_mb": round(tamano_mb, 2),
                "tablas": len(tablas),
                "destinatario": destinatario,
            }

        enviado = enviar_correo_con_adjunto(
            destinatario,
            f"Respaldo NUMA — {fecha_hoy}",
            plantilla_base(
                "Respaldo diario de la base de datos",
                f"Adjunto el respaldo automático del {fecha_hoy} "
                f"({tamano_mb:.1f} MB, {len(tablas)} tablas). "
                "Guárdalo en un lugar seguro (por ejemplo, una carpeta de Drive dedicada a respaldos).",
                "Ir al sistema",
                os.getenv("FRONTEND_URL", "https://numa-frontend-production.up.railway.app"),
            ),
            f"respaldo_numa_{fecha_hoy}.zip",
            contenido_zip,
        )

        if enviado:
            return {
                "ok": True,
                "motivo": f"Respaldo enviado a {destinatario} ({origen_destinatario}).",
                "destinatario": destinatario,
                "tamano_mb": round(tamano_mb, 2),
                "tablas": len(tablas),
            }
        else:
            return {
                "ok": False,
                "motivo": (
                    f"El servidor de correo (SMTP) rechazó o falló el envío a "
                    f"{destinatario}. Revisa los logs de Railway para ver el "
                    f"error exacto de smtplib."
                ),
                "destinatario": destinatario,
                "tamano_mb": round(tamano_mb, 2),
                "tablas": len(tablas),
            }

    except Exception as e:
        return {"ok": False, "motivo": f"Error generando el respaldo: {e}"}

    finally:
        cur.close()
        conn.close()


def generar_respaldo_base_datos():
    """Wrapper usado por el job automático de las 3am: solo imprime el resultado."""
    resultado = _generar_y_enviar_respaldo()
    if resultado["ok"]:
        print(f"✅ {resultado['motivo']} ({resultado.get('tamano_mb')} MB)")
    else:
        print(f"⚠️  Respaldo diario no enviado: {resultado['motivo']}")


# =========================
# PROGRAMADOR DE RECORDATORIOS
# =========================
# Se registra UNA sola vez, cuando arranca la aplicación (no cada vez que
# corre generar_recordatorios_citas, que era el bug anterior: eso creaba un
# programador nuevo -y lo volvía a registrar- cada vez que se ejecutaba).
_scheduler = BackgroundScheduler()


@app.on_event("startup")
def iniciar_scheduler():
    if _scheduler.get_jobs():
        return

    try:
        # Railway corre con reloj en UTC, así que sin esto "hour=8"
        # significaba 8am UTC = 3am Ecuador (mismo bug de zona horaria
        # ya corregido en la validación de invitaciones). Con esto sí
        # corre a las 8am hora de Ecuador todos los días.
        _scheduler.add_job(
            generar_recordatorios_citas,
            "cron",
            hour=8,
            minute=0,
            timezone="America/Guayaquil",
            # Si el servidor estaba reiniciándose justo a las 8:00 (por
            # ejemplo en una publicación), todavía corre si vuelve dentro
            # de las siguientes 4 horas.
            misfire_grace_time=4 * 3600,
            coalesce=True,
        )
    except Exception:
        # Si por lo que sea el servidor no tiene los datos de zonas horarias
        # disponibles, no debe tumbar el arranque de todo el sistema por un
        # recordatorio: se registra sin zona horaria específica (como estaba
        # antes) en vez de dejar caído el login y todo lo demás.
        _scheduler.add_job(
            generar_recordatorios_citas,
            "cron",
            hour=8,
            minute=0,
            misfire_grace_time=4 * 3600,
            coalesce=True,
        )

    try:
        # Respaldo diario de la base de datos (ver la función más arriba).
        # A las 3am hora de Ecuador, para que no compita con el horario en
        # que el centro está usando el sistema.
        _scheduler.add_job(
            generar_respaldo_base_datos,
            "cron",
            hour=3,
            minute=0,
            timezone="America/Guayaquil",
        )
    except Exception:
        _scheduler.add_job(
            generar_respaldo_base_datos,
            "cron",
            hour=3,
            minute=0,
        )

    _scheduler.start()

    # Al arrancar también se revisan los recordatorios una vez: si el
    # servidor se reinició después de las 8am, no se pierde el aviso del día.
    # No duplica nada (cada aviso se registra una sola vez).
    try:
        _scheduler.add_job(generar_recordatorios_citas)
    except Exception as e:
        print("No se pudo programar el recordatorio de arranque:", e)


# =========================
# NOTIFICACIONES
# =========================

@app.get("/notificaciones")
def obtener_notificaciones(usuario=Depends(obtener_usuario_actual)):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("""
            SELECT
                id,
                titulo,
                mensaje,
                tipo,
                leida,
                referencia_tipo,
                referencia_id,
                fecha_creacion
            FROM notificaciones
            WHERE usuario_id = %s
            ORDER BY fecha_creacion DESC
            LIMIT 50
        """, (usuario["id"],))

        return cur.fetchall()

    finally:
        cur.close()
        conn.close()


@app.put("/notificaciones/{notificacion_id}/leer")
def marcar_notificacion_leida(
    notificacion_id: int,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("""
            UPDATE notificaciones
            SET leida = true
            WHERE id = %s
              AND usuario_id = %s
            RETURNING id
        """, (notificacion_id, usuario["id"]))

        notificacion = cur.fetchone()

        if not notificacion:
            raise HTTPException(
                status_code=404,
                detail="Notificación no encontrada"
            )

        conn.commit()

        return {"mensaje": "Notificación marcada como leída"}

    except HTTPException:
        conn.rollback()
        raise

    finally:
        cur.close()
        conn.close()


@app.put("/notificaciones/leer-todas")
def marcar_todas_notificaciones_leidas(usuario=Depends(obtener_usuario_actual)):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("""
            UPDATE notificaciones
            SET leida = true
            WHERE usuario_id = %s
              AND leida = false
        """, (usuario["id"],))

        conn.commit()

        return {"mensaje": "Todas las notificaciones fueron marcadas como leídas"}

    finally:
        cur.close()
        conn.close()


# =========================
# LÍMITE DE INTENTOS DE LOGIN (protección contra fuerza bruta)
# =========================
_intentos_login = {}  # usuario (en minúsculas) -> {"fallos": int, "bloqueado_hasta": datetime|None}

MAX_INTENTOS_LOGIN = 5
BLOQUEO_MINUTOS = 15


def _clave_intentos(username: str) -> str:
    return (username or "").strip().lower()


def _esta_bloqueado(username: str):
    registro = _intentos_login.get(_clave_intentos(username))

    if not registro or not registro["bloqueado_hasta"]:
        return None

    if datetime.datetime.utcnow() < registro["bloqueado_hasta"]:
        segundos_restantes = (registro["bloqueado_hasta"] - datetime.datetime.utcnow()).total_seconds()
        return max(1, int(segundos_restantes / 60) + 1)

    # El bloqueo ya expiró, se limpia el registro
    _intentos_login.pop(_clave_intentos(username), None)
    return None


def _registrar_intento_fallido(username: str):
    clave = _clave_intentos(username)
    registro = _intentos_login.get(clave, {"fallos": 0, "bloqueado_hasta": None})
    registro["fallos"] += 1

    if registro["fallos"] >= MAX_INTENTOS_LOGIN:
        registro["bloqueado_hasta"] = datetime.datetime.utcnow() + datetime.timedelta(minutes=BLOQUEO_MINUTOS)

    _intentos_login[clave] = registro


def _limpiar_intentos(username: str):
    _intentos_login.pop(_clave_intentos(username), None)


# =========================
# AUDITORÍA
# =========================
# Registro de quién hizo qué sobre qué, y cuándo — para acciones sensibles
# (usuarios, clientes, sucursales, intentos de login). Se inserta con el
# mismo cursor/conexión de quien lo llama, así que queda dentro de la misma
# transacción: si la operación se revierte, el registro de auditoría
# también (no queda un log de algo que en realidad no se guardó).
def registrar_auditoria(cur, usuario, accion: str, entidad: str, entidad_id=None, detalle: str = None):
    nombre = None
    if usuario:
        nombre = (f"{usuario.get('nombre', '')} {usuario.get('apellido', '')}").strip()
        nombre = nombre or usuario.get("email") or usuario.get("username")

    cur.execute("""
        INSERT INTO auditoria (usuario_id, usuario_nombre, accion, entidad, entidad_id, detalle)
        VALUES (%s, %s, %s, %s, %s, %s)
    """, (
        usuario.get("id") if usuario else None,
        nombre,
        accion,
        entidad,
        entidad_id,
        detalle,
    ))


# =========================
# LOGIN
# =========================
@app.post("/login")
def login(username: str = Form(...), password: str = Form(...)):
    minutos_restantes = _esta_bloqueado(username)

    if minutos_restantes:
        raise HTTPException(
            status_code=429,
            detail=f"Demasiados intentos fallidos. Intenta de nuevo en {minutos_restantes} minuto(s)."
        )

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("""
            SELECT id, email, password_hash, rol, activo
            FROM usuarios
            WHERE email = %s
        """, (username,))

        user = cur.fetchone()

        if not user:
            _registrar_intento_fallido(username)
            registrar_auditoria(cur, None, "login_fallido", "auth", detalle=f"Usuario no encontrado: {username}")
            conn.commit()
            raise HTTPException(status_code=401, detail="Usuario no encontrado")

        if not user["activo"]:
            registrar_auditoria(cur, user, "login_fallido", "auth", user["id"], "Cuenta inactiva")
            conn.commit()
            raise HTTPException(status_code=401, detail="Usuario inactivo")

        if not pwd_context.verify(password, user["password_hash"]):
            _registrar_intento_fallido(username)
            registrar_auditoria(cur, user, "login_fallido", "auth", user["id"], "Contraseña incorrecta")
            conn.commit()
            raise HTTPException(status_code=401, detail="Contraseña incorrecta")

        _limpiar_intentos(username)

        token = crear_token({
            "user_id": user["id"],
            "rol": user["rol"]
        })

        return {
            "access_token": token,
            "token_type": "bearer"
        }

    finally:
        cur.close()
        conn.close()


# =========================
# OLVIDÉ MI CONTRASEÑA / ESTABLECER CONTRASEÑA
# =========================
TOKEN_RESET_EXPIRA_HORAS = 2


@app.post("/auth/olvide-password")
def olvide_password(email: str = Form(...)):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    mensaje_generico = {
        "mensaje": "Si el correo existe en nuestro sistema, recibirás un enlace para restablecer tu contraseña."
    }

    try:
        cur.execute("""
            SELECT id, nombre, email, activo
            FROM usuarios
            WHERE email = %s
        """, (email,))

        user = cur.fetchone()

        # No revelamos si el correo existe o no (evita que alguien
        # use este formulario para averiguar qué correos están registrados)
        if not user or not user["activo"]:
            return mensaje_generico

        token = secrets.token_urlsafe(32)
        expira_en = datetime.datetime.utcnow() + datetime.timedelta(hours=TOKEN_RESET_EXPIRA_HORAS)

        cur.execute("""
            INSERT INTO password_reset_tokens (usuario_id, token, expira_en)
            VALUES (%s, %s, %s)
        """, (user["id"], token, expira_en))

        conn.commit()

        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
        enlace = f"{frontend_url}/restablecer-password?token={token}"

        enviar_correo(
            destinatario=user["email"],
            asunto="Restablecer tu contraseña — NUMA",
            cuerpo_html=plantilla_base(
                titulo=f"Hola, {user['nombre']}",
                mensaje_html=(
                    "Recibimos una solicitud para restablecer tu contraseña "
                    "del Sistema Integral de Mediación NUMA. "
                    f"Este enlace es válido por {TOKEN_RESET_EXPIRA_HORAS} horas. "
                    "Si tú no pediste esto, puedes ignorar este correo."
                ),
                boton_texto="Restablecer contraseña",
                boton_url=enlace,
            )
        )

        return mensaje_generico

    finally:
        cur.close()
        conn.close()


@app.post("/auth/restablecer-password")
def restablecer_password(token: str = Form(...), nueva_password: str = Form(...)):
    if not validar_password(nueva_password):
        raise HTTPException(
            status_code=400,
            detail="La contraseña debe tener al menos 8 caracteres"
        )

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("""
            SELECT id, usuario_id, expira_en, usado
            FROM password_reset_tokens
            WHERE token = %s
        """, (token,))

        registro = cur.fetchone()

        if not registro:
            raise HTTPException(status_code=400, detail="Enlace inválido")

        if registro["usado"]:
            raise HTTPException(status_code=400, detail="Este enlace ya fue utilizado")

        if datetime.datetime.utcnow() > registro["expira_en"]:
            raise HTTPException(status_code=400, detail="Este enlace ya expiró, solicita uno nuevo")

        nuevo_hash = pwd_context.hash(nueva_password)

        cur.execute("""
            UPDATE usuarios
            SET password_hash = %s, debe_cambiar_password = false, fecha_modificacion = NOW()
            WHERE id = %s
        """, (nuevo_hash, registro["usuario_id"]))

        cur.execute("""
            UPDATE password_reset_tokens
            SET usado = true
            WHERE id = %s
        """, (registro["id"],))

        cur.execute("""
            SELECT nombre, email FROM usuarios WHERE id = %s
        """, (registro["usuario_id"],))
        destinatario = cur.fetchone()

        conn.commit()

        if destinatario:
            enviar_correo(
                destinatario=destinatario["email"],
                asunto="Tu contraseña fue cambiada — NUMA",
                cuerpo_html=plantilla_base(
                    titulo=f"Hola, {destinatario['nombre']}",
                    mensaje_html=(
                        "Te confirmamos que la contraseña de tu cuenta en el "
                        "Sistema Integral de Mediación NUMA fue cambiada. "
                        "Si tú no hiciste este cambio, contacta a tu administrador de inmediato."
                    ),
                    boton_texto="Ir a iniciar sesión",
                    boton_url=f"{os.getenv('FRONTEND_URL', 'http://localhost:3000')}/login",
                )
            )

        return {"mensaje": "Contraseña actualizada correctamente"}

    finally:
        cur.close()
        conn.close()


# =========================
# DASHBOARD
# =========================
@app.get("/dashboard")
def dashboard(usuario=Depends(obtener_usuario_actual)):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # Cada mediador ve solo sus propias estadísticas (sus procesos y
        # actas); el admin ve las de todos.
        filtro_usuario = ""
        params = []

        if usuario["rol"] != "administrador":
            filtro_usuario = " AND usuario_id = %s"
            params.append(usuario["id"])

        cur.execute(f"""
            SELECT
                COUNT(*) FILTER (WHERE estado = 'en_negociacion') AS en_negociacion,
                COUNT(*) FILTER (WHERE estado = 'cerrado_con_acuerdo') AS cerrados_con_acuerdo,
                COUNT(*) FILTER (WHERE estado = 'cerrado_sin_acuerdo') AS cerrados_sin_acuerdo,
                COUNT(*) FILTER (WHERE estado = 'archivado') AS archivados
            FROM procesos_mediacion
            WHERE 1=1 {filtro_usuario}
        """, tuple(params))

        procesos = cur.fetchone()

        cur.execute(f"""
            SELECT COUNT(*) AS total
            FROM actas_proceso ap
            JOIN procesos_mediacion p ON ap.proceso_id = p.id
            WHERE 1=1
            {" AND p.usuario_id = %s" if usuario["rol"] != "administrador" else ""}
        """, tuple(params))

        actas_finales = cur.fetchone()["total"]

        cur.execute(f"""
            SELECT
                p.id,
                p.codigo_proceso,
                p.tema,
                p.estado,
                p.fecha_creacion,
                cd.nombre || ' ' || cd.apellido AS demandante,
                cdd.nombre || ' ' || cdd.apellido AS demandado,
                s.nombre AS sucursal,
                ci.nombre AS ciudad,
                u.nombre || ' ' || u.apellido AS usuario
            FROM procesos_mediacion p
            JOIN clientes cd ON p.cliente_demandante_id = cd.id
            JOIN clientes cdd ON p.cliente_demandado_id = cdd.id
            JOIN sucursales s ON p.sucursal_id = s.id
            JOIN ciudades ci ON s.ciudad_id = ci.id
            JOIN usuarios u ON p.usuario_id = u.id
            WHERE 1=1
            {" AND p.usuario_id = %s" if usuario["rol"] != "administrador" else ""}
            ORDER BY p.id DESC
            LIMIT 5
        """, tuple(params))

        procesos_recientes = cur.fetchall()

        cur.execute(f"""
            SELECT
                ap.id,
                ap.codigo_acta,
                ap.fecha_subida,
                p.id AS proceso_id,
                p.codigo_proceso,
                cd.nombre || ' ' || cd.apellido AS demandante,
                cdd.nombre || ' ' || cdd.apellido AS demandado,
                s.nombre AS sucursal,
                ci.nombre AS ciudad,
                u.nombre || ' ' || u.apellido AS usuario,
                us.nombre || ' ' || us.apellido AS subida_por
            FROM actas_proceso ap
            JOIN procesos_mediacion p ON ap.proceso_id = p.id
            JOIN clientes cd ON p.cliente_demandante_id = cd.id
            JOIN clientes cdd ON p.cliente_demandado_id = cdd.id
            JOIN sucursales s ON p.sucursal_id = s.id
            JOIN ciudades ci ON s.ciudad_id = ci.id
            JOIN usuarios u ON p.usuario_id = u.id
            LEFT JOIN usuarios us ON ap.usuario_id = us.id
            WHERE 1=1
            {" AND p.usuario_id = %s" if usuario["rol"] != "administrador" else ""}
            ORDER BY ap.id DESC
            LIMIT 5
        """, tuple(params))

        actas_recientes = cur.fetchall()

        return {
            "procesos": procesos,
            "actas_finales": actas_finales,
            "procesos_recientes": procesos_recientes,
            "actas_recientes": actas_recientes
        }

    finally:
        cur.close()
        conn.close()
# =========================
# CLIENTES
# =========================
@app.get("/clientes")
def obtener_clientes(usuario=Depends(obtener_usuario_actual)):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("""
            SELECT 
                cl.id,
                cl.cedula,
                cl.nombre,
                cl.apellido,
                cl.tipo,
                cl.razon_social,
                cl.ruc,
                cl.representante_nombre,
                cl.representante_cedula,
                cl.telefono,
                cl.email,
                cl.ciudad_id,
                cl.direccion,
                c.nombre AS ciudad,
                p.nombre AS provincia,
                cl.fecha_nacimiento,
                cl.fecha_creacion,
                cl.fecha_modificacion
            FROM clientes cl
            LEFT JOIN ciudades c ON c.id = cl.ciudad_id
            LEFT JOIN provincias p ON p.id = c.provincia_id
            ORDER BY cl.apellido, cl.nombre
        """)

        return cur.fetchall()

    finally:
        cur.close()
        conn.close()


# =========================
# ACTUALIZAR CLIENTES
# =========================

def _validar_datos_cliente(cur, tipo, cedula, nombre, apellido, telefono, email,
                          ciudad_id, razon_social, ruc, representante_nombre,
                          representante_cedula, excluir_id=None):
    """Valida y normaliza los datos de un cliente (persona o empresa).
    Devuelve el diccionario listo para guardar."""
    tipo = (tipo or "persona").strip().lower()
    if tipo not in ("persona", "empresa"):
        raise HTTPException(status_code=400, detail="Tipo de cliente inválido")

    if email and not validar_email(email):
        raise HTTPException(status_code=400, detail="Email inválido")

    if telefono:
        telefono_limpio = re.sub(r"\D", "", telefono)
        if len(telefono_limpio) != 10:
            raise HTTPException(status_code=400, detail="El teléfono debe tener 10 dígitos")
        telefono = telefono_limpio

    if ciudad_id:
        cur.execute("SELECT id FROM ciudades WHERE id = %s AND activo = true", (ciudad_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Ciudad de domicilio no encontrada")

    if tipo == "persona":
        if not cedula or not (nombre or "").strip() or not (apellido or "").strip():
            raise HTTPException(status_code=400, detail="Cédula, nombre y apellido son obligatorios")
        if not validar_cedula_ecuatoriana(cedula):
            raise HTTPException(status_code=400, detail="Cédula ecuatoriana inválida")

        if excluir_id is None:
            cur.execute("SELECT id FROM clientes WHERE cedula = %s", (cedula,))
        else:
            cur.execute("SELECT id FROM clientes WHERE cedula = %s AND id <> %s", (cedula, excluir_id))
        if cur.fetchone():
            raise HTTPException(status_code=400, detail="Ya existe un cliente con esa cédula")

        verificar_cedula_misma_persona(cur, cedula, nombre, apellido, "usuarios")

        return {
            "tipo": "persona", "cedula": cedula, "nombre": nombre.strip(),
            "apellido": apellido.strip(), "razon_social": None, "ruc": None,
            "representante_nombre": None, "representante_cedula": None,
            "telefono": telefono, "email": email, "ciudad_id": ciudad_id,
        }

    # ---- empresa / institución ----
    razon_social = (razon_social or "").strip()
    ruc = re.sub(r"\D", "", ruc or "")
    representante_nombre = (representante_nombre or "").strip()
    representante_cedula = (representante_cedula or "").strip()

    if not razon_social:
        raise HTTPException(status_code=400, detail="La razón social es obligatoria")
    if len(ruc) != 13 or ruc.endswith("000"):
        raise HTTPException(status_code=400, detail="El RUC debe tener 13 dígitos")
    if not representante_nombre:
        raise HTTPException(status_code=400, detail="El nombre del representante legal es obligatorio")
    if not representante_cedula or not validar_cedula_ecuatoriana(representante_cedula):
        raise HTTPException(status_code=400, detail="La cédula del representante legal es inválida")

    if excluir_id is None:
        cur.execute("SELECT id FROM clientes WHERE ruc = %s", (ruc,))
    else:
        cur.execute("SELECT id FROM clientes WHERE ruc = %s AND id <> %s", (ruc, excluir_id))
    if cur.fetchone():
        raise HTTPException(status_code=400, detail="Ya existe una empresa con ese RUC")

    # nombre = razón social y apellido vacío: así todas las listas y reportes
    # que arman "nombre + apellido" siguen mostrando bien a la empresa.
    return {
        "tipo": "empresa", "cedula": None, "nombre": razon_social, "apellido": "",
        "razon_social": razon_social, "ruc": ruc,
        "representante_nombre": representante_nombre,
        "representante_cedula": representante_cedula,
        "telefono": telefono, "email": email, "ciudad_id": ciudad_id,
    }


_CAMPOS_CLIENTE_RETURN = """id, tipo, cedula, nombre, apellido, razon_social, ruc,
                      representante_nombre, representante_cedula, telefono, email,
                      ciudad_id, direccion, fecha_creacion, fecha_modificacion"""


@app.put("/clientes/{id}")
def actualizar_cliente(
    id: int,
    cedula: str = None,
    nombre: str = None,
    apellido: str = None,
    telefono: str = None,
    email: str = None,
    ciudad_id: int = None,
    direccion: str = None,
    tipo: str = "persona",
    razon_social: str = None,
    ruc: str = None,
    representante_nombre: str = None,
    representante_cedula: str = None,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("SELECT tipo FROM clientes WHERE id = %s", (id,))
        actual = cur.fetchone()
        if not actual:
            raise HTTPException(status_code=404, detail="Cliente no encontrado")
        if actual["tipo"] != (tipo or "persona"):
            raise HTTPException(
                status_code=400,
                detail="No se puede cambiar una persona a empresa (ni al revés). Crea un cliente nuevo."
            )

        d = _validar_datos_cliente(
            cur, tipo, cedula, nombre, apellido, telefono, email, ciudad_id,
            razon_social, ruc, representante_nombre, representante_cedula,
            excluir_id=id
        )

        cur.execute(f"""
            UPDATE clientes
            SET
                cedula = %s,
                nombre = %s,
                apellido = %s,
                razon_social = %s,
                ruc = %s,
                representante_nombre = %s,
                representante_cedula = %s,
                telefono = %s,
                email = %s,
                ciudad_id = %s,
                direccion = %s,
                fecha_modificacion = NOW()
            WHERE id = %s
            RETURNING {_CAMPOS_CLIENTE_RETURN}
        """, (
            d["cedula"], d["nombre"], d["apellido"], d["razon_social"], d["ruc"],
            d["representante_nombre"], d["representante_cedula"],
            d["telefono"], d["email"], d["ciudad_id"], direccion, id
        ))

        cliente = cur.fetchone()

        etiqueta = (
            f"la empresa {d['nombre']} (RUC {d['ruc']})" if d["tipo"] == "empresa"
            else f"al cliente {d['nombre']} {d['apellido']} (cédula {d['cedula']})"
        )
        registrar_auditoria(cur, usuario, "cliente_editado", "clientes", id, f"Editó {etiqueta}")

        conn.commit()
        return cliente

    except HTTPException:
        conn.rollback()
        raise

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cur.close()
        conn.close()


# =========================
# CIUDADES
# =========================
@app.get("/ciudades")
def obtener_ciudades(
    solo_con_sucursal: bool = False,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        if solo_con_sucursal:
            cur.execute("""
                SELECT DISTINCT
                    c.id,
                    c.nombre,
                    c.provincia_id,
                    p.nombre AS provincia,
                    c.prefijo,
                    c.activo,
                    c.fecha_creacion
                FROM ciudades c
                LEFT JOIN provincias p ON c.provincia_id = p.id
                JOIN sucursales s ON s.ciudad_id = c.id
                WHERE s.activo = TRUE
                ORDER BY p.nombre, c.nombre
            """)
        else:
            cur.execute("""
                SELECT 
                    c.id,
                    c.nombre,
                    c.provincia_id,
                    p.nombre AS provincia,
                    c.prefijo,
                    c.activo,
                    c.fecha_creacion
                FROM ciudades c
                LEFT JOIN provincias p ON c.provincia_id = p.id
                ORDER BY p.nombre, c.nombre
            """)

        return cur.fetchall()

    finally:
        cur.close()
        conn.close()


# =========================
# SUCURSALES
# =========================
@app.get("/sucursales")
def obtener_sucursales(
    activo: bool = None,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        query = """
            SELECT 
                s.id,
                s.ciudad_id,
                s.nombre,
                s.codigo,
                s.prefijo,
                s.direccion,
                s.telefono,
                s.codigo_corto,
                s.activo,
                s.fecha_creacion,
                s.fecha_modificacion,
                c.nombre AS ciudad,
                c.provincia
            FROM sucursales s
            LEFT JOIN ciudades c ON s.ciudad_id = c.id
        """

        params = []

        if activo is not None:
            query += " WHERE s.activo = %s"
            params.append(activo)

        query += " ORDER BY s.nombre"

        cur.execute(query, tuple(params))

        return cur.fetchall()

    finally:
        cur.close()
        conn.close()

        # =========================
# CREAR CLIENTE
# =========================
@app.post("/clientes")
def crear_cliente(
    cedula: str = None,
    nombre: str = None,
    apellido: str = None,
    telefono: str = None,
    email: str = None,
    ciudad_id: int = None,
    direccion: str = None,
    tipo: str = "persona",
    razon_social: str = None,
    ruc: str = None,
    representante_nombre: str = None,
    representante_cedula: str = None,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        d = _validar_datos_cliente(
            cur, tipo, cedula, nombre, apellido, telefono, email, ciudad_id,
            razon_social, ruc, representante_nombre, representante_cedula
        )

        cur.execute(f"""
            INSERT INTO clientes (
                tipo, cedula, nombre, apellido, razon_social, ruc,
                representante_nombre, representante_cedula,
                telefono, email, ciudad_id, direccion,
                fecha_creacion, fecha_modificacion
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
            RETURNING {_CAMPOS_CLIENTE_RETURN}
        """, (
            d["tipo"], d["cedula"], d["nombre"], d["apellido"], d["razon_social"], d["ruc"],
            d["representante_nombre"], d["representante_cedula"],
            d["telefono"], d["email"], d["ciudad_id"], direccion
        ))

        cliente = cur.fetchone()

        etiqueta = (
            f"la empresa {d['nombre']} (RUC {d['ruc']})" if d["tipo"] == "empresa"
            else f"al cliente {d['nombre']} {d['apellido']} (cédula {d['cedula']})"
        )
        registrar_auditoria(cur, usuario, "cliente_creado", "clientes", cliente["id"], f"Creó {etiqueta}")

        conn.commit()
        return cliente

    except HTTPException:
        conn.rollback()
        raise

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cur.close()
        conn.close()

# =========================
# CREAR CIUDAD
# =========================
@app.post("/ciudades")
def crear_ciudad(
    nombre: str,
    provincia_id: int,
    prefijo: str,
    usuario=Depends(obtener_usuario_actual)
):
    if usuario["rol"] != "administrador":
        raise HTTPException(
            status_code=403,
            detail="Solo administrador puede realizar esta acción"
        )

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        nombre = nombre.strip()
        prefijo = prefijo.strip().upper()

        if not nombre:
            raise HTTPException(
                status_code=400,
                detail="El nombre de la ciudad es obligatorio"
            )

        if not prefijo:
            raise HTTPException(
                status_code=400,
                detail="El prefijo de la ciudad es obligatorio"
            )

        cur.execute("""
            SELECT nombre
            FROM provincias
            WHERE id = %s AND activo = true
        """, (provincia_id,))

        provincia = cur.fetchone()

        if not provincia:
            raise HTTPException(
                status_code=404,
                detail="Provincia no encontrada"
            )

        cur.execute("""
            SELECT id
            FROM ciudades
            WHERE provincia_id = %s
              AND lower(nombre) = lower(%s)
        """, (provincia_id, nombre))

        existe = cur.fetchone()

        if existe:
            raise HTTPException(
                status_code=400,
                detail="Ya existe una ciudad con ese nombre en esta provincia"
            )

        cur.execute("""
            SELECT id
            FROM ciudades
            WHERE lower(prefijo) = lower(%s)
        """, (prefijo,))

        prefijo_existe = cur.fetchone()

        if prefijo_existe:
            raise HTTPException(
                status_code=400,
                detail="Ya existe una ciudad con ese prefijo"
        )

        cur.execute("""
            INSERT INTO ciudades (
                nombre,
                provincia,
                provincia_id,
                prefijo,
                activo,
                fecha_creacion
            )
            VALUES (%s, %s, %s, %s, true, NOW())
            RETURNING
                id,
                nombre,
                provincia_id,
                provincia,
                prefijo,
                activo,
                fecha_creacion
        """, (
            nombre,
            provincia["nombre"],
            provincia_id,
            prefijo
        ))

        ciudad = cur.fetchone()
        conn.commit()

        return ciudad

    except HTTPException:
        conn.rollback()
        raise

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cur.close()
        conn.close()

# =========================
# EDITAR CIUDAD
# =========================
@app.put("/ciudades/{id}")
def editar_ciudad(
    id: int,
    nombre: str,
    provincia_id: int,
    prefijo: str,
    usuario=Depends(obtener_usuario_actual)
):
    if usuario["rol"] != "administrador":
        raise HTTPException(
            status_code=403,
            detail="Solo administrador puede realizar esta acción"
        )

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        nombre = nombre.strip()
        prefijo = prefijo.strip().upper()

        if not nombre:
            raise HTTPException(status_code=400, detail="El nombre de la ciudad es obligatorio")

        if not prefijo:
            raise HTTPException(status_code=400, detail="El prefijo de la ciudad es obligatorio")

        cur.execute("SELECT id FROM ciudades WHERE id = %s", (id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Ciudad no encontrada")

        cur.execute("""
            SELECT nombre FROM provincias WHERE id = %s AND activo = true
        """, (provincia_id,))
        provincia = cur.fetchone()

        if not provincia:
            raise HTTPException(status_code=404, detail="Provincia no encontrada")

        cur.execute("""
            SELECT id FROM ciudades
            WHERE provincia_id = %s AND lower(nombre) = lower(%s) AND id != %s
        """, (provincia_id, nombre, id))
        if cur.fetchone():
            raise HTTPException(status_code=400, detail="Ya existe una ciudad con ese nombre en esta provincia")

        cur.execute("""
            SELECT id FROM ciudades WHERE lower(prefijo) = lower(%s) AND id != %s
        """, (prefijo, id))
        if cur.fetchone():
            raise HTTPException(status_code=400, detail="Ya existe una ciudad con ese prefijo")

        cur.execute("""
            UPDATE ciudades
            SET nombre = %s, provincia = %s, provincia_id = %s, prefijo = %s
            WHERE id = %s
            RETURNING id, nombre, provincia_id, provincia, prefijo, activo, fecha_creacion
        """, (nombre, provincia["nombre"], provincia_id, prefijo, id))

        ciudad = cur.fetchone()
        conn.commit()

        return ciudad

    except HTTPException:
        conn.rollback()
        raise

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cur.close()
        conn.close()

# =========================
# DESACTIVAR CIUDAD
# =========================
@app.delete("/ciudades/{id}")
def delete_ciudad(
    id: int,
    usuario=Depends(obtener_usuario_actual)
):
    if usuario["rol"] != "administrador":
        raise HTTPException(
            status_code=403,
            detail="Solo administrador puede realizar esta acción"
        )

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("""
            UPDATE ciudades
            SET activo = false
            WHERE id = %s
            RETURNING id
        """, (id,))

        ciudad = cur.fetchone()

        if not ciudad:
            raise HTTPException(
                status_code=404,
                detail="Ciudad no encontrada"
            )

        conn.commit()

        return {
            "mensaje": "Ciudad desactivada correctamente"
        }

    except HTTPException:
        conn.rollback()
        raise

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cur.close()
        conn.close()

# =========================
# CREAR SUCURSAL
# =========================
@app.post("/sucursales")
def crear_sucursal(
    ciudad_id: int,
    nombre: str,
    codigo: str = None,
    prefijo: str = None,
    direccion: str = None,
    telefono: str = None,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    if usuario["rol"] != "administrador":
        raise HTTPException(
            status_code=403,
            detail="Solo administrador puede realizar esta acción"
        )

    try:
        nombre = nombre.strip()

        if not nombre:
            raise HTTPException(
                status_code=400,
                detail="El nombre de la sucursal es obligatorio"
            )

      

        # VALIDAR CIUDAD
        cur.execute("""
            SELECT nombre
            FROM ciudades
            WHERE id = %s
        """, (ciudad_id,))

        ciudad = cur.fetchone()

        if not ciudad:
            raise HTTPException(
                status_code=404,
                detail="Ciudad no encontrada"
            )
        
          # CÓDIGO ÚNICO: ciudad + sucursal
        if not codigo:
            codigo = generar_slug(f"{ciudad['nombre']} {nombre}").upper().replace("-", "_")[:50]

            if not prefijo:
                prefijo = generar_slug(
                f"{ciudad['nombre']} {nombre}"
            ).upper().replace("-", "_")[:20]
                
             # CÓDIGO CORTO PARA ACTAS: NOR, SUR, VAL, VA2, etc.
            codigo_corto = generar_codigo_corto_sucursal(nombre)

        # VALIDAR NOMBRE REPETIDO SOLO EN LA MISMA CIUDAD
        cur.execute("""
            SELECT id
            FROM sucursales
            WHERE ciudad_id = %s
              AND lower(nombre) = lower(%s)
        """, (ciudad_id, nombre))

        existe = cur.fetchone()

        if existe:
            raise HTTPException(
                status_code=400,
                detail="Ya existe una sucursal con ese nombre en esta ciudad"
            )

        # SLUG: ciudad + sucursal
        slug = generar_slug(f"{ciudad['nombre']} {nombre}")

        cur.execute("""
            INSERT INTO sucursales (
                ciudad_id,
                nombre,
                codigo,
                prefijo,
                direccion,
                telefono,
                slug,
                codigo_corto,
                activo,
                fecha_creacion,
                fecha_modificacion
              )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, true, NOW(), NOW())
            RETURNING
                id,
                ciudad_id,
                nombre,
                codigo,
                prefijo,
                direccion,
                telefono,
                slug,
                codigo_corto,
                activo,
                fecha_creacion,
                fecha_modificacion
        """, (
            ciudad_id,
            nombre,
            codigo,
            prefijo,
            direccion,
            telefono,
            slug,
            codigo_corto
        ))

        sucursal = cur.fetchone()

        registrar_auditoria(
            cur, usuario, "sucursal_creada", "sucursales", sucursal["id"],
            f"Creó la sucursal {nombre} (ciudad: {ciudad['nombre']})"
        )

        conn.commit()

        return sucursal

    except HTTPException:
        conn.rollback()
        raise

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cur.close()
        conn.close()

# =========================
# EDITAR SUCURSAL
# =========================
@app.put("/sucursales/{id}")
def editar_sucursal(
    id: int,
    ciudad_id: int,
    nombre: str,
    direccion: str = None,
    telefono: str = None,
    usuario=Depends(obtener_usuario_actual)
):
    if usuario["rol"] != "administrador":
        raise HTTPException(
            status_code=403,
            detail="Solo administrador puede realizar esta acción"
        )

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        nombre = nombre.strip()

        if not nombre:
            raise HTTPException(status_code=400, detail="El nombre de la sucursal es obligatorio")

        cur.execute("SELECT id FROM sucursales WHERE id = %s", (id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Sucursal no encontrada")

        cur.execute("SELECT nombre FROM ciudades WHERE id = %s", (ciudad_id,))
        ciudad = cur.fetchone()

        if not ciudad:
            raise HTTPException(status_code=404, detail="Ciudad no encontrada")

        cur.execute("""
            SELECT id FROM sucursales
            WHERE ciudad_id = %s AND lower(nombre) = lower(%s) AND id != %s
        """, (ciudad_id, nombre, id))
        if cur.fetchone():
            raise HTTPException(status_code=400, detail="Ya existe una sucursal con ese nombre en esta ciudad")

        # El código, prefijo y código corto NO se recalculan aquí a propósito:
        # ya pueden estar usándose en códigos de acta emitidos, y no queremos
        # que corregir el nombre/dirección de una sucursal afecte esa numeración.
        slug = generar_slug(f"{ciudad['nombre']} {nombre}")

        cur.execute("""
            UPDATE sucursales
            SET ciudad_id = %s, nombre = %s, direccion = %s, telefono = %s,
                slug = %s, fecha_modificacion = NOW()
            WHERE id = %s
            RETURNING
                id, ciudad_id, nombre, codigo, prefijo, direccion, telefono,
                slug, codigo_corto, activo, fecha_creacion, fecha_modificacion
        """, (ciudad_id, nombre, direccion, telefono, slug, id))

        sucursal = cur.fetchone()

        registrar_auditoria(
            cur, usuario, "sucursal_editada", "sucursales", id,
            f"Editó la sucursal {nombre} (ciudad: {ciudad['nombre']})"
        )

        conn.commit()

        return sucursal

    except HTTPException:
        conn.rollback()
        raise

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cur.close()
        conn.close()

# =========================
# LISTAR USUARIOS
# =========================
@app.post("/usuarios")
def crear_usuario(
    nombre: str,
    apellido: str,
    cedula: str,
    email: str,
    password: str = None,
    rol: str = "mediador",
    sucursal_id: int = 1,
    usuario=Depends(obtener_usuario_actual)
):
    if usuario["rol"] != "administrador":
        raise HTTPException(
            status_code=403,
            detail="Solo administrador puede crear usuarios"
        )

    # El centro solo debe tener un administrador (el actual). Todo usuario
    # nuevo se crea como mediador, sin excepción.
    if rol == "administrador":
        raise HTTPException(
            status_code=400,
            detail="No se pueden crear nuevos administradores"
        )

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # VALIDAR CÉDULA
        if not validar_cedula_ecuatoriana(cedula):
            raise HTTPException(
                status_code=400,
                detail="Cédula ecuatoriana inválida"
            )
        
        if not validar_email(email):
            raise HTTPException(
        status_code=400,
        detail="Email inválido"
    )

        if password and not validar_password(password):
            raise HTTPException(
        status_code=400,
        detail="La contraseña debe tener al menos 8 caracteres"
    )

        # VALIDAR EMAIL DUPLICADO
        cur.execute("""
            SELECT id
            FROM usuarios
            WHERE email = %s
        """, (email,))

        existente_email = cur.fetchone()

        if existente_email:
            raise HTTPException(
                status_code=400,
                detail="Ya existe un usuario con ese email"
            )

        # VALIDAR CÉDULA DUPLICADA
        cur.execute("""
            SELECT id
            FROM usuarios
            WHERE cedula = %s
        """, (cedula,))

        existente_cedula = cur.fetchone()

        if existente_cedula:
            raise HTTPException(
                status_code=400,
                detail="Ya existe un usuario con esa cédula"
            )

        verificar_cedula_misma_persona(cur, cedula, nombre, apellido, "clientes")

        password_generada_automaticamente = not password

        if password_generada_automaticamente:
            password = secrets.token_urlsafe(16)

        password_hash = pwd_context.hash(password)

        # TEMPORAL — mientras no haya un dominio propio verificado para el
        # correo: si el admin escribe la contraseña directamente al crear el
        # usuario, esa persona puede iniciar sesión de una vez con esa
        # contraseña, sin que el sistema le obligue a cambiarla primero (así
        # no depende de que le llegue un correo o un enlace). Si en cambio
        # se genera la contraseña automáticamente (el admin no puso una), sí
        # se sigue exigiendo el cambio, porque en ese caso la única forma de
        # que la persona sepa su contraseña es por el enlace de activación.
        # Cuando ya tengamos el dominio verificado, esto se debe volver a
        # exigir siempre por seguridad.
        debe_cambiar_password = password_generada_automaticamente

        cur.execute("""
            INSERT INTO usuarios (
                sucursal_id,
                nombre,
                apellido,
                cedula,
                email,
                password_hash,
                rol,
                activo,
                debe_cambiar_password,
                fecha_creacion,
                fecha_modificacion
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, %s,
                true,
                %s,
                NOW(),
                NOW()
            )
            RETURNING
                id,
                sucursal_id,
                nombre,
                apellido,
                cedula,
                email,
                rol,
                activo,
                fecha_creacion,
                fecha_modificacion
        """, (
            sucursal_id,
            nombre,
            apellido,
            cedula,
            email,
            password_hash,
            rol,
            debe_cambiar_password
        ))

        nuevo_usuario = cur.fetchone()

        registrar_auditoria(
            cur, usuario, "usuario_creado", "usuarios", nuevo_usuario["id"],
            f"Creó al usuario {nombre} {apellido} ({email}) con rol {rol}"
        )

        conn.commit()

        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")

        enlace_activacion = None
        correo_enviado = False

        if password_generada_automaticamente:
            token = secrets.token_urlsafe(32)
            expira_en = datetime.datetime.utcnow() + datetime.timedelta(hours=TOKEN_RESET_EXPIRA_HORAS)

            cur.execute("""
                INSERT INTO password_reset_tokens (usuario_id, token, expira_en)
                VALUES (%s, %s, %s)
            """, (nuevo_usuario["id"], token, expira_en))

            conn.commit()

            enlace_activacion = f"{frontend_url}/restablecer-password?token={token}"

            correo_enviado = enviar_correo(
                destinatario=email,
                asunto="Bienvenido al Sistema NUMA — Activa tu cuenta",
                cuerpo_html=plantilla_base(
                    titulo=f"Hola, {nombre}",
                    mensaje_html=(
                        "Se creó una cuenta para ti en el Sistema Integral de Mediación NUMA, "
                        f"con el rol de <strong>{rol}</strong>. "
                        f"Para empezar a usarla, primero establece tu contraseña "
                        f"(este enlace es válido por {TOKEN_RESET_EXPIRA_HORAS} horas)."
                    ),
                    boton_texto="Establecer mi contraseña",
                    boton_url=enlace_activacion,
                )
            )
        else:
            correo_enviado = enviar_correo(
                destinatario=email,
                asunto="Bienvenido al Sistema NUMA",
                cuerpo_html=plantilla_base(
                    titulo=f"Hola, {nombre}",
                    mensaje_html=(
                        "Se creó una cuenta para ti en el Sistema Integral de Mediación NUMA, "
                        f"con el rol de <strong>{rol}</strong>. "
                        "Tu administrador te compartirá tu contraseña temporal por otro medio. "
                        "Al ingresar por primera vez, el sistema te pedirá cambiarla por una "
                        "que solo tú conozcas."
                    ),
                    boton_texto="Ir a iniciar sesión",
                    boton_url=f"{frontend_url}/login",
                )
            )

        # Mientras no haya un dominio propio verificado en el proveedor de
        # correo, el envío automático solo llega a la dirección dueña de esa
        # cuenta de correo — a cualquier otra dirección el envío puede fallar
        # en silencio. Por eso siempre se devuelve el enlace de activación
        # aquí: así el admin puede copiarlo y compartirlo manualmente
        # (WhatsApp, etc.) mientras tanto, sin depender de que el correo llegue.
        nuevo_usuario["enlace_activacion"] = enlace_activacion
        nuevo_usuario["correo_enviado"] = correo_enviado

        return nuevo_usuario

    except HTTPException:
        conn.rollback()
        raise

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cur.close()
        conn.close()

# =========================
# EDITAR USUARIO
# =========================
@app.put("/usuarios/{id}")
def editar_usuario(
    id: int,
    nombre: str,
    apellido: str,
    cedula: str,
    email: str,
    rol: str,
    sucursal_id: int,
    usuario=Depends(obtener_usuario_actual)
):
    if usuario["rol"] != "administrador":
        raise HTTPException(
            status_code=403,
            detail="Solo administrador puede editar usuarios"
        )

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        if not validar_cedula_ecuatoriana(cedula):
            raise HTTPException(status_code=400, detail="Cédula ecuatoriana inválida")

        if not validar_email(email):
            raise HTTPException(status_code=400, detail="Email inválido")

        if rol not in ("administrador", "mediador"):
            raise HTTPException(status_code=400, detail="Rol inválido")

        cur.execute("SELECT id, rol FROM usuarios WHERE id = %s", (id,))
        usuario_existente = cur.fetchone()

        if not usuario_existente:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")

        # El centro solo debe tener un administrador (el actual). Se puede
        # editar al administrador existente sin problema, pero no se puede
        # ascender a un mediador a administrador.
        if rol == "administrador" and usuario_existente["rol"] != "administrador":
            raise HTTPException(
                status_code=400,
                detail="No se pueden crear nuevos administradores"
            )

        cur.execute("SELECT id FROM usuarios WHERE email = %s AND id != %s", (email, id))
        if cur.fetchone():
            raise HTTPException(status_code=400, detail="Ya existe otro usuario con ese email")

        cur.execute("SELECT id FROM usuarios WHERE cedula = %s AND id != %s", (cedula, id))
        if cur.fetchone():
            raise HTTPException(status_code=400, detail="Ya existe otro usuario con esa cédula")

        verificar_cedula_misma_persona(cur, cedula, nombre, apellido, "clientes")

        cur.execute("""
            UPDATE usuarios
            SET nombre = %s, apellido = %s, cedula = %s, email = %s,
                rol = %s, sucursal_id = %s, fecha_modificacion = NOW()
            WHERE id = %s
            RETURNING
                id, sucursal_id, nombre, apellido, cedula, email, rol, activo,
                debe_cambiar_password, fecha_creacion, fecha_modificacion
        """, (nombre, apellido, cedula, email, rol, sucursal_id, id))

        usuario_actualizado = cur.fetchone()

        registrar_auditoria(
            cur, usuario, "usuario_editado", "usuarios", id,
            f"Editó al usuario {nombre} {apellido} ({email}), rol {rol}, sucursal {sucursal_id}"
        )

        conn.commit()

        return usuario_actualizado

    except HTTPException:
        conn.rollback()
        raise

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cur.close()
        conn.close()

# =========================
# LISTAR USUARIOS
# =========================
@app.get("/usuarios")
def obtener_usuarios(usuario=Depends(obtener_usuario_actual)):
    # Este listado trae el email, cédula y rol de TODOS los usuarios
    # (incluido el propio admin), así que solo el administrador puede
    # consultarlo. Ninguna pantalla de mediador necesita este endpoint.
    if usuario["rol"] != "administrador":
        raise HTTPException(status_code=403, detail="No tienes permiso para ver esta información")

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("""
            SELECT
                u.id,
                u.sucursal_id,
                u.nombre,
                u.apellido,
                u.cedula,
                u.email,
                u.rol,
                u.activo,
                u.fecha_creacion,
                s.nombre AS sucursal,
                c.nombre AS ciudad,
                c.provincia AS provincia
            FROM usuarios u
            LEFT JOIN sucursales s ON u.sucursal_id = s.id
            LEFT JOIN ciudades c ON s.ciudad_id = c.id
            ORDER BY u.id DESC
        """)

        return cur.fetchall()

    finally:
        cur.close()
        conn.close()


# =========================
# CAMBIAR CONTRASEÑA
# =========================
@app.put("/usuarios/cambiar-password")
def cambiar_password(
    password_actual: str,
    password_nueva: str,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("""
            SELECT id, password_hash
            FROM usuarios
            WHERE id = %s
        """, (usuario["id"],))

        user_db = cur.fetchone()

        if not user_db:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")

        if not pwd_context.verify(password_actual, user_db["password_hash"]):
            raise HTTPException(status_code=400, detail="Contraseña actual incorrecta")

        nueva_hash = pwd_context.hash(password_nueva)

        cur.execute("""
            UPDATE usuarios
            SET password_hash = %s,
                debe_cambiar_password = false,
                fecha_modificacion = NOW()
            WHERE id = %s
        """, (
            nueva_hash,
            usuario["id"]
        ))

        conn.commit()

        enviar_correo(
            destinatario=usuario["email"],
            asunto="Tu contraseña fue cambiada — NUMA",
            cuerpo_html=plantilla_base(
                titulo=f"Hola, {usuario['nombre']}",
                mensaje_html=(
                    "Te confirmamos que la contraseña de tu cuenta en el "
                    "Sistema Integral de Mediación NUMA fue cambiada. "
                    "Si tú no hiciste este cambio, contacta a tu administrador de inmediato."
                ),
                boton_texto="Ir a iniciar sesión",
                boton_url=f"{os.getenv('FRONTEND_URL', 'http://localhost:3000')}/login",
            )
        )

        return {
            "mensaje": "Contraseña actualizada correctamente"
        }

    except HTTPException:
        conn.rollback()
        raise

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cur.close()
        conn.close()

# =========================
# ME
# =========================      

@app.get("/me")
def me(usuario=Depends(obtener_usuario_actual)):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("""
            SELECT
                u.id,
                u.nombre,
                u.apellido,
                u.email,
                u.rol,
                u.activo,
                u.sucursal_id,
                u.debe_cambiar_password,
                s.nombre AS sucursal,
                c.nombre AS ciudad,
                c.provincia AS provincia
            FROM usuarios u
            LEFT JOIN sucursales s ON u.sucursal_id = s.id
            LEFT JOIN ciudades c ON s.ciudad_id = c.id
            WHERE u.id = %s
        """, (usuario["id"],))

        return cur.fetchone()

    finally:
        cur.close()
        conn.close()

# =========================
# PROVINCIAS
# =========================
@app.get("/provincias")
def obtener_provincias(usuario=Depends(obtener_usuario_actual)):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("""
            SELECT
                id,
                nombre,
                codigo,
                activo
            FROM provincias
            WHERE activo = true
            ORDER BY nombre
        """)

        return cur.fetchall()

    finally:
        cur.close()
        conn.close()

 # =========================
# CAMBIAR ESTADO CIUDAD
# =========================

@app.put("/ciudades/{id}/estado")
def cambiar_estado_ciudad(
    id: int,
    activo: bool,
    usuario=Depends(obtener_usuario_actual)
):
    if usuario["rol"] != "administrador":
        raise HTTPException(status_code=403, detail="Solo administrador puede realizar esta acción")

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("""
            UPDATE ciudades
            SET activo = %s
            WHERE id = %s
            RETURNING id, nombre, provincia_id, provincia, prefijo, activo, fecha_creacion
        """, (activo, id))

        ciudad = cur.fetchone()

        if not ciudad:
            raise HTTPException(status_code=404, detail="Ciudad no encontrada")

        conn.commit()
        return ciudad

    except HTTPException:
        conn.rollback()
        raise

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cur.close()
        conn.close()

# =========================
# CAMBIAR ESTADO SUCURSAL
# =========================

@app.put("/sucursales/{id}/estado")
def cambiar_estado_sucursal(
    id: int,
    activo: bool,
    usuario=Depends(obtener_usuario_actual)
):
    if usuario["rol"] != "administrador":
        raise HTTPException(
            status_code=403,
            detail="Solo administrador puede realizar esta acción"
        )

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("""
            UPDATE sucursales
            SET activo = %s,
                fecha_modificacion = NOW()
            WHERE id = %s
            RETURNING
                id,
                ciudad_id,
                nombre,
                codigo,
                prefijo,
                direccion,
                telefono,
                activo,
                fecha_creacion,
                fecha_modificacion
        """, (activo, id))

        sucursal = cur.fetchone()

        if not sucursal:
            raise HTTPException(status_code=404, detail="Sucursal no encontrada")

        registrar_auditoria(
            cur, usuario, "sucursal_activada" if activo else "sucursal_desactivada", "sucursales", id,
            f"{'Activó' if activo else 'Desactivó'} la sucursal {sucursal['nombre']}"
        )

        conn.commit()
        return sucursal

    except HTTPException:
        conn.rollback()
        raise

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cur.close()
        conn.close()

# =========================
# CAMBIAR ESTADO USUARIO
# =========================

@app.put("/usuarios/{id}/estado")
def cambiar_estado_usuario(
    id: int,
    activo: bool,
    usuario=Depends(obtener_usuario_actual)
):
    if usuario["rol"] != "administrador":
        raise HTTPException(
            status_code=403,
            detail="Solo administrador puede realizar esta acción"
        )

    if usuario["id"] == id and activo is False:
        raise HTTPException(
            status_code=400,
            detail="No puedes desactivar tu propio usuario"
        )

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("""
            UPDATE usuarios
            SET activo = %s,
                fecha_modificacion = NOW()
            WHERE id = %s
            RETURNING id, sucursal_id, nombre, apellido, email, rol, activo, fecha_creacion
        """, (activo, id))

        user = cur.fetchone()

        if not user:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")

        registrar_auditoria(
            cur, usuario, "usuario_activado" if activo else "usuario_desactivado", "usuarios", id,
            f"{'Activó' if activo else 'Desactivó'} al usuario {user['nombre']} {user['apellido']} ({user['email']})"
        )

        conn.commit()
        return user

    except HTTPException:
        conn.rollback()
        raise

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cur.close()
        conn.close()


# =========================
# CITAS
# =========================
@app.get("/citas")
def obtener_citas(
    estado: str = None,
    fecha_desde: str = None,
    fecha_hasta: str = None,
    usuario_id: int = None,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        query = """
            SELECT
                c.id,
                c.acta_id,
                c.proceso_id,
                c.cliente_demandante_id,
                c.cliente_demandado_id,
                c.sucursal_id,
                c.usuario_id,
                c.fecha,
                c.hora,
                c.tema,
                c.observaciones,
                c.estado,
                c.motivo_cancelacion,
                c.fecha_creacion,
                a.codigo_acta,
                s.nombre AS sucursal,
                ci.nombre AS ciudad,
                ci.provincia AS provincia,
                u.nombre || ' ' || u.apellido AS mediador,
                cd.cedula AS demandante_cedula,
                cd.nombre || ' ' || cd.apellido AS demandante,
                cdd.cedula AS demandado_cedula,
                cdd.nombre || ' ' || cdd.apellido AS demandado
            FROM citas c
            LEFT JOIN actas a ON c.acta_id = a.id
            JOIN sucursales s ON c.sucursal_id = s.id
            LEFT JOIN ciudades ci ON s.ciudad_id = ci.id
            JOIN usuarios u ON c.usuario_id = u.id
            JOIN clientes cd ON c.cliente_demandante_id = cd.id
            JOIN clientes cdd ON c.cliente_demandado_id = cdd.id
            WHERE 1=1
        """

        params = []

        # Cada mediador solo ve sus propias citas/agenda. El admin ve todo
        # y puede filtrar por un mediador específico con usuario_id.
        if usuario["rol"] != "administrador":
            query += " AND c.usuario_id = %s"
            params.append(usuario["id"])
        elif usuario_id:
            query += " AND c.usuario_id = %s"
            params.append(usuario_id)

        if estado:
            query += " AND c.estado = %s"
            params.append(estado)

        if fecha_desde:
            query += " AND c.fecha >= %s"
            params.append(fecha_desde)

        if fecha_hasta:
            query += " AND c.fecha <= %s"
            params.append(fecha_hasta)

        query += " ORDER BY c.fecha ASC, c.hora ASC"

        cur.execute(query, tuple(params))
        return cur.fetchall()

    finally:
        cur.close()
        conn.close()


@app.put("/citas/{cita_id}/estado")
def cambiar_estado_cita(
    cita_id: int,
    estado: str,
    motivo: str = None,
    usuario=Depends(obtener_usuario_actual)
):
    estados_validos = ["pendiente", "confirmada", "realizada", "cancelada"]

    if estado not in estados_validos:
        raise HTTPException(status_code=400, detail="Estado de invitación inválido")

    # Al cancelar, el motivo es obligatorio — así queda claro por qué se
    # canceló, tanto en Agenda como en la línea de tiempo del proceso.
    if estado == "cancelada" and not (motivo and motivo.strip()):
        raise HTTPException(
            status_code=400,
            detail="Debes indicar el motivo de la cancelación"
        )

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("""
            SELECT id, sucursal_id, usuario_id
            FROM citas
            WHERE id = %s
        """, (cita_id,))

        cita_actual = cur.fetchone()

        if not cita_actual:
            raise HTTPException(status_code=404, detail="Invitación no encontrada")

        if usuario["rol"] != "administrador":
            if usuario["id"] != cita_actual["usuario_id"]:
                raise HTTPException(
                    status_code=403,
                    detail="No puedes modificar invitaciones de otro mediador"
                )

        cur.execute("""
            UPDATE citas
            SET estado = %s,
                motivo_cancelacion = CASE WHEN %s = 'cancelada' THEN %s ELSE motivo_cancelacion END,
                fecha_modificacion = NOW()
            WHERE id = %s
            RETURNING *
        """, (estado, estado, motivo.strip() if motivo else None, cita_id))

        cita = cur.fetchone()
        conn.commit()

        return cita

    except HTTPException:
        conn.rollback()
        raise

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cur.close()
        conn.close()

# =========================
# SEDES
# =========================

@app.get("/sedes/{slug}")
def obtener_sede_publica(slug: str):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("""
            SELECT
                s.id,
                s.nombre,
                s.codigo,
                s.prefijo,
                s.direccion,
                s.telefono,
                s.slug,
                c.nombre AS ciudad,
                p.nombre AS provincia
            FROM sucursales s
            LEFT JOIN ciudades c
                ON c.id = s.ciudad_id
            LEFT JOIN provincias p
                ON p.id = c.provincia_id
            WHERE s.slug = %s
              AND s.activo = true
            LIMIT 1
        """, (slug,))

        sede = cur.fetchone()

        if not sede:
            raise HTTPException(
                status_code=404,
                detail="Sede no encontrada"
            )

        return sede

    finally:
        cur.close()
        conn.close()


@app.get("/sedes")
def listar_sedes_publicas():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("""
            SELECT
                s.id,
                s.nombre,
                s.codigo,
                s.prefijo,
                s.direccion,
                s.telefono,
                s.slug,
                c.nombre AS ciudad,
                p.nombre AS provincia
            FROM sucursales s
            LEFT JOIN ciudades c ON c.id = s.ciudad_id
            LEFT JOIN provincias p ON p.id = c.provincia_id
            WHERE s.activo = true
              AND s.slug IS NOT NULL
            ORDER BY p.nombre ASC, c.nombre ASC, s.nombre ASC
        """)

        return cur.fetchall()

    finally:
        cur.close()
        conn.close()

# =========================
# PROCESOS DE MEDIACIÓN
# =========================

@app.post("/procesos")
def crear_proceso_mediacion(
    cliente_demandante_id: int,
    cliente_demandado_id: int,
    tema: str,
    sucursal_id: int = None,
    empresa_solicitante_id: int = None,
    empresa_invitado_id: int = None,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        for _eid in (empresa_solicitante_id, empresa_invitado_id):
            if _eid:
                cur.execute("SELECT id FROM clientes WHERE id = %s AND tipo = 'empresa'", (_eid,))
                if not cur.fetchone():
                    raise HTTPException(status_code=400, detail="La empresa elegida no existe")

        if cliente_demandante_id == cliente_demandado_id:
            raise HTTPException(
                status_code=400,
                detail="Solicitante e invitado no pueden ser iguales"
            )

        if not tema.strip():
            raise HTTPException(
                status_code=400,
                detail="El tema es obligatorio"
            )

        # Conflicto de interés: quien lleva el proceso no puede ser una de
        # las partes. Se compara por cédula (misma persona = misma cédula).
        cur.execute("SELECT cedula FROM usuarios WHERE id = %s", (usuario["id"],))
        fila_mediador = cur.fetchone()
        if fila_mediador and fila_mediador["cedula"]:
            cur.execute(
                "SELECT id FROM clientes WHERE id IN (%s, %s) AND cedula = %s",
                (cliente_demandante_id, cliente_demandado_id, fila_mediador["cedula"])
            )
            if cur.fetchone():
                raise HTTPException(
                    status_code=400,
                    detail="No puedes ser parte de un proceso que tú mismo llevarías como mediador. Pide a otro mediador o al administrador que lo cree."
                )

        if usuario["rol"] != "administrador":
            sucursal_id = usuario["sucursal_id"]

        if not sucursal_id:
            raise HTTPException(
                status_code=400,
                detail="Sucursal obligatoria"
            )

        # Contador propio en la base: nunca retrocede ni repite un número,
        # aunque algún proceso se borre o se anule.
        cur.execute("SELECT nextval('procesos_codigo_seq') AS n")

        secuencial = cur.fetchone()["n"]
        codigo_proceso = f"PRC-{str(secuencial).zfill(6)}"

        cur.execute("""
            INSERT INTO procesos_mediacion (
                codigo_proceso,
                sucursal_id,
                usuario_id,
                cliente_demandante_id,
                cliente_demandado_id,
                tema,
                estado,
                fecha_creacion,
                fecha_modificacion
            )
            VALUES (%s, %s, %s, %s, %s, %s, 'en_negociacion', NOW(), NOW())
            RETURNING *
        """, (
            codigo_proceso,
            sucursal_id,
            usuario["id"],
            cliente_demandante_id,
            cliente_demandado_id,
            tema
        ))

        proceso = cur.fetchone()

        cur.execute("""
            INSERT INTO proceso_partes (proceso_id, rol, cliente_id, es_responsable, empresa_representada_id)
            VALUES (%s, 'solicitante', %s, true, %s),
                   (%s, 'invitado', %s, true, %s)
        """, (
            proceso["id"], cliente_demandante_id, empresa_solicitante_id,
            proceso["id"], cliente_demandado_id, empresa_invitado_id
        ))

        conn.commit()

        return proceso

    except HTTPException:
        conn.rollback()
        raise

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cur.close()
        conn.close()

# =========================
# OBTENER PROCESOS DE MEDIACIÓN
# =========================
@app.get("/procesos")
def obtener_procesos_mediacion(
    q: str = None,
    estado: str = None,
    ciudad_id: int = None,
    sucursal_id: int = None,
    usuario_id: int = None,
    cliente_id: int = None,
    fecha_desde: str = None,
    fecha_hasta: str = None,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        query = """
            SELECT
                p.id,
                p.codigo_proceso,
                p.tema,
                p.estado,
                p.fecha_creacion,
                p.fecha_acuerdo,
                p.sucursal_id,
                p.finalizado,
                p.acta_final_id,
                p.usuario_id,
                p.motivo_anulacion,
                af.codigo_acta AS codigo_acta,
                af.fecha_subida AS fecha_subida_acta,
                -- Id del proceso que, entre los pendientes de este mismo
                -- mediador, va primero en la fila (el más antiguo que sigue
                -- sin completar acta + comprobante + acta firmada y no está
                -- suspendido). Ya no hay plazo de 48 horas.
                (
                    SELECT p2.id
                    FROM procesos_mediacion p2
                    WHERE p2.usuario_id = p.usuario_id
                      AND """ + _sql_acta_pendiente("p2") + """
                    ORDER BY """ + _sql_fecha_cola("p2") + """ ASC NULLS LAST, p2.id ASC
                    LIMIT 1
                ) AS _id_bloqueante,
                p.suspendido,
                p.motivo_suspension,
                p.acuerdo_texto,
                p.requiere_acta_firmada,
                p.requiere_acta_no_acuerdo,
                p.pago_en_abonos,
                p.pago_pendiente,
                p.monto_total,
                p.abono1_monto,
                p.pago_fecha,
                (SELECT cx.fecha_pago FROM comprobantes_pago_extra cx
                  WHERE cx.proceso_id = p.id ORDER BY cx.id DESC LIMIT 1) AS pago_final_fecha,
                af.tipo AS tipo_acta,
                (p.acta_firmada_ruta IS NOT NULL) AS tiene_acta_firmada,
                p.acta_firmada_fecha,
                -- Si ya tiene una invitación pendiente, no se puede agendar
                -- otra hasta que esa se resuelva (realizada/cancelada) —
                -- usado para saber qué procesos se pueden elegir al crear
                -- una invitación nueva desde Agenda.
                EXISTS (
                    SELECT 1 FROM citas c
                    WHERE c.proceso_id = p.id AND c.estado = 'pendiente'
                ) AS tiene_invitacion_pendiente,
                -- Fecha y hora de esa invitación pendiente: el frontend las
                -- usa para decir qué toca hacer (agendar, esperar la
                -- reunión o registrar su resultado si ya pasó).
                (SELECT c.fecha FROM citas c
                  WHERE c.proceso_id = p.id AND c.estado = 'pendiente'
                  ORDER BY c.fecha, c.hora LIMIT 1) AS proxima_cita_fecha,
                (SELECT c.hora FROM citas c
                  WHERE c.proceso_id = p.id AND c.estado = 'pendiente'
                  ORDER BY c.fecha, c.hora LIMIT 1) AS proxima_cita_hora,
                cd.nombre || ' ' || cd.apellido AS demandante,
                cd.cedula AS demandante_cedula,
                cdd.nombre || ' ' || cdd.apellido AS demandado,
                cdd.cedula AS demandado_cedula,
                ARRAY(SELECT pp.cliente_id FROM proceso_partes pp
                      WHERE pp.proceso_id = p.id) AS partes_ids,
                (SELECT COUNT(*) FROM proceso_partes pp
                  WHERE pp.proceso_id = p.id AND pp.rol = 'solicitante')::int AS total_solicitantes,
                (SELECT COUNT(*) FROM proceso_partes pp
                  WHERE pp.proceso_id = p.id AND pp.rol = 'invitado')::int AS total_invitados,
                s.nombre AS sucursal,
                ci.nombre AS ciudad,
                u.nombre || ' ' || u.apellido AS usuario
            FROM procesos_mediacion p
            JOIN clientes cd ON p.cliente_demandante_id = cd.id
            JOIN clientes cdd ON p.cliente_demandado_id = cdd.id
            JOIN sucursales s ON p.sucursal_id = s.id
            JOIN ciudades ci ON s.ciudad_id = ci.id
            JOIN usuarios u ON p.usuario_id = u.id
            LEFT JOIN actas_proceso af ON af.id = p.acta_final_id
            WHERE 1=1
        """

        params = []

        # Cada mediador solo ve sus propios procesos. El admin ve todos y
        # puede filtrar por sucursal.
        if usuario["rol"] != "administrador":
            query += " AND p.usuario_id = %s"
            params.append(usuario["id"])

        if sucursal_id and usuario["rol"] == "administrador":
            query += " AND p.sucursal_id = %s"
            params.append(sucursal_id)

        if usuario_id and usuario["rol"] == "administrador":
            query += " AND p.usuario_id = %s"
            params.append(usuario_id)

        if estado:
            query += " AND p.estado = %s"
            params.append(estado)

        if q:
            query += """
                AND (
                    p.codigo_proceso ILIKE %s OR
                    p.tema ILIKE %s OR
                    cd.nombre ILIKE %s OR
                    cd.apellido ILIKE %s OR
                    cdd.nombre ILIKE %s OR
                    cdd.apellido ILIKE %s OR
                    cd.cedula ILIKE %s OR
                    cdd.cedula ILIKE %s OR
                    EXISTS (
                        SELECT 1 FROM proceso_partes pp
                        JOIN clientes cx ON cx.id = pp.cliente_id
                        WHERE pp.proceso_id = p.id AND (
                            cx.nombre ILIKE %s OR cx.apellido ILIKE %s OR
                            cx.cedula ILIKE %s OR cx.ruc ILIKE %s
                        )
                    )
                )
            """
            like = f"%{q}%"
            params.extend([like] * 12)

        if ciudad_id and usuario["rol"] == "administrador":
                query += " AND ci.id = %s"
                params.append(ciudad_id)

        if fecha_desde:
                query += " AND DATE(p.fecha_creacion AT TIME ZONE 'America/Guayaquil') >= %s"
                params.append(fecha_desde)

        if fecha_hasta:
                query += " AND DATE(p.fecha_creacion AT TIME ZONE 'America/Guayaquil') <= %s"
                params.append(fecha_hasta)

        # Usado por el detalle expandible del reporte de Clientes: procesos
        # donde el cliente participó, ya sea como solicitante o invitado.
        if cliente_id:
                query += """ AND (p.cliente_demandante_id = %s OR p.cliente_demandado_id = %s
                    OR EXISTS (SELECT 1 FROM proceso_partes pp
                               WHERE pp.proceso_id = p.id AND pp.cliente_id = %s))"""
                params.extend([cliente_id, cliente_id, cliente_id])

        query += " ORDER BY p.id DESC"

        cur.execute(query, tuple(params))
        filas = cur.fetchall()

        # Convierte el id auxiliar en un booleano simple (¿se puede subir
        # el acta de este proceso ahora mismo, o está bloqueado detrás de
        # otro?), y quita el campo auxiliar antes de devolver — el
        # frontend solo necesita el booleano.
        for fila in filas:
            id_bloqueante = fila.pop("_id_bloqueante", None)
            # Qué proceso lo bloquea (si no es él mismo).
            fila["bloqueante_id"] = (
                id_bloqueante
                if (_con_acta(fila["estado"], fila["requiere_acta_no_acuerdo"]) and not fila["suspendido"]
                    and id_bloqueante is not None and id_bloqueante != fila["id"])
                else None
            )
            fila["acta_primero_en_fila"] = bool(
                _con_acta(fila["estado"], fila["requiere_acta_no_acuerdo"])
                and not fila["finalizado"]
                and not fila["suspendido"]
                # Sin bloqueante -> libre. Con bloqueante -> solo ese id
                # puede subir su acta + comprobante ahora.
                and (id_bloqueante is None or id_bloqueante == fila["id"])
            )

            # Etapa del acta de un proceso cerrado con acuerdo:
            # falta_acta -> falta_firmada -> completa (o suspendido).
            etapa = None
            if _con_acta(fila["estado"], fila["requiere_acta_no_acuerdo"]):
                if fila["suspendido"]:
                    etapa = "suspendido"
                elif not fila["finalizado"]:
                    etapa = "falta_acta"
                elif fila["requiere_acta_firmada"] and not fila["tiene_acta_firmada"]:
                    etapa = "falta_firmada"
                else:
                    etapa = "completa"
            fila["etapa_acta"] = etapa

        return filas

    finally:
        cur.close()
        conn.close()


# Un proceso "en la fila" de actas es uno cerrado con acuerdo, no suspendido
# por el administrador, al que todavía le falta subir el acta + comprobante
# o el acta firmada. Ya no hay plazo de 48 horas: bloquea hasta que se
# complete (o el administrador lo suspenda).
def _sql_tiene_acta(a: str = "p") -> str:
    # Procesos que llevan acta: cerrados con acuerdo, o cerrados sin acuerdo
    # cuando el mediador pidió emitir el acta de no acuerdo.
    return (
        f"({a}.estado = 'cerrado_con_acuerdo' OR "
        f"({a}.estado = 'cerrado_sin_acuerdo' AND {a}.requiere_acta_no_acuerdo))"
    )


def _sql_fecha_cola(a: str = "p") -> str:
    # Fecha que ordena la fila de actas: la del acuerdo o, en el acta de no
    # acuerdo, la de cuando se pidió el acta.
    return f"COALESCE({a}.fecha_acuerdo, {a}.fecha_solicitud_acta_na)"


def _con_acta(estado, requiere_na) -> bool:
    return estado == "cerrado_con_acuerdo" or (
        estado == "cerrado_sin_acuerdo" and bool(requiere_na)
    )


def _sql_acta_pendiente(a: str = "p") -> str:
    return (
        f"({_sql_tiene_acta(a)} AND {a}.suspendido = false AND "
        f"({a}.finalizado = false OR "
        f"({a}.requiere_acta_firmada AND {a}.acta_firmada_ruta IS NULL)))"
    )


def _supabase_config():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    bucket = os.getenv("SUPABASE_BUCKET", "actas-pdf")
    if not url or not key:
        raise HTTPException(status_code=500, detail="Supabase no está configurado en el backend")
    return url.rstrip("/"), key, bucket

# =========================
# PARTES DEL PROCESO (varios solicitantes / invitados)
# =========================
def _consulta_partes(cur, proceso_id):
    cur.execute("""
        SELECT
            pp.id, pp.rol, pp.es_responsable, pp.cliente_id,
            pp.empresa_representada_id,
            c.tipo, c.nombre, c.apellido, c.cedula, c.ruc, c.razon_social,
            c.representante_nombre, c.representante_cedula, c.telefono, c.email, c.direccion,
            e.nombre AS empresa_nombre, e.ruc AS empresa_ruc,
            e.email AS empresa_email, e.telefono AS empresa_telefono, e.direccion AS empresa_direccion,
            e.representante_nombre AS empresa_representante_nombre,
            e.representante_cedula AS empresa_representante_cedula
        FROM proceso_partes pp
        JOIN clientes c ON c.id = pp.cliente_id
        LEFT JOIN clientes e ON e.id = pp.empresa_representada_id
        WHERE pp.proceso_id = %s
        ORDER BY pp.rol DESC, pp.es_responsable DESC, pp.id ASC
    """, (proceso_id,))
    return cur.fetchall()


def _proceso_para_editar_partes(cur, proceso_id, usuario):
    cur.execute(
        "SELECT id, usuario_id, estado, cliente_demandante_id, cliente_demandado_id "
        "FROM procesos_mediacion WHERE id = %s FOR UPDATE",
        (proceso_id,)
    )
    proceso = cur.fetchone()
    if not proceso:
        raise HTTPException(status_code=404, detail="Proceso no encontrado")
    if usuario["rol"] != "administrador" and proceso["usuario_id"] != usuario["id"]:
        raise HTTPException(status_code=403, detail="No puedes modificar este proceso")
    if proceso["estado"] != "en_negociacion":
        raise HTTPException(
            status_code=400,
            detail="Solo se pueden cambiar las partes mientras el proceso sigue en negociación"
        )
    return proceso


def _sincronizar_responsables(cur, proceso_id):
    """Mantiene en procesos_mediacion al responsable de cada lado (así
    reportes, agenda y listas siguen funcionando sin cambios)."""
    cur.execute("""
        UPDATE procesos_mediacion p
        SET cliente_demandante_id = COALESCE((
                SELECT cliente_id FROM proceso_partes
                WHERE proceso_id = p.id AND rol = 'solicitante' AND es_responsable LIMIT 1
            ), cliente_demandante_id),
            cliente_demandado_id = COALESCE((
                SELECT cliente_id FROM proceso_partes
                WHERE proceso_id = p.id AND rol = 'invitado' AND es_responsable LIMIT 1
            ), cliente_demandado_id),
            fecha_modificacion = NOW()
        WHERE p.id = %s
    """, (proceso_id,))


@app.get("/procesos/{proceso_id}/partes")
def obtener_partes_proceso(proceso_id: int, usuario=Depends(obtener_usuario_actual)):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT usuario_id FROM procesos_mediacion WHERE id = %s", (proceso_id,))
        proceso = cur.fetchone()
        if not proceso:
            raise HTTPException(status_code=404, detail="Proceso no encontrado")
        if usuario["rol"] != "administrador" and proceso["usuario_id"] != usuario["id"]:
            raise HTTPException(status_code=403, detail="No puedes ver este proceso")
        return _consulta_partes(cur, proceso_id)
    finally:
        cur.close()
        conn.close()


@app.post("/procesos/{proceso_id}/partes")
def agregar_parte_proceso(
    proceso_id: int,
    rol: str,
    cliente_id: int,
    empresa_representada_id: int = None,
    usuario=Depends(obtener_usuario_actual)
):
    if rol not in ("solicitante", "invitado"):
        raise HTTPException(status_code=400, detail="Rol inválido")

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        _proceso_para_editar_partes(cur, proceso_id, usuario)

        cur.execute("SELECT id, tipo, nombre, apellido, cedula FROM clientes WHERE id = %s", (cliente_id,))
        cliente = cur.fetchone()
        if not cliente:
            raise HTTPException(status_code=404, detail="Cliente no encontrado")

        if empresa_representada_id:
            if cliente["tipo"] == "empresa":
                raise HTTPException(status_code=400, detail="Una empresa no representa a otra empresa")
            cur.execute("SELECT id FROM clientes WHERE id = %s AND tipo = 'empresa'", (empresa_representada_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=400, detail="La empresa elegida no existe")

        # Una misma persona no puede estar dos veces en el proceso (ni de
        # los dos lados a la vez).
        cur.execute(
            "SELECT rol FROM proceso_partes WHERE proceso_id = %s AND cliente_id = %s",
            (proceso_id, cliente_id)
        )
        existe = cur.fetchone()
        if existe:
            raise HTTPException(
                status_code=400,
                detail=f"Ese cliente ya está en este proceso como {existe['rol']}"
            )

        # El mediador del proceso no puede ser parte (compara por cédula).
        cur.execute("SELECT cedula FROM usuarios WHERE id = (SELECT usuario_id FROM procesos_mediacion WHERE id = %s)", (proceso_id,))
        med = cur.fetchone()
        if med and med["cedula"] and cliente["cedula"] and med["cedula"] == cliente["cedula"]:
            raise HTTPException(
                status_code=400,
                detail="El mediador que lleva el proceso no puede ser una de las partes"
            )

        cur.execute("""
            INSERT INTO proceso_partes (proceso_id, rol, cliente_id, es_responsable, empresa_representada_id)
            VALUES (%s, %s, %s, false, %s)
        """, (proceso_id, rol, cliente_id, empresa_representada_id))

        registrar_auditoria(
            cur, usuario, "proceso_parte_agregada", "procesos", proceso_id,
            f"Agregó a {cliente['nombre']} {cliente['apellido']} como {rol}"
        )
        conn.commit()
        return _consulta_partes(cur, proceso_id)

    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@app.put("/procesos/{proceso_id}/partes/{parte_id}/responsable")
def cambiar_responsable_parte(
    proceso_id: int,
    parte_id: int,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        _proceso_para_editar_partes(cur, proceso_id, usuario)

        cur.execute(
            "SELECT id, rol FROM proceso_partes WHERE id = %s AND proceso_id = %s",
            (parte_id, proceso_id)
        )
        parte = cur.fetchone()
        if not parte:
            raise HTTPException(status_code=404, detail="Parte no encontrada")

        cur.execute(
            "UPDATE proceso_partes SET es_responsable = false WHERE proceso_id = %s AND rol = %s",
            (proceso_id, parte["rol"])
        )
        cur.execute("UPDATE proceso_partes SET es_responsable = true WHERE id = %s", (parte_id,))
        _sincronizar_responsables(cur, proceso_id)

        registrar_auditoria(
            cur, usuario, "proceso_responsable_cambiado", "procesos", proceso_id,
            f"Cambió el responsable de los {parte['rol']}s"
        )
        conn.commit()
        return _consulta_partes(cur, proceso_id)

    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@app.delete("/procesos/{proceso_id}/partes/{parte_id}")
def quitar_parte_proceso(
    proceso_id: int,
    parte_id: int,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        _proceso_para_editar_partes(cur, proceso_id, usuario)

        cur.execute(
            "SELECT id, rol, es_responsable, cliente_id FROM proceso_partes WHERE id = %s AND proceso_id = %s",
            (parte_id, proceso_id)
        )
        parte = cur.fetchone()
        if not parte:
            raise HTTPException(status_code=404, detail="Parte no encontrada")
        if parte["es_responsable"]:
            raise HTTPException(
                status_code=400,
                detail="No puedes quitar al responsable. Primero marca a otra persona como responsable."
            )

        cur.execute("DELETE FROM proceso_partes WHERE id = %s", (parte_id,))

        registrar_auditoria(
            cur, usuario, "proceso_parte_quitada", "procesos", proceso_id,
            f"Quitó a un {parte['rol']} (cliente {parte['cliente_id']})"
        )
        conn.commit()
        return _consulta_partes(cur, proceso_id)

    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


# =========================
# OBTENER CITAS DE PROCESO
# =========================
@app.get("/procesos/{proceso_id}/citas")
def obtener_citas_proceso(
    proceso_id: int,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        if usuario["rol"] != "administrador":
            cur.execute("""
                SELECT usuario_id FROM procesos_mediacion WHERE id = %s
            """, (proceso_id,))

            proceso_check = cur.fetchone()

            if not proceso_check:
                raise HTTPException(status_code=404, detail="Proceso no encontrado")

            if proceso_check["usuario_id"] != usuario["id"]:
                raise HTTPException(
                    status_code=403,
                    detail="No puedes ver las invitaciones de este proceso"
                )

        cur.execute("""
            SELECT
                c.id,
                c.fecha,
                c.hora,
                c.tema,
                c.estado,
                c.observaciones,
                c.motivo_cancelacion,
                c.fecha_creacion,
                cp.nombre || ' ' || cp.apellido AS creado_por
            FROM citas c
            LEFT JOIN usuarios cp ON cp.id = c.creado_por_id
            WHERE c.proceso_id = %s
            ORDER BY c.id ASC
        """, (proceso_id,))

        return cur.fetchall()

    except HTTPException:
        raise

    finally:
        cur.close()
        conn.close()

# =========================
# CREAR INVITACION DE PROCESO
# =========================
@app.post("/procesos/{proceso_id}/citas")
def crear_invitacion_proceso(
    proceso_id: int,
    fecha: str,
    hora: str,
    observaciones: str = None,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:

        cur.execute("""
            SELECT
                p.*,
                cd.nombre || ' ' || cd.apellido AS demandante,
                cdd.nombre || ' ' || cdd.apellido AS demandado,
                s.nombre AS sucursal,
                c.nombre AS ciudad
            FROM procesos_mediacion p
            JOIN clientes cd ON p.cliente_demandante_id = cd.id
            JOIN clientes cdd ON p.cliente_demandado_id = cdd.id
            JOIN sucursales s ON p.sucursal_id = s.id
            JOIN ciudades c ON s.ciudad_id = c.id
            WHERE p.id = %s
        """, (proceso_id,))

        proceso = cur.fetchone()

        if not proceso:
            raise HTTPException(
                status_code=404,
                detail="Proceso no encontrado"
            )

        if usuario["rol"] != "administrador" and proceso["usuario_id"] != usuario["id"]:
            raise HTTPException(
                status_code=403,
                detail="Solo el mediador asignado a este proceso puede crear invitaciones"
            )

        if proceso["estado"] == "anulado":
            raise HTTPException(
                status_code=400,
                detail="Este proceso está anulado: no admite invitaciones"
            )

        if not observaciones or not observaciones.strip():
            raise HTTPException(
                status_code=400,
                detail="Debes ingresar una observación para la invitación"
            )

        try:
            fecha_hora_cita = datetime.datetime.strptime(
                f"{fecha} {hora}", "%Y-%m-%d %H:%M"
            )
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="Fecha u hora inválida"
            )

        # fecha/hora llegan como hora local de Ecuador (UTC-5, sin horario de
        # verano), pero el servidor corre con reloj en UTC. Se convierte la
        # cita a UTC antes de comparar contra utcnow(); comparar contra
        # datetime.now() aquí causaba que cualquier invitación de las
        # próximas ~5 horas se rechazara como "ya pasada".
        fecha_hora_cita_utc = fecha_hora_cita + datetime.timedelta(hours=5)

        if fecha_hora_cita_utc < datetime.datetime.utcnow():
            raise HTTPException(
                status_code=400,
                detail="No se puede agendar una invitación en una fecha u hora pasada"
            )

        cur.execute("""
            SELECT id
            FROM citas
            WHERE usuario_id = %s
              AND fecha = %s
              AND hora = %s
              AND estado = 'pendiente'
        """, (proceso["usuario_id"], fecha, hora))

        if cur.fetchone():
            raise HTTPException(
                status_code=400,
                detail=f"El mediador ya tiene otra invitación pendiente el {fecha} a las {hora}. Elige otra hora."
            )

        try:
            cur.execute("""
                INSERT INTO citas (
                    proceso_id,
                    cliente_demandante_id,
                    cliente_demandado_id,
                    sucursal_id,
                    usuario_id,
                    creado_por_id,
                    fecha,
                    hora,
                    tema,
                    observaciones,
                    estado,
                    fecha_creacion,
                    fecha_modificacion
                )
                VALUES (
                    %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                    'pendiente',
                    NOW(),
                    NOW()
                )
                RETURNING *
            """, (
                proceso_id,
                proceso["cliente_demandante_id"],
                proceso["cliente_demandado_id"],
                proceso["sucursal_id"],
                proceso["usuario_id"],
                usuario["id"],
                fecha,
                hora,
                f"Invitación proceso {proceso['codigo_proceso']}",
                observaciones
            ))
        except psycopg2_errors.UniqueViolation:
            # Choca con el índice único parcial de la migración 005: dos
            # peticiones casi simultáneas (doble clic) intentaron crear una
            # invitación en el mismo horario para el mismo mediador. La
            # primera ya se guardó; a esta la rechazamos con el mismo
            # mensaje amigable que la validación previa.
            conn.rollback()
            raise HTTPException(
                status_code=400,
                detail=f"El mediador ya tiene otra invitación pendiente el {fecha} a las {hora}. Elige otra hora."
            )

        cita = cur.fetchone()

        cur.execute("""
            SELECT id FROM usuarios WHERE rol = 'administrador' AND activo = true
        """)

        for admin in cur.fetchall():
            crear_notificacion(
                cur,
                admin["id"],
                "Nueva invitación creada",
                f"{proceso['codigo_proceso']} | "
                f"{proceso['demandante']} vs {proceso['demandado']} | "
                f"{proceso['ciudad']} - {proceso['sucursal']} | "
                f"{fecha} {hora}",
                "cita",
                "proceso_mediacion",
                proceso_id
            )

        conn.commit()

        # Si la invitación es para hoy o mañana, se avisa de inmediato al
        # mediador y a los admins (el recordatorio diario corre a las 8am,
        # así que una invitación creada después de esa hora no se avisaba).
        # No repite avisos que ya existan.
        try:
            generar_recordatorios_citas()
        except Exception as e:
            print("No se pudo generar el recordatorio inmediato:", e)

        return cita

    except HTTPException:
        conn.rollback()
        raise

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cur.close()
        conn.close()


# =========================
# AVANCES POR PROCESO
# =========================

@app.put("/procesos/{proceso_id}/anular")
def anular_proceso(
    proceso_id: int,
    motivo: str,
    usuario=Depends(obtener_usuario_actual)
):
    # Solo el administrador anula. El proceso NO se borra: conserva su
    # número (queda bloqueado), su historial y su motivo de anulación.
    if usuario["rol"] != "administrador":
        raise HTTPException(status_code=403, detail="Solo el administrador puede anular un proceso")

    motivo = (motivo or "").strip()
    if len(motivo) < 5:
        raise HTTPException(status_code=400, detail="Debes indicar el motivo de la anulación")

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("SELECT id, codigo_proceso, estado FROM procesos_mediacion WHERE id = %s FOR UPDATE", (proceso_id,))
        proceso = cur.fetchone()

        if not proceso:
            raise HTTPException(status_code=404, detail="Proceso no encontrado")

        if proceso["estado"] == "anulado":
            raise HTTPException(status_code=400, detail="Este proceso ya está anulado")

        if proceso["estado"] != "en_negociacion":
            raise HTTPException(
                status_code=400,
                detail="Solo se puede anular un proceso que sigue en negociación. Los procesos ya cerrados no se anulan."
            )

        cur.execute("""
            UPDATE procesos_mediacion
            SET estado = 'anulado',
                motivo_anulacion = %s,
                fecha_anulacion = NOW(),
                anulado_por_id = %s,
                fecha_modificacion = NOW()
            WHERE id = %s
        """, (motivo, usuario["id"], proceso_id))

        # Las invitaciones pendientes de un proceso anulado ya no tienen
        # sentido: se cancelan para que no queden como "atrasadas".
        cur.execute("""
            UPDATE citas
            SET estado = 'cancelada',
                motivo_cancelacion = 'Proceso anulado',
                fecha_modificacion = NOW()
            WHERE proceso_id = %s AND estado IN ('pendiente', 'confirmada')
        """, (proceso_id,))

        registrar_auditoria(
            cur, usuario, "proceso_anulado", "procesos", proceso_id,
            f"Proceso {proceso['codigo_proceso']} anulado. Motivo: {motivo}"
        )

        conn.commit()
        return {"mensaje": "Proceso anulado", "codigo_proceso": proceso["codigo_proceso"]}

    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


@app.post("/procesos/{proceso_id}/avances")
def crear_avance_proceso(
    proceso_id: int,
    resultado: str,
    observacion: str,
    proxima_fecha: str = None,
    proxima_hora: str = None,
    proxima_observaciones: str = None,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        if not observacion.strip():
            raise HTTPException(status_code=400, detail="La observación es obligatoria")

        if resultado not in [
            "en_negociacion", "no_realizada",
            "cerrado_con_acuerdo", "cerrado_sin_acuerdo", "archivado"
        ]:
            raise HTTPException(status_code=400, detail="Resultado no válido")

        cur.execute("""
            SELECT *
            FROM procesos_mediacion
            WHERE id = %s
        """, (proceso_id,))

        proceso = cur.fetchone()

        if not proceso:
            raise HTTPException(status_code=404, detail="Proceso no encontrado")

        if proceso["estado"] == "anulado":
            raise HTTPException(
                status_code=400,
                detail="Este proceso está anulado: no admite avances"
            )

        if proceso["estado"] in ["cerrado_con_acuerdo", "cerrado_sin_acuerdo", "archivado"]:
            raise HTTPException(
                status_code=400,
                detail="No se pueden registrar avances en un proceso cerrado"
            )

        if usuario["rol"] != "administrador" and proceso["usuario_id"] != usuario["id"]:
            raise HTTPException(
                status_code=403,
                detail="Solo el mediador asignado a este proceso puede registrar avances"
            )

        # Buscar la última invitación pendiente del proceso
        cur.execute("""
            SELECT id
            FROM citas
            WHERE proceso_id = %s
              AND estado = 'pendiente'
            ORDER BY fecha ASC, hora ASC
            LIMIT 1
        """, (proceso_id,))

        cita_pendiente = cur.fetchone()

        if not cita_pendiente:
            raise HTTPException(
                status_code=400,
                detail="No existe una invitación pendiente para registrar resultado"
            )

        cita_id = cita_pendiente["id"]
        nueva_cita_id = None

        # "no_realizada": la invitación no se pudo llevar a cabo (no asistió
        # una parte, etc.). La nota queda como constancia, la invitación se
        # cierra con ese estado y el proceso sigue en negociación para poder
        # programar la siguiente invitación.
        es_no_realizada = (resultado == "no_realizada")

        # Marcar invitación como realizada (o como no realizada)
        cur.execute("""
            UPDATE citas
            SET
                estado = %s,
                fecha_modificacion = NOW()
            WHERE id = %s
        """, ("no_realizada" if es_no_realizada else "realizada", cita_id))

        # Si programa nueva invitación
        if proxima_fecha and proxima_hora:
            cur.execute("""
                SELECT id
                FROM citas
                WHERE usuario_id = %s
                  AND fecha = %s
                  AND hora = %s
                  AND estado = 'pendiente'
            """, (usuario["id"], proxima_fecha, proxima_hora))

            if cur.fetchone():
                raise HTTPException(
                    status_code=400,
                    detail=f"Ya tienes otra invitación pendiente el {proxima_fecha} a las {proxima_hora}. Elige otra hora."
                )

            try:
                cur.execute("""
                    INSERT INTO citas (
                        proceso_id,
                        cliente_demandante_id,
                        cliente_demandado_id,
                        sucursal_id,
                        usuario_id,
                        creado_por_id,
                        fecha,
                        hora,
                        tema,
                        observaciones,
                        estado,
                        fecha_creacion,
                        fecha_modificacion
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'pendiente', NOW(), NOW())
                    RETURNING id
                """, (
                    proceso_id,
                    proceso["cliente_demandante_id"],
                    proceso["cliente_demandado_id"],
                    proceso["sucursal_id"],
                    usuario["id"],
                    usuario["id"],
                    proxima_fecha,
                    proxima_hora,
                    f"Seguimiento del proceso {proceso['codigo_proceso']}",
                    proxima_observaciones.strip() if proxima_observaciones and proxima_observaciones.strip() else "Nueva invitación programada como seguimiento del proceso."
                ))
            except psycopg2_errors.UniqueViolation:
                # Mismo caso de carrera que en crear_invitacion_proceso,
                # pero disparado desde el registro de avance con "próxima
                # invitación".
                conn.rollback()
                raise HTTPException(
                    status_code=400,
                    detail=f"Ya tienes otra invitación pendiente el {proxima_fecha} a las {proxima_hora}. Elige otra hora."
                )

            nueva_cita_id = cur.fetchone()["id"]

        cur.execute("""
            INSERT INTO avances_mediacion (
                proceso_id,
                cita_id,
                usuario_id,
                resultado,
                observacion,
                proxima_fecha,
                proxima_hora,
                nueva_cita_id
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (
            proceso_id,
            cita_id,
            usuario["id"],
            resultado,
            observacion,
            proxima_fecha,
            proxima_hora,
            nueva_cita_id
        ))

        avance = cur.fetchone()

        if resultado == "cerrado_con_acuerdo":
            # El texto del acuerdo se escribe una sola vez, aquí (en el
            # resultado de la última invitación), y es el que sale en el
            # acta imprimible. Solo el administrador lo puede corregir luego.
            cur.execute("""
                UPDATE procesos_mediacion
                SET
                    estado = %s,
                    fecha_acuerdo = NOW(),
                    acuerdo_texto = %s,
                    fecha_modificacion = NOW()
                WHERE id = %s
            """, (
                resultado,
                observacion.strip(),
                proceso_id
            ))
        elif es_no_realizada:
            # El proceso no cambia de estado: sigue en negociación.
            cur.execute("""
                UPDATE procesos_mediacion
                SET fecha_modificacion = NOW()
                WHERE id = %s
            """, (proceso_id,))
        else:
            cur.execute("""
                UPDATE procesos_mediacion
                SET
                    estado = %s,
                    fecha_modificacion = NOW()
                WHERE id = %s
            """, (
                resultado,
                proceso_id
            ))

        if resultado in ["cerrado_con_acuerdo", "cerrado_sin_acuerdo", "archivado"]:
            etiquetas_resultado = {
                "cerrado_con_acuerdo": "Cerrado con acuerdo",
                "cerrado_sin_acuerdo": "Cerrado sin acuerdo",
                "archivado": "Archivado"
            }

            cur.execute("""
                SELECT id FROM usuarios WHERE rol = 'administrador' AND activo = true
            """)

            for admin in cur.fetchall():
                crear_notificacion(
                    cur,
                    admin["id"],
                    "Proceso cerrado",
                    f"El proceso {proceso['codigo_proceso']} quedó: {etiquetas_resultado[resultado]}",
                    "proceso",
                    "proceso_mediacion",
                    proceso_id
                )

        conn.commit()
        return avance

    except HTTPException:
        conn.rollback()
        raise

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cur.close()
        conn.close()

# =========================
# OBTENER AVANCES POR PROCESO
# =========================
@app.get("/procesos/{proceso_id}/avances")
def obtener_avances_proceso(
    proceso_id: int,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        if usuario["rol"] != "administrador":
            cur.execute("""
                SELECT usuario_id FROM procesos_mediacion WHERE id = %s
            """, (proceso_id,))

            proceso_check = cur.fetchone()

            if not proceso_check:
                raise HTTPException(status_code=404, detail="Proceso no encontrado")

            if proceso_check["usuario_id"] != usuario["id"]:
                raise HTTPException(
                    status_code=403,
                    detail="No puedes ver los avances de este proceso"
                )

        cur.execute("""
            SELECT
                av.id,
                av.proceso_id,
                av.cita_id,
                av.usuario_id,
                av.resultado,
                av.observacion,
                av.proxima_fecha,
                av.proxima_hora,
                av.nueva_cita_id,
                av.fecha_creacion,
                u.nombre || ' ' || u.apellido AS usuario
            FROM avances_mediacion av
            JOIN usuarios u ON av.usuario_id = u.id
            WHERE av.proceso_id = %s
            ORDER BY av.fecha_creacion DESC
        """, (proceso_id,))

        return cur.fetchall()

    except HTTPException:
        raise

    finally:
        cur.close()
        conn.close()


# =========================
# SUBIR ACTA FINAL DEL PROCESO
# =========================
@app.post("/procesos/{proceso_id}/acta-final")
async def subir_acta_final_proceso(
    proceso_id: int,
    archivo: UploadFile = File(...),
    comprobante_pago: UploadFile = File(...),
    pago_modo: str = Form("completo"),
    monto_total: float = Form(None),
    monto_abono: float = Form(None),
    fecha_pago: str = Form(None),
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        if archivo.content_type != "application/pdf":
            raise HTTPException(
                status_code=400,
                detail="El acta final solo se puede subir en PDF"
            )

        tipos_comprobante_permitidos = ["application/pdf", "image/jpeg", "image/jpg", "image/png"]
        if comprobante_pago.content_type not in tipos_comprobante_permitidos:
            raise HTTPException(
                status_code=400,
                detail="El comprobante de pago debe ser un PDF, JPG o PNG"
            )

        cur.execute("""
            SELECT
                p.id,
                p.codigo_proceso,
                p.sucursal_id,
                p.usuario_id,
                p.estado,
                p.finalizado,
                p.suspendido,
                p.fecha_acuerdo,
                p.fecha_solicitud_acta_na,
                p.requiere_acta_no_acuerdo,
                s.nombre AS sucursal,
                s.codigo_corto,
                c.nombre AS ciudad,
                c.prefijo AS prefijo_ciudad
            FROM procesos_mediacion p
            JOIN sucursales s ON p.sucursal_id = s.id
            JOIN ciudades c ON s.ciudad_id = c.id
            WHERE p.id = %s
        """, (proceso_id,))

        proceso = cur.fetchone()

        if not proceso:
            raise HTTPException(status_code=404, detail="Proceso no encontrado")

        if not _con_acta(proceso["estado"], proceso["requiere_acta_no_acuerdo"]):
            raise HTTPException(
                status_code=400,
                detail="Solo se puede subir acta final cuando el proceso está cerrado con acuerdo "
                       "(o cerrado sin acuerdo con el acta de no acuerdo solicitada)"
            )

        es_no_acuerdo = proceso["estado"] == "cerrado_sin_acuerdo"

        # Pago: completo (un comprobante) o en abonos (primer abono ahora y
        # el saldo con el acta firmada).
        pago_modo = (pago_modo or "completo").strip()
        if pago_modo not in ("completo", "abonos"):
            raise HTTPException(status_code=400, detail="Modo de pago no válido")

        try:
            fecha_pago_d = (
                datetime.datetime.strptime(fecha_pago, "%Y-%m-%d").date()
                if fecha_pago else
                (datetime.datetime.utcnow() - datetime.timedelta(hours=5)).date()
            )
        except ValueError:
            raise HTTPException(status_code=400, detail="La fecha del pago no es válida")

        if pago_modo == "abonos":
            if monto_total is None or monto_abono is None or monto_total <= 0 or monto_abono <= 0:
                raise HTTPException(
                    status_code=400,
                    detail="Indica el valor total y lo que se pagó en este primer abono"
                )
            if monto_abono >= monto_total:
                raise HTTPException(
                    status_code=400,
                    detail="El primer abono debe ser menor al valor total (si ya se pagó todo, elige pago completo)"
                )

        if proceso["finalizado"]:
            raise HTTPException(
                status_code=400,
                detail="El proceso ya está finalizado"
            )

        if usuario["rol"] != "administrador" and proceso["usuario_id"] != usuario["id"]:
            raise HTTPException(
                status_code=403,
                detail="Solo el mediador asignado a este proceso puede subir el acta final"
            )

        if proceso["suspendido"]:
            raise HTTPException(
                status_code=400,
                detail="Este proceso está suspendido por el administrador. Pídele que lo reactive."
            )

        # Los datos de facturación son obligatorios antes de subir el acta.
        cur.execute("SELECT 1 FROM proceso_facturacion WHERE proceso_id = %s", (proceso_id,))
        if not cur.fetchone():
            raise HTTPException(
                status_code=400,
                detail="Antes de subir el acta, completa los datos de facturación del proceso"
            )

        # Fila de espera por mediador: el proceso pendiente más antiguo
        # (sin completar acta + comprobante + acta firmada, y no suspendido)
        # va primero. Mientras no se complete, el mediador no puede subir
        # el acta de otros. El administrador no tiene esta restricción y
        # puede suspender el proceso bloqueante para desbloquear al mediador.
        if usuario["rol"] != "administrador":
            cur.execute(
                "SELECT id, codigo_proceso, fecha_acuerdo, fecha_solicitud_acta_na, estado, finalizado "
                "FROM procesos_mediacion p "
                "WHERE p.usuario_id = %s AND " + _sql_acta_pendiente("p") +
                " ORDER BY " + _sql_fecha_cola("p") + " ASC NULLS LAST, p.id ASC LIMIT 1",
                (usuario["id"],)
            )

            bloqueante = cur.fetchone()

            if bloqueante and bloqueante["id"] != proceso_id:
                faltante = (
                    "el acta firmada" if bloqueante["finalizado"]
                    else "el acta final y el comprobante de pago"
                )
                _f_cola = bloqueante["fecha_acuerdo"] or bloqueante["fecha_solicitud_acta_na"]
                fecha_txt = (
                    # La fecha se guarda en UTC (NOW() del servidor):
                    # se muestra en hora de Ecuador (UTC-5).
                    (_f_cola - datetime.timedelta(hours=5)).strftime("%d/%m/%Y %H:%M")
                    if _f_cola else "—"
                )
                _cierre_txt = (
                    "cerrado sin acuerdo, con acta de no acuerdo pedida"
                    if bloqueante["estado"] == "cerrado_sin_acuerdo" else "cerrado con acuerdo"
                )
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Primero debes completar el proceso {bloqueante['codigo_proceso']} "
                        f"({_cierre_txt} el {fecha_txt}): falta subir {faltante}. "
                        f"Hasta entonces no puedes subir actas de otros procesos. Si no se "
                        f"puede completar, pide al administrador que lo suspenda."
                    )
                )

        # Generar código de acta final
        prefijo_codigo = f"{proceso['prefijo_ciudad']}-{proceso['codigo_corto']}"

        cur.execute("""
            SELECT COUNT(*) AS total
            FROM actas_proceso ap
            JOIN procesos_mediacion p ON ap.proceso_id = p.id
            WHERE p.sucursal_id = %s
        """, (proceso["sucursal_id"],))

        secuencial = cur.fetchone()["total"] + 1
        codigo_acta = f"{prefijo_codigo}-{str(secuencial).zfill(5)}"

        contenido_acta = await archivo.read()
        contenido_comprobante = await comprobante_pago.read()

        # Se comprimen antes de subir a Supabase Storage para gastar menos
        # espacio de almacenamiento sin perder legibilidad (ver
        # app/file_compress_utils.py). Si algo falla al comprimir, se sube
        # el archivo tal cual llegó — nunca se bloquea la subida por eso.
        contenido_acta = comprimir_pdf(contenido_acta)

        content_type_comprobante = comprobante_pago.content_type
        extension_comprobante_forzada = None

        if content_type_comprobante in ("image/jpeg", "image/jpg", "image/png"):
            contenido_comprobante, content_type_comprobante, extension_comprobante_forzada = (
                comprimir_imagen(contenido_comprobante, content_type_comprobante)
            )
        elif content_type_comprobante == "application/pdf":
            contenido_comprobante = comprimir_pdf(contenido_comprobante)

        extension_comprobante = extension_comprobante_forzada or {
            "application/pdf": "pdf",
            "image/jpeg": "jpg",
            "image/jpg": "jpg",
            "image/png": "png",
        }[content_type_comprobante]

        nombre_unico_acta = f"{uuid.uuid4()}.pdf"
        ruta_storage = f"actas-finales/{codigo_acta}/{nombre_unico_acta}"

        nombre_unico_comprobante = f"{uuid.uuid4()}.{extension_comprobante}"
        ruta_comprobante = f"comprobantes-pago/{codigo_acta}/{nombre_unico_comprobante}"

        SUPABASE_URL = os.getenv("SUPABASE_URL")
        SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        SUPABASE_BUCKET = os.getenv("SUPABASE_BUCKET", "actas-pdf")

        if not SUPABASE_URL or not SUPABASE_KEY:
            raise HTTPException(
                status_code=500,
                detail="Supabase no está configurado en el backend"
            )

        SUPABASE_URL = SUPABASE_URL.rstrip("/")

        def _subir_a_supabase(ruta, contenido, content_type):
            ruta_encoded = quote(ruta, safe="/")
            upload_url = (
                f"{SUPABASE_URL}/storage/v1/object/"
                f"{SUPABASE_BUCKET}/{ruta_encoded}"
            )
            headers = {
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "apikey": SUPABASE_KEY,
                "Content-Type": content_type,
                "x-upsert": "true",
            }
            return requests.post(upload_url, headers=headers, data=contenido)

        response_acta = _subir_a_supabase(ruta_storage, contenido_acta, "application/pdf")

        if response_acta.status_code not in [200, 201]:
            raise HTTPException(
                status_code=500,
                detail=f"Error subiendo el acta final a Supabase: {response_acta.text}"
            )

        response_comprobante = _subir_a_supabase(
            ruta_comprobante, contenido_comprobante, content_type_comprobante
        )

        if response_comprobante.status_code not in [200, 201]:
            raise HTTPException(
                status_code=500,
                detail=f"Error subiendo el comprobante de pago a Supabase: {response_comprobante.text}"
            )

        cur.execute("""
            INSERT INTO actas_proceso (
                proceso_id,
                codigo_acta,
                tipo,
                archivo_pdf,
                nombre_original,
                tamano_bytes,
                ruta_comprobante_pago,
                nombre_comprobante_pago,
                tamano_comprobante_bytes,
                usuario_id,
                fecha_subida
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            RETURNING id
        """, (
            proceso_id,
            codigo_acta,
            "no_acuerdo" if es_no_acuerdo else "acuerdo",
            ruta_storage,
            archivo.filename,
            len(contenido_acta),
            ruta_comprobante,
            comprobante_pago.filename,
            len(contenido_comprobante),
            usuario["id"]
        ))

        acta_final = cur.fetchone()

        cur.execute("""
            UPDATE procesos_mediacion
            SET
                acta_final_id = %s,
                finalizado = true,
                fecha_cierre = NOW(),
                pago_en_abonos = %s,
                pago_pendiente = %s,
                monto_total = %s,
                abono1_monto = %s,
                pago_fecha = %s,
                fecha_modificacion = NOW()
            WHERE id = %s
        """, (
            acta_final["id"],
            pago_modo == "abonos",
            pago_modo == "abonos",
            monto_total if pago_modo == "abonos" else None,
            monto_abono if pago_modo == "abonos" else None,
            fecha_pago_d,
            proceso_id
        ))

        cur.execute("""
            SELECT id FROM usuarios WHERE rol = 'administrador' AND activo = true
        """)

        for admin in cur.fetchall():
            crear_notificacion(
                cur,
                admin["id"],
                "Acta final subida",
                f"Se subió el acta {'de no acuerdo ' if es_no_acuerdo else 'final '}{codigo_acta} ({proceso['ciudad']} - {proceso['sucursal']}), "
                + ("con el primer abono (saldo pendiente)" if pago_modo == "abonos" else "con comprobante de pago"),
                "acta",
                "proceso_mediacion",
                proceso_id
            )

        conn.commit()

        return {
            "mensaje": "Acta final y comprobante de pago subidos correctamente",
            "codigo_acta": codigo_acta,
            "ruta": ruta_storage,
            "ruta_comprobante": ruta_comprobante
        }

    except HTTPException:
        conn.rollback()
        raise

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cur.close()
        conn.close()

# =========================
# ACTA FIRMADA (PDF firmado por las partes)
# =========================
@app.post("/procesos/{proceso_id}/acta-firmada")
async def subir_acta_firmada(
    proceso_id: int,
    archivo: UploadFile = File(...),
    comprobante_final: UploadFile = File(None),
    fecha_pago_final: str = Form(None),
    confirmo: bool = Form(False),
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        if not confirmo:
            raise HTTPException(
                status_code=400,
                detail="Debes confirmar que el documento es el acta firmada por todas las partes"
            )

        if archivo.content_type != "application/pdf":
            raise HTTPException(
                status_code=400,
                detail="El acta firmada solo se puede subir en PDF (no fotos)"
            )

        cur.execute("""
            SELECT p.id, p.codigo_proceso, p.usuario_id, p.estado, p.finalizado,
                   p.suspendido, p.requiere_acta_firmada, p.acta_firmada_ruta,
                   p.requiere_acta_no_acuerdo, p.pago_pendiente, p.monto_total,
                   p.abono1_monto, p.acta_final_id,
                   ap.codigo_acta
            FROM procesos_mediacion p
            LEFT JOIN actas_proceso ap ON ap.id = p.acta_final_id
            WHERE p.id = %s
            FOR UPDATE OF p
        """, (proceso_id,))
        proceso = cur.fetchone()

        if not proceso:
            raise HTTPException(status_code=404, detail="Proceso no encontrado")

        if usuario["rol"] != "administrador" and proceso["usuario_id"] != usuario["id"]:
            raise HTTPException(
                status_code=403,
                detail="Solo el mediador asignado a este proceso puede subir el acta firmada"
            )

        if not _con_acta(proceso["estado"], proceso["requiere_acta_no_acuerdo"]) or not proceso["finalizado"]:
            raise HTTPException(
                status_code=400,
                detail="Primero se debe subir el acta final y el comprobante de pago"
            )

        if proceso["suspendido"]:
            raise HTTPException(
                status_code=400,
                detail="Este proceso está suspendido por el administrador"
            )

        # Si el pago quedó en abonos, el segundo comprobante (el saldo) es
        # obligatorio para poder cerrar el proceso.
        if proceso["pago_pendiente"] and (comprobante_final is None or not comprobante_final.filename):
            raise HTTPException(
                status_code=400,
                detail="Este proceso tiene un saldo pendiente: sube también el comprobante del segundo pago"
            )
        if proceso["pago_pendiente"] and comprobante_final.content_type not in (
            "application/pdf", "image/jpeg", "image/jpg", "image/png"
        ):
            raise HTTPException(
                status_code=400,
                detail="El comprobante del segundo pago debe ser un PDF, JPG o PNG"
            )
        try:
            fecha_pago_final_d = (
                datetime.datetime.strptime(fecha_pago_final, "%Y-%m-%d").date()
                if fecha_pago_final else
                (datetime.datetime.utcnow() - datetime.timedelta(hours=5)).date()
            )
        except ValueError:
            raise HTTPException(status_code=400, detail="La fecha del segundo pago no es válida")

        if proceso["acta_firmada_ruta"]:
            raise HTTPException(status_code=400, detail="El acta firmada ya fue subida")

        if not proceso["requiere_acta_firmada"]:
            raise HTTPException(
                status_code=400,
                detail="Este proceso es anterior a la regla del acta firmada y no la requiere"
            )

        contenido = comprimir_pdf(await archivo.read())

        base_url, key, bucket = _supabase_config()
        ruta = f"actas-firmadas/{proceso['codigo_acta'] or proceso['codigo_proceso']}/{uuid.uuid4()}.pdf"

        resp = requests.post(
            f"{base_url}/storage/v1/object/{bucket}/{quote(ruta, safe='/')}",
            headers={
                "Authorization": f"Bearer {key}",
                "apikey": key,
                "Content-Type": "application/pdf",
                "x-upsert": "true",
            },
            data=contenido
        )
        if resp.status_code not in [200, 201]:
            raise HTTPException(
                status_code=500,
                detail=f"Error subiendo el acta firmada a Supabase: {resp.text}"
            )

        if proceso["pago_pendiente"]:
            cont_c = await comprobante_final.read()
            ct_c = comprobante_final.content_type
            ext_c = None
            if ct_c in ("image/jpeg", "image/jpg", "image/png"):
                cont_c, ct_c, ext_c = comprimir_imagen(cont_c, ct_c)
            elif ct_c == "application/pdf":
                cont_c = comprimir_pdf(cont_c)
            ext_c = ext_c or {
                "application/pdf": "pdf", "image/jpeg": "jpg",
                "image/jpg": "jpg", "image/png": "png",
            }[ct_c]
            ruta_c = f"comprobantes-pago/{proceso['codigo_acta'] or proceso['codigo_proceso']}/{uuid.uuid4()}.{ext_c}"
            resp_c = requests.post(
                f"{base_url}/storage/v1/object/{bucket}/{quote(ruta_c, safe='/')}",
                headers={
                    "Authorization": f"Bearer {key}",
                    "apikey": key,
                    "Content-Type": ct_c,
                    "x-upsert": "true",
                },
                data=cont_c
            )
            if resp_c.status_code not in [200, 201]:
                raise HTTPException(
                    status_code=500,
                    detail=f"Error subiendo el comprobante del segundo pago a Supabase: {resp_c.text}"
                )
            saldo = None
            if proceso["monto_total"] is not None and proceso["abono1_monto"] is not None:
                saldo = proceso["monto_total"] - proceso["abono1_monto"]
            cur.execute("""
                INSERT INTO comprobantes_pago_extra
                    (proceso_id, acta_id, monto, fecha_pago, ruta, nombre, tamano_bytes, usuario_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                proceso_id, proceso["acta_final_id"], saldo, fecha_pago_final_d,
                ruta_c, comprobante_final.filename, len(cont_c), usuario["id"]
            ))

        cur.execute("""
            UPDATE procesos_mediacion
            SET acta_firmada_ruta = %s,
                acta_firmada_nombre = %s,
                acta_firmada_tamano = %s,
                acta_firmada_fecha = NOW(),
                acta_firmada_usuario_id = %s,
                pago_pendiente = false,
                fecha_modificacion = NOW()
            WHERE id = %s
        """, (ruta, archivo.filename, len(contenido), usuario["id"], proceso_id))

        cur.execute("SELECT id FROM usuarios WHERE rol = 'administrador' AND activo = true")
        for admin in cur.fetchall():
            crear_notificacion(
                cur, admin["id"], "Acta firmada subida",
                f"Se subió el acta firmada del proceso {proceso['codigo_proceso']}. El proceso quedó completo.",
                "acta", "proceso_mediacion", proceso_id
            )

        registrar_auditoria(
            cur, usuario, "acta_firmada_subida", "procesos", proceso_id,
            f"Subió el acta firmada del proceso {proceso['codigo_proceso']}"
        )

        conn.commit()
        return {"mensaje": "Acta firmada subida. El proceso quedó completo."}

    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@app.get("/procesos/{proceso_id}/acta-firmada")
def ver_acta_firmada(proceso_id: int, usuario=Depends(obtener_usuario_actual)):
    # El administrador ve cualquier acta firmada; el mediador solo la de
    # sus propios procesos.
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            "SELECT codigo_proceso, acta_firmada_ruta, usuario_id FROM procesos_mediacion WHERE id = %s",
            (proceso_id,)
        )
        p = cur.fetchone()
        if not p or not p["acta_firmada_ruta"]:
            raise HTTPException(status_code=404, detail="Acta firmada no encontrada")
        if usuario["rol"] != "administrador" and p["usuario_id"] != usuario["id"]:
            raise HTTPException(status_code=403, detail="No tienes permiso para ver esta acta firmada")

        base_url, key, bucket = _supabase_config()
        resp = requests.get(
            f"{base_url}/storage/v1/object/{bucket}/{quote(p['acta_firmada_ruta'], safe='/')}",
            headers={"Authorization": f"Bearer {key}", "apikey": key}
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=404, detail="PDF no encontrado en Storage")

        return Response(
            content=resp.content,
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="acta-firmada-{p["codigo_proceso"]}.pdf"'}
        )
    finally:
        cur.close()
        conn.close()


# =========================
# ACUERDO: corrección (solo administrador) e historial
# =========================
@app.put("/procesos/{proceso_id}/acuerdo")
def corregir_acuerdo(
    proceso_id: int,
    texto: str,
    motivo: str,
    usuario=Depends(obtener_usuario_actual)
):
    if usuario["rol"] != "administrador":
        raise HTTPException(status_code=403, detail="Solo el administrador puede corregir el acuerdo")

    texto = (texto or "").strip()
    motivo = (motivo or "").strip()
    if not texto:
        raise HTTPException(status_code=400, detail="El texto del acuerdo no puede quedar vacío")
    if len(motivo) < 5:
        raise HTTPException(status_code=400, detail="Indica el motivo de la corrección")

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            "SELECT id, codigo_proceso, estado, acuerdo_texto FROM procesos_mediacion WHERE id = %s FOR UPDATE",
            (proceso_id,)
        )
        p = cur.fetchone()
        if not p:
            raise HTTPException(status_code=404, detail="Proceso no encontrado")
        if p["estado"] != "cerrado_con_acuerdo":
            raise HTTPException(status_code=400, detail="Solo se corrige el acuerdo de un proceso cerrado con acuerdo")
        if (p["acuerdo_texto"] or "").strip() == texto:
            raise HTTPException(status_code=400, detail="El texto es igual al actual")

        cur.execute("""
            INSERT INTO proceso_acuerdo_historial (proceso_id, texto_anterior, texto_nuevo, motivo, usuario_id)
            VALUES (%s, %s, %s, %s, %s)
        """, (proceso_id, p["acuerdo_texto"], texto, motivo, usuario["id"]))

        cur.execute(
            "UPDATE procesos_mediacion SET acuerdo_texto = %s, fecha_modificacion = NOW() WHERE id = %s",
            (texto, proceso_id)
        )

        registrar_auditoria(
            cur, usuario, "acuerdo_corregido", "procesos", proceso_id,
            f"Corrigió el acuerdo del proceso {p['codigo_proceso']}. Motivo: {motivo}"
        )
        conn.commit()
        return {"mensaje": "Acuerdo corregido", "acuerdo_texto": texto}

    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@app.get("/procesos/{proceso_id}/acuerdo/historial")
def historial_acuerdo(proceso_id: int, usuario=Depends(obtener_usuario_actual)):
    if usuario["rol"] != "administrador":
        raise HTTPException(status_code=403, detail="Solo el administrador puede ver el historial del acuerdo")

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT h.id, h.texto_anterior, h.texto_nuevo, h.motivo, h.fecha,
                   u.nombre || ' ' || u.apellido AS usuario
            FROM proceso_acuerdo_historial h
            JOIN usuarios u ON u.id = h.usuario_id
            WHERE h.proceso_id = %s
            ORDER BY h.id DESC
        """, (proceso_id,))
        return cur.fetchall()
    finally:
        cur.close()
        conn.close()


# =========================
# SUSPENDER / REACTIVAR (desbloquea al mediador, solo administrador)
# =========================
@app.put("/procesos/{proceso_id}/suspender")
def suspender_proceso(proceso_id: int, motivo: str, usuario=Depends(obtener_usuario_actual)):
    if usuario["rol"] != "administrador":
        raise HTTPException(status_code=403, detail="Solo el administrador puede suspender un proceso")

    motivo = (motivo or "").strip()
    if len(motivo) < 5:
        raise HTTPException(status_code=400, detail="Indica el motivo de la suspensión")

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            "SELECT id, codigo_proceso, usuario_id, estado, suspendido, requiere_acta_no_acuerdo FROM procesos_mediacion WHERE id = %s FOR UPDATE",
            (proceso_id,)
        )
        p = cur.fetchone()
        if not p:
            raise HTTPException(status_code=404, detail="Proceso no encontrado")
        if not _con_acta(p["estado"], p["requiere_acta_no_acuerdo"]):
            raise HTTPException(status_code=400, detail="Solo se suspende un proceso cerrado que espera su acta")
        if p["suspendido"]:
            raise HTTPException(status_code=400, detail="El proceso ya está suspendido")

        cur.execute("""
            UPDATE procesos_mediacion
            SET suspendido = true, motivo_suspension = %s, fecha_suspension = NOW(),
                suspendido_por_id = %s, fecha_modificacion = NOW()
            WHERE id = %s
        """, (motivo, usuario["id"], proceso_id))

        crear_notificacion(
            cur, p["usuario_id"], "Proceso suspendido",
            f"El administrador suspendió el proceso {p['codigo_proceso']}. Ya puedes subir las actas de tus otros procesos. Motivo: {motivo}",
            "proceso", "proceso_mediacion", proceso_id
        )
        registrar_auditoria(
            cur, usuario, "proceso_suspendido", "procesos", proceso_id,
            f"Suspendió el proceso {p['codigo_proceso']}. Motivo: {motivo}"
        )
        conn.commit()
        return {"mensaje": "Proceso suspendido. El mediador ya no está bloqueado por este proceso."}

    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@app.put("/procesos/{proceso_id}/reactivar")
def reactivar_proceso(proceso_id: int, usuario=Depends(obtener_usuario_actual)):
    if usuario["rol"] != "administrador":
        raise HTTPException(status_code=403, detail="Solo el administrador puede reactivar un proceso")

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            "SELECT id, codigo_proceso, usuario_id, suspendido FROM procesos_mediacion WHERE id = %s FOR UPDATE",
            (proceso_id,)
        )
        p = cur.fetchone()
        if not p:
            raise HTTPException(status_code=404, detail="Proceso no encontrado")
        if not p["suspendido"]:
            raise HTTPException(status_code=400, detail="El proceso no está suspendido")

        cur.execute("""
            UPDATE procesos_mediacion
            SET suspendido = false, fecha_modificacion = NOW()
            WHERE id = %s
        """, (proceso_id,))

        crear_notificacion(
            cur, p["usuario_id"], "Proceso reactivado",
            f"El administrador reactivó el proceso {p['codigo_proceso']}: vuelve a la fila para completar su acta.",
            "proceso", "proceso_mediacion", proceso_id
        )
        registrar_auditoria(
            cur, usuario, "proceso_reactivado", "procesos", proceso_id,
            f"Reactivó el proceso {p['codigo_proceso']}"
        )
        conn.commit()
        return {"mensaje": "Proceso reactivado"}

    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


# =========================
# ACTA DE NO ACUERDO: el mediador la pide (opcional)
# =========================
@app.post("/procesos/{proceso_id}/solicitar-acta-no-acuerdo")
def solicitar_acta_no_acuerdo(proceso_id: int, usuario=Depends(obtener_usuario_actual)):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            "SELECT id, codigo_proceso, usuario_id, estado, requiere_acta_no_acuerdo "
            "FROM procesos_mediacion WHERE id = %s FOR UPDATE",
            (proceso_id,)
        )
        p = cur.fetchone()
        if not p:
            raise HTTPException(status_code=404, detail="Proceso no encontrado")
        if usuario["rol"] != "administrador" and p["usuario_id"] != usuario["id"]:
            raise HTTPException(
                status_code=403,
                detail="Solo el mediador asignado a este proceso puede pedir el acta de no acuerdo"
            )
        if p["estado"] != "cerrado_sin_acuerdo":
            raise HTTPException(
                status_code=400,
                detail="El acta de no acuerdo solo se pide en un proceso cerrado sin acuerdo"
            )
        if p["requiere_acta_no_acuerdo"]:
            raise HTTPException(status_code=400, detail="El acta de no acuerdo ya fue pedida")

        cur.execute("""
            UPDATE procesos_mediacion
            SET requiere_acta_no_acuerdo = true,
                fecha_solicitud_acta_na = NOW(),
                fecha_modificacion = NOW()
            WHERE id = %s
        """, (proceso_id,))

        cur.execute("SELECT id FROM usuarios WHERE rol = 'administrador' AND activo = true")
        for admin in cur.fetchall():
            crear_notificacion(
                cur, admin["id"], "Acta de no acuerdo pedida",
                f"Se pidió el acta de no acuerdo del proceso {p['codigo_proceso']}.",
                "acta", "proceso_mediacion", proceso_id
            )
        registrar_auditoria(
            cur, usuario, "acta_no_acuerdo_solicitada", "procesos", proceso_id,
            f"Pidió el acta de no acuerdo del proceso {p['codigo_proceso']}"
        )
        conn.commit()
        return {"mensaje": "Acta de no acuerdo solicitada. Ya puedes subirla como cualquier otra acta."}

    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


# =========================
# COMPROBANTE DEL SEGUNDO PAGO (abonos)
# =========================
@app.get("/procesos/{proceso_id}/comprobante-final")
def ver_comprobante_pago_final(proceso_id: int, usuario=Depends(obtener_usuario_actual)):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT cx.ruta, cx.nombre, p.usuario_id, p.codigo_proceso
            FROM comprobantes_pago_extra cx
            JOIN procesos_mediacion p ON p.id = cx.proceso_id
            WHERE cx.proceso_id = %s
            ORDER BY cx.id DESC LIMIT 1
        """, (proceso_id,))
        c = cur.fetchone()
        if not c:
            raise HTTPException(status_code=404, detail="Este proceso no tiene comprobante del segundo pago")
        if usuario["rol"] != "administrador" and c["usuario_id"] != usuario["id"]:
            raise HTTPException(status_code=403, detail="No puedes ver este comprobante")

        base_url, key, bucket = _supabase_config()
        resp = requests.get(
            f"{base_url}/storage/v1/object/{bucket}/{quote(c['ruta'], safe='/')}",
            headers={"Authorization": f"Bearer {key}", "apikey": key}
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=404, detail="Comprobante no encontrado en Storage")

        ext = (c["ruta"].rsplit(".", 1)[-1] or "pdf").lower()
        tipo = {"pdf": "application/pdf", "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png"}.get(
            ext, "application/octet-stream"
        )
        return Response(
            content=resp.content,
            media_type=tipo,
            headers={"Content-Disposition": f'inline; filename="comprobante-final-{c["codigo_proceso"]}.{ext}"'}
        )
    finally:
        cur.close()
        conn.close()


# =========================
# DATOS DEL ACTA IMPRIMIBLE
# =========================
@app.get("/procesos/{proceso_id}/acta-datos")
def datos_acta_imprimible(proceso_id: int, usuario=Depends(obtener_usuario_actual)):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT
                p.id, p.usuario_id, p.estado, p.finalizado, p.tema,
                p.fecha_acuerdo, p.acuerdo_texto, p.requiere_acta_no_acuerdo,
                ap.codigo_acta, ap.tipo AS tipo_acta, ap.fecha_subida AS fecha_acta,
                s.nombre AS sucursal, s.direccion AS sucursal_direccion,
                ci.nombre AS ciudad,
                u.nombre AS mediador_nombre, u.apellido AS mediador_apellido,
                u.cedula AS mediador_cedula
            FROM procesos_mediacion p
            JOIN sucursales s ON s.id = p.sucursal_id
            JOIN ciudades ci ON ci.id = s.ciudad_id
            JOIN usuarios u ON u.id = p.usuario_id
            LEFT JOIN actas_proceso ap ON ap.id = p.acta_final_id
            WHERE p.id = %s
        """, (proceso_id,))
        p = cur.fetchone()

        if not p:
            raise HTTPException(status_code=404, detail="Proceso no encontrado")
        if usuario["rol"] != "administrador" and p["usuario_id"] != usuario["id"]:
            raise HTTPException(status_code=403, detail="No puedes ver esta acta")
        if not _con_acta(p["estado"], p["requiere_acta_no_acuerdo"]) or not p["finalizado"]:
            raise HTTPException(
                status_code=400,
                detail="El acta imprimible se habilita cuando ya se subió el acta final y el comprobante de pago"
            )

        # En el acta de no acuerdo, el texto es lo que el mediador dejó
        # registrado al cerrar el proceso sin acuerdo.
        if p["estado"] == "cerrado_sin_acuerdo":
            cur.execute("""
                SELECT observacion, fecha_creacion FROM avances_mediacion
                WHERE proceso_id = %s AND resultado = 'cerrado_sin_acuerdo'
                ORDER BY id DESC LIMIT 1
            """, (proceso_id,))
            av = cur.fetchone()
            p["observacion_cierre"] = av["observacion"] if av else None
            p["fecha_cierre_sin_acuerdo"] = av["fecha_creacion"] if av else None

        return {"proceso": p, "partes": _consulta_partes(cur, proceso_id)}
    finally:
        cur.close()
        conn.close()


# =========================
# CONTADORES DE ACTAS COMPLETAS (visibles para todos los mediadores)
# =========================
@app.get("/actas/resumen-mes")
def resumen_actas_mes(mes: str = None, usuario=Depends(obtener_usuario_actual)):
    """Actas COMPLETAS (con acta firmada subida) por mediador y sucursal en
    un mes (formato YYYY-MM; por defecto el mes actual, hora de Ecuador).
    Solo cuenta lo terminado: lo que está a medias no suma."""
    if mes is None:
        mes = datetime.datetime.now(
            datetime.timezone(datetime.timedelta(hours=-5))
        ).strftime("%Y-%m")
    if not re.match(r"^\d{4}-(0[1-9]|1[0-2])$", mes):
        raise HTTPException(status_code=400, detail="Mes inválido (usa AAAA-MM)")

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT
                u.id AS usuario_id,
                u.nombre || ' ' || u.apellido AS mediador,
                s.id AS sucursal_id,
                s.nombre AS sucursal,
                ci.nombre AS ciudad,
                COUNT(p.id) FILTER (
                    WHERE p.acta_firmada_ruta IS NOT NULL
                      AND to_char(p.acta_firmada_fecha AT TIME ZONE 'America/Guayaquil', 'YYYY-MM') = %s
                )::int AS total
            FROM usuarios u
            JOIN sucursales s ON s.id = u.sucursal_id
            JOIN ciudades ci ON ci.id = s.ciudad_id
            LEFT JOIN procesos_mediacion p ON p.usuario_id = u.id
            WHERE u.rol = 'mediador' AND u.activo = true
            GROUP BY u.id, u.nombre, u.apellido, s.id, s.nombre, ci.nombre
            ORDER BY total DESC, mediador ASC
        """, (mes,))
        mediadores = cur.fetchall()

        por_sucursal = {}
        for m in mediadores:
            k = m["sucursal_id"]
            if k not in por_sucursal:
                por_sucursal[k] = {
                    "sucursal_id": k, "sucursal": m["sucursal"],
                    "ciudad": m["ciudad"], "total": 0
                }
            por_sucursal[k]["total"] += m["total"]

        return {
            "mes": mes,
            "mediadores": mediadores,
            "sucursales": sorted(por_sucursal.values(), key=lambda x: (-x["total"], x["sucursal"])),
            "total": sum(m["total"] for m in mediadores),
        }
    finally:
        cur.close()
        conn.close()


# =========================
# DATOS DE FACTURACIÓN DEL PROCESO
# =========================
# La factura se emite en el sistema propio del centro; aquí solo se guardan
# los datos de a nombre de quién va. Son obligatorios antes de subir el acta
# final y el comprobante de pago.
def _consulta_facturacion(cur, proceso_id):
    cur.execute("""
        SELECT f.origen, f.cliente_id, f.tipo_identificacion, f.identificacion,
               f.nombre, f.direccion, f.email, f.telefono, f.fecha_actualizacion,
               u.nombre || ' ' || u.apellido AS actualizado_por
        FROM proceso_facturacion f
        LEFT JOIN usuarios u ON u.id = f.actualizado_por_id
        WHERE f.proceso_id = %s
    """, (proceso_id,))
    return cur.fetchone()


@app.get("/procesos/{proceso_id}/facturacion")
def obtener_facturacion_proceso(proceso_id: int, usuario=Depends(obtener_usuario_actual)):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT usuario_id FROM procesos_mediacion WHERE id = %s", (proceso_id,))
        p = cur.fetchone()
        if not p:
            raise HTTPException(status_code=404, detail="Proceso no encontrado")
        if usuario["rol"] != "administrador" and p["usuario_id"] != usuario["id"]:
            raise HTTPException(status_code=403, detail="No puedes ver este proceso")
        return _consulta_facturacion(cur, proceso_id)
    finally:
        cur.close()
        conn.close()


@app.put("/procesos/{proceso_id}/facturacion")
def guardar_facturacion_proceso(
    proceso_id: int,
    origen: str,
    tipo_identificacion: str,
    identificacion: str,
    nombre: str,
    direccion: str,
    email: str,
    telefono: str = None,
    cliente_id: int = None,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            "SELECT id, usuario_id, estado, finalizado, codigo_proceso, "
            "requiere_acta_firmada, acta_firmada_ruta "
            "FROM procesos_mediacion WHERE id = %s FOR UPDATE",
            (proceso_id,)
        )
        p = cur.fetchone()
        if not p:
            raise HTTPException(status_code=404, detail="Proceso no encontrado")
        es_admin = usuario["rol"] == "administrador"
        if not es_admin and p["usuario_id"] != usuario["id"]:
            raise HTTPException(status_code=403, detail="No puedes modificar este proceso")
        if p["estado"] == "anulado":
            raise HTTPException(status_code=400, detail="El proceso está anulado")
        # El mediador puede corregir la facturación hasta subir el acta
        # firmada (por si cambian a último momento). Con el proceso completo,
        # solo el administrador puede corregirla.
        proceso_completo = p["finalizado"] and (
            p["acta_firmada_ruta"] is not None or not p["requiere_acta_firmada"]
        )
        if proceso_completo and not es_admin:
            raise HTTPException(
                status_code=400,
                detail="El proceso ya está completo: solo el administrador puede corregir los datos de facturación"
            )

        origen = (origen or "").strip()
        tipo_identificacion = (tipo_identificacion or "").strip()
        nombre = (nombre or "").strip()
        direccion = (direccion or "").strip()
        email = (email or "").strip()
        telefono = (telefono or "").strip() or None
        identificacion = (identificacion or "").strip().upper()

        if origen not in ("parte", "tercero"):
            raise HTTPException(status_code=400, detail="Indica a nombre de quién va la factura")
        if tipo_identificacion not in ("cedula", "ruc", "pasaporte"):
            raise HTTPException(status_code=400, detail="Tipo de identificación inválido")

        if tipo_identificacion == "cedula":
            identificacion = re.sub(r"\D", "", identificacion)
            if not validar_cedula_ecuatoriana(identificacion):
                raise HTTPException(status_code=400, detail="La cédula de facturación es inválida")
        elif tipo_identificacion == "ruc":
            identificacion = re.sub(r"\D", "", identificacion)
            if len(identificacion) != 13 or identificacion.endswith("000"):
                raise HTTPException(status_code=400, detail="El RUC de facturación debe tener 13 dígitos")
        else:
            if not re.match(r"^[A-Z0-9]{5,20}$", identificacion):
                raise HTTPException(status_code=400, detail="El pasaporte debe tener entre 5 y 20 letras o números")

        if len(nombre) < 3:
            raise HTTPException(status_code=400, detail="El nombre o razón social de facturación es obligatorio")
        if len(direccion) < 5:
            raise HTTPException(status_code=400, detail="La dirección de facturación es obligatoria")
        if not email or not validar_email(email):
            raise HTTPException(status_code=400, detail="El correo de facturación es inválido")

        if origen == "parte":
            if not cliente_id:
                raise HTTPException(status_code=400, detail="Elige a cuál de las partes se factura")
            cur.execute("""
                SELECT 1 FROM proceso_partes
                WHERE proceso_id = %s AND (cliente_id = %s OR empresa_representada_id = %s)
                LIMIT 1
            """, (proceso_id, cliente_id, cliente_id))
            if not cur.fetchone():
                raise HTTPException(status_code=400, detail="Esa persona o empresa no es parte de este proceso")
        else:
            cliente_id = None

        cur.execute("""
            INSERT INTO proceso_facturacion
                (proceso_id, origen, cliente_id, tipo_identificacion, identificacion,
                 nombre, direccion, email, telefono, actualizado_por_id, fecha_actualizacion)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (proceso_id) DO UPDATE SET
                origen = EXCLUDED.origen,
                cliente_id = EXCLUDED.cliente_id,
                tipo_identificacion = EXCLUDED.tipo_identificacion,
                identificacion = EXCLUDED.identificacion,
                nombre = EXCLUDED.nombre,
                direccion = EXCLUDED.direccion,
                email = EXCLUDED.email,
                telefono = EXCLUDED.telefono,
                actualizado_por_id = EXCLUDED.actualizado_por_id,
                fecha_actualizacion = NOW()
        """, (proceso_id, origen, cliente_id, tipo_identificacion, identificacion,
              nombre, direccion, email, telefono, usuario["id"]))

        registrar_auditoria(
            cur, usuario, "guardar_facturacion", "proceso", proceso_id,
            f"Facturación de {p['codigo_proceso']}: {nombre} ({identificacion})"
        )
        conn.commit()
        return _consulta_facturacion(cur, proceso_id)
    except HTTPException:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


@app.get("/actas/atrasadas")
def actas_atrasadas(dias: int = 5, usuario=Depends(obtener_usuario_actual)):
    """Para el administrador: procesos cerrados con acuerdo que llevan más
    de N días (5 por defecto) sin completar acta + comprobante + acta
    firmada. No incluye los suspendidos."""
    if usuario["rol"] != "administrador":
        raise HTTPException(status_code=403, detail="Solo el administrador puede ver este aviso")

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT
                p.id, p.codigo_proceso,
                u.nombre || ' ' || u.apellido AS mediador,
                s.nombre AS sucursal,
                p.fecha_acuerdo,
                FLOOR(EXTRACT(EPOCH FROM (NOW() - p.fecha_acuerdo)) / 86400)::int AS dias,
                CASE WHEN p.finalizado = false THEN 'Falta acta y comprobante'
                     ELSE 'Falta acta firmada' END AS etapa
            FROM procesos_mediacion p
            JOIN usuarios u ON u.id = p.usuario_id
            JOIN sucursales s ON s.id = p.sucursal_id
            WHERE """ + _sql_acta_pendiente("p") + """
              AND p.fecha_acuerdo < NOW() - (%s || ' days')::interval
            ORDER BY p.fecha_acuerdo ASC
        """, (str(max(dias, 1)),))
        return cur.fetchall()
    finally:
        cur.close()
        conn.close()


# =========================
# ACTAS FINALES
# =========================
@app.get("/actas-finales")
def obtener_actas_finales(
    q: str = None,
    ciudad_id: int = None,
    sucursal_id: int = None,
    usuario_id: int = None,
    fecha_desde: str = None,
    fecha_hasta: str = None,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        query = """
            SELECT
                ap.id,
                ap.codigo_acta,
                ap.tipo,
                ap.archivo_pdf,
                ap.nombre_original,
                ap.tamano_bytes,
                ap.ruta_comprobante_pago,
                ap.nombre_comprobante_pago,
                ap.tamano_comprobante_bytes,
                ap.fecha_subida,
                p.id AS proceso_id,
                p.codigo_proceso,
                p.tema,
                (p.acta_firmada_ruta IS NOT NULL) AS tiene_acta_firmada,
                p.requiere_acta_firmada,
                p.pago_en_abonos,
                p.pago_pendiente,
                (SELECT cx.id FROM comprobantes_pago_extra cx
                  WHERE cx.proceso_id = p.id ORDER BY cx.id DESC LIMIT 1) AS comprobante_final_id,
                fac.nombre AS fact_nombre,
                fac.tipo_identificacion AS fact_tipo_identificacion,
                fac.identificacion AS fact_identificacion,
                fac.direccion AS fact_direccion,
                fac.email AS fact_email,
                fac.telefono AS fact_telefono,
                cd.nombre || ' ' || cd.apellido AS demandante,
                cd.cedula AS demandante_cedula,
                cdd.nombre || ' ' || cdd.apellido AS demandado,
                cdd.cedula AS demandado_cedula,
                s.id AS sucursal_id,
                s.nombre AS sucursal,
                ci.id AS ciudad_id,
                ci.nombre AS ciudad,
                u.nombre || ' ' || u.apellido AS usuario
            FROM actas_proceso ap
            JOIN procesos_mediacion p ON ap.proceso_id = p.id
            JOIN clientes cd ON p.cliente_demandante_id = cd.id
            JOIN clientes cdd ON p.cliente_demandado_id = cdd.id
            JOIN sucursales s ON p.sucursal_id = s.id
            JOIN ciudades ci ON s.ciudad_id = ci.id
            JOIN usuarios u ON ap.usuario_id = u.id
            LEFT JOIN proceso_facturacion fac ON fac.proceso_id = p.id
            WHERE 1=1
        """

        params = []

        # Cada mediador solo ve las actas de sus propios procesos.
        if usuario["rol"] != "administrador":
            query += " AND p.usuario_id = %s"
            params.append(usuario["id"])

        if q:
            query += """
                AND (
                    ap.codigo_acta ILIKE %s OR
                    p.codigo_proceso ILIKE %s OR
                    p.tema ILIKE %s OR
                    cd.nombre ILIKE %s OR
                    cd.apellido ILIKE %s OR
                    cdd.nombre ILIKE %s OR
                    cdd.apellido ILIKE %s OR
                    cd.cedula ILIKE %s OR
                    cdd.cedula ILIKE %s
                )
            """
            like = f"%{q}%"
            params.extend([like] * 9)

        if ciudad_id and usuario["rol"] == "administrador":
            query += " AND ci.id = %s"
            params.append(ciudad_id)

        if sucursal_id and usuario["rol"] == "administrador":
            query += " AND s.id = %s"
            params.append(sucursal_id)

        if usuario_id and usuario["rol"] == "administrador":
            query += " AND p.usuario_id = %s"
            params.append(usuario_id)

        if fecha_desde:
            query += " AND DATE(ap.fecha_subida AT TIME ZONE 'America/Guayaquil') >= %s"
            params.append(fecha_desde)

        if fecha_hasta:
            query += " AND DATE(ap.fecha_subida AT TIME ZONE 'America/Guayaquil') <= %s"
            params.append(fecha_hasta)

        query += " ORDER BY ap.id DESC"

        cur.execute(query, tuple(params))
        return cur.fetchall()

    finally:
        cur.close()
        conn.close()


# =========================
# VER / DESCARGAR ACTA FINAL PDF
# =========================
@app.get("/actas-finales/{acta_id}/pdf")
def ver_pdf_acta_final(
    acta_id: int,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("""
            SELECT
                ap.codigo_acta,
                ap.archivo_pdf,
                ap.nombre_original,
                p.sucursal_id,
                p.usuario_id
            FROM actas_proceso ap
            JOIN procesos_mediacion p ON ap.proceso_id = p.id
            WHERE ap.id = %s
        """, (acta_id,))

        acta = cur.fetchone()

        if not acta:
            raise HTTPException(status_code=404, detail="Acta final no encontrada")

        if usuario["rol"] != "administrador" and acta["usuario_id"] != usuario["id"]:
            raise HTTPException(status_code=403, detail="No puedes ver esta acta")

        SUPABASE_URL = os.getenv("SUPABASE_URL")
        SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        SUPABASE_BUCKET = os.getenv("SUPABASE_BUCKET", "actas-pdf")

        if not SUPABASE_URL or not SUPABASE_KEY:
            raise HTTPException(status_code=500, detail="Supabase no está configurado")

        ruta_encoded = quote(acta["archivo_pdf"], safe="/")

        download_url = (
            f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/"
            f"{SUPABASE_BUCKET}/{ruta_encoded}"
        )

        headers = {
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "apikey": SUPABASE_KEY,
        }

        response = requests.get(download_url, headers=headers)

        if response.status_code != 200:
            raise HTTPException(status_code=404, detail="PDF no encontrado en Storage")

        return Response(
            content=response.content,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'inline; filename="{acta["codigo_acta"]}.pdf"'
            }
        )

    finally:
        cur.close()
        conn.close()


# =========================
# VER / DESCARGAR COMPROBANTE DE PAGO
# =========================
@app.get("/actas-finales/{acta_id}/comprobante")
def ver_comprobante_pago_acta_final(
    acta_id: int,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("""
            SELECT
                ap.codigo_acta,
                ap.ruta_comprobante_pago,
                ap.nombre_comprobante_pago,
                p.sucursal_id,
                p.usuario_id
            FROM actas_proceso ap
            JOIN procesos_mediacion p ON ap.proceso_id = p.id
            WHERE ap.id = %s
        """, (acta_id,))

        acta = cur.fetchone()

        if not acta:
            raise HTTPException(status_code=404, detail="Acta final no encontrada")

        if not acta["ruta_comprobante_pago"]:
            raise HTTPException(
                status_code=404,
                detail="Esta acta no tiene comprobante de pago registrado"
            )

        if usuario["rol"] != "administrador" and acta["usuario_id"] != usuario["id"]:
            raise HTTPException(status_code=403, detail="No puedes ver este comprobante")

        SUPABASE_URL = os.getenv("SUPABASE_URL")
        SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        SUPABASE_BUCKET = os.getenv("SUPABASE_BUCKET", "actas-pdf")

        if not SUPABASE_URL or not SUPABASE_KEY:
            raise HTTPException(status_code=500, detail="Supabase no está configurado")

        ruta_encoded = quote(acta["ruta_comprobante_pago"], safe="/")

        download_url = (
            f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/"
            f"{SUPABASE_BUCKET}/{ruta_encoded}"
        )

        headers = {
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "apikey": SUPABASE_KEY,
        }

        response = requests.get(download_url, headers=headers)

        if response.status_code != 200:
            raise HTTPException(
                status_code=404,
                detail="Comprobante de pago no encontrado en Storage"
            )

        extension = (acta["ruta_comprobante_pago"].rsplit(".", 1)[-1] or "pdf").lower()
        media_type = {
            "pdf": "application/pdf",
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "png": "image/png",
        }.get(extension, "application/octet-stream")

        nombre_descarga = acta["nombre_comprobante_pago"] or f"{acta['codigo_acta']}-comprobante.{extension}"

        return Response(
            content=response.content,
            media_type=media_type,
            headers={
                "Content-Disposition": f'inline; filename="{nombre_descarga}"'
            }
        )

    finally:
        cur.close()
        conn.close()

# =========================
# REEMPLAZAR ACTA FINAL PDF
# =========================
@app.post("/actas-finales/{acta_id}/reemplazar")
async def reemplazar_acta_final_pdf(
    acta_id: int,
    archivo: UploadFile = File(...),
    motivo: str = Form(...),
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        if usuario["rol"] != "administrador":
            raise HTTPException(
                status_code=403,
                detail="Solo el administrador puede reemplazar actas finales"
            )

        if not motivo.strip():
            raise HTTPException(
                status_code=400,
                detail="Debe ingresar el motivo del reemplazo"
            )

        if archivo.content_type != "application/pdf":
            raise HTTPException(
                status_code=400,
                detail="Solo se permiten archivos PDF"
            )

        cur.execute("""
            SELECT
                id,
                codigo_acta,
                archivo_pdf,
                fecha_subida
            FROM actas_proceso
            WHERE id = %s
        """, (acta_id,))

        acta = cur.fetchone()

        if not acta:
            raise HTTPException(
                status_code=404,
                detail="Acta final no encontrada"
            )

        contenido = await archivo.read()
        contenido = comprimir_pdf(contenido)

        nombre_unico = f"{uuid.uuid4()}.pdf"
        ruta_storage = f"actas-finales/{acta['codigo_acta']}/{nombre_unico}"

        SUPABASE_URL = os.getenv("SUPABASE_URL")
        SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        SUPABASE_BUCKET = os.getenv("SUPABASE_BUCKET", "actas-pdf")

        if not SUPABASE_URL or not SUPABASE_KEY:
            raise HTTPException(
                status_code=500,
                detail="Supabase no está configurado en el backend"
            )

        upload_url = (
            f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/"
            f"{SUPABASE_BUCKET}/{quote(ruta_storage, safe='/')}"
        )

        headers = {
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "apikey": SUPABASE_KEY,
            "Content-Type": "application/pdf",
            "x-upsert": "true",
        }

        response = requests.post(
            upload_url,
            headers=headers,
            data=contenido
        )

        if response.status_code not in [200, 201]:
            raise HTTPException(
                status_code=500,
                detail=f"Error subiendo archivo a Supabase: {response.text}"
            )

        # Guardar historial del reemplazo
        cur.execute("""
            INSERT INTO actas_proceso_historial (
                acta_proceso_id,
                acta_reemplazada_id,
                usuario_id,
                accion,
                motivo,
                archivo_anterior,
                archivo_nuevo,
                fecha_accion
            )
            VALUES (%s, %s, %s, 'REEMPLAZO_PDF', %s, %s, %s, NOW())
        """, (
            acta_id,
            acta_id,
            usuario["id"],
            motivo,
            acta["archivo_pdf"],
            ruta_storage
        ))

        # Actualizar el acta existente sin cambiar código ni fecha oficial
        cur.execute("""
         UPDATE actas_proceso
            SET
                archivo_pdf = %s,
                nombre_original = %s,
                tamano_bytes = %s
            WHERE id = %s
        """, (
            ruta_storage,
            archivo.filename,
            len(contenido),
            acta_id
        ))

        conn.commit()

        return {
            "mensaje": "Acta final reemplazada correctamente",
            "codigo_acta": acta["codigo_acta"],
            "fecha_oficial": acta["fecha_subida"],
            "motivo": motivo
        }

    except HTTPException:
        conn.rollback()
        raise

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cur.close()
        conn.close()

# =========================
# HISTORIAL ACTA FINAL PDF
# =========================
@app.get("/actas-finales/{acta_id}/historial")
def obtener_historial_acta_final(
    acta_id: int,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # 1) Datos principales del acta
        cur.execute("""
            SELECT
                ap.id,
                ap.codigo_acta,
                ap.archivo_pdf,
                ap.nombre_original,
                ap.fecha_subida,
                p.id AS proceso_id,
                p.codigo_proceso,
                p.tema,
                p.sucursal_id,
                p.usuario_id,
                cd.nombre || ' ' || cd.apellido AS demandante,
                cd.nombre AS demandante_nombre,
                cd.apellido AS demandante_apellido,
                cd.cedula AS demandante_cedula,
                cdd.nombre || ' ' || cdd.apellido AS demandado,
                cdd.nombre AS demandado_nombre,
                cdd.apellido AS demandado_apellido,
                cdd.cedula AS demandado_cedula,
                s.nombre AS sucursal,
                ci.nombre AS ciudad,
                u.nombre || ' ' || u.apellido AS subido_por,
                u.nombre AS mediador_nombre,
                u.apellido AS mediador_apellido,
                u.cedula AS mediador_cedula
            FROM actas_proceso ap
            JOIN procesos_mediacion p ON ap.proceso_id = p.id
            JOIN clientes cd ON p.cliente_demandante_id = cd.id
            JOIN clientes cdd ON p.cliente_demandado_id = cdd.id
            JOIN sucursales s ON p.sucursal_id = s.id
            JOIN ciudades ci ON s.ciudad_id = ci.id
            JOIN usuarios u ON ap.usuario_id = u.id
            WHERE ap.id = %s
        """, (acta_id,))

        acta = cur.fetchone()

        if not acta:
            raise HTTPException(
                status_code=404,
                detail="Acta final no encontrada"
            )

        # Solo el administrador ve el historial (incluye los reemplazos del PDF).
        if usuario["rol"] != "administrador":
            raise HTTPException(
                status_code=403,
                detail="Solo el administrador puede ver el historial del acta"
            )

        # 2) Historial de reemplazos
        cur.execute("""
            SELECT
                h.id,
                h.accion,
                h.motivo,
                h.archivo_anterior,
                h.archivo_nuevo,
                h.fecha_accion,
                u.nombre || ' ' || u.apellido AS usuario
            FROM actas_proceso_historial h
            JOIN usuarios u ON h.usuario_id = u.id
            WHERE h.acta_proceso_id = %s
               OR h.acta_reemplazada_id = %s
            ORDER BY h.fecha_accion ASC
        """, (acta_id, acta_id))

        historial = cur.fetchall()

        return {
            "acta": acta,
            "historial": historial
        }

    finally:
        cur.close()
        conn.close()
# =========================
# EXPORTAR ACTAS FINALES PDF
# =========================
@app.get("/actas-finales/exportar-pdfs")
def exportar_pdfs_actas_finales(
    fecha_desde: str = None,
    fecha_hasta: str = None,
    ciudad_id: int = None,
    sucursal_id: int = None,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        query = """
            SELECT
                ap.id,
                ap.codigo_acta,
                ap.archivo_pdf,
                ap.fecha_subida,
                s.nombre AS sucursal,
                ci.nombre AS ciudad,
                pr.nombre AS provincia,
                cd.nombre || ' ' || cd.apellido AS demandante,
                cd.cedula AS demandante_cedula,
                cdd.nombre || ' ' || cdd.apellido AS demandado,
                cdd.cedula AS demandado_cedula,
                u.nombre || ' ' || u.apellido AS mediador
            FROM actas_proceso ap
            JOIN procesos_mediacion p ON ap.proceso_id = p.id
            JOIN sucursales s ON p.sucursal_id = s.id
            JOIN ciudades ci ON s.ciudad_id = ci.id
            LEFT JOIN provincias pr ON ci.provincia_id = pr.id
            JOIN clientes cd ON p.cliente_demandante_id = cd.id
            JOIN clientes cdd ON p.cliente_demandado_id = cdd.id
            JOIN usuarios u ON p.usuario_id = u.id
            WHERE p.estado = 'cerrado_con_acuerdo'
              AND p.finalizado = true
        """

        params = []

        if usuario["rol"] != "administrador":
            query += " AND p.usuario_id = %s"
            params.append(usuario["id"])

        if ciudad_id and usuario["rol"] == "administrador":
            query += " AND ci.id = %s"
            params.append(ciudad_id)

        if sucursal_id and usuario["rol"] == "administrador":
            query += " AND s.id = %s"
            params.append(sucursal_id)

        if fecha_desde:
            query += " AND DATE(ap.fecha_subida AT TIME ZONE 'America/Guayaquil') >= %s"
            params.append(fecha_desde)

        if fecha_hasta:
            query += " AND DATE(ap.fecha_subida AT TIME ZONE 'America/Guayaquil') <= %s"
            params.append(fecha_hasta)

        query += " ORDER BY pr.nombre, ci.nombre, s.nombre, ap.codigo_acta"

        cur.execute(query, tuple(params))
        actas = cur.fetchall()

        if not actas:
            raise HTTPException(
                status_code=404,
                detail="No existen actas finales PDF para exportar con esos filtros"
            )

        SUPABASE_URL = os.getenv("SUPABASE_URL")
        SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        SUPABASE_BUCKET = os.getenv("SUPABASE_BUCKET", "actas-pdf")

        if not SUPABASE_URL or not SUPABASE_KEY:
            raise HTTPException(
                status_code=500,
                detail="Supabase no está configurado en el backend"
            )

        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        zip_path = tmp.name
        tmp.close()

        headers = {
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "apikey": SUPABASE_KEY,
        }

        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
            for acta in actas:
                ruta_storage = acta["archivo_pdf"]

                if not ruta_storage:
                    continue

                ruta_encoded = quote(ruta_storage, safe="/")

                download_url = (
                    f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/"
                    f"{SUPABASE_BUCKET}/{ruta_encoded}"
                )

                response = requests.get(download_url, headers=headers)

                if response.status_code != 200:
                    continue

                provincia = acta["provincia"] or "Sin provincia"
                ciudad = acta["ciudad"] or "Sin ciudad"
                sucursal = acta["sucursal"] or "Sin sucursal"
                codigo = acta["codigo_acta"] or f"acta_{acta['id']}"

                def _limpiar(texto):
                    texto = texto or ""
                    texto = unicodedata.normalize("NFD", texto)
                    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
                    texto = re.sub(r"[^A-Za-z0-9]+", "_", texto).strip("_")
                    return texto.upper()

                demandante_archivo = _limpiar(acta.get("demandante"))
                demandado_archivo = _limpiar(acta.get("demandado"))

                nombre_archivo = f"{codigo}_{demandante_archivo}_VS_{demandado_archivo}.pdf"
                ruta_zip = f"{provincia}/{ciudad}/{sucursal}/{nombre_archivo}"

                zipf.writestr(ruta_zip, response.content)

            # ── Índice en Excel, con nombre que llama la atención al abrir el ZIP ──
            wb = Workbook()
            ws = wb.active
            ws.title = "Índice de actas"

            encabezados = [
                "Código de acta",
                "Solicitante",
                "Cédula solicitante",
                "Invitado",
                "Cédula invitado",
                "Mediador",
                "Sucursal",
                "Ciudad",
                "Provincia",
                "Fecha de subida",
            ]
            ws.append(encabezados)

            for celda in ws[1]:
                celda.font = Font(bold=True)

            for acta in actas:
                ws.append([
                    acta.get("codigo_acta") or "",
                    acta.get("demandante") or "",
                    acta.get("demandante_cedula") or "",
                    acta.get("demandado") or "",
                    acta.get("demandado_cedula") or "",
                    acta.get("mediador") or "",
                    acta.get("sucursal") or "",
                    acta.get("ciudad") or "",
                    acta.get("provincia") or "",
                    _fecha_excel_ec(acta.get("fecha_subida")),
                ])

            for columna in ws.columns:
                ancho = max(len(str(c.value)) for c in columna if c.value) + 2
                ws.column_dimensions[columna[0].column_letter].width = min(ancho, 40)

            excel_buffer = io.BytesIO()
            wb.save(excel_buffer)

            zipf.writestr(
                "00_INDICE_DE_ACTAS_FINALES.xlsx",
                excel_buffer.getvalue()
            )

        filename = "actas_finales_numa.zip"

        return FileResponse(
            zip_path,
            media_type="application/zip",
            filename=filename
        )

    finally:
        cur.close()
        conn.close()

# =========================
# REPORTES
# =========================
@app.get("/reportes/resumen")
def obtener_reporte_resumen(
    fecha_desde: str = None,
    fecha_hasta: str = None,
    ciudad_id: int = None,
    sucursal_id: int = None,
    usuario_id: int = None,
    usuario=Depends(obtener_usuario_actual)
):
    """
    Indicadores de resultado (no solo de volumen): de los procesos que
    llegaron a una resolución real en el rango, qué porcentaje se cerró con
    acuerdo, y cuánto tiempo toma en promedio. "Archivado" se cuenta aparte
    porque no es un resultado de la mediación en sí (no llegó a resolverse
    por otra razón), así que no entra en el % de acuerdo para no
    distorsionarlo.
    """
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        query = """
            SELECT
                COUNT(*) FILTER (WHERE p.estado <> 'anulado') AS total_creados,
                COUNT(*) FILTER (WHERE p.estado = 'en_negociacion') AS en_negociacion,
                COUNT(*) FILTER (WHERE p.estado = 'cerrado_con_acuerdo') AS cerrados_con_acuerdo,
                COUNT(*) FILTER (WHERE p.estado = 'cerrado_sin_acuerdo') AS cerrados_sin_acuerdo,
                COUNT(*) FILTER (WHERE p.estado = 'archivado') AS archivados,
                ROUND(
                    AVG(
                        EXTRACT(EPOCH FROM (
                            COALESCE(
                                p.fecha_acuerdo,
                                CASE WHEN p.estado IN ('cerrado_sin_acuerdo', 'archivado')
                                     THEN p.fecha_modificacion END
                            ) - p.fecha_creacion
                        )) / 86400
                    ) FILTER (
                        WHERE p.estado IN ('cerrado_con_acuerdo', 'cerrado_sin_acuerdo')
                    )::numeric,
                    1
                ) AS promedio_dias_resolucion
            FROM procesos_mediacion p
            JOIN sucursales s ON p.sucursal_id = s.id
            JOIN ciudades ci ON s.ciudad_id = ci.id
            WHERE 1=1
        """
        params = []

        # Mismo alcance que el resto de reportes: un mediador solo ve lo
        # suyo, el admin ve todo y puede filtrar.
        if usuario["rol"] != "administrador":
            query += " AND p.usuario_id = %s"
            params.append(usuario["id"])
        else:
            if usuario_id:
                query += " AND p.usuario_id = %s"
                params.append(usuario_id)

            if sucursal_id:
                query += " AND s.id = %s"
                params.append(sucursal_id)

            if ciudad_id:
                query += " AND ci.id = %s"
                params.append(ciudad_id)

        if fecha_desde:
            query += " AND DATE(p.fecha_creacion AT TIME ZONE 'America/Guayaquil') >= %s"
            params.append(fecha_desde)

        if fecha_hasta:
            query += " AND DATE(p.fecha_creacion AT TIME ZONE 'America/Guayaquil') <= %s"
            params.append(fecha_hasta)

        cur.execute(query, tuple(params))
        fila = cur.fetchone()

        con_acuerdo = fila["cerrados_con_acuerdo"] or 0
        sin_acuerdo = fila["cerrados_sin_acuerdo"] or 0
        total_resueltos = con_acuerdo + sin_acuerdo

        fila["total_resueltos"] = total_resueltos
        fila["tasa_acuerdo"] = (
            round(con_acuerdo / total_resueltos * 100, 1) if total_resueltos > 0 else None
        )

        return fila

    finally:
        cur.close()
        conn.close()


@app.get("/reportes/productividad")
def obtener_reporte_productividad(
    fecha_desde: str = None,
    fecha_hasta: str = None,
    ciudad_id: int = None,
    sucursal_id: int = None,
    usuario_id: int = None,
    usuario=Depends(obtener_usuario_actual)
):
    # Reporte de comparación entre mediadores: solo el administrador puede
    # verlo (igual que Sucursales/Ciudades/Usuarios).
    if usuario["rol"] != "administrador":
        raise HTTPException(
            status_code=403,
            detail="Solo un administrador puede ver el reporte de productividad"
        )

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # LEFT JOIN a propósito: un mediador sin procesos en el rango de
        # fechas debe seguir apareciendo con contadores en cero, en vez de
        # desaparecer de la lista. Por eso el filtro de fechas va dentro del
        # ON del join y no en el WHERE (que excluiría esas filas nulas).
        query = """
            SELECT
                u.id AS usuario_id,
                u.nombre || ' ' || u.apellido AS mediador,
                u.activo,
                u.fecha_creacion AS fecha_ingreso,
                s.nombre AS sucursal,
                ci.nombre AS ciudad,
                COUNT(p.id) FILTER (WHERE p.estado <> 'anulado') AS total_procesos,
                COUNT(*) FILTER (WHERE p.estado = 'en_negociacion') AS en_negociacion,
                COUNT(*) FILTER (WHERE p.estado = 'cerrado_con_acuerdo') AS cerrados_con_acuerdo,
                COUNT(*) FILTER (WHERE p.estado = 'cerrado_sin_acuerdo') AS cerrados_sin_acuerdo,
                COUNT(*) FILTER (WHERE p.estado = 'archivado') AS archivados,
                COUNT(*) FILTER (WHERE p.estado = 'anulado') AS anulados,
                COUNT(*) FILTER (WHERE p.finalizado = true) AS actas_subidas,
                -- Cerrado con acuerdo pero el acta final + comprobante de
                -- pago todavía no se han subido: para que el admin no
                -- asuma que "cerrado" ya significa "acta lista".
                COUNT(*) FILTER (
                    WHERE (p.estado = 'cerrado_con_acuerdo'
                           OR (p.estado = 'cerrado_sin_acuerdo' AND p.requiere_acta_no_acuerdo))
                      AND p.finalizado = false
                ) AS actas_pendientes,
                ROUND(
                    AVG(
                        EXTRACT(EPOCH FROM (
                            COALESCE(
                                p.fecha_acuerdo,
                                CASE WHEN p.estado IN ('cerrado_sin_acuerdo', 'archivado')
                                     THEN p.fecha_modificacion END
                            ) - p.fecha_creacion
                        )) / 86400
                    )::numeric,
                    1
                ) AS promedio_dias_cierre
            FROM usuarios u
            JOIN sucursales s ON u.sucursal_id = s.id
            JOIN ciudades ci ON s.ciudad_id = ci.id
            LEFT JOIN procesos_mediacion p ON p.usuario_id = u.id
        """

        params = []
        condiciones_join = []

        if fecha_desde:
            condiciones_join.append("DATE(p.fecha_creacion AT TIME ZONE 'America/Guayaquil') >= %s")
            params.append(fecha_desde)

        if fecha_hasta:
            condiciones_join.append("DATE(p.fecha_creacion AT TIME ZONE 'America/Guayaquil') <= %s")
            params.append(fecha_hasta)

        if condiciones_join:
            query += " AND " + " AND ".join(condiciones_join)

        # Ya no se excluye a los mediadores inactivos: ahora este reporte
        # también sirve como listado del equipo (con su estado visible), así
        # que un mediador desactivado debe seguir apareciendo, marcado como
        # inactivo, en vez de desaparecer de la lista.
        #
        # El administrador también puede mediar sus propios procesos (no
        # solo crearlos), así que si tiene sucursal asignada (el JOIN de
        # arriba ya exige eso) también debe salir en este reporte, no solo
        # los usuarios con rol "mediador".
        query += " WHERE u.rol IN ('mediador', 'administrador')"

        # Cada mediador solo ve su propia fila; el admin ve todas y puede
        # filtrar por ciudad, sucursal o un mediador específico.
        if usuario["rol"] != "administrador":
            query += " AND u.id = %s"
            params.append(usuario["id"])
        else:
            if usuario_id:
                query += " AND u.id = %s"
                params.append(usuario_id)

            if sucursal_id:
                query += " AND s.id = %s"
                params.append(sucursal_id)

            if ciudad_id:
                query += " AND ci.id = %s"
                params.append(ciudad_id)

        query += """
            GROUP BY u.id, u.nombre, u.apellido, u.activo, u.fecha_creacion, s.nombre, ci.nombre
            ORDER BY u.activo DESC, total_procesos DESC, mediador ASC
        """

        cur.execute(query, tuple(params))
        return cur.fetchall()

    finally:
        cur.close()
        conn.close()


@app.get("/reportes/sucursales")
def obtener_reporte_sucursales(
    fecha_desde: str = None,
    fecha_hasta: str = None,
    ciudad_id: int = None,
    sucursal_id: int = None,
    usuario=Depends(obtener_usuario_actual)
):
    # Comparación entre sucursales: solo el administrador puede verlo (igual
    # que Productividad).
    if usuario["rol"] != "administrador":
        raise HTTPException(
            status_code=403,
            detail="Solo un administrador puede ver el reporte de sucursales"
        )

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # LEFT JOIN a propósito, igual que en Productividad: una sucursal sin
        # procesos en el rango de fechas debe seguir apareciendo con
        # contadores en cero, no desaparecer de la lista.
        query = """
            SELECT
                s.id AS sucursal_id,
                s.nombre AS sucursal,
                ci.nombre AS ciudad,
                COUNT(p.id) FILTER (WHERE p.estado <> 'anulado') AS total_procesos,
                COUNT(*) FILTER (WHERE p.estado = 'en_negociacion') AS en_negociacion,
                COUNT(*) FILTER (WHERE p.estado = 'cerrado_con_acuerdo') AS cerrados_con_acuerdo,
                COUNT(*) FILTER (WHERE p.estado = 'cerrado_sin_acuerdo') AS cerrados_sin_acuerdo,
                COUNT(*) FILTER (WHERE p.estado = 'archivado') AS archivados,
                COUNT(*) FILTER (WHERE p.estado = 'anulado') AS anulados,
                COUNT(*) FILTER (WHERE p.finalizado = true) AS actas_subidas,
                COUNT(*) FILTER (
                    WHERE (p.estado = 'cerrado_con_acuerdo'
                           OR (p.estado = 'cerrado_sin_acuerdo' AND p.requiere_acta_no_acuerdo))
                      AND p.finalizado = false
                ) AS actas_pendientes,
                ROUND(
                    AVG(
                        EXTRACT(EPOCH FROM (
                            COALESCE(
                                p.fecha_acuerdo,
                                CASE WHEN p.estado IN ('cerrado_sin_acuerdo', 'archivado')
                                     THEN p.fecha_modificacion END
                            ) - p.fecha_creacion
                        )) / 86400
                    )::numeric,
                    1
                ) AS promedio_dias_cierre
            FROM sucursales s
            JOIN ciudades ci ON s.ciudad_id = ci.id
            LEFT JOIN procesos_mediacion p ON p.sucursal_id = s.id
        """

        params = []
        condiciones_join = []

        if fecha_desde:
            condiciones_join.append("DATE(p.fecha_creacion AT TIME ZONE 'America/Guayaquil') >= %s")
            params.append(fecha_desde)

        if fecha_hasta:
            condiciones_join.append("DATE(p.fecha_creacion AT TIME ZONE 'America/Guayaquil') <= %s")
            params.append(fecha_hasta)

        if condiciones_join:
            query += " AND " + " AND ".join(condiciones_join)

        query += " WHERE 1=1"

        if sucursal_id:
            query += " AND s.id = %s"
            params.append(sucursal_id)

        if ciudad_id:
            query += " AND ci.id = %s"
            params.append(ciudad_id)

        query += """
            GROUP BY s.id, s.nombre, ci.nombre
            ORDER BY total_procesos DESC, sucursal ASC
        """

        cur.execute(query, tuple(params))
        return cur.fetchall()

    finally:
        cur.close()
        conn.close()


@app.get("/reportes/clientes")
def obtener_reporte_clientes(
    fecha_desde: str = None,
    fecha_hasta: str = None,
    ciudad_id: int = None,
    sucursal_id: int = None,
    usuario_id: int = None,
    usuario=Depends(obtener_usuario_actual)
):
    # A diferencia de Productividad/Sucursales, este sí lo puede ver
    # cualquier mediador — pero solo ve los clientes con quienes ha tenido
    # un proceso él mismo; el admin ve todos.
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # INNER JOIN a propósito (a diferencia de los otros dos reportes):
        # aquí no interesa listar clientes sin ningún proceso en el rango de
        # fechas/filtros elegidos.
        query = """
            SELECT
                cl.id AS cliente_id,
                TRIM(cl.nombre || ' ' || cl.apellido) AS cliente,
                COALESCE(cl.cedula, cl.ruc) AS cedula,
                cl.telefono,
                cl.email,
                COUNT(DISTINCT p.id) FILTER (WHERE p.estado <> 'anulado') AS total_procesos,
                COUNT(DISTINCT p.id) FILTER (WHERE p.estado = 'en_negociacion') AS en_negociacion,
                COUNT(DISTINCT p.id) FILTER (WHERE p.estado = 'cerrado_con_acuerdo') AS cerrados_con_acuerdo,
                COUNT(DISTINCT p.id) FILTER (WHERE p.estado = 'cerrado_sin_acuerdo') AS cerrados_sin_acuerdo,
                COUNT(DISTINCT p.id) FILTER (WHERE p.estado = 'archivado') AS archivados,
                COUNT(DISTINCT p.id) FILTER (WHERE p.estado = 'anulado') AS anulados,
                COUNT(DISTINCT p.id) FILTER (WHERE p.finalizado = true) AS actas_subidas,
                COUNT(DISTINCT p.id) FILTER (
                    WHERE (p.estado = 'cerrado_con_acuerdo'
                           OR (p.estado = 'cerrado_sin_acuerdo' AND p.requiere_acta_no_acuerdo))
                      AND p.finalizado = false
                ) AS actas_pendientes,
                -- Los códigos concretos, para que salgan también al imprimir
                -- y en el Excel (no solo las cantidades).
                STRING_AGG(DISTINCT p.codigo_proceso, ', ' ORDER BY p.codigo_proceso)
                    FILTER (WHERE p.estado <> 'anulado') AS codigos_procesos,
                STRING_AGG(DISTINCT af.codigo_acta, ', ' ORDER BY af.codigo_acta)
                    FILTER (WHERE p.finalizado = true) AS codigos_actas
            FROM clientes cl
            JOIN proceso_partes pp ON pp.cliente_id = cl.id
            JOIN procesos_mediacion p ON p.id = pp.proceso_id
            LEFT JOIN actas_proceso af ON af.id = p.acta_final_id
            JOIN sucursales s ON p.sucursal_id = s.id
            JOIN ciudades ci ON s.ciudad_id = ci.id
            WHERE 1=1
        """

        params = []

        # Mismo criterio que el resto del sistema: un mediador solo ve lo
        # relacionado con sus propios procesos.
        if usuario["rol"] != "administrador":
            query += " AND p.usuario_id = %s"
            params.append(usuario["id"])
        elif usuario_id:
            query += " AND p.usuario_id = %s"
            params.append(usuario_id)

        if sucursal_id:
            query += " AND s.id = %s"
            params.append(sucursal_id)

        if ciudad_id:
            query += " AND ci.id = %s"
            params.append(ciudad_id)

        if fecha_desde:
            query += " AND DATE(p.fecha_creacion AT TIME ZONE 'America/Guayaquil') >= %s"
            params.append(fecha_desde)

        if fecha_hasta:
            query += " AND DATE(p.fecha_creacion AT TIME ZONE 'America/Guayaquil') <= %s"
            params.append(fecha_hasta)

        query += """
            GROUP BY cl.id, cl.nombre, cl.apellido, cl.cedula, cl.ruc, cl.telefono, cl.email
            ORDER BY total_procesos DESC, cliente ASC
        """

        cur.execute(query, tuple(params))
        return cur.fetchall()

    finally:
        cur.close()
        conn.close()


def _filtros_operativos(query, params, usuario, usuario_id, sucursal_id, ciudad_id):
    # Mismo criterio de permisos: el mediador solo ve lo suyo; el admin ve
    # todo y puede filtrar por mediador. Requiere alias p (proceso), s, ci.
    if usuario["rol"] != "administrador":
        query += " AND p.usuario_id = %s"
        params.append(usuario["id"])
    elif usuario_id:
        query += " AND p.usuario_id = %s"
        params.append(usuario_id)
    if sucursal_id:
        query += " AND s.id = %s"
        params.append(sucursal_id)
    if ciudad_id:
        query += " AND ci.id = %s"
        params.append(ciudad_id)
    return query


@app.get("/reportes/operativos/agenda")
def reporte_operativo_agenda(
    fecha_desde: str = None,
    fecha_hasta: str = None,
    ciudad_id: int = None,
    sucursal_id: int = None,
    usuario_id: int = None,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        query = """
            SELECT
                c.id, c.proceso_id, c.fecha, c.hora, c.estado, c.tema,
                p.codigo_proceso,
                cd.nombre || ' ' || cd.apellido AS demandante,
                cdd.nombre || ' ' || cdd.apellido AS demandado,
                u.nombre || ' ' || u.apellido AS mediador,
                s.nombre AS sucursal,
                ci.nombre AS ciudad,
                (c.estado IN ('pendiente', 'confirmada')
                 AND (c.fecha + c.hora) < (NOW() AT TIME ZONE 'America/Guayaquil')) AS atrasada
            FROM citas c
            JOIN procesos_mediacion p ON c.proceso_id = p.id
            JOIN clientes cd ON c.cliente_demandante_id = cd.id
            JOIN clientes cdd ON c.cliente_demandado_id = cdd.id
            JOIN usuarios u ON p.usuario_id = u.id
            JOIN sucursales s ON p.sucursal_id = s.id
            JOIN ciudades ci ON s.ciudad_id = ci.id
            WHERE 1=1
        """
        params = []
        query = _filtros_operativos(query, params, usuario, usuario_id, sucursal_id, ciudad_id)
        if fecha_desde:
            query += " AND c.fecha >= %s"
            params.append(fecha_desde)
        if fecha_hasta:
            query += " AND c.fecha <= %s"
            params.append(fecha_hasta)
        query += " ORDER BY c.fecha ASC, c.hora ASC"
        cur.execute(query, tuple(params))
        return cur.fetchall()
    finally:
        cur.close()
        conn.close()


@app.get("/reportes/operativos/sin-avance")
def reporte_operativo_sin_avance(
    dias_minimo: int = 7,
    ciudad_id: int = None,
    sucursal_id: int = None,
    usuario_id: int = None,
    usuario=Depends(obtener_usuario_actual)
):
    if dias_minimo < 0:
        dias_minimo = 0
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        query = """
            SELECT * FROM (
                SELECT
                    p.id, p.codigo_proceso, p.tema,
                    cd.nombre || ' ' || cd.apellido AS demandante,
                    cdd.nombre || ' ' || cdd.apellido AS demandado,
                    u.nombre || ' ' || u.apellido AS mediador,
                    s.nombre AS sucursal,
                    ci.nombre AS ciudad,
                    p.fecha_creacion,
                    (SELECT MAX(a.fecha_creacion) FROM avances_mediacion a WHERE a.proceso_id = p.id) AS ultimo_avance,
                    (SELECT COUNT(*) FROM avances_mediacion a WHERE a.proceso_id = p.id) AS total_avances,
                    FLOOR(EXTRACT(EPOCH FROM (NOW() - GREATEST(
                        p.fecha_creacion,
                        COALESCE((SELECT MAX(a.fecha_creacion) FROM avances_mediacion a WHERE a.proceso_id = p.id), p.fecha_creacion)
                    ))) / 86400)::int AS dias_sin_avance
                FROM procesos_mediacion p
                JOIN clientes cd ON p.cliente_demandante_id = cd.id
                JOIN clientes cdd ON p.cliente_demandado_id = cdd.id
                JOIN usuarios u ON p.usuario_id = u.id
                JOIN sucursales s ON p.sucursal_id = s.id
                JOIN ciudades ci ON s.ciudad_id = ci.id
                WHERE p.estado = 'en_negociacion'
        """
        params = []
        query = _filtros_operativos(query, params, usuario, usuario_id, sucursal_id, ciudad_id)
        query += """
            ) t
            WHERE t.dias_sin_avance >= %s
            ORDER BY t.dias_sin_avance DESC, t.codigo_proceso ASC
        """
        params.append(dias_minimo)
        cur.execute(query, tuple(params))
        return cur.fetchall()
    finally:
        cur.close()
        conn.close()


@app.get("/reportes/operativos/actas-pendientes")
def reporte_operativo_actas_pendientes(
    ciudad_id: int = None,
    sucursal_id: int = None,
    usuario_id: int = None,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        query = """
            SELECT
                p.id, p.codigo_proceso, p.tema, p.fecha_acuerdo,
                cd.nombre || ' ' || cd.apellido AS demandante,
                cdd.nombre || ' ' || cdd.apellido AS demandado,
                u.nombre || ' ' || u.apellido AS mediador,
                s.nombre AS sucursal,
                ci.nombre AS ciudad,
                FLOOR(EXTRACT(EPOCH FROM (NOW() - p.fecha_acuerdo)) / 3600)::int AS horas_transcurridas,
                CASE
                    WHEN p.suspendido THEN 'Suspendido'
                    WHEN p.finalizado = false THEN 'Falta acta y comprobante'
                    ELSE 'Falta acta firmada'
                END AS etapa
            FROM procesos_mediacion p
            JOIN clientes cd ON p.cliente_demandante_id = cd.id
            JOIN clientes cdd ON p.cliente_demandado_id = cdd.id
            JOIN usuarios u ON p.usuario_id = u.id
            JOIN sucursales s ON p.sucursal_id = s.id
            JOIN ciudades ci ON s.ciudad_id = ci.id
            WHERE """ + _sql_tiene_acta("p") + """
              AND (
                    p.suspendido = true
                    OR p.finalizado = false
                    OR (p.requiere_acta_firmada AND p.acta_firmada_ruta IS NULL)
                  )
        """
        params = []
        query = _filtros_operativos(query, params, usuario, usuario_id, sucursal_id, ciudad_id)
        query += " ORDER BY p.fecha_acuerdo ASC NULLS LAST"
        cur.execute(query, tuple(params))
        return cur.fetchall()
    finally:
        cur.close()
        conn.close()


ETIQUETAS_ESTADO_REPORTE = {
    "en_negociacion": "En negociación",
    "cerrado_con_acuerdo": "Cerrado con acuerdo",
    "cerrado_sin_acuerdo": "Cerrado sin acuerdo",
    "archivado": "Archivado",
    "anulado": "Anulado"
}


def _fecha_excel_ec(valor, con_hora=True):
    """Fecha para el Excel, en hora de Ecuador y formato dd/mm/aaaa (hh:mm)."""
    if not valor:
        return ""
    if isinstance(valor, datetime.datetime):
        if valor.tzinfo is None:
            # Las columnas sin zona horaria se guardan en UTC (NOW()).
            valor = valor.replace(tzinfo=datetime.timezone.utc)
        valor = valor.astimezone(datetime.timezone(datetime.timedelta(hours=-5)))
        return valor.strftime("%d/%m/%Y %H:%M" if con_hora else "%d/%m/%Y")
    if isinstance(valor, datetime.date):
        return valor.strftime("%d/%m/%Y")
    return str(valor)


def _excel_con_formato(titulo, encabezados, filas):
    """Arma una hoja de Excel ordenada: título y fecha arriba, encabezados en
    el azul de la marca, fila de encabezados fija al bajar, filtros por
    columna, filas alternadas y anchos de columna a la medida."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Reporte"

    azul = "0E2338"
    n = max(len(encabezados), 1)
    ultima = get_column_letter(n)

    ws.append([f"Centro de Mediación NUMA · {titulo}"])
    ws.append([
        "Generado el " + datetime.datetime.now(
            datetime.timezone(datetime.timedelta(hours=-5))
        ).strftime("%d/%m/%Y %H:%M") + f" · {len(filas)} registro(s)"
    ])
    ws.append([])
    ws.merge_cells(f"A1:{ultima}1")
    ws.merge_cells(f"A2:{ultima}2")
    ws["A1"].font = Font(bold=True, size=14, color=azul)
    ws["A2"].font = Font(size=10, color="4A6789")
    ws.row_dimensions[1].height = 22

    ws.append(encabezados)
    fila_enc = 4
    borde = Side(style="thin", color="C9D6E5")
    for celda in ws[fila_enc]:
        celda.font = Font(bold=True, color="FFFFFF")
        celda.fill = PatternFill("solid", fgColor=azul)
        celda.alignment = Alignment(vertical="center", wrap_text=True)
        celda.border = Border(bottom=borde)
    ws.row_dimensions[fila_enc].height = 28

    gris = PatternFill("solid", fgColor="F3F6FA")
    for i, fila in enumerate(filas):
        ws.append(fila)
        if i % 2 == 1:
            for celda in ws[ws.max_row]:
                celda.fill = gris

    ws.freeze_panes = f"A{fila_enc + 1}"
    if filas:
        ws.auto_filter.ref = f"A{fila_enc}:{ultima}{ws.max_row}"

    for idx in range(1, n + 1):
        letra = get_column_letter(idx)
        valores = [ws.cell(row=r, column=idx).value for r in range(fila_enc, ws.max_row + 1)]
        ancho = max((len(str(v)) for v in valores if v is not None), default=10) + 3
        ws.column_dimensions[letra].width = max(10, min(ancho, 45))

    return wb


@app.get("/reportes/exportar-excel")
def exportar_reporte_excel(
    tipo: str,
    fecha_desde: str = None,
    fecha_hasta: str = None,
    ciudad_id: int = None,
    sucursal_id: int = None,
    usuario_id: int = None,
    dias_minimo: int = 7,
    usuario=Depends(obtener_usuario_actual)
):
    if tipo not in ["procesos", "productividad", "actas", "sucursales", "clientes",
                    "agenda", "sin-avance", "actas-pendientes"]:
        raise HTTPException(status_code=400, detail="Tipo de reporte inválido")

    # Se reutilizan las mismas funciones que alimentan la pantalla (llamadas
    # directamente como funciones de Python, no como endpoints HTTP), para
    # no duplicar la lógica de filtros ni el control de permisos por rol.
    if tipo == "procesos":
        filas = obtener_procesos_mediacion(
            q=None, estado=None, ciudad_id=ciudad_id, sucursal_id=sucursal_id,
            usuario_id=usuario_id, fecha_desde=fecha_desde, fecha_hasta=fecha_hasta,
            usuario=usuario
        )

        encabezados = [
            "Estado", "Acta final", "Solicitante", "Invitado", "Ciudad",
            "Sucursal", "Mediador", "Tema", "Fecha de creación"
        ]

        filas_excel = [
            [
                ETIQUETAS_ESTADO_REPORTE.get(f.get("estado"), f.get("estado")),
                # Para que "cerrado" no se confunda con "acta ya subida": un
                # proceso puede estar cerrado con acuerdo y seguir esperando
                # su acta final + comprobante de pago.
                "Pendiente"
                if (f.get("estado") == "cerrado_con_acuerdo"
                    or (f.get("estado") == "cerrado_sin_acuerdo" and f.get("requiere_acta_no_acuerdo"))) and not f.get("finalizado")
                else ("Subida" if f.get("finalizado") else "—"),
                f.get("demandante"),
                f.get("demandado"),
                f.get("ciudad"),
                f.get("sucursal"),
                f.get("usuario"),
                f.get("tema"),
                _fecha_excel_ec(f.get("fecha_creacion"))
            ]
            for f in filas
        ]

        nombre_archivo = "reporte_procesos_numa.xlsx"

    elif tipo == "productividad":
        filas = obtener_reporte_productividad(
            fecha_desde=fecha_desde, fecha_hasta=fecha_hasta, ciudad_id=ciudad_id,
            sucursal_id=sucursal_id, usuario_id=usuario_id, usuario=usuario
        )

        encabezados = [
            "Mediador", "Estado", "Fecha de ingreso", "Ciudad", "Sucursal",
            "Total procesos", "En negociación", "Cerrados con acuerdo",
            "Cerrados sin acuerdo", "Archivados", "Anulados", "Actas subidas",
            "Actas pendientes", "Promedio días de cierre"
        ]

        filas_excel = [
            [
                f.get("mediador"),
                "Activo" if f.get("activo") else "Inactivo",
                _fecha_excel_ec(f.get("fecha_ingreso"), con_hora=False),
                f.get("ciudad"),
                f.get("sucursal"),
                f.get("total_procesos"),
                f.get("en_negociacion"),
                f.get("cerrados_con_acuerdo"),
                f.get("cerrados_sin_acuerdo"),
                f.get("archivados"),
                f.get("anulados"),
                f.get("actas_subidas"),
                f.get("actas_pendientes"),
                f.get("promedio_dias_cierre") if f.get("promedio_dias_cierre") is not None else ""
            ]
            for f in filas
        ]

        nombre_archivo = "reporte_productividad_numa.xlsx"

    elif tipo == "sucursales":
        filas = obtener_reporte_sucursales(
            fecha_desde=fecha_desde, fecha_hasta=fecha_hasta, ciudad_id=ciudad_id,
            sucursal_id=sucursal_id, usuario=usuario
        )

        encabezados = [
            "Sucursal", "Ciudad", "Total procesos", "En negociación",
            "Cerrados con acuerdo", "Cerrados sin acuerdo", "Archivados", "Anulados",
            "Actas subidas", "Actas pendientes", "Promedio días de cierre"
        ]

        filas_excel = [
            [
                f.get("sucursal"),
                f.get("ciudad"),
                f.get("total_procesos"),
                f.get("en_negociacion"),
                f.get("cerrados_con_acuerdo"),
                f.get("cerrados_sin_acuerdo"),
                f.get("archivados"),
                f.get("anulados"),
                f.get("actas_subidas"),
                f.get("actas_pendientes"),
                f.get("promedio_dias_cierre") if f.get("promedio_dias_cierre") is not None else ""
            ]
            for f in filas
        ]

        nombre_archivo = "reporte_sucursales_numa.xlsx"

    elif tipo == "clientes":
        filas = obtener_reporte_clientes(
            fecha_desde=fecha_desde, fecha_hasta=fecha_hasta, ciudad_id=ciudad_id,
            sucursal_id=sucursal_id, usuario_id=usuario_id, usuario=usuario
        )

        encabezados = [
            "Cliente", "Cédula", "Teléfono", "Email", "Total procesos",
            "En negociación", "Cerrados con acuerdo", "Cerrados sin acuerdo",
            "Archivados", "Anulados", "Actas subidas", "Actas pendientes",
            "Procesos (códigos)", "Actas (códigos)"
        ]

        filas_excel = [
            [
                f.get("cliente"),
                f.get("cedula"),
                f.get("telefono"),
                f.get("email"),
                f.get("total_procesos"),
                f.get("en_negociacion"),
                f.get("cerrados_con_acuerdo"),
                f.get("cerrados_sin_acuerdo"),
                f.get("archivados"),
                f.get("anulados"),
                f.get("actas_subidas"),
                f.get("actas_pendientes"),
                f.get("codigos_procesos") or "",
                f.get("codigos_actas") or ""
            ]
            for f in filas
        ]

        nombre_archivo = "reporte_clientes_numa.xlsx"

    elif tipo == "agenda":
        filas = reporte_operativo_agenda(
            fecha_desde=fecha_desde, fecha_hasta=fecha_hasta, ciudad_id=ciudad_id,
            sucursal_id=sucursal_id, usuario_id=usuario_id, usuario=usuario
        )
        encabezados = ["Fecha", "Hora", "Solicitante", "Invitado", "Mediador",
                       "Sucursal", "Ciudad", "Estado", "Atrasada"]
        filas_excel = [
            [str(f.get("fecha")), str(f.get("hora"))[:5],
             f.get("demandante"), f.get("demandado"), f.get("mediador"),
             f.get("sucursal"), f.get("ciudad"), f.get("estado"),
             "Sí" if f.get("atrasada") else ""]
            for f in filas
        ]
        nombre_archivo = "reporte_agenda_numa.xlsx"

    elif tipo == "sin-avance":
        filas = reporte_operativo_sin_avance(
            dias_minimo=dias_minimo, ciudad_id=ciudad_id, sucursal_id=sucursal_id,
            usuario_id=usuario_id, usuario=usuario
        )
        encabezados = ["Solicitante", "Invitado", "Mediador", "Sucursal", "Ciudad",
                       "Tema", "Creado", "Último avance", "Avances", "Días sin avance"]
        filas_excel = [
            [f.get("demandante"), f.get("demandado"),
             f.get("mediador"), f.get("sucursal"), f.get("ciudad"), f.get("tema"),
             _fecha_excel_ec(f.get("fecha_creacion"), con_hora=False),
             str(f.get("ultimo_avance") or "")[:10] or "Ninguno",
             f.get("total_avances"), f.get("dias_sin_avance")]
            for f in filas
        ]
        nombre_archivo = "reporte_procesos_sin_avance_numa.xlsx"

    elif tipo == "actas-pendientes":
        filas = reporte_operativo_actas_pendientes(
            ciudad_id=ciudad_id, sucursal_id=sucursal_id,
            usuario_id=usuario_id, usuario=usuario
        )
        encabezados = ["Solicitante", "Invitado", "Mediador", "Sucursal", "Ciudad",
                       "Tema", "Fecha del acuerdo", "Estado", "Días pendientes"]
        filas_excel = [
            [f.get("demandante"), f.get("demandado"),
             f.get("mediador"), f.get("sucursal"), f.get("ciudad"), f.get("tema"),
             # fecha_acuerdo está en UTC: se muestra en hora de Ecuador.
             ((f["fecha_acuerdo"] - datetime.timedelta(hours=5)).strftime("%d/%m/%Y %H:%M")
              if f.get("fecha_acuerdo") else ""),
             f.get("etapa"),
             (f.get("horas_transcurridas") // 24) if f.get("horas_transcurridas") is not None else ""]
            for f in filas
        ]
        nombre_archivo = "reporte_actas_pendientes_numa.xlsx"

    else:
        filas = obtener_actas_finales(
            q=None, ciudad_id=ciudad_id, sucursal_id=sucursal_id, usuario_id=usuario_id,
            fecha_desde=fecha_desde, fecha_hasta=fecha_hasta, usuario=usuario
        )

        encabezados = [
            "Código de acta", "Solicitante", "Invitado", "Ciudad",
            "Sucursal", "Mediador", "Fecha de subida",
            "Facturar a", "Identificación", "Dirección", "Correo", "Teléfono"
        ]

        filas_excel = [
            [
                f.get("codigo_acta"),
                f.get("demandante"),
                f.get("demandado"),
                f.get("ciudad"),
                f.get("sucursal"),
                f.get("usuario"),
                _fecha_excel_ec(f.get("fecha_subida")),
                f.get("fact_nombre") or "",
                f.get("fact_identificacion") or "",
                f.get("fact_direccion") or "",
                f.get("fact_email") or "",
                f.get("fact_telefono") or ""
            ]
            for f in filas
        ]

        nombre_archivo = "reporte_actas_finales_numa.xlsx"

    titulos_excel = {
        "procesos": "Reporte de procesos por periodo",
        "productividad": "Reporte del equipo de mediadores",
        "actas": "Reporte de actas finales emitidas",
        "sucursales": "Reporte por sucursales",
        "clientes": "Reporte de clientes",
        "agenda": "Agenda de reuniones",
        "sin-avance": "Procesos sin avance",
        "actas-pendientes": "Actas pendientes de subir",
    }
    wb = _excel_con_formato(titulos_excel.get(tipo, "Reporte"), encabezados, filas_excel)

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{nombre_archivo}"'}
    )


# =========================
# EXPEDIENTE COMPLETO DEL PROCESO
# =========================
@app.get("/procesos/{proceso_id}/expediente")
def obtener_expediente_proceso(
    proceso_id: int,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("""
            SELECT
                p.*,
                cd.nombre || ' ' || cd.apellido AS demandante,
                cd.nombre AS demandante_nombre,
                cd.apellido AS demandante_apellido,
                cd.cedula AS demandante_cedula,
                cdd.nombre || ' ' || cdd.apellido AS demandado,
                cdd.nombre AS demandado_nombre,
                cdd.apellido AS demandado_apellido,
                cdd.cedula AS demandado_cedula,
                s.nombre AS sucursal,
                ci.nombre AS ciudad,
                u.nombre || ' ' || u.apellido AS mediador,
                u.nombre AS mediador_nombre,
                u.apellido AS mediador_apellido,
                u.cedula AS mediador_cedula
            FROM procesos_mediacion p
            JOIN clientes cd ON p.cliente_demandante_id = cd.id
            JOIN clientes cdd ON p.cliente_demandado_id = cdd.id
            JOIN sucursales s ON p.sucursal_id = s.id
            JOIN ciudades ci ON s.ciudad_id = ci.id
            JOIN usuarios u ON p.usuario_id = u.id
            WHERE p.id = %s
        """, (proceso_id,))

        proceso = cur.fetchone()

        if not proceso:
            raise HTTPException(status_code=404, detail="Proceso no encontrado")

        if usuario["rol"] != "administrador" and proceso["usuario_id"] != usuario["id"]:
            raise HTTPException(status_code=403, detail="No puedes ver este expediente")

        cur.execute("""
            SELECT
                c.id,
                c.fecha,
                c.hora,
                c.estado,
                c.observaciones,
                c.motivo_cancelacion,
                cp.nombre || ' ' || cp.apellido AS creado_por,
                av.resultado,
                av.observacion AS avance_observacion,
                av.proxima_fecha,
                av.proxima_hora,
                av.fecha_creacion AS fecha_avance,
                u.nombre || ' ' || u.apellido AS usuario_avance
            FROM citas c
            LEFT JOIN usuarios cp ON cp.id = c.creado_por_id
            LEFT JOIN avances_mediacion av ON av.cita_id = c.id
            LEFT JOIN usuarios u ON av.usuario_id = u.id
            WHERE c.proceso_id = %s
            ORDER BY c.id ASC
        """, (proceso_id,))

        linea_tiempo = cur.fetchall()

        cur.execute("""
            SELECT
                ap.id,
                ap.codigo_acta,
                ap.nombre_original,
                ap.fecha_subida,
                ap.nombre_comprobante_pago,
                u.nombre || ' ' || u.apellido AS subido_por
            FROM actas_proceso ap
            JOIN usuarios u ON ap.usuario_id = u.id
            WHERE ap.proceso_id = %s
            ORDER BY ap.id DESC
            LIMIT 1
        """, (proceso_id,))

        acta_final = cur.fetchone()

        historial_pdf = []

        if acta_final:
            cur.execute("""
                SELECT
                    h.id,
                    h.motivo,
                    h.fecha_accion,
                    u.nombre || ' ' || u.apellido AS usuario
                FROM actas_proceso_historial h
                JOIN usuarios u ON h.usuario_id = u.id
                WHERE h.acta_proceso_id = %s
                OR h.acta_reemplazada_id = %s
                ORDER BY h.fecha_accion ASC
            """, (
                acta_final["id"],
                acta_final["id"]
            ))

            historial_pdf = cur.fetchall()

        return {
            "proceso": proceso,
            "partes": _consulta_partes(cur, proceso_id),
            "linea_tiempo": linea_tiempo,
            "acta_final": acta_final,
            "historial_pdf": historial_pdf
        }

    finally:
        cur.close()
        conn.close()


# =========================
# ALMACENAMIENTO SUPABASE (uso real del bucket)
# =========================
def _listar_objetos_supabase_recursivo(base_url, bucket, headers, prefijo=""):
    """
    Recorre recursivamente un bucket de Supabase Storage y devuelve
    una lista plana de todos los archivos con su tamaño en bytes.
    Supabase Storage no tiene un endpoint de 'tamaño total del bucket',
    así que hay que recorrer carpeta por carpeta y sumar.
    """
    archivos = []

    list_url = f"{base_url}/storage/v1/object/list/{bucket}"

    response = requests.post(
        list_url,
        headers=headers,
        json={
            "prefix": prefijo,
            "limit": 1000,
            "offset": 0,
            "sortBy": {"column": "name", "order": "asc"},
        },
    )

    if response.status_code != 200:
        return archivos

    for item in response.json():
        ruta = f"{prefijo}{item['name']}" if prefijo.endswith("/") or prefijo == "" else f"{prefijo}/{item['name']}"

        if item.get("id") is None and item.get("metadata") is None:
            # Es una "carpeta" (no tiene metadata propia) — recursión
            archivos.extend(
                _listar_objetos_supabase_recursivo(base_url, bucket, headers, ruta + "/")
            )
        else:
            tamano = (item.get("metadata") or {}).get("size", 0) or 0
            archivos.append({"ruta": ruta, "bytes": tamano})

    return archivos


@app.post("/admin/respaldo-manual")
def enviar_respaldo_manual(usuario=Depends(obtener_usuario_actual)):
    """
    Genera y envía el respaldo de la base de datos en el momento, con el
    mismo código que usa el job automático de las 3am. Sirve para probar
    ahora mismo si el envío funciona (y por qué, si no), en vez de esperar
    a la madrugada y solo saber si llegó o no llegó el correo.
    """
    if usuario["rol"] != "administrador":
        raise HTTPException(
            status_code=403,
            detail="Solo el administrador puede enviar el respaldo manualmente"
        )

    resultado = _generar_y_enviar_respaldo()

    if not resultado["ok"]:
        raise HTTPException(status_code=500, detail=resultado["motivo"])

    return resultado


@app.get("/admin/auditoria")
def obtener_auditoria(
    fecha_desde: str = None,
    fecha_hasta: str = None,
    usuario_id: int = None,
    accion: str = None,
    limite: int = 100,
    usuario=Depends(obtener_usuario_actual)
):
    """
    Registro de acciones sensibles: quién hizo qué y cuándo (usuarios,
    clientes, sucursales, intentos de login). Solo el administrador puede
    consultarlo.
    """
    if usuario["rol"] != "administrador":
        raise HTTPException(
            status_code=403,
            detail="Solo el administrador puede ver el registro de auditoría"
        )

    limite = max(1, min(limite, 500))

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        query = """
            SELECT id, usuario_id, usuario_nombre, accion, entidad, entidad_id, detalle, fecha_creacion
            FROM auditoria
            WHERE 1=1
        """
        params = []

        if fecha_desde:
            query += " AND fecha_creacion >= %s"
            params.append(fecha_desde)

        if fecha_hasta:
            query += " AND fecha_creacion < (%s::date + INTERVAL '1 day')"
            params.append(fecha_hasta)

        if usuario_id:
            query += " AND usuario_id = %s"
            params.append(usuario_id)

        if accion:
            query += " AND accion = %s"
            params.append(accion)

        query += " ORDER BY fecha_creacion DESC LIMIT %s"
        params.append(limite)

        cur.execute(query, tuple(params))
        return cur.fetchall()

    finally:
        cur.close()
        conn.close()


@app.get("/admin/almacenamiento")
def obtener_uso_almacenamiento(usuario=Depends(obtener_usuario_actual)):
    if usuario["rol"] != "administrador":
        raise HTTPException(
            status_code=403,
            detail="Solo el administrador puede ver el uso de almacenamiento"
        )

    SUPABASE_URL = os.getenv("SUPABASE_URL")
    SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    SUPABASE_BUCKET = os.getenv("SUPABASE_BUCKET", "actas-pdf")
    LIMITE_GB = float(os.getenv("SUPABASE_STORAGE_LIMIT_GB", "1"))

    if not SUPABASE_URL or not SUPABASE_KEY:
        raise HTTPException(
            status_code=500,
            detail="Supabase no está configurado en el backend"
        )

    headers = {
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "apikey": SUPABASE_KEY,
    }

    archivos = _listar_objetos_supabase_recursivo(
        SUPABASE_URL.rstrip("/"), SUPABASE_BUCKET, headers
    )

    total_bytes = sum(a["bytes"] for a in archivos)
    limite_bytes = LIMITE_GB * 1024 * 1024 * 1024

    # Desglose por carpeta de primer nivel (actas, actas-finales, etc.)
    por_carpeta: dict = {}
    for a in archivos:
        carpeta = a["ruta"].split("/")[0] if "/" in a["ruta"] else "raíz"
        por_carpeta[carpeta] = por_carpeta.get(carpeta, 0) + a["bytes"]

    return {
        "bucket": SUPABASE_BUCKET,
        "total_archivos": len(archivos),
        "total_bytes": total_bytes,
        "total_mb": round(total_bytes / (1024 * 1024), 2),
        "total_gb": round(total_bytes / (1024 * 1024 * 1024), 4),
        "limite_gb": LIMITE_GB,
        "porcentaje_usado": round((total_bytes / limite_bytes) * 100, 2) if limite_bytes else 0,
        "por_carpeta": [
            {
                "carpeta": carpeta,
                "bytes": tam,
                "mb": round(tam / (1024 * 1024), 2),
            }
            for carpeta, tam in sorted(por_carpeta.items(), key=lambda x: -x[1])
        ],
    }