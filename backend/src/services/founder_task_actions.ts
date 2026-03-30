import { log, recordEvent } from './logger.js'
import {
  getChildTasks,
  getSupabaseClient,
  getTaskByReference,
  updateProjectStatus,
  updateTaskRequiresHumanReview,
  updateTaskStatus,
} from './supabase.js'
import { getPendingDependencyIds, getBlockedDependencyIds } from '../agents/software_delivery_utils.js'
import { runCeoAgent } from '../agents/ceo.js'
import { runDevLeadSaasAgent } from '../agents/dev_lead_saas.js'
import { runDevSaasAgent } from '../agents/dev_saas.js'
import { runConsultingLeadAgent } from '../agents/consulting_lead.js'
import { runAnalystAgent } from '../agents/analyst.js'
import { runMarketingStrategistAgent } from '../agents/marketing_strategist.js'
import { runArchitectAgent } from '../agents/architect.js'
import { runDevGeneralAgent } from '../agents/dev_general.js'
import { runDevOpsEngineerAgent } from '../agents/devops_engineer.js'
import { resumeApprovedDeliveryGates, runQaAgent } from '../agents/qa.js'
import { runOpsAgent } from '../agents/ops.js'
import { runFinanceAgent } from '../agents/finance.js'
import { runExecutiveSummaryAgent } from '../agents/executive_summary.js'
import { runFeedbackSynthesizerAgent } from '../agents/feedback_synthesizer.js'
import { runSecurityAuditorAgent } from '../agents/security_auditor.js'
import { runApiTesterAgent } from '../agents/api_tester.js'
import { runDbOptimizerAgent } from '../agents/db_optimizer.js'
import { runLegalComplianceAgent } from '../agents/legal_compliance.js'
import { runProposalStrategistAgent } from '../agents/proposal_strategist.js'
import { runContentWriterAgent } from '../agents/content_writer.js'
import { extractAndSaveProjectFacts, processFeedbackLearning } from './memory_learning.js'
import { buildSystemStatusReport } from './status_report.js'
import type { Task, TaskStatus } from '../types/index.js'

export type FounderTaskAction = 'retry' | 'approve' | 'reject'

export interface FounderTaskActionResult {
  action: FounderTaskAction
  task: Task
  nextStatus: TaskStatus
  message: string
  queued: boolean
}

function normalizeReason(reason?: string): string | undefined {
  if (!reason) return undefined
  const trimmed = reason.trim()
  return trimmed ? trimmed.slice(0, 500) : undefined
}

function toRetryCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

async function updateTaskMetadata(taskId: string, metadata: Record<string, unknown>, status?: TaskStatus): Promise<void> {
  const patch: Record<string, unknown> = {
    metadata,
    updated_at: new Date().toISOString(),
  }

  if (status) {
    patch['status'] = status
    patch['completed_at'] = status === 'done' ? new Date().toISOString() : null
  }

  const { error } = await getSupabaseClient()
    .from('tasks')
    .update(patch)
    .eq('id', taskId)

  if (error) {
    throw new Error(`Failed to update task metadata: ${error.message}`)
  }
}

function buildActionMetadata(task: Task, action: FounderTaskAction, source: string, reason?: string): Record<string, unknown> {
  return {
    ...task.metadata,
    last_founder_action: action,
    last_founder_action_at: new Date().toISOString(),
    last_founder_action_by: 'founder',
    last_founder_action_source: source,
    ...(reason ? { last_founder_action_reason: reason } : {}),
  }
}

function taskScope(task: Task): string {
  const clientName = typeof task.metadata['client_name'] === 'string' ? task.metadata['client_name'] : null
  const projectName = typeof task.metadata['project_name'] === 'string' ? task.metadata['project_name'] : null
  if (clientName || projectName) {
    return `${clientName ?? 'n/a'} / ${projectName ?? 'n/a'}`
  }
  return 'n/a'
}

