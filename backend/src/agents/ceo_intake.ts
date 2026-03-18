// ============================================================
// WAI – CEO Natural Language Intake Handler
// Neb scrive testo libero su Telegram; il CEO capisce, verifica,
// esegue in autonomia e risponde con un unico messaggio ricco.
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
// System prompt – injected with live client/project context
// ---------------------------------------------------------------------------

function buildSystemPrompt(clientContext: string): string {
  return `You are the CEO of WAI (Wawen Autonomous Industries), a fully autonomous Zero Human Company.
Neb (the founder) sends you free-text messages on Telegram instead of slash commands.

## YOUR PHILOSOPHY: MAXIMUM AUTONOMY
- When intent is clear → EXECUTE immediately. Never ask "vuoi che proceda?" or "sei sicuro?".
- Only ask ONE focused question when you genuinely CANNOT act without a specific missing piece of info.
- Never ask for confirmation of obvious intent. Never ask non-essential details.
- Use sensible defaults (e.g. project type = "other" if unclear, priority = 2).
- Be concise. Respond in the same language Neb uses (Italian or English).

## ACTIONS YOU CAN EXECUTE
- create_client      → needs: name (you auto-generate slug). Optional: email.
- create_project     → needs: client_slug (existing), project_name, project_type.
- write_brief        → needs: client_slug, project_slug, brief_text (extract from Neb's message).
- create_task        → needs: title, description. Optional: client_slug, project_slug.
- list_clients       → no params.
- list_projects      → optional: client_slug.
- status_report      → no params.

Valid project types: ${PROJECT_TYPES.join(', ')}

## EXISTING WAI STATE (use this to resolve references)
${clientContext}

## DECISION RULES
1. If client/project mentioned → check the existing state above first. Use exact existing slugs.
2. If client mentioned but NOT in the list → ask: "Non trovo il cliente [X]. Esiste con un nome diverso o vuoi che lo crei?"
3. If project mentioned but NOT in the list → list the client's projects and ask which one, or if to create a new one.
4. "campagna marketing", "contenuto social", "piano marketing" → create_task scoped to project if given.
5. "crea cliente X" or "aggiungi cliente X" → create_client immediately.
6. "crea progetto X per Y" → create_project immediately if client Y exists.
7. "status", "come va", "aggiornami" → status_report.
8. "lista clienti" / "lista progetti" → list_clients or list_projects.
9. If user confirms creation after a clarification ("sì, crealo" / "yes, create it") → create_client or create_project.
10. For task creation: include project scope whenever a project is mentioned or clearly implied.

## RESPONSE FORMAT — ONLY valid JSON, no markdown, no text outside JSON
{
  "action": "ask" | "execute" | "reply" | "unclear",
  "message": "<message to send Neb — for execute this is the post-execution summary>",
  "command": {
    "type": "<action name>",
    "params": { <parameters> }
  }
}

Rules:
- "command" is required when action is "execute" or "reply".
- For "execute": "message" = brief what you just did (shown AFTER execution succeeds).
- For "ask": no command. "message" = exactly ONE focused question.
- For "reply": "message" = intro to the data. Command fetches the data.
- For "unclear": no command. Politely ask to rephrase.`
}

// ---------------------------------------------------------------------------
// LLM response type and parser
// ---------------------------------------------------------------------------

interface IntentResponse {
  action: 'ask' | 'execute' | 'reply' | 'unclear'
  message: string
  command?: {
    type: string
    params: Record<string, unknown>
  }
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

