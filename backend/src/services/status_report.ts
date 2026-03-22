import {
  getAgents,
  getMonthlyCost,
  getProjectState,
  getSupabaseClient,
  getTasksByStatus,
} from './supabase.js'
import { getCalendarEventsToday, getGoogleWorkspaceMcpRuntimeStatus } from './google-workspace-mcp.js'
import type { Agent, SystemEvent, Task } from '../types/index.js'

interface AgentHealth {
  agent: Agent
  blockedTasks: number
  recentErrors: number
  hasCriticalStatus: boolean
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}\[\]()#+\-.!|])/g, '\\$1')
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function startOfCurrentMonthIso(): string {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
}

function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`
}

function formatMonthLabel(date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function shortId(id: string | null | undefined): string | null {
  return id ? id.slice(0, 8) : null
}

function summarizeTasks(tasks: Task[], prefix: string): string[] {
  if (tasks.length === 0) {
    return [`${prefix}: 0`]
  }

  const preview = tasks
    .slice(0, 3)
    .map((task) => `- ${escapeMarkdown(task.title)} \\(#${escapeMarkdown(shortId(task.id) ?? task.id)}\\)`)

  if (tasks.length > 3) {
    preview.push(`- +${tasks.length - 3} more`)
  }

  return [`${prefix}: ${tasks.length}`, ...preview]
}

