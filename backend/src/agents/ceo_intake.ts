// ============================================================
// WAI – CEO Natural Language Intake Handler
// Neb scrive testo libero su Telegram; il CEO capisce, pianifica
// una sequenza di azioni, le esegue tutte in autonomia, e risponde
// con un unico messaggio riassuntivo.
// ============================================================

import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { runAgent } from '../services/llm.js'
import {
  createClient,
  createProject,
  createTask,
  getClientBySlug,
  getClients,
  getPayments,
  getProjects,
  getProjectBySlug,
  getProjectsByClient,
  getRecentEvents,
  getTasksByStatus,
  updateProjectWorkspacePath,
} from '../services/supabase.js'
import {
  createClientWorkspace,
  createProjectWorkspace,
  getRelativeProjectPath,
  getProjectWorkspacePath,
} from '../services/workspace.js'
import { log, recordEvent } from '../services/logger.js'
import { buildSystemStatusReport } from '../services/status_report.js'
import { executeTool } from '../services/tool-executor.js'
import { ensurePersonalProfile, formatPersonalContextForPrompt, getPersonalContext } from '../services/personal-context.js'
import type { WebSearchResponse } from '../services/search.js'
import { callGoogleWorkspaceMcpTool, getGoogleWorkspaceUserEmail } from '../services/google-workspace-mcp.js'
import {
  executeFounderTaskAction,
  formatFounderTaskActionMessage,
} from '../services/founder_task_actions.js'
import {
  executeInvoiceProject,
  executeMarkProjectPaid,
  formatInvoiceProjectMessage,
  formatMarkProjectPaidMessage,
} from '../services/founder_revenue_actions.js'
import { loadAllWorkspaceContext } from './software_delivery_utils.js'
import { runCeoAgent } from './ceo.js'
import type { Client, Payment, Project, ProjectType, SystemEvent, Task } from '../types/index.js'

// ---------------------------------------------------------------------------
// Conversation state (in-memory, per chatId, TTL 10 min)
// ---------------------------------------------------------------------------

interface IntakeContext {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  lastMessageAt: number
}

const CONTEXT_TTL_MS = 10 * 60 * 1000
const _conversations = new Map<string, IntakeContext>()

function getConversation(chatId: string): IntakeContext | null {
  const ctx = _conversations.get(chatId)
  if (!ctx) return null
  if (Date.now() - ctx.lastMessageAt > CONTEXT_TTL_MS) {
    _conversations.delete(chatId)
    return null
  }
  return ctx
}

function saveConversation(chatId: string, ctx: IntakeContext): void {
  _conversations.set(chatId, { ...ctx, lastMessageAt: Date.now() })
}

function clearConversation(chatId: string): void {
  _conversations.delete(chatId)
}

// ---------------------------------------------------------------------------
// Project types
// ---------------------------------------------------------------------------

const PROJECT_TYPES: ProjectType[] = [
  'website', 'app', 'saas', 'consulting', 'ai',
  'marketing', 'content', 'copywriting', 'design', 'automation', 'other',
]

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(clientContext: string): string {
  return `You are the CEO of WAI (Wawen Autonomous Industries), a fully autonomous Zero Human Company.
Neb (the founder) sends you free-text messages on Telegram. Your job: understand the full intent and plan ALL the steps needed to complete it.

## YOUR PHILOSOPHY: MAXIMUM AUTONOMY
- Parse the ENTIRE request at once. Plan ALL steps in one shot.
- Never ask "vuoi che proceda?" or "sei sicuro?". Never ask for confirmation.
- Only ask ONE focused question if you genuinely cannot act without missing critical info.
- Use sensible defaults: project_type = "website" for landing pages/sites, priority = 2, etc.
- Slugs are generated as: lowercase, spaces/special chars → "-", trim dashes. Example: "CasaFacile" → "casafacile", "Wawen22" → "wawen22".
- Be concise. Respond in the same language Neb uses (Italian or English).

## ACTIONS YOU CAN EXECUTE (in sequence)
- create_client      → params: name, email? (auto-generates slug from name)
- create_project     → params: client_slug, project_name, project_type, contract_value_usd?
- write_brief        → params: client_slug, project_slug, brief_text  (use ONLY for NEW projects without a brief)
- update_brief       → params: client_slug, project_slug, update_text  (use when a brief ALREADY EXISTS — appends new info)
- create_task        → params: title, description, client_slug?, project_slug?
- list_clients       → no params
- list_projects      → params: client_slug?
- status_report      → no params
- personal_research  → params: query, title?, filename?
- weekly_digest      → no params
- gmail_inbox_summary → params: query?, limit?
- gmail_latest_message → params: query?
- calendar_today     → params: calendar_id?
- drive_find_file    → params: query, limit?, file_type?
- drive_read_file    → params: file_id?, query?, file_type?
- drive_recent_files → params: days?, limit?, file_type?
- daily_founder_brief → params: inbox_query?, drive_days?
- retry_task         → params: task_ref, reason?
- approve_task       → params: task_ref, reason?
- reject_task        → params: task_ref, reason?
- create_document    → params: title, content, filename?, format?, client_slug?, project_slug?, mode?
- send_report        → params: subject, body, to?, html?
- invoice_project    → params: client_slug, project_slug, amount_usd?
- mark_project_paid  → params: client_slug, project_slug, amount_usd

Valid project types: ${PROJECT_TYPES.join(', ')}

## EXISTING WAI STATE
${clientContext}

## PLANNING RULES
1. If Neb's message implies multiple steps (create client + project + task), include ALL steps in commands[].
2. When you create a client, you know its slug (slugify the name). Use that slug in subsequent commands.
3. When you create a project, you know its slug (slugify the project name). Use that slug in subsequent commands.
4. If client/project already exists (check existing state above), skip the create step and use existing slugs.
5. Only include write_brief / update_brief if Neb explicitly provides project description/goal text. Use write_brief for new projects; use update_brief when the project already exists and Neb is adding/changing requirements (the system will append the text to the existing brief).
6. A task description should be detailed enough for the CEO routing agent to understand the deliverable.
7. Only ask (action: "ask") when you genuinely cannot determine a required field from context.
8. **CRITICAL — ONE TASK PER PROJECT**: When creating work for a project, create EXACTLY ONE create_task command that covers the FULL deliverable. NEVER create 2 or 3 separate tasks for the same project in the same plan — this causes multiple Architect agents to run in parallel and collide on the same repository. One comprehensive task (e.g., "Crea landing page completa per [Client]") is always better than several partial tasks. If Neb asks to "launch tasks" or "start work" on a project, create ONE task that covers everything.
9. When Neb asks to unblock/retry/relaunch a blocked task, use retry_task instead of creating a new task.
10. When Neb asks to approve/confirm a task output, use approve_task. When Neb asks to reject/cancel/discard a task, use reject_task.
11. When Neb asks to invoice a project or mark it paid, use invoice_project / mark_project_paid instead of generic create_task.
12. task_ref may be a full UUID or a unique short prefix such as the 8-char IDs shown in Telegram/dashboard.
13. Use personal_research when Neb asks for a quick web research/report for himself. This should create a personal markdown report in the personal workspace, not a delegable delivery task.
14. Use weekly_digest when Neb asks for a founder recap/summary of the last week. Generate the digest directly instead of creating a task.
15. Use gmail_inbox_summary when Neb asks to check, summarize, or triage his inbox / emails.
16. Use gmail_latest_message when Neb asks for the last/latest email or asks to read the newest email directly.
17. Use calendar_today when Neb asks for today's agenda, meetings, or calendar schedule.
18. Use drive_find_file when Neb asks to find/search a file in Google Drive.
19. Use drive_read_file when Neb asks to open/read the content of a Drive document or file.
20. Use drive_recent_files when Neb asks for recent/recently modified files in Google Drive.
21. Use daily_founder_brief when Neb asks for a daily founder briefing combining inbox, calendar, and recent Drive activity.

## RESPONSE FORMAT — ONLY valid JSON, no markdown, no text outside JSON
{
  "action": "execute" | "ask" | "reply" | "unclear",
  "message": "<shown to Neb — for execute: what you planned to do, shown BEFORE execution>",
  "commands": [
    { "type": "<action>", "params": { <parameters> } }
  ]
}

Rules:
- "commands" array is required when action is "execute" or "reply". Can have 1 or more items.
- Commands execute IN ORDER — use predicted slugs from earlier steps in later steps.
- For "ask": no commands array. "message" = exactly ONE focused question.
- For "unclear": no commands. Politely ask to rephrase.
- For "reply" (list/status queries): single command in array.`
}