  return parsed as unknown as IntentResponse
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
// Execution result type
// ---------------------------------------------------------------------------

interface ExecResult {
  result: string
  clarificationNeeded?: string // set → execution skipped, ask this instead
}

// ---------------------------------------------------------------------------
// Execute action
// ---------------------------------------------------------------------------

async function executeAction(
  command: { type: string; params: Record<string, unknown> },
  notify: (msg: string) => Promise<void>
): Promise<ExecResult> {
  const { type, params } = command

  switch (type) {

    // ── list_clients ───────────────────────────────────────────────────────
    case 'list_clients': {
      const clients = await getClients()
      if (clients.length === 0) {
        return { result: 'Nessun cliente ancora. Scrivimi "crea cliente [nome]" per aggiungerne uno.' }
      }
      const icon = (s: string) => s === 'active' ? '🟢' : s === 'completed' ? '✅' : s === 'archived' ? '⬜' : '🟡'
      const lines = clients.map((c) => `${icon(c.status)} *${c.name}* — \`${c.slug}\``)
      return { result: `*Clienti WAI (${clients.length}):*\n\n${lines.join('\n')}` }
    }

    // ── list_projects ──────────────────────────────────────────────────────
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
        const ctx = clientSlug ? ` per \`${clientSlug}\`` : ''
        return { result: `Nessun progetto trovato${ctx}.` }
      }

      const icon = (s: string) =>
        s === 'active' ? '🟢' : s === 'delivered' ? '✅' : s === 'invoiced' ? '💰' :
        s === 'blocked' ? '⛔' : s === 'review' ? '🔍' : '🔵'

      const lines = projects.map((p) => `${icon(p.status)} *${p.name}* (\`${p.slug}\`) — ${p.type} — ${p.status}`)
      const title = clientSlug ? `Progetti di \`${clientSlug}\`` : 'Tutti i progetti WAI'
      return { result: `*${title} (${projects.length}):*\n\n${lines.join('\n')}` }
    }

    // ── status_report ──────────────────────────────────────────────────────
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

