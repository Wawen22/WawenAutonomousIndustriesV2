// ============================================================
// WAI – Executive Summary Agent
// Trasforma documenti lunghi, output agenti, meeting notes o
// report complessi in executive summary concisi e actionable
// per Neb / clienti.
// ============================================================

import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

import { runAgent } from '../services/llm.js'
import { getProjectById, updateTaskStatus } from '../services/supabase.js'
import { log, recordEvent } from '../services/logger.js'
import { getProjectWorkspacePath } from '../services/workspace.js'
import type { Task } from '../types/index.js'

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

interface ExecSummaryOutput {
  title: string
  tldr: string
  keyPoints: string[]
  keyDecisions: string[]
  actionItems: string[]
  urgency: string
  nextStep: string
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

function parseExecSummary(raw: string): ExecSummaryOutput | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  } catch {
    return null
  }

  const { title, tldr, keyPoints, keyDecisions, actionItems, urgency, nextStep } = parsed

  if (
    typeof title !== 'string' ||
    typeof tldr !== 'string' ||
    !Array.isArray(keyPoints) ||
    !Array.isArray(actionItems)
  ) {
    return null
  }

  return {
    title,
    tldr,
    keyPoints: keyPoints as string[],
    keyDecisions: Array.isArray(keyDecisions) ? (keyDecisions as string[]) : [],
    actionItems: actionItems as string[],
    urgency: typeof urgency === 'string' ? urgency : 'normal',
    nextStep: typeof nextStep === 'string' ? nextStep : '',
  }
}

// ---------------------------------------------------------------------------
// runExecutiveSummaryAgent – entry point
// ---------------------------------------------------------------------------

export async function runExecutiveSummaryAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  log.info({ taskId: task.id, title: task.title }, 'Executive Summary Agent: starting')

  const projectId = task.project_id ?? (task.metadata['project_id'] as string | undefined)
  const projectName = (task.metadata['project_name'] as string | undefined) ?? task.title
  const clientName = (task.metadata['client_name'] as string | undefined) ?? 'Internal'
  const sourceType = (task.metadata['source_type'] as string | undefined) ?? 'document'

  // clientId for scoped memory recall
  let clientId: string | undefined
  if (projectId) {
    try {
      const project = await getProjectById(projectId)
      clientId = project?.client_id
    } catch {
      // non-fatal
    }
  }

  // Workspace path for saving output
  const clientSlug = task.metadata['client_slug'] as string | undefined
  const projectSlug = task.metadata['project_slug'] as string | undefined
  const workspaceAbsPath =
    clientSlug && projectSlug ? getProjectWorkspacePath(clientSlug, projectSlug) : null

  const systemPrompt = `You are the Executive Summary Agent of WAI (Wawen Autonomous Industries).
Your role: transform long documents, agent outputs, meeting notes, or reports into concise, actionable executive summaries for the founder or clients.

Rules:
- Be radically concise. Busy founders read in under 60 seconds.
- Capture every important decision and action item — omit background noise.
- Use clear, direct language. No filler, no corporate speak.

Respond with ONLY a JSON object — no markdown, no text outside JSON:
{
  "title": "<executive summary title>",
  "tldr": "<1 sentence: the single most important takeaway>",
  "keyPoints": ["<point 1>", "<point 2>", "<point 3>"],
  "keyDecisions": ["<decision 1>", "<decision 2>"],
  "actionItems": ["<action 1 — owner: X>", "<action 2 — owner: Y>"],
  "urgency": "<low | normal | high | critical>",
  "nextStep": "<the single clearest immediate next step>"
}`

  const userMessage = [
    `Project: ${projectName}`,
    `For: ${clientName}`,
    `Source type: ${sourceType}`,
    `Task: ${task.description}`,
    task.metadata['content'] ? `\nContent to summarize:\n${task.metadata['content'] as string}` : '',
    `\nProduce a concise executive summary.`,
  ].filter(Boolean).join('\n')

  await updateTaskStatus(task.id, 'in_progress')

  try {
    const result = await runAgent(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      {
        agentId: 'executive_summary',
        taskId: task.id,
        taskType: 'analysis',
        requiresComplex: false,
        ...(projectId ? { projectId } : {}),
        ...(clientId ? { clientId } : {}),
      }
    )

    const summary = parseExecSummary(result.content)
    if (!summary) {
      throw new Error(
        `Executive Summary Agent could not parse output: ${result.content.substring(0, 200)}`
      )
    }

    // Save to workspace/deliverables/ if available
    let outputPath: string | null = null
    if (workspaceAbsPath) {
      const deliverableDir = join(workspaceAbsPath, 'deliverables')
      await mkdir(deliverableDir, { recursive: true })
      const slug = summary.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
      outputPath = join(deliverableDir, `exec-summary-${slug}.md`)
      const md = [
        `# ${summary.title}`,
        ``,
        `**TL;DR:** ${summary.tldr}`,
        ``,
        `**Urgency:** ${summary.urgency}`,
        ``,
        `## Key Points`,
        ...summary.keyPoints.map((p) => `- ${p}`),
        ``,
        summary.keyDecisions.length > 0 ? `## Key Decisions\n${summary.keyDecisions.map((d) => `- ${d}`).join('\n')}\n` : '',
        `## Action Items`,
        ...summary.actionItems.map((a) => `- [ ] ${a}`),
        ``,
        `## Next Step`,
        summary.nextStep,
      ].filter((l) => l !== '').join('\n')
      await writeFile(outputPath, md, 'utf-8')
    }

    await recordEvent('task_completed', {
      agentId: 'executive_summary',
      taskId: task.id,
      payload: {
        summary_title: summary.title,
        action_items_count: summary.actionItems.length,
        urgency: summary.urgency,
        output_path: outputPath,
        model_used: result.modelId,
        cost_usd: result.costUsd,
      },
    })

    await updateTaskStatus(task.id, 'done')

    const notifyLines = [
      `📋 *Executive Summary — Pronto*`,
      ``,
      `🎯 *${summary.title}*`,
      ``,
      `💡 *TL;DR:* ${summary.tldr}`,
      ``,
      `📌 *Key Points:*`,
      ...summary.keyPoints.slice(0, 3).map((p) => `• ${p}`),
      ``,
      summary.actionItems.length > 0
        ? `✅ *Action Items (${summary.actionItems.length}):*\n${summary.actionItems.slice(0, 3).map((a) => `• ${a}`).join('\n')}`
        : '',
      ``,
      `⚡ Urgency: ${summary.urgency}`,
      summary.nextStep ? `\n➡️ Next: ${summary.nextStep}` : '',
      outputPath ? `\n💾 Saved: \`${outputPath}\`` : '',
    ].filter((l) => l !== '').join('\n')

    await notify(notifyLines)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    log.error({ err, taskId: task.id }, 'Executive Summary Agent error')

    await recordEvent('agent_error', {
      agentId: 'executive_summary',
      taskId: task.id,
      payload: { error: errorMessage },
      severity: 'error',
    })

    await updateTaskStatus(task.id, 'blocked').catch(() => {})

    await notify(
      [
        `❌ *Executive Summary Error*`,
        ``,
        `🆔 Task: \`${task.id.slice(0, 8)}\` — ${task.title}`,
        `💥 Error: ${errorMessage.slice(0, 400)}`,
        ``,
        `💡 Riprova: \`/retry ${task.id}\``,
      ].join('\n')
    )

    throw err
  }
}
