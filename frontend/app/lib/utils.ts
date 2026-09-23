export function statusLabel(status: string) {
  switch (status) {
    case 'vigente':
      return 'Vigente'

    case 'en_evaluacion':
      return 'En Evaluación'

    case 'culminado':
      return 'Culminado'

    default:
      return 'Activo'
  }
}

export function statusColors(status: string) {
  switch (status) {
    case 'vigente':
      return {
        card: 'border-emerald-500',
        badge: 'bg-emerald-100 text-emerald-700',
        dot: 'bg-emerald-500',
        glow: 'hover:shadow-emerald-100'
      }

    case 'en_evaluacion':
      return {
        card: 'border-violet-500',
        badge: 'bg-violet-100 text-violet-700',
        dot: 'bg-violet-500',
        glow: 'hover:shadow-violet-100'
      }

    case 'culminado':
      return {
        card: 'border-rose-400',
        badge: 'bg-rose-100 text-rose-700',
        dot: 'bg-rose-400',
        glow: 'hover:shadow-rose-100'
      }

    default:
      return {
        card: 'border-slate-400',
        badge: 'bg-slate-100 text-slate-700',
        dot: 'bg-slate-400',
        glow: 'hover:shadow-slate-100'
      }
  }
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat(
    'es-PE',
    {
      style: 'currency',
      currency: 'PEN'
    }
  ).format(amount)
}

export function formatDate(date: string) {
  if (!date) return '-'

  return new Date(date).toLocaleDateString(
    'es-PE',
    {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }
  )
}