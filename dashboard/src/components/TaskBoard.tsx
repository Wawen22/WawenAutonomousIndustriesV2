// ============================================================
// WAI Dashboard – Tactical Ops Task Board (T069)
// High-depth Kanban with Agent Presence, Live Logs and Intelligence Pagination
// ============================================================

import { useState, useMemo } from 'react'
import { clsx } from 'clsx'
import { format, formatDistanceToNow } from 'date-fns'
import { Panel } from './ui/Panel.js'
import { Badge } from './ui/Badge.js'
import { 
  useTasks, 
  useClients, 
  useProjects, 
  useAgents, 
  useAgentStats, 
  useEventsWithContext 
} from '../hooks/useSupabaseRealtime.js'
import { getClientColor } from '../lib/clientColors.js'
import { getAgentColor } from '../lib/agentColors.js'
import { AgentDetailSidebar } from './AgentDetailSidebar.js'
import { DetailSidebar } from './ui/DetailSidebar.js'
import { Icon } from './ui/Icon.js'
import type { Task, TaskStatus, Agent, AgentRun } from '../types/index.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_VISIBLE = 6
const INCREMENT = 8

const COLUMNS: Array<{ status: TaskStatus; label: string; accent: string; description: string }> = [
  { status: 'todo',        label: 'Backlog',     accent: 'text-slate-500',   description: 'Queued operations waiting for resource allocation.' },
  { status: 'in_progress', label: 'Active Ops',  accent: 'text-[#00D4FF]',   description: 'Live threads currently being processed by neural nodes.' },
  { status: 'blocked',     label: 'Impediments', accent: 'text-rose-500',    description: 'Critical blocks requiring founder intervention or retry.' },
  { status: 'done',        label: 'Success',     accent: 'text-emerald-500', description: 'Verified operational outputs and completed objectives.' },
]

