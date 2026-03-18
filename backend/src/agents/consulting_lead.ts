// ============================================================
// WAI – Consulting Lead Agent
// Riceve un task dal CEO, legge il brief del progetto,
// produce una proposta/analisi strutturata in markdown,
// scrive workspace_path/deliverables/proposal.md,
// crea sub-subtask per Analyst se analisi approfondita richiesta,
// notifica Neb via Telegram.
// ============================================================

import { mkdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

import { runAgent } from '../services/llm.js'
import { createTask, updateProjectStatus, updateTaskStatus } from '../services/supabase.js'
import { log, recordEvent } from '../services/logger.js'
import { getProjectWorkspacePath } from '../services/workspace.js'
import type { ProjectStatus, Task } from '../types/index.js'

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

interface ProposalOutput {
  title: string
  executiveSummary: string
  objectives: string[]
  deliverables: string[]
  timeline: string
  investment: string
  nextSteps: string[]
  requiresAnalysis: boolean
}

// ---------------------------------------------------------------------------
// Parse risposta LLM → ProposalOutput
// ---------------------------------------------------------------------------

function parseProposal(raw: string): ProposalOutput | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  } catch {
    return null
  }

  const { title, executiveSummary, objectives, deliverables, timeline, investment, nextSteps, requiresAnalysis } = parsed

  if (
    typeof title !== 'string' ||
    typeof executiveSummary !== 'string' ||
    !Array.isArray(objectives) ||
    !Array.isArray(deliverables) ||
    typeof timeline !== 'string' ||
    typeof investment !== 'string' ||
    !Array.isArray(nextSteps)
  ) {
    return null
  }

  return {
    title,
    executiveSummary,
    objectives: objectives as string[],
    deliverables: deliverables as string[],
    timeline,
    investment,
    nextSteps: nextSteps as string[],
    requiresAnalysis: typeof requiresAnalysis === 'boolean' ? requiresAnalysis : false,
  }
}

// ---------------------------------------------------------------------------
// Render ProposalOutput → markdown
// ---------------------------------------------------------------------------

