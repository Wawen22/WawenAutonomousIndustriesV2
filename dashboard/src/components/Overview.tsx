// ============================================================
// WAI Dashboard – Overview (Mission Control)
// Risponde a: "Cosa sta succedendo ADESSO nel sistema?"
// ============================================================

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
  offline: 'bg-slate-700',
  error:   'bg-rose-400',
}

const SEV_BAR: Record<string, string> = {
  info:     'bg-sky-500/60',
  warning:  'bg-amber-500/60',
  error:    'bg-rose-500/60',
  critical: 'bg-rose-400',
}

const TASK_STATUS_ACCENT: Record<TaskStatus, string> = {
  todo:        'border-l-slate-600',
  in_progress: 'border-l-sky-500',
  done:        'border-l-emerald-500',
  blocked:     'border-l-orange-500',
  cancelled:   'border-l-slate-800',
}

const TEAM_ORDER = ['executive', 'saas', 'dev', 'consulting', 'marketing', 'ops']
const TEAM_ACCENT: Record<string, string> = {
  executive:  'text-[#00D4FF]',
  saas:       'text-violet-400',
  dev:        'text-sky-400',
  consulting: 'text-teal-400',
  marketing:  'text-pink-400',
  ops:        'text-slate-400',
}

// ---------------------------------------------------------------------------
// Mission Banner
// ---------------------------------------------------------------------------

function MissionBanner({
  phase,
  milestone,
  onlineCount,
  agentTotal,
}: {
  phase: string
  milestone: string
  onlineCount: number
  agentTotal: number
}) {
  const isOperational = onlineCount > 0

  return (
    <div className="relative rounded-xl overflow-hidden border border-white/[0.07]">
      {/* Background */}
      <div
        className="absolute inset-0"
        style={{
          background: [
            'linear-gradient(135deg, rgba(0,212,255,0.06) 0%, transparent 50%)',
            'linear-gradient(to right, #07101F, #0A1628)',
          ].join(', '),
        }}
      />
      {/* Scanline texture */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, white 3px, white 4px)',
        }}
      />

      <div className="relative flex items-center justify-between px-6 py-5">
        {/* Left: brand + phase */}
        <div className="flex items-center gap-5">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">WAI</span>
              <span className="text-slate-700">·</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">Zero Human Company</span>
            </div>
            <p className="text-lg font-bold text-white tracking-tight leading-none">
              {milestone || 'WAI System'}
            </p>
            <p className="text-xs text-slate-500 mt-1 font-mono">{phase || 'development'}</p>
          </div>
        </div>

        {/* Right: status indicator */}
        <div className="flex flex-col items-end gap-2">
          <div className={clsx(
            'flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold uppercase tracking-wider',
            isOperational
              ? 'border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-400'
              : 'border-slate-600/30 bg-slate-800/50 text-slate-500'
          )}>
            <span className={clsx(
              'w-1.5 h-1.5 rounded-full',
              isOperational ? 'bg-emerald-400 animate-pulse-slow' : 'bg-slate-600'
            )} />
            {isOperational ? 'Operational' : 'Offline'}
          </div>
          <span className="text-[11px] text-slate-600 font-mono">
            {onlineCount}/{agentTotal} agents active
          </span>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Active Task card
// ---------------------------------------------------------------------------

