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

            # Sin ciudad/sucursal: crear_notificacion se las agrega solo
            # al administrador. Se acepta también el formato anterior para
            # no duplicar recordatorios ya generados.
            mensaje = (
                f"{cita['demandante']} y {cita['demandado']} | "
                f"{cita['fecha']} {cita['hora']}"
            )
            mensaje_antiguo = (
                f"{cita['demandante']} y {cita['demandado']} | "
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
                      AND (REPLACE(mensaje, ' vs ', ' y ') = %s OR REPLACE(mensaje, ' vs ', ' y ') = %s OR LEFT(REPLACE(mensaje, ' vs ', ' y '), %s) = %s)
                """, (
                    usuario_id,
                    cita["proceso_id"],
                    titulo,
                    mensaje,
                    mensaje_antiguo,
                    len(mensaje),
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

        # Invitaciones rápidas (aún sin proceso): mismo recordatorio, pero
        # apuntando a la propia invitación.
        cur.execute("""
            SELECT ct.id, ct.fecha, ct.hora, ct.usuario_id, ct.partes_rapidas,
                   s.nombre AS sucursal, ci.nombre AS ciudad
            FROM citas ct
            JOIN sucursales s ON ct.sucursal_id = s.id
            JOIN ciudades ci ON s.ciudad_id = ci.id
            WHERE ct.proceso_id IS NULL
              AND ct.partes_rapidas IS NOT NULL
              AND ct.estado = 'pendiente'
              AND ct.fecha IN (%s, %s)
        """, (hoy, manana))

        for ct in cur.fetchall():
            pr = ct["partes_rapidas"] or {}
            sol, _ = _resumen_lado_rapido(pr.get("solicitantes"))
            inv, _ = _resumen_lado_rapido(pr.get("invitados"))
            titulo = "Invitación para hoy" if str(ct["fecha"]) == str(hoy) else "Invitación para mañana"
            mensaje = f"{sol} y {inv} | {ct['fecha']} {ct['hora']}"
            mensaje_antiguo = f"{sol} y {inv} | {ct['ciudad']} - {ct['sucursal']} | {ct['fecha']} {ct['hora']}"

            cur.execute("SELECT id FROM usuarios WHERE rol = 'administrador' AND activo = true")
            destino = {ct["usuario_id"]} | {a["id"] for a in cur.fetchall()}

            for uid in destino:
                cur.execute("""
                    SELECT id FROM notificaciones
                    WHERE usuario_id = %s AND referencia_tipo = 'cita'
                      AND referencia_id = %s AND titulo = %s
                      AND (REPLACE(mensaje, ' vs ', ' y ') = %s OR REPLACE(mensaje, ' vs ', ' y ') = %s OR LEFT(REPLACE(mensaje, ' vs ', ' y '), %s) = %s)
                """, (uid, ct["id"], titulo, mensaje, mensaje_antiguo, len(mensaje), mensaje))
                if cur.fetchone():
                    continue
                crear_notificacion(cur, uid, titulo, mensaje, "recordatorio", "cita", ct["id"])

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
    # Al administrador (que ve a todo el país) se le indica siempre a qué
    # sucursal y ciudad pertenece lo que se le avisa.
    _tabla_sucursal = {
        "proceso_mediacion": "procesos_mediacion",
        "cita": "citas",
        "reunion": "reuniones_mediadores",
        "numero_acta": "numeros_acta",
    }.get(referencia_tipo)
    if _tabla_sucursal and referencia_id and "Sucursal " not in (mensaje or ""):
        cur.execute("SELECT rol FROM usuarios WHERE id = %s", (usuario_id,))
        _dest = cur.fetchone()
        if _dest and _dest["rol"] == "administrador":
            cur.execute(f"""
                SELECT s.nombre AS sucursal, ci.nombre AS ciudad
                FROM {_tabla_sucursal} t
                JOIN sucursales s ON s.id = t.sucursal_id
                LEFT JOIN ciudades ci ON ci.id = s.ciudad_id
                WHERE t.id = %s
            """, (referencia_id,))
            _suc = cur.fetchone()
            if _suc:
                mensaje = (
                    f"{(mensaje or '').rstrip()} "
                    f"[Sucursal {_suc['sucursal']}"
                    f"{' · ' + _suc['ciudad'] if _suc['ciudad'] else ''}]"
                )

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
                    f"La cédula {cedula} ya está registrada como {donde} a nombre de "
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

    try:
        _scheduler.add_job(
            avisar_facturas_pendientes,
            "cron",
            hour=8,
            minute=10,
            timezone="America/Guayaquil",
            misfire_grace_time=4 * 3600,
            coalesce=True,
        )
    except Exception:
        _scheduler.add_job(
            avisar_facturas_pendientes,
            "cron",
            hour=8,
            minute=10,
            misfire_grace_time=4 * 3600,
            coalesce=True,
        )

    try:
        _scheduler.add_job(
            avisar_numeros_pendientes,
            "cron",
            hour=8,
            minute=20,
            timezone="America/Guayaquil",
            misfire_grace_time=4 * 3600,
            coalesce=True,
        )
    except Exception:
        _scheduler.add_job(
            avisar_numeros_pendientes,
            "cron",
            hour=8,
            minute=20,
            misfire_grace_time=4 * 3600,
            coalesce=True,
        )

    # Cada hora se revisa si algún número de acta cumplió sus 48 horas.
    try:
        _scheduler.add_job(
            avisar_plazo_acta_vencido,
            "interval",
            minutes=10,
            misfire_grace_time=600,
            coalesce=True,
        )
    except Exception as e:
        print("No se pudo programar el aviso de plazo vencido:", e)

    _scheduler.start()

    try:
        _scheduler.add_job(avisar_facturas_pendientes)
    except Exception as e:
        print("No se pudo programar el aviso de facturas:", e)

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

# Avisos urgentes que siguen vigentes (los del banner rojo). Los de "proceso
# suspendido" y de actas sin completar NO se quitan al abrirlos o leerlos:
# se quitan solo cuando se resuelve lo que avisan (el proceso se reactiva o
# el número de acta se completa/anula). Los demás urgentes (número anulado,
# cuenta bloqueada) siguen la regla de siempre: dejan de ser urgentes al leerlos.
@app.get("/notificaciones/urgentes")
def obtener_notificaciones_urgentes(usuario=Depends(obtener_usuario_actual)):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT DISTINCT ON (n.titulo, n.referencia_tipo, n.referencia_id)
                n.id, n.titulo, n.mensaje, n.tipo, n.leida,
                n.referencia_tipo, n.referencia_id, n.fecha_creacion,
                NULL::int AS cita_usuario_id
            FROM notificaciones n
            LEFT JOIN procesos_mediacion p
                ON n.referencia_tipo = 'proceso_mediacion' AND p.id = n.referencia_id
            LEFT JOIN numeros_acta na
                ON n.referencia_tipo = 'numero_acta' AND na.id = n.referencia_id
            WHERE n.usuario_id = %s
              AND (
                (n.titulo = 'Proceso suspendido' AND COALESCE(p.suspendido, false) = true AND n.leida = false)
                OR (n.titulo IN ('Número de acta sin completar', 'Acta con plazo vencido')
                    AND COALESCE(na.estado, '') = 'reservado')
                OR (n.titulo IN ('Número de acta anulado', 'Cuenta bloqueada') AND n.leida = false)
                OR (n.titulo IN ('Acta bloqueada', 'Acta bloqueada por plazo')
                    AND n.referencia_tipo = 'bloqueo_acta'
                    AND EXISTS (SELECT 1 FROM bloqueos_acta bq WHERE bq.id = n.referencia_id AND bq.estado = 'activo'))
              )
            ORDER BY n.titulo, n.referencia_tipo, n.referencia_id, n.fecha_creacion DESC
        """, (usuario["id"],))
        filas = cur.fetchall()
        for f in filas:
            f["proceso_destino"] = None

        # Aviso "Acta por vencer": al mediador le quedan 8 horas o menos para completar un número de
        # acta (el plazo es de 48 horas). No se guarda en la base: se calcula aquí, así aparece solo
        # y desaparece solo cuando sube la documentación o el acta se bloquea.
        if usuario["rol"] == "mediador":
            cur.execute("""
                SELECT na.id, na.codigo, na.proceso_id,
                       na.fecha_solicitud + INTERVAL '48 hours' AS vence_en,
                       to_char((na.fecha_solicitud + INTERVAL '48 hours') AT TIME ZONE 'America/Guayaquil',
                               'DD/MM "a las" HH24:MI') AS vence_texto
                FROM numeros_acta na
                WHERE na.usuario_id = %s AND na.estado = 'reservado'
                  AND na.fecha_solicitud + INTERVAL '48 hours' > NOW()
                  AND na.fecha_solicitud + INTERVAL '48 hours' <= NOW() + INTERVAL '8 hours'
                ORDER BY na.fecha_solicitud ASC
            """, (usuario["id"],))
            ahora = datetime.datetime.now(datetime.timezone.utc)
            _bq_otro = _bloqueo_activo_usuario(cur, usuario["id"])
            for r in cur.fetchall():
                if _bq_otro:
                    _msg_vence = (
                        f"Tu acta {r['codigo']} se bloquea el {r['vence_texto']} (hora de Ecuador). "
                        f"Por ahora no puedes subirla: tienes el acta {_bq_otro['codigo']} bloqueada y primero "
                        f"el administrador debe resolverla (desbloquearla o darla de baja)."
                    )
                else:
                    _msg_vence = (
                        f"Tu acta {r['codigo']} se bloquea el {r['vence_texto']} (hora de Ecuador). "
                        "Sube la documentación y el comprobante de pago antes de que termine el tiempo."
                    )
                filas.append({
                    "id": -r["id"],  # negativo: aviso calculado, no existe en la tabla de notificaciones
                    "titulo": "Acta por vencer",
                    "mensaje": _msg_vence,
                    "tipo": "acta",
                    "leida": True,
                    "referencia_tipo": "numero_acta",
                    "referencia_id": r["id"],
                    "fecha_creacion": ahora,
                    "cita_usuario_id": None,
                    "proceso_destino": r["proceso_id"],
                    "vence_en": r["vence_en"],
                })

        filas.sort(key=lambda r: r["fecha_creacion"], reverse=True)
        return filas
    finally:
        cur.close()
        conn.close()


@app.get("/notificaciones")
def obtener_notificaciones(usuario=Depends(obtener_usuario_actual)):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("""
            SELECT
                n.id,
                n.titulo,
                n.mensaje,
                n.tipo,
                n.leida,
                n.referencia_tipo,
                n.referencia_id,
                n.fecha_creacion,
                -- Para las notificaciones de una invitación: de qué mediador es,
                -- así el administrador/la secretaria llegan directo a esa cita.
                CASE WHEN n.referencia_tipo = 'cita' THEN c.usuario_id END AS cita_usuario_id
            FROM notificaciones n
            LEFT JOIN citas c ON n.referencia_tipo = 'cita' AND c.id = n.referencia_id
            WHERE n.usuario_id = %s
            ORDER BY n.fecha_creacion DESC
            LIMIT 50
        """, (usuario["id"],))

        return cur.fetchall()

    finally:
        cur.close()
        conn.close()


@app.get("/notificaciones/no-leidas")
def contar_notificaciones_no_leidas(usuario=Depends(obtener_usuario_actual)):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            "SELECT COUNT(*) AS total FROM notificaciones WHERE usuario_id = %s AND leida = false",
            (usuario["id"],),
        )
        return {"total": cur.fetchone()["total"]}
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

    bloqueo_nuevo = False
    if registro["fallos"] >= MAX_INTENTOS_LOGIN:
        registro["bloqueado_hasta"] = datetime.datetime.utcnow() + datetime.timedelta(minutes=BLOQUEO_MINUTOS)
        bloqueo_nuevo = True

    _intentos_login[clave] = registro
    return bloqueo_nuevo  # True solo cuando este intento provoca el bloqueo


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
            if _registrar_intento_fallido(username):
                registrar_auditoria(cur, None, "cuenta_bloqueada", "auth",
                                    detalle=f"Se bloqueó el ingreso de «{username}» por {MAX_INTENTOS_LOGIN} intentos fallidos seguidos (el usuario no existe). Bloqueo de {BLOQUEO_MINUTOS} minutos.")
            conn.commit()
            raise HTTPException(status_code=401, detail="Usuario no encontrado")

        if not user["activo"]:
            conn.commit()
            raise HTTPException(status_code=401, detail="Usuario inactivo")

        if not pwd_context.verify(password, user["password_hash"]):
            if _registrar_intento_fallido(username):
                registrar_auditoria(cur, user, "cuenta_bloqueada", "auth", user["id"],
                                    f"Se bloqueó el ingreso por {MAX_INTENTOS_LOGIN} contraseñas incorrectas seguidas. Bloqueo de {BLOQUEO_MINUTOS} minutos.")
                # Los administradores se enteran: puede ser alguien que olvidó su
                # clave o alguien tratando de entrar con una cuenta ajena.
                cur.execute("""
                    SELECT u.nombre, u.apellido, u.rol, s.nombre AS sucursal, ci.nombre AS ciudad
                    FROM usuarios u
                    LEFT JOIN sucursales s ON s.id = u.sucursal_id
                    LEFT JOIN ciudades ci ON ci.id = s.ciudad_id
                    WHERE u.id = %s
                """, (user["id"],))
                _det = cur.fetchone() or {}
                _quien = f"{(_det.get('nombre') or '').strip()} {(_det.get('apellido') or '').strip()}".strip()
                _rol = (_det.get("rol") or user["rol"] or "").capitalize()
                _donde = f"{_det['sucursal']}" + (f" · {_det['ciudad']}" if _det.get("ciudad") else "") if _det.get("sucursal") else "sin sucursal"
                cur.execute("SELECT id FROM usuarios WHERE rol = 'administrador' AND activo = true")
                for _adm in cur.fetchall():
                    crear_notificacion(
                        cur, _adm["id"], "Cuenta bloqueada",
                        f"{_quien or 'Usuario'} ({_rol}, sucursal {_donde}) — cuenta {user['email']} — quedó bloqueada {BLOQUEO_MINUTOS} minutos por "
                        f"{MAX_INTENTOS_LOGIN} contraseñas incorrectas seguidas. Si fue la propia persona, "
                        f"puede volver a intentar pasado ese tiempo; si no, revisa la Auditoría.",
                        "sistema"
                    )
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
def dashboard(solo_mios: bool = False, usuario=Depends(obtener_usuario_actual)):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # Cada mediador ve solo sus propias estadísticas (sus procesos y
        # actas); el admin ve las de todos.
        # El admin puede pedir solo lo suyo con ?solo_mios=true.
        filtrar = usuario["rol"] != "administrador" or solo_mios
        filtro_usuario = ""
        params = []

        if filtrar:
            filtro_usuario = " AND usuario_id = %s"
            params.append(usuario["id"])

        cur.execute(f"""
            SELECT
                COUNT(*) FILTER (WHERE estado = 'en_negociacion') AS en_negociacion,
                COUNT(*) FILTER (WHERE estado = 'cerrado_con_acuerdo' AND NOT suspendido) AS cerrados_con_acuerdo,
                COUNT(*) FILTER (WHERE estado = 'cerrado_sin_acuerdo' AND NOT suspendido) AS cerrados_sin_acuerdo,
                COUNT(*) FILTER (WHERE estado = 'archivado') AS archivados,
                COUNT(*) FILTER (WHERE suspendido) AS suspendidos,
                COUNT(*) FILTER (WHERE estado = 'anulado') AS anulados
            FROM procesos_mediacion
            WHERE 1=1 {filtro_usuario}
        """, tuple(params))

        procesos = cur.fetchone()

        cur.execute(f"""
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE ap.tipo = 'no_acuerdo') AS no_acuerdo
            FROM actas_proceso ap
            JOIN procesos_mediacion p ON ap.proceso_id = p.id
            WHERE 1=1
            AND (p.finalizado = true AND (NOT COALESCE(p.requiere_acta_firmada, false) OR p.acta_firmada_ruta IS NOT NULL))
            {" AND p.usuario_id = %s" if filtrar else ""}
        """, tuple(params))

        conteo_actas = cur.fetchone()
        actas_finales = conteo_actas["total"]
        actas_no_acuerdo = conteo_actas["no_acuerdo"]
        actas_acuerdo = actas_finales - actas_no_acuerdo

        cur.execute(
            "SELECT COUNT(*) AS n FROM bloqueos_acta WHERE estado = 'activo'"
            + (" AND usuario_id = %s" if filtrar else ""),
            tuple(params)
        )
        actas_bloqueadas = cur.fetchone()["n"]

        cur.execute(
            "SELECT COUNT(*) AS n FROM numeros_acta_anulaciones WHERE fecha > NOW() - INTERVAL '30 days'"
            + (" AND usuario_id = %s" if filtrar else ""),
            tuple(params)
        )
        numeros_anulados = cur.fetchone()["n"]

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
            {" AND p.usuario_id = %s" if filtrar else ""}
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
            AND (p.finalizado = true AND (NOT COALESCE(p.requiere_acta_firmada, false) OR p.acta_firmada_ruta IS NOT NULL))
            {" AND p.usuario_id = %s" if filtrar else ""}
            ORDER BY ap.id DESC
            LIMIT 6
        """, tuple(params))

        actas_recientes = cur.fetchall()

        return {
            "procesos": procesos,
            "actas_finales": actas_finales,
            "actas_acuerdo": actas_acuerdo,
            "actas_no_acuerdo": actas_no_acuerdo,
            "actas_bloqueadas": actas_bloqueadas,
            "numeros_anulados": numeros_anulados,
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
# FICHA DEL CLIENTE (solo lectura)
# =========================
# Reúne en un solo lugar lo de un cliente: sus datos, los procesos donde
# participa (como solicitante o invitado) y sus citas/invitaciones. El
# administrador ve todo; un mediador solo lo de sus propios procesos.
@app.get("/clientes/{cliente_id}/ficha")
def ficha_cliente(cliente_id: int, usuario=Depends(obtener_usuario_actual)):
    if usuario["rol"] not in ("administrador", "mediador"):
        raise HTTPException(status_code=403, detail="No tienes permiso para ver la ficha del cliente")
    es_admin = usuario["rol"] == "administrador"
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT cl.id, cl.cedula, cl.nombre, cl.apellido, cl.tipo, cl.razon_social,
                   cl.ruc, cl.representante_nombre, cl.representante_cedula,
                   cl.telefono, cl.email, cl.direccion, cl.fecha_creacion,
                   c.nombre AS ciudad, pr.nombre AS provincia
            FROM clientes cl
            LEFT JOIN ciudades c ON c.id = cl.ciudad_id
            LEFT JOIN provincias pr ON pr.id = c.provincia_id
            WHERE cl.id = %s
        """, (cliente_id,))
        cliente = cur.fetchone()
        if not cliente:
            raise HTTPException(status_code=404, detail="Cliente no encontrado")

        cur.execute("""
            SELECT p.id, p.codigo_proceso, p.tema, p.estado, p.suspendido, p.fecha_creacion,
                   CASE WHEN p.cliente_demandante_id = %s THEN 'Solicitante' ELSE 'Invitado' END AS rol,
                   (SELECT ax.codigo_acta FROM actas_proceso ax WHERE ax.proceso_id = p.id
                    ORDER BY ax.id DESC LIMIT 1) AS numero_acta,
                   um.nombre || ' ' || um.apellido AS mediador,
                   s.nombre AS sucursal
            FROM procesos_mediacion p
            JOIN usuarios um ON um.id = p.usuario_id
            JOIN sucursales s ON s.id = p.sucursal_id
            WHERE (p.cliente_demandante_id = %s OR p.cliente_demandado_id = %s)
              AND (%s OR p.usuario_id = %s)
            ORDER BY p.fecha_creacion DESC
        """, (cliente_id, cliente_id, cliente_id, es_admin, usuario["id"]))
        procesos = cur.fetchall()

        cur.execute("""
            SELECT c.id, c.fecha, c.hora, c.estado, c.tema, c.proceso_id,
                   p.codigo_proceso,
                   (SELECT ax.codigo_acta FROM actas_proceso ax WHERE ax.proceso_id = c.proceso_id
                    ORDER BY ax.id DESC LIMIT 1) AS numero_acta,
                   CASE WHEN c.cliente_demandante_id = %s THEN 'Solicitante' ELSE 'Invitado' END AS rol,
                   um.nombre || ' ' || um.apellido AS mediador,
                   (c.documento IS NOT NULL) AS tiene_invitacion
            FROM citas c
            LEFT JOIN procesos_mediacion p ON p.id = c.proceso_id
            LEFT JOIN usuarios um ON um.id = c.usuario_id
            WHERE (c.cliente_demandante_id = %s OR c.cliente_demandado_id = %s)
              AND (%s OR c.usuario_id = %s)
            ORDER BY c.fecha DESC, c.hora DESC
        """, (cliente_id, cliente_id, cliente_id, es_admin, usuario["id"]))
        citas = cur.fetchall()

        cur.execute("""
            SELECT ap.id, ap.codigo_acta, ap.tipo, ap.fecha_subida, ap.proceso_id,
                   p.codigo_proceso,
                   (p.acta_firmada_ruta IS NOT NULL) AS tiene_firmada,
                   CASE WHEN p.cliente_demandante_id = %s THEN 'Solicitante' ELSE 'Invitado' END AS rol,
                   um.nombre || ' ' || um.apellido AS mediador
            FROM actas_proceso ap
            JOIN procesos_mediacion p ON p.id = ap.proceso_id
            JOIN usuarios um ON um.id = p.usuario_id
            WHERE (p.cliente_demandante_id = %s OR p.cliente_demandado_id = %s)
              AND (%s OR p.usuario_id = %s)
              AND NOT EXISTS (SELECT 1 FROM actas_proceso r WHERE r.reemplaza_acta_id = ap.id)
            ORDER BY ap.fecha_subida DESC
        """, (cliente_id, cliente_id, cliente_id, es_admin, usuario["id"]))
        actas = cur.fetchall()

        return {"cliente": cliente, "procesos": procesos, "citas": citas, "actas": actas}
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

        if usuario["rol"] == "secretaria":
            # La secretaria solo corrige datos de contacto: el nombre y la cédula
            # salen en actas y reportes, así que no puede cambiarlos.
            cur.execute(
                "SELECT cedula, nombre, apellido, razon_social, ruc, representante_nombre, "
                "representante_cedula FROM clientes WHERE id = %s", (id,)
            )
            _act = cur.fetchone()
            _enviado = {
                "cedula": cedula, "nombre": nombre, "apellido": apellido,
                "razon_social": razon_social, "ruc": ruc,
                "representante_nombre": representante_nombre,
                "representante_cedula": representante_cedula,
            }
            for _k, _v in _enviado.items():
                if (_v or "").strip() != (_act[_k] or "").strip():
                    raise HTTPException(
                        status_code=403,
                        detail="Solo puedes cambiar teléfono, correo, dirección y ciudad. "
                               "Para corregir nombre o cédula pide ayuda a un mediador o al administrador."
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
                s.admin_telefono,
                s.admin_email,
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

def _contacto_admin_sucursal(admin_telefono, admin_email):
    """Teléfono y correo del responsable (administrador) de la sucursal: salen
    en el encabezado de las invitaciones."""
    tel = (admin_telefono or "").strip() or None
    mail = (admin_email or "").strip() or None
    if mail and not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$", mail):
        raise HTTPException(status_code=400, detail="El correo del administrador de la sucursal no es válido")
    if tel and not re.match(r"^[0-9+()\-\s]{7,30}$", tel):
        raise HTTPException(status_code=400, detail="El teléfono del administrador de la sucursal no es válido")
    return tel, mail


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
    admin_telefono: str = None,
    admin_email: str = None,
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

        admin_telefono, admin_email = _contacto_admin_sucursal(admin_telefono, admin_email)

        cur.execute("""
            INSERT INTO sucursales (
                ciudad_id,
                nombre,
                codigo,
                prefijo,
                direccion,
                telefono,
                admin_telefono,
                admin_email,
                slug,
                codigo_corto,
                activo,
                fecha_creacion,
                fecha_modificacion
              )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, true, NOW(), NOW())
            RETURNING
                id,
                ciudad_id,
                nombre,
                codigo,
                prefijo,
                direccion,
                telefono,
                admin_telefono,
                admin_email,
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
            admin_telefono,
            admin_email,
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
    admin_telefono: str = None,
    admin_email: str = None,
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

        admin_telefono, admin_email = _contacto_admin_sucursal(admin_telefono, admin_email)

        cur.execute("""
            UPDATE sucursales
            SET ciudad_id = %s, nombre = %s, direccion = %s, telefono = %s,
                admin_telefono = %s, admin_email = %s,
                slug = %s, fecha_modificacion = NOW()
            WHERE id = %s
            RETURNING
                id, ciudad_id, nombre, codigo, prefijo, direccion, telefono,
                admin_telefono, admin_email,
                slug, codigo_corto, activo, fecha_creacion, fecha_modificacion
        """, (ciudad_id, nombre, direccion, telefono, admin_telefono, admin_email, slug, id))

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
def _telefono_usuario(telefono):
    """Teléfono del mediador (para las invitaciones): opcional; si viene,
    debe tener 10 dígitos. Devuelve solo los dígitos o None."""
    if telefono is None:
        return None
    limpio = re.sub(r"\D", "", telefono)
    if not limpio:
        return None
    if len(limpio) != 10:
        raise HTTPException(status_code=400, detail="El teléfono debe tener 10 dígitos")
    return limpio


def _telefono_mediador_obligatorio(telefono):
    """Para un mediador el teléfono es obligatorio (sale en el pie de sus
    invitaciones). Devuelve solo los dígitos."""
    t = _telefono_usuario(telefono)
    if not t:
        raise HTTPException(status_code=400, detail="El teléfono del mediador es obligatorio (10 dígitos)")
    return t


def _verificar_un_coordinador(cur, sucursal_id, excluir_id=None):
    """Cada sucursal tiene UN solo coordinador activo."""
    cur.execute("""
        SELECT nombre, apellido FROM usuarios
        WHERE rol = 'mediador' AND es_coordinador = true AND activo = true
          AND sucursal_id = %s AND id <> COALESCE(%s, -1)
        LIMIT 1
    """, (sucursal_id, excluir_id))
    ya = cur.fetchone()
    if ya:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Esta sucursal ya tiene un coordinador ({ya['nombre']} {ya['apellido']}). "
                "Quítale primero la marca de coordinador para asignar a otro."
            )
        )


def _email_administrador(cur):
    """Correo principal del administrador (único para todo el país): es el
    que sale en el pie de las invitaciones."""
    cur.execute("""
        SELECT email FROM usuarios
        WHERE rol = 'administrador' AND activo = true
        ORDER BY id ASC LIMIT 1
    """)
    r = cur.fetchone()
    return r["email"] if r else None


@app.post("/usuarios")
def crear_usuario(
    nombre: str,
    apellido: str,
    cedula: str,
    email: str,
    password: str = None,
    rol: str = "mediador",
    sucursal_id: int = 1,
    telefono: str = None,
    es_coordinador: bool = False,
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
        if rol not in ("mediador", "secretaria"):
            raise HTTPException(status_code=400, detail="Rol inválido")
        if rol == "secretaria":
            _verificar_una_secretaria(cur, sucursal_id)
        if rol == "mediador":
            if not (nombre or "").strip() or not (apellido or "").strip():
                raise HTTPException(status_code=400, detail="Nombre y apellido son obligatorios")
        if es_coordinador and rol != "mediador":
            raise HTTPException(status_code=400, detail="Solo un mediador puede ser coordinador")
        if es_coordinador:
            _verificar_un_coordinador(cur, sucursal_id)

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
        telefono = _telefono_mediador_obligatorio(telefono) if rol == "mediador" else _telefono_usuario(telefono)

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
                telefono,
                es_coordinador,
                activo,
                debe_cambiar_password,
                fecha_creacion,
                fecha_modificacion
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s,
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
            telefono,
            bool(es_coordinador),
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
    telefono: str = None,
    es_coordinador: bool = None,
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

        if rol not in ("administrador", "mediador", "secretaria"):
            raise HTTPException(status_code=400, detail="Rol inválido")

        cur.execute("SELECT id, rol, activo, telefono, es_coordinador FROM usuarios WHERE id = %s", (id,))
        usuario_existente = cur.fetchone()

        if not usuario_existente:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")

        if usuario_existente["rol"] == "administrador" and rol != "administrador":
            raise HTTPException(
                status_code=400,
                detail="El rol del administrador no se puede cambiar"
            )

        if rol == "secretaria" and usuario_existente["activo"]:
            _verificar_una_secretaria(cur, sucursal_id, excluir_id=id)

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

        # Mediador: nombre, apellido y teléfono obligatorios. Para los demás
        # roles el teléfono es opcional (si viene vacío se borra).
        if rol == "mediador":
            if not (nombre or "").strip() or not (apellido or "").strip():
                raise HTTPException(status_code=400, detail="Nombre y apellido son obligatorios")
            tel_final = _telefono_mediador_obligatorio(
                telefono if telefono is not None else usuario_existente["telefono"]
            )
            cur.execute("UPDATE usuarios SET telefono = %s WHERE id = %s", (tel_final, id))
        elif telefono is not None:
            cur.execute(
                "UPDATE usuarios SET telefono = %s WHERE id = %s",
                (_telefono_usuario(telefono), id)
            )

        # Coordinador: solo un mediador, y uno por sucursal.
        coord_final = usuario_existente["es_coordinador"] if es_coordinador is None else bool(es_coordinador)
        if rol != "mediador":
            coord_final = False
        if coord_final and usuario_existente["activo"]:
            _verificar_un_coordinador(cur, sucursal_id, excluir_id=id)
        cur.execute("UPDATE usuarios SET es_coordinador = %s WHERE id = %s", (coord_final, id))

        cur.execute("""
            UPDATE usuarios
            SET nombre = %s, apellido = %s, cedula = %s, email = %s,
                rol = %s, sucursal_id = %s, fecha_modificacion = NOW()
            WHERE id = %s
            RETURNING
                id, sucursal_id, nombre, apellido, cedula, email, rol, activo,
                telefono, es_coordinador, debe_cambiar_password, fecha_creacion, fecha_modificacion
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
                u.telefono,
                u.rol,
                u.es_coordinador,
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
                u.es_coordinador,
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

@app.post("/usuarios/{id}/desbloquear")
def desbloquear_usuario(id: int, usuario=Depends(obtener_usuario_actual)):
    """Quita el bloqueo de ingreso por intentos fallidos y manda a la persona un
    enlace para que ELLA elija su contraseña nueva (el administrador nunca la
    conoce). El enlace también se devuelve para compartirlo a mano si el correo
    no llega."""
    if usuario["rol"] != "administrador":
        raise HTTPException(status_code=403, detail="Solo administrador puede realizar esta acción")

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT id, nombre, apellido, email, activo FROM usuarios WHERE id = %s", (id,))
        destino = cur.fetchone()
        if not destino:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")
        if not destino["activo"]:
            raise HTTPException(status_code=400, detail="El usuario está inactivo; reactívalo primero")

        _limpiar_intentos(destino["email"])

        token = secrets.token_urlsafe(32)
        expira_en = datetime.datetime.utcnow() + datetime.timedelta(hours=TOKEN_RESET_EXPIRA_HORAS)
        cur.execute("""
            INSERT INTO password_reset_tokens (usuario_id, token, expira_en)
            VALUES (%s, %s, %s)
        """, (id, token, expira_en))

        registrar_auditoria(
            cur, usuario, "usuario_desbloqueado", "usuarios", id,
            f"Desbloqueó a {destino['nombre']} {destino['apellido']} ({destino['email']}) y generó un enlace para que elija una contraseña nueva"
        )
        conn.commit()

        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
        enlace = f"{frontend_url}/restablecer-password?token={token}"

        correo_enviado = enviar_correo(
            destinatario=destino["email"],
            asunto="Sistema NUMA — Crea tu nueva contraseña",
            cuerpo_html=plantilla_base(
                titulo=f"Hola, {destino['nombre']}",
                mensaje_html=(
                    "Un administrador desbloqueó tu cuenta. Para volver a entrar, elige tu "
                    f"nueva contraseña (este enlace es válido por {TOKEN_RESET_EXPIRA_HORAS} horas)."
                ),
                boton_texto="Crear mi contraseña",
                boton_url=enlace,
            )
        )

        return {"correo_enviado": bool(correo_enviado), "enlace": enlace}
    finally:
        cur.close()
        conn.close()


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
        if activo:
            # Reactivar a una secretaria solo si la sucursal no tiene ya otra activa.
            cur.execute("SELECT rol, sucursal_id FROM usuarios WHERE id = %s", (id,))
            destino = cur.fetchone()
            if destino and destino["rol"] == "secretaria":
                _verificar_una_secretaria(cur, destino["sucursal_id"], excluir_id=id)
            cur.execute("SELECT rol, sucursal_id, es_coordinador FROM usuarios WHERE id = %s", (id,))
            d2 = cur.fetchone()
            if d2 and d2["rol"] == "mediador" and d2["es_coordinador"]:
                _verificar_un_coordinador(cur, d2["sucursal_id"], excluir_id=id)

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
# SECRETARIA Y REUNIONES DE MEDIADORES
# =========================
def _verificar_una_secretaria(cur, sucursal_id, excluir_id=None):
    """Cada sucursal tiene UNA sola secretaria activa."""
    cur.execute("""
        SELECT nombre, apellido FROM usuarios
        WHERE rol = 'secretaria' AND activo = true AND sucursal_id = %s
          AND id <> COALESCE(%s, -1)
        LIMIT 1
    """, (sucursal_id, excluir_id))
    ya = cur.fetchone()
    if ya:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Esta sucursal ya tiene una secretaria activa ({ya['nombre']} {ya['apellido']}). "
                "Suspéndela primero para poder registrar o activar a otra."
            )
        )


