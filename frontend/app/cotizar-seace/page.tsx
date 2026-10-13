'use client'

import { useEffect, useState, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { Bricolage_Grotesque } from 'next/font/google'
import {
  Search, X, RotateCcw, ChevronLeft, ChevronRight as ChevronRightIcon, ChevronDown,
  Table2, LayoutGrid, Building2, Eye, Download, Star, History, RadioTower,
  Package, Briefcase, HardHat, ClipboardCheck, SlidersHorizontal, SearchX, MapPin, Clock,
  type LucideIcon,
} from 'lucide-react'
import { SidebarTrigger } from '@/components/Sidebar'
import { getProcesosVigentes, getUbicaciones, type ProcesoSeace, type UbicacionesSeace } from '@/lib/seace-api'
import { iniciarScraperLive, getKpisSeace, getKpisEstados, type KpisSeace, type KpisEstados } from '@/lib/seace-scraper-api'
import ContratoSeaceCard from '@/components/ContratoSeaceCard'
import DetalleProcesoDrawer from '@/components/DetalleProcesoDrawer'
import VincularSeace from '@/components/VincularSeace'
import ScraperLiveLoader from '@/components/ScraperLiveLoader'

/* ------------------------------------------------------------------ */
/*  Tipografía de títulos y cifras (si tu versión de Next no trae      */
/*  Bricolage_Grotesque, borra estas 2 líneas y cambia fontDisplay     */
/*  por { className: '' }).                                            */
/* ------------------------------------------------------------------ */
const fontDisplay = Bricolage_Grotesque({ subsets: ['latin'], display: 'swap' })

/* ------------------------------------------------------------------ */
/*  Constantes                                                         */
/* ------------------------------------------------------------------ */
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

type IconType = LucideIcon

// Verifica los valores reales guardados en `categoria` en tu BD y ajusta si difiere.
const CATEGORIAS: { value: string; label: string; icon: IconType }[] = [
  { value: 'goods', label: 'Bien', icon: Package },
  { value: 'services', label: 'Servicio', icon: Briefcase },
  { value: 'works', label: 'Obra', icon: HardHat },
  { value: 'consultoriadeobra', label: 'Consultoría de obra', icon: ClipboardCheck },
]

const TABS_ESTADO = [
  { value: '', label: 'Todos', key: 'total', dot: 'bg-slate-400', bar: 'bg-[#0B3D6E]', text: 'text-[#0B3D6E]' },
  { value: 'vigente', label: 'Vigentes', key: 'vigente', dot: 'bg-emerald-500', bar: 'bg-emerald-500', text: 'text-emerald-600' },
  { value: 'con_resultado', label: 'Con resultado', key: 'con_resultado', dot: 'bg-blue-500', bar: 'bg-blue-500', text: 'text-blue-600' },
  { value: 'vencido_sin_resultado', label: 'Vencidos', key: 'vencido_sin_resultado', dot: 'bg-rose-500', bar: 'bg-rose-500', text: 'text-rose-600' },
] as const

const ORDENES = [
  { value: 'reciente', label: 'Más reciente' },
  { value: 'recien_extraido', label: 'Recién extraído' },
  { value: 'urgencia', label: 'Más urgente' },
  { value: 'monto_desc', label: 'Monto: mayor a menor' },
  { value: 'monto_asc', label: 'Monto: menor a mayor' },
] as const

const TAMANOS_PAGINA = [10, 20, 32, 50]

/* ------------------------------------------------------------------ */
/*  Estilos y animaciones                                              */
/* ------------------------------------------------------------------ */
const ESTILOS = `
.sx-root{--sx-ease:cubic-bezier(.22,1,.36,1)}
@keyframes sx-shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}
.sx-skel{background:linear-gradient(90deg,#e8eef5 25%,#f6f9fc 50%,#e8eef5 75%);background-size:800px 100%;animation:sx-shimmer 1.4s linear infinite}
@keyframes sx-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.sx-rise{opacity:0;animation:sx-rise .5s var(--sx-ease) forwards}
@keyframes sx-fade{from{opacity:0}to{opacity:1}}
.sx-fade{opacity:0;animation:sx-fade .35s ease forwards}
@keyframes sx-pop{0%{transform:scale(.55)}55%{transform:scale(1.4)}100%{transform:scale(1)}}
.sx-pop{animation:sx-pop .42s var(--sx-ease)}
@keyframes sx-ring{0%{transform:scale(1);opacity:.7}100%{transform:scale(2.7);opacity:0}}
.sx-ring{animation:sx-ring 1.8s ease-out infinite}
@keyframes sx-bar{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}
.sx-bar{animation:sx-bar 1.1s ease-in-out infinite}
@keyframes sx-toast{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}
.sx-toast{animation:sx-toast .4s var(--sx-ease)}
@keyframes sx-hero{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.sx-hero-a{opacity:0;animation:sx-hero .7s var(--sx-ease) .05s forwards}
.sx-hero-b{opacity:0;animation:sx-hero .7s var(--sx-ease) .2s forwards}
.sx-hero-c{opacity:0;animation:sx-hero .7s var(--sx-ease) .35s forwards}
.sx-collapse{display:grid;grid-template-rows:0fr;opacity:0;visibility:hidden;transition:grid-template-rows .32s var(--sx-ease),opacity .22s ease,visibility 0s linear .32s}
.sx-collapse[data-open="true"]{grid-template-rows:1fr;opacity:1;visibility:visible;transition:grid-template-rows .32s var(--sx-ease),opacity .25s ease .05s,visibility 0s}
.sx-collapse>div{min-height:0;overflow:hidden}
.sx-dots{background-image:radial-gradient(rgba(255,255,255,.09) 1px,transparent 1px);background-size:20px 20px}
@media (prefers-reduced-motion:reduce){
  .sx-root *,.sx-root *::before,.sx-root *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;transition-delay:0s!important}
}
`

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B3D6E] focus-visible:ring-offset-2'