// ---------------------------------------------------------------------------
// LLM response type and parser
// ---------------------------------------------------------------------------

interface CommandItem {
  type: string
  params: Record<string, unknown>
}

interface IntentResponse {
  action: 'ask' | 'execute' | 'reply' | 'unclear'
  message: string
  commands?: CommandItem[]
}

function detectFounderShortcutIntent(text: string): IntentResponse | null {
  const normalized = text.trim().toLowerCase()
  if (!normalized) {
    return null
  }

  if (/(daily founder brief|brief giornaliero|brief quotidiano|daily brief)/i.test(normalized)) {
    return {
      action: 'execute',
      message: 'Genero il daily founder brief.',
      commands: [{ type: 'daily_founder_brief', params: {} }],
    }
  }

  if (
    /(file recenti|recent files|recenti su google drive|recenti di google drive|ultimi file.*google drive|google drive.*file recenti)/i.test(normalized) &&
    /google drive|drive/i.test(normalized)
  ) {
    return {
      action: 'execute',
      message: 'Recupero i file recenti da Google Drive.',
      commands: [{ type: 'drive_recent_files', params: {} }],
    }
  }

  if (/(ultima email|latest email|last email|leggi l'ultima email|leggi ultima mail|ultima mail)/i.test(normalized)) {
    return {
      action: 'execute',
      message: 'Recupero l’ultima email.',
      commands: [{ type: 'gmail_latest_message', params: {} }],
    }
  }

  if (/(inbox|email ricevute|riassumimi le email|summary inbox|summarize inbox)/i.test(normalized)) {
    return {
      action: 'execute',
      message: 'Controllo e riassumo la inbox.',
      commands: [{ type: 'gmail_inbox_summary', params: {} }],
    }
  }

  if (/(agenda di oggi|calendar today|today agenda|today calendar|eventi di oggi|riunioni di oggi)/i.test(normalized)) {
    return {
      action: 'execute',
      message: 'Recupero l’agenda di oggi.',
      commands: [{ type: 'calendar_today', params: {} }],
    }
  }

  const driveReadMatch = text.match(/(?:leggi|apri|read|open)\s+(?:il\s+file\s+)?(.+?)\s+(?:su\s+google\s+drive|su\s+drive)$/i)
  if (driveReadMatch?.[1]?.trim()) {
    return {
      action: 'execute',
      message: 'Recupero il contenuto del file da Google Drive.',
      commands: [{ type: 'drive_read_file', params: { query: driveReadMatch[1].trim() } }],
    }
  }

  const driveFindMatch = text.match(/(?:trova|cerca|find|search)\s+(?:su\s+google\s+drive\s+)?(?:il\s+file\s+)?(.+?)(?:\s+su\s+google\s+drive|\s+su\s+drive)?$/i)
  if (driveFindMatch?.[1]?.trim() && /google drive|drive/i.test(normalized)) {
    return {
      action: 'execute',
      message: 'Cerco il file su Google Drive.',
      commands: [{ type: 'drive_find_file', params: { query: driveFindMatch[1].trim() } }],
    }
  }

  return null
}

function parseIntentResponse(raw: string): IntentResponse | null {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>
  } catch {
    return null
  }

  const { action, message } = parsed
  if (
    (action !== 'ask' && action !== 'execute' && action !== 'reply' && action !== 'unclear') ||
    typeof message !== 'string'
  ) {
    return null
  }

  // Parse commands array
  const commands: CommandItem[] = []
  if (Array.isArray(parsed['commands'])) {
    for (const item of parsed['commands']) {
      if (
        typeof item === 'object' && item !== null &&
        typeof (item as Record<string, unknown>)['type'] === 'string'
      ) {
        const cmd = item as Record<string, unknown>
        commands.push({
          type: cmd['type'] as string,
          params: (typeof cmd['params'] === 'object' && cmd['params'] !== null
            ? cmd['params']
            : {}) as Record<string, unknown>,
        })
      }
    }
  }

  return { action: action as IntentResponse['action'], message, commands }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function getString(params: Record<string, unknown>, key: string): string | undefined {
  const v = params[key]
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}

function getNumber(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key]
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.trim().replace(',', '.')
    if (!normalized) return undefined
    const parsed = Number(normalized)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return undefined
}

function buildPersonalResearchFilename(title: string, fallbackQuery: string, explicitFilename?: string): string {
  if (explicitFilename?.trim()) {
    return explicitFilename.trim()
  }

  const base = slugify(title) || slugify(fallbackQuery) || 'personal-research'
  return `${base}.md`
}

function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function startOfTrailingDays(days: number): Date {
  return new Date(Date.now() - (days * 24 * 60 * 60 * 1000))
}

function isOnOrAfter(iso: string | null | undefined, since: Date): boolean {
  if (!iso) return false
  const timestamp = Date.parse(iso)
  return Number.isFinite(timestamp) && timestamp >= since.getTime()
}

function buildWeeklyDigestFilename(now = new Date()): string {
  return `weekly-digest-${now.toISOString().slice(0, 10)}.md`
}

function buildDailyFounderBriefFilename(now = new Date()): string {
  return `daily-founder-brief-${now.toISOString().slice(0, 10)}.md`
}

function buildSearchEvidence(search: WebSearchResponse): string {
  const lines: string[] = []

  if (search.answerBox) {
    lines.push(`Quick answer: ${search.answerBox}`)
    lines.push('')
  }

  lines.push('Sources:')
  for (const item of search.organic) {
    lines.push(`${item.position}. ${item.title}`)
    lines.push(`URL: ${item.url}`)
    lines.push(`Snippet: ${item.snippet || 'n/a'}`)
    lines.push('')
  }

  if (search.relatedQueries.length > 0) {
    lines.push(`Related queries: ${search.relatedQueries.join(' | ')}`)
  }

  return lines.join('\n').trim()
}

function buildFallbackPersonalResearchReport(title: string, search: WebSearchResponse): string {
  const sections: string[] = [
    `# ${title}`,
    '',
    `- Query: ${search.query}`,
    `- Provider: ${search.provider}`,
    `- Generated at: ${new Date().toISOString()}`,
  ]

  if (search.answerBox) {
    sections.push(`- Quick answer: ${search.answerBox}`)
  }

  sections.push('', '## Summary', '')

  if (search.answerBox) {
    sections.push(search.answerBox, '')
  } else {
    sections.push('No direct answer was returned. Review the source list below.', '')
  }

  sections.push('## Sources', '')

  for (const item of search.organic) {
    sections.push(`### ${item.position}. ${item.title}`)
    sections.push(item.url)
    sections.push('')
    sections.push(item.snippet || '_No snippet returned._')
    sections.push('')
  }

  if (search.relatedQueries.length > 0) {
    sections.push('## Related Queries', '')
    for (const query of search.relatedQueries) {
      sections.push(`- ${query}`)
    }
    sections.push('')
  }

  return sections.join('\n').trim()
}

async function buildPersonalResearchReport(title: string, search: WebSearchResponse): Promise<string> {
  const fallback = buildFallbackPersonalResearchReport(title, search)

  try {
    const result = await runAgent([
      {
        role: 'system',
        content: `You are WAI's personal research analyst for the founder.

Write a concise markdown report in the same language as the search query.

Rules:
- Use only the provided search evidence.
- Do not invent facts.
- Keep it practical and founder-oriented.
- Include a short executive summary, key takeaways, and a source list.
- Preserve source URLs exactly as provided.
- If evidence is weak or conflicting, say so clearly.`,
      },
      {
        role: 'user',
        content: `Title: ${title}
Query: ${search.query}
Provider: ${search.provider}

Evidence:
${buildSearchEvidence(search)}`,
      },
    ], {
      agentId: 'ceo',
      taskType: 'analysis',
      requiresComplex: false,
      tools: ['web_search'],
      captureMemory: false,
      timeoutMs: 120_000,
    })

    return result.content.trim() || fallback
  } catch {
    return fallback
  }
}

