// ============================================================
// WAI – API Tester Agent
// Test automatico endpoint API: autenticazione, edge case,
// contract testing, response validation.
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

type TestStatus = 'pass' | 'fail' | 'warning' | 'skipped'

interface ApiTestCase {
  endpoint: string
  method: string
  scenario: string
  status: TestStatus
  expectedBehavior: string
  actualBehavior: string
  issue?: string
  recommendation?: string
}

interface ApiTestOutput {
  title: string
  overallStatus: 'pass' | 'fail' | 'partial'
  totalTests: number
  passed: number
  failed: number
  warnings: number
  coverageSummary: string
  testCases: ApiTestCase[]
  contractIssues: string[]
  authFindings: string[]
  recommendations: string[]
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

function parseTestCase(value: unknown): ApiTestCase | null {
  if (typeof value !== 'object' || value === null) return null
  const t = value as Record<string, unknown>
  if (typeof t['endpoint'] !== 'string' || typeof t['scenario'] !== 'string') return null

  return {
    endpoint: t['endpoint'],
    method: typeof t['method'] === 'string' ? t['method'] : 'GET',
    scenario: t['scenario'],
    status: ['pass', 'fail', 'warning', 'skipped'].includes(t['status'] as string)
      ? (t['status'] as TestStatus)
      : 'skipped',
    expectedBehavior: typeof t['expectedBehavior'] === 'string' ? t['expectedBehavior'] : '',
    actualBehavior: typeof t['actualBehavior'] === 'string' ? t['actualBehavior'] : '',
    ...(typeof t['issue'] === 'string' ? { issue: t['issue'] } : {}),
    ...(typeof t['recommendation'] === 'string' ? { recommendation: t['recommendation'] } : {}),
  }
}

function parseApiTestOutput(raw: string): ApiTestOutput | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  } catch {
    return null
  }

  const { title, coverageSummary } = parsed
  if (typeof title !== 'string') return null

  const testCases = Array.isArray(parsed['testCases'])
    ? parsed['testCases'].map(parseTestCase).filter((t): t is ApiTestCase => t !== null)
    : []

  const passed = testCases.filter((t) => t.status === 'pass').length
  const failed = testCases.filter((t) => t.status === 'fail').length
  const warnings = testCases.filter((t) => t.status === 'warning').length

  return {
    title,
    overallStatus:
      failed > 0 ? 'fail' : warnings > 0 ? 'partial' : 'pass',
    totalTests: testCases.length,
    passed,
    failed,
    warnings,
    coverageSummary: typeof coverageSummary === 'string' ? coverageSummary : '',
    testCases,
    contractIssues: Array.isArray(parsed['contractIssues']) ? (parsed['contractIssues'] as string[]) : [],
    authFindings: Array.isArray(parsed['authFindings']) ? (parsed['authFindings'] as string[]) : [],
    recommendations: Array.isArray(parsed['recommendations']) ? (parsed['recommendations'] as string[]) : [],
  }
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

function apiTestToMarkdown(output: ApiTestOutput, projectName: string): string {
  const now = new Date().toISOString().split('T')[0]!
  const statusEmoji: Record<string, string> = { pass: '✅', fail: '❌', warning: '⚠️', skipped: '⏭️' }
  const overallEmoji: Record<string, string> = { pass: '✅', fail: '❌', partial: '⚠️' }

  const lines = [
    `# ${output.title}`,
    ``,
    `**Project:** ${projectName}`,
    `**Date:** ${now}`,
    `**Overall Status:** ${overallEmoji[output.overallStatus] ?? ''} ${output.overallStatus.toUpperCase()}`,
    `**Tests:** ${output.passed}/${output.totalTests} passed | ${output.failed} failed | ${output.warnings} warnings`,
    ``,
    `---`,
    ``,
    `## Coverage Summary`,
    ``,
    output.coverageSummary,
    ``,
  ]

  if (output.authFindings.length > 0) {
    lines.push(`## Authentication Findings`, ``, ...output.authFindings.map((f) => `- 🔐 ${f}`), ``)
  }

  if (output.contractIssues.length > 0) {
    lines.push(`## Contract Issues`, ``, ...output.contractIssues.map((i) => `- ⚠️ ${i}`), ``)
  }

  lines.push(`## Test Cases`, ``)

  const failedFirst = [...output.testCases].sort((a, b) => {
    const order: TestStatus[] = ['fail', 'warning', 'skipped', 'pass']
    return order.indexOf(a.status) - order.indexOf(b.status)
  })

  for (const t of failedFirst) {
    lines.push(
      `### ${statusEmoji[t.status] ?? ''} \`${t.method} ${t.endpoint}\` — ${t.scenario}`,
      ``,
      `- **Expected:** ${t.expectedBehavior}`,
      `- **Actual:** ${t.actualBehavior}`,
      t.issue ? `- **Issue:** ${t.issue}` : '',
      t.recommendation ? `- **Fix:** ${t.recommendation}` : '',
      ``
    )
  }

  if (output.recommendations.length > 0) {
    lines.push(`## Recommendations`, ``, ...output.recommendations.map((r) => `- ${r}`), ``)
  }

  return lines.filter((l) => l !== '').join('\n')
}

// ---------------------------------------------------------------------------
// runApiTesterAgent – entry point
// ---------------------------------------------------------------------------

