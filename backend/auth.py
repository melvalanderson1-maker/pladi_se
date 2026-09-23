import os
import bcrypt
import jwt
from datetime import datetime, timedelta
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from db import get_db

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "cambia-esto-en-tu-.env")
ALGORITHM = "HS256"
EXPIRA_MINUTOS = 60 * 12  # 12 horas de sesión

security = HTTPBearer()

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verificar_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))

def crear_token(data: dict) -> str:
    to_encode = data.copy()
    to_encode.update({"exp": datetime.utcnow() + timedelta(minutes=EXPIRA_MINUTOS)})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db = Depends(get_db),
) -> dict:
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sesión expirada, vuelve a iniciar sesión")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")

    # El rol y la empresa se leen SIEMPRE de la BD (no del token), para que
    # un cambio de rol hecho por el admin se refleje en la siguiente
    # petición, sin que el usuario tenga que volver a loguearse.
    cursor = db.cursor(dictionary=True)
    cursor.execute(
        """
        SELECT u.id, u.nombre, u.correo, u.id_empresa, u.activo,
               r.nombre AS rol
        FROM usuarios u
        JOIN roles r ON r.id = u.id_rol
        WHERE u.id = %s
        """,
        (int(payload["sub"]),)
    )
    usuario_db = cursor.fetchone()
    cursor.close()

    if not usuario_db or not usuario_db["activo"]:
        raise HTTPException(status_code=401, detail="Usuario inactivo o no encontrado, vuelve a iniciar sesión")

    return {
        "sub": str(usuario_db["id"]),
        "nombre": usuario_db["nombre"],
        "correo": usuario_db["correo"],
        "rol": usuario_db["rol"],
        "id_empresa": usuario_db["id_empresa"],
    }

def requiere_rol(*roles_permitidos: str):
    def verificador(usuario: dict = Depends(get_current_user)) -> dict:
        if usuario.get("rol") not in roles_permitidos:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tienes permiso para realizar esta acción")
        return usuario
    return verificador



def requiere_modulo(clave_modulo: str):
    def verificador(usuario: dict = Depends(get_current_user), db = Depends(get_db)) -> dict:
        if usuario.get("rol") == "admin":
            return usuario  # admin siempre tiene acceso a todo, sin excepción
        cursor = db.cursor(dictionary=True)
        cursor.execute(
            """
            SELECT COALESCE(ump.habilitado, 1) AS habilitado
            FROM modulos m
            LEFT JOIN usuario_modulo_permiso ump
                   ON ump.id_modulo = m.id AND ump.id_usuario = %s
            WHERE m.clave = %s
            """,
            (int(usuario["sub"]), clave_modulo)
        )
        row = cursor.fetchone()
        cursor.close()
        if not row or row["habilitado"] != 1:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"No tienes el permiso '{clave_modulo}' habilitado"
            )
        return usuario
    return verificador