import os
from mysql.connector import pooling

dbconfig = {
    "host": os.getenv("MYSQL_HOST", "localhost"), "port": int(os.getenv("MYSQL_PORT", "3306")),
    "user": os.getenv("MYSQL_USER"),
    "password": os.getenv("MYSQL_PASSWORD"),
    "database": os.getenv("MYSQL_DATABASE"),
}

from contextlib import contextmanager

pool = pooling.MySQLConnectionPool(pool_name="pladibot_pool", pool_size=10, **dbconfig)

def get_db():
    """Para usar con Depends() de FastAPI — NO tocar, sigue igual."""
    conn = pool.get_connection()
    try:
        yield conn
    finally:
        conn.close()

@contextmanager
def get_db_conn():
    """Para usar en scripts fuera de FastAPI (scrapers, jobs), con 'with'."""
    conn = pool.get_connection()
    try:
        yield conn
    finally:
        conn.close()




        