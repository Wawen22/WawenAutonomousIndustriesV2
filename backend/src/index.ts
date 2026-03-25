// ============================================================
// WAI Backend – Entry Point
// ============================================================

import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { readdir, readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { log, recordEvent } from './services/logger.js'
import { recordCapabilityEvent } from './services/logger.js'
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
import { getTelegramBot } from './services/telegram.js'
import { updateAgentStatus, upsertAgentRecord, upsertModelRecord, getProjectState, updateProjectStatus } from './services/supabase.js'
import { AGENTS, getAllAgentIds } from './config/agents.js'
import { pingLiteLLM } from './services/llm.js'
import { getMcpBridgeStatus } from './services/mcp-bridge.js'
import {
  callGoogleWorkspaceMcpTool,
  finishGoogleWorkspaceMcpAuth,
  getGoogleWorkspaceMcpRuntimeStatus,
  startGoogleWorkspaceMcpAuth,
} from './services/google-workspace-mcp.js'
import { getWorkspaceRoot } from './services/workspace.js'
import { getPersonalContext, updatePersonalProfile } from './services/personal-context.js'
import { startOpsMonitor } from './agents/ops.js'
import { startFinanceRuntime, runFinanceCycleNow } from './agents/finance.js'
import { startHrRuntime } from './agents/hr.js'
import {
  executePersonalAssistantQuickAction,
  getPersonalAssistantQuickActionPrompt,
  type PersonalAssistantQuickActionId,
} from './services/personal-assistant-actions.js'
import {
  getPersonalAutomationStatus,
  runDailyFounderBriefAutomationNow,
  startFounderAutomationRuntime,
  updateDailyFounderBriefAutomation,
} from './services/personal-automation.js'
import {
  getKnowledgeBaseManifest,
  readKnowledgeBaseDocument,
} from './services/docs-knowledge-base.js'
import {
  getCapabilityById,
  getCapabilityRegistrySnapshot,
} from './services/capabilities.js'
import {
  getDeliveryConfig,
  getGlobalDeliveryDefaults,
  sanitizeDeliveryConfigPatch,
  updateProjectDeliveryConfig,
} from './services/delivery-config.js'
import {
  updateCapabilityGovernance,
  type CapabilityGovernanceUpdateInput,
} from './services/capability-governance.js'
import { runSkill, SkillPolicyError } from './services/skill-runner.js'
import {
  getWhatsAppStatus,
  initWhatsAppSession,
  disconnectWhatsApp,
} from './services/whatsapp.js'
import { sendFounderNotification, sendNotification } from './services/notification-router.js'
import { getNotificationPreferences, updateNotificationPreferences } from './services/notification-preferences.js'
import { getCompanyAutomations, updateCompanyAutomations } from './services/company-automations.js'
import { getAgentMemories, deleteAgentMemory, deleteAgentMemories } from './services/memory.js'
import {
  ingestKnowledgeItem,
  ingestUrl as ingestKnowledgeUrl,
  listKnowledgeItems,
  searchKnowledge,
  deleteKnowledgeItem,
} from './services/knowledge.js'
import {
  getContacts,
  getContact,
  upsertContact,
  deleteContact,
  getInteractions,
  addInteraction,
  deleteInteraction,
} from './services/crm.js'
import {
  getMeetingNotes,
  getMeetingNote,
  saveMeetingNote,
  deleteMeetingNote,
  summarizeMeetingNotes,
} from './services/meeting-notes.js'
import { MODELS, AGENT_MODEL_DEFAULTS, getModelOverrides } from './config/models.js'
import {
  assignModelToAgent,
  getPersistedModelOverrides,
  restorePersistedModelAssignments,
} from './services/model-assignments.js'
import {
  getSpecialModelOverrides,
  updateSpecialModelOverride,
} from './services/model-routing-policy.js'
import type {
  CapabilityAssignmentState,
  CapabilityAssignmentTargetType,
} from './types/index.js'

function isCapabilityAssignmentTargetType(value: unknown): value is CapabilityAssignmentTargetType {
  return value === 'runtime' || value === 'team' || value === 'agent'
}

function isCapabilityAssignmentState(value: unknown): value is CapabilityAssignmentState {
  return value === 'active' || value === 'disabled'
}

function isLocalRequest(req: IncomingMessage): boolean {
  const remote = req.socket.remoteAddress ?? ''
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
}

function isAllowedDashboardOrigin(origin: string | undefined): boolean {
  if (!origin) return true
  // Accept any localhost/127.0.0.1 port — Vite may start on a different port when 3000 is taken
  return origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')
}

function isAuthorizedRequest(req: IncomingMessage): boolean {
  if (isLocalRequest(req)) return true
  const header = req.headers.authorization?.trim()
  const token = process.env['WAI_DASHBOARD_TOKEN']?.trim()
  if (!header || !token) return false
  return header === `Bearer ${token}`
}

function isAuthorizedDashboardRequest(req: IncomingMessage): boolean {
  return isAuthorizedRequest(req) && isAllowedDashboardOrigin(req.headers.origin)
}

function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  const resolvedRoot = resolvePath(rootPath)
  const resolvedCandidate = resolvePath(candidatePath)
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}/`)
}

function getRequestBaseUrl(req: IncomingMessage): string {
  const explicit = process.env['PUBLIC_BACKEND_URL']?.trim()
  if (explicit) {
    return explicit.replace(/\/$/, '')
  }

  const forwardedProto = req.headers['x-forwarded-proto']
  const proto = typeof forwardedProto === 'string' && forwardedProto.trim()
    ? (forwardedProto.split(',')[0] ?? 'http').trim()
    : 'http'

  const forwardedHost = req.headers['x-forwarded-host']
  const hostHeader = typeof forwardedHost === 'string' && forwardedHost.trim()
    ? (forwardedHost.split(',')[0] ?? '').trim()
    : req.headers.host ?? `127.0.0.1:${process.env['BACKEND_PORT'] ?? process.env['PORT'] ?? '3001'}`

  return `${proto}://${hostHeader}`.replace(/\/$/, '')
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
    const allowedOrigin = isAllowedDashboardOrigin(req.headers.origin) ? req.headers.origin : undefined
    if (allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
      res.setHeader('Vary', 'Origin')
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

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

    if (url.pathname === '/api/docs/manifest' && req.method === 'GET') {
      void (async () => {
        try {
          const manifest = await getKnowledgeBaseManifest()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(manifest))
        } catch (err) {
          log.error({ err }, 'Knowledge base manifest API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      })()
      return
    }

    if (url.pathname === '/api/docs/content' && req.method === 'GET') {
      const relativePath = url.searchParams.get('path')

      if (!relativePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing path query param' }))
        return
      }

      void (async () => {
        try {
          const content = await readKnowledgeBaseDocument(relativePath)
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end(content)
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Knowledge base read failed'
          const statusCode = message.toLowerCase().includes('not found') || message.toLowerCase().includes('invalid')
            ? 404
            : 500
          if (statusCode === 500) {
            log.error({ err, relativePath }, 'Knowledge base content API error')
          }
          res.writeHead(statusCode, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })()
      return
    }

    if (url.pathname === '/api/capabilities' && req.method === 'GET') {
      void (async () => {
        try {
          const snapshot = await getCapabilityRegistrySnapshot()
          const typeParam = url.searchParams.get('type')
          if (typeParam) {
            const filtered = {
              ...snapshot,
              catalog: snapshot.catalog.filter((entry) => entry.capability.type === typeParam),
              assignments: snapshot.assignments.filter((assignment) =>
                snapshot.catalog.some((entry) =>
                  entry.capability.id === assignment.capabilityId && entry.capability.type === typeParam
                )
              ),
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(filtered))
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(snapshot))
          }
        } catch (err) {
          log.error({ err }, 'Capabilities registry API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      })()
      return
    }

    // POST /api/skills/:id/run — T100 Skill Execution Context
    const skillRunMatch = url.pathname.match(/^\/api\/skills\/(.+)\/run$/)
    if (skillRunMatch && req.method === 'POST') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }

          const skillId = decodeURIComponent(skillRunMatch[1] ?? '').trim()
          if (!skillId) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing skill id' }))
            return
          }

          const body = await readJsonBody(req)
          const payload = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}

          const input = typeof payload['input'] === 'object' && payload['input'] !== null
            ? payload['input'] as Record<string, unknown>
            : {}

          const forceApproval = payload['forceApproval'] === true

          const result = await runSkill(
            skillId,
            input,
            { source: 'dashboard:capabilities-panel', actorId: 'neb' },
            forceApproval,
          )

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, ...result }))
        } catch (err) {
          if (err instanceof SkillPolicyError) {
            const statusCode = err.requiresApproval ? 403 : 400
            res.writeHead(statusCode, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              error: err.message,
              ...(err.requiresApproval ? { requiresApproval: true } : {}),
            }))
            return
          }
          const message = err instanceof Error ? err.message : 'Unknown error'
          log.error({ err }, 'Skill run API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })()
      return
    }

    const capabilityGovernanceMatch = url.pathname.match(/^\/api\/capabilities\/(.+)\/governance$/)
    if (capabilityGovernanceMatch && req.method === 'POST') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }

          const capabilityId = decodeURIComponent(capabilityGovernanceMatch[1] ?? '').trim()
          if (!capabilityId) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing capability id' }))
            return
          }

          const beforeEntry = await getCapabilityById(capabilityId)
          if (!beforeEntry) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Capability not found' }))
            return
          }

          const body = await readJsonBody(req)
          const payload = typeof body === 'object' && body !== null
            ? body as Record<string, unknown>
            : {}

          const allowedPolicyModes = new Set(['open', 'restricted', 'approval_required', 'read_only'])
          const policyModeRaw = payload['policyMode']
          const policyMode = typeof policyModeRaw === 'string' && allowedPolicyModes.has(policyModeRaw)
            ? policyModeRaw as 'open' | 'restricted' | 'approval_required' | 'read_only'
            : undefined

          const policyNotes = typeof payload['policyNotes'] === 'string' || payload['policyNotes'] === null
            ? payload['policyNotes'] as string | null
            : undefined

          const assignmentStateRaw = payload['assignments']
          const validAssignments = new Set(
            beforeEntry.assignments.map((assignment) => `${assignment.targetType}:${assignment.targetId}`)
          )

          const assignments = Array.isArray(assignmentStateRaw)
            ? assignmentStateRaw.reduce<NonNullable<CapabilityGovernanceUpdateInput['assignments']>>((acc, item) => {
              if (typeof item !== 'object' || item === null) return acc

              const targetType = item['targetType']
              const targetId = item['targetId']
              const state = item['state']

              if (
                !isCapabilityAssignmentTargetType(targetType) ||
                typeof targetId !== 'string' ||
                !isCapabilityAssignmentState(state) ||
                !validAssignments.has(`${targetType}:${targetId}`)
              ) {
                return acc
              }

              const notes = typeof item['notes'] === 'string' || item['notes'] === null
                ? item['notes']
                : undefined

              acc.push({
                targetType,
                targetId,
                state,
                ...(notes !== undefined ? { notes } : {}),
              })
              return acc
            }, [])
            : undefined

          await updateCapabilityGovernance(
            capabilityId,
            {
              ...(policyMode !== undefined ? { policyMode } : {}),
              ...(policyNotes !== undefined ? { policyNotes } : {}),
              ...(assignments ? { assignments } : {}),
            },
            'neb',
          )

          const afterEntry = await getCapabilityById(capabilityId)
          if (!afterEntry) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Capability governance update failed' }))
            return
          }

          if (
            beforeEntry.policy.mode !== afterEntry.policy.mode ||
            (beforeEntry.policy.notes ?? '') !== (afterEntry.policy.notes ?? '')
          ) {
            await recordCapabilityEvent({
              capability_id: capabilityId,
              event_type: 'configured',
              actor_type: 'dashboard',
              actor_id: 'neb',
              source: 'capabilities:governance-save',
              summary: `Capability policy updated for ${afterEntry.capability.label}.`,
              payload: {
                previous_mode: beforeEntry.policy.mode,
                mode: afterEntry.policy.mode,
                previous_notes: beforeEntry.policy.notes ?? null,
                notes: afterEntry.policy.notes ?? null,
              },
            })
          }

          const beforeAssignments = new Map(
            beforeEntry.assignments.map((assignment) => [`${assignment.targetType}:${assignment.targetId}`, assignment])
          )

          for (const assignment of afterEntry.assignments) {
            const key = `${assignment.targetType}:${assignment.targetId}`
            const previous = beforeAssignments.get(key)
            if (!previous || previous.state === assignment.state) continue

            await recordCapabilityEvent({
              capability_id: capabilityId,
              event_type: assignment.state === 'disabled' ? 'disabled' : 'enabled',
              actor_type: 'dashboard',
              actor_id: 'neb',
              source: 'capabilities:governance-save',
              summary: `${afterEntry.capability.label}: ${assignment.label} set to ${assignment.state}.`,
              payload: {
                target_type: assignment.targetType,
                target_id: assignment.targetId,
                previous_state: previous.state,
                state: assignment.state,
              },
            })
          }

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, capability: afterEntry }))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          log.error({ err }, 'Capability governance API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })()
      return
    }

    if (url.pathname.startsWith('/api/capabilities/') && req.method === 'GET') {
      const capabilityId = decodeURIComponent(url.pathname.slice('/api/capabilities/'.length)).trim()

      if (!capabilityId) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing capability id' }))
        return
      }

      void (async () => {
        try {
          const entry = await getCapabilityById(capabilityId)
          if (!entry) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Capability not found' }))
            return
          }

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(entry))
        } catch (err) {
          log.error({ err, capabilityId }, 'Capability detail API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      })()
      return
    }

    if (url.pathname === '/api/delivery/defaults' && req.method === 'GET') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }

          const defaults = await getGlobalDeliveryDefaults()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(defaults))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          log.error({ err }, 'Delivery defaults API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })()
      return
    }

    const projectDeliveryConfigMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/delivery-config$/)
    if (projectDeliveryConfigMatch && req.method === 'GET') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }

          const projectId = decodeURIComponent(projectDeliveryConfigMatch[1] ?? '').trim()
          if (!projectId) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing project id' }))
            return
          }

          const config = await getDeliveryConfig(projectId)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(config))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          const statusCode = /not found/i.test(message) ? 404 : 500
          log.error({ err }, 'Project delivery config GET API error')
          res.writeHead(statusCode, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })()
      return
    }

    if (projectDeliveryConfigMatch && req.method === 'PATCH') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }

          const projectId = decodeURIComponent(projectDeliveryConfigMatch[1] ?? '').trim()
          if (!projectId) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing project id' }))
            return
          }

          const body = await readJsonBody(req)
          const patch = sanitizeDeliveryConfigPatch(body)
          if (Object.keys(patch).length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'No valid delivery config fields provided' }))
            return
          }

          const config = await updateProjectDeliveryConfig(projectId, patch)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(config))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          const statusCode = /not found/i.test(message) ? 404 : 500
          log.error({ err }, 'Project delivery config PATCH API error')
          res.writeHead(statusCode, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })()
      return
    }

    // POST /api/projects/:id/restart — reset a blocked/paused project back to active
    const projectRestartMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/restart$/)
    if (projectRestartMatch && req.method === 'POST') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }
          const projectId = decodeURIComponent(projectRestartMatch[1] ?? '').trim()
          if (!projectId) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing project id' }))
            return
          }
          await updateProjectStatus(projectId, 'active')
          await recordEvent('founder_command', {
            payload: { command: 'restart_project', project_id: projectId, source: 'dashboard' },
          })
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          log.error({ err }, 'Project restart API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })()
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

      const workspaceRoot = getWorkspaceRoot()
      const projectDir = resolvePath(workspaceRoot, ...parts)
      if (!isPathWithinRoot(workspaceRoot, projectDir)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'forbidden' }))
        return
      }
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

      const workspaceRoot = getWorkspaceRoot()
      const absPath = resolvePath(workspaceRoot, ...parts)
      if (!isPathWithinRoot(workspaceRoot, absPath)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'forbidden' }))
        return
      }

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

      const workspaceRoot = getWorkspaceRoot()
      const absPath = resolvePath(workspaceRoot, ...parts.slice(1)) // strip "workspace" prefix — workspaceRoot already points at workspace/
      if (!isPathWithinRoot(workspaceRoot, absPath)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'forbidden' }))
        return
      }

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
          if (!isAuthorizedDashboardRequest(req)) {
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
            notify: sendFounderNotification,
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
          if (!isAuthorizedDashboardRequest(req)) {
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
          if (!isAuthorizedDashboardRequest(req)) {
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
          if (!isAuthorizedDashboardRequest(req)) {
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

    if (url.pathname === '/api/personal/assistant/quick-action' && req.method === 'POST') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }

          const body = await readJsonBody(req)
          const payload = typeof body === 'object' && body !== null
            ? body as Record<string, unknown>
            : {}

          const actionId = typeof payload['actionId'] === 'string' ? payload['actionId'].trim() : ''
          const prompt = getPersonalAssistantQuickActionPrompt(actionId)

          if (!prompt) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid quick action' }))
            return
          }

          const result = await executePersonalAssistantQuickAction(
            actionId as PersonalAssistantQuickActionId,
            `dashboard:personal:${actionId}`,
          )

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, ...result }))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          log.error({ err }, 'Personal assistant quick action API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })()
      return
    }

    if (url.pathname === '/api/personal/automation/status' && req.method === 'GET') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }

          const status = await getPersonalAutomationStatus()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(status))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          log.error({ err }, 'Personal automation status API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })()
      return
    }

    if (url.pathname === '/api/personal/automation/config' && req.method === 'POST') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }

          const body = await readJsonBody(req)
          const payload = typeof body === 'object' && body !== null
            ? body as Record<string, unknown>
            : {}

          const status = await updateDailyFounderBriefAutomation({
            ...(typeof payload['enabled'] === 'boolean' ? { enabled: payload['enabled'] } : {}),
            ...(typeof payload['scheduleLocalTime'] === 'string'
              ? { scheduleLocalTime: payload['scheduleLocalTime'] }
              : {}),
          }, undefined, 'dashboard')

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, status }))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          log.error({ err }, 'Personal automation config API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })()
      return
    }

    if (url.pathname === '/api/personal/automation/run' && req.method === 'POST') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }

          const status = await runDailyFounderBriefAutomationNow('manual')
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, status }))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          log.error({ err }, 'Personal automation manual run API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })()
      return
    }

    if (url.pathname === '/api/mcp/status' && req.method === 'GET') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }

          const status = await getMcpBridgeStatus()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(status))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          log.error({ err }, 'MCP status API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })()
      return
    }

    if (url.pathname === '/api/mcp/google-workspace/runtime' && req.method === 'GET') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }

          const status = await getGoogleWorkspaceMcpRuntimeStatus()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(status))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          log.error({ err }, 'Google Workspace MCP runtime API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })()
      return
    }

    if (url.pathname === '/api/mcp/google-workspace/auth/start' && req.method === 'POST') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }

          const status = await startGoogleWorkspaceMcpAuth(undefined, getRequestBaseUrl(req))
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, status }))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          log.error({ err }, 'Google Workspace MCP auth start API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })()
      return
    }

    if (url.pathname === '/api/mcp/google-workspace/callback' && req.method === 'GET') {
      void (async () => {
        try {
          if (!isLocalRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('Forbidden')
            return
          }

          const code = url.searchParams.get('code')
          const error = url.searchParams.get('error')

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(`<!doctype html><html><body style="font-family: sans-serif; background:#08111d; color:#fff; padding:32px"><h1>Google Workspace MCP auth failed</h1><p>${error}</p></body></html>`)
            return
          }

          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end('<!doctype html><html><body style="font-family: sans-serif; background:#08111d; color:#fff; padding:32px"><h1>Missing authorization code</h1><p>Retry the Google Workspace MCP auth flow from WAI.</p></body></html>')
            return
          }

          const status = await finishGoogleWorkspaceMcpAuth(code)
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(`<!doctype html><html><body style="font-family: sans-serif; background:#08111d; color:#fff; padding:32px"><h1>Google Workspace MCP connected</h1><p>State: ${status.state}</p><p>Tools discovered: ${status.toolCount}</p><script>setTimeout(() => window.close(), 1800);</script></body></html>`)
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          log.error({ err }, 'Google Workspace MCP callback API error')
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(`<!doctype html><html><body style="font-family: sans-serif; background:#08111d; color:#fff; padding:32px"><h1>Google Workspace MCP callback failed</h1><p>${message}</p></body></html>`)
        }
      })()
      return
    }

    if (url.pathname === '/api/mcp/google-workspace/tool' && req.method === 'POST') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }

          const body = await readJsonBody(req)
          const payload = typeof body === 'object' && body !== null
            ? body as Record<string, unknown>
            : {}

          const name = typeof payload['name'] === 'string' ? payload['name'].trim() : ''
          const args = typeof payload['args'] === 'object' && payload['args'] !== null
            ? payload['args'] as Record<string, unknown>
            : {}

          if (!name) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing tool name' }))
            return
          }

          const result = await callGoogleWorkspaceMcpTool(name, args)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, result }))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          const statusCode = /authorization required/i.test(message) ? 409 : 500
          log.error({ err }, 'Google Workspace MCP tool call API error')
          res.writeHead(statusCode, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })()
      return
    }

    // GET /api/files/exports — recent exported files across all workspace output dirs
    if (url.pathname === '/api/files/exports' && req.method === 'GET') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }

          const EXPORT_EXTS = new Set(['.md', '.txt', '.json', '.csv', '.html'])
          const workspaceRoot = getWorkspaceRoot()

          type ExportedFile = {
            name: string
            relativePath: string
            sizeBytes: number
            createdAt: string
            type: 'md' | 'txt' | 'json' | 'csv' | 'html' | 'other'
            context: 'personal' | 'company'
          }

          // Derive file type label from extension
          function fileType(name: string): ExportedFile['type'] {
            const ext = name.lastIndexOf('.') >= 0 ? name.slice(name.lastIndexOf('.')).toLowerCase() : ''
            const known: Record<string, ExportedFile['type']> = { '.md': 'md', '.txt': 'txt', '.json': 'json', '.csv': 'csv', '.html': 'html' }
            return known[ext] ?? 'other'
          }

          // Scan a single output/ dir and collect files
          async function scanOutputDir(
            dir: string,
            relBase: string,
            context: ExportedFile['context'],
          ): Promise<ExportedFile[]> {
            if (!existsSync(dir)) return []
            const entries = await readdir(dir, { withFileTypes: true })
            const files = entries.filter((e) => {
              if (!e.isFile()) return false
              const ext = e.name.lastIndexOf('.') >= 0 ? e.name.slice(e.name.lastIndexOf('.')).toLowerCase() : ''
              return EXPORT_EXTS.has(ext)
            })
            return Promise.all(
              files.map(async (e) => {
                const fileStat = await stat(join(dir, e.name))
                return {
                  name: e.name,
                  relativePath: `${relBase}/${e.name}`.replace(/\\/g, '/'),
                  sizeBytes: fileStat.size,
                  createdAt: fileStat.mtime.toISOString(),
                  type: fileType(e.name),
                  context,
                } satisfies ExportedFile
              })
            )
          }

          // Discover all output dirs: personal and company
          const results: ExportedFile[] = []

          // personal: workspace/personal/<owner>/output/
          const personalRoot = join(workspaceRoot, 'personal')
          if (existsSync(personalRoot)) {
            const owners = await readdir(personalRoot, { withFileTypes: true })
            for (const owner of owners.filter((e) => e.isDirectory())) {
              const outputDir = join(personalRoot, owner.name, 'output')
              const files = await scanOutputDir(outputDir, `workspace/personal/${owner.name}/output`, 'personal')
              results.push(...files)
            }
          }

          // company: workspace/<client>/<project>/output/
          if (existsSync(workspaceRoot)) {
            const topEntries = await readdir(workspaceRoot, { withFileTypes: true })
            for (const clientDir of topEntries.filter((e) => e.isDirectory() && e.name !== 'personal' && e.name !== 'system')) {
              const clientPath = join(workspaceRoot, clientDir.name)
              const projectEntries = await readdir(clientPath, { withFileTypes: true })
              for (const projectDir of projectEntries.filter((e) => e.isDirectory())) {
                const outputDir = join(clientPath, projectDir.name, 'output')
                const files = await scanOutputDir(outputDir, `workspace/${clientDir.name}/${projectDir.name}/output`, 'company')
                results.push(...files)
              }
            }
          }

          results.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          const limitParam = url.searchParams.get('limit')
          const limit = limitParam ? Math.max(1, Math.min(200, parseInt(limitParam, 10))) : 50
          const paged = results.slice(0, limit)

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ exports: paged, total: results.length }))
        } catch (err) {
          log.error({ err }, 'Files exports API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      })()
      return
    }

    // GET /api/settings/notifications — T118 notification channel preferences
    if (url.pathname === '/api/settings/notifications' && req.method === 'GET') {
      void (async () => {
        try {
          const prefs = await getNotificationPreferences()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(prefs))
        } catch (err) {
          res.writeHead(500)
          res.end(JSON.stringify({ error: 'Failed to get notification preferences' }))
        }
      })()
      return
    }

    // POST /api/settings/notifications — T118 update notification channel preferences
    if (url.pathname === '/api/settings/notifications' && req.method === 'POST') {
      void (async () => {
        try {
          const body = await readJsonBody(req) as { telegram?: boolean; whatsapp?: boolean }
          const updated = await updateNotificationPreferences(body)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(updated))
        } catch (err) {
          res.writeHead(500)
          res.end(JSON.stringify({ error: 'Failed to update notification preferences' }))
        }
      })()
      return
    }

    // GET /api/settings/automations — T118 company automations state
    if (url.pathname === '/api/settings/automations' && req.method === 'GET') {
      void (async () => {
        try {
          const automations = await getCompanyAutomations()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(automations))
        } catch (err) {
          res.writeHead(500)
          res.end(JSON.stringify({ error: 'Failed to get company automations' }))
        }
      })()
      return
    }

    // POST /api/settings/automations/finance-weekly/run — T118 force-send finance report now
    if (url.pathname === '/api/settings/automations/finance-weekly/run' && req.method === 'POST') {
      void (async () => {
        try {
          // Use priority 'critical' to bypass in-memory dedup (60s window) so test sends always go through.
          // Respect channel prefs so only active channels receive it.
          const prefs = await getNotificationPreferences()
          const channels = (['telegram', 'whatsapp'] as const).filter((c) => prefs[c])
          const notify = async (msg: string) => {
            if (channels.length === 0) return
            await sendNotification(msg, { priority: 'critical', channels: [...channels] })
          }
          await runFinanceCycleNow(notify)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          res.writeHead(500)
          res.end(JSON.stringify({ error: message }))
        }
      })()
      return
    }

    // POST /api/settings/automations — T118 update company automations
    if (url.pathname === '/api/settings/automations' && req.method === 'POST') {
      void (async () => {
        try {
          const body = await readJsonBody(req) as Parameters<typeof updateCompanyAutomations>[0]
          const updated = await updateCompanyAutomations(body)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(updated))
        } catch (err) {
          res.writeHead(500)
          res.end(JSON.stringify({ error: 'Failed to update company automations' }))
        }
      })()
      return
    }

    // GET /api/memory — T119 list agent memories with optional filters
    if (url.pathname === '/api/memory' && req.method === 'GET') {
      void (async () => {
        try {
          const agentId = url.searchParams.get('agentId') ?? undefined
          const entityType = url.searchParams.get('entityType') ?? undefined
          const includeExpired = url.searchParams.get('includeExpired') === 'true'
          const limit = Number(url.searchParams.get('limit') ?? '500')
          const search = (url.searchParams.get('search') ?? '').toLowerCase().trim()
          let memories = await getAgentMemories({ agentId, entityType, includeExpired, limit })
          if (search) {
            memories = memories.filter(m =>
              m.content.toLowerCase().includes(search) ||
              m.agent_id.toLowerCase().includes(search) ||
              m.entity_type.toLowerCase().includes(search)
            )
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(memories))
        } catch (err) {
          res.writeHead(500)
          res.end(JSON.stringify({ error: 'Failed to get memories' }))
        }
      })()
      return
    }

    // DELETE /api/memory — T119 delete all memories (optionally scoped to agentId)
    if (url.pathname === '/api/memory' && req.method === 'DELETE') {
      void (async () => {
        try {
          const agentId = url.searchParams.get('agentId') ?? undefined
          const deleted = await deleteAgentMemories(agentId)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ deleted }))
        } catch (err) {
          res.writeHead(500)
          res.end(JSON.stringify({ error: 'Failed to delete memories' }))
        }
      })()
      return
    }

    // DELETE /api/memory/:id — T119 delete a single memory by id
    if (url.pathname.startsWith('/api/memory/') && req.method === 'DELETE') {
      const memoryId = url.pathname.slice('/api/memory/'.length)
      void (async () => {
        try {
          if (!memoryId) {
            res.writeHead(400)
            res.end(JSON.stringify({ error: 'Missing memory id' }))
            return
          }
          await deleteAgentMemory(memoryId)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } catch (err) {
          res.writeHead(500)
          res.end(JSON.stringify({ error: 'Failed to delete memory' }))
        }
      })()
      return
    }

    // GET /api/whatsapp/status — T101 WhatsApp channel status
    if (url.pathname === '/api/whatsapp/status' && req.method === 'GET') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }

          const status = getWhatsAppStatus()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(status))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          log.error({ err }, 'WhatsApp status API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })()
      return
    }

    // POST /api/whatsapp/disconnect — T101 disconnect and clear WhatsApp session
    if (url.pathname === '/api/whatsapp/disconnect' && req.method === 'POST') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }

          await disconnectWhatsApp()

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, message: 'WhatsApp session disconnected.' }))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          log.error({ err }, 'WhatsApp disconnect API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })()
      return
    }

    // POST /api/whatsapp/connect — T101 start or restart WhatsApp session
    if (url.pathname === '/api/whatsapp/connect' && req.method === 'POST') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }

          void initWhatsAppSession()

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, message: 'WhatsApp session starting — check /api/whatsapp/status for QR code.' }))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          log.error({ err }, 'WhatsApp connect API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })()
      return
    }

    // POST /api/whatsapp/test-send — T101 send a test notification via all channels
    if (url.pathname === '/api/whatsapp/test-send' && req.method === 'POST') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }

          await sendFounderNotification('🧪 WAI test notification — Telegram + WhatsApp delivery check.')

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, message: 'Test notification sent via all connected channels.' }))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          log.error({ err }, 'WhatsApp test-send API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })()
      return
    }

    // GET /api/models — T105 model registry + current assignments
    if (url.pathname === '/api/models' && req.method === 'GET') {
      void (async () => {
        try {
          const persistedOverrides = await getPersistedModelOverrides()
          const runtimeOverrides = getModelOverrides()
          // Merge: runtime takes precedence over persisted (they should be in sync, but safety first)
          const effectiveOverrides = { ...persistedOverrides, ...runtimeOverrides }

          // Compute current assignment for every known agent
          const assignments: Record<string, string> = {}
          for (const agentId of Object.keys(AGENT_MODEL_DEFAULTS)) {
            assignments[agentId] = effectiveOverrides[agentId] ?? AGENT_MODEL_DEFAULTS[agentId] ?? 'step-flash'
          }

          res.writeHead(200, { 'Content-Type': 'application/json' })
          const specialOverrides = await getSpecialModelOverrides()
          res.end(JSON.stringify({
            models: MODELS,
            defaults: AGENT_MODEL_DEFAULTS,
            overrides: effectiveOverrides,
            assignments,
            routing_notes: [
              'Assignments saved from the Models view become the runtime default for normal agent runs immediately.',
              'Choosing the default model for an agent clears its persisted override instead of creating redundant config.',
              'Special workflow overrides are founder-governed here: if unset, the workflow inherits the agent assignment.',
              'Primary-model failure fallback is disabled by default; WAI only uses a second model if you explicitly configure one here.',
            ],
            special_overrides: specialOverrides,
          }))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          log.error({ err }, 'Models API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })()
      return
    }

    // POST /api/models/assign — T105 persist model override for an agent
    if (url.pathname === '/api/models/assign' && req.method === 'POST') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }

          const body = await readJsonBody(req)
          const agentId = typeof (body as Record<string, unknown>)['agentId'] === 'string'
            ? (body as Record<string, unknown>)['agentId'] as string
            : null
          const modelId = typeof (body as Record<string, unknown>)['modelId'] === 'string'
            ? (body as Record<string, unknown>)['modelId'] as string
            : null

          if (!agentId || !modelId) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'agentId and modelId are required' }))
            return
          }

          await assignModelToAgent(agentId, modelId)

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, agentId, modelId }))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          log.error({ err }, 'Models assign API error')
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })()
      return
    }

    if (url.pathname === '/api/models/special-override' && req.method === 'POST') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }

          const body = await readJsonBody(req)
          const overrideId = typeof (body as Record<string, unknown>)['id'] === 'string'
            ? (body as Record<string, unknown>)['id'] as string
            : null
          const modelIdValue = (body as Record<string, unknown>)['modelId']
          const modelId = typeof modelIdValue === 'string'
            ? modelIdValue
            : modelIdValue === null
              ? null
              : null

          if (!overrideId) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'id is required' }))
            return
          }

          const specialOverride = await updateSpecialModelOverride(
            overrideId as 'repo_edit_planning',
            modelId,
          )

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, special_override: specialOverride }))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          log.error({ err }, 'Models special override API error')
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })()
      return
    }

    // ── CRM routes (T124 Personal CRM) ─────────────────────────────────────

    // GET /api/crm/contacts — list all contacts (optional ?status= filter)
    if (url.pathname === '/api/crm/contacts' && req.method === 'GET') {
      void (async () => {
        try {
          const status = url.searchParams.get('status')
          const validStatuses = ['active', 'follow_up', 'dormant']
          const filter = status && validStatuses.includes(status)
            ? { status: status as 'active' | 'follow_up' | 'dormant' }
            : undefined
          const contacts = await getContacts(filter)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ contacts }))
        } catch (err) {
          log.error({ err }, 'CRM: list contacts API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      })()
      return
    }

    // POST /api/crm/contacts — create a new contact
    if (url.pathname === '/api/crm/contacts' && req.method === 'POST') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }
          const body = await readJsonBody(req)
          const payload = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
          const name = typeof payload['name'] === 'string' ? payload['name'].trim() : ''
          if (!name) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'name is required' }))
            return
          }
          const contact = await upsertContact({
            name,
            email: typeof payload['email'] === 'string' ? payload['email'] : null,
            company: typeof payload['company'] === 'string' ? payload['company'] : null,
            status: (payload['status'] as 'active' | 'follow_up' | 'dormant') ?? 'active',
            notes: typeof payload['notes'] === 'string' ? payload['notes'] : '',
            tags: Array.isArray(payload['tags']) ? payload['tags'] as string[] : [],
            metadata: typeof payload['metadata'] === 'object' && payload['metadata'] !== null
              ? payload['metadata'] as Record<string, unknown>
              : {},
          })
          res.writeHead(201, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ contact }))
        } catch (err) {
          log.error({ err }, 'CRM: create contact API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      })()
      return
    }

    // Routes under /api/crm/contacts/:id (GET, PUT, DELETE) and /api/crm/contacts/:id/interactions
    if (url.pathname.startsWith('/api/crm/contacts/')) {
      const rest = url.pathname.slice('/api/crm/contacts/'.length)
      const parts = rest.split('/')
      const contactId = parts[0] ?? ''

      // GET /api/crm/contacts/:id
      if (parts.length === 1 && req.method === 'GET') {
        void (async () => {
          try {
            const contact = await getContact(contactId)
            if (!contact) {
              res.writeHead(404, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Not found' }))
              return
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ contact }))
          } catch (err) {
            log.error({ err, contactId }, 'CRM: get contact API error')
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Internal server error' }))
          }
        })()
        return
      }

      // PUT /api/crm/contacts/:id
      if (parts.length === 1 && req.method === 'PUT') {
        void (async () => {
          try {
            if (!isAuthorizedDashboardRequest(req)) {
              res.writeHead(403, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Forbidden' }))
              return
            }
            const body = await readJsonBody(req)
            const payload = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
            const name = typeof payload['name'] === 'string' ? payload['name'].trim() : ''
            if (!name) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'name is required' }))
              return
            }
            const updateInput: import('./services/crm.js').UpsertContactInput = { id: contactId, name }
            if ('email' in payload) updateInput.email = typeof payload['email'] === 'string' ? payload['email'] : null
            if ('company' in payload) updateInput.company = typeof payload['company'] === 'string' ? payload['company'] : null
            if (payload['status'] === 'active' || payload['status'] === 'follow_up' || payload['status'] === 'dormant') updateInput.status = payload['status']
            if (typeof payload['notes'] === 'string') updateInput.notes = payload['notes']
            if (Array.isArray(payload['tags'])) updateInput.tags = payload['tags'] as string[]
            if (typeof payload['metadata'] === 'object' && payload['metadata'] !== null) updateInput.metadata = payload['metadata'] as Record<string, unknown>
            const contact = await upsertContact(updateInput)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ contact }))
          } catch (err) {
            log.error({ err, contactId }, 'CRM: update contact API error')
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Internal server error' }))
          }
        })()
        return
      }

      // DELETE /api/crm/contacts/:id
      if (parts.length === 1 && req.method === 'DELETE') {
        void (async () => {
          try {
            if (!isAuthorizedDashboardRequest(req)) {
              res.writeHead(403, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Forbidden' }))
              return
            }
            await deleteContact(contactId)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))
          } catch (err) {
            log.error({ err, contactId }, 'CRM: delete contact API error')
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Internal server error' }))
          }
        })()
        return
      }

      // GET /api/crm/contacts/:id/interactions
      if (parts.length === 2 && parts[1] === 'interactions' && req.method === 'GET') {
        void (async () => {
          try {
            const interactions = await getInteractions(contactId)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ interactions }))
          } catch (err) {
            log.error({ err, contactId }, 'CRM: list interactions API error')
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Internal server error' }))
          }
        })()
        return
      }

      // POST /api/crm/contacts/:id/interactions
      if (parts.length === 2 && parts[1] === 'interactions' && req.method === 'POST') {
        void (async () => {
          try {
            if (!isAuthorizedDashboardRequest(req)) {
              res.writeHead(403, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Forbidden' }))
              return
            }
            const body = await readJsonBody(req)
            const payload = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
            const type = typeof payload['type'] === 'string' ? payload['type'] : ''
            const summary = typeof payload['summary'] === 'string' ? payload['summary'].trim() : ''
            const validTypes = ['email_in', 'email_out', 'meeting', 'note', 'call']
            if (!validTypes.includes(type) || !summary) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'type and summary are required' }))
              return
            }
            const intInput: import('./services/crm.js').AddInteractionInput = {
              type: type as 'email_in' | 'email_out' | 'meeting' | 'note' | 'call',
              summary,
              source: typeof payload['source'] === 'string'
                ? payload['source'] as 'gmail' | 'manual' | 'calendar'
                : 'manual',
            }
            if (typeof payload['occurred_at'] === 'string') intInput.occurred_at = payload['occurred_at']
            const interaction = await addInteraction(contactId, intInput)
            res.writeHead(201, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ interaction }))
          } catch (err) {
            log.error({ err, contactId }, 'CRM: add interaction API error')
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Internal server error' }))
          }
        })()
        return
      }
    }

    // DELETE /api/crm/interactions/:id
    if (url.pathname.startsWith('/api/crm/interactions/') && req.method === 'DELETE') {
      const interactionId = url.pathname.slice('/api/crm/interactions/'.length)
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }
          if (!interactionId) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing interaction id' }))
            return
          }
          await deleteInteraction(interactionId)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } catch (err) {
          log.error({ err, interactionId }, 'CRM: delete interaction API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      })()
      return
    }

    // ── Meeting Notes routes (T125) ─────────────────────────────────────────

    // GET /api/meeting-notes — list recent meeting notes
    if (url.pathname === '/api/meeting-notes' && req.method === 'GET') {
      void (async () => {
        try {
          const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10), 100)
          const notes = await getMeetingNotes(limit)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ notes }))
        } catch (err) {
          log.error({ err }, 'Meeting notes: list API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      })()
      return
    }

    // POST /api/meeting-notes — save a new note (optionally auto-summarize)
    if (url.pathname === '/api/meeting-notes' && req.method === 'POST') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }
          const payload = await readJsonBody(req) as Record<string, unknown>
          const title = typeof payload['title'] === 'string' ? payload['title'].trim() : ''
          if (!title) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'title is required' }))
            return
          }
          const autoSummarize = payload['auto_summarize'] === true
          const rawNotes = typeof payload['raw_notes'] === 'string' ? payload['raw_notes'] : ''
          const attendees = Array.isArray(payload['attendees'])
            ? (payload['attendees'] as unknown[]).filter((a): a is string => typeof a === 'string')
            : []

          const saveInput: import('./services/meeting-notes.js').SaveMeetingNoteInput = { title }
          if (typeof payload['meeting_date'] === 'string') saveInput.meeting_date = payload['meeting_date']
          if (rawNotes) saveInput.raw_notes = rawNotes
          if (attendees.length > 0) saveInput.attendees = attendees
          if (Array.isArray(payload['action_items'])) saveInput.action_items = payload['action_items'] as import('./types/index.js').ActionItem[]
          if (Array.isArray(payload['contact_ids'])) saveInput.contact_ids = payload['contact_ids'] as string[]

          if (autoSummarize && rawNotes.trim().length > 0) {
            const { summary, action_items } = await summarizeMeetingNotes(title, rawNotes, attendees)
            saveInput.summary = summary
            saveInput.action_items = action_items
          }

          const note = await saveMeetingNote(saveInput)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ note }))
        } catch (err) {
          log.error({ err }, 'Meeting notes: create API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      })()
      return
    }

    // Routes under /api/meeting-notes/:id (GET, PUT, DELETE)
    if (url.pathname.startsWith('/api/meeting-notes/')) {
      const noteId = url.pathname.slice('/api/meeting-notes/'.length)

      // GET /api/meeting-notes/:id
      if (req.method === 'GET') {
        void (async () => {
          try {
            const note = await getMeetingNote(noteId)
            if (!note) {
              res.writeHead(404, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Not found' }))
              return
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ note }))
          } catch (err) {
            log.error({ err, noteId }, 'Meeting notes: get API error')
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Internal server error' }))
          }
        })()
        return
      }

      // PUT /api/meeting-notes/:id — partial update (+ optional re-summarize)
      if (req.method === 'PUT') {
        void (async () => {
          try {
            if (!isAuthorizedDashboardRequest(req)) {
              res.writeHead(403, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Forbidden' }))
              return
            }
            const payload = await readJsonBody(req) as Record<string, unknown>
            const existing = await getMeetingNote(noteId)
            if (!existing) {
              res.writeHead(404, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Not found' }))
              return
            }
            const updateInput: import('./services/meeting-notes.js').SaveMeetingNoteInput = {
              id: noteId,
              title: typeof payload['title'] === 'string' ? payload['title'] : existing.title,
            }
            if (typeof payload['meeting_date'] === 'string') updateInput.meeting_date = payload['meeting_date']
            if (typeof payload['raw_notes'] === 'string') updateInput.raw_notes = payload['raw_notes']
            if (typeof payload['summary'] === 'string') updateInput.summary = payload['summary']
            if (Array.isArray(payload['attendees'])) updateInput.attendees = payload['attendees'] as string[]
            if (Array.isArray(payload['action_items'])) updateInput.action_items = payload['action_items'] as import('./types/index.js').ActionItem[]
            if (Array.isArray(payload['contact_ids'])) updateInput.contact_ids = payload['contact_ids'] as string[]
            if ('calendar_event_id' in payload) updateInput.calendar_event_id = typeof payload['calendar_event_id'] === 'string' ? payload['calendar_event_id'] : null

            // Re-summarize if raw_notes changed and auto_summarize requested
            if (payload['auto_summarize'] === true) {
              const rawNotes = updateInput.raw_notes ?? existing.raw_notes
              const attendees = updateInput.attendees ?? existing.attendees
              const { summary, action_items } = await summarizeMeetingNotes(updateInput.title, rawNotes, attendees)
              updateInput.summary = summary
              updateInput.action_items = action_items
            }

            const note = await saveMeetingNote(updateInput)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ note }))
          } catch (err) {
            log.error({ err, noteId }, 'Meeting notes: update API error')
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Internal server error' }))
          }
        })()
        return
      }

      // DELETE /api/meeting-notes/:id
      if (req.method === 'DELETE') {
        void (async () => {
          try {
            if (!isAuthorizedDashboardRequest(req)) {
              res.writeHead(403, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Forbidden' }))
              return
            }
            await deleteMeetingNote(noteId)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))
          } catch (err) {
            log.error({ err, noteId }, 'Meeting notes: delete API error')
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Internal server error' }))
          }
        })()
        return
      }
    }

    // ── Leads routes (T133 Lead Generation Engine) ──────────────────────────

    // GET /api/leads — list leads (qs: status, source, minScore, limit)
    if (url.pathname === '/api/leads' && req.method === 'GET') {
      void (async () => {
        try {
          const { getLeads } = await import('./services/leads.js')
          const statusParam = url.searchParams.get('status')
          const sourceParam = url.searchParams.get('source')
          const minScoreParam = url.searchParams.get('minScore')
          const limitParam = url.searchParams.get('limit')
          const filter: Parameters<typeof getLeads>[0] = {}
          if (statusParam) filter.status = statusParam as import('./types/index.js').LeadStatus
          if (sourceParam) filter.source = sourceParam as import('./types/index.js').LeadSource
          if (minScoreParam) filter.minScore = parseInt(minScoreParam, 10)
          if (limitParam) filter.limit = Math.min(parseInt(limitParam, 10), 200)
          const leads = await getLeads(filter)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(leads))
        } catch (err) {
          log.error({ err }, 'Leads: GET /api/leads error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      })()
      return
    }

    // POST /api/leads/harvest — trigger harvest (non-blocking, auth required)
    if (url.pathname === '/api/leads/harvest' && req.method === 'POST') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }
          const payload = await readJsonBody(req)
          if (typeof payload !== 'object' || payload === null) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid body' }))
            return
          }
          const body = payload as Record<string, unknown>
          const query = typeof body['query'] === 'string' ? body['query'] : ''
          const location = typeof body['location'] === 'string' ? body['location'] : 'Italy'
          const limit = typeof body['limit'] === 'number' ? Math.min(body['limit'], 20) : 10

          if (!query) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'query is required' }))
            return
          }

          // Pre-create the harvest run so we can return the runId immediately
          const { startHarvestRun } = await import('./services/leads.js')
          const run = await startHarvestRun('website_audit', query, location)

          // Non-blocking harvest — pass existingRunId to avoid double-creation
          void (async () => {
            try {
              const { harvestLeads } = await import('./services/lead-harvester.js')
              await harvestLeads({ query, location, limit, sector: query, existingRunId: run.id })
            } catch (err) {
              log.error({ err }, 'Leads: background harvest failed')
            }
          })()

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, runId: run.id }))
        } catch (err) {
          log.error({ err }, 'Leads: POST /api/leads/harvest error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      })()
      return
    }

    // GET /api/leads/harvest-runs — harvest run history
    if (url.pathname === '/api/leads/harvest-runs' && req.method === 'GET') {
      void (async () => {
        try {
          const { getHarvestRuns } = await import('./services/leads.js')
          const runs = await getHarvestRuns(10)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(runs))
        } catch (err) {
          log.error({ err }, 'Leads: GET /api/leads/harvest-runs error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      })()
      return
    }

    // Parameterized routes: /api/leads/:id and sub-actions
    if (url.pathname.startsWith('/api/leads/')) {
      const rest = url.pathname.slice('/api/leads/'.length)
      const parts = rest.split('/')
      const leadId = parts[0] ?? ''

      // GET /api/leads/:id
      if (parts.length === 1 && req.method === 'GET') {
        void (async () => {
          try {
            const { getLead } = await import('./services/leads.js')
            const lead = await getLead(leadId)
            if (!lead) {
              res.writeHead(404, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Not found' }))
              return
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(lead))
          } catch (err) {
            log.error({ err, leadId }, 'Leads: GET /api/leads/:id error')
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Internal server error' }))
          }
        })()
        return
      }

      // PUT /api/leads/:id — update draft, notes, contact_email
      if (parts.length === 1 && req.method === 'PUT') {
        void (async () => {
          try {
            if (!isAuthorizedDashboardRequest(req)) {
              res.writeHead(403, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Forbidden' }))
              return
            }
            const payload = await readJsonBody(req)
            if (typeof payload !== 'object' || payload === null) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Invalid body' }))
              return
            }
            const body = payload as Record<string, unknown>
            const { saveLead } = await import('./services/leads.js')
            // Imperative build for exactOptionalPropertyTypes safety
            const input: import('./services/leads.js').SaveLeadInput = { company_name: '' }
            input.id = leadId
            if (typeof body['company_name'] === 'string') input.company_name = body['company_name']
            else input.company_name = leadId // will be overwritten by the existing value
            if ('contact_email' in body) input.contact_email = typeof body['contact_email'] === 'string' ? body['contact_email'] : null
            if ('contact_name' in body) input.contact_name = typeof body['contact_name'] === 'string' ? body['contact_name'] : null
            if ('outreach_subject' in body) input.outreach_subject = typeof body['outreach_subject'] === 'string' ? body['outreach_subject'] : ''
            if ('outreach_draft' in body) input.outreach_draft = typeof body['outreach_draft'] === 'string' ? body['outreach_draft'] : ''
            if ('notes' in body) input.notes = typeof body['notes'] === 'string' ? body['notes'] : ''
            if ('contact_id' in body) input.contact_id = typeof body['contact_id'] === 'string' ? body['contact_id'] : null

            const lead = await saveLead(input)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(lead))
          } catch (err) {
            log.error({ err, leadId }, 'Leads: PUT /api/leads/:id error')
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Internal server error' }))
          }
        })()
        return
      }

      // POST /api/leads/:id/approve
      if (parts.length === 2 && parts[1] === 'approve' && req.method === 'POST') {
        void (async () => {
          try {
            if (!isAuthorizedDashboardRequest(req)) {
              res.writeHead(403, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Forbidden' }))
              return
            }
            const { updateLeadStatus } = await import('./services/leads.js')
            const lead = await updateLeadStatus(leadId, 'approved')
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(lead))
          } catch (err) {
            log.error({ err, leadId }, 'Leads: POST /api/leads/:id/approve error')
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Internal server error' }))
          }
        })()
        return
      }

      // POST /api/leads/:id/reject
      if (parts.length === 2 && parts[1] === 'reject' && req.method === 'POST') {
        void (async () => {
          try {
            if (!isAuthorizedDashboardRequest(req)) {
              res.writeHead(403, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Forbidden' }))
              return
            }
            const { updateLeadStatus } = await import('./services/leads.js')
            const lead = await updateLeadStatus(leadId, 'rejected')
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(lead))
          } catch (err) {
            log.error({ err, leadId }, 'Leads: POST /api/leads/:id/reject error')
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Internal server error' }))
          }
        })()
        return
      }

      // POST /api/leads/:id/send — execute outreach
      if (parts.length === 2 && parts[1] === 'send' && req.method === 'POST') {
        void (async () => {
          try {
            if (!isAuthorizedDashboardRequest(req)) {
              res.writeHead(403, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Forbidden' }))
              return
            }
            const { executeOutreach } = await import('./services/outreach-executor.js')
            const result = await executeOutreach(leadId)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(result))
          } catch (err) {
            log.error({ err, leadId }, 'Leads: POST /api/leads/:id/send error')
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }))
          }
        })()
        return
      }
    }

    // ── GET /api/personal/knowledge — list knowledge items ─────────────────
    if (url.pathname === '/api/personal/knowledge' && req.method === 'GET') {
      void (async () => {
        try {
          const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200)
          const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10))
          const items = await listKnowledgeItems('neb', { limit, offset })
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ items }))
        } catch (err) {
          log.error({ err }, 'Knowledge list API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      })()
      return
    }

    // ── GET /api/personal/knowledge/search — semantic search ───────────────
    if (url.pathname === '/api/personal/knowledge/search' && req.method === 'GET') {
      void (async () => {
        try {
          const query = url.searchParams.get('q') ?? ''
          const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '5', 10), 20)
          if (!query.trim()) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing q param' }))
            return
          }
          const results = await searchKnowledge('neb', query, limit)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ results }))
        } catch (err) {
          log.error({ err }, 'Knowledge search API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      })()
      return
    }

    // ── POST /api/personal/knowledge — ingest note or URL ──────────────────
    if (url.pathname === '/api/personal/knowledge' && req.method === 'POST') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }
          const body = await readJsonBody(req)
          const payload = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
          const sourceType = payload['sourceType'] as string
          const tags = Array.isArray(payload['tags'])
            ? (payload['tags'] as unknown[]).filter((t): t is string => typeof t === 'string')
            : []

          let item
          if (sourceType === 'url') {
            const urlParam = typeof payload['url'] === 'string' ? payload['url'] : null
            if (!urlParam) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Missing url' }))
              return
            }
            item = await ingestKnowledgeUrl('neb', urlParam, tags)
          } else {
            const content = typeof payload['content'] === 'string' ? payload['content'] : null
            if (!content) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Missing content' }))
              return
            }
            const title = typeof payload['title'] === 'string' ? payload['title'] : undefined
            item = await ingestKnowledgeItem({
              ownerSlug: 'neb',
              content,
              ...(title ? { title } : {}),
              sourceType: 'note',
              tags,
            })
          }

          if (!item) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, duplicate: true, item: null }))
            return
          }

          res.writeHead(201, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, item }))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Ingest failed'
          log.error({ err }, 'Knowledge ingest API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })()
      return
    }

    // ── DELETE /api/personal/knowledge/:id ─────────────────────────────────
    const knowledgeDeleteMatch = url.pathname.match(/^\/api\/personal\/knowledge\/([a-f0-9-]{36})$/)
    if (knowledgeDeleteMatch && req.method === 'DELETE') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }
          const id = knowledgeDeleteMatch[1]!
          await deleteKnowledgeItem(id)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Delete failed'
          log.error({ err }, 'Knowledge delete API error')
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

  // --- Sync models from config (must run before agents due to FK) ---
  try {
    for (const model of Object.values(MODELS)) {
      await upsertModelRecord({
        id: model.id,
        display_name: model.display_name,
        provider: model.provider,
        context_window: model.context_window,
        cost_per_1k_input_tokens: model.cost_per_1k_input_tokens,
        cost_per_1k_output_tokens: model.cost_per_1k_output_tokens,
        is_active: model.is_active,
        ...(model.notes ? { notes: model.notes } : {}),
      })
    }
    log.info({ count: Object.keys(MODELS).length }, 'Models synced')
  } catch (err) {
    log.warn({ err }, 'Failed to sync model records (DB may not be ready yet)')
  }

  // --- Sync agents from config (upsert) then mark all online ---
  // This ensures new agents added to config/agents.ts are auto-registered in the DB.
  try {
    for (const agent of Object.values(AGENTS)) {
      await upsertAgentRecord({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        team: agent.team,
        model_id: agent.model_id,
        config: agent.config as unknown as Record<string, unknown>,
      })
    }
    log.info({ count: Object.keys(AGENTS).length }, 'Agents synced and marked online')
  } catch (err) {
    log.warn({ err }, 'Failed to sync agent records (DB may not be ready yet)')
    // Fallback: try plain status update for known agents
    try {
      for (const agentId of getAllAgentIds()) {
        await updateAgentStatus(agentId, 'online')
      }
    } catch {
      // non-fatal — agents will appear offline until next restart
    }
  }

  // --- Restore persisted model assignment overrides ---
  try {
    await restorePersistedModelAssignments()
    log.info('Model assignment overrides restored')
  } catch (err) {
    log.warn({ err }, 'Failed to restore model assignments (non-fatal)')
  }

  // --- Start Telegram bot (with retry for 409 hot-reload conflicts) ---
  void (async () => {
    const MAX_ATTEMPTS = 5
    const RETRY_DELAY_MS = 15_000
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const bot = getTelegramBot()
        await bot.start({
          onStart: () => {
            log.info({ attempt }, 'Telegram bot started')
          },
        })
        return
      } catch (err: unknown) {
        const is409 =
          err instanceof Error && err.message.includes('409')
        if (is409 && attempt < MAX_ATTEMPTS) {
          log.warn({ attempt }, `Telegram 409 conflict — retrying in ${RETRY_DELAY_MS / 1000}s (previous instance still polling)`)
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
        } else {
          log.warn({ err }, 'Telegram bot polling unavailable; backend will continue without Telegram polling')
          return
        }
      }
    }
  })()

  // --- Ping LiteLLM ---
  const litellmOk = await pingLiteLLM()
  if (litellmOk) {
    log.info('LiteLLM reachable ✓')
  } else {
    log.warn('LiteLLM not reachable — model calls will fail until it is up')
  }

  // --- Start Ops / Finance / HR runtimes ---
  startOpsMonitor(sendFounderNotification)
  startFinanceRuntime(sendFounderNotification)
  startHrRuntime(sendFounderNotification)
  startFounderAutomationRuntime()

  // --- Start WhatsApp channel (T101) — non-blocking ---
  void initWhatsAppSession().catch((err: unknown) => {
    log.warn({ err }, 'WhatsApp session init failed at startup (will retry on connect request)')
  })

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