function formatRecentErrors(events: SystemEvent[]): string[] {
  if (events.length === 0) {
    return ['⚠️ Recent errors: none']
  }

  const lines = events.slice(0, 3).map((event) => {
    const source = event.agent_id ?? 'system'
    const taskRef = shortId(event.task_id)
    const rawMessage =
      typeof event.payload['error'] === 'string'
        ? event.payload['error']
        : typeof event.payload['message'] === 'string'
          ? event.payload['message']
          : event.type
    const compactMessage = rawMessage.replace(/\s+/g, ' ').trim().slice(0, 120)
    return `- ${escapeMarkdown(source)}${taskRef ? ` \\(#${escapeMarkdown(taskRef)}\\)` : ''}: ${escapeMarkdown(compactMessage)}`
  })

  return ['⚠️ Recent errors:', ...lines]
}

function formatAgenda(events: string[]): string[] {
  if (events.length === 0) {
    return ['📅 Agenda: no meetings today']
  }
  return ['📅 Agenda:', ...events.map(e => `- ${escapeMarkdown(e)}`)]
}

function buildProblematicAgents(
  agents: Agent[],
  blockedTasks: Task[],
  recentErrors: SystemEvent[]
): string[] {
  const byAgent = new Map<string, AgentHealth>()

  for (const agent of agents) {
    byAgent.set(agent.id, {
      agent,
      blockedTasks: 0,
      recentErrors: 0,
      hasCriticalStatus: agent.status === 'error' || agent.status === 'offline',
    })
  }

  for (const task of blockedTasks) {
    if (!task.assignee_agent_id) continue
    const current = byAgent.get(task.assignee_agent_id)
    if (!current) continue
    current.blockedTasks += 1
  }

  for (const event of recentErrors) {
    if (!event.agent_id) continue
    const current = byAgent.get(event.agent_id)
    if (!current) continue
    current.recentErrors += 1
  }

  const problematic = Array.from(byAgent.values())
    .filter((item) => item.hasCriticalStatus || item.blockedTasks > 0 || item.recentErrors > 0)
    .sort((a, b) => {
      if (a.hasCriticalStatus !== b.hasCriticalStatus) return a.hasCriticalStatus ? -1 : 1
      if (a.recentErrors !== b.recentErrors) return b.recentErrors - a.recentErrors
      return b.blockedTasks - a.blockedTasks
    })
    .slice(0, 4)

  if (problematic.length === 0) {
    return ['🧯 Problematic agents: none']
  }

  return [
    '🧯 Problematic agents:',
    ...problematic.map((item) => {
      const flags: string[] = []
      if (item.hasCriticalStatus) flags.push(`status ${item.agent.status}`)
      if (item.recentErrors > 0) flags.push(`${item.recentErrors} recent error${item.recentErrors === 1 ? '' : 's'}`)
      if (item.blockedTasks > 0) flags.push(`${item.blockedTasks} blocked task${item.blockedTasks === 1 ? '' : 's'}`)
      return `- ${escapeMarkdown(item.agent.id)}: ${escapeMarkdown(flags.join(', '))}`
    }),
  ]
}

export async function buildSystemStatusReport(): Promise<string> {
  const startOfMonthIso = startOfCurrentMonthIso()

  // Check if Google Workspace is connected before trying to fetch calendar
  const googleStatus = await getGoogleWorkspaceMcpRuntimeStatus('neb').catch(() => null)
  const fetchCalendar = googleStatus?.state === 'connected'

  const [agents, state, inProgressTasks, blockedTasks, cost, invoicedResult, paymentsResult, errorEventsResult, calendarEvents] =
    await Promise.all([
      getAgents(),
      getProjectState(),
      getTasksByStatus('in_progress'),
      getTasksByStatus('blocked'),
      getMonthlyCost(),
      getSupabaseClient()
        .from('events')
        .select('payload')
        .eq('type', 'revenue_recorded')
        .gte('created_at', startOfMonthIso),
      getSupabaseClient()
        .from('payments')
        .select('amount_usd')
        .gte('received_at', startOfMonthIso),
      getSupabaseClient()
        .from('events')
        .select('*')
        .in('severity', ['error', 'critical'])
        .order('created_at', { ascending: false })
        .limit(12),
      fetchCalendar ? getCalendarEventsToday('neb') : Promise.resolve([]),
    ])

  if (invoicedResult.error) {
    throw new Error(`Failed to load invoiced revenue: ${invoicedResult.error.message}`)
  }
  if (paymentsResult.error) {
    throw new Error(`Failed to load payments: ${paymentsResult.error.message}`)
  }
  if (errorEventsResult.error) {
    throw new Error(`Failed to load recent errors: ${errorEventsResult.error.message}`)
  }

  const monthlyInvoiced = (invoicedResult.data ?? []).reduce((sum, row) => {
    const payload = row.payload as Record<string, unknown> | null
    return sum + toNumber(payload?.['contract_value_usd'])
  }, 0)

  const monthlyPaid = (paymentsResult.data ?? []).reduce((sum, row) => {
    return sum + toNumber((row as { amount_usd?: number }).amount_usd)
  }, 0)

  const recentErrors = (errorEventsResult.data ?? []) as SystemEvent[]
  const healthyAgents = agents.filter((agent) => agent.status === 'online' || agent.status === 'busy').length
  const budget = state?.monthly_budget_usd ?? 500
  const pct = budget > 0 ? Math.round((cost / budget) * 100) : 0
  const boundedPct = Math.max(0, Math.min(pct, 999))
  const barUnits = Math.max(0, Math.min(10, Math.floor(boundedPct / 10)))
  const bar = '█'.repeat(barUnits) + '░'.repeat(10 - barUnits)

  return [
    '*WAI — Status Report*',
    '',
    `🎯 Milestone: ${escapeMarkdown(state?.current_milestone ?? 'none')}`,
    `🤖 Agents healthy: ${healthyAgents}/${agents.length}`,
    ...formatAgenda(calendarEvents),
    ...summarizeTasks(inProgressTasks, '⚡ Active tasks'),
    ...summarizeTasks(blockedTasks, '⛔ Blocked tasks'),
    `💰 ${escapeMarkdown(formatMonthLabel())} revenue: invoiced ${formatUsd(monthlyInvoiced)} | paid ${formatUsd(monthlyPaid)}`,
    `💸 Budget: [${bar}] ${boundedPct}% \\(${formatUsd(cost)} / ${formatUsd(budget)}\\)`,
    ...formatRecentErrors(recentErrors),
    ...buildProblematicAgents(agents, blockedTasks, recentErrors),
  ].join('\n')
}
