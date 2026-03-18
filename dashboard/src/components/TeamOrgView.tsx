// ============================================================
// WAI Dashboard – Team Org View (T064)
// Hierarchical org chart: Neb → CEO → Teams → Agents
// Fixed Layout, High Depth Design, and Sorted Hierarchy
// ============================================================

import { useState, useMemo } from 'react'
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
// Configuration & Ranking
// ---------------------------------------------------------------------------

const TEAM_ORDER: AgentTeam[] = ['executive', 'saas', 'dev', 'consulting', 'marketing', 'ops']

// Importance ranking (lower is more important)
const ROLE_RANK: Record<string, number> = {
  'ceo': 0,
  // SaaS
  'pm_saas': 1,
  'dev_lead_saas': 2,
  'dev_saas_1': 3,
  'dev_saas_2': 4,
  // Dev
  'architect': 1,
  'dev_general_1': 2,
  'dev_general_2': 3,
  'qa': 4,
  // Consulting
  'consulting_lead': 1,
  'analyst': 2,
  // Marketing
  'marketing_strategist': 1,
  'content_creator': 2,
  'social_manager': 3,
  // Ops
  'ops': 1,
  'finance': 2,
  'hr': 3,
}

const TEAM_META: Record<AgentTeam, { label: string; color: string; border: string; bg: string; shadow: string; glow: string }> = {
  executive:  { label: 'Executive',       color: 'text-[#00D4FF]',   border: 'border-[#00D4FF]/40',   bg: 'bg-[#00D4FF]/[0.04]', shadow: 'shadow-[#00D4FF]/10', glow: 'rgba(0,212,255,0.2)' },
  saas:       { label: 'SaaS Division',   color: 'text-violet-400',  border: 'border-violet-400/40',  bg: 'bg-violet-400/[0.04]', shadow: 'shadow-violet-400/10', glow: 'rgba(167,139,250,0.2)' },
  dev:        { label: 'Custom Software', color: 'text-emerald-400', border: 'border-emerald-400/40', bg: 'bg-emerald-400/[0.04]', shadow: 'shadow-emerald-400/10', glow: 'rgba(52,211,153,0.2)' },
  consulting: { label: 'Consulting',      color: 'text-cyan-400',    border: 'border-cyan-400/40',    bg: 'bg-cyan-400/[0.04]', shadow: 'shadow-cyan-400/10', glow: 'rgba(34,211,238,0.2)' },
  marketing:  { label: 'Marketing',       color: 'text-amber-400',   border: 'border-amber-400/40',   bg: 'bg-amber-400/[0.04]', shadow: 'shadow-amber-400/10', glow: 'rgba(251,191,36,0.2)' },
  ops:        { label: 'Ops / Fin / HR',  color: 'text-slate-400',   border: 'border-slate-400/40',   bg: 'bg-slate-400/[0.04]', shadow: 'shadow-slate-400/10', glow: 'rgba(148,163,184,0.2)' },
}

const STATUS_DOT: Record<AgentStatus, string> = {
  online:  'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]',
  busy:    'bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.6)]',
  offline: 'bg-slate-600',
  error:   'bg-rose-400 animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.6)]',
}

// ---------------------------------------------------------------------------
// UI Components: Specialized Nodes
// ---------------------------------------------------------------------------

function FounderNode() {
  return (
    <div className="flex flex-col items-center relative group">
      {/* Decorative background glow */}
      <div className="absolute inset-0 bg-amber-400/10 blur-2xl scale-110 rounded-full opacity-40 group-hover:opacity-70 transition-opacity duration-1000" />
      
      <div className={clsx(
        "relative rounded-2xl border-2 border-amber-400/40 bg-[#070C1A]/80 backdrop-blur-xl px-6 py-4",
        "shadow-[0_15px_40px_rgba(0,0,0,0.5),0_0_20px_rgba(251,191,36,0.1)]",
        "flex flex-col items-center gap-2 min-w-[160px] border-b-4",
        "transition-all duration-500 hover:-translate-y-1 hover:border-amber-400/80 hover:shadow-[0_20px_50px_rgba(251,191,36,0.2)]"
      )}>
        {/* Animated ring */}
        <div className="absolute -inset-0.5 rounded-[14px] border border-amber-400/10 animate-pulse" />
        
        <div className="w-14 h-14 relative flex items-center justify-center mb-0.5">
          <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full drop-shadow-[0_0_8px_rgba(251,191,36,0.4)]">
            <path 
              d="M50 5 L92 27.5 L92 72.5 L50 95 L8 72.5 L8 27.5 Z" 
              fill="rgba(251,191,36,0.06)" 
              stroke="rgba(251,191,36,0.5)" 
              strokeWidth="2.5" 
            />
          </svg>
          <span className="text-2xl font-black text-amber-400 tracking-tighter">N</span>
        </div>
        
        <div className="text-center">
          <h3 className="text-sm font-black text-white tracking-tight uppercase italic leading-none">Neb</h3>
          <div className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-400 text-black font-black text-[8px] uppercase tracking-[0.15em]">
            Founder
          </div>
        </div>
      </div>
    </div>
  )
}

