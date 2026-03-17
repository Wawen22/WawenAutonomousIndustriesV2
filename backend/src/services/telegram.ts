// ============================================================
// WAI – Telegram Bot Handler
// Processes commands from Neb and sends notifications.
// ============================================================

import { Bot, Context } from 'grammy'
import { log, recordEvent } from './logger.js'
import {
  createTask,
  getAgents,
  getMonthlyCost,
  getProjectState,
  getRecentEvents,
  getTaskById,
  getTasksByStatus,
  updateAgentModel,
  updateTaskStatus,
} from './supabase.js'
import { setModelOverride } from '../config/models.js'
import { runCeoAgent } from '../agents/ceo.js'
import type { CreateTaskInput } from '../types/index.js'

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
        'Commands:\n' +
        '/task descrizione – Crea un task\n' +
        '/status – Stato del sistema\n' +
        '/logs – Eventi recenti\n' +
        '/budget – Costi API\n' +
        '/assign\\_model agent\\_id model\\_id – Cambia modello\n' +
        '/approve task\\_id – Approva output\n' +
        '/reject task\\_id motivo – Rifiuta output',
      { parse_mode: 'Markdown' }
    )
    await recordEvent('founder_command', { payload: { command: 'start' } })
  })

  // /task "description" [type] [priority]
  bot.command('task', async (ctx) => {
    if (!requireFounder(ctx)) return

    const text = ctx.message?.text ?? ''
    const args = text.replace('/task', '').trim()

    if (!args) {
      await ctx.reply('Usage: /task "Task description" [type] [priority]\nExample: /task "Build auth module" dev 1')
      return
    }

    try {
      const taskInput: CreateTaskInput = {
        title: args.substring(0, 100),
        description: args,
        type: 'dev',
        priority: 2,
        delegator_agent_id: 'founder',
        assignee_agent_id: 'ceo',
        requires_human_review: false,
      }

      const task = await createTask(taskInput)
      await recordEvent('task_created', {
        taskId: task.id,
        payload: { title: task.title, source: 'telegram', issued_by: 'founder' },
      })

      await ctx.reply(`✅ Task created:\nID: \`${task.id}\`\nTitle: ${task.title}\nAssigned to: CEO Agent`, {
        parse_mode: 'Markdown',
      })

      // Invoke CEO Agent asynchronously (fire-and-forget)
      // Pass sendTelegramNotification as callback to avoid circular dependency
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
