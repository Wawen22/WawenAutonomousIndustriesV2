// ============================================================
// WAI Dashboard – Team Org View (T064)
// Hierarchical org chart: Neb → CEO → Teams → Agents
// Improved Design with SVG Connectors & Unified Sidebar
// ============================================================

import { useState } from 'react'
import { clsx } from 'clsx'
import {
  useAgents, 
  useAgentStats, 
  useTasks,
  useEventsWithContext
} from '../hooks/useSupabaseRealtime.js'
import { AgentDetailSidebar } from './AgentDetailSidebar.js'
import type { Agent, AgentStatus, AgentTeam } from '../types/index.js'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TEAM_ORDER: AgentTeam[] = ['executive', 'saas', 'dev', 'consulting', 'marketing', 'ops']

const TEAM_META: Record<AgentTeam, { label: string; color: string; border: string; bg: string; glow: string }> = {
  executive:  { label: 'Executive',       color: 'text-[#00D4FF]',   border: 'border-[#00D4FF]/30',   bg: 'bg-[#00D4FF]/[0.03]', glow: 'shadow-[0_0_20px_rgba(0,212,255,0.15)]' },
  saas:       { label: 'SaaS',            color: 'text-violet-400',  border: 'border-violet-400/30',  bg: 'bg-violet-400/[0.03]', glow: 'shadow-[0_0_20px_rgba(167,139,250,0.15)]' },
  dev:        { label: 'Custom Software', color: 'text-emerald-400', border: 'border-emerald-400/30', bg: 'bg-emerald-400/[0.03]', glow: 'shadow-[0_0_20px_rgba(52,211,153,0.15)]' },
  consulting: { label: 'Consulting',      color: 'text-cyan-400',    border: 'border-cyan-400/30',    bg: 'bg-cyan-400/[0.03]', glow: 'shadow-[0_0_20px_rgba(34,211,238,0.15)]' },
  marketing:  { label: 'Marketing',       color: 'text-amber-400',   border: 'border-amber-400/30',   bg: 'bg-amber-400/[0.03]', glow: 'shadow-[0_0_20px_rgba(251,191,36,0.15)]' },
  ops:        { label: 'Ops/Finance/HR',  color: 'text-slate-400',   border: 'border-slate-400/30',   bg: 'bg-slate-400/[0.03]', glow: '' },
}

const STATUS_DOT: Record<AgentStatus, string> = {
  online:  'bg-emerald-400 animate-pulse',
  busy:    'bg-amber-400 animate-pulse',
  offline: 'bg-slate-600',
  error:   'bg-rose-400 animate-pulse',
}

// ---------------------------------------------------------------------------
// Components: Nodes
// ---------------------------------------------------------------------------

function NodeConnector({ className }: { className?: string }) {
  return (
    <div className={clsx("flex flex-col items-center", className)}>
      <div className="w-px h-8 bg-gradient-to-b from-white/20 to-white/5" />
    </div>
  )
}

function FounderNode() {
  return (
    <div className="flex flex-col items-center relative z-10">
      <div className="relative group">
        {/* Animated outer glow */}
        <div className="absolute inset-0 rounded-3xl bg-amber-400/20 blur-2xl scale-125 opacity-50 group-hover:opacity-100 transition-opacity duration-700 animate-pulse" />
        
        <div className={clsx(
          "relative rounded-3xl border-2 border-amber-400/40 bg-[#0A1628] px-8 py-5",
          "shadow-[0_0_40px_rgba(251,191,36,0.15)]",
          "flex flex-col items-center gap-3 min-w-[180px]",
          "transition-all duration-500 hover:border-amber-400/60 hover:scale-[1.02]"
        )}>
          {/* Hexagonal avatar container */}
          <div className="w-16 h-16 relative flex items-center justify-center">
            <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full fill-amber-400/10 stroke-amber-400/40 stroke-2">
              <path d="M50 5 L90 27.5 L90 72.5 L50 95 L10 72.5 L10 27.5 Z" />
            </svg>
            <span className="text-2xl font-black text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]">N</span>
          </div>
          
          <div className="text-center">
            <h3 className="text-base font-black text-white tracking-tight">Neb</h3>
            <div className="inline-flex items-center gap-2 mt-1 px-3 py-1 rounded-full bg-amber-400/10 border border-amber-400/20">
              <span className="w-1 h-1 rounded-full bg-amber-400 animate-ping" />
              <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Founder</span>
            </div>
          </div>
        </div>
      </div>
      <NodeConnector />
    </div>
  )
}