const PRIORITY_STYLE: Record<number, string> = {
  1: 'border-rose-500/40 neon-border-p1 bg-rose-500/[0.03]',
  2: 'border-orange-500/40 neon-border-p2 bg-orange-500/[0.02]',
  3: 'border-[#00D4FF]/40 neon-border-p3 bg-[#00D4FF]/[0.02]',
  4: 'border-slate-500/30',
  5: 'border-slate-700/20',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMeta(task: Task, key: string): string {
  const v = task.metadata[key]
  return typeof v === 'string' && v.trim() ? v.trim() : ''
}

// ---------------------------------------------------------------------------
// TaskCard (Tactical Version)
// ---------------------------------------------------------------------------

function TaskCard({ 
  task, 
  agent, 
  lastRun,
  onSelect,
  onAgentClick 
}: { 
  task: Task; 
  agent?: Agent; 
  lastRun?: AgentRun;
  onSelect: (t: Task) => void;
  onAgentClick: (a: Agent) => void;
}) {
  const clientName  = getMeta(task, 'client_name')
  const clientColor = clientName ? getClientColor(clientName) : null
  const isImportant = task.priority <= 2
  const isBusy = agent?.status === 'busy'
  const agentColor = agent ? getAgentColor(agent.id) : null

  return (
    <div
      onClick={() => onSelect(task)}
      className={clsx(
        'relative group rounded-xl border bg-[#070C1A]/60 backdrop-blur-sm transition-all duration-300',
        'p-4 cursor-pointer hover:-translate-y-1 hover:bg-[#0F2040]/80',
        PRIORITY_STYLE[task.priority] || 'border-white/5'
      )}
    >
      {/* Priority Glow */}
      {isImportant && (
        <div className={clsx(
          "absolute -top-1 -left-1 w-2 h-2 rounded-full z-20",
          task.priority === 1 ? "bg-rose-500 shadow-[0_0_8px_#f43f5e]" : "bg-orange-500 shadow-[0_0_8px_#f97316]"
        )} />
      )}

      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          {clientName && clientColor && (
            <span className={clsx('text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-[0.2em] border mb-2 inline-block', clientColor.bg, clientColor.text, clientColor.border)}>
              {clientName}
            </span>
          )}
          <h4 className={clsx(
            "text-[13px] font-bold leading-snug transition-colors",
            isImportant ? "text-white" : "text-slate-300 group-hover:text-white"
          )}>
            {task.title}
          </h4>
        </div>

        {/* Agent Presence Avatar */}
        {agent && agentColor && (
          <div className="group/avatar relative shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); onAgentClick(agent); }}
              className={clsx(
                "relative transition-all duration-300 hover:scale-110 flex items-center justify-center w-10 h-10 rounded-lg border overflow-hidden font-black text-[10px]",
                agentColor.bg, agentColor.border, agentColor.text, agentColor.glow,
                isBusy && "ring-2 ring-amber-400/50"
              )}
            >
              {agent.name.split(' ').map(n => n[0]).join('')}
              {isBusy && (
                <div className="absolute inset-0 bg-amber-400/5 animate-pulse" />
              )}
            </button>
            <div className="absolute bottom-full right-0 mb-2 whitespace-nowrap px-2 py-1 rounded bg-[#0A1628] border border-white/10 text-[9px] font-black text-white uppercase tracking-widest opacity-0 invisible group-hover/avatar:opacity-100 group-hover/avatar:visible transition-all z-[60] pointer-events-none shadow-2xl">
              {agent.name}
            </div>
            <div className={clsx(
              "absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-[#070C1A] z-10",
              isBusy ? "bg-amber-400 animate-pulse" : agent.status === 'online' ? "bg-emerald-400" : "bg-slate-600"
            )} />
          </div>
        )}
      </div>

      {/* Live Node Log */}
      {task.status === 'in_progress' && lastRun && (
        <div className="mb-3 px-2 py-1.5 rounded bg-black/40 border border-white/5 font-mono text-[9px] text-emerald-400/80 overflow-hidden italic">
          <span className="text-slate-600 mr-1.5">[{new Date(lastRun.created_at).toLocaleTimeString('it-IT', { hour12: false })}]</span>
          {lastRun.output_summary ? lastRun.output_summary.slice(0, 60) + '...' : 'Processing stream...'}
        </div>
      )}

      {/* Footer Info */}
      <div className="flex flex-col gap-2 pt-3 border-t border-white/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-mono text-slate-600 uppercase tracking-widest">{task.type}</span>
            <span className="w-1 h-1 rounded-full bg-slate-800" />
            <span className="text-[9px] font-mono text-slate-500 font-bold uppercase tracking-tighter italic">
              {format(new Date(task.created_at), 'dd MMM HH:mm')}
            </span>
          </div>
          <div className={clsx(
            "text-[9px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded",
            task.priority === 1 ? "text-rose-400 bg-rose-400/10" : "text-slate-500 bg-white/5"
          )}>
            P{task.priority}
          </div>
        </div>
        
        {agent && (
          <div className="flex items-center gap-1.5">
            <div className="w-1 h-3 rounded-full bg-[#00D4FF]/20" />
            <span className="text-[10px] font-black text-[#00D4FF]/70 uppercase tracking-[0.1em]">
              Node: <span className="text-[#00D4FF]">{agent.name}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Column Header Component
// ---------------------------------------------------------------------------

function ColumnHeader({ config, count, total }: { config: typeof COLUMNS[0]; count: number; total: number }) {
  const threatLevel = config.status === 'blocked' && count > 0 
    ? 'text-rose-500 animate-pulse' 
    : config.status === 'in_progress' && count > 0 
      ? 'text-[#00D4FF]' 
      : 'text-slate-500'

  return (
    <div className="flex flex-col gap-1 group/col">
      <div className={clsx("flex items-center justify-between pb-3 border-b-2 transition-colors", config.accent.replace('text-', 'border-'))}>
        <div className="flex items-center gap-3">
          <h3 className={clsx("text-[11px] font-black uppercase tracking-[0.3em]", config.accent)}>{config.label}</h3>
          <div className={clsx("px-2 py-0.5 rounded bg-white/[0.03] border border-white/[0.05] text-[10px] font-mono font-bold", threatLevel)}>
            {count}
          </div>
        </div>
        <Icon name="overview" size={12} className="text-slate-800 group-hover/col:text-slate-600 transition-colors" />
      </div>
      <p className="text-[9px] text-slate-600 font-medium uppercase tracking-wider mt-1 px-1">{config.description}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Board
// ---------------------------------------------------------------------------

export function TaskBoard() {
  const { data: tasks, loading, error } = useTasks()
  const { data: agents } = useAgents()
  const { data: clients } = useClients()
  const { data: projects } = useProjects()
  const { runCounts, lastRuns } = useAgentStats()
  const { data: events } = useEventsWithContext(50)

  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  
  // Track visible count per status
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({
    todo: INITIAL_VISIBLE,
    in_progress: INITIAL_VISIBLE,
    blocked: INITIAL_VISIBLE,
    done: INITIAL_VISIBLE,
  })

  const grouped = useMemo(() => {
    const map = tasks.reduce<Record<TaskStatus, Task[]>>(
      (acc, t) => {
        acc[t.status] = [...(acc[t.status] ?? []), t]
        return acc
      },
      { todo: [], in_progress: [], done: [], blocked: [], cancelled: [] }
    )
    Object.keys(map).forEach((k) => {
      map[k as TaskStatus].sort((a, b) => a.priority - b.priority)
    })
    return map
  }, [tasks])

  const loadMore = (status: TaskStatus) => {
    setVisibleCounts(prev => ({ ...prev, [status]: prev[status] + INCREMENT }))
  }

  const resetCount = (status: TaskStatus) => {
    setVisibleCounts(prev => ({ ...prev, [status]: INITIAL_VISIBLE }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-[#00D4FF]/20 border-t-[#00D4FF] rounded-full animate-spin" />
      </div>
    )
  }

  if (error) return <div className="p-8 text-rose-400 font-bold uppercase tracking-widest text-xs">Critical Sync Failure: {error}</div>

  return (
    <div className="animate-fade-in space-y-10">
      {/* Board Summary HUD */}
      <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-8">
        <div className="flex items-center gap-12 overflow-x-auto pb-2 md:pb-0 w-full md:w-auto">
          {COLUMNS.map(col => {
            const count = grouped[col.status].length
            return (
              <div key={col.status} className="flex flex-col shrink-0">
                <div className="flex items-center gap-2">
                  <span className={clsx("text-2xl font-black font-mono tracking-tighter", col.accent)}>{count}</span>
                  {col.status === 'blocked' && count > 0 && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />}
                </div>
                <span className="text-[10px] font-black text-slate-600 uppercase tracking-[0.2em]">{col.label}</span>
              </div>
            )
          })}
        </div>
        
        <div className="flex items-center gap-6 shrink-0">
          <div className="text-right">
            <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Global Load</p>
            <p className="text-sm font-mono font-bold text-sky-400">{tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled').length} ACTIVE THREADS</p>
          </div>
          <div className="w-px h-8 bg-white/10" />
          <div className="px-4 py-2 rounded-xl bg-black/40 border border-white/5 flex items-center gap-3">
             <div className="flex gap-1">
                {[1,2,3].map(i => <div key={i} className="w-1 h-3 bg-[#00D4FF]/40 rounded-full animate-pulse" style={{ animationDelay: `${i*200}ms` }} />)}
             </div>
             <span className="text-[10px] font-black text-[#00D4FF] uppercase tracking-widest italic">Sync Active</span>
          </div>
        </div>
      </div>

      {/* Kanban Matrix */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 items-start">
        {COLUMNS.map(col => {
          const colTasks = grouped[col.status]
          const currentVisible = visibleCounts[col.status] || INITIAL_VISIBLE
          const visibleTasks = colTasks.slice(0, currentVisible)
          const hasMore = colTasks.length > currentVisible

          return (
            <div key={col.status} className="flex flex-col gap-6 group/column">
              <ColumnHeader config={col} count={colTasks.length} total={tasks.length} />
              
              <div className="flex flex-col gap-4 min-h-[400px]">
                {visibleTasks.map(task => {
                  const assignee = agents.find(a => a.id === task.assignee_agent_id)
                  const run = task.assignee_agent_id ? lastRuns[task.assignee_agent_id]?.[0] : undefined
                  return (
                    <TaskCard 
                      key={task.id} 
                      task={task} 
                      agent={assignee}
                      lastRun={run}
                      onSelect={setSelectedTask}
                      onAgentClick={setSelectedAgent}
                    />
                  )
                })}

                {colTasks.length === 0 && (
                  <div className="py-16 border border-dashed border-white/5 rounded-2xl flex flex-col items-center justify-center gap-3 opacity-40">
                    <Icon name="tasks" size={20} className="text-slate-800" />
                    <span className="text-[10px] font-black text-slate-700 uppercase tracking-[0.25em] italic">No Operational Data</span>
                  </div>
                )}

                <div className="space-y-2 mt-2">
                  {hasMore && (
                    <button
                      onClick={() => loadMore(col.status)}
                      className={clsx(
                        "w-full py-3 rounded-xl border border-white/5 bg-white/[0.02] text-[10px] font-black uppercase tracking-[0.2em] transition-all",
                        "hover:bg-white/[0.05] hover:border-white/10 hover:text-white group/more"
                      )}
                    >
                      <span className="flex items-center justify-center gap-2">
                        Access Intel Cluster (+{Math.min(INCREMENT, colTasks.length - currentVisible)}) 
                        <span className="text-lg group-hover/more:translate-y-0.5 transition-transform">↓</span>
                      </span>
                    </button>
                  )}

                  {currentVisible > INITIAL_VISIBLE && (
                    <button
                      onClick={() => resetCount(col.status)}
                      className="w-full py-2 text-[9px] font-black text-slate-600 uppercase tracking-widest hover:text-slate-400 transition-colors"
                    >
                      Reset Grid Sync ↑
                    </button>
                  )}
                </div>
              </div>

              {/* Column Footer Summary */}
              <div className="mt-2 flex items-center justify-between px-2 opacity-0 group-hover/column:opacity-100 transition-opacity">
                 <span className="text-[8px] font-mono text-slate-700 uppercase">Sector: {col.status}</span>
                 <div className="h-px flex-1 mx-4 bg-white/5" />
                 <span className="text-[8px] font-mono text-slate-700 uppercase">Load: {Math.round((colTasks.length / (tasks.length || 1)) * 100)}%</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Sidebars */}
      {selectedTask && (
        <DetailSidebar
          title="Operation Intel"
          subtitle={`Task Priority P${selectedTask.priority} • ${selectedTask.status}`}
          data={selectedTask}
          onClose={() => setSelectedTask(null)}
        />
      )}

      {selectedAgent && (
        <AgentDetailSidebar
          agent={selectedAgent}
          lastRuns={lastRuns[selectedAgent.id] ?? []}
          runCount={runCounts[selectedAgent.id] ?? 0}
          activeTasks={tasks.filter(t => t.status === 'in_progress')}
          recentEvents={events || []}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  )
}