async function dispatchRetriedTask(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  switch (task.assignee_agent_id) {
    case 'ceo':
      await runCeoAgent(task, notify)
      return
    case 'pm_saas':
      // Retired: redirected to dev_lead_saas
      await runDevLeadSaasAgent(task, notify)
      return
    case 'dev_lead_saas':
      await runDevLeadSaasAgent(task, notify)
      return
    case 'dev_saas_1':
    case 'dev_saas_2':
      await runDevSaasAgent(task, notify)
      return
    case 'consulting_lead':
      await runConsultingLeadAgent(task, notify)
      return
    case 'analyst':
      await runAnalystAgent(task, notify)
      return
    case 'marketing_strategist':
      await runMarketingStrategistAgent(task, notify)
      return
    case 'content_creator':
      // Retired: redirected to content_writer
      await runContentWriterAgent(task, notify)
      return
    case 'content_writer':
      await runContentWriterAgent(task, notify)
      return
    case 'social_manager':
      throw new Error(`Agent 'social_manager' has been retired. This task cannot be retried.`)
    case 'architect':
      await runArchitectAgent(task, notify)
      return
    case 'devops_engineer':
      await runDevOpsEngineerAgent(task, notify)
      return
    case 'dev_general':
    case 'dev_general_1': // backward compat for existing tasks
    case 'dev_general_2': // backward compat for existing tasks
      await runDevGeneralAgent(task, notify)
      return
    case 'ai_engineer':
    case 'automation_specialist':
      // Retired: redirected to dev_general
      await runDevGeneralAgent(task, notify)
      return
    case 'qa':
      await runQaAgent(task, notify)
      return
    case 'ops':
      await runOpsAgent(task, notify)
      return
    case 'finance':
      await runFinanceAgent(task, notify)
      return
    case 'hr':
      throw new Error(`Agent 'hr' has been retired. This task cannot be retried.`)
    case 'executive_summary':
      await runExecutiveSummaryAgent(task, notify)
      return
    case 'feedback_synthesizer':
      await runFeedbackSynthesizerAgent(task, notify)
      return
    case 'security_auditor':
      await runSecurityAuditorAgent(task, notify)
      return
    case 'api_tester':
      await runApiTesterAgent(task, notify)
      return
    case 'db_optimizer':
      await runDbOptimizerAgent(task, notify)
      return
    case 'legal_compliance':
      await runLegalComplianceAgent(task, notify)
      return
    case 'proposal_strategist':
      await runProposalStrategistAgent(task, notify)
      return
    case 'behavioral_coach':
      throw new Error(`Agent 'behavioral_coach' has been retired. This task cannot be retried.`)
    default:
      throw new Error(`Task ${task.id} has no retryable assignee`)
  }
}

