import { getModelForAgent } from '../config/models.js'
import { log, recordEvent, recordRun } from '../services/logger.js'
import { getAgents, getSupabaseClient, updateTaskStatus } from '../services/supabase.js'
import type { Agent, RunOutcome, Task } from '../types/index.js'

const DEFAULT_INTERVAL_MS = parsePositiveInt(process.env['HR_RUNTIME_INTERVAL_MS'], 6 * 60 * 60_000)

interface WeeklyTaskRow {
  assignee_agent_id: string | null
  status: string
  completed_at: string | null
}

interface WeeklyRunRow {
  agent_id: string
  outcome: RunOutcome
}

interface WeeklyEventRow {
  type: string
  agent_id: string | null
  severity: string
}

interface TeamDigestRow {
  team: string
  completedTasks: number
  activeTasks: number
  blockedTasks: number
  runs: number
  failedRuns: number
  warningEvents: number
}

interface HrWeeklyDigest {
  weekKey: string
  sinceIso: string
  teams: TeamDigestRow[]
  busiestAgentId: string | null
  totalCompletedTasks: number
  totalRuns: number
  totalWarnings: number
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function truncate(value: string, maxLength = 180): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`
}

function getWeekKey(date: Date): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = utc.getUTCDay() || 7
  utc.setUTCDate(utc.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7)
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

async function recordRuntimeRun(
  inputSummary: string,
  outputSummary: string,
  outcome: RunOutcome,
  errorMessage?: string,
  taskId?: string
): Promise<void> {
  const model = getModelForAgent({ agentId: 'hr', taskType: 'hr' })
  await recordRun({
    agent_id: 'hr',
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

async function hasWeeklyDigest(weekKey: string): Promise<boolean> {
  const { data, error } = await getSupabaseClient()
    .from('events')
    .select('id')
    .eq('type', 'hr_digest_generated')
    .contains('payload', { week_key: weekKey })
    .limit(1)

  if (error) throw new Error(`HR failed to query digest history: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}

async function getWeeklyTasks(sinceIso: string): Promise<WeeklyTaskRow[]> {
  const { data, error } = await getSupabaseClient()
    .from('tasks')
    .select('assignee_agent_id, status, completed_at')
    .or(`completed_at.gte.${sinceIso},updated_at.gte.${sinceIso}`)

  if (error) throw new Error(`HR failed to query tasks: ${error.message}`)
  return (data ?? []) as WeeklyTaskRow[]
}

async function getWeeklyRuns(sinceIso: string): Promise<WeeklyRunRow[]> {
  const { data, error } = await getSupabaseClient()
    .from('runs')
    .select('agent_id, outcome')
    .gte('created_at', sinceIso)

  if (error) throw new Error(`HR failed to query runs: ${error.message}`)
  return (data ?? []) as WeeklyRunRow[]
}

async function getWeeklyEvents(sinceIso: string): Promise<WeeklyEventRow[]> {
  const { data, error } = await getSupabaseClient()
    .from('events')
    .select('type, agent_id, severity')
    .gte('created_at', sinceIso)

  if (error) throw new Error(`HR failed to query events: ${error.message}`)
  return (data ?? []) as WeeklyEventRow[]
}

function emptyTeamRow(team: string): TeamDigestRow {
  return {
    team,
    completedTasks: 0,
    activeTasks: 0,
    blockedTasks: 0,
    runs: 0,
    failedRuns: 0,
    warningEvents: 0,
  }
}

async function buildHrWeeklyDigest(now = new Date()): Promise<HrWeeklyDigest> {
  const sinceIso = new Date(now.getTime() - (7 * 24 * 60 * 60_000)).toISOString()
  const [agents, tasks, runs, events] = await Promise.all([
    getAgents(),
    getWeeklyTasks(sinceIso),
    getWeeklyRuns(sinceIso),
    getWeeklyEvents(sinceIso),
  ])

  const teamByAgentId = new Map<string, Agent['team']>()
  const runCountByAgent = new Map<string, number>()
  for (const agent of agents) {
    teamByAgentId.set(agent.id, agent.team)
  }

  const rows = new Map<string, TeamDigestRow>()
  for (const agent of agents) {
    if (!rows.has(agent.team)) {
      rows.set(agent.team, emptyTeamRow(agent.team))
    }
  }

  for (const task of tasks) {
    const agentId = task.assignee_agent_id
    if (!agentId) continue

    const team = teamByAgentId.get(agentId) ?? 'ops'
    const row = rows.get(team) ?? emptyTeamRow(team)

    if (task.completed_at && new Date(task.completed_at).getTime() >= new Date(sinceIso).getTime()) {
      row.completedTasks += 1
    }
    if (task.status === 'in_progress' || task.status === 'todo') {
      row.activeTasks += 1
    }
    if (task.status === 'blocked') {
      row.blockedTasks += 1
    }

    rows.set(team, row)
  }

  for (const run of runs) {
    const team = teamByAgentId.get(run.agent_id) ?? 'ops'
    const row = rows.get(team) ?? emptyTeamRow(team)
    row.runs += 1
    if (run.outcome === 'failure') {
      row.failedRuns += 1
    }
    rows.set(team, row)
    runCountByAgent.set(run.agent_id, (runCountByAgent.get(run.agent_id) ?? 0) + 1)
  }

  for (const event of events) {
    if (event.severity !== 'warning' && event.severity !== 'error' && event.severity !== 'critical') {
      continue
    }

    const team = event.agent_id ? (teamByAgentId.get(event.agent_id) ?? 'ops') : 'ops'
    const row = rows.get(team) ?? emptyTeamRow(team)
    row.warningEvents += 1
    rows.set(team, row)
  }

  const busiestAgentEntry = Array.from(runCountByAgent.entries())
    .sort((a, b) => b[1] - a[1])[0]

  const teams = Array.from(rows.values()).sort((a, b) => a.team.localeCompare(b.team))

  return {
    weekKey: getWeekKey(now),
    sinceIso,
    teams,
    busiestAgentId: busiestAgentEntry?.[0] ?? null,
    totalCompletedTasks: teams.reduce((sum, row) => sum + row.completedTasks, 0),
    totalRuns: teams.reduce((sum, row) => sum + row.runs, 0),
    totalWarnings: teams.reduce((sum, row) => sum + row.warningEvents, 0),
  }
}

