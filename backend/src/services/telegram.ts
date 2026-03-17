// ============================================================
// WAI – Telegram Bot Handler
// Processes commands from Neb and sends notifications.
// ============================================================

import { Bot, Context } from 'grammy'
import { log, recordEvent } from './logger.js'
import {
  createClient,
  createProject,
  createTask,
  getAgents,
  getClientBySlug,
  getClients,
  getMonthlyCost,
  getProjectBySlug,
  getProjectState,
  getProjectsByClient,
  getRecentEvents,
  getTaskById,
  getTasksByStatus,
  updateAgentModel,
  updateProjectWorkspacePath,
  updateTaskStatus,
} from './supabase.js'
import {
  createClientWorkspace,
  createProjectWorkspace,
  getRelativeProjectPath,
} from './workspace.js'
import { setModelOverride } from '../config/models.js'
import { runCeoAgent } from '../agents/ceo.js'
import type { CreateTaskInput, ProjectType } from '../types/index.js'

// ---------------------------------------------------------------------------
// Bot singleton
// ---------------------------------------------------------------------------

let _bot: Bot | null = null

export function getTelegramBot(): Bot {
  const token = process.env['TELEGRAM_BOT_TOKEN']
  if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN')

  if (!_bot) {
    _bot = new Bot(token)
    registerHandlers(_bot)
    _bot.catch((err) => {
      log.error({ err: err.message, update: err.ctx?.update?.update_id }, 'Telegram bot error')
    })
  }
  return _bot
}

// ---------------------------------------------------------------------------
// Founder authentication
// ---------------------------------------------------------------------------

function isFounder(ctx: Context): boolean {
  const founderId = process.env['TELEGRAM_FOUNDER_CHAT_ID']
  if (!founderId) return false
  return ctx.from?.id.toString() === founderId
}

