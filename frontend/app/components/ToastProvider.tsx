'use client'

import { createContext, useCallback, useContext, useState } from 'react'
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from 'lucide-react'

type ToastTone = 'info' | 'success' | 'warning' | 'error'
type ToastItem = { id: number; text: string; tone: ToastTone }

type ToastCtx = {
  showToast: (text: string, tone?: ToastTone) => void
}

const Ctx = createContext<ToastCtx | null>(null)

export function useToast() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>')
  return ctx
}

const ICONOS: Record<ToastTone, any> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
}

const ESTILOS: Record<ToastTone, string> = {
  info: 'bg-blue-50 text-blue-700 border-blue-200',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  error: 'bg-rose-50 text-rose-700 border-rose-200',
}

let nextId = 1

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const showToast = useCallback((text: string, tone: ToastTone = 'info') => {
    const id = nextId++
    setToasts(prev => [...prev, { id, text, tone }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 5000)
  }, [])

  const dismiss = (id: number) => setToasts(prev => prev.filter(t => t.id !== id))

  return (
    <Ctx.Provider value={{ showToast }}>
      {children}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map(t => {
          const Icono = ICONOS[t.tone]
          return (
            <div
              key={t.id}
              className={`flex items-center gap-2 px-4 py-3 rounded-xl border shadow-lg text-xs font-semibold pointer-events-auto animate-in slide-in-from-right ${ESTILOS[t.tone]}`}
            >
              <Icono size={14} className="shrink-0" />
              <span className="flex-1">{t.text}</span>
              <button onClick={() => dismiss(t.id)}>
                <X size={12} className="opacity-60 hover:opacity-100" />
              </button>
            </div>
          )
        })}
      </div>
    </Ctx.Provider>
  )
}