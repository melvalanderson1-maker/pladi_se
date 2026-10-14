'use client'

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type CSSProperties,
} from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { Bricolage_Grotesque } from 'next/font/google'
import {
  Building2, BarChart3, ClipboardCheck, FileText, Settings,
  ChevronLeft, ChevronRight, Menu, X, Sun, Moon, LogOut, ChevronDown, Users, Shield,
  Handshake, Banknote, Coins, Gavel,
  type LucideIcon,
} from 'lucide-react'

import { useAuth } from '@/components/AuthProvider'

/* ------------------------------------------------------------------ */
/*  Misma tipografía de títulos que usa el content page.               */
/*  (si tu versión de Next no trae Bricolage_Grotesque, borra el       */
/*  import y pon: const fontDisplay = { className: '' })              */
/* ------------------------------------------------------------------ */
const fontDisplay = Bricolage_Grotesque({ subsets: ['latin'], display: 'swap' })

const STORAGE_KEY = 'pladibot-sidebar'

// ─── Ícono del easter egg: usa la imagen /public/monopoly.png ───────────────
type IconProps = {
  size?: number
  className?: string
  strokeWidth?: number
  style?: CSSProperties
}

const GentlemanIcon = ({ size = 24, className = '', style }: IconProps) => (
  <div className={className} style={{ width: size, height: size, position: 'relative', ...style }}>
    <Image src="/monopoly.png" alt="" fill sizes={`${size}px`} className="object-contain grayscale opacity-70" />
  </div>
)

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
  // Evita que el valor por defecto pise lo guardado antes de haberlo leído
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        setCollapsed(!!parsed.collapsed)
        if (parsed.theme === 'dark' || parsed.theme === 'light') setTheme(parsed.theme)
      }
    } catch {
      // JSON corrupto o storage bloqueado: seguimos con los valores por defecto
    }
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ collapsed, theme }))
    } catch {}
  }, [collapsed, theme, ready])

  const toggleCollapsed = useCallback(() => setCollapsed(v => !v), [])
  const toggleTheme = useCallback(() => setTheme(t => (t === 'dark' ? 'light' : 'dark')), [])

  // Atajo Ctrl/Cmd + B para contraer/expandir (solo en pantallas grandes)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'b') return
      const el = e.target as HTMLElement | null
      const escribiendo = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      if (escribiendo || window.innerWidth < 1024) return
      e.preventDefault()
      toggleCollapsed()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleCollapsed])

  const value = useMemo<SidebarCtx>(() => ({
    collapsed, toggleCollapsed, mobileOpen, setMobileOpen, theme, toggleTheme,
  }), [collapsed, toggleCollapsed, mobileOpen, theme, toggleTheme])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// ─── Botón hamburguesa para usar en el header de cada página (solo mobile) ──
