import { clsx } from 'clsx'

// Centralised badge variants — add new ones here as the system grows
const VARIANT_STYLES: Record<string, string> = {
  // Agent status
  online:      'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/25',
  offline:     'bg-slate-500/10  text-slate-400  ring-1 ring-slate-500/20',
  busy:        'bg-amber-500/10  text-amber-400  ring-1 ring-amber-500/25',
  error:       'bg-rose-500/10   text-rose-400   ring-1 ring-rose-500/25',
  // Task status
  todo:        'bg-slate-500/10  text-slate-400  ring-1 ring-slate-500/20',
  in_progress: 'bg-sky-500/10    text-sky-400    ring-1 ring-sky-500/25',
  done:        'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/25',
  blocked:     'bg-orange-500/10 text-orange-400 ring-1 ring-orange-500/25',
  cancelled:   'bg-slate-600/10  text-slate-500  ring-1 ring-slate-600/20',
  // Priority
  p1:          'bg-rose-500/10   text-rose-400   ring-1 ring-rose-500/25',
  p2:          'bg-orange-500/10 text-orange-400 ring-1 ring-orange-500/25',
  p3:          'bg-amber-500/10  text-amber-400  ring-1 ring-amber-500/25',
  p4:          'bg-sky-500/10    text-sky-400    ring-1 ring-sky-500/25',
  p5:          'bg-slate-500/10  text-slate-400  ring-1 ring-slate-500/20',
  // Severity
  info:        'bg-sky-500/10    text-sky-400    ring-1 ring-sky-500/25',
  warning:     'bg-amber-500/10  text-amber-400  ring-1 ring-amber-500/25',
  critical:    'bg-rose-500/10   text-rose-400   ring-1 ring-rose-500/25',
  // Task types
  dev:         'bg-violet-500/10 text-violet-400 ring-1 ring-violet-500/25',
  dev_complex: 'bg-violet-500/10 text-violet-400 ring-1 ring-violet-500/25',
  dev_simple:  'bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/25',
  architecture:'bg-violet-500/10 text-violet-400 ring-1 ring-violet-500/25',
  planning:    'bg-blue-500/10   text-blue-400   ring-1 ring-blue-500/25',
  marketing:   'bg-pink-500/10   text-pink-400   ring-1 ring-pink-500/25',
  content:     'bg-fuchsia-500/10 text-fuchsia-400 ring-1 ring-fuchsia-500/25',
  consulting:  'bg-teal-500/10   text-teal-400   ring-1 ring-teal-500/25',
  analysis:    'bg-cyan-500/10   text-cyan-400   ring-1 ring-cyan-500/25',
  ops:         'bg-slate-500/10  text-slate-400  ring-1 ring-slate-500/20',
  finance:     'bg-green-500/10  text-green-400  ring-1 ring-green-500/25',
  hr:          'bg-orange-500/10 text-orange-400 ring-1 ring-orange-500/25',
  strategy:    'bg-yellow-500/10 text-yellow-400 ring-1 ring-yellow-500/25',
  routing:     'bg-violet-500/10 text-violet-400 ring-1 ring-violet-500/25',
  support:     'bg-sky-500/10    text-sky-400    ring-1 ring-sky-500/25',
  // Fallback
  default:     'bg-white/5       text-slate-400  ring-1 ring-white/10',
}

interface BadgeProps {
  variant?: string
  children: React.ReactNode
  className?: string
  dot?: boolean
}

const DOT_COLORS: Record<string, string> = {
  online:  'bg-emerald-400',
  offline: 'bg-slate-500',
  busy:    'bg-amber-400',
  error:   'bg-rose-400',
}

export function Badge({ variant = 'default', children, className, dot }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider',
        VARIANT_STYLES[variant] ?? VARIANT_STYLES['default'],
        className
      )}
    >
      {dot && (
        <span
          className={clsx(
            'inline-block w-1.5 h-1.5 rounded-full flex-shrink-0',
            DOT_COLORS[variant] ?? 'bg-slate-400'
          )}
        />
      )}
      {children}
    </span>
  )
}
