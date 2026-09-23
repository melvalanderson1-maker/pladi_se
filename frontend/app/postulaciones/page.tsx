'use client'

import { useEffect, useState } from 'react'
import {
  ClipboardCheck, Loader2, Building2, Calendar, FileClock, Send,
  Search, Radio, Hourglass, Trophy, Award, XCircle, Flag,
  ChevronDown, ChevronUp, FileText, Download,
} from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { obtenerMisPostulaciones, type PostulacionItem } from '@/lib/cotizaciones-api'

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

// ─── Insignia del estado real del proceso en SEACE ─────────────────────────
// Vigente = verde, En Evaluación = morado suave, Culminado (y variantes
// desierto / adjudicado a otro) = rojo suave. Ganado siempre resalta aparte.
function EstadoProcesoBadge({ p }: { p: PostulacionItem }) {
  const estado = p.id_estado_contrato

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
    if (p.resultado_proceso === 'ganado') {
      return (
        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-900 bg-gradient-to-r from-amber-100 via-yellow-100 to-amber-100 border border-amber-300 ring-1 ring-amber-300/60 px-2.5 py-1 rounded-full shadow-sm whitespace-nowrap">
          <Trophy size={12} className="text-amber-600"/> Ganado
        </span>
      )
    }
    if (p.resultado_proceso === 'adjudicado_otro') {
      return (
        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-full whitespace-nowrap">
          <Award size={11} className="text-rose-500"/> Adjudicado a otro
        </span>
      )
    }
    if (p.resultado_proceso === 'desierto') {
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

// ─── Fila de la tabla, expandible para ver los archivos del contrato ──────
function FilaPostulacion({ p, indice }: { p: PostulacionItem; indice: number }) {
  const [expandido, setExpandido] = useState(false)
  const [archivos, setArchivos] = useState<ArchivoSubido[]>([])
  const [cargando, setCargando] = useState(false)
  const [cargados, setCargados] = useState(false)

  const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
  const filaBase = indice % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'

  const toggle = async () => {
    setExpandido(v => !v)
    if (!cargados && !expandido && p.id_cotizacion_seace) {
      setCargando(true)
      try {
        const res = await fetch(
          `${API}/api/contratos/${p.id_contrato}/cotizacion/${p.id_cotizacion_seace}/archivos-subidos`
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
          {p.total_archivos > 0 ? (
            expandido ? <ChevronUp size={14} className="text-slate-400"/> : <ChevronDown size={14} className="text-slate-400"/>
          ) : <span className="w-3.5 inline-block"/>}
        </td>
        <td className="pl-1 pr-4 py-3 align-top">
          <p className="text-xs font-mono font-semibold text-slate-500">{p.des_contratacion || `#${p.id_contrato}`}</p>
          <p className="text-xs font-medium text-slate-700 leading-snug mt-1 break-words">{p.des_objeto_contrato || '—'}</p>
          <p className="text-[10px] text-slate-400 mt-1">{p.nom_entidad || '—'}</p>
        </td>
        <td className="px-4 py-3 align-top">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700 truncate">
            <Building2 size={12} className="text-slate-400 shrink-0"/>
            <span className="truncate">{p.empresa_usada}</span>
          </div>
        </td>
        <td className="px-4 py-3 align-top">
          {p.estado_cotizacion === 'enviada' ? (
            <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-sky-600 whitespace-nowrap">
              <Send size={18} className="text-sky-500 shrink-0"/> Enviada
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-amber-600 whitespace-nowrap">
              <FileClock size={18} className="text-amber-500 shrink-0"/> Borrador
            </span>
          )}
        </td>
        <td className="px-4 py-3 align-top">
          <EstadoProcesoBadge p={p}/>
        </td>
        <td className="px-4 py-3 align-top">
          <div className="flex items-start gap-1.5 text-xs text-slate-600">
            <Calendar size={12} className="text-slate-400 shrink-0 mt-0.5"/>
            <div className="leading-snug">
              <p className="font-medium whitespace-nowrap">{formatFechaCorta(p.fecha_cotizado)}</p>
              <p className="text-xs font-bold text-slate-700 whitespace-nowrap mt-0.5">{formatHora(p.fecha_cotizado)}</p>
            </div>
          </div>
        </td>
        <td className="px-4 py-3 text-right align-top">
          {p.total_archivos > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">
              <FileText size={11}/> {p.total_archivos}
            </span>
          )}
        </td>
      </tr>

      {expandido && (
        <tr className={`${filaBase} border-t border-slate-100`}>
          <td colSpan={7} className="px-4 py-3">
            {!p.id_cotizacion_seace ? (
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
                    <a href={`${API}/api/contratos/${p.id_contrato}/cotizacion/${p.id_cotizacion_seace}/archivos-subidos/${a.id}/descargar`}
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
export default function PostulacionesPage() {
  const { token } = useAuth()
  const [postulaciones, setPostulaciones] = useState<PostulacionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'borrador' | 'enviada'>('todos')

  useEffect(() => {
    if (!token) return
    obtenerMisPostulaciones(token)
      .then(res => setPostulaciones(res.postulaciones))
      .catch((e: any) => setError(e.message || 'No se pudo cargar la información'))
      .finally(() => setLoading(false))
  }, [token])

  const filtradas = postulaciones.filter(p => {
    if (filtroEstado !== 'todos' && p.estado_cotizacion !== filtroEstado) return false
    if (!search.trim()) return true
    const s = search.toLowerCase()
    return (
      p.des_contratacion?.toLowerCase().includes(s) ||
      p.des_objeto_contrato?.toLowerCase().includes(s) ||
      p.nom_entidad?.toLowerCase().includes(s) ||
      p.empresa_usada?.toLowerCase().includes(s)
    )
  })

  const totalEnviadas = postulaciones.filter(p => p.estado_cotizacion === 'enviada').length
  const totalBorradores = postulaciones.filter(p => p.estado_cotizacion === 'borrador').length
  const totalGanados = postulaciones.filter(p => p.resultado_proceso === 'ganado').length

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="w-full px-6 py-6 2xl:px-10">
        <div className="flex items-center gap-3 mb-6">
          <ClipboardCheck size={22} className="text-blue-600"/>
          <h1 className="text-xl font-bold text-slate-800">Mis Postulaciones</h1>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4">
            <p className="text-2xl font-extrabold text-slate-800">{totalEnviadas}</p>
            <p className="text-xs text-slate-500 font-medium">Enviadas</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4">
            <p className="text-2xl font-extrabold text-slate-800">{totalBorradores}</p>
            <p className="text-xs text-slate-500 font-medium">Borradores</p>
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
              placeholder="Buscar por contrato, entidad, empresa..."
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
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24 gap-3 text-slate-400">
            <Loader2 size={22} className="animate-spin"/>
            <span className="text-sm">Cargando tus cotizaciones...</span>
          </div>
        ) : postulaciones.length === 0 ? (
          <div className="text-center py-24 text-sm text-slate-400">
            Todavía no has enviado ninguna cotización.
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className="w-4"/>
                <col className="w-[32%]"/>
                <col className="w-[16%]"/>
                <col className="w-[12%]"/>
                <col className="w-[15%]"/>
                <col className="w-[14%]"/>
                <col className="w-[7%]"/>
              </colgroup>
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="w-4 p-0"></th>
                  <th className="text-left pl-1 pr-4 py-3">Contrato</th>
                  <th className="text-left px-4 py-3">Empresa</th>
                  <th className="text-left px-4 py-3">Estado Cotización</th>
                  <th className="text-left px-4 py-3">Estado del Proceso</th>
                  <th className="text-left px-4 py-3">Fecha</th>
                  <th className="text-right px-4 py-3">Archivos</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((p, i) => (
                  <FilaPostulacion key={p.id_registro} p={p} indice={i}/>
                ))}
                {filtradas.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
                      No hay postulaciones que coincidan.
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