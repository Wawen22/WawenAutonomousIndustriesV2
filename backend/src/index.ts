// ============================================================
// WAI Backend – Entry Point
// ============================================================

import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { log, recordEvent } from './services/logger.js'
import { getTelegramBot } from './services/telegram.js'
import { startBudgetMonitor } from './services/budget.js'
import { updateAgentStatus, getProjectState } from './services/supabase.js'
import { getAllAgentIds } from './config/agents.js'
import { pingLiteLLM } from './services/llm.js'
import { getWorkspaceRoot } from './services/workspace.js'

async function main(): Promise<void> {
  const PORT = parseInt(process.env['PORT'] ?? '3001', 10)

  // --- HTTP server: health + API ---
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // CORS for dashboard on localhost:3000
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url ?? '/', `http://localhost`)

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', version: '0.1.0' }))
      return
    }

    // GET /api/deliverables?path=workspace/client/project
    if (url.pathname === '/api/deliverables' && req.method === 'GET') {
      const relPath = url.searchParams.get('path')

      if (!relPath) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing path query param' }))
        return
      }

      // Sanitize: strip leading "workspace/" and resolve
      const stripped = relPath.replace(/^workspace\//, '')
      const parts = stripped.split('/').filter((p) => p && !p.includes('..'))

      if (parts.length < 2) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid path' }))
        return
      }

      const deliverableDir = join(getWorkspaceRoot(), ...parts, 'deliverables')

      void (async () => {
        try {
          if (!existsSync(deliverableDir)) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ files: [] }))
            return
          }

          const entries = await readdir(deliverableDir)
          const files = await Promise.all(
            entries
              .filter((e) => e.endsWith('.md') || e.endsWith('.pdf') || e.endsWith('.txt'))
              .map(async (name) => {
                const fileStat = await stat(join(deliverableDir, name))
                return { name, modified_at: fileStat.mtime.toISOString(), size_bytes: fileStat.size }
              })
          )
          files.sort((a, b) => b.modified_at.localeCompare(a.modified_at))

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ files }))
        } catch (err) {
          log.error({ err, deliverableDir }, 'Deliverables API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      })()
      return
    }

    res.writeHead(404)
    res.end()
  })
  server.listen(PORT, () => log.info(`Health server on :${PORT}`))

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

  // --- Ping LiteLLM ---
  const litellmOk = await pingLiteLLM()
  if (litellmOk) {
    log.info('LiteLLM reachable ✓')
  } else {
    log.warn('LiteLLM not reachable — model calls will fail until it is up')
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
    server.close()
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
