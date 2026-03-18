// ============================================================
// WAI Dashboard – Agent List View
// List of all agents grouped by team.
// Unified sidebar on click.
// ============================================================

import { useState } from 'react'
import { clsx } from 'clsx'
import { Panel } from './ui/Panel.js'
import { Badge } from './ui/Badge.js'
import { 
  useAgents, 
  useAgentStats, 
  useTasks, 
  useEventsWithContext 
} from '../hooks/useSupabaseRealtime.js'
import { AgentDetailSidebar } from './AgentDetailSidebar.js'
import type { Agent, AgentStatus, AgentTeam } from '../types/index.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEAM_ORDER: AgentTeam[] = ['executive', 'saas', 'dev', 'consulting', 'marketing', 'ops']

const TEAM_META: Record<AgentTeam, { label: string; accent: string }> = {
  executive:  { label: 'Executive',  accent: 'text-[#00D4FF] border-[#00D4FF]/30' },
  saas:       { label: 'SaaS',       accent: 'text-violet-400 border-violet-400/30' },
  dev:        { label: 'Development',accent: 'text-sky-400    border-sky-400/30'   },
  consulting: { label: 'Consulting', accent: 'text-teal-400   border-teal-400/30'  },
  marketing:  { label: 'Marketing',  accent: 'text-pink-400   border-pink-400/30'  },
  ops:        { label: 'Operations', accent: 'text-slate-400  border-slate-400/30' },
}

const STATUS_GLOW: Record<AgentStatus, string> = {
  online:  'shadow-glow-emerald',
  busy:    '',
  offline: '',
  error:   'shadow-glow-rose',
}

const MODEL_COLOR: Record<string, string> = {
  'gpt-5.4':          'text-[#00D4FF] bg-[#00D4FF]/[0.07] ring-1 ring-[#00D4FF]/20',
  'gemini-2.5-flash': 'text-violet-400 bg-violet-400/[0.07] ring-1 ring-violet-400/20',
}

// ---------------------------------------------------------------------------
// AgentCard
// ---------------------------------------------------------------------------

function AgentCard({ agent, onClick }: { agent: Agent; onClick: (a: Agent) => void }) {
  const teamMeta = TEAM_META[agent.team] ?? { label: agent.team, accent: 'text-slate-400 border-slate-400/30' }
  const modelStyle = MODEL_COLOR[agent.model_id] ?? 'text-slate-400 bg-white/5 ring-1 ring-white/10'

  return (
    <button
      onClick={() => onClick(agent)}
      className={clsx(
        'group relative rounded-xl border border-white/[0.07] bg-[#0A1628] p-4 text-left w-full transition-all duration-200',
        'hover:border-white/[0.13] hover:bg-[#0F2040]/60',
        agent.status === 'online' && 'hover:shadow-glow-emerald',
        agent.status === 'error'  && STATUS_GLOW.error
      )}
    >
      {/* Status indicator line (left edge) */}
      <div
        className={clsx(
          'absolute left-0 top-4 bottom-4 w-0.5 rounded-r transition-opacity duration-200',
          agent.status === 'online'  && 'bg-emerald-400 opacity-60 group-hover:opacity-100',
          agent.status === 'busy'    && 'bg-amber-400 opacity-60',
          agent.status === 'error'   && 'bg-rose-400 opacity-80',
          agent.status === 'offline' && 'bg-slate-700 opacity-40',
        )}
      />

      <div className="flex items-start justify-between gap-3 pl-2">
        <div className="flex-1 min-w-0">
          {/* Name + status */}
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={agent.status} dot>
              {agent.status}
            </Badge>
            <span className="font-semibold text-white text-sm truncate">{agent.name}</span>
          </div>

          {/* Role */}
          <p className="text-xs text-slate-500 leading-relaxed line-clamp-2 mt-1">
            {agent.role}
          </p>
        </div>

        {/* Model badge */}
        <span
          className={clsx(
            'flex-shrink-0 text-[10px] font-semibold px-2 py-1 rounded-md font-mono whitespace-nowrap',
            modelStyle
          )}
        >
          {agent.model_id.split('-')[0].toUpperCase()}
        </span>
      </div>

      {/* Footer: team + ID */}
      <div className={clsx('flex items-center justify-between mt-3 pt-2.5 border-t border-white/[0.05] pl-2')}>
        <span className={clsx('text-[10px] font-semibold uppercase tracking-wider', teamMeta.accent.split(' ')[0])}>
          {teamMeta.label}
        </span>
        <span className="text-[10px] text-slate-600 font-mono">{agent.id}</span>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Team section header
// ---------------------------------------------------------------------------

function TeamSection({ team, agents, onAgentClick }: { team: AgentTeam; agents: Agent[]; onAgentClick: (a: Agent) => void }) {
  const meta = TEAM_META[team]
  const onlineCount = agents.filter((a) => a.status === 'online').length

  return (
    <div>
      <div className={clsx('flex items-center gap-3 mb-3 pb-2 border-b', meta.accent.split(' ')[1])}>
        <h2 className={clsx('text-xs font-bold uppercase tracking-[0.16em]', meta.accent.split(' ')[0])}>
          {meta.label}
        </h2>
        <span className="text-[11px] text-slate-600 font-mono">
          {onlineCount}/{agents.length}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} onClick={onAgentClick} />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function AgentList() {
  const { data: agents, loading, error } = useAgents()
  const { runCounts, lastRuns } = useAgentStats()
  const { data: tasks } = useTasks('in_progress')
  const { data: events } = useEventsWithContext(50)
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
      <Panel className="border-rose-500/20">
        <p className="text-rose-400 text-sm">Error loading agents: {error}</p>
      </Panel>
    )
  }

  const byTeam = agents.reduce<Partial<Record<AgentTeam, Agent[]>>>((acc, a) => {
    acc[a.team] = [...(acc[a.team] ?? []), a]
    return acc
  }, {})

  const onlineCount = agents.filter((a) => a.status === 'online').length

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Summary bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-slow" />
          <span className="text-sm font-semibold text-white">
            {onlineCount} <span className="text-slate-500 font-normal">of</span> {agents.length} agents online
          </span>
        </div>
        <div className="flex gap-2">
          {Object.entries(
            agents.reduce<Record<AgentStatus, number>>((a, ag) => {
              a[ag.status] = (a[ag.status] ?? 0) + 1
              return a
            }, { online: 0, offline: 0, busy: 0, error: 0 })
          )
            .filter(([, count]) => count > 0)
            .map(([status, count]) => (
              <Badge key={status} variant={status} dot>
                {count} {status}
              </Badge>
            ))}
        </div>
      </div>

      {/* Teams */}
      {TEAM_ORDER.filter((t) => (byTeam[t]?.length ?? 0) > 0).map((team) => (
        <TeamSection key={team} team={team} agents={byTeam[team]!} onAgentClick={setSelectedAgent} />
      ))}

      {/* Unified Sidebar */}
      {selectedAgent && (
        <AgentDetailSidebar
          agent={selectedAgent}
          lastRuns={lastRuns[selectedAgent.id] ?? []}
          runCount={runCounts[selectedAgent.id] ?? 0}
          activeTasks={tasks || []}
          recentEvents={events || []}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  )
}