def _verificar_sin_reunion(cur, mediador_id, fecha, hora):
    """Una hora dentro de una reunión de mediadores no admite invitaciones
    para los mediadores de esa sucursal."""
    cur.execute("SELECT rol, sucursal_id FROM usuarios WHERE id = %s", (mediador_id,))
    m = cur.fetchone()
    if not m or m["rol"] != "mediador":
        return
    cur.execute("""
        SELECT titulo, hora_inicio, hora_fin
        FROM reuniones_mediadores
        WHERE sucursal_id = %s AND fecha = %s AND estado = 'activa'
          AND %s::time >= hora_inicio AND %s::time < hora_fin
        LIMIT 1
    """, (m["sucursal_id"], fecha, str(hora)[:5], str(hora)[:5]))
    r = cur.fetchone()
    if r:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Esa hora está ocupada: el {fecha} de {str(r['hora_inicio'])[:5]} a "
                f"{str(r['hora_fin'])[:5]} hay una reunión de mediadores ({r['titulo']}). Elige otra hora."
            )
        )


_DIAS_ES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]


def _validar_reunion(datos):
    fecha = (datos.get("fecha") or "").strip()
    hora_inicio = (datos.get("hora_inicio") or "").strip()[:5]
    hora_fin = (datos.get("hora_fin") or "").strip()[:5]
    titulo = (datos.get("titulo") or "").strip()[:200] or "Reunión de mediadores"
    detalle = (datos.get("detalle") or "").strip()[:1000] or None
    try:
        ini = datetime.datetime.strptime(f"{fecha} {hora_inicio}", "%Y-%m-%d %H:%M")
        fin = datetime.datetime.strptime(f"{fecha} {hora_fin}", "%Y-%m-%d %H:%M")
    except ValueError:
        raise HTTPException(status_code=400, detail="Fecha u hora inválida")
    if fin <= ini:
        raise HTTPException(status_code=400, detail="La hora de fin debe ser posterior a la de inicio")
    # Hora local de Ecuador (UTC-5) contra el reloj del servidor (UTC).
    if ini + datetime.timedelta(hours=5) < datetime.datetime.utcnow():
        raise HTTPException(status_code=400, detail="No se puede crear una reunión en una fecha u hora pasada")
    return fecha, hora_inicio, hora_fin, titulo, detalle, ini


def _citas_en_conflicto(cur, sucursal_id, fecha, hora_inicio, hora_fin):
    """Invitaciones pendientes de los mediadores de la sucursal que caen
    dentro del horario de la reunión (solo se advierte, no se cancelan)."""
    cur.execute("""
        SELECT c.id, c.hora, u.nombre || ' ' || u.apellido AS mediador
        FROM citas c
        JOIN usuarios u ON u.id = c.usuario_id
        WHERE c.sucursal_id = %s AND c.fecha = %s AND c.estado = 'pendiente'
          AND u.rol = 'mediador'
          AND c.hora >= %s::time AND c.hora < %s::time
        ORDER BY c.hora
    """, (sucursal_id, fecha, hora_inicio, hora_fin))
    return cur.fetchall()


def _notificar_reunion(cur, sucursal_id, titulo, mensaje, reunion_id, excluir_id=None):
    cur.execute("""
        SELECT id FROM usuarios
        WHERE sucursal_id = %s AND activo = true AND rol IN ('mediador', 'secretaria')
          AND id <> COALESCE(%s, -1)
    """, (sucursal_id, excluir_id))
    for u in cur.fetchall():
        crear_notificacion(cur, u["id"], titulo, mensaje, "reunion", "reunion", reunion_id)


def _notificar_secretaria(cur, sucursal_id, titulo, mensaje, cita_id, excluir_id=None):
    """Avisa a la secretaria de la sucursal de las cancelaciones que hacen
    otras personas, para que sepa que ese horario quedó libre."""
    cur.execute("""
        SELECT id FROM usuarios
        WHERE sucursal_id = %s AND rol = 'secretaria' AND activo = true
          AND id <> COALESCE(%s, -1)
    """, (sucursal_id, excluir_id))
    for u in cur.fetchall():
        crear_notificacion(cur, u["id"], titulo, mensaje, "cita", "cita", cita_id)


def _texto_reunion(ini, hora_fin, titulo):
    dia = _DIAS_ES[ini.weekday()]
    return f"{titulo} — {dia} {ini.strftime('%Y-%m-%d')}, de {ini.strftime('%H:%M')} a {hora_fin}"


@app.get("/sucursal/mediadores")
def mediadores_de_mi_sucursal(usuario=Depends(obtener_usuario_actual)):
    """Mediadores activos de la sucursal de la secretaria (o del administrador)."""
    if usuario["rol"] not in ("secretaria", "administrador"):
        raise HTTPException(status_code=403, detail="No tienes permiso para ver esta información")
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT id, nombre, apellido, rol, telefono
            FROM usuarios
            WHERE sucursal_id = %s AND activo = true AND rol IN ('mediador', 'administrador')
            ORDER BY nombre, apellido
        """, (usuario["sucursal_id"],))
        return cur.fetchall()
    finally:
        cur.close()
        conn.close()


@app.get("/reuniones")
def listar_reuniones(
    fecha_desde: str = None,
    fecha_hasta: str = None,
    sucursal_id: int = None,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Cada quien ve las reuniones de su sucursal; el administrador puede
        # consultar la de cualquier sucursal (la del mediador que está viendo).
        suc = usuario["sucursal_id"]
        if usuario["rol"] == "administrador" and sucursal_id:
            suc = sucursal_id
        query = """
            SELECT r.id, r.sucursal_id, r.titulo, r.detalle, r.fecha,
                   r.hora_inicio, r.hora_fin, r.estado, r.fecha_creacion,
                   cp.nombre || ' ' || cp.apellido AS creado_por
            FROM reuniones_mediadores r
            LEFT JOIN usuarios cp ON cp.id = r.creado_por_id
            WHERE r.sucursal_id = %s AND r.estado = 'activa'
        """
        params = [suc]
        if fecha_desde:
            query += " AND r.fecha >= %s"
            params.append(fecha_desde)
        if fecha_hasta:
            query += " AND r.fecha <= %s"
            params.append(fecha_hasta)
        query += " ORDER BY r.fecha, r.hora_inicio"
        cur.execute(query, tuple(params))
        return cur.fetchall()
    finally:
        cur.close()
        conn.close()


@app.post("/reuniones")
def crear_reunion(datos: dict, usuario=Depends(obtener_usuario_actual)):
    """El administrador crea una reunión para TODOS los mediadores de su sucursal."""
    if usuario["rol"] != "administrador":
        raise HTTPException(status_code=403, detail="Solo el administrador puede crear reuniones")
    if not usuario["sucursal_id"]:
        raise HTTPException(status_code=400, detail="Tu usuario no tiene sucursal asignada")

    fecha, hora_inicio, hora_fin, titulo, detalle, ini = _validar_reunion(datos)

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            INSERT INTO reuniones_mediadores
                (sucursal_id, creado_por_id, titulo, detalle, fecha, hora_inicio, hora_fin)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (usuario["sucursal_id"], usuario["id"], titulo, detalle, fecha, hora_inicio, hora_fin))
        reunion = cur.fetchone()

        conflictos = _citas_en_conflicto(cur, usuario["sucursal_id"], fecha, hora_inicio, hora_fin)

        _notificar_reunion(
            cur, usuario["sucursal_id"], "Reunión de mediadores",
            _texto_reunion(ini, hora_fin, titulo), reunion["id"], excluir_id=usuario["id"]
        )
        conn.commit()
        return {"reunion": reunion, "conflictos": conflictos}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@app.put("/reuniones/{reunion_id}")
def editar_reunion(reunion_id: int, datos: dict, usuario=Depends(obtener_usuario_actual)):
    if usuario["rol"] != "administrador":
        raise HTTPException(status_code=403, detail="Solo el administrador puede modificar reuniones")

    fecha, hora_inicio, hora_fin, titulo, detalle, ini = _validar_reunion(datos)

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT id, sucursal_id, estado FROM reuniones_mediadores WHERE id = %s", (reunion_id,))
        actual = cur.fetchone()
        if not actual:
            raise HTTPException(status_code=404, detail="Reunión no encontrada")
        if actual["estado"] != "activa":
            raise HTTPException(status_code=400, detail="Esta reunión ya fue cancelada")

        cur.execute("""
            UPDATE reuniones_mediadores
            SET titulo = %s, detalle = %s, fecha = %s, hora_inicio = %s, hora_fin = %s,
                fecha_modificacion = NOW()
            WHERE id = %s
            RETURNING *
        """, (titulo, detalle, fecha, hora_inicio, hora_fin, reunion_id))
        reunion = cur.fetchone()

        conflictos = _citas_en_conflicto(cur, actual["sucursal_id"], fecha, hora_inicio, hora_fin)

        _notificar_reunion(
            cur, actual["sucursal_id"], "Reunión de mediadores modificada",
            "Nuevo horario: " + _texto_reunion(ini, hora_fin, titulo), reunion_id,
            excluir_id=usuario["id"]
        )
        conn.commit()
        return {"reunion": reunion, "conflictos": conflictos}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@app.put("/reuniones/{reunion_id}/cancelar")
def cancelar_reunion(reunion_id: int, motivo: str = None, usuario=Depends(obtener_usuario_actual)):
    if usuario["rol"] != "administrador":
        raise HTTPException(status_code=403, detail="Solo el administrador puede cancelar reuniones")

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            UPDATE reuniones_mediadores
            SET estado = 'cancelada', motivo_cancelacion = %s, fecha_modificacion = NOW()
            WHERE id = %s AND estado = 'activa'
            RETURNING *
        """, ((motivo or "").strip() or None, reunion_id))
        reunion = cur.fetchone()
        if not reunion:
            raise HTTPException(status_code=404, detail="Reunión no encontrada o ya cancelada")

        ini = datetime.datetime.strptime(
            f"{reunion['fecha']} {str(reunion['hora_inicio'])[:5]}", "%Y-%m-%d %H:%M"
        )
        _notificar_reunion(
            cur, reunion["sucursal_id"], "Reunión de mediadores cancelada",
            "Cancelada: " + _texto_reunion(ini, str(reunion["hora_fin"])[:5], reunion["titulo"]),
            reunion_id, excluir_id=usuario["id"]
        )
        conn.commit()
        return reunion
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
                c.partes_rapidas,
                -- Invitación rápida pendiente cuyo tema nadie ha escrito aún (la
                -- secretaria puede dejarlo en blanco; el mediador lo completa
                -- en el documento).
                (c.proceso_id IS NULL AND c.estado = 'pendiente'
                 AND c.tema = 'Invitación rápida'
                 AND COALESCE(btrim(c.documento->>'asunto'), '') = '') AS falta_tema,
                c.documento->>'editor_rol' AS documento_editor_rol,
                NULLIF(btrim(c.documento->>'asunto'), '') AS documento_asunto,
                (SELECT na.codigo FROM numeros_acta na WHERE na.cita_id = c.id LIMIT 1) AS numero_acta_codigo,
                (SELECT na.estado FROM numeros_acta na WHERE na.cita_id = c.id LIMIT 1) AS numero_acta_estado,
                (SELECT na.id FROM numeros_acta na WHERE na.cita_id = c.id LIMIT 1) AS numero_acta_id,
                c.creado_por_id,
                cp.nombre || ' ' || cp.apellido AS creado_por,
                pm.codigo_proceso AS codigo_proceso,
                a.codigo_acta,
                s.nombre AS sucursal,
                ci.nombre AS ciudad,
                ci.provincia AS provincia,
                u.nombre || ' ' || u.apellido AS mediador,
                COALESCE(NULLIF(cd.cedula, ''), cd.ruc) AS demandante_cedula,
                cd.nombre || ' ' || cd.apellido AS demandante,
                COALESCE(NULLIF(cdd.cedula, ''), cdd.ruc) AS demandado_cedula,
                cdd.nombre || ' ' || cdd.apellido AS demandado
            FROM citas c
            LEFT JOIN actas a ON c.acta_id = a.id
            JOIN sucursales s ON c.sucursal_id = s.id
            LEFT JOIN ciudades ci ON s.ciudad_id = ci.id
            JOIN usuarios u ON c.usuario_id = u.id
            LEFT JOIN usuarios cp ON cp.id = c.creado_por_id
            LEFT JOIN procesos_mediacion pm ON pm.id = c.proceso_id
            LEFT JOIN clientes cd ON c.cliente_demandante_id = cd.id
            LEFT JOIN clientes cdd ON c.cliente_demandado_id = cdd.id
            WHERE 1=1
        """

        params = []

        # Cada mediador solo ve sus propias citas/agenda. El admin ve todo
        # y puede filtrar por un mediador específico con usuario_id.
        if usuario["rol"] == "secretaria":
            # La secretaria ve la agenda de los mediadores de SU sucursal.
            query += " AND c.sucursal_id = %s"
            params.append(usuario["sucursal_id"])
            if usuario_id:
                query += " AND c.usuario_id = %s"
                params.append(usuario_id)
        elif usuario["rol"] != "administrador":
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
        filas = cur.fetchall()

        # Invitaciones rápidas (aún sin proceso): no tienen clientes
        # registrados; se muestran con las partes que se escribieron al crearlas.
        for fila in filas:
            pr = fila.get("partes_rapidas")
            if pr and not fila.get("demandante"):
                fila["demandante"], fila["demandante_cedula"] = _resumen_lado_rapido(pr.get("solicitantes"))
                fila["demandado"], fila["demandado_cedula"] = _resumen_lado_rapido(pr.get("invitados"))

        return filas

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
            SELECT id, sucursal_id, usuario_id, proceso_id, fecha, hora, estado, creado_por_id
            FROM citas
            WHERE id = %s
        """, (cita_id,))

        cita_actual = cur.fetchone()

        if not cita_actual:
            raise HTTPException(status_code=404, detail="Invitación no encontrada")

        if estado == "realizada":
            ahora_ec = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-5))).replace(tzinfo=None)
            momento = datetime.datetime.combine(cita_actual["fecha"], cita_actual["hora"])
            if momento > ahora_ec:
                raise HTTPException(
                    status_code=400,
                    detail="La reunión todavía no ha llegado: se podrá cerrar cuando sea la hora agendada"
                )

        if estado == "realizada" and cita_actual["proceso_id"]:
            raise HTTPException(
                status_code=400,
                detail="Esta invitación pertenece a un proceso: su resultado se registra dentro del proceso, en Registrar avance"
            )

        # Una invitación rápida con número de acta pedido no se puede cancelar ni
        # cerrar sin proceso: ese camino dejaría al mediador sin completar el acta.
        # Debe crear el proceso; si la reunión no se hizo, el administrador anula el número.
        if estado in ("cancelada", "realizada") and not cita_actual["proceso_id"]:
            cur.execute(
                "SELECT 1 FROM numeros_acta WHERE cita_id = %s AND estado IN ('reservado', 'usado') LIMIT 1",
                (cita_id,)
            )
            if cur.fetchone():
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Esta invitación ya tiene número de acta, así que no se puede cancelar ni cerrar sin proceso. "
                        "Crea el proceso para continuar. Si la reunión no se hizo, pide al administrador que anule el número."
                    )
                )

        if usuario["rol"] == "secretaria":
            if cita_actual["sucursal_id"] != usuario["sucursal_id"]:
                raise HTTPException(
                    status_code=403,
                    detail="Solo puedes modificar invitaciones de tu sucursal"
                )
            # La secretaria solo cancela lo que ella agendó, mientras el mediador
            # no haya continuado (sin proceso, sin número de acta pedido).
            if estado != "cancelada":
                raise HTTPException(
                    status_code=403,
                    detail="El resultado de la invitación lo registra el mediador"
                )
            if cita_actual["creado_por_id"] != usuario["id"]:
                raise HTTPException(
                    status_code=403,
                    detail="Solo puedes cancelar las invitaciones que tú agendaste. Pide al mediador que cancele esta."
                )
            cur.execute(
                "SELECT 1 FROM numeros_acta WHERE cita_id = %s AND estado IN ('reservado', 'usado') LIMIT 1",
                (cita_id,)
            )
            if cita_actual["proceso_id"] or cita_actual["estado"] != "pendiente" or cur.fetchone():
                raise HTTPException(
                    status_code=403,
                    detail="El mediador ya continuó con esta invitación: ahora solo él puede cancelarla"
                )
        elif usuario["rol"] != "administrador":
            if usuario["id"] != cita_actual["usuario_id"]:
                raise HTTPException(
                    status_code=403,
                    detail="No puedes modificar invitaciones de otro mediador"
                )

        cur.execute("""
            UPDATE citas
            SET estado = %s,
                motivo_cancelacion = CASE WHEN %s = 'cancelada' THEN %s ELSE motivo_cancelacion END,
                observaciones = CASE
                    WHEN %s = 'realizada' AND %s IS NOT NULL AND proceso_id IS NULL
                    THEN CASE WHEN COALESCE(btrim(observaciones), '') = '' THEN '' ELSE observaciones || E'\n' END
                         || 'Cierre sin proceso: ' || %s
                    ELSE observaciones
                END,
                fecha_modificacion = NOW()
            WHERE id = %s
            RETURNING *
        """, (estado, estado, motivo.strip() if motivo else None,
               estado, (motivo.strip() or None) if motivo else None,
               (motivo.strip() or None) if motivo else None, cita_id))

        cita = cur.fetchone()

        # Si la cancela otra persona (secretaria o administrador), el mediador
        # dueño de la invitación debe enterarse.
        if estado == "cancelada" and cita["usuario_id"] != usuario["id"]:
            crear_notificacion(
                cur, cita["usuario_id"], "Invitación cancelada",
                f"{usuario['nombre']} {usuario['apellido']} canceló tu invitación del "
                f"{str(cita['fecha'])[:10]} a las {str(cita['hora'])[:5]}. Motivo: {motivo.strip()}",
                "cita", "cita", cita["id"]
            )

        # La secretaria de la sucursal se entera de las cancelaciones que hacen
        # otras personas (el mediador o el administrador).
        if estado == "cancelada" and usuario["rol"] != "secretaria":
            cur.execute("SELECT nombre, apellido FROM usuarios WHERE id = %s", (cita["usuario_id"],))
            _med = cur.fetchone() or {}
            _nom_med = f"{_med.get('nombre', '')} {_med.get('apellido', '')}".strip()
            _notificar_secretaria(
                cur, cita["sucursal_id"], "Invitación cancelada",
                f"{_nom_med}: se canceló la invitación del {str(cita['fecha'])[:10]} a las "
                f"{str(cita['hora'])[:5]}. Motivo: {motivo.strip()}",
                cita["id"], excluir_id=usuario["id"]
            )

        # Una invitación rápida que termina sin proceso (cancelada o reunión
        # sin trámite) nunca tendrá acta: su número reservado se anula solo,
        # queda registrado y deja de contar para el plazo de 48 horas.
        if cita["proceso_id"] is None and estado in ("realizada", "cancelada"):
            motivo_num = "Invitación cancelada" if estado == "cancelada" else "Reunión sin trámite"
            cur.execute(
                "SELECT id, codigo, usuario_id FROM numeros_acta "
                "WHERE cita_id = %s AND estado = 'reservado' AND proceso_id IS NULL FOR UPDATE",
                (cita["id"],)
            )
            num = cur.fetchone()
            if num:
                cur.execute("""
                    UPDATE numeros_acta
                    SET estado = 'anulado', anulado_por = %s, motivo_anulacion = %s, fecha_anulacion = NOW(),
                        reutilizable = true, proceso_id = NULL, cita_id = NULL
                    WHERE id = %s
                """, (usuario["id"], motivo_num, num["id"]))

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
                (SELECT u.telefono FROM usuarios u
                 WHERE u.sucursal_id = s.id AND u.rol = 'mediador'
                   AND u.es_coordinador = true AND u.activo = true
                 LIMIT 1) AS telefono_coordinador,
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
                (SELECT u.telefono FROM usuarios u
                 WHERE u.sucursal_id = s.id AND u.rol = 'mediador'
                   AND u.es_coordinador = true AND u.activo = true
                 LIMIT 1) AS telefono_coordinador,
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
    cita_rapida_id: int = None,
    mediador_id: int = None,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # La secretaria prepara invitaciones, pero no lleva procesos ni
        # firma: no puede crear un proceso como si fuera mediadora.
        if usuario["rol"] == "secretaria":
            raise HTTPException(
                status_code=403,
                detail="La secretaria no puede crear procesos de mediación"
            )

        # Regla: la empresa se registra como la parte principal de su lado
        # (con su representante legal); ya no se crea una persona "en
        # representación de" una empresa.
        if empresa_solicitante_id or empresa_invitado_id:
            raise HTTPException(
                status_code=400,
                detail="Para una empresa, elígela directamente como solicitante o invitado."
            )

        if cliente_demandante_id == cliente_demandado_id:
            raise HTTPException(
                status_code=400,
                detail="Solicitante e invitado no pueden ser iguales"
            )

        # La primera letra del tema siempre va en mayúscula.
        tema = tema.strip()
        tema = tema[:1].upper() + tema[1:]
        if not tema.strip():
            raise HTTPException(
                status_code=400,
                detail="El tema es obligatorio"
            )

        # El administrador puede dejar el proceso a cargo de un mediador de la
        # sucursal elegida (por defecto lo lleva él mismo).
        responsable_id = usuario["id"]
        if mediador_id and usuario["rol"] == "administrador" and mediador_id != usuario["id"]:
            cur.execute("SELECT id, rol, activo, sucursal_id FROM usuarios WHERE id = %s", (mediador_id,))
            m_asig = cur.fetchone()
            if not m_asig or not m_asig["activo"] or m_asig["rol"] != "mediador":
                raise HTTPException(status_code=400, detail="El mediador elegido no está disponible")
            if sucursal_id and m_asig["sucursal_id"] != sucursal_id:
                raise HTTPException(status_code=400, detail="El mediador elegido no pertenece a esa sucursal")
            responsable_id = m_asig["id"]

        # Conflicto de interés: quien lleva el proceso no puede ser una de
        # las partes. Se compara por cédula (misma persona = misma cédula).
        cur.execute("SELECT cedula FROM usuarios WHERE id = %s", (responsable_id,))
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

        # Si el proceso nace de una invitación rápida de la Agenda, se valida
        # antes de gastar el número de proceso.
        if cita_rapida_id:
            cur.execute(
                "SELECT id, usuario_id, sucursal_id, proceso_id, estado FROM citas WHERE id = %s FOR UPDATE",
                (cita_rapida_id,)
            )
            cita_rapida = cur.fetchone()
            if not cita_rapida:
                raise HTTPException(status_code=404, detail="La invitación rápida no existe")
            if cita_rapida["proceso_id"]:
                raise HTTPException(status_code=400, detail="Esa invitación ya está enlazada a un proceso")
            if cita_rapida["estado"] == "cancelada":
                raise HTTPException(status_code=400, detail="Esa invitación fue cancelada")
            if cita_rapida["usuario_id"] != usuario["id"]:
                raise HTTPException(
                    status_code=403,
                    detail="Solo el mediador de esa invitación puede crear el proceso desde ella"
                )
            if cita_rapida["sucursal_id"] != sucursal_id:
                raise HTTPException(
                    status_code=400,
                    detail="La sucursal del proceso debe ser la misma de la invitación rápida"
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
            responsable_id,
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

        # La invitación rápida queda enlazada al proceso: desde aquí aparece
        # en su línea de tiempo y se puede registrar su resultado.
        if cita_rapida_id:
            cur.execute("""
                UPDATE citas
                SET proceso_id = %s,
                    cliente_demandante_id = %s,
                    cliente_demandado_id = %s,
                    fecha_modificacion = NOW()
                WHERE id = %s
            """, (proceso["id"], cliente_demandante_id, cliente_demandado_id, cita_rapida_id))
            # El número de acta ligado a la invitación pasa al proceso.
            cur.execute(
                "UPDATE numeros_acta SET proceso_id = %s WHERE cita_id = %s AND proceso_id IS NULL",
                (proceso["id"], cita_rapida_id)
            )

        if usuario["rol"] == "administrador":
            cur.execute("SELECT nombre, apellido FROM usuarios WHERE id = %s", (responsable_id,))
            r_nom = cur.fetchone()
            nombre_resp = f"{r_nom['nombre']} {r_nom['apellido']}".strip() if r_nom else str(responsable_id)
            if responsable_id != usuario["id"]:
                crear_notificacion(
                    cur, responsable_id, "Nuevo proceso asignado",
                    f"El administrador te asignó el proceso {codigo_proceso}. Ya aparece en tu lista de procesos.",
                    "proceso", "proceso_mediacion", proceso["id"]
                )
                registrar_auditoria(cur, usuario, "proceso_asignado", "procesos", proceso["id"],
                                    f"Proceso creado y dejado a cargo de {nombre_resp}")
            else:
                registrar_auditoria(cur, usuario, "proceso_asignado", "procesos", proceso["id"],
                                    f"Proceso creado por el administrador, a cargo de {nombre_resp}")

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
    suspendido: bool = None,
    proceso_id: int = None,
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
                -- suspendido) Y que ya pasó el plazo de gracia de 48 horas.
                (
                    SELECT p2.id
                    FROM procesos_mediacion p2
                    WHERE p2.usuario_id = p.usuario_id
                      AND """ + _sql_acta_pendiente("p2") + """
                      AND """ + _sql_acta_vencida("p2") + """
                    ORDER BY """ + _sql_fecha_cola("p2") + """ ASC NULLS LAST, p2.id ASC
                    LIMIT 1
                ) AS _id_bloqueante,
                """ + _sql_acta_vencida("p") + """ AS _vencida_propia,
                (SELECT bo.codigo FROM bloqueos_acta bo
                  WHERE bo.usuario_id = p.usuario_id AND bo.estado = 'activo'
                    AND bo.proceso_id IS DISTINCT FROM p.id
                  ORDER BY bo.id LIMIT 1) AS bloqueo_otro_codigo,
                (EXISTS (SELECT 1 FROM bloqueos_acta bd WHERE bd.proceso_id = p.id AND bd.estado = 'desbloqueado')
                 AND EXISTS (SELECT 1 FROM numeros_acta nd WHERE nd.proceso_id = p.id AND nd.estado = 'reservado')
                ) AS _desbloq_admin,
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
                p.requiere_facturas,
                EXISTS (SELECT 1 FROM proceso_facturas f
                         WHERE f.proceso_id = p.id AND f.vigente AND f.tipo = 'cliente') AS tiene_factura_cliente,
                EXISTS (SELECT 1 FROM proceso_facturas f
                         WHERE f.proceso_id = p.id AND f.vigente AND f.tipo = 'mediador') AS tiene_factura_mediador,
                (p.acta_impresa_fecha IS NOT NULL) AS acta_impresa,
                (SELECT na.id FROM numeros_acta na WHERE na.proceso_id = p.id ORDER BY na.id LIMIT 1) AS numero_acta_id,
                (SELECT na.codigo FROM numeros_acta na WHERE na.proceso_id = p.id ORDER BY na.id LIMIT 1) AS numero_acta_codigo,
                (SELECT na.estado FROM numeros_acta na WHERE na.proceso_id = p.id ORDER BY na.id LIMIT 1) AS numero_acta_estado,
                (SELECT na.fecha_solicitud + INTERVAL '48 hours' FROM numeros_acta na
                  WHERE na.proceso_id = p.id AND na.estado = 'reservado' ORDER BY na.id LIMIT 1) AS numero_acta_vence_en,
                (SELECT bq.id FROM bloqueos_acta bq WHERE bq.proceso_id = p.id AND bq.estado = 'activo'
                  ORDER BY bq.id DESC LIMIT 1) AS bloqueo_acta_id,
                (SELECT bq.codigo FROM bloqueos_acta bq WHERE bq.proceso_id = p.id AND bq.estado = 'activo'
                  ORDER BY bq.id DESC LIMIT 1) AS bloqueo_acta_codigo,
                (SELECT bq.fecha_bloqueo FROM bloqueos_acta bq WHERE bq.proceso_id = p.id AND bq.estado = 'activo'
                  ORDER BY bq.id DESC LIMIT 1) AS bloqueo_acta_fecha,
                -- Solo cuenta el ÚLTIMO desbloqueo: si ese devolvió el mismo número, no hubo cambio.
                (SELECT ub.codigo FROM (SELECT bq.codigo, bq.mismo_numero, bq.codigo_nuevo FROM bloqueos_acta bq
                  WHERE bq.proceso_id = p.id AND bq.estado = 'desbloqueado'
                  ORDER BY bq.id DESC LIMIT 1) ub
                  WHERE ub.mismo_numero = false
                    AND ub.codigo_nuevo = (SELECT na.codigo FROM numeros_acta na
                                            WHERE na.proceso_id = p.id AND na.estado = 'reservado'
                                            ORDER BY na.id LIMIT 1)) AS acta_renumerada_desde,
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
                COALESCE(NULLIF(cd.cedula, ''), cd.ruc) AS demandante_cedula,
                cdd.nombre || ' ' || cdd.apellido AS demandado,
                COALESCE(NULLIF(cdd.cedula, ''), cdd.ruc) AS demandado_cedula,
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

        # Un solo proceso (la pantalla de detalle no necesita traer todos).
        if proceso_id:
            query += " AND p.id = %s"
            params.append(proceso_id)

        if sucursal_id and usuario["rol"] == "administrador":
            query += " AND p.sucursal_id = %s"
            params.append(sucursal_id)

        if usuario_id and usuario["rol"] == "administrador":
            query += " AND p.usuario_id = %s"
            params.append(usuario_id)

        if estado:
            query += " AND p.estado = %s"
            params.append(estado)

        if suspendido:
            query += " AND p.suspendido = true"
        elif suspendido is False:
            query += " AND p.suspendido = false"

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
            # Si este proceso ya está vencido (pasaron 48 horas), puede subirse
            # en cualquier orden respecto a los otros vencidos: solo quedan
            # bloqueados los procesos nuevos mientras haya vencidos.
            _venc_propia = fila.pop("_vencida_propia", False)
            _desbloq = fila.pop("_desbloq_admin", False)
            # Otra acta bloqueada del mismo mediador le impide subir esta (salvo que el
            # administrador haya desbloqueado esta a propósito; el administrador no tiene el límite).
            if _desbloq or usuario["rol"] == "administrador":
                fila["bloqueo_otro_codigo"] = None
            if _venc_propia or _desbloq:
                id_bloqueante = None
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
    # Un proceso reactivado por el administrador pasa primero en la fila (si
    # hay varios reactivados, va primero el que se reactivó antes).
    return (
        f"COALESCE({a}.reactivado_fecha - INTERVAL '100 years', "
        f"{a}.fecha_acuerdo, {a}.fecha_solicitud_acta_na)"
    )


