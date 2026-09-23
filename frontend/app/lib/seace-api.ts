import { API_BASE } from './api'

const SEACE_API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export interface ProcesoSeace {
  ocid: string
  tender_id: string
  nomenclatura: string | null
  titulo: string
  entidad: string
  region: string | null
  departamento: string | null
  distrito: string | null
  modalidad: string
  categoria: string
  fecha_convocatoria: string | null
  fecha_fin_consultas: string | null
  monto: number | null
  tiene_indicio_desierto: boolean
  published_date: string | null
  scraped_at: string | null
  origen?: 'api' | 'scraper' | null
  estado?: 'vigente' | 'con_resultado' | 'vencido_sin_resultado' | null
}
export interface ProcesosVigentesResponse {
  total: number
  items: ProcesoSeace[]
}

export async function getProcesosVigentes(params?: {
  modalidad?: string
  categoria?: string
  estado?: string
  q?: string
  entidad?: string
  region?: string
  departamento?: string
  distrito?: string
  monto_min?: number
  monto_max?: number
  solo_desierto?: boolean
  orden?: 'reciente' | 'urgencia' | 'monto_desc' | 'monto_asc' | 'recien_extraido'
  limit?: number
  offset?: number
}): Promise<ProcesosVigentesResponse> {
  const query = new URLSearchParams()
  if (params?.modalidad) query.set('modalidad', params.modalidad)
  if (params?.categoria) query.set('categoria', params.categoria)
  if (params?.estado) query.set('estado', params.estado)
  if (params?.q) query.set('q', params.q)
  if (params?.entidad) query.set('entidad', params.entidad)
  if (params?.region) query.set('region', params.region)
  if (params?.departamento) query.set('departamento', params.departamento)
  if (params?.distrito) query.set('distrito', params.distrito)
  if (params?.monto_min !== undefined) query.set('monto_min', String(params.monto_min))
  if (params?.monto_max !== undefined) query.set('monto_max', String(params.monto_max))
  if (params?.solo_desierto) query.set('solo_desierto', 'true')
  if (params?.orden) query.set('orden', params.orden)
  if (params?.limit) query.set('limit', String(params.limit))
  if (params?.offset) query.set('offset', String(params.offset))

  const qs = query.toString()
  const response = await fetch(
    `${SEACE_API_BASE}/api/seace/vigentes${qs ? `?${qs}` : ''}`
  )
  if (!response.ok) throw new Error('Error obteniendo convocatorias del SEACE')
  return response.json()
}

export async function getDetalleProceso(ocid: string): Promise<ProcesoSeace> {
  const response = await fetch(`${SEACE_API_BASE}/api/seace/${ocid}`)
  if (!response.ok) throw new Error('Error obteniendo detalle del proceso')
  return response.json()
}

export interface DetalleFichaScraper {
  tipo_compra_seleccion: string | null
  normativa_aplicable: string | null
  entidad_convocante: string | null
  direccion_legal: string | null
  pagina_web: string | null
  telefono_entidad: string | null
  monto_derecho_participacion: string | null
  fecha_hora_publicacion_detalle: string | null
  descripcion_objeto_completa: string | null
}

export interface DocumentoScraper {
  nro: string
  etapa: string
  documento: string
  archivo: string
  fecha_publicacion: string
  ruta_local?: string | null
}

export function urlDocumento(ocid: string, nro: string) {
  return `${SEACE_API_BASE}/api/seace/documento/${encodeURIComponent(ocid)}/${encodeURIComponent(nro)}`
}

export interface DetalleCompleto {
  tender?: {
    title?: string
    description?: string
    procurementMethodDetails?: string
    tenderPeriod?: { startDate?: string; endDate?: string }
    enquiryPeriod?: { startDate?: string; endDate?: string }
    documents?: { id: string; title: string; url: string; format: string; documentType: string }[]
    items?: { id: string; description: string; quantity: number; unit?: { name: string } }[]
  }
  buyer?: { name?: string }
  parties?: { address?: { streetAddress?: string; locality?: string; region?: string }; contactPoint?: { telephone?: string } }[]
  awards?: any[]
  contracts?: any[]
  // datos que vienen de seace_detalle_ficha / seace_documentos cuando origen = 'scraper'
  detalle_ficha?: DetalleFichaScraper | null
  documentos_scraper?: DocumentoScraper[]
  error?: string
}

