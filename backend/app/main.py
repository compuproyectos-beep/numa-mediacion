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
from openpyxl.styles import Font
import secrets
from app.email_utils import enviar_correo, plantilla_base

from app.database import get_db
from app.security import obtener_usuario_actual, crear_token




# =========================
# GENERAR RECORDATORIOS
# =========================
def generar_recordatorios_citas():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("""
            SELECT
                ct.id,
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
              AND ct.fecha IN (CURRENT_DATE, CURRENT_DATE + INTERVAL '1 day')
        """)

        citas = cur.fetchall()

        for cita in citas:
            if str(cita["fecha"]) == str(datetime.date.today()):
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
                cur.execute("""
                    SELECT id
                    FROM notificaciones
                    WHERE usuario_id = %s
                      AND referencia_tipo = 'cita_recordatorio'
                      AND referencia_id = %s
                      AND titulo = %s
                """, (
                    usuario_id,
                    cita["id"],
                    titulo
                ))

                existe = cur.fetchone()

                if existe:
                    continue

                crear_notificacion(
                    cur,
                    usuario_id,
                    titulo,
                    mensaje,
                    "recordatorio",
                    "cita_recordatorio",
                    cita["id"]
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
# PROGRAMADOR DE RECORDATORIOS
# =========================
# Se registra UNA sola vez, cuando arranca la aplicación (no cada vez que
# corre generar_recordatorios_citas, que era el bug anterior: eso creaba un
# programador nuevo -y lo volvía a registrar- cada vez que se ejecutaba).
_scheduler = BackgroundScheduler()


@app.on_event("startup")
def iniciar_scheduler():
    if not _scheduler.get_jobs():
        _scheduler.add_job(
            generar_recordatorios_citas,
            "cron",
            hour=8,
            minute=0,
        )
        _scheduler.start()


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
            raise HTTPException(status_code=401, detail="Usuario no encontrado")

        if not user["activo"]:
            raise HTTPException(status_code=401, detail="Usuario inactivo")

        if not pwd_context.verify(password, user["password_hash"]):
            _registrar_intento_fallido(username)
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
                u.nombre || ' ' || u.apellido AS usuario
            FROM actas_proceso ap
            JOIN procesos_mediacion p ON ap.proceso_id = p.id
            JOIN clientes cd ON p.cliente_demandante_id = cd.id
            JOIN clientes cdd ON p.cliente_demandado_id = cdd.id
            JOIN sucursales s ON p.sucursal_id = s.id
            JOIN ciudades ci ON s.ciudad_id = ci.id
            JOIN usuarios u ON ap.usuario_id = u.id
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

@app.put("/clientes/{id}")
def actualizar_cliente(
    id: int,
    cedula: str,
    nombre: str,
    apellido: str,
    telefono: str = None,
    email: str = None,
    ciudad_id: int = None,
    direccion: str = None,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        if not validar_cedula_ecuatoriana(cedula):
            raise HTTPException(status_code=400, detail="Cédula ecuatoriana inválida")

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

        cur.execute("""
            SELECT id
            FROM clientes
            WHERE cedula = %s AND id <> %s
        """, (cedula, id))

        if cur.fetchone():
            raise HTTPException(status_code=400, detail="Ya existe otro cliente con esa cédula")

        cur.execute("""
            UPDATE clientes
            SET
                cedula = %s,
                nombre = %s,
                apellido = %s,
                telefono = %s,
                email = %s,
                ciudad_id = %s,
                direccion = %s,
                fecha_modificacion = NOW()
            WHERE id = %s
            RETURNING id, cedula, nombre, apellido, telefono, email,
                      ciudad_id, direccion, fecha_creacion, fecha_modificacion
        """, (
            cedula,
            nombre,
            apellido,
            telefono,
            email,
            ciudad_id,
            direccion,
            id
        ))

        cliente = cur.fetchone()

        if not cliente:
            raise HTTPException(status_code=404, detail="Cliente no encontrado")

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
    cedula: str,
    nombre: str,
    apellido: str,
    telefono: str = None,
    email: str = None,
    ciudad_id: int = None,
    direccion: str = None,
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        if not validar_cedula_ecuatoriana(cedula):
            raise HTTPException(status_code=400, detail="Cédula ecuatoriana inválida")

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

        cur.execute("SELECT id FROM clientes WHERE cedula = %s", (cedula,))
        if cur.fetchone():
            raise HTTPException(status_code=400, detail="Ya existe un cliente con esa cédula")

        cur.execute("""
            INSERT INTO clientes (
                cedula, nombre, apellido, telefono, email,
                ciudad_id, direccion,
                fecha_creacion, fecha_modificacion
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
            RETURNING id, cedula, nombre, apellido, telefono, email,
                      ciudad_id, direccion, fecha_creacion, fecha_modificacion
        """, (
            cedula,
            nombre,
            apellido,
            telefono,
            email,
            ciudad_id,
            direccion
        ))

        cliente = cur.fetchone()
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

        cur.execute("SELECT id FROM usuarios WHERE id = %s", (id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Usuario no encontrado")

        cur.execute("SELECT id FROM usuarios WHERE email = %s AND id != %s", (email, id))
        if cur.fetchone():
            raise HTTPException(status_code=400, detail="Ya existe otro usuario con ese email")

        cur.execute("SELECT id FROM usuarios WHERE cedula = %s AND id != %s", (cedula, id))
        if cur.fetchone():
            raise HTTPException(status_code=400, detail="Ya existe otro usuario con esa cédula")

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
                c.cliente_demandante_id,
                c.cliente_demandado_id,
                c.sucursal_id,
                c.usuario_id,
                c.fecha,
                c.hora,
                c.tema,
                c.observaciones,
                c.estado,
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
    usuario=Depends(obtener_usuario_actual)
):
    estados_validos = ["pendiente", "confirmada", "realizada", "cancelada"]

    if estado not in estados_validos:
        raise HTTPException(status_code=400, detail="Estado de invitación inválido")

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
                fecha_modificacion = NOW()
            WHERE id = %s
            RETURNING *
        """, (estado, cita_id))

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
            ORDER BY c.nombre ASC, s.nombre ASC
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
    usuario=Depends(obtener_usuario_actual)
):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
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

        if usuario["rol"] != "administrador":
            sucursal_id = usuario["sucursal_id"]

        if not sucursal_id:
            raise HTTPException(
                status_code=400,
                detail="Sucursal obligatoria"
            )

        cur.execute("""
            SELECT COUNT(*) AS total
            FROM procesos_mediacion
        """)

        secuencial = cur.fetchone()["total"] + 1
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
                cd.nombre || ' ' || cd.apellido AS demandante,
                cd.cedula AS demandante_cedula,
                cdd.nombre || ' ' || cdd.apellido AS demandado,
                cdd.cedula AS demandado_cedula,
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
                    cdd.cedula ILIKE %s
                )
            """
            like = f"%{q}%"
            params.extend([like] * 8)

        if ciudad_id and usuario["rol"] == "administrador":
                query += " AND ci.id = %s"
                params.append(ciudad_id)

        if fecha_desde:
                query += " AND DATE(p.fecha_creacion) >= %s"
                params.append(fecha_desde)

        if fecha_hasta:
                query += " AND DATE(p.fecha_creacion) <= %s"
                params.append(fecha_hasta)

        query += " ORDER BY p.id DESC"

        cur.execute(query, tuple(params))
        return cur.fetchall()

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
                id,
                fecha,
                hora,
                tema,
                estado,
                observaciones,
                fecha_creacion
            FROM citas
            WHERE proceso_id = %s
            ORDER BY id ASC
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

        try:
            fecha_hora_cita = datetime.datetime.strptime(
                f"{fecha} {hora}", "%Y-%m-%d %H:%M"
            )
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="Fecha u hora inválida"
            )

        if fecha_hora_cita < datetime.datetime.now():
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
                    fecha,
                    hora,
                    tema,
                    observaciones,
                    estado,
                    fecha_creacion,
                    fecha_modificacion
                )
                VALUES (
                    %s,%s,%s,%s,%s,%s,%s,%s,%s,
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
                "cita",
                cita["id"]
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


# =========================
# AVANCES POR PROCESO
# =========================

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

        cur.execute("""
            SELECT *
            FROM procesos_mediacion
            WHERE id = %s
        """, (proceso_id,))

        proceso = cur.fetchone()

        if not proceso:
            raise HTTPException(status_code=404, detail="Proceso no encontrado")

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

        # Marcar invitación como realizada
        cur.execute("""
            UPDATE citas
            SET
                estado = 'realizada',
                fecha_modificacion = NOW()
            WHERE id = %s
        """, (cita_id,))

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
                        fecha,
                        hora,
                        tema,
                        observaciones,
                        estado,
                        fecha_creacion,
                        fecha_modificacion
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'pendiente', NOW(), NOW())
                    RETURNING id
                """, (
                    proceso_id,
                    proceso["cliente_demandante_id"],
                    proceso["cliente_demandado_id"],
                    proceso["sucursal_id"],
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
            # Desde aquí empieza a correr el plazo de 48 horas para subir
            # el acta final + comprobante de pago de este proceso.
            cur.execute("""
                UPDATE procesos_mediacion
                SET
                    estado = %s,
                    fecha_acuerdo = NOW(),
                    fecha_modificacion = NOW()
                WHERE id = %s
            """, (
                resultado,
                proceso_id
            ))
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
                p.fecha_acuerdo,
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

        if proceso["estado"] != "cerrado_con_acuerdo":
            raise HTTPException(
                status_code=400,
                detail="Solo se puede subir acta final cuando el proceso está cerrado con acuerdo"
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

        # Bloqueo de 48 horas: si este mediador tiene OTRO proceso en
        # 'acuerdo' esperando su acta final + comprobante, no puede subir
        # la de este (salvo que sea justo la del proceso pendiente) hasta
        # que la suba o pasen las 48 horas desde que se marcó 'acuerdo'.
        #
        # Importante: solo cuenta como "bloqueante" un proceso que pasó a
        # 'acuerdo' ANTES que este (fecha_acuerdo < la de este proceso). Sin
        # este filtro, si el mediador tenía dos procesos pendientes a la vez
        # (por ejemplo el 12 y el 13), el sistema podía bloquear el intento
        # de subir el MÁS ANTIGUO de los dos (el que en realidad debía subir
        # primero) señalando al otro como bloqueante, simplemente porque
        # "id != proceso_id" no distinguía cuál era más viejo.
        if usuario["rol"] != "administrador":
            cur.execute("""
                SELECT id, codigo_proceso, fecha_acuerdo
                FROM procesos_mediacion
                WHERE usuario_id = %s
                  AND id != %s
                  AND estado = 'cerrado_con_acuerdo'
                  AND finalizado = false
                  AND fecha_acuerdo IS NOT NULL
                  AND fecha_acuerdo > NOW() - INTERVAL '48 hours'
                  AND fecha_acuerdo < %s
                ORDER BY fecha_acuerdo ASC
                LIMIT 1
            """, (usuario["id"], proceso_id, proceso["fecha_acuerdo"]))

            bloqueante = cur.fetchone()

            if bloqueante:
                fecha_limite = bloqueante["fecha_acuerdo"] + datetime.timedelta(hours=48)
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Tienes el proceso {bloqueante['codigo_proceso']} pendiente de "
                        f"subir su acta final y comprobante de pago (plazo de 48 horas). "
                        f"No puedes subir actas de otros procesos hasta subir esa, o hasta "
                        f"el {fecha_limite.strftime('%d/%m/%Y %H:%M')}."
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

        extension_comprobante = {
            "application/pdf": "pdf",
            "image/jpeg": "jpg",
            "image/jpg": "jpg",
            "image/png": "png",
        }[comprobante_pago.content_type]

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
            ruta_comprobante, contenido_comprobante, comprobante_pago.content_type
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
            VALUES (%s, %s, 'acuerdo', %s, %s, %s, %s, %s, %s, %s, NOW())
            RETURNING id
        """, (
            proceso_id,
            codigo_acta,
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
                fecha_modificacion = NOW()
            WHERE id = %s
        """, (
            acta_final["id"],
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
                f"Se subió el acta final {codigo_acta} ({proceso['ciudad']} - {proceso['sucursal']}), con comprobante de pago",
                "acta",
                "acta_proceso",
                acta_final["id"]
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
            query += " AND DATE(ap.fecha_subida) >= %s"
            params.append(fecha_desde)

        if fecha_hasta:
            query += " AND DATE(ap.fecha_subida) <= %s"
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

        if (
            usuario["rol"] != "administrador"
            and acta["usuario_id"] != usuario["id"]
        ):
            raise HTTPException(
                status_code=403,
                detail="No puedes ver el historial de esta acta"
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
            query += " AND DATE(ap.fecha_subida) >= %s"
            params.append(fecha_desde)

        if fecha_hasta:
            query += " AND DATE(ap.fecha_subida) <= %s"
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
                    str(acta.get("fecha_subida") or ""),
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
                av.resultado,
                av.observacion AS avance_observacion,
                av.proxima_fecha,
                av.proxima_hora,
                av.fecha_creacion AS fecha_avance,
                u.nombre || ' ' || u.apellido AS usuario_avance
            FROM citas c
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