# Plazo de gracia: un acta pendiente solo bloquea al mediador cuando pasaron
# 48 horas desde el acuerdo (o desde que se pidió el acta de no acuerdo). Antes
# de eso puede atender y subir las actas de otras reuniones del mismo día. Un
# proceso que el administrador reactivó cuenta como vencido de inmediato.
HORAS_GRACIA_ACTA = 48


def _sql_acta_vencida(a: str = "p") -> str:
    # El plazo corre desde que se pidió el número de acta (si el proceso tiene
    # uno reservado); si no, desde el acuerdo / la solicitud del acta de no
    # acuerdo. Así, varias actas dentro de sus 48 horas se pueden subir en
    # cualquier orden: solo bloquea la que ya venció.
    # Si a este proceso se le anuló su número y aún no pidió otro, el plazo vuelve a
    # empezar cuando lo pida: mientras tanto no cuenta como vencido ni bloquea.
    return (
        f"(NOT (NOT EXISTS (SELECT 1 FROM numeros_acta nx WHERE nx.proceso_id = {a}.id "
        f"AND nx.estado IN ('reservado', 'usado')) "
        f"AND EXISTS (SELECT 1 FROM numeros_acta_anulaciones an WHERE an.proceso_id = {a}.id)) AND "
        f"({a}.reactivado_fecha IS NOT NULL OR "
        f"COALESCE("
        f"(SELECT MIN(nr.fecha_solicitud) FROM numeros_acta nr "
        f"WHERE nr.proceso_id = {a}.id AND nr.estado = 'reservado'), "
        f"CASE WHEN COALESCE({a}.fecha_acuerdo, {a}.fecha_solicitud_acta_na) IS NULL THEN NULL "
        f"ELSE GREATEST(COALESCE({a}.fecha_acuerdo, {a}.fecha_solicitud_acta_na), "
        f"COALESCE({a}.fecha_reasignacion, '-infinity'::timestamptz)) END) "
        f"<= NOW() - INTERVAL '{HORAS_GRACIA_ACTA} hours'))"
    )


def _texto_acta_bloqueante(cur, proceso_id, codigo_proceso):
    """«el acta CAL-SUR-00032 (proceso PRC-000054)» o, si no tiene número,
    «el acta del proceso PRC-000054»."""
    cur.execute(
        "SELECT codigo FROM numeros_acta WHERE proceso_id = %s AND estado IN ('reservado','usado') "
        "ORDER BY id DESC LIMIT 1",
        (proceso_id,)
    )
    r = cur.fetchone()
    if r and r["codigo"]:
        return f"el acta {r['codigo']} (proceso {codigo_proceso})"
    return f"el acta del proceso {codigo_proceso}"


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


def _sb_auth(key):
    """Cabecera Authorization para Supabase. Las claves JWT antiguas (service_role)
    se envian tambien como Bearer; las claves nuevas (sb_secret_...) no son JWT
    y solo van en la cabecera apikey."""
    if key and str(key).startswith("eyJ"):
        return {"Authorization": f"Bearer {key}"}
    return {}


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


def _empresa_del_lado(cur, proceso_id, rol, cliente):
    """Regla de cada lado (solicitantes / invitados): o solo personas
    naturales, o UNA sola empresa con todas las demás personas como sus
    miembros. Nunca mezcladas ni dos empresas. Devuelve el id de la empresa
    a la que pertenece la nueva parte (o None si va a título personal)."""
    cur.execute("""
        SELECT pp.cliente_id, c.tipo
        FROM proceso_partes pp
        JOIN clientes c ON c.id = pp.cliente_id
        WHERE pp.proceso_id = %s AND pp.rol = %s
    """, (proceso_id, rol))
    lado = cur.fetchall()
    empresa = next((x for x in lado if x["tipo"] == "empresa"), None)
    personas = [x for x in lado if x["tipo"] != "empresa"]
    nombre_lado = "solicitantes" if rol == "solicitante" else "invitados"

    if cliente["tipo"] == "empresa":
        if empresa:
            raise HTTPException(
                status_code=400,
                detail=f"Los {nombre_lado} ya tienen una empresa. Solo puede haber una empresa por lado."
            )
        if personas:
            raise HTTPException(
                status_code=400,
                detail=f"Los {nombre_lado} ya tienen personas naturales. En un lado van solo personas naturales o una sola empresa con sus miembros; no se pueden mezclar."
            )
        return None

    return empresa["cliente_id"] if empresa else None


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


@app.get("/procesos/{proceso_id}/historial-asignacion")
def historial_asignacion_proceso(proceso_id: int, usuario=Depends(obtener_usuario_actual)):
    """Quién creó el proceso a nombre de quién y cada reasignación. Solo administrador."""
    if usuario["rol"] != "administrador":
        raise HTTPException(status_code=403, detail="Solo el administrador puede ver este historial")
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            "SELECT id, accion, usuario_nombre, detalle, fecha_creacion FROM auditoria "
            "WHERE entidad = 'procesos' AND entidad_id = %s AND accion IN ('proceso_asignado', 'proceso_reasignado') "
            "ORDER BY id", (proceso_id,)
        )
        return cur.fetchall()
    finally:
        cur.close()
        conn.close()


@app.post("/procesos/{proceso_id}/reasignar-mediador")
def reasignar_mediador_proceso(proceso_id: int, nuevo_usuario_id: int, usuario=Depends(obtener_usuario_actual)):
    """Solo el administrador. Pasa el proceso (con su número de acta e invitaciones
    pendientes) a otro mediador de la misma sucursal, o al propio administrador.
    Al nuevo responsable le corren 48 horas nuevas desde este momento."""
    if usuario["rol"] != "administrador":
        raise HTTPException(status_code=403, detail="Solo el administrador puede reasignar un proceso")
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT * FROM procesos_mediacion WHERE id = %s FOR UPDATE", (proceso_id,))
        p = cur.fetchone()
        if not p:
            raise HTTPException(status_code=404, detail="Proceso no encontrado")
        if p["estado"] == "anulado":
            raise HTTPException(status_code=400, detail="Este proceso está anulado")
        if p["finalizado"] and not (p["requiere_acta_firmada"] and p["acta_firmada_ruta"] is None):
            raise HTTPException(status_code=400, detail="Este proceso ya está completo")
        if p["usuario_id"] == nuevo_usuario_id:
            raise HTTPException(status_code=400, detail="Ese mediador ya lleva este proceso")
        cur.execute("SELECT id, nombre, apellido, cedula, rol, activo, sucursal_id FROM usuarios WHERE id = %s", (nuevo_usuario_id,))
        nuevo = cur.fetchone()
        if not nuevo or not nuevo["activo"] or nuevo["rol"] not in ("mediador", "administrador"):
            raise HTTPException(status_code=400, detail="El mediador elegido no está disponible")
        if nuevo["rol"] == "mediador" and nuevo["sucursal_id"] != p["sucursal_id"]:
            raise HTTPException(status_code=400, detail="El mediador debe ser de la misma sucursal del proceso")
        if nuevo["cedula"]:
            cur.execute(
                "SELECT 1 FROM proceso_partes pp JOIN clientes c ON c.id = pp.cliente_id "
                "WHERE pp.proceso_id = %s AND c.cedula = %s LIMIT 1",
                (proceso_id, nuevo["cedula"])
            )
            if cur.fetchone():
                raise HTTPException(status_code=400, detail="Ese mediador es parte del proceso y no puede llevarlo")
        anterior_id = p["usuario_id"]
        cur.execute("SELECT nombre, apellido FROM usuarios WHERE id = %s", (anterior_id,))
        ant = cur.fetchone()
        nombre_anterior = f"{ant['nombre']} {ant['apellido']}".strip() if ant else "sin asignar"
        cur.execute("SELECT pg_advisory_xact_lock(%s)", (7300000 + int(p["sucursal_id"]),))
        cur.execute(
            "UPDATE procesos_mediacion SET usuario_id = %s, fecha_reasignacion = NOW(), fecha_modificacion = NOW() WHERE id = %s",
            (nuevo_usuario_id, proceso_id)
        )
        # Invitaciones que siguen pendientes pasan a la agenda del nuevo mediador.
        cur.execute(
            "UPDATE citas SET usuario_id = %s, fecha_modificacion = NOW() "
            "WHERE proceso_id = %s AND estado IN ('pendiente', 'reagendada')",
            (nuevo_usuario_id, proceso_id)
        )
        # El número de acta reservado se va con el proceso y el plazo de 48 horas vuelve a empezar.
        cur.execute(
            "UPDATE numeros_acta SET usuario_id = %s, fecha_solicitud = NOW() WHERE proceso_id = %s AND estado = 'reservado'",
            (nuevo_usuario_id, proceso_id)
        )
        # Si el acta estaba bloqueada, su número queda libre y el bloqueo se cierra:
        # el nuevo responsable pide un número y arranca limpio.
        cur.execute(
            "UPDATE numeros_acta SET proceso_id = NULL, cita_id = NULL, reutilizable = true WHERE proceso_id = %s AND estado = 'bloqueado'",
            (proceso_id,)
        )
        cur.execute(
            "UPDATE bloqueos_acta SET estado = 'desbloqueado', fecha_desbloqueo = NOW(), "
            "desbloqueado_por = %s, mismo_numero = false WHERE proceso_id = %s AND estado = 'activo'",
            (usuario["id"], proceso_id)
        )
        nombre_nuevo = f"{nuevo['nombre']} {nuevo['apellido']}".strip()
        if nuevo_usuario_id != usuario["id"]:
            crear_notificacion(
                cur, nuevo_usuario_id, "Proceso asignado",
                f"El administrador te asignó el proceso {p['codigo_proceso']}. Tienes 48 horas desde ahora para completar su acta.",
                "proceso", "proceso_mediacion", proceso_id
            )
        if anterior_id and anterior_id != nuevo_usuario_id:
            crear_notificacion(
                cur, anterior_id, "Proceso reasignado",
                f"El proceso {p['codigo_proceso']} pasó a {nombre_nuevo}.",
                "proceso", "proceso_mediacion", proceso_id
            )
        registrar_auditoria(
            cur, usuario, "proceso_reasignado", "procesos", proceso_id,
            f"Pasó de {nombre_anterior} a {nombre_nuevo}. Plazo de 48 horas reiniciado."
        )
        conn.commit()
        return {"mensaje": "Proceso reasignado", "mediador": nombre_nuevo}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"No se pudo reasignar el proceso: {e}")
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

        # La pertenencia a la empresa se decide sola según el lado
        # (ya no se elige a mano).
        empresa_representada_id = _empresa_del_lado(cur, proceso_id, rol, cliente)

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
            "SELECT pp.id, pp.rol, c.tipo FROM proceso_partes pp JOIN clientes c ON c.id = pp.cliente_id "
            "WHERE pp.id = %s AND pp.proceso_id = %s",
            (parte_id, proceso_id)
        )
        parte = cur.fetchone()
        if not parte:
            raise HTTPException(status_code=404, detail="Parte no encontrada")

        if parte["tipo"] != "empresa":
            cur.execute(
                "SELECT 1 FROM proceso_partes pp JOIN clientes c ON c.id = pp.cliente_id "
                "WHERE pp.proceso_id = %s AND pp.rol = %s AND c.tipo = 'empresa'",
                (proceso_id, parte["rol"])
            )
            if cur.fetchone():
                raise HTTPException(
                    status_code=400,
                    detail="Cuando el lado tiene una empresa, la empresa es la parte principal (su representante legal sale en la invitación y el acta)."
                )

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

        cur.execute(
            "SELECT COALESCE(NULLIF(btrim(razon_social), ''), btrim(nombre || ' ' || COALESCE(apellido, ''))) AS nombre "
            "FROM clientes WHERE id = %s",
            (parte["cliente_id"],)
        )
        _cli = cur.fetchone()
        _nombre_quitado = (_cli["nombre"] if _cli and _cli["nombre"] else f"cliente {parte['cliente_id']}")

        cur.execute("DELETE FROM proceso_partes WHERE id = %s", (parte_id,))

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

        _verificar_sin_reunion(cur, proceso["usuario_id"], fecha, hora)

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

        cur.execute("SELECT nombre, apellido FROM usuarios WHERE id = %s", (proceso["usuario_id"],))
        _med_proc = cur.fetchone() or {}
        _nom_med_proc = f"{_med_proc.get('nombre', '')} {_med_proc.get('apellido', '')}".strip()

        for admin in cur.fetchall():
            crear_notificacion(
                cur,
                admin["id"],
                "Nueva invitación creada",
                f"{proceso['codigo_proceso']} | "
                f"{proceso['demandante']} y {proceso['demandado']} | "
                + (f"Mediador: {_nom_med_proc} | " if _nom_med_proc else "")
                + f"{proceso['ciudad']} - {proceso['sucursal']} | "
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
# INVITACIÓN RÁPIDA (desde la Agenda, sin crear proceso)
# =========================
def _limpiar_partes_rapidas(datos, cedula_mediador=None):
    """Valida y normaliza las partes de una invitación rápida. En cada lado
    van solo personas naturales (nombre + cédula) o UNA sola empresa con su
    representante legal (nombre + cédula)."""
    resultado = {}
    cedulas_vistas = {}
    for clave, etiqueta, singular in (
        ("solicitantes", "solicitantes", "solicitante"),
        ("invitados", "invitados", "invitado"),
    ):
        lista = datos.get(clave)
        if not isinstance(lista, list) or not lista:
            raise HTTPException(status_code=400, detail=f"Agrega al menos un {singular}")
        if len(lista) > 10:
            raise HTTPException(status_code=400, detail=f"Demasiados {etiqueta} (máximo 10)")

        limpio = []
        for x in lista:
            if not isinstance(x, dict):
                raise HTTPException(status_code=400, detail="Datos de partes inválidos")
            tipo = (x.get("tipo") or "persona").strip().lower()
            if tipo == "empresa":
                if len(lista) > 1:
                    raise HTTPException(
                        status_code=400,
                        detail=f"En los {etiqueta} va una sola empresa, o solo personas naturales; no se pueden mezclar."
                    )
                razon = (x.get("razon_social") or "").strip()[:200]
                ruc = re.sub(r"\D", "", x.get("ruc") or "")
                rep_nombre = (x.get("representante_nombre") or "").strip()[:200]
                rep_cedula = (x.get("representante_cedula") or "").strip()
                if not razon:
                    raise HTTPException(status_code=400, detail=f"Falta la razón social de la empresa ({singular})")
                if ruc and len(ruc) != 13:
                    raise HTTPException(status_code=400, detail="El RUC debe tener 13 dígitos")
                if not rep_nombre:
                    raise HTTPException(status_code=400, detail=f"Falta el nombre del representante legal ({singular})")
                if not validar_cedula_ecuatoriana(rep_cedula):
                    raise HTTPException(status_code=400, detail=f"La cédula del representante legal ({singular}) es inválida")
                cedula_clave = rep_cedula
                limpio.append({
                    "tipo": "empresa", "razon_social": razon, "ruc": ruc or None,
                    "representante_nombre": rep_nombre, "representante_cedula": rep_cedula,
                })
            else:
                nombre = (x.get("nombre") or "").strip()[:200]
                cedula = (x.get("cedula") or "").strip()
                if not nombre:
                    raise HTTPException(status_code=400, detail=f"Falta el nombre de un {singular}")
                if not validar_cedula_ecuatoriana(cedula):
                    raise HTTPException(status_code=400, detail=f"La cédula de {nombre} es inválida")
                cedula_clave = cedula
                limpio.append({"tipo": "persona", "nombre": nombre, "cedula": cedula})

            if cedula_clave in cedulas_vistas:
                raise HTTPException(
                    status_code=400,
                    detail="La misma cédula no puede repetirse entre solicitantes e invitados"
                )
            cedulas_vistas[cedula_clave] = True
            if cedula_mediador and cedula_clave == cedula_mediador:
                raise HTTPException(
                    status_code=400,
                    detail="El mediador no puede ser parte de la invitación que él mismo llevaría. Pide a otro mediador o al administrador que la cree."
                )
        resultado[clave] = limpio
    return resultado


def _resumen_lado_rapido(lista):
    """Texto corto de un lado de la invitación rápida: nombres y cédulas."""
    nombres, cedulas = [], []
    for x in lista or []:
        if x.get("tipo") == "empresa":
            nombres.append(x.get("razon_social") or "")
            cedulas.append(x.get("representante_cedula") or "")
        else:
            nombres.append(x.get("nombre") or "")
            cedulas.append(x.get("cedula") or "")
    return ", ".join(n for n in nombres if n), ", ".join(c for c in cedulas if c)


def _partes_desde_rapidas(pr):
    """Convierte las partes de una invitación rápida al mismo formato que
    usa el documento imprimible para las partes de un proceso."""
    salida = []
    n = 0
    for rol, clave in (("solicitante", "solicitantes"), ("invitado", "invitados")):
        for x in (pr or {}).get(clave) or []:
            n += 1
            base = {
                "id": n, "rol": rol, "es_responsable": n == 1, "cliente_id": None,
                "empresa_representada_id": None, "empresa_nombre": None,
                "apellido": "", "razon_social": None, "ruc": None,
                "representante_nombre": None, "representante_cedula": None,
                "cedula": None,
            }
            if x.get("tipo") == "empresa":
                base.update({
                    "tipo": "empresa", "nombre": x.get("razon_social") or "",
                    "razon_social": x.get("razon_social"), "ruc": x.get("ruc"),
                    "representante_nombre": x.get("representante_nombre"),
                    "representante_cedula": x.get("representante_cedula"),
                })
            else:
                base.update({"tipo": "persona", "nombre": x.get("nombre") or "", "cedula": x.get("cedula")})
            salida.append(base)
    return salida


@app.post("/citas/rapida")
def crear_invitacion_rapida(datos: dict, usuario=Depends(obtener_usuario_actual)):
    """Crea una invitación desde la Agenda SIN crear el proceso. Las partes
    se guardan en la propia invitación; cuando luego se crea el proceso, la
    invitación se enlaza a él."""
    fecha = (datos.get("fecha") or "").strip()
    hora = (datos.get("hora") or "").strip()
    observaciones = (datos.get("observaciones") or "").strip()
    tema = (datos.get("tema") or "").strip()[:500]

    # El tema se cobra con la invitación: solo la secretaria puede dejarlo en
    # blanco (el mediador lo completa después en el documento).
    if not tema and usuario["rol"] != "secretaria":
        raise HTTPException(status_code=400, detail="Escribe el tema a tratar en la reunión")

    try:
        fecha_hora_cita = datetime.datetime.strptime(f"{fecha} {hora[:5]}", "%Y-%m-%d %H:%M")
    except ValueError:
        raise HTTPException(status_code=400, detail="Fecha u hora inválida")
    hora = hora[:5]

    # Hora local de Ecuador (UTC-5) contra el reloj del servidor (UTC).
    if fecha_hora_cita + datetime.timedelta(hours=5) < datetime.datetime.utcnow():
        raise HTTPException(
            status_code=400,
            detail="No se puede agendar una invitación en una fecha u hora pasada"
        )

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # El mediador dueño de la invitación: uno mismo, o (admin) el que se
        # esté viendo en la Agenda.
        mediador_id = usuario["id"]
        if usuario["rol"] == "secretaria" and not datos.get("usuario_id"):
            raise HTTPException(
                status_code=400,
                detail="Elige el mediador al que se le asigna la invitación"
            )
        if usuario["rol"] in ("administrador", "secretaria") and datos.get("usuario_id"):
            try:
                mediador_id = int(datos.get("usuario_id"))
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Mediador inválido")

        cur.execute(
            "SELECT id, sucursal_id, cedula, activo, rol, nombre, apellido FROM usuarios WHERE id = %s",
            (mediador_id,)
        )
        mediador = cur.fetchone()
        if not mediador or not mediador["activo"]:
            raise HTTPException(status_code=404, detail="Mediador no encontrado")
        if not mediador["sucursal_id"]:
            raise HTTPException(status_code=400, detail="El mediador no tiene sucursal asignada")
        if usuario["rol"] == "secretaria" and (
            mediador["sucursal_id"] != usuario["sucursal_id"]
            or mediador["rol"] not in ("mediador", "administrador")
        ):
            raise HTTPException(
                status_code=403,
                detail="Solo puedes asignar invitaciones a mediadores de tu sucursal"
            )

        _verificar_sin_reunion(cur, mediador_id, fecha, hora)

        partes = _limpiar_partes_rapidas(datos, mediador["cedula"])

        # Avisa desde la invitación (y no hasta crear el proceso) si una
        # cédula ya pertenece a un usuario del sistema con otro nombre.
        for _clave in ("solicitantes", "invitados"):
            for _x in partes.get(_clave, []):
                if _x.get("tipo") == "empresa":
                    verificar_cedula_misma_persona(
                        cur, _x.get("representante_cedula"), _x.get("representante_nombre"), "", "usuarios"
                    )
                else:
                    verificar_cedula_misma_persona(cur, _x.get("cedula"), _x.get("nombre"), "", "usuarios")

        cur.execute("""
            SELECT id FROM citas
            WHERE usuario_id = %s AND fecha = %s AND hora = %s AND estado = 'pendiente'
        """, (mediador_id, fecha, hora))
        if cur.fetchone():
            raise HTTPException(
                status_code=400,
                detail=f"El mediador ya tiene otra invitación pendiente el {fecha} a las {hora}. Elige otra hora."
            )

        try:
            cur.execute("""
                INSERT INTO citas (
                    proceso_id, cliente_demandante_id, cliente_demandado_id,
                    sucursal_id, usuario_id, creado_por_id,
                    fecha, hora, tema, observaciones, estado,
                    partes_rapidas, fecha_creacion, fecha_modificacion
                )
                VALUES (NULL, NULL, NULL, %s, %s, %s, %s, %s, %s, %s, 'pendiente', %s::jsonb, NOW(), NOW())
                RETURNING *
            """, (
                mediador["sucursal_id"], mediador_id, usuario["id"],
                fecha, hora, tema or "Invitación rápida", observaciones,
                json.dumps(partes)
            ))
        except psycopg2_errors.UniqueViolation:
            conn.rollback()
            raise HTTPException(
                status_code=400,
                detail=f"El mediador ya tiene otra invitación pendiente el {fecha} a las {hora}. Elige otra hora."
            )
        cita = cur.fetchone()

        sol, _ = _resumen_lado_rapido(partes["solicitantes"])
        inv, _ = _resumen_lado_rapido(partes["invitados"])
        cur.execute("SELECT id FROM usuarios WHERE rol = 'administrador' AND activo = true")
        for admin in cur.fetchall():
            crear_notificacion(
                cur, admin["id"], "Nueva invitación rápida",
                f"{sol} y {inv} | Mediador: {mediador['nombre']} {mediador['apellido']} | {fecha} {hora}",
                "cita", "cita", cita["id"]
            )

        # Si la creó otra persona (la secretaria), el mediador asignado recibe
        # el aviso. Si el dueño es el administrador, ya recibió el de arriba.
        if mediador_id != usuario["id"] and mediador["rol"] != "administrador":
            crear_notificacion(
                cur, mediador_id, "Nueva invitación asignada",
                f"{usuario['nombre']} {usuario['apellido']} te asignó una invitación: "
                f"{sol} y {inv} | {fecha} {hora}"
                + ("" if tema else " — falta completar el tema"),
                "cita", "cita", cita["id"]
            )

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


@app.get("/citas/{cita_id}/historial")
def historial_invitaciones_cita(cita_id: int, usuario=Depends(obtener_usuario_actual)):
    """Todas las invitaciones del proceso al que pertenece esta (la primera,
    la segunda...), con su resultado y las observaciones del mediador."""
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            "SELECT id, usuario_id, sucursal_id, proceso_id FROM citas WHERE id = %s",
            (cita_id,)
        )
        c = cur.fetchone()
        if not c:
            raise HTTPException(status_code=404, detail="Invitación no encontrada")
        if usuario["rol"] == "secretaria":
            permitido = c["sucursal_id"] == usuario["sucursal_id"]
        elif usuario["rol"] != "administrador":
            permitido = c["usuario_id"] == usuario["id"]
        else:
            permitido = True
        if not permitido:
            raise HTTPException(status_code=403, detail="No puedes ver esta invitación")
        if not c["proceso_id"]:
            return []
        cur.execute("""
            SELECT
                ci.id, ci.fecha, ci.hora, ci.estado, ci.observaciones, ci.motivo_cancelacion,
                av.resultado, av.observacion AS observacion_resultado
            FROM citas ci
            LEFT JOIN LATERAL (
                SELECT a.resultado, a.observacion
                FROM avances_mediacion a
                WHERE a.cita_id = ci.id
                ORDER BY a.id DESC LIMIT 1
            ) av ON true
            WHERE ci.proceso_id = %s
            ORDER BY ci.fecha ASC, ci.hora ASC, ci.id ASC
        """, (c["proceso_id"],))
        return cur.fetchall()
    finally:
        cur.close()
        conn.close()


