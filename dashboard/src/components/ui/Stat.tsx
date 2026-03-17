import { clsx } from 'clsx'
import type { ReactNode } from 'react'

type StatColor = 'default' | 'cyan' | 'emerald' | 'amber' | 'rose' | 'violet' | 'sky'

const VALUE_COLORS: Record<StatColor, string> = {
  default: 'text-white',
  cyan:    'text-[#00D4FF]',
  emerald: 'text-emerald-400',
  amber:   'text-amber-400',
  rose:    'text-rose-400',
  violet:  'text-violet-400',
  sky:     'text-sky-400',
}

const ACCENT_BAR: Record<StatColor, string> = {
  default: 'bg-white/10',
  cyan:    'bg-[#00D4FF]/50',
  emerald: 'bg-emerald-400/50',
  amber:   'bg-amber-400/50',
  rose:    'bg-rose-400/50',
  violet:  'bg-violet-400/50',
  sky:     'bg-sky-400/50',
}

interface StatProps {
  label: string
  value: string | number
  sub?: string
  color?: StatColor
  icon?: ReactNode
  className?: string
}

export function Stat({ label, value, sub, color = 'default', icon, className }: StatProps) {
  return (
    <div
      className={clsx(
        'relative rounded-xl border border-white/[0.07] bg-[#0A1628] p-4 flex flex-col gap-0.5 overflow-hidden',
        className
      )}
    >
      {/* Subtle corner glow */}
      <div
        className={clsx(
          'absolute top-0 right-0 w-16 h-16 rounded-full blur-2xl opacity-[0.06] pointer-events-none',
          ACCENT_BAR[color]
        )}
      />

      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">{label}</p>
        {icon && <span>{icon}</span>}
      </div>

      <p className={clsx('text-2xl font-bold leading-none font-tabular', VALUE_COLORS[color])}>
        {value}
      </p>

      {sub && <p className="text-[11px] text-slate-600 mt-1">{sub}</p>}

      {/* Bottom accent line */}
      <div className={clsx('absolute bottom-0 left-0 right-0 h-px opacity-40', ACCENT_BAR[color])} />
    </div>
  )
}
