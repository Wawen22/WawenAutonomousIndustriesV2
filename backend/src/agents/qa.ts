// ============================================================
// WAI – QA Agent
// Esegue il gate finale per progetti software custom,
// produce qa_report.md e decide lo stato finale del progetto.
// ============================================================

import { mkdir, writeFile } from 'fs/promises'
import { basename, join } from 'path'

import { runAgent } from '../services/llm.js'
import {
  getClientById,
  getProjectById,
  updateProjectMetadata,
  updateProjectStatus,
  updateTaskMetadata,
  updateTaskRequiresHumanReview,
  updateTaskStatus,
  upsertProjectChecklist,
} from '../services/supabase.js'
import { log, recordCapabilityEvent, recordEvent } from '../services/logger.js'
import { appendProjectProgress, tickProgressChecklist } from '../services/workspace.js'
import { getCapabilityById } from '../services/capabilities.js'
import { getDeliveryConfig } from '../services/delivery-config.js'
import { deployToNetlify, deployToVercel, pushToGitHub } from '../services/deploy.js'
import { sendEmail } from '../services/email.js'
import { captureScreenshot } from '../services/screenshot.js'
import { executeInvoiceProject } from '../services/founder_revenue_actions.js'
import {
  loadRepoContext,
  loadRelevantDeliverables,
  readOptionalFile,
  resolveSoftwareWorkspacePath,
} from './software_delivery_utils.js'
import { assessRepoForQa, executeAgenticLoop, renderRepoQaSummary } from './software_repo_runtime.js'
import type { DeliveryConfig, ProjectStatus, Task } from '../types/index.js'

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
  repoBlockingIssues: string[] = [],
  screenshotPath?: string
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

  if (screenshotPath) {
    // Relative path for markdown if possible, but absolute path for founder/system is also fine
    // Since this is in workspace/{client}/{project}/deliverables/qa_report.md
    // and screenshot is in the same folder:
    const relScreenshot = basename(screenshotPath)
    lines.push(`## Visual QA`, ``, `![Live Screenshot](${relScreenshot})`, ``)
  }

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

interface DeliveryGateResult {
  approvalPending: boolean
  deployUrl: string | null
  summaryLines: string[]
}

function summarizeDeliveryScope(task: Task): string {
  const clientSlug = typeof task.metadata['client_slug'] === 'string' ? task.metadata['client_slug'] : null
  const projectSlug = typeof task.metadata['project_slug'] === 'string' ? task.metadata['project_slug'] : null
  if (clientSlug && projectSlug) {
    return `${clientSlug}/${projectSlug}`
  }

  const clientName = typeof task.metadata['client_name'] === 'string' ? task.metadata['client_name'] : null
  const projectName = typeof task.metadata['project_name'] === 'string' ? task.metadata['project_name'] : null
  if (clientName && projectName) {
    return `${clientName}/${projectName}`
  }

  return task.title
}

async function isCapabilityRuntimeEnabled(capabilityId: string): Promise<boolean> {
  const entry = await getCapabilityById(capabilityId)
  if (!entry) return true
  if (entry.capability.status === 'disabled' || entry.health.state === 'disabled') return false

  const runtimeAssignment = entry.assignments.find((assignment) =>
    assignment.targetType === 'runtime' && assignment.targetId === 'company'
  )

  return runtimeAssignment ? runtimeAssignment.state !== 'disabled' : true
}

async function getCapabilityPolicyMode(capabilityId: string): Promise<string | null> {
  const entry = await getCapabilityById(capabilityId)
  return entry?.policy.mode ?? null
}

function buildDeliveryEmail(
  clientName: string,
  projectName: string,
  repoUrl: string | undefined,
  deployUrl: string | null,
): { subject: string; text: string; html: string } {
  const linkLines = [
    deployUrl ? `Live URL: ${deployUrl}` : null,
    repoUrl ? `Repository: ${repoUrl}` : null,
  ].filter((line): line is string => Boolean(line))

  const text = [
    `Ciao ${clientName},`,
    ``,
    `la delivery di ${projectName} e pronta.`,
    ...linkLines,
    ``,
    `Se vuoi, possiamo fare subito il giro finale di feedback e handoff.`,
    ``,
    `WAI`,
  ].join('\n')

  const htmlLinks = [
    deployUrl ? `<p><strong>Live URL:</strong> <a href="${deployUrl}">${deployUrl}</a></p>` : '',
    repoUrl ? `<p><strong>Repository:</strong> <a href="${repoUrl}">${repoUrl}</a></p>` : '',
  ].join('')

  const html = [
    `<p>Ciao ${clientName},</p>`,
    `<p>la delivery di <strong>${projectName}</strong> e pronta.</p>`,
    htmlLinks,
    `<p>Se vuoi, possiamo fare subito il giro finale di feedback e handoff.</p>`,
    `<p>WAI</p>`,
  ].join('')

  return {
    subject: `${projectName} — delivery pronta`,
    text,
    html,
  }
}

