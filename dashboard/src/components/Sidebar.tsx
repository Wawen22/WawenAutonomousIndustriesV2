// ============================================================
// WAI Dashboard – Professional Tactical Sidebar
// Compact HUD design with logical mission grouping.
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Icon, type IconName } from './ui/Icon.js'
import { useKnowledgeBaseManifest } from '../hooks/useKnowledgeBaseManifest.js'
import type { KnowledgeBaseManifest } from '../types/index.js'

export type CompanyViewId = 'overview' | 'tasks' | 'activity' | 'costs' | 'runs' | 'clients' | 'projects' | 'revenue' | 'founder' | 'team' | 'office' | 'memory' | 'capabilities' | 'models' | 'settings' | 'docs'
export type PersonalViewId = 'assistant' | 'capabilities' | 'models' | 'documents' | 'activity' | 'settings' | 'docs'
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
      { id: 'capabilities', label: 'Capabilities',  icon: 'cpu'       },
      { id: 'models',    label: 'Models',           icon: 'models'    },
      { id: 'settings',  label: 'Settings',         icon: 'settings'  },
    ]
  }
]

const PERSONAL_NAV_SECTIONS: NavSection[] = [
  {
    title: 'PERSONAL',
    items: [
      { id: 'assistant', label: 'Assistant HQ', icon: 'overview' },
      { id: 'capabilities', label: 'Capabilities', icon: 'cpu' },
      { id: 'models', label: 'Models', icon: 'models' },
      { id: 'documents', label: 'Documents', icon: 'folder' },
      { id: 'activity', label: 'Activity Log', icon: 'activity' },
      { id: 'settings', label: 'Settings', icon: 'settings' },
    ],
  },
]

interface SidebarProps {
  mode: DashboardMode
  current: ViewId
  onNavigate: (view: ViewId) => void
  onOpenDocs: () => void
  onExitDocs: () => void
  docsSelectedPath: string | null
  onDocsSelect: (path: string) => void
  collapsed: boolean
  onToggle: () => void
}

