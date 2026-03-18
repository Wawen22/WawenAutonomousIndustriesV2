// ============================================================
// WAI Dashboard – Tactical Ops Task Board (T069)
// High-depth Kanban with Independent Column Scrolling
// ============================================================

import { useState, useMemo } from 'react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import {
  useTasks,
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
  { status: 'todo',        label: 'Backlog',     accent: 'text-slate-500',   description: 'Queued operations waiting for allocation.' },
  { status: 'in_progress', label: 'Active Ops',  accent: 'text-[#00D4FF]',   description: 'Live threads processed by neural nodes.' },
  { status: 'blocked',     label: 'Impediments', accent: 'text-rose-500',    description: 'Critical blocks requiring intervention.' },
  { status: 'done',        label: 'Success',     accent: 'text-emerald-500', description: 'Verified operational outputs completed.' },
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
// TaskCard
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
    <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          {clientName && clientColor && (
            <span className={clsx('text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-[0.2em] border mb-2 inline-block', clientColor.bg, clientColor.text, clientColor.border)}>
              {clientName}
            </span>
          )}
          <h4 className={clsx(
            "text-[13px] font-bold leading-snug transition-colors truncate",
            isImportant ? "text-white" : "text-slate-300 group-hover:text-white"
          )}>
            {task.title}
          </h4>
        </div>

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
              {isBusy && <div className="absolute inset-0 bg-amber-400/5 animate-pulse" />}
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

      {task.status === 'in_progress' && lastRun && (
        <div className="mb-3 px-2 py-1.5 rounded bg-black/40 border border-white/5 font-mono text-[9px] text-emerald-400/80 overflow-hidden italic">
          <span className="text-slate-600 mr-1.5">[{new Date(lastRun.created_at).toLocaleTimeString('it-IT', { hour12: false })}]</span>
          {lastRun.output_summary ? lastRun.output_summary.slice(0, 50) + '...' : 'Processing...'}
        </div>
      )}

      <div className="flex flex-col gap-2 pt-3 border-t border-white/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-mono text-slate-600 uppercase tracking-widest">{task.type}</span>
            <span className="w-1 h-1 rounded-full bg-slate-800" />
            <span className="text-[9px] font-mono text-slate-500 font-bold uppercase tracking-tighter">
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