@app.get("/citas/{cita_id}/invitacion-datos")
def datos_invitacion_rapida(cita_id: int, usuario=Depends(obtener_usuario_actual)):
    """Datos para el documento imprimible de una invitación rápida (misma
    forma que los de una invitación de proceso)."""
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT
                c.id, c.usuario_id, c.sucursal_id, c.proceso_id, c.tema, c.partes_rapidas,
                c.fecha, c.hora, c.estado, c.observaciones, c.documento,
                c.fecha_creacion,
                cp.nombre || ' ' || cp.apellido AS creado_por,
                s.nombre AS sucursal, s.direccion AS sucursal_direccion,
                s.telefono AS sucursal_telefono,
                s.admin_telefono AS sucursal_admin_telefono,
                s.admin_email AS sucursal_admin_email,
                ci.nombre AS ciudad,
                u.nombre AS mediador_nombre, u.apellido AS mediador_apellido,
                u.cedula AS mediador_cedula, u.telefono AS mediador_telefono,
                u.email AS mediador_email
            FROM citas c
            JOIN sucursales s ON s.id = c.sucursal_id
            JOIN ciudades ci ON ci.id = s.ciudad_id
            JOIN usuarios u ON u.id = c.usuario_id
            LEFT JOIN usuarios cp ON cp.id = c.creado_por_id
            WHERE c.id = %s
        """, (cita_id,))
        c = cur.fetchone()
        if not c:
            raise HTTPException(status_code=404, detail="Invitación no encontrada")
        if usuario["rol"] == "secretaria":
            if c["sucursal_id"] != usuario["sucursal_id"]:
                raise HTTPException(status_code=403, detail="No puedes ver esta invitación")
        elif usuario["rol"] != "administrador" and c["usuario_id"] != usuario["id"]:
            raise HTTPException(status_code=403, detail="No puedes ver esta invitación")
        if c["proceso_id"]:
            raise HTTPException(
                status_code=409,
                detail=f"proceso:{c['proceso_id']}"
            )

        c["sucursal_admin_telefono"] = c["mediador_telefono"]
        c["sucursal_admin_email"] = _email_administrador(cur)

        proceso = {
            "id": None, "usuario_id": c["usuario_id"],
            "tema": "" if c["tema"] == "Invitación rápida" else (c["tema"] or ""),
            "codigo_proceso": None,
            "sucursal": c["sucursal"], "sucursal_direccion": c["sucursal_direccion"],
            "sucursal_telefono": c["sucursal_telefono"],
            "sucursal_admin_telefono": c["sucursal_admin_telefono"],
            "sucursal_admin_email": c["sucursal_admin_email"],
            "ciudad": c["ciudad"],
            "mediador_nombre": c["mediador_nombre"], "mediador_apellido": c["mediador_apellido"],
            "mediador_cedula": c["mediador_cedula"], "mediador_telefono": c["mediador_telefono"],
            "mediador_email": c["mediador_email"],
        }
        cita = {
            "id": c["id"], "fecha": c["fecha"], "hora": c["hora"], "estado": c["estado"],
            "observaciones": c["observaciones"], "documento": c["documento"],
            "fecha_creacion": c["fecha_creacion"], "creado_por": c["creado_por"],
        }
        return {
            "proceso": proceso,
            "partes": _partes_desde_rapidas(c["partes_rapidas"]),
            "citas": [cita],
            "rapida": True,
        }
    finally:
        cur.close()
        conn.close()


@app.put("/citas/{cita_id}/documento")
def guardar_documento_invitacion_rapida(
    cita_id: int,
    datos: dict,
    usuario=Depends(obtener_usuario_actual)
):
    """Guarda los textos del documento de una invitación rápida."""
    limpio = _documento_limpio(datos)
    limpio["editor_rol"] = usuario["rol"]

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT usuario_id, sucursal_id, estado, proceso_id, documento FROM citas WHERE id = %s", (cita_id,))
        fila = cur.fetchone()
        if not fila:
            raise HTTPException(status_code=404, detail="Invitación no encontrada")
        if fila["proceso_id"]:
            raise HTTPException(status_code=400, detail="Esta invitación ya pertenece a un proceso")
        # La secretaria puede redactar su propio documento, pero no volver a
        # modificar uno que ya editó el mediador o el administrador.
        if usuario["rol"] == "secretaria" and (fila["documento"] or {}).get("editor_rol") in ("mediador", "administrador"):
            raise HTTPException(
                status_code=403,
                detail="El mediador ya editó esta invitación: solo puedes verla e imprimirla"
            )
        if fila["estado"] != "pendiente":
            raise HTTPException(
                status_code=400,
                detail="Esta invitación ya no está pendiente: solo se puede imprimir, no modificar"
            )
        if usuario["rol"] == "secretaria":
            if fila["sucursal_id"] != usuario["sucursal_id"]:
                raise HTTPException(status_code=403, detail="No puedes modificar esta invitación")
        elif usuario["rol"] != "administrador" and fila["usuario_id"] != usuario["id"]:
            raise HTTPException(status_code=403, detail="No puedes modificar esta invitación")

        cur.execute(
            "UPDATE citas SET documento = %s::jsonb WHERE id = %s",
            (json.dumps(limpio), cita_id)
        )
        conn.commit()
        return {"ok": True, "documento": limpio}
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
        cur.execute(
            "SELECT id, codigo_proceso, estado, usuario_id, finalizado, requiere_acta_firmada, acta_firmada_ruta, "
            "requiere_acta_no_acuerdo, suspendido FROM procesos_mediacion WHERE id = %s FOR UPDATE",
            (proceso_id,)
        )
        proceso = cur.fetchone()

        if not proceso:
            raise HTTPException(status_code=404, detail="Proceso no encontrado")

        if proceso["estado"] == "anulado":
            raise HTTPException(status_code=400, detail="Este proceso ya está anulado")

        # Se anula un proceso en negociación o uno cerrado cuya acta aún no se completa
        # (falta la documentación, el comprobante o el acta firmada).
        acta_pendiente = _con_acta(proceso["estado"], proceso["requiere_acta_no_acuerdo"]) and (
            not proceso["finalizado"]
            or (proceso["requiere_acta_firmada"] and proceso["acta_firmada_ruta"] is None)
        )
        if proceso["estado"] != "en_negociacion" and not acta_pendiente:
            raise HTTPException(
                status_code=400,
                detail="Solo se puede anular un proceso que sigue en negociación o cuya acta aún no se completa."
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

        # Un proceso anulado ya no tendrá acta: si tenía un número reservado (por ejemplo, de
        # su invitación rápida), se anula para que no cuente las 48 horas ni bloquee al mediador;
        # queda libre 30 días como cualquier número anulado.
        cur.execute(
            "UPDATE numeros_acta SET estado = 'anulado', anulado_por = %s, "
            "motivo_anulacion = 'Proceso anulado', fecha_anulacion = NOW(), "
            "reutilizable = true, proceso_id = NULL, cita_id = NULL "
            "WHERE proceso_id = %s AND estado = 'reservado'",
            (usuario["id"], proceso_id)
        )
        # Un número ya bloqueado por las 48 horas queda libre (se sueltan sus enlaces) y el
        # bloqueo activo se cierra: el mediador queda libre de este proceso.
        cur.execute(
            "UPDATE numeros_acta SET proceso_id = NULL, cita_id = NULL WHERE proceso_id = %s AND estado = 'bloqueado'",
            (proceso_id,)
        )
        cur.execute(
            "UPDATE bloqueos_acta SET estado = 'desbloqueado', fecha_desbloqueo = NOW(), "
            "desbloqueado_por = %s, mismo_numero = false WHERE proceso_id = %s AND estado = 'activo'",
            (usuario["id"], proceso_id)
        )
        if proceso["usuario_id"]:
            crear_notificacion(
                cur, proceso["usuario_id"], "Proceso anulado",
                f"El administrador anuló el proceso {proceso['codigo_proceso']}. Motivo: {motivo}",
                "proceso", "proceso_mediacion", proceso_id
            )

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
            "cerrado_con_acuerdo", "cerrado_no_acuerdo", "cerrado_sin_acuerdo", "archivado"
        ]:
            raise HTTPException(status_code=400, detail="Resultado no válido")

        # "Cerrado con no acuerdo": cierra sin acuerdo Y pide el acta de no
        # acuerdo, todo en un solo paso (con su número de acta). Si algo falla
        # (por ejemplo, un acta vencida), no se cierra nada.
        con_acta_na = (resultado == "cerrado_no_acuerdo")
        if con_acta_na:
            resultado = "cerrado_sin_acuerdo"

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
            SELECT id, fecha, hora
            FROM citas
            WHERE proceso_id = %s
              AND estado = 'pendiente'
            ORDER BY fecha ASC, hora ASC
            LIMIT 1
        """, (proceso_id,))

        cita_pendiente = cur.fetchone()

        # El resultado de una reunión se registra cuando ya llegó su hora.
        if cita_pendiente:
            ahora_ec = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-5))).replace(tzinfo=None)
            if datetime.datetime.combine(cita_pendiente["fecha"], cita_pendiente["hora"]) > ahora_ec:
                raise HTTPException(
                    status_code=400,
                    detail="La reunión todavía no ha llegado: el resultado se registra cuando sea la hora agendada"
                )

        if not cita_pendiente:
            raise HTTPException(
                status_code=400,
                detail="No existe una invitación pendiente para registrar resultado"
            )

        # Con número de acta pedido el proceso solo se cierra con acuerdo o con
        # acta de no acuerdo: cerrar sin acuerdo (sin acta) o archivar dejaría el
        # número sin completar. Si no se hizo la reunión, el administrador anula el número.
        if resultado in ("cerrado_sin_acuerdo", "archivado"):
            cur.execute(
                "SELECT 1 FROM numeros_acta WHERE proceso_id = %s AND estado IN ('reservado', 'usado') LIMIT 1",
                (proceso_id,)
            )
            if cur.fetchone():
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Este proceso ya tiene número de acta: solo se puede cerrar con acuerdo o con no acuerdo "
                        "(con acta). Si la reunión no se hizo, pide al administrador que anule el número."
                    )
                )

        numero_acta_asignado = None
        numero_acta_nuevo = False
        if resultado == "cerrado_con_acuerdo" or con_acta_na:
            cur.execute("SELECT 1 FROM numeros_acta WHERE proceso_id = %s LIMIT 1", (proceso_id,))
            _ya_tenia = cur.fetchone() is not None
            numero_acta_asignado = _asegurar_numero_proceso(cur, proceso, usuario)
            numero_acta_nuevo = not _ya_tenia

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

            _verificar_sin_reunion(cur, usuario["id"], proxima_fecha, proxima_hora)

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

        if con_acta_na:
            cur.execute("""
                UPDATE procesos_mediacion
                SET requiere_acta_no_acuerdo = true,
                    fecha_solicitud_acta_na = NOW()
                WHERE id = %s
            """, (proceso_id,))
            cur.execute("SELECT id FROM usuarios WHERE rol = 'administrador' AND activo = true")
            for admin in cur.fetchall():
                crear_notificacion(
                    cur, admin["id"], "Acta de no acuerdo pedida",
                    f"Se pidió el acta de no acuerdo del proceso {proceso['codigo_proceso']}"
                    + (f" y se le dio el número de acta {numero_acta_asignado}." if numero_acta_asignado else "."),
                    "acta", "proceso_mediacion", proceso_id
                )

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
        _resp = dict(avance) if avance else {}
        _resp["numero_acta_asignado"] = numero_acta_asignado
        _resp["numero_acta_nuevo"] = numero_acta_nuevo
        return _resp

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
    numero_acta_id: int = Form(None),
    confirmo: bool = Form(False),
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # La documentación y el acta firmada van en un solo PDF y solo se
        # pueden subir una vez: se exige confirmarlo antes de guardar.
        if not confirmo:
            raise HTTPException(
                status_code=400,
                detail="Debes confirmar que el PDF trae toda la documentación, incluida el acta firmada"
            )

        if archivo.content_type != "application/pdf":
            raise HTTPException(
                status_code=400,
                detail="La documentación (con el acta firmada) solo se puede subir en un PDF"
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
                detail="Solo se pueden subir los documentos del acta cuando el proceso está cerrado con acuerdo "
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

        # Bloqueo de 48 horas: con un acta bloqueada el mediador no sube actas.
        _bloquear_actas_vencidas(cur)
        _bq_proc = _bloqueo_activo_proceso(cur, proceso_id)
        if _bq_proc:
            raise HTTPException(status_code=400, detail=_msg_bloqueado(_bq_proc["codigo"]))
        _desbloq_admin = _proceso_desbloqueado_por_admin(cur, proceso_id)
        if usuario["rol"] != "administrador" and not _desbloq_admin:
            _bq_user = _bloqueo_activo_usuario(cur, usuario["id"])
            if _bq_user:
                raise HTTPException(
                    status_code=400,
                    detail=f"Tienes el acta {_bq_user['codigo']} bloqueada (pasaron 48 horas sin completarla). "
                           f"No puedes subir otras actas hasta que el administrador la desbloquee."
                )

        if usuario["rol"] != "administrador" and proceso["usuario_id"] != usuario["id"]:
            raise HTTPException(
                status_code=403,
                detail="Solo el mediador asignado a este proceso puede subir los documentos del acta"
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
        if usuario["rol"] != "administrador" and not _desbloq_admin:
            cur.execute(
                "SELECT id, codigo_proceso, fecha_acuerdo, fecha_solicitud_acta_na, estado, finalizado, pago_pendiente "
                "FROM procesos_mediacion p "
                "WHERE p.usuario_id = %s AND " + _sql_acta_pendiente("p") +
                " AND " + _sql_acta_vencida("p") +
                " ORDER BY " + _sql_fecha_cola("p") + " ASC NULLS LAST, p.id ASC LIMIT 1",
                (usuario["id"],)
            )

            bloqueante = cur.fetchone()

            cur.execute(
                "SELECT " + _sql_acta_vencida("p") + " AS v FROM procesos_mediacion p WHERE p.id = %s",
                (proceso_id,)
            )
            este_vencido = bool((cur.fetchone() or {}).get("v"))

            if bloqueante and bloqueante["id"] != proceso_id and not este_vencido:
                faltante = (
                    ("el comprobante del saldo (segundo pago)" if bloqueante["pago_pendiente"] else "el acta firmada")
                    if bloqueante["finalizado"]
                    else "la documentación con el acta firmada y el comprobante de pago"
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
                        f"Primero debes completar {_texto_acta_bloqueante(cur, bloqueante['id'], bloqueante['codigo_proceso'])}: "
                        f"ya pasaron más de 48 horas ({_cierre_txt} el {fecha_txt}) y falta subir {faltante}. "
                        f"Hasta entonces no puedes subir otras actas que ya estén vencidas. Si no se "
                        f"puede completar, pide al administrador que lo suspenda."
                    )
                )

        # Número de acta: el mediador elige cuál de los números que pidió
        # corresponde a esta acta (debe coincidir con la que redactó). Si no
        # pidió ninguno (o sube el administrador), se asigna el siguiente.
        numero_reservado = None
        es_admin_subida = usuario["rol"] == "administrador"
        # Si el proceso nació de una invitación rápida con número de acta, ese
        # es el número del acta: no se elige otro.
        cur.execute(
            "SELECT id, sucursal_id, codigo, estado, fecha_solicitud, "
            "(fecha_solicitud <= NOW() - INTERVAL '48 hours') AS vencido "
            "FROM numeros_acta WHERE proceso_id = %s AND estado IN ('reservado', 'anulado') "
            "ORDER BY id LIMIT 1 FOR UPDATE",
            (proceso_id,)
        )
        numero_ligado = cur.fetchone()
        if numero_ligado and numero_ligado["estado"] == "anulado":
            raise HTTPException(
                status_code=400,
                detail=(
                    f"El número de acta {numero_ligado['codigo']} de este proceso fue anulado. "
                    f"Pide al administrador que lo reactive para continuar con el mismo número."
                )
            )
        if not numero_ligado:
            raise HTTPException(
                status_code=400,
                detail="Primero pide el número de acta de este proceso (botón «Pedir número de acta»)."
            )
        cur.execute(
            "SELECT id, sucursal_id, codigo, fecha_solicitud, cita_id, proceso_id, "
            "(fecha_solicitud <= NOW() - INTERVAL '48 hours') AS vencido "
            "FROM numeros_acta WHERE usuario_id = %s AND estado = 'reservado' "
            "ORDER BY fecha_solicitud ASC, id ASC FOR UPDATE",
            (usuario["id"],)
        )
        reservados = cur.fetchall()
        # Los números ligados a otra invitación o proceso no se pueden elegir
        # para esta acta (solo cuentan para el plazo de 48 horas).
        libres = [r for r in reservados if not r["cita_id"] and not r["proceso_id"]]
        if numero_ligado:
            numero_reservado = numero_ligado
            if not es_admin_subida and not _desbloq_admin:
                vencidos = [r for r in reservados if r["vencido"] and r["id"] != numero_ligado["id"]]
                if vencidos and not numero_ligado["vencido"]:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Primero debes completar el acta con el número {vencidos[0]['codigo']}: "
                            f"lo pediste hace más de 48 horas. Si no se puede completar, pide al "
                            f"administrador que lo anule."
                        )
                    )
        elif es_admin_subida:
            # El administrador solo puede usar un número suyo de la misma sucursal;
            # si no elige ninguno, se asigna el siguiente.
            libres = [r for r in libres if r["sucursal_id"] == proceso["sucursal_id"]]
            if numero_acta_id:
                numero_reservado = next((r for r in libres if r["id"] == numero_acta_id), None)
                if not numero_reservado:
                    raise HTTPException(status_code=400, detail="El número de acta elegido no es válido")
        elif libres:
            if numero_acta_id:
                numero_reservado = next((r for r in libres if r["id"] == numero_acta_id), None)
                if not numero_reservado:
                    raise HTTPException(status_code=400, detail="El número de acta elegido no es válido")
            elif len(libres) == 1:
                numero_reservado = libres[0]
            else:
                raise HTTPException(
                    status_code=400,
                    detail="Tienes varios números de acta pedidos: elige cuál corresponde a esta acta"
                )
            vencidos = [r for r in reservados if r["vencido"]]
            if vencidos and not numero_reservado["vencido"]:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Primero debes completar el acta con el número {vencidos[0]['codigo']}: "
                        f"lo pediste hace más de 48 horas. Si no se puede completar, pide al "
                        f"administrador que lo anule."
                    )
                )
            if numero_reservado["sucursal_id"] != proceso["sucursal_id"]:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"El número {numero_reservado['codigo']} es de otra sucursal. "
                        f"Elige un número de la sucursal de este proceso."
                    )
                )

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

        # El número se define aquí (después de leer y comprimir los archivos)
        # para mantener bloqueada la numeración de la sucursal el menor
        # tiempo posible.
        if numero_reservado:
            codigo_acta = numero_reservado["codigo"]
            numero_id = numero_reservado["id"]
        else:
            # Ya no se asigna número solo: debe pedirse antes en el proceso.
            raise HTTPException(
                status_code=400,
                detail="Primero pide el número de acta de este proceso (botón «Pedir número de acta»)."
            )

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
                **_sb_auth(SUPABASE_KEY),
                "apikey": SUPABASE_KEY,
                "Content-Type": content_type,
                "x-upsert": "true",
            }
            return requests.post(upload_url, headers=headers, data=contenido)

        response_acta = _subir_a_supabase(ruta_storage, contenido_acta, "application/pdf")

        if response_acta.status_code not in [200, 201]:
            raise HTTPException(
                status_code=500,
                detail=f"Error subiendo los documentos del acta a Supabase: {response_acta.text}"
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

        cur.execute(
            "UPDATE numeros_acta SET estado = 'usado', proceso_id = %s, fecha_uso = NOW() WHERE id = %s",
            (proceso_id, numero_id)
        )

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

        # La documentación ya trae el acta firmada adentro. Si el pago quedó
        # completo, el proceso queda completo de una vez (se registra la misma
        # ruta como acta firmada, para que reportes, facturas y exportaciones
        # sigan funcionando igual). En abonos queda pendiente el saldo.
        if pago_modo == "completo":
            cur.execute("""
                UPDATE procesos_mediacion
                SET acta_firmada_ruta = %s,
                    acta_firmada_nombre = %s,
                    acta_firmada_tamano = %s,
                    acta_firmada_fecha = NOW(),
                    acta_firmada_usuario_id = %s,
                    requiere_facturas = true
                WHERE id = %s
            """, (ruta_storage, archivo.filename, len(contenido_acta), usuario["id"], proceso_id))

        cur.execute("""
            SELECT id FROM usuarios WHERE rol = 'administrador' AND activo = true
        """)

        for admin in cur.fetchall():
            crear_notificacion(
                cur,
                admin["id"],
                "Acta final subida",
                f"Se subió el acta {'de no acuerdo ' if es_no_acuerdo else 'final '}{codigo_acta} ({proceso['ciudad']} - {proceso['sucursal']}), "
                + ("con el primer abono (saldo pendiente)" if pago_modo == "abonos" else "con comprobante de pago. El proceso quedó completo."),
                "acta",
                "proceso_mediacion",
                proceso_id
            )

        conn.commit()

        return {
            "mensaje": (
                "Documentación y comprobante subidos. Falta el saldo para completar el proceso."
                if pago_modo == "abonos"
                else "Documentación y comprobante subidos. El proceso quedó completo."
            ),
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
# MARCAR QUE EL ACTA PARA FIRMAR YA SE ABRIÓ PARA IMPRIMIR
# (habilita el botón "Subir acta firmada" desde cualquier computador)
# =========================
@app.post("/procesos/{proceso_id}/acta-impresa")
def marcar_acta_impresa(proceso_id: int, usuario=Depends(obtener_usuario_actual)):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT usuario_id FROM procesos_mediacion WHERE id = %s", (proceso_id,))
        p = cur.fetchone()
        if not p:
            raise HTTPException(status_code=404, detail="Proceso no encontrado")
        if usuario["rol"] != "administrador" and p["usuario_id"] != usuario["id"]:
            raise HTTPException(status_code=403, detail="No puedes modificar este proceso")
        cur.execute(
            "UPDATE procesos_mediacion SET acta_impresa_fecha = COALESCE(acta_impresa_fecha, NOW()) WHERE id = %s",
            (proceso_id,)
        )
        conn.commit()
        return {"ok": True}
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


# =========================
# ACTA FIRMADA (PDF firmado por las partes)
# =========================
@app.post("/procesos/{proceso_id}/acta-firmada")
async def subir_acta_firmada(
    proceso_id: int,
    archivo: UploadFile = File(None),
    comprobante_final: UploadFile = File(None),
    fecha_pago_final: str = Form(None),
    confirmo: bool = Form(False),
    usuario=Depends(obtener_usuario_actual)
):
    # Con el flujo nuevo la documentación ya trae el acta firmada, así que
    # este paso solo sirve para subir el comprobante del saldo (segundo pago)
    # cuando el pago quedó en abonos. Si llega un PDF (procesos anteriores que
    # esperan su acta firmada), se sigue guardando como acta firmada.
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        con_archivo = archivo is not None and bool(archivo.filename)

        if con_archivo and not confirmo:
            raise HTTPException(
                status_code=400,
                detail="Debes confirmar que el documento es el acta firmada por todas las partes"
            )

        if con_archivo and archivo.content_type != "application/pdf":
            raise HTTPException(
                status_code=400,
                detail="El acta firmada solo se puede subir en PDF (no fotos)"
            )

        cur.execute("""
            SELECT p.id, p.codigo_proceso, p.usuario_id, p.estado, p.finalizado,
                   p.suspendido, p.requiere_acta_firmada, p.acta_firmada_ruta,
                   p.requiere_acta_no_acuerdo, p.pago_pendiente, p.monto_total,
                   p.abono1_monto, p.acta_final_id,
                   ap.codigo_acta, ap.archivo_pdf, ap.nombre_original, ap.tamano_bytes
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
                detail="Primero se deben subir los documentos del acta y el comprobante de pago"
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
            raise HTTPException(status_code=400, detail="Este proceso ya está completo")

        if not con_archivo and not proceso["pago_pendiente"]:
            raise HTTPException(
                status_code=400,
                detail="Falta el acta firmada: súbela en PDF para completar el proceso"
            )

        if not proceso["requiere_acta_firmada"]:
            raise HTTPException(
                status_code=400,
                detail="Este proceso es anterior a la regla del acta firmada y no la requiere"
            )

        base_url, key, bucket = _supabase_config()

        if con_archivo:
            contenido = comprimir_pdf(await archivo.read())
            ruta = f"actas-firmadas/{proceso['codigo_acta'] or proceso['codigo_proceso']}/{uuid.uuid4()}.pdf"
            nombre_firmada = archivo.filename
            tamano_firmada = len(contenido)

            resp = requests.post(
                f"{base_url}/storage/v1/object/{bucket}/{quote(ruta, safe='/')}",
                headers={
                    **_sb_auth(key),
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
        else:
            # La documentación subida antes ya incluye el acta firmada.
            ruta = proceso["archivo_pdf"]
            nombre_firmada = proceso["nombre_original"]
            tamano_firmada = proceso["tamano_bytes"]
            if not ruta:
                raise HTTPException(status_code=400, detail="No se encontró la documentación del proceso")

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
                    **_sb_auth(key),
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
                requiere_facturas = true,
                pago_pendiente = false,
                fecha_modificacion = NOW()
            WHERE id = %s
        """, (ruta, nombre_firmada, tamano_firmada, usuario["id"], proceso_id))

        cur.execute("SELECT id FROM usuarios WHERE rol = 'administrador' AND activo = true")
        for admin in cur.fetchall():
            crear_notificacion(
                cur, admin["id"], "Acta firmada subida",
                (
                    f"Se subió el acta firmada del proceso {proceso['codigo_proceso']}. El proceso quedó completo."
                    if con_archivo else
                    f"Se subió el comprobante del saldo del proceso {proceso['codigo_proceso']}. El proceso quedó completo."
                ),
                "acta", "proceso_mediacion", proceso_id
            )


        conn.commit()
        return {"mensaje": "Proceso completo."}

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
            headers={**_sb_auth(key), "apikey": key}
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
# FACTURAS DEL ACTA (dos PDF por acta culminada)
# =========================
# "cliente": factura que NUMA emite al cliente (el administrador se la da al
# mediador). "mediador": factura que el mediador, como trabajador
# independiente, emite a NUMA. Las sube el mediador del proceso después del
# acta firmada. Son obligatorias para el expediente pero NUNCA bloquean nada.
TIPOS_FACTURA = {
    "cliente": "Factura de NUMA al cliente",
    "mediador": "Factura del mediador a NUMA",
}


def _facturas_del_proceso(cur, proceso_id):
    cur.execute("""
        SELECT f.id, f.tipo, f.nombre, f.tamano_bytes, f.fecha_subida, f.vigente,
               f.reemplazada_en, u.nombre || ' ' || u.apellido AS subida_por
        FROM proceso_facturas f
        LEFT JOIN usuarios u ON u.id = f.usuario_id
        WHERE f.proceso_id = %s
        ORDER BY f.tipo, f.id DESC
    """, (proceso_id,))
    return cur.fetchall()


@app.get("/procesos/{proceso_id}/facturas")
def listar_facturas_proceso(proceso_id: int, usuario=Depends(obtener_usuario_actual)):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            "SELECT usuario_id, requiere_facturas FROM procesos_mediacion WHERE id = %s",
            (proceso_id,)
        )
        p = cur.fetchone()
        if not p:
            raise HTTPException(status_code=404, detail="Proceso no encontrado")
        if usuario["rol"] != "administrador" and p["usuario_id"] != usuario["id"]:
            raise HTTPException(status_code=403, detail="No tienes permiso para ver estas facturas")
        return {
            "requiere_facturas": bool(p["requiere_facturas"]),
            "facturas": _facturas_del_proceso(cur, proceso_id),
        }
    finally:
        cur.close()
        conn.close()


@app.post("/procesos/{proceso_id}/facturas")
async def subir_factura_proceso(
    proceso_id: int,
    tipo: str = Form(...),
    archivo: UploadFile = File(...),
    usuario=Depends(obtener_usuario_actual)
):
    if tipo not in TIPOS_FACTURA:
        raise HTTPException(status_code=400, detail="Tipo de factura inválido")
    if archivo.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="La factura se sube solo en PDF")

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT p.id, p.codigo_proceso, p.usuario_id, p.acta_firmada_ruta,
                   p.requiere_facturas, ap.codigo_acta
            FROM procesos_mediacion p
            LEFT JOIN actas_proceso ap ON ap.id = p.acta_final_id
            WHERE p.id = %s
            FOR UPDATE OF p
        """, (proceso_id,))
        p = cur.fetchone()
        if not p:
            raise HTTPException(status_code=404, detail="Proceso no encontrado")
        if usuario["rol"] != "administrador" and p["usuario_id"] != usuario["id"]:
            raise HTTPException(
                status_code=403,
                detail="Solo el mediador asignado a este proceso puede subir las facturas"
            )
        if not p["acta_firmada_ruta"] or not p["requiere_facturas"]:
            raise HTTPException(
                status_code=400,
                detail="Las facturas se suben después de subir el acta firmada"
            )

        contenido = comprimir_pdf(await archivo.read())

        base_url, key, bucket = _supabase_config()
        ruta = f"facturas/{p['codigo_acta'] or p['codigo_proceso']}/{tipo}-{uuid.uuid4()}.pdf"
        resp = requests.post(
            f"{base_url}/storage/v1/object/{bucket}/{quote(ruta, safe='/')}",
            headers={
                **_sb_auth(key),
                "apikey": key,
                "Content-Type": "application/pdf",
                "x-upsert": "true",
            },
            data=contenido
        )
        if resp.status_code not in [200, 201]:
            raise HTTPException(
                status_code=500,
                detail=f"Error subiendo la factura a Supabase: {resp.text}"
            )

        # Si ya había una vigente de este tipo, queda en el historial.
        cur.execute("""
            UPDATE proceso_facturas
            SET vigente = false, reemplazada_en = NOW()
            WHERE proceso_id = %s AND tipo = %s AND vigente
        """, (proceso_id, tipo))
        reemplazo = cur.rowcount > 0

        cur.execute("""
            INSERT INTO proceso_facturas (proceso_id, tipo, ruta, nombre, tamano_bytes, usuario_id)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (proceso_id, tipo, ruta, archivo.filename, len(contenido), usuario["id"]))

        if reemplazo:
            registrar_auditoria(
                cur, usuario, "factura_reemplazada",
                "procesos", proceso_id,
                f"Reemplazó la {TIPOS_FACTURA[tipo].lower()} del proceso {p['codigo_proceso']}"
            )
        conn.commit()
        return {
            "requiere_facturas": True,
            "facturas": _facturas_del_proceso(cur, proceso_id),
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


@app.get("/procesos/{proceso_id}/facturas/{factura_id}/archivo")
def ver_factura_proceso(proceso_id: int, factura_id: int, usuario=Depends(obtener_usuario_actual)):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT f.ruta, f.tipo, p.codigo_proceso, p.usuario_id
            FROM proceso_facturas f
            JOIN procesos_mediacion p ON p.id = f.proceso_id
            WHERE f.id = %s AND f.proceso_id = %s
        """, (factura_id, proceso_id))
        f = cur.fetchone()
        if not f:
            raise HTTPException(status_code=404, detail="Factura no encontrada")
        if usuario["rol"] != "administrador" and f["usuario_id"] != usuario["id"]:
            raise HTTPException(status_code=403, detail="No tienes permiso para ver esta factura")

        base_url, key, bucket = _supabase_config()
        resp = requests.get(
            f"{base_url}/storage/v1/object/{bucket}/{quote(f['ruta'], safe='/')}",
            headers={**_sb_auth(key), "apikey": key}
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=404, detail="PDF no encontrado en Storage")
        return Response(
            content=resp.content,
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="factura-{f["tipo"]}-{f["codigo_proceso"]}.pdf"'}
        )
    finally:
        cur.close()
        conn.close()


def avisar_facturas_pendientes():
    """Una vez por proceso: si pasaron 5 días desde el acta firmada y todavía
    faltan la factura del cliente o la del mediador, se avisa a los
    administradores. No bloquea nada."""
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT p.id, p.codigo_proceso, u.nombre || ' ' || u.apellido AS mediador,
                   NOT EXISTS (SELECT 1 FROM proceso_facturas f
                                WHERE f.proceso_id = p.id AND f.vigente AND f.tipo = 'cliente') AS falta_cliente,
                   NOT EXISTS (SELECT 1 FROM proceso_facturas f
                                WHERE f.proceso_id = p.id AND f.vigente AND f.tipo = 'mediador') AS falta_mediador
            FROM procesos_mediacion p
            JOIN usuarios u ON u.id = p.usuario_id
            WHERE p.requiere_facturas = true
              AND p.acta_firmada_ruta IS NOT NULL
              AND p.facturas_aviso_fecha IS NULL
              AND p.acta_firmada_fecha < NOW() - INTERVAL '5 days'
        """)
        pendientes = [r for r in cur.fetchall() if r["falta_cliente"] or r["falta_mediador"]]
        if not pendientes:
            return

        cur.execute("SELECT id FROM usuarios WHERE rol = 'administrador' AND activo = true")
        admins = cur.fetchall()
        for r in pendientes:
            faltan = []
            if r["falta_cliente"]:
                faltan.append("la factura de NUMA al cliente")
            if r["falta_mediador"]:
                faltan.append("la factura del mediador a NUMA")
            for a in admins:
                crear_notificacion(
                    cur, a["id"], "Faltan facturas",
                    f"Hace más de 5 días se subió el acta firmada del proceso {r['codigo_proceso']} "
                    f"(mediador {r['mediador']}) y todavía falta {' y '.join(faltan)}.",
                    "acta", "proceso_mediacion", r["id"]
                )
            cur.execute(
                "UPDATE procesos_mediacion SET facturas_aviso_fecha = NOW() WHERE id = %s",
                (r["id"],)
            )
        conn.commit()
    except Exception as e:
        conn.rollback()
        print("No se pudo revisar las facturas pendientes:", e)
    finally:
        cur.close()
        conn.close()


