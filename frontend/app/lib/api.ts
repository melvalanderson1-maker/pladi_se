export const API_BASE = '/api'

export interface DocumentInfo {
  document_id: string
  filename: string
  pages: number
  chunks: number
  was_ocr: boolean
  uploaded_at: string
}

export interface UploadResponse {
  success: boolean
  document_id: string
  filename: string
  pages: number
  chunks_created: number
  was_ocr: boolean
  message: string
}

export interface SourceChunk {
  document_id: string
  filename: string
  page: number
  content: string
  score: number
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: SourceChunk[]
}

const _uploadsInFlight = new Set<string>()

export async function uploadPDF(file: File): Promise<UploadResponse> {
  const key = `${file.name}-${file.size}-${file.lastModified}`

  if (_uploadsInFlight.has(key)) {
    throw new Error('Este archivo ya se está subiendo')
  }
  _uploadsInFlight.add(key)

  try {
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      body: formData,
    })
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Error subiendo el archivo')
    }
    return response.json()
  } finally {
    setTimeout(() => _uploadsInFlight.delete(key), 3000)
  }
}

export async function getDocuments(): Promise<DocumentInfo[]> {
  const response = await fetch(`${API_BASE}/documents`)
  if (!response.ok) throw new Error('Error obteniendo documentos')
  const data = await response.json()
  return data.documents
}

export async function deleteDocument(documentId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/documents/${documentId}`, {
    method: 'DELETE',
  })
  if (!response.ok) throw new Error('Error eliminando documento')
}

export async function* chatStream(
  question: string,
  documentId: string | null,
  conversationHistory: ChatMessage[]
): AsyncGenerator<{
  type: 'token' | 'done' | 'error'
  content?: string
  sources?: SourceChunk[]
}> {
  const history = conversationHistory.map(msg => ({
    role: msg.role,
    content: msg.content,
  }))

  const response = await fetch(`${API_BASE}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question,
      document_id: documentId,
      conversation_history: history,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail || 'Error en el chat')
  }

  if (!response.body) throw new Error('No se recibió stream del servidor')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim()
          if (!jsonStr) continue
          try {
            const event = JSON.parse(jsonStr)
            yield event
          } catch {
            // ignorar líneas mal formateadas
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}




// ─── CONTRATOS SEACE ──────────────────────────────────────────────────────────

export const API_BASE_CONTRATOS = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

