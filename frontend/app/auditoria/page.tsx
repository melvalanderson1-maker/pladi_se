'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/components/AuthProvider'
import {
  Shield, Building2, User, FileText, Loader2, Search,
  ChevronDown, ChevronUp, Download, Calendar, Package,
  CheckCircle2, Clock, X, Radio, Hourglass, Trophy, Award,
  XCircle, Flag, Send, FileClock,
} from 'lucide-react'

type RegistroAuditoria = {
  id_registro: number
  id_contrato: number
  id_cotizacion_seace: number | null
  estado_cotizacion: 'borrador' | 'enviada'
  fecha_cotizado: string | null
  id_usuario: number | null
  nombre_usuario: string | null
  id_empresa: number | null
  razon_social: string | null
  des_contratacion: string | null
  des_objeto_contrato: string | null
  nom_entidad: string | null
  total_archivos: number
  id_estado_contrato: number | null
  nom_estado_contrato: string | null
  resultado_proceso: 'ganado' | 'adjudicado_otro' | 'desierto' | 'culminado' | null
}

type ArchivoSubido = {
  id: number
  id_contrato_archivo: number
  id_usuario: number
  nombre_usuario: string | null
  id_empresa: number
  razon_social: string | null
  nombre_archivo: string
  extension: string | null
  bytes: number | null
  fecha_subida: string | null
}

function formatFechaCorta(f: string | null) {
  if (!f) return '—'
  try {
    return new Intl.DateTimeFormat('es-PE', {
      day: 'numeric', month: 'short', year: 'numeric',
    }).format(new Date(f)).replace('.', '')
  } catch {
    return f
  }
}

