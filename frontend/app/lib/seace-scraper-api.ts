// lib/seace-scraper-api.ts
//
// Cliente para los endpoints nuevos: iniciar/consultar el scraper en
// vivo y traer los KPIs por objeto de contratación. Se deja SEPARADO
// de tu lib/seace-api.ts existente para no tocar lo que ya tienes ahí
// (no conozco el contenido exacto de ese archivo) — solo importa estas
// funciones donde las necesites.
//
// Ajusta BASE_URL si tu backend usa otra variable de entorno o ruta
// base distinta a la que ya usa getProcesosVigentes().

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export type EstadoJob = 'en_cola' | 'corriendo' | 'completado' | 'error'

export interface ScraperJob {
  job_id: string
  estado: EstadoJob
  anio: string | null
  modalidad_actual: string | null
  modalidad_indice: number
  modalidad_total: number
  pagina_actual: number
  filas_procesadas: number
  mensaje: string | null
  error: string | null
  iniciado_en: string
  actualizado_en: string
  finalizado_en: string | null
}

export interface KpiCategoria {
  categoria: string
  total: number
  monto_total: number
}

export interface KpisSeace {
  total: number
  monto_total: number
  por_categoria: KpiCategoria[]
}

export interface ProgresoModalidad {
  modalidad: string
  pagina_actual: number
  paginas_totales: number | null
  filas_procesadas: number
  filas_totales: number | null
  estado: string
  actualizado_en: string
}

export async function iniciarScraperLive(anio: string): Promise<{ job_id: string; ya_estaba_corriendo: boolean }> {
  const res = await fetch(`${BASE_URL}/api/seace/scraper/iniciar?anio=${encodeURIComponent(anio)}`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error('No se pudo iniciar el scraper en vivo del SEACE.')
  return res.json()
}

export async function getEstadoScraper(jobId: string): Promise<ScraperJob> {
  const res = await fetch(`${BASE_URL}/api/seace/scraper/estado/${jobId}`)
  if (!res.ok) throw new Error('No se pudo consultar el estado del scraper.')
  return res.json()
}

export async function getProgresoScraper(jobId: string): Promise<{ modalidades: ProgresoModalidad[] }> {
  const res = await fetch(`${BASE_URL}/api/seace/scraper/progreso/${jobId}`)
  if (!res.ok) throw new Error('No se pudo consultar el progreso del scraper.')
  return res.json()
}

export async function getUltimoJobScraper(): Promise<ScraperJob | null> {
  const res = await fetch(`${BASE_URL}/api/seace/scraper/ultimo`)
  if (!res.ok) return null
  const data = await res.json()
  return data && data.job_id ? data : null
}

export async function getKpisSeace(estado: string = 'vigente'): Promise<KpisSeace> {
  const res = await fetch(`${BASE_URL}/api/seace/kpis?estado=${encodeURIComponent(estado)}`)
  if (!res.ok) throw new Error('No se pudo cargar los KPIs de SEACE.')
  return res.json()
}


export interface KpisEstados {
  vigente: number
  con_resultado: number
  vencido_sin_resultado: number
  total: number
}

export async function getKpisEstados(): Promise<KpisEstados> {
  const res = await fetch(`${BASE_URL}/api/seace/kpis-estados`)
  if (!res.ok) throw new Error('No se pudo cargar los KPIs por estado.')
  return res.json()
}