function renderHrWeeklyDigest(digest: HrWeeklyDigest): string {
  const lines = digest.teams.map((row) =>
    `- ${row.team}: ${row.completedTasks} done · ${row.activeTasks} active · ${row.blockedTasks} blocked · ${row.runs} runs · ${row.failedRuns} failed · ${row.warningEvents} alerts`
  )

  return [
    `🧾 *HR Weekly Digest*`,
    ``,
    `Window start: ${digest.sinceIso.slice(0, 10)}`,
    `Week key: ${digest.weekKey}`,
    `Completed tasks: ${digest.totalCompletedTasks}`,
    `Runs logged: ${digest.totalRuns}`,
    `Warnings/errors: ${digest.totalWarnings}`,
    `Busiest agent: ${digest.busiestAgentId ?? 'n/a'}`,
    ``,
    `Team activity:`,
    ...(lines.length > 0 ? lines : ['- no activity']),
  ].join('\n')
}

export async function runHrCycle(
  notify: (message: string) => Promise<void>
): Promise<HrWeeklyDigest | null> {
  const digest = await buildHrWeeklyDigest()
  const alreadySent = await hasWeeklyDigest(digest.weekKey)
  if (alreadySent) {
    await recordRuntimeRun(
      'Scheduled HR cycle',
      `weekly_digest_sent=false; week_key=${digest.weekKey}`,
      'success'
    )
    return null
  }

  await recordEvent('hr_digest_generated', {
    agentId: 'hr',
    payload: {
      week_key: digest.weekKey,
      window_start: digest.sinceIso,
      busiest_agent_id: digest.busiestAgentId,
      total_completed_tasks: digest.totalCompletedTasks,
      total_runs: digest.totalRuns,
      total_warnings: digest.totalWarnings,
      team_activity: digest.teams,
    },
  })

  const rendered = renderHrWeeklyDigest(digest)
  await notify(rendered)
  await recordRuntimeRun('Scheduled HR cycle', rendered, 'success')
  return digest
}

export function startHrRuntime(
  notify: (message: string) => Promise<void>,
  intervalMs = DEFAULT_INTERVAL_MS
): NodeJS.Timeout {
  log.info({ intervalMs }, 'Starting HR runtime')

  void runHrCycle(notify).catch(async (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    log.error({ err }, 'HR initial cycle failed')
    await recordRuntimeRun('Scheduled HR cycle', '', 'failure', message)
  })

  return setInterval(() => {
    void runHrCycle(notify).catch(async (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      log.error({ err }, 'HR cycle failed')
      await recordRuntimeRun('Scheduled HR cycle', '', 'failure', message)
    })
  }, intervalMs)
}

export async function runHrAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  await updateTaskStatus(task.id, 'in_progress')

  try {
    const digest = await buildHrWeeklyDigest()
    const rendered = renderHrWeeklyDigest(digest)

    await recordEvent('task_completed', {
      agentId: 'hr',
      taskId: task.id,
      payload: {
        week_key: digest.weekKey,
        busiest_agent_id: digest.busiestAgentId,
        total_completed_tasks: digest.totalCompletedTasks,
        total_runs: digest.totalRuns,
        total_warnings: digest.totalWarnings,
      },
    })

    await recordRuntimeRun(task.description, rendered, 'success', undefined, task.id)
    await updateTaskStatus(task.id, 'done')
    await notify(rendered)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    await recordEvent('agent_error', {
      agentId: 'hr',
      taskId: task.id,
      payload: { error: message },
      severity: 'error',
    })

    await recordRuntimeRun(task.description, '', 'failure', message, task.id)
    await updateTaskStatus(task.id, 'blocked').catch(() => {})

    await notify(
      [
        `❌ *HR Error*`,
        ``,
        `Task: ${task.title}`,
        `Error: ${truncate(message, 320)}`,
      ].join('\n')
    )

    throw err
  }
}