# =========================
# NÚMERO DE ACTA (consecutivo por sucursal)
# =========================
def _reservar_numero_acta(cur, sucursal_id, usuario_id, proceso_id=None, estado="reservado", cita_id=None):
    """Entrega el siguiente número de acta de la sucursal. El bloqueo por
    sucursal (vale hasta el commit) hace que dos mediadores que lo pidan a
    la vez nunca reciban el mismo; además la base lo impide con un índice
    único. Un número anulado o bloqueado se reutiliza durante un mes."""
    cur.execute("SELECT pg_advisory_xact_lock(%s)", (7300000 + int(sucursal_id),))
    cur.execute("""
        SELECT c.prefijo AS prefijo_ciudad, s.codigo_corto
        FROM sucursales s JOIN ciudades c ON c.id = s.ciudad_id
        WHERE s.id = %s
    """, (sucursal_id,))
    suc = cur.fetchone()
    if not suc:
        raise HTTPException(status_code=400, detail="La sucursal no existe")
    # Un número bloqueado (pasaron 48 h sin completar su acta) o anulado queda
    # libre para cualquier mediador de la misma sucursal durante un mes: se
    # entrega primero el más bajo, para no dejar números en blanco. Pasado el
    # mes sin que nadie lo tome, queda anulado de forma definitiva.
    cur.execute("""
        SELECT id FROM numeros_acta
        WHERE sucursal_id = %s
          AND (
            (estado = 'bloqueado' AND COALESCE(fecha_liberado, NOW()) > NOW() - INTERVAL '30 days')
            OR (estado = 'anulado' AND reutilizable AND fecha_anulacion > NOW() - INTERVAL '30 days')
          )
        ORDER BY secuencial ASC LIMIT 1 FOR UPDATE
    """, (sucursal_id,))
    libre = cur.fetchone()
    if libre:
        cur.execute("""
            UPDATE numeros_acta
            SET estado = %s, usuario_id = %s, proceso_id = %s, cita_id = %s,
                fecha_solicitud = NOW(), fecha_uso = CASE WHEN %s = 'usado' THEN NOW() ELSE NULL END,
                aviso_fecha = NULL, anulado_por = NULL, motivo_anulacion = NULL, fecha_anulacion = NULL,
                fecha_reactivacion = NULL, reactivado_por = NULL, fecha_liberado = NULL
            WHERE id = %s
            RETURNING id, codigo, secuencial
        """, (estado, usuario_id, proceso_id, cita_id, estado, libre["id"]))
        return cur.fetchone()
    cur.execute(
        "SELECT COALESCE(MAX(secuencial), 0) + 1 AS n FROM numeros_acta WHERE sucursal_id = %s",
        (sucursal_id,)
    )
    n = cur.fetchone()["n"]
    codigo = f"{suc['prefijo_ciudad']}-{suc['codigo_corto']}-{str(n).zfill(5)}"
    cur.execute("""
        INSERT INTO numeros_acta (sucursal_id, secuencial, codigo, estado, usuario_id, proceso_id, fecha_uso, cita_id)
        VALUES (%s, %s, %s, %s, %s, %s, CASE WHEN %s = 'usado' THEN NOW() ELSE NULL END, %s)
        RETURNING id, codigo, secuencial
    """, (sucursal_id, n, codigo, estado, usuario_id, proceso_id, estado, cita_id))
    return cur.fetchone()


def _fecha_ec_txt(valor):
    """Fecha y hora de Ecuador en texto (dd/mm/aaaa hh:mm) para los detalles de auditoría."""
    try:
        v = valor
        if v.tzinfo is not None:
            v = v.astimezone(datetime.timezone(datetime.timedelta(hours=-5)))
        return v.strftime("%d/%m/%Y %H:%M")
    except Exception:
        return str(valor)[:16]


HORAS_BLOQUEO_ACTA = 48


def _bloquear_actas_vencidas(cur):
    """Bloquea automáticamente todo número de acta de un mediador que cumplió
    las 48 horas desde que el sistema se lo dio sin completar su documentación.
    El número queda libre para la sucursal y se avisa al mediador y a los
    administradores. El administrador nunca se bloquea. Devuelve cuántos."""
    cur.execute("""
        SELECT n.id, n.codigo, n.sucursal_id, n.usuario_id, n.proceso_id, n.cita_id, n.fecha_solicitud,
               p.codigo_proceso,
               u.nombre || ' ' || u.apellido AS mediador
        FROM numeros_acta n
        JOIN usuarios u ON u.id = n.usuario_id
        LEFT JOIN procesos_mediacion p ON p.id = n.proceso_id
        WHERE n.estado = 'reservado'
          AND u.rol = 'mediador'
          AND n.fecha_solicitud <= NOW() - INTERVAL '48 hours'
          AND COALESCE(p.suspendido, false) = false
        FOR UPDATE OF n SKIP LOCKED
    """)
    filas = cur.fetchall()
    if not filas:
        return 0
    cur.execute("SELECT id FROM usuarios WHERE rol = 'administrador' AND activo = true")
    admins = cur.fetchall()
    for r in filas:
        cur.execute("UPDATE numeros_acta SET estado = 'bloqueado', fecha_liberado = NOW() WHERE id = %s", (r["id"],))
        cur.execute("""
            INSERT INTO bloqueos_acta (numero_id, codigo, sucursal_id, usuario_id, proceso_id, cita_id, fecha_solicitud_numero)
            VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id
        """, (r["id"], r["codigo"], r["sucursal_id"], r["usuario_id"], r["proceso_id"], r["cita_id"], r["fecha_solicitud"]))
        bid = cur.fetchone()["id"]
        donde = f" (proceso {r['codigo_proceso']})" if r["codigo_proceso"] else " (invitación rápida)"
        crear_notificacion(
            cur, r["usuario_id"], "Acta bloqueada",
            f"Pasaron 48 horas y el acta {r['codigo']}{donde} no se completó, así que quedó bloqueada. "
            f"Mientras tanto no puedes pedir números de acta ni subir otras actas. "
            f"Pide al administrador que la desbloquee.",
            "acta", "bloqueo_acta", bid
        )
        for a in admins:
            crear_notificacion(
                cur, a["id"], "Acta bloqueada por plazo",
                f"El acta {r['codigo']}{donde} del mediador {r['mediador']} se bloqueó: pasaron 48 horas sin "
                f"completar la documentación. Puedes desbloquearla en Actas Finales.",
                "acta", "bloqueo_acta", bid
            )
    # Se guarda de una vez: aunque la petición que lo detectó falle después,
    # el bloqueo ya queda registrado.
    cur.connection.commit()
    return len(filas)


def _bloqueo_activo_usuario(cur, usuario_id):
    cur.execute("""
        SELECT id, codigo, proceso_id FROM bloqueos_acta
        WHERE usuario_id = %s AND estado = 'activo' ORDER BY fecha_bloqueo ASC LIMIT 1
    """, (usuario_id,))
    return cur.fetchone()


def _proceso_desbloqueado_por_admin(cur, proceso_id):
    """True si el administrador desbloqueó el acta de este proceso y el proceso
    tiene de nuevo un número reservado. Esa acta se puede subir aunque el
    mediador tenga otras actas bloqueadas: el administrador eligió cuál va primero."""
    cur.execute(
        "SELECT 1 FROM bloqueos_acta b "
        "WHERE b.proceso_id = %s AND b.estado = 'desbloqueado' "
        "AND EXISTS (SELECT 1 FROM numeros_acta n WHERE n.proceso_id = %s AND n.estado = 'reservado') "
        "LIMIT 1",
        (proceso_id, proceso_id)
    )
    return cur.fetchone() is not None


def _bloqueo_activo_proceso(cur, proceso_id):
    cur.execute("""
        SELECT id, codigo FROM bloqueos_acta
        WHERE proceso_id = %s AND estado = 'activo' ORDER BY id DESC LIMIT 1
    """, (proceso_id,))
    return cur.fetchone()


def _msg_bloqueado(codigo):
    return (
        f"El acta {codigo} está bloqueada porque pasaron 48 horas sin completarla. "
        f"Pide al administrador que la desbloquee."
    )


def _numeros_pendientes_de(cur, usuario_id):
    """Números pedidos que aún no se usaron. 'vencido' = pasaron 48 horas."""
    cur.execute("""
        SELECT n.id, n.codigo, n.sucursal_id, n.fecha_solicitud, n.cita_id, n.proceso_id,
               (n.fecha_solicitud <= NOW() - INTERVAL '48 hours') AS vencido,
               n.fecha_solicitud + INTERVAL '48 hours' AS vence_en
        FROM numeros_acta n
        WHERE n.usuario_id = %s AND n.estado = 'reservado'
        ORDER BY n.fecha_solicitud ASC, n.id ASC
    """, (usuario_id,))
    return cur.fetchall()


def _nombre_parte_rapida(x):
    if not isinstance(x, dict):
        return ""
    if x.get("tipo") == "empresa":
        return x.get("razon_social") or ""
    return x.get("nombre") or ""


def _enriquecer_numeros(cur, filas):
    """Agrega a cada número a qué está ligado: el proceso (código y partes) o
    la invitación rápida (fecha y partes). Para mostrarlo en las listas."""
    for f in filas:
        f["ligado_a"] = None
        f["proceso_codigo"] = None
        f["ligado_detalle"] = None
        if f.get("proceso_id"):
            cur.execute("""
                SELECT p.codigo_proceso,
                       trim(COALESCE(cd.nombre, '') || ' ' || COALESCE(cd.apellido, '')) AS sol,
                       trim(COALESCE(cdd.nombre, '') || ' ' || COALESCE(cdd.apellido, '')) AS inv
                FROM procesos_mediacion p
                LEFT JOIN clientes cd ON cd.id = p.cliente_demandante_id
                LEFT JOIN clientes cdd ON cdd.id = p.cliente_demandado_id
                WHERE p.id = %s
            """, (f["proceso_id"],))
            r = cur.fetchone()
            if r:
                f["ligado_a"] = "proceso"
                f["proceso_codigo"] = r["codigo_proceso"]
                f["ligado_detalle"] = f"{r['sol']} y {r['inv']}".strip()
        elif f.get("cita_id"):
            cur.execute("SELECT fecha, hora, partes_rapidas FROM citas WHERE id = %s", (f["cita_id"],))
            r = cur.fetchone()
            if r:
                pr = r["partes_rapidas"] or {}
                sol = (pr.get("solicitantes") or [None])[0]
                inv = (pr.get("invitados") or [None])[0]
                f["ligado_a"] = "invitacion"
                f["ligado_detalle"] = (
                    f"{_nombre_parte_rapida(sol)} y {_nombre_parte_rapida(inv)}".strip()
                    + f" · {r['fecha'].strftime('%d/%m/%Y')} {str(r['hora'])[:5]}"
                )
    return filas


