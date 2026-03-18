import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { format, formatDistanceToNow } from 'date-fns'
import { Panel } from './ui/Panel.js'
import { Badge } from './ui/Badge.js'
import { Stat } from './ui/Stat.js'
import {
  useClients,
  useEventsWithContext,
  usePayments,
  useProjects,
  useProjectState,
  useReviewRequestedTasks,
  useTasks,
} from '../hooks/useSupabaseRealtime.js'
import { getClientColor } from '../lib/clientColors.js'
import type { Payment, Project, ProjectStatus, SystemEventWithContext, Task } from '../types/index.js'

const BACKEND_URL = (import.meta.env['VITE_BACKEND_URL'] as string | undefined) ?? 'http://localhost:3001'

type FounderTaskAction = 'retry' | 'approve' | 'reject'
type FounderRevenueAction = 'invoice' | 'mark_paid'

interface ActionState {
  pending: boolean
  message: string | null
  error: string | null
}

interface OutstandingRow {
  project: Project
  clientName: string
  clientSlug: string
  paidUsd: number
  outstandingUsd: number
  lastPaymentAt: string | null
}

function getMeta(task: Task, key: string): string {
  const value = task.metadata[key]
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`
}

function projectStatusVariant(status: ProjectStatus): string {
  switch (status) {
    case 'review':
      return 'in_progress'
    case 'blocked':
      return 'blocked'
    case 'delivered':
      return 'done'
    case 'active':
      return 'dev'
    case 'invoiced':
      return 'finance'
    default:
      return 'default'
  }
}

function founderEventVariant(type: string): string {
  switch (type) {
    case 'human_review_requested':
      return 'in_progress'
    case 'task_unblocked':
      return 'info'
    case 'human_approved':
      return 'done'
    case 'human_rejected':
      return 'blocked'
    case 'revenue_recorded':
      return 'finance'
    case 'payment_received':
      return 'finance'
    default:
      return 'default'
  }
}

function parsePromptAmount(raw: string | null): number | null {
  if (raw === null) return null
  const normalized = raw.trim().replace(',', '.')
  if (!normalized) return null
  const amount = Number(normalized)
  return Number.isFinite(amount) ? amount : Number.NaN
}

async function runFounderTaskAction(taskId: string, action: FounderTaskAction, reason?: string): Promise<string> {
  const response = await fetch(`${BACKEND_URL}/api/founder/task-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, action, reason }),
  })

  const payload = await response.json() as { error?: string; message?: string }
  if (!response.ok) {
    throw new Error(payload.error ?? 'Founder task action failed')
  }
  return payload.message ?? 'Action completed.'
}

