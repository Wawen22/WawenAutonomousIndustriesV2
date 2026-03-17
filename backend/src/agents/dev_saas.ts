// ============================================================
// WAI – Dev SaaS Agents
// Eseguono task implementativi creati dal Dev Lead SaaS,
// producono un deliverable tecnico e aggiornano il progress log.
// ============================================================

import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

import { runAgent } from '../services/llm.js'
import {
  getChildTasks,
  getProjectById,
  updateProjectStatus,
  updateTaskStatus,
} from '../services/supabase.js'
import { log, recordEvent } from '../services/logger.js'
import { appendProjectProgress, getProjectWorkspacePath } from '../services/workspace.js'
import type { Task, TaskType } from '../types/index.js'

interface DevImplementationOutput {
  title: string
  summary: string
  implementationApproach: string
  filesToTouch: string[]
  implementationSteps: string[]
  acceptanceChecklist: string[]
  testingNotes: string[]
  handoffNotes: string[]
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

function parseImplementation(raw: string): DevImplementationOutput | null {
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
    summary,
    implementationApproach,
    filesToTouch,
    implementationSteps,
    acceptanceChecklist,
    testingNotes,
    handoffNotes,
  } = parsed

  if (
    typeof title !== 'string' ||
    typeof summary !== 'string' ||
    typeof implementationApproach !== 'string' ||
    !Array.isArray(filesToTouch) ||
    !Array.isArray(implementationSteps) ||
    !Array.isArray(acceptanceChecklist) ||
    !Array.isArray(testingNotes) ||
    !Array.isArray(handoffNotes)
  ) {
    return null
  }

  const normalize = (items: unknown[]): string[] =>
    items.filter((item): item is string => typeof item === 'string' && item.length > 0)

  return {
    title,
    summary,
    implementationApproach,
    filesToTouch: normalize(filesToTouch as unknown[]),
    implementationSteps: normalize(implementationSteps as unknown[]),
    acceptanceChecklist: normalize(acceptanceChecklist as unknown[]),
    testingNotes: normalize(testingNotes as unknown[]),
    handoffNotes: normalize(handoffNotes as unknown[]),
  }
}

function taskTypeForAgent(agentId: string): TaskType {
  return agentId === 'dev_saas_1' ? 'dev_complex' : 'dev_simple'
}

function markdownForImplementation(
  output: DevImplementationOutput,
  task: Task,
  agentId: string,
  clientName: string,
  projectName: string
): string {
  const today = new Date().toISOString().split('T')[0]!
  const lines: string[] = [
    `# ${output.title}`,
    ``,
    `**Agent:** ${agentId}`,
    `**Client:** ${clientName}`,
    `**Project:** ${projectName}`,
    `**Date:** ${today}`,
    `**Source Task:** ${task.title}`,
    ``,
    `---`,
    ``,
    `## Summary`,
    ``,
    output.summary,
    ``,
    `## Implementation Approach`,
    ``,
    output.implementationApproach,
    ``,
    `## Files To Touch`,
    ``,
    ...output.filesToTouch.map((item) => `- ${item}`),
    ``,
    `## Implementation Steps`,
    ``,
    ...output.implementationSteps.map((item, index) => `${index + 1}. ${item}`),
    ``,
    `## Acceptance Checklist`,
    ``,
    ...output.acceptanceChecklist.map((item) => `- [ ] ${item}`),
    ``,
    `## Testing Notes`,
    ``,
    ...output.testingNotes.map((item) => `- ${item}`),
    ``,
    `## Handoff Notes`,
    ``,
    ...output.handoffNotes.map((item) => `- ${item}`),
    ``,
  ]

  return lines.join('\n')
}

function sanitizeFilePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export async function runDevSaasAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  const agentId =
    task.assignee_agent_id === 'dev_saas_1' || task.assignee_agent_id === 'dev_saas_2'
      ? task.assignee_agent_id
      : 'dev_saas_1'

  log.info({ taskId: task.id, agentId, title: task.title }, 'Dev SaaS Agent: starting')

  const projectId = task.project_id ?? (task.metadata['project_id'] as string | undefined)
  const projectName = (task.metadata['project_name'] as string | undefined) ?? 'Internal SaaS'
  const clientName = (task.metadata['client_name'] as string | undefined) ?? 'WAI'
  const epic = (task.metadata['epic'] as string | undefined) ?? 'SaaS delivery'
  const technicalApproach = (task.metadata['technical_approach'] as string | undefined) ?? ''
  const techStack = Array.isArray(task.metadata['tech_stack']) ? (task.metadata['tech_stack'] as string[]) : []
  const repoLocalPath = (task.metadata['repo_local_path'] as string | undefined) ?? undefined
  const repoUrl = (task.metadata['repo_url'] as string | undefined) ?? undefined
  const repoDefaultBranch = (task.metadata['repo_default_branch'] as string | undefined) ?? undefined
  const acceptanceCriteria = Array.isArray(task.metadata['implementation_acceptance_criteria'])
    ? (task.metadata['implementation_acceptance_criteria'] as string[])
    : []
  const workspaceAbsPath = await resolveWorkspacePath(task, projectId)

  const systemPrompt = `You are ${agentId}, a SaaS implementation agent inside WAI (Wawen Autonomous Industries).
Your role: take one implementation subtask from the Dev Lead and produce a concrete execution brief for coding, testing, and handoff.

Respond with ONLY a JSON object — no markdown, no text outside JSON:
{
  "title": "<implementation deliverable title>",
  "summary": "<short implementation summary>",
  "implementationApproach": "<technical approach tailored to this worker task>",
  "filesToTouch": ["<file or module 1>", "<file or module 2>"],
  "implementationSteps": ["<step 1>", "<step 2>", "<step 3>"],
  "acceptanceChecklist": ["<item 1>", "<item 2>"],
  "testingNotes": ["<test or validation note 1>", "<test or validation note 2>"],
  "handoffNotes": ["<handoff item 1>", "<handoff item 2>"]
}

Constraints:
- Be specific about code areas, validations, and handoff expectations.
- Assume the WAI stack is Node.js 22 + TypeScript strict + React/Vite/Tailwind unless the task context says otherwise.
- Do not invent completed work; produce a concrete implementation brief the team can execute immediately.`

  const userMessage = [
    `Epic: ${epic}`,
    `Client: ${clientName}`,
    `Project: ${projectName}`,
    `Worker: ${agentId}`,
    `Task title: ${task.title}`,
    `Task description: ${task.description}`,
    technicalApproach ? `Lead approach: ${technicalApproach}` : '',
    techStack.length > 0 ? `Lead tech stack: ${techStack.join(', ')}` : '',
    repoLocalPath ? `Repo local path: ${repoLocalPath}` : '',
    repoDefaultBranch ? `Repo default branch: ${repoDefaultBranch}` : '',
    repoUrl ? `Repo URL: ${repoUrl}` : '',
    acceptanceCriteria.length > 0 ? `Acceptance criteria: ${acceptanceCriteria.join(' | ')}` : '',
    ``,
    `Produce a concrete implementation brief with files to touch, steps, testing notes, and handoff.`,
  ].filter(Boolean).join('\n')

  await updateTaskStatus(task.id, 'in_progress')

  try {
    const result = await runAgent(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      {
        agentId,
        taskId: task.id,
        taskType: taskTypeForAgent(agentId),
        requiresComplex: agentId === 'dev_saas_1',
      }
    )

    const implementation = parseImplementation(result.content)
    if (!implementation) {
      throw new Error(
        `Dev SaaS could not parse implementation brief from LLM response: ${result.content.substring(0, 200)}`
      )
    }

    let artifactPath: string | null = null
    if (workspaceAbsPath) {
      const deliverableDir = join(workspaceAbsPath, 'deliverables')
      await mkdir(deliverableDir, { recursive: true })
      const filename = `${sanitizeFilePart(agentId)}-${sanitizeFilePart(task.title).slice(0, 48) || 'implementation'}-${task.id.slice(0, 8)}.md`
      artifactPath = join(deliverableDir, filename)
      await writeFile(
        artifactPath,
        markdownForImplementation(implementation, task, agentId, clientName, projectName),
        'utf-8'
      )

      await appendProjectProgress(workspaceAbsPath, `${agentId} completed implementation brief`, [
        `Task: ${task.title}`,
        `Artifact: ${filename}`,
        `Summary: ${implementation.summary}`,
      ])
    }

    await recordEvent('task_completed', {
      agentId,
      taskId: task.id,
      payload: {
        implementation_title: implementation.title,
        artifact_path: artifactPath,
        files_to_touch_count: implementation.filesToTouch.length,
        implementation_steps_count: implementation.implementationSteps.length,
        model_used: result.modelId,
        cost_usd: result.costUsd,
      },
    })

    await updateTaskStatus(task.id, 'done')

    let projectMovedToReview = false
    if (task.parent_task_id && projectId) {
      const siblings = await getChildTasks(task.parent_task_id)
      const allImplementationTasksDone = siblings
        .filter((item) => item.assignee_agent_id === 'dev_saas_1' || item.assignee_agent_id === 'dev_saas_2')
        .every((item) => item.status === 'done')

      if (allImplementationTasksDone) {
        await updateProjectStatus(projectId, 'review')
        projectMovedToReview = true

        if (workspaceAbsPath) {
          await appendProjectProgress(workspaceAbsPath, 'Implementation phase complete', [
            'All Dev SaaS worker tasks are done.',
            'Project moved to review status.',
          ])
        }
      }
    }

    const lines = [
      `💻 *${agentId} — Implementation Brief Ready*`,
      ``,
      `📌 Task: ${task.title}`,
      `👤 Client: ${clientName} | Project: ${projectName}`,
      `📝 ${implementation.summary}`,
      artifactPath ? `\n💾 Saved: \`${artifactPath}\`` : '',
      projectMovedToReview ? `\n🔎 Project status moved to *review*` : '',
    ].filter((line) => line !== '').join('\n')

    await notify(lines)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    log.error({ err, taskId: task.id, agentId }, 'Dev SaaS Agent error')

    await recordEvent('agent_error', {
      agentId,
      taskId: task.id,
      payload: { error: errorMessage },
      severity: 'error',
    })

    await notify(`❌ *${agentId} Error*\n\nTask: ${task.title}\nError: ${errorMessage}`)

    throw err
  }
}