async function retryBlockedTask(
  task: Task,
  source: string,
  notify: (message: string) => Promise<void>,
  reason?: string
): Promise<FounderTaskActionResult> {
  if (task.status !== 'blocked') {
    throw new Error(`Task is ${task.status}, not blocked`)
  }
  if (!task.assignee_agent_id) {
    throw new Error('Task has no assignee agent')
  }

  let pendingDependencyIds: string[] = []
  let blockedDependencyIds: string[] = []
  if (task.parent_task_id) {
    const siblings = await getChildTasks(task.parent_task_id)
    pendingDependencyIds = getPendingDependencyIds(task, siblings)
    blockedDependencyIds = getBlockedDependencyIds(task, siblings)
  }

  if (blockedDependencyIds.length > 0) {
    throw new Error(`Retry blocked: unresolved dependencies ${blockedDependencyIds.map((id) => id.slice(0, 8)).join(', ')}`)
  }

  const actionReason = normalizeReason(reason)
  const metadata: Record<string, unknown> = {
    ...buildActionMetadata(task, 'retry', source, actionReason),
    retry_count: toRetryCount(task.metadata['retry_count']) + 1,
    ...(pendingDependencyIds.length > 0 ? { pending_dependency_task_ids: pendingDependencyIds } : {}),
  }

  await updateTaskMetadata(task.id, metadata, 'todo')
  await updateTaskRequiresHumanReview(task.id, false)

  await recordEvent('task_unblocked', {
    taskId: task.id,
    severity: 'info',
    payload: {
      title: task.title,
      action: 'retry',
      source,
      assignee_agent_id: task.assignee_agent_id,
      retry_count: metadata['retry_count'],
      dependency_task_ids: pendingDependencyIds,
      ...(actionReason ? { reason: actionReason } : {}),
    },
  })

  if (pendingDependencyIds.length > 0) {
    return {
      action: 'retry',
      task: { ...task, status: 'todo', metadata, completed_at: null },
      nextStatus: 'todo',
      queued: true,
      message: `Task re-queued and waiting on dependencies: ${pendingDependencyIds.map((id) => id.slice(0, 8)).join(', ')}`,
    }
  }

  const retryTask: Task = {
    ...task,
    status: 'todo',
    metadata,
    completed_at: null,
    updated_at: new Date().toISOString(),
  }

  void dispatchRetriedTask(retryTask, notify).catch((err: unknown) => {
    log.error({ err, taskId: task.id, assignee: task.assignee_agent_id }, 'Retried task failed to dispatch')
  })

  return {
    action: 'retry',
    task: retryTask,
    nextStatus: 'todo',
    queued: false,
    message: `Task re-queued and handed back to ${task.assignee_agent_id}.`,
  }
}

async function approveTask(
  task: Task,
  source: string,
  notify: (message: string) => Promise<void>,
  reason?: string
): Promise<FounderTaskActionResult> {
  if (task.status === 'done') {
    throw new Error('Task is already done — no approval needed')
  }
  if (task.status === 'cancelled') {
    throw new Error('Task is cancelled — cannot approve a cancelled task')
  }

  const actionReason = normalizeReason(reason)
  await updateTaskStatus(task.id, 'done')
  await updateTaskRequiresHumanReview(task.id, false)
  await updateTaskMetadata(task.id, buildActionMetadata(task, 'approve', source, actionReason))

  if (actionReason) {
    void processFeedbackLearning(task, actionReason).catch((err: unknown) => {
      log.error({ err, taskId: task.id }, 'Adaptive learning failed during task approval')
    })
  }

  // Non-blocking: extract compact project facts from the completed task.
  // Uses the task description as context (task output lives in workspace, not in DB).
  if (task.project_id) {
    void extractAndSaveProjectFacts(task, task.description).catch((err: unknown) => {
      log.warn({ err, taskId: task.id }, 'extractAndSaveProjectFacts failed silently during task approval')
    })
  }

  await recordEvent('human_approved', {
    taskId: task.id,
    payload: {
      title: task.title,
      approved_by: 'founder',
      source,
      previous_status: task.status,
      ...(actionReason ? { reason: actionReason } : {}),
    },
  })

  if (task.metadata['pending_delivery_approval'] === true) {
    void resumeApprovedDeliveryGates(task, notify).catch((err: unknown) => {
      log.error({ err, taskId: task.id }, 'Approved delivery gates failed to resume')
      void notify(
        [
          `❌ *Delivery Resume Failed*`,
          ``,
          `Task: \`${task.id.slice(0, 8)}\``,
          `Title: ${task.title}`,
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        ].join('\n')
      )
    })
  }

  return {
    action: 'approve',
    task: { ...task, status: 'done' },
    nextStatus: 'done',
    queued: false,
    message: 'Task approved and marked done.',
  }
}

