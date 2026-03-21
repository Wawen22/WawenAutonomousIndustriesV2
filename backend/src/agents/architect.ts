// ============================================================
// WAI – Architect Agent
// Converte richieste software custom in un piano architetturale
// e prepara l'esecuzione per dev_general_* + QA.
// ============================================================

import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

import { runAgent } from '../services/llm.js'
import { createTask, updateProjectRepo, updateProjectStatus, updateTaskStatus } from '../services/supabase.js'
import { log, recordEvent } from '../services/logger.js'
import { appendProjectProgress } from '../services/workspace.js'
import { runDevGeneralAgent } from './dev_general.js'
import {
  loadAllWorkspaceContext,
  loadRepoContext,
  readOptionalFile,
  repoNeedsBootstrap,
  resolveSoftwareWorkspacePath,
} from './software_delivery_utils.js'
import { initWorkspaceRepo } from './software_repo_runtime.js'
import type { Task } from '../types/index.js'

interface ArchitectureImplementationTask {
  assignee: 'dev_general_1' | 'dev_general_2'
  title: string
  focus: string
  description: string
  acceptanceCriteria: string[]
}

interface ArchitecturePlanOutput {
  title: string
  executiveSummary: string
  solutionOverview: string
  technicalApproach: string
  techStack: string[]
  systemComponents: string[]
  implementationPhases: string[]
  qualityGates: string[]
  risks: string[]
  implementationTasks: ArchitectureImplementationTask[]
}

function normalizeStringArray(items: unknown): string[] {
  if (!Array.isArray(items)) return []
  return items.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function parseImplementationTask(value: unknown): ArchitectureImplementationTask | null {
  if (typeof value !== 'object' || value === null) return null

  const task = value as Record<string, unknown>
  if (
    (task['assignee'] !== 'dev_general_1' && task['assignee'] !== 'dev_general_2') ||
    typeof task['title'] !== 'string' ||
    typeof task['focus'] !== 'string' ||
    typeof task['description'] !== 'string'
  ) {
    return null
  }

  return {
    assignee: task['assignee'],
    title: task['title'],
    focus: task['focus'],
    description: task['description'],
    acceptanceCriteria: normalizeStringArray(task['acceptanceCriteria']),
  }
}

function parseArchitecturePlan(raw: string): ArchitecturePlanOutput | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  } catch {
    return null
  }

  const implementationTasks = Array.isArray(parsed['implementationTasks'])
    ? parsed['implementationTasks']
        .map((item) => parseImplementationTask(item))
        .filter((item): item is ArchitectureImplementationTask => item !== null)
    : []

  const assignees = new Set(implementationTasks.map((task) => task.assignee))
  if (
    typeof parsed['title'] !== 'string' ||
    typeof parsed['executiveSummary'] !== 'string' ||
    typeof parsed['solutionOverview'] !== 'string' ||
    typeof parsed['technicalApproach'] !== 'string' ||
    implementationTasks.length !== 2 ||
    assignees.size !== 2
  ) {
    return null
  }

  return {
    title: parsed['title'],
    executiveSummary: parsed['executiveSummary'],
    solutionOverview: parsed['solutionOverview'],
    technicalApproach: parsed['technicalApproach'],
    techStack: normalizeStringArray(parsed['techStack']),
    systemComponents: normalizeStringArray(parsed['systemComponents']),
    implementationPhases: normalizeStringArray(parsed['implementationPhases']),
    qualityGates: normalizeStringArray(parsed['qualityGates']),
    risks: normalizeStringArray(parsed['risks']),
    implementationTasks,
  }
}

