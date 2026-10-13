'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Bricolage_Grotesque } from 'next/font/google'
import {
  Search, RotateCcw, LayoutGrid, CheckCircle2,
  Clock, XCircle, TrendingUp, Bot, FileSearch,
  Loader2, AlertCircle, ShoppingCart, Package,
  Wrench, ClipboardList, HardHat, X, Layers, Users,
  ShieldCheck, ShieldAlert, AlertTriangle, Timer,
  SlidersHorizontal, ChevronDown, ChevronLeft, ChevronRight,
  MapPin, Lock,
  type LucideIcon,
} from 'lucide-react'

import { ContractCard }    from '@/components/ContractCard'
import { ContractDetail }  from '@/components/ContractDetail'
import CotizacionModal     from '@/components/CotizacionModal'
import EmpresaSelector     from '@/components/EmpresaSelector'

import {
  getContratos,
  getStatsContratos,
  getStatsResultadoCulminados,
  type ContratoResumen,
  type StatsContratos,
  type EstadoContrato,
} from '@/lib/api'

import {
  getOpcionesFiltro, getProvinciasPorDepartamento, getDistritosPorProvincia,
  type OpcionesFiltro,
} from '@/lib/api-stats'

import { obtenerCarrito, agregarAlCarrito, quitarDelCarrito } from '@/lib/cotizaciones-api'

import { SidebarTrigger } from '@/components/Sidebar'
import { useAuth } from '@/components/AuthProvider'

import { getSocket } from '@/lib/socket'

/* ------------------------------------------------------------------ */
/*  Tipografía de títulos y cifras (si tu versión de Next no trae      */
/*  Bricolage_Grotesque, borra el import y pon                         */
/*  const fontDisplay = { className: '' }).                            */
/* ------------------------------------------------------------------ */
const fontDisplay = Bricolage_Grotesque({ subsets: ['latin'], display: 'swap' })

// ─── Adaptador ────────────────────────────────────────────────────────────────
type ContratoAdaptable = {
  id_contrato        : number
  des_contratacion?  : string | null
  des_objeto_contrato?: string | null
  nom_entidad?       : string | null
  nom_sigla?         : string | null
  nom_area_usuaria?  : string | null
  valor_max_uit?     : number | null
  id_estado_contrato?: number | null
  fec_ini_cotizacion?: string | null
  fec_fin_cotizacion?: string | null
  nom_objeto_contrato?: string | null
  cotizar            : boolean
  total_archivos_contrato?  : number
  total_archivos_cotizacion?: number
  cotizacion_usuario?: string | null
  cotizacion_empresa?: string | null
  cotizacion_estado? : string | null
  cotizacion_fecha?  : string | null
}

function adaptarContrato(c: ContratoAdaptable) {
  const mapaEstado: Record<number, string> = { 2: 'vigente', 3: 'en_evaluacion', 4: 'culminado' }
  const status = mapaEstado[c.id_estado_contrato ?? 0] ?? 'otros'
  return {
    ...c,
    id        : c.id_contrato,
    code      : c.des_contratacion ?? `#${c.id_contrato}`,
    title     : c.des_objeto_contrato ?? '—',
    entity    : c.nom_entidad ?? '—',
    contractor: c.nom_sigla ?? '—',
    location  : c.nom_area_usuaria ?? undefined,
    amount    : c.valor_max_uit ?? null,
    status,
    start_date: c.fec_ini_cotizacion ?? '',
    end_date  : c.fec_fin_cotizacion  ?? '',
    object    : c.nom_objeto_contrato ?? undefined,
    description: c.des_objeto_contrato ?? undefined,
    cotizar   : c.cotizar,
    total_archivos_contrato  : c.total_archivos_contrato   ?? 0,
    total_archivos_cotizacion: c.total_archivos_cotizacion ?? 0,
    documents : [],
  }
}

function formatDuracion(segundos: number) {
  const h = Math.floor(segundos / 3600)
  const m = Math.floor((segundos % 3600) / 60)
  const s = Math.floor(segundos % 60)
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// Sonido de notificación estilo WhatsApp: dos tonos ascendentes generados
// con Web Audio API, sin necesidad de ningún archivo .mp3 externo.
function reproducirSonidoNotificacion() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    const ctx = new AudioContextClass()
    const ahora = ctx.currentTime

    const tocarTono = (frecuencia: number, inicio: number, duracion: number, volumen: number) => {
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(frecuencia, ahora + inicio)
      gain.gain.setValueAtTime(0, ahora + inicio)
      gain.gain.linearRampToValueAtTime(volumen, ahora + inicio + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, ahora + inicio + duracion)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(ahora + inicio)
      osc.stop(ahora + inicio + duracion)
    }

    // Volumen alto (0.6) y dos tonos ascendentes tipo "pop-pop" de WhatsApp
    tocarTono(880,  0,    0.16, 0.6)
    tocarTono(1175, 0.13, 0.20, 0.6)
  } catch {
    // Si el navegador bloquea audio autoplay sin interacción previa, falla en silencio
  }
}

type Toast = { text: string; tone: 'info' | 'success' | 'warning' | 'error' } | null

type FilterStatus = EstadoContrato

/* ------------------------------------------------------------------ */
/*  Constantes de UI                                                   */
/* ------------------------------------------------------------------ */
const TABS_ESTADO: {
  value: string
  label: string
  key: 'total' | 'vigentes' | 'en_evaluacion' | 'culminados'
  icon: LucideIcon
  iconBg: string
  bar: string
  text: string
}[] = [
  { value: 'todos',         label: 'Total',         key: 'total',         icon: Layers,       iconBg: 'bg-slate-100 text-slate-600',    bar: 'bg-slate-700',   text: 'text-slate-800' },
  { value: 'vigente',       label: 'Vigentes',      key: 'vigentes',      icon: CheckCircle2, iconBg: 'bg-emerald-100 text-emerald-600', bar: 'bg-emerald-500', text: 'text-emerald-600' },
  { value: 'en_evaluacion', label: 'En evaluación', key: 'en_evaluacion', icon: Clock,        iconBg: 'bg-violet-100 text-violet-600',   bar: 'bg-violet-500',  text: 'text-violet-600' },
  { value: 'culminado',     label: 'Culminados',    key: 'culminados',    icon: XCircle,      iconBg: 'bg-rose-100 text-rose-600',       bar: 'bg-rose-500',    text: 'text-rose-600' },
]

