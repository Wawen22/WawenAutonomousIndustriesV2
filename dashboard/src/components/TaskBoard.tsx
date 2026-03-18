// ============================================================
// WAI Dashboard – Tactical Ops Task Board (T069)
// High-depth Kanban with Agent Presence and Live Logs
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
import type { Task, TaskStatus, Agent, AgentRun } from '../types/index.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLUMNS: Array<{ status: TaskStatus; label: string; accent: string }> = [
  { status: 'todo',        label: 'Backlog',     accent: 'text-slate-500' },
  { status: 'in_progress', label: 'Active Ops',  accent: 'text-[#00D4FF]' },
  { status: 'blocked',     label: 'Impediments', accent: 'text-rose-500'  },
  { status: 'done',        label: 'Success',     accent: 'text-emerald-500' },
]

const PRIORITY_STYLE: Record<number, string> = {
  1: 'border-rose-500/40 neon-border-p1',
  2: 'border-orange-500/40 neon-border-p2',
  3: 'border-[#00D4FF]/40 neon-border-p3',
  4: 'border-slate-500/30',
  5: 'border-slate-700/20',
}

const BACKEND_URL = (import.meta.env['VITE_BACKEND_URL'] as string | undefined) ?? 'http://localhost:3001'

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
        PRIORITY_STYLE[task.priority] || 'border-white/5',
        task.status === 'blocked' && 'border-rose-500/20 bg-rose-500/[0.02]',
        task.status === 'in_progress' && 'bg-[#00D4FF]/[0.02]'
      )}
    >
      {/* Priority Glow */}
      {isImportant && (
        <div className={clsx(
          "absolute -top-1 -left-1 w-2 h-2 rounded-full",
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
          <div className="group/avatar relative">
            <button
              onClick={(e) => { e.stopPropagation(); onAgentClick(agent); }}
              className={clsx(
                "relative shrink-0 transition-all duration-300 hover:scale-110 flex items-center justify-center w-10 h-10 rounded-lg border overflow-hidden font-black text-[10px]",
                agentColor.bg, agentColor.border, agentColor.text, agentColor.glow,
                isBusy && "ring-2 ring-amber-400/50"
              )}
            >
              {agent.name.split(' ').map(n => n[0]).join('')}
              {isBusy && (
                <div className="absolute inset-0 bg-amber-400/5 animate-pulse" />
              )}
            </button>
            {/* Hover Tooltip for Agent Name */}
            <div className="absolute bottom-full right-0 mb-2 whitespace-nowrap px-2 py-1 rounded bg-[#0A1628] border border-white/10 text-[9px] font-black text-white uppercase tracking-widest opacity-0 invisible group-hover/avatar:opacity-100 group-hover/avatar:visible transition-all z-50 pointer-events-none shadow-2xl">
              {agent.name}
            </div>
            {/* Status Indicator */}
            <div className={clsx(
              "absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-[#070C1A] z-10",
              isBusy ? "bg-amber-400 animate-pulse" : agent.status === 'online' ? "bg-emerald-400" : "bg-slate-600"
            )} />
          </div>
        )}
      </div>

      {/* Live Node Log (Micro-string) */}
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
        
        {/* Agent Name Label in Footer */}
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

  const grouped = useMemo(() => {
    const map = tasks.reduce<Record<TaskStatus, Task[]>>(
      (acc, t) => {
        acc[t.status] = [...(acc[t.status] ?? []), t]
        return acc
      },
      { todo: [], in_progress: [], done: [], blocked: [], cancelled: [] }
    )
    // Sort columns by priority
    Object.keys(map).forEach((k) => {
      map[k as TaskStatus].sort((a, b) => a.priority - b.priority)
    })
    return map
  }, [tasks])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-[#00D4FF]/20 border-t-[#00D4FF] rounded-full animate-spin" />
      </div>
    )
  }

  if (error) return <div className="p-8 text-rose-400 font-bold">Board Sync Failure: {error}</div>

  return (
    <div className="animate-fade-in space-y-8">
      {/* Board Summary */}
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-8">
          {COLUMNS.map(col => (
            <div key={col.status} className="flex flex-col">
              <span className={clsx("text-lg font-black font-mono", col.accent)}>{grouped[col.status].length}</span>
              <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">{col.label}</span>
            </div>
          ))}
        </div>
        <p className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest italic">Tactical Map Active</p>
      </div>

      {/* Kanban Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-start">
        {COLUMNS.map(col => (
          <div key={col.status} className="flex flex-col gap-4">
            <div className={clsx("flex items-center justify-between pb-2 border-b-2", col.accent.replace('text-', 'border-'))}>
              <h3 className={clsx("text-[11px] font-black uppercase tracking-[0.25em]", col.accent)}>{col.label}</h3>
              <span className="text-[10px] font-mono text-slate-700">{grouped[col.status].length}</span>
            </div>
            
            <div className="flex flex-col gap-3 min-h-[500px]">
              {grouped[col.status].map(task => {
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
              {grouped[col.status].length === 0 && (
                <div className="py-12 border border-dashed border-white/5 rounded-xl flex items-center justify-center">
                  <span className="text-[10px] font-black text-slate-800 uppercase tracking-widest italic">No Intel</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Detail Sidebar (Task) */}
      {selectedTask && (
        <DetailSidebar
          title="Task Operational Detail"
          subtitle={`Priority P${selectedTask.priority} • ${selectedTask.status}`}
          data={selectedTask}
          onClose={() => setSelectedTask(null)}
        />
      )}

      {/* Agent Sidebar */}
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
