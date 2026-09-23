'use client'

import { createContext, useContext, useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  Building2, BarChart3, ClipboardCheck, FileText, Settings,
  ChevronLeft, ChevronRight, Menu, X, Sun, Moon, LogOut, ChevronDown, Users, Shield,
  Handshake, Pencil, Stamp, Dices, Banknote, Coins, Gavel,
} from 'lucide-react'

// Ícono del easter egg: usa la imagen /public/monopoly.png
const GentlemanIcon = ({ size = 24, className = '' }: { size?: number; className?: string }) => (
  <div className={className} style={{ width: size, height: size, position: 'relative' }}>
    <Image src="/monopoly.png" alt="" fill className="object-contain grayscale" />
  </div>
)


import { useAuth } from '@/components/AuthProvider'

// ─── Context ────────────────────────────────────────────────────────────────
type SidebarCtx = {
  collapsed: boolean
  toggleCollapsed: () => void
  mobileOpen: boolean
  setMobileOpen: (v: boolean) => void
  theme: 'dark' | 'light'
  toggleTheme: () => void
}

const Ctx = createContext<SidebarCtx | null>(null)

export function useSidebar() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSidebar debe usarse dentro de <SidebarProvider>')
  return ctx
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    const saved = localStorage.getItem('pladibot-sidebar')
    if (saved) {
      const { collapsed, theme } = JSON.parse(saved)
      setCollapsed(!!collapsed)
      if (theme) setTheme(theme)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('pladibot-sidebar', JSON.stringify({ collapsed, theme }))
  }, [collapsed, theme])

  return (
    <Ctx.Provider value={{
      collapsed,
      toggleCollapsed: () => setCollapsed(v => !v),
      mobileOpen,
      setMobileOpen,
      theme,
      toggleTheme: () => setTheme(t => (t === 'dark' ? 'light' : 'dark')),
    }}>
      {children}
    </Ctx.Provider>
  )
}

// ─── Botón hamburguesa para usar en el header de cada página (solo mobile) ──
export function SidebarTrigger({ className = '' }: { className?: string }) {
  const { setMobileOpen } = useSidebar()
  return (
    <button
      onClick={() => setMobileOpen(true)}
      className={`w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors ${className}`}
      aria-label="Abrir menú"
    >
      <Menu size={18} />
    </button>
  )
}