function CeoNode({ agent, onClick }: { agent: Agent | undefined; onClick: (a: Agent) => void }) {
  if (!agent) return null
  return (
    <div className="flex flex-col items-center mt-8 relative">
      {/* Vertical line from Founder */}
      <div className="absolute -top-8 w-px h-8 bg-gradient-to-b from-amber-400/40 to-[#00D4FF]/40" />
      
      <button
        onClick={() => onClick(agent)}
        className={clsx(
          "group relative rounded-2xl border-2 border-[#00D4FF]/40 bg-[#0A1628]/90 backdrop-blur-md px-6 py-4",
          "shadow-[0_15px_40px_rgba(0,0,0,0.4)] hover:shadow-[0_20px_50px_rgba(0,212,255,0.2)]",
          "flex flex-col items-center gap-2 min-w-[160px] border-b-4",
          "transition-all duration-300 hover:scale-105 hover:border-[#00D4FF] cursor-pointer"
        )}
      >
        <div className="w-12 h-12 rounded-xl bg-[#00D4FF]/10 border border-[#00D4FF]/30 flex items-center justify-center font-black text-xl text-[#00D4FF] group-hover:bg-[#00D4FF]/20 transition-all">
          {agent.name.split(' ').map(n => n[0]).join('')}
        </div>
        
        <div className="text-center">
          <div className="flex items-center gap-1.5 justify-center">
            <span className={clsx('w-1.5 h-1.5 rounded-full', STATUS_DOT[agent.status])} />
            <h4 className="text-sm font-black text-white tracking-tight">{agent.name}</h4>
          </div>
          <p className="text-[9px] font-bold text-[#00D4FF] uppercase tracking-[0.2em] mt-1 opacity-80 leading-none">Orchestrator Core</p>
        </div>
      </button>
    </div>
  )
}