function extractMessageIdsFromGmailSearch(raw: string, limit: number): string[] {
  const matches = [...raw.matchAll(/Message ID:\s*([A-Za-z0-9_-]+)/g)]
  return matches
    .map((match) => match[1])
    .filter((id): id is string => Boolean(id) && id !== 'unknown')
    .slice(0, limit)
}

interface DriveFileMatch {
  id: string
  name: string
  mimeType?: string
}

function extractDriveFileMatches(raw: string, limit: number): DriveFileMatch[] {
  const matches = [...raw.matchAll(/- Name:\s*"([^"]+)"\s+\(ID:\s*([A-Za-z0-9_-]+),\s*Type:\s*([^,)]+)/g)]
  return matches
    .map((match) => ({
      name: match[1]?.trim() ?? 'Unknown',
      id: match[2]?.trim() ?? '',
      ...(match[3]?.trim() ? { mimeType: match[3].trim() } : {}),
    }))
    .filter((item) => item.id.length > 0)
    .slice(0, limit)
}

function truncateReplyText(value: string, maxChars = 7000): string {
  if (value.length <= maxChars) {
    return value
  }

  return `${value.slice(0, maxChars).trimEnd()}\n\n[truncated]`
}

function formatLocalRfc3339(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  const seconds = pad(date.getSeconds())
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const offsetHours = pad(Math.floor(Math.abs(offsetMinutes) / 60))
  const offsetMins = pad(Math.abs(offsetMinutes) % 60)
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetMins}`
}

function getTodayWindowInLocalTimezone(now = new Date()): { start: string; end: string } {
  const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
  const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
  return {
    start: formatLocalRfc3339(startDate),
    end: formatLocalRfc3339(endDate),
  }
}

async function summarizeFounderInbox(rawInboxMetadata: string, query: string): Promise<string> {
  const fallback = rawInboxMetadata.trim()

  try {
    const result = await runAgent([
      {
        role: 'system',
        content: `You summarize a founder's inbox for action.

Rules:
- Use only the provided email metadata.
- Write in the same language as the query/context.
- Prioritize urgent, revenue, meeting, and blocker signals.
- Output concise markdown with sections: Executive Summary, Immediate Actions, Watchlist.
- If the inbox looks empty or low-signal, say so clearly.`,
      },
      {
        role: 'user',
        content: `Inbox query: ${query}

Email metadata:
${rawInboxMetadata}`,
      },
    ], {
      agentId: 'ceo',
      taskType: 'analysis',
      requiresComplex: false,
      tools: [],
      captureMemory: false,
      timeoutMs: 60_000,
    })

    return result.content.trim() || fallback
  } catch {
    return fallback
  }
}

function normalizeFounderGmailQuery(rawQuery: string): string {
  let query = rawQuery.trim().replace(/newer_than:\s+/gi, 'newer_than:')

  // Defensive fix: LLMs sometimes emit impossible windows like newer_than:1s for "today".
  query = query.replace(/newer_than:(?:[1-9]|[1-5][0-9])s\b/gi, 'newer_than:1d')

  if (!/(?:\bafter:|\bnewer_than:|\bolder_than:)/i.test(query) && /\b(today|oggi)\b/i.test(query)) {
    query = `${query} newer_than:1d`.trim()
  }

  return query
}

function broadenFounderGmailQuery(query: string): string | null {
  if (/newer_than:\d+s\b/i.test(query)) {
    return query.replace(/newer_than:\d+s\b/gi, 'newer_than:1d')
  }

  if (/newer_than:\d+h\b/i.test(query)) {
    return query.replace(/newer_than:\d+h\b/gi, 'newer_than:1d')
  }

  return null
}

function normalizeFounderDriveQuery(rawQuery: string): string {
  const query = rawQuery.trim()
  if (!query) {
    return "trashed = false"
  }

  return query
}

async function resolveDriveFileFromQuery(query: string, fileType?: string): Promise<DriveFileMatch | null> {
  const searchResult = await callGoogleWorkspaceMcpTool('search_drive_files', {
    query: normalizeFounderDriveQuery(query),
    page_size: 5,
    ...(fileType ? { file_type: fileType } : {}),
    detailed: true,
  })

  const matches = extractDriveFileMatches(searchResult.text, 5)
  const nonFolderMatch = matches.find((item) => item.mimeType !== 'application/vnd.google-apps.folder')
  return nonFolderMatch ?? matches[0] ?? null
}

function buildRecentDriveQuery(days: number): string {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  return `modifiedTime > '${since}' and trashed = false`
}

function buildFounderDailyBriefReport(input: {
  founderName: string
  userGoogleEmail: string
  timezone: string
  inboxQuery: string
  inboxSummary: string
  calendarSummary: string
  recentDriveSummary: string
  generatedAt?: Date
}): string {
  const generatedAt = input.generatedAt ?? new Date()
  const sections: string[] = [
    `# Daily Founder Brief — ${generatedAt.toISOString().slice(0, 10)}`,
    '',
    `- Founder: ${input.founderName}`,
    `- Google account: ${input.userGoogleEmail}`,
    `- Timezone: ${input.timezone}`,
    `- Generated at: ${generatedAt.toISOString()}`,
    `- Inbox query: ${input.inboxQuery}`,
    '',
    '## Inbox',
    '',
    input.inboxSummary.trim() || 'No inbox summary available.',
    '',
    '## Calendar Today',
    '',
    input.calendarSummary.trim() || 'No calendar summary available.',
    '',
    '## Recent Drive Activity',
    '',
    input.recentDriveSummary.trim() || 'No recent Drive activity available.',
  ]

  return sections.join('\n').trim()
}

async function summarizeFounderCalendar(rawEvents: string): Promise<string> {
  const fallback = rawEvents.trim()

  try {
    const result = await runAgent([
      {
        role: 'system',
        content: `You summarize a founder's daily calendar.

Rules:
- Use only the provided event list.
- Write concise markdown in the same language as the input.
- Highlight schedule shape, hard commitments, likely gaps, and collision risk.
- If there are no events, say that the day is clear.`,
      },
      {
        role: 'user',
        content: `Calendar events:
${rawEvents}`,
      },
    ], {
      agentId: 'ceo',
      taskType: 'analysis',
      requiresComplex: false,
      tools: [],
      captureMemory: false,
      timeoutMs: 60_000,
    })

    return result.content.trim() || fallback
  } catch {
    return fallback
  }
}

