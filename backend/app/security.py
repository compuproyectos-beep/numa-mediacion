import os
from datetime import datetime, timedelta
from jose import jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException
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


# 🔥 USUARIO REAL DESDE BD
def obtener_usuario_actual(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("user_id")

        if user_id is None:
            raise HTTPException(status_code=401, detail="Token inválido")

        conn = get_db()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("""
            SELECT id, sucursal_id, nombre, apellido, email, rol
            FROM usuarios
            WHERE id = %s
        """, (user_id,))

        usuario = cur.fetchone()

        cur.close()
        conn.close()

        if usuario is None:
            raise HTTPException(status_code=401, detail="Usuario no encontrado")

        return usuario

    except:
        raise HTTPException(status_code=401, detail="Token inválido")