const controlBase =
  'h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-700 transition hover:border-slate-300 focus:border-[#0B3D6E] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0B3D6E]/10'

/* ------------------------------------------------------------------ */
/*  Utilidades                                                         */
/* ------------------------------------------------------------------ */
function useCountUp(target: number | null | undefined, duration = 900) {
  const [val, setVal] = useState(0)
  const prev = useRef(0)

  useEffect(() => {
    if (target == null) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setVal(target)
      prev.current = target
      return
    }
    const from = prev.current
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setVal(Math.round(from + (target - from) * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
      else prev.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])

  return val
}

function Num({ value }: { value: number | null | undefined }) {
  const v = useCountUp(value)
  if (value == null) return <>—</>
  return <>{v.toLocaleString('es-PE')}</>
}

function normCategoria(categoria: string | null | undefined) {
  return (categoria || '').toLowerCase()
}

function etiquetaCategoria(categoria: string | null | undefined) {
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
  return map[normCategoria(categoria)] || '—'
}

function iconoCategoria(categoria: string | null | undefined): IconType {
  const k = normCategoria(categoria)
  if (['services', 'servicio', 'servicios'].includes(k)) return Briefcase
  if (['works', 'obra', 'obras'].includes(k)) return HardHat
  if (k === 'consultoriadeobra') return ClipboardCheck
  return Package
}

function tiempoRelativo(fecha: string | null | undefined) {
  if (!fecha) return '—'
  const d = new Date(fecha)
  if (Number.isNaN(d.getTime())) return '—'
  const segundos = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000))
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

const ESTADO_UI: Record<string, { label: string; badge: string; dot: string; stripe: string }> = {
  vigente: {
    label: 'Vigente',
    badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    dot: 'bg-emerald-500',
    stripe: 'bg-emerald-500',
  },
  con_resultado: {
    label: 'Con resultado',
    badge: 'bg-blue-50 text-blue-700 ring-blue-200',
    dot: 'bg-blue-500',
    stripe: 'bg-blue-500',
  },
  vencido_sin_resultado: {
    label: 'Vencido',
    badge: 'bg-rose-50 text-rose-700 ring-rose-200',
    dot: 'bg-rose-500',
    stripe: 'bg-rose-400',
  },
}

function BadgeEstado({ estado }: { estado: string | null | undefined }) {
  const ui = ESTADO_UI[estado ?? '']
  if (!ui) {
    return (
      <span className="inline-flex w-fit items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 ring-1 ring-inset ring-slate-200">
        {estado || '—'}
      </span>
    )
  }
  return (
    <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${ui.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ui.dot}`} />
      {ui.label}
    </span>
  )
}

function BadgeOrigen({ origen }: { origen: string | null | undefined }) {
  const vivo = origen === 'scraper'
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        vivo ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'
      }`}
    >
      {vivo && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="sx-ring absolute inline-flex h-full w-full rounded-full bg-amber-400" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
        </span>
      )}
      {vivo ? 'En vivo' : 'API'}
    </span>
  )
}

function SelectBox({
  value,
  onChange,
  label,
  children,
  className = '',
}: {
  value: string
  onChange: (v: string) => void
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`relative ${className}`}>
      <select
        aria-label={label}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`${controlBase} cursor-pointer appearance-none pr-9`}
      >
        {children}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span>
      {children}
    </label>
  )
}