function buildFounderWeeklyDigestReport(input: {
  projects: Project[]
  payments: Payment[]
  recentEvents: SystemEvent[]
  doneTasks: Task[]
  activeTasks: Task[]
  blockedTasks: Task[]
  statusReport: string
  personalWorkspacePath: string
  personalOutputPath: string
  personalDocuments: Array<{ name: string; relativePath: string; modifiedAt: string }>
  connectors: { email: boolean; telegram: boolean }
  founderName: string
  timezone: string
  now?: Date
}): string {
  const now = input.now ?? new Date()
  const since = startOfTrailingDays(7)
  const windowStart = since.toISOString().slice(0, 10)
  const windowEnd = now.toISOString().slice(0, 10)
  const weeklyPayments = input.payments.filter((payment) => isOnOrAfter(payment.received_at, since))
  const weeklyPaidUsd = weeklyPayments.reduce((sum, payment) => sum + toNumber(payment.amount_usd), 0)
  const weeklyDoneTasks = input.doneTasks.filter((task) => isOnOrAfter(task.completed_at, since))
  const weeklyInvoicedUsd = input.recentEvents
    .filter((event) => event.type === 'revenue_recorded' && isOnOrAfter(event.created_at, since))
    .reduce((sum, event) => sum + toNumber(event.payload['contract_value_usd']), 0)

  const activeProjects = input.projects.filter((project) => project.status === 'active')
  const watchProjects = input.projects
    .filter((project) => ['active', 'blocked', 'review', 'invoiced'].includes(project.status))
    .slice(0, 6)

  const notableEvents = input.recentEvents
    .filter((event) => isOnOrAfter(event.created_at, since))
    .filter((event) => ['founder_command', 'task_blocked', 'human_review_requested', 'revenue_recorded', 'payment_received'].includes(event.type))
    .slice(0, 8)

  const sections: string[] = [
    `# Weekly Digest — ${windowEnd}`,
    '',
    `- Founder: ${input.founderName}`,
    `- Timezone: ${input.timezone}`,
    `- Window: ${windowStart} → ${windowEnd}`,
    '',
    '## Executive Snapshot',
    '',
    `- Active projects now: ${activeProjects.length}`,
    `- Active tasks now: ${input.activeTasks.length}`,
    `- Blocked tasks now: ${input.blockedTasks.length}`,
    `- Tasks completed in last 7 days: ${weeklyDoneTasks.length}`,
    `- Revenue invoiced in last 7 days: ${formatUsd(weeklyInvoicedUsd)}`,
    `- Cash collected in last 7 days: ${formatUsd(weeklyPaidUsd)}`,
    `- Personal documents available: ${input.personalDocuments.length}`,
    '',
    '## Projects To Watch',
    '',
  ]

  if (watchProjects.length === 0) {
    sections.push('- No active watchlist projects right now.', '')
  } else {
    for (const project of watchProjects) {
      sections.push(`- ${project.slug} · ${project.type} · ${project.status} · contract ${formatUsd(project.contract_value_usd ?? 0)}`)
    }
    sections.push('')
  }

  sections.push('## Notable Signals', '')
  if (notableEvents.length === 0) {
    sections.push('- No major founder/system events in the last 7 days.', '')
  } else {
    for (const event of notableEvents) {
      const label =
        typeof event.payload['project_slug'] === 'string'
          ? `${event.type} · ${event.payload['project_slug']}`
          : event.type
      sections.push(`- ${event.created_at.slice(0, 10)} · ${label}`)
    }
    sections.push('')
  }

  sections.push('## Personal Workspace', '')
  sections.push(`- Workspace: ${input.personalWorkspacePath}`)
  sections.push(`- Output: ${input.personalOutputPath}`)
  sections.push(`- Connectors: email=${input.connectors.email ? 'ready' : 'missing'} · telegram=${input.connectors.telegram ? 'ready' : 'missing'}`)
  if (input.personalDocuments.length === 0) {
    sections.push('- Recent docs: none', '')
  } else {
    for (const doc of input.personalDocuments.slice(0, 5)) {
      sections.push(`- ${doc.modifiedAt.slice(0, 10)} · ${doc.name} · ${doc.relativePath}`)
    }
    sections.push('')
  }

  sections.push('## Current WAI Status', '', input.statusReport)
  return sections.join('\n').trim()
}

function formatTaskScope(task: Task): string {
  const clientSlug = typeof task.metadata['client_slug'] === 'string' ? task.metadata['client_slug'] : null
  const projectSlug = typeof task.metadata['project_slug'] === 'string' ? task.metadata['project_slug'] : null
  if (clientSlug && projectSlug) {
    return `${clientSlug}/${projectSlug}`
  }

  const clientName = typeof task.metadata['client_name'] === 'string' ? task.metadata['client_name'] : null
  const projectName = typeof task.metadata['project_name'] === 'string' ? task.metadata['project_name'] : null
  if (clientName && projectName) {
    return `${clientName} / ${projectName}`
  }
  if (clientName) {
    return clientName
  }
  return 'n/a'
}

// ---------------------------------------------------------------------------
// Execute a single action — returns a summary line or throws
// ---------------------------------------------------------------------------

