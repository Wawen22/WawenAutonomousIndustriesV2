// ============================================================
// WAI – QA Agent
// Esegue il gate finale per progetti software custom,
// produce qa_report.md e decide lo stato finale del progetto.
// ============================================================

import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

import { runAgent } from '../services/llm.js'
import { updateProjectStatus, updateTaskStatus } from '../services/supabase.js'
import { log, recordEvent } from '../services/logger.js'
import { appendProjectProgress } from '../services/workspace.js'
import {
  loadRepoContext,
  loadRelevantDeliverables,
  readOptionalFile,
  resolveSoftwareWorkspacePath,
} from './software_delivery_utils.js'
import { assessRepoForQa, renderRepoQaSummary } from './software_repo_runtime.js'
import type { ProjectStatus, Task } from '../types/index.js'

type ChecklistStatus = 'pass' | 'warning' | 'fail'
type ReleaseRecommendation = 'pass' | 'review' | 'blocked'

interface QaChecklistItem {
  area: string
  status: ChecklistStatus
  notes: string
}

interface QaReportOutput {
  title: string
  executiveSummary: string
  checklist: QaChecklistItem[]
  risks: string[]
  blockingIssues: string[]
  releaseRecommendation: ReleaseRecommendation
  releaseNotes: string
  followUpActions: string[]
}

function normalizeStringArray(items: unknown): string[] {
  if (!Array.isArray(items)) return []
  return items.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function parseChecklistItem(value: unknown): QaChecklistItem | null {
  if (typeof value !== 'object' || value === null) return null

  const item = value as Record<string, unknown>
  if (
    typeof item['area'] !== 'string' ||
    typeof item['notes'] !== 'string' ||
    (item['status'] !== 'pass' && item['status'] !== 'warning' && item['status'] !== 'fail')
  ) {
    return null
  }

  return {
    area: item['area'],
    status: item['status'],
    notes: item['notes'],
  }
}

function parseQaReport(raw: string): QaReportOutput | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  } catch {
    return null
  }

  const checklist = Array.isArray(parsed['checklist'])
    ? parsed['checklist']
        .map((item) => parseChecklistItem(item))
        .filter((item): item is QaChecklistItem => item !== null)
    : []

  if (
    typeof parsed['title'] !== 'string' ||
    typeof parsed['executiveSummary'] !== 'string' ||
    typeof parsed['releaseNotes'] !== 'string' ||
    (parsed['releaseRecommendation'] !== 'pass' &&
      parsed['releaseRecommendation'] !== 'review' &&
      parsed['releaseRecommendation'] !== 'blocked') ||
    checklist.length === 0
  ) {
    return null
  }

  return {
    title: parsed['title'],
    executiveSummary: parsed['executiveSummary'],
    checklist,
    risks: normalizeStringArray(parsed['risks']),
    blockingIssues: normalizeStringArray(parsed['blockingIssues']),
    releaseRecommendation: parsed['releaseRecommendation'],
    releaseNotes: parsed['releaseNotes'],
    followUpActions: normalizeStringArray(parsed['followUpActions']),
  }
}

function qaReportToMarkdown(
  output: QaReportOutput,
  task: Task,
  clientName: string,
  projectName: string,
  repoSummary?: string,
  repoWarnings: string[] = [],
  repoBlockingIssues: string[] = []
): string {
  const today = new Date().toISOString().split('T')[0]!
  const lines: string[] = [
    `# ${output.title}`,
    ``,
    `**Client:** ${clientName}`,
    `**Project:** ${projectName}`,
    `**Date:** ${today}`,
    `**Source Task:** ${task.title}`,
    `**Owner:** QA`,
    `**Release Recommendation:** ${output.releaseRecommendation}`,
    ``,
    `---`,
    ``,
    `## Executive Summary`,
    ``,
    output.executiveSummary,
    ``,
    `## Checklist`,
    ``,
    `| Area | Status | Notes |`,
    `|------|--------|-------|`,
    ...output.checklist.map((item) => `| ${item.area} | ${item.status} | ${item.notes.replace(/\n/g, ' ')} |`),
    ``,
    `## Release Notes`,
    ``,
    output.releaseNotes,
    ``,
  ]

  if (output.risks.length > 0) {
    lines.push(`## Risks`, ``, ...output.risks.map((item) => `- ${item}`), ``)
  }

  if (output.blockingIssues.length > 0) {
    lines.push(`## Blocking Issues`, ``, ...output.blockingIssues.map((item) => `- ${item}`), ``)
  }

  if (repoSummary) {
    lines.push(`## Repo Reality Check`, ``, '```text', repoSummary, '```', ``)
  }

  if (repoBlockingIssues.length > 0) {
    lines.push(`## Repo Blocking Issues`, ``, ...repoBlockingIssues.map((item) => `- ${item}`), ``)
  }

  if (repoWarnings.length > 0) {
    lines.push(`## Repo Warnings`, ``, ...repoWarnings.map((item) => `- ${item}`), ``)
  }

  if (output.followUpActions.length > 0) {
    lines.push(`## Follow-up Actions`, ``, ...output.followUpActions.map((item, index) => `${index + 1}. ${item}`), ``)
  }

  return lines.join('\n')
}

