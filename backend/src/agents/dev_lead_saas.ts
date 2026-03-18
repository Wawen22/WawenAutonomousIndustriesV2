// ============================================================
// WAI – Dev Lead SaaS Agent
// Riceve una user story dal PM SaaS, produce un piano tecnico
// strutturato, scrive sprint_plan.md nel workspace del progetto
// e crea task di implementazione per dev_saas_1 e dev_saas_2.
// ============================================================

import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

import { runAgent } from '../services/llm.js'
import {
  createTask,
  getProjectById,
  updateProjectStatus,
  updateTaskStatus,
} from '../services/supabase.js'
import { log, recordEvent } from '../services/logger.js'
import { getProjectWorkspacePath } from '../services/workspace.js'
import { runDevSaasAgent } from './dev_saas.js'
import { repoNeedsBootstrap } from './software_delivery_utils.js'
import type { Task } from '../types/index.js'

interface ImplementationTask {
  assignee: 'dev_saas_1' | 'dev_saas_2'
  title: string
  description: string
  acceptanceCriteria: string[]
}

interface SprintPlanOutput {
  title: string
  sprintGoal: string
  sprintOverview: string
  technicalApproach: string
  techStack: string[]
  sprintBreakdown: string[]
  risks: string[]
  implementationTasks: ImplementationTask[]
}

function parseRelativeWorkspacePath(relPath: string): string | null {
  const stripped = relPath.replace(/^workspace\//, '')
  const parts = stripped.split('/').filter(Boolean)
  if (parts.length < 2) return null
  return getProjectWorkspacePath(parts[0]!, parts[1]!)
}

async function resolveWorkspacePath(task: Task, projectId?: string): Promise<string | null> {
  const clientSlug = task.metadata['client_slug'] as string | undefined
  const projectSlug = task.metadata['project_slug'] as string | undefined

  if (clientSlug && projectSlug) {
    return getProjectWorkspacePath(clientSlug, projectSlug)
  }

  const relPath = task.metadata['workspace_path'] as string | undefined
  if (relPath) {
    return parseRelativeWorkspacePath(relPath)
  }

  if (projectId) {
    const project = await getProjectById(projectId)
    if (project?.workspace_path) {
      return parseRelativeWorkspacePath(project.workspace_path)
    }
  }

  return null
}

function parseSprintPlan(raw: string): SprintPlanOutput | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  } catch {
    return null
  }

  const {
    title,
    sprintGoal,
    sprintOverview,
    technicalApproach,
    techStack,
    sprintBreakdown,
    risks,
    implementationTasks,
  } = parsed

  if (
    typeof title !== 'string' ||
    typeof sprintGoal !== 'string' ||
    typeof sprintOverview !== 'string' ||
    typeof technicalApproach !== 'string' ||
    !Array.isArray(techStack) ||
    !Array.isArray(sprintBreakdown) ||
    !Array.isArray(risks) ||
    !Array.isArray(implementationTasks)
  ) {
    return null
  }

  const tasks: ImplementationTask[] = []
  for (const item of implementationTasks as unknown[]) {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as Record<string, unknown>)['assignee'] !== 'string' ||
      typeof (item as Record<string, unknown>)['title'] !== 'string' ||
      typeof (item as Record<string, unknown>)['description'] !== 'string' ||
      !Array.isArray((item as Record<string, unknown>)['acceptanceCriteria'])
    ) {
      continue
    }

    const task = item as Record<string, unknown>
    if (task['assignee'] !== 'dev_saas_1' && task['assignee'] !== 'dev_saas_2') {
      continue
    }

    tasks.push({
      assignee: task['assignee'] as 'dev_saas_1' | 'dev_saas_2',
      title: task['title'] as string,
      description: task['description'] as string,
      acceptanceCriteria: (task['acceptanceCriteria'] as string[]).filter(
        (criterion) => typeof criterion === 'string' && criterion.length > 0
      ),
    })
  }

  const assignees = new Set(tasks.map((task) => task.assignee))
  if (tasks.length !== 2 || assignees.size !== 2) {
    return null
  }

  return {
    title,
    sprintGoal,
    sprintOverview,
    technicalApproach,
    techStack: (techStack as unknown[]).filter((item): item is string => typeof item === 'string' && item.length > 0),
    sprintBreakdown: (sprintBreakdown as unknown[]).filter((item): item is string => typeof item === 'string' && item.length > 0),
    risks: (risks as unknown[]).filter((item): item is string => typeof item === 'string' && item.length > 0),
    implementationTasks: tasks,
  }
}

