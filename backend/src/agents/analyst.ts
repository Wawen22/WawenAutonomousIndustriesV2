// ============================================================
// WAI – Analyst Agent
// Produce un report di ricerca/analisi strutturato in markdown.
// Invocato da Consulting Lead in fire-and-forget.
// Scrive workspace_path/deliverables/analysis.md
// ============================================================

import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

import { runAgent } from '../services/llm.js'
import { updateTaskStatus } from '../services/supabase.js'
import { log, recordEvent } from '../services/logger.js'
import { getProjectWorkspacePath } from '../services/workspace.js'
import type { Task } from '../types/index.js'

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

interface AnalysisOutput {
  title: string
  summary: string
  marketContext: string
  keyFindings: string[]
  risks: string[]
  opportunities: string[]
  recommendations: string[]
  sources: string[]
}

// ---------------------------------------------------------------------------
// Parse risposta LLM → AnalysisOutput
// ---------------------------------------------------------------------------

function parseAnalysis(raw: string): AnalysisOutput | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  } catch {
    return null
  }

  const { title, summary, marketContext, keyFindings, risks, opportunities, recommendations, sources } = parsed

  if (
    typeof title !== 'string' ||
    typeof summary !== 'string' ||
    typeof marketContext !== 'string' ||
    !Array.isArray(keyFindings) ||
    !Array.isArray(risks) ||
    !Array.isArray(opportunities) ||
    !Array.isArray(recommendations)
  ) {
    return null
  }

  return {
    title,
    summary,
    marketContext,
    keyFindings: keyFindings as string[],
    risks: risks as string[],
    opportunities: opportunities as string[],
    recommendations: recommendations as string[],
    sources: Array.isArray(sources) ? (sources as string[]) : [],
  }
}

// ---------------------------------------------------------------------------
// Render AnalysisOutput → markdown
// ---------------------------------------------------------------------------