function AgentCard({ 
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
  const isImportant = (ROLE_RANK[agent.id] ?? 9) <= 1

  return (
    <button
      onClick={() => onClick(agent)}
      className={clsx(
        "group w-full flex items-center gap-4 rounded-xl border p-4 text-left transition-all duration-300 cursor-pointer relative overflow-hidden",
        teamMeta.border, 
        isImportant ? "bg-white/[0.04] border-l-4 shadow-lg" : "bg-white/[0.02]",
        "hover:bg-white/[0.08] hover:translate-x-1 hover:border-opacity-100",
        teamMeta.shadow
      )}
    >
      {/* Important role indicator */}
      {isImportant && (
        <div className={clsx("absolute top-0 right-0 w-16 h-16 -mr-8 -mt-8 rotate-45 opacity-20", teamMeta.bg.replace('/[0.04]', ''))} />
      )}

      <div className={clsx(
        "w-12 h-12 rounded-xl flex-shrink-0 flex items-center justify-center font-black text-sm border border-white/10 shadow-inner",
        isImportant ? teamMeta.color : "text-slate-400",
        "bg-black/20 group-hover:scale-110 transition-transform"
      )}>
        {agent.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', STATUS_DOT[agent.status])} />
          <p className={clsx("text-[13px] font-black tracking-tight truncate transition-colors", isImportant ? "text-white" : "text-slate-300 group-hover:text-white")}>
            {agent.name}
          </p>
        </div>
        <div className="flex items-center justify-between mt-1">
          <p className="text-[10px] text-slate-500 font-bold truncate uppercase tracking-wider">{agent.role.split('–')[0].split(',')[0].trim()}</p>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-600 font-mono font-black group-hover:text-slate-400">{runCount}R</span>
          </div>
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

  // Memoized sorted data
  const { ceoAgent, nonExecTeams, byTeam } = useMemo(() => {
    if (!agents) return { ceoAgent: undefined, nonExecTeams: [], byTeam: {} }

    const grouped = agents.reduce<Partial<Record<AgentTeam, Agent[]>>>((acc, a) => {
      acc[a.team] = [...(acc[a.team] ?? []), a]
      return acc
    }, {})

    // Sort agents within each team
    Object.keys(grouped).forEach((team) => {
      grouped[team as AgentTeam]?.sort((a, b) => (ROLE_RANK[a.id] ?? 99) - (ROLE_RANK[b.id] ?? 99))
    })

    const ceo = (grouped['executive'] ?? []).find((a) => a.id === 'ceo')
    const teams = TEAM_ORDER.filter((t) => t !== 'executive' && (grouped[t]?.length ?? 0) > 0)

    return { ceoAgent: ceo, nonExecTeams: teams, byTeam: grouped }
  }, [agents])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-10 h-10 border-4 border-[#00D4FF]/20 border-t-[#00D4FF] rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-10">
        <div className="max-w-md text-center p-8 rounded-2xl border border-rose-500/20 bg-rose-500/[0.05]">
          <p className="text-rose-400 font-black uppercase tracking-widest mb-2 text-sm">System Error</p>
          <p className="text-slate-400 text-sm font-medium">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full flex flex-col animate-fade-in pb-20">
      
      {/* Top Controls Bar */}
      <div className="flex-shrink-0 flex items-center justify-between mb-8 px-4 py-3 bg-white/[0.02] border border-white/[0.05] rounded-2xl">
        <div className="flex items-center gap-4">
          <div className="px-3 py-1 rounded-lg bg-[#00D4FF]/10 border border-[#00D4FF]/20">
             <p className="text-[10px] font-black text-[#00D4FF] uppercase tracking-[0.2em]">Deployment Status</p>
          </div>
          <p className="text-xs text-slate-500 font-bold">
            {agents.length} Active Nodes • {agents.filter(a => a.status === 'online').length} Synchronized
          </p>
        </div>
        <div className="flex items-center gap-6">
           <div className="flex items-center gap-2">
             <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
             <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Load Balanced</span>
           </div>
           <div className="h-4 w-px bg-white/10" />
           <p className="text-[11px] font-mono font-bold text-slate-500 tracking-tighter">REF: T-064-SYNC</p>
        </div>
      </div>

      {/* Main Org Viewport */}
      <div className="flex-1 relative flex flex-col items-center pt-4">
        
        {/* Hierarchy Layers Container */}
        <div className="w-full max-w-[1400px] flex flex-col items-center">
          
          {/* Layer 1: Founder */}
          <FounderNode />

          {/* Layer 2: CEO */}
          <CeoNode agent={ceoAgent} onClick={setSelectedAgent} />

          {/* Layer 3: Teams Grid */}
          <div className="mt-20 w-full relative">
            
            {/* SVG Complex Connectors */}
            <div className="absolute top-[-80px] left-0 right-0 h-20 pointer-events-none">
              <svg className="w-full h-full" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="org-grad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="rgba(0,212,255,0.4)" />
                    <stop offset="100%" stopColor="rgba(255,255,255,0.05)" />
                  </linearGradient>
                </defs>
                {/* Main vertical stem */}
                <line x1="50%" y1="0" x2="50%" y2="40" stroke="url(#org-grad)" strokeWidth="2" strokeDasharray="4 4" />
                {/* Horizontal spreader */}
                <line x1="8%" y1="40" x2="92%" y2="40" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
                
                {nonExecTeams.map((_, idx) => {
                  const x = 8 + (idx * (84 / (nonExecTeams.length - 1 || 1)))
                  return (
                    <g key={idx}>
                      <line x1={`${x}%`} y1="40" x2={`${x}%`} y2="80" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
                      <circle cx={`${x}%`} cy="40" r="3" fill="rgba(255,255,255,0.2)" />
                    </g>
                  )
                })}
              </svg>
            </div>

            {/* Glassmorphic Team Columns */}
            <div className="grid gap-6 px-4 pb-12" style={{ gridTemplateColumns: `repeat(${nonExecTeams.length}, minmax(0, 1fr))` }}>
              {nonExecTeams.map((team) => {
                const meta = TEAM_META[team]
                const teamAgents = byTeam[team] ?? []
                
                return (
                  <div key={team} className="flex flex-col gap-5">
                    {/* Team Header Panel */}
                    <div className={clsx(
                      "rounded-2xl border-2 p-5 text-center relative overflow-hidden group transition-all duration-500",
                      meta.border, meta.bg, "backdrop-blur-md",
                      "hover:shadow-2xl hover:-translate-y-1",
                      `hover:shadow-[0_20px_40px_${meta.glow}]`
                    )}>
                      {/* Depth effect: subtle background gradient */}
                      <div className={clsx("absolute inset-0 opacity-10 bg-gradient-to-br from-white to-transparent", meta.color.replace('text-', 'bg-'))} />
                      
                      <h5 className={clsx("relative z-10 text-[11px] font-black uppercase tracking-[0.3em] mb-1", meta.color)}>
                        {meta.label}
                      </h5>
                      <div className="relative z-10 flex items-center justify-center gap-2">
                        <span className="text-[9px] text-slate-500 font-mono font-black">{teamAgents.length} UNITS</span>
                        <div className="w-1 h-1 rounded-full bg-slate-700" />
                        <span className="text-[9px] text-slate-500 font-mono font-black">ACTIVE</span>
                      </div>
                    </div>

                    {/* Agent Cards Stack */}
                    <div className="flex flex-col gap-3">
                      {teamAgents.map(agent => (
                        <AgentCard 
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
      </div>

      {/* Unified Sidebar Overlay */}
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