async function executeAction(
  command: CommandItem,
  notify: (msg: string) => Promise<void>
): Promise<string> {
  const { type, params } = command

  switch (type) {

    // ── list_clients ─────────────────────────────────────────────────────
    case 'list_clients': {
      const clients = await getClients()
      if (clients.length === 0) {
        return 'Nessun cliente ancora. Scrivimi "crea cliente [nome]" per aggiungerne uno.'
      }
      const icon = (s: string) => s === 'active' ? '🟢' : s === 'completed' ? '✅' : s === 'archived' ? '⬜' : '🟡'
      const lines = clients.map((c) => `${icon(c.status)} *${c.name}* — \`${c.slug}\``)
      return `*Clienti WAI (${clients.length}):*\n\n${lines.join('\n')}`
    }

    // ── list_projects ─────────────────────────────────────────────────────
    case 'list_projects': {
      const clientSlug = getString(params, 'client_slug')
      let projects: Awaited<ReturnType<typeof getProjectsByClient>>
      if (clientSlug) {
        projects = await getProjectsByClient(clientSlug)
      } else {
        projects = await getProjects()
      }
      if (projects.length === 0) {
        return `Nessun progetto trovato${clientSlug ? ` per \`${clientSlug}\`` : ''}.`
      }
      const icon = (s: string) =>
        s === 'active' ? '🟢' : s === 'delivered' ? '✅' : s === 'invoiced' ? '💰' :
        s === 'blocked' ? '⛔' : s === 'review' ? '🔍' : '🔵'
      const lines = projects.map((p) => `${icon(p.status)} *${p.name}* (\`${p.slug}\`) — ${p.type} — ${p.status}`)
      const title = clientSlug ? `Progetti di \`${clientSlug}\`` : 'Tutti i progetti WAI'
      return `*${title} (${projects.length}):*\n\n${lines.join('\n')}`
    }

    // ── status_report ─────────────────────────────────────────────────────
    case 'status_report': {
      return buildSystemStatusReport()
    }

    // ── personal_research ────────────────────────────────────────────────
    case 'personal_research': {
      const query = getString(params, 'query') ?? getString(params, 'topic')
      const explicitTitle = getString(params, 'title')
      const explicitFilename = getString(params, 'filename')

      if (!query) throw new Error('query mancante per personal_research')

      const title = explicitTitle ?? `Personal Research — ${query}`
      const searchResult = await executeTool('web_search', {
        query,
        limit: 6,
      }, {
        agentId: 'ceo',
      })

      if (!searchResult.search) {
        throw new Error('web_search returned no structured results')
      }

      const reportContent = await buildPersonalResearchReport(title, searchResult.search)
      const exportResult = await executeTool('file_export', {
        title,
        filename: buildPersonalResearchFilename(title, query, explicitFilename),
        format: 'md',
        content: reportContent,
        mode: 'personal',
      }, {
        agentId: 'ceo',
      })

      await recordEvent('founder_command', {
        payload: {
          command: 'nl_personal_research',
          source: 'natural_language',
          query,
          title,
          provider: searchResult.search.provider,
          results_count: searchResult.search.organic.length,
          path: exportResult.relativePath,
        },
      })

      const answerSuffix = searchResult.search.answerBox ? ` Quick answer: ${searchResult.search.answerBox}` : ''
      return `🔎 Ricerca personale completata su *${query}* — report salvato in \`${exportResult.relativePath}\` con ${searchResult.search.organic.length} fonti.${answerSuffix}`.trim()
    }

    // ── weekly_digest ────────────────────────────────────────────────────
    case 'weekly_digest': {
      const [projects, payments, recentEvents, doneTasks, activeTasks, blockedTasks, statusReport, personalContext] = await Promise.all([
        getProjects(),
        getPayments(),
        getRecentEvents(60),
        getTasksByStatus('done'),
        getTasksByStatus('in_progress'),
        getTasksByStatus('blocked'),
        buildSystemStatusReport(),
        getPersonalContext(),
      ])

      const title = `Weekly Digest — ${new Date().toISOString().slice(0, 10)}`
      const digest = buildFounderWeeklyDigestReport({
        projects,
        payments,
        recentEvents,
        doneTasks,
        activeTasks,
        blockedTasks,
        statusReport,
        personalWorkspacePath: personalContext.workspacePath,
        personalOutputPath: personalContext.outputPath,
        personalDocuments: personalContext.recentDocuments,
        connectors: personalContext.connectors,
        founderName: personalContext.profile.displayName,
        timezone: personalContext.profile.timezone,
      })

      const exportResult = await executeTool('file_export', {
        title,
        filename: buildWeeklyDigestFilename(),
        format: 'md',
        content: digest,
        mode: 'personal',
      }, {
        agentId: 'ceo',
      })

      await recordEvent('founder_command', {
        payload: {
          command: 'nl_weekly_digest',
          source: 'natural_language',
          path: exportResult.relativePath,
        },
      })

      return `🧾 Weekly digest generato e salvato in \`${exportResult.relativePath}\``
    }

    // ── gmail_inbox_summary ──────────────────────────────────────────────
    case 'gmail_inbox_summary': {
      const requestedQuery = getString(params, 'query') ?? 'in:inbox newer_than:7d -category:promotions -category:social'
      let query = normalizeFounderGmailQuery(requestedQuery)
      const limit = Math.max(1, Math.min(getNumber(params, 'limit') ?? 6, 10))
      const userGoogleEmail = await getGoogleWorkspaceUserEmail()

      try {
        let searchResult = await callGoogleWorkspaceMcpTool('search_gmail_messages', {
          query,
          page_size: limit,
        })

        let messageIds = extractMessageIdsFromGmailSearch(searchResult.text, limit)
        if (messageIds.length === 0) {
          const broaderQuery = broadenFounderGmailQuery(query)
          if (broaderQuery && broaderQuery !== query) {
            query = broaderQuery
            searchResult = await callGoogleWorkspaceMcpTool('search_gmail_messages', {
              query,
              page_size: limit,
            })
            messageIds = extractMessageIdsFromGmailSearch(searchResult.text, limit)
          }
        }

        if (messageIds.length === 0) {
          return `📭 Nessun messaggio utile trovato per \`${query}\`.`
        }

        const metadataResult = await callGoogleWorkspaceMcpTool('get_gmail_messages_content_batch', {
          message_ids: messageIds,
          format: 'metadata',
        })

        const summary = await summarizeFounderInbox(metadataResult.text, query)

        await recordEvent('founder_command', {
          payload: {
            command: 'nl_gmail_inbox_summary',
            source: 'natural_language',
            query,
            message_count: messageIds.length,
          },
        })

        return `📬 Inbox summary pronta per \`${userGoogleEmail}\`\n\n${summary}`.trim()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (/authorization required/i.test(message)) {
          return '🔐 Gmail MCP non ancora autorizzato. Completa prima il Google Workspace auth da Personal HQ, poi riprova.'
        }
        throw err
      }
    }

    // ── gmail_latest_message ─────────────────────────────────────────────
    case 'gmail_latest_message': {
      const requestedQuery = getString(params, 'query') ?? 'in:inbox newer_than:1d'
      let query = normalizeFounderGmailQuery(requestedQuery)
      const userGoogleEmail = await getGoogleWorkspaceUserEmail()

      try {
        let searchResult = await callGoogleWorkspaceMcpTool('search_gmail_messages', {
          query,
          page_size: 1,
        })

        let messageIds = extractMessageIdsFromGmailSearch(searchResult.text, 1)
        if (messageIds.length === 0) {
          const broaderQuery = broadenFounderGmailQuery(query)
          if (broaderQuery && broaderQuery !== query) {
            query = broaderQuery
            searchResult = await callGoogleWorkspaceMcpTool('search_gmail_messages', {
              query,
              page_size: 1,
            })
            messageIds = extractMessageIdsFromGmailSearch(searchResult.text, 1)
          }
        }

        const messageId = messageIds[0]
        if (!messageId) {
          return `📭 Nessuna email trovata per \`${query}\`.`
        }

        const messageResult = await callGoogleWorkspaceMcpTool('get_gmail_message_content', {
          message_id: messageId,
        })

        await recordEvent('founder_command', {
          payload: {
            command: 'nl_gmail_latest_message',
            source: 'natural_language',
            query,
            message_id: messageId,
          },
        })

        return `📩 Ultima email trovata per \`${userGoogleEmail}\`\n\n${truncateReplyText(messageResult.text)}`.trim()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (/authorization required/i.test(message)) {
          return '🔐 Gmail MCP non ancora autorizzato. Completa prima il Google Workspace auth da Personal HQ, poi riprova.'
        }
        throw err
      }
    }

    // ── calendar_today ───────────────────────────────────────────────────
    case 'calendar_today': {
      const calendarId = getString(params, 'calendar_id') ?? 'primary'
      const userGoogleEmail = await getGoogleWorkspaceUserEmail()
      const { start, end } = getTodayWindowInLocalTimezone()

      try {
        const eventsResult = await callGoogleWorkspaceMcpTool('get_events', {
          calendar_id: calendarId,
          time_min: start,
          time_max: end,
          max_results: 12,
          detailed: false,
        })

        if (/No events found/i.test(eventsResult.text)) {
          return `📅 Nessun evento oggi nel calendario \`${calendarId}\` per \`${userGoogleEmail}\`.`
        }

        const summary = await summarizeFounderCalendar(eventsResult.text)

        await recordEvent('founder_command', {
          payload: {
            command: 'nl_calendar_today',
            source: 'natural_language',
            calendar_id: calendarId,
            window_start: start,
            window_end: end,
          },
        })

        return `📅 Agenda di oggi per \`${userGoogleEmail}\`\n\n${summary}`.trim()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (/authorization required/i.test(message)) {
          return '🔐 Google Calendar MCP non ancora autorizzato. Completa prima il Google Workspace auth da Personal HQ, poi riprova.'
        }
        throw err
      }
    }

    // ── drive_find_file ──────────────────────────────────────────────────
    case 'drive_find_file': {
      const query = getString(params, 'query') ?? getString(params, 'filename')
      const fileType = getString(params, 'file_type')
      const limit = Math.max(1, Math.min(getNumber(params, 'limit') ?? 5, 10))

      if (!query) {
        throw new Error('query mancante per drive_find_file')
      }

      try {
        const result = await callGoogleWorkspaceMcpTool('search_drive_files', {
          query: normalizeFounderDriveQuery(query),
          page_size: limit,
          ...(fileType ? { file_type: fileType } : {}),
          detailed: true,
        })

        if (/No files found/i.test(result.text)) {
          return `📂 Nessun file Drive trovato per \`${query}\`.`
        }

        await recordEvent('founder_command', {
          payload: {
            command: 'nl_drive_find_file',
            source: 'natural_language',
            query,
            ...(fileType ? { file_type: fileType } : {}),
          },
        })

        return `📂 Risultati Google Drive per \`${query}\`\n\n${truncateReplyText(result.text)}`.trim()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (/authorization required/i.test(message)) {
          return '🔐 Google Drive MCP non ancora autorizzato. Completa prima il Google Workspace auth da Personal HQ, poi riprova.'
        }
        throw err
      }
    }

    // ── drive_read_file ──────────────────────────────────────────────────
    case 'drive_read_file': {
      const explicitFileId = getString(params, 'file_id')
      const query = getString(params, 'query') ?? getString(params, 'filename')
      const fileType = getString(params, 'file_type')

      let fileId = explicitFileId
      let fileName: string | null = null

      if (!fileId) {
        if (!query) {
          throw new Error('file_id o query mancanti per drive_read_file')
        }

        const match = await resolveDriveFileFromQuery(query, fileType)
        if (!match) {
          return `📂 Nessun file Drive trovato per \`${query}\`.`
        }

        fileId = match.id
        fileName = match.name
      }

      try {
        const result = await callGoogleWorkspaceMcpTool('get_drive_file_content', {
          file_id: fileId,
        })

        await recordEvent('founder_command', {
          payload: {
            command: 'nl_drive_read_file',
            source: 'natural_language',
            file_id: fileId,
            ...(query ? { query } : {}),
          },
        })

        const label = fileName ?? query ?? fileId
        return `📄 Contenuto file Drive: \`${label}\`\n\n${truncateReplyText(result.text)}`.trim()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (/authorization required/i.test(message)) {
          return '🔐 Google Drive MCP non ancora autorizzato. Completa prima il Google Workspace auth da Personal HQ, poi riprova.'
        }
        throw err
      }
    }

    // ── drive_recent_files ───────────────────────────────────────────────
    case 'drive_recent_files': {
      const days = Math.max(1, Math.min(getNumber(params, 'days') ?? 7, 30))
      const limit = Math.max(1, Math.min(getNumber(params, 'limit') ?? 8, 15))
      const fileType = getString(params, 'file_type')
      const query = buildRecentDriveQuery(days)

      try {
        const result = await callGoogleWorkspaceMcpTool('search_drive_files', {
          query,
          page_size: limit,
          ...(fileType ? { file_type: fileType } : {}),
          detailed: true,
        })

        if (/No files found/i.test(result.text)) {
          return `📂 Nessun file Drive modificato negli ultimi ${days} giorni.`
        }

        await recordEvent('founder_command', {
          payload: {
            command: 'nl_drive_recent_files',
            source: 'natural_language',
            days,
            limit,
            ...(fileType ? { file_type: fileType } : {}),
          },
        })

        return `🗂️ File Drive recenti (ultimi ${days} giorni)\n\n${truncateReplyText(result.text)}`.trim()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (/authorization required/i.test(message)) {
          return '🔐 Google Drive MCP non ancora autorizzato. Completa prima il Google Workspace auth da Personal HQ, poi riprova.'
        }
        throw err
      }
    }

    // ── daily_founder_brief ──────────────────────────────────────────────
    case 'daily_founder_brief': {
      const inboxQuery = normalizeFounderGmailQuery(
        getString(params, 'inbox_query') ?? 'in:inbox newer_than:1d -category:promotions -category:social'
      )
      const driveDays = Math.max(1, Math.min(getNumber(params, 'drive_days') ?? 7, 30))
      const userGoogleEmail = await getGoogleWorkspaceUserEmail()
      const personalContext = await getPersonalContext()
      const { start, end } = getTodayWindowInLocalTimezone()

      try {
        const inboxSearch = await callGoogleWorkspaceMcpTool('search_gmail_messages', {
          query: inboxQuery,
          page_size: 5,
        })
        const inboxIds = extractMessageIdsFromGmailSearch(inboxSearch.text, 5)
        const inboxMetadata = inboxIds.length > 0
          ? await callGoogleWorkspaceMcpTool('get_gmail_messages_content_batch', {
              message_ids: inboxIds,
              format: 'metadata',
            })
          : null
        const inboxSummary = inboxMetadata
          ? await summarizeFounderInbox(inboxMetadata.text, inboxQuery)
          : `No messages found for query: ${inboxQuery}`

        const calendarResult = await callGoogleWorkspaceMcpTool('get_events', {
          calendar_id: 'primary',
          time_min: start,
          time_max: end,
          max_results: 12,
          detailed: false,
        })
        const calendarSummary = /No events found/i.test(calendarResult.text)
          ? 'No events today.'
          : await summarizeFounderCalendar(calendarResult.text)

        const driveResult = await callGoogleWorkspaceMcpTool('search_drive_files', {
          query: buildRecentDriveQuery(driveDays),
          page_size: 6,
          detailed: true,
        })
        const driveSummary = /No files found/i.test(driveResult.text)
          ? `No Drive files modified in the last ${driveDays} days.`
          : driveResult.text

        const title = `Daily Founder Brief — ${new Date().toISOString().slice(0, 10)}`
        const report = buildFounderDailyBriefReport({
          founderName: personalContext.profile.displayName,
          userGoogleEmail,
          timezone: personalContext.profile.timezone,
          inboxQuery,
          inboxSummary,
          calendarSummary,
          recentDriveSummary: truncateReplyText(driveSummary, 3000),
        })

        const exportResult = await executeTool('file_export', {
          title,
          filename: buildDailyFounderBriefFilename(),
          format: 'md',
          content: report,
          mode: 'personal',
        }, {
          agentId: 'ceo',
        })

        await recordEvent('founder_command', {
          payload: {
            command: 'nl_daily_founder_brief',
            source: 'natural_language',
            inbox_query: inboxQuery,
            drive_days: driveDays,
            path: exportResult.relativePath,
          },
        })

        return `🧠 Daily founder brief generato e salvato in \`${exportResult.relativePath}\`\n\n${truncateReplyText(report, 3500)}`.trim()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (/authorization required/i.test(message)) {
          return '🔐 Google Workspace MCP non ancora autorizzato. Completa prima il Google Workspace auth da Personal HQ, poi riprova.'
        }
        throw err
      }
    }

    // ── create_client ─────────────────────────────────────────────────────
    case 'create_client': {
      const name = getString(params, 'name')
      if (!name) throw new Error('Nome cliente mancante')

      const email = getString(params, 'email')
      const slug = slugify(name)

      const existing = await getClientBySlug(slug)
      if (existing) {
        return `⚠️ Cliente *${existing.name}* già esistente (\`${slug}\`) — uso quello esistente`
      }

      const client = await createClient({ name, slug, email })
      const workspacePath = await createClientWorkspace(slug)

      await recordEvent('founder_command', {
        payload: { command: 'nl_create_client', client_id: client.id, slug, source: 'natural_language' },
      })

      return `✅ Cliente *${client.name}* creato — slug: \`${slug}\` — workspace: \`${workspacePath}\``
    }

    // ── create_project ────────────────────────────────────────────────────
    case 'create_project': {
      const clientSlug = getString(params, 'client_slug')
      const projectName = getString(params, 'project_name')
      const projectTypeRaw = getString(params, 'project_type')
      const contractValue = getNumber(params, 'contract_value_usd')

      if (!clientSlug) throw new Error('client_slug mancante per create_project')
      if (!projectName) throw new Error('project_name mancante per create_project')

      const client = await getClientBySlug(clientSlug)
      if (!client) throw new Error(`Cliente \`${clientSlug}\` non trovato`)

      const type: ProjectType = PROJECT_TYPES.includes(projectTypeRaw as ProjectType)
        ? (projectTypeRaw as ProjectType)
        : 'other'

      const projectSlug = slugify(projectName)
      const relPath = getRelativeProjectPath(clientSlug, projectSlug)

      // Check if already exists
      const existing = await getProjectBySlug(client.id, projectSlug)
      if (existing) {
        return `⚠️ Progetto *${existing.name}* già esistente (\`${projectSlug}\`) — uso quello esistente`
      }

      const project = await createProject({
        client_id: client.id,
        name: projectName,
        slug: projectSlug,
        type,
        workspace_path: relPath,
        ...(contractValue !== undefined ? { contract_value_usd: contractValue } : {}),
      })

      await createProjectWorkspace(clientSlug, projectSlug, projectName, type, client.name)
      await updateProjectWorkspacePath(project.id, relPath)

      await recordEvent('founder_command', {
        payload: { command: 'nl_create_project', project_id: project.id, client_slug: clientSlug, source: 'natural_language' },
      })

      return `✅ Progetto *${project.name}* creato — tipo: ${type}${contractValue !== undefined ? ` — budget: $${contractValue}` : ''} — workspace pronto`
    }

    // ── write_brief ───────────────────────────────────────────────────────
    case 'write_brief': {
      const clientSlug = getString(params, 'client_slug')
      const projectSlug = getString(params, 'project_slug')
      const briefText = getString(params, 'brief_text')

      if (!clientSlug) throw new Error('client_slug mancante per write_brief')
      if (!projectSlug) throw new Error('project_slug mancante per write_brief')
      if (!briefText) throw new Error('brief_text mancante per write_brief')

      const client = await getClientBySlug(clientSlug)
      if (!client) throw new Error(`Cliente \`${clientSlug}\` non trovato`)

      const project = await getProjectBySlug(client.id, projectSlug)
      if (!project) throw new Error(`Progetto \`${projectSlug}\` non trovato per ${client.name}`)

      const workspacePath = getProjectWorkspacePath(clientSlug, projectSlug)
      const briefPath = join(workspacePath, 'brief.md')
      const now = new Date().toISOString()
      const content = `# ${project.name} – Brief\n\n> Aggiornato: ${now}\n\n${briefText}\n`
      await writeFile(briefPath, content, 'utf-8')

      await recordEvent('founder_command', {
        payload: { command: 'nl_write_brief', project_id: project.id, source: 'natural_language' },
      })

      return `✅ Brief scritto per *${project.name}*`
    }

    // ── update_brief ──────────────────────────────────────────────────────
    case 'update_brief': {
      const clientSlug = getString(params, 'client_slug')
      const projectSlug = getString(params, 'project_slug')
      const updateText = getString(params, 'update_text')

      if (!clientSlug) throw new Error('client_slug mancante per update_brief')
      if (!projectSlug) throw new Error('project_slug mancante per update_brief')
      if (!updateText) throw new Error('update_text mancante per update_brief')

      const client = await getClientBySlug(clientSlug)
      if (!client) throw new Error(`Cliente \`${clientSlug}\` non trovato`)

      const project = await getProjectBySlug(client.id, projectSlug)
      if (!project) throw new Error(`Progetto \`${projectSlug}\` non trovato per ${client.name}`)

      const workspacePath = getProjectWorkspacePath(clientSlug, projectSlug)
      const briefPath = join(workspacePath, 'brief.md')
      const now = new Date().toISOString()

      let existingContent = ''
      if (existsSync(briefPath)) {
        existingContent = await readFile(briefPath, 'utf-8')
      } else {
        // No existing brief — create one from scratch instead
        existingContent = `# ${project.name} – Brief\n\n`
      }

      const appendSection = `\n---\n\n> Aggiornamento: ${now}\n\n${updateText}\n`
      await writeFile(briefPath, existingContent + appendSection, 'utf-8')

      await recordEvent('founder_command', {
        payload: { command: 'nl_update_brief', project_id: project.id, source: 'natural_language' },
      })

      return `✅ Brief aggiornato per *${project.name}* — nuove info aggiunte`
    }

    // ── create_task ───────────────────────────────────────────────────────
    case 'create_task': {
      const title = getString(params, 'title')
      const description = getString(params, 'description') ?? title ?? ''
      const clientSlug = getString(params, 'client_slug')
      const projectSlug = getString(params, 'project_slug')

      if (!title) throw new Error('title mancante per create_task')

      let projectId: string | undefined
      let taskMetadata: Record<string, unknown> = {}
      let scopeLabel = ''
      let clientObj: Client | null = null

      if (clientSlug) {
        clientObj = await getClientBySlug(clientSlug)
        if (!clientObj) throw new Error(`Cliente \`${clientSlug}\` non trovato`)

        if (projectSlug) {
          const project = await getProjectBySlug(clientObj.id, projectSlug)
          if (!project) throw new Error(`Progetto \`${projectSlug}\` non trovato per ${clientObj.name}`)

          projectId = project.id
          scopeLabel = ` | *${clientObj.name}* / *${project.name}*`
          taskMetadata = {
            project_id: project.id,
            project_name: project.name,
            project_type: project.type,
            client_name: clientObj.name,
            client_slug: clientSlug,
            project_slug: projectSlug,
            workspace_path: project.workspace_path,
            ...(project.repo_local_path ? { repo_local_path: project.repo_local_path } : {}),
            ...(project.repo_url ? { repo_url: project.repo_url } : {}),
            ...(project.repo_default_branch ? { repo_default_branch: project.repo_default_branch } : {}),
            ...(project.repo_provider ? { repo_provider: project.repo_provider } : {}),
          }
        } else {
          scopeLabel = ` | *${clientObj.name}*`
          taskMetadata = {
            client_name: clientObj.name,
            client_slug: clientSlug,
          }
        }
      }

      // Enrich description with workspace context
      let enrichedDescription = description
      if (projectId && clientSlug && projectSlug) {
        try {
          const wsAbsPath = getProjectWorkspacePath(clientSlug, projectSlug)
          const ctx = await loadAllWorkspaceContext(wsAbsPath)
          if (ctx) {
            enrichedDescription = `${description}\n\n[WORKSPACE CONTEXT — existing deliverables and brief]\n${ctx}`
          }
        } catch {
          // best-effort
        }
      }

      const task = await createTask({
        title,
        description: enrichedDescription,
        type: 'routing',
        priority: 2,
        assignee_agent_id: 'ceo',
        requires_human_review: false,
        ...(projectId ? { project_id: projectId } : {}),
        metadata: taskMetadata,
      })

      await recordEvent('founder_command', {
        payload: { command: 'nl_create_task', task_id: task.id, source: 'natural_language' },
      })

      // Fire CEO agent async (fire-and-forget)
      void runCeoAgent(task, notify).catch((err: unknown) => {
        log.error({ err, taskId: task.id }, 'CEO Intake: runCeoAgent failed')
      })

      return `🚀 Task \`${task.id.slice(0, 8)}\` lanciato${scopeLabel}: *${title}* — il CEO sta delegando alla catena`
    }

    // ── retry_task ────────────────────────────────────────────────────────
    case 'retry_task': {
      const taskRef = getString(params, 'task_ref') ?? getString(params, 'task_id')
      const reason = getString(params, 'reason')

      if (!taskRef) throw new Error('task_ref mancante per retry_task')

      const result = await executeFounderTaskAction(taskRef, 'retry', {
        source: 'natural_language',
        reason,
        notify,
      })

      await recordEvent('founder_command', {
        taskId: result.task.id,
        payload: {
          command: 'nl_retry_task',
          source: 'natural_language',
          task_ref: taskRef,
          resolved_task_id: result.task.id,
          ...(reason ? { reason } : {}),
        },
      })

      return formatFounderTaskActionMessage(result)
    }

    // ── approve_task ──────────────────────────────────────────────────────
    case 'approve_task': {
      const taskRef = getString(params, 'task_ref') ?? getString(params, 'task_id')
      const reason = getString(params, 'reason')

      if (!taskRef) throw new Error('task_ref mancante per approve_task')

      const result = await executeFounderTaskAction(taskRef, 'approve', {
        source: 'natural_language',
        reason,
        notify,
      })

      await recordEvent('founder_command', {
        taskId: result.task.id,
        payload: {
          command: 'nl_approve_task',
          source: 'natural_language',
          task_ref: taskRef,
          resolved_task_id: result.task.id,
          ...(reason ? { reason } : {}),
        },
      })

      return formatFounderTaskActionMessage(result)
    }

    // ── reject_task ───────────────────────────────────────────────────────
    case 'reject_task': {
      const taskRef = getString(params, 'task_ref') ?? getString(params, 'task_id')
      const reason = getString(params, 'reason')

      if (!taskRef) throw new Error('task_ref mancante per reject_task')

      const result = await executeFounderTaskAction(taskRef, 'reject', {
        source: 'natural_language',
        reason,
        notify,
      })

      await recordEvent('founder_command', {
        taskId: result.task.id,
        payload: {
          command: 'nl_reject_task',
          source: 'natural_language',
          task_ref: taskRef,
          resolved_task_id: result.task.id,
          ...(reason ? { reason } : {}),
        },
      })

      return formatFounderTaskActionMessage(result)
    }

    // ── create_document ───────────────────────────────────────────────────
    case 'create_document': {
      const title = getString(params, 'title')
      const content = getString(params, 'content')
      const filename = getString(params, 'filename')
      const format = getString(params, 'format')
      const clientSlug = getString(params, 'client_slug')
      const projectSlug = getString(params, 'project_slug')
      const mode = getString(params, 'mode')

      if (!title) throw new Error('title mancante per create_document')
      if (!content) throw new Error('content mancante per create_document')

      const result = await executeTool('file_export', {
        title,
        content,
        ...(filename ? { filename } : {}),
        ...(format === 'md' || format === 'txt' || format === 'csv' || format === 'json' || format === 'html' ? { format } : {}),
        ...(clientSlug ? { clientSlug } : {}),
        ...(projectSlug ? { projectSlug } : {}),
        ...(mode === 'company' || mode === 'personal' ? { mode } : {}),
      }, {
        agentId: 'ceo',
      })

      await recordEvent('founder_command', {
        payload: {
          command: 'nl_create_document',
          source: 'natural_language',
          title,
          path: result.relativePath,
          mode: mode === 'company' ? 'company' : 'personal',
          ...(clientSlug ? { client_slug: clientSlug } : {}),
          ...(projectSlug ? { project_slug: projectSlug } : {}),
        },
      })

      return `📝 ${result.summary}`
    }

    // ── send_report ────────────────────────────────────────────────────────
    case 'send_report': {
      const subject = getString(params, 'subject')
      const body = getString(params, 'body') ?? getString(params, 'content')
      const to = getString(params, 'to')
      const html = getString(params, 'html')

      if (!subject) throw new Error('subject mancante per send_report')
      if (!body && !html) throw new Error('body/html mancante per send_report')

      const profile = await ensurePersonalProfile()
      const result = await executeTool('email', {
        subject,
        ...(body ? { body } : {}),
        ...(html ? { html } : {}),
        ...(to ? { to } : profile.primaryEmail ? { to: profile.primaryEmail } : {}),
      }, {
        agentId: 'ceo',
      })

      await recordEvent('founder_command', {
        payload: {
          command: 'nl_send_report',
          source: 'natural_language',
          subject,
          recipient: to ?? profile.primaryEmail ?? 'missing',
        },
      })

      return `📨 ${result.summary}`
    }

    // ── invoice_project ───────────────────────────────────────────────────
    case 'invoice_project': {
      const clientSlug = getString(params, 'client_slug')
      const projectSlug = getString(params, 'project_slug')
      const amountUsd = getNumber(params, 'amount_usd') ?? getNumber(params, 'amount')

      if (!clientSlug) throw new Error('client_slug mancante per invoice_project')
      if (!projectSlug) throw new Error('project_slug mancante per invoice_project')

      const result = await executeInvoiceProject(clientSlug, projectSlug, amountUsd, 'natural_language')

      await recordEvent('founder_command', {
        payload: {
          command: 'nl_invoice_project',
          source: 'natural_language',
          client_slug: clientSlug,
          project_slug: projectSlug,
          project_id: result.project.id,
          contract_value_usd: result.contractValueUsd,
        },
      })

      return formatInvoiceProjectMessage(result)
    }

    // ── mark_project_paid ────────────────────────────────────────────────
    case 'mark_project_paid': {
      const clientSlug = getString(params, 'client_slug')
      const projectSlug = getString(params, 'project_slug')
      const amountUsd = getNumber(params, 'amount_usd') ?? getNumber(params, 'amount')

      if (!clientSlug) throw new Error('client_slug mancante per mark_project_paid')
      if (!projectSlug) throw new Error('project_slug mancante per mark_project_paid')
      if (amountUsd === undefined) throw new Error('amount_usd mancante per mark_project_paid')

      const result = await executeMarkProjectPaid(clientSlug, projectSlug, amountUsd, 'natural_language')

      await recordEvent('founder_command', {
        payload: {
          command: 'nl_mark_project_paid',
          source: 'natural_language',
          client_slug: clientSlug,
          project_slug: projectSlug,
          project_id: result.project.id,
          payment_id: result.payment.id,
          amount_usd: amountUsd,
        },
      })

      return formatMarkProjectPaidMessage(result)
    }

    default:
      return `⚠️ Azione non riconosciuta: ${type}`
  }
}

