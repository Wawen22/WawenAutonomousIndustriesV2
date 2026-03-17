// ============================================================
// WAI – CEO Agent
// Riceve un task da Neb, decide a chi delegarlo, crea subtask.
// ============================================================

import { runAgent } from '../services/llm.js'
import { createTask, updateTaskStatus } from '../services/supabase.js'
import { log, recordEvent } from '../services/logger.js'
import { runPmSaasAgent } from './pm_saas.js'
import { runDevLeadSaasAgent } from './dev_lead_saas.js'
import { runDevSaasAgent } from './dev_saas.js'
import { runConsultingLeadAgent } from './consulting_lead.js'
import { runAnalystAgent } from './analyst.js'
import { runMarketingStrategistAgent } from './marketing_strategist.js'
import { runContentCreatorAgent } from './content_creator.js'
import { runSocialManagerAgent } from './social_manager.js'
import type { Task, TaskType, TaskPriority } from '../types/index.js'

// ---------------------------------------------------------------------------
// Roster agenti disponibili (iniettato nel system prompt)
// ---------------------------------------------------------------------------

const AGENT_ROSTER = `
Available agents:
- pm_saas         – Product Manager SaaS: roadmap, feature prioritization, user stories for SaaS products
- dev_lead_saas   – Dev Lead SaaS: technical planning, sprint planning, subtask breakdown
- dev_saas_1      – Developer SaaS #1: code implementation, tests, PRs
- dev_saas_2      – Developer SaaS #2: boilerplate, docs, simple features
- architect       – Architect: system design, tech stack decisions, diagrams
- dev_general_1   – Developer General #1: implementation, refactoring, debugging
- dev_general_2   – Developer General #2: simple implementations, boilerplate
- qa              – QA Agent: test writing, quality checklists, bug reports
- consulting_lead – Consulting Lead: client proposals, scope definition, consulting delivery pipeline — USE THIS for any client project task, consulting work, or proposal creation
- analyst         – Analyst: market research, data gathering, competitive analysis, reports — USE THIS for standalone analysis tasks without a consulting proposal
- marketing_strategist – Marketing Strategist: campaigns, funnels, positioning, content plans — USE THIS for project-scoped marketing, content, copywriting, launch or growth work
- content_creator – Content Creator: blog posts, social copy, scripts, newsletters — USE THIS for standalone copy/content production tasks
- social_manager  – Social Media Manager: scheduling, engagement, metrics — USE THIS for standalone distribution, social planning, or channel calendar tasks
- ops             – Ops Agent: system monitoring, uptime, incidents
- finance         – Finance Agent: cost tracking, budget alerts, reports
- hr              – HR Agent: agent docs, role definitions, process docs
`.trim()

const VALID_TASK_TYPES = [
  'dev', 'dev_complex', 'dev_simple', 'marketing', 'content',
  'consulting', 'analysis', 'ops', 'finance', 'hr',
  'strategy', 'architecture', 'planning', 'support', 'routing',
] as const

// ---------------------------------------------------------------------------
// Tipi interni
// ---------------------------------------------------------------------------

interface DelegationDecision {
  delegateTo: string
  reasoning: string
  subtaskTitle: string
  taskType: TaskType
  priority: TaskPriority
}

// ---------------------------------------------------------------------------
// Parse risposta LLM → DelegationDecision
// ---------------------------------------------------------------------------

function parseDelegation(raw: string): DelegationDecision | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  } catch {
    return null
  }

  const { delegateTo, reasoning, subtaskTitle, taskType, priority } = parsed

  if (
    typeof delegateTo !== 'string' ||
    typeof reasoning !== 'string' ||
    typeof subtaskTitle !== 'string' ||
    typeof taskType !== 'string' ||
    typeof priority !== 'number'
  ) {
    return null
  }

  if (!(VALID_TASK_TYPES as readonly string[]).includes(taskType)) {
    log.warn({ taskType }, 'CEO returned unknown taskType, defaulting to dev')
  }

  return {
    delegateTo,
    reasoning,
    subtaskTitle,
    taskType: (VALID_TASK_TYPES as readonly string[]).includes(taskType)
      ? (taskType as TaskType)
      : 'dev',
    priority: (Math.min(Math.max(Math.round(priority), 1), 5)) as TaskPriority,
  }
}

// ---------------------------------------------------------------------------
// runCeoAgent – entry point
//
// notify: callback per mandare messaggi Telegram a Neb.
//         Passato dall'esterno per evitare circular dependency con telegram.ts
// ---------------------------------------------------------------------------

