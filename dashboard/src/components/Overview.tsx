import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import { Stat } from './ui/Stat.js'
import { Badge } from './ui/Badge.js'
import { Panel } from './ui/Panel.js'
import {
  useAgents,
  useEvents,
  useTasks,
  useProjectState,
  useRecentRuns,
} from '../hooks/useSupabaseRealtime.js'
import type { Agent, AgentStatus, Task, TaskStatus, SystemEvent } from '../types/index.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_DOT: Record<AgentStatus, string> = {
  online:  'bg-emerald-400',
  busy:    'bg-amber-400',
  offline: 'bg-slate-600',
  error:   'bg-rose-400',
}

const TASK_BORDER: Record<TaskStatus, string> = {
  todo:        'border-l-slate-600',
  in_progress: 'border-l-sky-500',
  done:        'border-l-emerald-500',
  blocked:     'border-l-orange-500',
  cancelled:   'border-l-slate-700',
}

const SEV_DOT: Record<string, string> = {
  info:     'bg-sky-400',
  warning:  'bg-amber-400',
  error:    'bg-rose-400',
  critical: 'bg-rose-500',
}

const TEAM_ORDER = ['executive', 'saas', 'dev', 'consulting', 'marketing', 'ops']
const TEAM_LABELS: Record<string, string> = {
  executive: 'Executive',
  saas:      'SaaS',
  dev:       'Dev',
  consulting:'Consulting',
  marketing: 'Marketing',
  ops:       'Ops',
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AgentChip({ agent }: { agent: Agent }) {
  return (
    <div
      className={clsx(
        'flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-white/[0.07] bg-white/[0.03]',
        'hover:bg-white/[0.06] transition-colors cursor-default'
      )}
      title={`${agent.role} — ${agent.model_id}`}
    >
      <span
        className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', STATUS_DOT[agent.status])}
      />
      <span className="text-xs text-slate-300 font-medium whitespace-nowrap">{agent.name}</span>
    </div>
  )
}

function CompactTaskCard({ task }: { task: Task }) {
  return (
    <div
      className={clsx(
        'border-l-2 pl-3 py-2 pr-3 rounded-r-lg bg-white/[0.03] hover:bg-white/[0.055] transition-colors',
        TASK_BORDER[task.status] ?? 'border-l-slate-700'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-slate-200 font-medium leading-snug line-clamp-2 flex-1">
          {task.title}
        </p>
        <Badge variant={`p${task.priority}`} className="flex-shrink-0 mt-0.5">
          P{task.priority}
        </Badge>
      </div>
      {task.assignee_agent_id && (
        <p className="text-[11px] text-slate-500 mt-1 font-mono">{task.assignee_agent_id}</p>
      )}
    </div>
  )
}

function EventRow({ event }: { event: SystemEvent }) {
  const dot = SEV_DOT[event.severity] ?? SEV_DOT['info']
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-white/[0.04] last:border-0 animate-slide-up">
      <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5', dot)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm text-slate-300 font-medium truncate">{event.type.replace(/_/g, ' ')}</span>
          <span className="text-[11px] text-slate-600 flex-shrink-0 font-mono">
            {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
          </span>
        </div>
        {event.agent_id && (
          <p className="text-[11px] text-slate-500 font-mono mt-0.5">{event.agent_id}</p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// KANBAN COLUMN (compact, for Overview)
// ---------------------------------------------------------------------------

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo',        label: 'Todo'     },
  { status: 'in_progress', label: 'In Prog.' },
  { status: 'blocked',     label: 'Blocked'  },
  { status: 'done',        label: 'Done'     },
]

const COL_ACCENT: Record<TaskStatus, string> = {
  todo:        'text-slate-400 border-t-slate-600',
  in_progress: 'text-sky-400  border-t-sky-500',
  done:        'text-emerald-400 border-t-emerald-500',
  blocked:     'text-orange-400 border-t-orange-500',
  cancelled:   'text-slate-500 border-t-slate-700',
}

// ---------------------------------------------------------------------------
// Main Overview
// ---------------------------------------------------------------------------

export function Overview() {
  const { data: agents,  loading: aLoad  } = useAgents()
  const { data: tasks,   loading: tLoad  } = useTasks()
  const { data: events,  loading: eLoad  } = useEvents(25)
  const { state,         loading: sLoad  } = useProjectState()
  const { data: runs                      } = useRecentRuns(50)

  const loading = aLoad || tLoad || eLoad || sLoad

  // Derived stats
  const onlineCount    = agents.filter((a) => a.status === 'online').length
  const activeTaskCount = tasks.filter((t) => t.status === 'in_progress').length
  const budgetPct      = state ? (state.monthly_cost_usd / state.monthly_budget_usd) * 100 : 0
  const successRate    = runs.length > 0
    ? Math.round((runs.filter((r) => r.outcome === 'success').length / runs.length) * 100)
    : 100

  // Group tasks
  const byStatus = tasks.reduce<Record<TaskStatus, Task[]>>(
    (acc, t) => {
      if (t.status !== 'cancelled') {
        acc[t.status] = [...(acc[t.status] ?? []), t]
      }
      return acc
    },
    { todo: [], in_progress: [], done: [], blocked: [], cancelled: [] }
  )

  // Group agents by team (ordered)
  const byTeam = agents.reduce<Record<string, Agent[]>>((acc, a) => {
    acc[a.team] = [...(acc[a.team] ?? []), a]
    return acc
  }, {})

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-[#00D4FF]/30 border-t-[#00D4FF] rounded-full animate-spin" />
          <p className="text-sm text-slate-500">Loading system state...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in">

      {/* ── KPI row ── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat
          label="Agents Online"
          value={onlineCount}
          sub={`${agents.length} total`}
          color="emerald"
          icon={
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-slow inline-block" />
          }
        />
        <Stat
          label="Active Tasks"
          value={activeTaskCount}
          sub={`${tasks.length} total`}
          color="sky"
        />
        <Stat
          label="Monthly Spend"
          value={`$${(state?.monthly_cost_usd ?? 0).toFixed(2)}`}
          sub={`${budgetPct.toFixed(0)}% of $${state?.monthly_budget_usd ?? 500}`}
          color={budgetPct >= 80 ? 'amber' : budgetPct >= 50 ? 'sky' : 'emerald'}
        />
        <Stat
          label="Success Rate"
          value={`${successRate}%`}
          sub={`last ${runs.length} runs`}
          color={successRate < 90 ? 'amber' : 'emerald'}
        />
      </div>

      {/* ── Main 2-col ── */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">

        {/* Task kanban (3/5) */}
        <Panel title="Task Board" className="xl:col-span-3" noPad>
          <div className="grid grid-cols-4 divide-x divide-white/[0.06]">
            {COLUMNS.map((col) => {
              const colTasks = byStatus[col.status] ?? []
              return (
                <div key={col.status} className={clsx('border-t-2 pt-0', COL_ACCENT[col.status])}>
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <span className={clsx('text-xs font-semibold', COL_ACCENT[col.status].split(' ')[0])}>
                      {col.label}
                    </span>
                    <span className="text-[11px] text-slate-600 font-mono bg-white/[0.04] rounded px-1.5 py-0.5">
                      {colTasks.length}
                    </span>
                  </div>
                  <div className="px-2 pb-3 space-y-1.5 max-h-72 overflow-y-auto">
                    {colTasks.length === 0 ? (
                      <p className="text-[11px] text-slate-700 text-center py-3">—</p>
                    ) : (
                      colTasks.map((t) => <CompactTaskCard key={t.id} task={t} />)
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>

        {/* Activity feed (2/5) */}
        <Panel
          title="Activity"
          className="xl:col-span-2"
          noPad
          headerRight={
            <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono uppercase tracking-wider">
              <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse-slow inline-block" />
              live
            </span>
          }
        >
          <div className="px-4 py-1 max-h-80 overflow-y-auto">
            {events.length === 0 ? (
              <p className="text-sm text-slate-600 text-center py-8">No activity yet</p>
            ) : (
              events.slice(0, 20).map((e) => <EventRow key={e.id} event={e} />)
            )}
          </div>
        </Panel>
      </div>

      {/* ── Agent grid ── */}
      <Panel title="Agent Fleet" headerRight={
        <span className="text-[11px] text-slate-500 font-mono">
          {onlineCount}/{agents.length} online
        </span>
      }>
        <div className="space-y-4">
          {TEAM_ORDER.filter((t) => byTeam[t]?.length).map((team) => (
            <div key={team}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600 mb-2">
                {TEAM_LABELS[team] ?? team}
              </p>
              <div className="flex flex-wrap gap-2">
                {(byTeam[team] ?? []).map((a) => (
                  <AgentChip key={a.id} agent={a} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}