export function SidebarTrigger({ className = '' }: { className?: string }) {
  const { setMobileOpen, mobileOpen } = useSidebar()
  return (
    <button
      onClick={() => setMobileOpen(true)}
      className={`flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B700] sm:h-9 sm:w-9 ${className}`}
      aria-label="Abrir menú"
      aria-expanded={mobileOpen}
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
const ICONOS_MODULO: Record<string, LucideIcon> = {
  contrataciones: Building2,
  estadisticas: BarChart3,
  postulaciones: ClipboardCheck,
  cotizar_seace: Gavel,
  documentos: FileText,
  configuracion: Settings,
  usuarios: Users,
  auditoria: Shield,
}

// ─── Easter egg: íconos de contrataciones desfilando sobre la "vereda" ────
// 100% decorativo (aria-hidden + pointer-events-none, no afecta la app).
// `left` mueve cada ícono en horizontal y la propiedad CSS `translate`
// (independiente de `transform`) hace el saltito, así ambas animaciones
// conviven sin pisarse.
const ICONOS_EASTER_EGG = [GentlemanIcon, Banknote, Coins, Handshake]

function IconTrail({ collapsed, isDark }: { collapsed: boolean; isDark: boolean }) {
  const items = [
    { size: 26, bottom: 4, duration: 9,  delay: -1.2, jump: 'icon-jump-1', tone: isDark ? 'text-white/35'     : 'text-slate-400' },
    { size: 22, bottom: 1, duration: 7,  delay: -3,   jump: 'icon-jump-2', tone: isDark ? 'text-white/25'     : 'text-slate-400' },
    { size: 24, bottom: 5, duration: 10, delay: -5.5, jump: 'icon-jump-3', tone: isDark ? 'text-[#F5B700]/75' : 'text-[#0B3D6E]/60' },
    { size: 20, bottom: 0, duration: 8,  delay: -2,   jump: 'icon-jump-4', tone: isDark ? 'text-white/25'     : 'text-slate-300' },
  ]
  const visibles = collapsed ? items.slice(0, 2) : items

  return (
    <div
      aria-hidden="true"
      className={`relative h-16 shrink-0 overflow-hidden pointer-events-none border-t ${isDark ? 'border-white/10' : 'border-slate-100'}`}
    >
      {/* Línea sutil que simula la "vereda" */}
      <div className={`absolute bottom-1 left-3 right-3 h-px ${isDark ? 'bg-white/15' : 'bg-slate-200'}`} />

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
    toggleTheme,
  } = useSidebar()

  const { usuario, modulos, logout } = useAuth()

  const [profileOpen, setProfileOpen] = useState(false)
  // Controla la animación de cierre de sesión (telón)
  const [logoutTransition, setLogoutTransition] = useState(false)
  // Tooltip flotante cuando el sidebar está contraído en desktop
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null)

  const pathname = usePathname()
  const isDark = theme === 'dark'

  // ── Efectos de comportamiento ───────────────────────────────────────────
  // Cierra el drawer al cambiar de ruta (solo toca estado si realmente está abierto)
  useEffect(() => {
    if (mobileOpen) setMobileOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  // Drawer móvil: bloquea el scroll del fondo, Escape cierra y si la pantalla crece lo cierra
  useEffect(() => {
    if (!mobileOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileOpen(false) }
    const onResize = () => { if (window.innerWidth >= 1024) setMobileOpen(false) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [mobileOpen, setMobileOpen])

  // Menú del perfil: cierra al hacer clic fuera o con Escape
  useEffect(() => {
    if (!profileOpen) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      const el = e.target instanceof Element ? e.target : null
      if (!el?.closest('[data-profile-root]')) setProfileOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setProfileOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [profileOpen])

  // Al contraer/expandir o abrir/cerrar el drawer, limpiamos popups
  useEffect(() => {
    setProfileOpen(false)
    setTip(null)
  }, [collapsed, mobileOpen])

  const handleLogout = () => {
    if (logoutTransition) return
    // Avisamos al login que debe reproducir
    // la animación de entrada después de cerrar sesión.
    sessionStorage.setItem('pladibot-login-transition', 'true')

    // Primero mostramos el telón cerrándose.
    setLogoutTransition(true)
    setProfileOpen(false)

    // Esperamos que el telón llegue al centro.
    setTimeout(() => {
      logout()
    }, 900)
  }

  // ── Datos de navegación ─────────────────────────────────────────────────
  const navItems = useMemo(() => modulos.map(m => ({
    href: m.ruta,
    label: m.nombre,
    icon: ICONOS_MODULO[m.clave] ?? FileText,
    ready: m.listo,
  })), [modulos])

  // Un solo ítem activo: la ruta que mejor coincide (evita doble resaltado en rutas anidadas)
  const activeHref = useMemo(() => {
    let best = ''
    for (const it of navItems) {
      if (!it.ready || !it.href) continue
      const coincide = it.href === '/'
        ? pathname === '/'
        : pathname === it.href || pathname.startsWith(it.href + '/')
      if (coincide && it.href.length > best.length) best = it.href
    }
    return best
  }, [navItems, pathname])

  const moduloConfig = modulos.find(m => m.clave === 'configuracion' && m.listo)

  const iniciales = (usuario?.nombre ?? '').trim().split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase() || '??'

  // ── Tokens de tema (paleta del content page: navy #0A2F55, azul #0B3D6E, dorado #F5B700) ──
  const t = isDark
    ? {
        root:       'bg-gradient-to-b from-[#0A2F55] via-[#09294B] to-[#061C36] border-white/10',
        divider:    'border-white/10',
        main:       'text-white',
        muted:      'text-blue-100/60',
        hover:      'hover:bg-white/10 hover:text-white',
        active:     'bg-white/10 text-white',
        idle:       'text-blue-100/70 hover:bg-white/[0.07] hover:text-white',
        activeIcon: 'text-[#F5B700]',
        badge:      'bg-[#F5B700]/15 text-[#F5B700]',
        logoWrap:   'bg-white/10 ring-1 ring-white/15',
        menu:       'bg-[#0A2F55] border-white/15 shadow-black/40',
        menuItem:   'text-blue-50 hover:bg-white/10',
        menuHead:   'border-white/10',
        logout:     'text-rose-300 hover:bg-rose-500/15',
        ring:       'focus-visible:ring-[#F5B700]',
        kbd:        'border-white/15 text-blue-100/50',
        tooltip:    'bg-white text-[#0A2F55]',
      }
    : {
        root:       'bg-white border-slate-200',
        divider:    'border-slate-100',
        main:       'text-slate-800',
        muted:      'text-slate-500',
        hover:      'hover:bg-slate-100 hover:text-[#0B3D6E]',
        active:     'bg-[#0B3D6E]/[0.08] text-[#0B3D6E]',
        idle:       'text-slate-500 hover:bg-slate-100 hover:text-[#0B3D6E]',
        activeIcon: 'text-[#0B3D6E]',
        badge:      'bg-amber-100 text-amber-700',
        logoWrap:   'bg-slate-50 ring-1 ring-slate-200',
        menu:       'bg-white border-slate-200 shadow-slate-900/10',
        menuItem:   'text-slate-700 hover:bg-slate-100',
        menuHead:   'border-slate-100',
        logout:     'text-rose-600 hover:bg-rose-50',
        ring:       'focus-visible:ring-[#0B3D6E]',
        kbd:        'border-slate-200 text-slate-400',
        tooltip:    'bg-[#0A2F55] text-white',
      }

  const ring = `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset ${t.ring}`

  // Tooltip: solo aplica cuando el sidebar está contraído (compact)
  const showTip = (label: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    setTip({ label, top: r.top + r.height / 2 })
  }
  const tipProps = (label: string, compact: boolean) =>
    compact
      ? {
          onMouseEnter: (e: React.MouseEvent<HTMLElement>) => showTip(label, e.currentTarget),
          onFocus:      (e: React.FocusEvent<HTMLElement>) => showTip(label, e.currentTarget),
          onMouseLeave: () => setTip(null),
          onBlur:       () => setTip(null),
        }
      : {}

  // `compact` = icon-only. Solo es true en desktop con el sidebar contraído;
  // el drawer móvil SIEMPRE se muestra expandido.
  const renderContent = (compact: boolean) => (
    <div className={`flex h-full flex-col border-r pb-[env(safe-area-inset-bottom)] ${t.root}`}>

      {/* Marca */}
      <div className={`flex h-20 shrink-0 items-center border-b ${t.divider} ${compact ? 'justify-center px-2' : 'gap-3 px-4'}`}>
        <div className={`relative h-12 w-12 shrink-0 overflow-hidden rounded-xl shadow-lg shadow-black/25 ${t.logoWrap}`}>
          <Image src="/logo.png" alt="PLADIBOT" fill sizes="48px" priority className="object-contain" />
        </div>
        {!compact && (
          <>
            <div className="min-w-0">
              <p className={`${fontDisplay.className} truncate text-base font-bold leading-tight tracking-tight ${t.main}`}>PLADIBOT</p>
              <p className={`truncate text-xs ${t.muted}`}>Contratos menores</p>
            </div>
            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Cerrar menú"
              className={`ml-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors lg:hidden ${t.muted} ${t.hover} ${ring}`}
            >
              <X size={18} />
            </button>
          </>
        )}
      </div>

      {/* Navegación */}
      <nav
        aria-label="Navegación principal"
        onScroll={() => setTip(null)}
        className="sb-scroll flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-3 py-4"
      >
        {navItems.map(item => {
          const Icon = item.icon
          const active = item.ready && item.href === activeHref
          const layout = compact ? 'h-11 justify-center' : 'min-h-[44px] gap-3 px-3 py-2.5'

          if (!item.ready) {
            return (
              <div
                key={item.href}
                aria-disabled="true"
                title={compact ? undefined : 'Próximamente'}
                {...tipProps(`${item.label} · Próximamente`, compact)}
                className={`flex cursor-not-allowed items-center rounded-xl text-sm font-medium opacity-45 ${layout} ${t.muted}`}
              >
                <Icon size={19} className="shrink-0" />
                {!compact && <span className="truncate">{item.label}</span>}
                {!compact && (
                  <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${t.badge}`}>Pronto</span>
                )}
              </div>
            )
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              aria-current={active ? 'page' : undefined}
              {...tipProps(item.label, compact)}
              onClick={() => {
                // Solo tocamos el estado del drawer si realmente está abierto (móvil).
                // En desktop mobileOpen ya es false: llamar setMobileOpen(false)
                // igual dispararía un re-render innecesario justo cuando el
                // navegador procesa la navegación (causaba el "doble clic").
                if (mobileOpen) setMobileOpen(false)
              }}
              className={`group relative flex items-center rounded-xl text-sm font-semibold transition-colors duration-150 ${layout} ${active ? t.active : t.idle} ${ring}`}
            >
              {/* Indicador dorado del ítem activo */}
              {active && (
                <span aria-hidden="true" className="absolute -left-3 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-[#F5B700]" />
              )}
              <Icon size={19} className={`shrink-0 transition-colors ${active ? t.activeIcon : ''}`} />
              {!compact && <span className="truncate">{item.label}</span>}
            </Link>
          )
        })}
      </nav>

      {/* Tema + colapsar */}
      <div className={`shrink-0 space-y-1 border-t px-3 py-3 ${t.divider}`}>
        <button
          onClick={toggleTheme}
          {...tipProps(isDark ? 'Tema claro' : 'Tema oscuro', compact)}
          className={`flex w-full items-center rounded-xl text-sm font-medium transition-colors ${compact ? 'h-11 justify-center' : 'min-h-[44px] gap-3 px-3 py-2'} ${t.muted} ${t.hover} ${ring}`}
        >
          {isDark ? <Sun size={17} className="shrink-0" /> : <Moon size={17} className="shrink-0" />}
          {!compact && <span>{isDark ? 'Tema claro' : 'Tema oscuro'}</span>}
        </button>
        <button
          onClick={toggleCollapsed}
          aria-label={compact ? 'Expandir menú' : 'Contraer menú'}
          {...tipProps('Expandir menú', compact)}
          className={`hidden w-full items-center rounded-xl text-sm font-medium transition-colors lg:flex ${compact ? 'h-11 justify-center' : 'min-h-[44px] gap-3 px-3 py-2'} ${t.muted} ${t.hover} ${ring}`}
        >
          {compact ? <ChevronRight size={17} className="shrink-0" /> : <ChevronLeft size={17} className="shrink-0" />}
          {!compact && <span>Contraer menú</span>}
          {!compact && (
            <kbd className={`ml-auto rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${t.kbd}`}>Ctrl B</kbd>
          )}
        </button>
      </div>

      {/* Easter egg: íconos de contrataciones desfilando — justo encima del perfil */}
      <IconTrail collapsed={compact} isDark={isDark} />

      {/* Perfil */}
      <div data-profile-root className={`relative shrink-0 border-t px-3 py-3 ${t.divider}`}>
        <button
          onClick={() => setProfileOpen(v => !v)}
          aria-haspopup="menu"
          aria-expanded={profileOpen}
          {...tipProps(usuario?.nombre ?? 'Invitado', compact)}
          className={`flex w-full items-center rounded-xl transition-colors ${compact ? 'justify-center p-1.5' : 'min-h-[48px] gap-3 px-2 py-2'} ${t.hover} ${ring}`}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#F5B700] to-amber-500 text-xs font-bold text-[#0A2F55] shadow-md shadow-black/20">
            {iniciales}
          </div>
          {!compact && (
            <>
              <div className="min-w-0 text-left">
                <p className={`truncate text-sm font-semibold ${t.main}`}>{usuario?.nombre ?? 'Invitado'}</p>
                <p className={`truncate text-xs capitalize ${t.muted}`}>{usuario?.rol ?? '—'}</p>
              </div>
              <ChevronDown size={15} className={`ml-auto shrink-0 transition-transform duration-200 ${profileOpen ? 'rotate-180' : ''} ${t.muted}`} />
            </>
          )}
        </button>

        {profileOpen && (
          <div
            role="menu"
            className={`sb-fade absolute z-10 overflow-hidden rounded-xl border shadow-xl ${t.menu} ${
              compact ? 'bottom-3 left-full ml-3 w-56' : 'bottom-full left-3 right-3 mb-2'
            }`}
          >
            {compact && (
              <div className={`border-b px-3 py-2.5 ${t.menuHead}`}>
                <p className={`truncate text-sm font-semibold ${t.main}`}>{usuario?.nombre ?? 'Invitado'}</p>
                <p className={`truncate text-xs capitalize ${t.muted}`}>{usuario?.rol ?? '—'}</p>
              </div>
            )}

            {moduloConfig ? (
              <Link
                href={moduloConfig.ruta}
                role="menuitem"
                onClick={() => { setProfileOpen(false); if (mobileOpen) setMobileOpen(false) }}
                className={`flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium ${t.menuItem} ${ring}`}
              >
                <Settings size={15} /> Configuración
              </Link>
            ) : (
              <button
                role="menuitem"
                className={`flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium ${t.menuItem} ${ring}`}
              >
                <Settings size={15} /> Configuración
              </button>
            )}

            <button
              role="menuitem"
              onClick={handleLogout}
              disabled={logoutTransition}
              className={`flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium disabled:opacity-60 ${t.logout} ${ring}`}
            >
              <LogOut size={15} />
              {logoutTransition ? 'Cerrando sesión...' : 'Cerrar sesión'}
            </button>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop: fijo */}
      <aside
        aria-label="Barra lateral"
        className={`fixed inset-y-0 left-0 z-30 hidden transition-[width] duration-300 ease-in-out lg:block ${collapsed ? 'w-20' : 'w-72'}`}
      >
        {renderContent(collapsed)}
      </aside>

      {/* Mobile / tablet: drawer con overlay (siempre expandido) */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Menú de navegación">
          <button
            className="sb-fade absolute inset-0 bg-[#061C36]/70 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-label="Cerrar menú"
          />
          <aside className="sb-drawer relative h-full w-72 max-w-[85vw] shadow-2xl shadow-black/40">
            {renderContent(false)}
          </aside>
        </div>
      )}

      {/* Tooltip del sidebar contraído */}
      {tip && collapsed && (
        <div
          role="tooltip"
          className={`sb-fade pointer-events-none fixed z-[60] hidden -translate-y-1/2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold shadow-xl shadow-black/20 lg:block ${t.tooltip}`}
          style={{ top: tip.top, left: 88 }}
        >
          {tip.label}
        </div>
      )}

      {/* =====================================================
          TELÓN DE CIERRE DE SESIÓN
      ====================================================== */}
      {logoutTransition && (
        <div className="pointer-events-none fixed inset-0 z-[9999]">

          {/* Panel izquierdo */}
          <div className="animate-curtain-close-left absolute inset-y-0 left-0 w-1/2 bg-[#07111f]">
            <div className="absolute right-0 top-0 h-full w-px bg-blue-400/30" />
          </div>

          {/* Panel derecho */}
          <div className="animate-curtain-close-right absolute inset-y-0 right-0 w-1/2 bg-[#07111f]">
            <div className="absolute left-0 top-0 h-full w-px bg-blue-400/30" />
          </div>

          {/* Centro */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="relative flex h-16 w-16 animate-pulse items-center justify-center overflow-hidden rounded-2xl border border-blue-400/20 bg-blue-500/10 shadow-2xl shadow-blue-900/40">
              <Image src="/logo.png" alt="PLADIBOT" fill sizes="64px" className="object-contain p-2" />
            </div>
          </div>
        </div>
      )}

      {/* =====================================================
          ESTILOS GLOBALES (telón + drawer + easter egg)
      ====================================================== */}
      <style jsx global>{`
        /* ── Drawer / tooltip / menú ─────────────────────────────── */
        @keyframes sbDrawerIn {
          from { transform: translateX(-100%); }
          to   { transform: none; }
        }
        @keyframes sbFade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .sb-drawer { animation: sbDrawerIn 0.32s cubic-bezier(0.22, 1, 0.36, 1); }
        .sb-fade   { animation: sbFade 0.2s ease; }

        .sb-scroll { scrollbar-width: thin; scrollbar-color: rgba(148, 163, 184, 0.35) transparent; }
        .sb-scroll::-webkit-scrollbar { width: 6px; }
        .sb-scroll::-webkit-scrollbar-thumb { background: rgba(148, 163, 184, 0.35); border-radius: 9999px; }

        /* ── Telón ───────────────────────────────────────────────── */
        @keyframes curtainCloseLeft {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(0); }
        }
        @keyframes curtainCloseRight {
          0%   { transform: translateX(100%); }
          100% { transform: translateX(0); }
        }
        .animate-curtain-close-left {
          animation: curtainCloseLeft 0.9s cubic-bezier(0.76, 0, 0.24, 1) forwards;
        }
        .animate-curtain-close-right {
          animation: curtainCloseRight 0.9s cubic-bezier(0.76, 0, 0.24, 1) forwards;
        }

        /* ── Easter egg: íconos con velocidad variable ───────────── */
        .icon-unit {
          left: -10%;
          animation-name: iconWalk;
          animation-iteration-count: infinite;
        }

        /* Arranca, acelera de golpe a mitad de camino (la "ráfaga") y frena antes de salir. */
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

        /* Respeta a quien pidió menos movimiento */
        @media (prefers-reduced-motion: reduce) {
          .sb-drawer, .sb-fade { animation: none; }
          .icon-unit { display: none; }
        }
      `}</style>
    </>
  )
}