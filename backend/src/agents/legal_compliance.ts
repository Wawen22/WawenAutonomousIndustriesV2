// ============================================================
// WAI – Legal Compliance Agent
// Review contratti, GDPR compliance, privacy policy, termini
// di servizio. Solo analisi e raccomandazioni — non da consigli
// legali vincolanti.
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

type ComplianceStatus = 'compliant' | 'partial' | 'non_compliant' | 'unknown'
type FindingSeverity = 'critical' | 'high' | 'medium' | 'low'

interface ComplianceFinding {
  area: string
  status: ComplianceStatus
  severity: FindingSeverity
  issue: string
  recommendation: string
  legalReference?: string
}

interface LegalComplianceOutput {
  title: string
  overallCompliance: ComplianceStatus
  executiveSummary: string
  findings: ComplianceFinding[]
  gdprStatus: ComplianceStatus
  gdprGaps: string[]
  privacyPolicyStatus: ComplianceStatus
  tosStatus: ComplianceStatus
  criticalIssues: string[]
  recommendations: string[]
  disclaimer: string
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

const COMPLIANCE_VALUES: ComplianceStatus[] = ['compliant', 'partial', 'non_compliant', 'unknown']

function parseComplianceFinding(value: unknown): ComplianceFinding | null {
  if (typeof value !== 'object' || value === null) return null
  const f = value as Record<string, unknown>
  if (typeof f['area'] !== 'string' || typeof f['issue'] !== 'string') return null

  return {
    area: f['area'],
    status: COMPLIANCE_VALUES.includes(f['status'] as ComplianceStatus)
      ? (f['status'] as ComplianceStatus)
      : 'unknown',
    severity: ['critical', 'high', 'medium', 'low'].includes(f['severity'] as string)
      ? (f['severity'] as FindingSeverity)
      : 'medium',
    issue: f['issue'],
    recommendation: typeof f['recommendation'] === 'string' ? f['recommendation'] : '',
    ...(typeof f['legalReference'] === 'string' ? { legalReference: f['legalReference'] } : {}),
  }
}

function parseLegalCompliance(raw: string): LegalComplianceOutput | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  } catch {
    return null
  }

  const { title, executiveSummary } = parsed
  if (typeof title !== 'string' || typeof executiveSummary !== 'string') return null

  return {
    title,
    overallCompliance: COMPLIANCE_VALUES.includes(parsed['overallCompliance'] as ComplianceStatus)
      ? (parsed['overallCompliance'] as ComplianceStatus)
      : 'unknown',
    executiveSummary,
    findings: Array.isArray(parsed['findings'])
      ? parsed['findings'].map(parseComplianceFinding).filter((f): f is ComplianceFinding => f !== null)
      : [],
    gdprStatus: COMPLIANCE_VALUES.includes(parsed['gdprStatus'] as ComplianceStatus)
      ? (parsed['gdprStatus'] as ComplianceStatus)
      : 'unknown',
    gdprGaps: Array.isArray(parsed['gdprGaps']) ? (parsed['gdprGaps'] as string[]) : [],
    privacyPolicyStatus: COMPLIANCE_VALUES.includes(parsed['privacyPolicyStatus'] as ComplianceStatus)
      ? (parsed['privacyPolicyStatus'] as ComplianceStatus)
      : 'unknown',
    tosStatus: COMPLIANCE_VALUES.includes(parsed['tosStatus'] as ComplianceStatus)
      ? (parsed['tosStatus'] as ComplianceStatus)
      : 'unknown',
    criticalIssues: Array.isArray(parsed['criticalIssues']) ? (parsed['criticalIssues'] as string[]) : [],
    recommendations: Array.isArray(parsed['recommendations']) ? (parsed['recommendations'] as string[]) : [],
    disclaimer: typeof parsed['disclaimer'] === 'string'
      ? parsed['disclaimer']
      : 'This analysis is for informational purposes only and does not constitute legal advice. Consult a qualified legal professional for binding decisions.',
  }
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

