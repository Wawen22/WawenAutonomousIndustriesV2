// ============================================================
// WAI – Budget Monitoring Service
// Tracks API costs and fires alerts when thresholds are exceeded.
// ============================================================

import { log, recordBudgetAlert } from './logger.js'
import { getMonthlyCost, updateProjectState } from './supabase.js'
import { sendTelegramNotification } from './telegram.js'
import type { EventSeverity } from '../types/index.js'

const BUDGET_USD = parseFloat(process.env['MONTHLY_BUDGET_USD'] ?? '500')
const ALERT_THRESHOLD = parseFloat(process.env['ALERT_THRESHOLD_PERCENT'] ?? '80') / 100

// Track which alerts have been sent to avoid spam
const alertsSent = new Set<string>()

export async function checkBudget(): Promise<void> {
  try {
    const cost = await getMonthlyCost()
    const ratio = cost / BUDGET_USD

    // Update project_state
    await updateProjectState({ monthly_cost_usd: cost })

    let severity: EventSeverity | null = null
    let alertKey: string | null = null

    if (ratio >= 1.0) {
      severity = 'critical'
      alertKey = 'critical-100'
    } else if (ratio >= ALERT_THRESHOLD) {
      severity = 'warning'
      alertKey = `warning-${Math.floor(ratio * 10) * 10}`
    } else if (ratio >= 0.5) {
      severity = 'info'
      alertKey = 'info-50'
    }

    if (severity && alertKey && !alertsSent.has(alertKey)) {
      alertsSent.add(alertKey)
      await recordBudgetAlert(cost, BUDGET_USD, severity)

      if (severity === 'warning' || severity === 'critical') {
        const pct = Math.round(ratio * 100)
        await sendTelegramNotification(
          `⚠️ *Budget Alert* – ${pct}% used\n$${cost.toFixed(2)} of $${BUDGET_USD.toFixed(2)}`
        )
      }
    }

    // Reset info alert at start of new month
    const now = new Date()
    if (now.getDate() === 1 && now.getHours() === 0) {
      alertsSent.clear()
    }

    log.debug({ cost, budget: BUDGET_USD, ratio: ratio.toFixed(3) }, 'Budget check complete')
  } catch (err) {
    log.error({ err }, 'Budget check failed')
  }
}

export function startBudgetMonitor(intervalMs = 3_600_000): NodeJS.Timer {
  log.info({ intervalMs, budgetUsd: BUDGET_USD }, 'Starting budget monitor')
  return setInterval(() => void checkBudget(), intervalMs)
}
