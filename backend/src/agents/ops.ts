import { getModelForAgent } from '../config/models.js'
import { log, recordEvent, recordRun } from '../services/logger.js'
import { getSupabaseClient, updateTaskStatus } from '../services/supabase.js'
import type { RunOutcome, Task, TaskStatus } from '../types/index.js'

const DEFAULT_INTERVAL_MS = parsePositiveInt(process.env['OPS_MONITOR_INTERVAL_MS'], 15 * 60_000)
const STUCK_THRESHOLD_MS = parsePositiveInt(process.env['OPS_STUCK_THRESHOLD_MS'], 30 * 60_000)

const alertedTaskSignatures = new Map<string, string>()
const alertedAgentSignatures = new Map<string, string>()

interface AgentErrorEvent {
  id: string
  agent_id: string | null
  task_id: string | null
  payload: Record<string, unknown> | null
  created_at: string
}

interface LatestRunState {
  created_at: string
  outcome: RunOutcome
}

interface StuckAgentAlert {
  agentId: string
  taskId: string | null
  eventId: string
  errorSummary: string
  minutesSinceError: number
  createdAt: string
}

interface OpsSnapshot {
  stuckTasks: Task[]
  stuckAgents: StuckAgentAlert[]
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function minutesSince(iso: string): number {
  const diffMs = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.floor(diffMs / 60_000))
}

function truncate(value: string, maxLength = 180): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`
}

async function recordRuntimeRun(
  inputSummary: string,
  outputSummary: string,
  outcome: RunOutcome,
  errorMessage?: string,
  taskId?: string
): Promise<void> {
  const model = getModelForAgent({ agentId: 'ops', taskType: 'ops' })
  await recordRun({
    agent_id: 'ops',
    ...(taskId ? { task_id: taskId } : {}),
    model_id: model.id,
    input_summary: truncate(inputSummary, 500),
    output_summary: truncate(outputSummary, 500),
    tokens_input: 0,
    tokens_output: 0,
    tools_used: ['supabase_read', 'supabase_write_events', 'telegram_notify'],
    outcome,
    ...(errorMessage ? { error_message: truncate(errorMessage, 500) } : {}),
    duration_ms: 0,
  })
}

async function getStuckTasks(cutoffIso: string): Promise<Task[]> {
  const statuses: TaskStatus[] = ['in_progress', 'blocked']
  const { data, error } = await getSupabaseClient()
    .from('tasks')
    .select('*')
    .in('status', statuses)
    .lte('updated_at', cutoffIso)
    .order('updated_at', { ascending: true })
    .limit(50)

  if (error) throw new Error(`Ops failed to query stuck tasks: ${error.message}`)
  return (data ?? []) as Task[]
}

async function getCandidateAgentErrors(cutoffIso: string): Promise<AgentErrorEvent[]> {
  const { data, error } = await getSupabaseClient()
    .from('events')
    .select('id, agent_id, task_id, payload, created_at')
    .eq('type', 'agent_error')
    .lte('created_at', cutoffIso)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw new Error(`Ops failed to query agent errors: ${error.message}`)
  return (data ?? []) as AgentErrorEvent[]
}

async function getLatestRunState(agentId: string): Promise<LatestRunState | null> {
  const { data, error } = await getSupabaseClient()
    .from('runs')
    .select('created_at, outcome')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) throw new Error(`Ops failed to query latest run for ${agentId}: ${error.message}`)
  const latest = Array.isArray(data) ? data[0] : null
  return latest ? (latest as LatestRunState) : null
}

async function collectOpsSnapshot(): Promise<OpsSnapshot> {
  const cutoffIso = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString()
  const [stuckTasks, candidateErrors] = await Promise.all([
    getStuckTasks(cutoffIso),
    getCandidateAgentErrors(cutoffIso),
  ])

  const latestErrorByAgent = new Map<string, AgentErrorEvent>()
  for (const event of candidateErrors) {
    const agentId = event.agent_id
    if (!agentId || latestErrorByAgent.has(agentId)) continue
    latestErrorByAgent.set(agentId, event)
  }

  const stuckAgents: StuckAgentAlert[] = []
  for (const [agentId, event] of latestErrorByAgent.entries()) {
    const latestRun = await getLatestRunState(agentId)
    if (
      latestRun &&
      latestRun.outcome === 'success' &&
      new Date(latestRun.created_at).getTime() > new Date(event.created_at).getTime()
    ) {
      continue
    }

    const payload = event.payload ?? {}
    const rawError = typeof payload['error'] === 'string' ? payload['error'] : 'Unknown agent error'
    stuckAgents.push({
      agentId,
      taskId: event.task_id,
      eventId: event.id,
      errorSummary: truncate(rawError, 220),
      minutesSinceError: minutesSince(event.created_at),
      createdAt: event.created_at,
    })
  }

  return { stuckTasks, stuckAgents }
}

function renderTaskAlert(task: Task): string {
  const clientName = (task.metadata['client_name'] as string | undefined) ?? 'n/a'
  const projectName = (task.metadata['project_name'] as string | undefined) ?? 'n/a'
  return [
    `🛠 *Ops Alert — Task Stuck*`,
    ``,
    `Task: ${task.title}`,
    `Agent: ${task.assignee_agent_id ?? 'unassigned'}`,
    `Status: ${task.status}`,
    `Blocked for: ${minutesSince(task.updated_at)} min`,
    `Client/Project: ${clientName} / ${projectName}`,
    `Task ID: \`${task.id.slice(0, 8)}\``,
    '',
    `Actions: \`/retry ${task.id}\` · \`/reject ${task.id} reason\``,
  ].join('\n')
}