function CeoNode({ agent, onClick }: { agent: Agent | undefined; onClick: (a: Agent) => void }) {
  if (!agent) return null
  return (
    <div className="flex flex-col items-center relative z-10">
      <button
        onClick={() => onClick(agent)}
        className={clsx(
          "group relative rounded-2xl border-2 border-[#00D4FF]/30 bg-[#0A1628] px-6 py-4",
          "shadow-[0_0_30px_rgba(0,212,255,0.1)] hover:shadow-[0_0_40px_rgba(0,212,255,0.25)]",
          "flex flex-col items-center gap-3 min-w-[160px]",
          "transition-all duration-300 hover:border-[#00D4FF]/60 hover:scale-[1.02] cursor-pointer"
        )}
      >
        <div className="w-14 h-14 rounded-xl bg-[#00D4FF]/10 border border-[#00D4FF]/20 flex items-center justify-center font-black text-lg text-[#00D4FF] group-hover:scale-110 transition-transform">
          {agent.name.split(' ').map(n => n[0]).join('')}
        </div>
        
        <div className="text-center">
          <div className="flex items-center gap-1.5 justify-center">
            <span className={clsx('w-1.5 h-1.5 rounded-full', STATUS_DOT[agent.status])} />
            <h4 className="text-sm font-bold text-white">{agent.name}</h4>
          </div>
          <p className="text-[10px] font-black text-[#00D4FF] uppercase tracking-widest mt-1 opacity-70">Chief Executive</p>
        </div>
      </button>
      
      {/* Connector lines to teams */}
      <div className="w-px h-10 bg-gradient-to-b from-white/20 to-transparent" />
    </div>
  )
}

