'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Bricolage_Grotesque } from 'next/font/google'
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, AreaChart, Area, LabelList,
} from 'recharts'
import {
  BarChart3, Building2, TrendingUp, AlertCircle, CheckCircle2, Clock, XCircle,
  Layers, MapPin, Package, CalendarRange, ShoppingBag, SlidersHorizontal,
  ChevronDown, Search, X, RotateCcw,
} from 'lucide-react'
import { SidebarTrigger } from '@/components/Sidebar'
import { getStatsContratos, type StatsContratos } from '@/lib/api'
import {
  getStatsEntidades, getStatsGeografia, getStatsProductos, getStatsTimeline, getStatsObjeto,
  getStatsProveedores,
  getOpcionesFiltro, getProvinciasPorDepartamento, getDistritosPorProvincia,
  buscarEntidades, buscarProveedores, buscarProductos,
  type EntidadStat, type GeografiaStat, type ProductoStat, type TimelineStat, type ObjetoStat,
  type ProveedorStat, type OpcionesFiltro,
} from '@/lib/api-stats'

/* ------------------------------------------------------------------ */
/*  Tipografía de títulos y cifras (si tu versión de Next no trae      */
/*  Bricolage_Grotesque, borra el import y pon                         */
/*  const fontDisplay = { className: '' }).                            */
/* ------------------------------------------------------------------ */
const fontDisplay = Bricolage_Grotesque({ subsets: ['latin'], display: 'swap' })

/* ------------------------------------------------------------------ */
/*  Colores                                                            */
/* ------------------------------------------------------------------ */
const NAVY = '#0B3D6E'
const GOLD = '#F5B700'

// Estados (iguales a los del resto de la plataforma)
const COLORS = { vigente: '#10b981', en_evaluacion: '#8b5cf6', culminado: '#f43f5e', otros: '#94a3b8' }
// Paleta de marca: azul PLADIBOT + dorado primero, luego acentos
const PALETTE = [NAVY, GOLD, '#3b82f6', '#10b981', '#8b5cf6', '#f43f5e', '#06b6d4', '#84cc16']

/* ------------------------------------------------------------------ */
/*  Tipos y constantes                                                 */
/* ------------------------------------------------------------------ */
type Filtros = {
  anio: string; estado: string; resultado: string; objeto: string
  entidad: string; proveedor: string
  departamento: string; provincia: string; distrito: string
  producto: string
}

const FILTROS_INICIALES: Filtros = {
  anio: 'todos', estado: 'todos', resultado: '', objeto: '',
  entidad: '', proveedor: '', departamento: '', provincia: '', distrito: '', producto: '',
}

const ESTADOS_LABEL: Record<string, string> = {
  vigente: 'Vigentes', en_evaluacion: 'En evaluación', culminado: 'Culminados',
}
const OBJETOS_LABEL: Record<string, string> = {
  '1': 'Bienes', '2': 'Servicios', '3': 'Obra', '4': 'Consultoría de obra',
}

/* ------------------------------------------------------------------ */
/*  Estilos                                                            */
/*  Container queries (.sx-cq): las grillas dependen del ANCHO REAL    */
/*  del contenido, así que se adaptan solas cuando el sidebar se       */
/*  contrae o se expande.                                              */
/* ------------------------------------------------------------------ */
const ESTILOS = `
.sx-root{--sx-ease:cubic-bezier(.22,1,.36,1)}
@keyframes sx-shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}
.sx-skel{background:linear-gradient(90deg,#e8eef5 25%,#f6f9fc 50%,#e8eef5 75%);background-size:800px 100%;animation:sx-shimmer 1.4s linear infinite}
@keyframes sx-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.sx-rise{opacity:0;animation:sx-rise .5s var(--sx-ease) forwards}
@keyframes sx-fade{from{opacity:0}to{opacity:1}}
.sx-fade{opacity:0;animation:sx-fade .3s ease forwards}
@keyframes sx-bar{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}
.sx-bar{animation:sx-bar 1.1s ease-in-out infinite}
@keyframes sx-hero{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.sx-hero-a{opacity:0;animation:sx-hero .6s var(--sx-ease) .05s forwards}
.sx-dots{background-image:radial-gradient(rgba(255,255,255,.09) 1px,transparent 1px);background-size:20px 20px}

.sx-cq{container-type:inline-size}

.sx-kpi-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}
@container (min-width:640px){.sx-kpi-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@container (min-width:1280px){.sx-kpi-grid{grid-template-columns:repeat(6,minmax(0,1fr));gap:1rem}}

.sx-charts{display:grid;grid-template-columns:minmax(0,1fr);gap:1rem}
@container (min-width:760px){.sx-charts{grid-template-columns:repeat(2,minmax(0,1fr))}}
@container (min-width:1180px){.sx-charts{grid-template-columns:repeat(3,minmax(0,1fr))}}
.sx-span-all{grid-column:1 / -1}

@media (prefers-reduced-motion:reduce){
  .sx-root *,.sx-root *::before,.sx-root *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;transition-delay:0s!important}
}
`

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B3D6E] focus-visible:ring-offset-2'

// text-base en móvil evita el zoom automático de iOS al enfocar un campo
const ctl =
  'h-10 w-full rounded-xl border px-3 text-base transition focus:outline-none focus:ring-4 focus:ring-[#0B3D6E]/10 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-300 sm:text-sm'
