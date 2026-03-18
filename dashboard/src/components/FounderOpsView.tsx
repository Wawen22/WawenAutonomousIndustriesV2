// ============================================================
// WAI Dashboard – Founder Action Center (T070)
// High-tension decision HQ for the only human in the system.
// ============================================================

import { useMemo, useState } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { Panel } from './ui/Panel.js'
import { Badge } from './ui/Badge.js'
import { Icon } from './ui/Icon.js'
import {
  useClients,
  useEventsWithContext,
  usePayments,
  useProjects,
  useProjectState,
  useReviewRequestedTasks,
  useTasks,
} from '../hooks/useSupabaseRealtime.js'
import type { Task } from '../types/index.js'

const BACKEND_URL = (import.meta.env['VITE_BACKEND_URL'] as string | undefined) ?? 'http://localhost:3001'

type FounderTaskAction = 'retry' | 'approve' | 'reject'

interface ActionState {
  pending: boolean
  message: string | null
  error: string | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMeta(task: Task, key: string): string {
  const value = task.metadata[key]
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function formatUsd(amount: number): string {
  return `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
}

// ---------------------------------------------------------------------------
// API Calls
// ---------------------------------------------------------------------------

async function runFounderTaskAction(taskId: string, action: FounderTaskAction, reason?: string): Promise<string> {
  const response = await fetch(`${BACKEND_URL}/api/founder/task-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, action, reason }),
  })
  const payload = await response.json() as { error?: string; message?: string }
  if (!response.ok) throw new Error(payload.error ?? 'Action failed')
  return payload.message ?? 'Action completed.'
}

// ---------------------------------------------------------------------------
// Sub-components: Strategic UI
// ---------------------------------------------------------------------------

function BlockedAlertCard({ task, state, onRetry, onReject }: { task: Task; state?: ActionState; onRetry: any; onReject: any }) {
  const rawError = getMeta(task, 'blocked_reason') || getMeta(task, 'error') || 'Critical node failure'
  
  return (
    <div className="relative group overflow-hidden rounded-2xl border-2 border-rose-500/30 bg-rose-500/[0.03] p-5 transition-all hover:bg-rose-500/[0.06]">
      <div className="absolute top-0 right-0 p-4 opacity-20 group-hover:opacity-40 transition-opacity">
        <Icon name="alert" size={40} className="text-rose-500" />
      </div>
      
      <div className="relative z-10 space-y-4">
        <div className="flex items-center gap-3">
          <span className="flex h-2 w-2 rounded-full bg-rose-500 animate-ping" />
          <h4 className="text-[10px] font-black text-rose-500 uppercase tracking-[0.3em]">Emergency Directive Required</h4>
        </div>

        <div className="space-y-1">
          <h3 className="text-lg font-black text-white leading-tight uppercase italic">{task.title}</h3>
          <p className="text-[11px] text-slate-400 font-mono">NODE: {task.assignee_agent_id?.toUpperCase() || 'UNASSIGNED'} • ID: {task.id.slice(0,8)}</p>
        </div>

        <div className="bg-black/40 border border-rose-500/20 rounded-xl p-3 font-mono text-[11px] text-rose-200/80 leading-relaxed italic">
          &gt; ERROR_LOG: {rawError}
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => onRetry(task)}
            disabled={state?.pending}
            className="flex-1 bg-white text-black font-black text-[11px] uppercase py-3 rounded-xl hover:bg-[#00D4FF] transition-all disabled:opacity-50"
          >
            {state?.pending ? 'Processing...' : 'Force Retry'}
          </button>
          <button 
            onClick={() => onReject(task)}
            disabled={state?.pending}
            className="px-6 border-2 border-rose-500/40 text-rose-500 font-black text-[11px] uppercase py-3 rounded-xl hover:bg-rose-500 hover:text-white transition-all disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
        {state?.message && <p className="text-[10px] text-emerald-400 font-mono font-bold">✓ {state.message}</p>}
        {state?.error && <p className="text-[10px] text-rose-400 font-mono font-bold">⚠ {state.error}</p>}
      </div>
    </div>
  )
}

