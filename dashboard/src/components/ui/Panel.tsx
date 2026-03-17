import type { ReactNode } from 'react'
import { clsx } from 'clsx'

type PanelAccent = 'cyan' | 'emerald' | 'amber' | 'rose' | 'violet' | 'sky' | 'none'

const ACCENT_LINE: Record<PanelAccent, string> = {
  cyan:    'border-t-[#00D4FF]/60',
  emerald: 'border-t-emerald-400/60',
  amber:   'border-t-amber-400/60',
  rose:    'border-t-rose-400/60',
  violet:  'border-t-violet-400/60',
  sky:     'border-t-sky-400/60',
  none:    'border-t-transparent',
}

interface PanelProps {
  title?: string
  headerRight?: ReactNode
  className?: string
  children: ReactNode
  noPad?: boolean
  accent?: PanelAccent
}

export function Panel({ title, headerRight, className, children, noPad, accent = 'none' }: PanelProps) {
  return (
    <div
      className={clsx(
        'rounded-xl border border-white/[0.07] bg-[#0A1628] overflow-hidden',
        'border-t-2',
        ACCENT_LINE[accent],
        className
      )}
    >
      {title && (
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.05]">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
            {title}
          </span>
          {headerRight && <div className="flex items-center gap-2">{headerRight}</div>}
        </div>
      )}
      <div className={clsx(!noPad && 'p-5')}>{children}</div>
    </div>
  )
}