function complianceToMarkdown(output: LegalComplianceOutput, projectName: string, clientName: string): string {
  const now = new Date().toISOString().split('T')[0]!
  const statusEmoji: Record<string, string> = {
    compliant: '✅', partial: '⚠️', non_compliant: '❌', unknown: '❓',
  }
  const severityEmoji: Record<string, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' }

  const lines = [
    `# ${output.title}`,
    ``,
    `**Project:** ${projectName}`,
    `**Client:** ${clientName}`,
    `**Date:** ${now}`,
    `**Overall Compliance:** ${statusEmoji[output.overallCompliance] ?? ''} ${output.overallCompliance.replace(/_/g, ' ')}`,
    ``,
    `> ⚠️ **Disclaimer:** ${output.disclaimer}`,
    ``,
    `---`,
    ``,
    `## Executive Summary`,
    ``,
    output.executiveSummary,
    ``,
    `## Compliance Overview`,
    ``,
    `| Area | Status |`,
    `|------|--------|`,
    `| GDPR | ${statusEmoji[output.gdprStatus] ?? ''} ${output.gdprStatus.replace(/_/g, ' ')} |`,
    `| Privacy Policy | ${statusEmoji[output.privacyPolicyStatus] ?? ''} ${output.privacyPolicyStatus.replace(/_/g, ' ')} |`,
    `| Terms of Service | ${statusEmoji[output.tosStatus] ?? ''} ${output.tosStatus.replace(/_/g, ' ')} |`,
    ``,
  ]

  if (output.criticalIssues.length > 0) {
    lines.push(`## Critical Issues 🔴`, ``, ...output.criticalIssues.map((i) => `- ${i}`), ``)
  }

  if (output.gdprGaps.length > 0) {
    lines.push(`## GDPR Gaps`, ``, ...output.gdprGaps.map((g) => `- ${g}`), ``)
  }

  lines.push(`## Findings (${output.findings.length})`, ``)

  const sorted = [...output.findings].sort((a, b) => {
    const order: FindingSeverity[] = ['critical', 'high', 'medium', 'low']
    return order.indexOf(a.severity) - order.indexOf(b.severity)
  })

  for (const f of sorted) {
    lines.push(
      `### ${severityEmoji[f.severity] ?? ''} ${statusEmoji[f.status] ?? ''} ${f.area}`,
      ``,
      `**Status:** ${f.status.replace(/_/g, ' ')} | **Severity:** ${f.severity}`,
      f.legalReference ? `**Legal Reference:** ${f.legalReference}` : '',
      ``,
      `**Issue:** ${f.issue}`,
      ``,
      `**Recommendation:** ${f.recommendation}`,
      ``
    )
  }

  if (output.recommendations.length > 0) {
    lines.push(`## Recommendations`, ``, ...output.recommendations.map((r, i) => `${i + 1}. ${r}`), ``)
  }

  return lines.filter((l) => l !== '').join('\n')
}

// ---------------------------------------------------------------------------
// runLegalComplianceAgent – entry point
// ---------------------------------------------------------------------------