async function persistDeliveryState(
  task: Task,
  patch: Record<string, unknown>,
): Promise<void> {
  await updateTaskMetadata(task.id, {
    ...task.metadata,
    ...patch,
  })
}

export async function runDeliveryGates(
  task: Task,
  config: DeliveryConfig,
  notify: (message: string) => Promise<void>,
  options: { skipFounderApproval?: boolean } = {},
): Promise<DeliveryGateResult> {
  const projectId = task.project_id ?? (task.metadata['project_id'] as string | undefined)
  const repoLocalPath = (task.metadata['repo_local_path'] as string | undefined) ?? undefined
  const repoUrl = (task.metadata['repo_url'] as string | undefined) ?? undefined
  const projectName = (task.metadata['project_name'] as string | undefined) ?? task.title
  const clientName = (task.metadata['client_name'] as string | undefined) ?? 'client'
  const clientSlug = (task.metadata['client_slug'] as string | undefined) ?? undefined
  const projectSlug = (task.metadata['project_slug'] as string | undefined) ?? undefined
  const deliveryScope = summarizeDeliveryScope(task)

  const project = projectId ? await getProjectById(projectId) : null
  const client = project ? await getClientById(project.client_id) : null

  if (config.requireFounderApproval && !options.skipFounderApproval) {
    const approvalMessage = `🔐 Delivery pronta per ${deliveryScope} — approvi? Rispondi /approve ${task.id} o /reject ${task.id}`

    await persistDeliveryState(task, {
      pending_delivery_approval: true,
      delivery_config_snapshot: config,
      delivery_approval_requested_at: new Date().toISOString(),
    })
    await updateTaskRequiresHumanReview(task.id, true)
    await updateTaskStatus(task.id, 'blocked')
    await recordEvent('human_review_requested', {
      agentId: 'qa',
      taskId: task.id,
      payload: {
        title: task.title,
        reason: 'Founder approval required before governed delivery execution',
        project_id: projectId ?? null,
        client_slug: clientSlug ?? null,
        project_slug: projectSlug ?? null,
        delivery_config: config,
      },
      severity: 'warning',
    })
    await notify(approvalMessage)

    return {
      approvalPending: true,
      deployUrl: null,
      summaryLines: ['🔐 Founder approval requested before delivery gates.'],
    }
  }

  const summaryLines: string[] = []
  let deployUrl: string | null = null

  if (config.gitPush && repoLocalPath) {
    if (await isCapabilityRuntimeEnabled('deployment.git_push')) {
      await recordCapabilityEvent({
        capability_id: 'deployment.git_push',
        event_type: 'used',
        actor_type: 'agent',
        actor_id: 'qa',
        source: 'qa_delivery_gates',
        summary: `Git push requested for ${deliveryScope}`,
        payload: { task_id: task.id, repo_local_path: repoLocalPath },
      })
      const gitResult = await pushToGitHub(repoLocalPath)
      if (gitResult.ok) {
        summaryLines.push('✅ Git push: completed')
        await recordCapabilityEvent({
          capability_id: 'deployment.git_push',
          event_type: 'succeeded',
          actor_type: 'agent',
          actor_id: 'qa',
          source: 'qa_delivery_gates',
          summary: `Git push completed for ${deliveryScope}`,
          payload: { task_id: task.id, repo_local_path: repoLocalPath },
        })
      } else {
        summaryLines.push(`⚠️ Git push: ${gitResult.error ?? 'failed'}`)
        await recordCapabilityEvent({
          capability_id: 'deployment.git_push',
          event_type: 'failed',
          actor_type: 'agent',
          actor_id: 'qa',
          source: 'qa_delivery_gates',
          summary: `Git push failed for ${deliveryScope}`,
          payload: { task_id: task.id, error: gitResult.error ?? 'unknown_error' },
        })
      }
    } else {
      summaryLines.push('⏭️ Git push: skipped (capability disabled globally)')
    }
  } else if (config.gitPush) {
    summaryLines.push('⚠️ Git push: skipped (repo local path missing)')
  } else {
    summaryLines.push('⏭️ Git push: disabled by project config')
  }

  if (config.autoDeploy && repoLocalPath && config.deployProvider) {
    const capabilityId = config.deployProvider === 'netlify'
      ? 'deployment.netlify_deploy'
      : 'deployment.vercel_deploy'

    if (await isCapabilityRuntimeEnabled(capabilityId)) {
      await recordCapabilityEvent({
        capability_id: capabilityId,
        event_type: 'used',
        actor_type: 'agent',
        actor_id: 'qa',
        source: 'qa_delivery_gates',
        summary: `Deploy requested for ${deliveryScope}`,
        payload: { task_id: task.id, provider: config.deployProvider, repo_local_path: repoLocalPath },
      })

      const deployResult = config.deployProvider === 'netlify'
        ? await deployToNetlify(repoLocalPath, projectName)
        : await deployToVercel(repoLocalPath, projectName)

      if (deployResult?.url) {
        deployUrl = deployResult.url
        summaryLines.push(`✅ Deploy (${config.deployProvider}): ${deployUrl}`)
        await recordCapabilityEvent({
          capability_id: capabilityId,
          event_type: 'succeeded',
          actor_type: 'agent',
          actor_id: 'qa',
          source: 'qa_delivery_gates',
          summary: `Deploy completed for ${deliveryScope}`,
          payload: { task_id: task.id, provider: config.deployProvider, url: deployUrl },
        })
      } else {
        summaryLines.push(`⚠️ Deploy (${config.deployProvider}): skipped or failed`)
        await recordCapabilityEvent({
          capability_id: capabilityId,
          event_type: 'failed',
          actor_type: 'agent',
          actor_id: 'qa',
          source: 'qa_delivery_gates',
          summary: `Deploy failed for ${deliveryScope}`,
          payload: { task_id: task.id, provider: config.deployProvider },
        })
      }
    } else {
      summaryLines.push(`⏭️ Deploy (${config.deployProvider}): skipped (capability disabled globally)`)
    }
  } else if (config.autoDeploy) {
    summaryLines.push('⚠️ Deploy: skipped (provider or repo path missing)')
  } else {
    summaryLines.push('⏭️ Deploy: disabled by project config')
  }

  if (deployUrl) {
    await persistDeliveryState(task, {
      deployUrl,
      pending_delivery_approval: false,
      delivery_completed_at: new Date().toISOString(),
    })
    if (project) {
      await updateProjectMetadata(project.id, {
        ...project.metadata,
        deployUrl,
      })
    }
  } else {
    await persistDeliveryState(task, {
      pending_delivery_approval: false,
      delivery_completed_at: new Date().toISOString(),
    })
  }

  if (config.clientEmailOnDelivery && client?.email) {
    if (await isCapabilityRuntimeEnabled('delivery.client_email')) {
      try {
        await recordCapabilityEvent({
          capability_id: 'delivery.client_email',
          event_type: 'used',
          actor_type: 'agent',
          actor_id: 'qa',
          source: 'qa_delivery_gates',
          summary: `Client delivery email requested for ${deliveryScope}`,
          payload: { task_id: task.id, recipient: client.email },
        })
        const emailPayload = buildDeliveryEmail(client.name, projectName, repoUrl, deployUrl)
        await sendEmail({
          to: client.email,
          subject: emailPayload.subject,
          text: emailPayload.text,
          html: emailPayload.html,
        })
        summaryLines.push(`✅ Client email: sent to ${client.email}`)
        await recordCapabilityEvent({
          capability_id: 'delivery.client_email',
          event_type: 'succeeded',
          actor_type: 'agent',
          actor_id: 'qa',
          source: 'qa_delivery_gates',
          summary: `Client delivery email sent for ${deliveryScope}`,
          payload: { task_id: task.id, recipient: client.email },
        })
      } catch (error) {
        summaryLines.push(`⚠️ Client email: ${error instanceof Error ? error.message : 'failed'}`)
        await recordCapabilityEvent({
          capability_id: 'delivery.client_email',
          event_type: 'failed',
          actor_type: 'agent',
          actor_id: 'qa',
          source: 'qa_delivery_gates',
          summary: `Client delivery email failed for ${deliveryScope}`,
          payload: {
            task_id: task.id,
            recipient: client.email,
            error: error instanceof Error ? error.message : String(error),
          },
        })
      }
    } else {
      summaryLines.push('⏭️ Client email: skipped (capability disabled globally)')
    }
  } else if (config.clientEmailOnDelivery) {
    summaryLines.push('⚠️ Client email: skipped (client email missing)')
  } else {
    summaryLines.push('⏭️ Client email: disabled by project config')
  }

  if (config.autoInvoice && clientSlug && projectSlug) {
    const autoInvoiceEnabled = await isCapabilityRuntimeEnabled('delivery.auto_invoice')
    const autoInvoicePolicy = await getCapabilityPolicyMode('delivery.auto_invoice')
    if (!autoInvoiceEnabled) {
      summaryLines.push('⏭️ Auto invoice: skipped (capability disabled globally)')
    } else if (autoInvoicePolicy === 'approval_required') {
      summaryLines.push(`⏭️ Auto invoice: blocked by capability policy — /invoice ${clientSlug}/${projectSlug}`)
    } else {
      try {
        await recordCapabilityEvent({
          capability_id: 'delivery.auto_invoice',
          event_type: 'used',
          actor_type: 'agent',
          actor_id: 'qa',
          source: 'qa_delivery_gates',
          summary: `Auto invoice requested for ${deliveryScope}`,
          payload: { task_id: task.id, client_slug: clientSlug, project_slug: projectSlug },
        })
        await executeInvoiceProject(clientSlug, projectSlug, undefined, 'auto')
        summaryLines.push(`✅ Auto invoice: /invoice ${clientSlug}/${projectSlug} executed`)
        await recordCapabilityEvent({
          capability_id: 'delivery.auto_invoice',
          event_type: 'succeeded',
          actor_type: 'agent',
          actor_id: 'qa',
          source: 'qa_delivery_gates',
          summary: `Auto invoice completed for ${deliveryScope}`,
          payload: { task_id: task.id, client_slug: clientSlug, project_slug: projectSlug },
        })
      } catch (error) {
        summaryLines.push(`⚠️ Auto invoice: ${error instanceof Error ? error.message : 'failed'}`)
        await recordCapabilityEvent({
          capability_id: 'delivery.auto_invoice',
          event_type: 'failed',
          actor_type: 'agent',
          actor_id: 'qa',
          source: 'qa_delivery_gates',
          summary: `Auto invoice failed for ${deliveryScope}`,
          payload: {
            task_id: task.id,
            client_slug: clientSlug,
            project_slug: projectSlug,
            error: error instanceof Error ? error.message : String(error),
          },
        })
      }
    }
  } else if (config.autoInvoice) {
    summaryLines.push('⚠️ Auto invoice: skipped (project scope missing)')
  } else {
    summaryLines.push('⏭️ Auto invoice: disabled by project config')
  }

  await updateTaskRequiresHumanReview(task.id, false)
  await recordEvent('project_delivered', {
    agentId: 'qa',
    taskId: task.id,
    payload: {
      project_id: projectId ?? null,
      client_name: client?.name ?? clientName,
      project_name: projectName,
      deploy_url: deployUrl,
      repo_url: repoUrl ?? null,
      delivery_config: config,
    },
  })

  return {
    approvalPending: false,
    deployUrl,
    summaryLines,
  }
}

