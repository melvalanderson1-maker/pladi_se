const SCRAPER = process.env.NEXT_PUBLIC_SCRAPER_URL || 'http://localhost:4000'

export interface ItemCotizacionDetalle {
  idContratoItem: number
  idCubso: number
  codCubso: string
  nomCubso: string
  nomMoneda: string
  nomUnidadMedida: string
  descripcionItem: string
  cantidad: number
  idCotizacionItem: number | null
  precioUnitario: number | null
  precioTotal: number | null
}

export interface RtmCotizacionDetalle {
  idContratoRtm: number
  nomRtm: string
  valorConRtm: string | null
  idContratoRtmValor: number
  tipoProceso: string
  idCotizacionRtm: number | null
  valorCotRtm: string | null
}

export interface ArchivoCotizacionDetalle {
  idContratoArchivo: number
  nomTipoArchivo: string
  nombreArchivo: string
  desExtension: string
  tamanio: string
  idCotizacionArchivo: number | null
  nombreArchivoCot: string | null
  desExtensionCot: string | null
  tamanioCot: string | null
}

export interface DetalleCotizacionResponse {
  detalle_cotizacion: {
    idTipoCotizacion: number
    uitCotizacionCompletaProjection: {
      idCotizacion: number
      idContratoInvita: number
      idEstadoCotiza: number
      nomEstadoCotiza: string
      fecVigencia: string
      nomCorreo: string
      numCelular: string
      precioTotal: number | null
    } | null
    uitContratoItemCotizacionProjectionList: ItemCotizacionDetalle[]
    uitContratoRtmCotizacionProjectionList: RtmCotizacionDetalle[]
    contratoArchivoCotizacionProjectionList: ArchivoCotizacionDetalle[]
  }
  datos_contrato: {
    nomEntidad: string
    nomSigla: string
    nomAreaUsuaria: string
    nroDescripcion: string
    desObjetoContrato: string
    fecFinCotizacion: string
    valorMaxUit: number
  }
}

export async function obtenerDetalleCotizacion(idContrato: number, token: string, idCotizacion?: number) {
  const url = new URL(`${SCRAPER}/cotizaciones/detalle/${idContrato}`)
  if (idCotizacion) url.searchParams.set('id_cotizacion', String(idCotizacion))

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30000)

  let res: Response
  try {
    res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (e: any) {
    if (e.name === 'AbortError') {
      throw new Error('El servidor de extracción no respondió en 30 segundos. Verifica que esté corriendo en el puerto 4000.')
    }
    throw new Error('No se pudo conectar al servidor de extracción (puerto 4000). ¿Está corriendo?')
  } finally {
    clearTimeout(timeoutId)
  }

  if (!res.ok) {
    let mensaje = 'No se pudo obtener el detalle de cotización'
    try {
      const data = await res.json()
      if (data.error) mensaje = data.error
    } catch {}
    throw new Error(mensaje)
  }
  return res.json() as Promise<DetalleCotizacionResponse>
}

export interface ItemPayload {
  idContratoItem: number
  precioUnitario: number
  precioTotal: number
  idCotizacionItem?: number | null
}

export interface RtmPayload {
  idContratoRtmValor: number
  tipoProceso: string
  valor: string
  idCotizacionRtm?: number | null
}

export async function guardarBorrador(payload: {
  idCotizacion?: number | null   
  idContrato: number
  idContratoInvita?: number | null
  fecVigencia: string
  nomCorreo: string
  numCelular: string
  precioTotal: number
  items: ItemPayload[]
  rtm: RtmPayload[]
}, token: string) {
  const res = await fetch(`${SCRAPER}/cotizaciones/guardar-borrador`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'No se pudo guardar el borrador')
  return data as { idCotizacion: number; mensaje: string }
}
export async function subirArchivoCotizacion(idCotizacion: number, idContratoArchivo: number, idContrato: number, file: File, token: string) {
  const form = new FormData()
  form.append('file', file)
  const url = new URL(`${SCRAPER}/cotizaciones/subir-archivo`)
  url.searchParams.set('id_cotizacion', String(idCotizacion))
  url.searchParams.set('id_contrato_archivo', String(idContratoArchivo))
  url.searchParams.set('id_contrato', String(idContrato))
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'No se pudo subir el archivo')
  return data as { idCotizacionArchivo: number; idCotizacion: number }
}

export function urlDescargarFormato(idArchivo: number) {
  return `${SCRAPER}/cotizaciones/descargar-formato/${idArchivo}`
}

export async function eliminarArchivoCotizacion(idCotizacionArchivo: number, token: string) {
  const res = await fetch(`${SCRAPER}/cotizaciones/eliminar-archivo/${idCotizacionArchivo}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  let data: any = {}
  try { data = await res.json() } catch {}
  if (!res.ok) throw new Error(data.error || 'No se pudo eliminar el archivo')
  return data
}
export async function enviarCotizacion(idCotizacion: number, idContrato: number, token: string) {
  const res = await fetch(`${SCRAPER}/cotizaciones/enviar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ idCotizacion, idContrato }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'No se pudo enviar la cotización')
  return data
}


export interface PostulacionItem {
  id_registro: number
  id_contrato: number
  id_cotizacion_seace: number | null
  estado_cotizacion: 'borrador' | 'enviada'
  fecha_cotizado: string | null
  empresa_usada: string
  des_contratacion: string | null
  des_objeto_contrato: string | null
  nom_entidad: string | null
  id_estado_contrato: number | null
  total_archivos: number
  resultado_proceso: 'ganado' | 'adjudicado_otro' | 'desierto' | 'culminado' | null
}
export async function obtenerMisPostulaciones(token: string) {
  const res = await fetch(`${SCRAPER}/cotizaciones/mis-postulaciones`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'No se pudo cargar tus postulaciones')
  return data as { postulaciones: PostulacionItem[] }
}

export interface ItemCarrito {
  id_contrato: number
  des_contratacion: string | null
  des_objeto_contrato: string | null
  nom_entidad: string | null
  nom_sigla: string | null
  nom_area_usuaria: string | null
  valor_max_uit: number | null
  id_estado_contrato: number | null
  fec_ini_cotizacion: string | null
  fec_fin_cotizacion: string | null
  nom_objeto_contrato: string | null
  cotizar: boolean
  fecha_agregado: string
}



export async function obtenerCarrito(token: string) {
  const res = await fetch(`${SCRAPER}/cotizaciones/carrito`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'No se pudo cargar el carrito')
  return data as { carrito: ItemCarrito[] }
}

export async function agregarAlCarrito(idContrato: number, token: string) {
  const res = await fetch(`${SCRAPER}/cotizaciones/carrito/${idContrato}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'No se pudo agregar al carrito')
  return data
}



export async function quitarDelCarrito(idContrato: number, token: string) {
  const res = await fetch(`${SCRAPER}/cotizaciones/carrito/${idContrato}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'No se pudo quitar del carrito')
  return data
}


export async function autorellenarArchivoCotizacion(
  idArchivo: number,
  idCotizacion: number,
  idContrato: number,
  token: string,
) {
  const res = await fetch(
    `${SCRAPER}/cotizaciones/autorellenar/${idArchivo}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ idCotizacion, idContrato }),
    }
  )
  if (!res.ok) throw new Error('No se pudo rellenar el documento con IA')
  return res.json() as Promise<{ idContratoArchivo: number; rutaRelleno: string; fuente: string; campos_rellenados: number }>
}