// ---------------------------------------------------------------------------
// Build client context string (injected into system prompt)
// ---------------------------------------------------------------------------

async function buildClientContext(): Promise<string> {
  try {
    const [clients, blockedTasks, personalContext] = await Promise.all([
      getClients(),
      getTasksByStatus('blocked'),
      formatPersonalContextForPrompt(),
    ])

    if (clients.length === 0) return 'No clients yet in WAI.'

    const lines: string[] = ['Clients in WAI:']
    for (const c of clients) {
      try {
        const projects = await getProjectsByClient(c.slug)
        const projectList = projects.length === 0
          ? 'no projects'
          : projects.map((p) => `${p.slug} (${p.type}, ${p.status})`).join(', ')
        lines.push(`- ${c.name} | slug: ${c.slug} | ${c.status} | projects: ${projectList}`)
      } catch {
        lines.push(`- ${c.name} | slug: ${c.slug} | ${c.status}`)
      }
    }

    lines.push('')
    lines.push('Blocked tasks requiring founder attention:')
    if (blockedTasks.length === 0) {
      lines.push('- none')
    } else {
      for (const task of blockedTasks.slice(0, 8)) {
        lines.push(
          `- ${task.id.slice(0, 8)} | ${task.title} | agent: ${task.assignee_agent_id ?? 'unassigned'} | scope: ${formatTaskScope(task)} | updated_at: ${task.updated_at}`
        )
      }
      if (blockedTasks.length > 8) {
        lines.push(`- ...and ${blockedTasks.length - 8} more blocked tasks`)
      }
    }

    lines.push('')
    lines.push(personalContext)

    return lines.join('\n')
  } catch {
    return 'Could not load client list.'
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runCeoNaturalLanguageHandler(
  chatId: string,
  text: string,
  reply: (msg: string) => Promise<void>,
  notify: (msg: string) => Promise<void>
): Promise<void> {
  log.info({ chatId, text: text.substring(0, 120) }, 'CEO Intake: free-text received')

  const shortcutIntent = detectFounderShortcutIntent(text)
  if (shortcutIntent?.commands?.length) {
    const summaries: string[] = []
    let failed = false

    for (const command of shortcutIntent.commands) {
      try {
        const summary = await executeAction(command, notify)
        summaries.push(summary)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.error({ err, command: command.type }, 'CEO Intake: shortcut action execution error')
        summaries.push(`❌ Errore in \`${command.type}\`: ${msg}`)
        failed = true
        break
      }
    }

    const body = summaries.join('\n')
    const finalMessage = failed
      ? `⚠️ *Piano parzialmente eseguito:*\n\n${body}`
      : summaries.length === 1
        ? body
        : `*Piano eseguito — ${summaries.length} step:*\n\n${body}`

    await reply(finalMessage)
    clearConversation(chatId)
    return
  }

  const clientContext = await buildClientContext()

  const existing = getConversation(chatId)
  const messages: IntakeContext['messages'] = existing?.messages ?? []
  messages.push({ role: 'user', content: text })

  // Call LLM
  let intent: IntentResponse | null = null
  try {
    const chatMessages = [
      { role: 'system' as const, content: buildSystemPrompt(clientContext) },
      ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ]

    const result = await runAgent(chatMessages, {
      agentId: 'ceo',
      taskType: 'routing',
      requiresComplex: true,
    })

    log.debug({ raw: result.content.substring(0, 500) }, 'CEO Intake: LLM raw response')
    intent = parseIntentResponse(result.content)
  } catch (err) {
    log.error({ err }, 'CEO Intake: LLM call failed')
    await reply('❌ Errore interno. Riprova tra un momento.')
    clearConversation(chatId)
    return
  }

  if (!intent) {
    log.warn('CEO Intake: could not parse LLM response')
    await reply('🤔 Non ho capito bene. Puoi riformulare?')
    clearConversation(chatId)
    return
  }

  switch (intent.action) {

    case 'ask': {
      messages.push({ role: 'assistant', content: intent.message })
      saveConversation(chatId, { messages, lastMessageAt: Date.now() })
      await reply(intent.message)
      break
    }

    case 'execute':
    case 'reply': {
      const commands = intent.commands ?? []

      if (commands.length === 0) {
        // Shouldn't happen, but graceful fallback
        await reply(intent.message)
        clearConversation(chatId)
        break
      }

      // Execute all commands in sequence, collect summaries
      const summaries: string[] = []
      let failed = false

      for (const command of commands) {
        try {
          const summary = await executeAction(command, notify)
          summaries.push(summary)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.error({ err, command: command.type }, 'CEO Intake: action execution error')
          summaries.push(`❌ Errore in \`${command.type}\`: ${msg}`)
          failed = true
          break // stop sequence on error
        }
      }

      // Single reply with all results
      const body = summaries.join('\n')
      const finalMessage = failed
        ? `⚠️ *Piano parzialmente eseguito:*\n\n${body}`
        : summaries.length === 1
          ? body
          : `*Piano eseguito — ${summaries.length} step:*\n\n${body}`

      messages.push({ role: 'assistant', content: finalMessage })
      clearConversation(chatId)
      await reply(finalMessage)
      break
    }

    case 'unclear':
    default: {
      await reply(intent.message)
      clearConversation(chatId)
      break
    }
  }
}
