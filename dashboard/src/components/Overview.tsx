// ============================================================
// WAI Dashboard – Mission Control Overview (T068)
// High-tech HUD design, System Heartbeat, and Terminal Feed.
// ============================================================

import { useState, useEffect, useMemo } from 'react'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import { Stat } from './ui/Stat.js'
import { Badge } from './ui/Badge.js'
import { Panel } from './ui/Panel.js'
import { Icon } from './ui/Icon.js'
import {
  useAgents,
  useEvents,
  useTasks,
  useProjectState,
  useRecentRuns,
  usePayments
} from '../hooks/useSupabaseRealtime.js'
import type { Agent, AgentStatus, Task, SystemEvent } from '../types/index.js'

// ---------------------------------------------------------------------------
// Constants & Styles
// ---------------------------------------------------------------------------

const STATUS_DOT: Record<AgentStatus, string> = {
  online:  'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]',
  busy:    'bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.6)]',
  offline: 'bg-slate-700',
  error:   'bg-rose-400 animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.6)]',
}

const TEAM_ACCENT: Record<string, string> = {
  executive:  'text-[#00D4FF]',
  saas:       'text-violet-400',
  dev:        'text-emerald-400',
  consulting: 'text-cyan-400',
  marketing:  'text-amber-400',
  ops:        'text-slate-400',
}

// ---------------------------------------------------------------------------
// Sub-component: System Heartbeat (Animated Wave)
// ---------------------------------------------------------------------------

