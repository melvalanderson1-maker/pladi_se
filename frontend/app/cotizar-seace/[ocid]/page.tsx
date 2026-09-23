'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  Search, X, RotateCcw, ChevronLeft, ChevronRight as ChevronRightIcon,
  Table2, LayoutGrid, RadioTower, Package, Briefcase, HardHat, ClipboardCheck,
} from 'lucide-react'
import { SidebarTrigger } from '@/components/Sidebar'
import { getProcesosVigentes, type ProcesoSeace } from '@/lib/seace-api'
import { iniciarScraperLive, getKpisSeace, type KpisSeace } from '@/lib/seace-scraper-api'
import ContratoSeaceCard from '@/components/ContratoSeaceCard'
import DetalleProcesoDrawer from '@/components/DetalleProcesoDrawer'
import VincularSeace from '@/components/VincularSeace'
import ScraperLiveLoader from '@/components/ScraperLiveLoader'

const MODALIDADES = [
  'Concurso Público Abreviado',
  'Adjudicación Simplificada',
  'Licitación Pública',
  'Subasta Inversa Electrónica',
]

// Verifica los valores reales guardados en `categoria` en tu BD y ajusta si difiere.
const CATEGORIAS = [
  { value: 'goods', label: 'Bienes', icon: Package, active: 'bg-blue-600 border-blue-600 text-white' },
  { value: 'services', label: 'Servicios', icon: Briefcase, active: 'bg-violet-600 border-violet-600 text-white' },
  { value: 'works', label: 'Obras', icon: HardHat, active: 'bg-orange-600 border-orange-600 text-white' },
  { value: 'consultoriadeobra', label: 'Consultoría de obra', icon: ClipboardCheck, active: 'bg-teal-600 border-teal-600 text-white' },
]

const ESTADOS = [
  { value: '', label: 'Todos' },
  { value: 'vigente', label: 'Vigentes' },
  { value: 'con_resultado', label: 'Con resultado' },
  { value: 'vencido_sin_resultado', label: 'Vencidos' },
]

