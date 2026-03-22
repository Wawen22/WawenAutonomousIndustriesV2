// ============================================================
// WAI – Proposal Strategist Agent
// Costruisce proposte commerciali complete: executive summary,
// scope, pricing, timeline, ROI. Si basa su brief progetto.
// ============================================================

import { mkdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

import { runAgent } from '../services/llm.js'
import { getProjectById, updateTaskStatus } from '../services/supabase.js'
import { log, recordEvent } from '../services/logger.js'
import { getProjectWorkspacePath } from '../services/workspace.js'
import type { Task } from '../types/index.js'

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

interface PricingTier {
  name: string
  price: string
  includes: string[]
  recommended?: boolean
}

interface ProposalStrategyOutput {
  title: string
  executiveSummary: string
  problemStatement: string
  proposedSolution: string
  scopeOfWork: string[]
  deliverables: string[]
  timeline: string
  milestones: string[]
  pricingTiers: PricingTier[]
  roi: string
  whyUs: string[]
  nextSteps: string[]
  expiryNote: string
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

function parsePricingTier(value: unknown): PricingTier | null {
  if (typeof value !== 'object' || value === null) return null
  const t = value as Record<string, unknown>
  if (typeof t['name'] !== 'string' || typeof t['price'] !== 'string') return null

  return {
    name: t['name'],
    price: t['price'],
    includes: Array.isArray(t['includes']) ? (t['includes'] as string[]) : [],
    recommended: typeof t['recommended'] === 'boolean' ? t['recommended'] : false,
  }
}

function parseProposalStrategy(raw: string): ProposalStrategyOutput | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  } catch {
    return null
  }

  const { title, executiveSummary, proposedSolution } = parsed
  if (
    typeof title !== 'string' ||
    typeof executiveSummary !== 'string' ||
    typeof proposedSolution !== 'string'
  ) {
    return null
  }

  return {
    title,
    executiveSummary,
    problemStatement: typeof parsed['problemStatement'] === 'string' ? parsed['problemStatement'] : '',
    proposedSolution,
    scopeOfWork: Array.isArray(parsed['scopeOfWork']) ? (parsed['scopeOfWork'] as string[]) : [],
    deliverables: Array.isArray(parsed['deliverables']) ? (parsed['deliverables'] as string[]) : [],
    timeline: typeof parsed['timeline'] === 'string' ? parsed['timeline'] : 'TBD',
    milestones: Array.isArray(parsed['milestones']) ? (parsed['milestones'] as string[]) : [],
    pricingTiers: Array.isArray(parsed['pricingTiers'])
      ? parsed['pricingTiers'].map(parsePricingTier).filter((t): t is PricingTier => t !== null)
      : [],
    roi: typeof parsed['roi'] === 'string' ? parsed['roi'] : '',
    whyUs: Array.isArray(parsed['whyUs']) ? (parsed['whyUs'] as string[]) : [],
    nextSteps: Array.isArray(parsed['nextSteps']) ? (parsed['nextSteps'] as string[]) : [],
    expiryNote: typeof parsed['expiryNote'] === 'string' ? parsed['expiryNote'] : 'This proposal is valid for 30 days.',
  }
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

function proposalToMarkdown(p: ProposalStrategyOutput, projectName: string, clientName: string): string {
  const now = new Date().toISOString().split('T')[0]!

  const lines = [
    `# ${p.title}`,
    ``,
    `**Prepared for:** ${clientName}`,
    `**Project:** ${projectName}`,
    `**Date:** ${now}`,
    `**Status:** Proposal`,
    ``,
    `---`,
    ``,
    `## Executive Summary`,
    ``,
    p.executiveSummary,
    ``,
  ]

  if (p.problemStatement) {
    lines.push(`## The Challenge`, ``, p.problemStatement, ``)
  }

  lines.push(`## Our Solution`, ``, p.proposedSolution, ``)

  if (p.scopeOfWork.length > 0) {
    lines.push(`## Scope of Work`, ``, ...p.scopeOfWork.map((s) => `- ${s}`), ``)
  }

  if (p.deliverables.length > 0) {
    lines.push(`## Deliverables`, ``, ...p.deliverables.map((d) => `- ✅ ${d}`), ``)
  }

  lines.push(`## Timeline`, ``, p.timeline, ``)

  if (p.milestones.length > 0) {
    lines.push(
      `## Milestones`,
      ``,
      ...p.milestones.map((m, i) => `**Phase ${i + 1}:** ${m}`),
      ``
    )
  }

  if (p.pricingTiers.length > 0) {
    lines.push(`## Investment`, ``)
    for (const tier of p.pricingTiers) {
      lines.push(
        `### ${tier.recommended ? '⭐ ' : ''}${tier.name} — ${tier.price}`,
        ``,
        ...tier.includes.map((item) => `- ${item}`),
        ``
      )
    }
  }

  if (p.roi) {
    lines.push(`## Return on Investment`, ``, p.roi, ``)
  }

  if (p.whyUs.length > 0) {
    lines.push(`## Why Choose Us`, ``, ...p.whyUs.map((w) => `- ${w}`), ``)
  }

  if (p.nextSteps.length > 0) {
    lines.push(
      `## Next Steps`,
      ``,
      ...p.nextSteps.map((step, i) => `${i + 1}. ${step}`),
      ``
    )
  }

  lines.push(`---`, ``, `*${p.expiryNote}*`, ``)

  return lines.filter((l) => l !== undefined).join('\n')
}

// ---------------------------------------------------------------------------
// runProposalStrategistAgent – entry point
// ---------------------------------------------------------------------------

export async function runProposalStrategistAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  log.info({ taskId: task.id, title: task.title }, 'Proposal Strategist Agent: starting')

  const projectId = task.project_id ?? (task.metadata['project_id'] as string | undefined)
  const projectName = (task.metadata['project_name'] as string | undefined) ?? task.title
  const clientName = (task.metadata['client_name'] as string | undefined) ?? 'the client'

  let clientId: string | undefined
  if (projectId) {
    try {
      const project = await getProjectById(projectId)
      clientId = project?.client_id
    } catch {
      // non-fatal
    }
  }

  const clientSlug = task.metadata['client_slug'] as string | undefined
  const projectSlug = task.metadata['project_slug'] as string | undefined
  const workspaceAbsPath =
    clientSlug && projectSlug ? getProjectWorkspacePath(clientSlug, projectSlug) : null

  // Load brief from workspace if available
  let briefContent = ''
  if (workspaceAbsPath) {
    const briefPath = join(workspaceAbsPath, 'brief.md')
    if (existsSync(briefPath)) {
      try {
        briefContent = await readFile(briefPath, 'utf-8')
      } catch {
        // non-fatal
      }
    }
  }

  const systemPrompt = `You are the Proposal Strategist Agent of WAI (Wawen Autonomous Industries).
Your role: build complete, conversion-optimized commercial proposals that win clients.

A great proposal:
- Leads with the client's pain, not our capabilities
- Makes the investment feel like a low-risk, high-return decision
- Offers tiered pricing to anchor value and create optionality
- Has a clear, specific call to action

Pricing guidance:
- Always offer 2-3 tiers (e.g., Essential / Professional / Enterprise)
- Mark one tier as recommended (usually the middle tier)
- Price confidently — vague TBDs lose deals

Respond with ONLY a JSON object — no markdown, no text outside JSON:
{
  "title": "<proposal title, e.g. 'Proposal: E-commerce Platform for Acme Corp'>",
  "executiveSummary": "<2-3 sentences: why this project matters and what we'll deliver>",
  "problemStatement": "<the client's current pain, challenge, or opportunity>",
  "proposedSolution": "<our approach and why it's the right fit>",
  "scopeOfWork": ["<scope item 1>", "<scope item 2>"],
  "deliverables": ["<deliverable 1>", "<deliverable 2>"],
  "timeline": "<e.g. '6 weeks: Week 1-2 discovery, Week 3-4 build, Week 5 review, Week 6 delivery'>",
  "milestones": ["<milestone 1>", "<milestone 2>"],
  "pricingTiers": [
    {
      "name": "<tier name, e.g. Essential>",
      "price": "<e.g. €3,500>",
      "includes": ["<what's included 1>", "<what's included 2>"],
      "recommended": false
    },
    {
      "name": "<tier name, e.g. Professional>",
      "price": "<e.g. €5,500>",
      "includes": ["<everything in Essential>", "<plus this>"],
      "recommended": true
    }
  ],
  "roi": "<what's the expected return or business impact for the client>",
  "whyUs": ["<differentiator 1>", "<differentiator 2>"],
  "nextSteps": ["<step 1>", "<step 2>"],
  "expiryNote": "This proposal is valid for 30 days from the date above."
}`

  const userMessage = [
    `Client: ${clientName}`,
    `Project: ${projectName}`,
    `Task: ${task.description}`,
    briefContent ? `\nProject Brief:\n${briefContent}` : '',
    task.metadata['budget_range']
      ? `\nBudget range: ${task.metadata['budget_range'] as string}`
      : '',
    `\nBuild a complete, compelling commercial proposal.`,
  ].filter(Boolean).join('\n')

  await updateTaskStatus(task.id, 'in_progress')

  try {
    const result = await runAgent(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      {
        agentId: 'proposal_strategist',
        taskId: task.id,
        taskType: 'consulting',
        requiresComplex: true,
        ...(projectId ? { projectId } : {}),
        ...(clientId ? { clientId } : {}),
      }
    )

    const proposal = parseProposalStrategy(result.content)
    if (!proposal) {
      throw new Error(
        `Proposal Strategist could not parse output: ${result.content.substring(0, 200)}`
      )
    }

    let outputPath: string | null = null
    if (workspaceAbsPath) {
      const deliverableDir = join(workspaceAbsPath, 'deliverables')
      await mkdir(deliverableDir, { recursive: true })
      outputPath = join(deliverableDir, 'proposal-strategy.md')
      await writeFile(outputPath, proposalToMarkdown(proposal, projectName, clientName), 'utf-8')
    }

    await recordEvent('task_completed', {
      agentId: 'proposal_strategist',
      taskId: task.id,
      payload: {
        proposal_title: proposal.title,
        pricing_tiers: proposal.pricingTiers.length,
        deliverables_count: proposal.deliverables.length,
        has_roi: Boolean(proposal.roi),
        output_path: outputPath,
        model_used: result.modelId,
        cost_usd: result.costUsd,
      },
    })

    await updateTaskStatus(task.id, 'done')

    const recommendedTier = proposal.pricingTiers.find((t) => t.recommended) ?? proposal.pricingTiers[0]

    const notifyLines = [
      `💼 *Proposal Strategist — Proposta Pronta*`,
      ``,
      `🎯 *${proposal.title}*`,
      `👤 ${clientName} | ${projectName}`,
      ``,
      `📝 ${proposal.executiveSummary}`,
      ``,
      `📦 *${proposal.deliverables.length} deliverables | ${proposal.pricingTiers.length} tier di pricing*`,
      recommendedTier ? `\n⭐ Recommended: **${recommendedTier.name}** — ${recommendedTier.price}` : '',
      `⏱ Timeline: ${proposal.timeline}`,
      ``,
      proposal.roi ? `📈 ROI: ${proposal.roi.slice(0, 120)}` : '',
      outputPath ? `\n💾 Saved: \`${outputPath}\`` : '',
    ].filter((l) => l !== '').join('\n')

    await notify(notifyLines)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    log.error({ err, taskId: task.id }, 'Proposal Strategist Agent error')

    await recordEvent('agent_error', {
      agentId: 'proposal_strategist',
      taskId: task.id,
      payload: { error: errorMessage },
      severity: 'error',
    })

    await updateTaskStatus(task.id, 'blocked').catch(() => {})

    await notify(
      [
        `❌ *Proposal Strategist Error*`,
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