export async function getDetalleCompleto(ocid: string): Promise<DetalleCompleto> {
  const response = await fetch(
    `${SEACE_API_BASE}/api/seace/detalle-completo/${encodeURIComponent(ocid)}`
  )

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText)
    throw new Error(
      `Error obteniendo detalle completo: ${response.status} ${detail}`
    )
  }

  return response.json()
}



export interface CronogramaFase {
  etapa: string
  fecha_inicio: string | null
  fecha_fin: string | null
  es_etapa_actual: boolean
}

export async function getCronograma(
  tenderId: string
): Promise<{ tender_id: string; fases: CronogramaFase[] }> {
  const response = await fetch(
    `${SEACE_API_BASE}/api/seace/cronograma/${encodeURIComponent(tenderId)}`
  )
  if (!response.ok) throw new Error('Error obteniendo cronograma')
  return response.json()
}


export interface Adjudicacion {
  ocid: string
  proveedor: string | null
  proveedor_ruc: string | null
  monto: number | null
  moneda: string | null
  fecha_adjudicacion: string | null
  estado_award: string | null
}

export async function getAdjudicacion(ocid: string): Promise<Adjudicacion | null> {
  const response = await fetch(
    `${SEACE_API_BASE}/api/seace/${encodeURIComponent(ocid)}/adjudicacion`
  )
  if (response.status === 404) return null
  if (!response.ok) throw new Error('Error obteniendo adjudicación')
  return response.json()
}


export interface Comparable {
  ocid: string
  nomenclatura: string | null
  entidad: string | null
  descripcion: string | null
  proveedor: string | null
  proveedor_ruc: string | null
  precio_unitario: number | null
  cantidad: number | null
  unidad: string | null
  fecha_adjudicacion: string | null
}

export async function getComparables(ocid: string): Promise<{ comparables: Comparable[] }> {
  const response = await fetch(`${SEACE_API_BASE}/api/seace/${encodeURIComponent(ocid)}/comparables`)
  if (!response.ok) return { comparables: [] }
  return response.json()
}


export interface UbicacionesSeace {
  regiones: string[]
  departamentos: string[]
  distritos: string[]
}

export async function getUbicaciones(): Promise<UbicacionesSeace> {
  const response = await fetch(`${SEACE_API_BASE}/api/seace/ubicaciones`)
  if (!response.ok) return { regiones: [], departamentos: [], distritos: [] }
  return response.json()
}


export interface PostorItem {
  nro: string
  descripcion: string
  cantidad_solicitada: string
  vr_ve_cuantia: string
  cantidad_ofertada: string
  monto_ofertado: string
}

export interface DocumentoPostor {
  nombre: string
  ruta_local: string
}

export interface Postor {
  ruc: string | null
  razon_social: string | null
  consorcio: string | null
  estado_propuesta: string | null
  estado_registro: string | null
  mype: string | null
  monto_total: number
  items: PostorItem[]
  documentos: DocumentoPostor[]
}

export interface PostoresResponse {
  ocid: string
  estado: 'pendiente' | 'en_progreso' | 'listo' | 'error' | 'sin_ofertas'
  postores: Postor[]
  error?: string | null
  paso?: string | null
  total_postores?: number | null
  postor_actual?: number | null
  actualizado_en?: string | null
}

export async function getPostores(ocid: string, nomenclatura: string): Promise<PostoresResponse> {
  const qs = new URLSearchParams({ nomenclatura })
  const response = await fetch(`${SEACE_API_BASE}/api/seace/${encodeURIComponent(ocid)}/postores?${qs}`)
  if (!response.ok) throw new Error('Error obteniendo postores')
  return response.json()
}

export async function refrescarPostores(ocid: string, nomenclatura: string): Promise<PostoresResponse> {
  const qs = new URLSearchParams({ nomenclatura })
  const response = await fetch(`${SEACE_API_BASE}/api/seace/${encodeURIComponent(ocid)}/postores/refrescar?${qs}`, {
    method: 'POST',
  })
  if (!response.ok) throw new Error('Error iniciando scraping de postores')
  return response.json()
}

export function urlDocumentoPostor(ocid: string, ruc: string, nombre: string) {
  return `${SEACE_API_BASE}/api/seace/documento-postor/${encodeURIComponent(ocid)}/${encodeURIComponent(ruc)}/${encodeURIComponent(nombre)}`
}