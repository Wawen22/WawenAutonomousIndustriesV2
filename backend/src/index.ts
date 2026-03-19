// ============================================================
// WAI Backend – Entry Point
// ============================================================

import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { readdir, readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { log, recordEvent } from './services/logger.js'
import {
  executeFounderTaskAction,
  formatFounderTaskActionMessage,
} from './services/founder_task_actions.js'
import {
  executeInvoiceProject,
  executeMarkProjectPaid,
  formatInvoiceProjectMessage,
  formatMarkProjectPaidMessage,
} from './services/founder_revenue_actions.js'
import { getTelegramBot, sendTelegramNotification } from './services/telegram.js'
import { updateAgentStatus, getProjectState } from './services/supabase.js'
import { getAllAgentIds } from './config/agents.js'
import { pingLiteLLM } from './services/llm.js'
import { getWorkspaceRoot } from './services/workspace.js'
import { getPersonalContext, updatePersonalProfile } from './services/personal-context.js'
import { startOpsMonitor } from './agents/ops.js'
import { startFinanceRuntime } from './agents/finance.js'
import { startHrRuntime } from './agents/hr.js'

function isLocalRequest(req: IncomingMessage): boolean {
  const remote = req.socket.remoteAddress ?? ''
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
}

function isAllowedDashboardOrigin(origin: string | undefined): boolean {
  if (!origin) return true
  return origin === 'http://localhost:3000' || origin === 'http://127.0.0.1:3000'
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  const raw = Buffer.concat(chunks).toString('utf-8').trim()
  if (!raw) return {}

  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new Error('Invalid JSON body')
  }
}

