// ============================================================
// WAI – Dev General Agents
// Eseguono task custom software creati dall'Architect,
// producono deliverable tecnici e attivano il gate QA.
// ============================================================

import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'

import { runAgent } from '../services/llm.js'
import {
  getChildTasks,
  getProjectById,
  getTaskById,
  transitionTaskStatus,
  updateTaskStatus,
} from '../services/supabase.js'
import { log, recordEvent } from '../services/logger.js'
import { appendProjectProgress } from '../services/workspace.js'
import { runQaAgent } from './qa.js'
import {
  DEV_GENERAL_WORKERS,
  getBlockedDependencyIds,
  getPendingDependencyIds,
  loadRepoContext,
  readOptionalFile,
  resolveSoftwareWorkspacePath,
  sanitizeFilePart,
} from './software_delivery_utils.js'
import {
  executeRepoImplementation,
  executeWorkspaceFileCreation,
  renderRepoExecutionMarkdown,
} from './software_repo_runtime.js'
import { loadAllWorkspaceContext } from './software_delivery_utils.js'
import type { Task, TaskType } from '../types/index.js'

interface DevGeneralOutput {
  title: string
  summary: string
  implementationApproach: string
  filesToTouch: string[]
  implementationSteps: string[]
  acceptanceChecklist: string[]
  testingNotes: string[]
  handoffNotes: string[]
}

function normalizeStringArray(items: unknown): string[] {
  if (!Array.isArray(items)) return []
  return items.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function parseImplementation(raw: string): DevGeneralOutput | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  } catch {
    return null
  }

  if (
    typeof parsed['title'] !== 'string' ||
    typeof parsed['summary'] !== 'string' ||
    typeof parsed['implementationApproach'] !== 'string'
  ) {
    return null
  }

  return {
    title: parsed['title'],
    summary: parsed['summary'],
    implementationApproach: parsed['implementationApproach'],
    filesToTouch: normalizeStringArray(parsed['filesToTouch']),
    implementationSteps: normalizeStringArray(parsed['implementationSteps']),
    acceptanceChecklist: normalizeStringArray(parsed['acceptanceChecklist']),
    testingNotes: normalizeStringArray(parsed['testingNotes']),
    handoffNotes: normalizeStringArray(parsed['handoffNotes']),
  }
}

function taskTypeForAgent(agentId: string): TaskType {
  return agentId === 'dev_general_1' ? 'dev_complex' : 'dev_simple'
}

