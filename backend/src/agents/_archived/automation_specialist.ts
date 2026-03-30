// ============================================================
// WAI – Automation Specialist Agent
// Builds workflow automations, Zapier/Make integrations,
// n8n flows, webhooks, and cross-system connectors.
// Uses executeAgenticLoop for iterative, reactive execution.
// ============================================================

import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

import { getChildTasks, updateTaskStatus } from '../services/supabase.js'
import { log, recordEvent } from '../services/logger.js'
import { appendProjectProgress } from '../services/workspace.js'
import {
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

export async function runAutomationSpecialistAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  log.info({ taskId: task.id, title: task.title }, 'Automation Specialist Agent: starting')

  const projectId = task.project_id ?? (task.metadata['project_id'] as string | undefined)
  const projectName = (task.metadata['project_name'] as string | undefined) ?? task.title
  const clientName = (task.metadata['client_name'] as string | undefined) ?? 'the client'
  const repoLocalPath = (task.metadata['repo_local_path'] as string | undefined) ?? undefined
  const workspaceAbsPath = await resolveSoftwareWorkspacePath(task, projectId)

  // Dependency checks — automation tasks may depend on dev or devops tasks
  const siblings = task.parent_task_id
    ? await getChildTasks(task.parent_task_id)
    : []

  const pendingDeps = getPendingDependencyIds(task, siblings)
  if (pendingDeps.length > 0) {
    await updateTaskStatus(task.id, 'blocked')
    return
  }

  const blockedDeps = getBlockedDependencyIds(task, siblings)
  if (blockedDeps.length > 0) {
    await updateTaskStatus(task.id, 'blocked')
    return
  }

  await updateTaskStatus(task.id, 'in_progress')
  await notify(`⚙️ Automation Specialist starting workflow implementation for **${projectName}**`)

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
      `Your role: workflow automation and integration specialist.`,
      `Your responsibilities:`,
      `- Design and implement workflow automations (n8n, Zapier, Make/Integromat patterns)`,
      `- Build webhook endpoints and event-driven integrations`,
      `- Connect third-party APIs and services (Slack, Notion, Airtable, HubSpot, etc.)`,
      `- Create data pipeline scripts and scheduled jobs`,
      `- Implement retry logic, error handling, and idempotency for automations`,
      `- Document automation flows clearly so they can be maintained`,
      `- Export automation configs as JSON/YAML where the platform supports it`,
      workspaceContext ? `\n## Workspace Context\n${workspaceContext}` : '',
      repoContext ? `\n## Current Repo State\n${repoContext}` : '',
    ].filter(Boolean).join('\n')

    let executionMarkdown = ''

    if (repoLocalPath) {
      const repoExecution = await executeAgenticLoop({
        task,
        repoPath: repoLocalPath,
        agentId: task.assignee_agent_id ?? 'automation_specialist',
        agentRole: 'an expert Automation Specialist. You design and implement workflow automations, webhook integrations, data pipelines, and cross-system connectors. You write reliable, idempotent automation code with proper error handling and retry logic.',
        taskDescription,
        architecturePlan,
      })

      executionMarkdown = renderRepoExecutionMarkdown({
        title: `Automation Specialist — ${projectName}`,
        agentId: task.assignee_agent_id ?? 'automation_specialist',
        task,
        projectName,
        clientName,
        execution: repoExecution,
      })

      if (workspaceAbsPath) {
        const deliverableDir = join(workspaceAbsPath, 'deliverables')
        await mkdir(deliverableDir, { recursive: true })
        await writeFile(
          join(deliverableDir, `automation-specialist-${task.id}.md`),
          executionMarkdown,
          'utf-8'
        )
      }

      if (repoExecution.blockers.length > 0) {
        await updateTaskStatus(task.id, 'blocked')
        await notify(`⚠️ Automation Specialist blocked on **${projectName}**: ${repoExecution.blockers[0] ?? 'unknown'}`)
        await recordEvent('task_blocked', {
          agentId: task.assignee_agent_id ?? 'automation_specialist',
          taskId: task.id,
          payload: { blockers: repoExecution.blockers },
        })
        return
      }
    }

    const summary = executionMarkdown
      ? `Automation workflows complete for ${projectName}.`
      : `Automation Specialist setup complete for ${projectName}.`

    await updateTaskStatus(task.id, 'done')
    await recordEvent('task_completed', {
      agentId: task.assignee_agent_id ?? 'automation_specialist',
      taskId: task.id,
      payload: { project: projectName, summary: summary.slice(0, 300) },
    })

    if (workspaceAbsPath) {
      await appendProjectProgress(
        workspaceAbsPath,
        'Automation Specialist complete',
        [`Automation Specialist completed workflow implementation for ${projectName}.`]
      )
    }

    await notify(`✅ Automation Specialist completed workflows for **${projectName}**`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error({ taskId: task.id, error }, 'Automation Specialist Agent: fatal error')
    await updateTaskStatus(task.id, 'blocked')
    await notify(`❌ Automation Specialist error on **${projectName}**: ${message}`)
  }
}
