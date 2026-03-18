// ============================================================
// WAI Dashboard – Team Org View (T064)
// Hierarchical org chart: Neb → CEO → Teams → Agents
// ============================================================

import { useState } from 'react'
import { clsx } from 'clsx'
import { useAgents } from '../hooks/useSupabaseRealtime.js'
import { useAgentStats } from '../hooks/useSupabaseRealtime.js'
import { useTasks } from '../hooks/useSupabaseRealtime.js'
import type { Agent, AgentStatus, AgentTeam, AgentRun, Task } from '../types/index.js'

// ---------------------------------------------------------------------------
// Static team config
// ---------------------------------------------------------------------------

const TEAM_ORDER: AgentTeam[] = ['executive', 'saas', 'dev', 'consulting', 'marketing', 'ops']

const TEAM_META: Record<AgentTeam, { label: string; color: string; glow: string; border: string; bg: string }> = {
  executive:  { label: 'Executive',       color: 'text-[#00D4FF]',   glow: 'shadow-[0_0_16px_rgba(0,212,255,0.25)]',   border: 'border-[#00D4FF]/30',   bg: 'bg-[#00D4FF]/[0.05]'  },
  saas:       { label: 'SaaS',            color: 'text-violet-400',  glow: 'shadow-[0_0_16px_rgba(167,139,250,0.25)]', border: 'border-violet-400/30',  bg: 'bg-violet-400/[0.05]' },
  dev:        { label: 'Custom Software', color: 'text-emerald-400', glow: 'shadow-[0_0_16px_rgba(52,211,153,0.25)]',  border: 'border-emerald-400/30', bg: 'bg-emerald-400/[0.05]'},
  consulting: { label: 'Consulting',      color: 'text-cyan-400',    glow: 'shadow-[0_0_16px_rgba(34,211,238,0.25)]',  border: 'border-cyan-400/30',    bg: 'bg-cyan-400/[0.05]'   },
  marketing:  { label: 'Marketing',       color: 'text-amber-400',   glow: 'shadow-[0_0_16px_rgba(251,191,36,0.25)]',  border: 'border-amber-400/30',   bg: 'bg-amber-400/[0.05]'  },
  ops:        { label: 'Ops/Finance/HR',  color: 'text-slate-400',   glow: '',                                          border: 'border-slate-400/30',   bg: 'bg-slate-400/[0.05]'  },
}

const MODEL_COLOR: Record<string, { text: string; bg: string }> = {
  'gpt-5.4':          { text: 'text-[#00D4FF]',  bg: 'bg-[#00D4FF]/[0.08]'  },
  'gemini-2.5-flash': { text: 'text-violet-400', bg: 'bg-violet-400/[0.08]' },
}

const STATUS_DOT: Record<AgentStatus, string> = {
  online:  'bg-emerald-400 animate-pulse',
  busy:    'bg-amber-400 animate-pulse',
  offline: 'bg-slate-600',
  error:   'bg-rose-400 animate-pulse',
}

// ---------------------------------------------------------------------------
// Avatar: initials + color from model
// ---------------------------------------------------------------------------