function proposalToMarkdown(p: ProposalOutput, projectName: string, clientName: string): string {
  const now = new Date().toISOString().split('T')[0]!
  return [
    `# ${p.title}`,
    ``,
    `**Client:** ${clientName}`,
    `**Project:** ${projectName}`,
    `**Date:** ${now}`,
    `**Status:** Draft`,
    ``,
    `---`,
    ``,
    `## Executive Summary`,
    ``,
    p.executiveSummary,
    ``,
    `## Objectives`,
    ``,
    ...p.objectives.map((o) => `- ${o}`),
    ``,
    `## Deliverables`,
    ``,
    ...p.deliverables.map((d) => `- ${d}`),
    ``,
    `## Timeline`,
    ``,
    p.timeline,
    ``,
    `## Investment`,
    ``,
    p.investment,
    ``,
    `## Next Steps`,
    ``,
    ...p.nextSteps.map((s, i) => `${i + 1}. ${s}`),
    ``,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// resolveWorkspacePath – ricava l'assoluto dal metadata del task
// ---------------------------------------------------------------------------

function resolveWorkspacePath(task: Task): string | null {
  const clientSlug = task.metadata['client_slug'] as string | undefined
  const projectSlug = task.metadata['project_slug'] as string | undefined

  if (clientSlug && projectSlug) {
    return getProjectWorkspacePath(clientSlug, projectSlug)
  }

  // Fallback: workspace_path relativo nel metadata
  const relPath = task.metadata['workspace_path'] as string | undefined
  if (relPath) {
    // relPath = "workspace/{client}/{project}" — strip leading "workspace/"
    const stripped = relPath.replace(/^workspace\//, '')
    const parts = stripped.split('/').filter(Boolean)
    if (parts.length >= 2) {
      return getProjectWorkspacePath(parts[0]!, parts[1]!)
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// runConsultingLeadAgent – entry point
// ---------------------------------------------------------------------------

export async function runConsultingLeadAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  log.info({ taskId: task.id, title: task.title }, 'Consulting Lead Agent: starting')

  const projectId = task.project_id ?? (task.metadata['project_id'] as string | undefined)
  const projectName = (task.metadata['project_name'] as string | undefined) ?? task.title
  const clientName = (task.metadata['client_name'] as string | undefined) ?? 'the client'

  // Leggi brief.md dal workspace se disponibile
  const workspaceAbsPath = resolveWorkspacePath(task)
  let briefContent = ''

  if (workspaceAbsPath) {
    const briefPath = join(workspaceAbsPath, 'brief.md')
    if (existsSync(briefPath)) {
      try {
        briefContent = await readFile(briefPath, 'utf-8')
        log.debug({ briefPath }, 'Consulting Lead: brief.md loaded')
      } catch {
        log.warn({ briefPath }, 'Consulting Lead: could not read brief.md')
      }
    }
  }

  const systemPrompt = `You are the Consulting Lead Agent of WAI (Wawen Autonomous Industries).
Your role: analyze a client brief and produce a professional consulting proposal.

Respond with ONLY a JSON object — no markdown, no text outside JSON:
{
  "title": "<proposal title>",
  "executiveSummary": "<2-3 sentences summarizing the proposal value>",
  "objectives": ["<objective 1>", "<objective 2>", ...],
  "deliverables": ["<deliverable 1>", "<deliverable 2>", ...],
  "timeline": "<proposed timeline description (e.g. '4 weeks: Week 1 discovery, Week 2-3 execution, Week 4 review')>",
  "investment": "<investment estimate or 'TBD — pending scope definition'>",
  "nextSteps": ["<step 1>", "<step 2>", ...],
  "requiresAnalysis": <true if deep market/technical analysis is needed, false otherwise>
}`

  const userMessage = [
    `Client: ${clientName}`,
    `Project: ${projectName}`,
    `Task: ${task.description}`,
    briefContent ? `\nProject Brief:\n${briefContent}` : '',
    `\nProduce a structured consulting proposal.`,
  ].filter(Boolean).join('\n')

  await updateTaskStatus(task.id, 'in_progress')

  try {
    const result = await runAgent(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      {
        agentId: 'consulting_lead',
        taskId: task.id,
        taskType: 'consulting',
        requiresComplex: true,
      }
    )

    log.debug({ raw: result.content.substring(0, 300) }, 'Consulting Lead raw response')

    const proposal = parseProposal(result.content)
    if (!proposal) {
      throw new Error(
        `Consulting Lead could not parse proposal from LLM response: ${result.content.substring(0, 200)}`
      )
    }

    // Scrivi proposal.md in workspace/deliverables/
    let proposalAbsPath: string | null = null
    if (workspaceAbsPath) {
      const deliverableDir = join(workspaceAbsPath, 'deliverables')
      await mkdir(deliverableDir, { recursive: true })
      proposalAbsPath = join(deliverableDir, 'proposal.md')
      await writeFile(proposalAbsPath, proposalToMarkdown(proposal, projectName, clientName), 'utf-8')
      log.info({ proposalAbsPath }, 'Consulting Lead: proposal.md written')
    }

    // Crea sub-subtask per Analyst se analisi approfondita richiesta
    if (proposal.requiresAnalysis) {
      const analystTask = await createTask({
        title: `Market & technical analysis — ${projectName}`.substring(0, 100),
        description: [
          `Perform in-depth research and analysis for consulting project.`,
          ``,
          `Client: ${clientName}`,
          `Project: ${projectName}`,
          `Original request: ${task.description}`,
          ``,
          `Deliverables expected:`,
          ...proposal.deliverables.map((d) => `- ${d}`),
        ].join('\n'),
        type: 'analysis',
        priority: task.priority,
        parent_task_id: task.id,
        ...(projectId ? { project_id: projectId } : {}),
        delegator_agent_id: 'consulting_lead',
        assignee_agent_id: 'analyst',
        requires_human_review: false,
        metadata: {
          ...task.metadata,
          parent_proposal_path: proposalAbsPath,
        },
      })
      log.info({ analystTaskId: analystTask.id }, 'Consulting Lead: analyst sub-task created')
    }

    // Move project to delivered (no analysis needed) or active (waiting for analyst)
    const projectStatus: ProjectStatus = proposal.requiresAnalysis ? 'active' : 'delivered'
    if (projectId) {
      await updateProjectStatus(projectId, projectStatus)
    }

    const finalEventType = projectStatus === 'delivered' ? 'project_delivered' : 'task_completed'
    await recordEvent(finalEventType, {
      agentId: 'consulting_lead',
      taskId: task.id,
      payload: {
        proposal_title: proposal.title,
        deliverables_count: proposal.deliverables.length,
        objectives_count: proposal.objectives.length,
        requires_analysis: proposal.requiresAnalysis,
        proposal_path: proposalAbsPath,
        ...(projectId ? { project_status: projectStatus } : {}),
        model_used: result.modelId,
        cost_usd: result.costUsd,
      },
    })

    await updateTaskStatus(task.id, 'done')

    log.info({ taskId: task.id, proposalTitle: proposal.title }, 'Consulting Lead Agent: done')

    // Notifica Neb con preview
    const deliverableLines = proposal.deliverables
      .slice(0, 3)
      .map((d) => `• ${d}`)
    if (proposal.deliverables.length > 3) {
      deliverableLines.push(`_...e altri ${proposal.deliverables.length - 3}_`)
    }

    const clientSlug = (task.metadata['client_slug'] as string | undefined) ?? ''
    const projectSlug = (task.metadata['project_slug'] as string | undefined) ?? ''
    const invoicePrompt =
      projectStatus === 'delivered' && clientSlug && projectSlug
        ? `\n💰 Pronto per la fattura: /invoice ${clientSlug}/${projectSlug}`
        : ''

    const notifyLines = [
      `📄 *Consulting Lead — Proposta Pronta*`,
      ``,
      `🎯 *${proposal.title}*`,
      `👤 Client: ${clientName} | Project: ${projectName}`,
      ``,
      `📝 ${proposal.executiveSummary}`,
      ``,
      `📦 *Deliverables (${proposal.deliverables.length}):*`,
      ...deliverableLines,
      ``,
      `⏱ ${proposal.timeline}`,
      proposalAbsPath ? `\n💾 Saved: \`${proposalAbsPath}\`` : '',
      proposal.requiresAnalysis ? `\n🔍 Sub-task Analyst creato per analisi approfondita` : '',
      `\n📍 Project status: *${projectStatus}*`,
      invoicePrompt,
    ].filter((l) => l !== '').join('\n')

    await notify(notifyLines)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    log.error({ err, taskId: task.id }, 'Consulting Lead Agent error')

    await recordEvent('agent_error', {
      agentId: 'consulting_lead',
      taskId: task.id,
      payload: { error: errorMessage },
      severity: 'error',
    })

    await notify(`❌ *Consulting Lead Error*\n\nTask: ${task.title}\nError: ${errorMessage}`)

    throw err
  }
}