const ORDENES = [
  { value: 'reciente', label: 'Más reciente' },
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
    <tr className="border-t border-blue-50">
      {Array.from({ length: 6 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-3 w-full max-w-[140px] animate-pulse rounded bg-blue-50" />
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
    vencido_sin_resultado: 'bg-slate-100 text-slate-500',
  }
  const label: Record<string, string> = {
    vigente: 'Vigente',
    con_resultado: 'Con resultado',
    vencido_sin_resultado: 'Vencido',
  }
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium ${map[key] || 'bg-slate-100 text-slate-500'}`}>
      {label[key] || key || '—'}
    </span>
  )
}

function etiquetaCategoria(categoria: string | null) {
  return CATEGORIAS.find(c => c.value === categoria)?.label || '—'
}

function formatearMonto(monto: number | null) {
  if (monto === null || monto === undefined) return '—'
  return `S/ ${monto.toLocaleString('es-PE', { maximumFractionDigits: 0 })}`
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
  const [limit, setLimit] = useState(20)
  const [vista, setVista] = useState<'tabla' | 'cuadricula'>('tabla')

  const [q, setQ] = useState('')
  const [entidadFiltro, setEntidadFiltro] = useState('')
  const [estado, setEstado] = useState('')
  const [modalidad, setModalidad] = useState('')
  const [categoria, setCategoria] = useState('')
  const [montoMin, setMontoMin] = useState('')
  const [montoMax, setMontoMax] = useState('')
  const [orden, setOrden] = useState<(typeof ORDENES)[number]['value']>('reciente')
  const [soloDesierto, setSoloDesierto] = useState(false)

  const [kpis, setKpis] = useState<KpisSeace | null>(null)
  const [jobIdActivo, setJobIdActivo] = useState<string | null>(null)
  const [iniciandoScraper, setIniciandoScraper] = useState(false)

  const activeFilters = useMemo(
    () => [categoria, modalidad, entidadFiltro, montoMin, montoMax, soloDesierto, orden !== 'reciente'].filter(Boolean).length,
    [categoria, modalidad, entidadFiltro, montoMin, montoMax, soloDesierto, orden]
  )

  const limpiarFiltros = () => {
    setEstado('')
    setModalidad('')
    setCategoria('')
    setEntidadFiltro('')
    setMontoMin('')
    setMontoMax('')
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
        monto_min: montoMin ? Number(montoMin) : undefined,
        monto_max: montoMax ? Number(montoMax) : undefined,
        solo_desierto: soloDesierto || undefined,
        orden,
        limit,
        offset: (page - 1) * limit,
      } as any)
      setItems(data.items)
      setTotal(data.total)
    } finally {
      setLoading(false)
    }
  }, [q, entidadFiltro, modalidad, categoria, estado, montoMin, montoMax, soloDesierto, orden, page, limit])

  const cargarKpis = useCallback(async () => {
    try {
      setKpis(await getKpisSeace('vigente'))
    } catch {
      // los KPIs son un plus visual — si fallan no bloqueamos el listado
    }
  }, [])

  useEffect(() => {
    setPage(1)
  }, [q, entidadFiltro, modalidad, categoria, estado, montoMin, montoMax, soloDesierto, orden, limit])

  useEffect(() => {
    const t = setTimeout(cargar, 300)
    return () => clearTimeout(t)
  }, [cargar])

  useEffect(() => {
    cargarKpis()
  }, [cargarKpis])

  const totalPages = Math.max(1, Math.ceil(total / limit))
  const paginasVisibles = generarPaginasVisibles(page, totalPages)

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

  return (
    <>
      <div className="min-h-screen bg-slate-50 p-4 lg:p-8 space-y-5">
        {/* encabezado */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="lg:hidden" />Detalle de convocatoria
            <div>
              <h1 className="text-xl font-bold text-[#0B3D6E]">Cotizar en SEACE</h1>
              <p className="text-sm text-slate-500">
                <span className="font-semibold text-slate-700">{total}</span> convocatorias
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
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

        {/* KPIs por objeto de contratación */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div className="rounded-xl border border-blue-100 bg-white p-3.5 shadow-sm">
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
                  ${categoria === c.value ? 'border-[#0B3D6E] bg-[#0B3D6E]/5' : 'border-blue-100 bg-white hover:border-blue-200'}`}
              >
                <Icono size={15} className="text-slate-400" />
                <p className="mt-1.5 text-xs font-medium text-slate-400">{c.label}</p>
                <p className="text-xl font-bold text-slate-800">{dato?.total ?? 0}</p>
              </button>
            )
          })}
        </div>

        {/* barra de filtros */}
        <div className="space-y-2.5 rounded-xl border border-blue-100 bg-white p-3 shadow-sm">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0B3D6E]/50" />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Palabra clave..."
                className="w-full rounded-lg border border-blue-100 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#0B3D6E] focus:outline-none focus:ring-1 focus:ring-[#0B3D6E]"
              />
            </div>
            <input
              value={entidadFiltro}
              onChange={e => setEntidadFiltro(e.target.value)}
              placeholder="Buscar entidad (mín. 3 caracteres)..."
              className="w-full rounded-lg border border-blue-100 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#0B3D6E] focus:outline-none focus:ring-1 focus:ring-[#0B3D6E]"
            />
            <select
              value={categoria}
              onChange={e => setCategoria(e.target.value)}
              className="w-full rounded-lg border border-blue-100 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-[#0B3D6E] focus:outline-none"
            >
              <option value="">Objeto: todos</option>
              {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <div className="flex items-center gap-1 rounded-lg border border-blue-100 bg-blue-50/40 p-1">
              {ESTADOS.map(e => (
                <button
                  key={e.value}
                  onClick={() => setEstado(e.value)}
                  className={`flex-1 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors
                    ${estado === e.value ? 'bg-[#0B3D6E] text-white shadow-sm' : 'text-slate-600 hover:bg-white hover:text-[#0B3D6E]'}`}
                >
                  {e.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-blue-50 pt-2.5">
            <select
              value={modalidad}
              onChange={e => setModalidad(e.target.value)}
              className="shrink-0 rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 focus:border-[#0B3D6E] focus:outline-none"
            >
              <option value="">Modalidad</option>
              {MODALIDADES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>

            <div className="flex shrink-0 items-center gap-1 rounded-lg border border-blue-100 bg-white px-2 py-1">
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
              className="shrink-0 rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 focus:border-[#0B3D6E] focus:outline-none"
            >
              {ORDENES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-xs font-medium text-slate-600">
              <input type="checkbox" checked={soloDesierto} onChange={e => setSoloDesierto(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 accent-[#F5B700]" />
              Desierto
            </label>

            {(activeFilters > 0 || estado || q) && (
              <button onClick={limpiarFiltros} className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 py-2 text-xs font-medium text-slate-400 transition-colors hover:text-[#0B3D6E]">
                <RotateCcw size={12} /> Limpiar
              </button>
            )}

            <div className="ml-auto flex shrink-0 items-center gap-1 rounded-lg border border-blue-100 bg-blue-50/40 p-1">
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
              className="shrink-0 rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 focus:border-[#0B3D6E] focus:outline-none"
            >
              {TAMANOS_PAGINA.map(n => <option key={n} value={n}>Mostrar: {n}</option>)}
            </select>
          </div>
        </div>

        {/* resultados */}
        {items.length === 0 && !loading ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-blue-100 bg-white py-20 text-center">
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
          <div className="overflow-x-auto rounded-xl border border-blue-100 bg-white shadow-sm">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-blue-50 bg-blue-50/30 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Código</th>
                  <th className="px-4 py-3">Entidad</th>
                  <th className="px-4 py-3">Objeto</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Publicación</th>
                  <th className="px-4 py-3">Monto</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
                  : items.map(p => (
                      <tr
                        key={p.ocid}
                        onClick={() => { setSelectedOcid(p.ocid); setSelectedTenderId(p.tender_id) }}
                        className="cursor-pointer border-t border-blue-50 transition-colors hover:bg-blue-50/40"
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">{p.tender_id || '—'}</p>
                          <p className="max-w-[220px] truncate text-xs text-slate-400">{p.titulo}</p>
                        </td>
                        <td className="max-w-[220px] truncate px-4 py-3 text-slate-600">{p.entidad}</td>
                        <td className="px-4 py-3 text-slate-600">{etiquetaCategoria(p.categoria)}</td>
                        <td className="px-4 py-3">{badgeEstado(p.estado)}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {p.published_date ? new Date(p.published_date).toLocaleDateString('es-PE') : '—'}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-700">{formatearMonto(p.monto)}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        )}

        {/* paginación numerada */}
        {items.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-white px-4 py-3">
            <p className="text-xs text-slate-500">
              Mostrando <span className="font-medium text-slate-700">{(page - 1) * limit + 1}</span>–
              <span className="font-medium text-slate-700">{Math.min(page * limit, total)}</span> de{' '}
              <span className="font-medium text-slate-700">{total}</span>
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="flex items-center gap-1 rounded-lg border border-blue-100 px-2.5 py-1.5 text-sm font-medium text-[#0B3D6E] transition-colors hover:border-[#0B3D6E] disabled:cursor-not-allowed disabled:opacity-30"
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
                      ${page === p ? 'bg-[#0B3D6E] text-white' : 'text-slate-600 hover:bg-blue-50'}`}
                  >
                    {p}
                  </button>
                )
              )}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="flex items-center gap-1 rounded-lg border border-blue-100 px-2.5 py-1.5 text-sm font-medium text-[#0B3D6E] transition-colors hover:border-[#0B3D6E] disabled:cursor-not-allowed disabled:opacity-30"
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