function architecturePlanToMarkdown(
  output: ArchitecturePlanOutput,
  task: Task,
  clientName: string,
  projectName: string,
  projectType: string
): string {
  const today = new Date().toISOString().split('T')[0]!
  const lines: string[] = [
    `# ${output.title}`,
    ``,
    `**Client:** ${clientName}`,
    `**Project:** ${projectName}`,
    `**Project Type:** ${projectType}`,
    `**Date:** ${today}`,
    `**Source Task:** ${task.title}`,
    `**Owner:** Architect`,
    ``,
    `---`,
    ``,
    `## Executive Summary`,
    ``,
    output.executiveSummary,
    ``,
    `## Solution Overview`,
    ``,
    output.solutionOverview,
    ``,
    `## Technical Approach`,
    ``,
    output.technicalApproach,
    ``,
  ]

  if (output.techStack.length > 0) {
    lines.push(`## Recommended Tech Stack`, ``, ...output.techStack.map((item) => `- ${item}`), ``)
  }

  if (output.systemComponents.length > 0) {
    lines.push(`## System Components`, ``, ...output.systemComponents.map((item) => `- ${item}`), ``)
  }

  if (output.implementationPhases.length > 0) {
    lines.push(
      `## Implementation Phases`,
      ``,
      ...output.implementationPhases.map((item, index) => `${index + 1}. ${item}`),
      ``
    )
  }

  lines.push(`## Worker Breakdown`, ``)
  for (const implementationTask of output.implementationTasks) {
    lines.push(
      `### ${implementationTask.assignee} — ${implementationTask.title}`,
      ``,
      `**Focus:** ${implementationTask.focus}`,
      ``,
      implementationTask.description,
      ``,
      `Acceptance Criteria:`,
      ...implementationTask.acceptanceCriteria.map((item) => `- ${item}`),
      ``
    )
  }

  if (output.qualityGates.length > 0) {
    lines.push(`## QA Gate`, ``, ...output.qualityGates.map((item) => `- ${item}`), ``)
  }

  if (output.risks.length > 0) {
    lines.push(`## Risks`, ``, ...output.risks.map((item) => `- ⚠️ ${item}`), ``)
  }

  return lines.join('\n')
}

