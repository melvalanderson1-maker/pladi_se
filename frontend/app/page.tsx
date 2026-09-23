'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Search, RotateCcw, LayoutGrid, CheckCircle2,
  Clock, XCircle, TrendingUp, Bot, FileSearch,
  Loader2, AlertCircle, ShoppingCart, Package,
  Wrench, ClipboardList, X, Layers, Users,
  Link2, ShieldCheck, ShieldAlert, AlertTriangle, Timer,
  SlidersHorizontal, ChevronDown,
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

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, count, color, icon, loading }: {
  label: string; count: number; color: string; icon: React.ReactNode; loading: boolean
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4 flex items-center gap-4 hover:shadow-md transition-shadow">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${color}`}>{icon}</div>
      <div>
        {loading
          ? <div className="h-7 w-12 bg-slate-100 rounded animate-pulse mb-1"/>
          : <p className="text-2xl font-extrabold text-slate-800">{count.toLocaleString()}</p>
        }
        <p className="text-xs text-slate-500 font-medium">{label}</p>
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
    <div className="fixed inset-0 z-50 flex">
      <button className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative ml-auto w-full max-w-md h-full bg-white shadow-2xl flex flex-col">
        <div className="bg-gradient-to-r from-emerald-600 to-teal-700 px-5 py-4 flex items-center gap-3 shrink-0">
          <ShoppingCart size={18} className="text-white"/>
          <div className="flex-1">
            <p className="text-sm font-bold text-white">Mis Cotizaciones</p>
            <p className="text-xs text-emerald-200">{items.length} contrato{items.length !== 1 ? 's' : ''} seleccionado{items.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg bg-emerald-500 hover:bg-emerald-400 flex items-center justify-center text-white transition-colors">
            <X size={14}/>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
              <ShoppingCart size={40} className="opacity-20"/>
              <p className="text-sm">No has agregado contratos aún</p>
              <p className="text-xs text-center">Haz clic en el ícono <ShoppingCart size={11} className="inline"/> de los cards para agregar</p>
            </div>
          ) : items.map(c => (
            <div key={c.id} className="bg-slate-50 rounded-xl border border-slate-100 p-3 flex flex-col gap-2 hover:border-emerald-200 transition-colors">
              <div className="flex gap-3">
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { onOpen(c); onClose() }}>
                  <p className="text-[10px] font-mono text-slate-400 truncate">{c.code}</p>
                  <p className="text-xs font-semibold text-slate-700 line-clamp-2 mt-0.5">{c.title}</p>
                  <p className="text-[10px] text-slate-400 mt-1 truncate">{c.entity}</p>
                </div>
                <button
                  onClick={() => onRemove(c.id)}
                  className="w-6 h-6 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-400 hover:text-rose-600 flex items-center justify-center shrink-0 transition-colors mt-0.5"
                >
                  <X size={11}/>
                </button>
              </div>
              {c.cotizar && (
                <button
                  onClick={() => onCotizar(c)}
                  className="w-full py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold transition-colors"
                >
                  Cotizar en SEACE
                </button>
              )}
            </div>
          ))}
        </div>

        {items.length > 0 && (
          <div className="p-4 border-t border-slate-100 shrink-0">
            <button
              onClick={() => { if(confirm('¿Limpiar todas las cotizaciones?')) items.forEach(i => onRemove(i.id)) }}
              className="w-full py-2.5 rounded-xl border border-slate-200 text-sm text-slate-500 hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
            >
              <RotateCcw size={13}/> Limpiar todo
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

type FilterStatus = EstadoContrato

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

  // ── Clases filtro ─────────────────────────────────────────────────────────
const filterClass = (value: FilterStatus) => {
    const base = 'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-all duration-150'
    if (filter === value) {
      if (value === 'todos')         return `${base} bg-slate-800 text-white border-slate-800 shadow-sm`
      if (value === 'vigente')       return `${base} bg-emerald-500 text-white border-emerald-500 shadow-sm shadow-emerald-200`
      if (value === 'en_evaluacion') return `${base} bg-violet-500 text-white border-violet-500 shadow-sm shadow-violet-200`
      if (value === 'culminado')     return `${base} bg-rose-500 text-white border-rose-500 shadow-sm shadow-rose-200`
    }
    return `${base} bg-white text-slate-600 border-slate-200 hover:bg-slate-50`
  }


  const objetoClass = (id: number | undefined) => {
    const base = 'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all duration-150'
    return objeto === id
      ? `${base} bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-200`
      : `${base} bg-white text-slate-600 border-slate-200 hover:bg-slate-50`
  }

  return (
    <div className="min-h-screen bg-slate-50">

      {/* MODAL: Plan requerido */}
      {showPlanModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={() => setShowPlanModal(false)}/>
          <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm mx-4 border border-slate-100 overflow-hidden">
            {/* Header dorado */}
            <div className="bg-gradient-to-r from-amber-400 to-yellow-500 px-6 py-5 flex flex-col items-center gap-2">
              <div className="w-12 h-12 rounded-2xl bg-white/30 flex items-center justify-center">
                <span className="text-2xl font-black text-white">$</span>
              </div>
              <p className="text-sm font-black text-amber-900 uppercase tracking-widest">Plan Premium</p>
            </div>
            {/* Body */}
            <div className="px-6 py-5 text-center space-y-3">
              <h3 className="text-base font-bold text-slate-800">Función no disponible</h3>
              <p className="text-sm text-slate-500 leading-relaxed">
                La extracción <span className="font-bold text-slate-700">total de contratos</span> requiere un plan activo. Contáctanos para habilitarlo en tu cuenta.
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700 font-medium">
                ✓ Extracción de vigentes gratis<br/>
                ✗ Extracción total → Plan requerido
              </div>
            </div>
            {/* Footer */}
            <div className="px-6 pb-5 flex gap-2">
              <button
                onClick={() => setShowPlanModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-500 hover:bg-slate-50 transition-colors font-medium"
              >
                Cerrar
              </button>
              <button
                onClick={() => setShowPlanModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 text-sm font-bold text-amber-900 hover:opacity-90 transition-opacity shadow-sm"
              >
                Contactar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      {/* OVERLAY BLOQUEANTE mientras scraper corre */}
      {scraperRunning && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl px-8 py-8 flex flex-col items-center gap-6 max-w-sm w-full mx-4 border border-slate-100">
            <div className="relative w-16 h-16 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border-4 border-blue-100"/>
              <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-blue-600 animate-spin"/>
              <div className="absolute inset-[6px] rounded-full border-4 border-transparent border-t-blue-400 animate-spin" style={{animationDuration:'0.9s', animationDirection:'reverse'}}/>
              <Bot size={20} className="text-blue-600"/>
            </div>

            <div className="text-center w-full">
              <p className="text-sm font-bold text-slate-800 mb-1">
                {scraperMode === 'todo' ? 'Extrayendo todos los contratos' : 'Extrayendo contratos vigentes'}
              </p>
              <p className="text-xs text-slate-400 leading-relaxed">Manteniendo la sesión activa con SEACE.<br/>No cierres esta ventana.</p>
            </div>

            <div className="w-full grid grid-cols-2 gap-3">
              <div className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5 flex flex-col items-center gap-1">
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Timer size={12}/>
                  <span className="text-[10px] font-semibold uppercase tracking-wide">Transcurrido</span>
                </div>
                <p className="text-base font-mono font-bold text-slate-800">{formatDuracion(elapsedSeconds)}</p>
              </div>
              <div className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5 flex flex-col items-center gap-1">
                <div className="flex items-center gap-1.5 text-slate-400">
                  <TrendingUp size={12}/>
                  <span className="text-[10px] font-semibold uppercase tracking-wide">
                    {estimatedSeconds ? 'Restante est.' : 'Referencia'}
                  </span>
                </div>
                <p className="text-base font-mono font-bold text-slate-800">
                  {estimatedSeconds ? formatDuracion(Math.max(estimatedSeconds - elapsedSeconds, 0)) : '—'}
                </p>
              </div>
            </div>

            <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
              {estimatedSeconds ? (
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-1000"
                  style={{ width: `${Math.min((elapsedSeconds / estimatedSeconds) * 100, 100)}%` }}
                />
              ) : (
                <div className="h-full bg-gradient-to-r from-blue-500 via-blue-400 to-blue-500 rounded-full bg-[length:200%_100%]"
                     style={{animation:'shimmer 1.5s ease-in-out infinite', backgroundSize:'200% 100%',
                             backgroundImage:'linear-gradient(90deg,#3b82f6 0%,#93c5fd 50%,#3b82f6 100%)'}}/>
              )}
            </div>

            <p className="text-[10px] text-slate-400 font-mono uppercase tracking-widest text-center">
              {scraperMode === 'todo' ? 'Modo total' : 'Modo vigentes'}
              {estimatedSeconds ? ` · según la última corrida (${formatDuracion(estimatedSeconds)})` : ''}
            </p>
          </div>
        </div>
      )}

      {/* TOAST notificación scraper */}
      {scraperToast && !scraperRunning && (
        <div className={`fixed bottom-6 right-6 z-[90] text-xs font-semibold px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-fade-in border
          ${scraperToast.tone === 'success' ? 'bg-emerald-950 text-emerald-100 border-emerald-800' : ''}
          ${scraperToast.tone === 'warning' ? 'bg-amber-950 text-amber-100 border-amber-800' : ''}
          ${scraperToast.tone === 'error'   ? 'bg-rose-950 text-rose-100 border-rose-800' : ''}
          ${scraperToast.tone === 'info'    ? 'bg-slate-900 text-white border-slate-700' : ''}
        `}>
          {scraperToast.tone === 'success' && <ShieldCheck size={15} className="shrink-0"/>}
          {scraperToast.tone === 'warning' && <AlertTriangle size={15} className="shrink-0"/>}
          {scraperToast.tone === 'error'   && <ShieldAlert size={15} className="shrink-0"/>}
          {scraperToast.tone === 'info'    && <Loader2 size={15} className="shrink-0 animate-spin"/>}
          <span>{scraperToast.text}</span>
          <button onClick={() => setScraperToast(null)} className="ml-1 opacity-60 hover:opacity-100 transition-opacity"><X size={12}/></button>
        </div>
      )}

      <header className="bg-gradient-to-r from-slate-900 via-slate-800 to-blue-900 shadow-xl sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="lg:hidden" />


          </div>
          <div className="flex items-center gap-3">


            {/* Selector de empresas vinculadas a SEACE */}
            <EmpresaSelector onNotify={setScraperToast} disabled={scraperRunning}/>

            {/* Botón: Actualizar Estados
            <button
              onClick={async () => {
                const SCRAPER = process.env.NEXT_PUBLIC_SCRAPER_URL || 'http://localhost:4000'
                setScraperToast('Actualizando estados...')
                await fetch(`${SCRAPER}/actualizar/estados`, { method: 'POST' })
                setScraperToast('✅ Actualización de estados iniciada en background')
                setTimeout(() => setScraperToast(null), 5000)
              }}
              disabled={scraperRunning}
              title="Actualiza solo los estados sin re-extraer todo"
              className="relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-lg bg-violet-600 hover:bg-violet-500 text-white shadow-violet-900/30 hover:scale-105 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <RotateCcw size={15}/>
              <span className="hidden sm:inline">Sync Estados</span>
            </button>*/}

            {/* Botón: Extraer Vigentes */}
            <button
              onClick={() => lanzarScraper('vigentes')}
              disabled={scraperRunning}
              title="Extraer solo contratos Vigentes"
              className={`relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-lg
                ${scraperRunning
                  ? 'bg-slate-600 text-slate-400 cursor-not-allowed opacity-60'
                  : 'bg-amber-500 hover:bg-amber-400 text-white shadow-amber-900/30 hover:scale-105'
                }`}
            >
              {scraperRunning && scraperMode === 'vigentes'
                ? <Loader2 size={15} className="animate-spin"/>
                : <CheckCircle2 size={15}/>
              }
              <span className="hidden sm:inline">Vigentes</span>
            </button>

            {/* Botón: Extraer Todo */}
            {puedeExtraerTodo ? (
              <button
                onClick={() => lanzarScraper('todo')}
                disabled={scraperRunning}
                title="Extraer TODOS los contratos"
                className={`relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-lg
                  ${scraperRunning
                    ? 'bg-slate-600 text-slate-400 cursor-not-allowed opacity-60'
                    : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/30 hover:scale-105'
                  }`}
              >
                {scraperRunning && scraperMode === 'todo'
                  ? <Loader2 size={15} className="animate-spin"/>
                  : <RotateCcw size={15}/>
                }
                <span className="hidden sm:inline">Extraer Todo</span>
              </button>
            ) : (
              <button
                onClick={() => setShowPlanModal(true)}
                title="Requiere plan Premium"
                className="relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-lg bg-slate-700 hover:bg-slate-600 text-slate-300 shadow-slate-900/30 hover:scale-105"
              >
                <RotateCcw size={15}/>
                <span className="hidden sm:inline">Extraer Todo</span>
                <span className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-amber-400 text-slate-900 text-[9px] font-black flex items-center justify-center">$</span>
              </button>
            )}

            {/* Botón cotizaciones */}
            <button
              onClick={() => setShowCotizaciones(true)}
              disabled={scraperRunning}
              className={`relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-lg shadow-emerald-900/30
                ${scraperRunning
                  ? 'bg-slate-600 text-slate-400 cursor-not-allowed opacity-60'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-white hover:scale-105'
                }`}
            >
              <ShoppingCart size={15}/>
              <span className="hidden sm:inline">Cotizaciones</span>
              {cotizaciones.length > 0 && (
                <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
                  {cotizaciones.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-[1600px] mx-auto px-6 py-4 space-y-4">

        {/* ERROR */}
        {error && (
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            <AlertCircle size={16} className="shrink-0"/>
            {error}
            <button onClick={cargarContratos} className="ml-auto underline text-xs">Reintentar</button>
          </div>
        )}

        {/* KPIS */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total"         count={stats?.total         ?? 0} color="bg-slate-100 text-slate-600"    icon={<Layers       size={18}/>} loading={loadingStats}/>
          <StatCard label="Vigentes"      count={stats?.vigentes      ?? 0} color="bg-emerald-100 text-emerald-600" icon={<CheckCircle2 size={18}/>} loading={loadingStats}/>
          <StatCard label="En Evaluación" count={stats?.en_evaluacion ?? 0} color="bg-violet-100 text-violet-600"  icon={<Clock        size={18}/>} loading={loadingStats}/>
          <StatCard label="Culminados"    count={stats?.culminados    ?? 0} color="bg-rose-100 text-rose-600"      icon={<XCircle      size={18}/>} loading={loadingStats}/>
        </div>

        {/* FILTROS — barra compacta */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Buscador principal */}
            <div className="relative flex-1 min-w-[220px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por entidad, descripción, código..."
                className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
              />
            </div>

            {/* Estado */}
            <select
              value={filter}
              onChange={e => setFilter(e.target.value as FilterStatus)}
              className="px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 bg-white text-slate-600 focus:outline-none focus:border-blue-400 cursor-pointer"
            >
              <option value="todos">Todos los estados</option>
              <option value="vigente">Vigentes</option>
              <option value="en_evaluacion">En evaluación</option>
              <option value="culminado">Culminados</option>
            </select>

            {/* Sub-filtro resultado — solo aparece si el estado activo es "culminado" */}
            {filter === 'culminado' && (
              <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
                {(['', 'adjudicado', 'desierto'] as const).map(val => (
                  <button
                    key={val || 'todos'}
                    onClick={() => setResultadoCotiza(val)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
                      ${resultadoCotiza === val
                        ? val === 'adjudicado'
                          ? 'bg-emerald-500 text-white shadow-sm'
                          : val === 'desierto'
                            ? 'bg-rose-500 text-white shadow-sm'
                            : 'bg-slate-700 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                      }`}
                  >
                    {val === '' ? 'Todos' : val === 'adjudicado' ? 'Adjudicados' : 'Desiertos'}
                    {resultadoStats && (
                      <span className="ml-1 opacity-70">
                        ({val === '' ? resultadoStats.total : val === 'adjudicado' ? resultadoStats.adjudicados : resultadoStats.desiertos})
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Tipo objeto */}
            <select
              value={objeto ?? ''}
              onChange={e => setObjeto(e.target.value ? Number(e.target.value) : undefined)}
              className="px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 bg-white text-slate-600 focus:outline-none focus:border-blue-400 cursor-pointer"
            >
              <option value="">Todo tipo</option>
              <option value="1">Bienes</option>
              <option value="2">Servicios</option>
              <option value="3">Obra</option>
              <option value="4">Consultoría de Obra</option>
            </select>

            {/* Departamento */}
            <select
              value={departamento}
              onChange={e => setDepartamento(e.target.value)}
              className="px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 bg-white text-slate-600 focus:outline-none focus:border-blue-400 cursor-pointer"
            >
              <option value="">Departamento</option>
              {opciones?.departamentos.map(d => <option key={d} value={d}>{d}</option>)}
            </select>

            {/* Provincia */}
            <select
              value={provincia}
              disabled={!departamento}
              onChange={e => setProvincia(e.target.value)}
              className="px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 bg-white text-slate-600 focus:outline-none focus:border-blue-400 disabled:bg-slate-50 disabled:text-slate-300 cursor-pointer"
            >
              <option value="">{departamento ? 'Provincia' : 'Elige depto.'}</option>
              {provinciasDisp.map(p => <option key={p} value={p}>{p}</option>)}
            </select>

            {/* Distrito */}
            <select
              value={distrito}
              disabled={!departamento}
              onChange={e => setDistrito(e.target.value)}
              className="px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 bg-white text-slate-600 focus:outline-none focus:border-blue-400 disabled:bg-slate-50 disabled:text-slate-300 cursor-pointer"
            >
              <option value="">{departamento ? 'Distrito' : 'Elige depto.'}</option>
              {distritosDisp.map(d => <option key={d} value={d}>{d}</option>)}
            </select>

            {/* Solo Cotizables */}
            <button
              onClick={() => setShowCotizablesOnly(!showCotizablesOnly)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all duration-150
                ${showCotizablesOnly
                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-200'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
            >
              <Clock size={13}/> Cotizables
            </button>

            {/* Mis ofertas */}
            <button
              onClick={() => setSoloMios(!soloMios)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all duration-150
                ${soloMios
                  ? 'bg-purple-600 text-white border-purple-600 shadow-sm shadow-purple-200'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
            >
              <Users size={13}/> Míos
            </button>

            <button
              onClick={() => setShowFilters(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all duration-150
                ${showFilters || entidad || descripcion || proveedor
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
            >
              <SlidersHorizontal size={13}/> Más filtros
              {(entidad || descripcion || proveedor) && (
                <span className="w-4 h-4 rounded-full bg-amber-400 text-[9px] font-black flex items-center justify-center text-slate-900">
                  {[entidad, descripcion, proveedor].filter(Boolean).length}
                </span>
              )}
              <ChevronDown size={12} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`}/>
            </button>

            {/* Limpiar */}
            <button onClick={clearFilters} className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-500 hover:bg-slate-50 transition-colors">
              <RotateCcw size={13}/> Limpiar
            </button>
          </div>

          {/* Panel desplegable: filtros avanzados */}
          {showFilters && (
            <div className="pt-3 border-t border-slate-100 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                  <input
                    value={entidad}
                    onChange={e => setEntidad(e.target.value)}
                    placeholder="Filtrar por entidad..."
                    className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                  />
                </div>
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                  <input
                    value={descripcion}
                    onChange={e => setDescripcion(e.target.value)}
                    placeholder="Filtrar por descripción del contrato/producto..."
                    className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                  />
                </div>
                <div className="relative">
                  <Users size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                  <input
                    value={proveedor}
                    onChange={e => setProveedor(e.target.value)}
                    placeholder="Filtrar por proveedor..."
                    className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 transition-all"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* INFO RESULTADOS */}
        <div className="flex justify-between items-center">
          <p className="text-sm text-slate-500">
            Mostrando <span className="font-bold text-slate-700 mx-1">{adaptados.length}</span>
            de <span className="font-bold text-slate-700 mx-1">{totalItems.toLocaleString()}</span> contratos
          </p>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <TrendingUp size={12}/>
            Página {page} de {totalPages}
          </div>
        </div>

        {/* GRID 4 columnas */}
        {loadingData ? (
          <div className="flex items-center justify-center py-24 gap-3 text-slate-400">
            <Loader2 size={22} className="animate-spin"/>
            <span className="text-sm">Cargando contratos...</span>
          </div>
        ) : adaptados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400">
            <FileSearch size={44} className="mb-3 opacity-20"/>
            <p className="text-sm font-medium">Sin resultados para esta búsqueda</p>
            <button onClick={clearFilters} className="mt-3 text-xs text-blue-500 underline">Limpiar filtros</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {adaptados.map(contract => (
              <ContractCard
                key={contract.id}
                contract={contract}
                onClick={setSelectedContract}
                onCotizar={toggleCotizar}
                onCotizarSeace={c => setCotizandoId(c.id)}
                inCotizar={cotizaciones.some(c => c.id === contract.id)}
                otrosUsuarios={otrosEnCarrito[contract.id]}
              />
            ))}
          </div>
        )}

        {/* PAGINACIÓN */}
        {totalPages > 1 && !loadingData && (
          <div className="flex items-center justify-center gap-2 pt-4">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium disabled:opacity-40 hover:bg-slate-50 transition-colors"
            >← Anterior</button>
            <span className="text-sm text-slate-500 px-3">{page} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium disabled:opacity-40 hover:bg-slate-50 transition-colors"
            >Siguiente →</button>
          </div>
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