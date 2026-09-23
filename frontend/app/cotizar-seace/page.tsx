'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  Search, X, RotateCcw, ChevronLeft, ChevronRight as ChevronRightIcon, ChevronDown,
  Table2, LayoutGrid, Building2, Eye, Download, Star, History, RadioTower,
  Package, Briefcase, HardHat, ClipboardCheck,
} from 'lucide-react'
import { SidebarTrigger } from '@/components/Sidebar'
import { getProcesosVigentes, getUbicaciones, type ProcesoSeace, type UbicacionesSeace } from '@/lib/seace-api'
import { iniciarScraperLive, getKpisSeace, getKpisEstados, type KpisSeace, type KpisEstados } from '@/lib/seace-scraper-api'
import ContratoSeaceCard from '@/components/ContratoSeaceCard'
import DetalleProcesoDrawer from '@/components/DetalleProcesoDrawer'
import VincularSeace from '@/components/VincularSeace'
import ScraperLiveLoader from '@/components/ScraperLiveLoader'

const MODALIDADES = [
  'Licitación Pública',
  'Licitación Pública Abreviada',
  'Concurso Público Abreviado',
  'Concurso Público de Servicios',
  'Concurso Público para Consultoría',
  'Subasta Inversa Electrónica',
  'Comparación de Precios',
  'Adjudicación Selectiva',
  'Adjudicación Simplificada',
  'Regímen Especial',
  'Contratación Internacional',
  'Convenio',
]

// Verifica los valores reales guardados en `categoria` en tu BD y ajusta si difiere.
const CATEGORIAS = [
  { value: 'goods', label: 'Bien', icon: Package },
  { value: 'services', label: 'Servicio', icon: Briefcase },
  { value: 'works', label: 'Obra', icon: HardHat },
  { value: 'consultoriadeobra', label: 'Consultoría de obra', icon: ClipboardCheck },
]

const ESTADOS = [
  { value: '', label: 'Todos' },
  { value: 'vigente', label: 'Vigentes' },
  { value: 'con_resultado', label: 'Con resultado' },
  { value: 'vencido_sin_resultado', label: 'Vencidos' },
]

const ORDENES = [
  { value: 'reciente', label: 'Más reciente' },
  { value: 'recien_extraido', label: 'Recién extraído' },
  { value: 'urgencia', label: 'Urgencia' },
  { value: 'monto_desc', label: 'Monto ↓' },
  { value: 'monto_asc', label: 'Monto ↑' },
] as const

const TAMANOS_PAGINA = [10, 20, 32, 50]

function SkeletonCard() {
  return (
    <div className="relative flex flex-col gap-2.5 overflow-hidden rounded-lg border border-blue-100 bg-white py-3.5 pl-4 pr-3.5">
      <div className="absolute inset-y-0 left-0 w-1 bg-blue-50" />
      <div className="flex items-center justify-between">
        <div className="h-3 w-20 animate-pulse rounded bg-blue-50" />
        <div className="h-4 w-14 animate-pulse rounded-full bg-blue-50" />
      </div>
      <div className="h-3.5 w-full animate-pulse rounded bg-blue-50" />
      <div className="h-3.5 w-2/3 animate-pulse rounded bg-blue-50" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-blue-50" />
      <div className="flex justify-between border-t border-blue-50 pt-2.5">
        <div className="h-3 w-1/3 animate-pulse rounded bg-blue-50" />
        <div className="h-3 w-1/4 animate-pulse rounded bg-blue-50" />
      </div>
    </div>
  )
}

function SkeletonRow() {
  return (
    <tr className="border-t border-slate-100">
      {Array.from({ length: 6 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-3 w-full max-w-[140px] animate-pulse rounded bg-slate-100" />
        </td>
      ))}
    </tr>
  )
}

