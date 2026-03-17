import { clsx } from 'clsx'

export type IconName =
  | 'overview' | 'agents' | 'tasks' | 'activity' | 'costs' | 'runs' | 'clients' | 'projects'
  | 'chevron-left' | 'chevron-right'
  | 'check' | 'x' | 'clock' | 'zap' | 'arrow-right' | 'info' | 'alert'
  | 'cpu' | 'dollar' | 'trending-up' | 'refresh' | 'folder' | 'building'

interface IconProps {
  name: IconName
  size?: number
  className?: string
}

const svgProps = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24' as const,
  fill: 'none' as const,
  stroke: 'currentColor' as const,
  strokeWidth: 1.75 as const,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
})

export function Icon({ name, size = 16, className }: IconProps) {
  const p = svgProps(size, clsx('flex-shrink-0', className))

  switch (name) {
    case 'overview':
      return (
        <svg {...p}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      )
    case 'agents':
      return (
        <svg {...p}>
          <circle cx="9" cy="7" r="4" />
          <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          <path d="M21 21v-2a4 4 0 0 0-3-3.87" />
        </svg>
      )
    case 'tasks':
      return (
        <svg {...p}>
          <rect x="3" y="3" width="5" height="18" rx="1" />
          <rect x="10" y="3" width="5" height="12" rx="1" />
          <rect x="17" y="3" width="4" height="8" rx="1" />
        </svg>
      )
    case 'activity':
      return (
        <svg {...p}>
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
      )
    case 'costs':
      return (
        <svg {...p}>
          <line x1="12" y1="1" x2="12" y2="23" />
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      )
    case 'chevron-left':
      return (
        <svg {...p}>
          <path d="M15 18l-6-6 6-6" />
        </svg>
      )
    case 'chevron-right':
      return (
        <svg {...p}>
          <path d="M9 18l6-6-6-6" />
        </svg>
      )
    case 'check':
      return (
        <svg {...p}>
          <path d="M20 6L9 17l-5-5" />
        </svg>
      )
    case 'x':
      return (
        <svg {...p}>
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      )
    case 'clock':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      )
    case 'zap':
      return (
        <svg {...p}>
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      )
    case 'arrow-right':
      return (
        <svg {...p}>
          <path d="M5 12h14m-7-7 7 7-7 7" />
        </svg>
      )
    case 'info':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4m0-4h.01" />
        </svg>
      )
    case 'alert':
      return (
        <svg {...p}>
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      )
    case 'cpu':
      return (
        <svg {...p}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <rect x="9" y="9" width="6" height="6" />
          <path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" />
        </svg>
      )
    case 'dollar':
      return (
        <svg {...p}>
          <line x1="12" y1="1" x2="12" y2="23" />
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      )
    case 'trending-up':
      return (
        <svg {...p}>
          <path d="M22 7l-8.5 8.5-5-5L2 17" />
          <path d="M16 7h6v6" />
        </svg>
      )
    case 'refresh':
      return (
        <svg {...p}>
          <path d="M23 4v6h-6" />
          <path d="M1 20v-6h6" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      )
    case 'runs':
      return (
        <svg {...p}>
          <path d="M3 6h18M3 12h18M3 18h11" />
          <circle cx="19" cy="18" r="2" />
          <path d="M19 14v2" />
        </svg>
      )
    case 'clients':
    case 'building':
      return (
        <svg {...p}>
          <rect x="3" y="9" width="18" height="13" rx="1" />
          <path d="M8 22V9" />
          <path d="M16 22V9" />
          <path d="M3 9l9-6 9 6" />
          <rect x="9" y="14" width="6" height="8" />
        </svg>
      )
    case 'projects':
    case 'folder':
      return (
        <svg {...p}>
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      )
    default:
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" />
        </svg>
      )
  }
}
