// ============================================================
// WAI – DB Optimizer Agent
// Review schema DB, query performance, indici mancanti,
// N+1 queries, e anti-pattern comuni.
// captureMemory: false — non salva output grezzo in memoria.
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

type IssueSeverity = 'critical' | 'high' | 'medium' | 'low'
type IssueType = 'missing_index' | 'n_plus_1' | 'schema_design' | 'slow_query' | 'anti_pattern' | 'normalization' | 'other'

interface DbIssue {
  severity: IssueSeverity
  type: IssueType
  title: string
  description: string
  location: string
  estimatedImpact: string
  fix: string
}

interface IndexRecommendation {
  table: string
  columns: string[]
  reason: string
  sqlStatement: string
}

interface DbOptimizerOutput {
  title: string
  overallScore: number
  summary: string
  issues: DbIssue[]
  indexRecommendations: IndexRecommendation[]
  n1QueryLocations: string[]
  schemaImprovements: string[]
  estimatedPerformanceGain: string
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

function parseDbIssue(value: unknown): DbIssue | null {
  if (typeof value !== 'object' || value === null) return null
  const i = value as Record<string, unknown>
  if (typeof i['title'] !== 'string' || typeof i['description'] !== 'string') return null

  return {
    severity: ['critical', 'high', 'medium', 'low'].includes(i['severity'] as string)
      ? (i['severity'] as IssueSeverity)
      : 'medium',
    type: ['missing_index', 'n_plus_1', 'schema_design', 'slow_query', 'anti_pattern', 'normalization', 'other'].includes(i['type'] as string)
      ? (i['type'] as IssueType)
      : 'other',
    title: i['title'],
    description: i['description'],
    location: typeof i['location'] === 'string' ? i['location'] : 'unknown',
    estimatedImpact: typeof i['estimatedImpact'] === 'string' ? i['estimatedImpact'] : '',
    fix: typeof i['fix'] === 'string' ? i['fix'] : '',
  }
}

function parseIndexRecommendation(value: unknown): IndexRecommendation | null {
  if (typeof value !== 'object' || value === null) return null
  const r = value as Record<string, unknown>
  if (typeof r['table'] !== 'string') return null

  return {
    table: r['table'],
    columns: Array.isArray(r['columns']) ? (r['columns'] as string[]) : [],
    reason: typeof r['reason'] === 'string' ? r['reason'] : '',
    sqlStatement: typeof r['sqlStatement'] === 'string' ? r['sqlStatement'] : '',
  }
}

function parseDbOptimizer(raw: string): DbOptimizerOutput | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  } catch {
    return null
  }

  const { title, summary } = parsed
  if (typeof title !== 'string' || typeof summary !== 'string') return null

  return {
    title,
    overallScore: typeof parsed['overallScore'] === 'number' ? parsed['overallScore'] : 5,
    summary,
    issues: Array.isArray(parsed['issues'])
      ? parsed['issues'].map(parseDbIssue).filter((i): i is DbIssue => i !== null)
      : [],
    indexRecommendations: Array.isArray(parsed['indexRecommendations'])
      ? parsed['indexRecommendations'].map(parseIndexRecommendation).filter((r): r is IndexRecommendation => r !== null)
      : [],
    n1QueryLocations: Array.isArray(parsed['n1QueryLocations']) ? (parsed['n1QueryLocations'] as string[]) : [],
    schemaImprovements: Array.isArray(parsed['schemaImprovements']) ? (parsed['schemaImprovements'] as string[]) : [],
    estimatedPerformanceGain: typeof parsed['estimatedPerformanceGain'] === 'string' ? parsed['estimatedPerformanceGain'] : '',
  }
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

