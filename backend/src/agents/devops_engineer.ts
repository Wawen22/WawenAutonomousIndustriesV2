// ============================================================
// WAI – DevOps Engineer Agent
// Esegue la fase di scaffold e infrastruttura per Team Dev:
// inizializza il repo, installa dipendenze, configura CI/CD.
// Usa executeAgenticLoop per reagire ai risultati in tempo reale.
// ============================================================

import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

import {
  getChildTasks,
  getTaskById,
  transitionTaskStatus,
  updateTaskStatus,
  upsertProjectChecklist,
} from '../services/supabase.js'
import { log, recordEvent } from '../services/logger.js'
import { appendProjectProgress, tickProgressChecklist } from '../services/workspace.js'
import {
  DEV_WORKERS,
  getBlockedDependencyIds,
  getPendingDependencyIds,
  loadAllWorkspaceContext,
  readOptionalFile,
  resolveSoftwareWorkspacePath,
} from './software_delivery_utils.js'
import {
  buildRepoContext,
  executeAgenticLoop,
  renderRepoExecutionMarkdown,
} from './software_repo_runtime.js'
import { runDevGeneralAgent } from './dev_general.js'
import { runAiEngineerAgent } from './ai_engineer.js'
import type { Task } from '../types/index.js'

export async function runDevOpsEngineerAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  log.info({ taskId: task.id, title: task.title }, 'DevOps Engineer Agent: starting')

  const projectId = task.project_id ?? (task.metadata['project_id'] as string | undefined)
  const projectName = (task.metadata['project_name'] as string | undefined) ?? task.title
  const clientName = (task.metadata['client_name'] as string | undefined) ?? 'the client'
  const repoLocalPath = (task.metadata['repo_local_path'] as string | undefined) ?? undefined
  const workspaceAbsPath = await resolveSoftwareWorkspacePath(task, projectId)

  const siblingTasks = task.parent_task_id
    ? await getChildTasks(task.parent_task_id)
    : []

  const pendingDeps = getPendingDependencyIds(task, siblingTasks)
  if (pendingDeps.length > 0) {
    await updateTaskStatus(task.id, 'blocked')
    return
  }

  const blockedDeps = getBlockedDependencyIds(task, siblingTasks)
  if (blockedDeps.length > 0) {
    await updateTaskStatus(task.id, 'blocked')
    return
  }

  await updateTaskStatus(task.id, 'in_progress')
  await notify(`🔧 DevOps Engineer starting scaffold for **${projectName}**`)

  try {
    const architecturePlan = workspaceAbsPath
      ? (await readOptionalFile(join(workspaceAbsPath, 'deliverables', 'architecture_plan.md'))) ?? ''
      : ''

    const workspaceContext = workspaceAbsPath
      ? await loadAllWorkspaceContext(workspaceAbsPath)
      : ''

    const repoContext = repoLocalPath ? await buildRepoContext(repoLocalPath) : ''

    const taskDescription = [
      `Task: ${task.title}`,
      task.description ? `Description: ${task.description}` : '',
      `Project: ${projectName} | Client: ${clientName}`,
      ``,
      `Your role: scaffold and infrastructure phase.`,
      `Your responsibilities:`,
      `- Initialize the project structure using npx create-*, npm init, or similar`,
      `- Write package.json, tsconfig.json, .gitignore, .env.example`,
      `- Run npm/pnpm install to confirm all dependencies resolve`,
      `- Set up Docker, CI/CD config if the architecture requires it`,
      `- Verify the project builds (run build or typecheck)`,
      `- Leave the repo in a clean, buildable state for the dev_general agent`,
      workspaceContext ? `\n## Workspace Context\n${workspaceContext}` : '',
      repoContext ? `\n## Current Repo State\n${repoContext}` : '',
    ].filter(Boolean).join('\n')

    let executionMarkdown = ''

    if (repoLocalPath) {
      const repoExecution = await executeAgenticLoop({
        task,
        repoPath: repoLocalPath,
        agentId: task.assignee_agent_id ?? 'devops_engineer',
        agentRole: 'an expert DevOps Engineer. You scaffold projects, set up infrastructure, configure CI/CD, and ensure the repo is buildable before application code is written.',
        taskDescription,
        architecturePlan,
      })

      executionMarkdown = renderRepoExecutionMarkdown({
        title: `DevOps Scaffold — ${projectName}`,
        agentId: task.assignee_agent_id ?? 'devops_engineer',
        task,
        projectName,
        clientName,
        execution: repoExecution,
      })

      if (workspaceAbsPath) {
        const deliverableDir = join(workspaceAbsPath, 'deliverables')
        await mkdir(deliverableDir, { recursive: true })
        await writeFile(join(deliverableDir, `devops-scaffold-${task.id}.md`), executionMarkdown, 'utf-8')
      }

      if (repoExecution.blockers.length > 0) {
        await updateTaskStatus(task.id, 'blocked')
        await notify(`⚠️ DevOps Engineer blocked on **${projectName}**: ${repoExecution.blockers[0] ?? 'unknown'}`)
        await recordEvent('task_blocked', {
          agentId: task.assignee_agent_id ?? 'devops_engineer',
          taskId: task.id,
          payload: { blockers: repoExecution.blockers },
        })
        return
      }
    }

    const summary = executionMarkdown ? `Scaffold complete for ${projectName}.` : `DevOps setup complete for ${projectName}.`
    await updateTaskStatus(task.id, 'done')
    await recordEvent('task_completed', {
      agentId: task.assignee_agent_id ?? 'devops_engineer',
      taskId: task.id,
      payload: { project: projectName, summary: summary.slice(0, 300) },
    })

    if (workspaceAbsPath) {
      await appendProjectProgress(workspaceAbsPath, 'DevOps scaffold complete', [`DevOps Engineer completed scaffold for ${projectName}.`])
      await tickProgressChecklist(workspaceAbsPath, 'Work in progress')
    }
    if (projectId) {
      await upsertProjectChecklist({ project_id: projectId, key: 'scaffold_done', label: 'Scaffold complete', status: 'done', agent_id: 'devops_engineer', category: 'technical', order_index: 3 }).catch(() => {})
    }

    await notify(`✅ DevOps Engineer scaffold complete for **${projectName}**`)

    // Activate sibling implementation tasks that were waiting for scaffold
    const freshSiblings = await getChildTasks(task.parent_task_id ?? '')
    const siblingsToActivate = freshSiblings.filter((s) =>
      s.status === 'todo' &&
      DEV_WORKERS.has(s.assignee_agent_id ?? '') &&
      s.id !== task.id
    )

    for (const sibling of siblingsToActivate) {
      const siblingTask = await getTaskById(sibling.id)
      if (!siblingTask || siblingTask.status !== 'todo') continue

      const pending = getPendingDependencyIds(siblingTask, freshSiblings)
      if (pending.length > 0) continue

      const claimed = await transitionTaskStatus(sibling.id, 'todo', 'in_progress')
      if (!claimed) continue

      await recordEvent('task_unblocked_by_devops', {
        agentId: 'devops_engineer',
        taskId: sibling.id,
        payload: { unblocked_by: task.id },
      })

      const freshSibling = await getTaskById(sibling.id)
      const taskToRun = freshSibling ?? { ...siblingTask, status: 'in_progress' as const }

      const runner = sibling.assignee_agent_id === 'ai_engineer' ? runAiEngineerAgent : runDevGeneralAgent
      void runner(taskToRun, notify).catch((err: unknown) => {
        log.error({ err, siblingTaskId: sibling.id, assignee: sibling.assignee_agent_id }, 'DevOps: sibling task failed')
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error({ taskId: task.id, error }, 'DevOps Engineer Agent: fatal error')
    await updateTaskStatus(task.id, 'blocked')
    await notify(`❌ DevOps Engineer error on **${projectName}**: ${message}`)
  }
}
