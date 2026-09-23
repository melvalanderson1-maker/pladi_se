'use client'

import { useEffect, useState } from 'react'
import {
  Bot,
  Mail,
  Lock,
  Loader2,
  ShieldAlert,
  FileText,
  BriefcaseBusiness,
  Files,
  FileCheck2,
  ClipboardCheck,
  Building2,
  Scale,
  ScrollText,
  ChevronRight,
} from 'lucide-react'
import Image from 'next/image'

import { useAuth } from '@/components/AuthProvider'

const GentlemanIcon = ({ size = 24, className = '' }: { size?: number; className?: string }) => (
  <div className={className} style={{ width: size, height: size, position: 'relative' }}>
    <Image src="/monopoly.png" alt="" fill className="object-contain" />
  </div>
)

export default function LoginPage() {
  const { login } = useAuth()

  const [correo, setCorreo] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Controla el efecto de telón
  const [showCurtain, setShowCurtain] = useState(false)

    useEffect(() => {
    const transition =
      sessionStorage.getItem('pladibot-login-transition')

    if (transition === 'true') {
      // Quitamos la marca para que no vuelva a ejecutarse
      // al refrescar la página.
      sessionStorage.removeItem('pladibot-login-transition')

      // Primero mostramos el telón cerrado.
      setShowCurtain(true)

      // Después abrimos el telón.
      setTimeout(() => {
        setShowCurtain(false)
      }, 100)
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    setError(null)
    setLoading(true)

    // Activamos el telón inmediatamente
    // para que la transición empiece antes de enviar la petición.
    setShowCurtain(true)

    try {
      await login(correo, password)
    } catch (err: any) {
      // Si las credenciales son incorrectas,
      // quitamos el telón y mostramos el error.
      setShowCurtain(false)

      setError(
        err.message || 'No se pudo iniciar sesión'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#07111f]">

      {/* =====================================================
          FONDO
      ====================================================== */}

      <div className="absolute inset-0 overflow-hidden">

        {/* Gradientes grandes */}
        <div className="absolute -left-32 -top-32 h-[500px] w-[500px] rounded-full bg-blue-600/20 blur-[120px]" />

        <div className="absolute -right-32 top-1/4 h-[450px] w-[450px] rounded-full bg-cyan-500/10 blur-[120px]" />

        <div className="absolute bottom-[-200px] left-1/3 h-[500px] w-[500px] rounded-full bg-indigo-600/15 blur-[130px]" />

        {/* Grid tecnológico */}
        <div
          className="absolute inset-0 opacity-[0.055]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.7) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.7) 1px, transparent 1px)
            `,
            backgroundSize: '45px 45px',
          }}
        />

        {/* Vignette */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_20%,rgba(3,8,18,0.65)_100%)]" />
      </div>

{/* =====================================================
    ÓRBITA DE ICONOS
====================================================== */}

<div className="pointer-events-none absolute inset-0 z-10 block">

  {/* Órbita exterior */}

  <div className="absolute left-1/2 top-1/2 h-[760px] w-[760px] -translate-x-1/2 -translate-y-1/2 animate-orbit-slow">

    <FloatingIcon
      icon={<FileCheck2 size={25} />}
      label="Contratos"
      position="left-0 top-1/2 -translate-y-1/2"
    />

    <FloatingIcon
      icon={<BriefcaseBusiness size={26} />}
      label="Contrataciones"
      position="right-0 top-1/2 -translate-y-1/2"
    />

    <FloatingIcon
      icon={
        <div className="relative h-10 w-10">
          <Image src="/monopoly.png" alt="" fill className="object-contain grayscale" />
        </div>
      }
      label="Gestión"
      position="left-1/2 top-0 -translate-x-1/2"
    />

    <FloatingIcon
      icon={<Files size={24} />}
      label="Documentos"
      position="left-1/2 bottom-0 -translate-x-1/2"
    />

  </div>


  {/* Órbita interior */}

  <div className="absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 animate-orbit-reverse">

    <FloatingIcon
      icon={<ScrollText size={23} />}
      label="Expedientes"
      position="left-0 top-1/2 -translate-y-1/2"
      small
    />

    <FloatingIcon
      icon={<ClipboardCheck size={23} />}
      label="Validaciones"
      position="right-0 top-1/2 -translate-y-1/2"
      small
    />

    <FloatingIcon
      icon={<Scale size={23} />}
      label="Normativa"
      position="left-1/2 top-0 -translate-x-1/2"
      small
    />

    <FloatingIcon
      icon={<FileText size={22} />}
      label="Archivo"
      position="left-1/2 bottom-0 -translate-x-1/2"
      small
    />

  </div>

</div>


      {/* =====================================================
          CONTENIDO PRINCIPAL
      ====================================================== */}

      <main className="relative z-20 flex min-h-screen items-center justify-center px-5 py-10">

        <div className="w-full max-w-[430px]">

          {/* =================================================
              LOGO
          ================================================== */}

          <div className="mb-8 flex flex-col items-center">

            <div className="relative">

              {/* Aura */}
              <div className="absolute inset-[-18px] rounded-[30px] bg-amber-400/20 blur-2xl" />

              {/* Logo */}
              <div className="relative flex h-[84px] w-[84px] items-center justify-center rounded-[22px] border border-white/15 bg-white/[0.08] shadow-2xl backdrop-blur-xl">

                <div className="relative h-16 w-16">
                  <Image
                    src="/logo.png"
                    alt="PLADIBOT"
                    fill
                    className="object-contain"
                  />
                </div>

              </div>

            </div>

            <div className="mt-5 text-center">

              <h1 className="text-[25px] font-black tracking-[-0.03em] text-white">
                PLADIBOT
              </h1>

              <div className="mt-1 flex items-center justify-center gap-2">

                <span className="h-px w-5 bg-blue-400/50" />

                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-400">
                  Plataforma SEACE
                </p>

                <span className="h-px w-5 bg-blue-400/50" />

              </div>

            </div>
          </div>


          {/* =================================================
              LOGIN CARD
          ================================================== */}

          <div className="relative">

            {/* Glow */}
            <div className="absolute -inset-1 rounded-[30px] bg-gradient-to-r from-blue-500/20 via-cyan-400/10 to-indigo-500/20 blur-xl" />

            <form
              onSubmit={handleSubmit}
              className="relative overflow-hidden rounded-[30px] border border-white/10 bg-white/[0.075] p-7 shadow-2xl backdrop-blur-2xl sm:p-8"
            >

              {/* Línea superior */}
              <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/70 to-transparent" />

              {/* Header */}
              <div className="mb-7">

                <div className="mb-2 flex items-center gap-2">

                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400/15">
                    <Lock
                      size={15}
                      className="text-amber-400"
                    />
                  </div>

                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-400">
                    Acceso seguro
                  </span>

                </div>

                <h2 className="text-[22px] font-bold tracking-tight text-white">
                  Bienvenido nuevamente
                </h2>

                <p className="mt-1.5 text-[12px] leading-5 text-slate-400">
                  Ingresa tus credenciales para acceder a la plataforma.
                </p>

              </div>


              {/* =================================================
                  ERROR
              ================================================== */}

              {error && (
                <div className="mb-5 flex items-start gap-3 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3.5 py-3 text-rose-300">

                  <ShieldAlert
                    size={17}
                    className="mt-0.5 shrink-0"
                  />

                  <p className="text-xs font-semibold leading-5">
                    {error}
                  </p>

                </div>
              )}


              {/* =================================================
                  CORREO
              ================================================== */}

              <div className="mb-4">

                <label className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">

                  <Mail size={12} />

                  Correo electrónico

                </label>

                <div className="group relative">

                  <Mail
                    size={17}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 transition-colors group-focus-within:text-blue-400"
                  />

                  <input
                    type="email"
                    required
                    value={correo}
                    onChange={(e) =>
                      setCorreo(e.target.value)
                    }
                    placeholder="tucorreo@empresa.com"
                    autoComplete="email"
                    className="h-[50px] w-full rounded-2xl border border-white/10 bg-black/20 pl-11 pr-4 text-sm text-white outline-none transition-all placeholder:text-slate-600 focus:border-blue-400/50 focus:bg-black/30 focus:ring-4 focus:ring-blue-500/10"
                  />

                </div>

              </div>


              {/* =================================================
                  PASSWORD
              ================================================== */}

              <div className="mb-6">

                <label className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">

                  <Lock size={12} />

                  Contraseña

                </label>

                <div className="group relative">

                  <Lock
                    size={17}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 transition-colors group-focus-within:text-blue-400"
                  />

                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) =>
                      setPassword(e.target.value)
                    }
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="h-[50px] w-full rounded-2xl border border-white/10 bg-black/20 pl-11 pr-4 text-sm text-white outline-none transition-all placeholder:text-slate-600 focus:border-blue-400/50 focus:bg-black/30 focus:ring-4 focus:ring-blue-500/10"
                  />

                </div>

              </div>


              {/* =================================================
                  BOTÓN
              ================================================== */}

              <button
                type="submit"
                disabled={loading}
                className="group relative flex h-[52px] w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-500 text-sm font-bold text-[#07111f] shadow-xl shadow-amber-900/30 transition-all duration-300 hover:-translate-y-[1px] hover:shadow-amber-900/50 disabled:cursor-not-allowed disabled:opacity-60"
              >

                {/* Brillo */}
                <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />

                {loading ? (
                  <>
                    <Loader2
                      size={17}
                      className="relative animate-spin"
                    />

                    <span className="relative">
                      Ingresando...
                    </span>
                  </>
                ) : (
                  <>
                    <span className="relative">
                      Ingresar a PLADIBOT
                    </span>

                    <ChevronRight
                      size={17}
                      className="relative transition-transform duration-300 group-hover:translate-x-1"
                    />
                  </>
                )}

              </button>


              {/* =================================================
                  SEGURIDAD
              ================================================== */}

              <div className="mt-5 flex items-center justify-center gap-2">

                <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />

                <span className="text-[10px] font-medium text-slate-500">
                  Sistema protegido · Grupo RPC / Grupo Ecolimp
                </span>

              </div>

            </form>

          </div>


          {/* =================================================
              FOOTER
          ================================================== */}

          <div className="mt-7 text-center">

            <p className="text-[10px] font-medium tracking-wide text-slate-600">
              Gestión inteligente de contrataciones públicas
            </p>

          </div>

        </div>

      </main>


      {/* =====================================================
          TELÓN DE TRANSICIÓN
      ====================================================== */}

      {showCurtain && (
        <div className="pointer-events-none fixed inset-0 z-[9999]">

          {/* Panel izquierdo */}
          <div className="absolute inset-y-0 left-0 w-1/2 animate-curtain-left bg-[#07111f]">

            <div className="absolute right-0 top-0 h-full w-px bg-blue-400/30" />

          </div>

          {/* Panel derecho */}
          <div className="absolute inset-y-0 right-0 w-1/2 animate-curtain-right bg-[#07111f]">

            <div className="absolute left-0 top-0 h-full w-px bg-blue-400/30" />

          </div>

          {/* Centro */}
          <div className="absolute inset-0 flex items-center justify-center">

            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-blue-400/20 bg-blue-500/10 shadow-2xl shadow-blue-900/40 animate-pulse">

              <Bot
                size={28}
                className="text-blue-400"
              />

            </div>

          </div>

        </div>
      )}


      {/* =====================================================
          ANIMACIONES CSS
      ====================================================== */}

      <style jsx global>{`
        @keyframes float {
          0%, 100% {
            transform: translateY(0px) scale(1);
          }

          50% {
            transform: translateY(-14px) scale(1.025);
          }
        }

        @keyframes floatSlow {
          0%, 100% {
            transform: translateY(0px) rotate(0deg);
          }

          50% {
            transform: translateY(-18px) rotate(2deg);
          }
        }

        @keyframes floatReverse {
          0%, 100% {
            transform: translateY(0px);
          }

          50% {
            transform: translateY(12px);
          }
        }

        @keyframes curtainLeft {
          0% {
            transform: translateX(0);
          }

          100% {
            transform: translateX(-100%);
          }
        }

        @keyframes curtainRight {
          0% {
            transform: translateX(0);
          }

          100% {
            transform: translateX(100%);
          }
        }

        .animate-float {
          animation: float 5s ease-in-out infinite;
        }

        .animate-float-slow {
          animation: floatSlow 7s ease-in-out infinite;
        }

        .animate-float-reverse {
          animation: floatReverse 6s ease-in-out infinite;
        }

        .animate-curtain-left {
          animation: curtainLeft 0.9s cubic-bezier(0.76, 0, 0.24, 1) forwards;
        }

        .animate-curtain-right {
          animation: curtainRight 0.9s cubic-bezier(0.76, 0, 0.24, 1) forwards;
        }

        /* =====================================================
            ÓRBITAS
            ===================================================== */

            @keyframes orbitSlow {
            from {
                transform: translate(-50%, -50%) rotate(0deg);
            }

            to {
                transform: translate(-50%, -50%) rotate(360deg);
            }
            }

            @keyframes orbitReverse {
            from {
                transform: translate(-50%, -50%) rotate(360deg);
            }

            to {
                transform: translate(-50%, -50%) rotate(0deg);
            }
            }

            .animate-orbit-slow {
            animation: orbitSlow 35s linear infinite;
            }

            .animate-orbit-reverse {
            animation: orbitReverse 25s linear infinite;
            }
      `}</style>

    </div>
  )
}


/* =========================================================
   COMPONENTE DE ICONO FLOTANTE
========================================================= */

function FloatingIcon({
  icon,
  label,
  position,
  small = false,
}: {
  icon: React.ReactNode
  label: string
  position: string
  small?: boolean
}) {

  return (
    <div
      className={`absolute ${position}`}
    >

      <div
        className={`
          group relative
          flex items-center justify-center
          rounded-2xl
          border border-white/[0.08]
          bg-white/[0.035]
          shadow-2xl
          backdrop-blur-md
          transition-all
          duration-500
          hover:border-blue-400/30
          hover:bg-blue-500/[0.08]
          hover:scale-110
          ${
            small
              ? 'h-12 w-12 text-slate-500'
              : 'h-20 w-20 text-slate-400'
          }
        `}
      >

        {/* Glow */}

        <div className="
          absolute
          inset-0
          rounded-2xl
          bg-blue-500/0
          blur-xl
          transition-all
          duration-500
          group-hover:bg-blue-500/20
        " />

        {/* Icono */}

        <div className="relative z-10">
          {icon}
        </div>

        {/* Tooltip */}

        <div
          className="
            absolute
            -bottom-8
            left-1/2
            -translate-x-1/2
            whitespace-nowrap
            rounded-md
            border
            border-white/5
            bg-black/60
            px-2
            py-1
            text-[9px]
            font-medium
            text-slate-300
            opacity-0
            backdrop-blur-md
            transition-opacity
            duration-300
            group-hover:opacity-100
          "
        >
          {label}
        </div>

      </div>

    </div>
  )
}