const OBJETOS: { value: number | undefined; label: string; icon: LucideIcon }[] = [
  { value: undefined, label: 'Todos',               icon: LayoutGrid },
  { value: 1,         label: 'Bienes',              icon: Package },
  { value: 2,         label: 'Servicios',           icon: Wrench },
  { value: 3,         label: 'Obra',                icon: HardHat },
  { value: 4,         label: 'Consultoría de obra', icon: ClipboardList },
]

const ESTILOS = `
.sx-root{--sx-ease:cubic-bezier(.22,1,.36,1)}
@keyframes sx-shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}
.sx-skel{background:linear-gradient(90deg,#e8eef5 25%,#f6f9fc 50%,#e8eef5 75%);background-size:800px 100%;animation:sx-shimmer 1.4s linear infinite}
@keyframes sx-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.sx-rise{opacity:0;animation:sx-rise .5s var(--sx-ease) forwards}
@keyframes sx-fade{from{opacity:0}to{opacity:1}}
.sx-fade{opacity:0;animation:sx-fade .3s ease forwards}
@keyframes sx-pop{0%{transform:scale(.5)}55%{transform:scale(1.3)}100%{transform:scale(1)}}
.sx-pop{animation:sx-pop .4s var(--sx-ease)}
@keyframes sx-bar{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}
.sx-bar{animation:sx-bar 1.1s ease-in-out infinite}
@keyframes sx-toast{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}
.sx-toast{animation:sx-toast .4s var(--sx-ease)}
@keyframes sx-slide{from{transform:translateX(100%)}to{transform:none}}
.sx-slide{animation:sx-slide .38s var(--sx-ease)}
@keyframes sx-modal{from{opacity:0;transform:translateY(12px) scale(.96)}to{opacity:1;transform:none}}
.sx-modal{animation:sx-modal .4s var(--sx-ease)}
.sx-collapse{display:grid;grid-template-rows:0fr;opacity:0;visibility:hidden;transition:grid-template-rows .32s var(--sx-ease),opacity .22s ease,visibility 0s linear .32s}
.sx-collapse[data-open="true"]{grid-template-rows:1fr;opacity:1;visibility:visible;transition:grid-template-rows .32s var(--sx-ease),opacity .25s ease .05s,visibility 0s}
.sx-collapse>div{min-height:0;overflow:hidden}
@media (prefers-reduced-motion:reduce){
  .sx-root *,.sx-root *::before,.sx-root *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;transition-delay:0s!important}
}
`

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B3D6E] focus-visible:ring-offset-2'

const focusRingDark =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A2F55]'

const controlBase =
  'h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-700 transition hover:border-slate-300 focus:border-[#0B3D6E] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0B3D6E]/10 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-300 disabled:hover:border-slate-200'

/* ------------------------------------------------------------------ */
/*  Utilidades de UI                                                   */
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

function generarPaginasVisibles(actual: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const paginas: (number | '...')[] = [1]
  if (actual > 3) paginas.push('...')
  for (let p = Math.max(2, actual - 1); p <= Math.min(total - 1, actual + 1); p++) paginas.push(p)
  if (actual < total - 2) paginas.push('...')
  paginas.push(total)
  return paginas
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span>
      {children}
    </label>
  )
}

