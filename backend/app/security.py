import os
import re
from datetime import datetime, timedelta
from jose import jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordBearer
from psycopg2.extras import RealDictCursor
from app.database import get_db
from dotenv import load_dotenv

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError(
        "Falta la variable de entorno SECRET_KEY. "
        "Genera una con: python -c \"import secrets; print(secrets.token_hex(32))\" "
        "y agrégala a tu archivo .env (o a las variables de entorno de Railway)."
    )

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")


def verificar_password(password_plano, password_hash):
    return pwd_context.verify(password_plano, password_hash)


def crear_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


# La secretaria solo puede usar la Agenda, los Clientes y el reporte de Clientes. Aquí se listan,
# una por una, las únicas rutas a las que puede llamar; todo lo demás
# (procesos, actas, reportes, usuarios...) se le niega aunque conozca la URL.
_RUTAS_SECRETARIA = [
    ("GET", r"^/me$"),
    ("GET", r"^/notificaciones(/no-leidas|/urgentes)?$"),
    ("PUT", r"^/notificaciones/(\d+/leer|leer-todas)$"),
    ("PUT", r"^/usuarios/cambiar-password$"),
    ("GET", r"^/citas$"),
    ("PUT", r"^/citas/\d+/estado$"),
    ("POST", r"^/citas/rapida$"),
    ("GET", r"^/citas/\d+/invitacion-datos$"),
    ("PUT", r"^/citas/\d+/documento$"),
    ("GET", r"^/clientes$"),
    ("POST", r"^/clientes$"),
    ("PUT", r"^/clientes/\d+$"),
    ("GET", r"^/provincias$"),
    ("GET", r"^/ciudades$"),
    ("GET", r"^/sucursal/mediadores$"),
    ("GET", r"^/reuniones$"),
    # Reportes: solo el de Clientes (de su sucursal) y su descarga en Excel;
    # main.py además rechaza cualquier otro tipo de reporte para ella.
    ("GET", r"^/reportes/clientes$"),
    ("GET", r"^/reportes/exportar-excel$"),
]


def _ruta_permitida_secretaria(metodo: str, ruta: str) -> bool:
    ruta = ruta.rstrip("/") or "/"
    return any(m == metodo and re.match(p, ruta) for m, p in _RUTAS_SECRETARIA)


# 🔥 USUARIO REAL DESDE BD
def obtener_usuario_actual(request: Request, token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("user_id")

        if user_id is None:
            raise HTTPException(status_code=401, detail="Token inválido")

        conn = get_db()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("""
            SELECT id, sucursal_id, nombre, apellido, email, rol, activo
            FROM usuarios
            WHERE id = %s
        """, (user_id,))

        usuario = cur.fetchone()

        cur.close()
        conn.close()

        if usuario is None:
            raise HTTPException(status_code=401, detail="Usuario no encontrado")

    except:
        raise HTTPException(status_code=401, detail="Token inválido")

    # Un usuario suspendido deja de poder usar el sistema de inmediato, aunque
    # su sesión (token) todavía no haya vencido.
    if not usuario["activo"]:
        raise HTTPException(status_code=401, detail="Usuario suspendido")

    if usuario["rol"] == "secretaria" and not _ruta_permitida_secretaria(
        request.method, request.url.path
    ):
        raise HTTPException(
            status_code=403,
            detail="Tu usuario solo puede usar la Agenda, los Clientes y el reporte de Clientes"
        )

    return usuario
