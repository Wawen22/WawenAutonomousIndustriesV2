// ============================================================
// WAI – Security Auditor Agent
// Analizza sicurezza di codice, infrastruttura e dipendenze.
// Cerca vulnerabilità, OWASP top 10, secrets esposti.
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

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'
type RiskLevel = 'critical' | 'high' | 'medium' | 'low'

interface SecurityFinding {
  severity: Severity
  category: string
  title: string
  description: string
  location: string
  recommendation: string
  owaspCategory?: string
}

interface SecurityAuditOutput {
  title: string
  overallRisk: RiskLevel
  summary: string
  findings: SecurityFinding[]
  owaspCategoriesFound: string[]
  secretsExposed: boolean
  actionPlan: string[]
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

function parseFinding(value: unknown): SecurityFinding | null {
  if (typeof value !== 'object' || value === null) return null
  const f = value as Record<string, unknown>
  if (typeof f['title'] !== 'string' || typeof f['description'] !== 'string') return null

  return {
    severity: ['critical', 'high', 'medium', 'low', 'info'].includes(f['severity'] as string)
      ? (f['severity'] as Severity)
      : 'medium',
    category: typeof f['category'] === 'string' ? f['category'] : 'general',
    title: f['title'],
    description: f['description'],
    location: typeof f['location'] === 'string' ? f['location'] : 'unknown',
    recommendation: typeof f['recommendation'] === 'string' ? f['recommendation'] : '',
    ...(typeof f['owaspCategory'] === 'string' ? { owaspCategory: f['owaspCategory'] } : {}),
  }
}

function parseSecurityAudit(raw: string): SecurityAuditOutput | null {
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
    overallRisk: ['critical', 'high', 'medium', 'low'].includes(parsed['overallRisk'] as string)
      ? (parsed['overallRisk'] as RiskLevel)
      : 'medium',
    summary,
    findings: Array.isArray(parsed['findings'])
      ? parsed['findings'].map(parseFinding).filter((f): f is SecurityFinding => f !== null)
      : [],
    owaspCategoriesFound: Array.isArray(parsed['owaspCategoriesFound'])
      ? (parsed['owaspCategoriesFound'] as string[])
      : [],
    secretsExposed: typeof parsed['secretsExposed'] === 'boolean' ? parsed['secretsExposed'] : false,
    actionPlan: Array.isArray(parsed['actionPlan']) ? (parsed['actionPlan'] as string[]) : [],
  }
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

function auditToMarkdown(audit: SecurityAuditOutput, projectName: string): string {
  const now = new Date().toISOString().split('T')[0]!
  const riskEmoji: Record<string, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' }
  const severityEmoji: Record<string, string> = {
    critical: '🔴', high: '🟠', medium: '🟡', low: '🟢', info: '🔵',
  }

  const lines = [
    `# ${audit.title}`,
    ``,
    `**Project:** ${projectName}`,
    `**Date:** ${now}`,
    `**Overall Risk:** ${riskEmoji[audit.overallRisk] ?? ''} ${audit.overallRisk.toUpperCase()}`,
    `**Secrets Exposed:** ${audit.secretsExposed ? '⚠️ YES — CRITICAL' : '✅ None detected'}`,
    ``,
    `---`,
    ``,
    `## Summary`,
    ``,
    audit.summary,
    ``,
  ]

  if (audit.owaspCategoriesFound.length > 0) {
    lines.push(`## OWASP Categories Found`, ``, ...audit.owaspCategoriesFound.map((c) => `- ${c}`), ``)
  }

  lines.push(`## Findings (${audit.findings.length})`, ``)

  const sortOrder: Severity[] = ['critical', 'high', 'medium', 'low', 'info']
  const sortedFindings = [...audit.findings].sort(
    (a, b) => sortOrder.indexOf(a.severity) - sortOrder.indexOf(b.severity)
  )

  for (const f of sortedFindings) {
    lines.push(
      `### ${severityEmoji[f.severity] ?? ''} [${f.severity.toUpperCase()}] ${f.title}`,
      ``,
      `**Category:** ${f.category}`,
      `**Location:** \`${f.location}\``,
      f.owaspCategory ? `**OWASP:** ${f.owaspCategory}` : '',
      ``,
      f.description,
      ``,
      `**Recommendation:** ${f.recommendation}`,
      ``
    )
  }

  if (audit.actionPlan.length > 0) {
    lines.push(
      `## Action Plan`,
      ``,
      ...audit.actionPlan.map((step, i) => `${i + 1}. ${step}`),
      ``
    )
  }

  return lines.filter((l) => l !== '').join('\n')
}

// ---------------------------------------------------------------------------
// runSecurityAuditorAgent – entry point
// ---------------------------------------------------------------------------

export async function runSecurityAuditorAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  log.info({ taskId: task.id, title: task.title }, 'Security Auditor Agent: starting')

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