function ReviewRequestCard({ task, onApprove, onReject }: { task: Task; state?: ActionState; onApprove: any; onReject: any }) {
  return (
    <div className="relative rounded-2xl border border-violet-500/30 bg-violet-500/[0.03] p-5 space-y-4 hover:bg-violet-500/[0.06] transition-all">
      <div className="flex justify-between items-start">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="in_progress">HUMAN_REVIEW</Badge>
            <span className="text-[9px] font-mono text-slate-600">REQ_AT: {format(new Date(task.updated_at), 'HH:mm:ss')}</span>
          </div>
          <h3 className="text-base font-black text-white uppercase">{task.title}</h3>
        </div>
        <div className="w-10 h-10 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center font-black text-xs text-violet-400">
          {task.assignee_agent_id?.slice(0,2).toUpperCase()}
        </div>
      </div>

      <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-2 italic font-medium">"{task.description}"</p>

      <div className="flex gap-2">
        <button 
          onClick={() => onApprove(task)}
          className="flex-1 bg-violet-500 text-white font-black text-[10px] uppercase py-2.5 rounded-lg hover:bg-violet-400 transition-all shadow-[0_0_15px_rgba(139,92,246,0.3)]"
        >
          Approve Work
        </button>
        <button 
          onClick={() => onReject(task)}
          className="px-4 border border-violet-500/30 text-violet-400 font-black text-[10px] uppercase py-2.5 rounded-lg hover:bg-violet-500/10 transition-all"
        >
          Reject
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function FounderOpsView() {
  const { data: blockedTasks, loading: tasksLoading } = useTasks('blocked')
  const { data: reviewTasks, loading: reviewLoading } = useReviewRequestedTasks()
  const { data: projects, loading: projectsLoading } = useProjects()
  const { data: clients } = useClients()
  const { data: payments, loading: paymentsLoading } = usePayments()
  const { data: events } = useEventsWithContext(50)
  const { state: projectState } = useProjectState()
  
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({})

  const clientMap = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients])

  const totals = useMemo(() => {
    const outstandingUsd = projects
      .filter(p => p.status === 'invoiced')
      .reduce((sum, p) => {
        const paid = payments.filter(pay => pay.project_id === p.id).reduce((s, pay) => s + (pay.amount_usd ?? 0), 0)
        return sum + Math.max((p.contract_value_usd ?? 0) - paid, 0)
      }, 0)

    return {
      blocked: blockedTasks.length,
      pendingReview: reviewTasks.length,
      outstandingUsd,
    }
  }, [blockedTasks, reviewTasks, projects, payments])

  const loading = tasksLoading || reviewLoading || projectsLoading || paymentsLoading

  async function handleAction(key: string, fn: () => Promise<string>) {
    setActionStates(s => ({ ...s, [key]: { pending: true, message: null, error: null } }))
    try {
      const msg = await fn()
      setActionStates(s => ({ ...s, [key]: { pending: false, message: msg, error: null } }))
    } catch (err) {
      setActionStates(s => ({ ...s, [key]: { pending: false, message: null, error: err instanceof Error ? err.message : 'Unknown' } }))
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="w-12 h-12 border-4 border-[#00D4FF]/20 border-t-[#00D4FF] rounded-full animate-spin" />
        <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Accessing Secure Founder Node...</p>
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-fade-in pb-20">
      
      {/* ── Command Header ── */}
      <div className="relative overflow-hidden rounded-3xl border border-white/5 bg-[#070C1A] p-8">
        <div className="absolute inset-0 bg-gradient-to-r from-[#00D4FF]/5 via-transparent to-transparent pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="flex items-center gap-6">
            <div className="w-20 h-20 rounded-2xl bg-amber-400/10 border-2 border-amber-400/40 flex items-center justify-center relative shadow-[0_0_30px_rgba(251,191,36,0.15)]">
               <span className="text-4xl font-black text-amber-400 italic">N</span>
               <div className="absolute -top-2 -right-2 px-2 py-0.5 rounded bg-rose-500 text-white text-[8px] font-black uppercase animate-pulse">Root</div>
            </div>
            <div>
              <h1 className="text-2xl font-black text-white uppercase tracking-tighter italic">Central Command</h1>
              <p className="text-[11px] text-slate-500 font-mono tracking-widest mt-1 uppercase">Authentication Verified: Neb (Founder)</p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="text-right">
              <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Milestone Target</p>
              <p className="text-sm font-mono font-bold text-cyan-400 uppercase">{projectState?.current_milestone?.split(' - ')[0] || 'M7'}</p>
            </div>
            <div className="w-px h-8 bg-white/10" />
            <div className="text-right">
              <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Uncollected Capital</p>
              <p className="text-sm font-mono font-bold text-emerald-400 uppercase">{formatUsd(totals.outstandingUsd)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tactical Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Urgent Operations (Blocked + Reviews) */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Emergency Directives (Blocked) */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-black text-white uppercase tracking-[0.3em] flex items-center gap-3">
                <Icon name="alert" size={14} className="text-rose-500" />
                Active Impediments
              </h2>
              <span className="text-[10px] font-mono text-slate-600 uppercase font-bold">{blockedTasks.length} CRITICAL</span>
            </div>
            
            <div className="grid grid-cols-1 gap-4">
              {blockedTasks.length === 0 ? (
                <div className="py-12 rounded-2xl border-2 border-dashed border-white/5 flex items-center justify-center grayscale opacity-30">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">No blockages detected in neural grid</p>
                </div>
              ) : (
                blockedTasks.map(t => (
                  <BlockedAlertCard 
                    key={t.id} task={t} state={actionStates[`task:${t.id}`]}
                    onRetry={(task: Task) => handleAction(`task:${task.id}`, () => runFounderTaskAction(task.id, 'retry'))}
                    onReject={(task: Task) => handleAction(`task:${task.id}`, () => runFounderTaskAction(task.id, 'reject'))}
                  />
                ))
              )}
            </div>
          </section>

          {/* Executive Approvals */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-black text-white uppercase tracking-[0.3em] flex items-center gap-3">
                <Icon name="check" size={14} className="text-violet-400" />
                Human Validation
              </h2>
              <span className="text-[10px] font-mono text-slate-600 uppercase font-bold">{reviewTasks.length} PENDING</span>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {reviewTasks.map(t => (
                <ReviewRequestCard 
                  key={t.id} task={t} state={actionStates[`task:${t.id}`]}
                  onApprove={(task: Task) => handleAction(`task:${task.id}`, () => runFounderTaskAction(task.id, 'approve'))}
                  onReject={(task: Task) => handleAction(`task:${task.id}`, () => runFounderTaskAction(task.id, 'reject'))}
                />
              ))}
              {reviewTasks.length === 0 && (
                <div className="col-span-full py-8 text-center opacity-30">
                  <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest italic">All agent outputs verified</p>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Intelligence Side-bar (Revenue + Decisions) */}
        <div className="space-y-8">
          
          {/* Revenue Pipeline */}
          <Panel title="Revenue Pipeline" accent="emerald">
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="flex justify-between text-[10px] font-black uppercase">
                  <span className="text-slate-500">Pipeline Health</span>
                  <span className="text-emerald-400">Optimal</span>
                </div>
                <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 shadow-[0_0_10px_#10b981]" style={{ width: '75%' }} />
                </div>
              </div>

              <div className="space-y-4">
                {projects.filter(p => p.status === 'delivered' || p.status === 'review').slice(0,3).map(p => (
                  <div key={p.id} className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5 group hover:border-emerald-500/20 transition-all">
                    <div>
                      <p className="text-[11px] font-bold text-white truncate uppercase">{p.name}</p>
                      <p className="text-[9px] text-slate-600 font-mono mt-0.5">{clientMap.get(p.client_id)?.name}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] font-mono font-black text-emerald-400">{formatUsd(p.contract_value_usd || 0)}</p>
                      <button className="text-[8px] font-black text-[#00D4FF] uppercase tracking-tighter mt-1 opacity-0 group-hover:opacity-100 transition-opacity">Generate Invoice</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          {/* Executive Decision Log */}
          <Panel title="Recent Override Log" accent="violet">
            <div className="space-y-0 h-[300px] overflow-y-auto custom-scrollbar">
              {events.filter(e => e.type.includes('human_') || e.type.includes('task_unblocked')).slice(0, 10).map(e => (
                <div key={e.id} className="py-3 border-b border-white/5 last:border-0 flex items-start gap-3">
                  <div className="w-1 h-1 rounded-full bg-violet-500 mt-1.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline gap-2">
                      <p className="text-[10px] font-black text-slate-300 uppercase tracking-tight truncate">{e.type.replace(/_/g, ' ')}</p>
                      <span className="text-[8px] text-slate-600 font-mono whitespace-nowrap">{formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 font-medium italic mt-0.5 line-clamp-1">{String(e.payload['message'] || e.payload['title'] || '')}</p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