const ctlIdle = 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 focus:border-[#0B3D6E]'
// Filtro activo: resaltado fijo (antes parpadeaba)
const ctlOn = 'border-[#0B3D6E] bg-[#0B3D6E]/[0.04] font-medium text-[#0B3D6E] ring-2 ring-[#0B3D6E]/15'

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function truncate(str: string, max: number) {
  if (!str) return ''
  return str.length > max ? str.slice(0, max - 1) + '…' : str
}

function formatPeriodo(periodo: string) {
  const [anio, mes] = periodo.split('-')
  const nombres = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  const idx = parseInt(mes, 10) - 1
  return `${nombres[idx] ?? mes} ${anio.slice(2)}`
}

const fmt = (n: number) => n.toLocaleString('es-PE')
const fmtPct = (n: number) => `${n.toLocaleString('es-PE', { maximumFractionDigits: 1 })}%`

// Ancho del eje Y y cantidad de caracteres según el ancho real de la tarjeta
function ejeY(ancho: number, max = 190) {
  const base = ancho || 420
  const width = Math.max(92, Math.min(max, Math.round(base * 0.38)))
  return { width, chars: Math.max(10, Math.floor((width - 12) / 6)) }
}

function useAncho<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [ancho, setAncho] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setAncho(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, ancho] as const
}

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
  return <>{fmt(v)}</>
}

/* ------------------------------------------------------------------ */
/*  Piezas de los gráficos                                             */
/* ------------------------------------------------------------------ */
// Tick del eje Y: trunca según el ancho disponible y muestra el nombre completo al pasar el mouse
function TruncatedTick({ x, y, payload, maxChars = 22 }: any) {
  const full = String(payload.value)
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill="#475569" fontSize={11}>
      <title>{full}</title>
      {truncate(full, maxChars)}
    </text>
  )
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const titulo = payload[0]?.payload?.nombreCompleto ?? label
  return (
    <div className="max-w-xs rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-xl shadow-slate-900/10">
      {titulo && <p className="mb-1 break-words font-bold text-slate-800">{titulo}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} className="flex items-center gap-1.5" style={{ color: p.color || p.fill }}>
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color || p.fill }} />
          {p.name}: <span className="font-bold tabular-nums text-slate-700">{fmt(Number(p.value))}</span>
        </p>
      ))}
    </div>
  )
}

function ChartSkeleton() {
  const anchos = ['92%', '78%', '66%', '58%', '47%', '39%', '31%', '24%']
  return (
    <div className="flex h-[260px] flex-col justify-center gap-3 px-3" aria-hidden="true">
      {anchos.map((w, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="sx-skel h-3 w-16 shrink-0 rounded" />
          <div className="sx-skel h-3.5 rounded" style={{ width: w }} />
        </div>
      ))}
    </div>
  )
}

function ChartCard({
  title, icon, children, skeleton, refreshing, empty, right, className = '',
}: {
  title: string
  icon: ReactNode
  children: ReactNode | ((ancho: number) => ReactNode)
  skeleton: boolean
  refreshing: boolean
  empty?: boolean
  right?: ReactNode
  className?: string
}) {
  const [ref, ancho] = useAncho<HTMLDivElement>()
  return (
    <section className={`flex min-w-0 flex-col rounded-2xl border border-slate-200/80 bg-white shadow-sm ${className}`}>
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-2 px-4 pt-4 sm:px-5 sm:pt-5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0B3D6E]/[0.07] text-[#0B3D6E]">
          {icon}
        </span>
        <h2 className={`${fontDisplay.className} min-w-0 flex-1 basis-40 text-[15px] font-bold leading-snug text-slate-800`}>{title}</h2>
        {right}
      </header>

      <div
        ref={ref}
        className={`min-w-0 flex-1 px-2 pb-3 pt-3 transition-opacity duration-200 sm:px-3 ${refreshing ? 'opacity-50' : 'opacity-100'}`}
      >
        {skeleton ? (
          <ChartSkeleton />
        ) : empty ? (
          <div className="flex h-[260px] flex-col items-center justify-center gap-2 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <AlertCircle size={22} />
            </span>
            <p className="text-sm font-medium text-slate-600">Sin datos para mostrar</p>
            <p className="text-xs text-slate-400">Prueba quitando algún filtro.</p>
          </div>
        ) : typeof children === 'function' ? (
          children(ancho)
        ) : (
          children
        )}
      </div>
    </section>
  )
}