function renderAgentAlert(alert: StuckAgentAlert): string {
  return [
    `🛠 *Ops Alert — Agent Stuck*`,
    ``,
    `Agent: \`${alert.agentId}\``,
    `Since error: ${alert.minutesSinceError} min`,
    alert.taskId ? `Task ID: \`${alert.taskId.slice(0, 8)}\`` : 'Task ID: n/a',
    `Last error: ${alert.errorSummary}`,
  ].join('\n')
}

export async function runOpsMonitor(
  notify: (message: string) => Promise<void>
): Promise<OpsSnapshot> {
  const snapshot = await collectOpsSnapshot()

  const liveTaskIds = new Set(snapshot.stuckTasks.map((task) => task.id))
  for (const taskId of alertedTaskSignatures.keys()) {
    if (!liveTaskIds.has(taskId)) {
      alertedTaskSignatures.delete(taskId)
    }
  }

  const liveAgentIds = new Set(snapshot.stuckAgents.map((alert) => alert.agentId))
  for (const agentId of alertedAgentSignatures.keys()) {
    if (!liveAgentIds.has(agentId)) {
      alertedAgentSignatures.delete(agentId)
    }
  }

  for (const task of snapshot.stuckTasks) {
    const signature = `${task.status}:${task.updated_at}`
    if (alertedTaskSignatures.get(task.id) === signature) continue

    alertedTaskSignatures.set(task.id, signature)

    await recordEvent('ops_alert', {
      agentId: 'ops',
      taskId: task.id,
      severity: task.status === 'blocked' ? 'warning' : 'error',
      payload: {
        kind: 'stuck_task',
        assignee_agent_id: task.assignee_agent_id,
        task_status: task.status,
        minutes_stuck: minutesSince(task.updated_at),
      },
    })

    await notify(renderTaskAlert(task))
  }

  for (const alert of snapshot.stuckAgents) {
    const signature = `${alert.eventId}:${alert.createdAt}`
    if (alertedAgentSignatures.get(alert.agentId) === signature) continue

    alertedAgentSignatures.set(alert.agentId, signature)

    await recordEvent('ops_alert', {
      agentId: 'ops',
      ...(alert.taskId ? { taskId: alert.taskId } : {}),
      severity: 'error',
      payload: {
        kind: 'stuck_agent',
        target_agent_id: alert.agentId,
        minutes_since_error: alert.minutesSinceError,
        error: alert.errorSummary,
      },
    })

    await notify(renderAgentAlert(alert))
  }

  await recordRuntimeRun(
    'Scheduled ops monitor sweep',
    `stuck_tasks=${snapshot.stuckTasks.length}; stuck_agents=${snapshot.stuckAgents.length}`,
    'success'
  )

  return snapshot
}

export function startOpsMonitor(
  notify: (message: string) => Promise<void>,
  intervalMs = DEFAULT_INTERVAL_MS
): NodeJS.Timeout {
  log.info({ intervalMs, stuckThresholdMs: STUCK_THRESHOLD_MS }, 'Starting Ops monitor')

  void runOpsMonitor(notify).catch(async (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    log.error({ err }, 'Ops monitor initial sweep failed')
    await recordRuntimeRun('Scheduled ops monitor sweep', '', 'failure', message)
  })

  return setInterval(() => {
    void runOpsMonitor(notify).catch(async (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      log.error({ err }, 'Ops monitor sweep failed')
      await recordRuntimeRun('Scheduled ops monitor sweep', '', 'failure', message)
    })
  }, intervalMs)
}

function renderOpsSnapshot(snapshot: OpsSnapshot): string {
  const stuckTaskLines =
    snapshot.stuckTasks.length > 0
      ? snapshot.stuckTasks.map((task) => `- ${task.assignee_agent_id ?? 'unassigned'} · ${task.status} · ${task.title}`)
      : ['- none']

  const stuckAgentLines =
    snapshot.stuckAgents.length > 0
      ? snapshot.stuckAgents.map((alert) => `- ${alert.agentId} · ${alert.minutesSinceError} min · ${alert.errorSummary}`)
      : ['- none']

  return [
    `🛠 *Ops Snapshot*`,
    ``,
    `Stuck tasks (${snapshot.stuckTasks.length}):`,
    ...stuckTaskLines,
    ``,
    `Problematic agents (${snapshot.stuckAgents.length}):`,
    ...stuckAgentLines,
  ].join('\n')
}

export async function runOpsAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  await updateTaskStatus(task.id, 'in_progress')

  try {
    const snapshot = await collectOpsSnapshot()

    await recordEvent('task_completed', {
      agentId: 'ops',
      taskId: task.id,
      payload: {
        stuck_tasks_count: snapshot.stuckTasks.length,
        stuck_agents_count: snapshot.stuckAgents.length,
      },
    })

    await recordRuntimeRun(task.description, renderOpsSnapshot(snapshot), 'success', undefined, task.id)
    await updateTaskStatus(task.id, 'done')
    await notify(renderOpsSnapshot(snapshot))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    await recordEvent('agent_error', {
      agentId: 'ops',
      taskId: task.id,
      payload: { error: message },
      severity: 'error',
    })

    await recordRuntimeRun(task.description, '', 'failure', message, task.id)
    await updateTaskStatus(task.id, 'blocked').catch(() => {})

    await notify(
      [
        `❌ *Ops Error*`,
        ``,
        `Task: ${task.title}`,
        `Error: ${truncate(message, 320)}`,
      ].join('\n')
    )

    throw err
  }
}