function ColumnHeader({ config, count }: { config: typeof COLUMNS[0]; count: number }) {
  const threatLevel = config.status === 'blocked' && count > 0 
    ? 'text-rose-500 animate-pulse' 
    : config.status === 'in_progress' && count > 0 
      ? 'text-[#00D4FF]' 
      : 'text-slate-500'

  return (
    <div className="flex flex-col gap-1 shrink-0 bg-[#05080F]/80 backdrop-blur-md pb-2 z-10">
      <div className={clsx("flex items-center justify-between pb-3 border-b-2 transition-colors", config.accent.replace('text-', 'border-'))}>
        <div className="flex items-center gap-3">
          <h3 className={clsx("text-[11px] font-black uppercase tracking-[0.3em]", config.accent)}>{config.label}</h3>
          <div className={clsx("px-2 py-0.5 rounded bg-white/[0.03] border border-white/[0.05] text-[10px] font-mono font-bold", threatLevel)}>
            {count}
          </div>
        </div>
        <Icon name="overview" size={12} className="text-slate-800" />
      </div>
      <p className="text-[9px] text-slate-600 font-medium uppercase tracking-wider mt-1 px-1 line-clamp-1">{config.description}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Board
// ---------------------------------------------------------------------------

export function TaskBoard() {
  const { data: tasks, loading, error } = useTasks()
  const { data: agents } = useAgents()
  const { runCounts, lastRuns } = useAgentStats()
  const { data: events } = useEventsWithContext(50)

  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({
    todo: INITIAL_VISIBLE, in_progress: INITIAL_VISIBLE, blocked: INITIAL_VISIBLE, done: INITIAL_VISIBLE,
  })

  const grouped = useMemo(() => {
    const map = tasks.reduce<Record<TaskStatus, Task[]>>(
      (acc, t) => {
        acc[t.status] = [...(acc[t.status] ?? []), t]
        return acc
      },
      { todo: [], in_progress: [], done: [], blocked: [], cancelled: [] }
    )
    Object.keys(map).forEach((k) => map[k as TaskStatus].sort((a, b) => a.priority - b.priority))
    return map
  }, [tasks])

  const loadMore = (status: TaskStatus) => setVisibleCounts(prev => ({ ...prev, [status]: prev[status] + INCREMENT }))
  const resetCount = (status: TaskStatus) => setVisibleCounts(prev => ({ ...prev, [status]: INITIAL_VISIBLE }))

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-[#00D4FF]/20 border-t-[#00D4FF] rounded-full animate-spin" />
      </div>
    )
  }

  if (error) return <div className="p-8 text-rose-400 font-bold uppercase tracking-widest text-xs">Sync Failure: {error}</div>

  return (
    <div className="h-[calc(100vh-110px)] flex flex-col space-y-6 animate-fade-in overflow-hidden">
      
      {/* Board Summary HUD (Fixed at top) */}
      <div className="shrink-0 bg-white/[0.02] border border-white/5 rounded-2xl p-5 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-10 overflow-x-auto no-scrollbar">
          {COLUMNS.map(col => {
            const count = grouped[col.status].length
            return (
              <div key={col.status} className="flex flex-col shrink-0">
                <div className="flex items-center gap-2">
                  <span className={clsx("text-xl font-black font-mono tracking-tighter", col.accent)}>{count}</span>
                  {col.status === 'blocked' && count > 0 && <span className="w-1 h-1 rounded-full bg-rose-500 animate-ping" />}
                </div>
                <span className="text-[10px] font-black text-slate-600 uppercase tracking-[0.2em]">{col.label}</span>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Grid Load</p>
            <p className="text-xs font-mono font-bold text-sky-400 uppercase tracking-tight">{tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled').length} Active Processes</p>
          </div>
          <div className="w-px h-6 bg-white/10 hidden sm:block" />
          <div className="hidden sm:flex px-3 py-1.5 rounded-lg bg-black/40 border border-white/5 items-center gap-2">
             <span className="w-1 h-1 rounded-full bg-[#00D4FF] animate-pulse" />
             <span className="text-[9px] font-black text-[#00D4FF] uppercase tracking-widest">Realtime Sync</span>
          </div>
        </div>
      </div>

      {/* Kanban Matrix (Scrollable columns) */}
      <div className="flex-1 flex gap-6 overflow-x-auto pb-4 no-scrollbar">
        {COLUMNS.map(col => {
          const colTasks = grouped[col.status]
          const currentVisible = visibleCounts[col.status] || INITIAL_VISIBLE
          const visibleTasks = colTasks.slice(0, currentVisible)
          const hasMore = colTasks.length > currentVisible

          return (
            <div key={col.status} className="flex-1 min-w-[300px] flex flex-col h-full bg-white/[0.01] rounded-2xl border border-white/[0.03] p-4 group/column">
              <ColumnHeader config={col} count={colTasks.length} />
              
              {/* Individual Column Scroll Area */}
              <div className="flex-1 overflow-y-auto mt-4 pr-1 space-y-3 custom-scrollbar scroll-smooth">
                {visibleTasks.map(task => {
                  const assignee = agents.find(a => a.id === task.assignee_agent_id)
                  const run = task.assignee_agent_id ? lastRuns[task.assignee_agent_id]?.[0] : undefined
                  return (
                    <TaskCard 
                      key={task.id} task={task} agent={assignee} lastRun={run}
                      onSelect={setSelectedTask} onAgentClick={setSelectedAgent}
                    />
                  )
                })}

                {colTasks.length === 0 && (
                  <div className="py-12 border border-dashed border-white/5 rounded-xl flex flex-col items-center justify-center gap-3 opacity-30">
                    <Icon name="tasks" size={16} className="text-slate-800" />
                    <span className="text-[9px] font-black text-slate-700 uppercase tracking-widest">No Intel</span>
                  </div>
                )}

                {/* Inline Loading / Reset */}
                <div className="pt-2 space-y-2 shrink-0">
                  {hasMore && (
                    <button
                      onClick={() => loadMore(col.status)}
                      className="w-full py-2.5 rounded-lg border border-white/5 bg-white/[0.02] text-[9px] font-black uppercase tracking-[0.2em] hover:bg-[#00D4FF]/5 hover:text-[#00D4FF] transition-all group/more"
                    >
                      Sync Cluster (+{Math.min(INCREMENT, colTasks.length - currentVisible)}) ↓
                    </button>
                  )}
                  {currentVisible > INITIAL_VISIBLE && (
                    <button onClick={() => resetCount(col.status)} className="w-full py-1 text-[8px] font-black text-slate-700 uppercase tracking-widest hover:text-slate-400">
                      Reset Sync ↑
                    </button>
                  )}
                </div>
              </div>

              {/* Stats Footer (Optional summary) */}
              <div className="pt-3 flex items-center justify-between border-t border-white/[0.03] mt-2 opacity-40">
                 <span className="text-[8px] font-mono text-slate-600 uppercase">Load: {Math.round((colTasks.length / (tasks.length || 1)) * 100)}%</span>
                 <span className="text-[8px] font-mono text-slate-600 uppercase">Sector: {col.status}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Overlays */}
      {selectedTask && (
        <DetailSidebar
          title="Operation Intel" subtitle={`P${selectedTask.priority} • ${selectedTask.status}`}
          data={selectedTask} onClose={() => setSelectedTask(null)}
        />
      )}
      {selectedAgent && (
        <AgentDetailSidebar
          agent={selectedAgent} lastRuns={lastRuns[selectedAgent.id] ?? []}
          runCount={runCounts[selectedAgent.id] ?? 0} activeTasks={tasks.filter(t => t.status === 'in_progress')}
          recentEvents={events || []} onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  )
}