async function contratosApiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_CONTRATOS}${path}`)
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText)
    throw new Error(`API ${path} → ${res.status}: ${detail}`)
  }
  return res.json() as Promise<T>
}

export type EstadoContrato = 'vigente' | 'en_evaluacion' | 'culminado' | 'todos'

export interface ContratoResumen {
  id_contrato              : number
  des_contratacion         : string | null
  nom_objeto_contrato      : string | null
  des_objeto_contrato      : string | null
  nom_entidad              : string | null
  nom_estado_contrato      : string | null
  id_estado_contrato       : number | null
  cotizar                  : boolean
  fec_ini_cotizacion       : string | null
  fec_fin_cotizacion       : string | null
  fec_publica              : string | null
  nom_etapa_contratacion   : string | null
  nom_tipo_cotizacion      : string | null
  valor_max_uit            : number | null
  nom_sigla                : string | null
  nom_area_usuaria         : string | null
  num_subsanaciones_total  : number
  nom_estado_cotiza        : string | null
  total_archivos_contrato  : number
  total_archivos_cotizacion: number
  cotizacion_usuario       : string | null
  cotizacion_empresa       : string | null
  cotizacion_estado        : string | null
  cotizacion_fecha         : string | null
}

export interface ContratoDetalle extends ContratoResumen {
  nro_contratacion     : number | null
  nom_sigla_cot        : string | null
  nom_area_usuaria_cot : string | null
  dir_organismo        : string | null
  nom_tipo_invitacion  : string | null
  des_ccmn             : string | null
  des_justif_tip_invit : string | null
  num_consultas        : number
  num_invitaciones     : number
  nom_usu_registro     : string | null
  anio                 : number | null
  updated_at           : string | null
}

export interface ArchivoSeace {
  id_archivo   : number | null
  nombre       : string | null
  tipo         : string | null
  extension    : string | null
  tamanio      : string | null
  url_descarga : string | null
  ruta_local   : string | null
  contexto     : string | null
  bytes        : number
  rag_document_id ?: string | null
}

export interface ItemContrato {
  id_contrato_item  : number | null
  cod_cubso         : string | null
  nom_cubso         : string | null
  nom_moneda        : string | null
  nom_unidad_medida : string | null
  descripcion_item  : string | null
  cantidad          : number | null
  precio_total      : number | null
  nom_distrito      : string | null
  nom_estado_cotiza : string | null
}

export interface ItemCotizacion {
  id_contrato_item  : number | null
  cod_cubso         : string | null
  nom_cubso         : string | null
  nom_moneda        : string | null
  nom_unidad_medida : string | null
  descripcion_item  : string | null
  cantidad          : number | null
  precio_unitario   : number | null
  precio_total      : number | null
}

export interface RtmContrato {
  id_contrato_rtm : number | null
  nombre_rtm      : string | null
  valor           : string | null
}

export interface RtmCotizacion {
  id_contrato_rtm : number | null
  nom_rtm         : string | null
  valor_con_rtm   : string | null
  valor_cot_rtm   : string | null
}

export interface EtapaContrato {
  id_etapa_contrato  : number | null
  nom_etapa_contrato : string | null
  fec_ini            : string | null
  fec_fin            : string | null
}

export interface OfertaCotizacion {
  id_cotizacion    : number | null
  cod_ruc          : string | null
  nom_razon_social : string | null
  precio_oferta    : number | null
  precio_total     : number | null
  plazo_ejecucion  : string | null
  fec_cotiza       : string | null
  nom_estado_cotiza: string | null
  id_cubso         ?: number   // ← AGREGAR
  cod_cubso        ?: string   // ← AGREGAR
}

export interface CotizacionCompleta {
  items   : ItemCotizacion[]
  rtm     : RtmCotizacion[]
  ofertas : OfertaCotizacion[]
  archivos: ArchivoSeace[]
}

export interface StatsContratos {
  total        : number
  vigentes     : number
  en_evaluacion: number
  culminados   : number
  otros        : number
  con_cotizar  : number
}

export interface PaginatedContratos {
  data        : ContratoResumen[]
  total       : number
  page        : number
  page_size   : number
  total_pages : number
}

export async function getStatsContratos(params?: {
  anio?: number
  estado?: string
  resultado?: string
  entidad?: string
  proveedor?: string
  departamento?: string
  provincia?: string
  distrito?: string
  producto?: string
}): Promise<StatsContratos> {
  const sp = new URLSearchParams()
  Object.entries(params ?? {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  })
  const qs = sp.toString()
  return contratosApiFetch<StatsContratos>(`/api/contratos/stats${qs ? `?${qs}` : ''}`)
}

export interface ResultadoCulminadosStat {
  total       : number
  adjudicados : number
  desiertos   : number
}

export async function getStatsResultadoCulminados(): Promise<ResultadoCulminadosStat> {
  return contratosApiFetch<ResultadoCulminadosStat>('/api/contratos/stats/resultado-culminados')
}
export async function getContratos(
  page      = 1,
  page_size = 20,
  estado?   : EstadoContrato,
  q?        : string,
  cotizar?  : boolean,
  anio?     : number,
  objeto?   : number,
  soloMios? : boolean,
  proveedor?: string,
  entidad?  : string,
  descripcion?: string,
  resultado?: 'adjudicado' | 'desierto',
  departamento?: string,
  provincia?   : string,
  distrito?    : string,
): Promise<PaginatedContratos> {
  const params = new URLSearchParams()
  params.set('page',      String(page))
  params.set('page_size', String(page_size))
  if (estado && estado !== 'todos') params.set('estado', estado)
  if (q)                            params.set('q', q)
  if (cotizar !== undefined)        params.set('cotizar', String(cotizar))
  if (anio)                         params.set('anio', String(anio))
  if (objeto)                       params.set('objeto', String(objeto))
  if (soloMios)                     params.set('solo_mios', String(soloMios))
  if (proveedor && proveedor.trim())    params.set('proveedor', proveedor.trim())
  if (entidad && entidad.trim())        params.set('entidad', entidad.trim())
  if (descripcion && descripcion.trim())params.set('descripcion', descripcion.trim())
  if (resultado)                        params.set('resultado', resultado)
  if (departamento && departamento.trim()) params.set('departamento', departamento.trim())
  if (provincia && provincia.trim())       params.set('provincia', provincia.trim())
  if (distrito && distrito.trim())         params.set('distrito', distrito.trim())
  return contratosApiFetch<PaginatedContratos>(`/api/contratos?${params}`)
}

export async function getContrato(id: number): Promise<ContratoDetalle> {
  return contratosApiFetch<ContratoDetalle>(`/api/contratos/${id}`)
}

export async function getArchivosSeace(
  id      : number,
  contexto: 'contrato' | 'cotizacion' | 'todos' = 'todos',
): Promise<ArchivoSeace[]> {
  return contratosApiFetch<ArchivoSeace[]>(`/api/contratos/${id}/archivos?contexto=${contexto}`)
}

export async function getItemsContrato(id: number): Promise<ItemContrato[]> {
  return contratosApiFetch<ItemContrato[]>(`/api/contratos/${id}/items`)
}

export async function getRtmContrato(id: number): Promise<RtmContrato[]> {
  return contratosApiFetch<RtmContrato[]>(`/api/contratos/${id}/rtm`)
}

export async function getEtapasContrato(id: number): Promise<EtapaContrato[]> {
  return contratosApiFetch<EtapaContrato[]>(`/api/contratos/${id}/etapas`)
}

export async function getCotizacion(id: number): Promise<CotizacionCompleta> {
  return contratosApiFetch<CotizacionCompleta>(`/api/contratos/${id}/cotizacion`)
}



/**
 * URL para abrir/descargar un archivo desde ruta_local via backend.
 * Úsala en lugar de url_descarga (que apunta a SEACE y requiere token).
 */
export function getUrlArchivoLocal(id_contrato: number, id_archivo: number): string {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'
  return `${base}/api/contratos/${id_contrato}/archivos/${id_archivo}/descargar`
}

export function getUrlArchivoPreview(idContrato: number, idArchivo: number): string {
  return `${API_BASE}/contratos/${idContrato}/archivos/${idArchivo}/preview`
}




export async function indexarArchivo(idContrato: number, idArchivo: number): Promise<{ document_id: string; chunks: number; already_indexed: boolean }> {
  const res = await fetch(`${API_BASE}/contratos/${idContrato}/archivos/${idArchivo}/indexar`, { method: 'POST' })
  if (!res.ok) throw new Error('Error indexando archivo')
  return res.json()
}





// ─── FILL DOCUMENT ────────────────────────────────────────────────────────────

export interface Empresa {
  id: number
  razon_social: string
  ruc: string
  representante_nombre: string
}

export interface CampoDetectado {
  indice: number
  campo: string
  label: string
  valor_auto: string
  editable: boolean
  contexto: string
}

export interface PreviewFill {
  id_archivo: number
  nombre: string
  extension: string
  campos: CampoDetectado[]
  tiene_campos: boolean
}

export async function getEmpresas(): Promise<Empresa[]> {
  const r = await fetch(`${API_BASE}/empresas`)
  if (!r.ok) throw new Error('Error cargando empresas')
  return r.json()
}

export async function detectarCampos(
  idContrato: number,
  idArchivo: number,
  empresaId: number
): Promise<PreviewFill> {
  const r = await fetch(`${API_BASE}/fill-document`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id_contrato: idContrato,
      id_archivo : idArchivo,
      empresa_id : empresaId,
    }),
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err.detail || 'Error detectando campos')
  }
  return r.json()
}

export async function generarDocumento(
  idContrato: number,
  idArchivo: number,
  empresaId: number,
  valores: Record<string, string>
): Promise<void> {
  const r = await fetch(`${API_BASE}/fill-document/generar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id_contrato: idContrato,
      id_archivo : idArchivo,
      empresa_id : empresaId,
      valores,
    }),
  })
  if (!r.ok) throw new Error('Error generando documento')
  const blob = await r.blob()
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `documento_rellenado.docx`
  a.click()
  URL.revokeObjectURL(url)
}