/* ------------------------------------------------------------------ */
/*  Skeletons                                                          */
/* ------------------------------------------------------------------ */
function SkeletonCard() {
  return (
    <div className="relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-slate-200 bg-white py-4 pl-5 pr-4">
      <div className="sx-skel absolute inset-y-0 left-0 w-1" />
      <div className="flex items-center justify-between">
        <div className="sx-skel h-3.5 w-24 rounded" />
        <div className="sx-skel h-5 w-16 rounded-full" />
      </div>
      <div className="sx-skel h-4 w-full rounded" />
      <div className="sx-skel h-4 w-2/3 rounded" />
      <div className="sx-skel h-3 w-1/2 rounded" />
      <div className="flex justify-between border-t border-slate-100 pt-3">
        <div className="sx-skel h-3 w-1/3 rounded" />
        <div className="sx-skel h-3 w-1/4 rounded" />
      </div>
    </div>
  )
}

function SkeletonRow() {
  return (
    <tr className="border-t border-slate-100">
      <td className="px-5 py-4"><div className="sx-skel h-4 w-28 rounded" /><div className="sx-skel mt-2 h-3 w-16 rounded" /></td>
      <td className="px-4 py-4"><div className="sx-skel h-4 w-44 rounded" /><div className="sx-skel mt-2 h-3 w-28 rounded" /></td>
      <td className="px-4 py-4"><div className="sx-skel h-4 w-24 rounded" /><div className="sx-skel mt-2 h-3 w-52 rounded" /></td>
      <td className="px-4 py-4"><div className="sx-skel h-6 w-24 rounded-full" /></td>
      <td className="px-4 py-4"><div className="sx-skel h-4 w-24 rounded" /></td>
      <td className="px-4 py-4"><div className="sx-skel h-8 w-40 rounded-lg" /></td>
    </tr>
  )
}

