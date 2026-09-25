from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import os
from dotenv import load_dotenv
import psycopg2
from psycopg2 import pool

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


# 🔥 ESTE ES EL IMPORTANTE
#
# Antes, get_db() abria una conexion NUEVA a la base de datos en cada
# peticion (psycopg2.connect(...)). Como la base de datos vive en Supabase
# (no en esta misma maquina), cada conexion nueva paga el costo completo de
# un viaje de ida y vuelta por internet antes de poder ejecutar cualquier
# consulta.
#
# Ahora se mantiene un "pool" de conexiones ya abiertas y listas para
# reutilizar. Como psycopg2 no deja reemplazar el metodo .close() de una
# conexion real directamente (es de solo lectura), se envuelve la conexion
# en PooledConnection: por fuera se ve y se comporta exactamente igual
# (conn.cursor(), conn.commit(), conn.rollback(), conn.close()), pero
# conn.close() en realidad devuelve la conexion al pool en vez de cerrarla
# de verdad.
_connection_pool = psycopg2.pool.ThreadedConnectionPool(
    minconn=2,
    maxconn=15,
    dsn=DATABASE_URL,
)


class PooledConnection:
    def __init__(self, real_conn):
        self._conn = real_conn

    def close(self):
        try:
            if self._conn.closed:
                # La conexion ya se rompio (ej. se cayo la red); descartala
                # en vez de devolverla al pool para que no dane la siguiente.
                _connection_pool.putconn(self._conn, close=True)
            else:
                # Deshace cualquier transaccion que haya quedado sin
                # confirmar antes de reutilizar la conexion.
                self._conn.rollback()
                _connection_pool.putconn(self._conn)
        except Exception:
            try:
                _connection_pool.putconn(self._conn, close=True)
            except Exception:
                pass

    def __getattr__(self, name):
        # Cualquier otra cosa (cursor, commit, rollback, closed, etc.) se
        # delega tal cual a la conexion real de psycopg2.
        return getattr(self._conn, name)


def get_db():
    real_conn = _connection_pool.getconn()
    return PooledConnection(real_conn)
