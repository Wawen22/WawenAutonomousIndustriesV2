// ============================================================
// WAI Dashboard – Virtual Office View (T065)
// Ogni agente ha una scrivania. Animazione "typing" se attivo.
// Click su scrivania → modale con task, runs, events recenti.
// ============================================================

import { useState, useEffect, useCallback } from 'react'
import { clsx } from 'clsx'
import {
  useAgents,
  useAgentStats,
  useTasks,
  useEventsWithContext,
} from '../hooks/useSupabaseRealtime.js'
import { AgentDetailSidebar } from './AgentDetailSidebar.js'
import type { Agent, AgentStatus, AgentTeam, AgentRun } from '../types/index.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEAM_ORDER: AgentTeam[] = ['executive', 'saas', 'dev', 'consulting', 'marketing', 'ops']

const TEAM_META: Record<AgentTeam, { label: string; color: string; border: string; bg: string; screenColor: string; screenGlow: string }> = {
  executive:  { label: 'Executive',       color: 'text-[#00D4FF]',   border: 'border-[#00D4FF]/25',   bg: 'bg-[#00D4FF]/[0.04]',   screenColor: 'bg-[#00D4FF]/[0.10]',   screenGlow: 'shadow-[0_0_18px_rgba(0,212,255,0.30)]'   },
  saas:       { label: 'SaaS',            color: 'text-violet-400',  border: 'border-violet-400/25',  bg: 'bg-violet-400/[0.04]',  screenColor: 'bg-violet-400/[0.10]',  screenGlow: 'shadow-[0_0_18px_rgba(167,139,250,0.30)]' },
  dev:        { label: 'Custom Software', color: 'text-emerald-400', border: 'border-emerald-400/25', bg: 'bg-emerald-400/[0.04]', screenColor: 'bg-emerald-400/[0.10]', screenGlow: 'shadow-[0_0_18px_rgba(52,211,153,0.30)]'  },
  consulting: { label: 'Consulting',      color: 'text-cyan-400',    border: 'border-cyan-400/25',    bg: 'bg-cyan-400/[0.04]',    screenColor: 'bg-cyan-400/[0.10]',    screenGlow: 'shadow-[0_0_18px_rgba(34,211,238,0.30)]'  },
  marketing:  { label: 'Marketing',       color: 'text-amber-400',   border: 'border-amber-400/25',   bg: 'bg-amber-400/[0.04]',   screenColor: 'bg-amber-400/[0.10]',   screenGlow: 'shadow-[0_0_18px_rgba(251,191,36,0.30)]'  },
  ops:        { label: 'Ops / Finance / HR', color: 'text-slate-400', border: 'border-slate-400/20', bg: 'bg-slate-400/[0.03]',   screenColor: 'bg-slate-400/[0.08]',   screenGlow: ''                                        },
}

const STATUS_DOT: Record<AgentStatus, string> = {
  online:  'bg-emerald-400',
  busy:    'bg-amber-400 animate-pulse',
  offline: 'bg-slate-600',
  error:   'bg-rose-400 animate-pulse',
}

const MODEL_BADGE: Record<string, { text: string; bg: string }> = {
  'gpt-5.4':          { text: 'text-[#00D4FF]',  bg: 'bg-[#00D4FF]/[0.08]'  },
  'gemini-2.5-flash': { text: 'text-violet-400', bg: 'bg-violet-400/[0.08]' },
}

const ACTIVE_WINDOW_MS = 60_000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function agentActivityState(agent: Agent, lastRun: AgentRun | undefined, nowMs: number): 'working' | 'recent' | 'idle' {
  if (agent.status === 'busy') return 'working'
  if (lastRun) {
    const age = nowMs - new Date(lastRun.created_at).getTime()
    if (age < ACTIVE_WINDOW_MS) return 'recent'
  }
  return 'idle'
}

