'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  Building2, Calendar, Hash, FileText,
  ShoppingCart, CheckCircle, Clock, XCircle,
  AlertCircle, Eye, Tag, X, Loader2, Send,
} from 'lucide-react'

export interface ContractDocument {
  id: string
  label: string
  document_id: string | null
}

export interface Contract {
  id          : number
  code        : string
  title       : string
  entity      : string
  contractor  : string
  location?   : string
  amount      : number | null
  status      : string
  start_date  : string
  end_date    : string
  object?     : string
  description?: string
  cotizar     : boolean
  nom_estado_cotiza?: string | null
  total_archivos_contrato  : number
  total_archivos_cotizacion: number
  documents   : ContractDocument[]
  items_preview?: { nom_cubso?: string; cod_cubso?: string; cantidad?: number; nom_unidad_medida?: string }[]
  cotizacion_usuario?: string | null
  cotizacion_empresa?: string | null
  cotizacion_estado?: string | null
  cotizacion_fecha?: string | null
}

interface ContractCardProps {
  contract  : Contract
  onClick   : (contract: Contract) => void
  onCotizar?: (contract: Contract, e: React.MouseEvent) => void
  onCotizarSeace?: (contract: Contract, e: React.MouseEvent) => void
  items?    : { nom_cubso?: string; cod_cubso?: string; cantidad?: number; nom_unidad_medida?: string }[]
  inCotizar?: boolean
  otrosUsuarios?: string[]
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; bg: string; text: string; dot: string }> = {
    vigente      : { label: 'Vigente',       bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
    en_evaluacion: { label: 'En Evaluación', bg: 'bg-violet-50',  text: 'text-violet-700',  dot: 'bg-violet-500'  },
    culminado    : { label: 'Culminado',     bg: 'bg-rose-50',    text: 'text-rose-700',    dot: 'bg-rose-500'    },
  }
  const c = cfg[status] ?? { label: status, bg: 'bg-slate-50', text: 'text-slate-600', dot: 'bg-slate-400' }
  return (
    <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`}/>
      {c.label}
    </span>
  )
}

const borderColor: Record<string, string> = {
  vigente      : 'border-l-emerald-400',
  en_evaluacion: 'border-l-violet-400',
  culminado    : 'border-l-rose-400',
}

// ── Items popup ───────────────────────────────────────────────────────────────
function ItemsPopup({ items, loading, onClose }: {
  items: { nom_cubso?: string; cod_cubso?: string; cantidad?: number; nom_unidad_medida?: string; descripcion_item?: string; precio_total?: number; nom_distrito?: string }[]
  loading?: boolean
  onClose: () => void
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
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"/>
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[70vh] flex flex-col overflow-hidden border border-slate-100"
        onClick={e => e.stopPropagation()}
      >
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Eye size={14} className="text-white"/>
            <span className="text-sm font-bold text-white">Ítems del contrato</span>
          </div>
          <button onClick={onClose} className="w-6 h-6 rounded-lg bg-blue-500 hover:bg-blue-400 flex items-center justify-center text-white transition-colors">
            <X size={12}/>
          </button>
        </div>
        <div className="overflow-y-auto p-3 space-y-2 flex-1">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-2">
              <Loader2 size={22} className="animate-spin text-blue-500"/>
              <p className="text-xs">Cargando ítems...</p>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-400">
              <FileText size={28} className="mb-2 opacity-30"/>
              <p className="text-xs">Sin ítems registrados</p>
            </div>
          ) : items.map((it: any, i: number) => (
            <div key={i} className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-100 hover:border-blue-200 hover:bg-blue-50 transition-colors">
              <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i+1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-700 leading-snug">{it.nom_cubso || it.cod_cubso || '—'}</p>
                {it.descripcion_item && (
                  <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">{it.descripcion_item}</p>
                )}
                <div className="flex flex-wrap gap-3 mt-1.5 text-[10px] text-slate-400">
                  {it.cantidad    && <span>Cant: <b className="text-slate-600">{it.cantidad}</b> {it.nom_unidad_medida}</span>}
                  {it.precio_total && <span>Total: <b className="text-slate-600">S/ {Number(it.precio_total).toFixed(2)}</b></span>}
                  {it.nom_distrito && <span>📍 {it.nom_distrito}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>  
      </div>
    </div>
  )
}

// ── Main card ─────────────────────────────────────────────────────────────────
export function ContractCard({ contract, onClick, onCotizar, onCotizarSeace, items, inCotizar, otrosUsuarios }: ContractCardProps) {
  const [showItems, setShowItems] = useState(false)
  const [loadingItems, setLoadingItems] = useState(false)
  const [itemsCargados, setItemsCargados] = useState<any[]>([])

  const border    = borderColor[contract.status] ?? 'border-l-slate-300'
  const isCotizar = contract.cotizar

  const formatFecha = (f: string | null | undefined) => {
    if (!f) return '—'

    try {
      // convertir "DD/MM/YYYY HH:mm:ss" → "YYYY-MM-DDTHH:mm:ss"
      const [datePart, timePart] = f.split(' ')
      if (!datePart) return '—'

      const [day, month, year] = datePart.split('/')

      const isoString = `${year}-${month}-${day}T${timePart ?? '00:00:00'}`

      const date = new Date(isoString)

      if (isNaN(date.getTime())) return f // fallback seguro

      return new Intl.DateTimeFormat('es-PE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(date)

    } catch (e) {
      return f
    }
  }
  const formatMonto = (v: number | null) => {
    if (!v) return null
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', maximumFractionDigits: 2 }).format(v)
  }

  const monto     = formatMonto(contract.amount)
  const totalDocs = contract.total_archivos_contrato + contract.total_archivos_cotizacion

  // Función para calcular tiempo restante
// ── Contador dinámico de tiempo restante ────────────────────────────────────
  const [tiempoRestante, setTiempoRestante] = useState<any>(null)

  const calcularTiempoRestante = useCallback((fechaTarget: string | undefined, tipo: 'habilita' | 'cierra') => {
    if (!fechaTarget) return null
    try {
      const [datePart, timePart] = fechaTarget.split(' ')
      const [day, month, year] = datePart.split('/')
      const fecha = new Date(`${year}-${month}-${day}T${timePart ?? '00:00:00'}`)
      const ahora = new Date()
      const diferencia = fecha.getTime() - ahora.getTime()
      
      if (diferencia <= 0) {
        return { 
          texto: tipo === 'habilita' ? 'Habilitado ahora' : 'Proceso vencido',
          color: tipo === 'habilita' ? 'text-emerald-700' : 'text-rose-700',
          bg: tipo === 'habilita' ? 'bg-emerald-50' : 'bg-rose-50'
        }
      }
      
      const dias = Math.floor(diferencia / (1000 * 60 * 60 * 24))
      const horas = Math.floor((diferencia % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
      const minutos = Math.floor((diferencia % (1000 * 60 * 60)) / (1000 * 60))
      
      let colorScheme = 'text-slate-600'
      let bgScheme = 'bg-slate-50'
      
      if (tipo === 'habilita') {
        // Antes de habilitarse: azul → gris
        colorScheme = dias > 7 ? 'text-blue-700' : dias > 3 ? 'text-blue-600' : 'text-cyan-600'
        bgScheme = dias > 7 ? 'bg-blue-50' : dias > 3 ? 'bg-blue-50' : 'bg-cyan-50'
      } else {
        // Después de habilitarse: verde → naranja → rojo
        colorScheme = dias > 7 ? 'text-emerald-700' : dias > 3 ? 'text-amber-700' : 'text-orange-700'
        bgScheme = dias > 7 ? 'bg-emerald-50' : dias > 3 ? 'bg-amber-50' : 'bg-orange-50'
      }
      
      let textoFormatado = ''
      if (dias > 0) {
        textoFormatado = `${dias}d ${horas}h ${minutos}m`
      } else {
        textoFormatado = `${horas}h ${minutos}m`
      }
      
      return { 
        texto: textoFormatado,
        color: colorScheme,
        bg: bgScheme
      }
    } catch {
      return null
    }
  }, [])

  // Effect para actualizar contador cada minuto
// Effect para actualizar contador como cronómetro (cada segundo)
  useEffect(() => {
    const actualizarContador = () => {
      const tipo = isCotizar ? 'cierra' : 'habilita'
      const fecha = isCotizar ? contract.end_date : contract.start_date
      setTiempoRestante(calcularTiempoRestante(fecha, tipo))
    }
    
    actualizarContador()
    const interval = setInterval(actualizarContador, 1000) // Actualiza cada SEGUNDO
    
    return () => clearInterval(interval)
  }, [contract.end_date, contract.start_date, isCotizar, calcularTiempoRestante])

  return (
    <>
      <button
        onClick={() => onClick(contract)}
        className={`
          w-full text-left rounded-2xl border-l-4 ${border} border border-slate-100
          shadow-sm hover:shadow-xl transition-all duration-200 hover:-translate-y-1
          overflow-hidden group relative
          ${inCotizar
            ? 'bg-gradient-to-br from-emerald-50 to-teal-50 ring-2 ring-emerald-300/70 shadow-lg'
            : isCotizar
              ? 'bg-gradient-to-br from-emerald-50 to-emerald-100 ring-2 ring-emerald-300/80 shadow-md'
              : 'bg-white'
          }
        `}
      >
        {/* Ribbon cotizar */}
        {/* Ribbon cotizar - Destacado */}
        {/* Ribbon cotizar - Profesional */}
        {isCotizar && contract.status === 'vigente' && (
          <div className={`px-3 py-1.5 flex items-center gap-1.5 font-bold text-[9px] uppercase tracking-widest border-b
            ${inCotizar 
              ? 'bg-gradient-to-r from-emerald-600 to-emerald-700 border-emerald-800 text-white shadow-sm' 
              : tiempoRestante?.texto === 'Proceso vencido'
                ? 'bg-gradient-to-r from-rose-600 to-rose-700 border-rose-800 text-white shadow-sm'
                : 'bg-gradient-to-r from-green-600 to-green-700 border-green-800 text-white shadow-sm'
            }`}>
            <ShoppingCart size={10} className="opacity-90"/>
            <span>
              {inCotizar ? 'Activo en cotizaciones' : 'Disponible para cotizar'}
            </span>
          </div>
        )}

        {contract.cotizacion_usuario && (
          <div className={`px-3 py-1.5 flex items-center gap-1.5 font-bold text-[9px] uppercase tracking-widest border-b
            ${contract.cotizacion_estado?.toUpperCase().includes('ENVIA')
              ? 'bg-gradient-to-r from-blue-600 to-blue-700 border-blue-800 text-white shadow-sm'
              : 'bg-gradient-to-r from-amber-500 to-amber-600 border-amber-700 text-white shadow-sm'
            }`}>
            <CheckCircle size={10} className="opacity-90 shrink-0"/>
            <span className="truncate normal-case tracking-normal font-semibold">
              {contract.cotizacion_estado?.toUpperCase().includes('ENVIA') ? '✓ Enviada' : '📝 Borrador'} — {contract.cotizacion_usuario}
              {contract.cotizacion_empresa ? ` · ${contract.cotizacion_empresa}` : ''}
              {contract.cotizacion_fecha ? ` · ${formatFecha(contract.cotizacion_fecha)}` : ''}
            </span>
          </div>
        )}

        <div className="p-4 pb-3">

          {otrosUsuarios && otrosUsuarios.length > 0 && (
            <div className="mb-2 flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg w-fit">
              <ShoppingCart size={10}/>
              también en el carrito de {otrosUsuarios[0]}
              {otrosUsuarios.length > 1 ? ` +${otrosUsuarios.length - 1}` : ''}
            </div>
          )}
          {/* Header */}
          {/* Header - Código de Contratación */}
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 px-2.5 py-2 bg-slate-50 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors group">
                <span className="text-[10.2px] font-bold font-mono text-slate-700 select-all cursor-text break-words">
                  {contract.code}
                </span>
              </div>
            </div>
            <StatusBadge status={contract.status}/>
          </div>

          {/* Tipo objeto */}
          {contract.object && (
            <div className="flex items-center gap-1 mb-1.5">
              <Tag size={9} className="text-blue-400 shrink-0"/>
              <p className="text-[9px] font-bold uppercase tracking-wider text-blue-500">{contract.object}</p>
            </div>
          )}

          {/* Título */}
          <h3 className="text-sm font-semibold text-slate-800 leading-snug mb-3 group-hover:text-blue-700 transition-colors line-clamp-3">
            {contract.title}
          </h3>

          {/* Entidad */}
          <div className="flex items-start gap-1.5 text-xs text-slate-500 mb-1.5">
            <Building2 size={11} className="shrink-0 text-slate-400 mt-0.5"/>
            <span className="line-clamp-2 leading-snug">{contract.entity}</span>
          </div>

          {/* Fechas */}
          {/* Fechas y Countdown */}

          {/* Fechas - Matriz 1x2 (lado a lado) */}
          <div className="flex items-start gap-2 mb-3 pb-3 border-b border-slate-100">
            <Calendar size={12} className="shrink-0 text-slate-400 mt-0.5"/>
            <div className="min-w-0 flex-1">
              <div className="grid grid-cols-2 gap-3">
                {/* Fecha de Inicio */}
                <div>
                  <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">Inicio</div>
                  <div className="text-xs text-slate-700 font-medium mt-1 leading-snug">
                    {formatFecha(contract.start_date)}
                  </div>
                </div>
                
                {/* Fecha de Fin */}
                {contract.end_date && (
                  <div>
                    <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">Vencimiento</div>
                  <div className="text-xs text-slate-700 font-medium mt-1 leading-snug">
                    {formatFecha(contract.end_date)}
                  </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Contador + Botones - Integrados en una sola fila */}
            {contract.status === 'culminado' ? (
            // ──── ESTADO CULMINADO: Mostrar "Finalizado" ────
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 px-2.5 py-2 rounded-lg border border-rose-300 bg-rose-50">
                <div className="w-8 h-8 rounded-lg bg-rose-200 flex items-center justify-center shrink-0">
                  <XCircle size={14} className="text-rose-600"/>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-medium text-rose-600 uppercase tracking-wide">Proceso</div>
                  <div className="text-sm font-bold text-rose-700">Finalizado</div>
                </div>
              </div>

              {/* Botones a la derecha - Sin cotizar */}
              <div className="flex items-center gap-1">
                {totalDocs > 0 && (
                  <button
                    onClick={async e => {
                      e.stopPropagation()
                      setShowItems(true)
                      if (itemsCargados.length === 0) {
                        setLoadingItems(true)
                        try {
                          const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
                          const res = await fetch(`${API}/api/contratos/${contract.id}/items`)
                          const data = await res.json()
                          setItemsCargados(data)
                        } catch { setItemsCargados([]) }
                        finally { setLoadingItems(false) }
                      }
                    }}
                    title={`Ver ${totalDocs} documento${totalDocs !== 1 ? 's' : ''}`}
                    className="flex items-center gap-0.5 text-[10px] text-slate-500 bg-slate-100 hover:bg-slate-200 px-2 py-1.5 rounded-lg border border-slate-200 transition-colors"
                  >
                    <FileText size={10}/>
                    {totalDocs}
                  </button>
                )}

                <button
                  onClick={async e => {
                    e.stopPropagation()
                    setShowItems(true)
                    if (itemsCargados.length === 0) {
                      setLoadingItems(true)
                      try {
                        const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
                        const res = await fetch(`${API}/api/contratos/${contract.id}/items`)
                        const data = await res.json()
                        setItemsCargados(data)
                      } catch { setItemsCargados([]) }
                      finally { setLoadingItems(false) }
                    }
                  }}
                  title="Ver ítems del contrato"
                  className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-700 flex items-center justify-center transition-all border border-slate-200 hover:border-slate-300"
                >
                  <Eye size={13}/>
                </button>
              </div>
            </div>
          ) : contract.status === 'en_evaluacion' ? (
            // ──── ESTADO EN EVALUACIÓN: Mostrar "En proceso" ────
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 px-2.5 py-2 rounded-lg border border-violet-300 bg-violet-50">
                <div className="w-8 h-8 rounded-lg bg-violet-200 flex items-center justify-center shrink-0">
                  <Clock size={14} className="text-violet-600 animate-pulse"/>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-medium text-violet-600 uppercase tracking-wide">Estado</div>
                  <div className="text-sm font-bold text-violet-700">En proceso de evaluación</div>
                </div>
              </div>

              {/* Botones a la derecha - Sin cotizar */}
              <div className="flex items-center gap-1">
                {totalDocs > 0 && (
                  <button
                    onClick={async e => {
                      e.stopPropagation()
                      setShowItems(true)
                      if (itemsCargados.length === 0) {
                        setLoadingItems(true)
                        try {
                          const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
                          const res = await fetch(`${API}/api/contratos/${contract.id}/items`)
                          const data = await res.json()
                          setItemsCargados(data)
                        } catch { setItemsCargados([]) }
                        finally { setLoadingItems(false) }
                      }
                    }}
                    title={`Ver ${totalDocs} documento${totalDocs !== 1 ? 's' : ''}`}
                    className="flex items-center gap-0.5 text-[10px] text-slate-500 bg-slate-100 hover:bg-slate-200 px-2 py-1.5 rounded-lg border border-slate-200 transition-colors"
                  >
                    <FileText size={10}/>
                    {totalDocs}
                  </button>
                )}

                <button
                  onClick={async e => {
                    e.stopPropagation()
                    setShowItems(true)
                    if (itemsCargados.length === 0) {
                      setLoadingItems(true)
                      try {
                        const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
                        const res = await fetch(`${API}/api/contratos/${contract.id}/items`)
                        const data = await res.json()
                        setItemsCargados(data)
                      } catch { setItemsCargados([]) }
                      finally { setLoadingItems(false) }
                    }
                  }}
                  title="Ver ítems del contrato"
                  className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-700 flex items-center justify-center transition-all border border-slate-200 hover:border-slate-300"
                >
                  <Eye size={13}/>
                </button>
              </div>
            </div>
          ) : tiempoRestante && (
            // ──── ESTADO VIGENTE: Mostrar contador de tiempo ────
            <div className="flex items-center gap-2">
              {/* Contador dinámico a la izquierda */}
              <div className={`flex-1 flex items-center gap-2 px-2.5 py-2 rounded-lg border transition-all ${tiempoRestante.bg} ${tiempoRestante.color}`}
                style={{borderColor: tiempoRestante.color.replace('text-', 'border-').replace('-700', '-300').replace('-600', '-300')}}>
                <Clock size={14} className="shrink-0 animate-pulse"/>
                <div className="min-w-0 flex-1">
                <div className="text-[10px] font-medium opacity-75 leading-none">
                  {tiempoRestante.texto === 'Proceso vencido'
                    ? 'Estado'
                    : (isCotizar ? 'Cierra en' : 'Se habilita')}
                </div>
                  <div className="text-sm font-bold font-mono leading-none mt-0.5">
                    {tiempoRestante.texto}
                  </div>
                </div>
              </div>

              {/* Botones a la derecha */}
              <div className="flex items-center gap-1">
                {totalDocs > 0 && (
                  <button
                    onClick={async e => {
                      e.stopPropagation()
                      setShowItems(true)
                      if (itemsCargados.length === 0) {
                        setLoadingItems(true)
                        try {
                          const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
                          const res = await fetch(`${API}/api/contratos/${contract.id}/items`)
                          const data = await res.json()
                          setItemsCargados(data)
                        } catch { setItemsCargados([]) }
                        finally { setLoadingItems(false) }
                      }
                    }}
                    title={`Ver ${totalDocs} documento${totalDocs !== 1 ? 's' : ''}`}
                    className="flex items-center gap-0.5 text-[10px] text-slate-500 bg-slate-100 hover:bg-slate-200 px-2 py-1.5 rounded-lg border border-slate-200 transition-colors"
                  >
                    <FileText size={10}/>
                    {totalDocs}
                  </button>
                )}

                {/* Botón ojo */}
                <button
                  onClick={async e => {
                    e.stopPropagation()
                    setShowItems(true)
                    if (itemsCargados.length === 0) {
                      setLoadingItems(true)
                      try {
                        const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
                        const res = await fetch(`${API}/api/contratos/${contract.id}/items`)
                        const data = await res.json()
                        setItemsCargados(data)
                      } catch { setItemsCargados([]) }
                      finally { setLoadingItems(false) }
                    }
                  }}
                  title="Ver ítems del contrato"
                  className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-700 flex items-center justify-center transition-all border border-slate-200 hover:border-slate-300"
                >
                  <Eye size={13}/>
                </button>

                {/* Botón cotizar (carrito) */}
                {isCotizar && tiempoRestante?.texto !== 'Proceso vencido' && (
                  <button
                    onClick={e => { e.stopPropagation(); onCotizar?.(contract, e) }}
                    title={inCotizar ? 'Quitar de cotizaciones' : 'Agregar a cotizaciones'}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all border font-bold
                      ${inCotizar
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-700'
                        : 'bg-slate-200 hover:bg-slate-300 text-slate-700 border-slate-300'
                      }`}
                  >
                    <ShoppingCart size={14}/>
                  </button>
                )}

                {/* Botón cotizar en SEACE (abre el modal directo) */}
                {isCotizar && tiempoRestante?.texto !== 'Proceso vencido' && (
                  <button
                    onClick={e => { e.stopPropagation(); onCotizarSeace?.(contract, e) }}
                    title="Cotizar en SEACE"
                    className="w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center transition-all border border-blue-700 font-bold"
                  >
                    <Send size={13}/>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </button>

      {showItems && (
        <ItemsPopup
          items={itemsCargados}
          loading={loadingItems}
          onClose={() => setShowItems(false)}
        />
      )}
    </>
  )
}