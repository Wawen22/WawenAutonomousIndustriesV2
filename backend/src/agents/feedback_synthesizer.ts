// ============================================================
// WAI – Feedback Synthesizer Agent
// Analizza feedback raccolto (cliente, utenti, stakeholder),
// identifica pattern, assegna priority score, produce action items.
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

interface FeedbackPattern {
  theme: string
  count: number
  priorityScore: number
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed'
  examples: string[]
}

interface FeedbackActionItem {
  action: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  relatedTheme: string
  owner: string
}

interface FeedbackSynthesisOutput {
  title: string
  totalFeedbackItems: number
  overallSentiment: 'positive' | 'negative' | 'neutral' | 'mixed'
  executiveSummary: string
  patterns: FeedbackPattern[]
  actionItems: FeedbackActionItem[]
  quickWins: string[]
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

function parseFeedbackPattern(value: unknown): FeedbackPattern | null {
  if (typeof value !== 'object' || value === null) return null
  const p = value as Record<string, unknown>
  if (
    typeof p['theme'] !== 'string' ||
    typeof p['priorityScore'] !== 'number'
  ) return null

  return {
    theme: p['theme'],
    count: typeof p['count'] === 'number' ? p['count'] : 1,
    priorityScore: p['priorityScore'],
    sentiment: ['positive', 'negative', 'neutral', 'mixed'].includes(p['sentiment'] as string)
      ? (p['sentiment'] as FeedbackPattern['sentiment'])
      : 'neutral',
    examples: Array.isArray(p['examples']) ? (p['examples'] as string[]) : [],
  }
}

function parseFeedbackActionItem(value: unknown): FeedbackActionItem | null {
  if (typeof value !== 'object' || value === null) return null
  const a = value as Record<string, unknown>
  if (typeof a['action'] !== 'string') return null

  return {
    action: a['action'],
    priority: ['critical', 'high', 'medium', 'low'].includes(a['priority'] as string)
      ? (a['priority'] as FeedbackActionItem['priority'])
      : 'medium',
    relatedTheme: typeof a['relatedTheme'] === 'string' ? a['relatedTheme'] : '',
    owner: typeof a['owner'] === 'string' ? a['owner'] : 'team',
  }
}

function parseFeedbackSynthesis(raw: string): FeedbackSynthesisOutput | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  } catch {
    return null
  }

  const { title, executiveSummary, patterns, actionItems } = parsed

  if (typeof title !== 'string' || typeof executiveSummary !== 'string') return null

  return {
    title,
    totalFeedbackItems: typeof parsed['totalFeedbackItems'] === 'number' ? parsed['totalFeedbackItems'] : 0,
    overallSentiment: ['positive', 'negative', 'neutral', 'mixed'].includes(parsed['overallSentiment'] as string)
      ? (parsed['overallSentiment'] as FeedbackSynthesisOutput['overallSentiment'])
      : 'neutral',
    executiveSummary,
    patterns: Array.isArray(patterns)
      ? patterns.map(parseFeedbackPattern).filter((p): p is FeedbackPattern => p !== null)
      : [],
    actionItems: Array.isArray(actionItems)
      ? actionItems.map(parseFeedbackActionItem).filter((a): a is FeedbackActionItem => a !== null)
      : [],
    quickWins: Array.isArray(parsed['quickWins']) ? (parsed['quickWins'] as string[]) : [],
  }
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

function synthesisToMarkdown(s: FeedbackSynthesisOutput, projectName: string, clientName: string): string {
  const now = new Date().toISOString().split('T')[0]!
  const sentimentEmoji: Record<string, string> = {
    positive: '🟢', negative: '🔴', neutral: '⚪', mixed: '🟡',
  }

  const lines = [
    `# ${s.title}`,
    ``,
    `**Project:** ${projectName}`,
    `**Client:** ${clientName}`,
    `**Date:** ${now}`,
    `**Total Feedback Items:** ${s.totalFeedbackItems}`,
    `**Overall Sentiment:** ${sentimentEmoji[s.overallSentiment] ?? ''} ${s.overallSentiment}`,
    ``,
    `---`,
    ``,
    `## Executive Summary`,
    ``,
    s.executiveSummary,
    ``,
    `## Feedback Patterns`,
    ``,
  ]

  for (const pattern of s.patterns.sort((a, b) => b.priorityScore - a.priorityScore)) {
    lines.push(
      `### ${sentimentEmoji[pattern.sentiment] ?? ''} ${pattern.theme} (Priority: ${pattern.priorityScore}/10)`,
      ``,
      `- Count: ${pattern.count} mentions`,
      `- Sentiment: ${pattern.sentiment}`,
      pattern.examples.length > 0
        ? `- Examples:\n${pattern.examples.slice(0, 2).map((e) => `  - "${e}"`).join('\n')}`
        : '',
      ``
    )
  }

  lines.push(`## Action Items`, ``)
  for (const item of s.actionItems) {
    const priorityEmoji: Record<string, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' }
    lines.push(`- ${priorityEmoji[item.priority] ?? ''} **[${item.priority.toUpperCase()}]** ${item.action} *(${item.owner})*`)
  }
  lines.push(``)

  if (s.quickWins.length > 0) {
    lines.push(`## Quick Wins`, ``, ...s.quickWins.map((w) => `- ⚡ ${w}`), ``)
  }

  return lines.filter((l) => l !== undefined).join('\n')
}

