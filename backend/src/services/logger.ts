// ============================================================
// WAI – Centralized Logger
// Wraps pino for structured logging + Supabase event writing
// ============================================================

import pino from 'pino'
import { logCapabilityEvent, logEvent, logRun } from './supabase.js'
import type {
  EventType,
  EventSeverity,
  LogCapabilityEventInput,
  LogRunInput,
} from '../types/index.js'

// ---------------------------------------------------------------------------
// Pino logger (structured JSON logging)
// ---------------------------------------------------------------------------

const pinoOptions: pino.LoggerOptions = {
  level: process.env['LOG_LEVEL'] ?? 'info',
}
if (process.env['NODE_ENV'] === 'development') {
  pinoOptions.transport = { target: 'pino-pretty', options: { colorize: true } }
}

export const log = pino(pinoOptions)

// ---------------------------------------------------------------------------
// Supabase event logger (persisted events for Dashboard)
// ---------------------------------------------------------------------------

export async function recordEvent(
  type: EventType,
  options: {
    agentId?: string
    taskId?: string
    payload?: Record<string, unknown>
    severity?: EventSeverity
  } = {}
): Promise<void> {
  try {
    await logEvent({
      type,
      ...(options.agentId !== undefined && { agent_id: options.agentId }),
      ...(options.taskId !== undefined && { task_id: options.taskId }),
      payload: options.payload ?? {},
      severity: options.severity ?? 'info',
    })
  } catch (err) {
    log.error({ err, type }, 'Failed to record event to Supabase')
  }
}

export async function recordCapabilityEvent(
  input: LogCapabilityEventInput,
): Promise<void> {
  try {
    await logCapabilityEvent(input)
  } catch (err) {
    log.error({ err, capabilityId: input.capability_id, eventType: input.event_type }, 'Failed to record capability event to Supabase')
  }
}

// ---------------------------------------------------------------------------
// Agent run recorder
// ---------------------------------------------------------------------------

export async function recordRun(input: LogRunInput): Promise<void> {
  try {
    await logRun(input)
    log.debug(
      {
        agentId: input.agent_id,
        modelId: input.model_id,
        outcome: input.outcome,
        tokens: input.tokens_input + input.tokens_output,
      },
      'Agent run recorded'
    )
  } catch (err) {
    log.error({ err }, 'Failed to record run to Supabase')
  }
}

// ---------------------------------------------------------------------------
// Budget alert logger
// ---------------------------------------------------------------------------

export async function recordBudgetAlert(
  currentCost: number,
  budgetUsd: number,
  severity: EventSeverity
): Promise<void> {
  const percentage = Math.round((currentCost / budgetUsd) * 100)
  await recordEvent('budget_alert', {
    severity,
    payload: {
      current_cost_usd: currentCost,
      budget_usd: budgetUsd,
      percentage,
    },
  })
  log.warn({ currentCost, budgetUsd, percentage }, `Budget alert: ${percentage}% used`)
}
