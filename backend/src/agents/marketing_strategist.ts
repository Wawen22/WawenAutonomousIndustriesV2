// ============================================================
// WAI – Marketing Strategist Agent
// Produce un piano marketing strutturato e delega execution
// a Content Creator e Social Manager.
// ============================================================

import { mkdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

import { runAgent } from '../services/llm.js'
import { createTask, updateProjectStatus, updateTaskStatus } from '../services/supabase.js'
import { log, recordEvent } from '../services/logger.js'
import { appendProjectProgress } from '../services/workspace.js'
import { resolveMarketingWorkspacePath } from './marketing_utils.js'
import { runContentWriterAgent } from './content_writer.js'
import type { Task } from '../types/index.js'

interface WorkerTaskPlan {
  title: string
  description: string
  outputs: string[]
}

interface MarketingPlanOutput {
  title: string
  executiveSummary: string
  objective: string
  targetAudience: string
  positioning: string
  keyMessages: string[]
  channels: string[]
  deliverables: string[]
  timeline: string
  successMetrics: string[]
  contentTask: WorkerTaskPlan
  socialTask: WorkerTaskPlan
}

function normalizeStringArray(items: unknown): string[] {
  if (!Array.isArray(items)) return []
  return items.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function parseWorkerTaskPlan(value: unknown): WorkerTaskPlan | null {
  if (typeof value !== 'object' || value === null) return null

  const task = value as Record<string, unknown>
  if (
    typeof task['title'] !== 'string' ||
    typeof task['description'] !== 'string'
  ) {
    return null
  }

  return {
    title: task['title'],
    description: task['description'],
    outputs: normalizeStringArray(task['outputs']),
  }
}

function parseMarketingPlan(raw: string): MarketingPlanOutput | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  } catch {
    return null
  }

  const contentTask = parseWorkerTaskPlan(parsed['contentTask'])
  const socialTask = parseWorkerTaskPlan(parsed['socialTask'])

  if (
    typeof parsed['title'] !== 'string' ||
    typeof parsed['executiveSummary'] !== 'string' ||
    typeof parsed['objective'] !== 'string' ||
    typeof parsed['targetAudience'] !== 'string' ||
    typeof parsed['positioning'] !== 'string' ||
    !contentTask ||
    !socialTask
  ) {
    return null
  }

  return {
    title: parsed['title'],
    executiveSummary: parsed['executiveSummary'],
    objective: parsed['objective'],
    targetAudience: parsed['targetAudience'],
    positioning: parsed['positioning'],
    keyMessages: normalizeStringArray(parsed['keyMessages']),
    channels: normalizeStringArray(parsed['channels']),
    deliverables: normalizeStringArray(parsed['deliverables']),
    timeline: typeof parsed['timeline'] === 'string' ? parsed['timeline'] : 'TBD',
    successMetrics: normalizeStringArray(parsed['successMetrics']),
    contentTask,
    socialTask,
  }
}

function marketingPlanToMarkdown(
  output: MarketingPlanOutput,
  task: Task,
  clientName: string,
  projectName: string
): string {
  const today = new Date().toISOString().split('T')[0]!
  const lines: string[] = [
    `# ${output.title}`,
    ``,
    `**Client:** ${clientName}`,
    `**Project:** ${projectName}`,
    `**Date:** ${today}`,
    `**Source Task:** ${task.title}`,
    `**Owner:** Marketing Strategist`,
    ``,
    `---`,
    ``,
    `## Executive Summary`,
    ``,
    output.executiveSummary,
    ``,
    `## Objective`,
    ``,
    output.objective,
    ``,
    `## Target Audience`,
    ``,
    output.targetAudience,
    ``,
    `## Positioning`,
    ``,
    output.positioning,
    ``,
    `## Key Messages`,
    ``,
    ...output.keyMessages.map((item) => `- ${item}`),
    ``,
    `## Recommended Channels`,
    ``,
    ...output.channels.map((item) => `- ${item}`),
    ``,
    `## Deliverables`,
    ``,
    ...output.deliverables.map((item) => `- ${item}`),
    ``,
    `## Timeline`,
    ``,
    output.timeline,
    ``,
  ]

  if (output.successMetrics.length > 0) {
    lines.push(`## Success Metrics`, ``, ...output.successMetrics.map((item) => `- ${item}`), ``)
  }

  lines.push(
    `## Execution Breakdown`,
    ``,
    `### Content Creator`,
    ``,
    output.contentTask.description,
    ``,
    ...output.contentTask.outputs.map((item) => `- ${item}`),
    ``,
    `### Social Manager`,
    ``,
    output.socialTask.description,
    ``,
    ...output.socialTask.outputs.map((item) => `- ${item}`),
    ``
  )

  return lines.join('\n')
}