function badgeEstado(estado: string | null | undefined) {
  const key = estado ?? ''
  const map: Record<string, string> = {
    vigente: 'bg-emerald-50 text-emerald-600',
    con_resultado: 'bg-blue-50 text-blue-600',
    vencido_sin_resultado: 'bg-rose-50 text-rose-500',
  }
  const label: Record<string, string> = {
    vigente: 'Vigente',
    con_resultado: 'Culminado',
    vencido_sin_resultado: 'Vencido',
  }
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium ${map[key] || 'bg-slate-100 text-slate-500'}`}>
      {label[key] || key || '—'}
    </span>
  )
}

function etiquetaCategoria(categoria: string | null | undefined) {
  const key = (categoria || '').toLowerCase()
  const map: Record<string, string> = {
    goods: 'Bien',
    bien: 'Bien',
    bienes: 'Bien',
    services: 'Servicio',
    servicio: 'Servicio',
    servicios: 'Servicio',
    works: 'Obra',
    obra: 'Obra',
    obras: 'Obra',
    consultoriadeobra: 'Consultoría de obra',
  }
  return map[key] || '—'
}

function tiempoRelativo(fecha: string | null) {
  if (!fecha) return '—'
  const d = new Date(fecha)
  if (Number.isNaN(d.getTime())) return '—'
  const segundos = Math.floor((Date.now() - d.getTime()) / 1000)
  if (segundos < 60) return `hace ${segundos} segundos`
  const minutos = Math.floor(segundos / 60)
  if (minutos < 60) return `hace ${minutos} minuto${minutos === 1 ? '' : 's'}`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `hace ${horas} hora${horas === 1 ? '' : 's'}`
  const dias = Math.floor(horas / 24)
  return `hace ${dias} día${dias === 1 ? '' : 's'}`
}

function generarPaginasVisibles(actual: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const paginas: (number | '...')[] = [1]
  if (actual > 3) paginas.push('...')
  for (let p = Math.max(2, actual - 1); p <= Math.min(total - 1, actual + 1); p++) paginas.push(p)
  if (actual < total - 2) paginas.push('...')
  paginas.push(total)
  return paginas
}

export default function CotizarSeacePage() {
  const [items, setItems] = useState<ProcesoSeace[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selectedOcid, setSelectedOcid] = useState<string | null>(null)
  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [vista, setVista] = useState<'tabla' | 'cuadricula'>('tabla')
  const [mostrarGeo, setMostrarGeo] = useState(false)

  const [q, setQ] = useState('')
  const [entidadFiltro, setEntidadFiltro] = useState('')
  const [estado, setEstado] = useState('')
  const [modalidad, setModalidad] = useState('')
  const [categoria, setCategoria] = useState('')
  const [montoMin, setMontoMin] = useState('')
  const [montoMax, setMontoMax] = useState('')
  const [region, setRegion] = useState('')
  const [departamento, setDepartamento] = useState('')
  const [distrito, setDistrito] = useState('')
  const [ubicaciones, setUbicaciones] = useState<UbicacionesSeace>({ regiones: [], departamentos: [], distritos: [] })
  const [orden, setOrden] = useState<(typeof ORDENES)[number]['value']>('reciente')
  const [soloDesierto, setSoloDesierto] = useState(false)

  // Favoritos: solo en memoria por ahora — no persiste al recargar.
  // TODO: cuando exista endpoint de favoritos, reemplazar este estado
  // por una carga inicial + POST/DELETE contra el backend.
  const [favoritos, setFavoritos] = useState<Set<string>>(new Set())

  const [kpis, setKpis] = useState<KpisSeace | null>(null)
  const [kpisEstados, setKpisEstados] = useState<KpisEstados | null>(null)
  const [jobIdActivo, setJobIdActivo] = useState<string | null>(null)
  const [iniciandoScraper, setIniciandoScraper] = useState(false)

  const activeFilters = useMemo(
    () => [categoria, modalidad, montoMin, montoMax, soloDesierto, orden !== 'reciente'].filter(Boolean).length,
    [categoria, modalidad, montoMin, montoMax, soloDesierto, orden]
  )

  const limpiarFiltros = () => {
    setEstado('')
    setModalidad('')
    setCategoria('')
    setEntidadFiltro('')
    setMontoMin('')
    setMontoMax('')
    setRegion('')
    setDepartamento('')
    setDistrito('')
    setOrden('reciente')
    setSoloDesierto(false)
  }


  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getProcesosVigentes({
        q: q || undefined,
        entidad: entidadFiltro || undefined,
        modalidad: modalidad || undefined,
        categoria: categoria || undefined,
        estado: estado || undefined,
        region: region || undefined,
        departamento: departamento || undefined,
        distrito: distrito || undefined,
        monto_min: montoMin ? Number(montoMin) : undefined,
        monto_max: montoMax ? Number(montoMax) : undefined,
        solo_desierto: soloDesierto || undefined,
        orden,
        limit,
        offset: (page - 1) * limit,
      })
      setItems(data.items)
      setTotal(data.total)
    } finally {
      setLoading(false)
    }
  }, [q, entidadFiltro, modalidad, categoria, estado, region, departamento, distrito, montoMin, montoMax, soloDesierto, orden, page, limit])

  const cargarKpis = useCallback(async () => {
    try {
      setKpis(await getKpisSeace('vigente'))
    } catch {
      // los KPIs son un plus visual — si fallan no bloqueamos el listado
    }
    try {
      setKpisEstados(await getKpisEstados())
    } catch {
      // idem
    }
  }, [])

  useEffect(() => {
    setPage(1)
  }, [q, entidadFiltro, modalidad, categoria, estado, region, departamento, distrito, montoMin, montoMax, soloDesierto, orden, limit])

  useEffect(() => {
    const t = setTimeout(cargar, 300)
    return () => clearTimeout(t)
  }, [cargar])

  useEffect(() => {
    cargarKpis()
  }, [cargarKpis])

  useEffect(() => {
    getUbicaciones().then(setUbicaciones).catch(() => {})
  }, [])

  const handleActualizarEnVivo = async () => {
    setIniciandoScraper(true)
    try {
      const { job_id } = await iniciarScraperLive(String(new Date().getFullYear()))
      setJobIdActivo(job_id)
    } catch (e) {
      alert('No se pudo iniciar la actualización en vivo del SEACE. Intenta de nuevo en unos minutos.')
    } finally {
      setIniciandoScraper(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit))
  const paginasVisibles = generarPaginasVisibles(page, totalPages)

  const toggleFavorito = (ocid: string) => {
    setFavoritos(prev => {
      const next = new Set(prev)
      if (next.has(ocid)) next.delete(ocid)
      else next.add(ocid)
      return next
    })
  }

  // TODO: implementar contra tu endpoint real de descarga de documentos
  // (ej. GET /api/seace/{ocid}/documentos/zip). Por ahora solo avisa.
  const handleDescargar = (p: ProcesoSeace) => {
    alert(`Descarga de documentos para "${p.tender_id}" — pendiente de conectar al backend.`)
  }

  return (
    <>
      <div className="min-h-screen bg-slate-50 p-4 lg:p-8 space-y-5">
        {/* encabezado */}
        <div className="flex flex-wrap items-center gap-3">
          <SidebarTrigger className="lg:hidden" />
          <div>
            <h1 className="text-xl font-bold text-slate-900">Buscador de Licitaciones del SEACE 2026</h1>
            <p className="text-sm text-slate-500">
              Busca y filtra contratos del Estado peruano en segundos. Palabra clave, entidad, departamento. Gratis y sin registro.
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              onClick={handleActualizarEnVivo}
              disabled={iniciandoScraper || !!jobIdActivo}
              className="flex items-center gap-2 rounded-lg bg-[#F5B700] px-3.5 py-2 text-sm font-semibold text-[#0B3D6E] shadow-sm transition-colors hover:bg-[#F5B700]/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RadioTower size={15} className={iniciandoScraper ? 'animate-pulse' : ''} />
              {iniciandoScraper ? 'Iniciando...' : 'Actualizar en vivo'}
            </button>
            <VincularSeace />
          </div>
        </div>

        {/* KPIs por estado */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <button
            onClick={() => setEstado('')}
            className={`flex flex-col items-start rounded-xl border p-3.5 text-left shadow-sm transition-colors
              ${estado === '' ? 'border-[#0B3D6E] bg-[#0B3D6E]/5' : 'border-slate-200 bg-white hover:border-slate-300'}`}
          >
            <p className="text-xs font-medium text-slate-400">Total de contratos</p>
            <p className="mt-1 text-xl font-bold text-[#0B3D6E]">{kpisEstados?.total ?? '—'}</p>
          </button>
          <button
            onClick={() => setEstado(prev => (prev === 'vigente' ? '' : 'vigente'))}
            className={`flex flex-col items-start rounded-xl border p-3.5 text-left shadow-sm transition-colors
              ${estado === 'vigente' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
          >
            <p className="text-xs font-medium text-slate-400">Vigentes</p>
            <p className="mt-1 text-xl font-bold text-emerald-600">{kpisEstados?.vigente ?? '—'}</p>
          </button>
          <button
            onClick={() => setEstado(prev => (prev === 'con_resultado' ? '' : 'con_resultado'))}
            className={`flex flex-col items-start rounded-xl border p-3.5 text-left shadow-sm transition-colors
              ${estado === 'con_resultado' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
          >
            <p className="text-xs font-medium text-slate-400">Con resultado</p>
            <p className="mt-1 text-xl font-bold text-blue-600">{kpisEstados?.con_resultado ?? '—'}</p>
          </button>
          <button
            onClick={() => setEstado(prev => (prev === 'vencido_sin_resultado' ? '' : 'vencido_sin_resultado'))}
            className={`flex flex-col items-start rounded-xl border p-3.5 text-left shadow-sm transition-colors
              ${estado === 'vencido_sin_resultado' ? 'border-rose-500 bg-rose-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
          >
            <p className="text-xs font-medium text-slate-400">Vencidos</p>
            <p className="mt-1 text-xl font-bold text-rose-500">{kpisEstados?.vencido_sin_resultado ?? '—'}</p>
          </button>
        </div>

        {/* KPIs por objeto de contratación */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
            <p className="text-xs font-medium text-slate-400">Total vigentes</p>
            <p className="mt-1 text-xl font-bold text-[#0B3D6E]">{kpis?.total ?? '—'}</p>
          </div>
          {CATEGORIAS.map(c => {
            const dato = kpis?.por_categoria.find(k => k.categoria === c.value)
            const Icono = c.icon
            return (
              <button
                key={c.value}
                onClick={() => setCategoria(prev => (prev === c.value ? '' : c.value))}
                className={`flex flex-col items-start rounded-xl border p-3.5 text-left shadow-sm transition-colors
                  ${categoria === c.value ? 'border-[#0B3D6E] bg-[#0B3D6E]/5' : 'border-slate-200 bg-white hover:border-slate-300'}`}
              >
                <Icono size={15} className="text-slate-400" />
                <p className="mt-1.5 text-xs font-medium text-slate-400">{c.label}</p>
                <p className="text-xl font-bold text-slate-800">{dato?.total ?? 0}</p>
              </button>
            )
          })}
        </div>

        {/* card: Filtros de Búsqueda */}
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">Filtros de Búsqueda</h2>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Palabra Clave</label>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  placeholder="Buscar..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#0B3D6E] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#0B3D6E]"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Entidad</label>
              <div className="relative">
                <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={entidadFiltro}
                  onChange={e => setEntidadFiltro(e.target.value)}
                  placeholder="Buscar entidad (mín. 3 caracteres)..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#0B3D6E] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#0B3D6E]"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Objeto</label>
              <select
                value={categoria}
                onChange={e => setCategoria(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 focus:border-[#0B3D6E] focus:bg-white focus:outline-none"
              >
                <option value="">Todos</option>
                {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Estado</label>
              <select
                value={estado}
                onChange={e => setEstado(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 focus:border-[#0B3D6E] focus:bg-white focus:outline-none"
              >
                {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
              </select>
            </div>
          </div>

          <button
            onClick={() => setMostrarGeo(v => !v)}
            className="flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-[#0B3D6E]"
          >
            <ChevronDown size={15} className={`transition-transform ${mostrarGeo ? 'rotate-180' : ''}`} />
            Mostrar filtros geográficos
          </button>

          {mostrarGeo && (
            <div className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2 lg:grid-cols-4">
              <select
                value={region}
                onChange={e => setRegion(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 focus:border-[#0B3D6E] focus:bg-white focus:outline-none"
              >
                <option value="">Región (todas)</option>
                {ubicaciones.regiones.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <select
                value={departamento}
                onChange={e => setDepartamento(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 focus:border-[#0B3D6E] focus:bg-white focus:outline-none"
              >
                <option value="">Departamento (todos)</option>
                {ubicaciones.departamentos.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <select
                value={distrito}
                onChange={e => setDistrito(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 focus:border-[#0B3D6E] focus:bg-white focus:outline-none"
              >
                <option value="">Distrito (todos)</option>
                {ubicaciones.distritos.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <select
              value={modalidad}
              onChange={e => setModalidad(e.target.value)}
              className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 focus:border-[#0B3D6E] focus:outline-none"
            >
              <option value="">Modalidad</option>
              {MODALIDADES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>

            <div className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1">
              <span className="text-xs text-slate-400">S/</span>
              <input type="number" value={montoMin} onChange={e => setMontoMin(e.target.value)} placeholder="Mín"
                className="w-14 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none" />
              <span className="text-slate-300">—</span>
              <input type="number" value={montoMax} onChange={e => setMontoMax(e.target.value)} placeholder="Máx"
                className="w-14 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none" />
            </div>

            <select
              value={orden}
              onChange={e => setOrden(e.target.value as typeof orden)}
              className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 focus:border-[#0B3D6E] focus:outline-none"
            >
              {ORDENES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-600">
              <input type="checkbox" checked={soloDesierto} onChange={e => setSoloDesierto(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 accent-[#F5B700]" />
              Desierto
            </label>

            {(activeFilters > 0 || estado || q || entidadFiltro || region || departamento || distrito) && (
              <button onClick={limpiarFiltros} className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 py-2 text-xs font-medium text-slate-400 transition-colors hover:text-[#0B3D6E]">
                <RotateCcw size={12} /> Limpiar
              </button>
            )}
          </div>
        </div>

        {/* barra: vista + mostrar N */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
            <button onClick={() => setVista('tabla')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${vista === 'tabla' ? 'bg-white text-[#0B3D6E] shadow-sm' : 'text-slate-500'}`}>
              <Table2 size={13} /> Tabla
            </button>
            <button onClick={() => setVista('cuadricula')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${vista === 'cuadricula' ? 'bg-white text-[#0B3D6E] shadow-sm' : 'text-slate-500'}`}>
              <LayoutGrid size={13} /> Cuadrícula
            </button>
          </div>

          <select
            value={limit}
            onChange={e => setLimit(Number(e.target.value))}
            className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 focus:border-[#0B3D6E] focus:outline-none"
          >
            {TAMANOS_PAGINA.map(n => <option key={n} value={n}>Mostrar: {n}</option>)}
          </select>
        </div>

        {/* resultados */}
        {items.length === 0 && !loading ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white py-20 text-center">
            <X size={20} className="text-slate-300" />
            <p className="text-sm text-slate-500">No se encontraron convocatorias con estos filtros.</p>
          </div>
        ) : vista === 'cuadricula' ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {loading
              ? Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
              : items.map(p => (
                  <ContratoSeaceCard
                    key={p.ocid}
                    proceso={p}
                    isLoading={false}
                    disabled={false}
                    onClick={() => { setSelectedOcid(p.ocid); setSelectedTenderId(p.tender_id) }}
                  />
                ))}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Código</th>
                  <th className="px-4 py-3">Entidad</th>
                  <th className="px-4 py-3">Objeto</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Publicación</th>
                  <th className="px-4 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
                  : items.map(p => (
                      <tr key={p.ocid} className="border-t border-slate-100 transition-colors hover:bg-slate-50/60">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-800">{p.nomenclatura || p.tender_id || '—'}</p>
                          <p className="text-xs text-slate-400">
                            N° {(p.nomenclatura || p.tender_id)?.split('-')[1] || '—'}
                          </p>
                        </td>
                        <td className="max-w-[240px] px-4 py-3 text-slate-600">
                          <p className="truncate">{p.entidad}</p>
                          {(p.departamento || p.distrito) && (
                            <p className="text-xs text-slate-400">
                              {[p.distrito, p.departamento].filter(Boolean).join(', ')}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          <p className="font-medium">{etiquetaCategoria(p.categoria)}</p>
                          {p.modalidad && (
                            <span className="mt-0.5 inline-flex w-fit rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-[#0B3D6E]">
                              {p.modalidad}
                            </span>
                          )}
                          <p className="max-w-[280px] truncate text-xs text-slate-400">{p.titulo}</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            {badgeEstado(p.estado)}
                            <span
                              className={`inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                p.origen === 'scraper'
                                  ? 'bg-amber-50 text-amber-600'
                                  : 'bg-slate-100 text-slate-500'
                              }`}
                            >
                              {p.origen === 'scraper' ? 'En vivo' : 'API'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {tiempoRelativo(p.published_date)}
                          {p.origen === 'scraper' && p.scraped_at && (
                            <p className="mt-0.5 text-[10px] text-amber-600">
                              Extraído {tiempoRelativo(p.scraped_at)}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <button
                              title="Ver cronograma"
                              onClick={() => { setSelectedOcid(p.ocid); setSelectedTenderId(p.tender_id) }}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                            >
                              <History size={14} />
                            </button>
                            <button
                              title="Ver detalle"
                              onClick={() => { setSelectedOcid(p.ocid); setSelectedTenderId(p.tender_id) }}
                              className="flex h-7 w-7 items-center justify-center rounded-md bg-[#0B3D6E] text-white hover:bg-[#0B3D6E]/90"
                            >
                              <Eye size={14} />
                            </button>
                            <button
                              title="Descargar documentos"
                              onClick={() => handleDescargar(p)}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                            >
                              <Download size={14} />
                            </button>
                            <button
                              title={favoritos.has(p.ocid) ? 'Quitar de favoritos' : 'Marcar como favorito'}
                              onClick={() => toggleFavorito(p.ocid)}
                              className={`flex h-7 w-7 items-center justify-center rounded-md hover:bg-slate-100 ${favoritos.has(p.ocid) ? 'text-[#F5B700]' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                              <Star size={14} fill={favoritos.has(p.ocid) ? 'currentColor' : 'none'} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        )}

        {/* paginación numerada */}
        {items.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs text-slate-500">
              <span className="font-medium text-slate-700">{(page - 1) * limit + 1}</span>–
              <span className="font-medium text-slate-700">{Math.min(page * limit, total)}</span> de{' '}
              <span className="font-medium text-slate-700">{total.toLocaleString('es-PE')}</span>
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-medium text-[#0B3D6E] transition-colors hover:border-[#0B3D6E] disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronLeft size={14} />
              </button>
              {paginasVisibles.map((p, i) =>
                p === '...' ? (
                  <span key={`dots-${i}`} className="px-1.5 text-xs text-slate-400">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p as number)}
                    className={`min-w-[30px] rounded-md px-2 py-1.5 text-xs font-semibold transition-colors
                      ${page === p ? 'bg-[#0B3D6E] text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                  >
                    {p}
                  </button>
                )
              )}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-medium text-[#0B3D6E] transition-colors hover:border-[#0B3D6E] disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronRightIcon size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      <DetalleProcesoDrawer
        ocid={selectedOcid}
        tenderId={selectedTenderId}
        proceso={items.find(i => i.ocid === selectedOcid) ?? null}
        onClose={() => { setSelectedOcid(null); setSelectedTenderId(null) }}
      />

      {jobIdActivo && (
        <ScraperLiveLoader
          jobId={jobIdActivo}
          onClose={() => setJobIdActivo(null)}
          onCompletado={() => { cargar(); cargarKpis() }}
        />
      )}
    </>
  )
}