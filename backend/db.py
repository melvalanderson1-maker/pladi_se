import os
from mysql.connector import pooling

dbconfig = {
    "host": os.getenv("MYSQL_HOST", "localhost"), "port": int(os.getenv("MYSQL_PORT", "3306")),
    "user": os.getenv("MYSQL_USER"),
    "password": os.getenv("MYSQL_PASSWORD"),
    "database": os.getenv("MYSQL_DATABASE"),
}

pool = pooling.MySQLConnectionPool(pool_name="pladibot_pool", pool_size=5, **dbconfig)

def get_db():
    conn = pool.get_connection()
    try:
        yield conn
    finally:
        conn.close()




        