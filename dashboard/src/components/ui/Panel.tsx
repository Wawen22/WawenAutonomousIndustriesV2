import type { ReactNode } from 'react'
import { clsx } from 'clsx'

interface PanelProps {
  title?: string
  headerRight?: ReactNode
  className?: string
  children: ReactNode
  noPad?: boolean
}

export function Panel({ title, headerRight, className, children, noPad }: PanelProps) {
  return (
    <div
      className={clsx(
        'rounded-xl border border-white/[0.07] bg-[#0A1628] overflow-hidden',
        className
      )}
    >
      {title && (
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            {title}
          </span>
          {headerRight && <div className="flex items-center gap-2">{headerRight}</div>}
        </div>
      )}
      <div className={clsx(!noPad && 'p-5')}>{children}</div>
    </div>
  )
}