  const systemPrompt = `You are the Security Auditor Agent of WAI (Wawen Autonomous Industries).
Your role: analyze code, infrastructure configuration, and dependencies for security vulnerabilities.

Focus areas:
- OWASP Top 10 vulnerabilities
- Exposed secrets, API keys, or credentials in code/config
- Authentication and authorization flaws
- Input validation and injection vulnerabilities (SQL, XSS, command injection)
- Insecure dependencies and outdated packages
- Misconfigured infrastructure (CORS, headers, TLS)
- Access control and privilege escalation risks

Rules:
- Be specific: name exact files, functions, or config fields where issues exist.
- Distinguish confirmed vulnerabilities from potential risks.
- Prioritize findings by severity: critical > high > medium > low > info.
- Do NOT suggest theoretical fixes — give concrete, implementable recommendations.

Respond with ONLY a JSON object — no markdown, no text outside JSON:
{
  "title": "<security audit title>",
  "overallRisk": "<critical | high | medium | low>",
  "summary": "<2-3 sentences: overall security posture and most critical issues>",
  "findings": [
    {
      "severity": "<critical | high | medium | low | info>",
      "category": "<e.g. Injection | Broken Auth | Exposed Secret | Misconfiguration | ...>",
      "title": "<short finding title>",
      "description": "<what is the issue and why is it dangerous>",
      "location": "<file path, endpoint, or config key>",
      "recommendation": "<specific fix or mitigation>",
      "owaspCategory": "<OWASP Top 10 category if applicable, e.g. A03:2021-Injection>"
    }
  ],
  "owaspCategoriesFound": ["<OWASP category 1>", "<OWASP category 2>"],
  "secretsExposed": <true if any credentials/API keys/tokens found in code>,
  "actionPlan": ["<step 1>", "<step 2>", "<step 3>"]
}`

  const userMessage = [
    `Project: ${projectName}`,
    `Task: ${task.description}`,
    task.metadata['code_context']
      ? `\nCode/config to audit:\n${task.metadata['code_context'] as string}`
      : '',
    task.metadata['repo_url'] ? `\nRepo: ${task.metadata['repo_url'] as string}` : '',
    `\nPerform a thorough security audit. Flag every confirmed or potential vulnerability.`,
  ].filter(Boolean).join('\n')

  await updateTaskStatus(task.id, 'in_progress')

  try {
    const result = await runAgent(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      {
        agentId: 'security_auditor',
        taskId: task.id,
        taskType: 'analysis',
        requiresComplex: true,
        captureMemory: false,
        ...(projectId ? { projectId } : {}),
        ...(clientId ? { clientId } : {}),
      }
    )

    const audit = parseSecurityAudit(result.content)
    if (!audit) {
      throw new Error(
        `Security Auditor could not parse output: ${result.content.substring(0, 200)}`
      )
    }

    let outputPath: string | null = null
    if (workspaceAbsPath) {
      const deliverableDir = join(workspaceAbsPath, 'deliverables')
      await mkdir(deliverableDir, { recursive: true })
      outputPath = join(deliverableDir, 'security-audit.md')
      await writeFile(outputPath, auditToMarkdown(audit, projectName), 'utf-8')
    }

    const criticalCount = audit.findings.filter((f) => f.severity === 'critical').length
    const highCount = audit.findings.filter((f) => f.severity === 'high').length

    await recordEvent('task_completed', {
      agentId: 'security_auditor',
      taskId: task.id,
      payload: {
        audit_title: audit.title,
        overall_risk: audit.overallRisk,
        findings_count: audit.findings.length,
        critical_count: criticalCount,
        high_count: highCount,
        secrets_exposed: audit.secretsExposed,
        owasp_categories: audit.owaspCategoriesFound,
        output_path: outputPath,
        model_used: result.modelId,
        cost_usd: result.costUsd,
      },
    })

    await updateTaskStatus(task.id, 'done')

    const riskEmoji: Record<string, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' }

    const notifyLines = [
      `🔐 *Security Auditor — Audit Completato*`,
      ``,
      `🎯 *${audit.title}*`,
      ``,
      `${riskEmoji[audit.overallRisk] ?? ''} **Overall Risk: ${audit.overallRisk.toUpperCase()}**`,
      audit.secretsExposed ? `\n⚠️ *ATTENZIONE: Secrets/credenziali esposte nel codice!*` : '',
      ``,
      `📊 *${audit.findings.length} findings:* ${criticalCount} critici, ${highCount} alti`,
      ``,
      `📝 ${audit.summary}`,
      audit.owaspCategoriesFound.length > 0
        ? `\n🛡️ *OWASP:* ${audit.owaspCategoriesFound.slice(0, 3).join(', ')}`
        : '',
      outputPath ? `\n💾 Saved: \`${outputPath}\`` : '',
    ].filter((l) => l !== '').join('\n')

    await notify(notifyLines)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    log.error({ err, taskId: task.id }, 'Security Auditor Agent error')

    await recordEvent('agent_error', {
      agentId: 'security_auditor',
      taskId: task.id,
      payload: { error: errorMessage },
      severity: 'error',
    })

    await updateTaskStatus(task.id, 'blocked').catch(() => {})

    await notify(
      [
        `❌ *Security Auditor Error*`,
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
