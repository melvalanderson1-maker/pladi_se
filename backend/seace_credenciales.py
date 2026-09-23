"""
seace_credenciales.py
Cifrado/descifrado (Fernet) y CRUD de credenciales SEACE por empresa.
Cada empresa vincula su propia cuenta SEACE; el scraper las usa una por una.
"""
import os
from cryptography.fernet import Fernet
from mysql.connector import pooling
from dotenv import load_dotenv

load_dotenv()

_key = os.getenv("SEACE_CRED_KEY")
if not _key:
    raise RuntimeError("Falta SEACE_CRED_KEY en el .env (genera una con Fernet.generate_key())")
fernet = Fernet(_key.encode())

dbconfig = {
    "host": os.getenv("MYSQL_HOST", "localhost"), "port": int(os.getenv("MYSQL_PORT", "3306")),
    "user": os.getenv("MYSQL_USER"),
    "password": os.getenv("MYSQL_PASSWORD"),
    "database": os.getenv("MYSQL_DATABASE"),
}
pool = pooling.MySQLConnectionPool(pool_name="seace_cred_pool", pool_size=3, **dbconfig)


def get_conn():
    return pool.get_connection()


def guardar_credencial(empresa_id: int, usuario: str, password: str):
    password_cifrado = fernet.encrypt(password.encode())
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO seace_credenciales_empresa (empresa_id, usuario, password_cifrado, activo)
        VALUES (%s, %s, %s, 1)
        ON DUPLICATE KEY UPDATE
            usuario = VALUES(usuario),
            password_cifrado = VALUES(password_cifrado),
            activo = 1
        """,
        (empresa_id, usuario, password_cifrado),
    )
    conn.commit()
    cur.close()
    conn.close()


def listar_credenciales_activas() -> list[dict]:
    conn = get_conn()
    cur = conn.cursor(dictionary=True)
    cur.execute(
        "SELECT empresa_id, usuario, password_cifrado FROM seace_credenciales_empresa WHERE activo = 1"
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()
    for r in rows:
        r["password"] = fernet.decrypt(r["password_cifrado"]).decode()
        del r["password_cifrado"]
    return rows