export async function runApiTesterAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  log.info({ taskId: task.id, title: task.title }, 'API Tester Agent: starting')

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

  const systemPrompt = `You are the API Tester Agent of WAI (Wawen Autonomous Industries).
Your role: analyze API endpoints and produce a comprehensive test report covering authentication, edge cases, contract compliance, and response validation.

Test areas to cover for each endpoint:
1. **Authentication & Authorization** — missing auth, broken access control, JWT issues
2. **Input validation** — missing validation, type coercion, SQL/NoSQL injection vectors
3. **Edge cases** — empty payloads, null values, oversized inputs, boundary conditions
4. **Contract testing** — does the response match the documented schema?
5. **Error handling** — proper HTTP status codes, error messages not leaking internals
6. **Rate limiting** — endpoints vulnerable to abuse

Rules:
- For each test case, specify EXACTLY what you'd test and what the expected vs actual behavior should be.
- If you cannot verify actual behavior (no live system), describe the expected behavior and flag as a design review.
- Be practical: focus on the highest-impact test cases, not exhaustive permutations.

Respond with ONLY a JSON object — no markdown, no text outside JSON:
{
  "title": "<API test report title>",
  "coverageSummary": "<what was tested and what coverage was achieved>",
  "testCases": [
    {
      "endpoint": "<path, e.g. /api/users/:id>",
      "method": "<GET|POST|PUT|DELETE|PATCH>",
      "scenario": "<what is being tested>",
      "status": "<pass | fail | warning | skipped>",
      "expectedBehavior": "<what should happen>",
      "actualBehavior": "<what was observed or inferred>",
      "issue": "<issue description if fail/warning>",
      "recommendation": "<fix recommendation if fail/warning>"
    }
  ],
  "contractIssues": ["<contract mismatch 1>"],
  "authFindings": ["<auth issue 1>"],
  "recommendations": ["<recommendation 1>", "<recommendation 2>"]
}`

  const userMessage = [
    `Project: ${projectName}`,
    `Task: ${task.description}`,
    task.metadata['api_spec']
      ? `\nAPI Spec / Endpoints:\n${task.metadata['api_spec'] as string}`
      : '',
    task.metadata['code_context']
      ? `\nRoute definitions / code context:\n${task.metadata['code_context'] as string}`
      : '',
    `\nAnalyze these API endpoints and produce a thorough test report.`,
  ].filter(Boolean).join('\n')

  await updateTaskStatus(task.id, 'in_progress')

  try {
    const result = await runAgent(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      {
        agentId: 'api_tester',
        taskId: task.id,
        taskType: 'analysis',
        requiresComplex: false,
        captureMemory: false,
        ...(projectId ? { projectId } : {}),
        ...(clientId ? { clientId } : {}),
      }
    )

    const testOutput = parseApiTestOutput(result.content)
    if (!testOutput) {
      throw new Error(
        `API Tester could not parse output: ${result.content.substring(0, 200)}`
      )
    }

    let outputPath: string | null = null
    if (workspaceAbsPath) {
      const deliverableDir = join(workspaceAbsPath, 'deliverables')
      await mkdir(deliverableDir, { recursive: true })
      outputPath = join(deliverableDir, 'api-test-report.md')
      await writeFile(outputPath, apiTestToMarkdown(testOutput, projectName), 'utf-8')
    }

    await recordEvent('task_completed', {
      agentId: 'api_tester',
      taskId: task.id,
      payload: {
        report_title: testOutput.title,
        overall_status: testOutput.overallStatus,
        total_tests: testOutput.totalTests,
        passed: testOutput.passed,
        failed: testOutput.failed,
        auth_findings_count: testOutput.authFindings.length,
        contract_issues_count: testOutput.contractIssues.length,
        output_path: outputPath,
        model_used: result.modelId,
        cost_usd: result.costUsd,
      },
    })

    await updateTaskStatus(task.id, 'done')

    const overallEmoji: Record<string, string> = { pass: '✅', fail: '❌', partial: '⚠️' }

    const notifyLines = [
      `🧪 *API Tester — Report Pronto*`,
      ``,
      `🎯 *${testOutput.title}*`,
      ``,
      `${overallEmoji[testOutput.overallStatus] ?? ''} **Overall: ${testOutput.overallStatus.toUpperCase()}**`,
      `📊 ${testOutput.passed}/${testOutput.totalTests} test passati | ${testOutput.failed} falliti | ${testOutput.warnings} warning`,
      testOutput.authFindings.length > 0
        ? `\n🔐 *Auth issues:* ${testOutput.authFindings.length}`
        : '',
      testOutput.contractIssues.length > 0
        ? `\n📋 *Contract issues:* ${testOutput.contractIssues.length}`
        : '',
      ``,
      testOutput.coverageSummary ? `📝 ${testOutput.coverageSummary}` : '',
      outputPath ? `\n💾 Saved: \`${outputPath}\`` : '',
    ].filter((l) => l !== '').join('\n')

    await notify(notifyLines)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    log.error({ err, taskId: task.id }, 'API Tester Agent error')

    await recordEvent('agent_error', {
      agentId: 'api_tester',
      taskId: task.id,
      payload: { error: errorMessage },
      severity: 'error',
    })

    await updateTaskStatus(task.id, 'blocked').catch(() => {})

    await notify(
      [
        `❌ *API Tester Error*`,
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