function AgentMiniNode({ 
  agent, 
  runCount, 
  onClick, 
  teamMeta 
}: { 
  agent: Agent; 
  runCount: number; 
  onClick: (a: Agent) => void; 
  teamMeta: (typeof TEAM_META)[AgentTeam] 
}) {
  return (
    <button
      onClick={() => onClick(agent)}
      className={clsx(
        "group w-full flex items-center gap-3 rounded-xl border p-3 text-left transition-all duration-200 cursor-pointer",
        teamMeta.border, teamMeta.bg,
        "hover:brightness-125 hover:scale-[1.02]",
        teamMeta.glow ? `hover:${teamMeta.glow}` : "hover:shadow-lg"
      )}
    >
      <div className={clsx(
        "w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center font-bold text-xs border border-white/5 bg-white/5",
        teamMeta.color
      )}>
        {agent.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', STATUS_DOT[agent.status])} />
          <p className="text-[11px] font-bold text-white truncate">{agent.name}</p>
        </div>
        <div className="flex items-center justify-between mt-1">
          <p className="text-[9px] text-slate-500 font-medium truncate">{agent.role.split(',')[0]}</p>
          <span className="text-[9px] text-slate-600 font-mono font-bold">{runCount}R</span>
        </div>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function TeamOrgView() {
  const { data: agents, loading, error } = useAgents()
  const { runCounts, lastRuns } = useAgentStats()
  const { data: tasks } = useTasks('in_progress')
  const { data: events } = useEventsWithContext(50)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 border-2 border-[#00D4FF]/20 rounded-full" />
          <div className="absolute inset-0 border-2 border-[#00D4FF] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.05] p-6 text-center">
        <p className="text-rose-400 text-sm font-bold">Failed to load organization data</p>
        <p className="text-rose-400/60 text-xs mt-1">{error}</p>
      </div>
    )
  }

  const byTeam = agents.reduce<Partial<Record<AgentTeam, Agent[]>>>((acc, a) => {
    acc[a.team] = [...(acc[a.team] ?? []), a]
    return acc
  }, {})

  const ceoAgent = (byTeam['executive'] ?? []).find((a) => a.id === 'ceo')
  const nonExecTeams = TEAM_ORDER.filter((t) => t !== 'executive' && (byTeam[t]?.length ?? 0) > 0)

  return (
    <div className="animate-fade-in pb-20 overflow-x-auto min-w-max">
      {/* Page Header */}
      <div className="flex items-end justify-between mb-12 px-2">
        <div>
          <h2 className="text-xl font-black text-white tracking-tight">Command Center</h2>
          <p className="text-xs text-slate-500 font-medium mt-1 flex items-center gap-2">
            <span className="w-1 h-1 rounded-full bg-slate-700" />
            Hierarchical Deployment Control · {agents.length} Nodes
          </p>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Active Systems</p>
            <p className="text-sm font-mono font-bold text-emerald-400">{agents.filter(a => a.status === 'online').length} ONLINE</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">System Load</p>
            <p className="text-sm font-mono font-bold text-amber-400">{agents.filter(a => a.status === 'busy').length} ENGAGED</p>
          </div>
        </div>
      </div>

      {/* Org Tree Visualization */}
      <div className="flex flex-col items-center">
        {/* L1: Founder */}
        <FounderNode />

        {/* L2: CEO */}
        <CeoNode agent={ceoAgent} onClick={setSelectedAgent} />

        {/* L3: Teams */}
        <div className="relative w-full px-4">
          {/* SVG Connector Lines */}
          <div className="absolute top-0 left-0 right-0 h-10 pointer-events-none">
            <svg className="w-full h-full" preserveAspectRatio="none">
              <defs>
                <linearGradient id="line-grad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="rgba(255,255,255,0.2)" />
                  <stop offset="100%" stopColor="rgba(255,255,255,0.05)" />
                </linearGradient>
              </defs>
              <line x1="50%" y1="0" x2="50%" y2="20" stroke="url(#line-grad)" strokeWidth="1" />
              <line x1="10%" y1="20" x2="90%" y2="20" stroke="url(#line-grad)" strokeWidth="1" />
              {nonExecTeams.map((_, idx) => {
                const x = 10 + (idx * (80 / (nonExecTeams.length - 1 || 1)))
                return (
                  <line 
                    key={idx} 
                    x1={`${x}%`} 
                    y1="20" 
                    x2={`${x}%`} 
                    y2="40" 
                    stroke="url(#line-grad)" 
                    strokeWidth="1" 
                  />
                )
              })}
            </svg>
          </div>

          {/* Team Columns */}
          <div className="grid gap-6 mt-10" style={{ gridTemplateColumns: `repeat(${nonExecTeams.length}, minmax(220px, 1fr))` }}>
            {nonExecTeams.map((team) => {
              const meta = TEAM_META[team]
              const teamAgents = byTeam[team] ?? []
              
              return (
                <div key={team} className="flex flex-col gap-4">
                  {/* Team Header */}
                  <div className={clsx(
                    "rounded-xl border p-4 text-center transition-all duration-300",
                    meta.border, meta.bg,
                    "group hover:bg-opacity-10"
                  )}>
                    <h5 className={clsx("text-[10px] font-black uppercase tracking-[0.25em]", meta.color)}>
                      {meta.label}
                    </h5>
                    <p className="text-[9px] text-slate-600 font-mono mt-1 font-bold">
                      {teamAgents.length} SPECIALISTS
                    </p>
                  </div>

                  {/* Agent List */}
                  <div className="flex flex-col gap-2.5">
                    {teamAgents.map(agent => (
                      <AgentMiniNode 
                        key={agent.id}
                        agent={agent}
                        runCount={runCounts[agent.id] ?? 0}
                        onClick={setSelectedAgent}
                        teamMeta={meta}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Unified Agent Detail Sidebar */}
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
