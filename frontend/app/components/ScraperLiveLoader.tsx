'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, CheckCircle2, XCircle, Radar } from 'lucide-react'
import { getEstadoScraper, getProgresoScraper, type ScraperJob, type ProgresoModalidad } from '@/lib/seace-scraper-api'

interface Props {
  jobId: string
  onClose: () => void
  onCompletado: () => void
}

export default function ScraperLiveLoader({ jobId, onClose, onCompletado }: Props) {
  const [job, setJob] = useState<ScraperJob | null>(null)
  const [modalidades, setModalidades] = useState<ProgresoModalidad[]>([])
  const intervalo = useRef<ReturnType<typeof setInterval> | null>(null)
  const onCompletadoRef = useRef(onCompletado)
  onCompletadoRef.current = onCompletado

  useEffect(() => {
    const consultar = async () => {
      try {
        const data = await getEstadoScraper(jobId)
        setJob(data)
        try {
          const prog = await getProgresoScraper(jobId)
          setModalidades(prog.modalidades)
        } catch {
          // si el progreso falla no rompemos el loader
        }
        if (data.estado === 'completado' || data.estado === 'error') {
          if (intervalo.current) clearInterval(intervalo.current)
          if (data.estado === 'completado') onCompletadoRef.current()
        }
      } catch {
        // si una consulta falla no cortamos el loader, se reintenta en el siguiente tick
      }
    }

    consultar()
    intervalo.current = setInterval(consultar, 3000)
    return () => {
      if (intervalo.current) clearInterval(intervalo.current)
    }
  }, [jobId])

  const progresoModalidad = job && job.modalidad_total > 0
    ? Math.round(((job.modalidad_indice - 1) / job.modalidad_total) * 100)
    : 0

  const terminado = job?.estado === 'completado'
  const fallo = job?.estado === 'error'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-2xl border border-blue-100 bg-white p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full
            ${fallo ? 'bg-red-50' : terminado ? 'bg-emerald-50' : 'bg-blue-50'}`}>
            {fallo ? (
              <XCircle size={20} className="text-red-500" />
            ) : terminado ? (
              <CheckCircle2 size={20} className="text-emerald-500" />
            ) : (
              <Radar size={20} className="text-[#0B3D6E] animate-pulse" />
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              {fallo ? 'El scraper se detuvo' : terminado ? 'Actualización lista' : 'Actualizando desde el SEACE'}
            </h3>
            <p className="text-xs text-slate-500">
              {fallo ? 'Revisa los logs del backend' : terminado ? 'Ya puedes cerrar esta ventana' : 'Esto puede tardar unos minutos'}
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <p className="flex items-center gap-2 text-sm text-slate-700">
            {!terminado && !fallo && <Loader2 size={14} className="animate-spin text-[#0B3D6E]" />}
            {job?.mensaje || 'Siguiendo navegando en licitaciones del SEACE...'}
          </p>

          {job && job.modalidad_total > 0 && !fallo && (
            <div>
              <div className="flex justify-between text-[11px] font-medium text-slate-400">
                <span>Modalidad {Math.min(job.modalidad_indice, job.modalidad_total)} de {job.modalidad_total}</span>
                <span>{job.filas_procesadas} convocatorias procesadas</span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-blue-50">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${terminado ? 'bg-emerald-500' : 'bg-[#0B3D6E]'}`}
                  style={{ width: `${terminado ? 100 : Math.max(8, progresoModalidad)}%` }}
                />
              </div>
            </div>
          )}

          {modalidades.length > 0 && !fallo && (
            <div className="space-y-2">
              {modalidades.map(m => {
                const pct = m.paginas_totales && m.paginas_totales > 0
                  ? Math.min(100, Math.round((m.pagina_actual / m.paginas_totales) * 100))
                  : 0
                const lista = m.estado === 'completada'
                return (
                  <div key={m.modalidad} className="rounded-lg border border-blue-50 bg-slate-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-slate-700">{m.modalidad}</span>
                      <span className={`shrink-0 text-[10px] font-semibold ${lista ? 'text-emerald-600' : 'text-[#0B3D6E]'}`}>
                        {lista ? 'Completada' : m.estado}
                      </span>
                    </div>
                    <div className="mt-1 flex justify-between text-[11px] text-slate-400">
                      <span>Pág. {m.pagina_actual}{m.paginas_totales ? ` de ${m.paginas_totales}` : ''}</span>
                      <span>{m.filas_procesadas}{m.filas_totales ? ` / ${m.filas_totales}` : ''} filas</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${lista ? 'bg-emerald-500' : 'bg-[#0B3D6E]'}`}
                        style={{ width: `${lista ? 100 : Math.max(4, pct)}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {modalidades.length === 0 && job?.pagina_actual ? (
            <p className="text-xs text-slate-400">Página {job.pagina_actual} de resultados en curso</p>
          ) : null}
          {fallo && job?.error && (
            <p className="rounded-lg bg-red-50 p-2 text-xs text-red-600">{job.error}</p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          {(terminado || fallo) ? (
            <button
              onClick={onClose}
              className="rounded-lg bg-[#0B3D6E] px-4 py-2 text-sm font-medium text-white hover:bg-[#0B3D6E]/90"
            >
              Cerrar
            </button>
          ) : (
            <button
              onClick={onClose}
              className="rounded-lg border border-blue-100 px-4 py-2 text-sm font-medium text-slate-500 hover:text-[#0B3D6E]"
            >
              Seguir en segundo plano
            </button>
          )}
        </div>
      </div>
    </div>
  )
}