function AgentAvatar({ agent, size = 'md' }: { agent: Agent; size?: 'sm' | 'md' }) {
  const initials = agent.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
  const style = MODEL_BADGE[agent.model_id] ?? { text: 'text-slate-400', bg: 'bg-slate-400/10' }
  const sz = size === 'sm' ? 'w-7 h-7 text-[9px]' : 'w-9 h-9 text-[10px]'
  return (
    <div className={clsx('rounded-lg flex items-center justify-center font-bold border', sz, style.bg, style.text,
      agent.model_id === 'gpt-5.4' ? 'border-[#00D4FF]/20' : 'border-violet-400/20'
    )}>
      {initials}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Typing dots animation
// ---------------------------------------------------------------------------

function TypingDots({ color }: { color: string }) {
  return (
    <div className="flex items-end gap-0.5">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className={clsx('w-1 h-1 rounded-full animate-bounce', color)}
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Monitor component
// ---------------------------------------------------------------------------

function Monitor({
  activity,
  teamMeta,
}: {
  activity: 'working' | 'recent' | 'idle'
  teamMeta: (typeof TEAM_META)[AgentTeam]
}) {
  const isWorking = activity === 'working'
  const isRecent  = activity === 'recent'

  return (
    <div className="flex flex-col items-center mb-2.5">
      {/* Monitor frame */}
      <div
        className={clsx(
          'w-full rounded-md border-2 p-1 transition-all duration-500',
          isWorking
            ? clsx('border-current/50', teamMeta.border.replace('/25', '/60'), teamMeta.screenGlow)
            : isRecent
              ? clsx(teamMeta.border)
              : 'border-white/[0.07]'
        )}
      >
        {/* Screen */}
        <div
          className={clsx(
            'rounded h-14 flex items-center justify-center transition-all duration-500',
            isWorking ? teamMeta.screenColor : isRecent ? 'bg-white/[0.04]' : 'bg-[#050810]'
          )}
        >
          {isWorking ? (
            <div className="flex flex-col items-center gap-1.5">
              <TypingDots color={
                teamMeta.color === 'text-[#00D4FF]'   ? 'bg-[#00D4FF]'   :
                teamMeta.color === 'text-violet-400'  ? 'bg-violet-400'  :
                teamMeta.color === 'text-emerald-400' ? 'bg-emerald-400' :
                teamMeta.color === 'text-cyan-400'    ? 'bg-cyan-400'    :
                teamMeta.color === 'text-amber-400'   ? 'bg-amber-400'   :
                'bg-slate-400'
              } />
              <span className={clsx('text-[8px] font-mono font-bold', teamMeta.color)}>WORKING</span>
            </div>
          ) : isRecent ? (
            <span className="text-[9px] font-mono text-slate-600">DONE</span>
          ) : (
            <span className="text-slate-800 text-lg">—</span>
          )}
        </div>
      </div>
      {/* Stand */}
      <div className="w-2.5 h-2 bg-white/[0.06] rounded-b" />
      <div className="w-8 h-px bg-white/[0.07]" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Agent desk card
// ---------------------------------------------------------------------------

function AgentDesk({
  agent,
  lastRun,
  runCount,
  nowMs,
  onClick,
}: {
  agent: Agent
  lastRun: AgentRun | undefined
  runCount: number
  nowMs: number
  onClick: (a: Agent) => void
}) {
  const activity = agentActivityState(agent, lastRun, nowMs)
  const teamMeta = TEAM_META[agent.team] ?? TEAM_META.ops
  const modelStyle = MODEL_BADGE[agent.model_id] ?? { text: 'text-slate-400', bg: 'bg-slate-400/10' }
  const isWorking = activity === 'working'

  return (
    <button
      onClick={() => onClick(agent)}
      className={clsx(
        'group flex flex-col items-center rounded-xl border p-3 w-full text-left transition-all duration-200 cursor-pointer',
        teamMeta.bg,
        isWorking ? clsx(teamMeta.border.replace('/25', '/50'), teamMeta.screenGlow) : clsx(teamMeta.border, 'hover:brightness-125'),
        'hover:scale-[1.02]'
      )}
    >
      {/* Monitor */}
      <Monitor activity={activity} teamMeta={teamMeta} />

      {/* Avatar + info */}
      <div className="flex flex-col items-center gap-1 w-full mt-1">
        <AgentAvatar agent={agent} />
        <p className="text-[11px] font-semibold text-white text-center leading-tight mt-1 px-1 truncate w-full">
          {agent.name}
        </p>
        <p className="text-[9px] text-slate-600 text-center truncate w-full px-1 leading-relaxed">
          {agent.role.split(',')[0]}
        </p>

        {/* Status + model row */}
        <div className="flex items-center justify-center gap-1.5 mt-1.5 flex-wrap">
          <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', STATUS_DOT[agent.status])} />
          <span className={clsx('text-[8px] font-semibold font-mono px-1 py-0.5 rounded', modelStyle.bg, modelStyle.text)}>
            {agent.model_id === 'gpt-5.4' ? 'GPT' : 'GEM'}
          </span>
          <span className="text-[8px] text-slate-700 font-mono">{runCount}</span>
        </div>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Neb CEO Corner
// ---------------------------------------------------------------------------

function NebCorner() {
  return (
    <div className="relative rounded-2xl border-2 border-amber-400/30 bg-amber-400/[0.04] p-5 overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 bg-amber-400/[0.03] pointer-events-none" />
      <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-amber-400/[0.06] blur-3xl pointer-events-none" />

      <div className="relative flex items-center gap-6">
        {/* Special monitor */}
        <div className="flex flex-col items-center flex-shrink-0">
          <div className="rounded-lg border-2 border-amber-400/40 p-1.5 shadow-[0_0_24px_rgba(251,191,36,0.20)]">
            <div className="rounded w-24 h-16 bg-amber-400/[0.06] flex items-center justify-center">
              <span className="text-2xl font-black text-amber-400/60">N</span>
            </div>
          </div>
          <div className="w-3 h-2 bg-white/[0.05] rounded-b" />
          <div className="w-10 h-px bg-white/[0.07]" />
        </div>

        {/* Info */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-400/70">CEO Corner</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-400/20 border border-amber-400/30 text-amber-400 font-bold uppercase tracking-widest">
              Founder
            </span>
          </div>
          <p className="text-lg font-black text-white">Neb</p>
          <p className="text-xs text-slate-500 mt-0.5">The only human in the building</p>
          <p className="text-[10px] text-amber-400/50 font-mono mt-2">Gives orders via Telegram ↗</p>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Team section
// ---------------------------------------------------------------------------

function TeamSection({
  team,
  agents,
  lastRuns,
  runCounts,
  nowMs,
  onAgentClick,
}: {
  team: AgentTeam
  agents: Agent[]
  lastRuns: Record<string, AgentRun[]>
  runCounts: Record<string, number>
  nowMs: number
  onAgentClick: (a: Agent) => void
}) {
  const meta = TEAM_META[team]
  const workingCount = agents.filter((a) => a.status === 'busy').length

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center gap-3 mb-3">
        <div className={clsx('h-px flex-1 bg-gradient-to-r from-transparent', meta.border.replace('border-', 'to-').replace('/25', '/30'))} />
        <span className={clsx('text-[10px] font-bold uppercase tracking-[0.15em] flex items-center gap-2', meta.color)}>
          {meta.label}
          {workingCount > 0 && (
            <span className={clsx('w-1.5 h-1.5 rounded-full animate-pulse', meta.color.replace('text-', 'bg-'))} />
          )}
        </span>
        <div className={clsx('h-px flex-1 bg-gradient-to-l from-transparent', meta.border.replace('border-', 'to-').replace('/25', '/30'))} />
      </div>

      {/* Desks grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {agents.map((agent) => (
          <AgentDesk
            key={agent.id}
            agent={agent}
            lastRun={lastRuns[agent.id]?.[0]}
            runCount={runCounts[agent.id] ?? 0}
            nowMs={nowMs}
            onClick={onAgentClick}
          />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Easter egg – all agents idle
// ---------------------------------------------------------------------------

function OfficeQuiet() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 animate-fade-in">
      <div className="text-5xl animate-pulse-slow">🌙</div>
      <p className="text-lg font-semibold text-slate-500">Office is quiet...</p>
      <p className="text-xs text-slate-700 font-mono">All agents are offline or idle</p>
    </div>
  )
}

export function VirtualOfficeView() {
  const { data: agents, loading, error } = useAgents()
  const { runCounts, lastRuns } = useAgentStats()
  const { data: activeTasks } = useTasks('in_progress')
  const { data: recentEvents } = useEventsWithContext(100)

  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())

  // Refresh "now" every 10s for typing detection
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 10_000)
    return () => clearInterval(id)
  }, [])

  const handleClose = useCallback(() => setSelectedAgent(null), [])

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

  const busyCount   = agents.filter((a) => a.status === 'busy').length
  const onlineCount = agents.filter((a) => a.status === 'online').length
  const allIdle = agents.length > 0 && busyCount === 0 && onlineCount === 0

  return (
    <div className="animate-fade-in space-y-8">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-white">Virtual Office</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {agents.length} workstations · {busyCount > 0 ? `${busyCount} active` : 'all idle'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {busyCount > 0 && (
            <span className="flex items-center gap-1.5 text-[11px] text-amber-400 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              {busyCount} working
            </span>
          )}
          {onlineCount > 0 && (
            <span className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              {onlineCount} online
            </span>
          )}
        </div>
      </div>

      {/* Neb CEO Corner */}
      <NebCorner />

      {/* Easter egg */}
      {allIdle && <OfficeQuiet />}

      {/* Teams + desks */}
      {!allIdle && TEAM_ORDER.filter((t) => (byTeam[t]?.length ?? 0) > 0).map((team) => (
        <TeamSection
          key={team}
          team={team}
          agents={byTeam[team]!}
          lastRuns={lastRuns}
          runCounts={runCounts}
          nowMs={nowMs}
          onAgentClick={setSelectedAgent}
        />
      ))}

      {/* Show teams even when all idle, but below the easter egg */}
      {allIdle && TEAM_ORDER.filter((t) => (byTeam[t]?.length ?? 0) > 0).map((team) => (
        <TeamSection
          key={team}
          team={team}
          agents={byTeam[team]!}
          lastRuns={lastRuns}
          runCounts={runCounts}
          nowMs={nowMs}
          onAgentClick={setSelectedAgent}
        />
      ))}

      {/* Agent Detail Sidebar */}
      {selectedAgent && (
        <AgentDetailSidebar
          agent={selectedAgent}
          lastRuns={lastRuns[selectedAgent.id] ?? []}
          runCount={runCounts[selectedAgent.id] ?? 0}
          activeTasks={activeTasks}
          recentEvents={recentEvents}
          onClose={handleClose}
        />
      )}
    </div>
  )
}