function dbOptimizationToMarkdown(output: DbOptimizerOutput, projectName: string): string {
  const now = new Date().toISOString().split('T')[0]!
  const severityEmoji: Record<string, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' }

  const scoreBar = '█'.repeat(Math.round(output.overallScore / 2)) + '░'.repeat(5 - Math.round(output.overallScore / 2))

  const lines = [
    `# ${output.title}`,
    ``,
    `**Project:** ${projectName}`,
    `**Date:** ${now}`,
    `**DB Health Score:** ${scoreBar} ${output.overallScore}/10`,
    ``,
    `---`,
    ``,
    `## Summary`,
    ``,
    output.summary,
    output.estimatedPerformanceGain ? `\n**Estimated performance gain if fixed:** ${output.estimatedPerformanceGain}` : '',
    ``,
  ]

  if (output.n1QueryLocations.length > 0) {
    lines.push(
      `## N+1 Query Locations ⚠️`,
      ``,
      ...output.n1QueryLocations.map((loc) => `- \`${loc}\``),
      ``
    )
  }

  lines.push(`## Issues (${output.issues.length})`, ``)

  const sorted = [...output.issues].sort((a, b) => {
    const order: IssueSeverity[] = ['critical', 'high', 'medium', 'low']
    return order.indexOf(a.severity) - order.indexOf(b.severity)
  })

  for (const issue of sorted) {
    lines.push(
      `### ${severityEmoji[issue.severity] ?? ''} [${issue.severity.toUpperCase()}] ${issue.title}`,
      ``,
      `**Type:** ${issue.type.replace(/_/g, ' ')}`,
      `**Location:** \`${issue.location}\``,
      `**Impact:** ${issue.estimatedImpact}`,
      ``,
      issue.description,
      ``,
      `**Fix:** ${issue.fix}`,
      ``
    )
  }

  if (output.indexRecommendations.length > 0) {
    lines.push(`## Index Recommendations`, ``)
    for (const rec of output.indexRecommendations) {
      lines.push(
        `### \`${rec.table}\` — index on (${rec.columns.join(', ')})`,
        ``,
        rec.reason,
        ``,
        `\`\`\`sql`,
        rec.sqlStatement,
        `\`\`\``,
        ``
      )
    }
  }

  if (output.schemaImprovements.length > 0) {
    lines.push(`## Schema Improvements`, ``, ...output.schemaImprovements.map((s) => `- ${s}`), ``)
  }

  return lines.filter((l) => l !== undefined).join('\n')
}

// ---------------------------------------------------------------------------
// runDbOptimizerAgent – entry point
// ---------------------------------------------------------------------------