function sprintPlanToMarkdown(plan: SprintPlanOutput, task: Task, clientName: string, projectName: string): string {
  const today = new Date().toISOString().split('T')[0]!
  const lines: string[] = [
    `# ${plan.title}`,
    ``,
    `**Client:** ${clientName}`,
    `**Project:** ${projectName}`,
    `**Date:** ${today}`,
    `**Source Story:** ${task.title}`,
    `**Owner:** Dev Lead SaaS`,
    ``,
    `---`,
    ``,
    `## Sprint Goal`,
    ``,
    plan.sprintGoal,
    ``,
    `## Sprint Overview`,
    ``,
    plan.sprintOverview,
    ``,
    `## Technical Approach`,
    ``,
    plan.technicalApproach,
    ``,
    `## Recommended Tech Stack`,
    ``,
    ...plan.techStack.map((item) => `- ${item}`),
    ``,
    `## Sprint Breakdown`,
    ``,
    ...plan.sprintBreakdown.map((item, index) => `${index + 1}. ${item}`),
    ``,
    `## Implementation Tasks`,
    ``,
  ]

  for (const implementationTask of plan.implementationTasks) {
    lines.push(
      `### ${implementationTask.assignee} — ${implementationTask.title}`,
      ``,
      implementationTask.description,
      ``,
      `Acceptance Criteria:`,
      ...implementationTask.acceptanceCriteria.map((criterion) => `- ${criterion}`),
      ``
    )
  }

  if (plan.risks.length > 0) {
    lines.push(`## Risks`, ``, ...plan.risks.map((risk) => `- ⚠️ ${risk}`), ``)
  }

  return lines.join('\n')
}