async function runFounderRevenueAction(
  action: FounderRevenueAction,
  clientSlug: string,
  projectSlug: string,
  amountUsd?: number
): Promise<string> {
  const response = await fetch(`${BACKEND_URL}/api/founder/revenue-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, clientSlug, projectSlug, amountUsd }),
  })

  const payload = await response.json() as { error?: string; message?: string }
  if (!response.ok) {
    throw new Error(payload.error ?? 'Founder revenue action failed')
  }
  return payload.message ?? 'Action completed.'
}

function aggregatePayments(payments: Payment[]): Map<string, { paidUsd: number; lastPaymentAt: string | null }> {
  const map = new Map<string, { paidUsd: number; lastPaymentAt: string | null }>()

  for (const payment of payments) {
    const current = map.get(payment.project_id) ?? { paidUsd: 0, lastPaymentAt: null }
    const nextLastPaymentAt =
      !current.lastPaymentAt || new Date(payment.received_at).getTime() > new Date(current.lastPaymentAt).getTime()
        ? payment.received_at
        : current.lastPaymentAt

    map.set(payment.project_id, {
      paidUsd: current.paidUsd + (payment.amount_usd ?? 0),
      lastPaymentAt: nextLastPaymentAt,
    })
  }

  return map
}

function FounderOpsTaskCard({
  task,
  state,
  onRetry,
  onReject,
}: {
  task: Task
  state: ActionState | undefined
  onRetry: (task: Task) => Promise<void>
  onReject: (task: Task) => Promise<void>
}) {
  const clientName = getMeta(task, 'client_name')
  const projectName = getMeta(task, 'project_name')
  const projectType = getMeta(task, 'project_type')
  const clientColor = clientName ? getClientColor(clientName) : null
  const retryCount = typeof task.metadata['retry_count'] === 'number' ? task.metadata['retry_count'] : null
  const rawError = getMeta(task, 'blocked_reason') || getMeta(task, 'error')
  const blockedReason = rawError || [
    'Agent runtime failed or timed out (no error detail captured).',
    `Assignee: ${task.assignee_agent_id ?? 'none'}.`,
    retryCount !== null ? `Retry count: ${retryCount}.` : '',
    'Use Retry to re-dispatch, or Cancel to close.',
  ].filter(Boolean).join(' ')

  return (
    <div className="rounded-xl border border-orange-500/20 bg-orange-950/10 p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="blocked">blocked</Badge>
            <Badge variant={`p${task.priority}`}>P{task.priority}</Badge>
            <span className="text-[10px] font-mono text-slate-500">{task.id.slice(0, 8)}</span>
          </div>

          {(clientName || projectName) && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {clientName && clientColor && (
                <span
                  className={clsx(
                    'text-[10px] font-mono px-1.5 py-0.5 rounded border',
                    clientColor.bg,
                    clientColor.border,
                    clientColor.text
                  )}
                >
                  {clientName}
                </span>
              )}
              {projectName && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/40 text-cyan-300">
                  {projectType ? `${projectName} · ${projectType}` : projectName}
                </span>
              )}
            </div>
          )}

          <p className="text-sm font-medium text-white leading-snug">{task.title}</p>
        </div>

        <div className="text-right flex-shrink-0">
          <div className="text-[10px] text-slate-500 font-mono">
            {formatDistanceToNow(new Date(task.updated_at), { addSuffix: true })}
          </div>
          <div className="text-[11px] text-orange-300 font-mono mt-1">
            {task.assignee_agent_id ?? 'unassigned'}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-orange-300/85 font-mono whitespace-pre-wrap break-words">
        {blockedReason}
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => void onRetry(task)}
          disabled={state?.pending}
          className="px-2.5 py-1.5 rounded-md text-[11px] font-mono border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50 transition-colors"
        >
          {state?.pending ? 'Retrying…' : 'Retry'}
        </button>
        <button
          onClick={() => void onReject(task)}
          disabled={state?.pending}
          className="px-2.5 py-1.5 rounded-md text-[11px] font-mono border border-rose-500/25 text-rose-300 hover:bg-rose-500/10 disabled:opacity-50 transition-colors"
        >
          {state?.pending ? 'Cancelling…' : 'Cancel'}
        </button>
      </div>

      {state?.message && <p className="text-[11px] text-emerald-400 font-mono">{state.message}</p>}
      {state?.error && <p className="text-[11px] text-rose-400 font-mono">{state.error}</p>}
    </div>
  )
}

function ReviewTaskCard({
  task,
  state,
  onApprove,
  onReject,
}: {
  task: Task
  state: ActionState | undefined
  onApprove: (task: Task) => Promise<void>
  onReject: (task: Task) => Promise<void>
}) {
  const clientName = getMeta(task, 'client_name')
  const projectName = getMeta(task, 'project_name')
  const projectType = getMeta(task, 'project_type')
  const clientColor = clientName ? getClientColor(clientName) : null

  return (
    <div className="rounded-xl border border-violet-500/20 bg-violet-950/10 p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="in_progress">review</Badge>
            <Badge variant={`p${task.priority}`}>P{task.priority}</Badge>
            <span className="text-[10px] font-mono text-slate-500">{task.id.slice(0, 8)}</span>
          </div>

          {(clientName || projectName) && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {clientName && clientColor && (
                <span
                  className={clsx(
                    'text-[10px] font-mono px-1.5 py-0.5 rounded border',
                    clientColor.bg,
                    clientColor.border,
                    clientColor.text
                  )}
                >
                  {clientName}
                </span>
              )}
              {projectName && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/40 text-cyan-300">
                  {projectType ? `${projectName} · ${projectType}` : projectName}
                </span>
              )}
            </div>
          )}

          <p className="text-sm font-medium text-white leading-snug">{task.title}</p>
          {task.description && (
            <p className="text-[11px] text-slate-400 font-mono line-clamp-2">{task.description}</p>
          )}
        </div>

        <div className="text-right flex-shrink-0">
          <div className="text-[10px] text-slate-500 font-mono">
            {formatDistanceToNow(new Date(task.updated_at), { addSuffix: true })}
          </div>
          <div className="text-[11px] text-violet-300 font-mono mt-1">
            {task.assignee_agent_id ?? 'unassigned'}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => void onApprove(task)}
          disabled={state?.pending}
          className="px-2.5 py-1.5 rounded-md text-[11px] font-mono border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50 transition-colors"
        >
          {state?.pending ? 'Approving…' : 'Approve'}
        </button>
        <button
          onClick={() => void onReject(task)}
          disabled={state?.pending}
          className="px-2.5 py-1.5 rounded-md text-[11px] font-mono border border-rose-500/25 text-rose-300 hover:bg-rose-500/10 disabled:opacity-50 transition-colors"
        >
          {state?.pending ? 'Rejecting…' : 'Reject'}
        </button>
      </div>

      {state?.message && <p className="text-[11px] text-emerald-400 font-mono">{state.message}</p>}
      {state?.error && <p className="text-[11px] text-rose-400 font-mono">{state.error}</p>}
    </div>
  )
}

function InvoiceQueueCard({
  project,
  clientName,
  clientSlug,
  state,
  onInvoice,
}: {
  project: Project
  clientName: string
  clientSlug: string
  state: ActionState | undefined
  onInvoice: (project: Project, clientSlug: string) => Promise<void>
}) {
  return (
    <div className="rounded-xl border border-cyan-500/15 bg-cyan-950/10 p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant={projectStatusVariant(project.status)}>{project.status}</Badge>
            <Badge variant="default">{project.type}</Badge>
          </div>
          <p className="text-sm font-medium text-white">{project.name}</p>
          <p className="text-[11px] text-slate-500 font-mono">{clientName} · {clientSlug}/{project.slug}</p>
        </div>

        <div className="text-right flex-shrink-0">
          <div className="text-[10px] text-slate-500 font-mono">contract</div>
          <div className="text-sm font-bold text-emerald-400 font-mono">{formatUsd(project.contract_value_usd ?? 0)}</div>
        </div>
      </div>

      <button
        onClick={() => void onInvoice(project, clientSlug)}
        disabled={state?.pending}
        className="px-2.5 py-1.5 rounded-md text-[11px] font-mono border border-cyan-500/25 text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-50 transition-colors"
      >
        {state?.pending ? 'Invoicing…' : 'Invoice'}
      </button>

      {state?.message && <p className="text-[11px] text-emerald-400 font-mono">{state.message}</p>}
      {state?.error && <p className="text-[11px] text-rose-400 font-mono">{state.error}</p>}
    </div>
  )
}

function OutstandingCard({
  row,
  state,
  onMarkPaid,
}: {
  row: OutstandingRow
  state: ActionState | undefined
  onMarkPaid: (row: OutstandingRow) => Promise<void>
}) {
  return (
    <div className="rounded-xl border border-emerald-500/15 bg-emerald-950/10 p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="finance">invoiced</Badge>
            <Badge variant={row.outstandingUsd > 0 ? 'warning' : 'done'}>
              {row.outstandingUsd > 0 ? 'outstanding' : 'paid'}
            </Badge>
          </div>
          <p className="text-sm font-medium text-white">{row.project.name}</p>
          <p className="text-[11px] text-slate-500 font-mono">{row.clientName} · {row.clientSlug}/{row.project.slug}</p>
        </div>

        <div className="text-right flex-shrink-0 space-y-1">
          <div className="text-[10px] text-slate-500 font-mono">outstanding</div>
          <div className="text-sm font-bold text-amber-400 font-mono">{formatUsd(row.outstandingUsd)}</div>
          <div className="text-[10px] text-cyan-300 font-mono">paid {formatUsd(row.paidUsd)}</div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[10px] text-slate-500 font-mono">
          Last payment: {row.lastPaymentAt ? format(new Date(row.lastPaymentAt), 'MMM d, yyyy') : '—'}
        </div>
        <button
          onClick={() => void onMarkPaid(row)}
          disabled={state?.pending || row.outstandingUsd <= 0}
          className="px-2.5 py-1.5 rounded-md text-[11px] font-mono border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50 transition-colors"
        >
          {state?.pending ? 'Recording…' : 'Mark Paid'}
        </button>
      </div>

      {state?.message && <p className="text-[11px] text-emerald-400 font-mono">{state.message}</p>}
      {state?.error && <p className="text-[11px] text-rose-400 font-mono">{state.error}</p>}
    </div>
  )
}

function FounderEventRow({ event }: { event: SystemEventWithContext }) {
  const clientName = typeof event.task?.metadata?.['client_name'] === 'string' ? event.task.metadata['client_name'] : null
  const projectName = typeof event.task?.metadata?.['project_name'] === 'string' ? event.task.metadata['project_name'] : null

  return (
    <div className="py-2 border-b border-white/[0.04] last:border-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant={founderEventVariant(event.type)}>{event.type}</Badge>
          <span className="text-[11px] text-slate-300 truncate">{String(event.payload['title'] ?? event.payload['project_name'] ?? event.type)}</span>
        </div>
        <span className="text-[10px] text-slate-600 font-mono whitespace-nowrap">
          {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
        </span>
      </div>

      {(clientName || projectName) && (
        <p className="mt-1 text-[10px] text-slate-500 font-mono">
          {[clientName, projectName].filter(Boolean).join(' / ')}
        </p>
      )}
    </div>
  )
}

export function FounderOpsView() {
  const { data: blockedTasks, loading: tasksLoading, error: tasksError } = useTasks('blocked')
  const { data: reviewTasks, loading: reviewLoading, error: reviewError } = useReviewRequestedTasks()
  const { data: projects, loading: projectsLoading, error: projectsError } = useProjects()
  const { data: clients } = useClients()
  const { data: payments, loading: paymentsLoading, error: paymentsError } = usePayments()
  const { data: events } = useEventsWithContext(80)
  const { state: projectState } = useProjectState()
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({})

  const clientMap = useMemo(() => {
    return new Map(clients.map((client) => [client.id, client]))
  }, [clients])

  const invoiceQueue = useMemo(() => {
    return projects
      .filter((project) => project.status !== 'invoiced' && ['review', 'delivered', 'blocked', 'active'].includes(project.status))
      .map((project) => ({
        project,
        client: clientMap.get(project.client_id),
      }))
      .filter((entry) => Boolean(entry.client))
      .sort((a, b) => new Date(b.project.created_at).getTime() - new Date(a.project.created_at).getTime())
  }, [clientMap, projects])

  const paymentMap = useMemo(() => aggregatePayments(payments), [payments])

  const outstandingRows = useMemo<OutstandingRow[]>(() => {
    return projects
      .filter((project) => project.status === 'invoiced')
      .map((project) => {
        const paymentState = paymentMap.get(project.id)
        const paidUsd = paymentState?.paidUsd ?? 0
        const outstandingUsd = Math.max((project.contract_value_usd ?? 0) - paidUsd, 0)
        const client = clientMap.get(project.client_id)
        return {
          project,
          clientName: client?.name ?? '—',
          clientSlug: client?.slug ?? '',
          paidUsd,
          outstandingUsd,
          lastPaymentAt: paymentState?.lastPaymentAt ?? null,
        }
      })
      .filter((row) => row.clientSlug && row.outstandingUsd > 0)
      .sort((a, b) => b.outstandingUsd - a.outstandingUsd)
  }, [clientMap, paymentMap, projects])

  const founderEvents = useMemo(() => {
    const allowed = new Set(['human_review_requested', 'task_unblocked', 'human_approved', 'human_rejected', 'revenue_recorded', 'payment_received'])
    return events.filter((event) => allowed.has(event.type)).slice(0, 12)
  }, [events])

  const totals = useMemo(() => {
    const outstandingUsd = outstandingRows.reduce((sum, row) => sum + row.outstandingUsd, 0)
    return {
      blocked: blockedTasks.length,
      pendingReview: reviewTasks.length,
      invoiceable: invoiceQueue.length,
      outstandingProjects: outstandingRows.length,
      outstandingUsd,
    }
  }, [blockedTasks.length, reviewTasks.length, invoiceQueue.length, outstandingRows])

  function setPendingState(key: string) {
    setActionStates((current) => ({
      ...current,
      [key]: { pending: true, message: null, error: null },
    }))
  }

  function setSuccessState(key: string, message: string) {
    setActionStates((current) => ({
      ...current,
      [key]: { pending: false, message, error: null },
    }))
  }

  function setErrorState(key: string, error: string) {
    setActionStates((current) => ({
      ...current,
      [key]: { pending: false, message: null, error },
    }))
  }

  async function handleApprove(task: Task) {
    const key = `task:${task.id}`
    const reason = window.prompt('Optional approval note?', '')
    if (reason === null) return

    try {
      setPendingState(key)
      const message = await runFounderTaskAction(task.id, 'approve', reason || undefined)
      setSuccessState(key, message)
    } catch (err) {
      setErrorState(key, err instanceof Error ? err.message : 'Unknown error')
    }
  }

  async function handleRetry(task: Task) {
    const key = `task:${task.id}`
    const reason = window.prompt('Optional retry note for the agent?', '')
    if (reason === null) return

    try {
      setPendingState(key)
      const message = await runFounderTaskAction(task.id, 'retry', reason || undefined)
      setSuccessState(key, message)
    } catch (err) {
      setErrorState(key, err instanceof Error ? err.message : 'Unknown error')
    }
  }

  async function handleReject(task: Task) {
    const key = `task:${task.id}`
    const reason = window.prompt('Reason for cancelling this task?', 'Founder cancelled blocked task')
    if (reason === null) return

    try {
      setPendingState(key)
      const message = await runFounderTaskAction(task.id, 'reject', reason || undefined)
      setSuccessState(key, message)
    } catch (err) {
      setErrorState(key, err instanceof Error ? err.message : 'Unknown error')
    }
  }

  async function handleInvoice(project: Project, clientSlug: string) {
    const key = `project:invoice:${project.id}`
    const raw = window.prompt(
      `Invoice amount for ${clientSlug}/${project.slug}`,
      project.contract_value_usd > 0 ? String(project.contract_value_usd) : ''
    )
    const amount = parsePromptAmount(raw)
    if (amount === null) return
    if (!Number.isFinite(amount)) {
      setErrorState(key, 'Invalid invoice amount')
      return
    }

    try {
      setPendingState(key)
      const message = await runFounderRevenueAction('invoice', clientSlug, project.slug, amount)
      setSuccessState(key, message)
    } catch (err) {
      setErrorState(key, err instanceof Error ? err.message : 'Unknown error')
    }
  }

  async function handleMarkPaid(row: OutstandingRow) {
    const key = `project:paid:${row.project.id}`
    const raw = window.prompt(
      `Payment received for ${row.clientSlug}/${row.project.slug}`,
      row.outstandingUsd > 0 ? String(row.outstandingUsd) : ''
    )
    const amount = parsePromptAmount(raw)
    if (amount === null) return
    if (!Number.isFinite(amount)) {
      setErrorState(key, 'Invalid payment amount')
      return
    }

    try {
      setPendingState(key)
      const message = await runFounderRevenueAction('mark_paid', row.clientSlug, row.project.slug, amount)
      setSuccessState(key, message)
    } catch (err) {
      setErrorState(key, err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const loading = tasksLoading || reviewLoading || projectsLoading || paymentsLoading
  const error = tasksError ?? reviewError ?? projectsError ?? paymentsError

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-white">Founder Ops</h2>
          <p className="text-[11px] text-slate-600 mt-0.5">
            Decision queue per Neb: blocked tasks, invoice queue, outstanding payments.
          </p>
        </div>
        <div className="max-w-xl rounded-xl border border-cyan-500/15 bg-cyan-950/10 px-3 py-2">
          <p className="text-[11px] text-cyan-200 font-medium">M7 clarification</p>
          <p className="text-[10px] text-slate-500 mt-1 leading-relaxed font-mono">
            In dev, this board validates a revenue-ready founder loop on test data.
            Real external revenue only starts when Neb runs the same flow on an actual paying client.
          </p>
          <p className="text-[10px] text-slate-600 mt-1 font-mono">
            Current milestone: {projectState?.current_milestone ?? 'M7 - First revenue-generating output'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Blocked Tasks" value={String(totals.blocked)} color="amber" />
        <Stat label="Pending Review" value={String(totals.pendingReview)} color="violet" />
        <Stat label="Ready To Invoice" value={String(totals.invoiceable)} color="cyan" />
        <Stat label="Outstanding Invoices" value={String(totals.outstandingProjects)} color="violet" />
        <Stat label="Outstanding USD" value={formatUsd(totals.outstandingUsd)} color="emerald" />
      </div>

      {loading && (
        <Panel title="Founder Queue" accent="cyan">
          <p className="text-[11px] text-slate-600 font-mono animate-pulse py-6">Caricamento founder action center…</p>
        </Panel>
      )}

      {error && (
        <Panel title="Founder Queue" accent="rose">
          <p className="text-[11px] text-rose-400 font-mono py-6">Errore: {error}</p>
        </Panel>
      )}

      {!loading && !error && (
        <div className="grid grid-cols-1 xl:grid-cols-[1.15fr,0.85fr] gap-5">
          <div className="space-y-5">
            <Panel title={`Blocked Tasks (${blockedTasks.length})`} accent="amber">
              <div className="space-y-3">
                {blockedTasks.length === 0 && (
                  <p className="text-[11px] text-slate-600 font-mono py-4">
                    Nessuna task bloccata. Se qualcosa si rompe, comparirà qui con Retry / Cancel immediati.
                  </p>
                )}

                {blockedTasks.map((task) => (
                  <FounderOpsTaskCard
                    key={task.id}
                    task={task}
                    state={actionStates[`task:${task.id}`]}
                    onRetry={handleRetry}
                    onReject={handleReject}
                  />
                ))}
              </div>
            </Panel>

            <Panel title={`Pending Review (${reviewTasks.length})`} accent="violet">
              <div className="space-y-3">
                {reviewTasks.length === 0 && (
                  <p className="text-[11px] text-slate-600 font-mono py-4">
                    Nessuna task in attesa di approvazione founder. Le task create con <span className="text-violet-400">requires_human_review = true</span> compariranno qui.
                  </p>
                )}

                {reviewTasks.map((task) => (
                  <ReviewTaskCard
                    key={task.id}
                    task={task}
                    state={actionStates[`task:${task.id}`]}
                    onApprove={handleApprove}
                    onReject={handleReject}
                  />
                ))}
              </div>
            </Panel>

            <Panel title={`Ready To Invoice (${invoiceQueue.length})`} accent="cyan">
              <div className="space-y-3">
                {invoiceQueue.length === 0 && (
                  <p className="text-[11px] text-slate-600 font-mono py-4">
                    Nessun progetto in review/delivered/blocked/active da fatturare adesso.
                  </p>
                )}

                {invoiceQueue.map(({ project, client }) => (
                  <InvoiceQueueCard
                    key={project.id}
                    project={project}
                    clientName={client?.name ?? '—'}
                    clientSlug={client?.slug ?? ''}
                    state={actionStates[`project:invoice:${project.id}`]}
                    onInvoice={handleInvoice}
                  />
                ))}
              </div>
            </Panel>
          </div>

          <div className="space-y-5">
            <Panel title={`Outstanding Payments (${outstandingRows.length})`} accent="emerald">
              <div className="space-y-3">
                {outstandingRows.length === 0 && (
                  <p className="text-[11px] text-slate-600 font-mono py-4">
                    Nessun outstanding aperto. I progetti invoiced e non ancora fully paid compariranno qui.
                  </p>
                )}

                {outstandingRows.map((row) => (
                  <OutstandingCard
                    key={row.project.id}
                    row={row}
                    state={actionStates[`project:paid:${row.project.id}`]}
                    onMarkPaid={handleMarkPaid}
                  />
                ))}
              </div>
            </Panel>

            <Panel title="Recent Founder Decisions" accent="violet">
              <div className="space-y-0">
                {founderEvents.length === 0 && (
                  <p className="text-[11px] text-slate-600 font-mono py-4">
                    Nessuna founder decision recente registrata.
                  </p>
                )}

                {founderEvents.map((event) => (
                  <FounderEventRow key={event.id} event={event} />
                ))}
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  )
}
