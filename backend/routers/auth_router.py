from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from auth import verificar_password, crear_token, get_current_user
from db import get_db

router = APIRouter(prefix="/auth", tags=["auth"])

class LoginRequest(BaseModel):
    correo: str
    password: str

@router.post("/login")
def login(datos: LoginRequest, db = Depends(get_db)):
    cursor = db.cursor(dictionary=True)
    cursor.execute(
        """
        SELECT u.id, u.nombre, u.correo, u.password_hash, u.id_empresa, u.activo,
               r.nombre AS rol
        FROM usuarios u
        JOIN roles r ON r.id = u.id_rol
        WHERE u.correo = %s
        """,
        (datos.correo,)
    )
    usuario = cursor.fetchone()
    cursor.close()

    if not usuario or not usuario["activo"] or not verificar_password(datos.password, usuario["password_hash"]):
        raise HTTPException(status_code=401, detail="Correo o contraseña incorrectos")

    token = crear_token({
        "sub": str(usuario["id"]), "nombre": usuario["nombre"], "correo": usuario["correo"],
        "rol": usuario["rol"], "id_empresa": usuario["id_empresa"],
    })
    return {"token": token, "usuario": {
        "id": usuario["id"], "nombre": usuario["nombre"], "correo": usuario["correo"],
        "rol": usuario["rol"], "id_empresa": usuario["id_empresa"],
    }}

@router.get("/me")
def me(usuario: dict = Depends(get_current_user)):
    return usuario

@router.get("/modulos")
def modulos_permitidos(usuario: dict = Depends(get_current_user), db = Depends(get_db)):
    cursor = db.cursor(dictionary=True)
    cursor.execute(
        """
        SELECT m.id, m.clave, m.nombre, m.ruta, m.listo,
               ump.habilitado AS override,
               (rm.id_modulo IS NOT NULL) AS en_rol
        FROM modulos m
        LEFT JOIN usuario_modulo_permiso ump
               ON ump.id_modulo = m.id AND ump.id_usuario = %s
        LEFT JOIN roles r ON r.nombre = %s
        LEFT JOIN rol_modulo rm
               ON rm.id_modulo = m.id AND rm.id_rol = r.id
        """,
        (int(usuario["sub"]), usuario["rol"])
    )
    filas = cursor.fetchall()
    cursor.close()
    # Regla: si hay un permiso explícito por usuario (override), manda ese
    # valor sin importar el rol. Si no hay override, cae al default del rol.
    resultado = [
        {"clave": f["clave"], "nombre": f["nombre"], "ruta": f["ruta"], "listo": bool(f["listo"])}
        for f in filas
        if (f["override"] if f["override"] is not None else f["en_rol"]) == 1
    ]
    return resultado