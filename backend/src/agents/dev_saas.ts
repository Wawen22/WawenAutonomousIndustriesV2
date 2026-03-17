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
  getTaskById,
  transitionTaskStatus,
  updateProjectStatus,
  updateTaskStatus,
} from '../services/supabase.js'
import { log, recordEvent } from '../services/logger.js'
import { appendProjectProgress, getProjectWorkspacePath } from '../services/workspace.js'
import {
  DEV_SAAS_WORKERS,
  getBlockedDependencyIds,
  getPendingDependencyIds,
} from './software_delivery_utils.js'
import {
  buildRepoContext,
  executeRepoImplementation,
  renderRepoExecutionMarkdown,
} from './software_repo_runtime.js'
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

async function processDevSaasFollowUps(
  task: Task,
  notify: (message: string) => Promise<void>,
  workspaceAbsPath: string | null,
  projectId?: string
): Promise<{
  projectMovedToReview: boolean
  projectMovedToBlocked: boolean
  startedDependentTasks: Array<{ assignee: string; title: string }>
  blockedDependentTasks: Array<{ assignee: string; title: string }>
}> {
  const startedDependentTasks: Array<{ assignee: string; title: string }> = []
  const blockedDependentTasks: Array<{ assignee: string; title: string }> = []

  if (!task.parent_task_id) {
    return {
      projectMovedToReview: false,
      projectMovedToBlocked: false,
      startedDependentTasks,
      blockedDependentTasks,
    }
  }

  let siblings = await getChildTasks(task.parent_task_id)

  for (const sibling of siblings) {
    if (sibling.id === task.id || sibling.status !== 'todo') continue
    if (!sibling.assignee_agent_id || !DEV_SAAS_WORKERS.has(sibling.assignee_agent_id)) continue

    const blockedDependencyIds = getBlockedDependencyIds(sibling, siblings)
    if (blockedDependencyIds.length > 0) {
      const blocked = await transitionTaskStatus(sibling.id, 'todo', 'blocked')
      if (!blocked) continue

      blockedDependentTasks.push({
        assignee: sibling.assignee_agent_id,
        title: sibling.title,
      })

      await recordEvent('task_blocked', {
        agentId: sibling.assignee_agent_id,
        taskId: sibling.id,
        payload: {
          reason: 'Dependency blocked',
          dependency_task_ids: blockedDependencyIds,
        },
        severity: 'warning',
      })

      continue
    }

    const pendingDependencyIds = getPendingDependencyIds(sibling, siblings)
    if (pendingDependencyIds.length > 0) continue

    const claimed = await transitionTaskStatus(sibling.id, 'todo', 'in_progress')
    if (!claimed) continue

    const freshSibling = await getTaskById(sibling.id)
    const siblingToRun = freshSibling ?? { ...sibling, status: 'in_progress' as const }
    startedDependentTasks.push({
      assignee: sibling.assignee_agent_id,
      title: sibling.title,
    })

    void runDevSaasAgent(siblingToRun, notify).catch((err: unknown) => {
      log.error(
        { err, siblingTaskId: sibling.id, assignee: sibling.assignee_agent_id },
        'Dev SaaS dependent task failed'
      )
    })
  }

  siblings = await getChildTasks(task.parent_task_id)
  const implementationTasks = siblings.filter((item) =>
    item.assignee_agent_id ? DEV_SAAS_WORKERS.has(item.assignee_agent_id) : false
  )

  if (
    implementationTasks.length === 0 ||
    !implementationTasks.every((item) => item.status === 'done' || item.status === 'blocked')
  ) {
    return {
      projectMovedToReview: false,
      projectMovedToBlocked: false,
      startedDependentTasks,
      blockedDependentTasks,
    }
  }

  const hasBlockedImplementation = implementationTasks.some((item) => item.status === 'blocked')
  if (!projectId) {
    return {
      projectMovedToReview: false,
      projectMovedToBlocked: false,
      startedDependentTasks,
      blockedDependentTasks,
    }
  }

  if (hasBlockedImplementation) {
    await updateProjectStatus(projectId, 'blocked')

    if (workspaceAbsPath) {
      await appendProjectProgress(workspaceAbsPath, 'Implementation phase blocked', [
        'At least one Dev SaaS worker task is blocked.',
        'Project moved to blocked status.',
      ])
    }

    return {
      projectMovedToReview: false,
      projectMovedToBlocked: true,
      startedDependentTasks,
      blockedDependentTasks,
    }
  }

  await updateProjectStatus(projectId, 'review')

  if (workspaceAbsPath) {
    await appendProjectProgress(workspaceAbsPath, 'Implementation phase complete', [
      'All Dev SaaS worker tasks are done.',
      'Project moved to review status.',
    ])
  }

  return {
    projectMovedToReview: true,
    projectMovedToBlocked: false,
    startedDependentTasks,
    blockedDependentTasks,
  }
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
  const clientSlug = (task.metadata['client_slug'] as string | undefined) ?? ''
  const projectSlug = (task.metadata['project_slug'] as string | undefined) ?? ''
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
  const repoContext = await buildRepoContext(repoLocalPath)

  if (task.parent_task_id) {
    const siblings = await getChildTasks(task.parent_task_id)
    const pendingDependencyIds = getPendingDependencyIds(task, siblings)
    if (pendingDependencyIds.length > 0) {
      log.info(
        { taskId: task.id, agentId, pendingDependencyIds },
        'Dev SaaS Agent: waiting for dependencies'
      )
      return
    }
  }

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
- When repo context is present, prefer exact repo-relative file paths in filesToTouch.
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
    repoContext ? `\nRepository Context:\n${repoContext}` : '',
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
    let executionReportPath: string | null = null
    let repoExecutionSummary = ''
    let repoTouchedFiles: string[] = []
    let repoBlockingIssues: string[] = []
    let repoWarnings: string[] = []
    let repoCommandsExecuted = 0
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
    }

    const repoExecution = await executeRepoImplementation({
      agentId,
      task,
      taskType: taskTypeForAgent(agentId),
      projectName,
      clientName,
      projectType: 'saas',
      taskDescription: task.description,
      implementationTitle: implementation.title,
      implementationSummary: implementation.summary,
      implementationApproach: implementation.implementationApproach,
      filesToTouch: implementation.filesToTouch,
      testingNotes: implementation.testingNotes,
      additionalContext: [
        epic ? `Epic: ${epic}` : '',
        technicalApproach ? `Technical approach: ${technicalApproach}` : '',
        techStack.length > 0 ? `Tech stack: ${techStack.join(', ')}` : '',
        acceptanceCriteria.length > 0 ? `Acceptance criteria: ${acceptanceCriteria.join(' | ')}` : '',
      ].filter(Boolean),
      ...(repoLocalPath ? { repoLocalPath } : {}),
    })

    if (workspaceAbsPath) {
      await appendProjectProgress(workspaceAbsPath, `${agentId} completed implementation brief`, [
        `Task: ${task.title}`,
        `Artifact: ${artifactPath ? artifactPath.split('/').at(-1) ?? 'implementation artifact' : 'implementation artifact'}`,
        `Summary: ${implementation.summary}`,
      ])

      if (repoExecution) {
        const deliverableDir = join(workspaceAbsPath, 'deliverables')
        const executionFilename = `repo-execution-${sanitizeFilePart(agentId)}-${task.id.slice(0, 8)}.md`
        executionReportPath = join(deliverableDir, executionFilename)
        await writeFile(
          executionReportPath,
          renderRepoExecutionMarkdown({
            title: `Repo Execution — ${implementation.title}`,
            agentId,
            task,
            projectName,
            clientName,
            execution: repoExecution,
          }),
          'utf-8'
        )

        repoExecutionSummary = repoExecution.summary
        repoTouchedFiles = repoExecution.touchedFiles
        repoBlockingIssues = repoExecution.blockers
        repoWarnings = repoExecution.warnings
        repoCommandsExecuted = repoExecution.commands.length

        await appendProjectProgress(workspaceAbsPath, `${agentId} executed repo-aware implementation`, [
          `Execution report: ${executionFilename}`,
          `Touched files: ${repoTouchedFiles.length > 0 ? repoTouchedFiles.join(', ') : 'none'}`,
          `Commands executed: ${String(repoCommandsExecuted)}`,
          `Blocking issues: ${String(repoBlockingIssues.length)}`,
        ])
      }
    }

    await recordEvent('task_completed', {
      agentId,
      taskId: task.id,
      payload: {
        implementation_title: implementation.title,
        artifact_path: artifactPath,
        execution_report_path: executionReportPath,
        files_to_touch_count: implementation.filesToTouch.length,
        repo_touched_files: repoTouchedFiles,
        repo_commands_executed: repoCommandsExecuted,
        repo_blocking_issues: repoBlockingIssues,
        repo_warnings: repoWarnings,
        repo_execution_summary: repoExecutionSummary || undefined,
        implementation_steps_count: implementation.implementationSteps.length,
        model_used: result.modelId,
        cost_usd: result.costUsd,
      },
    })

    await updateTaskStatus(task.id, 'done')

    const {
      projectMovedToReview,
      projectMovedToBlocked,
      startedDependentTasks,
      blockedDependentTasks,
    } = await processDevSaasFollowUps(task, notify, workspaceAbsPath, projectId)

    const lines = [
      `💻 *${agentId} — Implementation Brief Ready*`,
      ``,
      `📌 Task: ${task.title}`,
      `👤 Client: ${clientName} | Project: ${projectName}`,
      `📝 ${implementation.summary}`,
      startedDependentTasks.length > 0
        ? `⏭️ Unblocked: ${startedDependentTasks.map((item) => `${item.assignee} (${item.title})`).join(', ')}`
        : '',
      blockedDependentTasks.length > 0
        ? `⛔ Blocked dependents: ${blockedDependentTasks.map((item) => `${item.assignee} (${item.title})`).join(', ')}`
        : '',
      repoExecution
        ? `🛠️ Repo: ${repoTouchedFiles.length > 0 ? `${repoTouchedFiles.length} file(s) changed` : 'no file changes'}`
        : '',
      repoExecution
        ? `🧪 Checks: ${String(repoCommandsExecuted)} command(s) executed${repoBlockingIssues.length > 0 ? `, ${repoBlockingIssues.length} blocker(s)` : ''}`
        : '',
      artifactPath ? `\n💾 Saved: \`${artifactPath}\`` : '',
      executionReportPath ? `💾 Repo report: \`${executionReportPath}\`` : '',
      projectMovedToReview ? `\n🔎 Project status moved to *review*` : '',
      projectMovedToReview && clientSlug && projectSlug
        ? `💰 Pronto per la fattura: /invoice ${clientSlug}/${projectSlug}`
        : '',
      projectMovedToBlocked ? `\n⛔ Project status moved to *blocked*` : '',
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

    await updateTaskStatus(task.id, 'blocked').catch(() => {})
    const {
      projectMovedToReview,
      projectMovedToBlocked,
      startedDependentTasks,
      blockedDependentTasks,
    } = await processDevSaasFollowUps(task, notify, workspaceAbsPath, projectId).catch(() => ({
      projectMovedToReview: false,
      projectMovedToBlocked: false,
      startedDependentTasks: [],
      blockedDependentTasks: [],
    }))

    await notify(
      [
        `❌ *${agentId} Error*`,
        ``,
        `Task: ${task.title}`,
        `Error: ${errorMessage}`,
        startedDependentTasks.length > 0
          ? `⏭️ Unblocked: ${startedDependentTasks.map((item) => `${item.assignee} (${item.title})`).join(', ')}`
          : '',
        blockedDependentTasks.length > 0
          ? `⛔ Blocked dependents: ${blockedDependentTasks.map((item) => `${item.assignee} (${item.title})`).join(', ')}`
          : '',
        projectMovedToReview ? `🔎 Project status moved to review` : '',
        projectMovedToBlocked ? `⛔ Project status moved to blocked` : '',
      ].filter((line) => line !== '').join('\n')
    )

    throw err
  }
}