async function rejectTask(
  task: Task,
  source: string,
  reason?: string
): Promise<FounderTaskActionResult> {
  const actionReason = normalizeReason(reason) ?? 'No reason provided'
  await updateTaskStatus(task.id, 'cancelled')
  await updateTaskRequiresHumanReview(task.id, false)
  await updateTaskMetadata(task.id, buildActionMetadata(task, 'reject', source, actionReason))

  if (actionReason && actionReason !== 'No reason provided') {
    void processFeedbackLearning(task, actionReason).catch((err: unknown) => {
      log.error({ err, taskId: task.id }, 'Adaptive learning failed during task rejection')
    })
  }

  await recordEvent('human_rejected', {
    taskId: task.id,
    payload: {
      title: task.title,
      rejected_by: 'founder',
      source,
      reason: actionReason,
      previous_status: task.status,
    },
  })

  if (task.metadata['pending_delivery_approval'] === true && task.project_id) {
    await updateProjectStatus(task.project_id, 'review').catch(() => {})
  }

  return {
    action: 'reject',
    task: { ...task, status: 'cancelled' },
    nextStatus: 'cancelled',
    queued: false,
    message: 'Task cancelled by founder.',
  }
}

export async function executeFounderTaskAction(
  taskId: string,
  action: FounderTaskAction,
  options: {
    source: 'telegram' | 'dashboard' | 'whatsapp' | 'natural_language'
    reason?: string | undefined
    notify: (message: string) => Promise<void>
  }
): Promise<FounderTaskActionResult> {
  const task = await getTaskByReference(taskId)
  if (!task) {
    throw new Error(`Task ${taskId} not found`)
  }

  switch (action) {
    case 'retry':
      return retryBlockedTask(task, options.source, options.notify, options.reason)
    case 'approve':
      return approveTask(task, options.source, options.notify, options.reason)
    case 'reject':
      return rejectTask(task, options.source, options.reason)
    default:
      throw new Error(`Unsupported founder task action: ${String(action)}`)
  }
}

/**
 * Unified command executor for cross-channel parity (T116).
 * Handles structured commands like /approve, /reject, /retry.
 */
export async function executeCommand(
  text: string,
  options: {
    source: 'telegram' | 'whatsapp' | 'dashboard'
    notify: (message: string) => Promise<void>
  }
): Promise<string> {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) {
    return 'Not a structured command.'
  }

  const [commandWithAt, ...args] = trimmed.split(/\s+/)
  const command = commandWithAt!.split('@')[0]!.toLowerCase()

  try {
    switch (command) {
      case '/approve':
      case '/reject':
      case '/retry': {
        const taskId = args[0]
        if (!taskId) return `Usage: ${command} <task_id> [reason]`
        
        const action = command.slice(1) as FounderTaskAction
        const reason = args.slice(1).join(' ')
        
        const result = await executeFounderTaskAction(taskId, action, {
          source: options.source,
          reason,
          notify: options.notify,
        })
        
        return formatFounderTaskActionMessage(result)
      }

      case '/briefing':
      case '/status': {
        return await buildSystemStatusReport()
      }

      // Add more shared commands here (e.g., /status, /projects, etc.)
      
      default:
        return `Unknown command: ${command}`
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `❌ Command failed: ${msg}`
  }
}

export function formatFounderTaskActionMessage(result: FounderTaskActionResult): string {
  const task = result.task
  const shortId = task.id.slice(0, 8)

  if (result.action === 'retry') {
    return [
      `🔁 *Task Retried*`,
      ``,
      `ID: \`${shortId}\``,
      `Title: ${task.title}`,
      `Agent: ${task.assignee_agent_id ?? 'unassigned'}`,
      `Scope: ${taskScope(task)}`,
      `Status: ${result.queued ? 'todo (queued)' : 'todo (rerun started)'}`,
      result.message,
    ].join('\n')
  }

  if (result.action === 'approve') {
    return [
      `✅ *Task Approved*`,
      ``,
      `ID: \`${shortId}\``,
      `Title: ${task.title}`,
      `Status: done`,
      `Scope: ${taskScope(task)}`,
    ].join('\n')
  }

  return [
    `🚫 *Task Rejected*`,
    ``,
    `ID: \`${shortId}\``,
    `Title: ${task.title}`,
    `Status: cancelled`,
    `Scope: ${taskScope(task)}`,
  ].join('\n')
}
