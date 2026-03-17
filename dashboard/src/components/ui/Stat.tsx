import { clsx } from 'clsx'
import type { ReactNode } from 'react'

const VALUE_COLORS: Record<string, string> = {
  default: 'text-white',
  cyan:    'text-[#00D4FF]',
  emerald: 'text-emerald-400',
  amber:   'text-amber-400',
  rose:    'text-rose-400',
  violet:  'text-violet-400',
  sky:     'text-sky-400',
}

interface StatProps {
  label: string
  value: string | number
  sub?: string
  color?: keyof typeof VALUE_COLORS
  icon?: ReactNode
  className?: string
}

export function Stat({ label, value, sub, color = 'default', icon, className }: StatProps) {
  return (
    <div
      className={clsx(
        'rounded-xl border border-white/[0.07] bg-[#0A1628] p-5 flex flex-col gap-1',
        className
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{label}</p>
        {icon && <span className="text-slate-600">{icon}</span>}
      </div>
      <p
        className={clsx(
          'text-3xl font-bold leading-none mt-1 font-tabular',
          VALUE_COLORS[color] ?? 'text-white'
        )}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )
}