async function main(): Promise<void> {
  const PORT = parseInt(process.env['PORT'] ?? '3001', 10)

  // --- HTTP server: health + API ---
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // CORS for dashboard on localhost:3000
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
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

      const projectDir = join(getWorkspaceRoot(), ...parts)
      const deliverableDir = join(projectDir, 'deliverables')
      const outputDir = join(projectDir, 'output')
      const repoDir = join(projectDir, 'repo')

      void (async () => {
        try {
          const DELIVERABLE_EXTS = new Set(['.md', '.pdf', '.txt', '.html', '.css', '.js', '.ts', '.py', '.json', '.yaml', '.yml'])
          // Code-only extensions shown in the Project Files tab (no .md — those live in deliverables)
          const CODE_EXTS = new Set(['.html', '.css', '.js', '.ts', '.jsx', '.tsx', '.py', '.json', '.yaml', '.yml', '.sh', '.env.example'])
          const IGNORED_REPO_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.turbo', '.cache', '.vercel'])

          // Flat scan of a single directory (no recursion)
          async function scanDir(dir: string, dirType: 'deliverable' | 'output') {
            if (!existsSync(dir)) return []
            const entries = await readdir(dir, { withFileTypes: true })
            const fileEntries = entries.filter((e) => {
              if (!e.isFile()) return false
              const ext = e.name.lastIndexOf('.') >= 0 ? e.name.slice(e.name.lastIndexOf('.')) : ''
              return DELIVERABLE_EXTS.has(ext) || ext === ''
            })
            return Promise.all(
              fileEntries.map(async (e) => {
                const fileStat = await stat(join(dir, e.name))
                return { name: e.name, modified_at: fileStat.mtime.toISOString(), size_bytes: fileStat.size, dir: dirType }
              })
            )
          }

          // Recursive scan of repo/ — max depth 3, skip ignored dirs, code files only
          async function scanRepo(dir: string, relBase: string, depth: number): Promise<Array<{ name: string; modified_at: string; size_bytes: number; dir: 'repo' }>> {
            if (!existsSync(dir) || depth > 3) return []
            const entries = await readdir(dir, { withFileTypes: true })
            const results: Array<{ name: string; modified_at: string; size_bytes: number; dir: 'repo' }> = []
            for (const e of entries) {
              if (e.isDirectory()) {
                if (!IGNORED_REPO_DIRS.has(e.name)) {
                  const sub = await scanRepo(join(dir, e.name), relBase ? `${relBase}/${e.name}` : e.name, depth + 1)
                  results.push(...sub)
                }
              } else if (e.isFile()) {
                const ext = e.name.lastIndexOf('.') >= 0 ? e.name.slice(e.name.lastIndexOf('.')) : ''
                if (CODE_EXTS.has(ext)) {
                  const fileStat = await stat(join(dir, e.name))
                  results.push({
                    name: relBase ? `${relBase}/${e.name}` : e.name,
                    modified_at: fileStat.mtime.toISOString(),
                    size_bytes: fileStat.size,
                    dir: 'repo',
                  })
                }
              }
            }
            return results
          }

          const [deliverableFiles, outputFiles, repoFiles] = await Promise.all([
            scanDir(deliverableDir, 'deliverable'),
            scanDir(outputDir, 'output'),
            scanRepo(repoDir, '', 0),
          ])

          const allFiles = [...deliverableFiles, ...outputFiles, ...repoFiles]
          allFiles.sort((a, b) => b.modified_at.localeCompare(a.modified_at))

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ files: allFiles }))
        } catch (err) {
          log.error({ err, projectDir }, 'Deliverables API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      })()
      return
    }

    // GET /api/file?path=workspace/client/project/repo/index.html
    if (url.pathname === '/api/file' && req.method === 'GET') {
      const relPath = url.searchParams.get('path')

      if (!relPath) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing path query param' }))
        return
      }

      // Sanitize path: strip leading "workspace/", reject traversal
      const stripped = relPath.replace(/^workspace\//, '')
      const parts = stripped.split('/').filter((p) => p && !p.includes('..'))

      if (parts.length < 3) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid path' }))
        return
      }

      const absPath = join(getWorkspaceRoot(), ...parts)

      void (async () => {
        try {
          if (!existsSync(absPath)) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'File not found' }))
            return
          }

          const fileStat = await stat(absPath)
          if (!fileStat.isFile()) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Not a file' }))
            return
          }

          // Only allow safe text/code extensions
          const ALLOWED_EXTS = new Set(['.html', '.css', '.js', '.ts', '.json', '.md', '.txt', '.yaml', '.yml'])
          const ext = absPath.lastIndexOf('.') >= 0 ? absPath.slice(absPath.lastIndexOf('.')) : ''
          if (!ALLOWED_EXTS.has(ext)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'File type not allowed' }))
            return
          }

          const content = await readFile(absPath, 'utf-8')
          const contentType = ext === '.html' ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8'
          res.writeHead(200, { 'Content-Type': contentType })
          res.end(content)
        } catch (err) {
          log.error({ err, absPath }, 'File API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      })()
      return
    }

    // GET /api/repo/workspace/<client>/<project>/repo/<...file>
    // Static-serves files from a repo directory so relative CSS/JS refs resolve.
    if (url.pathname.startsWith('/api/repo/') && req.method === 'GET') {
      const rawPath = url.pathname.slice('/api/repo/'.length) // "workspace/client/project/repo/index.html"

      // Sanitize: reject traversal, must start with "workspace/"
      const parts = rawPath.split('/').filter((p) => p !== '' && !p.includes('..'))
      if (parts.length < 5 || parts[0] !== 'workspace') {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid path' }))
        return
      }

      // Must pass through the "repo" segment for safety
      const repoIdx = parts.indexOf('repo')
      if (repoIdx < 0) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Only repo/ files are served via this route' }))
        return
      }

      const absPath = join(getWorkspaceRoot(), ...parts.slice(1)) // strip "workspace" prefix — getWorkspaceRoot already is workspace/

      void (async () => {
        try {
          if (!existsSync(absPath)) {
            res.writeHead(404)
            res.end()
            return
          }

          const fileStat = await stat(absPath)
          if (!fileStat.isFile()) {
            res.writeHead(404)
            res.end()
            return
          }

          const EXT_MIME: Record<string, string> = {
            '.html': 'text/html; charset=utf-8',
            '.css':  'text/css; charset=utf-8',
            '.js':   'application/javascript; charset=utf-8',
            '.ts':   'application/javascript; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.svg':  'image/svg+xml',
            '.png':  'image/png',
            '.jpg':  'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.ico':  'image/x-icon',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
            '.txt':  'text/plain; charset=utf-8',
            '.md':   'text/plain; charset=utf-8',
          }

          const extRaw = absPath.lastIndexOf('.') >= 0 ? absPath.slice(absPath.lastIndexOf('.')) : ''
          const mime = EXT_MIME[extRaw] ?? 'application/octet-stream'

          // For binary files (images, fonts) serve as buffer; text as utf-8
          const isBinary = ['.png', '.jpg', '.jpeg', '.ico', '.woff', '.woff2'].includes(extRaw)
          if (isBinary) {
            const buf = await import('node:fs/promises').then((m) => m.readFile(absPath))
            res.writeHead(200, { 'Content-Type': mime })
            res.end(buf)
          } else {
            const content = await readFile(absPath, 'utf-8')
            res.writeHead(200, { 'Content-Type': mime })
            res.end(content)
          }
        } catch (err) {
          log.error({ err, absPath }, 'Repo static API error')
          res.writeHead(500)
          res.end()
        }
      })()
      return
    }

    if (url.pathname === '/api/founder/task-action' && req.method === 'POST') {
      void (async () => {
        try {
          if (!isLocalRequest(req) || !isAllowedDashboardOrigin(req.headers.origin)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }

          const body = await readJsonBody(req)
          const payload = typeof body === 'object' && body !== null
            ? body as Record<string, unknown>
            : {}

          const taskId = typeof payload['taskId'] === 'string' ? payload['taskId'].trim() : ''
          const action = typeof payload['action'] === 'string' ? payload['action'].trim() : ''
          const reason = typeof payload['reason'] === 'string' ? payload['reason'] : undefined

          if (!taskId || (action !== 'retry' && action !== 'approve' && action !== 'reject')) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid task action payload' }))
            return
          }

          const result = await executeFounderTaskAction(taskId, action, {
            source: 'dashboard',
            reason,
            notify: sendTelegramNotification,
          })

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            ok: true,
            task_id: result.task.id,
            action: result.action,
            status: result.nextStatus,
            queued: result.queued,
            message: result.message,
            telegram_message: formatFounderTaskActionMessage(result),
          }))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          log.error({ err }, 'Founder task action API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })()
      return
    }

    if (url.pathname === '/api/founder/revenue-action' && req.method === 'POST') {
      void (async () => {
        try {
          if (!isLocalRequest(req) || !isAllowedDashboardOrigin(req.headers.origin)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }

          const body = await readJsonBody(req)
          const payload = typeof body === 'object' && body !== null
            ? body as Record<string, unknown>
            : {}

          const action = typeof payload['action'] === 'string' ? payload['action'].trim() : ''
          const clientSlug = typeof payload['clientSlug'] === 'string' ? payload['clientSlug'].trim() : ''
          const projectSlug = typeof payload['projectSlug'] === 'string' ? payload['projectSlug'].trim() : ''
          const amountRaw = payload['amountUsd']
          const amountUsd = typeof amountRaw === 'number'
            ? amountRaw
            : typeof amountRaw === 'string'
              ? Number(amountRaw)
              : undefined

          if (!clientSlug || !projectSlug || (action !== 'invoice' && action !== 'mark_paid')) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid revenue action payload' }))
            return
          }

          if (action === 'mark_paid' && (amountUsd === undefined || !Number.isFinite(amountUsd))) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'mark_paid requires a valid amountUsd' }))
            return
          }

          if (amountUsd !== undefined && !Number.isFinite(amountUsd)) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid amountUsd' }))
            return
          }

          if (action === 'invoice') {
            const result = await executeInvoiceProject(clientSlug, projectSlug, amountUsd, 'dashboard')
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              ok: true,
              action,
              project_id: result.project.id,
              status: result.project.status,
              contract_value_usd: result.contractValueUsd,
              message: `Project invoiced at $${result.contractValueUsd.toFixed(2)}.`,
              telegram_message: formatInvoiceProjectMessage(result),
            }))
            return
          }

          const result = await executeMarkProjectPaid(clientSlug, projectSlug, amountUsd ?? 0, 'dashboard')
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            ok: true,
            action,
            project_id: result.project.id,
            payment_id: result.payment.id,
            amount_usd: result.amountUsd,
            total_paid_usd: result.totalPaidUsd,
            outstanding_usd: result.outstandingUsd,
            message: `Payment recorded: $${result.amountUsd.toFixed(2)}.`,
            telegram_message: formatMarkProjectPaidMessage(result),
          }))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          log.error({ err }, 'Founder revenue action API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })()
      return
    }

    if (url.pathname === '/api/personal/context' && req.method === 'GET') {
      void (async () => {
        try {
          if (!isLocalRequest(req) || !isAllowedDashboardOrigin(req.headers.origin)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }

          const context = await getPersonalContext()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(context))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          log.error({ err }, 'Personal context API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })()
      return
    }

    if (url.pathname === '/api/personal/context' && req.method === 'POST') {
      void (async () => {
        try {
          if (!isLocalRequest(req) || !isAllowedDashboardOrigin(req.headers.origin)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }

          const body = await readJsonBody(req)
          const payload = typeof body === 'object' && body !== null
            ? body as Record<string, unknown>
            : {}

          const profile = await updatePersonalProfile({
            ...(typeof payload['displayName'] === 'string' ? { displayName: payload['displayName'] } : {}),
            ...(typeof payload['role'] === 'string' ? { role: payload['role'] } : {}),
            ...(typeof payload['primaryEmail'] === 'string' || payload['primaryEmail'] === null ? { primaryEmail: payload['primaryEmail'] as string | null } : {}),
            ...(typeof payload['timezone'] === 'string' ? { timezone: payload['timezone'] } : {}),
            ...(typeof payload['preferredLanguage'] === 'string' ? { preferredLanguage: payload['preferredLanguage'] } : {}),
            ...(typeof payload['assistantStyle'] === 'string' ? { assistantStyle: payload['assistantStyle'] } : {}),
            ...(Array.isArray(payload['priorities']) ? { priorities: payload['priorities'] as string[] } : {}),
          })

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, profile }))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          log.error({ err }, 'Personal context update API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
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

  // --- Start Ops / Finance / HR runtimes ---
  startOpsMonitor(sendTelegramNotification)
  startFinanceRuntime(sendTelegramNotification)
  startHrRuntime(sendTelegramNotification)

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