export async function runDevLeadSaasAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  log.info({ taskId: task.id, title: task.title }, 'Dev Lead SaaS Agent: starting')

  const projectId = task.project_id ?? (task.metadata['project_id'] as string | undefined)
  const projectName = (task.metadata['project_name'] as string | undefined) ?? 'Internal SaaS'
  const clientName = (task.metadata['client_name'] as string | undefined) ?? 'WAI'
  const epic = (task.metadata['epic'] as string | undefined) ?? 'SaaS delivery'
  const storyPoints = task.metadata['story_points'] as number | undefined
  const repoLocalPath = task.metadata['repo_local_path'] as string | undefined
  const repoDefaultBranch = task.metadata['repo_default_branch'] as string | undefined
  const workspaceAbsPath = await resolveWorkspacePath(task, projectId)
  const bootstrapRepo = await repoNeedsBootstrap(repoLocalPath)

  const systemPrompt = `You are the Dev Lead SaaS Agent of WAI (Wawen Autonomous Industries).
Your role: read a user story from PM SaaS, create a structured technical sprint plan, and split execution into exactly two implementation tasks.

Respond with ONLY a JSON object — no markdown, no text outside JSON:
{
  "title": "<technical plan title>",
  "sprintGoal": "<one concise sprint goal>",
  "sprintOverview": "<short overview of delivery scope>",
  "technicalApproach": "<implementation approach, architecture and sequencing>",
  "techStack": ["<technology 1>", "<technology 2>", "..."],
  "sprintBreakdown": ["<step 1>", "<step 2>", "<step 3>"],
  "risks": ["<risk 1>", "<risk 2>"],
  "implementationTasks": [
    {
      "assignee": "dev_saas_1",
      "title": "<backend/core implementation task>",
      "description": "<specific implementation brief>",
      "acceptanceCriteria": ["<criterion 1>", "<criterion 2>"]
    },
    {
      "assignee": "dev_saas_2",
      "title": "<frontend/supporting implementation task>",
      "description": "<specific implementation brief>",
      "acceptanceCriteria": ["<criterion 1>", "<criterion 2>"]
    }
  ]
}

Constraints:
- Always return exactly 2 implementationTasks.
- One task must be assigned to dev_saas_1 and the other to dev_saas_2.
- Keep the plan implementation-oriented and grounded in the user story.
- If the repo is effectively empty, make dev_saas_1 own the bootstrap/foundation work and dev_saas_2 own work that can start only after that base exists.
- Prefer WAI stack defaults unless the task clearly requires something else.`

  const userMessage = [
    `Epic: ${epic}`,
    `Client: ${clientName}`,
    `Project: ${projectName}`,
    `User story title: ${task.title}`,
    `User story description: ${task.description}`,
    storyPoints ? `Story points: ${storyPoints}` : '',
    repoLocalPath ? `Repo local path: ${repoLocalPath}` : '',
    repoDefaultBranch ? `Repo default branch: ${repoDefaultBranch}` : '',
    bootstrapRepo ? `Repo state: bootstrap needed (empty or near-empty repo)` : '',
    ``,
    `Create a sprint plan with technical approach, stack recommendation, breakdown, and implementation tasks.`,
  ].filter(Boolean).join('\n')

  await updateTaskStatus(task.id, 'in_progress')

  try {
    const result = await runAgent(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      {
        agentId: 'dev_lead_saas',
        taskId: task.id,
        taskType: 'planning',
        requiresComplex: true,
      }
    )

    log.debug({ raw: result.content.substring(0, 300) }, 'Dev Lead SaaS raw response')

    const sprintPlan = parseSprintPlan(result.content)
    if (!sprintPlan) {
      throw new Error(
        `Dev Lead SaaS could not parse sprint plan from LLM response: ${result.content.substring(0, 200)}`
      )
    }

    let sprintPlanAbsPath: string | null = null
    if (projectId && workspaceAbsPath) {
      const deliverableDir = join(workspaceAbsPath, 'deliverables')
      await mkdir(deliverableDir, { recursive: true })
      sprintPlanAbsPath = join(deliverableDir, 'sprint_plan.md')
      await writeFile(
        sprintPlanAbsPath,
        sprintPlanToMarkdown(sprintPlan, task, clientName, projectName),
        'utf-8'
      )
      log.info({ sprintPlanAbsPath }, 'Dev Lead SaaS: sprint_plan.md written')
    }

    const createdImplementationTasks: Array<{ id: string; assignee: string; title: string }> = []
    const createdTaskIdsByAssignee = new Map<string, string>()
    const orderedImplementationTasks = [...sprintPlan.implementationTasks].sort((a, b) =>
      a.assignee.localeCompare(b.assignee)
    )

    for (const implementationTask of orderedImplementationTasks) {
      const dependencyTaskIds =
        bootstrapRepo && implementationTask.assignee === 'dev_saas_2'
          ? [createdTaskIdsByAssignee.get('dev_saas_1')].filter(
              (value): value is string => typeof value === 'string' && value.length > 0
            )
          : []
      const dependencyReason =
        dependencyTaskIds.length > 0
          ? 'Repo bootstrap required before supporting SaaS implementation can start.'
          : undefined

      const createdTask = await createTask({
        title: implementationTask.title.substring(0, 100),
        description: [
          `Parent story: ${task.title}`,
          `Project: ${projectName}`,
          ``,
          implementationTask.description,
          ``,
          `Technical Approach:`,
          sprintPlan.technicalApproach,
          ``,
          `Acceptance Criteria:`,
          ...implementationTask.acceptanceCriteria.map((criterion) => `- ${criterion}`),
          ``,
          `Tech Stack:`,
          ...sprintPlan.techStack.map((item) => `- ${item}`),
          sprintPlanAbsPath ? `` : '',
          sprintPlanAbsPath ? `Sprint Plan: ${sprintPlanAbsPath}` : '',
        ].filter((line) => line !== '').join('\n'),
        type: 'dev',
        priority: task.priority,
        parent_task_id: task.id,
        ...(projectId ? { project_id: projectId } : {}),
        delegator_agent_id: 'dev_lead_saas',
        assignee_agent_id: implementationTask.assignee,
        requires_human_review: false,
        metadata: {
          ...task.metadata,
          sprint_plan_path: sprintPlanAbsPath ?? undefined,
          technical_plan_title: sprintPlan.title,
          technical_approach: sprintPlan.technicalApproach,
          tech_stack: sprintPlan.techStack,
          implementation_owner: implementationTask.assignee,
          implementation_acceptance_criteria: implementationTask.acceptanceCriteria,
          ...(dependencyTaskIds.length > 0 ? { dependency_task_ids: dependencyTaskIds } : {}),
          ...(dependencyReason ? { dependency_reason: dependencyReason } : {}),
          orchestration_mode: dependencyTaskIds.length > 0 ? 'sequential' : 'parallel',
        },
      })

      createdTaskIdsByAssignee.set(implementationTask.assignee, createdTask.id)
      createdImplementationTasks.push({
        id: createdTask.id,
        assignee: implementationTask.assignee,
        title: implementationTask.title,
      })

      if (dependencyTaskIds.length === 0) {
        void runDevSaasAgent(createdTask, notify).catch((err: unknown) => {
          log.error({ err, subtaskId: createdTask.id, assignee: implementationTask.assignee }, 'Dev SaaS Agent failed')
        })
      }
    }

    if (projectId) {
      await updateProjectStatus(projectId, 'active')
    }

    await recordEvent('task_completed', {
      agentId: 'dev_lead_saas',
      taskId: task.id,
      payload: {
        sprint_plan_title: sprintPlan.title,
        sprint_plan_path: sprintPlanAbsPath,
        implementation_tasks_count: createdImplementationTasks.length,
        implementation_task_ids: createdImplementationTasks.map((item) => item.id),
        ...(projectId ? { project_status: 'active' } : {}),
        model_used: result.modelId,
        cost_usd: result.costUsd,
      },
    })

    await updateTaskStatus(task.id, 'done')

    const taskList = createdImplementationTasks
      .map((item) => {
        const isQueued = bootstrapRepo && item.assignee === 'dev_saas_2'
        return `• \`${item.assignee}\` → ${item.title}${isQueued ? ' *(queued after bootstrap)*' : ''}`
      })
      .join('\n')

    await notify(
      [
        `🛠 *Dev Lead SaaS — Sprint Plan Ready*`,
        ``,
        `📦 *${sprintPlan.title}*`,
        `👤 Client: ${clientName} | Project: ${projectName}`,
        `🎯 ${sprintPlan.sprintGoal}`,
        ``,
        `🚀 *Implementation tasks created:*`,
        taskList,
        sprintPlanAbsPath ? `\n💾 Saved: \`${sprintPlanAbsPath}\`` : '',
      ].filter((line) => line !== '').join('\n')
    )
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    log.error({ err, taskId: task.id }, 'Dev Lead SaaS Agent error')

    await recordEvent('agent_error', {
      agentId: 'dev_lead_saas',
      taskId: task.id,
      payload: { error: errorMessage },
      severity: 'error',
    })

    await updateTaskStatus(task.id, 'blocked').catch(() => {})

    await notify(`❌ *Dev Lead SaaS Error*\n\nTask: ${task.title}\nError: ${errorMessage}`)

    throw err
  }
}
