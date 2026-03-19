// ============================================================
// WAI Dashboard – Professional Tactical Sidebar
// Compact HUD design with logical mission grouping.
// ============================================================

import { clsx } from 'clsx'
import { Icon, type IconName } from './ui/Icon.js'

export type CompanyViewId = 'overview' | 'tasks' | 'activity' | 'costs' | 'runs' | 'clients' | 'projects' | 'revenue' | 'founder' | 'team' | 'office' | 'memory'
export type PersonalViewId = 'assistant' | 'documents' | 'activity'
export type ViewId = CompanyViewId | PersonalViewId
export type DashboardMode = 'company' | 'personal'

interface NavItem {
  id: ViewId
  label: string
  icon: IconName
}

interface NavSection {
  title: string
  items: NavItem[]
}

const COMPANY_NAV_SECTIONS: NavSection[] = [
  {
    title: 'COMMAND',
    items: [
      { id: 'overview',  label: 'Mission Control',  icon: 'overview'  },
      { id: 'office',    label: 'Virtual Office',   icon: 'office'    },
      { id: 'team',      label: 'Neural Org',       icon: 'team'      },
    ]
  },
  {
    title: 'TACTICAL',
    items: [
      { id: 'tasks',     label: 'Task Board',       icon: 'tasks'     },
      { id: 'runs',      label: 'Run History',      icon: 'runs'      },
      { id: 'activity',  label: 'System Log',       icon: 'activity'  },
    ]
  },
  {
    title: 'FINANCE',
    items: [
      { id: 'revenue',   label: 'Revenue',          icon: 'revenue'   },
      { id: 'costs',     label: 'Burn Rate',        icon: 'costs'     },
      { id: 'projects',  label: 'Blueprints',       icon: 'projects'  },
      { id: 'clients',   label: 'Entity Map',       icon: 'clients'   },
    ]
  },
  {
    title: 'CORE',
    items: [
      { id: 'founder',   label: 'Founder HQ',       icon: 'alert'     },
      { id: 'memory',    label: 'Neural Archive',   icon: 'memory'    },
    ]
  }
]

const PERSONAL_NAV_SECTIONS: NavSection[] = [
  {
    title: 'PERSONAL',
    items: [
      { id: 'assistant', label: 'Assistant HQ', icon: 'overview' },
      { id: 'documents', label: 'Documents', icon: 'folder' },
      { id: 'activity', label: 'Activity Log', icon: 'activity' },
    ],
  },
]

interface SidebarProps {
  mode: DashboardMode
  current: ViewId
  onNavigate: (view: ViewId) => void
  collapsed: boolean
  onToggle: () => void
}

function WaiLogo({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={clsx('flex items-center gap-2.5', collapsed && 'justify-center')}>
      <svg width="24" height="24" viewBox="0 0 32 32" fill="none" className="flex-shrink-0">
        <path d="M16 2L29 9v14L16 30 3 23V9L16 2Z" stroke="#00D4FF" strokeWidth="2" fill="rgba(0,212,255,0.1)" />
        <text x="50%" y="55%" dominantBaseline="middle" textAnchor="middle" fontSize="12" fontWeight="900" fill="#00D4FF" fontFamily="Inter, sans-serif">W</text>
      </svg>
      {!collapsed && (
        <div className="min-w-0">
          <p className="text-xs font-black text-white tracking-tighter leading-none italic uppercase">WAI</p>
          <p className="text-[7px] text-[#00D4FF]/60 tracking-[0.3em] mt-1 leading-none uppercase font-black">Autonomous</p>
        </div>
      )}
    </div>
  )
}

export function Sidebar({ mode, current, onNavigate, collapsed, onToggle }: SidebarProps) {
  const navSections = mode === 'company' ? COMPANY_NAV_SECTIONS : PERSONAL_NAV_SECTIONS

  return (
    <aside
      className={clsx(
        'flex flex-col h-full border-r border-white/[0.05] bg-[#05080F] transition-all duration-300 flex-shrink-0 pb-10 relative z-[300]',
        collapsed ? 'w-14' : 'w-48'
      )}
    >
      {/* Background HUD Scanline */}
      <div className="absolute inset-0 bg-scanline opacity-[0.01] pointer-events-none" />

      <div className={clsx('flex items-center px-3 py-5', collapsed ? 'flex-col gap-4' : 'justify-between')}>
        <WaiLogo collapsed={collapsed} />
        <button
          onClick={onToggle}
          className="p-1 rounded-md text-slate-600 hover:text-[#00D4FF] hover:bg-[#00D4FF]/5 transition-all"
          title={collapsed ? 'EXPAND' : 'COLLAPSE'}
        >
          <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={12} />
        </button>
      </div>

      <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent mx-3" />

      {!collapsed && (
        <div className="px-4 pt-4">
          <div className={clsx(
            'rounded-2xl border px-3 py-2 text-[9px] font-black uppercase tracking-[0.25em]',
            mode === 'company'
              ? 'border-[#00D4FF]/15 bg-[#00D4FF]/5 text-[#00D4FF]'
              : 'border-[#7CF6E6]/15 bg-[#7CF6E6]/6 text-[#7CF6E6]'
          )}>
            {mode === 'company' ? 'Company Mode' : 'Personal Mode'}
          </div>
        </div>
      )}

      {/* Navigation Matrix */}
      <nav className="flex-1 px-2 pt-6 space-y-6 overflow-y-auto no-scrollbar relative z-10">
        {navSections.map((section) => (
          <div key={section.title} className="space-y-1">
            {!collapsed && (
              <h3 className="px-3 mb-2 text-[8px] font-black uppercase tracking-[0.4em] text-slate-700">
                {section.title}
              </h3>
            )}
            {section.items.map((item) => {
              const active = current === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={clsx(
                    'w-full flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs transition-all duration-200 relative group',
                    collapsed && 'justify-center px-0 py-2',
                    active
                      ? 'bg-[#00D4FF]/[0.06] text-[#00D4FF] shadow-[inset_0_0_10px_rgba(0,212,255,0.05)]'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.02]'
                  )}
                >
                  {/* Active Indicator */}
                  {active && !collapsed && (
                    <div className="absolute left-0 w-0.5 h-3 bg-[#00D4FF] rounded-r-full shadow-[0_0_8px_#00D4FF]" />
                  )}
                  
                  <Icon name={item.icon} size={14} className={clsx('transition-colors', active ? 'text-[#00D4FF]' : 'text-slate-600 group-hover:text-slate-400')} />
                  {!collapsed && (
                    <span className={clsx('font-black tracking-tight uppercase italic', active ? 'text-white' : 'text-inherit')}>
                      {item.label}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Connection Status Badge */}
      <div className="px-4 mt-auto">
        <div className={clsx(
          "flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/5 bg-black/40",
          collapsed ? "justify-center px-0" : ""
        )}>
          <div className="relative">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_#10b981]" />
            <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping opacity-40" />
          </div>
          {!collapsed && (
            <span className="text-[8px] text-emerald-500/80 font-black tracking-[0.2em] uppercase italic">
              LINK_ESTABLISHED
            </span>
          )}
        </div>
      </div>
    </aside>
  )
}