export async function runCeoAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  log.info({ taskId: task.id, title: task.title }, 'CEO Agent: analyzing task')

  // Build optional project context from task.metadata or task.project_id
  const projectId = task.project_id ?? (task.metadata['project_id'] as string | undefined)
  let projectContext = ''
  if (task.metadata['project_name']) {
    const clientSlug = task.metadata['client_slug'] as string | undefined
    projectContext = `\nProject context:
- Project: ${task.metadata['project_name'] as string}
- Client: ${(task.metadata['client_name'] as string | undefined) ?? 'unknown'}
- Type: ${(task.metadata['project_type'] as string | undefined) ?? 'unknown'}
${clientSlug ? `- Client slug: ${clientSlug}` : ''}`
  }

  const systemPrompt = `You are the CEO Agent of WAI (Wawen Autonomous Industries), a Zero Human Company.
Your role: analyze tasks from Founder Neb and delegate them to the right agent.

${AGENT_ROSTER}

Valid taskType values: ${VALID_TASK_TYPES.join(', ')}

Routing hints:
- If the task is a client project with type consulting or ai, prefer consulting_lead unless it is pure standalone analysis.
- If the task is for saas, app, website, or automation delivery, prefer pm_saas or dev_lead_saas unless it is clearly a single worker task.
- If the task is for marketing, content, copywriting, design, launches, funnels, or audience growth, prefer marketing_strategist for coordinated delivery. Use content_creator or social_manager directly only for clearly standalone execution.

Respond with ONLY a JSON object — no markdown, no text outside JSON:
{
  "delegateTo": "<agent_id>",
  "reasoning": "<1-2 sentence explanation>",
  "subtaskTitle": "<clear actionable title>",
  "taskType": "<one of the valid task types>",
  "priority": <integer 1-5, where 1 = highest>
}`

  const userMessage = `New task from Founder Neb:
Title: ${task.title}
Description: ${task.description}${projectContext}

Analyze and delegate to the most appropriate agent.`

  // Mark parent task in_progress before calling the LLM
  await updateTaskStatus(task.id, 'in_progress')

  let delegation: DelegationDecision | null = null

  try {
    const result = await runAgent(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      {
        agentId: 'ceo',
        taskId: task.id,
        taskType: 'routing',
        requiresComplex: true,
      }
    )

    log.debug({ raw: result.content.substring(0, 300) }, 'CEO raw response')

    delegation = parseDelegation(result.content)

    if (!delegation) {
      throw new Error(
        `CEO could not parse delegation from LLM response: ${result.content.substring(0, 200)}`
      )
    }

    // Create subtask assigned to the chosen agent (inherit project_id if set)
    const subtask = await createTask({
      title: delegation.subtaskTitle,
      description: task.description,
      type: delegation.taskType,
      priority: delegation.priority,
      parent_task_id: task.id,
      ...(projectId ? { project_id: projectId } : {}),
      delegator_agent_id: 'ceo',
      assignee_agent_id: delegation.delegateTo,
      requires_human_review: false,
      metadata: projectId ? { project_id: projectId, ...task.metadata } : task.metadata,
    })

    await recordEvent('task_assigned', {
      agentId: 'ceo',
      taskId: subtask.id,
      payload: {
        parent_task_id: task.id,
        delegated_to: delegation.delegateTo,
        reasoning: delegation.reasoning,
        model_used: result.modelId,
        cost_usd: result.costUsd,
      },
    })

    log.info(
      { subtaskId: subtask.id, delegateTo: delegation.delegateTo },
      'CEO Agent: task delegated'
    )

    // CEO job done: mark parent task as done (subtask carries the work forward)
    await updateTaskStatus(task.id, 'done')

    await notify(
      `🤖 *CEO Agent Decision*\n\n` +
        `📋 Task: ${task.title}\n` +
        `➡️ Delegated to: \`${delegation.delegateTo}\`\n` +
        `💭 ${delegation.reasoning}\n` +
        `🆔 Subtask: \`${subtask.id}\``
    )

    // Invoke downstream agents asynchronously (fire-and-forget)
    if (delegation.delegateTo === 'pm_saas') {
      void runPmSaasAgent(subtask, notify).catch((err: unknown) => {
        log.error({ err, subtaskId: subtask.id }, 'PM SaaS Agent failed')
      })
    } else if (delegation.delegateTo === 'dev_lead_saas') {
      void runDevLeadSaasAgent(subtask, notify).catch((err: unknown) => {
        log.error({ err, subtaskId: subtask.id }, 'Dev Lead SaaS Agent failed')
      })
    } else if (delegation.delegateTo === 'dev_saas_1' || delegation.delegateTo === 'dev_saas_2') {
      const workerAgentId = delegation.delegateTo
      void runDevSaasAgent(subtask, notify).catch((err: unknown) => {
        log.error({ err, subtaskId: subtask.id, assignee: workerAgentId }, 'Dev SaaS Agent failed')
      })
    } else if (delegation.delegateTo === 'consulting_lead') {
      void runConsultingLeadAgent(subtask, notify).catch((err: unknown) => {
        log.error({ err, subtaskId: subtask.id }, 'Consulting Lead Agent failed')
      })
    } else if (delegation.delegateTo === 'analyst') {
      void runAnalystAgent(subtask, notify).catch((err: unknown) => {
        log.error({ err, subtaskId: subtask.id }, 'Analyst Agent failed')
      })
    } else if (delegation.delegateTo === 'marketing_strategist') {
      void runMarketingStrategistAgent(subtask, notify).catch((err: unknown) => {
        log.error({ err, subtaskId: subtask.id }, 'Marketing Strategist Agent failed')
      })
    } else if (delegation.delegateTo === 'content_creator') {
      void runContentCreatorAgent(subtask, notify).catch((err: unknown) => {
        log.error({ err, subtaskId: subtask.id }, 'Content Creator Agent failed')
      })
    } else if (delegation.delegateTo === 'social_manager') {
      void runSocialManagerAgent(subtask, notify).catch((err: unknown) => {
        log.error({ err, subtaskId: subtask.id }, 'Social Manager Agent failed')
      })
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    log.error({ err, taskId: task.id }, 'CEO Agent error')

    await recordEvent('agent_error', {
      agentId: 'ceo',
      taskId: task.id,
      payload: { error: errorMessage },
      severity: 'error',
    })

    await notify(`❌ *CEO Agent Error*\n\nTask: ${task.title}\nError: ${errorMessage}`)

    throw err
  }
}