function ActiveTaskCard({ task }: { task: Task }) {
  return (
    <div className={clsx(
      'border-l-2 pl-3 py-2.5 pr-3 rounded-r-lg',
      'bg-white/[0.02] hover:bg-white/[0.04] transition-colors',
      TASK_STATUS_ACCENT[task.status]
    )}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-slate-200 font-medium leading-snug line-clamp-2 flex-1">
          {task.title}
        </p>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Badge variant={`p${task.priority}`}>P{task.priority}</Badge>
          <Badge variant={task.type}>{task.type}</Badge>
        </div>
      </div>
      {task.assignee_agent_id && (
        <div className="flex items-center gap-1.5 mt-2">
          <span className="w-1 h-1 rounded-full bg-sky-400 flex-shrink-0" />
          <span className="text-[11px] text-sky-400/80 font-mono">{task.assignee_agent_id}</span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Event feed row
// ---------------------------------------------------------------------------

function EventFeedRow({ event }: { event: SystemEvent }) {
  const bar = SEV_BAR[event.severity] ?? SEV_BAR['info']

  return (
    <div className="flex items-start gap-3 py-2 border-b border-white/[0.04] last:border-0">
      {/* Severity bar */}
      <div className={clsx('w-0.5 self-stretch rounded-full flex-shrink-0 mt-0.5', bar)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-slate-300 font-medium truncate">
            {event.type.replace(/_/g, ' ')}
          </span>
          <span className="text-[10px] text-slate-600 font-mono flex-shrink-0 whitespace-nowrap">
            {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
          </span>
        </div>
        {event.agent_id && (
          <p className="text-[11px] text-slate-600 font-mono mt-0.5">{event.agent_id}</p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Agent matrix — compact dots per team
// ---------------------------------------------------------------------------

function AgentMatrixRow({ team, agents }: { team: string; agents: Agent[] }) {
  const accent = TEAM_ACCENT[team] ?? 'text-slate-400'

  return (
    <div className="flex items-center gap-3">
      <span className={clsx('text-[10px] font-bold uppercase tracking-[0.16em] w-20 flex-shrink-0', accent)}>
        {team}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {agents.map((a) => (
          <div
            key={a.id}
            title={`${a.name} — ${a.status}`}
            className="flex items-center gap-1.5 cursor-default"
          >
            <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', STATUS_DOT[a.status])} />
            <span className="text-[11px] text-slate-500 font-mono">{a.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function Overview() {
  const { data: agents, loading: aLoad } = useAgents()
  const { data: tasks,  loading: tLoad } = useTasks()
  const { data: events, loading: eLoad } = useEvents(30)
  const { state,        loading: sLoad } = useProjectState()
  const { data: runs                    } = useRecentRuns(50)

  const loading = aLoad || tLoad || eLoad || sLoad

  // Derived
  const onlineCount     = agents.filter((a) => a.status === 'online').length
  const activeTasks     = tasks.filter((t) => t.status === 'in_progress')
  const todoCount       = tasks.filter((t) => t.status === 'todo').length
  const doneCount       = tasks.filter((t) => t.status === 'done').length
  const budgetPct       = state ? (state.monthly_cost_usd / state.monthly_budget_usd) * 100 : 0
  const successRate     = runs.length > 0
    ? Math.round((runs.filter((r) => r.outcome === 'success').length / runs.length) * 100)
    : 100

  // Agent matrix
  const byTeam = agents.reduce<Record<string, Agent[]>>((acc, a) => {
    acc[a.team] = [...(acc[a.team] ?? []), a]
    return acc
  }, {})

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-[#00D4FF]/30 border-t-[#00D4FF] rounded-full animate-spin" />
          <p className="text-xs text-slate-600 font-mono uppercase tracking-widest">Connecting...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 animate-fade-in">

      {/* ── Mission Banner ── */}
      <MissionBanner
        phase={state?.phase ?? 'development'}
        milestone={state?.current_milestone ?? 'WAI System'}
        onlineCount={onlineCount}
        agentTotal={agents.length}
      />

      {/* ── KPI row ── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Stat
          label="Agents Online"
          value={onlineCount}
          sub={`${agents.length} total registered`}
          color="emerald"
          icon={<span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-slow inline-block" />}
        />
        <Stat
          label="Active Tasks"
          value={activeTasks.length}
          sub={`${todoCount} queued · ${doneCount} done`}
          color="sky"
        />
        <Stat
          label="Monthly Spend"
          value={`$${(state?.monthly_cost_usd ?? 0).toFixed(2)}`}
          sub={`${budgetPct.toFixed(0)}% of $${state?.monthly_budget_usd ?? 500} budget`}
          color={budgetPct >= 80 ? 'amber' : budgetPct >= 50 ? 'cyan' : 'emerald'}
        />
        <Stat
          label="Run Success"
          value={`${successRate}%`}
          sub={`${runs.length} runs tracked`}
          color={successRate < 90 ? 'amber' : 'emerald'}
        />
      </div>

      {/* ── Main two-col ── */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">

        {/* Active Work — 3/5 */}
        <Panel
          title="Active Work"
          accent="sky"
          className="xl:col-span-3"
          headerRight={
            <span className="text-[11px] font-mono text-sky-400/70">
              {activeTasks.length} in progress
            </span>
          }
        >
          {activeTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <span className="w-8 h-8 rounded-full bg-white/[0.04] flex items-center justify-center">
                <span className="w-2 h-2 rounded-full bg-slate-700" />
              </span>
              <p className="text-sm text-slate-600">System idle — no active tasks</p>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-80 overflow-y-auto">
              {activeTasks.map((t) => <ActiveTaskCard key={t.id} task={t} />)}
            </div>
          )}
        </Panel>

        {/* Live Feed — 2/5 */}
        <Panel
          title="Live Feed"
          accent="emerald"
          className="xl:col-span-2"
          noPad
          headerRight={
            <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono uppercase tracking-widest">
              <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse-slow" />
              live
            </span>
          }
        >
          <div className="px-4 py-2 max-h-[22rem] overflow-y-auto">
            {events.length === 0 ? (
              <p className="text-sm text-slate-600 text-center py-8">No events yet</p>
            ) : (
              events.slice(0, 20).map((e) => <EventFeedRow key={e.id} event={e} />)
            )}
          </div>
        </Panel>
      </div>

      {/* ── Agent Matrix ── */}
      <Panel
        title="Agent Fleet"
        accent="none"
        headerRight={
          <span className="text-[11px] text-slate-600 font-mono">
            {onlineCount}/{agents.length} online
          </span>
        }
      >
        <div className="space-y-3">
          {TEAM_ORDER.filter((t) => byTeam[t]?.length).map((team) => (
            <AgentMatrixRow key={team} team={team} agents={byTeam[team] ?? []} />
          ))}
        </div>
      </Panel>
    </div>
  )
}
