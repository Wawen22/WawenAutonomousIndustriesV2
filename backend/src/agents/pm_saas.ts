// ============================================================
// WAI – PM SaaS Agent
// Riceve un subtask dal CEO, produce user stories strutturate,
// crea sotto-subtask su Supabase, notifica Neb.
// ============================================================

import { runAgent } from '../services/llm.js'
import { createTask, updateTaskStatus } from '../services/supabase.js'
import { log, recordEvent } from '../services/logger.js'
import { runDevLeadSaasAgent } from './dev_lead_saas.js'
import type { Task, TaskPriority } from '../types/index.js'

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

interface UserStory {
  title: string
  description: string
  acceptanceCriteria: string[]
  priority: TaskPriority
  storyPoints: number
}

interface UserStoriesOutput {
  epic: string
  rationale: string
  userStories: UserStory[]
}

// ---------------------------------------------------------------------------
// Parse risposta LLM → UserStoriesOutput
// ---------------------------------------------------------------------------

function parseUserStories(raw: string): UserStoriesOutput | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  } catch {
    return null
  }

  const { epic, rationale, userStories } = parsed

  if (
    typeof epic !== 'string' ||
    typeof rationale !== 'string' ||
    !Array.isArray(userStories) ||
    userStories.length === 0
  ) {
    return null
  }

  const stories: UserStory[] = []
  for (const s of userStories as unknown[]) {
    if (
      typeof s !== 'object' ||
      s === null ||
      typeof (s as Record<string, unknown>)['title'] !== 'string' ||
      typeof (s as Record<string, unknown>)['description'] !== 'string' ||
      !Array.isArray((s as Record<string, unknown>)['acceptanceCriteria']) ||
      typeof (s as Record<string, unknown>)['priority'] !== 'number' ||
      typeof (s as Record<string, unknown>)['storyPoints'] !== 'number'
    ) {
      continue
    }
    const story = s as Record<string, unknown>
    stories.push({
      title: story['title'] as string,
      description: story['description'] as string,
      acceptanceCriteria: story['acceptanceCriteria'] as string[],
      priority: (Math.min(Math.max(Math.round(story['priority'] as number), 1), 5)) as TaskPriority,
      storyPoints: Math.max(1, Math.round(story['storyPoints'] as number)),
    })
  }

  if (stories.length === 0) return null

  return { epic, rationale, userStories: stories }
}

// ---------------------------------------------------------------------------
// runPmSaasAgent – entry point
//
// notify: callback per Telegram (stessa pattern di ceo.ts, no circular dep)
// ---------------------------------------------------------------------------

export async function runPmSaasAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  log.info({ taskId: task.id, title: task.title }, 'PM SaaS Agent: analyzing subtask')

  const systemPrompt = `You are the PM SaaS Agent of WAI (Wawen Autonomous Industries).
Your role: receive a feature/product task and produce structured user stories for the development team.

For each user story, follow the format: "As a [user], I want [goal] so that [benefit]".

Respond with ONLY a JSON object — no markdown, no text outside JSON:
{
  "epic": "<brief epic title grouping all stories>",
  "rationale": "<1-2 sentence explanation of product value>",
  "userStories": [
    {
      "title": "<As a [user], I want [goal] so that [benefit]>",
      "description": "<detailed description of the story>",
      "acceptanceCriteria": ["<criterion 1>", "<criterion 2>", ...],
      "priority": <integer 1-5, where 1 = highest>,
      "storyPoints": <integer 1-13 Fibonacci: 1,2,3,5,8,13>
    }
  ]
}`

  const userMessage = `Feature task from CEO:
Title: ${task.title}
Description: ${task.description}

Break this down into 3-6 user stories with clear acceptance criteria.`

  await updateTaskStatus(task.id, 'in_progress')

  let output: UserStoriesOutput | null = null

  try {
    const result = await runAgent(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      {
        agentId: 'pm_saas',
        taskId: task.id,
        taskType: 'planning',
        requiresComplex: true,
      }
    )

    log.debug({ raw: result.content.substring(0, 300) }, 'PM SaaS raw response')

    output = parseUserStories(result.content)

    if (!output) {
      throw new Error(
        `PM SaaS could not parse user stories from LLM response: ${result.content.substring(0, 200)}`
      )
    }

    // Create one sub-subtask per user story
    const createdStories: Array<{ id: string; title: string }> = []

    for (const story of output.userStories) {
      const subTask = await createTask({
        title: story.title.substring(0, 100),
        description: [
          story.description,
          '',
          'Acceptance Criteria:',
          ...story.acceptanceCriteria.map((c) => `- ${c}`),
          '',
          `Story Points: ${story.storyPoints}`,
        ].join('\n'),
        type: 'planning',
        priority: story.priority,
        parent_task_id: task.id,
        ...(task.project_id ? { project_id: task.project_id } : {}),
        delegator_agent_id: 'pm_saas',
        assignee_agent_id: 'dev_lead_saas',
        requires_human_review: false,
        metadata: {
          ...task.metadata,
          story_points: story.storyPoints,
          epic: output.epic,
          story_description: story.description,
          acceptance_criteria: story.acceptanceCriteria,
        },
      })
      createdStories.push({ id: subTask.id, title: story.title })

      void runDevLeadSaasAgent(subTask, notify).catch((err: unknown) => {
        log.error({ err, subtaskId: subTask.id }, 'Dev Lead SaaS Agent failed')
      })
    }

    await recordEvent('task_completed', {
      agentId: 'pm_saas',
      taskId: task.id,
      payload: {
        epic: output.epic,
        stories_count: output.userStories.length,
        model_used: result.modelId,
        cost_usd: result.costUsd,
        subtask_ids: createdStories.map((s) => s.id),
      },
    })

    await updateTaskStatus(task.id, 'done')

    log.info(
      { taskId: task.id, storiesCount: output.userStories.length },
      'PM SaaS Agent: user stories created'
    )

    const storiesList = createdStories
      .map((s, i) => `${i + 1}. ${s.title}`)
      .join('\n')

    await notify(
      `📋 *PM SaaS Agent — User Stories Ready*\n\n` +
        `🎯 Epic: ${output.epic}\n` +
        `💡 ${output.rationale}\n\n` +
        `📝 *${output.userStories.length} user stories created:*\n${storiesList}`
    )
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    log.error({ err, taskId: task.id }, 'PM SaaS Agent error')

    await recordEvent('agent_error', {
      agentId: 'pm_saas',
      taskId: task.id,
      payload: { error: errorMessage },
      severity: 'error',
    })

    await notify(`❌ *PM SaaS Agent Error*\n\nTask: ${task.title}\nError: ${errorMessage}`)

    throw err
  }
}
