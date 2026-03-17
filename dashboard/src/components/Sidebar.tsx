import { clsx } from 'clsx'
import { Icon, type IconName } from './ui/Icon.js'

export type ViewId = 'overview' | 'agents' | 'tasks' | 'activity' | 'costs' | 'runs' | 'clients' | 'projects'

interface NavItem {
  id: ViewId
  label: string
  icon: IconName
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview',  label: 'Overview',  icon: 'overview'  },
  { id: 'agents',    label: 'Agents',    icon: 'agents'    },
  { id: 'tasks',     label: 'Tasks',     icon: 'tasks'     },
  { id: 'clients',   label: 'Clients',   icon: 'clients'   },
  { id: 'projects',  label: 'Projects',  icon: 'projects'  },
  { id: 'activity',  label: 'Activity',  icon: 'activity'  },
  { id: 'costs',     label: 'Costs',     icon: 'costs'     },
  { id: 'runs',      label: 'Runs',      icon: 'runs'      },
]

interface SidebarProps {
  current: ViewId
  onNavigate: (view: ViewId) => void
  collapsed: boolean
  onToggle: () => void
}

function WaiLogo({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={clsx('flex items-center gap-3 px-3 py-5', collapsed && 'justify-center px-0')}>
      {/* Hexagonal brand mark */}
      <svg
        width="32"
        height="32"
        viewBox="0 0 32 32"
        fill="none"
        className="flex-shrink-0"
      >
        <path
          d="M16 2L29 9v14L16 30 3 23V9L16 2Z"
          stroke="#00D4FF"
          strokeWidth="1.5"
          fill="rgba(0,212,255,0.07)"
        />
        <text
          x="50%"
          y="55%"
          dominantBaseline="middle"
          textAnchor="middle"
          fontSize="11"
          fontWeight="700"
          fill="#00D4FF"
          fontFamily="Inter, sans-serif"
          letterSpacing="0.5"
        >
          W
        </text>
      </svg>

      {!collapsed && (
        <div className="min-w-0">
          <p className="text-sm font-bold text-white tracking-tight leading-none">WAI</p>
          <p className="text-[10px] text-slate-600 tracking-wider mt-0.5 leading-none">
            Autonomous Industries
          </p>
        </div>
      )}
    </div>
  )
}

export function Sidebar({ current, onNavigate, collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      className={clsx(
        'flex flex-col h-full border-r border-white/[0.07] bg-[#07101F] transition-all duration-200 flex-shrink-0',
        collapsed ? 'w-14' : 'w-52'
      )}
    >
      {/* Logo */}
      <WaiLogo collapsed={collapsed} />

      <div className="h-px bg-white/[0.06] mx-3" />

      {/* Navigation */}
      <nav className="flex-1 px-2 pt-3 pb-2 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const active = current === item.id
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              title={collapsed ? item.label : undefined}
              className={clsx(
                'w-full flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-all duration-150',
                collapsed && 'justify-center px-0 py-2.5',
                active
                  ? 'bg-[#00D4FF]/[0.08] text-[#00D4FF]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
              )}
            >
              {/* Active left accent bar */}
              {!collapsed && (
                <span
                  className={clsx(
                    'absolute left-0 w-0.5 h-6 rounded-r bg-[#00D4FF] transition-opacity duration-150',
                    active ? 'opacity-100' : 'opacity-0'
                  )}
                />
              )}
              <Icon name={item.icon} size={16} />
              {!collapsed && (
                <span className="font-medium tracking-wide">{item.label}</span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="h-px bg-white/[0.06] mx-3" />

      {/* Bottom: status + collapse toggle */}
      <div className={clsx('p-3 flex items-center', collapsed ? 'justify-center' : 'justify-between')}>
        {!collapsed && (
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-slow flex-shrink-0" />
            <span className="text-[11px] text-slate-500 font-medium tracking-wider uppercase">
              Online
            </span>
          </div>
        )}
        <button
          onClick={onToggle}
          className="p-1.5 rounded-md text-slate-600 hover:text-slate-300 hover:bg-white/[0.06] transition-colors"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={14} />
        </button>
      </div>
    </aside>
  )
}
