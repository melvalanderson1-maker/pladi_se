// ══════════════════════════════════════════════════════════════════════════
// Agrega estos tipos y funciones a tu lib/api.ts existente (junto a
// getStatsContratos y getContratos). Usan el mismo patrón: ajusta
// `API_BASE` / la función fetch base si tu archivo usa un nombre distinto.
// ══════════════════════════════════════════════════════════════════════════

const API_BASE_CONTRATOS = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'


export interface FiltrosStats {
  anio?: number
  estado?: string
  resultado?: string
  objeto?: number
  entidad?: string
  proveedor?: string
  departamento?: string
  provincia?: string
  distrito?: string
  producto?: string
}

function buildQuery(params: Record<string, any>) {
  const qs = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '' && v !== 'todos') qs.set(k, String(v))
  })
  const s = qs.toString()
  return s ? `?${s}` : ''
}

export interface OpcionesFiltro {
  entidades: string[]; proveedores: string[]; productos: string[]
  distritos: string[]; provincias: string[]; departamentos: string[]
}

export async function getOpcionesFiltro(): Promise<OpcionesFiltro> {
  const res = await fetch(`${API_BASE_CONTRATOS}/api/contratos/filtros/opciones`)
  if (!res.ok) throw new Error('Error al obtener opciones de filtro')
  return res.json()
}


export async function getProvinciasPorDepartamento(departamento: string): Promise<string[]> {
  const res = await fetch(`${API_BASE_CONTRATOS}/api/contratos/filtros/provincias?departamento=${encodeURIComponent(departamento)}`)
  return res.json()
}

export async function getDistritosPorProvincia(departamento: string, provincia?: string): Promise<string[]> {
  const qs = new URLSearchParams({ departamento, ...(provincia ? { provincia } : {}) })
  const res = await fetch(`${API_BASE_CONTRATOS}/api/contratos/filtros/distritos?${qs}`)
  return res.json()
}

export interface EntidadStat {
  nom_entidad: string
  total: number
  vigentes: number
  en_evaluacion: number
  culminados: number
}

export interface GeografiaStat {
  nom_distrito: string
  total: number
}

export interface ProductoStat {
  nom_cubso: string
  total: number
  cantidad_total: number
}

export interface TimelineStat {
  periodo: string
  total: number
}

export interface ObjetoStat {
  nom_objeto_contrato: string
  total: number
}

export async function getStatsEntidades(params?: FiltrosStats & { limit?: number }): Promise<EntidadStat[]> {
  const res = await fetch(`${API_BASE_CONTRATOS}/api/contratos/stats/entidades${buildQuery(params ?? {})}`)
  if (!res.ok) throw new Error('Error al obtener estadísticas de entidades')
  return res.json()
}
export async function getStatsGeografia(params?: FiltrosStats & { limit?: number }): Promise<GeografiaStat[]> {
  const res = await fetch(`${API_BASE_CONTRATOS}/api/contratos/stats/geografia${buildQuery(params ?? {})}`)
  if (!res.ok) throw new Error('Error al obtener estadísticas geográficas')
  return res.json()
}

export async function getStatsProductos(params?: FiltrosStats & { limit?: number; solo_adjudicados?: boolean }): Promise<ProductoStat[]> {
  const res = await fetch(`${API_BASE_CONTRATOS}/api/contratos/stats/productos${buildQuery(params ?? {})}`)
  if (!res.ok) throw new Error('Error al obtener estadísticas de productos')
  return res.json()
}

export async function getStatsTimeline(params?: FiltrosStats): Promise<TimelineStat[]> {
  const res = await fetch(`${API_BASE_CONTRATOS}/api/contratos/stats/timeline${buildQuery(params ?? {})}`)
  if (!res.ok) throw new Error('Error al obtener línea de tiempo')
  return res.json()
}

export async function getStatsObjeto(params?: FiltrosStats): Promise<ObjetoStat[]> {
  const res = await fetch(`${API_BASE_CONTRATOS}/api/contratos/stats/objeto${buildQuery(params ?? {})}`)
  if (!res.ok) throw new Error('Error al obtener distribución por objeto')
  return res.json()
}


export async function buscarEntidades(q: string): Promise<string[]> {
  if (q.trim().length < 2) return []
  const res = await fetch(`${API_BASE_CONTRATOS}/api/contratos/filtros/entidades?q=${encodeURIComponent(q)}`)
  return res.ok ? res.json() : []
}
export async function buscarProveedores(q: string): Promise<string[]> {
  if (q.trim().length < 2) return []
  const res = await fetch(`${API_BASE_CONTRATOS}/api/contratos/filtros/proveedores?q=${encodeURIComponent(q)}`)
  return res.ok ? res.json() : []
}
export async function buscarProductos(q: string): Promise<string[]> {
  if (q.trim().length < 2) return []
  const res = await fetch(`${API_BASE_CONTRATOS}/api/contratos/filtros/productos?q=${encodeURIComponent(q)}`)
  return res.ok ? res.json() : []
}


export interface ProveedorStat {
  proveedor: string
  total: number
  adjudicados: number
  desiertos: number
}

export async function getStatsProveedores(params?: FiltrosStats & { limit?: number }): Promise<ProveedorStat[]> {
  const res = await fetch(`${API_BASE_CONTRATOS}/api/contratos/stats/proveedores${buildQuery(params ?? {})}`)
  if (!res.ok) throw new Error('Error al obtener ranking de proveedores')
  return res.json()
}