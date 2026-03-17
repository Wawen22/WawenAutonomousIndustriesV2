import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import { Panel } from './ui/Panel.js'
import { Badge } from './ui/Badge.js'
import { useTasks } from '../hooks/useSupabaseRealtime.js'
import type { Task, TaskStatus } from '../types/index.js'

// ---------------------------------------------------------------------------
// Column config
// ---------------------------------------------------------------------------

interface ColConfig {
  status: TaskStatus
  label: string
  accent: string     // text color for count + border-t
  border: string     // left border on card
}

const COLUMNS: ColConfig[] = [
  { status: 'todo',        label: 'Todo',        accent: 'text-slate-400',   border: 'border-l-slate-700'  },
  { status: 'in_progress', label: 'In Progress', accent: 'text-sky-400',     border: 'border-l-sky-500'    },
  { status: 'blocked',     label: 'Blocked',     accent: 'text-orange-400',  border: 'border-l-orange-500' },
  { status: 'done',        label: 'Done',        accent: 'text-emerald-400', border: 'border-l-emerald-500' },
]

// ---------------------------------------------------------------------------
// TaskCard
// ---------------------------------------------------------------------------

function TaskCard({ task }: { task: Task }) {
  const col = COLUMNS.find((c) => c.status === task.status)
  return (
    <div
      className={clsx(
        'border-l-2 rounded-r-xl bg-white/[0.03] hover:bg-white/[0.06] transition-colors',
        'px-3 pt-3 pb-2.5 space-y-2',
        col?.border ?? 'border-l-slate-700'
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-200 leading-snug flex-1 line-clamp-3">
          {task.title}
        </p>
        <Badge variant={`p${task.priority}`} className="flex-shrink-0 mt-0.5">
          P{task.priority}
        </Badge>
      </div>

      {/* Type badge */}
      <Badge variant={task.type}>{task.type.replace(/_/g, ' ')}</Badge>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-white/[0.05]">
        <span className="text-[11px] font-mono text-slate-600 truncate">
          {task.assignee_agent_id ?? task.delegator_agent_id ?? '—'}
        </span>
        <span className="text-[11px] text-slate-700 font-mono flex-shrink-0">
          {formatDistanceToNow(new Date(task.created_at), { addSuffix: true })}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Column
// ---------------------------------------------------------------------------

function Column({ config, tasks }: { config: ColConfig; tasks: Task[] }) {
  return (
    <div className="flex flex-col min-w-0">
      {/* Column header */}
      <div
        className={clsx(
          'flex items-center justify-between px-1 py-3 border-t-2',
          config.status === 'todo'        && 'border-t-slate-700',
          config.status === 'in_progress' && 'border-t-sky-500',
          config.status === 'blocked'     && 'border-t-orange-500',
          config.status === 'done'        && 'border-t-emerald-500',
        )}
      >
        <span className={clsx('text-xs font-bold uppercase tracking-wider', config.accent)}>
          {config.label}
        </span>
        <span
          className={clsx(
            'text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md',
            tasks.length > 0
              ? `${config.accent} bg-white/[0.05]`
              : 'text-slate-700 bg-white/[0.02]'
          )}
        >
          {tasks.length}
        </span>
      </div>

      {/* Cards */}
      <div className="space-y-2 mt-1 flex-1 overflow-y-auto max-h-[calc(100vh-260px)] pr-0.5">
        {tasks.length === 0 ? (
          <div className="flex items-center justify-center h-20 border border-dashed border-white/[0.06] rounded-xl">
            <span className="text-xs text-slate-700">Empty</span>
          </div>
        ) : (
          tasks.map((t) => <TaskCard key={t.id} task={t} />)
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

  const grouped = tasks.reduce<Record<TaskStatus, Task[]>>(
    (acc, t) => {
      if (t.status !== 'cancelled') {
        acc[t.status] = [...(acc[t.status] ?? []), t]
      }
      return acc
    },
    { todo: [], in_progress: [], done: [], blocked: [], cancelled: [] }
  )

  const totalActive = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length

  return (
    <div className="animate-fade-in space-y-4">
      {/* Summary */}
      <div className="flex items-center justify-between">
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
        <span className="text-xs text-slate-500 font-mono">{totalActive} active</span>
      </div>

      {/* Board */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {COLUMNS.map((col) => (
          <Column key={col.status} config={col} tasks={grouped[col.status] ?? []} />
        ))}
      </div>
    </div>
  )
}