def _motivo_no_puede_pedir_numero(cur, usuario):
    """Regla de las 48 horas: tener números o actas pendientes NO bloquea
    mientras no pasen 48 horas (puede haber varias reuniones el mismo día).
    Solo bloquea lo que ya venció."""
    _bloquear_actas_vencidas(cur)
    bq = _bloqueo_activo_usuario(cur, usuario["id"])
    if bq:
        return (
            f"Tienes el acta {bq['codigo']} bloqueada (pasaron 48 horas sin completarla). "
            f"Hasta que el administrador la desbloquee no puedes pedir números de acta."
        )
    for n in _numeros_pendientes_de(cur, usuario["id"]):
        if n["vencido"]:
            return (
                f"Pediste el número {n['codigo']} hace más de 48 horas y todavía no se completa esa acta. "
                f"Sube sus documentos en el proceso correspondiente; si no se puede completar, "
                f"pide al administrador que lo anule."
            )
    cur.execute(
        "SELECT p.id, p.codigo_proceso FROM procesos_mediacion p "
        "WHERE p.usuario_id = %s AND " + _sql_acta_pendiente("p") +
        " AND " + _sql_acta_vencida("p") +
        " ORDER BY " + _sql_fecha_cola("p") + " ASC NULLS LAST, p.id ASC LIMIT 1",
        (usuario["id"],)
    )
    bloqueante = cur.fetchone()
    if bloqueante:
        return (
            f"Primero debes completar {_texto_acta_bloqueante(cur, bloqueante['id'], bloqueante['codigo_proceso'])} "
            f"(documentos del acta, comprobante de pago y acta firmada): ya pasaron más de 48 horas. "
            f"Hasta entonces no puedes pedir otro número de acta."
        )
    return None


@app.get("/numeros-acta/anulaciones")
def historial_anulaciones_numeros(usuario=Depends(obtener_usuario_actual)):
    """Anulaciones de números de acta de los últimos 30 días (la ventana en que un número
    puede volver a tomarse). El administrador ve todas; el mediador, solo las suyas.
    «destino» dice qué pasó después con el número."""
    if usuario["rol"] not in ("administrador", "mediador"):
        raise HTTPException(status_code=403, detail="No tienes permiso para ver esta información")
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        filtro = "" if usuario["rol"] == "administrador" else " AND a.usuario_id = %(u)s"
        cur.execute(f"""
            SELECT a.id, a.codigo, a.fecha, a.motivo, a.proceso_id, a.cita_id, a.usuario_id AS mediador_id,
                   pr.codigo_proceso AS proceso_codigo,
                   m.nombre || ' ' || m.apellido AS mediador,
                   s.nombre AS sucursal, ci.nombre AS ciudad,
                   CASE
                     WHEN n.estado = 'anulado' AND n.reutilizable THEN 'libre'
                     WHEN n.estado = 'anulado' THEN 'retirado'
                     WHEN n.usuario_id IS DISTINCT FROM a.usuario_id THEN 'tomado'
                     ELSE 'reactivado'
                   END AS destino,
                   CASE WHEN n.estado <> 'anulado' AND n.usuario_id IS DISTINCT FROM a.usuario_id
                        THEN o.nombre || ' ' || o.apellido END AS tomado_por
            FROM numeros_acta_anulaciones a
            JOIN numeros_acta n ON n.id = a.numero_id
            LEFT JOIN usuarios m ON m.id = a.usuario_id
            LEFT JOIN usuarios o ON o.id = n.usuario_id
            LEFT JOIN procesos_mediacion pr ON pr.id = a.proceso_id
            LEFT JOIN sucursales s ON s.id = a.sucursal_id
            LEFT JOIN ciudades ci ON ci.id = s.ciudad_id
            WHERE a.fecha > NOW() - INTERVAL '30 days' {filtro}
            ORDER BY a.fecha DESC
        """, {"u": usuario["id"]})
        return cur.fetchall()
    finally:
        cur.close()
        conn.close()


@app.get("/numeros-acta/mio")
def mi_numero_acta(usuario=Depends(obtener_usuario_actual)):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        es_admin = usuario["rol"] == "administrador"
        _bloquear_actas_vencidas(cur)
        conn.commit()
        reservados = _enriquecer_numeros(cur, _numeros_pendientes_de(cur, usuario["id"]))
        cur.execute("""
            SELECT id, codigo, fecha_bloqueo, proceso_id, cita_id
            FROM bloqueos_acta WHERE usuario_id = %s AND estado = 'activo'
            ORDER BY fecha_bloqueo ASC
        """, (usuario["id"],))
        bloqueados = _enriquecer_numeros(cur, cur.fetchall())
        motivo = None if es_admin else _motivo_no_puede_pedir_numero(cur, usuario)
        cur.execute("""
            SELECT id, codigo, estado, fecha_solicitud, fecha_anulacion, motivo_anulacion,
                   cita_id, proceso_id
            FROM numeros_acta WHERE usuario_id = %s AND estado = 'anulado'
            ORDER BY fecha_anulacion DESC NULLS LAST, id DESC LIMIT 20
        """, (usuario["id"],))
        anulados = _enriquecer_numeros(cur, cur.fetchall())
        cur.execute("""
            SELECT id, codigo, estado, fecha_solicitud, fecha_uso, cita_id, proceso_id
            FROM numeros_acta WHERE usuario_id = %s AND estado = 'usado'
            ORDER BY fecha_uso DESC NULLS LAST, id DESC LIMIT 10
        """, (usuario["id"],))
        usados = _enriquecer_numeros(cur, cur.fetchall())
        return {
            "es_admin": es_admin,
            "reservados": reservados,
            "bloqueados": bloqueados,
            "puede_pedir": motivo is None,
            "motivo": motivo,
            "recientes": anulados[:5],
            "anulados": anulados,
            "usados": usados,
        }
    finally:
        cur.close()
        conn.close()


@app.post("/numeros-acta")
def pedir_numero_acta(cita_id: int = None, usuario=Depends(obtener_usuario_actual)):
    if not cita_id:
        raise HTTPException(
            status_code=400,
            detail="El número de acta se asigna al cerrar el proceso, o se pide desde una invitación rápida en la Agenda."
        )
    if not usuario.get("sucursal_id"):
        raise HTTPException(status_code=400, detail="Tu usuario no tiene sucursal asignada")
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        sucursal_numero = usuario["sucursal_id"]
        # Pedido desde una invitación rápida: el número queda ligado a ella.
        # Una invitación tiene un solo número (si se anula, el número queda libre y la
        # invitación puede pedir otro).
        if cita_id:
            cur.execute("""
                SELECT id, usuario_id, sucursal_id, proceso_id, estado, partes_rapidas
                FROM citas WHERE id = %s
            """, (cita_id,))
            cita_n = cur.fetchone()
            if not cita_n:
                raise HTTPException(status_code=404, detail="Invitación no encontrada")
            if usuario["rol"] != "administrador" and cita_n["usuario_id"] != usuario["id"]:
                raise HTTPException(status_code=403, detail="Solo el mediador de la invitación puede pedir su número de acta")
            if cita_n["proceso_id"] or not cita_n["partes_rapidas"]:
                raise HTTPException(status_code=400, detail="Esta invitación ya pertenece a un proceso")
            if cita_n["estado"] not in ("pendiente", "reagendada"):
                raise HTTPException(status_code=400, detail="Solo se puede pedir el número de una invitación pendiente")
            cur.execute("UPDATE numeros_acta SET cita_id = NULL, proceso_id = NULL WHERE cita_id = %s AND estado = 'anulado'", (cita_id,))
            cur.execute("SELECT codigo, estado FROM numeros_acta WHERE cita_id = %s", (cita_id,))
            previo = cur.fetchone()
            if previo:
                extra = ""
                if previo["estado"] == "bloqueado":
                    extra = " Está bloqueado por pasar 48 horas: solo el administrador puede desbloquearlo."
                raise HTTPException(status_code=409, detail=f"Esta invitación ya tiene el número {previo['codigo']}.{extra}")
            sucursal_numero = cita_n["sucursal_id"]
        # El administrador no tiene bloqueos (es un mediador más, con más permisos).
        motivo = None if usuario["rol"] == "administrador" else _motivo_no_puede_pedir_numero(cur, usuario)
        if motivo:
            raise HTTPException(status_code=400, detail=motivo)
        try:
            n = _reservar_numero_acta(cur, sucursal_numero, usuario["id"], cita_id=cita_id)
        except psycopg2_errors.UniqueViolation:
            conn.rollback()
            raise HTTPException(status_code=409, detail="Ya tienes un número de acta pedido")
        conn.commit()
        return {"id": n["id"], "codigo": n["codigo"]}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"No se pudo pedir el número de acta: {e}")
    finally:
        cur.close()
        conn.close()


def _asegurar_numero_proceso(cur, proceso, usuario):
    """Da al proceso su número de acta si aún no lo tiene (al cerrarlo con acuerdo
    o con acta de no acuerdo). Si ya tiene uno (por ejemplo, de la invitación
    rápida) lo conserva. Desde aquí empiezan a contar las 48 horas. El número
    queda a nombre del mediador dueño del proceso."""
    cur.execute(
        "SELECT codigo, estado FROM numeros_acta WHERE proceso_id = %s ORDER BY id LIMIT 1",
        (proceso["id"],)
    )
    previo = cur.fetchone()
    if previo:
        if previo["estado"] == "anulado":
            raise HTTPException(
                status_code=400,
                detail=f"El número de acta {previo['codigo']} de este proceso fue anulado. "
                       f"Pide al administrador que lo reactive para continuar con el mismo número."
            )
        if previo["estado"] == "bloqueado":
            raise HTTPException(status_code=400, detail=_msg_bloqueado(previo["codigo"]))
        return previo["codigo"]
    _bqp = _bloqueo_activo_proceso(cur, proceso["id"])
    if _bqp:
        raise HTTPException(status_code=400, detail=_msg_bloqueado(_bqp["codigo"]))
    if usuario["rol"] != "administrador":
        cur.execute("SELECT " + _sql_acta_vencida("p") + " AS v FROM procesos_mediacion p WHERE p.id = %s",
                    (proceso["id"],))
        fila = cur.fetchone()
        if not (fila and fila["v"]):
            motivo = _motivo_no_puede_pedir_numero(cur, usuario)
            if motivo:
                raise HTTPException(status_code=400, detail=motivo)
    n = _reservar_numero_acta(cur, proceso["sucursal_id"], proceso["usuario_id"], proceso_id=proceso["id"])
    return n["codigo"]


@app.post("/procesos/{proceso_id}/numero-acta")
def pedir_numero_acta_proceso(proceso_id: int, usuario=Depends(obtener_usuario_actual)):
    """Pide el número de acta de un proceso (el que no nació de una invitación
    con número). Queda ligado al proceso: es el número del acta y no se pide otro."""
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            "SELECT p.id, p.usuario_id, p.sucursal_id, p.estado, p.finalizado, p.suspendido, "
            "p.requiere_acta_no_acuerdo, " + _sql_acta_vencida("p") + " AS vencida_propia "
            "FROM procesos_mediacion p WHERE p.id = %s FOR UPDATE",
            (proceso_id,)
        )
        p = cur.fetchone()
        if not p:
            raise HTTPException(status_code=404, detail="Proceso no encontrado")
        es_admin = usuario["rol"] == "administrador"
        if not es_admin and p["usuario_id"] != usuario["id"]:
            raise HTTPException(status_code=403, detail="Solo el mediador del proceso puede pedir su número de acta")
        if p["estado"] == "anulado" or p["suspendido"]:
            raise HTTPException(status_code=400, detail="Este proceso está anulado o suspendido")
        if p["estado"] not in ("en_negociacion", "cerrado_sin_acuerdo") and not _con_acta(p["estado"], p["requiere_acta_no_acuerdo"]):
            raise HTTPException(status_code=400, detail="Este proceso ya está cerrado y no lleva acta")
        if p["finalizado"]:
            raise HTTPException(status_code=400, detail="El acta de este proceso ya está completa")
        cur.execute("UPDATE numeros_acta SET cita_id = NULL, proceso_id = NULL WHERE proceso_id = %s AND estado = 'anulado'", (proceso_id,))
        cur.execute("SELECT codigo, estado FROM numeros_acta WHERE proceso_id = %s ORDER BY id LIMIT 1", (proceso_id,))
        previo = cur.fetchone()
        if previo:
            extra = ""
            if previo["estado"] == "bloqueado":
                extra = " Está bloqueado por pasar 48 horas: solo el administrador puede desbloquearlo."
            raise HTTPException(status_code=409, detail=f"Este proceso ya tiene el número {previo['codigo']}.{extra}")
        _bqp = _bloqueo_activo_proceso(cur, proceso_id)
        if _bqp:
            raise HTTPException(status_code=409, detail=_msg_bloqueado(_bqp["codigo"]))
        # Un proceso ya vencido (48 h) debe poder pedir su propio número.
        motivo = None if (es_admin or p["vencida_propia"]) else _motivo_no_puede_pedir_numero(cur, usuario)
        if motivo:
            raise HTTPException(status_code=400, detail=motivo)
        try:
            n = _reservar_numero_acta(cur, p["sucursal_id"], p["usuario_id"], proceso_id=proceso_id)
        except psycopg2_errors.UniqueViolation:
            conn.rollback()
            raise HTTPException(status_code=409, detail="Ya tienes un número de acta pedido")
        conn.commit()
        return {"id": n["id"], "codigo": n["codigo"]}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"No se pudo pedir el número de acta: {e}")
    finally:
        cur.close()
        conn.close()


@app.get("/numeros-acta")
def listar_numeros_acta(sucursal_id: int = None, usuario=Depends(obtener_usuario_actual)):
    if usuario["rol"] != "administrador":
        raise HTTPException(status_code=403, detail="Solo el administrador puede ver esta lista")
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        _bloquear_actas_vencidas(cur)
        conn.commit()
        filtro = " AND n.sucursal_id = %(s)s" if sucursal_id else ""
        base = """
            SELECT n.id, n.codigo, n.estado, n.fecha_solicitud, n.fecha_anulacion, n.motivo_anulacion,
                   n.cita_id, n.proceso_id,
                   EXTRACT(DAY FROM NOW() - n.fecha_solicitud)::int AS dias,
                   (SELECT substring(a.detalle from 'Motivo: (.*)$') FROM auditoria a
                     WHERE a.accion = 'pedir_anulacion_numero_acta' AND a.entidad = 'numero_acta'
                       AND a.entidad_id = n.id AND n.estado = 'reservado'
                     ORDER BY a.id DESC LIMIT 1) AS pedido_anulacion,
                   u.nombre || ' ' || u.apellido AS mediador,
                   s.nombre AS sucursal, c.nombre AS ciudad
            FROM numeros_acta n
            LEFT JOIN usuarios u ON u.id = n.usuario_id
            JOIN sucursales s ON s.id = n.sucursal_id
            JOIN ciudades c ON c.id = s.ciudad_id
            WHERE """
        cur.execute(base + "n.estado = 'reservado'" + filtro + " ORDER BY n.fecha_solicitud ASC", {"s": sucursal_id})
        pendientes = cur.fetchall()
        cur.execute(base + "n.estado = 'anulado'" + filtro + " ORDER BY n.fecha_anulacion DESC LIMIT 30", {"s": sucursal_id})
        anulados = cur.fetchall()
        cur.execute("""
            SELECT b.id, b.codigo, b.fecha_bloqueo, b.proceso_id, b.cita_id, b.numero_id, b.usuario_id,
                   (nn.estado = 'bloqueado') AS numero_libre,
                   u.nombre || ' ' || u.apellido AS mediador,
                   s.nombre AS sucursal, c.nombre AS ciudad
            FROM bloqueos_acta b
            LEFT JOIN numeros_acta nn ON nn.id = b.numero_id
            LEFT JOIN usuarios u ON u.id = b.usuario_id
            JOIN sucursales s ON s.id = b.sucursal_id
            JOIN ciudades c ON c.id = s.ciudad_id
            WHERE b.estado = 'activo'""" + (" AND b.sucursal_id = %(s)s" if sucursal_id else "") + """
            ORDER BY b.fecha_bloqueo ASC
        """, {"s": sucursal_id})
        bloqueados = cur.fetchall()
        return {
            "pendientes": _enriquecer_numeros(cur, pendientes),
            "anulados": _enriquecer_numeros(cur, anulados),
            "bloqueados": _enriquecer_numeros(cur, bloqueados),
        }
    finally:
        cur.close()
        conn.close()


@app.post("/bloqueos-acta/{bloqueo_id}/desbloquear")
def desbloquear_acta(bloqueo_id: int, usuario=Depends(obtener_usuario_actual)):
    """Solo el administrador. Al bloquearse, el número queda libre; al desbloquear
    el mediador recibe el número libre más bajo de la sucursal (solo coincide con
    el anterior si nadie más lo tomó). Arranca un plazo nuevo de 48 horas."""
    if usuario["rol"] != "administrador":
        raise HTTPException(status_code=403, detail="Solo el administrador puede desbloquear un acta")
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT * FROM bloqueos_acta WHERE id = %s FOR UPDATE", (bloqueo_id,))
        b = cur.fetchone()
        if not b:
            raise HTTPException(status_code=404, detail="Bloqueo no encontrado")
        if b["estado"] != "activo":
            raise HTTPException(status_code=400, detail="Esta acta ya fue desbloqueada")
        cur.execute("SELECT pg_advisory_xact_lock(%s)", (7300000 + int(b["sucursal_id"]),))
        # El número bloqueado quedó libre para la sucursal: el mediador entra a la
        # cola como cualquiera y recibe el número libre más bajo. Solo recibe el
        # mismo si, por coincidencia, nadie más lo tomó y sigue siendo el menor.
        # Se sueltan los enlaces del número bloqueado (proceso/invitación) para que
        # el número que se asigne pueda quedar ligado a ellos (hay índices únicos).
        # Si el bloqueado vuelve a salir elegido, _reservar_numero_acta lo religa.
        cur.execute("""
            UPDATE numeros_acta SET proceso_id = NULL, cita_id = NULL
            WHERE id = %s AND estado = 'bloqueado'
        """, (b["numero_id"],))
        nuevo = _reservar_numero_acta(
            cur, b["sucursal_id"], b["usuario_id"], proceso_id=b["proceso_id"], cita_id=b["cita_id"]
        )
        codigo_nuevo = nuevo["codigo"]
        numero_nuevo_id = nuevo["id"]
        mismo = codigo_nuevo == b["codigo"]
        cur.execute("""
            UPDATE bloqueos_acta
            SET estado = 'desbloqueado', fecha_desbloqueo = NOW(), desbloqueado_por = %s,
                mismo_numero = %s, codigo_nuevo = %s
            WHERE id = %s
        """, (usuario["id"], mismo, codigo_nuevo, bloqueo_id))
        registrar_auditoria(
            cur, usuario, "desbloquear_acta", "numero_acta", numero_nuevo_id,
            f"Acta {b['codigo']} desbloqueada. " + ("Recibió el mismo número (seguía libre)." if mismo else f"Recibió el número nuevo {codigo_nuevo}.")
        )
        if b["usuario_id"]:
            if mismo:
                msg = (f"El administrador desbloqueó tu acta. Tu número de acta es {codigo_nuevo} y "
                       f"tienes 48 horas desde ahora para completarla.")
            else:
                msg = (f"El administrador desbloqueó tu acta. El número {b['codigo']} quedó libre para otros: "
                       f"tu nuevo número de acta es {codigo_nuevo}. Debes rehacer el acta con ese número y "
                       f"volver a firmarla. Tienes 48 horas desde ahora.")
            crear_notificacion(cur, b["usuario_id"], "Acta desbloqueada", msg, "acta", "bloqueo_acta", bloqueo_id)
        conn.commit()
        return {"mensaje": "Acta desbloqueada", "mismo_numero": mismo, "codigo": codigo_nuevo}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"No se pudo desbloquear el acta: {e}")
    finally:
        cur.close()
        conn.close()


@app.post("/numeros-acta/{numero_id}/pedir-anulacion")
def pedir_anulacion_numero(numero_id: int, motivo: str = Form(...), usuario=Depends(obtener_usuario_actual)):
    """El mediador pide al administrador que anule su número de acta (por ejemplo,
    porque la reunión no se hizo). Queda registrado en la auditoría y avisa a los
    administradores y a la secretaria de la sucursal. No anula nada por sí solo."""
    if usuario["rol"] != "mediador":
        raise HTTPException(status_code=403, detail="Solo el mediador dueño del número puede pedir su anulación")
    motivo = (motivo or "").strip()
    if len(motivo) < 5:
        raise HTTPException(status_code=400, detail="Escribe el motivo del pedido")
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            "SELECT id, codigo, estado, usuario_id, sucursal_id, cita_id, proceso_id FROM numeros_acta WHERE id = %s",
            (numero_id,)
        )
        n = cur.fetchone()
        if not n or n["usuario_id"] != usuario["id"]:
            raise HTTPException(status_code=404, detail="Número de acta no encontrado")
        if n["estado"] != "reservado":
            raise HTTPException(status_code=400, detail="Solo se puede pedir la anulación de un número pedido que aún no se usó")
        nombre = f"{usuario['nombre']} {usuario['apellido']}".strip()
        texto = (
            f"{nombre} pide anular el número de acta {n['codigo']}. Motivo: {motivo}. "
            f"El administrador puede anularlo en Actas finales (números de acta)."
        )
        cur.execute("SELECT id FROM usuarios WHERE rol = 'administrador' AND activo = true")
        for a in cur.fetchall():
            crear_notificacion(cur, a["id"], "Pedido de anulación de número", texto, "acta", "numero_acta", numero_id)
        cur.execute(
            "SELECT id FROM usuarios WHERE rol = 'secretaria' AND activo = true AND sucursal_id = %s",
            (n["sucursal_id"],)
        )
        for sec in cur.fetchall():
            crear_notificacion(
                cur, sec["id"], "Pedido de anulación de número",
                texto + " Si el administrador aún no lo resuelve, recuérdaselo.", "acta", "numero_acta", numero_id
            )
        registrar_auditoria(cur, usuario, "pedir_anulacion_numero_acta", "numero_acta", numero_id,
                            f"Pidió anular el número {n['codigo']}. Motivo: {motivo}")
        conn.commit()
        return {"mensaje": "Pedido enviado al administrador"}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"No se pudo enviar el pedido: {e}")
    finally:
        cur.close()
        conn.close()


@app.post("/numeros-acta/{numero_id}/anular")
def anular_numero_acta(numero_id: int, motivo: str = Form(...), usuario=Depends(obtener_usuario_actual)):
    if usuario["rol"] != "administrador":
        raise HTTPException(status_code=403, detail="Solo el administrador puede anular un número de acta")
    motivo = (motivo or "").strip()
    if len(motivo) < 5:
        raise HTTPException(status_code=400, detail="Escribe el motivo de la anulación")
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT id, codigo, estado, usuario_id, cita_id, proceso_id FROM numeros_acta WHERE id = %s FOR UPDATE", (numero_id,))
        n = cur.fetchone()
        if not n:
            raise HTTPException(status_code=404, detail="Número de acta no encontrado")
        if n["estado"] != "reservado":
            raise HTTPException(status_code=400, detail="Solo se puede anular un número pedido que aún no se usó")
        cur.execute("""
            UPDATE numeros_acta
            SET estado = 'anulado', anulado_por = %s, motivo_anulacion = %s, fecha_anulacion = NOW(),
                        reutilizable = true, proceso_id = NULL, cita_id = NULL
            WHERE id = %s
        """, (usuario["id"], motivo, numero_id))
        registrar_auditoria(cur, usuario, "anular_numero_acta", "numero_acta", numero_id,
                            f"Número {n['codigo']} anulado. Motivo: {motivo}")
        if n["usuario_id"]:
            crear_notificacion(
                cur, n["usuario_id"], "Número de acta anulado",
                f"El administrador anuló el número {n['codigo']}. Motivo: {motivo}. "
                + "El número queda libre para reutilizarse y ya puedes pedir otro.",
                "acta", "numero_acta", numero_id
            )
        conn.commit()
        return {"mensaje": "Número anulado", "codigo": n["codigo"]}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"No se pudo anular el número: {e}")
    finally:
        cur.close()
        conn.close()


@app.post("/numeros-acta/{numero_id}/reactivar")
def reactivar_numero_acta(numero_id: int, usuario=Depends(obtener_usuario_actual)):
    """El administrador devuelve un número anulado al mediador para que
    continúe con la misma acta (con un plazo nuevo de 48 horas)."""
    if usuario["rol"] != "administrador":
        raise HTTPException(status_code=403, detail="Solo el administrador puede reactivar un número de acta")
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT id, codigo, estado, usuario_id, fecha_solicitud FROM numeros_acta WHERE id = %s FOR UPDATE", (numero_id,))
        n = cur.fetchone()
        if not n:
            raise HTTPException(status_code=404, detail="Número de acta no encontrado")
        if n["estado"] != "anulado":
            raise HTTPException(status_code=400, detail="Solo se puede reactivar un número anulado")
        cur.execute("""
            UPDATE numeros_acta
            SET estado = 'reservado', fecha_solicitud = NOW(), aviso_fecha = NULL,
                anulado_por = NULL, motivo_anulacion = NULL, fecha_anulacion = NULL,
                fecha_reactivacion = NOW(), reactivado_por = %s
            WHERE id = %s
        """, (usuario["id"], numero_id))
        registrar_auditoria(cur, usuario, "reactivar_numero_acta", "numero_acta", numero_id,
                            f"Número {n['codigo']} reactivado (pedido originalmente el {_fecha_ec_txt(n['fecha_solicitud'])})")
        if n["usuario_id"]:
            crear_notificacion(
                cur, n["usuario_id"], "Número de acta reactivado",
                f"El administrador reactivó el número {n['codigo']}. Puedes continuar con esa acta: tienes 48 horas desde ahora.",
                "acta", "numero_acta", numero_id
            )
        conn.commit()
        return {"mensaje": "Número reactivado", "codigo": n["codigo"]}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"No se pudo reactivar el número: {e}")
    finally:
        cur.close()
        conn.close()


def avisar_plazo_acta_vencido():
    """Cada pocos minutos: bloquea los números de acta de mediadores que
    cumplieron 48 horas sin completar su documentación (ver
    _bloquear_actas_vencidas). Se llama igual que antes para no tocar el
    programador de tareas."""
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        _bloquear_actas_vencidas(cur)
        # Un mes sin que nadie tome un número libre: queda anulado para siempre.
        cur.execute("""
            UPDATE numeros_acta
            SET estado = 'anulado', reutilizable = false, fecha_anulacion = NOW(),
                motivo_anulacion = 'Pasó un mes sin que ningún mediador tomara este número'
            WHERE estado = 'bloqueado' AND fecha_liberado <= NOW() - INTERVAL '30 days'
        """)
        cur.execute("""
            UPDATE numeros_acta SET reutilizable = false
            WHERE estado = 'anulado' AND reutilizable AND fecha_anulacion <= NOW() - INTERVAL '30 days'
        """)
        conn.commit()
    except Exception as e:
        conn.rollback()
        print("No se pudieron bloquear las actas vencidas:", e)
    finally:
        cur.close()
        conn.close()


