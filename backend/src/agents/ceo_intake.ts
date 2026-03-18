// ============================================================
// WAI – CEO Natural Language Intake Handler
// Neb scrive testo libero su Telegram; il CEO capisce, pianifica
// una sequenza di azioni, le esegue tutte in autonomia, e risponde
// con un unico messaggio riassuntivo.
// ============================================================

import { writeFile } from 'fs/promises'
import { join } from 'path'
import { runAgent } from '../services/llm.js'
import {
  createClient,
  createProject,
  createTask,
  getAgents,
  getClientBySlug,
  getClients,
  getMonthlyCost,
  getProjectBySlug,
  getProjectsByClient,
  getProjectState,
  getTasksByStatus,
  updateProjectWorkspacePath,
} from '../services/supabase.js'
import {
  createClientWorkspace,
  createProjectWorkspace,
  getRelativeProjectPath,
  getProjectWorkspacePath,
} from '../services/workspace.js'
import { log, recordEvent } from '../services/logger.js'
import { loadAllWorkspaceContext } from './software_delivery_utils.js'
import { runCeoAgent } from './ceo.js'
import type { Client, ProjectType } from '../types/index.js'

// ---------------------------------------------------------------------------
// Conversation state (in-memory, per chatId, TTL 10 min)
// ---------------------------------------------------------------------------

interface IntakeContext {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  lastMessageAt: number
}

const CONTEXT_TTL_MS = 10 * 60 * 1000
const _conversations = new Map<string, IntakeContext>()

function getConversation(chatId: string): IntakeContext | null {
  const ctx = _conversations.get(chatId)
  if (!ctx) return null
  if (Date.now() - ctx.lastMessageAt > CONTEXT_TTL_MS) {
    _conversations.delete(chatId)
    return null
  }
  return ctx
}

function saveConversation(chatId: string, ctx: IntakeContext): void {
  _conversations.set(chatId, { ...ctx, lastMessageAt: Date.now() })
}

function clearConversation(chatId: string): void {
  _conversations.delete(chatId)
}

// ---------------------------------------------------------------------------
// Project types
// ---------------------------------------------------------------------------

const PROJECT_TYPES: ProjectType[] = [
  'website', 'app', 'saas', 'consulting', 'ai',
  'marketing', 'content', 'copywriting', 'design', 'automation', 'other',
]

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(clientContext: string): string {
  return `You are the CEO of WAI (Wawen Autonomous Industries), a fully autonomous Zero Human Company.
Neb (the founder) sends you free-text messages on Telegram. Your job: understand the full intent and plan ALL the steps needed to complete it.

## YOUR PHILOSOPHY: MAXIMUM AUTONOMY
- Parse the ENTIRE request at once. Plan ALL steps in one shot.
- Never ask "vuoi che proceda?" or "sei sicuro?". Never ask for confirmation.
- Only ask ONE focused question if you genuinely cannot act without missing critical info.
- Use sensible defaults: project_type = "website" for landing pages/sites, priority = 2, etc.
- Slugs are generated as: lowercase, spaces/special chars → "-", trim dashes. Example: "CasaFacile" → "casafacile", "Wawen22" → "wawen22".
- Be concise. Respond in the same language Neb uses (Italian or English).

## ACTIONS YOU CAN EXECUTE (in sequence)
- create_client      → params: name, email? (auto-generates slug from name)
- create_project     → params: client_slug, project_name, project_type, contract_value_usd?
- write_brief        → params: client_slug, project_slug, brief_text
- create_task        → params: title, description, client_slug?, project_slug?
- list_clients       → no params
- list_projects      → params: client_slug?
- status_report      → no params

Valid project types: ${PROJECT_TYPES.join(', ')}

## EXISTING WAI STATE
${clientContext}

## PLANNING RULES
1. If Neb's message implies multiple steps (create client + project + task), include ALL steps in commands[].
2. When you create a client, you know its slug (slugify the name). Use that slug in subsequent commands.
3. When you create a project, you know its slug (slugify the project name). Use that slug in subsequent commands.
4. If client/project already exists (check existing state above), skip the create step and use existing slugs.
5. Only include write_brief if Neb explicitly provides project description/goal text.
6. A task description should be detailed enough for the CEO routing agent to understand the deliverable.
7. Only ask (action: "ask") when you genuinely cannot determine a required field from context.
8. **CRITICAL — ONE TASK PER PROJECT**: When creating work for a project, create EXACTLY ONE create_task command that covers the FULL deliverable. NEVER create 2 or 3 separate tasks for the same project in the same plan — this causes multiple Architect agents to run in parallel and collide on the same repository. One comprehensive task (e.g., "Crea landing page completa per [Client]") is always better than several partial tasks. If Neb asks to "launch tasks" or "start work" on a project, create ONE task that covers everything.

## RESPONSE FORMAT — ONLY valid JSON, no markdown, no text outside JSON
{
  "action": "execute" | "ask" | "reply" | "unclear",
  "message": "<shown to Neb — for execute: what you planned to do, shown BEFORE execution>",
  "commands": [
    { "type": "<action>", "params": { <parameters> } }
  ]
}

Rules:
- "commands" array is required when action is "execute" or "reply". Can have 1 or more items.
- Commands execute IN ORDER — use predicted slugs from earlier steps in later steps.
- For "ask": no commands array. "message" = exactly ONE focused question.
- For "unclear": no commands. Politely ask to rephrase.
- For "reply" (list/status queries): single command in array.`
}

