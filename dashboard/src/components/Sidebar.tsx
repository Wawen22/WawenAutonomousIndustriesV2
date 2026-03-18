import { clsx } from 'clsx'
import { Icon, type IconName } from './ui/Icon.js'

export type ViewId = 'overview' | 'tasks' | 'activity' | 'costs' | 'runs' | 'clients' | 'projects' | 'revenue' | 'founder' | 'team' | 'office' | 'memory'

interface NavItem {
  id: ViewId
  label: string
  icon: IconName
}

interface NavSection {
  title: string
  items: NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Main',
    items: [
      { id: 'overview',  label: 'Overview',  icon: 'overview'  },
      { id: 'office',    label: 'Office',    icon: 'office'    },
    ]
  },
  {
    title: 'Business',
    items: [
      { id: 'clients',   label: 'Clients',   icon: 'clients'   },
      { id: 'projects',  label: 'Projects',  icon: 'projects'  },
      { id: 'revenue',   label: 'Revenue',   icon: 'revenue'   },
      { id: 'founder',   label: 'Founder',   icon: 'alert'     },
      { id: 'costs',     label: 'Costs',     icon: 'costs'     },
    ]
  },
  {
    title: 'Operations',
    items: [
      { id: 'tasks',     label: 'Tasks',     icon: 'tasks'     },
      { id: 'team',      label: 'Team',      icon: 'team'      },
      { id: 'runs',      label: 'Runs',      icon: 'runs'      },
      { id: 'activity',  label: 'Activity',  icon: 'activity'  },
    ]
  },
  {
    title: 'Intelligence',
    items: [
      { id: 'memory',    label: 'Memory',    icon: 'memory'    },
    ]
  }
]

interface SidebarProps {
  current: ViewId
  onNavigate: (view: ViewId) => void
  collapsed: boolean
  onToggle: () => void
}

function WaiLogo({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={clsx('flex items-center gap-3', collapsed && 'justify-center')}>
      {/* Hexagonal brand mark */}
      <svg
        width="28"
        height="28"
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
          <p className="text-[9px] text-slate-600 tracking-wider mt-1 leading-none uppercase font-black">
            Autonomous
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
        'flex flex-col h-full border-r border-white/[0.07] bg-[#07101F] transition-all duration-200 flex-shrink-0 pb-10',
        collapsed ? 'w-14' : 'w-52'
      )}
    >
      {/* Header area with Logo and Toggle */}
      <div className={clsx(
        'flex items-center px-3 py-6',
        collapsed ? 'flex-col gap-4' : 'justify-between'
      )}>
        <WaiLogo collapsed={collapsed} />
        <button
          onClick={onToggle}
          className="p-1.5 rounded-md text-slate-600 hover:text-slate-300 hover:bg-white/[0.06] transition-colors"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={14} />
        </button>
      </div>

      <div className="h-px bg-white/[0.06] mx-3" />

      {/* Navigation */}
      <nav className="flex-1 px-2 pt-4 pb-2 space-y-5 overflow-y-auto custom-scrollbar">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="space-y-1">
            {!collapsed && (
              <h3 className="px-3 mb-2 text-[9px] font-black uppercase tracking-[0.2em] text-slate-600">
                {section.title}
              </h3>
            )}
            {section.items.map((item) => {
              const active = current === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  title={collapsed ? item.label : undefined}
                  className={clsx(
                    'w-full flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-all duration-150 relative group',
                    collapsed && 'justify-center px-0 py-2.5',
                    active
                      ? 'bg-[#00D4FF]/[0.08] text-[#00D4FF]'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                  )}
                >
                  {/* Active left accent bar */}
                  {!collapsed && active && (
                    <span className="absolute left-0 w-0.5 h-5 rounded-r bg-[#00D4FF]" />
                  )}
                  
                  <Icon name={item.icon} size={16} />
                  {!collapsed && (
                    <span className="font-bold tracking-tight text-[13px]">{item.label}</span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="h-px bg-white/[0.06] mx-3" />

      {/* Bottom: status only */}
      <div className="p-4 flex items-center justify-center">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.02] border border-white/[0.05]">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-slow flex-shrink-0 shadow-[0_0_5px_#10b981]" />
          {!collapsed && (
            <span className="text-[9px] text-slate-500 font-black tracking-widest uppercase">
              System Online
            </span>
          )}
        </div>
      </div>
    </aside>
  )
}
