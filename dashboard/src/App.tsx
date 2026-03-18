import { useState, useEffect, lazy, Suspense, Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { clsx } from 'clsx'
import { Sidebar, type ViewId } from './components/Sidebar.js'
import { Overview } from './components/Overview.js'
import { TaskBoard } from './components/TaskBoard.js'
import { EventTimeline } from './components/EventTimeline.js'
import { CostPanel } from './components/CostPanel.js'
import { RunsView } from './components/RunsView.js'
import { ClientsView } from './components/ClientsView.js'
import { ProjectsView } from './components/ProjectsView.js'
import { RevenueView } from './components/RevenueView.js'
import { TeamOrgView } from './components/TeamOrgView.js'

const VirtualOffice3DView = lazy(() =>
  import('./components/VirtualOffice3DView.js').then((m) => ({ default: m.VirtualOffice3DView }))
)

// ---------------------------------------------------------------------------
// Error boundary
// ---------------------------------------------------------------------------

interface EBState { error: Error | null }

class ErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { error: null }

  static getDerivedStateFromError(error: Error): EBState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[WAI ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
          <p className="text-rose-400 text-sm font-mono font-bold">Render error</p>
          <pre className="text-[11px] text-slate-500 font-mono whitespace-pre-wrap max-w-xl text-center">
            {this.state.error.message}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="text-[11px] text-[#00D4FF] border border-[#00D4FF]/30 rounded px-3 py-1 hover:bg-[#00D4FF]/10 transition-colors"
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ---------------------------------------------------------------------------
// View metadata
// ---------------------------------------------------------------------------

const VIEW_META: Record<ViewId, { title: string; description: string }> = {
  overview: { title: 'Overview',       description: 'System command center'                        },
  tasks:    { title: 'Task Board',     description: 'Task pipeline — Kanban view'                  },
  clients:  { title: 'Clients',        description: 'Client registry — prospects and active deals' },
  projects: { title: 'Projects',       description: 'All projects — filterable by client / status' },
  revenue:  { title: 'Revenue',        description: 'Progetti fatturati — ricavi real-time'        },
  activity: { title: 'Activity Log',   description: 'Real-time system event timeline'              },
  costs:    { title: 'Costs & Runs',   description: 'Budget, model usage, run history'             },
  runs:     { title: 'Runs',           description: 'All agent runs — filterable by agent, model, outcome' },
  team:     { title: 'Team Org',       description: 'WAI org chart — Neb → CEO → teams → agents'           },
  office:   { title: 'Virtual Office', description: 'Digital office — agent desks, activity, realtime'     },
  memory:   { title: 'Memory',         description: 'Agent memory documents — search & browse'              },
}

// ---------------------------------------------------------------------------
// Topbar
// ---------------------------------------------------------------------------

function Topbar({ view }: { view: ViewId }) {
  const meta = VIEW_META[view]
  const [time, setTime] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-white/[0.07] bg-[#070C1A]/80 backdrop-blur-sm flex-shrink-0">
      <div>
        <h1 className="text-sm font-bold text-white tracking-tight leading-none">
          {meta.title}
        </h1>
        <p className="text-[11px] text-slate-600 mt-0.5">{meta.description}</p>
      </div>

      <div className="flex items-center gap-3">
        {/* Milestone pill */}
        <span className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.06]">
          <span className="w-1 h-1 rounded-full bg-[#00D4FF]" />
          <span className="text-[10px] text-slate-500 font-mono">M7 In Progress</span>
        </span>

        <div className="w-px h-3.5 bg-white/[0.08]" />

        {/* Live indicator */}
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-slow" />
          <span className="text-[10px] text-emerald-400 font-mono uppercase tracking-widest font-bold">
            Live
          </span>
        </div>

        {/* Time */}
        <span className="hidden md:block text-[10px] text-slate-600 font-mono">
          {time.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
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
    case 'overview':  return <Overview />
    case 'tasks':     return <TaskBoard />
    case 'clients':   return <ClientsView />
    case 'projects':  return <ProjectsView />
    case 'revenue':   return <RevenueView />
    case 'activity':  return <EventTimeline />
    case 'costs':     return <CostPanel />
    case 'runs':      return <RunsView />
    case 'team':      return <TeamOrgView />
    case 'office':    return (
      <Suspense fallback={
        <div className="flex items-center justify-center h-full min-h-[500px]">
          <div className="w-6 h-6 border-2 border-[#00D4FF]/30 border-t-[#00D4FF] rounded-full animate-spin" />
        </div>
      }>
        <VirtualOffice3DView />
      </Suspense>
    )
    case 'memory':    return <div className="flex items-center justify-center h-40 text-slate-600 text-sm">Memory System — coming soon (T066)</div>
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
          <ErrorBoundary key={view}>
            <ViewContent view={view} />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}
