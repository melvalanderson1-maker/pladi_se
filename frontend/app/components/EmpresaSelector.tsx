'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Building2, Check, Link2, Unlink,
  Loader2, AlertCircle, Footprints,
} from 'lucide-react'
import {
  getEmpresas, vincularEmpresa, seleccionarEmpresa, desvincularEmpresa,
  type EmpresaEstado,
} from '@/lib/empresas-api'
import { useAuth } from '@/components/AuthProvider'

type Toast = { text: string; tone: 'info' | 'success' | 'warning' | 'error' } | null

interface Props {
  onNotify: (toast: Toast) => void
  disabled?: boolean
}

// Saca hasta 2 iniciales del nombre de la empresa (ej: "GRUPO ECOLIMP E.I.R.L." -> "GE")
function iniciales(razonSocial: string) {
  const palabras = razonSocial
    .split(' ')
    .filter(p => p.length > 1) // ignora siglas sueltas como "E", "S"
  const base = palabras.length ? palabras : razonSocial.split(' ')
  return base.slice(0, 2).map(p => p[0]).join('').toUpperCase()
}

export default function EmpresaSelector({ onNotify, disabled }: Props) {
  const { token } = useAuth()
  const [empresas, setEmpresas] = useState<EmpresaEstado[]>([])
  const [seleccionada, setSeleccionada] = useState<string | null>(null)
  const [cargandoLista, setCargandoLista] = useState(true)
  const [vinculando, setVinculando] = useState<string | null>(null)
  const [seleccionando, setSeleccionando] = useState<string | null>(null)
  const [desvinculando, setDesvinculando] = useState<string | null>(null)

  const estadoPrevioRef = useRef<Record<string, boolean>>({})

  const notificar = useCallback((toast: Toast) => {
    onNotify(toast)
    setTimeout(() => onNotify(null), 5000)
  }, [onNotify])

  const cargarEmpresas = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargandoLista(true)
    if (!token) return
    try {
      const data = await getEmpresas(token)
      data.empresas.forEach(emp => {
        const estabaActiva = estadoPrevioRef.current[emp.ruc]
        if (estabaActiva && !emp.activa) {
          notificar({
            text: `La sesión de ${emp.razon_social} se cerró. Vincúlala nuevamente.`,
            tone: 'warning',
          })
        }
        estadoPrevioRef.current[emp.ruc] = emp.activa
      })
      setEmpresas(data.empresas)
      setSeleccionada(data.empresa_seleccionada)
    } catch {
      if (!silencioso) notificar({ text: 'No se pudo cargar la lista de empresas', tone: 'error' })
    } finally {
      if (!silencioso) setCargandoLista(false)
    }
  }, [notificar])

  useEffect(() => {
    cargarEmpresas()
    const interval = setInterval(() => cargarEmpresas(true), 15000)
    return () => clearInterval(interval)
  }, [cargarEmpresas])

  const handleVincular = async (ruc: string, razonSocial: string) => {
    if (!token) return
    setVinculando(ruc)
    try {
      await vincularEmpresa(ruc, token)
      const poll = setInterval(async () => {
        const data = await getEmpresas(token).catch(() => null)
        if (!data) return
        const emp = data.empresas.find(e => e.ruc === ruc)
        if (emp?.activa) {
          clearInterval(poll)
          setVinculando(null)
          setEmpresas(data.empresas)
          setSeleccionada(data.empresa_seleccionada)
          estadoPrevioRef.current[ruc] = true
          notificar({ text: `${razonSocial} vinculada correctamente.`, tone: 'success' })
        } else if (emp?.error) {
          clearInterval(poll)
          setVinculando(null)
          notificar({ text: `No se pudo vincular ${razonSocial}: ${emp.error}`, tone: 'error' })
        }
      }, 3000)
    } catch (e: any) {
      setVinculando(null)
      notificar({ text: e.message || `No se pudo vincular ${razonSocial}`, tone: 'error' })
    }
  }

  const handleSeleccionar = async (ruc: string, razonSocial: string) => {
    if (!token) return
    setSeleccionando(ruc)
    try {
      await seleccionarEmpresa(ruc, token)
      setSeleccionada(ruc)
      notificar({ text: `${razonSocial} es ahora la empresa activa para cotizar.`, tone: 'success' })
    } catch (e: any) {
      notificar({ text: e.message || `No se pudo seleccionar ${razonSocial}`, tone: 'error' })
    } finally {
      setSeleccionando(null)
    }
  }

  const handleDesvincular = async (ruc: string, razonSocial: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!token) return
    setDesvinculando(ruc)
    try {
      await desvincularEmpresa(ruc, token)
      estadoPrevioRef.current[ruc] = false
      await cargarEmpresas(true)
      notificar({ text: `Sesión de ${razonSocial} cerrada.`, tone: 'info' })
    } catch (e: any) {
      notificar({ text: e.message || `No se pudo desvincular ${razonSocial}`, tone: 'error' })
    } finally {
      setDesvinculando(null)
    }
  }

  const handleClickTarjeta = (emp: EmpresaEstado) => {
    if (disabled) return
    if (emp.activa) {
      if (emp.ruc !== seleccionada) handleSeleccionar(emp.ruc, emp.razon_social)
    } else if (vinculando === null) {
      handleVincular(emp.ruc, emp.razon_social)
    }
  }

  return (
    <div className="relative">
      <style>{`
        @keyframes correr-icono {
          0%, 15%   { transform: translateX(0); }
          40%       { transform: translateX(9px); }
          55%, 70%  { transform: translateX(9px); }
          95%, 100% { transform: translateX(0); }
        }
        .icono-corriendo {
          animation: correr-icono 1.8s ease-in-out infinite;
        }
      `}</style>

      <div className="grid grid-cols-3 gap-2">
        {cargandoLista ? (
          <div className="col-span-3 flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-white/10 border border-white/20 text-white text-xs font-semibold">
            <Loader2 size={14} className="animate-spin"/> Cargando empresas...
          </div>
        ) : empresas.map(emp => {
          const esSeleccionada = emp.activa && emp.ruc === seleccionada
          const estaVinculando = vinculando === emp.ruc
          const estaSeleccionando = seleccionando === emp.ruc
          const estaDesvinculando = desvinculando === emp.ruc
          const ocupado = estaVinculando || estaSeleccionando || estaDesvinculando

          return (
            <div key={emp.ruc} className="group relative">
              <button
                onClick={() => handleClickTarjeta(emp)}
                disabled={disabled || ocupado || (vinculando !== null && !estaVinculando)}
                title={emp.activa ? (esSeleccionada ? `${emp.razon_social} (activa)` : `Usar ${emp.razon_social}`) : `Vincular ${emp.razon_social}`}
                className={`w-full flex flex-col items-start gap-1.5 px-3.5 py-2.5 rounded-2xl text-left transition-all shadow-lg disabled:cursor-not-allowed disabled:opacity-60 border-2
                  ${esSeleccionada
                    ? 'bg-emerald-100 border-emerald-400 shadow-emerald-500/30 ring-[3px] ring-emerald-300/70 scale-[1.02]'
                    : emp.activa
                      ? 'bg-teal-800/40 border-teal-500/40 hover:bg-teal-800/55 shadow-teal-900/10'
                      : 'bg-white/5 border-white/15 hover:bg-white/10 shadow-slate-900/30'
                  }`}
              >
                <div className="flex items-center gap-2.5 w-full">
                  {/* Avatar circular con iniciales + indicador de estado */}
                  <span className={`relative shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-extrabold border-2
                    ${esSeleccionada
                      ? 'bg-white text-emerald-600 border-emerald-300'
                      : emp.activa
                        ? 'bg-teal-900/40 text-teal-200 border-teal-500/40'
                        : 'bg-white/10 text-white/60 border-white/20'}`}>
                    {iniciales(emp.razon_social)}
                    {(estaVinculando || ocupado) ? (
                      <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-slate-700 flex items-center justify-center">
                        <Loader2 size={9} className="animate-spin text-white"/>
                      </span>
                    ) : esSeleccionada ? (
                      <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center">
                        <Check size={8} className="text-white"/>
                      </span>
                    ) : emp.activa ? (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-teal-400 border-2 border-teal-800"/>
                    ) : (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-slate-400 border-2 border-slate-700"/>
                    )}
                  </span>

                  {/* Nombre, RUC y estado en una sola columna compacta */}
                  <div className="min-w-0 flex-1">
                    <p className={`text-[11px] font-bold truncate ${esSeleccionada ? 'text-emerald-900' : emp.activa ? 'text-teal-100' : 'text-white/90'}`}>
                      {emp.razon_social}
                    </p>
                    <p className={`text-[10px] font-mono truncate ${esSeleccionada ? 'text-emerald-800/80' : emp.activa ? 'text-teal-200/80' : 'text-white/40'}`}>
                      {emp.ruc}
                      <span className={`ml-1 font-sans font-extrabold ${esSeleccionada ? 'text-emerald-700' : emp.activa ? 'text-teal-200' : 'text-white/40'}`}>
                        · {esSeleccionada ? 'En uso' : emp.activa ? 'Vinculada' : 'Sin vincular'}
                      </span>
                    </p>
                    {emp.error && (
                      <p className="flex items-center gap-1 text-[9px] text-rose-300 leading-tight mt-0.5">
                        <AlertCircle size={9} className="shrink-0"/>
                        <span className="line-clamp-1">{emp.error}</span>
                      </p>
                    )}
                  </div>
                </div>
              </button>

              {/* Botón desvincular: aparece solo al pasar el mouse sobre tarjetas ya vinculadas */}
              {emp.activa && !ocupado && !disabled && (
                <button
                  onClick={(e) => handleDesvincular(emp.ruc, emp.razon_social, e)}
                  title={`Desvincular ${emp.razon_social}`}
                  className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center
                    bg-rose-500 hover:bg-rose-400 text-white shadow-md
                    opacity-0 group-hover:opacity-100 transition-opacity`}
                >
                  <Unlink size={10}/>
                </button>
              )}

              {/* Botón vincular: SIEMPRE visible (sin hover) en tarjetas NO vinculadas, para que el estado quede claro de un vistazo */}
              {!emp.activa && !ocupado && !disabled && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleVincular(emp.ruc, emp.razon_social) }}
                  title={`Vincular ${emp.razon_social}`}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center
                    bg-slate-500 hover:bg-emerald-500 text-white shadow-md transition-colors"
                >
                  <Link2 size={10}/>
                </button>
              )}

              {estaDesvinculando && (
                <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center bg-rose-500 text-white shadow-md">
                  <Loader2 size={10} className="animate-spin"/>
                </span>
              )}
              {estaVinculando && (
                <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center bg-emerald-500 text-white shadow-md">
                  <Loader2 size={10} className="animate-spin"/>
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}