function SelectBox({
  value, onChange, label, children, disabled = false, icon,
}: {
  value: string
  onChange: (v: string) => void
  label: string
  children: React.ReactNode
  disabled?: boolean
  icon?: React.ReactNode
}) {
  return (
    <div className="relative">
      {icon && <span className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-slate-400">{icon}</span>}
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        className={`${controlBase} cursor-pointer appearance-none pr-9 ${icon ? 'pl-10' : ''}`}
      >
        {children}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="sx-skel h-3.5 w-28 rounded" />
        <div className="sx-skel h-5 w-16 rounded-full" />
      </div>
      <div className="sx-skel h-4 w-full rounded" />
      <div className="sx-skel h-4 w-4/5 rounded" />
      <div className="sx-skel h-3 w-1/2 rounded" />
      <div className="mt-1 flex justify-between border-t border-slate-100 pt-3">
        <div className="sx-skel h-3 w-1/3 rounded" />
        <div className="sx-skel h-7 w-20 rounded-lg" />
      </div>
    </div>
  )
}

// ─── Panel de cotizaciones ────────────────────────────────────────────────────
function CotizacionesPanel({
  items, onClose, onRemove, onOpen, onCotizar,
}: {
  items: any[]
  onClose: () => void
  onRemove: (id: number) => void
  onOpen: (c: any) => void
  onCotizar: (c: any) => void
}) {
  // Cerrar con ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Mis cotizaciones">
      <button
        aria-label="Cerrar panel"
        className="sx-fade absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="sx-slide relative ml-auto flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <div className="flex shrink-0 items-center gap-3 bg-emerald-700 px-5 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 text-white">
            <ShoppingCart size={17} />
          </span>
          <div className="flex-1">
            <p className={`${fontDisplay.className} text-base font-bold text-white`}>Mis cotizaciones</p>
            <p className="text-xs text-emerald-100">
              {items.length} contrato{items.length !== 1 ? 's' : ''} seleccionado{items.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className={`flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20 ${focusRingDark}`}
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/60 p-4">
          {items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-slate-400">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
                <ShoppingCart size={28} className="opacity-50" />
              </span>
              <p className="text-sm font-medium text-slate-600">Aún no agregaste contratos</p>
              <p className="max-w-[240px] text-xs leading-relaxed">
                Usa el ícono <ShoppingCart size={11} className="inline" /> de cada tarjeta para guardarlo aquí.
              </p>
            </div>
          ) : items.map((c, i) => (
            <div
              key={c.id}
              className="sx-rise flex flex-col gap-2.5 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition-colors hover:border-emerald-300"
              style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
            >
              <div className="flex gap-3">
                <button
                  className={`min-w-0 flex-1 rounded-md text-left ${focusRing}`}
                  onClick={() => { onOpen(c); onClose() }}
                >
                  <p className="truncate text-[11px] font-medium text-slate-400">{c.code}</p>
                  <p className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug text-slate-800">{c.title}</p>
                  <p className="mt-1 truncate text-xs text-slate-500">{c.entity}</p>
                </button>
                <button
                  onClick={() => onRemove(c.id)}
                  aria-label="Quitar de cotizaciones"
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-400 transition-colors hover:bg-rose-100 hover:text-rose-600 ${focusRing}`}
                >
                  <X size={13} />
                </button>
              </div>
              {c.cotizar && (
                <button
                  onClick={() => onCotizar(c)}
                  className={`w-full rounded-lg bg-emerald-600 py-2 text-xs font-bold text-white transition-all hover:bg-emerald-500 active:scale-[0.98] ${focusRing}`}
                >
                  Cotizar en SEACE
                </button>
              )}
            </div>
          ))}
        </div>

        {items.length > 0 && (
          <div className="shrink-0 border-t border-slate-100 bg-white p-4">
            <button
              onClick={() => { if (confirm('¿Limpiar todas las cotizaciones?')) items.forEach(i => onRemove(i.id)) }}
              className={`flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-rose-600 ${focusRing}`}
            >
              <RotateCcw size={13} /> Limpiar todo
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Home() {
  const { token, modulos } = useAuth()
  const [selectedContract, setSelectedContract] = useState<any>(null)
  const [search,  setSearch]  = useState('')
  const [showCotizablesOnly, setShowCotizablesOnly] = useState(false)
  const [soloMios, setSoloMios] = useState(false)
  const [proveedor, setProveedor] = useState('')
  const [entidad, setEntidad] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [resultadoCotiza, setResultadoCotiza] = useState<'' | 'adjudicado' | 'desierto'>('')

  const [departamento, setDepartamento] = useState('')
  const [provincia,    setProvincia]    = useState('')
  const [distrito,     setDistrito]     = useState('')
  const [opciones,       setOpciones]       = useState<OpcionesFiltro | null>(null)
  const [provinciasDisp, setProvinciasDisp] = useState<string[]>([])
  const [distritosDisp,  setDistritosDisp]  = useState<string[]>([])

  const [resultadoStats, setResultadoStats] = useState<{ total: number; adjudicados: number; desiertos: number } | null>(null)
  const [filter,  setFilter]  = useState<FilterStatus>('todos')
  const [objeto,  setObjeto]  = useState<number | undefined>(undefined)
  const [page,    setPage]    = useState(1)

  const inputBusquedaRef = useRef<HTMLInputElement>(null)

  const puedeExtraerTodo = modulos.some(m => m.clave === 'extraer_todo')

  useEffect(() => {
    if (filter !== 'culminado') return
    getStatsResultadoCulminados().then(setResultadoStats).catch(() => {})
  }, [filter])


  useEffect(() => { getOpcionesFiltro().then(setOpciones).catch(() => {}) }, [])

  useEffect(() => {
    if (!departamento) { setProvinciasDisp([]); setDistritosDisp([]); return }
    getProvinciasPorDepartamento(departamento).then(setProvinciasDisp).catch(() => setProvinciasDisp([]))
    setProvincia(''); setDistrito('')
  }, [departamento])

  useEffect(() => {
    if (!departamento) return
    getDistritosPorProvincia(departamento, provincia || undefined).then(setDistritosDisp).catch(() => setDistritosDisp([]))
    setDistrito('')
  }, [provincia])

  const [contratos,  setContratos]  = useState<ContratoResumen[]>([])
  const [stats,      setStats]      = useState<StatsContratos | null>(null)
  const [totalPages, setTotalPages] = useState(1)
  const [totalItems, setTotalItems] = useState(0)

  const [loadingData,  setLoadingData]  = useState(true)
  const [loadingStats, setLoadingStats] = useState(true)
  const [error,        setError]        = useState<string | null>(null)

  // Cotizaciones
  const [cotizaciones,     setCotizaciones]     = useState<any[]>([])
  const [showCotizaciones, setShowCotizaciones] = useState(false)
  const [cotizandoId,      setCotizandoId]      = useState<number | null>(null)

  const [otrosEnCarrito, setOtrosEnCarrito] = useState<Record<number, string[]>>({})

  // Cargar el carrito real (persistido en BD, por usuario) al montar la página
  useEffect(() => {
    if (!token) return
    obtenerCarrito(token)
      .then(res => setCotizaciones(res.carrito.map(adaptarContrato)))
      .catch(() => {})
  }, [token])


  useEffect(() => {
    if (!token) return
    const socket = getSocket()
    if (!socket) return

    const handleCarritoActualizado = (data: {
      id_contrato: number
      usuario: string
      accion: 'agregado' | 'quitado'
    }) => {
      setOtrosEnCarrito(prev => {
        const actuales = prev[data.id_contrato] ?? []
        if (data.accion === 'agregado') {
          if (actuales.includes(data.usuario)) return prev
          return { ...prev, [data.id_contrato]: [...actuales, data.usuario] }
        } else {
          return { ...prev, [data.id_contrato]: actuales.filter(u => u !== data.usuario) }
        }
      })
    }

    socket.on('carrito_actualizado', handleCarritoActualizado)
    return () => { socket.off('carrito_actualizado', handleCarritoActualizado) }
  }, [token])

  useEffect(() => {
    if (!token) return
    const socket = getSocket()
    if (!socket) return

    const handleCotizacionNotificacion = (data: {
      usuario: string
      id_contrato: number
      mensaje: string
      empresa?: string | null
    }) => {
      const esEnvio = data.mensaje.includes('envió la cotización')

      // Sonido de notificación tipo WhatsApp
      reproducirSonidoNotificacion()

      // Toast — reutiliza el mismo mecanismo que ya usa el scraper
      setScraperToast({ text: data.mensaje, tone: esEnvio ? 'success' : 'info' })
      setTimeout(() => setScraperToast(null), 5000)

      // Actualiza el badge en la card sin recargar la página
      setContratos(prev => prev.map(c =>
        c.id_contrato === data.id_contrato
          ? {
              ...c,
              cotizacion_usuario: data.usuario,
              cotizacion_empresa: (data as any).empresa ?? c.cotizacion_empresa,
              cotizacion_estado : esEnvio ? 'ENVIADA' : 'BORRADOR',
              cotizacion_fecha  : new Date().toISOString(),
            }
          : c
      ))
    }

    socket.on('cotizacion_notificacion', handleCotizacionNotificacion)
    return () => { socket.off('cotizacion_notificacion', handleCotizacionNotificacion) }
  }, [token])
  useEffect(() => {
    if (!token) return
    const socket = getSocket()
    if (!socket) return

    const handleCotizacionActualizada = (data: {
      id_contrato: number
      usuario: string
      mensaje: string
      estado_cotizacion?: 'borrador' | 'enviada'
      empresa?: string
    }) => {
      // Toast — reutiliza el mismo mecanismo que ya usa el scraper
      setScraperToast({
        text: `${data.usuario} ${data.mensaje} el contrato #${data.id_contrato}`,
        tone: data.estado_cotizacion === 'enviada' ? 'success' : 'info',
      })
      setTimeout(() => setScraperToast(null), 5000)

      // Actualiza el badge en la card sin recargar la página
      setContratos(prev => prev.map(c =>
        c.id_contrato === data.id_contrato
          ? {
              ...c,
              cotizacion_usuario: data.usuario,
              cotizacion_empresa: data.empresa ?? c.cotizacion_empresa,
              cotizacion_estado : data.estado_cotizacion ?? c.cotizacion_estado,
              cotizacion_fecha  : new Date().toISOString(),
            }
          : c
      ))
    }

    socket.on('cotizacion_actualizada', handleCotizacionActualizada)
    return () => { socket.off('cotizacion_actualizada', handleCotizacionActualizada) }
  }, [token])

  const [scraperRunning, setScraperRunning]   = useState(false)
  const [scraperMode,    setScraperMode]       = useState<'todo' | 'vigentes' | null>(null)
  const [scraperToast,   setScraperToast]      = useState<Toast>(null)

  const [showPlanModal,  setShowPlanModal]     = useState(false)
  const [showFilters,    setShowFilters]       = useState(false)

  // Cronómetro de extracción
  const [scraperStartedAt, setScraperStartedAt] = useState<number | null>(null)
  const [elapsedSeconds,   setElapsedSeconds]   = useState(0)
  const [estimatedSeconds, setEstimatedSeconds] = useState<number | null>(null)

  const toggleCotizar = (contract: any, e: React.MouseEvent) => {
    e.stopPropagation()
    const yaEstaba = cotizaciones.some(c => c.id === contract.id)

    // Optimista: la UI cambia al toque, sin esperar al backend
    setCotizaciones(prev =>
      yaEstaba ? prev.filter(c => c.id !== contract.id) : [...prev, contract]
    )

    if (!token) return
    const accion = yaEstaba ? quitarDelCarrito(contract.id, token) : agregarAlCarrito(contract.id, token)
    accion.catch(() => {
      // Si el backend falla, revertimos el cambio optimista
      setCotizaciones(prev =>
        yaEstaba ? [...prev, contract] : prev.filter(c => c.id !== contract.id)
      )
      setScraperToast({ text: 'No se pudo actualizar el carrito, inténtalo de nuevo.', tone: 'error' })
      setTimeout(() => setScraperToast(null), 4000)
    })
  }


  const lanzarScraper = async (modo: 'todo' | 'vigentes') => {
    if (scraperRunning) return
    const endpoint  = modo === 'todo' ? '/extraer/todo' : '/extraer/vigentes'
    const SCRAPER   = process.env.NEXT_PUBLIC_SCRAPER_URL || 'http://localhost:4000'
    const storageKey = `duracion_promedio_${modo}`

    const previa = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey) : null
    setEstimatedSeconds(previa ? Number(previa) : null)

    const inicio = Date.now()
    setScraperStartedAt(inicio)
    setElapsedSeconds(0)
    setScraperRunning(true)
    setScraperMode(modo)
    setScraperToast({
      text: `Iniciando extracción ${modo === 'todo' ? 'total' : 'solo vigentes'}...`,
      tone: 'info',
    })

    try {
      const res  = await fetch(`${SCRAPER}${endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (res.status === 409) {
        setScraperToast({ text: `Ya hay una tarea corriendo (${data.modo})`, tone: 'warning' })
        setScraperRunning(false)
        setScraperMode(null)
        setScraperStartedAt(null)
        return
      }
      setScraperToast({ text: data.mensaje, tone: 'info' })

      const poll = setInterval(async () => {
        try {
          const st = await fetch(`${SCRAPER}/`).then(r => r.json())
          if (!st.corriendo) {
            clearInterval(poll)
            const duracion = Math.floor((Date.now() - inicio) / 1000)
            if (typeof window !== 'undefined') {
              window.localStorage.setItem(storageKey, String(duracion))
            }
            setScraperRunning(false)
            setScraperMode(null)
            setScraperStartedAt(null)
            setScraperToast({ text: 'Extracción finalizada correctamente', tone: 'success' })
            setTimeout(() => setScraperToast(null), 4000)
            cargarContratos()
          }
        } catch {
          clearInterval(poll)
          setScraperRunning(false)
          setScraperMode(null)
          setScraperStartedAt(null)
          setScraperToast({ text: 'Se perdió la conexión con el servidor de extracción', tone: 'error' })
          setTimeout(() => setScraperToast(null), 5000)
        }
      }, 5000)
    } catch {
      setScraperToast({ text: 'No se pudo conectar al servidor de extracción (:4000)', tone: 'error' })
      setScraperRunning(false)
      setScraperMode(null)
      setScraperStartedAt(null)
      setTimeout(() => setScraperToast(null), 4000)
    }
  }

  // ── KPIs ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoadingStats(true)
    getStatsContratos()
      .then(setStats)
      .catch(() => setError('No se pudo conectar al backend'))
      .finally(() => setLoadingStats(false))
  }, [])


  // ── Cronómetro de extracción ────────────────────────────────────────────────
  useEffect(() => {
    if (!scraperRunning || !scraperStartedAt) return
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - scraperStartedAt) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [scraperRunning, scraperStartedAt])

  // ── Contratos ─────────────────────────────────────────────────────────────
  const cargarContratos = useCallback(async () => {
    setLoadingData(true)
    setError(null)
    try {
      const searchQuery = search.trim() || undefined

      const res = await getContratos(page, 24,
        filter === 'todos' ? undefined : filter,
        searchQuery,
        undefined, undefined, objeto,
        soloMios,
        proveedor,
        entidad,
        descripcion,
        filter === 'culminado' ? (resultadoCotiza || undefined) : undefined,
        departamento || undefined,
        provincia || undefined,
        distrito || undefined,
      )

      // Si está activo el filtro "Solo Cotizables", filtra en cliente
      if (showCotizablesOnly) {
        res.data = res.data.filter((c: ContratoResumen) => c.cotizar === true)
        res.total = res.data.length
      }
      setContratos(res.data)
      setTotalPages(res.total_pages)
      setTotalItems(res.total)
    } catch {
      setError('Error cargando contratos. ¿Está el backend activo en :8000?')
    } finally {
      setLoadingData(false)
    }
  }, [page, filter, search, objeto, showCotizablesOnly, soloMios, proveedor, entidad, descripcion, resultadoCotiza, departamento, provincia, distrito])

  useEffect(() => {
    const t = setTimeout(() => { cargarContratos() }, 400)
    return () => clearTimeout(t)
  }, [cargarContratos])

  useEffect(() => { setPage(1) }, [filter, search, objeto, showCotizablesOnly, soloMios, proveedor, entidad, descripcion, resultadoCotiza, departamento, provincia, distrito] )
  useEffect(() => { if (filter !== 'culminado') setResultadoCotiza('') }, [filter])
  const clearFilters = () => { setSearch(''); setFilter('todos'); setObjeto(undefined); setShowCotizablesOnly(false); setSoloMios(false); setProveedor(''); setEntidad(''); setDescripcion(''); setResultadoCotiza(''); setDepartamento(''); setProvincia(''); setDistrito(''); setPage(1) }
  const adaptados = contratos.map(adaptarContrato)

  // ── Extras de UI (no tocan la lógica de datos) ────────────────────────────
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

  const irAPagina = (n: number) => {
    setPage(Math.min(Math.max(1, n), totalPages))
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const filtrosAvanzadosActivos = [departamento, provincia, distrito, entidad, descripcion, proveedor].filter(Boolean).length

  const chips = useMemo(() => {
    const c: { id: string; label: string; clear: () => void }[] = []
    if (search.trim()) c.push({ id: 'search', label: `Búsqueda: ${search.trim()}`, clear: () => setSearch('') })
    if (filter !== 'todos') {
      const t = TABS_ESTADO.find(t => t.value === filter)
      c.push({ id: 'estado', label: `Estado: ${t?.label ?? filter}`, clear: () => setFilter('todos') })
    }
    if (filter === 'culminado' && resultadoCotiza) {
      c.push({
        id: 'resultado',
        label: resultadoCotiza === 'adjudicado' ? 'Adjudicados' : 'Desiertos',
        clear: () => setResultadoCotiza(''),
      })
    }
    if (objeto !== undefined) {
      const o = OBJETOS.find(o => o.value === objeto)
      c.push({ id: 'objeto', label: `Tipo: ${o?.label ?? objeto}`, clear: () => setObjeto(undefined) })
    }
    if (showCotizablesOnly) c.push({ id: 'cotizables', label: 'Solo cotizables', clear: () => setShowCotizablesOnly(false) })
    if (soloMios) c.push({ id: 'mios', label: 'Solo míos', clear: () => setSoloMios(false) })
    if (departamento) c.push({ id: 'depto', label: departamento, clear: () => setDepartamento('') })
    if (provincia) c.push({ id: 'prov', label: provincia, clear: () => setProvincia('') })
    if (distrito) c.push({ id: 'dist', label: distrito, clear: () => setDistrito('') })
    if (entidad) c.push({ id: 'entidad', label: `Entidad: ${entidad}`, clear: () => setEntidad('') })
    if (descripcion) c.push({ id: 'desc', label: `Descripción: ${descripcion}`, clear: () => setDescripcion('') })
    if (proveedor) c.push({ id: 'prov-ed', label: `Proveedor: ${proveedor}`, clear: () => setProveedor('') })
    return c
  }, [search, filter, resultadoCotiza, objeto, showCotizablesOnly, soloMios, departamento, provincia, distrito, entidad, descripcion, proveedor])

  const primeraCarga = loadingData && contratos.length === 0
  const paginasVisibles = generarPaginasVisibles(page, totalPages)

  const toggleBase =
    'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition-all duration-200'

  return (
    <div className="sx-root min-h-screen bg-[#F3F6FA] pb-16">
      <style dangerouslySetInnerHTML={{ __html: ESTILOS }} />

      {/* MODAL: Plan requerido */}
      {showPlanModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="sx-fade absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={() => setShowPlanModal(false)} />
          <div className="sx-modal relative mx-4 w-full max-w-sm overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-2xl">
            <div className="flex flex-col items-center gap-3 bg-[#0A2F55] px-6 py-6">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F5B700] text-[#0A2F55]">
                <Lock size={20} />
              </span>
              <p className={`${fontDisplay.className} text-lg font-bold text-white`}>Plan Premium</p>
            </div>
            <div className="space-y-4 px-6 py-5 text-center">
              <div>
                <h3 className="text-base font-bold text-slate-800">Esta función no está disponible en tu plan</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                  La extracción <span className="font-semibold text-slate-700">total de contratos</span> requiere un plan activo. Contáctanos para habilitarla en tu cuenta.
                </p>
              </div>
              <div className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm">
                <p className="flex items-center gap-2 font-medium text-emerald-700"><CheckCircle2 size={15} /> Extracción de vigentes: gratis</p>
                <p className="flex items-center gap-2 font-medium text-amber-800"><Lock size={14} /> Extracción total: requiere plan</p>
              </div>
            </div>
            <div className="flex gap-2 px-6 pb-6">
              <button
                onClick={() => setShowPlanModal(false)}
                className={`flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-50 ${focusRing}`}
              >
                Cerrar
              </button>
              <button
                onClick={() => setShowPlanModal(false)}
                className={`flex-1 rounded-xl bg-[#F5B700] py-2.5 text-sm font-bold text-[#0A2F55] shadow-sm transition-all hover:bg-[#ffc933] active:scale-[0.98] ${focusRing}`}
              >
                Contactar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OVERLAY BLOQUEANTE mientras scraper corre */}
      {scraperRunning && (
        <div className="sx-fade fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm" role="alertdialog" aria-live="polite">
          <div className="sx-modal mx-4 flex w-full max-w-sm flex-col items-center gap-6 rounded-3xl border border-slate-100 bg-white px-8 py-8 shadow-2xl">
            <div className="relative flex h-16 w-16 items-center justify-center">
              <div className="absolute inset-0 rounded-full border-4 border-blue-100" />
              <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-[#0B3D6E]" />
              <div className="absolute inset-[6px] animate-spin rounded-full border-4 border-transparent border-t-[#F5B700]" style={{ animationDuration: '0.9s', animationDirection: 'reverse' }} />
              <Bot size={20} className="text-[#0B3D6E]" />
            </div>

            <div className="w-full text-center">
              <p className={`${fontDisplay.className} mb-1 text-lg font-bold text-slate-800`}>
                {scraperMode === 'todo' ? 'Extrayendo todos los contratos' : 'Extrayendo contratos vigentes'}
              </p>
              <p className="text-xs leading-relaxed text-slate-400">Manteniendo la sesión activa con SEACE.<br />No cierres esta ventana.</p>
            </div>

            <div className="grid w-full grid-cols-2 gap-3">
              <div className="flex flex-col items-center gap-1 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Timer size={12} />
                  <span className="text-xs font-medium">Transcurrido</span>
                </div>
                <p className="text-lg font-bold tabular-nums text-slate-800">{formatDuracion(elapsedSeconds)}</p>
              </div>
              <div className="flex flex-col items-center gap-1 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                <div className="flex items-center gap-1.5 text-slate-400">
                  <TrendingUp size={12} />
                  <span className="text-xs font-medium">
                    {estimatedSeconds ? 'Restante est.' : 'Referencia'}
                  </span>
                </div>
                <p className="text-lg font-bold tabular-nums text-slate-800">
                  {estimatedSeconds ? formatDuracion(Math.max(estimatedSeconds - elapsedSeconds, 0)) : '—'}
                </p>
              </div>
            </div>

            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              {estimatedSeconds ? (
                <div
                  className="h-full rounded-full bg-[#0B3D6E] transition-all duration-1000"
                  style={{ width: `${Math.min((elapsedSeconds / estimatedSeconds) * 100, 100)}%` }}
                />
              ) : (
                <div className="sx-bar h-full w-1/3 rounded-full bg-[#0B3D6E]" />
              )}
            </div>

            <p className="text-center text-xs text-slate-400">
              {scraperMode === 'todo' ? 'Modo total' : 'Modo vigentes'}
              {estimatedSeconds ? `, según la última corrida (${formatDuracion(estimatedSeconds)})` : ''}
            </p>
          </div>
        </div>
      )}

      {/* TOAST notificación scraper */}
      {scraperToast && !scraperRunning && (
        <div
          role="status"
          className={`sx-toast fixed bottom-6 right-6 z-[90] flex max-w-sm items-center gap-3 rounded-2xl border px-5 py-3.5 text-sm font-medium shadow-2xl
          ${scraperToast.tone === 'success' ? 'border-emerald-800 bg-emerald-950 text-emerald-100' : ''}
          ${scraperToast.tone === 'warning' ? 'border-amber-800 bg-amber-950 text-amber-100' : ''}
          ${scraperToast.tone === 'error'   ? 'border-rose-800 bg-rose-950 text-rose-100' : ''}
          ${scraperToast.tone === 'info'    ? 'border-slate-700 bg-slate-900 text-white' : ''}
        `}>
          {scraperToast.tone === 'success' && <ShieldCheck size={16} className="shrink-0" />}
          {scraperToast.tone === 'warning' && <AlertTriangle size={16} className="shrink-0" />}
          {scraperToast.tone === 'error'   && <ShieldAlert size={16} className="shrink-0" />}
          {scraperToast.tone === 'info'    && <Loader2 size={16} className="shrink-0 animate-spin" />}
          <span className="leading-snug">{scraperToast.text}</span>
          <button
            onClick={() => setScraperToast(null)}
            aria-label="Cerrar aviso"
            className="ml-1 shrink-0 opacity-60 transition-opacity hover:opacity-100"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* HEADER */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0A2F55]/95 shadow-lg backdrop-blur-md">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 px-4 py-3 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger className="text-white lg:hidden" />
            <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F5B700] text-[#0A2F55] sm:flex">
              <FileSearch size={19} />
            </span>
            <div className="min-w-0">
              <h1 className={`${fontDisplay.className} truncate text-lg font-bold leading-tight tracking-tight text-white sm:text-xl`}>
                Contratos del SEACE
              </h1>
              <p className="hidden text-xs text-blue-200/80 sm:block">Busca, compara y cotiza en un solo lugar</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {/* Selector de empresas vinculadas a SEACE */}
            <EmpresaSelector onNotify={setScraperToast} disabled={scraperRunning} />

            {/* Botón: Extraer Vigentes */}
            <button
              onClick={() => lanzarScraper('vigentes')}
              disabled={scraperRunning}
              title="Extraer solo contratos vigentes"
              className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-bold transition-all duration-200 ${focusRingDark}
                ${scraperRunning
                  ? 'cursor-not-allowed bg-white/10 text-white/40'
                  : 'bg-[#F5B700] text-[#0A2F55] shadow-lg shadow-black/20 hover:-translate-y-0.5 hover:bg-[#ffc933] active:translate-y-0'
                }`}
            >
              {scraperRunning && scraperMode === 'vigentes'
                ? <Loader2 size={15} className="animate-spin" />
                : <CheckCircle2 size={15} />
              }
              <span className="hidden sm:inline">Extraer vigentes</span>
            </button>

            {/* Botón: Extraer Todo */}
            {puedeExtraerTodo ? (
              <button
                onClick={() => lanzarScraper('todo')}
                disabled={scraperRunning}
                title="Extraer todos los contratos"
                className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold transition-all duration-200 ${focusRingDark}
                  ${scraperRunning
                    ? 'cursor-not-allowed border-white/10 bg-white/5 text-white/40'
                    : 'border-white/25 bg-white/10 text-white hover:-translate-y-0.5 hover:bg-white/20 active:translate-y-0'
                  }`}
              >
                {scraperRunning && scraperMode === 'todo'
                  ? <Loader2 size={15} className="animate-spin" />
                  : <RotateCcw size={15} />
                }
                <span className="hidden sm:inline">Extraer todo</span>
              </button>
            ) : (
              <button
                onClick={() => setShowPlanModal(true)}
                title="Requiere plan Premium"
                className={`flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white/70 transition-all duration-200 hover:bg-white/10 hover:text-white ${focusRingDark}`}
              >
                <Lock size={14} />
                <span className="hidden sm:inline">Extraer todo</span>
              </button>
            )}

            {/* Botón cotizaciones */}
            <button
              onClick={() => setShowCotizaciones(true)}
              disabled={scraperRunning}
              className={`relative flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-bold transition-all duration-200 ${focusRingDark}
                ${scraperRunning
                  ? 'cursor-not-allowed bg-white/10 text-white/40'
                  : 'bg-emerald-500 text-white shadow-lg shadow-black/20 hover:-translate-y-0.5 hover:bg-emerald-400 active:translate-y-0'
                }`}
            >
              <ShoppingCart size={15} />
              <span className="hidden sm:inline">Cotizaciones</span>
              {cotizaciones.length > 0 && (
                <span
                  key={cotizaciones.length}
                  className="sx-pop absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white shadow-sm ring-2 ring-[#0A2F55]"
                >
                  {cotizaciones.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-5 px-4 py-5 lg:px-6">

        {/* ERROR */}
        {error && (
          <div role="alert" className="sx-fade flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <AlertCircle size={16} className="shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={cargarContratos} className={`rounded-md px-2 py-1 text-xs font-semibold underline hover:bg-rose-100 ${focusRing}`}>
              Reintentar
            </button>
          </div>
        )}

        {/* PANEL: KPIs (también filtran por estado) + búsqueda + filtros */}
        <section aria-label="Búsqueda y filtros" className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xl shadow-slate-900/5">

          {/* Pestañas de estado */}
          <div role="tablist" aria-label="Estado del contrato" className="grid grid-cols-2 border-b border-slate-100 lg:grid-cols-4">
            {TABS_ESTADO.map((t, i) => {
              const activo = filter === t.value
              const Icono = t.icon
              return (
                <button
                  key={t.value}
                  role="tab"
                  aria-selected={activo}
                  onClick={() => setFilter(t.value as FilterStatus)}
                  className={`group relative flex items-center gap-3.5 px-5 py-4 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0B3D6E]
                    ${i > 0 ? 'lg:border-l lg:border-slate-100' : ''} ${i % 2 === 1 ? 'border-l border-slate-100' : ''}`}
                >
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-105 ${t.iconBg}`}>
                    <Icono size={19} />
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-slate-500">{t.label}</span>
                    <span className={`${fontDisplay.className} block text-3xl font-bold tabular-nums leading-tight transition-colors duration-300 ${activo ? t.text : 'text-slate-800'}`}>
                      {loadingStats
                        ? <span className="sx-skel mt-1 inline-block h-7 w-14 rounded" />
                        : <Num value={stats ? stats[t.key] : 0} />}
                    </span>
                  </span>
                  <span
                    className={`absolute inset-x-0 bottom-0 h-[3px] origin-left transition-transform duration-300 ease-out ${t.bar} ${activo ? 'scale-x-100' : 'scale-x-0'}`}
                  />
                </button>
              )
            })}
          </div>

          {/* Buscador + más filtros */}
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={inputBusquedaRef}
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Busca por entidad, descripción o código de contratación..."
                aria-label="Buscar contratos"
                className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-11 pr-12 text-[15px] text-slate-800 transition placeholder:text-slate-400 hover:border-slate-300 focus:border-[#0B3D6E] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0B3D6E]/10 [&::-webkit-search-cancel-button]:hidden"
              />
              {search ? (
                <button
                  onClick={() => setSearch('')}
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
              onClick={() => setShowFilters(v => !v)}
              aria-expanded={showFilters}
              aria-controls="panel-filtros"
              className={`flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-all duration-200 ${focusRing} ${
                showFilters || filtrosAvanzadosActivos > 0
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
              <ChevronDown size={15} className={`transition-transform duration-300 ${showFilters ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {/* Tipo de contrato + atajos */}
          <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
            <span className="mr-1 text-sm font-medium text-slate-500">Tipo</span>
            {OBJETOS.map(o => {
              const Icono = o.icon
              const activo = objeto === o.value
              return (
                <button
                  key={o.label}
                  aria-pressed={activo}
                  onClick={() => setObjeto(o.value)}
                  className={`${toggleBase} ${focusRing} ${
                    activo
                      ? 'border-[#0B3D6E] bg-[#0B3D6E] text-white shadow-md shadow-[#0B3D6E]/25'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <Icono size={15} className={activo ? 'text-[#F5B700]' : 'text-slate-400'} />
                  {o.label}
                </button>
              )
            })}

            <span className="mx-1 hidden h-6 w-px bg-slate-200 sm:block" />

            <button
              aria-pressed={showCotizablesOnly}
              onClick={() => setShowCotizablesOnly(v => !v)}
              className={`${toggleBase} ${focusRing} ${
                showCotizablesOnly
                  ? 'border-emerald-600 bg-emerald-600 text-white shadow-md shadow-emerald-600/25'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <Clock size={15} className={showCotizablesOnly ? 'text-white' : 'text-slate-400'} />
              Cotizables
            </button>

            <button
              aria-pressed={soloMios}
              onClick={() => setSoloMios(v => !v)}
              className={`${toggleBase} ${focusRing} ${
                soloMios
                  ? 'border-violet-600 bg-violet-600 text-white shadow-md shadow-violet-600/25'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <Users size={15} className={soloMios ? 'text-white' : 'text-slate-400'} />
              Míos
            </button>
          </div>

          {/* Sub-filtro de resultado: solo cuando el estado es "culminado" */}
          <div className="sx-collapse" data-open={filter === 'culminado'}>
            <div>
              <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 bg-rose-50/40 px-4 py-3">
                <span className="text-sm font-medium text-slate-500">Resultado</span>
                <div className="relative inline-flex rounded-xl bg-slate-100 p-1" role="group" aria-label="Resultado del contrato culminado">
                  {(['', 'adjudicado', 'desierto'] as const).map(val => {
                    const activo = resultadoCotiza === val
                    const cuenta = resultadoStats
                      ? (val === '' ? resultadoStats.total : val === 'adjudicado' ? resultadoStats.adjudicados : resultadoStats.desiertos)
                      : null
                    return (
                      <button
                        key={val || 'todos'}
                        aria-pressed={activo}
                        onClick={() => setResultadoCotiza(val)}
                        className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-all duration-200 ${focusRing} ${
                          activo
                            ? val === 'adjudicado'
                              ? 'bg-emerald-500 text-white shadow-sm'
                              : val === 'desierto'
                                ? 'bg-rose-500 text-white shadow-sm'
                                : 'bg-slate-700 text-white shadow-sm'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        {val === '' ? 'Todos' : val === 'adjudicado' ? 'Adjudicados' : 'Desiertos'}
                        {cuenta !== null && <span className="ml-1.5 tabular-nums opacity-75">{cuenta.toLocaleString('es-PE')}</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Filtros avanzados */}
          <div id="panel-filtros" className="sx-collapse" data-open={showFilters}>
            <div>
              <div className="space-y-4 border-t border-slate-100 bg-slate-50/50 p-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field label="Departamento">
                    <SelectBox
                      label="Departamento"
                      value={departamento}
                      onChange={setDepartamento}
                      icon={<MapPin size={15} />}
                    >
                      <option value="">Todos</option>
                      {opciones?.departamentos.map(d => <option key={d} value={d}>{d}</option>)}
                    </SelectBox>
                  </Field>
                  <Field label="Provincia">
                    <SelectBox label="Provincia" value={provincia} onChange={setProvincia} disabled={!departamento}>
                      <option value="">{departamento ? 'Todas' : 'Elige un departamento'}</option>
                      {provinciasDisp.map(p => <option key={p} value={p}>{p}</option>)}
                    </SelectBox>
                  </Field>
                  <Field label="Distrito">
                    <SelectBox label="Distrito" value={distrito} onChange={setDistrito} disabled={!departamento}>
                      <option value="">{departamento ? 'Todos' : 'Elige un departamento'}</option>
                      {distritosDisp.map(d => <option key={d} value={d}>{d}</option>)}
                    </SelectBox>
                  </Field>
                </div>

                <div className="grid grid-cols-1 gap-4 border-t border-slate-200/70 pt-4 sm:grid-cols-3">
                  <Field label="Entidad">
                    <div className="relative">
                      <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        value={entidad}
                        onChange={e => setEntidad(e.target.value)}
                        placeholder="Nombre de la entidad"
                        className={`${controlBase} pl-10`}
                      />
                    </div>
                  </Field>
                  <Field label="Descripción del contrato o producto">
                    <div className="relative">
                      <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        value={descripcion}
                        onChange={e => setDescripcion(e.target.value)}
                        placeholder="Palabras de la descripción"
                        className={`${controlBase} pl-10`}
                      />
                    </div>
                  </Field>
                  <Field label="Proveedor">
                    <div className="relative">
                      <Users size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        value={proveedor}
                        onChange={e => setProveedor(e.target.value)}
                        placeholder="Nombre del proveedor"
                        className={`${controlBase} pl-10`}
                      />
                    </div>
                  </Field>
                </div>
              </div>
            </div>
          </div>

          {/* Filtros aplicados */}
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
                onClick={clearFilters}
                className={`ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#0B3D6E] ${focusRing}`}
              >
                <RotateCcw size={12} />
                Limpiar todo
              </button>
            </div>
          )}
        </section>

        {/* INFO RESULTADOS */}
        <div className="relative flex flex-wrap items-center justify-between gap-2 px-1 pb-1">
          <p className="text-sm text-slate-500" aria-live="polite">
            Mostrando <span className="font-bold tabular-nums text-slate-800">{adaptados.length}</span> de{' '}
            <span className="font-bold tabular-nums text-slate-800">{totalItems.toLocaleString('es-PE')}</span> contratos
          </p>
          <p className="flex items-center gap-1.5 text-xs text-slate-400">
            <TrendingUp size={12} />
            Página {page} de {totalPages}
          </p>
          {loadingData && (
            <div className="absolute inset-x-0 -bottom-1 h-0.5 overflow-hidden rounded-full bg-[#0B3D6E]/10">
              <div className="sx-bar h-full w-1/3 rounded-full bg-[#0B3D6E]" />
            </div>
          )}
        </div>

        {/* GRID 4 columnas */}
        {primeraCarga ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : adaptados.length === 0 && !loadingData ? (
          <div className="sx-fade flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-20 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <FileSearch size={26} />
            </span>
            <div>
              <p className="text-base font-semibold text-slate-800">No hay contratos con estos filtros</p>
              <p className="mt-1 text-sm text-slate-500">Prueba con otra palabra o quita algún filtro.</p>
            </div>
            <button
              onClick={clearFilters}
              className={`mt-1 inline-flex items-center gap-2 rounded-xl bg-[#0B3D6E] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0a3460] ${focusRing}`}
            >
              <RotateCcw size={14} /> Limpiar filtros
            </button>
          </div>
        ) : (
          <div
            className={`grid grid-cols-1 gap-4 transition-opacity duration-200 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${
              loadingData ? 'opacity-60' : 'opacity-100'
            }`}
          >
            {adaptados.map((contract, i) => (
              <div
                key={contract.id}
                className="sx-rise transition-transform duration-300 hover:-translate-y-1"
                style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
              >
                <ContractCard
                  contract={contract}
                  onClick={setSelectedContract}
                  onCotizar={toggleCotizar}
                  onCotizarSeace={c => setCotizandoId(c.id)}
                  inCotizar={cotizaciones.some(c => c.id === contract.id)}
                  otrosUsuarios={otrosEnCarrito[contract.id]}
                />
              </div>
            ))}
          </div>
        )}

        {/* PAGINACIÓN */}
        {totalPages > 1 && !primeraCarga && (
          <nav
            aria-label="Paginación"
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm"
          >
            <p className="text-sm text-slate-500">
              Página <span className="font-semibold tabular-nums text-slate-800">{page}</span> de{' '}
              <span className="font-semibold tabular-nums text-slate-800">{totalPages}</span>
            </p>

            <div className="flex items-center gap-1">
              <button
                onClick={() => irAPagina(page - 1)}
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
                    onClick={() => irAPagina(p as number)}
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
                onClick={() => irAPagina(page + 1)}
                disabled={page === totalPages}
                aria-label="Página siguiente"
                className={`flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-[#0B3D6E] transition-all hover:border-[#0B3D6E] hover:bg-[#0B3D6E]/5 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-slate-200 disabled:hover:bg-transparent ${focusRing}`}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </nav>
        )}

      </main>

      {/* PANEL COTIZACIONES */}
      {showCotizaciones && (
        <CotizacionesPanel
          items={cotizaciones}
          onClose={() => setShowCotizaciones(false)}
          onRemove={id => {
            setCotizaciones(prev => prev.filter(c => c.id !== id))
            if (token) quitarDelCarrito(id, token).catch(() => {})
          }}
          onOpen={c => { setSelectedContract(c); setShowCotizaciones(false) }}
          onCotizar={c => { setCotizandoId(c.id); setShowCotizaciones(false) }}
        />
      )}
      {/* DETALLE */}
      {selectedContract && (
        <ContractDetail
          contract={selectedContract}
          onClose={() => setSelectedContract(null)}
        />
      )}

      {/* MODAL DE COTIZACIÓN */}
      {cotizandoId !== null && (
        <CotizacionModal
          idContrato={cotizandoId}
          onClose={() => setCotizandoId(null)}
          onEnviada={() => {
            setScraperToast({ text: 'Cotización enviada correctamente.', tone: 'success' })
            setTimeout(() => setScraperToast(null), 4000)
            setCotizaciones(prev => prev.filter(c => c.id !== cotizandoId))
            if (token) quitarDelCarrito(cotizandoId, token).catch(() => {})
            cargarContratos()
          }}
        />
      )}
    </div>
  )
}