export type ModuloPermiso = {
  id_modulo: number
  clave: string
  nombre: string
  habilitado: boolean
}
export async function obtenerPermisosUsuario(idUsuario: number, token: string): Promise<ModuloPermiso[]> {
  const res = await fetch(`${API_BASE_CONTRATOS}/api/usuarios/${idUsuario}/permisos`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('No se pudieron obtener los permisos')
  return res.json()
}

export async function guardarPermisosUsuario(
  idUsuario: number,
  permisos: { id_modulo: number; habilitado: boolean }[],
  token: string
) {
  const res = await fetch(`${API_BASE_CONTRATOS}/api/usuarios/${idUsuario}/permisos`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ permisos }),
  })
  if (!res.ok) throw new Error('No se pudieron guardar los permisos')
  return res.json()
}

export async function listarUsuariosAdmin(token: string) {
  const res = await fetch(`${API_BASE_CONTRATOS}/api/usuarios`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('No se pudo listar usuarios')
  return res.json()
}



export interface Rol {
  id: number
  nombre: string
  descripcion: string | null
}

export async function listarRoles(token: string): Promise<Rol[]> {
  const res = await fetch(`${API_BASE_CONTRATOS}/api/usuarios/roles`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('No se pudieron cargar los roles')
  return res.json()
}

export interface UsuarioCrearPayload {
  nombre: string
  correo: string
  password: string
  id_rol: number
  id_empresa?: number | null
}

export async function crearUsuario(datos: UsuarioCrearPayload, token: string): Promise<{ id: number; mensaje: string }> {
  const res = await fetch(`${API_BASE_CONTRATOS}/api/usuarios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(datos),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'No se pudo crear el usuario')
  }
  return res.json()
}

export interface UsuarioActualizarPayload {
  nombre?: string
  id_rol?: number
  id_empresa?: number | null
  activo?: boolean
}

export async function actualizarUsuario(id: number, datos: UsuarioActualizarPayload, token: string): Promise<{ mensaje: string }> {
  const res = await fetch(`${API_BASE_CONTRATOS}/api/usuarios/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(datos),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'No se pudo actualizar el usuario')
  }
  return res.json()
}

export async function eliminarUsuario(id: number, token: string): Promise<{ mensaje: string }> {
  const res = await fetch(`${API_BASE_CONTRATOS}/api/usuarios/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'No se pudo eliminar el usuario')
  }
  return res.json()
}