function requireFounder(ctx: Context): boolean {
  if (!isFounder(ctx)) {
    log.warn({ userId: ctx.from?.id }, 'Unauthorized Telegram access attempt')
    return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

function registerHandlers(bot: Bot): void {
  // /start
  bot.command('start', async (ctx) => {
    if (!requireFounder(ctx)) return
    await ctx.reply(
      '🤖 *WAI – Wawen Autonomous Industries*\n\n' +
        '*Tasks:*\n' +
        '/task descrizione – Crea un task\n' +
        '/task client/project descrizione – Task con scope progetto\n' +
        '/approve task\\_id – Approva output\n' +
        '/reject task\\_id motivo – Rifiuta output\n\n' +
        '*Clients & Projects:*\n' +
        '/new\\_client nome \\[email\\] – Crea cliente\n' +
        '/new\\_project slug\\_cliente nome \\[tipo\\] – Crea progetto\n' +
        '/clients – Lista clienti\n' +
        '/projects \\[client\\_slug\\] – Lista progetti\n\n' +
        '*System:*\n' +
        '/status – Stato del sistema\n' +
        '/logs – Eventi recenti\n' +
        '/budget – Costi API\n' +
        '/assign\\_model agent\\_id model\\_id – Cambia modello',
      { parse_mode: 'Markdown' }
    )
    await recordEvent('founder_command', { payload: { command: 'start' } })
  })

  // /task [client_slug/project_slug] description
  // Examples:
  //   /task Build a new auth module
  //   /task acme-corp/website Crea una proposta per il sito
  bot.command('task', async (ctx) => {
    if (!requireFounder(ctx)) return

    const text = ctx.message?.text ?? ''
    const args = text.replace('/task', '').trim()

    if (!args) {
      await ctx.reply(
        'Usage:\n' +
          '/task description\n' +
          '/task client\\_slug/project\\_slug description\n\n' +
          'Examples:\n' +
          '/task Build auth module\n' +
          '/task acme\\-corp/website Crea proposta commerciale',
        { parse_mode: 'Markdown' }
      )
      return
    }

    // Detect optional "client_slug/project_slug" as first token (contains a slash, no spaces)
    let description = args
    let projectMetadata: Record<string, unknown> = {}
    let projectId: string | undefined

    const firstToken = args.split(' ')[0] ?? ''
    const projectScopeMatch = firstToken.match(/^([a-z0-9-]+)\/([a-z0-9-]+)$/)

    if (projectScopeMatch) {
      const clientSlug = projectScopeMatch[1]!
      const projectSlug = projectScopeMatch[2]!
      description = args.slice(firstToken.length).trim()

      if (!description) {
        await ctx.reply(
          `❌ Missing task description after \`${firstToken}\`.\n` +
            `Usage: /task ${firstToken} your task description`,
          { parse_mode: 'Markdown' }
        )
        return
      }

      try {
        const client = await getClientBySlug(clientSlug)
        if (!client) {
          await ctx.reply(
            `❌ Client \`${clientSlug}\` not found. Use /clients to see available clients.`,
            { parse_mode: 'Markdown' }
          )
          return
        }

        const project = await getProjectBySlug(client.id, projectSlug)
        if (!project) {
          await ctx.reply(
            `❌ Project \`${projectSlug}\` not found for client \`${clientSlug}\`.\n` +
              `Use /projects ${clientSlug} to see available projects.`,
            { parse_mode: 'Markdown' }
          )
          return
        }

        projectId = project.id
        projectMetadata = {
          project_id: project.id,
          project_name: project.name,
          project_slug: project.slug,
          project_type: project.type,
          client_id: client.id,
          client_name: client.name,
          client_slug: client.slug,
          workspace_path: project.workspace_path ?? undefined,
        }

        log.info(
          { clientSlug, projectSlug, projectId: project.id },
          'Task scoped to project'
        )
      } catch (err) {
        log.error({ err }, 'Failed to resolve project scope for /task')
        await ctx.reply('❌ Failed to resolve project. Check logs.')
        return
      }
    }

    try {
      const taskInput: CreateTaskInput = {
        title: description.substring(0, 100),
        description,
        type: 'dev',
        priority: 2,
        delegator_agent_id: 'founder',
        assignee_agent_id: 'ceo',
        requires_human_review: false,
        ...(projectId ? { project_id: projectId } : {}),
        ...(Object.keys(projectMetadata).length > 0 ? { metadata: projectMetadata } : {}),
      }

      const task = await createTask(taskInput)
      await recordEvent('task_created', {
        taskId: task.id,
        payload: {
          title: task.title,
          source: 'telegram',
          issued_by: 'founder',
          ...(projectId ? { project_id: projectId } : {}),
        },
      })

      const scopeLine =
        projectMetadata['project_name']
          ? `\nProject: ${projectMetadata['client_name'] as string} / ${projectMetadata['project_name'] as string}`
          : ''

      await ctx.reply(
        `✅ Task created:\nID: \`${task.id}\`\nTitle: ${task.title}${scopeLine}\nAssigned to: CEO Agent`,
        { parse_mode: 'Markdown' }
      )

      // Invoke CEO Agent asynchronously (fire-and-forget)
      void runCeoAgent(task, sendTelegramNotification).catch((err: unknown) => {
        log.error({ err, taskId: task.id }, 'CEO Agent failed')
      })
    } catch (err) {
      log.error({ err }, 'Failed to create task from Telegram')
      await ctx.reply('❌ Failed to create task. Check logs.')
    }
  })

  // /status
  bot.command('status', async (ctx) => {
    if (!requireFounder(ctx)) return

    try {
      const [agents, state, inProgress] = await Promise.all([
        getAgents(),
        getProjectState(),
        getTasksByStatus('in_progress'),
      ])

      const onlineCount = agents.filter((a) => a.status === 'online').length
      const statusLines = [
        `*WAI System Status*`,
        ``,
        `Phase: ${state?.phase ?? 'unknown'}`,
        `Milestone: ${state?.current_milestone ?? 'none'}`,
        `Agents online: ${onlineCount}/${agents.length}`,
        `Tasks in progress: ${inProgress.length}`,
        `Monthly cost: $${(state?.monthly_cost_usd ?? 0).toFixed(2)} / $${state?.monthly_budget_usd ?? 500}`,
      ]

      await ctx.reply(statusLines.join('\n'), { parse_mode: 'Markdown' })
    } catch (err) {
      log.error({ err }, 'Failed to get status')
      await ctx.reply('❌ Failed to get status.')
    }
  })

  // /logs [limit]
  bot.command('logs', async (ctx) => {
    if (!requireFounder(ctx)) return

    try {
      const events = await getRecentEvents(10)

      if (events.length === 0) {
        await ctx.reply('No recent events.')
        return
      }

      const lines = events.map((e) => {
        const time = new Date(e.created_at).toLocaleTimeString()
        const icon = e.severity === 'critical' ? '🔴' : e.severity === 'error' ? '🟠' : e.severity === 'warning' ? '🟡' : '🟢'
        return `${icon} [${time}] ${e.type}${e.agent_id ? ` (${e.agent_id})` : ''}`
      })

      await ctx.reply(`*Recent Events:*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' })
    } catch (err) {
      log.error({ err }, 'Failed to get logs')
      await ctx.reply('❌ Failed to get logs.')
    }
  })

  // /budget
  bot.command('budget', async (ctx) => {
    if (!requireFounder(ctx)) return

    try {
      const [cost, state] = await Promise.all([getMonthlyCost(), getProjectState()])
      const budget = state?.monthly_budget_usd ?? 500
      const pct = Math.round((cost / budget) * 100)
      const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10))

      await ctx.reply(
        `*Monthly Budget*\n\n[${bar}] ${pct}%\n$${cost.toFixed(2)} / $${budget.toFixed(2)}`,
        { parse_mode: 'Markdown' }
      )
    } catch (err) {
      log.error({ err }, 'Failed to get budget')
      await ctx.reply('❌ Failed to get budget.')
    }
  })

  // /assign_model agent_id model_id
  bot.command('assign_model', async (ctx) => {
    if (!requireFounder(ctx)) return

    const text = ctx.message?.text ?? ''
    const parts = text.split(' ').filter(Boolean)

    if (parts.length < 3) {
      await ctx.reply('Usage: /assign_model agent_id model_id\nExample: /assign_model dev_saas_1 gemini-2.5-flash')
      return
    }

    const agentId = parts[1]!
    const modelId = parts[2]!

    try {
      setModelOverride(agentId, modelId)
      await updateAgentModel(agentId, modelId)
      await recordEvent('model_changed', {
        agentId,
        payload: { model_id: modelId, changed_by: 'founder' },
      })
      await ctx.reply(`✅ Model for \`${agentId}\` set to \`${modelId}\``, { parse_mode: 'Markdown' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      await ctx.reply(`❌ Failed: ${message}`)
    }
  })

  // /approve <task_id>
  bot.command('approve', async (ctx) => {
    if (!requireFounder(ctx)) return

    const text = ctx.message?.text ?? ''
    const parts = text.split(' ').filter(Boolean)
    const taskId = parts[1]

    if (!taskId) {
      await ctx.reply('Usage: /approve <task\\_id>', { parse_mode: 'Markdown' })
      return
    }

    try {
      const task = await getTaskById(taskId)
      if (!task) {
        await ctx.reply(`❌ Task \`${taskId}\` not found.`, { parse_mode: 'Markdown' })
        return
      }

      await updateTaskStatus(taskId, 'done')
      await recordEvent('human_approved', {
        taskId,
        payload: { title: task.title, approved_by: 'founder' },
      })

      await ctx.reply(
        `✅ *Task Approved*\n\nID: \`${taskId}\`\nTitle: ${task.title}\nStatus: done`,
        { parse_mode: 'Markdown' }
      )
    } catch (err) {
      log.error({ err, taskId }, 'Failed to approve task')
      await ctx.reply('❌ Failed to approve task. Check logs.')
    }
  })

  // /reject <task_id> [reason]
  bot.command('reject', async (ctx) => {
    if (!requireFounder(ctx)) return

    const text = ctx.message?.text ?? ''
    const parts = text.replace('/reject', '').trim().split(' ')
    const taskId = parts[0]
    const reason = parts.slice(1).join(' ').trim() || 'No reason provided'

    if (!taskId) {
      await ctx.reply('Usage: /reject <task\\_id> [reason]', { parse_mode: 'Markdown' })
      return
    }

    try {
      const task = await getTaskById(taskId)
      if (!task) {
        await ctx.reply(`❌ Task \`${taskId}\` not found.`, { parse_mode: 'Markdown' })
        return
      }

      await updateTaskStatus(taskId, 'cancelled')
      await recordEvent('human_rejected', {
        taskId,
        payload: { title: task.title, rejected_by: 'founder', reason },
      })

      await ctx.reply(
        `🚫 *Task Rejected*\n\nID: \`${taskId}\`\nTitle: ${task.title}\nReason: ${reason}`,
        { parse_mode: 'Markdown' }
      )
    } catch (err) {
      log.error({ err, taskId }, 'Failed to reject task')
      await ctx.reply('❌ Failed to reject task. Check logs.')
    }
  })

  // /new_client <name> [email]
  bot.command('new_client', async (ctx) => {
    if (!requireFounder(ctx)) return

    const text = ctx.message?.text ?? ''
    const args = text.replace('/new_client', '').trim().split(/\s+/)
    const name = args[0]

    if (!name) {
      await ctx.reply('Usage: /new\\_client <name> \\[email\\]\nExample: /new\\_client "Acme Corp" info@acme.com', { parse_mode: 'Markdown' })
      return
    }

    const email = args[1] ?? undefined
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

    try {
      const existing = await getClientBySlug(slug)
      if (existing) {
        await ctx.reply(`⚠️ Client with slug \`${slug}\` already exists.`, { parse_mode: 'Markdown' })
        return
      }

      const client = await createClient({ name, slug, email })
      const workspacePath = await createClientWorkspace(slug)

      await recordEvent('task_created', {
        payload: { action: 'client_created', client_id: client.id, slug, source: 'telegram' },
      })

      await ctx.reply(
        `✅ *Client Created*\n\n` +
          `Name: ${client.name}\n` +
          `Slug: \`${slug}\`\n` +
          `Status: ${client.status}\n` +
          `Workspace: \`${workspacePath}\``,
        { parse_mode: 'Markdown' }
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      log.error({ err }, 'Failed to create client')
      await ctx.reply(`❌ Failed to create client: ${msg}`)
    }
  })

  // /new_project <client_slug> <project_name> [type]
  bot.command('new_project', async (ctx) => {
    if (!requireFounder(ctx)) return

    const text = ctx.message?.text ?? ''
    const args = text.replace('/new_project', '').trim().split(/\s+/)
    const clientSlug = args[0]

    // Last arg is type if it matches known types
    const knownTypes: ProjectType[] = ['website', 'app', 'consulting', 'marketing', 'other']
    const lastArg = args[args.length - 1] ?? ''
    const type: ProjectType = knownTypes.includes(lastArg as ProjectType) ? (lastArg as ProjectType) : 'other'
    const nameParts = knownTypes.includes(lastArg as ProjectType)
      ? args.slice(1, args.length - 1)
      : args.slice(1)
    const name = nameParts.join(' ')

    if (!clientSlug || !name) {
      await ctx.reply(
        'Usage: /new\\_project <client\\_slug> <project\\_name> \\[type\\]\n' +
          'Types: website \\| app \\| consulting \\| marketing \\| other\n' +
          'Example: /new\\_project acme-corp "Landing Page" website',
        { parse_mode: 'Markdown' }
      )
      return
    }

    try {
      const client = await getClientBySlug(clientSlug)
      if (!client) {
        await ctx.reply(`❌ Client \`${clientSlug}\` not found. Use /new\\_client first.`, { parse_mode: 'Markdown' })
        return
      }

      const projectSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const relPath = getRelativeProjectPath(clientSlug, projectSlug)

      const project = await createProject({
        client_id: client.id,
        name,
        slug: projectSlug,
        type,
        workspace_path: relPath,
      })

      const absPath = await createProjectWorkspace(clientSlug, projectSlug, name, type, client.name)
      await updateProjectWorkspacePath(project.id, relPath)

      await recordEvent('task_created', {
        payload: {
          action: 'project_created',
          project_id: project.id,
          client_slug: clientSlug,
          source: 'telegram',
        },
      })

      await ctx.reply(
        `✅ *Project Created*\n\n` +
          `Name: ${project.name}\n` +
          `Client: ${client.name}\n` +
          `Type: ${type}\n` +
          `Status: ${project.status}\n` +
          `Workspace: \`${absPath}\`\n` +
          `Files: brief.md, PROGRESS.md, deliverables/, assets/, drafts/`,
        { parse_mode: 'Markdown' }
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      log.error({ err }, 'Failed to create project')
      await ctx.reply(`❌ Failed to create project: ${msg}`)
    }
  })

  // /clients
  bot.command('clients', async (ctx) => {
    if (!requireFounder(ctx)) return

    try {
      const clients = await getClients()

      if (clients.length === 0) {
        await ctx.reply('No clients yet. Use /new\\_client to add one.', { parse_mode: 'Markdown' })
        return
      }

      const statusIcon = (s: string) =>
        s === 'active' ? '🟢' : s === 'prospect' ? '🟡' : s === 'completed' ? '✅' : '⬜'

      const lines = clients.map((c) => `${statusIcon(c.status)} *${c.name}* \\(\`${c.slug}\`\\) — ${c.status}`)

      await ctx.reply(`*Clients (${clients.length})*\n\n${lines.join('\n')}`, { parse_mode: 'MarkdownV2' })
    } catch (err) {
      log.error({ err }, 'Failed to list clients')
      await ctx.reply('❌ Failed to list clients.')
    }
  })

  // /projects [client_slug]
  bot.command('projects', async (ctx) => {
    if (!requireFounder(ctx)) return

    const text = ctx.message?.text ?? ''
    const clientSlug = text.replace('/projects', '').trim() || undefined

    try {
      const projects = clientSlug
        ? await getProjectsByClient(clientSlug)
        : await (async () => {
            const { getProjects } = await import('./supabase.js')
            return getProjects()
          })()

      if (projects.length === 0) {
        const note = clientSlug ? ` for \`${clientSlug}\`` : ''
        await ctx.reply(`No projects found${note}.`, { parse_mode: 'Markdown' })
        return
      }

      const statusIcon = (s: string) =>
        s === 'active' ? '🟢' : s === 'delivered' ? '✅' : s === 'paused' ? '⏸' : s === 'invoiced' ? '💰' : '🔵'

      const lines = projects.map(
        (p) => `${statusIcon(p.status)} *${p.name}* — ${p.type} — ${p.status}`
      )

      const title = clientSlug ? `Projects for \`${clientSlug}\`` : 'All Projects'
      await ctx.reply(`*${title} (${projects.length})*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' })
    } catch (err) {
      log.error({ err }, 'Failed to list projects')
      await ctx.reply('❌ Failed to list projects.')
    }
  })

  // Unknown commands
  bot.on('message', async (ctx) => {
    if (!requireFounder(ctx)) return
    await ctx.reply('Unknown command. Use /start for help.')
  })
}

// ---------------------------------------------------------------------------
// Notification sender (for agents to call)
// ---------------------------------------------------------------------------

export async function sendTelegramNotification(message: string): Promise<void> {
  const chatId = process.env['TELEGRAM_FOUNDER_CHAT_ID']
  if (!chatId) {
    log.warn('TELEGRAM_FOUNDER_CHAT_ID not set, skipping notification')
    return
  }

  try {
    const bot = getTelegramBot()
    await bot.api.sendMessage(chatId, message, { parse_mode: 'Markdown' })
  } catch (err) {
    log.error({ err }, 'Failed to send Telegram notification')
  }
}
