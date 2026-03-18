import { useState, useMemo } from 'react'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import { Panel } from './ui/Panel.js'
import { Badge } from './ui/Badge.js'
import { useTasks, useClients, useProjects } from '../hooks/useSupabaseRealtime.js'
import { getClientColor } from '../lib/clientColors.js'
import type { Task, TaskStatus } from '../types/index.js'

// ---------------------------------------------------------------------------
// Column config
// ---------------------------------------------------------------------------

interface ColConfig {
  status: TaskStatus
  label: string
  accent: string
  border: string
  borderT: string
}

const COLUMNS: ColConfig[] = [
  { status: 'todo',        label: 'Todo',        accent: 'text-slate-400',   border: 'border-l-slate-600',  borderT: 'border-t-slate-600'  },
  { status: 'in_progress', label: 'In Progress', accent: 'text-sky-400',     border: 'border-l-sky-500',    borderT: 'border-t-sky-500'    },
  { status: 'blocked',     label: 'Blocked',     accent: 'text-orange-400',  border: 'border-l-orange-500', borderT: 'border-t-orange-500' },
  { status: 'done',        label: 'Done',        accent: 'text-emerald-400', border: 'border-l-emerald-600', borderT: 'border-t-emerald-600' },
]

const DONE_LIMIT = 12   // cap "Done" column to avoid clutter

// ---------------------------------------------------------------------------
// Helpers to extract metadata fields
// ---------------------------------------------------------------------------