def avisar_numeros_pendientes():
    """Una vez por número: si un mediador lleva más de 5 días con un número de
    acta pedido sin completar, se avisa a los administradores."""
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT n.id, n.codigo, u.nombre || ' ' || u.apellido AS mediador
            FROM numeros_acta n JOIN usuarios u ON u.id = n.usuario_id
            WHERE n.estado = 'reservado' AND n.aviso_fecha IS NULL
              AND u.rol = 'mediador'
              AND n.fecha_solicitud < NOW() - INTERVAL '5 days'
        """)
        pendientes = cur.fetchall()
        if not pendientes:
            return
        cur.execute("SELECT id FROM usuarios WHERE rol = 'administrador' AND activo = true")
        admins = cur.fetchall()
        for r in pendientes:
            for a in admins:
                crear_notificacion(
                    cur, a["id"], "Número de acta sin completar",
                    f"El mediador {r['mediador']} pidió el número {r['codigo']} hace más de 5 días y no ha completado el acta. "
                    f"Puedes anularlo en Actas Finales.",
                    "acta", "numero_acta", r["id"]
                )
            cur.execute("UPDATE numeros_acta SET aviso_fecha = NOW() WHERE id = %s", (r["id"],))
        conn.commit()
    except Exception as e:
        conn.rollback()
        print("No se pudo revisar los números de acta pendientes:", e)
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
def suspender_proceso(proceso_id: int, motivo: str, baja: bool = False, usuario=Depends(obtener_usuario_actual)):
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
        """, (("Baja del acta: " if baja else "") + motivo, usuario["id"], proceso_id))

        if baja:
            # Baja del acta: el mediador queda libre de ese número y el número vuelve
            # a estar disponible durante 30 días (para otro mediador o para el mismo).
            cur.execute(
                "SELECT id, estado FROM numeros_acta WHERE proceso_id = %s AND estado IN ('reservado', 'bloqueado') FOR UPDATE",
                (proceso_id,)
            )
            for num in cur.fetchall():
                if num["estado"] == "reservado":
                    cur.execute("""
                        UPDATE numeros_acta
                        SET estado = 'anulado', anulado_por = %s, motivo_anulacion = %s, fecha_anulacion = NOW(),
                        reutilizable = true, proceso_id = NULL, cita_id = NULL
                        WHERE id = %s
                    """, (usuario["id"], "Baja del acta: " + motivo, num["id"]))
                else:
                    cur.execute("UPDATE numeros_acta SET proceso_id = NULL, cita_id = NULL WHERE id = %s", (num["id"],))
            cur.execute("""
                UPDATE bloqueos_acta
                SET estado = 'desbloqueado', fecha_desbloqueo = NOW(), desbloqueado_por = %s, mismo_numero = false
                WHERE proceso_id = %s AND estado = 'activo'
            """, (usuario["id"], proceso_id))

        crear_notificacion(
            cur, p["usuario_id"],
            "Acta dada de baja" if baja else "Proceso suspendido",
            (f"El administrador dio de baja el acta del proceso {p['codigo_proceso']}: ya no tienes que completarla y quedas libre para tus otros procesos. Motivo: {motivo}"
             if baja else
             f"El administrador suspendió el proceso {p['codigo_proceso']}. Ya puedes subir las actas de tus otros procesos. Motivo: {motivo}"),
            "proceso", "proceso_mediacion", proceso_id
        )
        registrar_auditoria(
            cur, usuario, "proceso_baja_acta" if baja else "proceso_suspendido", "procesos", proceso_id,
            (f"Dio de baja el acta del proceso {p['codigo_proceso']}. Motivo: {motivo}" if baja
             else f"Suspendió el proceso {p['codigo_proceso']}. Motivo: {motivo}")
        )
        conn.commit()
        return {"mensaje": ("Acta dada de baja. El mediador queda libre y el número vuelve a estar disponible 30 días."
                            if baja else "Proceso suspendido. El mediador ya no está bloqueado por este proceso.")}

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
            SET suspendido = false, reactivado_fecha = NOW(), fecha_modificacion = NOW()
            WHERE id = %s
        """, (proceso_id,))

        crear_notificacion(
            cur, p["usuario_id"], "Proceso reactivado",
            f"El administrador reactivó el proceso {p['codigo_proceso']}: pasa a ser el primero de tu fila para completar su acta.",
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
            "SELECT id, codigo_proceso, usuario_id, sucursal_id, estado, requiere_acta_no_acuerdo "
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
        _num_na = _asegurar_numero_proceso(cur, {"id": p["id"], "usuario_id": p["usuario_id"], "sucursal_id": p["sucursal_id"]}, usuario)

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
                f"Se pidió el acta de no acuerdo del proceso {p['codigo_proceso']} y se le dio el número de acta {_num_na}.",
                "acta", "proceso_mediacion", proceso_id
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
            headers={**_sb_auth(key), "apikey": key}
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
                s.telefono AS sucursal_telefono,
                s.admin_telefono AS sucursal_admin_telefono,
                s.admin_email AS sucursal_admin_email,
                ci.nombre AS ciudad,
                u.nombre AS mediador_nombre, u.apellido AS mediador_apellido,
                u.cedula AS mediador_cedula, u.telefono AS mediador_telefono,
                u.email AS mediador_email
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
                detail="El acta imprimible se habilita cuando ya se subieron los documentos del acta y el comprobante de pago"
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
# DATOS PARA IMPRIMIR LA INVITACIÓN
# =========================
@app.get("/procesos/{proceso_id}/invitacion-datos")
def datos_invitacion_imprimible(proceso_id: int, usuario=Depends(obtener_usuario_actual)):
    """Datos para generar la invitación imprimible (no se guarda nada: el
    documento se puede volver a generar cuando haga falta)."""
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT
                p.id, p.usuario_id, p.tema, p.codigo_proceso,
                s.nombre AS sucursal, s.direccion AS sucursal_direccion,
                s.telefono AS sucursal_telefono,
                s.admin_telefono AS sucursal_admin_telefono,
                s.admin_email AS sucursal_admin_email,
                ci.nombre AS ciudad,
                u.nombre AS mediador_nombre, u.apellido AS mediador_apellido,
                u.cedula AS mediador_cedula, u.telefono AS mediador_telefono,
                u.email AS mediador_email
            FROM procesos_mediacion p
            JOIN sucursales s ON s.id = p.sucursal_id
            JOIN ciudades ci ON ci.id = s.ciudad_id
            JOIN usuarios u ON u.id = p.usuario_id
            WHERE p.id = %s
        """, (proceso_id,))
        p = cur.fetchone()

        if not p:
            raise HTTPException(status_code=404, detail="Proceso no encontrado")
        if usuario["rol"] != "administrador" and p["usuario_id"] != usuario["id"]:
            raise HTTPException(status_code=403, detail="No puedes ver este proceso")

        cur.execute("""
            SELECT c.id, c.fecha, c.hora, c.estado, c.observaciones, c.documento,
                   c.fecha_creacion, cp.nombre || ' ' || cp.apellido AS creado_por
            FROM citas c
            LEFT JOIN usuarios cp ON cp.id = c.creado_por_id
            WHERE c.proceso_id = %s ORDER BY c.id ASC
        """, (proceso_id,))
        citas = cur.fetchall()

        # Pie de la invitación: teléfono del mediador que la hace y correo
        # principal del administrador (igual para todo el país).
        p["sucursal_admin_telefono"] = p["mediador_telefono"]
        p["sucursal_admin_email"] = _email_administrador(cur)

        return {"proceso": p, "partes": _consulta_partes(cur, proceso_id), "citas": citas}
    finally:
        cur.close()
        conn.close()


# =========================
# GUARDAR LOS TEXTOS DEL DOCUMENTO DE LA INVITACIÓN
# =========================
_CAMPOS_DOCUMENTO = {
    "modelo": 20, "titulo": 120, "fecha_emision": 10, "asunto": 500,
    "lugar": 1000, "pie": 500, "telefono": 40, "correo": 200, "extras": 1500,
    # Textos del cuerpo del documento que la persona modificó (JSON como texto).
    "textos": 20000,
}


def _documento_limpio(datos):
    limpio = {}
    for campo, maximo in _CAMPOS_DOCUMENTO.items():
        valor = datos.get(campo)
        if valor is None:
            continue
        if not isinstance(valor, str):
            raise HTTPException(status_code=400, detail=f"Campo inválido: {campo}")
        limpio[campo] = valor.strip()[:maximo]

    if limpio.get("modelo") and limpio["modelo"] not in ("natural", "empresa"):
        raise HTTPException(status_code=400, detail="Modelo inválido")
    return limpio


