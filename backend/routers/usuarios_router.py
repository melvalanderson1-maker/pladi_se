from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from auth import requiere_rol, hash_password
from db import get_db

router = APIRouter(prefix="/api/usuarios", tags=["usuarios"])

class UsuarioCrear(BaseModel):
    nombre: str
    correo: str
    password: str
    id_rol: int
    id_empresa: Optional[int] = None

class UsuarioActualizar(BaseModel):
    nombre: Optional[str] = None
    id_rol: Optional[int] = None
    id_empresa: Optional[int] = None
    activo: Optional[bool] = None

@router.get("")
def listar_usuarios(admin: dict = Depends(requiere_rol("admin")), db = Depends(get_db)):
    cursor = db.cursor(dictionary=True)
    cursor.execute(
        """
        SELECT u.id, u.nombre, u.correo, u.activo, u.id_empresa, r.nombre AS rol, e.razon_social AS empresa
        FROM usuarios u
        JOIN roles r ON r.id = u.id_rol
        LEFT JOIN empresas e ON e.id = u.id_empresa
        ORDER BY u.nombre
        """
    )
    data = cursor.fetchall()
    cursor.close()
    return data

@router.get("/roles")
def listar_roles(admin: dict = Depends(requiere_rol("admin")), db = Depends(get_db)):
    cursor = db.cursor(dictionary=True)
    cursor.execute("SELECT id, nombre, descripcion FROM roles")
    data = cursor.fetchall()
    cursor.close()
    return data

@router.post("")
def crear_usuario(datos: UsuarioCrear, admin: dict = Depends(requiere_rol("admin")), db = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute(
        "INSERT INTO usuarios (nombre, correo, password_hash, id_rol, id_empresa) VALUES (%s, %s, %s, %s, %s)",
        (datos.nombre, datos.correo, hash_password(datos.password), datos.id_rol, datos.id_empresa)
    )
    db.commit()
    nuevo_id = cursor.lastrowid
    cursor.close()
    return {"id": nuevo_id, "mensaje": "Usuario creado correctamente"}

@router.put("/{id_usuario}")
async def actualizar_usuario(id_usuario: int, datos: UsuarioActualizar, admin: dict = Depends(requiere_rol("admin")), db = Depends(get_db)):
    campos, valores = [], []
    for campo, valor in datos.dict(exclude_unset=True).items():
        campos.append(f"{campo} = %s")
        valores.append(valor)
    if not campos:
        raise HTTPException(status_code=400, detail="Nada que actualizar")
    valores.append(id_usuario)
    cursor = db.cursor()
    cursor.execute(f"UPDATE usuarios SET {', '.join(campos)} WHERE id = %s", valores)
    db.commit()
    cursor.close()

    from socket_manager import notificar_permisos_actualizados
    await notificar_permisos_actualizados(id_usuario)

    return {"mensaje": "Usuario actualizado correctamente"}

@router.delete("/{id_usuario}")
async def desactivar_usuario(id_usuario: int, admin: dict = Depends(requiere_rol("admin")), db = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute("UPDATE usuarios SET activo = 0 WHERE id = %s", (id_usuario,))
    db.commit()
    cursor.close()

    from socket_manager import sio
    await sio.emit("cuenta_desactivada", {}, room=f"usuario_{id_usuario}")

    return {"mensaje": "Usuario desactivado"}



# ─── PERMISOS POR MÓDULO (específico por usuario) ────────────────────────────

@router.get("/{id_usuario}/permisos")
def obtener_permisos_usuario(id_usuario: int, admin: dict = Depends(requiere_rol("admin")), db = Depends(get_db)):
    cursor = db.cursor(dictionary=True)
    # Trae TODOS los módulos existentes, con el estado real para este usuario:
    # si hay override en usuario_modulo_permiso, manda ese valor (prende o
    # apaga sin importar el rol); si no hay override, cae al default del rol.
    cursor.execute(
        """
        SELECT m.id AS id_modulo, m.clave, m.nombre,
               COALESCE(
                   ump.habilitado,
                   (rm.id_modulo IS NOT NULL)
               ) AS habilitado
        FROM modulos m
        LEFT JOIN usuario_modulo_permiso ump
               ON ump.id_modulo = m.id AND ump.id_usuario = %s
        LEFT JOIN roles r
               ON r.id = (SELECT id_rol FROM usuarios WHERE id = %s)
        LEFT JOIN rol_modulo rm
               ON rm.id_modulo = m.id AND rm.id_rol = r.id
        ORDER BY m.nombre
        """,
        (id_usuario, id_usuario)
    )
    data = cursor.fetchall()
    cursor.close()
    return data


class PermisoModulo(BaseModel):
    id_modulo: int
    habilitado: bool

class ActualizarPermisosRequest(BaseModel):
    permisos: List[PermisoModulo]

@router.put("/{id_usuario}/permisos")
async def actualizar_permisos_usuario(id_usuario: int, datos: ActualizarPermisosRequest,
                                       admin: dict = Depends(requiere_rol("admin")), db = Depends(get_db)):
    cursor = db.cursor()
    for p in datos.permisos:
        cursor.execute(
            """
            INSERT INTO usuario_modulo_permiso (id_usuario, id_modulo, habilitado)
            VALUES (%s, %s, %s)
            ON DUPLICATE KEY UPDATE habilitado = VALUES(habilitado)
            """,
            (id_usuario, p.id_modulo, 1 if p.habilitado else 0)
        )
    db.commit()
    cursor.close()

    from socket_manager import notificar_permisos_actualizados
    print(f"📤 Emitiendo permisos_actualizados para usuario {id_usuario}")
    await notificar_permisos_actualizados(id_usuario)
    print(f"📤 Emit terminado")

    return {"mensaje": "Permisos actualizados correctamente"}


# ─── EMPRESAS PARA COTIZAR (N:N, un usuario puede cotizar en varias) ─────────

@router.get("/{id_usuario}/empresas")
def obtener_empresas_usuario(id_usuario: int, admin: dict = Depends(requiere_rol("admin")), db = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute(
        "SELECT id_empresa FROM usuario_empresa WHERE id_usuario = %s",
        (id_usuario,)
    )
    ids = [row[0] for row in cursor.fetchall()]
    cursor.close()
    return ids


class EmpresasUsuarioRequest(BaseModel):
    ids_empresas: List[int]

@router.put("/{id_usuario}/empresas")
def actualizar_empresas_usuario(id_usuario: int, datos: EmpresasUsuarioRequest,
                                 admin: dict = Depends(requiere_rol("admin")), db = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute("DELETE FROM usuario_empresa WHERE id_usuario = %s", (id_usuario,))
    for id_empresa in datos.ids_empresas:
        cursor.execute(
            "INSERT INTO usuario_empresa (id_usuario, id_empresa) VALUES (%s, %s)",
            (id_usuario, id_empresa)
        )
    db.commit()
    cursor.close()
    return {"mensaje": "Empresas actualizadas correctamente"}