      return {
        result: [
          `*WAI — Status Report*`,
          ``,
          `🎯 Milestone: ${state?.current_milestone ?? 'none'}`,
          `🤖 Agents online: ${onlineCount}/${agents.length}`,
          `⚡ Tasks in progress: ${inProgress.length}`,
          `📋 Tasks in coda: ${todo.length}`,
          `💸 Budget mensile: [${bar}] ${pct}% ($${cost.toFixed(2)} / $${budget})`,
        ].join('\n'),
      }
    }

    // ── create_client ──────────────────────────────────────────────────────
    case 'create_client': {
      const name = getString(params, 'name')
      if (!name) return { result: '', clarificationNeeded: '❓ Come si chiama il cliente che vuoi creare?' }

      const email = getString(params, 'email')
      const slug = slugify(name)

      const existing = await getClientBySlug(slug)
      if (existing) {
        return {
          result: `⚠️ Il cliente *${existing.name}* esiste già (slug: \`${slug}\`).\nPuoi usarlo direttamente.`,
        }
      }

      const client = await createClient({ name, slug, email })
      const workspacePath = await createClientWorkspace(slug)

      await recordEvent('founder_command', {
        payload: { command: 'nl_create_client', client_id: client.id, slug, source: 'natural_language' },
      })

      return {
        result:
          `✅ *Cliente creato!*\n\n` +
          `Nome: *${client.name}*\n` +
          `Slug: \`${slug}\`\n` +
          `Workspace: \`${workspacePath}\`\n\n` +
          `Prossimo step: dimmi quale progetto aprire per ${client.name}.`,
      }
    }

    // ── create_project ─────────────────────────────────────────────────────
    case 'create_project': {
      const clientSlug = getString(params, 'client_slug')
      const projectName = getString(params, 'project_name')
      const projectTypeRaw = getString(params, 'project_type')

      if (!clientSlug) return { result: '', clarificationNeeded: '❓ Per quale cliente vuoi creare il progetto?' }
      if (!projectName) return { result: '', clarificationNeeded: `❓ Come si chiama il progetto per \`${clientSlug}\`?` }

      const client = await getClientBySlug(clientSlug)
      if (!client) {
        const all = await getClients()
        const suggestions = all.map((c) => `\`${c.slug}\``).join(', ') || 'nessuno'
        return {
          result: '',
          clarificationNeeded:
            `❓ Non trovo il cliente \`${clientSlug}\`.\n` +
            `Clienti presenti: ${suggestions}.\n` +
            `Vuoi usarne uno esistente o creare \`${clientSlug}\`?`,
        }
      }

      const type: ProjectType = PROJECT_TYPES.includes(projectTypeRaw as ProjectType)
        ? (projectTypeRaw as ProjectType)
        : 'other'

      const projectSlug = slugify(projectName)
      const relPath = getRelativeProjectPath(clientSlug, projectSlug)

      const project = await createProject({
        client_id: client.id,
        name: projectName,
        slug: projectSlug,
        type,
        workspace_path: relPath,
      })

      const absPath = await createProjectWorkspace(clientSlug, projectSlug, projectName, type, client.name)
      await updateProjectWorkspacePath(project.id, relPath)

      await recordEvent('founder_command', {
        payload: { command: 'nl_create_project', project_id: project.id, client_slug: clientSlug, source: 'natural_language' },
      })

      return {
        result:
          `✅ *Progetto creato!*\n\n` +
          `Progetto: *${project.name}*\n` +
          `Cliente: ${client.name}\n` +
          `Tipo: ${type}\n` +
          `Workspace: \`${absPath}\`\n\n` +
          `Prossimo step: dimmi il brief del progetto e lo scrivo io, oppure usa:\n` +
          `\`/brief ${clientSlug}/${projectSlug} <descrizione>\`\n` +
          `\`/task ${clientSlug}/${projectSlug} <cosa fare>\``,
      }
    }

    // ── write_brief ────────────────────────────────────────────────────────
    case 'write_brief': {
      const clientSlug = getString(params, 'client_slug')
      const projectSlug = getString(params, 'project_slug')
      const briefText = getString(params, 'brief_text')

      if (!clientSlug) return { result: '', clarificationNeeded: '❓ Per quale cliente vuoi scrivere il brief?' }
      if (!projectSlug) return { result: '', clarificationNeeded: `❓ Per quale progetto di \`${clientSlug}\`?` }
      if (!briefText) return { result: '', clarificationNeeded: '❓ Cosa vuoi scrivere nel brief? Descrivimi il progetto.' }

      const client = await getClientBySlug(clientSlug)
      if (!client) {
        return { result: '', clarificationNeeded: `❓ Non trovo il cliente \`${clientSlug}\`.` }
      }

      const project = await getProjectBySlug(client.id, projectSlug)
      if (!project) {
        const projects = await getProjectsByClient(clientSlug)
        const slugs = projects.map((p) => `\`${p.slug}\``).join(', ') || 'nessuno'
        return {
          result: '',
          clarificationNeeded: `❓ Non trovo il progetto \`${projectSlug}\` per ${client.name}.\nProgetti esistenti: ${slugs}.`,
        }
      }

      const workspacePath = getProjectWorkspacePath(clientSlug, projectSlug)
      const briefPath = join(workspacePath, 'brief.md')
      const now = new Date().toISOString()
      const content = `# ${project.name} – Brief\n\n> Aggiornato: ${now}\n\n${briefText}\n`
      await writeFile(briefPath, content, 'utf-8')

      await recordEvent('founder_command', {
        payload: { command: 'nl_write_brief', project_id: project.id, source: 'natural_language' },
      })

      return {
        result:
          `✅ *Brief aggiornato!*\n\n` +
          `Progetto: *${project.name}*\n` +
          `Cliente: ${client.name}\n` +
          `Path: \`${briefPath}\`\n\n` +
          `Ora puoi lanciare il task:\n` +
          `\`/task ${clientSlug}/${projectSlug} <cosa fare>\`\n` +
          `Oppure scrivimi tu cosa deve fare il team e lo lancio io.`,
      }
    }

    // ── create_task ────────────────────────────────────────────────────────
    case 'create_task': {
      const title = getString(params, 'title')
      const description = getString(params, 'description') ?? title ?? ''
      const clientSlug = getString(params, 'client_slug')
      const projectSlug = getString(params, 'project_slug')

      if (!title) return { result: '', clarificationNeeded: '❓ Cosa vuoi che faccia il team? Descrivimi il task.' }

      let projectId: string | undefined
      let taskMetadata: Record<string, unknown> = {}
      let scopeLabel = ''
      let clientObj: Client | null = null

      // Validate client/project if provided
      if (clientSlug) {
        clientObj = await getClientBySlug(clientSlug)

        if (!clientObj) {
          const all = await getClients()
          const suggestions = all.map((c) => `\`${c.slug}\``).join(', ') || 'nessuno'
          return {
            result: '',
            clarificationNeeded:
              `❓ Non trovo il cliente \`${clientSlug}\` in WAI.\n` +
              `Clienti presenti: ${suggestions}.\n` +
              `Vuoi usarne uno esistente o creare \`${clientSlug}\`?`,
          }
        }

        if (projectSlug) {
          const project = await getProjectBySlug(clientObj.id, projectSlug)

          if (!project) {
            const projects = await getProjectsByClient(clientSlug)
            const slugs = projects.map((p) => `\`${p.slug}\``).join(', ') || 'nessuno'
            return {
              result: '',
              clarificationNeeded:
                `❓ Non trovo il progetto \`${projectSlug}\` per *${clientObj.name}*.\n` +
                `Progetti esistenti: ${slugs}.\n` +
                `Vuoi usarne uno esistente o creare \`${projectSlug}\`?`,
            }
          }

          projectId = project.id
          scopeLabel = `\nScope: *${clientObj.name}* / *${project.name}*`
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
          // Client known, no project — use client context only
          scopeLabel = `\nScope: *${clientObj.name}*`
          taskMetadata = {
            client_name: clientObj.name,
            client_slug: clientSlug,
          }
        }
      }

      const task = await createTask({
        title,
        description,
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

      // Fire CEO agent async
      void runCeoAgent(task, notify).catch((err: unknown) => {
        log.error({ err, taskId: task.id }, 'CEO Intake: runCeoAgent failed')
      })

      return {
        result:
          `🚀 *Task lanciato!*${scopeLabel}\n\n` +
          `ID: \`${task.id}\`\n` +
          `Titolo: ${title}\n\n` +
          `Il CEO sta analizzando e delegando alla catena giusta. Ti avviso appena pronto.`,
      }
    }

    default:
      return { result: `⚠️ Azione non riconosciuta: ${type}` }
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

  // Load client/project context for LLM
  const clientContext = await buildClientContext()

  // Get or create conversation context
  const existing = getConversation(chatId)
  const messages: IntakeContext['messages'] = existing?.messages ?? []

  // Add the new user message
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

    log.debug({ raw: result.content.substring(0, 400) }, 'CEO Intake: LLM raw response')
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

  // Handle each action type
  switch (intent.action) {

    case 'ask': {
      // LLM needs clarification — save context and ask
      messages.push({ role: 'assistant', content: intent.message })
      saveConversation(chatId, { messages, lastMessageAt: Date.now() })
      await reply(intent.message)
      break
    }

    case 'execute': {
      if (!intent.command) {
        // Shouldn't happen, but graceful fallback
        await reply(intent.message)
        clearConversation(chatId)
        break
      }

      // Execute — validation happens inside executeAction
      const execResult: ExecResult = await executeAction(intent.command, notify).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        log.error({ err, command: intent!.command?.type }, 'CEO Intake: action execution error')
        return { result: `❌ Errore durante l'esecuzione: ${msg}` } satisfies ExecResult
      })

      if (execResult.clarificationNeeded) {
        // Validation failed → ask for clarification, keep conversation alive
        messages.push({ role: 'assistant', content: execResult.clarificationNeeded })
        saveConversation(chatId, { messages, lastMessageAt: Date.now() })
        await reply(execResult.clarificationNeeded)
      } else {
        // Success → single rich post-execution message
        messages.push({ role: 'assistant', content: execResult.result })
        clearConversation(chatId) // done — fresh slate next time
        await reply(execResult.result)
      }
      break
    }

    case 'reply': {
      // Data query (list_*, status_report)
      if (intent.command) {
        const execResult = await executeAction(intent.command, notify).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          return { result: `❌ Errore: ${msg}` }
        })
        await reply(execResult.result || intent.message)
      } else {
        await reply(intent.message)
      }
      clearConversation(chatId)
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