export async function runDbOptimizerAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  log.info({ taskId: task.id, title: task.title }, 'DB Optimizer Agent: starting')

  const projectId = task.project_id ?? (task.metadata['project_id'] as string | undefined)
  const projectName = (task.metadata['project_name'] as string | undefined) ?? task.title

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

  const systemPrompt = `You are the DB Optimizer Agent of WAI (Wawen Autonomous Industries).
Your role: review database schemas and query patterns to identify performance issues, missing indexes, N+1 queries, and design anti-patterns.

Analysis areas:
1. **Missing indexes** — identify columns frequently used in WHERE/JOIN/ORDER BY without indexes
2. **N+1 queries** — find ORM patterns or loops that trigger repeated DB calls
3. **Schema design** — normalization issues, missing foreign keys, inappropriate data types
4. **Slow queries** — identify query patterns that will degrade under load
5. **Anti-patterns** — SELECT *, unnecessary JOINs, missing pagination, unbounded queries

For each issue:
- Provide the exact SQL migration or code fix
- Estimate the performance impact (e.g., "reduces query from O(n²) to O(n log n)")

DB Health Score: 1-10 where 10 = excellent, 1 = critical issues requiring immediate action.

Respond with ONLY a JSON object — no markdown, no text outside JSON:
{
  "title": "<DB optimization report title>",
  "overallScore": <1-10 health score>,
  "summary": "<2-3 sentences: overall DB health and most impactful issues>",
  "estimatedPerformanceGain": "<e.g. '40-60% query time reduction if top 3 indexes added'>",
  "issues": [
    {
      "severity": "<critical | high | medium | low>",
      "type": "<missing_index | n_plus_1 | schema_design | slow_query | anti_pattern | normalization | other>",
      "title": "<issue title>",
      "description": "<what the issue is and why it matters>",
      "location": "<table name, file path, or query pattern>",
      "estimatedImpact": "<performance impact description>",
      "fix": "<exact SQL or code fix>"
    }
  ],
  "indexRecommendations": [
    {
      "table": "<table name>",
      "columns": ["<col1>", "<col2>"],
      "reason": "<why this index is needed>",
      "sqlStatement": "<CREATE INDEX ... SQL>"
    }
  ],
  "n1QueryLocations": ["<file:line or pattern description>"],
  "schemaImprovements": ["<improvement 1>", "<improvement 2>"]
}`

  const userMessage = [
    `Project: ${projectName}`,
    `Task: ${task.description}`,
    task.metadata['schema_context']
      ? `\nDB Schema:\n${task.metadata['schema_context'] as string}`
      : '',
    task.metadata['query_context']
      ? `\nQuery patterns / ORM code:\n${task.metadata['query_context'] as string}`
      : '',
    `\nAnalyze the database and produce an optimization report.`,
  ].filter(Boolean).join('\n')

  await updateTaskStatus(task.id, 'in_progress')

  try {
    const result = await runAgent(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      {
        agentId: 'db_optimizer',
        taskId: task.id,
        taskType: 'analysis',
        requiresComplex: false,
        captureMemory: false,
        ...(projectId ? { projectId } : {}),
        ...(clientId ? { clientId } : {}),
      }
    )

    const dbOutput = parseDbOptimizer(result.content)
    if (!dbOutput) {
      throw new Error(
        `DB Optimizer could not parse output: ${result.content.substring(0, 200)}`
      )
    }

    let outputPath: string | null = null
    if (workspaceAbsPath) {
      const deliverableDir = join(workspaceAbsPath, 'deliverables')
      await mkdir(deliverableDir, { recursive: true })
      outputPath = join(deliverableDir, 'db-optimization-report.md')
      await writeFile(outputPath, dbOptimizationToMarkdown(dbOutput, projectName), 'utf-8')
    }

    const criticalCount = dbOutput.issues.filter((i) => i.severity === 'critical').length
    const highCount = dbOutput.issues.filter((i) => i.severity === 'high').length

    await recordEvent('task_completed', {
      agentId: 'db_optimizer',
      taskId: task.id,
      payload: {
        report_title: dbOutput.title,
        overall_score: dbOutput.overallScore,
        issues_count: dbOutput.issues.length,
        critical_count: criticalCount,
        n1_locations: dbOutput.n1QueryLocations.length,
        index_recommendations: dbOutput.indexRecommendations.length,
        output_path: outputPath,
        model_used: result.modelId,
        cost_usd: result.costUsd,
      },
    })

    await updateTaskStatus(task.id, 'done')

    const scoreEmoji = dbOutput.overallScore >= 8 ? '🟢' : dbOutput.overallScore >= 5 ? '🟡' : '🔴'

    const notifyLines = [
      `🗄️ *DB Optimizer — Report Pronto*`,
      ``,
      `🎯 *${dbOutput.title}*`,
      ``,
      `${scoreEmoji} **DB Health Score: ${dbOutput.overallScore}/10**`,
      `📊 ${dbOutput.issues.length} issues: ${criticalCount} critici, ${highCount} alti`,
      dbOutput.indexRecommendations.length > 0
        ? `🔍 ${dbOutput.indexRecommendations.length} index mancanti`
        : '',
      dbOutput.n1QueryLocations.length > 0
        ? `⚡ ${dbOutput.n1QueryLocations.length} N+1 query locations`
        : '',
      ``,
      `📝 ${dbOutput.summary}`,
      dbOutput.estimatedPerformanceGain
        ? `\n📈 ${dbOutput.estimatedPerformanceGain}`
        : '',
      outputPath ? `\n💾 Saved: \`${outputPath}\`` : '',
    ].filter((l) => l !== '').join('\n')

    await notify(notifyLines)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    log.error({ err, taskId: task.id }, 'DB Optimizer Agent error')

    await recordEvent('agent_error', {
      agentId: 'db_optimizer',
      taskId: task.id,
      payload: { error: errorMessage },
      severity: 'error',
    })

    await updateTaskStatus(task.id, 'blocked').catch(() => {})

    await notify(
      [
        `❌ *DB Optimizer Error*`,
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