export async function resumeApprovedDeliveryGates(
  task: Task,
  notify: (message: string) => Promise<void>,
): Promise<void> {
  const projectId = task.project_id ?? (task.metadata['project_id'] as string | undefined)
  if (!projectId) {
    throw new Error('Cannot resume delivery gates without project id')
  }

  const config = await getDeliveryConfig(projectId)
  const result = await runDeliveryGates(task, config, notify, { skipFounderApproval: true })
  const repoUrl = (task.metadata['repo_url'] as string | undefined) ?? undefined
  const clientSlug = (task.metadata['client_slug'] as string | undefined) ?? ''
  const projectSlug = (task.metadata['project_slug'] as string | undefined) ?? ''

  const lines = [
    `🚚 *Governed Delivery Completed*`,
    ``,
    `📌 Task: ${task.title}`,
    `📍 Scope: ${summarizeDeliveryScope(task)}`,
    ...result.summaryLines,
    result.deployUrl ? `🌐 Live URL: ${result.deployUrl}` : '',
    repoUrl ? `🧬 Repo: ${repoUrl}` : '',
    clientSlug && projectSlug ? `💰 Invoice hint: /invoice ${clientSlug}/${projectSlug}` : '',
  ].filter(Boolean).join('\n')

  await notify(lines)
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
  const workerDeliverables = workspaceAbsPath
    ? await loadRelevantDeliverables(workspaceAbsPath)
    : []
  const repoContext = await loadRepoContext(repoLocalPath)

  // ── Auto-fix loop ───────────────────────────────────────────────────────────
  // If the repo build/typecheck fails, run dev_general's agentic loop to fix it
  // automatically before the LLM analysis. Max 2 attempts before escalating.
  const MAX_QA_AUTOFIX = 2
  const qaAutofixCount = (task.metadata['qa_autofix_count'] as number | undefined) ?? 0

  let repoAssessment = await assessRepoForQa({
    task,
    ...(repoLocalPath ? { repoLocalPath } : {}),
    ...(qaScope.length > 0 ? { qaScope } : {}),
  })

  if (repoLocalPath && repoAssessment && repoAssessment.blockingIssues.length > 0 && qaAutofixCount < MAX_QA_AUTOFIX) {
    await notify(
      `🔧 QA: ${repoAssessment.blockingIssues.length} blocking issue(s) found — auto-fix attempt ${qaAutofixCount + 1}/${MAX_QA_AUTOFIX}...`
    )

    const failedCommands = repoAssessment.commands.filter((c) => c.status === 'failed')
    const fixDescription = [
      `QA found the following build/check failures that must be fixed:`,
      ``,
      ...repoAssessment.blockingIssues.map((issue, i) => `${i + 1}. ${issue}`),
      failedCommands.length > 0 ? `\nFailed commands output:` : '',
      ...failedCommands.map((c) => `- ${c.command}: ${(c.summary ?? 'failed').slice(0, 600)}`),
      ``,
      `Fix all issues so the build passes cleanly. Run "npm run build" at the end to confirm.`,
    ].filter(Boolean).join('\n')

    await executeAgenticLoop({
      task,
      repoPath: repoLocalPath,
      agentId: 'dev_general',
      agentRole: 'a senior developer. Your sole job is to fix the specific build/type errors listed and make the project compile successfully.',
      taskDescription: fixDescription,
      architecturePlan: '',
    })

    await updateTaskMetadata(task.id, { ...task.metadata, qa_autofix_count: qaAutofixCount + 1 })

    // Re-assess after fix
    repoAssessment = await assessRepoForQa({
      task,
      ...(repoLocalPath ? { repoLocalPath } : {}),
      ...(qaScope.length > 0 ? { qaScope } : {}),
    })

    if (repoAssessment && repoAssessment.blockingIssues.length === 0) {
      await notify(`✅ QA auto-fix succeeded — build is clean. Proceeding with analysis...`)
    } else {
      await notify(
        `⚠️ QA auto-fix attempt ${qaAutofixCount + 1}: ${repoAssessment?.blockingIssues.length ?? 0} issue(s) remain.`
      )
    }
  }
  // ───────────────────────────────────────────────────────────────────────────

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
        ...(projectId ? { projectId } : {}),
        ...(clientId ? { clientId } : {}),
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

    let deliveryResult: DeliveryGateResult | null = null
    let screenshotPath: string | undefined = undefined

    if (finalRecommendation === 'pass') {
      const deliveryConfig = projectId ? await getDeliveryConfig(projectId) : null
      if (deliveryConfig) {
        deliveryResult = await runDeliveryGates(task, deliveryConfig, notify)
      }
    }

    // T112 – Screenshot capture if deployUrl is available
    if (deliveryResult?.deployUrl && workspaceAbsPath) {
      const deliverableDir = join(workspaceAbsPath, 'deliverables')
      const targetScreenshotPath = join(deliverableDir, 'screenshot.png')

      const screenshotResult = await captureScreenshot(deliveryResult.deployUrl, targetScreenshotPath)
      if (screenshotResult.ok && screenshotResult.path) {
        screenshotPath = screenshotResult.path
        await recordCapabilityEvent({
          capability_id: 'tool.playwright_screenshot',
          event_type: 'used',
          actor_type: 'agent',
          actor_id: 'qa',
          source: 'qa_agent_run',
          summary: `Captured visual snapshot of ${deliveryResult.deployUrl}`,
          payload: { task_id: task.id, url: deliveryResult.deployUrl, path: screenshotPath },
        })

        // Re-write QA report with screenshot included
        if (qaReportPath) {
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
              repoAssessment?.blockingIssues ?? [],
              screenshotPath
            ),
            'utf-8'
          )
        }

        await appendProjectProgress(workspaceAbsPath, 'Visual QA captured', [
          `Screenshot: deliverables/screenshot.png`,
          `URL: ${deliveryResult.deployUrl}`,
        ])
      }
    }

    await recordEvent('task_completed', {
      agentId: 'qa',
      taskId: task.id,
      payload: {
        qa_report_path: qaReportPath,
        screenshot_path: screenshotPath,
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

    // Update checklist based on QA outcome
    if (projectId) {
      const buildPassing = (repoAssessment?.blockingIssues.length ?? 0) === 0
      await upsertProjectChecklist({ project_id: projectId, key: 'build_passing', label: 'Build passing', status: buildPassing ? 'done' : 'failed', agent_id: 'qa', category: 'quality', order_index: 5 }).catch(() => {})
      await upsertProjectChecklist({ project_id: projectId, key: 'qa_passed', label: 'QA review passed', status: finalRecommendation === 'pass' ? 'done' : finalRecommendation === 'blocked' ? 'failed' : 'in_progress', agent_id: 'qa', category: 'quality', order_index: 6 }).catch(() => {})
      if (finalRecommendation !== 'blocked') {
        await upsertProjectChecklist({ project_id: projectId, key: 'delivered', label: 'Delivered to client', status: projectStatus === 'delivered' ? 'done' : 'pending', agent_id: 'qa', category: 'delivery', order_index: 7 }).catch(() => {})
      }
    }
    if (workspaceAbsPath) {
      if (finalRecommendation === 'pass') {
        await tickProgressChecklist(workspaceAbsPath, 'Review').catch(() => {})
        await tickProgressChecklist(workspaceAbsPath, 'Delivered').catch(() => {})
      } else if (finalRecommendation === 'review') {
        await tickProgressChecklist(workspaceAbsPath, 'Review').catch(() => {})
      }
    }

    // When QA blocks a project, escalate to the founder for human review
    // instead of closing the task. The task surfaces in the Founder Ops
    // "Pending Review" inbox so Neb can Approve or Reject it.
    if (finalRecommendation === 'blocked') {
      await updateTaskRequiresHumanReview(task.id, true)
      await updateTaskStatus(task.id, 'blocked')
      await recordEvent('human_review_requested', {
        agentId: 'qa',
        taskId: task.id,
        payload: {
          title: task.title,
          assignee: 'qa',
          delegator: task.delegator_agent_id ?? null,
          reason: 'QA found blocking issues — founder review required before delivery',
          blocking_issues: mergedBlockingIssues,
        },
        severity: 'warning',
      })
    } else {
      await updateTaskStatus(task.id, deliveryResult?.approvalPending ? 'blocked' : 'done')
    }

    const clientSlug = (task.metadata['client_slug'] as string | undefined) ?? ''
    const projectSlug = (task.metadata['project_slug'] as string | undefined) ?? ''
    const founderHint =
      deliveryResult?.approvalPending
        ? `\n🔐 Delivery in attesa di approvazione founder\nTask ID: \`${task.id.slice(0, 8)}\``
        : projectStatus === 'delivered' && clientSlug && projectSlug
        ? `\n💰 Pronto per la fattura: /invoice ${clientSlug}/${projectSlug}`
        : projectStatus === 'blocked'
          ? `\n⚠️ Richiesta revisione founder — vai in Founder Ops → Pending Review\nTask ID: \`${task.id.slice(0, 8)}\``
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
      deliveryResult && !deliveryResult.approvalPending ? `\n🚚 Delivery gates:\n${deliveryResult.summaryLines.join('\n')}` : '',
      qaReportPath ? `\n💾 Saved: \`${qaReportPath}\`` : '',
      screenshotPath ? `🖼️ Screenshot: \`screenshot.png\`` : '',
      `\n📍 Project status: *${projectStatus}*`,
      founderHint,
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

    const retryHint = `Riprova: \`/retry ${task.id}\``

    await notify(
      [
        `❌ *QA Error*`,
        ``,
        `🆔 Task: \`${task.id.slice(0, 8)}\` — ${task.title}`,
        `🤖 Agent: qa | 📦 Project: ${clientName} / ${projectName}`,
        `💥 Error: ${errorMessage.slice(0, 400)}`,
        ``,
        `💡 ${retryHint}`,
      ].join('\n')
    )

    throw err
  }
}