// ─── Wrapper que corre el contenido según el ancho del sidebar en desktop ───
export function SidebarInset({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar()
  return (
    <main className={`transition-[padding] duration-300 ease-in-out ${collapsed ? 'lg:pl-20' : 'lg:pl-72'}`}>
      {children}
    </main>
  )
}

// ─── Navegación (los módulos vienen del backend según el rol) ─────────────
const ICONOS_MODULO: Record<string, any> = {
  contrataciones: Building2,
  estadisticas: BarChart3,
  postulaciones: ClipboardCheck,
  cotizar_seace: Gavel,
  documentos: FileText,
  configuracion: Settings,
  usuarios: Users,
  auditoria: Shield,
}

// ─── Easter egg: dinosaurios pixel-art caminando sobre la barra inferior ───
// 100% decorativo (aria-hidden + pointer-events-none, no afecta la app).
// Cada dino usa `left` (relativo al ancho real del contenedor → responsive
// tanto en modo colapsado como expandido) para el desplazamiento horizontal,
// y la propiedad CSS `translate` (independiente de `transform`) para el
// salto vertical, así ambas animaciones conviven sin pisarse. Las 2 patas
// alternan por opacidad (steps) para el clásico efecto de sprite retro de
// 2 cuadros, como los dinosaurios de un editor de código.




const ICONOS_EASTER_EGG = [GentlemanIcon, Banknote, Coins, Handshake]

function IconTrail({ collapsed, isDark }: { collapsed: boolean; isDark: boolean }) {
  const items = [
    { size: 26, bottom: 4, duration: 9,  delay: -1.2, jump: 'icon-jump-1', tone: isDark ? 'text-slate-500'   : 'text-slate-400' },
    { size: 22, bottom: 1, duration: 7,  delay: -3,   jump: 'icon-jump-2', tone: isDark ? 'text-slate-600'   : 'text-slate-400' },
    { size: 24, bottom: 5, duration: 10, delay: -5.5, jump: 'icon-jump-3', tone: isDark ? 'text-blue-500/70' : 'text-blue-400'  },
    { size: 20, bottom: 0, duration: 8,  delay: -2,   jump: 'icon-jump-4', tone: isDark ? 'text-slate-600'   : 'text-slate-300' },
  ]
  const visibles = collapsed ? items.slice(0, 2) : items

  return (
    <div
      aria-hidden="true"
      className={`relative h-16 overflow-hidden pointer-events-none border-t ${isDark ? 'border-slate-800' : 'border-slate-100'}`}
    >
      {/* Línea sutil que simula la "vereda" sobre la que se desplazan */}
      <div className={`absolute left-3 right-3 bottom-1 h-px opacity-60 ${isDark ? 'bg-slate-700' : 'bg-slate-200'}`} />

      {visibles.map((it, i) => {
        const Icono = ICONOS_EASTER_EGG[i % ICONOS_EASTER_EGG.length]
        return (
          <div
            key={i}
            className="icon-unit absolute"
            style={{
              bottom: it.bottom,
              animationDuration: `${it.duration}s`,
              animationDelay: `${it.delay}s`,
            }}
          >
            <Icono
              size={it.size}
              strokeWidth={2.25}
              className={`${it.jump} ${it.tone}`}
              style={{ animationDuration: `${it.duration}s`, animationDelay: `${it.delay}s` }}
            />
          </div>
        )
      })}
    </div>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────
export default function Sidebar() {
  const {
    collapsed,
    toggleCollapsed,
    mobileOpen,
    setMobileOpen,
    theme,
    toggleTheme
  } = useSidebar()

  const {
    usuario,
    modulos,
    logout,
  } = useAuth()

  const [profileOpen, setProfileOpen] = useState(false)

  // NUEVO: controla la animación de cierre de sesión
  const [logoutTransition, setLogoutTransition] = useState(false)

  const pathname = usePathname()

  const isDark = theme === 'dark'


  const handleLogout = () => {
    // Avisamos al login que debe reproducir
    // la animación de entrada después de cerrar sesión.
    sessionStorage.setItem('pladibot-login-transition', 'true')

    // Primero mostramos el telón cerrándose.
    setLogoutTransition(true)

    // Esperamos que el telón llegue al centro.
    setTimeout(() => {
      logout()
    }, 900)
  }


  const navItems = useMemo(() => modulos.map(m => ({
    href: m.ruta,
    label: m.nombre,
    icon: ICONOS_MODULO[m.clave] ?? FileText,
    ready: m.listo,
  })), [modulos])

  const base       = isDark ? 'bg-gradient-to-b from-slate-900 to-slate-950 border-slate-800' : 'bg-white border-slate-200'
  const textMuted  = isDark ? 'text-slate-400' : 'text-slate-500'
  const textMain   = isDark ? 'text-slate-100' : 'text-slate-800'
  const hoverSoft  = isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'

  const content = (
    <div className={`h-full flex flex-col border-r ${base}`}>

      {/* Marca */}
      <div className={`flex items-center gap-3 px-4 h-20 shrink-0 border-b ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
        <div className="w-14 h-14 rounded-xl overflow-hidden shadow-lg shadow-blue-900/40 shrink-0 relative">
          <Image src="/logo.png" alt="PLADIBOT" fill className="object-contain" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className={`font-extrabold text-sm tracking-tight truncate ${textMain}`}>PLADIBOT</p>
            <p className={`text-[10px] uppercase tracking-wider truncate ${textMuted}`}>Contratos Menores</p>
          </div>
        )}
        <button
          onClick={() => setMobileOpen(false)}
          className={`ml-auto lg:hidden w-7 h-7 rounded-lg flex items-center justify-center ${textMuted} ${hoverSoft}`}
        >
          <X size={16} />
        </button>
      </div>

      {/* Navegación */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {navItems.map(item => {
          const Icon = item.icon
          const active = pathname === item.href

          if (!item.ready) {
            return (
              <div
                key={item.href}
                title="Próximamente"
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium opacity-40 cursor-not-allowed ${textMuted}`}
              >
                <Icon size={18} className="shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
                {!collapsed && <span className="ml-auto text-[9px] font-bold uppercase tracking-wide">Pronto</span>}
              </div>
            )
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              onClick={() => {
                // Solo tocamos el estado del drawer si realmente está
                // abierto (móvil). En desktop, mobileOpen ya es false,
                // así que llamar setMobileOpen(false) de todas formas
                // dispara un re-render innecesario de TODO el Sidebar
                // (está en el context) justo cuando el navegador está
                // procesando la navegación del Link — eso es lo que
                // causaba el "necesito hacer doble clic".
                if (mobileOpen) setMobileOpen(false)
              }}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150
                ${active ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/30' : `${textMuted} ${hoverSoft} hover:text-blue-600`}`}
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          )
        })}
      </nav>

      {/* Tema + colapsar */}
      <div className={`px-3 py-3 border-t space-y-1 ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
        <button
          onClick={toggleTheme}
          className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${textMuted} ${hoverSoft}`}
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
          {!collapsed && <span>{isDark ? 'Tema claro' : 'Tema oscuro'}</span>}
        </button>
        <button
          onClick={toggleCollapsed}
          className={`hidden lg:flex w-full items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${textMuted} ${hoverSoft}`}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          {!collapsed && <span>Contraer menú</span>}
        </button>
      </div>

      {/* Easter egg: iconos de contrataciones flotando — justo encima del nombre del usuario */}
      <IconTrail collapsed={collapsed} isDark={isDark} />

      {/* Perfil */}
      <div className={`relative px-3 py-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
        <button
          onClick={() => setProfileOpen(v => !v)}
          className={`w-full flex items-center gap-3 px-2 py-2 rounded-xl transition-colors ${hoverSoft}`}
        >
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
            {(usuario?.nombre ?? '??').trim().split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase()}
          </div>
          {!collapsed && (
            <>
              <div className="min-w-0 text-left">
                <p className={`text-sm font-semibold truncate ${textMain}`}>{usuario?.nombre ?? 'Invitado'}</p>
                <p className={`text-[11px] truncate capitalize ${textMuted}`}>{usuario?.rol ?? '—'}</p>
              </div>
              <ChevronDown size={14} className={`ml-auto shrink-0 transition-transform ${profileOpen ? 'rotate-180' : ''} ${textMuted}`} />
            </>
          )}
        </button>

        {profileOpen && !collapsed && (
          <div className={`absolute bottom-full left-3 right-3 mb-2 rounded-xl border shadow-lg overflow-hidden ${isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}>
            <button className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left ${textMain} ${hoverSoft}`}>
              <Settings size={14} /> Configuración
            </button>
            <button
              onClick={handleLogout}
              disabled={logoutTransition}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left text-rose-500 hover:bg-rose-50 disabled:opacity-60"
            >
              <LogOut size={14} />

              {logoutTransition
                ? 'Cerrando sesión...'
                : 'Cerrar sesión'}
            </button>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop: fijo */}
      <aside className={`hidden lg:block fixed inset-y-0 left-0 z-30 transition-[width] duration-300 ease-in-out ${collapsed ? 'w-20' : 'w-72'}`}>
        {content}
      </aside>

      {/* Mobile: drawer con overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <button
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-label="Cerrar menú"
          />
          <aside className="relative w-72 max-w-[85%] h-full">
            {content}
          </aside>
        </div>
      )}


            {/* =====================================================
          TELÓN DE CIERRE DE SESIÓN
      ====================================================== */}
      {logoutTransition && (
        <div className="fixed inset-0 z-[9999] pointer-events-none">

          {/* Panel izquierdo */}
          <div className="absolute inset-y-0 left-0 w-1/2 bg-[#07111f] animate-curtain-close-left">
            <div className="absolute right-0 top-0 h-full w-px bg-blue-400/30" />
          </div>

          {/* Panel derecho */}
          <div className="absolute inset-y-0 right-0 w-1/2 bg-[#07111f] animate-curtain-close-right">
            <div className="absolute left-0 top-0 h-full w-px bg-blue-400/30" />
          </div>

          {/* Centro */}
          <div className="absolute inset-0 flex items-center justify-center">

            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-blue-400/20 bg-blue-500/10 shadow-2xl shadow-blue-900/40 animate-pulse relative overflow-hidden">

              <Image
                src="/logo.png"
                alt="PLADIBOT"
                fill
                className="object-contain p-2"
              />

            </div>

          </div>

        </div>
      )}

      {/* =====================================================
          ANIMACIÓN DEL TELÓN
      ====================================================== */}

      <style jsx global>{`
        @keyframes curtainCloseLeft {
          0% {
            transform: translateX(-100%);
          }

          100% {
            transform: translateX(0);
          }
        }

        @keyframes curtainCloseRight {
          0% {
            transform: translateX(100%);
          }

          100% {
            transform: translateX(0);
          }
        }

        .animate-curtain-close-left {
          animation: curtainCloseLeft 0.9s cubic-bezier(0.76, 0, 0.24, 1) forwards;
        }

        .animate-curtain-close-right {
          animation: curtainCloseRight 0.9s cubic-bezier(0.76, 0, 0.24, 1) forwards;
        }

        /* ── Easter egg: iconos profesionales con velocidad variable ──── */
        .icon-unit {
          left: -10%;
          animation-name: iconWalk;
          animation-iteration-count: infinite;
        }

        /* El recorrido ya NO es a velocidad constante: arranca, acelera
           de golpe a mitad de camino (la "ráfaga") y frena antes de salir. */
        @keyframes iconWalk {
          0%   { left: -10%; animation-timing-function: ease-in; }
          30%  { left: 35%;  animation-timing-function: linear; }
          48%  { left: 50%;  animation-timing-function: cubic-bezier(.15,.85,.25,1); }
          62%  { left: 78%;  animation-timing-function: ease-out; }
          80%  { left: 92%;  animation-timing-function: ease-in; }
          100% { left: 110%; }
        }

        .icon-jump-1, .icon-jump-2, .icon-jump-3, .icon-jump-4 {
          animation-timing-function: ease-in-out;
          animation-iteration-count: infinite;
        }
        .icon-jump-1 { animation-name: iconBounce1; }
        .icon-jump-2 { animation-name: iconBounce2; }
        .icon-jump-3 { animation-name: iconBounce3; }
        .icon-jump-4 { animation-name: iconBounce4; }

        /* Salto doble: un rebote chico y luego uno más marcado, como un trotecito */
        @keyframes iconBounce1 {
          0%, 100% { translate: 0 0;    scale: 1;    }
          20%      { translate: 0 -3px; scale: 1.02; }
          38%      { translate: 0 0;    scale: 1;    }
          55%      { translate: 0 -8px; scale: 1.05; }
          70%      { translate: 0 0;    scale: 1;    }
        }
        @keyframes iconBounce2 {
          0%, 100% { translate: 0 0;    scale: 1;    }
          25%      { translate: 0 -2px; scale: 1;    }
          45%      { translate: 0 0;    scale: 1;    }
          65%      { translate: 0 -6px; scale: 1.04; }
          82%      { translate: 0 0;    scale: 1;    }
        }
        @keyframes iconBounce3 {
          0%, 100% { translate: 0 0;    scale: 1;    }
          15%      { translate: 0 -4px; scale: 1.03; }
          32%      { translate: 0 0;    scale: 1;    }
          58%      { translate: 0 -9px; scale: 1.06; }
          75%      { translate: 0 0;    scale: 1;    }
        }
        @keyframes iconBounce4 {
          0%, 100% { translate: 0 0;    scale: 1;    }
          30%      { translate: 0 -5px; scale: 1.03; }
          50%      { translate: 0 0;    scale: 1;    }
          68%      { translate: 0 -3px; scale: 1.02; }
          85%      { translate: 0 0;    scale: 1;    }
        }
      `}</style>

    </>
  )
}