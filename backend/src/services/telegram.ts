// ============================================================
// WAI – Telegram Bot Handler
// Processes commands from Neb and sends notifications.
// ============================================================

import { mkdir, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { Bot, Context, InputFile } from 'grammy'
import { isAbsolute, join } from 'path'
import {
  addGitRemoteOrigin,
  cloneGitRepository,
  initGitRepository,
  isDirectoryEmpty,
  looksLikeRepoUrl,
  resolveGitRepository,
  tokenizeCommandArgs,
} from './git.js'
import { log, recordEvent } from './logger.js'
import {
  executeFounderTaskAction,
  formatFounderTaskActionMessage,
} from './founder_task_actions.js'
import {
  executeInvoiceProject,
  executeMarkProjectPaid,
  formatInvoiceProjectMessage,
  formatMarkProjectPaidMessage,
} from './founder_revenue_actions.js'
import {
  createClient,
  createProject,
  createTask,
  getClientBySlug,
  getClients,
  getMonthlyCost,
  getProjectBySlug,
  getProjectState,
  getProjectsByClient,
  getRecentEvents,
  updateProjectRepo,
  updateProjectWorkspacePath,
} from './supabase.js'
import {
  createClientWorkspace,
  createProjectWorkspace,
  getProjectRepoPath,
  getProjectWorkspacePath,
  getRelativeProjectPath,
} from './workspace.js'
import { assignModelToAgent } from './model-assignments.js'
import { buildSystemStatusReport } from './status_report.js'
import { runCeoAgent } from '../agents/ceo.js'
import { runCeoNaturalLanguageHandler } from '../agents/ceo_intake.js'
import type { CreateTaskInput, ProjectType, RepoProvider } from '../types/index.js'

const PROJECT_TYPES: ProjectType[] = [
  'website',
  'app',
  'saas',
  'consulting',
  'ai',
  'marketing',
  'content',
  'copywriting',
  'design',
  'automation',
  'other',
]

function inferRepoProvider(repoUrl?: string): RepoProvider | undefined {
  if (!repoUrl) return undefined
  const lower = repoUrl.toLowerCase()
  if (lower.includes('github.com')) return 'github'
  if (lower.includes('gitlab')) return 'gitlab'
  if (lower.includes('bitbucket')) return 'bitbucket'
  return 'other'
}

function parseRepoCommandOptions(optionalArgs: string[]): {
  repoDefaultBranch?: string
  repoUrl?: string
} {
  if (optionalArgs.length > 2) {
    throw new Error('Too many optional arguments.')
  }

  const [first, second] = optionalArgs

  if (!first) return {}
  if (!second) {
    return looksLikeRepoUrl(first)
      ? { repoUrl: first }
      : { repoDefaultBranch: first }
  }

  if (looksLikeRepoUrl(first) && !looksLikeRepoUrl(second)) {
    return { repoUrl: first, repoDefaultBranch: second }
  }

  if (!looksLikeRepoUrl(first) && looksLikeRepoUrl(second)) {
    return { repoDefaultBranch: first, repoUrl: second }
  }

  throw new Error(
    'Optional arguments must be [branch] [repo_url] or [repo_url] [branch].'
  )
}

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
        '💬 *Natural Language:* Scrivi in testo libero e il CEO capirà cosa vuoi fare.\n' +
        'Es: "Crea un cliente chiamato Acme Corp", "sblocca la task abc12345", "fattura acme/landing 2500"\n\n' +
        '*Tasks (comandi diretti):*\n' +
        '/task descrizione – Crea un task\n' +
        '/task client/project descrizione – Task con scope progetto\n' +
        '/brief client/project testo – Aggiorna brief.md del progetto\n' +
        '/link\\_repo client/project "/path con spazi" \\[branch\\] \\[repo\\_url\\] – Collega repo esistente\n' +
        '/link\\_repo client/project https://repo.git \\[branch\\] – Clona repo nel workspace e la collega\n' +
        '/init\\_repo client/project \\[repo\\_url\\] \\[branch\\] – Inizializza repo locale nel workspace\n' +
        '/approve task\\_id – Approva output\n' +
        '/retry task\\_id \\[reason\\] – Sblocca e rilancia un task bloccato (ID completo o short ID univoco)\n' +
        '/reject task\\_id motivo – Rifiuta output\n\n' +
        '*Clients & Projects:*\n' +
        '/new\\_client nome \\[email\\] – Crea cliente\n' +
        '/new\\_project slug\\_cliente nome \\[tipo\\] – Crea progetto\n' +
        '/clients – Lista clienti\n' +
        '/projects \\[client\\_slug\\] – Lista progetti\n' +
        '/invoice client/project \\[amount\\_usd\\] – Fattura progetto consegnato\n' +
        '/mark\\_paid client/project amount\\_usd – Registra pagamento ricevuto\n\n' +
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
          repo_url: project.repo_url ?? undefined,
          repo_local_path: project.repo_local_path ?? undefined,
          repo_default_branch: project.repo_default_branch ?? undefined,
          repo_provider: project.repo_provider ?? undefined,
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

  // /brief <client_slug>/<project_slug> <brief text>
  bot.command('brief', async (ctx) => {
    if (!requireFounder(ctx)) return

    const text = ctx.message?.text ?? ''
    const args = text.replace(/^\/brief(?:@\S+)?/, '').trim()

    if (!args) {
      await ctx.reply(
        'Usage:\n' +
          '/brief client\\_slug/project\\_slug brief text\n\n' +
          'Example:\n' +
          '/brief acme\\-corp/landingpage Landing page per lead generation B2B con CTA demo',
        { parse_mode: 'Markdown' }
      )
      return
    }

    const firstSpace = args.indexOf(' ')
    if (firstSpace === -1) {
      await ctx.reply('❌ Missing brief text.\nUsage: /brief client\\_slug/project\\_slug your brief', {
        parse_mode: 'Markdown',
      })
      return
    }

    const scope = args.slice(0, firstSpace).trim()
    const briefText = args.slice(firstSpace + 1).trim()
    const scopeMatch = scope.match(/^([a-z0-9-]+)\/([a-z0-9-]+)$/)

    if (!scopeMatch || !briefText) {
      await ctx.reply('❌ Invalid format.\nUsage: /brief client\\_slug/project\\_slug your brief', {
        parse_mode: 'Markdown',
      })
      return
    }

    const clientSlug = scopeMatch[1]!
    const projectSlug = scopeMatch[2]!

    try {
      const client = await getClientBySlug(clientSlug)
      if (!client) {
        await ctx.reply(`❌ Client \`${clientSlug}\` not found. Use /clients to inspect available clients.`, {
          parse_mode: 'Markdown',
        })
        return
      }

      const project = await getProjectBySlug(client.id, projectSlug)
      if (!project) {
        await ctx.reply(
          `❌ Project \`${projectSlug}\` not found for client \`${clientSlug}\`.\nUse /projects ${clientSlug} to inspect available projects.`,
          { parse_mode: 'Markdown' }
        )
        return
      }

      const projectPath = getProjectWorkspacePath(clientSlug, projectSlug)
      await mkdir(projectPath, { recursive: true })

      const briefPath = join(projectPath, 'brief.md')
      await writeFile(briefPath, briefText, 'utf-8')

      await recordEvent('founder_command', {
        payload: {
          command: 'brief',
          client_slug: clientSlug,
          project_slug: projectSlug,
          project_id: project.id,
          brief_path: briefPath,
        },
      })

      await ctx.reply(
        `✅ *Brief Updated*\n\n` +
          `Client: ${client.name}\n` +
          `Project: ${project.name}\n` +
          `Path: \`${briefPath}\``,
        { parse_mode: 'Markdown' }
      )
    } catch (err) {
      log.error({ err, clientSlug, projectSlug }, 'Failed to update project brief')
      await ctx.reply('❌ Failed to update brief. Check logs.')
    }
  })

  // /link_repo <client_slug>/<project_slug> <repo_local_path|repo_url> [branch] [repo_url]
  bot.command('link_repo', async (ctx) => {
    if (!requireFounder(ctx)) return

    const text = ctx.message?.text ?? ''
    let args: string[]

    try {
      args = tokenizeCommandArgs(text.replace(/^\/link_repo(?:@\S+)?/, '').trim())
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid command arguments.'
      await ctx.reply(`❌ ${msg}\nTip: wrap paths with spaces in double quotes.`, {
        parse_mode: 'Markdown',
      })
      return
    }

    if (args.length < 2) {
      await ctx.reply(
        'Usage:\n' +
          '/link\\_repo client\\_slug/project\\_slug "/absolute/repo/path" \\[branch\\] \\[repo\\_url\\]\n' +
          '/link\\_repo client\\_slug/project\\_slug https://github.com/org/repo.git \\[branch\\]\n\n' +
          'Examples:\n' +
          '/link\\_repo acme-corp/client-portal "/home/neb/repos/Client Portal" main\n' +
          '/link\\_repo acme-corp/client-portal https://github.com/acme/client-portal.git main',
        { parse_mode: 'Markdown' }
      )
      return
    }

    const scope = args[0]!
    const repoSource = args[1]!
    const scopeMatch = scope.match(/^([a-z0-9-]+)\/([a-z0-9-]+)$/)
    let repoDefaultBranch: string | undefined
    let repoUrl: string | undefined

    try {
      const parsedOptions = parseRepoCommandOptions(args.slice(2))
      repoDefaultBranch = parsedOptions.repoDefaultBranch
      repoUrl = parsedOptions.repoUrl
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid optional arguments.'
      await ctx.reply(`❌ ${msg}`, { parse_mode: 'Markdown' })
      return
    }

    if (!scopeMatch) {
      await ctx.reply('❌ Invalid scope. Usage: /link\\_repo client\\_slug/project\\_slug "/absolute/repo/path"', {
        parse_mode: 'Markdown',
      })
      return
    }

    const clientSlug = scopeMatch[1]!
    const projectSlug = scopeMatch[2]!
    const canonicalRepoPath = getProjectRepoPath(clientSlug, projectSlug)
    const projectWorkspacePath = getProjectWorkspacePath(clientSlug, projectSlug)

    try {
      const client = await getClientBySlug(clientSlug)
      if (!client) {
        await ctx.reply(`❌ Client \`${clientSlug}\` not found.`, { parse_mode: 'Markdown' })
        return
      }

      const project = await getProjectBySlug(client.id, projectSlug)
      if (!project) {
        await ctx.reply(`❌ Project \`${projectSlug}\` not found for client \`${clientSlug}\`.`, {
          parse_mode: 'Markdown',
        })
          return
      }

      await mkdir(projectWorkspacePath, { recursive: true })

      if (looksLikeRepoUrl(repoSource)) {
        const remoteUrl = repoSource
        let repoInfo:
          | {
              rootPath: string
              currentBranch: string | null
              originUrl: string | null
            }
          | null = null
        let reusedExistingRepo = false

        if (existsSync(canonicalRepoPath)) {
          try {
            repoInfo = await resolveGitRepository(canonicalRepoPath)
            reusedExistingRepo = true
          } catch {
            if (!(await isDirectoryEmpty(canonicalRepoPath))) {
              await ctx.reply(
                `❌ Target path \`${canonicalRepoPath}\` already exists and is not an empty git repo.\n` +
                  'WAI will not overwrite it automatically.',
                { parse_mode: 'Markdown' }
              )
              return
            }
          }
        }

        if (!repoInfo) {
          repoInfo = await cloneGitRepository(remoteUrl, canonicalRepoPath, repoDefaultBranch)
        } else if (!repoInfo.originUrl) {
          await addGitRemoteOrigin(repoInfo.rootPath, remoteUrl)
          repoInfo = await resolveGitRepository(repoInfo.rootPath)
        }

        if (repoInfo.originUrl && repoInfo.originUrl !== remoteUrl) {
          await ctx.reply(
            `❌ Workspace repo already points to \`${repoInfo.originUrl}\`, not \`${remoteUrl}\`.\n` +
              'WAI will not rewrite the remote automatically.',
            { parse_mode: 'Markdown' }
          )
          return
        }

        const resolvedRepoUrl = repoInfo.originUrl ?? remoteUrl
        const resolvedBranch = repoInfo.currentBranch ?? repoDefaultBranch
        const repoProvider = inferRepoProvider(resolvedRepoUrl)

        await updateProjectRepo(project.id, {
          repo_local_path: repoInfo.rootPath,
          repo_default_branch: resolvedBranch,
          repo_url: resolvedRepoUrl,
          repo_provider: repoProvider,
        })

        await recordEvent('founder_command', {
          payload: {
            command: 'link_repo',
            mode: reusedExistingRepo ? 'link_existing_workspace_repo' : 'clone_remote',
            project_id: project.id,
            client_slug: clientSlug,
            project_slug: projectSlug,
            repo_local_path: repoInfo.rootPath,
            repo_default_branch: resolvedBranch,
            repo_url: resolvedRepoUrl,
            repo_provider: repoProvider,
            workspace_repo_path: canonicalRepoPath,
          },
        })

        await ctx.reply(
          `✅ *Repo ${reusedExistingRepo ? 'Linked' : 'Cloned & Linked'}*\n\n` +
            `Client: ${client.name}\n` +
            `Project: ${project.name}\n` +
            `Repo Path: \`${repoInfo.rootPath}\`\n` +
            `Branch: ${resolvedBranch ?? '—'}\n` +
            `Repo URL: ${resolvedRepoUrl}\n` +
            `Mode: ${reusedExistingRepo ? 'existing workspace checkout reused' : 'cloned into workspace/repo'}`,
          { parse_mode: 'Markdown' }
        )
        return
      }

      if (!isAbsolute(repoSource)) {
        await ctx.reply('❌ repo_local_path must be an absolute path. Quote it if it contains spaces.', {
          parse_mode: 'Markdown',
        })
        return
      }

      if (!existsSync(repoSource)) {
        await ctx.reply(`❌ Path \`${repoSource}\` does not exist on disk.`, { parse_mode: 'Markdown' })
        return
      }

      let repoInfo: {
        rootPath: string
        currentBranch: string | null
        originUrl: string | null
      }

      try {
        repoInfo = await resolveGitRepository(repoSource)
      } catch {
        await ctx.reply(
          `❌ Path \`${repoSource}\` exists, but it is not a git repository.\n` +
            `Use /init\\_repo ${clientSlug}/${projectSlug} to create the canonical workspace repo, or point /link\\_repo to an existing git checkout.`,
          { parse_mode: 'Markdown' }
        )
        return
      }

      if (repoUrl && repoInfo.originUrl && repoInfo.originUrl !== repoUrl) {
        await ctx.reply(
          `❌ Provided repo URL \`${repoUrl}\` does not match detected origin \`${repoInfo.originUrl}\`.`,
          { parse_mode: 'Markdown' }
        )
        return
      }

      const resolvedRepoUrl = repoUrl ?? repoInfo.originUrl ?? undefined
      const resolvedBranch = repoDefaultBranch ?? repoInfo.currentBranch ?? undefined
      const repoProvider = inferRepoProvider(resolvedRepoUrl)

      await updateProjectRepo(project.id, {
        repo_local_path: repoInfo.rootPath,
        repo_default_branch: resolvedBranch,
        repo_url: resolvedRepoUrl,
        repo_provider: repoProvider,
      })

      await recordEvent('founder_command', {
        payload: {
          command: 'link_repo',
          mode: 'link_existing',
          project_id: project.id,
          client_slug: clientSlug,
          project_slug: projectSlug,
          provided_path: repoSource,
          repo_local_path: repoInfo.rootPath,
          repo_default_branch: resolvedBranch,
          repo_url: resolvedRepoUrl,
          repo_provider: repoProvider,
        },
      })

      await ctx.reply(
        `✅ *Repo Linked*\n\n` +
          `Client: ${client.name}\n` +
          `Project: ${project.name}\n` +
          `Repo Path: \`${repoInfo.rootPath}\`\n` +
          `Branch: ${resolvedBranch ?? '—'}\n` +
          `Repo URL: ${resolvedRepoUrl ?? '—'}`,
        { parse_mode: 'Markdown' }
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      log.error({ err, clientSlug, projectSlug, repoSource }, 'Failed to link repo')
      await ctx.reply(`❌ Failed to link repo: ${msg}`)
    }
  })

  // /init_repo <client_slug>/<project_slug> [repo_url] [branch]
  bot.command('init_repo', async (ctx) => {
    if (!requireFounder(ctx)) return

    const text = ctx.message?.text ?? ''
    let args: string[]

    try {
      args = tokenizeCommandArgs(text.replace(/^\/init_repo(?:@\S+)?/, '').trim())
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid command arguments.'
      await ctx.reply(`❌ ${msg}`, { parse_mode: 'Markdown' })
      return
    }

    if (args.length < 1) {
      await ctx.reply(
        'Usage:\n' +
          '/init\\_repo client\\_slug/project\\_slug \\[repo\\_url\\] \\[branch\\]\n' +
          '/init\\_repo client\\_slug/project\\_slug \\[branch\\]\n\n' +
          'Examples:\n' +
          '/init\\_repo acme-corp/client-portal\n' +
          '/init\\_repo acme-corp/client-portal https://github.com/acme/client-portal.git main',
        { parse_mode: 'Markdown' }
      )
      return
    }

    const scope = args[0]!
    const scopeMatch = scope.match(/^([a-z0-9-]+)\/([a-z0-9-]+)$/)

    if (!scopeMatch) {
      await ctx.reply('❌ Invalid scope. Usage: /init\\_repo client\\_slug/project\\_slug', {
        parse_mode: 'Markdown',
      })
      return
    }

    let repoDefaultBranch: string | undefined
    let repoUrl: string | undefined

    try {
      const parsedOptions = parseRepoCommandOptions(args.slice(1))
      repoDefaultBranch = parsedOptions.repoDefaultBranch
      repoUrl = parsedOptions.repoUrl
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid optional arguments.'
      await ctx.reply(`❌ ${msg}`, { parse_mode: 'Markdown' })
      return
    }

    const clientSlug = scopeMatch[1]!
    const projectSlug = scopeMatch[2]!
    const projectWorkspacePath = getProjectWorkspacePath(clientSlug, projectSlug)
    const canonicalRepoPath = getProjectRepoPath(clientSlug, projectSlug)

    try {
      const client = await getClientBySlug(clientSlug)
      if (!client) {
        await ctx.reply(`❌ Client \`${clientSlug}\` not found.`, { parse_mode: 'Markdown' })
        return
      }

      const project = await getProjectBySlug(client.id, projectSlug)
      if (!project) {
        await ctx.reply(`❌ Project \`${projectSlug}\` not found for client \`${clientSlug}\`.`, {
          parse_mode: 'Markdown',
        })
        return
      }

      await mkdir(projectWorkspacePath, { recursive: true })

      let repoInfo:
        | {
            rootPath: string
            currentBranch: string | null
            originUrl: string | null
          }
        | null = null
      let reusedExistingRepo = false

      if (existsSync(canonicalRepoPath)) {
        try {
          repoInfo = await resolveGitRepository(canonicalRepoPath)
          reusedExistingRepo = true
        } catch {
          if (!(await isDirectoryEmpty(canonicalRepoPath))) {
            await ctx.reply(
              `❌ Target path \`${canonicalRepoPath}\` already exists and is not empty.\n` +
                'WAI will not run git init over existing files automatically.',
              { parse_mode: 'Markdown' }
            )
            return
          }
        }
      }

      if (!repoInfo) {
        repoInfo = await initGitRepository(canonicalRepoPath, repoDefaultBranch, repoUrl)
      } else if (repoUrl && !repoInfo.originUrl) {
        await addGitRemoteOrigin(repoInfo.rootPath, repoUrl)
        repoInfo = await resolveGitRepository(repoInfo.rootPath)
      }

      if (repoUrl && repoInfo.originUrl && repoInfo.originUrl !== repoUrl) {
        await ctx.reply(
          `❌ Workspace repo already points to \`${repoInfo.originUrl}\`, not \`${repoUrl}\`.\n` +
            'WAI will not rewrite the remote automatically.',
          { parse_mode: 'Markdown' }
        )
        return
      }

      const resolvedRepoUrl = repoInfo.originUrl ?? repoUrl
      const resolvedBranch = repoInfo.currentBranch ?? repoDefaultBranch
      const repoProvider = inferRepoProvider(resolvedRepoUrl)

      await updateProjectRepo(project.id, {
        repo_local_path: repoInfo.rootPath,
        repo_default_branch: resolvedBranch,
        repo_url: resolvedRepoUrl,
        repo_provider: repoProvider,
      })

      await recordEvent('founder_command', {
        payload: {
          command: 'init_repo',
          mode: reusedExistingRepo ? 'link_existing_workspace_repo' : 'init_local',
          project_id: project.id,
          client_slug: clientSlug,
          project_slug: projectSlug,
          repo_local_path: repoInfo.rootPath,
          repo_default_branch: resolvedBranch,
          repo_url: resolvedRepoUrl,
          repo_provider: repoProvider,
          workspace_repo_path: canonicalRepoPath,
        },
      })

      await ctx.reply(
        `✅ *Repo ${reusedExistingRepo ? 'Already Initialized & Linked' : 'Initialized & Linked'}*\n\n` +
          `Client: ${client.name}\n` +
          `Project: ${project.name}\n` +
          `Repo Path: \`${repoInfo.rootPath}\`\n` +
          `Branch: ${resolvedBranch ?? '—'}\n` +
          `Repo URL: ${resolvedRepoUrl ?? '—'}`,
        { parse_mode: 'Markdown' }
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      log.error({ err, clientSlug, projectSlug }, 'Failed to init repo')
      await ctx.reply(`❌ Failed to init repo: ${msg}`)
    }
  })

  // /status
  bot.command('status', async (ctx) => {
    if (!requireFounder(ctx)) return

    try {
      await ctx.reply(await buildSystemStatusReport(), { parse_mode: 'Markdown' })
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
      await assignModelToAgent(agentId, modelId)
      await recordEvent('model_changed', {
        agentId,
        payload: { model_id: modelId, changed_by: 'founder', source: 'telegram_command' },
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
      const result = await executeFounderTaskAction(taskId, 'approve', {
        source: 'telegram',
        notify: sendTelegramNotification,
      })

      await ctx.reply(formatFounderTaskActionMessage(result), { parse_mode: 'Markdown' })
    } catch (err) {
      log.error({ err, taskId }, 'Failed to approve task')
      const message = err instanceof Error ? err.message : 'Unknown error'
      await ctx.reply(`❌ Failed to approve task: ${message}`)
    }
  })

  // /retry <task_id> [reason]
  bot.command('retry', async (ctx) => {
    if (!requireFounder(ctx)) return

    const text = ctx.message?.text ?? ''
    const parts = text.replace(/^\/retry(?:@\S+)?/, '').trim().split(/\s+/)
    const taskId = parts[0]
    const reason = parts.slice(1).join(' ').trim() || undefined

    if (!taskId) {
      await ctx.reply('Usage: /retry <task\\_id> [reason]', { parse_mode: 'Markdown' })
      return
    }

    try {
      const result = await executeFounderTaskAction(taskId, 'retry', {
        source: 'telegram',
        reason,
        notify: sendTelegramNotification,
      })

      await ctx.reply(formatFounderTaskActionMessage(result), { parse_mode: 'Markdown' })
    } catch (err) {
      log.error({ err, taskId }, 'Failed to retry task')
      const message = err instanceof Error ? err.message : 'Unknown error'
      await ctx.reply(`❌ Failed to retry task: ${message}`)
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
      const result = await executeFounderTaskAction(taskId, 'reject', {
        source: 'telegram',
        reason,
        notify: sendTelegramNotification,
      })

      await ctx.reply(formatFounderTaskActionMessage(result), { parse_mode: 'Markdown' })
    } catch (err) {
      log.error({ err, taskId }, 'Failed to reject task')
      const message = err instanceof Error ? err.message : 'Unknown error'
      await ctx.reply(`❌ Failed to reject task: ${message}`)
    }
  })

  // /new_client <name> [email]
  bot.command('new_client', async (ctx) => {
    if (!requireFounder(ctx)) return

    const text = ctx.message?.text ?? ''
    let args: string[]

    try {
      args = tokenizeCommandArgs(text.replace(/^\/new_client(?:@\S+)?/, '').trim())
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid command arguments.'
      await ctx.reply(`❌ ${msg}`, { parse_mode: 'Markdown' })
      return
    }

    const lastArg = args[args.length - 1]
    const email = lastArg && lastArg.includes('@') ? lastArg : undefined
    const name = (email ? args.slice(0, -1) : args).join(' ').trim()

    if (!name) {
      await ctx.reply('Usage: /new\\_client <name> \\[email\\]\nExample: /new\\_client "Acme Corp" info@acme.com', { parse_mode: 'Markdown' })
      return
    }

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
    let args: string[]

    try {
      args = tokenizeCommandArgs(text.replace(/^\/new_project(?:@\S+)?/, '').trim())
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid command arguments.'
      await ctx.reply(`❌ ${msg}`, { parse_mode: 'Markdown' })
      return
    }

    const clientSlug = args[0]

    // Last arg is type if it matches known types
    const knownTypes: ProjectType[] = PROJECT_TYPES
    const lastArg = args[args.length - 1] ?? ''
    const type: ProjectType = knownTypes.includes(lastArg as ProjectType) ? (lastArg as ProjectType) : 'other'
    const nameParts = knownTypes.includes(lastArg as ProjectType)
      ? args.slice(1, args.length - 1)
      : args.slice(1)
    const name = nameParts.join(' ')

    if (!clientSlug || !name) {
      await ctx.reply(
        'Usage: /new\\_project <client\\_slug> <project\\_name> \\[type\\]\n' +
          'Types: website \\| app \\| saas \\| consulting \\| ai \\| marketing \\| content \\| copywriting \\| design \\| automation \\| other\n' +
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
        s === 'active'
          ? '🟢'
          : s === 'delivered'
            ? '✅'
            : s === 'blocked'
              ? '⛔'
              : s === 'paused'
                ? '⏸'
                : s === 'invoiced'
                  ? '💰'
                  : '🔵'

      const lines = projects.map((p) => {
        const repoMarker = p.repo_local_path ? ' — 🔗 repo linked' : ''
        return `${statusIcon(p.status)} *${p.name}* — ${p.type} — ${p.status}${repoMarker}`
      })

      const title = clientSlug ? `Projects for \`${clientSlug}\`` : 'All Projects'
      await ctx.reply(`*${title} (${projects.length})*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' })
    } catch (err) {
      log.error({ err }, 'Failed to list projects')
      await ctx.reply('❌ Failed to list projects.')
    }
  })

  // /invoice <client_slug>/<project_slug> [amount_usd]
  // Marks a project as invoiced and optionally sets contract_value_usd.
  bot.command('invoice', async (ctx) => {
    if (!requireFounder(ctx)) return

    const text = ctx.message?.text ?? ''
    const parts = text.replace(/^\/invoice(?:@\S+)?/, '').trim().split(/\s+/)
    const scope = parts[0]

    if (!scope) {
      await ctx.reply(
        'Usage: /invoice client\\_slug/project\\_slug \\[amount\\_usd\\]\n\n' +
          'Examples:\n' +
          '/invoice acme\\-corp/landing\\-page\n' +
          '/invoice acme\\-corp/landing\\-page 2500',
        { parse_mode: 'Markdown' }
      )
      return
    }

    const scopeMatch = scope.match(/^([a-z0-9-]+)\/([a-z0-9-]+)$/)
    if (!scopeMatch) {
      await ctx.reply('❌ Invalid format. Use: /invoice client\\_slug/project\\_slug', {
        parse_mode: 'Markdown',
      })
      return
    }

    const clientSlug = scopeMatch[1]!
    const projectSlug = scopeMatch[2]!
    const rawAmount = parts[1]
    const amountUsd = rawAmount ? Number.parseFloat(rawAmount) : undefined

    if (rawAmount !== undefined && (Number.isNaN(amountUsd) || (amountUsd !== undefined && amountUsd < 0))) {
      await ctx.reply('❌ Invalid amount. Must be a positive number (e.g. 2500 or 1499.99).', {
        parse_mode: 'Markdown',
      })
      return
    }

    try {
      const result = await executeInvoiceProject(clientSlug, projectSlug, amountUsd, 'telegram')
      await ctx.reply(formatInvoiceProjectMessage(result), { parse_mode: 'Markdown' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      log.error({ err, clientSlug, projectSlug }, 'Failed to invoice project')
      await ctx.reply(`❌ Failed to invoice project: ${msg}`)
    }
  })

  // /mark_paid <client_slug>/<project_slug> <amount_usd>
  // Records cash actually received after invoicing.
  bot.command('mark_paid', async (ctx) => {
    if (!requireFounder(ctx)) return

    const text = ctx.message?.text ?? ''
    const parts = text.replace(/^\/mark_paid(?:@\S+)?/, '').trim().split(/\s+/)
    const scope = parts[0]
    const rawAmount = parts[1]

    if (!scope || !rawAmount) {
      await ctx.reply(
        'Usage: /mark\\_paid client\\_slug/project\\_slug amount\\_usd\n\n' +
          'Examples:\n' +
          '/mark\\_paid acme\\-corp/landing\\-page 500\n' +
          '/mark\\_paid acme\\-corp/landing\\-page 2500',
        { parse_mode: 'Markdown' }
      )
      return
    }

    const scopeMatch = scope.match(/^([a-z0-9-]+)\/([a-z0-9-]+)$/)
    if (!scopeMatch) {
      await ctx.reply('❌ Invalid format. Use: /mark\\_paid client\\_slug/project\\_slug amount', {
        parse_mode: 'Markdown',
      })
      return
    }

    const amountUsd = Number.parseFloat(rawAmount)
    if (Number.isNaN(amountUsd) || amountUsd <= 0) {
      await ctx.reply('❌ Invalid amount. Must be a positive number (e.g. 500 or 1499.99).', {
        parse_mode: 'Markdown',
      })
      return
    }

    const clientSlug = scopeMatch[1]!
    const projectSlug = scopeMatch[2]!

    try {
      const result = await executeMarkProjectPaid(clientSlug, projectSlug, amountUsd, 'telegram')
      await ctx.reply(formatMarkProjectPaidMessage(result), { parse_mode: 'Markdown' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      log.error({ err, clientSlug, projectSlug, amountUsd }, 'Failed to record payment')
      await ctx.reply(`❌ Failed to record payment: ${msg}`)
    }
  })

  // Free-text natural language → CEO Intake Handler
  bot.on('message:text', async (ctx) => {
    if (!requireFounder(ctx)) return

    const text = ctx.message?.text ?? ''

    // Commands not matched by any handler above → show help
    if (text.startsWith('/')) {
      await ctx.reply('Unknown command. Use /start for help.')
      return
    }

    // Free-text message: route to CEO natural language handler
    const chatId = String(ctx.chat?.id ?? ctx.from?.id ?? 'unknown')
    const reply = async (msg: string) => {
      await ctx.reply(msg, { parse_mode: 'Markdown' })
    }
    const notify = sendTelegramNotification

    void runCeoNaturalLanguageHandler(chatId, text, reply, notify).catch((err: unknown) => {
      log.error({ err, chatId }, 'CEO Intake handler error')
      void ctx.reply('❌ Errore interno. Riprova.')
    })
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
    try {
      await bot.api.sendMessage(chatId, message, { parse_mode: 'Markdown' })
    } catch {
      // Markdown parse failed (e.g. unmatched backtick in agent output) — retry as plain text
      await bot.api.sendMessage(chatId, message)
    }
  } catch (err) {
    log.error({ err }, 'Failed to send Telegram notification')
  }
}

export async function sendTelegramPhoto(photoPath: string, caption?: string): Promise<void> {
  const chatId = process.env['TELEGRAM_FOUNDER_CHAT_ID']
  if (!chatId) {
    log.warn('TELEGRAM_FOUNDER_CHAT_ID not set, skipping photo notification')
    return
  }

  try {
    const bot = getTelegramBot()
    await bot.api.sendPhoto(chatId, new InputFile(photoPath), {
      ...(caption ? { caption } : {}),
      parse_mode: 'Markdown',
    })
  } catch (err) {
    log.error({ err, photoPath }, 'Failed to send Telegram photo')
  }
}

