import { useState } from 'react'
import { clsx } from 'clsx'
import { Sidebar, type ViewId } from './components/Sidebar.js'
import { Overview } from './components/Overview.js'
import { AgentList } from './components/AgentList.js'
import { TaskBoard } from './components/TaskBoard.js'
import { EventTimeline } from './components/EventTimeline.js'
import { CostPanel } from './components/CostPanel.js'

// ---------------------------------------------------------------------------
// View metadata
// ---------------------------------------------------------------------------

const VIEW_META: Record<ViewId, { title: string; description: string }> = {
  overview: { title: 'Overview',       description: 'System command center'           },
  agents:   { title: 'Agent Fleet',    description: 'All agents and their status'     },
  tasks:    { title: 'Task Board',     description: 'Task pipeline — Kanban view'     },
  activity: { title: 'Activity Log',   description: 'Real-time system event timeline' },
  costs:    { title: 'Costs & Runs',   description: 'Budget, model usage, run history'},
}

// ---------------------------------------------------------------------------
// Topbar
// ---------------------------------------------------------------------------

function Topbar({ view }: { view: ViewId }) {
  const meta = VIEW_META[view]
  const now  = new Date()

  return (
    <div className="flex items-center justify-between px-6 py-3.5 border-b border-white/[0.07] bg-[#070C1A]/80 backdrop-blur-sm flex-shrink-0">
      <div>
        <h1 className="text-base font-bold text-white tracking-tight leading-none">
          {meta.title}
        </h1>
        <p className="text-[11px] text-slate-600 mt-0.5">{meta.description}</p>
      </div>

      <div className="flex items-center gap-4">
        {/* Current milestone */}
        <span className="hidden sm:block text-[11px] text-slate-600 font-mono">
          M2 · CEO Agent Loop
        </span>

        {/* Divider */}
        <div className="w-px h-4 bg-white/[0.08]" />

        {/* Live indicator */}
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-slow" />
          <span className="text-[11px] text-emerald-400 font-mono uppercase tracking-wider font-semibold">
            Live
          </span>
        </div>

        {/* Time */}
        <span className="hidden md:block text-[11px] text-slate-600 font-mono">
          {now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// View renderer
// ---------------------------------------------------------------------------

function ViewContent({ view }: { view: ViewId }) {
  switch (view) {
    case 'overview': return <Overview />
    case 'agents':   return <AgentList />
    case 'tasks':    return <TaskBoard />
    case 'activity': return <EventTimeline />
    case 'costs':    return <CostPanel />
  }
}

// ---------------------------------------------------------------------------
// App root
// ---------------------------------------------------------------------------

export function App() {
  const [view, setView]           = useState<ViewId>('overview')
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="flex h-full bg-[#05080F] overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        current={view}
        onNavigate={setView}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
      />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar */}
        <Topbar view={view} />

        {/* Page */}
        <main
          className={clsx(
            'flex-1 overflow-y-auto bg-grid',
            'p-5 xl:p-6'
          )}
          // Subtle radial gradient overlay for depth
          style={{
            backgroundImage: [
              'radial-gradient(ellipse 70% 40% at 60% -10%, rgba(0,212,255,0.04) 0%, transparent 60%)',
              "radial-gradient(circle, rgba(255,255,255,0.055) 1px, transparent 1px)",
            ].join(', '),
            backgroundSize: 'auto, 28px 28px',
          }}
        >
          <ViewContent view={view} />
        </main>
      </div>
    </div>
  )
}