// ---------------------------------------------------------------------------
// LLM response type and parser
// ---------------------------------------------------------------------------

interface CommandItem {
  type: string
  params: Record<string, unknown>
}

interface IntentResponse {
  action: 'ask' | 'execute' | 'reply' | 'unclear'
  message: string
  commands?: CommandItem[]
}

function parseIntentResponse(raw: string): IntentResponse | null {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>
  } catch {
    return null
  }

  const { action, message } = parsed
  if (
    (action !== 'ask' && action !== 'execute' && action !== 'reply' && action !== 'unclear') ||
    typeof message !== 'string'
  ) {
    return null
  }

  // Parse commands array
  const commands: CommandItem[] = []
  if (Array.isArray(parsed['commands'])) {
    for (const item of parsed['commands']) {
      if (
        typeof item === 'object' && item !== null &&
        typeof (item as Record<string, unknown>)['type'] === 'string'
      ) {
        const cmd = item as Record<string, unknown>
        commands.push({
          type: cmd['type'] as string,
          params: (typeof cmd['params'] === 'object' && cmd['params'] !== null
            ? cmd['params']
            : {}) as Record<string, unknown>,
        })
      }
    }
  }

  return { action: action as IntentResponse['action'], message, commands }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function getString(params: Record<string, unknown>, key: string): string | undefined {
  const v = params[key]
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}

// ---------------------------------------------------------------------------
// Execute a single action — returns a summary line or throws
// ---------------------------------------------------------------------------