export async function runLegalComplianceAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  log.info({ taskId: task.id, title: task.title }, 'Legal Compliance Agent: starting')

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

  const systemPrompt = `You are the Legal Compliance Agent of WAI (Wawen Autonomous Industries).
Your role: analyze contracts, privacy policies, terms of service, and GDPR compliance posture.

IMPORTANT: You provide analysis and recommendations ONLY. You do NOT provide binding legal advice. Always include a disclaimer.

Analysis areas:
1. **GDPR Compliance** — lawful basis for processing, data subject rights, DPA obligations, data retention, consent mechanisms, cookie policies
2. **Privacy Policy** — completeness, accuracy, plain language, required disclosures
3. **Terms of Service / Contracts** — unfair terms, missing clauses, liability exposure, IP ownership
4. **Data Security obligations** — technical and organizational measures required by regulation
5. **Third-party processors** — DPA agreements with vendors, sub-processors

For each finding, cite the relevant regulation or legal reference where possible.

Respond with ONLY a JSON object — no markdown, no text outside JSON:
{
  "title": "<compliance review title>",
  "overallCompliance": "<compliant | partial | non_compliant | unknown>",
  "executiveSummary": "<2-3 sentences: overall compliance posture and most critical gaps>",
  "findings": [
    {
      "area": "<e.g. GDPR Art. 13 disclosure | Cookie consent | Contract liability cap>",
      "status": "<compliant | partial | non_compliant | unknown>",
      "severity": "<critical | high | medium | low>",
      "issue": "<what is missing or non-compliant>",
      "recommendation": "<specific action to remediate>",
      "legalReference": "<e.g. GDPR Art. 13, PECR Reg. 6>"
    }
  ],
  "gdprStatus": "<compliant | partial | non_compliant | unknown>",
  "gdprGaps": ["<gap 1>", "<gap 2>"],
  "privacyPolicyStatus": "<compliant | partial | non_compliant | unknown>",
  "tosStatus": "<compliant | partial | non_compliant | unknown>",
  "criticalIssues": ["<critical issue 1>"],
  "recommendations": ["<prioritized recommendation 1>", "<recommendation 2>"],
  "disclaimer": "This analysis is for informational purposes only and does not constitute legal advice. Consult a qualified legal professional before making legal decisions."
}`

  const userMessage = [
    `Project: ${projectName}`,
    `Client: ${clientName}`,
    `Task: ${task.description}`,
    task.metadata['document_content']
      ? `\nDocument to review:\n${task.metadata['document_content'] as string}`
      : '',
    task.metadata['jurisdiction']
      ? `\nJurisdiction: ${task.metadata['jurisdiction'] as string}`
      : '',
    `\nAnalyze the compliance posture and produce a detailed review.`,
  ].filter(Boolean).join('\n')

  await updateTaskStatus(task.id, 'in_progress')

  try {
    const result = await runAgent(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      {
        agentId: 'legal_compliance',
        taskId: task.id,
        taskType: 'analysis',
        requiresComplex: true,
        captureMemory: false,
        ...(projectId ? { projectId } : {}),
        ...(clientId ? { clientId } : {}),
      }
    )

    const complianceOutput = parseLegalCompliance(result.content)
    if (!complianceOutput) {
      throw new Error(
        `Legal Compliance Agent could not parse output: ${result.content.substring(0, 200)}`
      )
    }

    let outputPath: string | null = null
    if (workspaceAbsPath) {
      const deliverableDir = join(workspaceAbsPath, 'deliverables')
      await mkdir(deliverableDir, { recursive: true })
      outputPath = join(deliverableDir, 'legal-compliance-review.md')
      await writeFile(outputPath, complianceToMarkdown(complianceOutput, projectName, clientName), 'utf-8')
    }

    const statusEmoji: Record<string, string> = {
      compliant: '✅', partial: '⚠️', non_compliant: '❌', unknown: '❓',
    }

    await recordEvent('task_completed', {
      agentId: 'legal_compliance',
      taskId: task.id,
      payload: {
        review_title: complianceOutput.title,
        overall_compliance: complianceOutput.overallCompliance,
        findings_count: complianceOutput.findings.length,
        critical_issues_count: complianceOutput.criticalIssues.length,
        gdpr_status: complianceOutput.gdprStatus,
        output_path: outputPath,
        model_used: result.modelId,
        cost_usd: result.costUsd,
      },
    })

    await updateTaskStatus(task.id, 'done')

    const notifyLines = [
      `⚖️ *Legal Compliance — Review Completata*`,
      ``,
      `🎯 *${complianceOutput.title}*`,
      `👤 ${clientName} | ${projectName}`,
      ``,
      `${statusEmoji[complianceOutput.overallCompliance] ?? ''} **Overall: ${complianceOutput.overallCompliance.replace(/_/g, ' ').toUpperCase()}**`,
      ``,
      `📋 GDPR: ${statusEmoji[complianceOutput.gdprStatus] ?? ''} ${complianceOutput.gdprStatus.replace(/_/g, ' ')}`,
      `📄 Privacy Policy: ${statusEmoji[complianceOutput.privacyPolicyStatus] ?? ''} ${complianceOutput.privacyPolicyStatus.replace(/_/g, ' ')}`,
      `📝 ToS: ${statusEmoji[complianceOutput.tosStatus] ?? ''} ${complianceOutput.tosStatus.replace(/_/g, ' ')}`,
      ``,
      complianceOutput.criticalIssues.length > 0
        ? `🔴 *${complianceOutput.criticalIssues.length} critical issues trovati*`
        : '',
      ``,
      `📝 ${complianceOutput.executiveSummary}`,
      ``,
      `⚠️ _Questa analisi non costituisce consulenza legale vincolante._`,
      outputPath ? `\n💾 Saved: \`${outputPath}\`` : '',
    ].filter((l) => l !== '').join('\n')

    await notify(notifyLines)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    log.error({ err, taskId: task.id }, 'Legal Compliance Agent error')

    await recordEvent('agent_error', {
      agentId: 'legal_compliance',
      taskId: task.id,
      payload: { error: errorMessage },
      severity: 'error',
    })

    await updateTaskStatus(task.id, 'blocked').catch(() => {})

    await notify(
      [
        `❌ *Legal Compliance Error*`,
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
