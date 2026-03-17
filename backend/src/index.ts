// ============================================================
// WAI Backend – Entry Point
// ============================================================

import 'dotenv/config'
import { log, recordEvent } from './services/logger.js'
import { getTelegramBot } from './services/telegram.js'
import { startBudgetMonitor } from './services/budget.js'
import { getAgents, updateAgentStatus, getProjectState } from './services/supabase.js'
import { AGENTS, getAllAgentIds } from './config/agents.js'

async function main(): Promise<void> {
  log.info('WAI Backend starting...')

  // --- Validate environment ---
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_FOUNDER_CHAT_ID',
  ]
  const missing = required.filter((k) => !process.env[k])
  if (missing.length > 0) {
    log.fatal({ missing }, 'Missing required environment variables')
    process.exit(1)
  }

  // --- Log startup event ---
  await recordEvent('system_startup', {
    severity: 'info',
    payload: { version: '0.1.0', agents: getAllAgentIds() },
  })

  // --- Mark all known agents as online ---
  try {
    for (const agentId of getAllAgentIds()) {
      await updateAgentStatus(agentId, 'online')
    }
    log.info({ count: getAllAgentIds().length }, 'Agents marked online')
  } catch (err) {
    log.warn({ err }, 'Failed to update agent statuses (DB may not be ready yet)')
  }

  // --- Start Telegram bot ---
  try {
    const bot = getTelegramBot()
    void bot.start({
      onStart: () => {
        log.info('Telegram bot started')
      },
    })
  } catch (err) {
    log.error({ err }, 'Failed to start Telegram bot')
  }

  // --- Start budget monitor (every hour) ---
  startBudgetMonitor(3_600_000)

  // --- Project state summary ---
  try {
    const state = await getProjectState()
    log.info(
      {
        phase: state?.phase,
        milestone: state?.current_milestone,
        monthlyCost: state?.monthly_cost_usd,
      },
      'WAI system ready'
    )
  } catch (err) {
    log.warn({ err }, 'Could not read project state')
  }

  // --- Graceful shutdown ---
  process.on('SIGTERM', async () => {
    log.info('SIGTERM received, shutting down...')
    await recordEvent('system_shutdown', { severity: 'info' })
    for (const agentId of getAllAgentIds()) {
      await updateAgentStatus(agentId, 'offline').catch(() => {})
    }
    process.exit(0)
  })

  log.info('WAI Backend running ✓')
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