export async function runMarketingStrategistAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  log.info({ taskId: task.id, title: task.title }, 'Marketing Strategist Agent: starting')

  const projectId = task.project_id ?? (task.metadata['project_id'] as string | undefined)
  const projectName = (task.metadata['project_name'] as string | undefined) ?? task.title
  const clientName = (task.metadata['client_name'] as string | undefined) ?? 'the client'
  const projectType = (task.metadata['project_type'] as string | undefined) ?? 'other'
  const workspaceAbsPath = await resolveMarketingWorkspacePath(task, projectId)

  let briefContent = ''
  if (workspaceAbsPath) {
    const briefPath = join(workspaceAbsPath, 'brief.md')
    if (existsSync(briefPath)) {
      try {
        briefContent = await readFile(briefPath, 'utf-8')
      } catch {
        log.warn({ briefPath }, 'Marketing Strategist: could not read brief.md')
      }
    }
  }

  const systemPrompt = `You are the Marketing Strategist Agent of WAI (Wawen Autonomous Industries).
Your role: take a marketing, content, growth, positioning, or campaign request and turn it into an execution-ready plan.

Respond with ONLY a JSON object — no markdown, no text outside JSON:
{
  "title": "<marketing plan title>",
  "executiveSummary": "<2-3 sentence summary>",
  "objective": "<primary business objective>",
  "targetAudience": "<audience definition>",
  "positioning": "<core positioning statement>",
  "keyMessages": ["<message 1>", "<message 2>"],
  "channels": ["<channel 1>", "<channel 2>"],
  "deliverables": ["<deliverable 1>", "<deliverable 2>"],
  "timeline": "<delivery timeline>",
  "successMetrics": ["<metric 1>", "<metric 2>"],
  "contentTask": {
    "title": "<task title for content creation>",
    "description": "<clear execution brief>",
    "outputs": ["<output 1>", "<output 2>"]
  },
  "socialTask": {
    "title": "<task title for social content>",
    "description": "<clear execution brief>",
    "outputs": ["<output 1>", "<output 2>"]
  }
}

Constraints:
- Always create both a contentTask and a socialTask.
- Keep the plan useful for real client work across marketing, content, copywriting, AI positioning, or service launches.
- Prefer specific outputs over vague advice.` 

  const userMessage = [
    `Client: ${clientName}`,
    `Project: ${projectName}`,
    `Project type: ${projectType}`,
    `Task title: ${task.title}`,
    `Task description: ${task.description}`,
    briefContent ? `\nProject Brief:\n${briefContent}` : '',
    ``,
    `Produce a strategy plan and execution breakdown for content and social delivery.`,
  ].filter(Boolean).join('\n')

  await updateTaskStatus(task.id, 'in_progress')

  try {
    const result = await runAgent(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      {
        agentId: 'marketing_strategist',
        taskId: task.id,
        taskType: 'strategy',
        requiresComplex: true,
      }
    )

    const marketingPlan = parseMarketingPlan(result.content)
    if (!marketingPlan) {
      throw new Error(
        `Marketing Strategist could not parse plan from LLM response: ${result.content.substring(0, 200)}`
      )
    }

    let planPath: string | null = null
    if (workspaceAbsPath) {
      const deliverableDir = join(workspaceAbsPath, 'deliverables')
      await mkdir(deliverableDir, { recursive: true })
      const filename = `marketing-plan.md`
      planPath = join(deliverableDir, filename)
      await writeFile(
        planPath,
        marketingPlanToMarkdown(marketingPlan, task, clientName, projectName),
        'utf-8'
      )

      await appendProjectProgress(workspaceAbsPath, 'Marketing strategy prepared', [
        `Task: ${task.title}`,
        `Artifact: ${filename}`,
        `Summary: ${marketingPlan.executiveSummary}`,
      ])
    }

    const createdTasks: Array<{ id: string; assignee: string; title: string }> = []
    const baseMetadata = {
      ...task.metadata,
      marketing_plan_title: marketingPlan.title,
      marketing_plan_path: planPath ?? undefined,
      target_audience: marketingPlan.targetAudience,
      positioning: marketingPlan.positioning,
      key_messages: marketingPlan.keyMessages,
      recommended_channels: marketingPlan.channels,
    }

    const contentTask = await createTask({
      title: marketingPlan.contentTask.title.substring(0, 100),
      description: marketingPlan.contentTask.description,
      type: 'content',
      priority: task.priority,
      parent_task_id: task.id,
      ...(projectId ? { project_id: projectId } : {}),
      delegator_agent_id: 'marketing_strategist',
      assignee_agent_id: 'content_writer',
      requires_human_review: false,
      metadata: {
        ...baseMetadata,
        requested_outputs: marketingPlan.contentTask.outputs,
      },
    })
    createdTasks.push({ id: contentTask.id, assignee: 'content_writer', title: contentTask.title })

    const socialTask = await createTask({
      title: marketingPlan.socialTask.title.substring(0, 100),
      description: marketingPlan.socialTask.description,
      type: 'marketing',
      priority: task.priority,
      parent_task_id: task.id,
      ...(projectId ? { project_id: projectId } : {}),
      delegator_agent_id: 'marketing_strategist',
      assignee_agent_id: 'content_writer',
      requires_human_review: false,
      metadata: {
        ...baseMetadata,
        requested_outputs: marketingPlan.socialTask.outputs,
      },
    })
    createdTasks.push({ id: socialTask.id, assignee: 'content_writer', title: socialTask.title })

    void runContentWriterAgent(contentTask, notify).catch((err: unknown) => {
      log.error({ err, subtaskId: contentTask.id }, 'Content Writer Agent (content) failed')
    })
    void runContentWriterAgent(socialTask, notify).catch((err: unknown) => {
      log.error({ err, subtaskId: socialTask.id }, 'Content Writer Agent (social) failed')
    })

    if (projectId) {
      await updateProjectStatus(projectId, 'active')
    }

    await recordEvent('task_completed', {
      agentId: 'marketing_strategist',
      taskId: task.id,
      payload: {
        marketing_plan_title: marketingPlan.title,
        marketing_plan_path: planPath,
        subtask_ids: createdTasks.map((item) => item.id),
        project_status: projectId ? 'active' : undefined,
        model_used: result.modelId,
        cost_usd: result.costUsd,
      },
    })

    await updateTaskStatus(task.id, 'done')

    const lines = [
      `📈 *Marketing Strategist — Plan Ready*`,
      ``,
      `🎯 *${marketingPlan.title}*`,
      `👤 Client: ${clientName} | Project: ${projectName}`,
      `📝 ${marketingPlan.executiveSummary}`,
      ``,
      `📦 Deliverables: ${marketingPlan.deliverables.slice(0, 3).join(' • ') || 'Defined in plan'}`,
      planPath ? `\n💾 Saved: \`${planPath}\`` : '',
      ``,
      ...createdTasks.map((item) => `• \`${item.assignee}\` → ${item.title}`),
    ].filter((line) => line !== '').join('\n')

    await notify(lines)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    log.error({ err, taskId: task.id }, 'Marketing Strategist Agent error')

    await recordEvent('agent_error', {
      agentId: 'marketing_strategist',
      taskId: task.id,
      payload: { error: errorMessage },
      severity: 'error',
    })

    await notify(`❌ *Marketing Strategist Error*\n\nTask: ${task.title}\nError: ${errorMessage}`)

    throw err
  }
}
