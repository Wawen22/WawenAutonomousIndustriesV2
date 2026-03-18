import { getModelForAgent } from '../config/models.js'
import { checkBudget } from '../services/budget.js'
import { log, recordEvent, recordRun } from '../services/logger.js'
import { getMonthlyCost, getProjectState, getSupabaseClient, updateTaskStatus } from '../services/supabase.js'
import type { RunOutcome, Task } from '../types/index.js'

const DEFAULT_INTERVAL_MS = parsePositiveInt(process.env['FINANCE_RUNTIME_INTERVAL_MS'], 60 * 60_000)

interface WeeklyRunRow {
  agent_id: string
  model_id: string
  cost_usd: number
  tokens_input: number
  tokens_output: number
  outcome: RunOutcome
}

interface WeeklyFinanceSummary {
  weekKey: string
  sinceIso: string
  totalCostUsd: number
  monthToDateCostUsd: number
  monthlyBudgetUsd: number
  totalRuns: number
  failureRuns: number
  totalTokens: number
  topAgents: Array<{ agentId: string; costUsd: number }>
  topModels: Array<{ modelId: string; costUsd: number }>
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
  const model = getModelForAgent({ agentId: 'finance', taskType: 'finance' })
  await recordRun({
    agent_id: 'finance',
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

async function getWeeklyRuns(sinceIso: string): Promise<WeeklyRunRow[]> {
  const { data, error } = await getSupabaseClient()
    .from('runs')
    .select('agent_id, model_id, cost_usd, tokens_input, tokens_output, outcome')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Finance failed to query runs: ${error.message}`)
  return (data ?? []) as WeeklyRunRow[]
}

async function hasWeeklyReport(weekKey: string): Promise<boolean> {
  const { data, error } = await getSupabaseClient()
    .from('events')
    .select('id')
    .eq('type', 'finance_report_generated')
    .contains('payload', { week_key: weekKey })
    .limit(1)

  if (error) throw new Error(`Finance failed to query report history: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}

async function buildWeeklyFinanceSummary(now = new Date()): Promise<WeeklyFinanceSummary> {
  const sinceIso = new Date(now.getTime() - (7 * 24 * 60 * 60_000)).toISOString()
  const [runs, monthToDateCost, state] = await Promise.all([
    getWeeklyRuns(sinceIso),
    getMonthlyCost(),
    getProjectState(),
  ])

  const totalCostUsd = runs.reduce((sum, row) => sum + (row.cost_usd ?? 0), 0)
  const totalRuns = runs.length
  const failureRuns = runs.filter((row) => row.outcome === 'failure').length
  const totalTokens = runs.reduce((sum, row) => sum + row.tokens_input + row.tokens_output, 0)

  const byAgent = new Map<string, number>()
  const byModel = new Map<string, number>()

  for (const row of runs) {
    byAgent.set(row.agent_id, (byAgent.get(row.agent_id) ?? 0) + (row.cost_usd ?? 0))
    byModel.set(row.model_id, (byModel.get(row.model_id) ?? 0) + (row.cost_usd ?? 0))
  }

  const topAgents = Array.from(byAgent.entries())
    .map(([agentId, costUsd]) => ({ agentId, costUsd }))
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 3)

  const topModels = Array.from(byModel.entries())
    .map(([modelId, costUsd]) => ({ modelId, costUsd }))
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 3)

  return {
    weekKey: getWeekKey(now),
    sinceIso,
    totalCostUsd,
    monthToDateCostUsd: monthToDateCost,
    monthlyBudgetUsd: state?.monthly_budget_usd ?? Number.parseFloat(process.env['MONTHLY_BUDGET_USD'] ?? '500'),
    totalRuns,
    failureRuns,
    totalTokens,
    topAgents,
    topModels,
  }
}

function renderWeeklyFinanceSummary(summary: WeeklyFinanceSummary): string {
  const topAgentLines =
    summary.topAgents.length > 0
      ? summary.topAgents.map((item) => `- ${item.agentId}: $${item.costUsd.toFixed(2)}`)
      : ['- no runs']

  const topModelLines =
    summary.topModels.length > 0
      ? summary.topModels.map((item) => `- ${item.modelId}: $${item.costUsd.toFixed(2)}`)
      : ['- no runs']

  const budgetPct =
    summary.monthlyBudgetUsd > 0
      ? Math.round((summary.monthToDateCostUsd / summary.monthlyBudgetUsd) * 100)
      : 0

  return [
    `💸 *Finance Weekly Report*`,
    ``,
    `Window start: ${summary.sinceIso.slice(0, 10)}`,
    `Week key: ${summary.weekKey}`,
    `Weekly cost: $${summary.totalCostUsd.toFixed(2)}`,
    `Month-to-date cost: $${summary.monthToDateCostUsd.toFixed(2)} / $${summary.monthlyBudgetUsd.toFixed(2)} (${budgetPct}%)`,
    `Runs: ${summary.totalRuns} total · ${summary.failureRuns} failed`,
    `Tokens: ${summary.totalTokens.toLocaleString('en-US')}`,
    ``,
    `Top agents:`,
    ...topAgentLines,
    ``,
    `Top models:`,
    ...topModelLines,
  ].join('\n')
}

export async function runFinanceCycle(
  notify: (message: string) => Promise<void>
): Promise<WeeklyFinanceSummary | null> {
  await checkBudget()

  const summary = await buildWeeklyFinanceSummary()
  const alreadySent = await hasWeeklyReport(summary.weekKey)
  if (alreadySent) {
    await recordRuntimeRun(
      'Scheduled finance cycle',
      `budget_checked=true; weekly_report_sent=false; week_key=${summary.weekKey}`,
      'success'
    )
    return null
  }

  await recordEvent('finance_report_generated', {
    agentId: 'finance',
    payload: {
      week_key: summary.weekKey,
      window_start: summary.sinceIso,
      total_cost_usd: summary.totalCostUsd,
      month_to_date_cost_usd: summary.monthToDateCostUsd,
      monthly_budget_usd: summary.monthlyBudgetUsd,
      total_runs: summary.totalRuns,
      failure_runs: summary.failureRuns,
      total_tokens: summary.totalTokens,
      top_agents: summary.topAgents,
      top_models: summary.topModels,
    },
  })

  const rendered = renderWeeklyFinanceSummary(summary)
  await notify(rendered)
  await recordRuntimeRun('Scheduled finance cycle', rendered, 'success')
  return summary
}

export function startFinanceRuntime(
  notify: (message: string) => Promise<void>,
  intervalMs = DEFAULT_INTERVAL_MS
): NodeJS.Timeout {
  log.info({ intervalMs }, 'Starting Finance runtime')

  void runFinanceCycle(notify).catch(async (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    log.error({ err }, 'Finance initial cycle failed')
    await recordRuntimeRun('Scheduled finance cycle', '', 'failure', message)
  })

  return setInterval(() => {
    void runFinanceCycle(notify).catch(async (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      log.error({ err }, 'Finance cycle failed')
      await recordRuntimeRun('Scheduled finance cycle', '', 'failure', message)
    })
  }, intervalMs)
}

export async function runFinanceAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  await updateTaskStatus(task.id, 'in_progress')

  try {
    await checkBudget()
    const summary = await buildWeeklyFinanceSummary()
    const rendered = renderWeeklyFinanceSummary(summary)

    await recordEvent('task_completed', {
      agentId: 'finance',
      taskId: task.id,
      payload: {
        week_key: summary.weekKey,
        total_cost_usd: summary.totalCostUsd,
        month_to_date_cost_usd: summary.monthToDateCostUsd,
        total_runs: summary.totalRuns,
      },
    })

    await recordRuntimeRun(task.description, rendered, 'success', undefined, task.id)
    await updateTaskStatus(task.id, 'done')
    await notify(rendered)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    await recordEvent('agent_error', {
      agentId: 'finance',
      taskId: task.id,
      payload: { error: message },
      severity: 'error',
    })

    await recordRuntimeRun(task.description, '', 'failure', message, task.id)
    await updateTaskStatus(task.id, 'blocked').catch(() => {})

    await notify(
      [
        `❌ *Finance Error*`,
        ``,
        `Task: ${task.title}`,
        `Error: ${truncate(message, 320)}`,
      ].join('\n')
    )

    throw err
  }
}