async function executeAction(
  command: CommandItem,
  notify: (msg: string) => Promise<void>
): Promise<string> {
  const { type, params } = command

  switch (type) {

    // ── list_clients ─────────────────────────────────────────────────────
    case 'list_clients': {
      const clients = await getClients()
      if (clients.length === 0) {
        return 'Nessun cliente ancora. Scrivimi "crea cliente [nome]" per aggiungerne uno.'
      }
      const icon = (s: string) => s === 'active' ? '🟢' : s === 'completed' ? '✅' : s === 'archived' ? '⬜' : '🟡'
      const lines = clients.map((c) => `${icon(c.status)} *${c.name}* — \`${c.slug}\``)
      return `*Clienti WAI (${clients.length}):*\n\n${lines.join('\n')}`
    }

    // ── list_projects ─────────────────────────────────────────────────────
    case 'list_projects': {
      const clientSlug = getString(params, 'client_slug')
      let projects: Awaited<ReturnType<typeof getProjectsByClient>>
      if (clientSlug) {
        projects = await getProjectsByClient(clientSlug)
      } else {
        const { getProjects } = await import('../services/supabase.js')
        projects = await getProjects()
      }
      if (projects.length === 0) {
        return `Nessun progetto trovato${clientSlug ? ` per \`${clientSlug}\`` : ''}.`
      }
      const icon = (s: string) =>
        s === 'active' ? '🟢' : s === 'delivered' ? '✅' : s === 'invoiced' ? '💰' :
        s === 'blocked' ? '⛔' : s === 'review' ? '🔍' : '🔵'
      const lines = projects.map((p) => `${icon(p.status)} *${p.name}* (\`${p.slug}\`) — ${p.type} — ${p.status}`)
      const title = clientSlug ? `Progetti di \`${clientSlug}\`` : 'Tutti i progetti WAI'
      return `*${title} (${projects.length}):*\n\n${lines.join('\n')}`
    }

    // ── status_report ─────────────────────────────────────────────────────
    case 'status_report': {
      const [agents, state, inProgress, todo] = await Promise.all([
        getAgents(),
        getProjectState(),
        getTasksByStatus('in_progress'),
        getTasksByStatus('todo'),
      ])
      const cost = await getMonthlyCost()
      const onlineCount = (agents as Array<{ status: string }>).filter((a) => a.status === 'online').length
      const budget = state?.monthly_budget_usd ?? 500
      const pct = Math.round((cost / budget) * 100)
      const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10))
      return [
        `*WAI — Status Report*`,
        ``,
        `🎯 Milestone: ${state?.current_milestone ?? 'none'}`,
        `🤖 Agents online: ${onlineCount}/${agents.length}`,
        `⚡ Tasks in progress: ${inProgress.length}`,
        `📋 Tasks in coda: ${todo.length}`,
        `💸 Budget mensile: [${bar}] ${pct}% ($${cost.toFixed(2)} / $${budget})`,
      ].join('\n')
    }

    // ── create_client ─────────────────────────────────────────────────────
    case 'create_client': {
      const name = getString(params, 'name')
      if (!name) throw new Error('Nome cliente mancante')

      const email = getString(params, 'email')
      const slug = slugify(name)

      const existing = await getClientBySlug(slug)
      if (existing) {
        return `⚠️ Cliente *${existing.name}* già esistente (\`${slug}\`) — uso quello esistente`
      }

      const client = await createClient({ name, slug, email })
      const workspacePath = await createClientWorkspace(slug)

      await recordEvent('founder_command', {
        payload: { command: 'nl_create_client', client_id: client.id, slug, source: 'natural_language' },
      })

      return `✅ Cliente *${client.name}* creato — slug: \`${slug}\` — workspace: \`${workspacePath}\``
    }

    // ── create_project ────────────────────────────────────────────────────
    case 'create_project': {
      const clientSlug = getString(params, 'client_slug')
      const projectName = getString(params, 'project_name')
      const projectTypeRaw = getString(params, 'project_type')
      const contractValue = typeof params['contract_value_usd'] === 'number'
        ? params['contract_value_usd']
        : undefined

      if (!clientSlug) throw new Error('client_slug mancante per create_project')
      if (!projectName) throw new Error('project_name mancante per create_project')

      const client = await getClientBySlug(clientSlug)
      if (!client) throw new Error(`Cliente \`${clientSlug}\` non trovato`)

      const type: ProjectType = PROJECT_TYPES.includes(projectTypeRaw as ProjectType)
        ? (projectTypeRaw as ProjectType)
        : 'other'

      const projectSlug = slugify(projectName)
      const relPath = getRelativeProjectPath(clientSlug, projectSlug)

      // Check if already exists
      const existing = await getProjectBySlug(client.id, projectSlug)
      if (existing) {
        return `⚠️ Progetto *${existing.name}* già esistente (\`${projectSlug}\`) — uso quello esistente`
      }

      const project = await createProject({
        client_id: client.id,
        name: projectName,
        slug: projectSlug,
        type,
        workspace_path: relPath,
        ...(contractValue !== undefined ? { contract_value_usd: contractValue } : {}),
      })

      await createProjectWorkspace(clientSlug, projectSlug, projectName, type, client.name)
      await updateProjectWorkspacePath(project.id, relPath)

      await recordEvent('founder_command', {
        payload: { command: 'nl_create_project', project_id: project.id, client_slug: clientSlug, source: 'natural_language' },
      })

      return `✅ Progetto *${project.name}* creato — tipo: ${type}${contractValue !== undefined ? ` — budget: $${contractValue}` : ''} — workspace pronto`
    }

    // ── write_brief ───────────────────────────────────────────────────────
    case 'write_brief': {
      const clientSlug = getString(params, 'client_slug')
      const projectSlug = getString(params, 'project_slug')
      const briefText = getString(params, 'brief_text')

      if (!clientSlug) throw new Error('client_slug mancante per write_brief')
      if (!projectSlug) throw new Error('project_slug mancante per write_brief')
      if (!briefText) throw new Error('brief_text mancante per write_brief')

      const client = await getClientBySlug(clientSlug)
      if (!client) throw new Error(`Cliente \`${clientSlug}\` non trovato`)

      const project = await getProjectBySlug(client.id, projectSlug)
      if (!project) throw new Error(`Progetto \`${projectSlug}\` non trovato per ${client.name}`)

      const workspacePath = getProjectWorkspacePath(clientSlug, projectSlug)
      const briefPath = join(workspacePath, 'brief.md')
      const now = new Date().toISOString()
      const content = `# ${project.name} – Brief\n\n> Aggiornato: ${now}\n\n${briefText}\n`
      await writeFile(briefPath, content, 'utf-8')

      await recordEvent('founder_command', {
        payload: { command: 'nl_write_brief', project_id: project.id, source: 'natural_language' },
      })

      return `✅ Brief scritto per *${project.name}*`
    }

    // ── create_task ───────────────────────────────────────────────────────
    case 'create_task': {
      const title = getString(params, 'title')
      const description = getString(params, 'description') ?? title ?? ''
      const clientSlug = getString(params, 'client_slug')
      const projectSlug = getString(params, 'project_slug')

      if (!title) throw new Error('title mancante per create_task')

      let projectId: string | undefined
      let taskMetadata: Record<string, unknown> = {}
      let scopeLabel = ''
      let clientObj: Client | null = null

      if (clientSlug) {
        clientObj = await getClientBySlug(clientSlug)
        if (!clientObj) throw new Error(`Cliente \`${clientSlug}\` non trovato`)

        if (projectSlug) {
          const project = await getProjectBySlug(clientObj.id, projectSlug)
          if (!project) throw new Error(`Progetto \`${projectSlug}\` non trovato per ${clientObj.name}`)

          projectId = project.id
          scopeLabel = ` | *${clientObj.name}* / *${project.name}*`
          taskMetadata = {
            project_id: project.id,
            project_name: project.name,
            project_type: project.type,
            client_name: clientObj.name,
            client_slug: clientSlug,
            project_slug: projectSlug,
            workspace_path: project.workspace_path,
            ...(project.repo_local_path ? { repo_local_path: project.repo_local_path } : {}),
            ...(project.repo_url ? { repo_url: project.repo_url } : {}),
            ...(project.repo_default_branch ? { repo_default_branch: project.repo_default_branch } : {}),
            ...(project.repo_provider ? { repo_provider: project.repo_provider } : {}),
          }
        } else {
          scopeLabel = ` | *${clientObj.name}*`
          taskMetadata = {
            client_name: clientObj.name,
            client_slug: clientSlug,
          }
        }
      }

      // Enrich description with workspace context
      let enrichedDescription = description
      if (projectId && clientSlug && projectSlug) {
        try {
          const wsAbsPath = getProjectWorkspacePath(clientSlug, projectSlug)
          const ctx = await loadAllWorkspaceContext(wsAbsPath)
          if (ctx) {
            enrichedDescription = `${description}\n\n[WORKSPACE CONTEXT — existing deliverables and brief]\n${ctx}`
          }
        } catch {
          // best-effort
        }
      }

      const task = await createTask({
        title,
        description: enrichedDescription,
        type: 'routing',
        priority: 2,
        assignee_agent_id: 'ceo',
        requires_human_review: false,
        ...(projectId ? { project_id: projectId } : {}),
        metadata: taskMetadata,
      })

      await recordEvent('founder_command', {
        payload: { command: 'nl_create_task', task_id: task.id, source: 'natural_language' },
      })

      // Fire CEO agent async (fire-and-forget)
      void runCeoAgent(task, notify).catch((err: unknown) => {
        log.error({ err, taskId: task.id }, 'CEO Intake: runCeoAgent failed')
      })

      return `🚀 Task \`${task.id.slice(0, 8)}\` lanciato${scopeLabel}: *${title}* — il CEO sta delegando alla catena`
    }

    default:
      return `⚠️ Azione non riconosciuta: ${type}`
  }
}