function SystemHeartbeat({ activityLevel }: { activityLevel: number }) {
  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-black/40 border border-white/5 rounded-xl overflow-hidden relative">
      <div className="flex flex-col relative z-10">
        <span className="text-[8px] font-black text-slate-600 uppercase tracking-widest leading-none">System Frequency</span>
        <span className="text-xs font-mono font-bold text-emerald-400 mt-1">{activityLevel.toFixed(1)} Hz</span>
      </div>
      <div className="flex-1 h-8 flex items-center justify-center relative z-10">
        <svg viewBox="0 0 200 40" className="w-full h-full stroke-emerald-500/40 fill-none stroke-1">
          <path d="M0 20 Q 25 20, 40 20 T 50 10 T 60 30 T 70 20 T 90 20 T 100 5 T 110 35 T 120 20 T 150 20 T 170 20 T 200 20" strokeDasharray="400" strokeDashoffset="400">
            <animate attributeName="stroke-dashoffset" from="400" to="0" dur="2s" repeatCount="indefinite" />
          </path>
          <path d="M0 20 Q 25 20, 40 20 T 50 15 T 60 25 T 70 20 T 90 20 T 100 10 T 110 30 T 120 20 T 150 20 T 170 20 T 200 20" className="opacity-30">
             <animate attributeName="d" values="M0 20 Q 25 20, 40 20 T 50 15 T 60 25 T 70 20 T 90 20 T 100 10 T 110 30 T 120 20 T 150 20 T 170 20 T 200 20; M0 20 Q 25 20, 40 20 T 50 5 T 60 35 T 70 20 T 90 20 T 100 0 T 110 40 T 120 20 T 150 20 T 170 20 T 200 20; M0 20 Q 25 20, 40 20 T 50 15 T 60 25 T 70 20 T 90 20 T 100 10 T 110 30 T 120 20 T 150 20 T 170 20 T 200 20" dur="3s" repeatCount="indefinite" />
          </path>
        </svg>
      </div>
      <div className="absolute top-0 right-0 w-16 h-full bg-gradient-to-l from-emerald-500/5 to-transparent pointer-events-none" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-component: Terminal Feed
// ---------------------------------------------------------------------------

function TerminalFeed({ events }: { events: SystemEvent[] }) {
  return (
    <div className="flex flex-col h-full bg-black/60 border border-white/5 rounded-2xl overflow-hidden font-mono text-[11px] relative group">
      {/* Scanline effect - added pointer-events-none to fix bug */}
      <div className="absolute inset-0 pointer-events-none bg-scanline opacity-[0.03] z-20" />
      
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-white/[0.02] relative z-10">
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <div className="w-2 h-2 rounded-full bg-rose-500/40" />
            <div className="w-2 h-2 rounded-full bg-amber-500/40" />
            <div className="w-2 h-2 rounded-full bg-emerald-500/40" />
          </div>
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Live Activity Log</span>
        </div>
        <span className="text-[9px] text-emerald-500/60 animate-pulse">REC ●</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar relative z-10">
        {events.length === 0 ? (
          <div className="flex items-center gap-2 text-slate-700">
            <span className="animate-blink">_</span>
            <span>Waiting for system input...</span>
          </div>
        ) : (
          events.map((e, idx) => (
            <div key={e.id} className={clsx(
              "flex items-start gap-3 transition-opacity duration-500",
              idx === 0 ? "text-emerald-400" : "text-slate-400 opacity-70"
            )}>
              <span className="text-slate-600 shrink-0">[{new Date(e.created_at).toLocaleTimeString('it-IT', { hour12: false })}]</span>
              <span className={clsx(
                "shrink-0 px-1 rounded",
                e.severity === 'error' || e.severity === 'critical' ? 'bg-rose-500/20 text-rose-400' :
                e.severity === 'warning' ? 'bg-amber-500/20 text-amber-400' : 'bg-sky-500/10 text-sky-400'
              )}>
                {e.type.toUpperCase()}
              </span>
              <span className="truncate">
                {e.payload['message'] || JSON.stringify(e.payload).slice(0, 60)}
              </span>
              {idx === 0 && <span className="animate-blink">_</span>}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mission Header
// ---------------------------------------------------------------------------

function MissionHeader({ state, onlineCount, agentTotal }: { state: any; onlineCount: number; agentTotal: number }) {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="relative group rounded-3xl overflow-hidden border border-white/10 bg-[#070C1A]">
      <div className="absolute inset-0 bg-gradient-to-br from-[#00D4FF]/10 via-transparent to-transparent opacity-50 pointer-events-none" />
      {/* Decorative corners */}
      <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-[#00D4FF]/30 rounded-tl-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-[#00D4FF]/30 rounded-br-3xl pointer-events-none" />

      <div className="relative px-8 py-8 flex flex-col md:flex-row items-center justify-between gap-8 z-10">
        <div className="flex items-center gap-6">
          <div className="w-16 h-16 rounded-2xl bg-[#00D4FF]/5 border border-[#00D4FF]/20 flex items-center justify-center animate-float">
            <svg viewBox="0 0 32 32" className="w-8 h-8 stroke-[#00D4FF] fill-none stroke-[1.5]">
              <path d="M16 2L29 9v14L16 30 3 23V9L16 2Z" />
              <path d="M16 8v16M8 12l16 8M8 20l16-8" className="opacity-40" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-3 mb-1.5">
              <h1 className="text-2xl font-black text-white tracking-tighter uppercase italic leading-none">Mission Control</h1>
              <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-black uppercase tracking-widest">
                Operational
              </span>
            </div>
            <p className="text-sm text-slate-500 font-mono tracking-tight">
              {state?.current_milestone || 'Initializing WAI Core...'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-12">
          <div className="hidden lg:flex flex-col items-end">
            <span className="text-[10px] font-black text-slate-600 uppercase tracking-[0.25em] mb-1">System Clock</span>
            <span className="text-2xl font-mono font-black text-white tracking-tighter">
              {time.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-black text-slate-600 uppercase tracking-[0.25em] mb-1">Grid Sync</span>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-mono font-black text-[#00D4FF] tracking-tighter">
                {Math.round((onlineCount / (agentTotal || 1)) * 100)}%
              </span>
              <div className="w-12 h-2 rounded-full bg-white/5 border border-white/10 overflow-hidden">
                <div className="h-full bg-[#00D4FF] shadow-[0_0_10px_#00D4FF]" style={{ width: `${Math.round((onlineCount / (agentTotal || 1)) * 100)}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function Overview() {
  const { data: agents, loading: aLoad } = useAgents()
  const { data: tasks,  loading: tLoad } = useTasks()
  const { data: events, loading: eLoad } = useEvents(20)
  const { state,        loading: sLoad } = useProjectState()
  const { data: runs                    } = useRecentRuns(50)
  const { data: payments                } = usePayments()

  const loading = aLoad || tLoad || eLoad || sLoad

  // Derived metrics
  const onlineCount = agents.filter(a => a.status === 'online').length
  const busyCount = agents.filter(a => a.status === 'busy').length
  const activeTasks = tasks.filter(t => t.status === 'in_progress')
  const completedTasks = tasks.filter(t => t.status === 'done').slice(0, 5)
  const budgetPct = state ? (state.monthly_cost_usd / state.monthly_budget_usd) * 100 : 0
  
  const totalRevenue = useMemo(() => {
    return payments.reduce((acc, p) => acc + Number(p.amount_usd), 0)
  }, [payments])

  const activityFrequency = useMemo(() => {
    const recent = runs.filter(r => {
      const age = Date.now() - new Date(r.created_at).getTime()
      return age < 300_000 // 5 minutes
    }).length
    return (recent / 5) || 0.2 // Hz
  }, [runs])

  const byTeam = agents.reduce<Record<string, Agent[]>>((acc, a) => {
    acc[a.team] = [...(acc[a.team] ?? []), a]
    return acc
  }, {})

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-200px)]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-[#00D4FF]/20 border-t-[#00D4FF] rounded-full animate-spin" />
          <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em]">Synching Neural Grid...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      
      {/* ── Mission Control Header ── */}
      <MissionHeader state={state} onlineCount={onlineCount} agentTotal={agents.length} />

      {/* ── HUD KPI Grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Agent Fleet */}
        <div className="group relative rounded-2xl border border-white/5 bg-white/[0.02] p-5 transition-all hover:bg-white/[0.04] overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#00D4FF]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          <div className="flex justify-between items-start mb-4 relative z-10">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Agent Fleet</span>
            <Icon name="agents" size={14} className="text-[#00D4FF]" />
          </div>
          <p className="text-3xl font-mono font-black text-white tracking-tighter relative z-10">{onlineCount}<span className="text-slate-700 text-xl mx-1">/</span>{agents.length}</p>
          <div className="mt-4 flex items-center gap-2 relative z-10">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[10px] font-bold text-slate-500 uppercase">{busyCount} Nodes Engaged</span>
          </div>
        </div>

        {/* Operational Load */}
        <div className="group relative rounded-2xl border border-white/5 bg-white/[0.02] p-5 transition-all hover:bg-white/[0.04] overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-sky-400/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          <div className="flex justify-between items-start mb-4 relative z-10">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Operational Load</span>
            <Icon name="tasks" size={14} className="text-sky-400" />
          </div>
          <p className="text-3xl font-mono font-black text-white tracking-tighter relative z-10">{activeTasks.length}</p>
          <div className="mt-4 flex items-center gap-2 relative z-10">
            <span className="text-[10px] font-bold text-slate-500 uppercase">Active Threads</span>
          </div>
        </div>

        {/* Resource Burn */}
        <div className="group relative rounded-2xl border border-white/5 bg-white/[0.02] p-5 transition-all hover:bg-white/[0.04] overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-400/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          <div className="flex justify-between items-start mb-4 relative z-10">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Resource Burn</span>
            <Icon name="costs" size={14} className="text-emerald-400" />
          </div>
          <p className="text-3xl font-mono font-black text-white tracking-tighter relative z-10">${(state?.monthly_cost_usd ?? 0).toFixed(2)}</p>
          <div className="mt-4 w-full h-1 bg-white/5 rounded-full overflow-hidden relative z-10">
            <div className={clsx("h-full transition-all duration-1000", budgetPct > 80 ? 'bg-rose-500 shadow-[0_0_8px_#f43f5e]' : 'bg-emerald-500 shadow-[0_0_8px_#10b981]')} style={{ width: `${Math.min(budgetPct, 100)}%` }} />
          </div>
        </div>

        {/* Financial Pulse */}
        <div className="group relative rounded-2xl border border-white/5 bg-white/[0.02] p-5 transition-all hover:bg-white/[0.04] overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-400/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          <div className="flex justify-between items-start mb-4 relative z-10">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Financial Pulse</span>
            <Icon name="revenue" size={14} className="text-amber-400" />
          </div>
          <p className="text-3xl font-mono font-black text-white tracking-tighter relative z-10">${totalRevenue.toLocaleString()}</p>
          <div className="mt-4 flex items-center gap-2 relative z-10">
            <span className="text-[10px] font-bold text-slate-500 uppercase">Gross Revenue</span>
          </div>
        </div>
      </div>

      {/* ── Center Operational Section ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* Terminal Log — 2/3 */}
        <div className="xl:col-span-2 h-[450px]">
          <TerminalFeed events={events} />
        </div>

        {/* Node Matrix — 1/3 */}
        <div className="h-[450px] bg-white/[0.02] border border-white/5 rounded-2xl p-6 overflow-hidden flex flex-col relative group">
          <div className="absolute inset-0 bg-scanline opacity-[0.01] pointer-events-none" />
          <div className="flex items-center justify-between mb-6 relative z-10">
            <h3 className="text-[11px] font-black text-white uppercase tracking-[0.25em]">Neural Grid</h3>
            <span className="text-[9px] font-mono text-slate-600 uppercase">Status Monitor</span>
          </div>
          
          <div className="flex-1 overflow-y-auto space-y-6 custom-scrollbar pr-2 relative z-10">
            {['executive', 'saas', 'dev', 'consulting', 'marketing', 'ops'].map(team => {
              const teamAgents = byTeam[team] || []
              if (teamAgents.length === 0) return null
              return (
                <div key={team} className="space-y-3">
                  <h4 className={clsx("text-[9px] font-black uppercase tracking-widest border-b border-white/5 pb-1", TEAM_ACCENT[team])}>
                    {team}
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    {teamAgents.map(a => (
                      <div key={a.id} className="flex items-center gap-2 p-1.5 rounded-lg bg-black/20 border border-white/[0.02] transition-all hover:border-white/10 hover:bg-black/40">
                        <span className={clsx("w-1.5 h-1.5 rounded-full flex-shrink-0", STATUS_DOT[a.status])} />
                        <span className="text-[10px] font-mono text-slate-400 truncate">{a.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── System Frequency & Stability Row ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <SystemHeartbeat activityLevel={activityFrequency} />
          <div className="bg-white/[0.02] border border-white/5 rounded-xl px-6 py-4 flex items-center justify-between">
             <div className="flex flex-col">
                <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Network Stability Index</span>
                <p className="text-sm font-mono font-bold text-emerald-400 mt-1">OPTIMAL <span className="text-slate-500 ml-2">99.98%</span></p>
             </div>
             <div className="flex gap-1">
                {[1,2,3,4,5,6,7,8].map(i => (
                  <div key={i} className="w-1 h-4 bg-emerald-500/20 rounded-full overflow-hidden">
                    <div className="w-full h-full bg-emerald-500 animate-pulse" style={{ animationDelay: `${i * 100}ms` }} />
                  </div>
                ))}
             </div>
          </div>
      </div>

      {/* ── Active & Recent Tasks Row ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Active Objectives */}
        <Panel title="Active Objectives" accent="sky">
          {activeTasks.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-xs text-slate-600 font-mono uppercase tracking-widest italic">All primary objectives completed</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeTasks.slice(0, 4).map(t => (
                <div key={t.id} className="p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:border-[#00D4FF]/20 transition-all group">
                  <div className="flex justify-between items-start mb-2">
                    <Badge variant={`p${t.priority}`}>P{t.priority}</Badge>
                    <span className="text-[9px] font-mono text-slate-600 uppercase">Target: {t.assignee_agent_id}</span>
                  </div>
                  <h4 className="text-xs font-bold text-slate-200 group-hover:text-white transition-colors line-clamp-1">{t.title}</h4>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Recent Intelligence (Output) */}
        <Panel title="Recent System Output" accent="emerald">
          {completedTasks.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-xs text-slate-600 font-mono uppercase tracking-widest italic">No recently completed tasks</p>
            </div>
          ) : (
            <div className="space-y-3">
              {completedTasks.map(t => (
                <div key={t.id} className="p-4 rounded-xl bg-emerald-500/[0.02] border border-emerald-500/5 hover:border-emerald-500/20 transition-all group">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">SUCCESS</span>
                    <span className="text-[9px] font-mono text-slate-600 uppercase">
                      {t.completed_at ? formatDistanceToNow(new Date(t.completed_at), { addSuffix: true }) : 'Recently'}
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-slate-200 group-hover:text-white transition-colors line-clamp-1">{t.title}</h4>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