function findDocSectionTitle(manifest: KnowledgeBaseManifest | null, relativePath: string | null): string | null {
  if (!manifest || !relativePath) return null
  return manifest.sections.find((section) => section.items.some((item) => item.relativePath === relativePath))?.title ?? null
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

function DocsSidebar({
  selectedPath,
  onSelectPath,
  onExit,
}: {
  selectedPath: string | null
  onSelectPath: (path: string) => void
  onExit: () => void
}) {
  const { data: manifest, loading, error } = useKnowledgeBaseManifest()
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!manifest) return
    const currentExists = manifest.sections.some((section) => section.items.some((item) => item.relativePath === selectedPath))
    if (currentExists) return
    onSelectPath(manifest.rootDocumentPath)
  }, [manifest, onSelectPath, selectedPath])

  const filteredSections = useMemo(() => {
    if (!manifest) return []
    const query = search.trim().toLowerCase()
    if (!query) return manifest.sections

    return manifest.sections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => {
          const haystack = `${item.title} ${item.fileName} ${item.relativePath}`.toLowerCase()
          return haystack.includes(query)
        }),
      }))
      .filter((section) => section.items.length > 0)
  }, [manifest, search])

  const totalCount = useMemo(
    () => manifest?.sections.reduce((count, section) => count + section.items.length, 0) ?? 0,
    [manifest]
  )

  const currentSectionTitle = useMemo(
    () => findDocSectionTitle(manifest, selectedPath),
    [manifest, selectedPath]
  )

  return (
    <>
      <div className="flex items-center justify-between px-3 py-5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#00D4FF]/15 bg-[#00D4FF]/[0.08] text-[#00D4FF]">
            <Icon name="book" size={16} />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white">Knowledge Base</p>
            <p className="mt-1 text-[10px] text-slate-600 truncate">{currentSectionTitle ?? `${totalCount} docs indexed`}</p>
          </div>
        </div>
        <button
          onClick={onExit}
          className="rounded-xl border border-white/8 bg-black/20 px-2.5 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 transition hover:border-white/12 hover:text-white"
          title="Exit Knowledge Base"
        >
          Exit
        </button>
      </div>

      <div className="px-3">
        <label htmlFor="kb-search" className="text-[9px] font-black uppercase tracking-[0.24em] text-slate-700">
          Search Docs
        </label>
        <input
          id="kb-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="index, founder, archive..."
          className="mt-2 w-full rounded-2xl border border-white/8 bg-black/30 px-4 py-3 text-sm text-slate-200 outline-none transition focus:border-[#00D4FF]/35 focus:bg-black/40"
        />
      </div>

      <nav className="flex-1 px-2 pt-5 overflow-y-auto no-scrollbar relative z-10">
        {loading && (
          <div className="px-3 py-6 text-[10px] font-black uppercase tracking-[0.22em] text-slate-600">
            Indexing knowledge base...
          </div>
        )}

        {error && (
          <div className="mx-2 rounded-2xl border border-rose-500/20 bg-rose-500/5 px-3 py-4">
            <p className="text-[11px] font-bold text-rose-400">Docs unavailable</p>
            <p className="mt-1 text-[10px] text-slate-500">{error}</p>
          </div>
        )}

        {!loading && !error && filteredSections.map((section) => (
          <div key={section.id} className="mb-5">
            <div className="px-3 mb-2 flex items-center justify-between">
              <p className="text-[8px] font-black uppercase tracking-[0.32em] text-slate-700">
                {section.title}
              </p>
              <span className="text-[9px] font-mono text-slate-700">{section.items.length}</span>
            </div>

            <div className="space-y-1">
              {section.items.map((doc) => {
                const active = selectedPath === doc.relativePath
                return (
                  <button
                    key={doc.relativePath}
                    onClick={() => onSelectPath(doc.relativePath)}
                    className={clsx(
                      'w-full rounded-2xl px-3 py-2.5 text-left transition relative',
                      active
                        ? 'bg-[#00D4FF]/10 text-white'
                        : 'text-slate-400 hover:bg-white/[0.03] hover:text-slate-200'
                    )}
                  >
                    {active && (
                      <div className="absolute left-0 top-3 bottom-3 w-0.5 rounded-r-full bg-[#00D4FF] shadow-[0_0_8px_#00D4FF]" />
                    )}
                    <p className="truncate text-[11px] font-black uppercase tracking-[0.14em]">
                      {doc.title}
                    </p>
                    <p className="mt-1 truncate text-[10px] font-mono text-slate-600">
                      {doc.fileName}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {!loading && !error && filteredSections.length === 0 && (
          <div className="mx-2 rounded-2xl border border-dashed border-white/8 px-4 py-8 text-center">
            <p className="text-xs text-slate-500">No documents match this filter.</p>
          </div>
        )}
      </nav>
    </>
  )
}

export function Sidebar({
  mode,
  current,
  onNavigate,
  onOpenDocs,
  onExitDocs,
  docsSelectedPath,
  onDocsSelect,
  collapsed,
  onToggle,
}: SidebarProps) {
  const isDocsMode = current === 'docs'
  const effectiveCollapsed = isDocsMode ? false : collapsed
  const navSections = mode === 'company' ? COMPANY_NAV_SECTIONS : PERSONAL_NAV_SECTIONS

  return (
    <aside
      className={clsx(
        'flex flex-col h-full border-r border-white/[0.05] bg-[#05080F] transition-all duration-300 flex-shrink-0 pb-10 relative z-[300]',
        effectiveCollapsed ? 'w-14' : isDocsMode ? 'w-72' : 'w-48'
      )}
    >
      {/* Background HUD Scanline */}
      <div className="absolute inset-0 bg-scanline opacity-[0.01] pointer-events-none" />

      {isDocsMode ? (
        <DocsSidebar selectedPath={docsSelectedPath} onSelectPath={onDocsSelect} onExit={onExitDocs} />
      ) : (
        <>
          <div className={clsx('flex items-center px-3 py-5', effectiveCollapsed ? 'flex-col gap-4' : 'justify-between')}>
            <WaiLogo collapsed={effectiveCollapsed} />
            <button
              onClick={onToggle}
              className="p-1 rounded-md text-slate-600 hover:text-[#00D4FF] hover:bg-[#00D4FF]/5 transition-all"
              title={effectiveCollapsed ? 'EXPAND' : 'COLLAPSE'}
            >
              <Icon name={effectiveCollapsed ? 'chevron-right' : 'chevron-left'} size={12} />
            </button>
          </div>

          <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent mx-3" />

          {!effectiveCollapsed && (
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

          <nav className="flex-1 px-2 pt-5 space-y-6 overflow-y-auto no-scrollbar relative z-10">
            {navSections.map((section) => (
              <div key={section.title} className="space-y-1">
                {!effectiveCollapsed && (
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
                        effectiveCollapsed && 'justify-center px-0 py-2',
                        active
                          ? 'bg-[#00D4FF]/[0.06] text-[#00D4FF] shadow-[inset_0_0_10px_rgba(0,212,255,0.05)]'
                          : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.02]'
                      )}
                    >
                      {active && !effectiveCollapsed && (
                        <div className="absolute left-0 w-0.5 h-3 bg-[#00D4FF] rounded-r-full shadow-[0_0_8px_#00D4FF]" />
                      )}

                      <Icon name={item.icon} size={14} className={clsx('transition-colors', active ? 'text-[#00D4FF]' : 'text-slate-600 group-hover:text-slate-400')} />
                      {!effectiveCollapsed && (
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
        </>
      )}

      {/* Connection Status Badge */}
      <div className="px-4 mt-auto">
        {!isDocsMode && (
          <div className="mb-3 flex justify-start">
            <button
              onClick={onOpenDocs}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/8 bg-black/30 text-slate-400 transition hover:border-[#00D4FF]/30 hover:text-[#00D4FF]"
              title="Knowledge Base"
            >
              <Icon name="book" size={15} />
            </button>
          </div>
        )}
        <div className={clsx(
          "flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/5 bg-black/40",
          effectiveCollapsed ? "justify-center px-0" : ""
        )}>
          <div className="relative">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_#10b981]" />
            <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping opacity-40" />
          </div>
          {!effectiveCollapsed && (
            <span className="text-[8px] text-emerald-500/80 font-black tracking-[0.2em] uppercase italic">
              LINK_ESTABLISHED
            </span>
          )}
        </div>
      </div>
    </aside>
  )
}