function implementationToMarkdown(
  output: DevGeneralOutput,
  task: Task,
  agentId: string,
  clientName: string,
  projectName: string,
  projectType: string
): string {
  const today = new Date().toISOString().split('T')[0]!
  const lines: string[] = [
    `# ${output.title}`,
    ``,
    `**Agent:** ${agentId}`,
    `**Client:** ${clientName}`,
    `**Project:** ${projectName}`,
    `**Project Type:** ${projectType}`,
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

async function appendExecutionResult(
  filePath: string,
  output: DevGeneralOutput,
  touchedFiles: string[],
  blockers: string[],
  warnings: string[],
  summary: string,
  commandsExecuted: number
): Promise<void> {
  let existing = ''
  try {
    existing = await readFile(filePath, 'utf-8')
  } catch {
    return
  }

  // Strip any previously appended execution result section
  const markerIndex = existing.indexOf('\n---\n\n## Execution Result')
  if (markerIndex !== -1) {
    existing = existing.slice(0, markerIndex)
  }

  const touchedSet = new Set(
    touchedFiles.map((f) => f.replace(/^.*[\\/]/, '').toLowerCase())
  )

  // Re-render checklist: mark [x] if a touched file matches the item text
  const updatedChecklist = output.acceptanceChecklist.map((item) => {
    const itemLower = item.toLowerCase()
    const done = touchedFiles.some((f) => {
      const base = f.replace(/^.*[\\/]/, '').toLowerCase()
      return itemLower.includes(base) || base.includes(itemLower.split(' ')[0]!)
    })
    return done ? `- [x] ${item}` : `- [ ] ${item}`
  })

  void touchedSet

  // Replace the old Acceptance Checklist section with updated one
  const checklistSection =
    `## Acceptance Checklist\n\n${updatedChecklist.join('\n')}\n`
  const updatedExisting = existing.replace(
    /## Acceptance Checklist\n\n(- \[[ x]\] .+\n)+/,
    checklistSection
  )

  const today = new Date().toISOString().split('T')[0]!
  const resultLines: string[] = [
    ``,
    `---`,
    ``,
    `## Execution Result`,
    ``,
    `**Date:** ${today}`,
    `**Status:** ${blockers.length > 0 ? '⚠️ BLOCKED' : '✅ COMPLETED'}`,
    `**Commands executed:** ${commandsExecuted}`,
    ``,
    `### Files Written`,
    ``,
    touchedFiles.length > 0
      ? touchedFiles.map((f) => `- \`${f}\``).join('\n')
      : '- *(no files written)*',
    ``,
  ]

  if (summary) {
    resultLines.push(`### Summary`, ``, summary, ``)
  }

  if (blockers.length > 0) {
    resultLines.push(
      `### Blockers`,
      ``,
      ...blockers.map((b) => `- ⛔ ${b}`),
      ``
    )
  }

  if (warnings.length > 0) {
    resultLines.push(
      `### Warnings`,
      ``,
      ...warnings.map((w) => `- ⚠️ ${w}`),
      ``
    )
  }

  await writeFile(filePath, updatedExisting + resultLines.join('\n'), 'utf-8')
}

async function processDevGeneralFollowUps(
  task: Task,
  notify: (message: string) => Promise<void>,
  workspaceAbsPath: string | null
): Promise<{
  qaActivated: boolean
  startedDependentTasks: Array<{ assignee: string; title: string }>
  blockedDependentTasks: Array<{ assignee: string; title: string }>
}> {
  const startedDependentTasks: Array<{ assignee: string; title: string }> = []
  const blockedDependentTasks: Array<{ assignee: string; title: string }> = []

  if (!task.parent_task_id) {
    return { qaActivated: false, startedDependentTasks, blockedDependentTasks }
  }

  let siblings = await getChildTasks(task.parent_task_id)

  for (const sibling of siblings) {
    if (sibling.id === task.id || sibling.status !== 'todo') continue
    if (!sibling.assignee_agent_id || !DEV_GENERAL_WORKERS.has(sibling.assignee_agent_id)) continue

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

    void runDevGeneralAgent(siblingToRun, notify).catch((err: unknown) => {
      log.error(
        { err, siblingTaskId: sibling.id, assignee: sibling.assignee_agent_id },
        'Dev General dependent task failed'
      )
    })
  }

  siblings = await getChildTasks(task.parent_task_id)
  const devTasks = siblings.filter((item) =>
    item.assignee_agent_id ? DEV_GENERAL_WORKERS.has(item.assignee_agent_id) : false
  )
  const allDevTasksTerminal =
    devTasks.length > 0 && devTasks.every((item) => item.status === 'done' || item.status === 'blocked')

  if (!allDevTasksTerminal) {
    return { qaActivated: false, startedDependentTasks, blockedDependentTasks }
  }

  const qaTask = siblings.find((item) => item.assignee_agent_id === 'qa')
  if (!qaTask) {
    return { qaActivated: false, startedDependentTasks, blockedDependentTasks }
  }

  // Try to claim the QA task from either 'todo' (normal path) or 'blocked'
  // (retry path — QA was previously blocked and needs to be re-activated).
  let claimed = await transitionTaskStatus(qaTask.id, 'todo', 'in_progress')
  if (!claimed && qaTask.status === 'blocked') {
    claimed = await transitionTaskStatus(qaTask.id, 'blocked', 'in_progress')
  }
  if (!claimed) {
    return { qaActivated: false, startedDependentTasks, blockedDependentTasks }
  }

  if (workspaceAbsPath) {
    await appendProjectProgress(workspaceAbsPath, 'Custom software implementation phase complete', [
      'All dev_general worker tasks reached a terminal state.',
      'QA gate activated.',
    ])
  }

  const freshQaTask = await getTaskById(qaTask.id)
  const qaTaskToRun = freshQaTask ?? { ...qaTask, status: 'in_progress' as const }

  void runQaAgent(qaTaskToRun, notify).catch((err: unknown) => {
    log.error({ err, qaTaskId: qaTask.id }, 'QA Agent failed')
  })

  return { qaActivated: true, startedDependentTasks, blockedDependentTasks }
}

export async function runDevGeneralAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  const agentId =
    task.assignee_agent_id === 'dev_general_1' || task.assignee_agent_id === 'dev_general_2'
      ? task.assignee_agent_id
      : 'dev_general_1'

  log.info({ taskId: task.id, agentId, title: task.title }, 'Dev General Agent: starting')

  const projectId = task.project_id ?? (task.metadata['project_id'] as string | undefined)
  const projectName = (task.metadata['project_name'] as string | undefined) ?? task.title
  const clientName = (task.metadata['client_name'] as string | undefined) ?? 'the client'
  const projectType = (task.metadata['project_type'] as string | undefined) ?? 'custom software'
  const architecturePlanPath = (task.metadata['architecture_plan_path'] as string | undefined) ?? undefined
  const technicalApproach = (task.metadata['technical_approach'] as string | undefined) ?? ''
  const solutionOverview = (task.metadata['solution_overview'] as string | undefined) ?? ''
  const implementationFocus = (task.metadata['implementation_focus'] as string | undefined) ?? ''
  const repoLocalPath = (task.metadata['repo_local_path'] as string | undefined) ?? undefined
  const repoUrl = (task.metadata['repo_url'] as string | undefined) ?? undefined
  const repoDefaultBranch = (task.metadata['repo_default_branch'] as string | undefined) ?? undefined
  const acceptanceCriteria = normalizeStringArray(task.metadata['implementation_acceptance_criteria'])
  const qualityGates = normalizeStringArray(task.metadata['quality_gates'])
  const workspaceAbsPath = await resolveSoftwareWorkspacePath(task, projectId)

  // Resolve clientId for scoped memory recall (best-effort, non-fatal)
  let clientId: string | undefined
  if (projectId) {
    try {
      const project = await getProjectById(projectId)
      clientId = project?.client_id
    } catch {
      // non-fatal
    }
  }

  const architecturePlanContent =
    architecturePlanPath ? await readOptionalFile(architecturePlanPath) : ''
  const repoContext = await loadRepoContext(repoLocalPath)

  if (task.parent_task_id) {
    const siblings = await getChildTasks(task.parent_task_id)
    const pendingDependencyIds = getPendingDependencyIds(task, siblings)
    if (pendingDependencyIds.length > 0) {
      log.info(
        { taskId: task.id, agentId, pendingDependencyIds },
        'Dev General Agent: waiting for dependencies'
      )
      return
    }
  }

  const systemPrompt = `You are ${agentId}, a custom software implementation agent inside WAI (Wawen Autonomous Industries).
Your role: take one architecture-defined implementation task and produce a concrete execution brief for software delivery.

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
- Be specific about implementation ownership, code areas, and validations.
- Use the architecture plan and repo context when present.
- When repo context is present, prefer exact repo-relative file paths in filesToTouch.
- Do not claim completed coding work; produce an execution-ready implementation deliverable.`

  const userMessage = [
    `Client: ${clientName}`,
    `Project: ${projectName}`,
    `Project type: ${projectType}`,
    `Worker: ${agentId}`,
    `Task title: ${task.title}`,
    `Task description: ${task.description}`,
    implementationFocus ? `Assigned focus: ${implementationFocus}` : '',
    solutionOverview ? `Solution overview: ${solutionOverview}` : '',
    technicalApproach ? `Architect technical approach: ${technicalApproach}` : '',
    acceptanceCriteria.length > 0 ? `Acceptance criteria: ${acceptanceCriteria.join(' | ')}` : '',
    qualityGates.length > 0 ? `QA gates: ${qualityGates.join(' | ')}` : '',
    repoLocalPath ? `Repo local path: ${repoLocalPath}` : '',
    repoDefaultBranch ? `Repo default branch: ${repoDefaultBranch}` : '',
    repoUrl ? `Repo URL: ${repoUrl}` : '',
    architecturePlanContent ? `\nArchitecture Plan:\n${architecturePlanContent.slice(0, 8000)}` : '',
    repoContext ? `\nRepository Context:\n${repoContext}` : '',
    ``,
    `Produce a concrete implementation brief with files, steps, testing notes, and handoff.`,
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
        requiresComplex: agentId === 'dev_general_1',
        ...(projectId ? { projectId } : {}),
        ...(clientId ? { clientId } : {}),
      }
    )

    const implementation = parseImplementation(result.content)
    if (!implementation) {
      throw new Error(
        `Dev General could not parse implementation brief from LLM response: ${result.content.substring(0, 200)}`
      )
    }

    let artifactPath: string | null = null
    let executionReportPath: string | null = null
    let repoExecutionSummary = ''
    let repoTouchedFiles: string[] = []
    let repoBlockingIssues: string[] = []
    let repoWarnings: string[] = []
    let repoCommandsExecuted = 0
    let wsOutputDir: string | null = null
    let filename = ''

    if (workspaceAbsPath) {
      const deliverableDir = join(workspaceAbsPath, 'deliverables')
      await mkdir(deliverableDir, { recursive: true })
      // Fixed filename — one file per agent, overwritten each run.
      // Git history in the project repo provides the version trail.
      filename = `${sanitizeFilePart(agentId)}.md`
      artifactPath = join(deliverableDir, filename)
      await writeFile(
        artifactPath,
        implementationToMarkdown(implementation, task, agentId, clientName, projectName, projectType),
        'utf-8'
      )
    }

    // Try repo-based execution first
    const repoExecution = repoLocalPath ? await executeRepoImplementation({
      agentId,
      task,
      taskType: taskTypeForAgent(agentId),
      projectName,
      clientName,
      projectType,
      taskDescription: task.description,
      implementationTitle: implementation.title,
      implementationSummary: implementation.summary,
      implementationApproach: implementation.implementationApproach,
      filesToTouch: implementation.filesToTouch,
      testingNotes: implementation.testingNotes,
      architecturePlanContent,
      additionalContext: [
        solutionOverview ? `Solution overview: ${solutionOverview}` : '',
        technicalApproach ? `Architect technical approach: ${technicalApproach}` : '',
        implementationFocus ? `Implementation focus: ${implementationFocus}` : '',
      ].filter(Boolean),
      repoLocalPath,
    }) : null

    // If no repo: write actual output files directly into the workspace output/ dir
    if (!repoExecution && workspaceAbsPath) {
      const wsContext = await loadAllWorkspaceContext(workspaceAbsPath).catch(() => '')
      const wsResult = await executeWorkspaceFileCreation({
        agentId,
        task,
        taskType: taskTypeForAgent(agentId),
        workspaceAbsPath,
        projectName,
        clientName,
        projectType,
        taskDescription: task.description,
        implementationTitle: implementation.title,
        implementationSummary: implementation.summary,
        implementationApproach: implementation.implementationApproach,
        filesToCreate: implementation.filesToTouch,
        architecturePlanContent,
        additionalContext: [
          solutionOverview ? `Solution overview: ${solutionOverview}` : '',
          technicalApproach ? `Architect technical approach: ${technicalApproach}` : '',
          implementationFocus ? `Implementation focus: ${implementationFocus}` : '',
        ].filter(Boolean),
        workspaceContext: wsContext,
      })

      wsOutputDir = wsResult.outputDir
      repoTouchedFiles = wsResult.touchedFiles
      repoBlockingIssues = wsResult.blockers
      repoWarnings = wsResult.warnings
      repoExecutionSummary = wsResult.summary

      await appendProjectProgress(workspaceAbsPath, `${agentId} created workspace output files`, [
        `Output dir: ${wsResult.outputDir}`,
        `Files written: ${wsResult.touchedFiles.join(', ') || 'none'}`,
        `Summary: ${wsResult.summary}`,
        `Blocking issues: ${String(wsResult.blockers.length)}`,
      ])
    }

    if (workspaceAbsPath) {
      await appendProjectProgress(workspaceAbsPath, `${agentId} prepared implementation deliverable`, [
        `Task: ${task.title}`,
        `Artifact: ${filename}`,
        `Summary: ${implementation.summary}`,
      ])

      if (repoExecution) {
        const deliverableDir = join(workspaceAbsPath, 'deliverables')
        const executionFilename = `repo-execution-${sanitizeFilePart(agentId)}.md`
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

    // Update the deliverable brief with actual execution results
    if (artifactPath) {
      await appendExecutionResult(
        artifactPath,
        implementation,
        repoTouchedFiles,
        repoBlockingIssues,
        repoWarnings,
        repoExecutionSummary,
        repoCommandsExecuted
      ).catch(() => { /* non-fatal */ })
    }

    await recordEvent('task_completed', {
      agentId,
      taskId: task.id,
      payload: {
        implementation_title: implementation.title,
        artifact_path: artifactPath,
        execution_report_path: executionReportPath,
        workspace_output_dir: wsOutputDir ?? undefined,
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

    const { qaActivated, startedDependentTasks, blockedDependentTasks } =
      await processDevGeneralFollowUps(task, notify, workspaceAbsPath)

    const lines = [
      `💻 *${agentId} — Implementation Deliverable Ready*`,
      ``,
      `📌 Task: ${task.title}`,
      `👤 Client: ${clientName} | Project: ${projectName}`,
      `📝 ${implementation.summary}`,
      repoExecution
        ? `🛠️ Repo: ${repoTouchedFiles.length > 0 ? `${repoTouchedFiles.length} file(s) changed` : 'no file changes'}`
        : wsOutputDir
          ? `📁 Output: ${repoTouchedFiles.length > 0 ? `${repoTouchedFiles.length} file(s) written → \`${wsOutputDir}\`` : 'no files written'}`
          : '',
      repoBlockingIssues.length > 0
        ? `⚠️ Blockers: ${repoBlockingIssues.join(', ')}`
        : '',
      startedDependentTasks.length > 0
        ? `⏭️ Unblocked: ${startedDependentTasks.map((item) => `${item.assignee} (${item.title})`).join(', ')}`
        : '',
      blockedDependentTasks.length > 0
        ? `⛔ Blocked dependents: ${blockedDependentTasks.map((item) => `${item.assignee} (${item.title})`).join(', ')}`
        : '',
      repoExecution
        ? `🧪 Checks: ${String(repoCommandsExecuted)} command(s) executed${repoBlockingIssues.length > 0 ? `, ${repoBlockingIssues.length} blocker(s)` : ''}`
        : '',
      artifactPath ? `\n💾 Brief: \`${artifactPath}\`` : '',
      executionReportPath ? `💾 Repo report: \`${executionReportPath}\`` : '',
      qaActivated ? `\n🧪 QA gate activated` : '',
    ].filter((line) => line !== '').join('\n')

    await notify(lines)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    log.error({ err, taskId: task.id, agentId }, 'Dev General Agent error')

    await recordEvent('agent_error', {
      agentId,
      taskId: task.id,
      payload: { error: errorMessage },
      severity: 'error',
    })

    await updateTaskStatus(task.id, 'blocked').catch(() => {})
    const { qaActivated, startedDependentTasks, blockedDependentTasks } =
      await processDevGeneralFollowUps(task, notify, workspaceAbsPath).catch(() => ({
        qaActivated: false,
        startedDependentTasks: [],
        blockedDependentTasks: [],
      }))

    const retryHint = `Riprova: \`/retry ${task.id}\``

    await notify(
      [
        `❌ *${agentId} Error*`,
        ``,
        `🆔 Task: \`${task.id.slice(0, 8)}\` — ${task.title}`,
        `🤖 Agent: ${agentId} | 📦 Project: ${clientName} / ${projectName}`,
        `💥 Error: ${errorMessage.slice(0, 400)}`,
        startedDependentTasks.length > 0
          ? `⏭️ Unblocked: ${startedDependentTasks.map((item) => `${item.assignee} (${item.title})`).join(', ')}`
          : '',
        blockedDependentTasks.length > 0
          ? `⛔ Blocked dependents: ${blockedDependentTasks.map((item) => `${item.assignee} (${item.title})`).join(', ')}`
          : '',
        qaActivated ? `🧪 QA gate activated` : '',
        ``,
        `💡 ${retryHint}`,
      ].filter((line) => line !== '').join('\n')
    )

    throw err
  }
}
