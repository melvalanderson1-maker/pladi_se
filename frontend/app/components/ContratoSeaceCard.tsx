'use client'

import {
  Building2,
  CalendarDays,
  Clock,
  Coins,
  AlertTriangle,
  Package,
  Briefcase,
  HardHat,
  ClipboardCheck,
  ChevronRight,
} from 'lucide-react'
import type { ProcesoSeace } from '@/lib/seace-api'

interface Props {
  proceso: ProcesoSeace
  isLoading: boolean
  disabled: boolean
  onClick: () => void
}

const CATEGORIA_CONFIG: Record<
  string,
  { label: string; icon: typeof Package; accent: string; bar: string }
> = {
  bien: { label: 'Bienes', icon: Package, accent: 'text-blue-600', bar: 'bg-blue-500' },
  bienes: { label: 'Bienes', icon: Package, accent: 'text-blue-600', bar: 'bg-blue-500' },
  goods: { label: 'Bienes', icon: Package, accent: 'text-blue-600', bar: 'bg-blue-500' },

  servicio: { label: 'Servicios', icon: Briefcase, accent: 'text-violet-600', bar: 'bg-violet-500' },
  servicios: { label: 'Servicios', icon: Briefcase, accent: 'text-violet-600', bar: 'bg-violet-500' },
  services: { label: 'Servicios', icon: Briefcase, accent: 'text-violet-600', bar: 'bg-violet-500' },

  obra: { label: 'Obras', icon: HardHat, accent: 'text-orange-600', bar: 'bg-orange-500' },
  obras: { label: 'Obras', icon: HardHat, accent: 'text-orange-600', bar: 'bg-orange-500' },
  works: { label: 'Obras', icon: HardHat, accent: 'text-orange-600', bar: 'bg-orange-500' },

  consultoriadeobra: { label: 'Consultoría de obra', icon: ClipboardCheck, accent: 'text-teal-600', bar: 'bg-teal-500' },
  consultoriadeobras: { label: 'Consultoría de obra', icon: ClipboardCheck, accent: 'text-teal-600', bar: 'bg-teal-500' },
}

const DEFAULT_CATEGORIA = {
  label: 'Sin categoría',
  icon: Package,
  accent: 'text-slate-500',
  bar: 'bg-slate-300',
}

function getCategoria(categoria?: string) {
  const key = (categoria || '').toLowerCase().replace(/\s/g, '')
  return CATEGORIA_CONFIG[key] || DEFAULT_CATEGORIA
}

function diasRestantes(fechaFin: string | null) {
  if (!fechaFin) return null
  const fin = new Date(fechaFin)
  if (Number.isNaN(fin.getTime())) return null
  const hoy = new Date()
  return Math.ceil((fin.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))
}

function getUrgencia(dias: number | null) {
  if (dias === null) return { label: 'Sin fecha', className: 'bg-slate-100 text-slate-500 border-slate-200' }
  if (dias < 0) return { label: 'Vencido', className: 'bg-slate-100 text-slate-500 border-slate-200' }
  if (dias === 0) return { label: 'Vence hoy', className: 'bg-red-50 text-red-700 border-red-200' }
  if (dias <= 3) return { label: `${dias} día${dias === 1 ? '' : 's'}`, className: 'bg-red-50 text-red-700 border-red-200' }
  if (dias <= 7) return { label: `${dias} días`, className: 'bg-amber-50 text-amber-700 border-amber-200' }
  return { label: `${dias} días`, className: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
}

export default function ContratoSeaceCard({ proceso, isLoading, disabled, onClick }: Props) {
  const dias = diasRestantes(proceso.fecha_fin_consultas)
  const urg = getUrgencia(dias)
  const cat = getCategoria(proceso.categoria)
  const CatIcon = cat.icon

  const fechaVence = proceso.fecha_fin_consultas
    ? new Date(proceso.fecha_fin_consultas).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })
    : '—'
  const fechaConvocatoria = proceso.fecha_convocatoria
    ? new Date(proceso.fecha_convocatoria).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })
    : '—'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group relative flex w-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white text-left shadow-sm transition-all duration-150
        hover:border-slate-300 hover:shadow-md
        ${disabled && !isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      {/* barra de acento — codifica la categoría, no decora */}
      <div className={`absolute inset-y-0 left-0 w-1 ${cat.bar}`} />

      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/85 backdrop-blur-[1px]">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
        </div>
      )}

      <div className="flex flex-col gap-2.5 py-3.5 pl-4 pr-3.5">
        {/* categoría + urgencia */}
        <div className="flex items-center justify-between gap-2">
          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${cat.accent}`}>
            <CatIcon size={13} strokeWidth={2.25} />
            {cat.label}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold tabular-nums ${urg.className}`}>
            <Clock size={10} strokeWidth={2.5} />
            {urg.label}
          </span>
        </div>

        {proceso.tiene_indicio_desierto && (
          <div className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10.5px] font-medium text-amber-700">
            <AlertTriangle size={11} strokeWidth={2.5} />
            Posible declaratoria de desierto
          </div>
        )}

        {/* título */}
        <h3 className="line-clamp-2 min-h-[2.5rem] text-[13.5px] font-semibold leading-snug tracking-[-0.01em] text-slate-900">
          {proceso.titulo}
        </h3>

        {/* entidad */}
        <div className="flex items-center gap-1.5 text-[12px] text-slate-500">
          <Building2 size={12.5} className="shrink-0 text-slate-400" />
          <span className="truncate">{proceso.entidad}</span>
        </div>

        {/* fechas */}
        <div className="grid grid-cols-2 gap-x-3 border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
          <div className="flex items-center gap-1.5">
            <CalendarDays size={11.5} className="shrink-0 text-slate-400" />
            <span>
              Convocado{' '}
              <span className="font-medium text-slate-600 tabular-nums">{fechaConvocatoria}</span>
            </span>
          </div>
          <div className="flex items-center justify-end gap-1.5 text-right">
            <span>
              Vence{' '}
              <span className="font-medium text-slate-600 tabular-nums">{fechaVence}</span>
            </span>
            <CalendarDays size={11.5} className="shrink-0 text-slate-400" />
          </div>
        </div>

        {/* modalidad + origen */}
        <div className="flex items-center justify-between gap-2">
          <span className="truncate rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10.5px] font-medium text-slate-600">
            {proceso.modalidad}
          </span>
          {proceso.origen && (
            <span className="shrink-0 text-[9.5px] font-medium uppercase tracking-wide text-slate-300">
              {proceso.origen === 'api' ? 'API' : 'Scraper'}
            </span>
          )}
        </div>

        {/* monto + acción */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-2.5">
          {proceso.monto ? (
            <span className="flex items-baseline gap-1 text-[15px] font-bold tabular-nums text-emerald-700">
              <Coins size={13} className="mb-0.5 text-emerald-600" />
              S/ {proceso.monto.toLocaleString('es-PE')}
            </span>
          ) : (
            <span className="text-[11px] italic text-slate-400">Sin monto referencial</span>
          )}

          <span className="flex items-center gap-1 text-[11px] font-medium text-slate-400 opacity-0 transition-opacity group-hover:text-blue-600 group-hover:opacity-100">
            Ver detalle
            <ChevronRight size={13} />
          </span>
        </div>
      </div>
    </button>
  )
}