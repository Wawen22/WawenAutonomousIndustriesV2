// ============================================================
// WAI Dashboard – Agent Detail Sidebar (Unified)
// Slide-in panel showing agent info, stats, tasks, runs, events.
// ============================================================

import { useEffect } from 'react'
import { clsx } from 'clsx'
import { createPortal } from 'react-dom'
import type { Agent, AgentStatus, AgentRun, Task, SystemEventWithContext, AgentTeam } from '../types/index.js'

// ---------------------------------------------------------------------------
// Constants & Styles
// ---------------------------------------------------------------------------

const TEAM_META: Record<AgentTeam, { label: string; color: string; bg: string }> = {
  executive:  { label: 'Executive',       color: 'text-[#00D4FF]',   bg: 'bg-[#00D4FF]/[0.04]' },
  saas:       { label: 'SaaS',            color: 'text-violet-400',  bg: 'bg-violet-400/[0.04]' },
  dev:        { label: 'Custom Software', color: 'text-emerald-400', bg: 'bg-emerald-400/[0.04]' },
  consulting: { label: 'Consulting',      color: 'text-cyan-400',    bg: 'bg-cyan-400/[0.04]' },
  marketing:  { label: 'Marketing',       color: 'text-amber-400',   bg: 'bg-amber-400/[0.04]' },
  ops:        { label: 'Ops / Finance / HR', color: 'text-slate-400', bg: 'bg-slate-400/[0.03]' },
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function severityColor(s: string): string {
  if (s === 'error' || s === 'critical') return 'text-rose-400'
  if (s === 'warning') return 'text-amber-400'
  return 'text-slate-500'
}

function eventPayloadSummary(payload: Record<string, unknown>): string {
  const msg = payload['message'] ?? payload['description'] ?? payload['summary'] ?? payload['text']
  if (typeof msg === 'string' && msg.trim()) return msg.slice(0, 120)
  return JSON.stringify(payload).slice(0, 120)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AgentDetailSidebarProps {
  agent: Agent
  lastRuns: AgentRun[]
  runCount: number
  activeTasks: Task[]
  recentEvents: SystemEventWithContext[]
  onClose: () => void
}

export function AgentDetailSidebar({
  agent,
  lastRuns,
  runCount,
  activeTasks,
  recentEvents,
  onClose,
}: AgentDetailSidebarProps) {
  const teamMeta = TEAM_META[agent.team] ?? TEAM_META.ops
  const modelStyle = MODEL_BADGE[agent.model_id] ?? { text: 'text-slate-400', bg: 'bg-slate-400/10' }
  const myTasks = activeTasks.filter((t) => t.assignee_agent_id === agent.id)
  const myEvents = recentEvents.filter((e) => e.agent_id === agent.id).slice(0, 10)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const initials = agent.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

  return createPortal(
    <div className="fixed inset-0 z-[100] flex justify-end" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" />
      
      {/* Panel */}
      <div
        className={clsx(
          "relative w-full max-w-[400px] h-full bg-[#070C1A] border-l border-white/[0.08] flex flex-col shadow-[-20px_0_80px_rgba(0,0,0,0.8)] animate-slide-in-right"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={clsx('px-6 py-6 border-b border-white/[0.07] flex items-center gap-4', teamMeta.bg)}>
          <div className={clsx(
            'w-14 h-14 rounded-2xl flex items-center justify-center font-black text-lg border-2 shadow-lg transition-transform hover:scale-105',
            modelStyle.bg, modelStyle.text,
            agent.model_id === 'gpt-5.4' ? 'border-[#00D4FF]/30' : 'border-violet-400/30'
          )}>
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className={clsx('w-2.5 h-2.5 rounded-full flex-shrink-0 shadow-sm', STATUS_DOT[agent.status])} />
              <h2 className="text-base font-bold text-white truncate tracking-tight">{agent.name}</h2>
            </div>
            <div className="flex items-center gap-2">
              <p className={clsx('text-[10px] font-bold uppercase tracking-[0.2em]', teamMeta.color)}>
                {teamMeta.label}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/[0.03] text-slate-500 hover:text-white hover:bg-white/[0.08] transition-all"
          >
            ✕
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">

          {/* Role Section */}
          <section>
            <h3 className="text-[10px] text-slate-500 uppercase tracking-[0.2em] font-black mb-3">Professional Profile</h3>
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-4">
              <p className="text-[13px] text-slate-300 leading-relaxed font-medium">
                {agent.role}
              </p>
              <div className="mt-4 pt-4 border-t border-white/[0.05] flex items-center justify-between">
                <span className="text-[10px] text-slate-500 font-mono">Model Architecture</span>
                <span className={clsx('text-[10px] font-bold font-mono px-2 py-0.5 rounded border border-white/5', modelStyle.bg, modelStyle.text)}>
                  {agent.model_id}
                </span>
              </div>
            </div>
          </section>

          {/* Vital Stats */}
          <section className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3 text-center transition-colors hover:bg-white/[0.04]">
              <p className="text-xl font-black text-white">{runCount}</p>
              <p className="text-[9px] text-slate-600 uppercase tracking-widest font-bold mt-1">Total Runs</p>
            </div>
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3 text-center transition-colors hover:bg-white/[0.04]">
              <p className="text-xl font-black text-white">{myTasks.length}</p>
              <p className="text-[9px] text-slate-600 uppercase tracking-widest font-bold mt-1">Active Tasks</p>
            </div>
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3 text-center transition-colors hover:bg-white/[0.04]">
              <p className="text-xl font-black text-emerald-400">99<span className="text-[10px]">%</span></p>
              <p className="text-[9px] text-slate-600 uppercase tracking-widest font-bold mt-1">Reliability</p>
            </div>
          </section>

          {/* Active Work Section */}
          {myTasks.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[10px] text-slate-500 uppercase tracking-[0.2em] font-black">Current Engagement</h3>
                <span className="px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-400 text-[9px] font-bold border border-amber-400/20">LIVE</span>
              </div>
              <div className="space-y-2">
                {myTasks.slice(0, 3).map((t) => (
                  <div key={t.id} className="group relative rounded-xl border border-amber-400/20 bg-amber-400/[0.03] p-4 transition-all hover:bg-amber-400/[0.06]">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[12px] text-white font-bold leading-tight group-hover:text-amber-300 transition-colors">{t.title}</p>
                      <span className="text-[9px] font-mono text-amber-400/60 uppercase">{t.type}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Recent Operations (Last Runs) */}
          <section>
            <h3 className="text-[10px] text-slate-500 uppercase tracking-[0.2em] font-black mb-3">Operational History</h3>
            {lastRuns.length === 0 ? (
              <div className="rounded-xl border border-white/[0.05] bg-white/[0.01] p-8 text-center">
                <p className="text-[11px] text-slate-700 font-medium italic italic">Zero operational records found</p>
              </div>
            ) : (
              <div className="space-y-3">
                {lastRuns.slice(0, 5).map((run) => (
                  <div key={run.id} className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-4 transition-all hover:border-white/[0.1]">
                    <div className="flex items-center justify-between mb-2">
                      <span className={clsx(
                        'text-[9px] font-black uppercase px-2 py-0.5 rounded-md tracking-wider',
                        run.outcome === 'success' ? 'bg-emerald-400/10 text-emerald-400' :
                        run.outcome === 'failure' ? 'bg-rose-400/10 text-rose-400' :
                        'bg-amber-400/10 text-amber-400',
                      )}>
                        {run.outcome}
                      </span>
                      <span className="text-[9px] text-slate-600 font-mono font-medium">
                        {new Date(run.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed font-medium mb-3">
                      {run.output_summary || run.input_summary || 'No summary available'}
                    </p>
                    <div className="flex items-center gap-3 pt-3 border-t border-white/[0.03] text-[9px] font-mono text-slate-600">
                      <span>COST: <span className="text-slate-400">${run.cost_usd.toFixed(4)}</span></span>
                      <span>•</span>
                      <span>TIME: <span className="text-slate-400">{run.duration_ms}ms</span></span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* System Telemetry (Recent Events) */}
          {myEvents.length > 0 && (
            <section className="pb-8">
              <h3 className="text-[10px] text-slate-500 uppercase tracking-[0.2em] font-black mb-3">System Telemetry</h3>
              <div className="space-y-2">
                {myEvents.map((ev) => (
                  <div key={ev.id} className="rounded-lg border border-white/[0.04] bg-white/[0.01] px-3 py-2.5 flex items-start gap-3">
                    <div className={clsx('w-1 h-1 rounded-full mt-1.5 flex-shrink-0', 
                      ev.severity === 'error' || ev.severity === 'critical' ? 'bg-rose-400 shadow-[0_0_4px_rgba(251,113,133,0.5)]' :
                      ev.severity === 'warning' ? 'bg-amber-400' : 'bg-slate-600'
                    )} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className={clsx('text-[10px] font-mono font-bold truncate tracking-tight', severityColor(ev.severity))}>
                          {ev.type}
                        </span>
                        <span className="text-[9px] text-slate-700 font-mono flex-shrink-0">
                          {new Date(ev.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </div>
                      {Object.keys(ev.payload).length > 0 && (
                        <p className="text-[10px] text-slate-500 line-clamp-1 font-medium italic">
                          {eventPayloadSummary(ev.payload)}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