function formatHora(f: string | null) {
  if (!f) return ''
  try {
    return new Intl.DateTimeFormat('es-PE', {
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date(f))
  } catch {
    return ''
  }
}

function formatBytes(b: number | null) {
  if (!b) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

// ─── Insignia del estado real del proceso en SEACE ─────────────────────────
// Vigente = verde (proceso abierto, en curso)
// En Evaluación = morado suave (fase intermedia, en revisión)
// Culminado (y sus variantes: desierto / adjudicado a otro) = rojo suave (proceso cerrado)
// Ganado = insignia dorada independiente, siempre debe resaltar sobre las demás
function EstadoProcesoBadge({ registro }: { registro: RegistroAuditoria }) {
  const estado = registro.id_estado_contrato

  if (estado === 2) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full whitespace-nowrap">
        <Radio size={11} className="text-emerald-500"/> Vigente
      </span>
    )
  }

  if (estado === 3) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-violet-700 bg-violet-50 border border-violet-200 px-2.5 py-1 rounded-full whitespace-nowrap">
        <Hourglass size={11} className="text-violet-500"/> En Evaluación
      </span>
    )
  }

  if (estado === 4) {
    // Ganado se muestra SIEMPRE con su propia identidad visual (dorado),
    // nunca se mezcla con el rojo suave del resto de culminados — es la
    // señal más importante del panel y debe notarse de inmediato.
    if (registro.resultado_proceso === 'ganado') {
      return (
        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-900 bg-gradient-to-r from-amber-100 via-yellow-100 to-amber-100 border border-amber-300 ring-1 ring-amber-300/60 px-2.5 py-1 rounded-full shadow-sm whitespace-nowrap">
          <Trophy size={12} className="text-amber-600"/> Ganado
        </span>
      )
    }
    if (registro.resultado_proceso === 'adjudicado_otro') {
      return (
        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-full whitespace-nowrap">
          <Award size={11} className="text-rose-500"/> Adjudicado a otro
        </span>
      )
    }
    if (registro.resultado_proceso === 'desierto') {
      return (
        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-full whitespace-nowrap">
          <XCircle size={11} className="text-rose-500"/> Desierto
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-full whitespace-nowrap">
        <Flag size={11} className="text-rose-500"/> Culminado
      </span>
    )
  }

  return <span className="text-[10px] text-slate-400">—</span>
}
// ─── Fila expandible con archivos ──────────────────────────────────────────
function FilaRegistro({ registro, indice }: { registro: RegistroAuditoria; indice: number }) {
  const [expandido, setExpandido] = useState(false)
  const [archivos, setArchivos] = useState<ArchivoSubido[]>([])
  const [cargando, setCargando] = useState(false)
  const [cargados, setCargados] = useState(false)

  const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  // Zebra striping muy sutil para diferenciar cada fila/contrato a simple vista
  const filaBase = indice % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'

  const toggle = async () => {
    setExpandido(v => !v)
    if (!cargados && !expandido && registro.id_cotizacion_seace) {
      setCargando(true)
      try {
        const res = await fetch(
          `${API}/api/contratos/${registro.id_contrato}/cotizacion/${registro.id_cotizacion_seace}/archivos-subidos`
        )
        const data = await res.json()
        setArchivos(data)
        setCargados(true)
      } catch {
        setArchivos([])
      } finally {
        setCargando(false)
      }
    }
  }

  return (
    <>
      <tr className={`${filaBase} border-t border-slate-100 hover:bg-slate-100/70 cursor-pointer transition-colors`} onClick={toggle}>
        <td className="pl-1 pr-0 py-3 align-top">
          {registro.total_archivos > 0 ? (
            expandido ? <ChevronUp size={14} className="text-slate-400"/> : <ChevronDown size={14} className="text-slate-400"/>
          ) : <span className="w-3.5 inline-block"/>}
        </td>
        <td className="pl-1 pr-4 py-3 align-top">
          <p className="text-xs font-mono font-semibold text-slate-500">{registro.des_contratacion || `#${registro.id_contrato}`}</p>
          <p className="text-xs font-medium text-slate-700 leading-snug mt-1 break-words">{registro.des_objeto_contrato || '—'}</p>
          <p className="text-[10px] text-slate-400 mt-1">{registro.nom_entidad || '—'}</p>
        </td>
        <td className="px-4 py-3 align-top">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700 truncate">
            <User size={12} className="text-slate-400 shrink-0"/>
            <span className="truncate">{registro.nombre_usuario || '—'}</span>
          </div>
        </td>
        <td className="px-4 py-3 align-top">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700 truncate">
            <Building2 size={12} className="text-slate-400 shrink-0"/>
            <span className="truncate">{registro.razon_social || '—'}</span>
          </div>
        </td>
        <td className="px-4 py-3 align-top">
          {registro.estado_cotizacion === 'enviada' ? (
            <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-sky-600 whitespace-nowrap">
              <Send size={18} className="text-sky-500 shrink-0"/> Enviada
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-amber-600 whitespace-nowrap">
              <FileClock size={18} className="text-amber-500 shrink-0"/> Borrador
            </span>
          )}
        </td>
        <td className="px-4 py-3">
          <EstadoProcesoBadge registro={registro}/>
        </td>
        <td className="px-4 py-3 align-top">
          <div className="flex items-start gap-1.5 text-xs text-slate-600">
            <Calendar size={12} className="text-slate-400 shrink-0 mt-0.5"/>
            <div className="leading-snug">
              <p className="font-medium whitespace-nowrap">{formatFechaCorta(registro.fecha_cotizado)}</p>
              <p className="text-xs font-bold text-slate-700 whitespace-nowrap mt-0.5">{formatHora(registro.fecha_cotizado)}</p>
            </div>
          </div>
        </td>
        <td className="px-4 py-3 text-right">
          {registro.total_archivos > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">
              <FileText size={11}/> {registro.total_archivos}
            </span>
          )}
        </td>
      </tr>

      {expandido && (
        <tr className={`${filaBase} border-t border-slate-100`}>
          <td colSpan={8} className="px-4 py-3">
            {!registro.id_cotizacion_seace ? (
              <p className="text-xs text-slate-400 pl-6">Sin id de cotización SEACE registrado.</p>
            ) : cargando ? (
              <div className="flex items-center gap-2 text-xs text-slate-400 pl-6">
                <Loader2 size={13} className="animate-spin"/> Cargando archivos...
              </div>
            ) : archivos.length === 0 ? (
              <p className="text-xs text-slate-400 pl-6">No hay archivos registrados para esta cotización.</p>
            ) : (
              <div className="pl-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                {archivos.map(a => (
                  <div key={a.id} className="flex items-center gap-2.5 bg-white border border-slate-100 rounded-xl px-3 py-2.5 min-w-0">
                    <FileText size={16} className="text-blue-500 shrink-0"/>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-slate-700 truncate">{a.nombre_archivo}</p>
                      <p className="text-[10px] text-slate-400">
                        {formatBytes(a.bytes)} · {formatFechaCorta(a.fecha_subida)} · {formatHora(a.fecha_subida)}
                      </p>
                    </div>
                    <a href={`${API}/api/contratos/${registro.id_contrato}/cotizacion/${registro.id_cotizacion_seace}/archivos-subidos/${a.id}/descargar`}
                       onClick={e => e.stopPropagation()}
                       target="_blank"
                       rel="noopener noreferrer"
                       title="Descargar"
                       className="shrink-0 text-blue-600 hover:text-blue-700 p-1.5 rounded-lg hover:bg-blue-50 transition-colors"
                    >
                      <Download size={15}/>
                    </a>
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Página principal ───────────────────────────────────────────────────────
export default function AuditoriaPage() {
  const { token } = useAuth()
  const [registros, setRegistros] = useState<RegistroAuditoria[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'borrador' | 'enviada'>('todos')

  const SCRAPER = process.env.NEXT_PUBLIC_SCRAPER_URL || 'http://localhost:4000'

  const cargar = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${SCRAPER}/cotizaciones/auditoria`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('No se pudo cargar la auditoría')
      const data = await res.json()
      setRegistros(data.registros)
    } catch (e: any) {
      setError(e.message || 'Error cargando auditoría')
    } finally {
      setLoading(false)
    }
  }, [token, SCRAPER])

  useEffect(() => { cargar() }, [cargar])

  const filtrados = registros.filter(r => {
    if (filtroEstado !== 'todos' && r.estado_cotizacion !== filtroEstado) return false
    if (!search.trim()) return true
    const s = search.toLowerCase()
    return (
      r.des_contratacion?.toLowerCase().includes(s) ||
      r.des_objeto_contrato?.toLowerCase().includes(s) ||
      r.nom_entidad?.toLowerCase().includes(s) ||
      r.nombre_usuario?.toLowerCase().includes(s) ||
      r.razon_social?.toLowerCase().includes(s)
    )
  })

  const totalEnviadas = registros.filter(r => r.estado_cotizacion === 'enviada').length
  const totalBorradores = registros.filter(r => r.estado_cotizacion === 'borrador').length
  const totalArchivos = registros.reduce((acc, r) => acc + r.total_archivos, 0)
  const totalGanados = registros.filter(r => r.resultado_proceso === 'ganado').length

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="w-full px-6 py-6 2xl:px-10">
        <div className="flex items-center gap-3 mb-6">
          <Shield size={22} className="text-blue-600"/>
          <h1 className="text-xl font-bold text-slate-800">Auditoría de Cotizaciones</h1>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4">
            <p className="text-2xl font-extrabold text-slate-800">{totalEnviadas}</p>
            <p className="text-xs text-slate-500 font-medium">Enviadas</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4">
            <p className="text-2xl font-extrabold text-slate-800">{totalBorradores}</p>
            <p className="text-xs text-slate-500 font-medium">Borradores</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4">
            <p className="text-2xl font-extrabold text-slate-800">{totalArchivos}</p>
            <p className="text-xs text-slate-500 font-medium">Archivos totales</p>
          </div>
          <div className="bg-gradient-to-br from-amber-50 to-white rounded-2xl border border-amber-200 shadow-sm px-5 py-4">
            <div className="flex items-center gap-2">
              <Trophy size={18} className="text-amber-500"/>
              <p className="text-2xl font-extrabold text-amber-700">{totalGanados}</p>
            </div>
            <p className="text-xs text-amber-700/80 font-semibold mt-0.5">Contratos ganados</p>
          </div>
        </div>

        {/* Filtros */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3 mb-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por contrato, entidad, usuario, empresa..."
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
            {(['todos', 'enviada', 'borrador'] as const).map(v => (
              <button
                key={v}
                onClick={() => setFiltroEstado(v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  filtroEstado === v ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {v === 'todos' ? 'Todos' : v === 'enviada' ? 'Enviadas' : 'Borradores'}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 mb-4">
            {error}
            <button onClick={cargar} className="ml-auto underline text-xs">Reintentar</button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24 gap-3 text-slate-400">
            <Loader2 size={22} className="animate-spin"/>
            <span className="text-sm">Cargando auditoría...</span>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm table-fixed">

              <colgroup>
                <col className="w-4"/>
                <col className="w-[32%]"/>
                <col className="w-[9%]"/>
                <col className="w-[13%]"/>
                <col className="w-[9%]"/>
                <col className="w-[12%]"/>
                <col className="w-[13%]"/>
                <col className="w-[6%]"/>
              </colgroup>
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="w-4 p-0"></th>
                  <th className="text-left pl-1 pr-4 py-3">Contrato</th>
                  <th className="text-left px-4 py-3">Usuario</th>
                  <th className="text-left px-4 py-3">Empresa</th>
                  <th className="text-left px-4 py-3">Estado Cotización</th>
                  <th className="text-left px-4 py-3">Estado del Proceso</th>
                  <th className="text-left px-4 py-3">Fecha</th>
                  <th className="text-right px-4 py-3">Archivos</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((r, i) => <FilaRegistro key={r.id_registro} registro={r} indice={i}/>)}
                {filtrados.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">
                      No hay registros que coincidan.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}