export async function runArchitectAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  log.info({ taskId: task.id, title: task.title }, 'Architect Agent: starting')

  const projectId = task.project_id ?? (task.metadata['project_id'] as string | undefined)
  const projectName = (task.metadata['project_name'] as string | undefined) ?? task.title
  const clientName = (task.metadata['client_name'] as string | undefined) ?? 'the client'
  const projectType = (task.metadata['project_type'] as string | undefined) ?? 'custom software'
  const repoLocalPath = (task.metadata['repo_local_path'] as string | undefined) ?? undefined
  const repoUrl = (task.metadata['repo_url'] as string | undefined) ?? undefined
  const repoDefaultBranch = (task.metadata['repo_default_branch'] as string | undefined) ?? undefined
  const workspaceAbsPath = await resolveSoftwareWorkspacePath(task, projectId)

  // Auto-init git repo when workspace exists but no repo is linked yet
  let effectiveRepoLocalPath = repoLocalPath
  let effectiveRepoUrl = repoUrl
  const repoInitWarnings: string[] = []
  if (!repoLocalPath && workspaceAbsPath && projectId) {
    try {
      const initResult = await initWorkspaceRepo({
        workspaceAbsPath,
        projectName,
        projectType,
      })
      effectiveRepoLocalPath = initResult.repoPath
      repoInitWarnings.push(...initResult.warnings)

      if (initResult.repoUrl) {
        effectiveRepoUrl = initResult.repoUrl
      }

      if (!initResult.alreadyExisted) {
        await updateProjectRepo(projectId, {
          repo_local_path: initResult.repoPath,
          ...(initResult.repoUrl ? { repo_url: initResult.repoUrl, repo_provider: 'github' } : {}),
        })
        log.info(
          {
            taskId: task.id,
            repoPath: initResult.repoPath,
            committed: initResult.committed,
            repoUrl: initResult.repoUrl,
          },
          'Architect: auto-initialized workspace repo'
        )
      }
    } catch (err) {
      log.warn({ err, taskId: task.id }, 'Architect: auto-repo-init failed — falling back to workspace file creation')
    }
  }

  const briefContent = workspaceAbsPath
    ? await readOptionalFile(join(workspaceAbsPath, 'brief.md'))
    : ''
  // Load full workspace context: brief + ALL existing deliverables (including cross-chain artifacts)
  const fullWorkspaceContext = workspaceAbsPath
    ? await loadAllWorkspaceContext(workspaceAbsPath)
    : ''
  const repoContext = await loadRepoContext(effectiveRepoLocalPath)
  // Force bootstrap when the repo was JUST auto-initialized (no real project files yet)
  const repoWasAutoInit = !repoLocalPath && Boolean(effectiveRepoLocalPath)
  const bootstrapRepo = repoWasAutoInit || await repoNeedsBootstrap(effectiveRepoLocalPath)

  const systemPrompt = `You are the Architect Agent of WAI (Wawen Autonomous Industries).
Your role: translate a request into an execution-ready plan and split work between exactly two implementation workers.

IMPORTANT: If workspace context includes existing deliverables (marketing plans, analysis, content packages, etc.), your workers MUST read and use them. Do not recreate content that already exists — build ON TOP of it. Reference specific file names from the workspace context in the worker task descriptions.

Respond with ONLY a JSON object — no markdown, no text outside JSON:
{
  "title": "<architecture plan title>",
  "executiveSummary": "<2-3 sentence summary>",
  "solutionOverview": "<core product and system shape>",
  "technicalApproach": "<how the solution should be implemented>",
  "techStack": ["<technology 1>", "<technology 2>"],
  "systemComponents": ["<component 1>", "<component 2>"],
  "implementationPhases": ["<phase 1>", "<phase 2>", "<phase 3>"],
  "qualityGates": ["<qa gate 1>", "<qa gate 2>"],
  "risks": ["<risk 1>", "<risk 2>"],
  "implementationTasks": [
    {
      "assignee": "dev_general_1",
      "title": "<core implementation task>",
      "focus": "<main ownership area>",
      "description": "<specific execution brief>",
      "acceptanceCriteria": ["<criterion 1>", "<criterion 2>"]
    },
    {
      "assignee": "dev_general_2",
      "title": "<supporting implementation task>",
      "focus": "<main ownership area>",
      "description": "<specific execution brief>",
      "acceptanceCriteria": ["<criterion 1>", "<criterion 2>"]
    }
  ]
}

Constraints:
- Always return exactly 2 implementationTasks.
- One task must be assigned to dev_general_1 and the other to dev_general_2.
- Keep the plan grounded in real client delivery for website, app, automation, portal, dashboard, or custom software work.
- When repo context exists, reference real repo-relative modules and folders instead of generic placeholders.
- If the repo is effectively empty, make dev_general_1 own the bootstrap/foundation work and dev_general_2 own work that can layer on top once that base exists.
- Use repo context when present instead of inventing a blank architecture.`

  const userMessage = [
    `Client: ${clientName}`,
    `Project: ${projectName}`,
    `Project type: ${projectType}`,
    `Task title: ${task.title}`,
    `Task description: ${task.description}`,
    effectiveRepoLocalPath ? `Repo local path: ${effectiveRepoLocalPath}` : '',
    repoDefaultBranch ? `Repo default branch: ${repoDefaultBranch}` : '',
    repoUrl ? `Repo URL: ${repoUrl}` : '',
    bootstrapRepo ? `Repo state: bootstrap needed (empty or near-empty repo)` : '',
    !repoLocalPath && effectiveRepoLocalPath ? `Repo note: fresh repo auto-initialized by Architect — workers must populate the scaffold files` : '',
    fullWorkspaceContext ? `\nWorkspace Context (brief + existing deliverables — BUILD ON THESE):\n${fullWorkspaceContext}` : briefContent ? `\nProject Brief:\n${briefContent}` : '',
    repoContext ? `\nRepository Context:\n${repoContext}` : '',
    ``,
    `Produce an architecture plan and worker split. If workspace context exists, workers must use the existing deliverables as inputs, not recreate them.`,
  ].filter(Boolean).join('\n')

  await updateTaskStatus(task.id, 'in_progress')

  try {
    const result = await runAgent(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      {
        agentId: 'architect',
        taskId: task.id,
        taskType: 'architecture',
        requiresComplex: true,
      }
    )

    const architecturePlan = parseArchitecturePlan(result.content)
    if (!architecturePlan) {
      throw new Error(
        `Architect could not parse architecture plan from LLM response: ${result.content.substring(0, 200)}`
      )
    }

    let architecturePlanPath: string | null = null
    if (workspaceAbsPath) {
      const deliverableDir = join(workspaceAbsPath, 'deliverables')
      await mkdir(deliverableDir, { recursive: true })
      architecturePlanPath = join(deliverableDir, 'architecture_plan.md')
      await writeFile(
        architecturePlanPath,
        architecturePlanToMarkdown(architecturePlan, task, clientName, projectName, projectType),
        'utf-8'
      )

      await appendProjectProgress(workspaceAbsPath, 'Architecture plan prepared', [
        `Task: ${task.title}`,
        `Artifact: architecture_plan.md`,
        `Summary: ${architecturePlan.executiveSummary}`,
      ])
    }

    const createdTasks: Array<{ id: string; assignee: string; title: string }> = []
    const createdTaskIdsByAssignee = new Map<string, string>()
    const baseMetadata = {
      ...task.metadata,
      architecture_plan_title: architecturePlan.title,
      architecture_plan_path: architecturePlanPath ?? undefined,
      solution_overview: architecturePlan.solutionOverview,
      technical_approach: architecturePlan.technicalApproach,
      tech_stack: architecturePlan.techStack,
      system_components: architecturePlan.systemComponents,
      implementation_phases: architecturePlan.implementationPhases,
      quality_gates: architecturePlan.qualityGates,
      architecture_risks: architecturePlan.risks,
      // Propagate effective repo path and URL (may be auto-initialized)
      ...(effectiveRepoLocalPath ? { repo_local_path: effectiveRepoLocalPath } : {}),
      ...(effectiveRepoUrl ? { repo_url: effectiveRepoUrl } : {}),
    }

    const orderedImplementationTasks = [...architecturePlan.implementationTasks].sort((a, b) =>
      a.assignee.localeCompare(b.assignee)
    )

    for (const implementationTask of orderedImplementationTasks) {
      const dependencyTaskIds =
        bootstrapRepo && implementationTask.assignee === 'dev_general_2'
          ? [createdTaskIdsByAssignee.get('dev_general_1')].filter(
              (value): value is string => typeof value === 'string' && value.length > 0
            )
          : []
      const dependencyReason =
        dependencyTaskIds.length > 0
          ? 'Repo bootstrap required before supporting implementation can start.'
          : undefined

      const createdTask = await createTask({
        title: implementationTask.title.substring(0, 100),
        description: [
          `Parent architecture task: ${task.title}`,
          `Project: ${projectName}`,
          `Focus: ${implementationTask.focus}`,
          ``,
          implementationTask.description,
          ``,
          `Acceptance Criteria:`,
          ...implementationTask.acceptanceCriteria.map((item) => `- ${item}`),
        ].join('\n'),
        type: implementationTask.assignee === 'dev_general_1' ? 'dev_complex' : 'dev_simple',
        priority: task.priority,
        parent_task_id: task.id,
        ...(projectId ? { project_id: projectId } : {}),
        delegator_agent_id: 'architect',
        assignee_agent_id: implementationTask.assignee,
        requires_human_review: false,
        metadata: {
          ...baseMetadata,
          implementation_owner: implementationTask.assignee,
          implementation_focus: implementationTask.focus,
          implementation_acceptance_criteria: implementationTask.acceptanceCriteria,
          ...(dependencyTaskIds.length > 0 ? { dependency_task_ids: dependencyTaskIds } : {}),
          ...(dependencyReason ? { dependency_reason: dependencyReason } : {}),
          orchestration_mode: dependencyTaskIds.length > 0 ? 'sequential' : 'parallel',
        },
      })

      createdTaskIdsByAssignee.set(implementationTask.assignee, createdTask.id)
      createdTasks.push({
        id: createdTask.id,
        assignee: implementationTask.assignee,
        title: createdTask.title,
      })

      if (dependencyTaskIds.length === 0) {
        void runDevGeneralAgent(createdTask, notify).catch((err: unknown) => {
          log.error(
            { err, subtaskId: createdTask.id, assignee: implementationTask.assignee },
            'Dev General Agent failed'
          )
        })
      }
    }

    const qaTask = await createTask({
      title: `QA review — ${projectName}`.substring(0, 100),
      description: [
        `Run QA review for the custom software delivery.`,
        `Project: ${projectName}`,
        `Task source: ${task.title}`,
        ``,
        `Validate architecture alignment, implementation coverage, and release readiness.`,
      ].join('\n'),
      type: 'support',
      priority: task.priority,
      parent_task_id: task.id,
      ...(projectId ? { project_id: projectId } : {}),
      delegator_agent_id: 'architect',
      assignee_agent_id: 'qa',
      requires_human_review: false,
      metadata: {
        ...baseMetadata,
        qa_scope: architecturePlan.qualityGates,
      },
    })

    if (projectId) {
      await updateProjectStatus(projectId, 'active')
    }

    await recordEvent('task_completed', {
      agentId: 'architect',
      taskId: task.id,
      payload: {
        architecture_plan_title: architecturePlan.title,
        architecture_plan_path: architecturePlanPath,
        subtask_ids: createdTasks.map((item) => item.id),
        qa_task_id: qaTask.id,
        project_status: projectId ? 'active' : undefined,
        model_used: result.modelId,
        cost_usd: result.costUsd,
      },
    })

    await updateTaskStatus(task.id, 'done')

    const lines = [
      `🏗 *Architect — Plan Ready*`,
      ``,
      `📦 *${architecturePlan.title}*`,
      `👤 Client: ${clientName} | Project: ${projectName}`,
      `📝 ${architecturePlan.executiveSummary}`,
      !repoLocalPath && effectiveRepoLocalPath
        ? `\n🗂️ Git repo auto-inizializzato: \`${effectiveRepoLocalPath}\``
        : '',
      repoInitWarnings.length > 0
        ? `⚠️ Repo init warnings: ${repoInitWarnings.join(', ')}`
        : '',
      architecturePlanPath ? `\n💾 Saved: \`${architecturePlanPath}\`` : '',
      ``,
      `🚀 *Implementation tasks created:*`,
      ...createdTasks.map((item) => {
        const isQueued = bootstrapRepo && item.assignee === 'dev_general_2'
        return `• \`${item.assignee}\` → ${item.title}${isQueued ? ' *(queued after bootstrap)*' : ''}`
      }),
      `• \`qa\` → ${qaTask.title} (staged)`,
    ].filter((line) => line !== '').join('\n')

    await notify(lines)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    log.error({ err, taskId: task.id }, 'Architect Agent error')

    await recordEvent('agent_error', {
      agentId: 'architect',
      taskId: task.id,
      payload: { error: errorMessage },
      severity: 'error',
    })

    await updateTaskStatus(task.id, 'blocked').catch(() => {})

    const retryHint = `Riprova: \`/retry ${task.id}\``

    await notify(
      [
        `❌ *Architect Error*`,
        ``,
        `🆔 Task: \`${task.id.slice(0, 8)}\` — ${task.title}`,
        `🤖 Agent: architect`,
        `💥 Error: ${errorMessage.slice(0, 400)}`,
        ``,
        `💡 ${retryHint}`,
      ].join('\n')
    )

    throw err
  }
}