// ---------------------------------------------------------------------------
// runFeedbackSynthesizerAgent – entry point
// ---------------------------------------------------------------------------

export async function runFeedbackSynthesizerAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  log.info({ taskId: task.id, title: task.title }, 'Feedback Synthesizer Agent: starting')

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

  const systemPrompt = `You are the Feedback Synthesizer Agent of WAI (Wawen Autonomous Industries).
Your role: analyze collected feedback from clients, users, or stakeholders. Identify recurring themes and patterns, assign priority scores (1-10), and produce actionable insights.

Rules:
- Group similar feedback into named themes/patterns.
- Priority score = (frequency × impact / 10), scale 1-10.
- Be specific in action items — vague recommendations are useless.
- Flag quick wins: high-impact, low-effort improvements.

Respond with ONLY a JSON object — no markdown, no text outside JSON:
{
  "title": "<synthesis title>",
  "totalFeedbackItems": <number of individual feedback items analyzed>,
  "overallSentiment": "<positive | negative | neutral | mixed>",
  "executiveSummary": "<2-3 sentences: what does this feedback mean for the project?>",
  "patterns": [
    {
      "theme": "<theme name>",
      "count": <number of mentions>,
      "priorityScore": <1-10>,
      "sentiment": "<positive | negative | neutral | mixed>",
      "examples": ["<verbatim example 1>", "<verbatim example 2>"]
    }
  ],
  "actionItems": [
    {
      "action": "<specific action to take>",
      "priority": "<critical | high | medium | low>",
      "relatedTheme": "<theme name>",
      "owner": "<who should own this: product | dev | design | business>"
    }
  ],
  "quickWins": ["<quick win 1>", "<quick win 2>"]
}`

  const userMessage = [
    `Project: ${projectName}`,
    `Client: ${clientName}`,
    `Task: ${task.description}`,
    task.metadata['feedback_content']
      ? `\nFeedback data:\n${task.metadata['feedback_content'] as string}`
      : '',
    `\nSynthesize the feedback and identify actionable patterns.`,
  ].filter(Boolean).join('\n')

  await updateTaskStatus(task.id, 'in_progress')

  try {
    const result = await runAgent(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      {
        agentId: 'feedback_synthesizer',
        taskId: task.id,
        taskType: 'analysis',
        requiresComplex: false,
        ...(projectId ? { projectId } : {}),
        ...(clientId ? { clientId } : {}),
      }
    )

    const synthesis = parseFeedbackSynthesis(result.content)
    if (!synthesis) {
      throw new Error(
        `Feedback Synthesizer could not parse output: ${result.content.substring(0, 200)}`
      )
    }

    let outputPath: string | null = null
    if (workspaceAbsPath) {
      const deliverableDir = join(workspaceAbsPath, 'deliverables')
      await mkdir(deliverableDir, { recursive: true })
      outputPath = join(deliverableDir, 'feedback-synthesis.md')
      await writeFile(outputPath, synthesisToMarkdown(synthesis, projectName, clientName), 'utf-8')
    }

    await recordEvent('task_completed', {
      agentId: 'feedback_synthesizer',
      taskId: task.id,
      payload: {
        synthesis_title: synthesis.title,
        patterns_count: synthesis.patterns.length,
        action_items_count: synthesis.actionItems.length,
        overall_sentiment: synthesis.overallSentiment,
        output_path: outputPath,
        model_used: result.modelId,
        cost_usd: result.costUsd,
      },
    })

    await updateTaskStatus(task.id, 'done')

    const topPattern = synthesis.patterns.sort((a, b) => b.priorityScore - a.priorityScore)[0]
    const criticalItems = synthesis.actionItems.filter((a) => a.priority === 'critical')

    const notifyLines = [
      `🔍 *Feedback Synthesizer — Analisi Completata*`,
      ``,
      `📊 *${synthesis.title}*`,
      `👤 ${clientName} | ${projectName}`,
      ``,
      `📝 ${synthesis.executiveSummary}`,
      ``,
      `📌 *Top pattern:* ${topPattern ? `${topPattern.theme} (score: ${topPattern.priorityScore}/10)` : 'N/A'}`,
      `✅ *${synthesis.actionItems.length} action items*, ${criticalItems.length} critici`,
      synthesis.quickWins.length > 0
        ? `\n⚡ *Quick wins:*\n${synthesis.quickWins.slice(0, 2).map((w) => `• ${w}`).join('\n')}`
        : '',
      outputPath ? `\n💾 Saved: \`${outputPath}\`` : '',
    ].filter((l) => l !== '').join('\n')

    await notify(notifyLines)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    log.error({ err, taskId: task.id }, 'Feedback Synthesizer Agent error')

    await recordEvent('agent_error', {
      agentId: 'feedback_synthesizer',
      taskId: task.id,
      payload: { error: errorMessage },
      severity: 'error',
    })

    await updateTaskStatus(task.id, 'blocked').catch(() => {})

    await notify(
      [
        `❌ *Feedback Synthesizer Error*`,
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
