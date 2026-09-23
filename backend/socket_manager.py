# socket_manager.py
import socketio
import jwt
from auth import SECRET_KEY, ALGORITHM

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",   # en producción pon tu dominio del frontend
)

# sid -> id_usuario, para poder limpiar al desconectar
_sesiones_socket: dict[str, int] = {}

# id_usuario -> cantidad de sockets abiertos (pestañas/dispositivos). Un
# usuario puede tener más de un sid; solo se considera "desconectado"
# cuando cierra el ÚLTIMO de sus sockets, no el primero.
_conteo_conexiones: dict[int, int] = {}

def usuarios_en_linea() -> list[int]:
    """IDs de usuarios con al menos un socket activo ahora mismo."""
    return list(_conteo_conexiones.keys())

@sio.event
async def connect(sid, environ, auth):
    """
    El frontend debe conectarse mandando el token así:
      io(URL, { auth: { token: "<jwt>" } })
    """
    token = (auth or {}).get("token")
    if not token:
        return False  # rechaza la conexión

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return False

    id_usuario = int(payload["sub"])
    _sesiones_socket[sid] = id_usuario
    era_offline = _conteo_conexiones.get(id_usuario, 0) == 0
    _conteo_conexiones[id_usuario] = _conteo_conexiones.get(id_usuario, 0) + 1
    await sio.enter_room(sid, f"usuario_{id_usuario}")
    print(f"🔌 Socket conectado: usuario {id_usuario} (sid={sid})")

    # Al recién conectado se le manda la lista completa AHORA MISMO, para
    # que pinte el estado inicial de todos sin esperar al próximo evento.
    await sio.emit("usuarios_online", {"usuarios": usuarios_en_linea()}, room=sid)

    # Si es su primer socket abierto, avisa a TODOS que este usuario
    # pasó a "en línea" (si ya tenía otra pestaña abierta, no se repite).
    if era_offline:
        await sio.emit("usuario_conectado", {"id_usuario": id_usuario})
    return True

@sio.event
async def disconnect(sid):
    id_usuario = _sesiones_socket.pop(sid, None)
    if id_usuario is None:
        return
    print(f"🔌 Socket desconectado: usuario {id_usuario}")

    restantes = _conteo_conexiones.get(id_usuario, 1) - 1
    if restantes <= 0:
        _conteo_conexiones.pop(id_usuario, None)
        await sio.emit("usuario_desconectado", {"id_usuario": id_usuario})
    else:
        _conteo_conexiones[id_usuario] = restantes


async def notificar_permisos_actualizados(id_usuario: int):
    """Llamar esto justo después de guardar permisos en BD."""
    await sio.emit("permisos_actualizados", {}, room=f"usuario_{id_usuario}")


async def notificar_cotizacion(nombre_usuario: str, id_contrato: int, accion: str, empresa: str | None = None):
    """Llamar después de guardar borrador o enviar cotización. Broadcast a todos los conectados."""
    await sio.emit("cotizacion_notificacion", {
        "usuario": nombre_usuario,
        "id_contrato": id_contrato,
        "mensaje": f"{nombre_usuario} {accion} el contrato {id_contrato}",
        "empresa": empresa,
    })


async def notificar_carrito(nombre_usuario: str, id_contrato: int, accion: str):
    """
    accion: 'agregado' o 'quitado'.
    Broadcast a todos los conectados para que el frontend pinte en vivo
    el badge "también en el carrito de: <usuario>" sobre el ContractCard.
    """
    await sio.emit("carrito_actualizado", {
        "usuario": nombre_usuario,
        "id_contrato": id_contrato,
        "accion": accion,
    })


async def notificar_resultado_ganado(
    id_contrato: int,
    razon_social: str,
    des_contratacion: str | None = None,
    nom_entidad: str | None = None,
):
    """
    Llamar cuando el scraper detecta que un contrato acaba de pasar a
    Culminado y una de NUESTRAS empresas (RUC propio) quedó como
    ADJUDICADO en cotizacion_ofertas. Broadcast a todos los conectados
    para que el frontend muestre la alerta de contrato ganado.
    """
    await sio.emit("contrato_ganado", {
        "id_contrato": id_contrato,
        "razon_social": razon_social,
        "des_contratacion": des_contratacion,
        "nom_entidad": nom_entidad,
        "mensaje": f"Contrato ganado: {razon_social} fue adjudicado en {des_contratacion or f'#{id_contrato}'}",
    })


@sio.event
async def solicitar_usuarios_online(sid, data=None):
    """
    El frontend llama esto al montar cualquier pantalla que necesite
    saber quién está en línea AHORA MISMO — cubre el caso en que el
    socket ya estaba conectado desde antes (por ejemplo, la app lo abrió
    en otra pantalla) y por eso esa pantalla se perdió el evento inicial
    'usuarios_online' que solo se manda en el momento exacto del connect.
    """
    await sio.emit("usuarios_online", {"usuarios": usuarios_en_linea()}, room=sid)