function recommendationToProjectStatus(recommendation: ReleaseRecommendation): ProjectStatus {
  if (recommendation === 'pass') return 'delivered'
  if (recommendation === 'blocked') return 'blocked'
  return 'review'
}

function mergeRecommendation(
  recommendation: ReleaseRecommendation,
  repoBlockingIssues: string[],
  repoWarnings: string[]
): ReleaseRecommendation {
  if (repoBlockingIssues.length > 0) return 'blocked'
  if (recommendation === 'blocked') return 'blocked'
  if (recommendation === 'review') return 'review'
  if (repoWarnings.length > 0) return 'review'
  return 'pass'
}

export async function runQaAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  log.info({ taskId: task.id, title: task.title }, 'QA Agent: starting')

  const projectId = task.project_id ?? (task.metadata['project_id'] as string | undefined)
  const projectName = (task.metadata['project_name'] as string | undefined) ?? task.title
  const clientName = (task.metadata['client_name'] as string | undefined) ?? 'the client'
  const architecturePlanPath = (task.metadata['architecture_plan_path'] as string | undefined) ?? undefined
  const repoLocalPath = (task.metadata['repo_local_path'] as string | undefined) ?? undefined
  const repoDefaultBranch = (task.metadata['repo_default_branch'] as string | undefined) ?? undefined
  const repoUrl = (task.metadata['repo_url'] as string | undefined) ?? undefined
  const qualityGates = normalizeStringArray(task.metadata['quality_gates'])
  const qaScope = normalizeStringArray(task.metadata['qa_scope'])
  const workspaceAbsPath = await resolveSoftwareWorkspacePath(task, projectId)

  const architecturePlanContent =
    architecturePlanPath ? await readOptionalFile(architecturePlanPath) : ''
  const workerDeliverables = workspaceAbsPath
    ? await loadRelevantDeliverables(workspaceAbsPath)
    : []
  const repoContext = await loadRepoContext(repoLocalPath)
  const repoAssessment = await assessRepoForQa({
    task,
    ...(repoLocalPath ? { repoLocalPath } : {}),
    ...(qaScope.length > 0 ? { qaScope } : {}),
  })
  const repoSummary = repoAssessment ? renderRepoQaSummary(repoAssessment) : ''

  await updateTaskStatus(task.id, 'in_progress')
  if (projectId) {
    await updateProjectStatus(projectId, 'review')
  }

  if (workspaceAbsPath) {
    await appendProjectProgress(workspaceAbsPath, 'QA review started', [
      `Task: ${task.title}`,
      'Project moved to review status.',
    ])
  }

  const systemPrompt = `You are the QA Agent of WAI (Wawen Autonomous Industries).
Your role: review architecture and implementation outputs for a custom software delivery and produce a release recommendation.

Respond with ONLY a JSON object — no markdown, no text outside JSON:
{
  "title": "<qa report title>",
  "executiveSummary": "<short overall verdict>",
  "checklist": [
    {
      "area": "<review area>",
      "status": "pass" | "warning" | "fail",
      "notes": "<what was validated>"
    }
  ],
  "risks": ["<risk 1>", "<risk 2>"],
  "blockingIssues": ["<blocking issue 1>", "<blocking issue 2>"],
  "releaseRecommendation": "pass" | "review" | "blocked",
  "releaseNotes": "<what this means for release readiness>",
  "followUpActions": ["<next step 1>", "<next step 2>"]
}

Constraints:
- Use "blocked" when severe issues stop delivery.
- Use "review" when work is promising but still needs fixes or clarification.
- Use "pass" only when the deliverables support release readiness.
- Always include at least 4 checklist items.`

  const userMessage = [
    `Client: ${clientName}`,
    `Project: ${projectName}`,
    `Task title: ${task.title}`,
    `Task description: ${task.description}`,
    repoLocalPath ? `Repo local path: ${repoLocalPath}` : '',
    repoDefaultBranch ? `Repo default branch: ${repoDefaultBranch}` : '',
    repoUrl ? `Repo URL: ${repoUrl}` : '',
    qualityGates.length > 0 ? `Architecture quality gates: ${qualityGates.join(' | ')}` : '',
    qaScope.length > 0 ? `QA scope: ${qaScope.join(' | ')}` : '',
    architecturePlanContent ? `\nArchitecture Plan:\n${architecturePlanContent.slice(0, 8000)}` : '',
    workerDeliverables.length > 0 ? `\nWorker Deliverables:\n${workerDeliverables.join('\n\n')}` : '',
    repoContext ? `\nRepository Context:\n${repoContext}` : '',
    repoSummary ? `\nRepository QA Summary:\n${repoSummary}` : '',
    ``,
    `Produce a QA report with checklist, risks, blocking issues, and a release recommendation.`,
  ].filter(Boolean).join('\n')

  try {
    const result = await runAgent(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      {
        agentId: 'qa',
        taskId: task.id,
        taskType: 'support',
      }
    )

    const qaReport = parseQaReport(result.content)
    if (!qaReport) {
      throw new Error(`QA could not parse report from LLM response: ${result.content.substring(0, 200)}`)
    }

    const mergedBlockingIssues = [
      ...qaReport.blockingIssues,
      ...(repoAssessment?.blockingIssues ?? []),
    ]
    const mergedWarnings = repoAssessment?.warnings ?? []
    const finalRecommendation = mergeRecommendation(
      qaReport.releaseRecommendation,
      repoAssessment?.blockingIssues ?? [],
      mergedWarnings
    )
    const projectStatus = recommendationToProjectStatus(finalRecommendation)

    let qaReportPath: string | null = null
    if (workspaceAbsPath) {
      const deliverableDir = join(workspaceAbsPath, 'deliverables')
      await mkdir(deliverableDir, { recursive: true })
      qaReportPath = join(deliverableDir, 'qa_report.md')
      await writeFile(
        qaReportPath,
        qaReportToMarkdown(
          {
            ...qaReport,
            blockingIssues: mergedBlockingIssues,
            releaseRecommendation: finalRecommendation,
          },
          task,
          clientName,
          projectName,
          repoSummary || undefined,
          mergedWarnings,
          repoAssessment?.blockingIssues ?? []
        ),
        'utf-8'
      )

      await appendProjectProgress(workspaceAbsPath, 'QA review completed', [
        `Artifact: qa_report.md`,
        `Recommendation: ${finalRecommendation}`,
        `Project status: ${projectStatus}`,
        `Repo blocking issues: ${String(repoAssessment?.blockingIssues.length ?? 0)}`,
      ])
    }

    if (projectId) {
      await updateProjectStatus(projectId, projectStatus)
    }

    await recordEvent('task_completed', {
      agentId: 'qa',
      taskId: task.id,
      payload: {
        qa_report_path: qaReportPath,
        release_recommendation: finalRecommendation,
        llm_release_recommendation: qaReport.releaseRecommendation,
        blocking_issues_count: mergedBlockingIssues.length,
        repo_blocking_issues_count: repoAssessment?.blockingIssues.length ?? 0,
        repo_warning_count: mergedWarnings.length,
        repo_command_results: repoAssessment?.commands.map((command) => ({
          name: command.name,
          dir: command.relativeDir,
          status: command.status,
        })),
        project_status: projectStatus,
        model_used: result.modelId,
        cost_usd: result.costUsd,
      },
    })

    await updateTaskStatus(task.id, 'done')

    const clientSlug = (task.metadata['client_slug'] as string | undefined) ?? ''
    const projectSlug = (task.metadata['project_slug'] as string | undefined) ?? ''
    const invoicePrompt =
      projectStatus === 'delivered' && clientSlug && projectSlug
        ? `\n💰 Pronto per la fattura: /invoice ${clientSlug}/${projectSlug}`
        : ''

    const lines = [
      `🧪 *QA — Report Ready*`,
      ``,
      `📌 Task: ${task.title}`,
      `👤 Client: ${clientName} | Project: ${projectName}`,
      `📝 ${qaReport.executiveSummary}`,
      `📦 Recommendation: *${finalRecommendation}*`,
      repoAssessment
        ? `🧪 Repo checks: ${repoAssessment.commands.length} command(s), ${repoAssessment.blockingIssues.length} blocker(s), ${mergedWarnings.length} warning(s)`
        : '',
      qaReportPath ? `\n💾 Saved: \`${qaReportPath}\`` : '',
      `\n📍 Project status: *${projectStatus}*`,
      invoicePrompt,
    ].filter((line) => line !== '').join('\n')

    await notify(lines)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    log.error({ err, taskId: task.id }, 'QA Agent error')

    await recordEvent('agent_error', {
      agentId: 'qa',
      taskId: task.id,
      payload: { error: errorMessage },
      severity: 'error',
    })

    await updateTaskStatus(task.id, 'blocked').catch(() => {})

    await notify(`❌ *QA Error*\n\nTask: ${task.title}\nError: ${errorMessage}`)

    throw err
  }
}