function AgentAvatar({ agent, size = 'md' }: { agent: Agent; size?: 'sm' | 'md' | 'lg' }) {
  const initials = agent.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

  const modelStyle = MODEL_COLOR[agent.model_id] ?? { text: 'text-slate-400', bg: 'bg-slate-400/10' }
  const sizeClass = size === 'sm' ? 'w-8 h-8 text-[10px]' : size === 'lg' ? 'w-14 h-14 text-base' : 'w-10 h-10 text-xs'

  return (
    <div
      className={clsx(
        'rounded-lg flex items-center justify-center font-bold flex-shrink-0 border',
        sizeClass,
        modelStyle.bg,
        modelStyle.text,
        agent.model_id === 'gpt-5.4' ? 'border-[#00D4FF]/20' : 'border-violet-400/20'
      )}
    >
      {initials}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Neb founder node
// ---------------------------------------------------------------------------

function NebNode() {
  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        {/* Glow ring */}
        <div className="absolute inset-0 rounded-2xl bg-amber-400/10 blur-xl scale-150 pointer-events-none" />
        <div className={clsx(
          'relative rounded-2xl border-2 border-amber-400/40 bg-amber-400/[0.06] px-6 py-4',
          'shadow-[0_0_24px_rgba(251,191,36,0.2)]',
          'flex flex-col items-center gap-2 min-w-[140px]',
        )}>
          {/* Avatar */}
          <div className="w-14 h-14 rounded-xl bg-amber-400/[0.12] border border-amber-400/30 flex items-center justify-center text-xl font-black text-amber-400">
            N
          </div>
          <div className="text-center">
            <p className="text-sm font-bold text-white">Neb</p>
            <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[9px] font-bold tracking-widest bg-amber-400/20 text-amber-400 border border-amber-400/30 uppercase">
              Founder
            </span>
          </div>
        </div>
      </div>
      {/* Connector down */}
      <div className="w-px h-6 bg-gradient-to-b from-amber-400/40 to-[#00D4FF]/40" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// CEO node
// ---------------------------------------------------------------------------

function CeoNode({ agent, onClick }: { agent: Agent | undefined; onClick: (a: Agent) => void }) {
  if (!agent) return null
  const status = agent.status
  return (
    <div className="flex flex-col items-center">
      <button
        onClick={() => onClick(agent)}
        className={clsx(
          'group relative rounded-xl border-2 px-5 py-3 transition-all duration-200 cursor-pointer',
          'border-[#00D4FF]/30 bg-[#00D4FF]/[0.05]',
          'hover:border-[#00D4FF]/60 hover:bg-[#00D4FF]/[0.10]',
          'shadow-[0_0_16px_rgba(0,212,255,0.15)] hover:shadow-[0_0_24px_rgba(0,212,255,0.3)]',
          'flex flex-col items-center gap-2 min-w-[130px]',
        )}
      >
        <AgentAvatar agent={agent} size="lg" />
        <div className="text-center">
          <div className="flex items-center gap-1.5 justify-center">
            <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', STATUS_DOT[status])} />
            <p className="text-sm font-semibold text-white">{agent.name}</p>
          </div>
          <p className="text-[10px] text-[#00D4FF] font-mono mt-0.5">Executive</p>
        </div>
      </button>
      {/* Connector down */}
      <div className="w-px h-6 bg-[#00D4FF]/30" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Agent mini card (inside team)
// ---------------------------------------------------------------------------

function AgentMiniCard({
  agent,
  runCount,
  onClick,
  teamMeta,
}: {
  agent: Agent
  runCount: number
  onClick: (a: Agent) => void
  teamMeta: (typeof TEAM_META)[AgentTeam]
}) {
  const status = agent.status
  const modelStyle = MODEL_COLOR[agent.model_id] ?? { text: 'text-slate-400', bg: 'bg-slate-400/10' }

  return (
    <button
      onClick={() => onClick(agent)}
      className={clsx(
        'group w-full text-left rounded-xl border p-3 transition-all duration-200 cursor-pointer',
        teamMeta.border,
        teamMeta.bg,
        'hover:brightness-125',
        teamMeta.glow ? `hover:${teamMeta.glow}` : 'hover:shadow-md',
      )}
    >
      <div className="flex items-start gap-2.5">
        <AgentAvatar agent={agent} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', STATUS_DOT[status])} />
            <p className="text-[11px] font-semibold text-white truncate">{agent.name}</p>
          </div>
          <p className="text-[10px] text-slate-500 truncate leading-relaxed">{agent.role.split(',')[0]}</p>
        </div>
      </div>
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/[0.05]">
        <span className={clsx('text-[9px] font-semibold font-mono px-1.5 py-0.5 rounded', modelStyle.bg, modelStyle.text)}>
          {agent.model_id === 'gpt-5.4' ? 'GPT-5.4' : 'Gemini'}
        </span>
        <span className="text-[9px] text-slate-600 font-mono">{runCount} runs</span>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Team column
// ---------------------------------------------------------------------------

function TeamColumn({
  team,
  agents,
  runCounts,
  onAgentClick,
}: {
  team: AgentTeam
  agents: Agent[]
  runCounts: Record<string, number>
  onAgentClick: (a: Agent) => void
}) {
  const meta = TEAM_META[team]
  return (
    <div className="flex flex-col items-center">
      {/* Connector up */}
      <div className="w-px h-4 bg-white/[0.12]" />
      {/* Team header */}
      <div className={clsx(
        'rounded-lg px-3 py-1.5 border mb-3 text-center',
        meta.border, meta.bg,
      )}>
        <span className={clsx('text-[10px] font-bold uppercase tracking-[0.14em]', meta.color)}>{meta.label}</span>
      </div>
      {/* Agent cards */}
      <div className="flex flex-col gap-2 w-full">
        {agents.map((agent) => (
          <AgentMiniCard
            key={agent.id}
            agent={agent}
            runCount={runCounts[agent.id] ?? 0}
            onClick={onAgentClick}
            teamMeta={meta}
          />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Slide-in agent panel
// ---------------------------------------------------------------------------

function AgentPanel({
  agent,
  lastRuns,
  activeTasks,
  runCount,
  onClose,
}: {
  agent: Agent
  lastRuns: AgentRun[]
  activeTasks: Task[]
  runCount: number
  onClose: () => void
}) {
  const teamMeta = TEAM_META[agent.team] ?? TEAM_META.ops
  const modelStyle = MODEL_COLOR[agent.model_id] ?? { text: 'text-slate-400', bg: 'bg-slate-400/10' }
  const myActiveTasks = activeTasks.filter((t) => t.assignee_agent_id === agent.id)

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      {/* Panel */}
      <div
        className={clsx(
          'relative w-[360px] h-full bg-[#070C1A] border-l border-white/[0.08] flex flex-col',
          'shadow-[-20px_0_60px_rgba(0,0,0,0.5)]',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={clsx('px-5 py-4 border-b border-white/[0.07] flex items-center gap-3', teamMeta.bg)}>
          <AgentAvatar agent={agent} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={clsx('w-2 h-2 rounded-full', STATUS_DOT[agent.status])} />
              <h2 className="text-sm font-bold text-white">{agent.name}</h2>
            </div>
            <p className={clsx('text-[10px] font-semibold uppercase tracking-wider mt-0.5', teamMeta.color)}>
              {teamMeta.label}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors text-lg leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Role */}
          <div>
            <p className="text-[10px] text-slate-600 uppercase tracking-wider font-bold mb-1.5">Role</p>
            <p className="text-xs text-slate-300 leading-relaxed">{agent.role}</p>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] p-3 text-center">
              <p className="text-lg font-bold text-white">{runCount}</p>
              <p className="text-[9px] text-slate-600 uppercase tracking-wide mt-0.5">Runs</p>
            </div>
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] p-3 text-center">
              <p className="text-lg font-bold text-white">{myActiveTasks.length}</p>
              <p className="text-[9px] text-slate-600 uppercase tracking-wide mt-0.5">Active</p>
            </div>
            <div className={clsx('rounded-lg border p-3 text-center', modelStyle.bg, 'border-white/[0.07]')}>
              <p className={clsx('text-[10px] font-bold font-mono', modelStyle.text)}>
                {agent.model_id === 'gpt-5.4' ? 'GPT-5.4' : 'Gemini'}
              </p>
              <p className="text-[9px] text-slate-600 uppercase tracking-wide mt-0.5">Model</p>
            </div>
          </div>

          {/* Active tasks */}
          {myActiveTasks.length > 0 && (
            <div>
              <p className="text-[10px] text-slate-600 uppercase tracking-wider font-bold mb-2">Active Tasks</p>
              <div className="space-y-1.5">
                {myActiveTasks.slice(0, 3).map((t) => (
                  <div key={t.id} className="rounded-lg border border-amber-400/20 bg-amber-400/[0.04] px-3 py-2">
                    <p className="text-[11px] text-white font-medium truncate">{t.title}</p>
                    <p className="text-[10px] text-slate-500 font-mono mt-0.5">{t.type}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Last runs */}
          <div>
            <p className="text-[10px] text-slate-600 uppercase tracking-wider font-bold mb-2">Last Runs</p>
            {lastRuns.length === 0 ? (
              <p className="text-[11px] text-slate-600 italic">No runs yet</p>
            ) : (
              <div className="space-y-2">
                {lastRuns.map((run) => (
                  <div key={run.id} className="rounded-lg border border-white/[0.07] bg-white/[0.03] p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className={clsx(
                        'text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded font-mono',
                        run.outcome === 'success' ? 'bg-emerald-400/10 text-emerald-400' :
                        run.outcome === 'failure' ? 'bg-rose-400/10 text-rose-400' :
                        'bg-amber-400/10 text-amber-400',
                      )}>
                        {run.outcome}
                      </span>
                      <span className="text-[9px] text-slate-600 font-mono">
                        {new Date(run.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 line-clamp-2 leading-relaxed">
                      {run.output_summary || run.input_summary || '—'}
                    </p>
                    <p className="text-[9px] text-slate-600 font-mono mt-1">
                      ${run.cost_usd.toFixed(4)} · {run.duration_ms}ms
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TeamOrgView() {
  const { data: agents, loading, error } = useAgents()
  const { runCounts, lastRuns } = useAgentStats()
  const { data: tasks } = useTasks('in_progress')
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-5 h-5 border-2 border-[#00D4FF]/30 border-t-[#00D4FF] rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.05] p-4">
        <p className="text-rose-400 text-sm">Error loading agents: {error}</p>
      </div>
    )
  }

  const byTeam = agents.reduce<Partial<Record<AgentTeam, Agent[]>>>((acc, a) => {
    acc[a.team] = [...(acc[a.team] ?? []), a]
    return acc
  }, {})

  const ceoAgent = (byTeam['executive'] ?? []).find((a) => a.id === 'ceo')
  // Non-executive teams in display order
  const nonExecTeams = TEAM_ORDER.filter((t) => t !== 'executive' && (byTeam[t]?.length ?? 0) > 0)

  const onlineCount = agents.filter((a) => a.status === 'online').length
  const busyCount   = agents.filter((a) => a.status === 'busy').length

  return (
    <div className="animate-fade-in min-h-full">
      {/* Header summary */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-base font-bold text-white">Team Organization</h2>
          <p className="text-xs text-slate-500 mt-0.5">WAI Zero Human Company — {agents.length} agents across {nonExecTeams.length + 1} teams</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {onlineCount} online
          </span>
          {busyCount > 0 && (
            <span className="flex items-center gap-1.5 text-[11px] text-amber-400 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              {busyCount} busy
            </span>
          )}
        </div>
      </div>

      {/* Org tree */}
      <div className="flex flex-col items-center">

        {/* Level 1 — Neb */}
        <NebNode />

        {/* Level 2 — CEO */}
        <CeoNode agent={ceoAgent} onClick={setSelectedAgent} />

        {/* Horizontal connector bar spanning all teams */}
        <div className="relative flex items-start w-full max-w-6xl">
          {/* Central line */}
          <div
            className="absolute top-0 left-0 right-0 h-px bg-white/[0.10]"
            style={{ top: 0 }}
          />
          {/* Columns */}
          <div
            className="grid w-full gap-4"
            style={{ gridTemplateColumns: `repeat(${nonExecTeams.length}, minmax(0, 1fr))` }}
          >
            {nonExecTeams.map((team) => (
              <TeamColumn
                key={team}
                team={team}
                agents={byTeam[team] ?? []}
                runCounts={runCounts}
                onAgentClick={setSelectedAgent}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Slide-in panel */}
      {selectedAgent && (
        <AgentPanel
          agent={selectedAgent}
          lastRuns={lastRuns[selectedAgent.id] ?? []}
          activeTasks={tasks}
          runCount={runCounts[selectedAgent.id] ?? 0}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  )
}