@app.put("/procesos/{proceso_id}/citas/{cita_id}/documento")
def guardar_documento_invitacion(
    proceso_id: int,
    cita_id: int,
    datos: dict,
    usuario=Depends(obtener_usuario_actual)
):
    """Guarda los textos con los que se arma el documento de la invitación
    (lugar, asunto, título, etc.) para poder reimprimirlo igual después."""
    limpio = _documento_limpio(datos)

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT p.usuario_id, c.estado
            FROM citas c
            JOIN procesos_mediacion p ON p.id = c.proceso_id
            WHERE c.id = %s AND c.proceso_id = %s
        """, (cita_id, proceso_id))
        fila = cur.fetchone()
        if not fila:
            raise HTTPException(status_code=404, detail="Invitación no encontrada")
        if fila["estado"] != "pendiente":
            raise HTTPException(
                status_code=400,
                detail="Esta invitación ya no está pendiente: solo se puede imprimir, no modificar"
            )
        if usuario["rol"] != "administrador" and fila["usuario_id"] != usuario["id"]:
            raise HTTPException(status_code=403, detail="No puedes modificar esta invitación")

        cur.execute(
            "UPDATE citas SET documento = %s::jsonb WHERE id = %s",
            (json.dumps(limpio), cita_id)
        )
        conn.commit()
        return {"ok": True, "documento": limpio}
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
# LEER UNA INVITACIÓN YA LLENA (Word o PDF) — Camino A
# =========================
_MESES_ES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10,
    "noviembre": 11, "diciembre": 12,
}
_ORDINALES_INV = ["primera", "segunda", "tercera", "cuarta", "quinta", "sexta"]


def _sin_tildes(texto):
    return "".join(
        c for c in unicodedata.normalize("NFD", texto or "")
        if unicodedata.category(c) != "Mn"
    )


def _texto_de_documento(nombre, contenido):
    """Texto plano de un .docx (sin librerías extra) o de un PDF con texto.
    Devuelve None si el PDF es solo una imagen escaneada."""
    nombre = (nombre or "").lower()
    if nombre.endswith(".docx"):
        try:
            with zipfile.ZipFile(io.BytesIO(contenido)) as z:
                xml = z.read("word/document.xml").decode("utf-8", errors="ignore")
        except Exception:
            raise HTTPException(status_code=400, detail="No se pudo abrir el archivo Word")
        xml = re.sub(r"</w:p>", "\n", xml)
        xml = re.sub(r"<w:tab/>", " ", xml)
        xml = re.sub(r"<[^>]+>", "", xml)
        import html as _html
        return _html.unescape(xml)

    if nombre.endswith(".pdf"):
        try:
            from pypdf import PdfReader
            lector = PdfReader(io.BytesIO(contenido))
            texto = "\n".join((pag.extract_text() or "") for pag in lector.pages)
        except Exception:
            raise HTTPException(status_code=400, detail="No se pudo leer el archivo PDF")
        return texto if len(texto.strip()) >= 50 else None

    raise HTTPException(status_code=400, detail="Sube un archivo Word (.docx) o PDF")


def _datos_de_invitacion(texto):
    """Busca en el texto la fecha, la hora, el 'Primera/Segunda invitación'
    y el lugar de la audiencia."""
    norm = _sin_tildes(texto).lower()
    norm = re.sub(r"\s+", " ", norm)

    inicio = norm.find("convoca")
    if inicio < 0:
        inicio = norm.find("efectu")
    desde = max(inicio, 0)

    # Todas las formas de escribir una fecha que se aceptan. Cada una arma
    # (posición, fin, año, mes, día). Si el documento usa números con barras
    # (11/10/2026) se entiende día/mes/año, como se escribe en Ecuador.
    meses = "|".join(_MESES_ES.keys())
    candidatos = []

    def _agregar(m, anio, mes, dia):
        try:
            datetime.date(int(anio), int(mes), int(dia))
        except ValueError:
            return
        candidatos.append((m.start(), m.end(), int(anio), int(mes), int(dia)))

    # 20 de octubre de 2026 · 20 de octubre del año 2026 · 20 octubre 2026
    for m in re.finditer(rf"(\d{{1,2}})\s+(?:de\s+)?({meses})\s*,?\s*(?:de|del)?\s*(?:ano\s+)?(\d{{4}})", norm):
        _agregar(m, m.group(3), _MESES_ES[m.group(2)], m.group(1))
    # octubre 20, 2026 · octubre 20 de 2026
    for m in re.finditer(rf"({meses})\s+(\d{{1,2}})\s*,?\s*(?:de|del)?\s*(?:ano\s+)?(\d{{4}})", norm):
        _agregar(m, m.group(3), _MESES_ES[m.group(1)], m.group(2))
    # 2026 octubre 20 · 2026, octubre 20
    for m in re.finditer(rf"(\d{{4}})\s*,?\s*({meses})\s*,?\s*(\d{{1,2}})(?!\d)", norm):
        _agregar(m, m.group(1), _MESES_ES[m.group(2)], m.group(3))
    # 2026-10-20 · 2026/10/20 · 2026.10.20
    for m in re.finditer(r"(?<!\d)(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})(?!\d)", norm):
        _agregar(m, m.group(1), m.group(2), m.group(3))
    # 20/10/2026 · 20-10-2026 (día primero)
    for m in re.finditer(r"(?<!\d)(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})(?!\d)", norm):
        _agregar(m, m.group(3), m.group(2), m.group(1))

    candidatos.sort()
    elegida = next((c for c in candidatos if c[0] >= desde), None) or (
        candidatos[-1] if candidatos else None
    )

    fecha = None
    hora = None
    if elegida:
        fecha = datetime.date(elegida[2], elegida[3], elegida[4]).isoformat()
        cola = norm[elegida[1]: elegida[1] + 80]

        def _a_24h(h, minutos, pm):
            h = int(h)
            minutos = int(minutos or 0)
            if not (1 <= h <= 12) or minutos > 59:
                return None
            if pm and h < 12:
                h += 12
            if not pm and h == 12:
                h = 0
            return f"{h:02d}:{minutos:02d}"

        # 3 p.m. · 3pm · 8:30 a. m. · 8 de la mañana · 3 de la tarde
        mh = re.search(r"(?<!\d)(\d{1,2})(?:\s*[:h.]\s*(\d{2}))?\s*([ap])\s*\.?\s*m(?![a-z])", cola)
        if mh:
            hora = _a_24h(mh.group(1), mh.group(2), mh.group(3) == "p")
        if not hora:
            mh = re.search(r"(?<!\d)(\d{1,2})(?:\s*[:h]\s*(\d{2}))?\s*de la\s+(manana|tarde|noche)", cola)
            if mh:
                hora = _a_24h(mh.group(1), mh.group(2), mh.group(3) != "manana")
        if not hora:
            mh = re.search(r"(\d{1,2})\s*(?:h|:)\s*(\d{2})", cola)
            if mh and int(mh.group(1)) < 24 and int(mh.group(2)) < 60:
                hora = f"{int(mh.group(1)):02d}:{mh.group(2)}"
        if not hora:
            mh = re.search(r"a las\s+(\d{1,2})\s*(?:horas|hrs|h)\b", cola)
            if mh and int(mh.group(1)) < 24:
                hora = f"{int(mh.group(1)):02d}:00"

    ordinal = None
    mo = re.search(r"(primera|segunda|tercera|cuarta|quinta|sexta)\s+invitacion", norm)
    if mo:
        ordinal = _ORDINALES_INV.index(mo.group(1)) + 1

    lugar = None
    texto_plano = re.sub(r"\s+", " ", texto)
    ml = re.search(r"(en las oficinas.{10,300}?)(?:\.\s|\.$)", texto_plano, re.IGNORECASE)
    if ml:
        lugar = ml.group(1).strip()

    return {"fecha": fecha, "hora": hora, "ordinal": ordinal, "lugar": lugar}


def _parte_aparece(texto_norm_palabras, parte):
    """¿Aparece esta parte (persona, o empresa/representante) en el texto?"""
    def _todas(nombre):
        palabras = [w for w in re.findall(r"[a-z0-9]+", _sin_tildes(nombre or "").lower()) if len(w) >= 3]
        return bool(palabras) and all(w in texto_norm_palabras for w in palabras)

    if parte["tipo"] == "empresa":
        return _todas(parte["nombre"]) or _todas(parte.get("representante_nombre"))
    return _todas(f"{parte['nombre']} {parte.get('apellido') or ''}")


@app.post("/procesos/{proceso_id}/invitacion-leer")
async def leer_invitacion_llena(
    proceso_id: int,
    archivo: UploadFile = File(...),
    usuario=Depends(obtener_usuario_actual)
):
    """Lee una invitación ya llena (Word o PDF) y devuelve lo que entendió
    para que el mediador lo revise. No guarda el archivo ni crea nada."""
    contenido = await archivo.read()
    if len(contenido) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="El archivo es muy pesado (máximo 10 MB)")

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT id, usuario_id FROM procesos_mediacion WHERE id = %s", (proceso_id,))
        p = cur.fetchone()
        if not p:
            raise HTTPException(status_code=404, detail="Proceso no encontrado")
        if usuario["rol"] != "administrador" and p["usuario_id"] != usuario["id"]:
            raise HTTPException(status_code=403, detail="No puedes modificar este proceso")

        texto = _texto_de_documento(archivo.filename, contenido)
        if texto is None:
            raise HTTPException(
                status_code=400,
                detail="Este PDF es una imagen (escaneado) y no se puede leer. Sube el Word o el PDF generado en computadora."
            )

        datos = _datos_de_invitacion(texto)
        palabras = set(re.findall(r"[a-z0-9]+", _sin_tildes(texto).lower()))

        partes = []
        for pt in _consulta_partes(cur, proceso_id):
            nombre = (
                f"{pt['nombre']} {pt.get('apellido') or ''}".strip()
                if pt["tipo"] != "empresa" else pt["nombre"]
            )
            partes.append({
                "nombre": nombre,
                "rol": pt["rol"],
                "encontrado": _parte_aparece(palabras, pt),
            })

        cur.execute("SELECT COUNT(*) AS n FROM citas WHERE proceso_id = %s", (proceso_id,))
        existentes = cur.fetchone()["n"]

        avisos = []
        if not datos["fecha"]:
            avisos.append("No se encontró la fecha de la audiencia. Escríbela abajo.")
        if datos["fecha"] and not datos["hora"]:
            avisos.append("No se encontró la hora. Escríbela abajo.")
        faltan = [x["nombre"] for x in partes if not x["encontrado"]]
        if faltan:
            avisos.append(
                "No aparecen en el documento: " + ", ".join(faltan)
                + ". Revisa que sea la invitación de este proceso."
            )
        if datos["ordinal"] and datos["ordinal"] != existentes + 1:
            avisos.append(
                f"El documento dice «{_ORDINALES_INV[datos['ordinal'] - 1].capitalize()} invitación», "
                f"pero este proceso ya tiene {existentes} invitación(es)."
            )

        return {**datos, "partes": partes, "avisos": avisos}
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

        if not nombre:
            raise HTTPException(status_code=400, detail="El nombre o razón social de facturación es obligatorio")
        if not direccion:
            raise HTTPException(status_code=400, detail="La dirección de facturación es obligatoria")
        if len(direccion) < 3:
            raise HTTPException(status_code=400, detail="La dirección debe tener al menos 3 caracteres")
        if not email or not validar_email(email):
            raise HTTPException(status_code=400, detail="El correo de facturación es inválido")
        if telefono:
            telefono = re.sub(r"\D", "", telefono)
            if not 7 <= len(telefono) <= 10:
                raise HTTPException(status_code=400, detail="El teléfono de facturación debe tener entre 7 y 10 dígitos")

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
                COALESCE(p.requiere_facturas, false) AS requiere_facturas,
                NOT EXISTS (SELECT 1 FROM proceso_facturas f
                             WHERE f.proceso_id = p.id AND f.vigente AND f.tipo = 'cliente') AS falta_factura_cliente,
                NOT EXISTS (SELECT 1 FROM proceso_facturas f
                             WHERE f.proceso_id = p.id AND f.vigente AND f.tipo = 'mediador') AS falta_factura_mediador,
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
                u.nombre || ' ' || u.apellido AS usuario,
                um.nombre || ' ' || um.apellido AS mediador
            FROM actas_proceso ap
            JOIN procesos_mediacion p ON ap.proceso_id = p.id
            JOIN clientes cd ON p.cliente_demandante_id = cd.id
            JOIN clientes cdd ON p.cliente_demandado_id = cdd.id
            JOIN sucursales s ON p.sucursal_id = s.id
            JOIN ciudades ci ON s.ciudad_id = ci.id
            JOIN usuarios u ON ap.usuario_id = u.id
            JOIN usuarios um ON p.usuario_id = um.id
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
            **_sb_auth(SUPABASE_KEY),
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
            **_sb_auth(SUPABASE_KEY),
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
            **_sb_auth(SUPABASE_KEY),
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

        # Si el acta firmada del proceso era este mismo archivo (acta de no
        # acuerdo: un solo PDF), también apunta al nuevo para que "Acta firmada"
        # y "Documentos del acta" muestren el mismo documento.
        cur.execute("""
            UPDATE procesos_mediacion
            SET acta_firmada_ruta = %s
            WHERE acta_final_id = %s AND acta_firmada_ruta = %s
        """, (ruta_storage, acta_id, acta["archivo_pdf"]))

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
                u.nombre || ' ' || u.apellido AS mediador,
                p.acta_firmada_ruta
            FROM actas_proceso ap
            JOIN procesos_mediacion p ON ap.proceso_id = p.id
            JOIN sucursales s ON p.sucursal_id = s.id
            JOIN ciudades ci ON s.ciudad_id = ci.id
            LEFT JOIN provincias pr ON ci.provincia_id = pr.id
            JOIN clientes cd ON p.cliente_demandante_id = cd.id
            JOIN clientes cdd ON p.cliente_demandado_id = cdd.id
            JOIN usuarios u ON p.usuario_id = u.id
            WHERE (p.estado = 'cerrado_con_acuerdo'
                   OR (p.estado = 'cerrado_sin_acuerdo' AND COALESCE(p.requiere_acta_no_acuerdo, false)))
              AND p.finalizado = true
              AND (NOT COALESCE(p.requiere_acta_firmada, false) OR p.acta_firmada_ruta IS NOT NULL)
              AND COALESCE(p.suspendido, false) = false
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
            **_sb_auth(SUPABASE_KEY),
            "apikey": SUPABASE_KEY,
        }

        def _limpiar(texto):
            texto = texto or ""
            texto = unicodedata.normalize("NFD", texto)
            texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
            texto = re.sub(r"[^A-Za-z0-9]+", "_", texto).strip("_")
            return texto.upper()

        def _descargar(ruta_storage):
            if not ruta_storage:
                return None
            url_archivo = (
                f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/"
                f"{SUPABASE_BUCKET}/{quote(ruta_storage, safe='/')}"
            )
            r = requests.get(url_archivo, headers=headers)
            return r.content if r.status_code == 200 else None

        incluidas = []
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
            for acta in actas:
                firmada = _descargar(acta.get("acta_firmada_ruta"))
                documentacion = _descargar(acta["archivo_pdf"])

                if firmada is None and documentacion is None:
                    continue

                provincia = _limpiar(acta["provincia"] or "Sin provincia")
                ciudad = _limpiar(acta["ciudad"] or "Sin ciudad")
                sucursal = _limpiar(acta["sucursal"] or "Sin sucursal")
                mediador = _limpiar(acta.get("mediador") or "Sin mediador")
                codigo = acta["codigo_acta"] or f"acta_{acta['id']}"
                fecha = acta.get("fecha_subida")
                mes = fecha.strftime("%Y-%m") if fecha else "Sin fecha"

                carpeta = (
                    f"{provincia}/{ciudad}/{sucursal}/{mediador}/{mes}/"
                    f"{codigo}_{_limpiar(acta.get('demandante'))}_VS_{_limpiar(acta.get('demandado'))}"
                )

                if firmada is not None:
                    zipf.writestr(f"{carpeta}/ACTA_FIRMADA.pdf", firmada)
                if documentacion is not None:
                    zipf.writestr(f"{carpeta}/DOCUMENTACION.pdf", documentacion)

                incluidas.append(acta)

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

            for acta in incluidas:
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
def _bloquear_secretaria_reportes(usuario):
    """La secretaria solo puede sacar el reporte de Agenda y el de Clientes
    (de su propia sucursal). El resto de reportes es información de
    administración y no debe poder verlos."""
    if usuario["rol"] == "secretaria":
        raise HTTPException(
            status_code=403,
            detail="Este reporte es solo para el administrador y los mediadores"
        )


@app.get("/reportes/resumen")
def obtener_reporte_resumen(
    fecha_desde: str = None,
    fecha_hasta: str = None,
    ciudad_id: int = None,
    sucursal_id: int = None,
    usuario_id: int = None,
    usuario=Depends(obtener_usuario_actual)
):
    _bloquear_secretaria_reportes(usuario)
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
    _bloquear_secretaria_reportes(usuario)
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
                COUNT(*) FILTER (WHERE (p.finalizado = true AND (NOT COALESCE(p.requiere_acta_firmada, false) OR p.acta_firmada_ruta IS NOT NULL))) AS actas_subidas,
                COUNT(*) FILTER (WHERE (p.finalizado = true AND p.estado = 'cerrado_sin_acuerdo' AND (NOT COALESCE(p.requiere_acta_firmada, false) OR p.acta_firmada_ruta IS NOT NULL))) AS actas_no_acuerdo,
                -- Cerrado con acuerdo pero el acta final + comprobante de
                -- pago todavía no se han subido: para que el admin no
                -- asuma que "cerrado" ya significa "acta lista".
                COUNT(*) FILTER (
                    WHERE (p.estado = 'cerrado_con_acuerdo'
                           OR (p.estado = 'cerrado_sin_acuerdo' AND p.requiere_acta_no_acuerdo))
                      AND NOT (p.finalizado = true AND (NOT COALESCE(p.requiere_acta_firmada, false) OR p.acta_firmada_ruta IS NOT NULL))
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
        filas = cur.fetchall()

        # Reuniones de cada mediador en el mismo rango de fechas (de procesos
        # y también invitaciones rápidas): solo conteos, sin listado.
        if filas:
            q_citas = """
                SELECT usuario_id,
                       COUNT(*) FILTER (WHERE estado = 'realizada') AS reuniones_realizadas,
                       COUNT(*) FILTER (WHERE estado = 'cancelada') AS reuniones_canceladas,
                       COUNT(*) FILTER (WHERE estado = 'no_realizada') AS reuniones_no_asistieron
                FROM citas
                WHERE usuario_id = ANY(%s)
            """
            p_citas = [[f["usuario_id"] for f in filas]]
            if fecha_desde:
                q_citas += " AND fecha >= %s"
                p_citas.append(fecha_desde)
            if fecha_hasta:
                q_citas += " AND fecha <= %s"
                p_citas.append(fecha_hasta)
            q_citas += " GROUP BY usuario_id"
            cur.execute(q_citas, tuple(p_citas))
            por_usuario = {r["usuario_id"]: r for r in cur.fetchall()}
            for f in filas:
                r = por_usuario.get(f["usuario_id"]) or {}
                f["reuniones_realizadas"] = r.get("reuniones_realizadas", 0)
                f["reuniones_canceladas"] = r.get("reuniones_canceladas", 0)
                f["reuniones_no_asistieron"] = r.get("reuniones_no_asistieron", 0)
        return filas

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
    _bloquear_secretaria_reportes(usuario)
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
                COUNT(*) FILTER (WHERE (p.finalizado = true AND (NOT COALESCE(p.requiere_acta_firmada, false) OR p.acta_firmada_ruta IS NOT NULL))) AS actas_subidas,
                COUNT(*) FILTER (WHERE (p.finalizado = true AND p.estado = 'cerrado_sin_acuerdo' AND (NOT COALESCE(p.requiere_acta_firmada, false) OR p.acta_firmada_ruta IS NOT NULL))) AS actas_no_acuerdo,
                COUNT(*) FILTER (
                    WHERE (p.estado = 'cerrado_con_acuerdo'
                           OR (p.estado = 'cerrado_sin_acuerdo' AND p.requiere_acta_no_acuerdo))
                      AND NOT (p.finalizado = true AND (NOT COALESCE(p.requiere_acta_firmada, false) OR p.acta_firmada_ruta IS NOT NULL))
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
                COUNT(DISTINCT p.id) FILTER (WHERE (p.finalizado = true AND (NOT COALESCE(p.requiere_acta_firmada, false) OR p.acta_firmada_ruta IS NOT NULL))) AS actas_subidas,
                COUNT(DISTINCT p.id) FILTER (WHERE (p.finalizado = true AND p.estado = 'cerrado_sin_acuerdo' AND (NOT COALESCE(p.requiere_acta_firmada, false) OR p.acta_firmada_ruta IS NOT NULL))) AS actas_no_acuerdo,
                COUNT(DISTINCT p.id) FILTER (
                    WHERE (p.estado = 'cerrado_con_acuerdo'
                           OR (p.estado = 'cerrado_sin_acuerdo' AND p.requiere_acta_no_acuerdo))
                      AND NOT (p.finalizado = true AND (NOT COALESCE(p.requiere_acta_firmada, false) OR p.acta_firmada_ruta IS NOT NULL))
                ) AS actas_pendientes,
                -- Los códigos concretos, para que salgan también al imprimir
                -- y en el Excel (no solo las cantidades).
                STRING_AGG(DISTINCT p.codigo_proceso, ', ' ORDER BY p.codigo_proceso)
                    FILTER (WHERE p.estado <> 'anulado') AS codigos_procesos,
                STRING_AGG(DISTINCT af.codigo_acta, ', ' ORDER BY af.codigo_acta)
                    FILTER (WHERE (p.finalizado = true AND (NOT COALESCE(p.requiere_acta_firmada, false) OR p.acta_firmada_ruta IS NOT NULL))) AS codigos_actas
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
        if usuario["rol"] == "secretaria":
            # La secretaria ve los clientes de los procesos de su sucursal.
            query += " AND p.sucursal_id = %s"
            params.append(usuario["sucursal_id"])
        elif usuario["rol"] != "administrador":
            query += " AND p.usuario_id = %s"
            params.append(usuario["id"])
        elif usuario_id:
            query += " AND p.usuario_id = %s"
            params.append(usuario_id)

        if sucursal_id and usuario["rol"] != "secretaria":
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
        # Incluye las invitaciones de procesos y también las invitaciones
        # rápidas (sin proceso), que no tienen clientes registrados: sus partes
        # salen de lo que se escribió al crearlas.
        query = """
            SELECT
                c.id, c.proceso_id, c.usuario_id AS mediador_id, c.fecha, c.hora, c.estado, c.tema,
                c.partes_rapidas,
                p.codigo_proceso,
                cd.nombre || ' ' || cd.apellido AS demandante,
                cdd.nombre || ' ' || cdd.apellido AS demandado,
                u.nombre || ' ' || u.apellido AS mediador,
                s.nombre AS sucursal,
                ci.nombre AS ciudad,
                (c.estado IN ('pendiente', 'confirmada')
                 AND (c.fecha + c.hora) < (NOW() AT TIME ZONE 'America/Guayaquil')) AS atrasada
            FROM citas c
            LEFT JOIN procesos_mediacion p ON c.proceso_id = p.id
            LEFT JOIN clientes cd ON c.cliente_demandante_id = cd.id
            LEFT JOIN clientes cdd ON c.cliente_demandado_id = cdd.id
            JOIN usuarios u ON u.id = COALESCE(p.usuario_id, c.usuario_id)
            JOIN sucursales s ON s.id = COALESCE(p.sucursal_id, c.sucursal_id)
            JOIN ciudades ci ON s.ciudad_id = ci.id
            WHERE (c.proceso_id IS NOT NULL OR c.partes_rapidas IS NOT NULL)
        """
        params = []
        if usuario["rol"] == "secretaria":
            # La secretaria ve la agenda de toda su sucursal (no la de otras).
            query += " AND s.id = %s"
            params.append(usuario["sucursal_id"])
            if usuario_id:
                query += " AND u.id = %s"
                params.append(usuario_id)
        elif usuario["rol"] != "administrador":
            query += " AND u.id = %s"
            params.append(usuario["id"])
        elif usuario_id:
            query += " AND u.id = %s"
            params.append(usuario_id)
        if sucursal_id and usuario["rol"] != "secretaria":
            query += " AND s.id = %s"
            params.append(sucursal_id)
        if ciudad_id:
            query += " AND ci.id = %s"
            params.append(ciudad_id)
        if fecha_desde:
            query += " AND c.fecha >= %s"
            params.append(fecha_desde)
        if fecha_hasta:
            query += " AND c.fecha <= %s"
            params.append(fecha_hasta)
        query += " ORDER BY c.fecha ASC, c.hora ASC"
        cur.execute(query, tuple(params))
        filas = cur.fetchall()
        for fila in filas:
            pr = fila.pop("partes_rapidas", None)
            fila["sin_proceso"] = fila["proceso_id"] is None
            if pr and not fila.get("demandante"):
                fila["demandante"], _ = _resumen_lado_rapido(pr.get("solicitantes"))
                fila["demandado"], _ = _resumen_lado_rapido(pr.get("invitados"))
        return filas
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
    _bloquear_secretaria_reportes(usuario)
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
    _bloquear_secretaria_reportes(usuario)
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


@app.get("/reportes/operativos/facturas-pendientes")
def reporte_operativo_facturas_pendientes(
    ciudad_id: int = None,
    sucursal_id: int = None,
    usuario_id: int = None,
    usuario=Depends(obtener_usuario_actual)
):
    _bloquear_secretaria_reportes(usuario)
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        query = """
            SELECT
                p.id, p.codigo_proceso, p.tema, p.acta_firmada_fecha,
                cd.nombre || ' ' || cd.apellido AS demandante,
                cdd.nombre || ' ' || cdd.apellido AS demandado,
                u.nombre || ' ' || u.apellido AS mediador,
                s.nombre AS sucursal,
                ci.nombre AS ciudad,
                FLOOR(EXTRACT(EPOCH FROM (NOW() - p.acta_firmada_fecha)) / 86400)::int AS dias_transcurridos,
                NOT EXISTS (SELECT 1 FROM proceso_facturas f
                             WHERE f.proceso_id = p.id AND f.vigente AND f.tipo = 'cliente') AS falta_cliente,
                NOT EXISTS (SELECT 1 FROM proceso_facturas f
                             WHERE f.proceso_id = p.id AND f.vigente AND f.tipo = 'mediador') AS falta_mediador
            FROM procesos_mediacion p
            JOIN clientes cd ON p.cliente_demandante_id = cd.id
            JOIN clientes cdd ON p.cliente_demandado_id = cdd.id
            JOIN usuarios u ON p.usuario_id = u.id
            JOIN sucursales s ON p.sucursal_id = s.id
            JOIN ciudades ci ON s.ciudad_id = ci.id
            WHERE p.requiere_facturas = true
              AND p.acta_firmada_ruta IS NOT NULL
              AND (
                    NOT EXISTS (SELECT 1 FROM proceso_facturas f
                                 WHERE f.proceso_id = p.id AND f.vigente AND f.tipo = 'cliente')
                 OR NOT EXISTS (SELECT 1 FROM proceso_facturas f
                                 WHERE f.proceso_id = p.id AND f.vigente AND f.tipo = 'mediador')
                  )
        """
        params = []
        query = _filtros_operativos(query, params, usuario, usuario_id, sucursal_id, ciudad_id)
        query += " ORDER BY p.acta_firmada_fecha ASC"
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
                    "agenda", "sin-avance", "actas-pendientes", "facturas-pendientes"]:
        raise HTTPException(status_code=400, detail="Tipo de reporte inválido")
    if usuario["rol"] == "secretaria" and tipo not in ("agenda", "clientes"):
        raise HTTPException(status_code=403, detail="Este reporte es solo para el administrador y los mediadores")

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
                "Suspendido" if f.get("suspendido")
                else ETIQUETAS_ESTADO_REPORTE.get(f.get("estado"), f.get("estado")),
                # Para que "cerrado" no se confunda con "acta lista": el acta
                # solo cuenta cuando ya está subida el acta firmada.
                ("Suspendida" if f.get("etapa_acta") == "suspendido"
                 else "Pendiente" if f.get("etapa_acta") in ("falta_acta", "falta_firmada")
                 else ("Firmada" if f.get("etapa_acta") == "completa" else "—")),
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
            "Total (sin anulados)", "En negociación", "Cerrados con acuerdo",
            "Cerrados sin acuerdo", "Archivados", "Anulados", "Actas de acuerdo", "Actas de no acuerdo",
            "Actas pendientes", "Promedio días de cierre",
            "Reuniones realizadas", "Reuniones canceladas", "No asistieron"
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
                (f.get("actas_subidas") or 0) - (f.get("actas_no_acuerdo") or 0),
                f.get("actas_no_acuerdo") or 0,
                f.get("actas_pendientes"),
                f.get("promedio_dias_cierre") if f.get("promedio_dias_cierre") is not None else "",
                f.get("reuniones_realizadas", 0),
                f.get("reuniones_canceladas", 0),
                f.get("reuniones_no_asistieron", 0)
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
            "Sucursal", "Ciudad", "Total (sin anulados)", "En negociación",
            "Cerrados con acuerdo", "Cerrados sin acuerdo", "Archivados", "Anulados",
            "Actas de acuerdo", "Actas de no acuerdo", "Actas pendientes", "Promedio días de cierre"
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
                (f.get("actas_subidas") or 0) - (f.get("actas_no_acuerdo") or 0),
                f.get("actas_no_acuerdo") or 0,
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
            "Cliente", "Cédula", "Teléfono", "Email", "Total (sin anulados)",
            "En negociación", "Cerrados con acuerdo", "Cerrados sin acuerdo",
            "Archivados", "Anulados", "Actas de acuerdo", "Actas de no acuerdo", "Actas pendientes",
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
                (f.get("actas_subidas") or 0) - (f.get("actas_no_acuerdo") or 0),
                f.get("actas_no_acuerdo") or 0,
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

    elif tipo == "facturas-pendientes":
        filas = reporte_operativo_facturas_pendientes(
            ciudad_id=ciudad_id, sucursal_id=sucursal_id,
            usuario_id=usuario_id, usuario=usuario
        )
        encabezados = ["Proceso", "Solicitante", "Invitado", "Mediador", "Sucursal", "Ciudad",
                       "Acta firmada el", "Días sin facturas",
                       "Falta factura de NUMA al cliente", "Falta factura del mediador a NUMA"]
        filas_excel = [
            [f.get("codigo_proceso"), f.get("demandante"), f.get("demandado"),
             f.get("mediador"), f.get("sucursal"), f.get("ciudad"),
             _fecha_excel_ec(f.get("acta_firmada_fecha")),
             f.get("dias_transcurridos"),
             "Sí" if f.get("falta_cliente") else "No",
             "Sí" if f.get("falta_mediador") else "No"]
            for f in filas
        ]
        nombre_archivo = "reporte_facturas_pendientes_numa.xlsx"

    else:
        filas = obtener_actas_finales(
            q=None, ciudad_id=ciudad_id, sucursal_id=sucursal_id, usuario_id=usuario_id,
            fecha_desde=fecha_desde, fecha_hasta=fecha_hasta, usuario=usuario
        )
        # Solo cuentan como emitidas las actas con el acta firmada subida.
        filas = [f for f in filas
                 if (not f.get("requiere_acta_firmada")) or f.get("tiene_acta_firmada")]

        encabezados = [
            "Código de acta", "Tipo", "Solicitante", "Invitado", "Ciudad",
            "Sucursal", "Mediador", "Fecha de subida",
            "Facturar a", "Identificación", "Dirección", "Correo", "Teléfono"
        ]

        filas_excel = [
            [
                f.get("codigo_acta"),
                "No acuerdo" if f.get("tipo") == "no_acuerdo" else "Acuerdo",
                f.get("demandante"),
                f.get("demandado"),
                f.get("ciudad"),
                f.get("sucursal"),
                f.get("mediador") or f.get("usuario"),
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
        "procesos": "Reporte de procesos",
        "productividad": "Reporte del equipo de mediadores",
        "actas": "Reporte de actas finales",
        "sucursales": "Reporte por sucursales",
        "clientes": "Reporte de clientes",
        "agenda": "Agenda de reuniones",
        "sin-avance": "Procesos sin avance",
        "actas-pendientes": "Actas pendientes de subir",
        "facturas-pendientes": "Facturas pendientes",
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
# FACTURAS Y PAGOS (lista central, solo lectura)
# =========================
# Reúne en una sola lista lo que ya se subió dentro de cada proceso: las dos
# facturas, el comprobante de pago del acta y el comprobante del segundo pago.
# No sube ni borra nada; abrir un archivo usa los endpoints de cada proceso.
TIPOS_FACTURAS_PAGOS = {
    "factura_cliente": "Factura de NUMA al cliente",
    "factura_mediador": "Factura del mediador a NUMA",
    "pago_acta": "Comprobante de pago",
    "pago_final": "Comprobante del segundo pago",
}


def _facturas_pagos_filas(usuario, q=None, tipo=None, usuario_id=None,
                          sucursal_id=None, fecha_desde=None, fecha_hasta=None,
                          cliente_id=None):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT * FROM (
                SELECT 'factura-' || f.id AS clave,
                       'factura_' || f.tipo AS tipo,
                       f.id AS archivo_id, NULL::int AS acta_id,
                       f.proceso_id, f.nombre, f.tamano_bytes,
                       f.fecha_subida AS fecha, NULL::numeric AS monto,
                       f.usuario_id AS subido_por_id
                FROM proceso_facturas f
                WHERE f.vigente = true
                UNION ALL
                SELECT 'acta-' || ap.id, 'pago_acta', ap.id, ap.id,
                       ap.proceso_id, ap.nombre_comprobante_pago,
                       ap.tamano_comprobante_bytes,
                       ap.fecha_subida, NULL::numeric, ap.usuario_id
                FROM actas_proceso ap
                WHERE ap.ruta_comprobante_pago IS NOT NULL
                UNION ALL
                SELECT * FROM (
                    SELECT DISTINCT ON (cx.proceso_id)
                           'abono-' || cx.id, 'pago_final', cx.id, cx.acta_id,
                           cx.proceso_id, cx.nombre, cx.tamano_bytes,
                           cx.fecha_subida, cx.monto, cx.usuario_id
                    FROM comprobantes_pago_extra cx
                    ORDER BY cx.proceso_id, cx.id DESC
                ) ult
            ) t
            JOIN procesos_mediacion p ON p.id = t.proceso_id
            JOIN sucursales s ON s.id = p.sucursal_id
            LEFT JOIN ciudades ci ON ci.id = s.ciudad_id
            JOIN usuarios um ON um.id = p.usuario_id
            LEFT JOIN usuarios us ON us.id = t.subido_por_id
            LEFT JOIN clientes cd ON cd.id = p.cliente_demandante_id
            LEFT JOIN clientes cdd ON cdd.id = p.cliente_demandado_id
            WHERE 1=1
              AND (%s OR p.usuario_id = %s)
              AND (%s::text IS NULL OR t.tipo = %s)
              AND (%s::int IS NULL OR p.usuario_id = %s)
              AND (%s::int IS NULL OR p.sucursal_id = %s)
              AND (%s::int IS NULL OR p.cliente_demandante_id = %s OR p.cliente_demandado_id = %s)
              AND (%s::date IS NULL OR t.fecha::date >= %s::date)
              AND (%s::date IS NULL OR t.fecha::date <= %s::date)
              AND (%s::text IS NULL OR p.codigo_proceso ILIKE %s
                   OR COALESCE(t.nombre, '') ILIKE %s
                   OR (um.nombre || ' ' || um.apellido) ILIKE %s
                   OR EXISTS (SELECT 1 FROM actas_proceso ay WHERE ay.proceso_id = p.id AND ay.codigo_acta ILIKE %s)
                   OR (COALESCE(cd.nombre,'') || ' ' || COALESCE(cd.apellido,'')) ILIKE %s
                   OR (COALESCE(cdd.nombre,'') || ' ' || COALESCE(cdd.apellido,'')) ILIKE %s)
            ORDER BY t.fecha DESC NULLS LAST
            LIMIT 1000
        """.replace(
            "SELECT * FROM (\n                SELECT 'factura-'",
            "SELECT t.clave, t.tipo, t.archivo_id, t.acta_id, t.proceso_id, t.nombre,\n"
            "       t.tamano_bytes, t.fecha, t.monto, p.codigo_proceso,\n"
            "       s.nombre AS sucursal, ci.nombre AS ciudad,\n"
            "       um.nombre || ' ' || um.apellido AS mediador,\n"
            "       us.nombre || ' ' || us.apellido AS subida_por,\n"
            "       (SELECT ax.codigo_acta FROM actas_proceso ax WHERE ax.proceso_id = p.id\n"
            "        ORDER BY ax.id DESC LIMIT 1) AS numero_acta,\n"
            "       TRIM(cd.nombre || ' ' || COALESCE(cd.apellido, '')) AS demandante,\n"
            "       TRIM(cdd.nombre || ' ' || COALESCE(cdd.apellido, '')) AS demandado,\n"
            "       p.monto_total, p.abono1_monto, p.pago_en_abonos\n"
            "FROM (\n                SELECT 'factura-'", 1
        ), (
            usuario["rol"] == "administrador", usuario["id"],
            tipo or None, tipo or None,
            usuario_id, usuario_id,
            sucursal_id, sucursal_id,
            cliente_id, cliente_id, cliente_id,
            fecha_desde or None, fecha_desde or None,
            fecha_hasta or None, fecha_hasta or None,
            (q or None), f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%",
        ))
        filas = cur.fetchall()
        for f in filas:
            f["tipo_etiqueta"] = TIPOS_FACTURAS_PAGOS.get(f["tipo"], f["tipo"])
            # El comprobante del acta es el primer pago: su monto vive en el
            # proceso (abono 1 si se paga en abonos; si no, el total).
            if f["tipo"] == "pago_acta":
                if f.get("pago_en_abonos"):
                    f["tipo_etiqueta"] = "Comprobante del primer pago"
                    f["monto"] = f.get("abono1_monto")
                else:
                    f["monto"] = f.get("monto_total")
        return filas
    finally:
        cur.close()
        conn.close()


@app.get("/facturas-pagos")
def listar_facturas_pagos(
    q: str = None, tipo: str = None, usuario_id: int = None,
    sucursal_id: int = None, fecha_desde: str = None, fecha_hasta: str = None,
    cliente_id: int = None,
    usuario=Depends(obtener_usuario_actual)
):
    if usuario["rol"] not in ("administrador", "mediador"):
        raise HTTPException(status_code=403, detail="No tienes permiso para ver esta lista")
    if tipo and tipo not in TIPOS_FACTURAS_PAGOS:
        raise HTTPException(status_code=400, detail="Tipo inválido")
    return _facturas_pagos_filas(usuario, q, tipo, usuario_id, sucursal_id, fecha_desde, fecha_hasta, cliente_id)


@app.get("/facturas-pagos/faltantes")
def listar_facturas_pagos_faltantes(
    q: str = None, usuario_id: int = None, sucursal_id: int = None,
    usuario=Depends(obtener_usuario_actual)
):
    """Lo que FALTA por subir: facturas (solo en procesos con el acta firmada ya subida),
    el comprobante de pago del acta (hay documentos pero no comprobante) y el comprobante
    del saldo (pago en abonos todavía incompleto). El mediador solo ve sus procesos."""
    if usuario["rol"] not in ("administrador", "mediador"):
        raise HTTPException(status_code=403, detail="No tienes permiso para ver esta lista")
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT * FROM (
                SELECT p.id AS proceso_id, p.codigo_proceso, p.acta_firmada_fecha,
                       s.nombre AS sucursal, ci.nombre AS ciudad,
                       um.nombre || ' ' || um.apellido AS mediador,
                       TRIM(cd.nombre || ' ' || COALESCE(cd.apellido, '')) AS demandante,
                       TRIM(cdd.nombre || ' ' || COALESCE(cdd.apellido, '')) AS demandado,
                       (SELECT ax.codigo_acta FROM actas_proceso ax WHERE ax.proceso_id = p.id
                        ORDER BY ax.id DESC LIMIT 1) AS numero_acta,
                       CASE WHEN p.acta_firmada_fecha IS NULL THEN NULL
                            ELSE FLOOR(EXTRACT(EPOCH FROM (NOW() - p.acta_firmada_fecha)) / 86400)::int
                       END AS dias_desde_acta_firmada,
                       (p.requiere_facturas = true AND p.acta_firmada_ruta IS NOT NULL
                        AND NOT EXISTS (SELECT 1 FROM proceso_facturas f
                                         WHERE f.proceso_id = p.id AND f.vigente AND f.tipo = 'cliente')
                       ) AS falta_factura_cliente,
                       (p.requiere_facturas = true AND p.acta_firmada_ruta IS NOT NULL
                        AND NOT EXISTS (SELECT 1 FROM proceso_facturas f
                                         WHERE f.proceso_id = p.id AND f.vigente AND f.tipo = 'mediador')
                       ) AS falta_factura_mediador,
                       EXISTS (SELECT 1 FROM actas_proceso ap
                                WHERE ap.proceso_id = p.id AND ap.ruta_comprobante_pago IS NULL
                       ) AS falta_comprobante_pago,
                       COALESCE(p.pago_en_abonos AND p.pago_pendiente, false) AS falta_comprobante_saldo
                FROM procesos_mediacion p
                JOIN sucursales s ON s.id = p.sucursal_id
                LEFT JOIN ciudades ci ON ci.id = s.ciudad_id
                JOIN usuarios um ON um.id = p.usuario_id
                LEFT JOIN clientes cd ON cd.id = p.cliente_demandante_id
                LEFT JOIN clientes cdd ON cdd.id = p.cliente_demandado_id
                WHERE p.estado <> 'anulado'
                  AND (%s OR p.usuario_id = %s)
                  AND (%s::int IS NULL OR p.usuario_id = %s)
                  AND (%s::int IS NULL OR p.sucursal_id = %s)
                  AND (%s::text IS NULL OR p.codigo_proceso ILIKE %s
                       OR (um.nombre || ' ' || um.apellido) ILIKE %s
                       OR (COALESCE(cd.nombre,'') || ' ' || COALESCE(cd.apellido,'')) ILIKE %s
                       OR (COALESCE(cdd.nombre,'') || ' ' || COALESCE(cdd.apellido,'')) ILIKE %s)
            ) x
            WHERE x.falta_factura_cliente OR x.falta_factura_mediador
               OR x.falta_comprobante_pago OR x.falta_comprobante_saldo
            ORDER BY x.acta_firmada_fecha ASC NULLS LAST, x.proceso_id DESC
            LIMIT 500
        """, (
            usuario["rol"] == "administrador", usuario["id"],
            usuario_id, usuario_id,
            sucursal_id, sucursal_id,
            (q or None), f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%",
        ))
        filas = cur.fetchall()
        for f in filas:
            faltan = []
            if f["falta_comprobante_pago"]:
                faltan.append("Comprobante de pago")
            if f["falta_comprobante_saldo"]:
                faltan.append("Comprobante del segundo pago (saldo)")
            if f["falta_factura_cliente"]:
                faltan.append("Factura de NUMA al cliente")
            if f["falta_factura_mediador"]:
                faltan.append("Factura del mediador a NUMA")
            f["faltan"] = faltan
        return filas
    finally:
        cur.close()
        conn.close()


@app.get("/facturas-pagos/exportar-excel")
def exportar_facturas_pagos_excel(
    q: str = None, tipo: str = None, usuario_id: int = None,
    sucursal_id: int = None, fecha_desde: str = None, fecha_hasta: str = None,
    usuario=Depends(obtener_usuario_actual)
):
    if usuario["rol"] not in ("administrador", "mediador"):
        raise HTTPException(status_code=403, detail="No tienes permiso para exportar esta lista")
    if tipo and tipo not in TIPOS_FACTURAS_PAGOS:
        raise HTTPException(status_code=400, detail="Tipo inválido")
    filas = _facturas_pagos_filas(usuario, q, tipo, usuario_id, sucursal_id, fecha_desde, fecha_hasta)
    encabezados = ["Proceso", "N.º de acta", "Solicitante", "Invitado", "Mediador",
                   "Sucursal", "Ciudad", "Tipo", "Archivo", "Fecha", "Monto"]
    filas_excel = [
        [f["codigo_proceso"], f.get("numero_acta") or "", f.get("demandante") or "",
         f.get("demandado") or "", f["mediador"], f["sucursal"], f.get("ciudad") or "",
         f["tipo_etiqueta"], f["nombre"] or "", _fecha_excel_ec(f["fecha"]),
         float(f["monto"]) if f.get("monto") is not None else ""]
        for f in filas
    ]
    wb = _excel_con_formato("Facturas y pagos", encabezados, filas_excel)
    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="facturas_y_pagos_numa.xlsx"'}
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
                c.fecha_creacion,
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
        **_sb_auth(SUPABASE_KEY),
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