function analysisToMarkdown(a: AnalysisOutput, projectName: string, clientName: string): string {
  const now = new Date().toISOString().split('T')[0]!
  const lines: string[] = [
    `# ${a.title}`,
    ``,
    `**Client:** ${clientName}`,
    `**Project:** ${projectName}`,
    `**Date:** ${now}`,
    `**Author:** Analyst Agent (WAI)`,
    ``,
    `---`,
    ``,
    `## Executive Summary`,
    ``,
    a.summary,
    ``,
    `## Market Context`,
    ``,
    a.marketContext,
    ``,
    `## Key Findings`,
    ``,
    ...a.keyFindings.map((f) => `- ${f}`),
    ``,
    `## Opportunities`,
    ``,
    ...a.opportunities.map((o) => `- ${o}`),
    ``,
    `## Risks`,
    ``,
    ...a.risks.map((r) => `- ⚠️ ${r}`),
    ``,
    `## Recommendations`,
    ``,
    ...a.recommendations.map((rec, i) => `${i + 1}. ${rec}`),
    ``,
  ]

  if (a.sources.length > 0) {
    lines.push(`## Sources`, ``, ...a.sources.map((s) => `- ${s}`), ``)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// resolveWorkspacePath
// ---------------------------------------------------------------------------

function resolveWorkspacePath(task: Task): string | null {
  const clientSlug = task.metadata['client_slug'] as string | undefined
  const projectSlug = task.metadata['project_slug'] as string | undefined

  if (clientSlug && projectSlug) {
    return getProjectWorkspacePath(clientSlug, projectSlug)
  }

  const relPath = task.metadata['workspace_path'] as string | undefined
  if (relPath) {
    const stripped = relPath.replace(/^workspace\//, '')
    const parts = stripped.split('/').filter(Boolean)
    if (parts.length >= 2) {
      return getProjectWorkspacePath(parts[0]!, parts[1]!)
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// runAnalystAgent – entry point
// ---------------------------------------------------------------------------

export async function runAnalystAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  log.info({ taskId: task.id, title: task.title }, 'Analyst Agent: starting')

  const projectName = (task.metadata['project_name'] as string | undefined) ?? task.title
  const clientName = (task.metadata['client_name'] as string | undefined) ?? 'the client'
  const workspaceAbsPath = resolveWorkspacePath(task)

  const systemPrompt = `You are the Analyst Agent of WAI (Wawen Autonomous Industries).
Your role: perform structured research and analysis for consulting projects.

Respond with ONLY a JSON object — no markdown, no text outside JSON:
{
  "title": "<analysis report title>",
  "summary": "<2-3 sentence executive summary of findings>",
  "marketContext": "<paragraph describing the market/industry context>",
  "keyFindings": ["<finding 1>", "<finding 2>", ...],
  "risks": ["<risk 1>", "<risk 2>", ...],
  "opportunities": ["<opportunity 1>", "<opportunity 2>", ...],
  "recommendations": ["<recommendation 1>", "<recommendation 2>", ...],
  "sources": ["<source or reference 1>", ...]
}`

  const userMessage = [
    `Client: ${clientName}`,
    `Project: ${projectName}`,
    `Analysis request: ${task.description}`,
    ``,
    `Perform a comprehensive research and analysis report.`,
    `Focus on: market context, key findings, risks, opportunities, and actionable recommendations.`,
  ].join('\n')

  await updateTaskStatus(task.id, 'in_progress')

  try {
    const result = await runAgent(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      {
        agentId: 'analyst',
        taskId: task.id,
        taskType: 'analysis',
        requiresComplex: true,
      }
    )

    log.debug({ raw: result.content.substring(0, 300) }, 'Analyst raw response')

    const analysis = parseAnalysis(result.content)
    if (!analysis) {
      throw new Error(
        `Analyst could not parse analysis from LLM response: ${result.content.substring(0, 200)}`
      )
    }

    // Scrivi analysis.md in workspace/deliverables/
    let analysisAbsPath: string | null = null
    if (workspaceAbsPath) {
      const deliverableDir = join(workspaceAbsPath, 'deliverables')
      await mkdir(deliverableDir, { recursive: true })
      analysisAbsPath = join(deliverableDir, 'analysis.md')
      await writeFile(analysisAbsPath, analysisToMarkdown(analysis, projectName, clientName), 'utf-8')
      log.info({ analysisAbsPath }, 'Analyst: analysis.md written')
    }

    await recordEvent('task_completed', {
      agentId: 'analyst',
      taskId: task.id,
      payload: {
        analysis_title: analysis.title,
        findings_count: analysis.keyFindings.length,
        recommendations_count: analysis.recommendations.length,
        analysis_path: analysisAbsPath,
        model_used: result.modelId,
        cost_usd: result.costUsd,
      },
    })

    await updateTaskStatus(task.id, 'done')

    log.info({ taskId: task.id, analysisTitle: analysis.title }, 'Analyst Agent: done')

    const notifyLines = [
      `🔍 *Analyst — Report Pronto*`,
      ``,
      `📊 *${analysis.title}*`,
      `👤 Client: ${clientName} | Project: ${projectName}`,
      ``,
      `📝 ${analysis.summary}`,
      ``,
      `🔑 *Key Findings (${analysis.keyFindings.length}):*`,
      ...analysis.keyFindings.slice(0, 3).map((f) => `• ${f}`),
      analysis.keyFindings.length > 3 ? `_...e altri ${analysis.keyFindings.length - 3}_` : '',
      ``,
      `✅ *Recommendations (${analysis.recommendations.length}):*`,
      ...analysis.recommendations.slice(0, 2).map((r) => `• ${r}`),
      analysisAbsPath ? `\n💾 Saved: \`${analysisAbsPath}\`` : '',
    ].filter((l) => l !== '').join('\n')

    await notify(notifyLines)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    log.error({ err, taskId: task.id }, 'Analyst Agent error')

    await recordEvent('agent_error', {
      agentId: 'analyst',
      taskId: task.id,
      payload: { error: errorMessage },
      severity: 'error',
    })

    await notify(`❌ *Analyst Agent Error*\n\nTask: ${task.title}\nError: ${errorMessage}`)

    throw err
  }
}