/* ------------------------------------------------------------------ */
/*  Página                                                             */
/* ------------------------------------------------------------------ */
export default function CotizarSeacePage() {
  const [items, setItems] = useState<ProcesoSeace[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selectedOcid, setSelectedOcid] = useState<string | null>(null)
  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [vista, setVista] = useState<'tabla' | 'cuadricula'>('tabla')
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false)

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

  const [toast, setToast] = useState<{ msg: string; tipo: 'info' | 'error' } | null>(null)
  const inputBusquedaRef = useRef<HTMLInputElement>(null)

  /* ---------- filtros ---------- */
  const filtrosAvanzadosActivos = useMemo(
    () =>
      [modalidad, montoMin, montoMax, entidadFiltro, region, departamento, distrito, soloDesierto].filter(Boolean).length,
    [modalidad, montoMin, montoMax, entidadFiltro, region, departamento, distrito, soloDesierto]
  )

  const chips = useMemo(() => {
    const c: { id: string; label: string; clear: () => void }[] = []
    if (q) c.push({ id: 'q', label: `Palabra: ${q}`, clear: () => setQ('') })
    if (estado) {
      const t = TABS_ESTADO.find(t => t.value === estado)
      c.push({ id: 'estado', label: `Estado: ${t?.label ?? estado}`, clear: () => setEstado('') })
    }
    if (categoria) {
      const cat = CATEGORIAS.find(x => x.value === categoria)
      c.push({ id: 'categoria', label: `Objeto: ${cat?.label ?? categoria}`, clear: () => setCategoria('') })
    }
    if (modalidad) c.push({ id: 'modalidad', label: modalidad, clear: () => setModalidad('') })
    if (entidadFiltro) c.push({ id: 'entidad', label: `Entidad: ${entidadFiltro}`, clear: () => setEntidadFiltro('') })
    if (montoMin || montoMax) {
      c.push({
        id: 'monto',
        label: `Monto: S/ ${montoMin || '0'} – ${montoMax || 'sin tope'}`,
        clear: () => { setMontoMin(''); setMontoMax('') },
      })
    }
    if (region) c.push({ id: 'region', label: region, clear: () => setRegion('') })
    if (departamento) c.push({ id: 'departamento', label: departamento, clear: () => setDepartamento('') })
    if (distrito) c.push({ id: 'distrito', label: distrito, clear: () => setDistrito('') })
    if (soloDesierto) c.push({ id: 'desierto', label: 'Solo desiertos', clear: () => setSoloDesierto(false) })
    return c
  }, [q, estado, categoria, modalidad, entidadFiltro, montoMin, montoMax, region, departamento, distrito, soloDesierto])

  const limpiarTodo = () => {
    setQ('')
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

  /* ---------- carga de datos ---------- */
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

  // Atajo: "/" enfoca el buscador
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const escribiendo = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      if (e.key === '/' && !escribiendo) {
        e.preventDefault()
        inputBusquedaRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Toast con cierre automático
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4500)
    return () => clearTimeout(t)
  }, [toast])

  /* ---------- acciones ---------- */
  const handleActualizarEnVivo = async () => {
    setIniciandoScraper(true)
    try {
      const { job_id } = await iniciarScraperLive(String(new Date().getFullYear()))
      setJobIdActivo(job_id)
    } catch {
      setToast({
        tipo: 'error',
        msg: 'No se pudo iniciar la actualización en vivo del SEACE. Inténtalo de nuevo en unos minutos.',
      })
    } finally {
      setIniciandoScraper(false)
    }
  }

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
    setToast({ tipo: 'info', msg: `La descarga de documentos de ${p.tender_id} aún no está conectada al backend.` })
  }

  const abrirDetalle = (p: ProcesoSeace) => {
    setSelectedOcid(p.ocid)
    setSelectedTenderId(p.tender_id)
  }

  /* ---------- derivados ---------- */
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const paginasVisibles = generarPaginasVisibles(page, totalPages)
  const primeraCarga = loading && items.length === 0

  const ultimaExtraccion = useMemo(() => {
    let max = 0
    for (const p of items) {
      if (!p.scraped_at) continue
      const t = new Date(p.scraped_at).getTime()
      if (!Number.isNaN(t) && t > max) max = t
    }
    return max ? new Date(max).toISOString() : null
  }, [items])

  /* ---------- fragmentos reutilizables ---------- */
  const iconBtn =
    `flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-[#0B3D6E] ${focusRing}`

  /* ---------------------------------------------------------------- */
  return (
    <div className="sx-root min-h-screen bg-[#F3F6FA] pb-16">
      <style dangerouslySetInnerHTML={{ __html: ESTILOS }} />

      {/* =============================== HERO =============================== */}
      <header className="sx-dots relative overflow-hidden bg-[#0B3D6E]">
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#F5B700]/60 to-transparent" />
        <div className="mx-auto flex max-w-[1400px] flex-col gap-8 px-4 pb-24 pt-6 lg:flex-row lg:items-end lg:justify-between lg:px-8 lg:pt-8">
          <div className="max-w-2xl">
            <div className="sx-hero-a mb-5 flex items-center gap-3">
              <SidebarTrigger className="text-white lg:hidden" />
            </div>
            <h1
              className={`${fontDisplay.className} sx-hero-a text-4xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-5xl`}
            >
              Licitaciones del SEACE 2026
            </h1>
            <p className="sx-hero-b mt-4 max-w-xl text-base leading-relaxed text-blue-100/90">
              Encuentra contratos del Estado peruano por palabra clave, entidad o ubicación, y revisa cuáles siguen abiertos.
            </p>
            <div className="sx-hero-c mt-6 flex flex-wrap items-center gap-3">
              <button
                onClick={handleActualizarEnVivo}
                disabled={iniciandoScraper || !!jobIdActivo}
                className={`group flex items-center gap-2.5 rounded-xl bg-[#F5B700] px-5 py-3 text-sm font-bold text-[#0B3D6E] shadow-lg shadow-black/20 transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#ffc933] hover:shadow-xl active:translate-y-0 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B3D6E]`}
              >
                <RadioTower size={17} className={iniciandoScraper || jobIdActivo ? 'animate-pulse' : 'transition-transform group-hover:scale-110'} />
                {iniciandoScraper ? 'Iniciando...' : jobIdActivo ? 'Actualizando...' : 'Actualizar en vivo'}
              </button>
              <VincularSeace />
            </div>
          </div>

          <div className="sx-hero-c w-full max-w-sm rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur-md lg:w-80">
            <div className="flex items-center gap-2.5 text-sm font-medium text-blue-100">
              <span className="relative flex h-2.5 w-2.5">
                <span className="sx-ring absolute inline-flex h-full w-full rounded-full bg-emerald-400" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
              </span>
              Procesos vigentes ahora
            </div>
            <p className={`${fontDisplay.className} mt-2 text-6xl font-extrabold tabular-nums leading-none text-white`}>
              <Num value={kpis?.total} />
            </p>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-blue-200/80">
              <Clock size={12} />
              Última extracción en vivo: {tiempoRelativo(ultimaExtraccion)}
            </p>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto -mt-14 max-w-[1400px] space-y-5 px-4 lg:px-8">
        {/* ============ PANEL DE BÚSQUEDA Y FILTROS ============ */}
        <section
          aria-label="Búsqueda y filtros"
          className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xl shadow-slate-900/5"
        >
          {/* pestañas de estado */}
          <div role="tablist" aria-label="Estado del proceso" className="grid grid-cols-2 border-b border-slate-100 lg:grid-cols-4">
            {TABS_ESTADO.map((t, i) => {
              const activo = estado === t.value
              return (
                <button
                  key={t.value || 'todos'}
                  role="tab"
                  aria-selected={activo}
                  onClick={() => setEstado(prev => (prev === t.value && t.value !== '' ? '' : t.value))}
                  className={`group relative px-5 py-4 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0B3D6E] ${
                    i > 0 ? 'lg:border-l lg:border-slate-100' : ''
                  } ${i % 2 === 1 ? 'border-l border-slate-100 lg:border-l' : ''}`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-slate-500">
                    <span className={`h-2 w-2 rounded-full ${t.dot}`} />
                    {t.label}
                  </span>
                  <span
                    className={`${fontDisplay.className} mt-1 block text-3xl font-bold tabular-nums transition-colors duration-300 ${
                      activo ? t.text : 'text-slate-800'
                    }`}
                  >
                    <Num value={kpisEstados ? kpisEstados[t.key] : null} />
                  </span>
                  <span
                    className={`absolute inset-x-0 bottom-0 h-[3px] origin-left transition-transform duration-300 ease-out ${t.bar} ${
                      activo ? 'scale-x-100' : 'scale-x-0'
                    }`}
                  />
                </button>
              )
            })}
          </div>

          {/* buscador */}
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={inputBusquedaRef}
                type="search"
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Busca por palabra clave: uniformes, mantenimiento vial, software..."
                aria-label="Buscar por palabra clave"
                className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-11 pr-12 text-[15px] text-slate-800 transition placeholder:text-slate-400 hover:border-slate-300 focus:border-[#0B3D6E] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0B3D6E]/10 [&::-webkit-search-cancel-button]:hidden"
              />
              {q ? (
                <button
                  onClick={() => setQ('')}
                  aria-label="Borrar búsqueda"
                  className={`absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-600 ${focusRing}`}
                >
                  <X size={14} />
                </button>
              ) : (
                <kbd className="pointer-events-none absolute right-3 top-1/2 hidden h-6 -translate-y-1/2 items-center rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-400 sm:inline-flex">
                  /
                </kbd>
              )}
            </div>

            <button
              onClick={() => setFiltrosAbiertos(v => !v)}
              aria-expanded={filtrosAbiertos}
              aria-controls="panel-filtros"
              className={`flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-all duration-200 ${focusRing} ${
                filtrosAbiertos || filtrosAvanzadosActivos > 0
                  ? 'border-[#0B3D6E] bg-[#0B3D6E]/5 text-[#0B3D6E]'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <SlidersHorizontal size={16} />
              Más filtros
              {filtrosAvanzadosActivos > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#0B3D6E] px-1.5 text-xs font-bold text-white">
                  {filtrosAvanzadosActivos}
                </span>
              )}
              <ChevronDown size={15} className={`transition-transform duration-300 ${filtrosAbiertos ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {/* objeto de contratación */}
          <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
            <span className="mr-1 text-sm font-medium text-slate-500">Objeto</span>
            {CATEGORIAS.map(c => {
              const dato = kpis?.por_categoria.find(k => k.categoria === c.value)
              const Icono = c.icon
              const activo = categoria === c.value
              return (
                <button
                  key={c.value}
                  aria-pressed={activo}
                  title="Cantidad de procesos vigentes"
                  onClick={() => setCategoria(prev => (prev === c.value ? '' : c.value))}
                  className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-all duration-200 ${focusRing} ${
                    activo
                      ? 'border-[#0B3D6E] bg-[#0B3D6E] text-white shadow-md shadow-[#0B3D6E]/25'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <Icono size={15} className={activo ? 'text-[#F5B700]' : 'text-slate-400'} />
                  {c.label}
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
                      activo ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {dato?.total ?? 0}
                  </span>
                </button>
              )
            })}
          </div>

          {/* filtros avanzados (colapsable) */}
          <div id="panel-filtros" className="sx-collapse" data-open={filtrosAbiertos}>
            <div>
              <div className="space-y-4 border-t border-slate-100 bg-slate-50/50 p-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Entidad">
                    <div className="relative">
                      <Building2 size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        value={entidadFiltro}
                        onChange={e => setEntidadFiltro(e.target.value)}
                        placeholder="Mínimo 3 caracteres"
                        className={`${controlBase} pl-10`}
                      />
                    </div>
                  </Field>

                  <Field label="Modalidad">
                    <SelectBox label="Modalidad" value={modalidad} onChange={setModalidad}>
                      <option value="">Todas</option>
                      {MODALIDADES.map(m => <option key={m} value={m}>{m}</option>)}
                    </SelectBox>
                  </Field>

                  <Field label="Monto (S/)">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={montoMin}
                        onChange={e => setMontoMin(e.target.value)}
                        placeholder="Mínimo"
                        aria-label="Monto mínimo"
                        className={`${controlBase} min-w-0`}
                      />
                      <span className="text-slate-300">–</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={montoMax}
                        onChange={e => setMontoMax(e.target.value)}
                        placeholder="Máximo"
                        aria-label="Monto máximo"
                        className={`${controlBase} min-w-0`}
                      />
                    </div>
                  </Field>

                  <Field label="Procesos desiertos">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={soloDesierto}
                      onClick={() => setSoloDesierto(v => !v)}
                      className={`flex h-11 w-full items-center justify-between rounded-xl border px-3.5 text-sm transition-colors ${focusRing} ${
                        soloDesierto
                          ? 'border-[#F5B700] bg-[#F5B700]/10 text-[#0B3D6E]'
                          : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      Mostrar solo desiertos
                      <span
                        className={`relative h-6 w-11 rounded-full transition-colors duration-300 ${
                          soloDesierto ? 'bg-[#F5B700]' : 'bg-slate-300'
                        }`}
                      >
                        <span
                          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-300 ${
                            soloDesierto ? 'translate-x-5' : ''
                          }`}
                        />
                      </span>
                    </button>
                  </Field>
                </div>

                <div className="grid grid-cols-1 gap-4 border-t border-slate-200/70 pt-4 sm:grid-cols-3">
                  <Field label="Región">
                    <div className="relative">
                      <MapPin size={15} className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-slate-400" />
                      <select
                        aria-label="Región"
                        value={region}
                        onChange={e => setRegion(e.target.value)}
                        className={`${controlBase} cursor-pointer appearance-none pl-10 pr-9`}
                      >
                        <option value="">Todas</option>
                        {ubicaciones.regiones.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    </div>
                  </Field>
                  <Field label="Departamento">
                    <SelectBox label="Departamento" value={departamento} onChange={setDepartamento}>
                      <option value="">Todos</option>
                      {ubicaciones.departamentos.map(d => <option key={d} value={d}>{d}</option>)}
                    </SelectBox>
                  </Field>
                  <Field label="Distrito">
                    <SelectBox label="Distrito" value={distrito} onChange={setDistrito}>
                      <option value="">Todos</option>
                      {ubicaciones.distritos.map(d => <option key={d} value={d}>{d}</option>)}
                    </SelectBox>
                  </Field>
                </div>
              </div>
            </div>
          </div>

          {/* filtros aplicados */}
          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
              <span className="text-xs font-medium text-slate-400">Aplicados</span>
              {chips.map(c => (
                <button
                  key={c.id}
                  onClick={c.clear}
                  aria-label={`Quitar filtro: ${c.label}`}
                  className={`sx-fade group inline-flex max-w-[260px] items-center gap-1.5 rounded-full bg-[#0B3D6E]/[0.07] py-1 pl-3 pr-2 text-xs font-medium text-[#0B3D6E] transition-colors hover:bg-rose-50 hover:text-rose-600 ${focusRing}`}
                >
                  <span className="truncate">{c.label}</span>
                  <X size={13} className="shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
                </button>
              ))}
              <button
                onClick={limpiarTodo}
                className={`ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#0B3D6E] ${focusRing}`}
              >
                <RotateCcw size={12} />
                Limpiar todo
              </button>
            </div>
          )}
        </section>

        {/* ============ BARRA DE RESULTADOS (sticky) ============ */}
        <div className="sticky top-2 z-20 flex flex-wrap items-center justify-between gap-3 overflow-hidden rounded-2xl border border-slate-200/80 bg-white/85 px-4 py-2.5 shadow-sm backdrop-blur-md">
          <p className="text-sm text-slate-600" aria-live="polite">
            <span className="font-bold tabular-nums text-slate-900">{total.toLocaleString('es-PE')}</span>{' '}
            {total === 1 ? 'proceso' : 'procesos'}
            {chips.length > 0 && ' con tus filtros'}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <SelectBox
              label="Ordenar por"
              value={orden}
              onChange={v => setOrden(v as typeof orden)}
              className="w-48"
            >
              {ORDENES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </SelectBox>

            <SelectBox label="Resultados por página" value={String(limit)} onChange={v => setLimit(Number(v))} className="w-36">
              {TAMANOS_PAGINA.map(n => <option key={n} value={n}>{n} por página</option>)}
            </SelectBox>

            <div className="relative grid grid-cols-2 rounded-xl bg-slate-100 p-1" role="group" aria-label="Tipo de vista">
              <span
                aria-hidden
                className={`absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-lg bg-white shadow-sm transition-transform duration-300 ease-out ${
                  vista === 'cuadricula' ? 'translate-x-full' : ''
                }`}
              />
              <button
                onClick={() => setVista('tabla')}
                aria-pressed={vista === 'tabla'}
                className={`relative z-10 flex h-9 w-24 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors ${focusRing} ${
                  vista === 'tabla' ? 'text-[#0B3D6E]' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Table2 size={14} /> Tabla
              </button>
              <button
                onClick={() => setVista('cuadricula')}
                aria-pressed={vista === 'cuadricula'}
                className={`relative z-10 flex h-9 w-24 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors ${focusRing} ${
                  vista === 'cuadricula' ? 'text-[#0B3D6E]' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <LayoutGrid size={14} /> Tarjetas
              </button>
            </div>
          </div>

          {loading && (
            <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-[#0B3D6E]/10">
              <div className="sx-bar h-full w-1/3 rounded-full bg-[#0B3D6E]" />
            </div>
          )}
        </div>

        {/* ============ RESULTADOS ============ */}
        {items.length === 0 && !loading ? (
          <div className="sx-fade flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-20 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <SearchX size={26} />
            </span>
            <div>
              <p className="text-base font-semibold text-slate-800">No hay procesos con estos filtros</p>
              <p className="mt-1 text-sm text-slate-500">Prueba con otra palabra clave o quita algún filtro.</p>
            </div>
            {chips.length > 0 && (
              <button
                onClick={limpiarTodo}
                className={`mt-1 inline-flex items-center gap-2 rounded-xl bg-[#0B3D6E] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0a3460] ${focusRing}`}
              >
                <RotateCcw size={14} /> Limpiar filtros
              </button>
            )}
          </div>
        ) : (
          <div className={`transition-opacity duration-200 ${loading && !primeraCarga ? 'opacity-60' : 'opacity-100'}`}>
            {/* ---------- tarjetas (vista cuadrícula y móvil) ---------- */}
            <div className={`${vista === 'tabla' ? 'md:hidden' : ''} grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4`}>
              {primeraCarga
                ? Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
                : items.map((p, i) => (
                    <div
                      key={p.ocid}
                      className="sx-rise transition-transform duration-300 hover:-translate-y-1"
                      style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}
                    >
                      <ContratoSeaceCard
                        proceso={p}
                        isLoading={false}
                        disabled={false}
                        onClick={() => abrirDetalle(p)}
                      />
                    </div>
                  ))}
            </div>

            {/* ---------- tabla (escritorio) ---------- */}
            {vista === 'tabla' && (
              <div className="hidden overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm md:block">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/80 text-xs font-semibold text-slate-500">
                        <th className="px-5 py-3.5">Proceso</th>
                        <th className="px-4 py-3.5">Entidad</th>
                        <th className="px-4 py-3.5">Objeto y modalidad</th>
                        <th className="px-4 py-3.5">Estado</th>
                        <th className="px-4 py-3.5">Publicación</th>
                        <th className="px-4 py-3.5 text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {primeraCarga
                        ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
                        : items.map((p, i) => {
                            const Icono = iconoCategoria(p.categoria)
                            const fav = favoritos.has(p.ocid)
                            const stripe = ESTADO_UI[p.estado ?? '']?.stripe ?? 'bg-slate-300'
                            return (
                              <tr
                                key={p.ocid}
                                onClick={() => abrirDetalle(p)}
                                className="sx-fade group cursor-pointer border-t border-slate-100 transition-colors duration-200 hover:bg-[#0B3D6E]/[0.035]"
                                style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                              >
                                <td className="relative px-5 py-4 align-top">
                                  <span
                                    className={`absolute inset-y-3 left-0 w-1 origin-center scale-y-50 rounded-r-full opacity-60 transition-all duration-300 group-hover:scale-y-100 group-hover:opacity-100 ${stripe}`}
                                  />
                                  <p className="font-semibold text-slate-900">{p.nomenclatura || p.tender_id || '—'}</p>
                                  <p className="mt-0.5 text-xs text-slate-400">
                                    N.º {(p.nomenclatura || p.tender_id)?.split('-')[1] || '—'}
                                  </p>
                                </td>

                                <td className="max-w-[260px] px-4 py-4 align-top">
                                  <p className="line-clamp-2 font-medium text-slate-700" title={p.entidad}>{p.entidad}</p>
                                  {(p.departamento || p.distrito) && (
                                    <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                                      <MapPin size={11} className="shrink-0" />
                                      <span className="truncate">{[p.distrito, p.departamento].filter(Boolean).join(', ')}</span>
                                    </p>
                                  )}
                                </td>

                                <td className="px-4 py-4 align-top">
                                  <p className="flex items-center gap-1.5 font-medium text-slate-700">
                                    <Icono size={14} className="text-slate-400" />
                                    {etiquetaCategoria(p.categoria)}
                                  </p>
                                  {p.modalidad && (
                                    <span className="mt-1.5 inline-flex w-fit rounded-full bg-[#0B3D6E]/[0.07] px-2.5 py-0.5 text-[11px] font-medium text-[#0B3D6E]">
                                      {p.modalidad}
                                    </span>
                                  )}
                                  <p className="mt-1.5 line-clamp-2 max-w-[300px] text-xs leading-relaxed text-slate-500" title={p.titulo}>
                                    {p.titulo}
                                  </p>
                                </td>

                                <td className="px-4 py-4 align-top">
                                  <div className="flex flex-col gap-1.5">
                                    <BadgeEstado estado={p.estado} />
                                    <BadgeOrigen origen={p.origen} />
                                  </div>
                                </td>

                                <td className="px-4 py-4 align-top text-xs text-slate-500">
                                  <p className="text-sm text-slate-600">{tiempoRelativo(p.published_date)}</p>
                                  {p.origen === 'scraper' && p.scraped_at && (
                                    <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-600">
                                      <Clock size={10} />
                                      Extraído {tiempoRelativo(p.scraped_at)}
                                    </p>
                                  )}
                                </td>

                                <td className="px-4 py-4 align-top" onClick={e => e.stopPropagation()}>
                                  <div className="flex items-center justify-end gap-1">
                                    <button
                                      title="Ver cronograma"
                                      aria-label={`Ver cronograma de ${p.tender_id}`}
                                      onClick={() => abrirDetalle(p)}
                                      className={iconBtn}
                                    >
                                      <History size={15} />
                                    </button>
                                    <button
                                      title="Descargar documentos"
                                      aria-label={`Descargar documentos de ${p.tender_id}`}
                                      onClick={() => handleDescargar(p)}
                                      className={iconBtn}
                                    >
                                      <Download size={15} />
                                    </button>
                                    <button
                                      title={fav ? 'Quitar de favoritos' : 'Guardar en favoritos'}
                                      aria-label={fav ? 'Quitar de favoritos' : 'Guardar en favoritos'}
                                      aria-pressed={fav}
                                      onClick={() => toggleFavorito(p.ocid)}
                                      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-amber-50 ${focusRing} ${
                                        fav ? 'text-[#F5B700]' : 'text-slate-400 hover:text-[#F5B700]'
                                      }`}
                                    >
                                      <Star key={String(fav)} size={15} fill={fav ? 'currentColor' : 'none'} className={fav ? 'sx-pop' : ''} />
                                    </button>
                                    <button
                                      onClick={() => abrirDetalle(p)}
                                      className={`ml-1 inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#0B3D6E] px-3 text-xs font-semibold text-white shadow-sm transition-all duration-200 hover:bg-[#0a3460] hover:shadow-md active:scale-95 ${focusRing}`}
                                    >
                                      <Eye size={14} />
                                      Ver detalle
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ============ PAGINACIÓN ============ */}
        {items.length > 0 && (
          <nav
            aria-label="Paginación"
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm"
          >
            <p className="text-sm text-slate-500">
              Mostrando <span className="font-semibold text-slate-800 tabular-nums">{(page - 1) * limit + 1}</span> a{' '}
              <span className="font-semibold text-slate-800 tabular-nums">{Math.min(page * limit, total)}</span> de{' '}
              <span className="font-semibold text-slate-800 tabular-nums">{total.toLocaleString('es-PE')}</span>
            </p>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                aria-label="Página anterior"
                className={`flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-[#0B3D6E] transition-all hover:border-[#0B3D6E] hover:bg-[#0B3D6E]/5 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-slate-200 disabled:hover:bg-transparent ${focusRing}`}
              >
                <ChevronLeft size={16} />
              </button>

              {paginasVisibles.map((p, i) =>
                p === '...' ? (
                  <span key={`dots-${i}`} className="w-8 text-center text-sm text-slate-400">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p as number)}
                    aria-current={page === p ? 'page' : undefined}
                    className={`h-9 min-w-9 rounded-lg px-2.5 text-sm font-semibold tabular-nums transition-all duration-200 active:scale-90 ${focusRing} ${
                      page === p
                        ? 'bg-[#0B3D6E] text-white shadow-md shadow-[#0B3D6E]/25'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {p}
                  </button>
                )
              )}

              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                aria-label="Página siguiente"
                className={`flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-[#0B3D6E] transition-all hover:border-[#0B3D6E] hover:bg-[#0B3D6E]/5 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-slate-200 disabled:hover:bg-transparent ${focusRing}`}
              >
                <ChevronRightIcon size={16} />
              </button>
            </div>
          </nav>
        )}
      </main>

      {/* ============ DRAWER, LOADER Y TOAST ============ */}
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

      {toast && (
        <div
          role="status"
          className={`sx-toast fixed bottom-6 right-6 z-[60] flex max-w-sm items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-2xl ${
            toast.tipo === 'error'
              ? 'border-rose-200 bg-rose-50 text-rose-800'
              : 'border-slate-200 bg-white text-slate-700'
          }`}
        >
          <span className="flex-1 leading-relaxed">{toast.msg}</span>
          <button
            onClick={() => setToast(null)}
            aria-label="Cerrar aviso"
            className={`mt-0.5 shrink-0 rounded text-slate-400 hover:text-slate-700 ${focusRing}`}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