// ---------------------------------------------------------------------------
// Build client context string (injected into system prompt)
// ---------------------------------------------------------------------------

async function buildClientContext(): Promise<string> {
  try {
    const clients = await getClients()
    if (clients.length === 0) return 'No clients yet in WAI.'

    const lines: string[] = ['Clients in WAI:']
    for (const c of clients) {
      try {
        const projects = await getProjectsByClient(c.slug)
        const projectList = projects.length === 0
          ? 'no projects'
          : projects.map((p) => `${p.slug} (${p.type}, ${p.status})`).join(', ')
        lines.push(`- ${c.name} | slug: ${c.slug} | ${c.status} | projects: ${projectList}`)
      } catch {
        lines.push(`- ${c.name} | slug: ${c.slug} | ${c.status}`)
      }
    }
    return lines.join('\n')
  } catch {
    return 'Could not load client list.'
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runCeoNaturalLanguageHandler(
  chatId: string,
  text: string,
  reply: (msg: string) => Promise<void>,
  notify: (msg: string) => Promise<void>
): Promise<void> {
  log.info({ chatId, text: text.substring(0, 120) }, 'CEO Intake: free-text received')

  const clientContext = await buildClientContext()

  const existing = getConversation(chatId)
  const messages: IntakeContext['messages'] = existing?.messages ?? []
  messages.push({ role: 'user', content: text })

  // Call LLM
  let intent: IntentResponse | null = null
  try {
    const chatMessages = [
      { role: 'system' as const, content: buildSystemPrompt(clientContext) },
      ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ]

    const result = await runAgent(chatMessages, {
      agentId: 'ceo',
      taskType: 'routing',
      requiresComplex: true,
    })

    log.debug({ raw: result.content.substring(0, 500) }, 'CEO Intake: LLM raw response')
    intent = parseIntentResponse(result.content)
  } catch (err) {
    log.error({ err }, 'CEO Intake: LLM call failed')
    await reply('❌ Errore interno. Riprova tra un momento.')
    clearConversation(chatId)
    return
  }

  if (!intent) {
    log.warn('CEO Intake: could not parse LLM response')
    await reply('🤔 Non ho capito bene. Puoi riformulare?')
    clearConversation(chatId)
    return
  }

  switch (intent.action) {

    case 'ask': {
      messages.push({ role: 'assistant', content: intent.message })
      saveConversation(chatId, { messages, lastMessageAt: Date.now() })
      await reply(intent.message)
      break
    }

    case 'execute':
    case 'reply': {
      const commands = intent.commands ?? []

      if (commands.length === 0) {
        // Shouldn't happen, but graceful fallback
        await reply(intent.message)
        clearConversation(chatId)
        break
      }

      // Execute all commands in sequence, collect summaries
      const summaries: string[] = []
      let failed = false

      for (const command of commands) {
        try {
          const summary = await executeAction(command, notify)
          summaries.push(summary)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.error({ err, command: command.type }, 'CEO Intake: action execution error')
          summaries.push(`❌ Errore in \`${command.type}\`: ${msg}`)
          failed = true
          break // stop sequence on error
        }
      }

      // Single reply with all results
      const body = summaries.join('\n')
      const finalMessage = failed
        ? `⚠️ *Piano parzialmente eseguito:*\n\n${body}`
        : summaries.length === 1
          ? body
          : `*Piano eseguito — ${summaries.length} step:*\n\n${body}`

      messages.push({ role: 'assistant', content: finalMessage })
      clearConversation(chatId)
      await reply(finalMessage)
      break
    }

    case 'unclear':
    default: {
      await reply(intent.message)
      clearConversation(chatId)
      break
    }
  }
}
