// ============================================================
// WAI – AI Engineer Agent
// Implements AI/LLM features: prompt templates, RAG, embeddings,
// vector search, API integrations for Team Dev.
// Uses executeAgenticLoop to react to command output iteratively.
// ============================================================

import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

import {
  getChildTasks,
  getTaskById,
  transitionTaskStatus,
  updateTaskStatus,
} from '../services/supabase.js'
import { log, recordEvent } from '../services/logger.js'
import { appendProjectProgress } from '../services/workspace.js'
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
import type { Task } from '../types/index.js'

export async function runAiEngineerAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  log.info({ taskId: task.id, title: task.title }, 'AI Engineer Agent: starting')

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
  await notify(`🤖 AI Engineer starting AI/LLM implementation for **${projectName}**`)

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
      `Your role: AI/LLM integration specialist.`,
      `Your responsibilities:`,
      `- Implement LLM API integrations (OpenAI, Anthropic, or other providers)`,
      `- Build prompt templates and prompt engineering logic`,
      `- Set up vector databases and embedding pipelines if needed`,
      `- Implement RAG (Retrieval-Augmented Generation) patterns`,
      `- Add semantic search and similarity search capabilities`,
      `- Wire AI features to the application layer built by dev_general`,
      `- Write tests for AI components (mock LLM responses for unit tests)`,
      `- Ensure AI API keys are handled via env vars, never hardcoded`,
      workspaceContext ? `\n## Workspace Context\n${workspaceContext}` : '',
      repoContext ? `\n## Current Repo State\n${repoContext}` : '',
    ].filter(Boolean).join('\n')

    let executionMarkdown = ''

    if (repoLocalPath) {
      const repoExecution = await executeAgenticLoop({
        task,
        repoPath: repoLocalPath,
        agentId: task.assignee_agent_id ?? 'ai_engineer',
        agentRole: 'an expert AI/LLM Engineer. You implement AI integrations, RAG pipelines, prompt templates, embedding systems, and vector search. You write clean, testable code and always handle API keys through environment variables.',
        taskDescription,
        architecturePlan,
      })

      executionMarkdown = renderRepoExecutionMarkdown({
        title: `AI Engineer — ${projectName}`,
        agentId: task.assignee_agent_id ?? 'ai_engineer',
        task,
        projectName,
        clientName,
        execution: repoExecution,
      })

      if (workspaceAbsPath) {
        const deliverableDir = join(workspaceAbsPath, 'deliverables')
        await mkdir(deliverableDir, { recursive: true })
        await writeFile(join(deliverableDir, `ai-engineer-${task.id}.md`), executionMarkdown, 'utf-8')
      }

      if (repoExecution.blockers.length > 0) {
        await updateTaskStatus(task.id, 'blocked')
        await notify(`⚠️ AI Engineer blocked on **${projectName}**: ${repoExecution.blockers[0] ?? 'unknown'}`)
        await recordEvent('task_blocked', {
          agentId: task.assignee_agent_id ?? 'ai_engineer',
          taskId: task.id,
          payload: { blockers: repoExecution.blockers },
        })
        return
      }
    }

    const summary = executionMarkdown
      ? `AI/LLM integration complete for ${projectName}.`
      : `AI Engineer setup complete for ${projectName}.`

    await updateTaskStatus(task.id, 'done')
    await recordEvent('task_completed', {
      agentId: task.assignee_agent_id ?? 'ai_engineer',
      taskId: task.id,
      payload: { project: projectName, summary: summary.slice(0, 300) },
    })

    if (workspaceAbsPath) {
      await appendProjectProgress(workspaceAbsPath, 'AI Engineer integration complete', [`AI Engineer completed AI/LLM integration for ${projectName}.`])
    }

    await notify(`✅ AI Engineer completed AI/LLM integration for **${projectName}**`)

    // Activate sibling QA task if all dev workers are done
    if (task.parent_task_id) {
      const freshSiblings = await getChildTasks(task.parent_task_id)
      const allDevDone = freshSiblings
        .filter((s) => DEV_WORKERS.has(s.assignee_agent_id ?? '') && s.id !== task.id)
        .every((s) => s.status === 'done')

      if (allDevDone) {
        const qaTask = freshSiblings.find((s) => s.assignee_agent_id === 'qa')
        if (qaTask && qaTask.status === 'todo') {
          const claimed = await transitionTaskStatus(qaTask.id, 'todo', 'in_progress')
          if (claimed) {
            await recordEvent('qa_gate_activated', {
              agentId: 'ai_engineer',
              taskId: qaTask.id,
              payload: { triggered_by: task.id },
            })

            const freshQaTask = await getTaskById(qaTask.id)
            const taskToRun = freshQaTask ?? { ...qaTask, status: 'in_progress' as const }

            const { runQaAgent } = await import('./qa.js')
            void runQaAgent(taskToRun, notify).catch((err: unknown) => {
              log.error({ err, qaTaskId: qaTask.id }, 'AI Engineer: QA task failed')
            })
          }
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error({ taskId: task.id, error }, 'AI Engineer Agent: fatal error')
    await updateTaskStatus(task.id, 'blocked')
    await notify(`❌ AI Engineer error on **${projectName}**: ${message}`)
  }
}