function getMeta(task: Task, key: string): string {
  const v = task.metadata[key]
  return typeof v === 'string' && v.trim() ? v.trim() : ''
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

interface FilterState {
  search: string
  clientId: string
  projectId: string
  agent: string
}

interface FilterBarProps {
  filter: FilterState
  onChange: (f: FilterState) => void
  clients: Array<{ id: string; name: string }>
  projects: Array<{ id: string; name: string; client_id: string }>
  agents: string[]
}

function FilterBar({ filter, onChange, clients, projects, agents }: FilterBarProps) {
  const sel = clsx(
    'text-[11px] font-mono bg-white/[0.04] border border-white/[0.08] rounded-md px-2 py-1.5',
    'text-slate-300 focus:outline-none focus:border-sky-500/40 transition-colors'
  )
  const inp = clsx(sel, 'placeholder-slate-600 w-36')

  const visibleProjects = filter.clientId
    ? projects.filter((p) => p.client_id === filter.clientId)
    : projects

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] text-slate-600 uppercase tracking-wider font-medium">Filter:</span>

      <input
        value={filter.search}
        onChange={(e) => onChange({ ...filter, search: e.target.value })}
        placeholder="Search title…"
        className={inp}
      />

      <select
        value={filter.clientId}
        onChange={(e) => onChange({ ...filter, clientId: e.target.value, projectId: '' })}
        className={sel}
      >
        <option value="">All clients</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>

      <select
        value={filter.projectId}
        onChange={(e) => onChange({ ...filter, projectId: e.target.value })}
        className={sel}
        disabled={visibleProjects.length === 0}
      >
        <option value="">All projects</option>
        {visibleProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>

      <select
        value={filter.agent}
        onChange={(e) => onChange({ ...filter, agent: e.target.value })}
        className={sel}
      >
        <option value="">All agents</option>
        {agents.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>

      {(filter.search || filter.clientId || filter.projectId || filter.agent) && (
        <button
          onClick={() => onChange({ search: '', clientId: '', projectId: '', agent: '' })}
          className="text-[10px] text-slate-500 hover:text-slate-300 font-mono transition-colors px-1.5 py-1 rounded border border-white/[0.06] hover:border-white/[0.12]"
        >
          ✕ clear
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// TaskCard
// ---------------------------------------------------------------------------

function TaskCard({ task }: { task: Task }) {
  const [expanded, setExpanded] = useState(false)

  const col = COLUMNS.find((c) => c.status === task.status)

  const clientName  = getMeta(task, 'client_name')
  const projectName = getMeta(task, 'project_name')
  const projectType = getMeta(task, 'project_type')
  const clientColor = clientName ? getClientColor(clientName) : null
  const errorMsg    = getMeta(task, 'error')
  const isChild     = Boolean(task.parent_task_id)

  const assignee  = task.assignee_agent_id ?? ''
  const delegator = task.delegator_agent_id ?? ''
  // Show routing chain: delegator → assignee, or just one of them
  const agentLine =
    delegator && assignee && delegator !== assignee
      ? `${delegator} → ${assignee}`
      : assignee || delegator || '—'

  const shortId = task.id.slice(0, 8)

  const descPreview = !clientName && task.description
    ? task.description.replace(/\[WORKSPACE CONTEXT.*$/s, '').trim().slice(0, 100)
    : ''

  return (
    <div
      className={clsx(
        'border-l-2 rounded-r-xl transition-all',
        'px-3 pt-3 pb-2.5 space-y-2',
        col?.border ?? 'border-l-slate-700',
        task.status === 'blocked'
          ? 'bg-orange-950/20 hover:bg-orange-950/30'
          : task.status === 'in_progress'
            ? 'bg-sky-950/20 hover:bg-sky-950/30'
            : 'bg-white/[0.03] hover:bg-white/[0.05]',
        'cursor-pointer select-none'
      )}
      onClick={() => setExpanded((v) => !v)}
    >
      {/* Client / Project chip */}
      {(clientName || projectName) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {clientName && clientColor && (
            <span
              className={clsx(
                'text-[10px] font-mono px-1.5 py-0.5 rounded border',
                clientColor.bg, clientColor.border, clientColor.text
              )}
            >
              {clientName}
            </span>
          )}
          {projectName && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/40 text-cyan-300">
              {projectType ? `${projectName} · ${projectType}` : projectName}
            </span>
          )}
          {isChild && (
            <span className="text-[9px] font-mono text-slate-600 border border-slate-700/50 rounded px-1 py-0.5">sub</span>
          )}
        </div>
      )}

      {/* Title */}
      <p className={clsx(
        'text-sm font-medium text-slate-200 leading-snug',
        expanded ? '' : 'line-clamp-2'
      )}>
        {task.title}
      </p>

      {/* Description preview — collapsed only, no-client tasks */}
      {!clientName && !expanded && descPreview && (
        <p className="text-[11px] text-slate-500 font-mono leading-relaxed line-clamp-2">
          {descPreview}{descPreview.length >= 100 ? '…' : ''}
        </p>
      )}

      {/* Blocked error */}
      {task.status === 'blocked' && errorMsg && (
        <p className={clsx(
          'text-[10px] text-orange-400 font-mono leading-relaxed',
          expanded ? 'whitespace-pre-wrap break-words' : 'line-clamp-2'
        )}>
          ⚠ {errorMsg}
        </p>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="pt-1 space-y-1.5 border-t border-white/[0.06]">
          {task.description && (
            <p className="text-[10px] text-slate-500 font-mono leading-relaxed whitespace-pre-wrap break-words">
              {task.description.replace(/\[WORKSPACE CONTEXT.*$/s, '').trim()}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[9px] font-mono text-slate-600 bg-white/[0.03] border border-white/[0.06] rounded px-1.5 py-0.5">
              id: {shortId}
            </span>
            {task.parent_task_id && (
              <span className="text-[9px] font-mono text-slate-600 bg-white/[0.03] border border-white/[0.06] rounded px-1.5 py-0.5">
                parent: {task.parent_task_id.slice(0, 8)}
              </span>
            )}
          </div>
          {task.status === 'blocked' && (
            <p className="text-[9px] font-mono text-slate-600">
              💡 /reject {shortId} to mark resolved
            </p>
          )}
          {task.status === 'in_progress' && (
            <p className="text-[9px] font-mono text-slate-600">
              💡 /approve {shortId} · /reject {shortId}
            </p>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-white/[0.04]">
        <div className="flex items-center gap-1.5 min-w-0">
          <Badge variant={task.type} className="flex-shrink-0">{task.type.replace(/_/g, ' ')}</Badge>
          <span className="text-[10px] font-mono text-slate-600 truncate" title={agentLine}>
            {agentLine}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-1">
          <Badge variant={`p${task.priority}`} className="flex-shrink-0">P{task.priority}</Badge>
          <span className="text-[10px] text-slate-700 font-mono">
            {formatDistanceToNow(new Date(task.created_at), { addSuffix: true })}
          </span>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Column
// ---------------------------------------------------------------------------

function Column({ config, tasks, isDone }: { config: ColConfig; tasks: Task[]; isDone?: boolean }) {
  const displayTasks = isDone ? tasks.slice(0, DONE_LIMIT) : tasks
  const hidden = isDone ? tasks.length - DONE_LIMIT : 0

  return (
    <div className="flex flex-col min-w-0">
      {/* Column header */}
      <div className={clsx('flex items-center justify-between px-1 py-3 border-t-2', config.borderT)}>
        <span className={clsx('text-xs font-bold uppercase tracking-wider', config.accent)}>
          {config.label}
        </span>
        <span className={clsx(
          'text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md',
          tasks.length > 0
            ? `${config.accent} bg-white/[0.05]`
            : 'text-slate-700 bg-white/[0.02]'
        )}>
          {tasks.length}
        </span>
      </div>

      {/* Cards */}
      <div className="space-y-2 mt-1 flex-1 overflow-y-auto max-h-[calc(100vh-300px)] pr-0.5">
        {displayTasks.length === 0 ? (
          <div className="flex items-center justify-center h-20 border border-dashed border-white/[0.06] rounded-xl">
            <span className="text-xs text-slate-700">Empty</span>
          </div>
        ) : (
          <>
            {displayTasks.map((t) => <TaskCard key={t.id} task={t} />)}
            {hidden > 0 && (
              <div className="text-center py-2">
                <span className="text-[10px] font-mono text-slate-600">
                  +{hidden} older task{hidden > 1 ? 's' : ''} hidden
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function TaskBoard() {
  const { data: tasks, loading, error } = useTasks()
  const { data: clients } = useClients()
  const { data: projects } = useProjects()

  const [filter, setFilter] = useState<FilterState>({
    search: '', clientId: '', projectId: '', agent: '',
  })

  // Unique agents present in tasks (assignee or delegator)
  const agentOptions = useMemo(() => {
    const s = new Set<string>()
    for (const t of tasks) {
      if (t.assignee_agent_id) s.add(t.assignee_agent_id)
      if (t.delegator_agent_id) s.add(t.delegator_agent_id)
    }
    return Array.from(s).sort()
  }, [tasks])

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (t.status === 'cancelled') return false

      if (filter.search) {
        const q = filter.search.toLowerCase()
        const clientName  = getMeta(t, 'client_name').toLowerCase()
        const projectName = getMeta(t, 'project_name').toLowerCase()
        if (
          !t.title.toLowerCase().includes(q) &&
          !clientName.includes(q) &&
          !projectName.includes(q)
        ) return false
      }

      if (filter.clientId) {
        const clientName = clients.find((c) => c.id === filter.clientId)?.name ?? ''
        if (getMeta(t, 'client_name').toLowerCase() !== clientName.toLowerCase()) return false
      }

      if (filter.projectId) {
        const project = projects.find((p) => p.id === filter.projectId)
        if (!project) return false
        if (t.project_id !== project.id && getMeta(t, 'project_name').toLowerCase() !== project.name.toLowerCase()) return false
      }

      if (filter.agent) {
        if (t.assignee_agent_id !== filter.agent && t.delegator_agent_id !== filter.agent) return false
      }

      return true
    })
  }, [tasks, filter, clients, projects])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-5 h-5 border-2 border-[#00D4FF]/30 border-t-[#00D4FF] rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <Panel className="border-rose-500/20">
        <p className="text-rose-400 text-sm">Error: {error}</p>
      </Panel>
    )
  }

  const grouped = filtered.reduce<Record<TaskStatus, Task[]>>(
    (acc, t) => {
      acc[t.status] = [...(acc[t.status] ?? []), t]
      return acc
    },
    { todo: [], in_progress: [], done: [], blocked: [], cancelled: [] }
  )

  const totalActive = filtered.filter((t) => t.status !== 'done').length
  const isFiltering = Boolean(filter.search || filter.clientId || filter.projectId || filter.agent)

  return (
    <div className="animate-fade-in space-y-4">
      {/* Summary bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          {COLUMNS.map((col) => {
            const count = grouped[col.status].length
            return (
              <div key={col.status} className="flex items-center gap-1.5">
                <span className={clsx('text-xl font-bold font-tabular', col.accent)}>{count}</span>
                <span className="text-xs text-slate-600 capitalize">{col.label}</span>
              </div>
            )
          })}
        </div>
        <span className="text-xs text-slate-500 font-mono">
          {totalActive} active{isFiltering ? ` (filtered from ${tasks.filter((t) => t.status !== 'cancelled').length})` : ''}
        </span>
      </div>

      {/* Filter bar */}
      <FilterBar
        filter={filter}
        onChange={setFilter}
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
        projects={projects.map((p) => ({ id: p.id, name: p.name, client_id: p.client_id }))}
        agents={agentOptions}
      />

      {/* Board */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {COLUMNS.map((col) => (
          <Column
            key={col.status}
            config={col}
            tasks={grouped[col.status] ?? []}
            isDone={col.status === 'done'}
          />
        ))}
      </div>
    </div>
  )
}
