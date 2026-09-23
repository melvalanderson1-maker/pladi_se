from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from auth import get_current_user
from db import get_db
from seace_credenciales import fernet

router = APIRouter(prefix="/empresas", tags=["seace-credenciales"])


class VincularSeaceBody(BaseModel):
    usuario: str
    password: str


@router.post("/vincular-seace")
def vincular_seace(
    body: VincularSeaceBody,
    usuario: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    empresa_id = usuario.get("id_empresa")
    if not empresa_id:
        raise HTTPException(status_code=400, detail="Tu usuario no tiene una empresa asignada")

    password_cifrado = fernet.encrypt(body.password.encode())
    cursor = db.cursor()
    cursor.execute(
        """
        INSERT INTO seace_credenciales_empresa (empresa_id, usuario, password_cifrado, activo)
        VALUES (%s, %s, %s, 1)
        ON DUPLICATE KEY UPDATE
            usuario = VALUES(usuario),
            password_cifrado = VALUES(password_cifrado),
            activo = 1
        """,
        (empresa_id, body.usuario, password_cifrado),
    )
    db.commit()
    cursor.close()
    return {"ok": True}


@router.get("/seace/estado")
def estado_seace(usuario: dict = Depends(get_current_user), db=Depends(get_db)):
    empresa_id = usuario.get("id_empresa")
    if not empresa_id:
        return {"vinculada": False, "usuario": None}

    cursor = db.cursor(dictionary=True)
    cursor.execute(
        "SELECT usuario, activo FROM seace_credenciales_empresa WHERE empresa_id = %s",
        (empresa_id,),
    )
    row = cursor.fetchone()
    cursor.close()

    if not row or not row["activo"]:
        return {"vinculada": False, "usuario": None}
    return {"vinculada": True, "usuario": row["usuario"]}