// Leyenda con valores y porcentajes (debajo de las dona)
function LeyendaLista({ items }: { items: { name: string; value: number; color: string }[] }) {
  const total = items.reduce((a, b) => a + b.value, 0)
  return (
    <ul className="mt-3 space-y-1.5 px-1.5 sm:px-2">
      {items.map((it, i) => (
        <li key={i} className="flex items-center gap-2 text-sm">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: it.color }} />
          <span className="min-w-0 flex-1 truncate text-slate-600" title={it.name}>{it.name}</span>
          <span className="font-semibold tabular-nums text-slate-800">{fmt(it.value)}</span>
          <span className="w-12 text-right text-xs tabular-nums text-slate-400">
            {total > 0 ? fmtPct((it.value / total) * 100) : '—'}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Dona({
  data, dataKey, nameKey, colorFor, centro,
}: {
  data: any[]
  dataKey: string
  nameKey: string
  colorFor: (d: any, i: number) => string
  centro: { valor: number; texto: string }
}) {
  return (
    <div className="relative h-[170px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey={dataKey}
            nameKey={nameKey}
            innerRadius={54}
            outerRadius={80}
            paddingAngle={3}
            stroke="#fff"
            strokeWidth={2}
          >
            {data.map((d, i) => <Cell key={i} fill={colorFor(d, i)} />)}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className={`${fontDisplay.className} text-2xl font-extrabold tabular-nums leading-none text-slate-800`}>
          {fmt(centro.valor)}
        </span>
        <span className="mt-1 text-[11px] text-slate-400">{centro.texto}</span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  KPIs                                                               */
/* ------------------------------------------------------------------ */
function KpiCard({
  label, value, icon, chip, bar, loading, caption, pct, active, onClick,
}: {
  label: string
  value: number
  icon: ReactNode
  chip: string
  bar: string
  loading: boolean
  caption?: string
  pct?: number
  active?: boolean
  onClick?: () => void
}) {
  const contenido = (
    <>
      <span className="flex items-center gap-2.5">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${chip}`}>{icon}</span>
        <span className="min-w-0 truncate text-sm font-medium text-slate-500">{label}</span>
      </span>

      <span className={`${fontDisplay.className} block truncate text-3xl font-bold tabular-nums leading-none text-slate-800`}>
        {loading ? <span className="sx-skel inline-block h-7 w-20 rounded" /> : <Num value={value} />}
      </span>

      {pct != null ? (
        <span className="block">
          <span className="block h-1.5 overflow-hidden rounded-full bg-slate-100">
            <span
              className={`block h-full rounded-full transition-[width] duration-700 ease-out ${bar}`}
              style={{ width: `${loading ? 0 : Math.min(100, pct)}%` }}
            />
          </span>
          <span className="mt-1.5 block text-xs tabular-nums text-slate-400">
            {loading ? '—' : `${fmtPct(pct)} del total`}
          </span>
        </span>
      ) : (
        <span className="block text-xs text-slate-400">{caption}</span>
      )}

      {onClick && (
        <span
          aria-hidden="true"
          className={`absolute inset-x-0 bottom-0 h-[3px] origin-left transition-transform duration-300 ease-out ${bar} ${active ? 'scale-x-100' : 'scale-x-0'}`}
        />
      )}
    </>
  )

  const base = 'relative flex min-w-0 flex-col gap-3 overflow-hidden rounded-2xl border bg-white p-4 text-left shadow-sm'
  const borde = active ? 'border-[#0B3D6E]/30 ring-2 ring-[#0B3D6E]/10' : 'border-slate-200/80'

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={`${base} ${borde} transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${focusRing}`}
      >
        {contenido}
      </button>
    )
  }
  return <div className={`${base} ${borde}`}>{contenido}</div>
}

/* ------------------------------------------------------------------ */
/*  Controles de filtro                                                */
/* ------------------------------------------------------------------ */
function SelectField({
  label, value, onChange, children, disabled = false, activo = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  children: ReactNode
  disabled?: boolean
  activo?: boolean
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <span className="relative block">
        <select
          value={value}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
          className={`${ctl} cursor-pointer appearance-none pr-8 ${activo ? ctlOn : ctlIdle}`}
        >
          {children}
        </select>
        <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
      </span>
    </label>
  )
}

function AutocompleteFiltro({
  label, value, onChange, buscar, placeholder, activo = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  buscar: (q: string) => Promise<string[]>
  placeholder: string
  activo?: boolean
}) {
  const [texto, setTexto] = useState(value)
  const [sugerencias, setSugerencias] = useState<string[]>([])
  const [abierto, setAbierto] = useState(false)
  const [indice, setIndice] = useState(-1)
  // Evita que, al elegir una sugerencia, el buscador vuelva a abrir la lista
  const seleccionado = useRef<string | null>(null)
  const listaId = useId()

  useEffect(() => { setTexto(value) }, [value])

  useEffect(() => {
    const timeout = setTimeout(() => {
      onChange(texto)
      if (texto.trim().length >= 2) {
        if (texto === seleccionado.current) return
        buscar(texto)
          .then(r => { setSugerencias(r); setAbierto(true); setIndice(-1) })
          .catch(() => {})
      } else {
        setSugerencias([])
      }
    }, 400)
    return () => clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto])

  const elegir = (s: string) => {
    seleccionado.current = s
    setTexto(s)
    onChange(s)
    setAbierto(false)
    setSugerencias([])
    setIndice(-1)
  }

  const limpiar = () => {
    seleccionado.current = null
    setTexto('')
    onChange('')
    setSugerencias([])
    setAbierto(false)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && sugerencias.length) {
      e.preventDefault()
      setAbierto(true)
      setIndice(i => (i + 1) % sugerencias.length)
    } else if (e.key === 'ArrowUp' && sugerencias.length) {
      e.preventDefault()
      setIndice(i => (i <= 0 ? sugerencias.length - 1 : i - 1))
    } else if (e.key === 'Enter' && abierto && indice >= 0) {
      e.preventDefault()
      elegir(sugerencias[indice])
    } else if (e.key === 'Escape') {
      setAbierto(false)
    }
  }

  const mostrarLista = abierto && sugerencias.length > 0

  return (
    <div className="relative min-w-0">
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={texto}
          onChange={e => { seleccionado.current = null; setTexto(e.target.value) }}
          onFocus={() => sugerencias.length && setAbierto(true)}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={mostrarLista}
          aria-controls={listaId}
          aria-autocomplete="list"
          autoComplete="off"
          className={`${ctl} pl-9 pr-9 ${activo ? ctlOn : ctlIdle} placeholder:font-normal placeholder:text-slate-400`}
        />
        {texto && (
          <button
            type="button"
            onClick={limpiar}
            aria-label={`Borrar ${label.toLowerCase()}`}
            className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-600"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {mostrarLista && (
        <ul
          id={listaId}
          role="listbox"
          className="sx-fade absolute left-0 top-full z-30 mt-1.5 max-h-56 w-full min-w-[15rem] overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl shadow-slate-900/10"
        >
          {sugerencias.map((s, i) => (
            <li
              key={s}
              role="option"
              aria-selected={i === indice}
              onMouseDown={() => elegir(s)}
              onMouseEnter={() => setIndice(i)}
              className={`cursor-pointer px-3 py-2 text-sm ${i === indice ? 'bg-[#0B3D6E]/[0.07] text-[#0B3D6E]' : 'text-slate-700 hover:bg-slate-50'}`}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function GrupoFiltros({
  titulo, icono, basis, children,
}: {
  titulo: string
  icono: ReactNode
  basis: string
  children: ReactNode
}) {
  return (
    <fieldset className={`min-w-0 rounded-xl bg-slate-50/70 p-3 ring-1 ring-inset ring-slate-100 ${basis}`}>
      <legend className="sr-only">{titulo}</legend>
      <p className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold text-[#0B3D6E]">
        {icono}
        {titulo}
      </p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-3">{children}</div>
    </fieldset>
  )
}

/* ------------------------------------------------------------------ */
/*  Página                                                             */
/* ------------------------------------------------------------------ */
export default function EstadisticasPage() {
  const [stats, setStats] = useState<StatsContratos | null>(null)
  const [entidades, setEntidades] = useState<EntidadStat[]>([])
  const [geografia, setGeografia] = useState<GeografiaStat[]>([])
  const [productos, setProductos] = useState<ProductoStat[]>([])
  const [timeline, setTimeline] = useState<TimelineStat[]>([])
  const [objeto, setObjeto] = useState<ObjetoStat[]>([])
  const [proveedores, setProveedores] = useState<ProveedorStat[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filtros
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_INICIALES)
  const [soloAdjudicados, setSoloAdjudicados] = useState(false)
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false)
  const [opciones, setOpciones] = useState<OpcionesFiltro | null>(null)
  const [provinciasDisp, setProvinciasDisp] = useState<string[]>([])
  const [distritosDisp, setDistritosDisp] = useState<string[]>([])

  // Si el valor no cambió devuelve el mismo objeto: así no se dispara una recarga de datos innecesaria
  const setFiltro = useCallback((k: keyof Filtros, v: string) => {
    setFiltros(f => (f[k] === v ? f : { ...f, [k]: v }))
  }, [])

  const setEstado = useCallback((v: string) => {
    setFiltros(f => (f.estado === v && f.resultado === '' ? f : { ...f, estado: v, resultado: '' }))
  }, [])

  useEffect(() => { getOpcionesFiltro().then(setOpciones).catch(() => {}) }, [])

  // Cascada: al cambiar departamento, recarga provincias y limpia provincia/distrito
  useEffect(() => {
    if (!filtros.departamento) {
      setProvinciasDisp([])
      setDistritosDisp([])
      setFiltros(f => (f.provincia || f.distrito ? { ...f, provincia: '', distrito: '' } : f))
      return
    }
    let cancelado = false
    getProvinciasPorDepartamento(filtros.departamento)
      .then(r => { if (!cancelado) setProvinciasDisp(r) })
      .catch(() => { if (!cancelado) setProvinciasDisp([]) })
    setFiltros(f => (f.provincia || f.distrito ? { ...f, provincia: '', distrito: '' } : f))
    return () => { cancelado = true }
  }, [filtros.departamento])

  // Cascada: distritos del departamento (o de la provincia elegida) y limpia distrito
  useEffect(() => {
    if (!filtros.departamento) return
    let cancelado = false
    getDistritosPorProvincia(filtros.departamento, filtros.provincia || undefined)
      .then(r => { if (!cancelado) setDistritosDisp(r) })
      .catch(() => { if (!cancelado) setDistritosDisp([]) })
    setFiltros(f => (f.distrito ? { ...f, distrito: '' } : f))
    return () => { cancelado = true }
  }, [filtros.departamento, filtros.provincia])

  const anioOptions = useMemo(() => {
    const actual = new Date().getFullYear()
    const arr = [{ value: 'todos', label: 'Todos los años' }]
    for (let y = actual; y >= actual - 6; y--) arr.push({ value: String(y), label: String(y) })
    return arr
  }, [])

  // Carga de datos (ignora respuestas viejas si el usuario cambia filtros rápido)
  const reqId = useRef(0)
  const cargar = useCallback(async () => {
    const id = ++reqId.current
    setLoading(true)
    setError(null)
    try {
      const f = {
        anio: filtros.anio !== 'todos' ? parseInt(filtros.anio, 10) : undefined,
        estado: filtros.estado !== 'todos' ? filtros.estado : undefined,
        resultado: filtros.resultado || undefined,
        objeto: filtros.objeto ? parseInt(filtros.objeto, 10) : undefined,
        entidad: filtros.entidad || undefined,
        proveedor: filtros.proveedor || undefined,
        departamento: filtros.departamento || undefined,
        provincia: filtros.provincia || undefined,
        distrito: filtros.distrito || undefined,
        producto: filtros.producto || undefined,
      }
      const [s, ent, geo, prod, tl, obj, prov] = await Promise.all([
        getStatsContratos(f),
        getStatsEntidades({ limit: 10, ...f }),
        getStatsGeografia({ limit: 10, ...f }),
        getStatsProductos({ limit: 10, solo_adjudicados: soloAdjudicados, ...f }),
        getStatsTimeline(f),
        getStatsObjeto(f),
        getStatsProveedores({ limit: 10, ...f }),
      ])
      if (id !== reqId.current) return
      setStats(s); setEntidades(ent); setGeografia(geo)
      setProductos(prod); setTimeline(tl); setObjeto(obj); setProveedores(prov)
    } catch {
      if (id === reqId.current) setError('No se pudo conectar al backend. Verifica que la API esté disponible.')
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [filtros, soloAdjudicados])

  useEffect(() => { cargar() }, [cargar])

  /* ---------- derivados ---------- */
  const primeraCarga = loading && !stats
  const refrescando = loading && !primeraCarga

  const estadoData = stats ? [
    { name: 'Vigentes',    value: stats.vigentes,      color: COLORS.vigente },
    { name: 'Evaluación',  value: stats.en_evaluacion, color: COLORS.en_evaluacion },
    { name: 'Culminados',  value: stats.culminados,    color: COLORS.culminado },
  ] : []
  const totalEstados = estadoData.reduce((a, b) => a + b.value, 0)

  const entidadesChartData = entidades.map(e => ({
    ...e,
    nombreCorto: e.nom_entidad,
    nombreCompleto: e.nom_entidad,
  }))

  const timelineChartData = timeline.map(t => ({ ...t, periodoCorto: formatPeriodo(t.periodo) }))

  const totalBase = stats?.total ?? 0
  const pct = (v: number) => (totalBase > 0 ? (v / totalBase) * 100 : 0)

  const esAdjudicados = filtros.estado === 'culminado' && filtros.resultado === 'adjudicado'

  const filtrosActivos = [
    filtros.anio !== 'todos', filtros.estado !== 'todos', filtros.resultado, filtros.objeto,
    filtros.entidad, filtros.proveedor, filtros.producto,
    filtros.departamento, filtros.provincia, filtros.distrito,
  ].filter(Boolean).length

  const chips = useMemo(() => {
    const c: { id: string; label: string; clear: () => void }[] = []
    if (filtros.anio !== 'todos') c.push({ id: 'anio', label: `Año: ${filtros.anio}`, clear: () => setFiltro('anio', 'todos') })
    if (filtros.estado !== 'todos') c.push({ id: 'estado', label: `Estado: ${ESTADOS_LABEL[filtros.estado] ?? filtros.estado}`, clear: () => setEstado('todos') })
    if (filtros.resultado) c.push({ id: 'resultado', label: filtros.resultado === 'adjudicado' ? 'Adjudicados' : 'Desiertos', clear: () => setFiltro('resultado', '') })
    if (filtros.objeto) c.push({ id: 'objeto', label: `Tipo: ${OBJETOS_LABEL[filtros.objeto] ?? filtros.objeto}`, clear: () => setFiltro('objeto', '') })
    if (filtros.entidad) c.push({ id: 'entidad', label: `Entidad: ${filtros.entidad}`, clear: () => setFiltro('entidad', '') })
    if (filtros.proveedor) c.push({ id: 'proveedor', label: `Proveedor: ${filtros.proveedor}`, clear: () => setFiltro('proveedor', '') })
    if (filtros.producto) c.push({ id: 'producto', label: `Producto: ${filtros.producto}`, clear: () => setFiltro('producto', '') })
    if (filtros.departamento) c.push({ id: 'depto', label: filtros.departamento, clear: () => setFiltro('departamento', '') })
    if (filtros.provincia) c.push({ id: 'prov', label: filtros.provincia, clear: () => setFiltro('provincia', '') })
    if (filtros.distrito) c.push({ id: 'dist', label: filtros.distrito, clear: () => setFiltro('distrito', '') })
    return c
  }, [filtros, setFiltro, setEstado])

  const limpiarTodo = () => setFiltros(FILTROS_INICIALES)

  /* ---------------------------------------------------------------- */
  return (
    <div className="sx-root min-h-screen bg-[#F3F6FA] pb-16" style={{ minHeight: '100dvh' }}>
      <style dangerouslySetInnerHTML={{ __html: ESTILOS }} />

      {/* =============================== HEADER COMPACTO =============================== */}
      <header className="sx-dots relative overflow-hidden bg-[#0B3D6E]">
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#F5B700]/60 to-transparent" />
        <div className="sx-hero-a flex w-full items-center gap-3 px-3 pb-10 pt-4 sm:px-4 lg:px-6 2xl:px-8">
          <SidebarTrigger className="shrink-0 text-white lg:hidden" />
          <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F5B700] text-[#0B3D6E] sm:flex">
            <BarChart3 size={19} />
          </span>
          <div className="min-w-0">
            <h1 className={`${fontDisplay.className} text-xl font-extrabold leading-tight tracking-tight text-white sm:text-2xl lg:text-3xl`}>
              Estadísticas
            </h1>
            <p className="mt-0.5 hidden truncate text-sm text-blue-100/85 md:block">
              Panorama general de contratos
            </p>
          </div>
        </div>
      </header>

      {/* Contenido a ancho completo (se estira cuando el sidebar se contrae) */}
      <div className="sx-cq relative z-10 -mt-5 w-full space-y-4 px-3 sm:space-y-5 sm:px-4 lg:px-6 2xl:px-8">

        {/* ERROR */}
        {error && (
          <div role="alert" className="sx-fade flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <AlertCircle size={16} className="shrink-0" />
            <span className="min-w-0 flex-1">{error}</span>
            <button onClick={cargar} className={`rounded-md px-2 py-1.5 text-xs font-semibold underline hover:bg-rose-100 ${focusRing}`}>
              Reintentar
            </button>
          </div>
        )}

        {/* ============ FILTROS ============ */}
        <section
          aria-label="Filtros"
          className="relative z-20 rounded-2xl border border-slate-200/80 bg-white shadow-xl shadow-slate-900/5"
        >
          {loading && (
            <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden rounded-t-2xl bg-[#0B3D6E]/10">
              <div className="sx-bar h-full w-1/3 rounded-full bg-[#0B3D6E]" />
            </div>
          )}

          <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0B3D6E]/[0.07] text-[#0B3D6E]">
              <SlidersHorizontal size={16} />
            </span>
            <div className="min-w-0">
              <p className={`${fontDisplay.className} text-sm font-bold text-slate-800`}>Filtros</p>
              <p className="hidden truncate text-xs text-slate-500 sm:block">
                Los KPIs y los gráficos se actualizan al cambiar cualquier filtro
              </p>
            </div>
            {filtrosActivos > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#0B3D6E] px-1.5 text-xs font-bold text-white">
                {filtrosActivos}
              </span>
            )}
            <button
              type="button"
              onClick={() => setFiltrosAbiertos(v => !v)}
              aria-expanded={filtrosAbiertos}
              className={`ml-auto flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 lg:hidden ${focusRing}`}
            >
              {filtrosAbiertos ? 'Ocultar' : 'Mostrar'}
              <ChevronDown size={15} className={`transition-transform duration-300 ${filtrosAbiertos ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {/* Cuerpo: siempre visible en pantallas grandes, desplegable en móvil/tablet */}
          <div className={`${filtrosAbiertos ? 'block' : 'hidden'} lg:block`}>
            <div className="flex flex-wrap gap-3 border-t border-slate-100 p-3 sm:p-4">

              <GrupoFiltros titulo="Periodo y tipo" icono={<CalendarRange size={13} />} basis="flex-[2_1_300px]">
                <SelectField label="Año" value={filtros.anio} onChange={v => setFiltro('anio', v)} activo={filtros.anio !== 'todos'}>
                  {anioOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </SelectField>

                <SelectField label="Estado" value={filtros.estado} onChange={setEstado} activo={filtros.estado !== 'todos'}>
                  <option value="todos">Todos</option>
                  <option value="vigente">Vigentes</option>
                  <option value="en_evaluacion">En evaluación</option>
                  <option value="culminado">Culminados</option>
                </SelectField>

                <SelectField label="Tipo" value={filtros.objeto} onChange={v => setFiltro('objeto', v)} activo={!!filtros.objeto}>
                  <option value="">Todo tipo</option>
                  <option value="1">Bienes</option>
                  <option value="2">Servicios</option>
                  <option value="3">Obra</option>
                  <option value="4">Consultoría de Obra</option>
                </SelectField>

                {filtros.estado === 'culminado' && (
                  <SelectField label="Resultado" value={filtros.resultado} onChange={v => setFiltro('resultado', v)} activo={!!filtros.resultado}>
                    <option value="">Todos</option>
                    <option value="adjudicado">Adjudicados</option>
                    <option value="desierto">Desiertos</option>
                  </SelectField>
                )}
              </GrupoFiltros>

              <GrupoFiltros titulo="Búsqueda" icono={<Search size={13} />} basis="flex-[3_1_420px]">
                <AutocompleteFiltro
                  label="Entidad"
                  value={filtros.entidad}
                  onChange={v => setFiltro('entidad', v)}
                  buscar={buscarEntidades}
                  placeholder="Buscar entidad..."
                  activo={!!filtros.entidad}
                />
                <AutocompleteFiltro
                  label="Proveedor"
                  value={filtros.proveedor}
                  onChange={v => setFiltro('proveedor', v)}
                  buscar={buscarProveedores}
                  placeholder="Buscar proveedor..."
                  activo={!!filtros.proveedor}
                />
                <AutocompleteFiltro
                  label="Producto"
                  value={filtros.producto}
                  onChange={v => setFiltro('producto', v)}
                  buscar={buscarProductos}
                  placeholder="Buscar producto..."
                  activo={!!filtros.producto}
                />
              </GrupoFiltros>

              <GrupoFiltros titulo="Ubicación" icono={<MapPin size={13} />} basis="flex-[3_1_420px]">
                <SelectField label="Departamento" value={filtros.departamento} onChange={v => setFiltro('departamento', v)} activo={!!filtros.departamento}>
                  <option value="">Todos</option>
                  {opciones?.departamentos.map(d => <option key={d} value={d}>{d}</option>)}
                </SelectField>

                <SelectField label="Provincia" value={filtros.provincia} onChange={v => setFiltro('provincia', v)} disabled={!filtros.departamento} activo={!!filtros.provincia}>
                  <option value="">{filtros.departamento ? 'Todas' : '—'}</option>
                  {provinciasDisp.map(p => <option key={p} value={p}>{p}</option>)}
                </SelectField>

                <SelectField label="Distrito" value={filtros.distrito} onChange={v => setFiltro('distrito', v)} disabled={!filtros.departamento} activo={!!filtros.distrito}>
                  <option value="">{filtros.departamento ? 'Todos' : '—'}</option>
                  {distritosDisp.map(d => <option key={d} value={d}>{d}</option>)}
                </SelectField>
              </GrupoFiltros>
            </div>
          </div>

          {/* filtros aplicados */}
          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-3 py-3 sm:px-4">
              <span className="text-xs font-medium text-slate-400">Aplicados</span>
              {chips.map(c => (
                <button
                  key={c.id}
                  onClick={c.clear}
                  aria-label={`Quitar filtro: ${c.label}`}
                  className={`sx-fade group inline-flex max-w-full items-center gap-1.5 rounded-full bg-[#0B3D6E]/[0.07] py-1.5 pl-3 pr-2 text-xs font-medium text-[#0B3D6E] transition-colors hover:bg-rose-50 hover:text-rose-600 sm:max-w-[260px] sm:py-1 ${focusRing}`}
                >
                  <span className="truncate">{c.label}</span>
                  <X size={13} className="shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
                </button>
              ))}
              <button
                onClick={limpiarTodo}
                className={`ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#0B3D6E] sm:py-1.5 ${focusRing}`}
              >
                <RotateCcw size={12} />
                Limpiar filtros
              </button>
            </div>
          )}
        </section>

        {/* ============ KPIs ============ */}
        <div className="sx-kpi-grid">
          <KpiCard
            label="Total" value={stats?.total ?? 0} loading={primeraCarga}
            icon={<Layers size={17} />} chip="bg-slate-100 text-slate-600" bar="bg-[#0B3D6E]"
            caption="Con los filtros actuales"
            active={filtros.estado === 'todos'} onClick={() => setEstado('todos')}
          />
          <KpiCard
            label="Vigentes" value={stats?.vigentes ?? 0} loading={primeraCarga} pct={pct(stats?.vigentes ?? 0)}
            icon={<CheckCircle2 size={17} />} chip="bg-emerald-100 text-emerald-600" bar="bg-emerald-500"
            active={filtros.estado === 'vigente'} onClick={() => setEstado(filtros.estado === 'vigente' ? 'todos' : 'vigente')}
          />
          <KpiCard
            label="En evaluación" value={stats?.en_evaluacion ?? 0} loading={primeraCarga} pct={pct(stats?.en_evaluacion ?? 0)}
            icon={<Clock size={17} />} chip="bg-violet-100 text-violet-600" bar="bg-violet-500"
            active={filtros.estado === 'en_evaluacion'} onClick={() => setEstado(filtros.estado === 'en_evaluacion' ? 'todos' : 'en_evaluacion')}
          />
          <KpiCard
            label="Culminados" value={stats?.culminados ?? 0} loading={primeraCarga} pct={pct(stats?.culminados ?? 0)}
            icon={<XCircle size={17} />} chip="bg-rose-100 text-rose-600" bar="bg-rose-500"
            active={filtros.estado === 'culminado'} onClick={() => setEstado(filtros.estado === 'culminado' ? 'todos' : 'culminado')}
          />
          <KpiCard
            label="Otros estados" value={(stats as any)?.otros ?? 0} loading={primeraCarga} pct={pct((stats as any)?.otros ?? 0)}
            icon={<AlertCircle size={17} />} chip="bg-amber-100 text-amber-600" bar="bg-amber-500"
          />
          <KpiCard
            label="Con cotización" value={(stats as any)?.con_cotizar ?? 0} loading={primeraCarga} pct={pct((stats as any)?.con_cotizar ?? 0)}
            icon={<ShoppingBag size={17} />} chip="bg-blue-100 text-blue-600" bar="bg-blue-500"
          />
        </div>

        {/* ============ GRÁFICOS ============ */}
        <div className="sx-charts">

          {/* 1 · Top entidades */}
          <ChartCard
            title="Top entidades que más contratan"
            icon={<TrendingUp size={16} />}
            skeleton={primeraCarga}
            refreshing={refrescando}
            empty={!entidadesChartData.length}
          >
            {(ancho: number) => {
              const eje = ejeY(ancho)
              return (
                <>
                  <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 px-2 text-xs text-slate-500">
                    {[
                      ['Vigentes', COLORS.vigente],
                      ['En evaluación', COLORS.en_evaluacion],
                      ['Culminados', COLORS.culminado],
                    ].map(([n, c]) => (
                      <li key={n} className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: c }} />
                        {n}
                      </li>
                    ))}
                  </ul>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={entidadesChartData} layout="vertical" margin={{ left: 4, right: 34, top: 2, bottom: 2 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                      <XAxis type="number" tick={{ fontSize: 10 }} stroke="#94a3b8" allowDecimals={false} />
                      <YAxis
                        type="category" dataKey="nombreCorto" width={eje.width}
                        tick={<TruncatedTick maxChars={eje.chars} />} stroke="#94a3b8" interval={0}
                      />
                      <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f1f5f9' }} />
                      <Bar dataKey="vigentes" stackId="a" name="Vigentes" fill={COLORS.vigente} maxBarSize={22} />
                      <Bar dataKey="en_evaluacion" stackId="a" name="En evaluación" fill={COLORS.en_evaluacion} maxBarSize={22} />
                      <Bar dataKey="culminados" stackId="a" name="Culminados" fill={COLORS.culminado} radius={[0, 6, 6, 0]} maxBarSize={22}>
                        <LabelList dataKey="total" position="right" style={{ fontSize: 10, fontWeight: 700, fill: '#334155' }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </>
              )
            }}
          </ChartCard>

          {/* 2 · Distribución por estado */}
          <ChartCard
            title="Distribución por estado"
            icon={<Building2 size={16} />}
            skeleton={primeraCarga}
            refreshing={refrescando}
            empty={!estadoData.some(d => d.value > 0)}
          >
            <div className="pt-2">
              <Dona
                data={estadoData}
                dataKey="value"
                nameKey="name"
                colorFor={d => d.color}
                centro={{ valor: totalEstados, texto: 'contratos' }}
              />
              <LeyendaLista items={estadoData} />
            </div>
          </ChartCard>

          {/* 3 · Ranking de proveedores adjudicados / Evolución mensual */}
          {esAdjudicados ? (
            <ChartCard
              title="Ranking de proveedores adjudicados"
              icon={<TrendingUp size={16} />}
              skeleton={primeraCarga}
              refreshing={refrescando}
              empty={!proveedores.length}
            >
              {(ancho: number) => {
                const eje = ejeY(ancho, 170)
                return (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart
                      data={proveedores.map(p => ({ ...p, nombreCorto: p.proveedor, nombreCompleto: p.proveedor }))}
                      layout="vertical" margin={{ left: 4, right: 34, top: 2, bottom: 2 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                      <XAxis type="number" tick={{ fontSize: 10 }} stroke="#94a3b8" allowDecimals={false} />
                      <YAxis
                        type="category" dataKey="nombreCorto" width={eje.width}
                        tick={<TruncatedTick maxChars={eje.chars} />} stroke="#94a3b8" interval={0}
                      />
                      <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f1f5f9' }} />
                      <Bar dataKey="adjudicados" name="Adjudicados" fill={COLORS.vigente} radius={[0, 6, 6, 0]} maxBarSize={22}>
                        <LabelList dataKey="adjudicados" position="right" style={{ fontSize: 10, fontWeight: 700, fill: '#334155' }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )
              }}
            </ChartCard>
          ) : (
            <ChartCard
              title="Evolución mensual de publicaciones"
              icon={<CalendarRange size={16} />}
              skeleton={primeraCarga}
              refreshing={refrescando}
              empty={!timeline.length}
            >
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={timelineChartData} margin={{ left: -10, right: 20, top: 8 }}>
                  <defs>
                    <linearGradient id="colorTotalGrid" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={NAVY} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={NAVY} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="periodoCorto" tick={{ fontSize: 10 }} stroke="#94a3b8" interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone" dataKey="total" name="Contratos publicados"
                    stroke={NAVY} fill="url(#colorTotalGrid)" strokeWidth={2.5}
                    activeDot={{ r: 5, fill: GOLD, stroke: '#fff', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          {/* 4 · Distritos con más contratos */}
          <ChartCard
            title="Distritos con más contratos"
            icon={<MapPin size={16} />}
            skeleton={primeraCarga}
            refreshing={refrescando}
            empty={!geografia.length}
          >
            {(ancho: number) => {
              const eje = ejeY(ancho, 150)
              return (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart
                    data={geografia.map(g => ({ ...g, nombreCorto: g.nom_distrito, nombreCompleto: g.nom_distrito }))}
                    layout="vertical" margin={{ left: 4, right: 34, top: 2, bottom: 2 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fontSize: 10 }} stroke="#94a3b8" allowDecimals={false} />
                    <YAxis
                      type="category" dataKey="nombreCorto" width={eje.width}
                      tick={<TruncatedTick maxChars={eje.chars} />} stroke="#94a3b8" interval={0}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f1f5f9' }} />
                    <Bar dataKey="total" name="Contratos" radius={[0, 6, 6, 0]} maxBarSize={22}>
                      <LabelList dataKey="total" position="right" style={{ fontSize: 10, fontWeight: 700, fill: '#334155' }} />
                      {geografia.map((_, i) => (
                        <Cell key={i} fill={i === 0 ? GOLD : NAVY} fillOpacity={i === 0 ? 1 : Math.max(0.45, 1 - i * 0.07)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )
            }}
          </ChartCard>

          {/* 5 · Productos / categorías */}
          <ChartCard
            title="Productos / categorías más contratados"
            icon={<Package size={16} />}
            skeleton={primeraCarga}
            refreshing={refrescando}
            empty={!productos.length}
            right={
              <button
                type="button"
                role="switch"
                aria-checked={soloAdjudicados}
                onClick={() => setSoloAdjudicados(v => !v)}
                className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${focusRing} ${
                  soloAdjudicados
                    ? 'border-[#F5B700] bg-[#F5B700]/10 text-[#0B3D6E]'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                }`}
              >
                <span className={`relative h-4 w-7 shrink-0 rounded-full transition-colors duration-300 ${soloAdjudicados ? 'bg-[#F5B700]' : 'bg-slate-300'}`}>
                  <span className={`absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform duration-300 ${soloAdjudicados ? 'translate-x-3' : ''}`} />
                </span>
                Solo adjudicados
              </button>
            }
          >
            {(ancho: number) => {
              const eje = ejeY(ancho, 150)
              return (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart
                    data={productos.map(p => ({ ...p, nombreCorto: p.nom_cubso, nombreCompleto: p.nom_cubso }))}
                    layout="vertical" margin={{ left: 4, right: 34, top: 2, bottom: 2 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fontSize: 10 }} stroke="#94a3b8" allowDecimals={false} />
                    <YAxis
                      type="category" dataKey="nombreCorto" width={eje.width}
                      tick={<TruncatedTick maxChars={eje.chars} />} stroke="#94a3b8" interval={0}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f1f5f9' }} />
                    <Bar dataKey="total" name="Veces contratado" radius={[0, 6, 6, 0]} maxBarSize={22}>
                      <LabelList dataKey="total" position="right" style={{ fontSize: 10, fontWeight: 700, fill: '#334155' }} />
                      {productos.map((_, i) => (
                        <Cell key={i} fill={i === 0 ? GOLD : '#2F6FB5'} fillOpacity={i === 0 ? 1 : Math.max(0.45, 1 - i * 0.07)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )
            }}
          </ChartCard>

          {/* 6 · Distribución por tipo de objeto */}
          <ChartCard
            title="Distribución por tipo de objeto"
            icon={<Layers size={16} />}
            skeleton={primeraCarga}
            refreshing={refrescando}
            empty={!objeto.length}
          >
            <div className="pt-2">
              <Dona
                data={objeto}
                dataKey="total"
                nameKey="nom_objeto_contrato"
                colorFor={(_, i) => PALETTE[i % PALETTE.length]}
                centro={{ valor: objeto.reduce((a, b) => a + b.total, 0), texto: 'contratos' }}
              />
              <LeyendaLista
                items={objeto.map((o, i) => ({
                  name: o.nom_objeto_contrato,
                  value: o.total,
                  color: PALETTE[i % PALETTE.length],
                }))}
              />
            </div>
          </ChartCard>

          {/* 7 · Evolución mensual a ancho completo (solo cuando el ranking de proveedores ocupa el lugar 3) */}
          {esAdjudicados && (
            <div className="sx-span-all min-w-0">
              <ChartCard
                title="Evolución mensual de publicaciones"
                icon={<CalendarRange size={16} />}
                skeleton={primeraCarga}
                refreshing={refrescando}
                empty={!timeline.length}
              >
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={timelineChartData} margin={{ left: -10, right: 20, top: 8 }}>
                    <defs>
                      <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={NAVY} stopOpacity={0.35} />
                        <stop offset="95%" stopColor={NAVY} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="periodoCorto" tick={{ fontSize: 10 }} stroke="#94a3b8" interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" allowDecimals={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone" dataKey="total" name="Contratos publicados"
                      stroke={NAVY} fill="url(#colorTotal)" strokeWidth={2.5}
                      activeDot={{ r: 5, fill: GOLD, stroke: '#fff', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}