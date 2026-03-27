// ============================================================
// WAI – CEO Natural Language Intake Handler
// Neb scrive testo libero su Telegram; il CEO capisce, pianifica
// una sequenza di azioni, le esegue tutte in autonomia, e risponde
// con un unico messaggio riassuntivo.
// ============================================================

import { mkdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { runAgent } from '../services/llm.js'
import {
  createClient,
  createProject,
  createTask,
  findClientFuzzy,
  getClientBySlug,
  getClients,
  getInProgressTasksByProject,
  getPayments,
  getProjects,
  getProjectBySlug,
  getProjectsByClient,
  getRecentEvents,
  getTaskByReference,
  getTasksByStatus,
  updateProjectStatus,
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
import { sanitizeDeliveryConfigPatch, updateProjectDeliveryConfig } from '../services/delivery-config.js'
import { captureScreenshot } from '../services/screenshot.js'
import { scrapeUrl } from '../services/scraper.js'
import {
  isPinchTabAvailable,
  browserNavigate,
  browserText,
  browserScreenshot as pinchTabScreenshot,
  browserSnapshot,
} from '../services/pinchtab.js'
import { sendFounderPhoto } from '../services/notification-router.js'
import { loadAllWorkspaceContext } from './software_delivery_utils.js'
import { runCeoAgent } from './ceo.js'
import { runQaAgent } from './qa.js'
import { createAgentMemory } from '../services/memory.js'
import { ingestNote, ingestUrl as ingestKnowledgeUrl, listKnowledgeItems, searchKnowledge } from '../services/knowledge.js'
import {
  getContacts as crmGetContacts,
  upsertContact as crmUpsertContact,
  addInteraction as crmAddInteraction,
  findContactByNameOrEmail,
} from '../services/crm.js'
import {
  getMeetingNotes as listMeetingNotes,
  saveMeetingNote,
  summarizeMeetingNotes,
} from '../services/meeting-notes.js'
import { getLeads as crmGetLeads, updateLeadStatus } from '../services/leads.js'
import { harvestLeads } from '../services/lead-harvester.js'
import { executeOutreach } from '../services/outreach-executor.js'
import {
  updateWeeklyLeadHarvestAutomation,
  runWeeklyLeadHarvestNow,
  getPersonalAutomationStatus,
  type WeekDay,
  type HarvestSector,
} from '../services/personal-automation.js'
import type { Client, DeliveryConfig, Payment, Project, ProjectType, SystemEvent, Task } from '../types/index.js'

// ---------------------------------------------------------------------------
// CEO Fact Extraction — non-blocking background extraction of client/project
// facts from the founder's free-text messages.
// ---------------------------------------------------------------------------

function logMemoryWarning(err: unknown, context: string): void {
  log.warn({ err }, `CEO Intake: memory extraction failed (${context}) — silently swallowed`)
}

async function scheduleCeoFactExtraction(text: string): Promise<void> {
  // Load all clients and their projects to find slug matches in the message
  let allClients: Client[]
  try {
    allClients = await getClients()
  } catch {
    return // Can't load clients — skip silently
  }

  // Find which client slug appears in the text (case-insensitive)
  let matchedClient: Client | undefined
  let matchedProject: Project | undefined

  for (const client of allClients) {
    if (text.toLowerCase().includes(client.slug.toLowerCase())) {
      matchedClient = client
      // Also check for a project slug match
      try {
        const projects = await getProjectsByClient(client.slug)
        for (const project of projects) {
          if (text.toLowerCase().includes(project.slug.toLowerCase())) {
            matchedProject = project
            break
          }
        }
      } catch {
        // project lookup is best-effort
      }
      break
    }
  }

  // If no client slug recognized — skip (avoids wasted LLM call)
  if (!matchedClient) return

  const clientId = matchedClient.id
  const projectId = matchedProject?.id

  const prompt = `You are WAI's memory capture module. Extract any persistent facts about a client or project from this founder message.

Message: "${text}"

Return JSON: { "clientFacts": string[], "projectFacts": string[] }
Rules:
- Only extract facts that will be useful in future tasks (preferences, billing terms, communication style, constraints).
- Each fact must be ≤ 200 chars and be a standalone sentence.
- If no persistent facts, return empty arrays.
- Do NOT extract temporary requests or one-off actions.`

  try {
    const result = await runAgent(
      [{ role: 'user', content: prompt }],
      { agentId: 'system_learning', modelOverride: 'nemotron-120b', captureMemory: false }
    )

    const jsonMatch = result.content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return

    const parsed = JSON.parse(jsonMatch[0]) as { clientFacts?: unknown; projectFacts?: unknown }
    const clientFacts = Array.isArray(parsed.clientFacts) ? parsed.clientFacts as string[] : []
    const projectFacts = Array.isArray(parsed.projectFacts) ? parsed.projectFacts as string[] : []

    for (const fact of clientFacts) {
      if (typeof fact !== 'string' || fact.trim().length < 10) continue
      await createAgentMemory({
        agentId: '_system',
        content: fact.trim().slice(0, 200),
        entityType: 'client_fact',
        clientId,
      }).catch((err: unknown) => { logMemoryWarning(err, 'client_fact save') })
    }

    if (projectId) {
      for (const fact of projectFacts) {
        if (typeof fact !== 'string' || fact.trim().length < 10) continue
        await createAgentMemory({
          agentId: '_system',
          content: fact.trim().slice(0, 200),
          entityType: 'project_fact',
          projectId,
          clientId,
        }).catch((err: unknown) => { logMemoryWarning(err, 'project_fact save') })
      }
    }
  } catch (err) {
    logMemoryWarning(err, 'LLM extraction')
  }
}

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
- retry_qa           → params: task_ref  (re-runs ONLY the QA gate — skips Architect + Dev General)
- approve_task       → params: task_ref, reason?
- reject_task        → params: task_ref, reason?
- create_document    → params: title, content, filename?, format?, client_slug?, project_slug?, mode?
- send_report        → params: subject, body, to?, html?
- invoice_project    → params: client_slug, project_slug, amount_usd?
- mark_project_paid  → params: client_slug, project_slug, amount_usd
- configure_delivery → params: client_slug, project_slug, config_patch
- capture_screenshot → params: url, caption?
- read_url           → params: url
- browser_navigate   → params: url  (naviga il browser PinchTab a un URL — fondamenta per sessioni multi-step)
- browser_read       → params: url?, summary?  (naviga + legge il testo della pagina via PinchTab — ideale per SPA e siti JS-heavy)
- browser_screenshot → params: url?, caption?  (naviga + screenshot live del browser PinchTab → invia foto su Telegram)
- browser_snapshot   → params: url?  (naviga + snapshot DOM compatto → utile per ispezionare la struttura della pagina)
- brain_save         → params: text, tags?  (salva una nota/testo nel Second Brain personale)
- brain_url          → params: url, tags?   (scarica e salva una pagina web nel Second Brain)
- brain_search       → params: query        (cerca semanticamente nel Second Brain)
- crm_add_contact    → params: name, email?, company?, notes?, tags?  (aggiunge un nuovo contatto al CRM)
- crm_log_interaction → params: contact, type (email_in|email_out|meeting|note|call), summary, occurred_at? (ISO 8601)  (logga un'interazione con un contatto)
- crm_get_contacts   → params: status? (active|follow_up|dormant)  (recupera lista contatti, opzionale filtro per status)
- crm_follow_up_due  → no params  (mostra i contatti con status follow_up che aspettano risposta)
- meeting_save       → params: title, notes, attendees? (nomi separati da virgola), date? (YYYY-MM-DD)  (salva note riunione e genera automaticamente summary + action items con AI)
- meeting_list       → no params  (mostra le ultime 10 riunioni con titolo, data e action item count)
- leads_harvest      → params: query (es. "ristoranti"), location (es. "Milano"), limit? (default 10)  — avvia una harvest di lead
- leads_show         → no params  — mostra il riepilogo del proposal inbox (count per status, top 5 scored)
- leads_send_approved → no params  — invia l'outreach email a tutti i lead con status 'approved'
- leads_approve_top → params: limit? (integer, default 10)  — approva i top N lead qualificati per score
- leads_mark_replied → params: company (string)  — segna un lead come replied (ha risposto all'email)
- harvest_automation_status → no params  — mostra lo stato dell'automazione harvest settimanale
- harvest_automation_config → params: enabled? (bool), scheduleDay? (es. "monday"), scheduleLocalTime? (es. "09:00"), sectors? (array [{query, location, limit?}])  — configura l'automazione harvest settimanale
- harvest_automation_run → no params  — avvia manualmente l'harvest settimanale ora (usa i settori configurati)
- content_generate → params: type (blog|social|newsletter), topic, tone?, client_slug?, project_slug?

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
9. When Neb asks to "lancia il lavoro" / "inizia il lavoro" / "start work" / "relaunch" / "riprendi" on a project: check EXISTING WAI STATE first. If there is a BLOCKED task for that project → use retry_task. If there is NO blocked task (tasks are completed, cancelled, or the project has no tasks at all) → use create_task to create new work. NEVER ask Neb for a task ID — determine the right action from context.
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
22. When Neb asks to enable/disable governed delivery steps for a specific project, use configure_delivery with client_slug, project_slug, and a config_patch object. The ONLY valid config_patch fields are: gitPush (boolean), autoDeploy (boolean), deployProvider ("vercel"|"netlify"|null), requireFounderApproval (boolean), clientEmailOnDelivery (boolean), autoInvoice (boolean). Example patch: { "autoDeploy": false }. IMPORTANT: billing cycle, payment terms, invoicing frequency, and similar billing preferences are NOT delivery config fields — do NOT use configure_delivery for those. Instead, use update_brief to append the preference to the project brief (e.g. content: "Preferenze fatturazione: trimestrale") so it is stored on the project and visible to agents.
23. Use retry_qa when Neb explicitly asks to redo/retry only QA (e.g. "rifai il QA", "retry qa <id>", "ri-lancia solo QA"). This skips Architect and Dev General and runs only the final QA gate.
24. Use capture_screenshot when Neb asks to take a visual snapshot of a URL (e.g. "fai uno screenshot di google.it", "screen di https://...").
25. Use read_url when Neb asks to read, analyze, or summarize a specific web page (e.g. "leggi questo articolo https://...", "riassumi questa pagina: ...").
26. Use browser_navigate to open a URL in the PinchTab live browser (foundation for multi-step sessions). Use before browser_read/browser_screenshot/browser_snapshot when chaining commands.
27. Use browser_read when Neb asks to read/analyze a JS-heavy or SPA page via the live browser (e.g. "vai su X e dimmi cosa c'è", "scraping di Y con browser", "leggi questa dashboard"). Prefer over read_url for dynamic pages. If url param is provided it navigates first.
28. Use browser_screenshot when Neb asks for a live browser screenshot via PinchTab (e.g. "browser screenshot di X", "screenshot con pinchtab di Y"). If url param provided it navigates first.
29. Use browser_snapshot when Neb wants to inspect the DOM structure of a page (e.g. "dimmi gli elementi interattivi di X", "vedi il DOM di Y"). If url param provided it navigates first.
30. All browser_* commands require PinchTab running on http://127.0.0.1:9867. They fail gracefully with a clear message if PinchTab is unavailable. Never call browser_read/browser_screenshot/browser_snapshot without either a url param or a preceding browser_navigate in the same plan.
31. Use brain_save when Neb wants to save a note, insight, or text to his personal knowledge base / Second Brain (e.g. "salva questa nota", "ricorda questo", "aggiungi al brain", "brain: ...").
32. Use brain_url when Neb wants to save a web page — including phrases like "salva questo URL", "salva questo link", "aggiungi questo sito". If Neb adds context like "per il cliente X" or "per il progetto Y", pass that as tags (e.g. tags: ["bayou"]). Do NOT use create_document for URL-saving requests.
33. Use brain_search when Neb wants to search/recall something from his Second Brain (e.g. "cerca nel brain", "cosa so su X", "trova nel knowledge base", "brain search: ...").
34. Use crm_add_contact when Neb wants to save a new contact (e.g. "aggiungi contatto X", "salva contatto", "nuovo contatto", "add contact").
35. Use crm_log_interaction when Neb logs an interaction with someone (e.g. "ho parlato con X", "ho incontrato X", "ho chiamato X", "log call con X", "email a X"). Infer type from wording: "chiamato/call" → call, "incontrato/meeting/riunione" → meeting, "email/risposto" → email_out, "ricevuto email da" → email_in. For occurred_at, if Neb says "ieri" use yesterday's ISO date; if not specified use current datetime.
36. Use crm_get_contacts when Neb wants to see his contacts (e.g. "mostra contatti", "lista contatti", "chi ho nel CRM", "chi conosco"). Optional status filter if Neb specifies "attivi", "follow-up", "dormienti".
37. Use crm_follow_up_due when Neb asks who needs follow-up (e.g. "follow-up da fare", "chi devo seguire", "chi aspetta risposta", "follow up pending", "pending follow-ups").
38. Use meeting_save when Neb wants to save meeting notes (e.g. "salva note riunione X", "prendi nota del meeting X", "meeting con X: ...", "note riunione"). Neb provides raw notes; WAI auto-generates summary and action items. attendees: comma-separated names if mentioned. date: ISO date if specified; omit if not mentioned.
39. Use meeting_list when Neb wants to see recent meetings (e.g. "mostra riunioni", "ultime meeting notes", "che meeting ho avuto", "lista meeting").
40. Use leads_harvest when Neb wants to find potential clients or do prospecting (e.g. "trova lead a Milano", "cerca aziende senza sito a Roma", "prospecting ristoranti Torino", "trova clienti nel settore X").
41. Use leads_show when Neb asks about the lead pipeline or proposal inbox (e.g. "mostra i lead", "quanti lead ho?", "cosa c'è nell'inbox dei lead?").
42. Use leads_send_approved when Neb wants to send outreach to already-approved leads (e.g. "manda le email ai lead approvati", "invia l'outreach", "procedi con i lead approvati").
43. Use leads_approve_top when Neb wants to approve multiple leads at once (e.g. "approva i top 10 lead", "batch approve lead", "approva i migliori qualificati", "approva top 5").  Extract limit from the message if specified, default 10.
44. Use leads_mark_replied when Neb reports that a lead has replied (e.g. "X ha risposto", "mark replied X", "risposta da X", "ho ricevuto risposta da X"). Extract the company name from the message.
45. Use harvest_automation_status when Neb asks about the weekly harvest automation status (e.g. "stato harvest automatica", "quando gira il harvest?", "è attiva l'automazione lead?").
46. Use harvest_automation_config when Neb wants to configure or enable/disable the weekly harvest (e.g. "attiva harvest settimanale", "imposta harvest ogni lunedì per ristoranti a Milano", "aggiungi settore dentisti a Roma", "disattiva harvest automatica"). Extract sectors as array of {query, location, limit?}.
47. Use harvest_automation_run when Neb wants to trigger the weekly harvest immediately (e.g. "avvia harvest manuale", "run harvest automation ora", "fai girare l'harvest adesso").
48. Use content_generate when Neb wants WAI to write a content piece for a client or for himself. Required: type (blog|social|newsletter), topic. Optional: tone (default "professional"), client_slug, project_slug. Output is a .md file saved to the project workspace (or personal workspace if no client/project) — a Telegram preview with approval buttons will follow automatically. Do NOT use create_task for content generation requests.

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

  // --- Read URL ---
  const readUrlMatch = text.match(/^(?:leggi|analizza|riassumi|read|summarize)\s+(https?:\/\/[^\s]+|[a-z0-9.-]+\.[a-z]{2,}[^\s]*)$/i)
  if (readUrlMatch?.[1]) {
    let url = readUrlMatch[1].trim()
    if (!url.startsWith('http')) url = `https://${url}`
    return {
      action: 'execute',
      message: `Leggo e analizzo il contenuto di ${url}.`,
      commands: [{ type: 'read_url', params: { url } }],
    }
  }

  // --- Second Brain: save note ---
  const brainSaveMatch = text.match(/^(?:ricorda(?:ti)?|salva\s+nota|brain\s+save|secondo\s+cervello\s+salva)[:\s]+(.+)$/is)
  if (brainSaveMatch?.[1]) {
    const content = brainSaveMatch[1].trim()
    return {
      action: 'execute',
      message: `Salvo nel Second Brain: "${content.slice(0, 80)}${content.length > 80 ? '…' : ''}"`,
      commands: [{ type: 'brain_save', params: { text: content } }],
    }
  }

  // --- Second Brain: save URL ---
  const brainUrlMatch = text.match(/^(?:brain\s+url|salva\s+(?:url|articolo|link)|secondo\s+cervello\s+(?:url|link))[:\s]+(https?:\/\/[^\s]+|[a-z0-9.-]+\.[a-z]{2,}[^\s]*)$/i)
  if (brainUrlMatch?.[1]) {
    let targetUrl = brainUrlMatch[1].trim()
    if (!targetUrl.startsWith('http')) targetUrl = `https://${targetUrl}`
    return {
      action: 'execute',
      message: `Salvo nel Second Brain: ${targetUrl}`,
      commands: [{ type: 'brain_url', params: { url: targetUrl } }],
    }
  }

  // --- Second Brain: search ---
  const brainSearchMatch = text.match(/^(?:cosa\s+so\s+su|cerca\s+nel\s+(?:cervello|second\s+brain|brain)|brain\s+search|secondo\s+cervello[,:\s]+cerca)[:\s]+(.+)$/i)
  if (brainSearchMatch?.[1]) {
    const query = brainSearchMatch[1].trim()
    return {
      action: 'execute',
      message: `Cerco nel Second Brain: "${query}"`,
      commands: [{ type: 'brain_search', params: { query } }],
    }
  }

  // --- Screenshot ---
  const screenshotMatch = text.match(/^(?:fai uno\s+)?(?:screenshot|screen|snapshot)\s+(?:di\s+)?(https?:\/\/[^\s]+|[a-z0-9.-]+\.[a-z]{2,}[^\s]*)$/i)
  if (screenshotMatch?.[1]) {
    let url = screenshotMatch[1].trim()
    if (!url.startsWith('http')) url = `https://${url}`
    return {
      action: 'execute',
      message: `Catturo uno screenshot di ${url}.`,
      commands: [{ type: 'capture_screenshot', params: { url } }],
    }
  }

  // --- Status report ---
  if (/^(status|stato|report|system status|stato sistema|status report|wai status|mostra status|dimmi lo status)$/i.test(normalized)) {
    return {
      action: 'reply',
      message: 'Genero il report di sistema.',
      commands: [{ type: 'status_report', params: {} }],
    }
  }

  // --- Lista clienti ---
  if (/^(clienti|lista clienti|list clients|elenco clienti|mostra clienti|show clients|clients)$/i.test(normalized)) {
    return {
      action: 'reply',
      message: 'Ecco i clienti WAI.',
      commands: [{ type: 'list_clients', params: {} }],
    }
  }

  // --- Lista progetti ---
  if (/^(progetti|lista progetti|list projects|elenco progetti|mostra progetti|show projects|projects|all projects|tutti i progetti)$/i.test(normalized)) {
    return {
      action: 'reply',
      message: 'Ecco i progetti WAI.',
      commands: [{ type: 'list_projects', params: {} }],
    }
  }

  // --- Weekly digest ---
  if (/(weekly digest|digest settimanale|recap settimanale|weekly recap|riepilogo settimanale)/i.test(normalized)) {
    return {
      action: 'execute',
      message: 'Genero il weekly digest.',
      commands: [{ type: 'weekly_digest', params: {} }],
    }
  }

  // --- Daily brief ---
  if (/(daily founder brief|brief giornaliero|brief quotidiano|daily brief)/i.test(normalized)) {
    return {
      action: 'execute',
      message: 'Genero il daily founder brief.',
      commands: [{ type: 'daily_founder_brief', params: {} }],
    }
  }

  // --- Drive: file recenti ---
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

  // --- Gmail: ultima email ---
  if (/(ultima email|latest email|last email|leggi l'ultima email|leggi ultima mail|ultima mail)/i.test(normalized)) {
    return {
      action: 'execute',
      message: 'Recupero l\u2019ultima email.',
      commands: [{ type: 'gmail_latest_message', params: {} }],
    }
  }

  // --- Gmail: inbox summary ---
  if (/(inbox|email ricevute|riassumimi le email|summary inbox|summarize inbox)/i.test(normalized)) {
    return {
      action: 'execute',
      message: 'Controllo e riassumo la inbox.',
      commands: [{ type: 'gmail_inbox_summary', params: {} }],
    }
  }

  // --- Calendar ---
  if (/(agenda di oggi|calendar today|today agenda|today calendar|eventi di oggi|riunioni di oggi)/i.test(normalized)) {
    return {
      action: 'execute',
      message: 'Recupero l\u2019agenda di oggi.',
      commands: [{ type: 'calendar_today', params: {} }],
    }
  }

  // --- Drive: read file ---
  const driveReadMatch = text.match(/(?:leggi|apri|read|open)\s+(?:il\s+file\s+)?(.+?)\s+(?:su\s+google\s+drive|su\s+drive)$/i)
  if (driveReadMatch?.[1]?.trim()) {
    return {
      action: 'execute',
      message: 'Recupero il contenuto del file da Google Drive.',
      commands: [{ type: 'drive_read_file', params: { query: driveReadMatch[1].trim() } }],
    }
  }

  // --- Drive: find file ---
  const driveFindMatch = text.match(/(?:trova|cerca|find|search)\s+(?:su\s+google\s+drive\s+)?(?:il\s+file\s+)?(.+?)(?:\s+su\s+google\s+drive|\s+su\s+drive)?$/i)
  if (driveFindMatch?.[1]?.trim() && /google drive|drive/i.test(normalized)) {
    return {
      action: 'execute',
      message: 'Cerco il file su Google Drive.',
      commands: [{ type: 'drive_find_file', params: { query: driveFindMatch[1].trim() } }],
    }
  }

  // --- Retry QA only ---
  const retryQaMatch = text.match(/^(?:\/)?retry[-\s]qa\s+([a-f0-9-]{4,36})$/i)
  if (retryQaMatch?.[1]?.trim()) {
    return {
      action: 'execute',
      message: 'Rilancio il solo gate QA sul task.',
      commands: [{ type: 'retry_qa', params: { task_ref: retryQaMatch[1].trim() } }],
    }
  }

  // --- Browser read (PinchTab) ---
  const browserReadMatch = text.match(/^(?:browser\s+(?:leggi|read|scraping)|leggi\s+browser|scraping\s+browser)\s+(https?:\/\/[^\s]+|[a-z0-9.-]+\.[a-z]{2,}[^\s]*)$/i)
  if (browserReadMatch?.[1]) {
    let url = browserReadMatch[1].trim()
    if (!url.startsWith('http')) url = `https://${url}`
    return {
      action: 'execute',
      message: `Leggo il contenuto di ${url} via browser PinchTab.`,
      commands: [{ type: 'browser_read', params: { url } }],
    }
  }

  // --- Browser screenshot (PinchTab) ---
  const browserScreenMatch = text.match(/^(?:browser\s+(?:screenshot|screen|snap)|pt\s+(?:screenshot|screen))\s+(https?:\/\/[^\s]+|[a-z0-9.-]+\.[a-z]{2,}[^\s]*)$/i)
  if (browserScreenMatch?.[1]) {
    let url = browserScreenMatch[1].trim()
    if (!url.startsWith('http')) url = `https://${url}`
    return {
      action: 'execute',
      message: `Catturo uno screenshot live di ${url} via PinchTab.`,
      commands: [{ type: 'browser_screenshot', params: { url } }],
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

function formatDeliveryConfigSummary(config: DeliveryConfig): string {
  return [
    `- Git Push: ${config.gitPush ? 'ON' : 'OFF'}`,
    `- Auto Deploy: ${config.autoDeploy ? 'ON' : 'OFF'}`,
    `- Deploy Provider: ${config.deployProvider ?? 'none'}`,
    `- Founder Approval: ${config.requireFounderApproval ? 'ON' : 'OFF'}`,
    `- Client Email: ${config.clientEmailOnDelivery ? 'ON' : 'OFF'}`,
    `- Auto Invoice: ${config.autoInvoice ? 'ON' : 'OFF'}`,
  ].join('\n')
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

/**
 * T112/T113: Cleans up error messages to prevent breaking Telegram Markdown.
 * Removes ANSI escape codes, removes problematic markdown symbols, and truncates length.
 */
function sanitizeErrorForTelegram(msg: string): string {
  return msg
    .replace(/\u001b\[[0-9;]*m/g, '') // Remove ANSI escape codes
    .replace(/[`*#_\[\]()]/g, '')     // Remove characters that trigger markdown entities
    .slice(0, 500)                    // Limit length
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

function resolveFounderOutputLanguage(preferredLanguage?: string): { code: 'it' | 'en'; label: string } {
  const normalized = preferredLanguage?.trim().toLowerCase() ?? 'it'
  if (normalized.startsWith('en')) {
    return { code: 'en', label: 'English' }
  }

  return { code: 'it', label: 'Italian' }
}

async function summarizeFounderInbox(rawInboxMetadata: string, query: string, preferredLanguage?: string): Promise<string> {
  const fallback = rawInboxMetadata.trim()
  const language = resolveFounderOutputLanguage(preferredLanguage)

  try {
    const result = await runAgent([
      {
        role: 'system',
        content: `You summarize a founder's inbox for action.

Rules:
- Use only the provided email metadata.
- Write in ${language.label}.
- Do not switch language even if the emails contain mixed-language content.
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
  recentKnowledgeSummary?: string
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

  if (input.recentKnowledgeSummary) {
    sections.push('', '## Second Brain — Recent Items', '', input.recentKnowledgeSummary.trim())
  }

  return sections.join('\n').trim()
}

async function summarizeFounderCalendar(rawEvents: string, preferredLanguage?: string): Promise<string> {
  const fallback = rawEvents.trim()
  const language = resolveFounderOutputLanguage(preferredLanguage)

  try {
    const result = await runAgent([
      {
        role: 'system',
        content: `You summarize a founder's daily calendar.

Rules:
- Use only the provided event list.
- Write concise markdown in ${language.label}.
- Do not switch language even if event titles or attendees use another language.
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
      const personalContext = await getPersonalContext()
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

        const summary = await summarizeFounderCalendar(
          eventsResult.text,
          personalContext.profile.preferredLanguage,
        )

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
          ? await summarizeFounderInbox(
              inboxMetadata.text,
              inboxQuery,
              personalContext.profile.preferredLanguage,
            )
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
          : await summarizeFounderCalendar(
              calendarResult.text,
              personalContext.profile.preferredLanguage,
            )

        const driveResult = await callGoogleWorkspaceMcpTool('search_drive_files', {
          query: buildRecentDriveQuery(driveDays),
          page_size: 6,
          detailed: true,
        })
        const driveSummary = /No files found/i.test(driveResult.text)
          ? `No Drive files modified in the last ${driveDays} days.`
          : driveResult.text

        // Second Brain: surface the 5 most recently saved items
        let recentKnowledgeSummary: string | undefined
        try {
          const knowledgeItems = await listKnowledgeItems('neb', { limit: 5 })
          if (knowledgeItems.length > 0) {
            recentKnowledgeSummary = knowledgeItems
              .map((item) => `- **${item.title}** *(${item.source_type}, ${item.created_at.slice(0, 10)})*`)
              .join('\n')
          }
        } catch {
          // non-fatal: brief still works without knowledge section
        }

        const title = `Daily Founder Brief — ${new Date().toISOString().slice(0, 10)}`
        const report = buildFounderDailyBriefReport({
          founderName: personalContext.profile.displayName,
          userGoogleEmail,
          timezone: personalContext.profile.timezone,
          inboxQuery,
          inboxSummary,
          calendarSummary,
          recentDriveSummary: truncateReplyText(driveSummary, 3000),
          ...(recentKnowledgeSummary ? { recentKnowledgeSummary } : {}),
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

      const existing = await findClientFuzzy(slug)
      if (existing) {
        return `⚠️ Cliente *${existing.name}* già esistente (\`${existing.slug}\`) — uso quello esistente`
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

      const client = await findClientFuzzy(clientSlug)
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

      const client = await findClientFuzzy(clientSlug)
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

      const client = await findClientFuzzy(clientSlug)
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
        clientObj = await findClientFuzzy(clientSlug)
        if (!clientObj) throw new Error(`Cliente \`${clientSlug}\` non trovato`)

        if (projectSlug) {
          const project = await getProjectBySlug(clientObj.id, projectSlug)
          if (!project) throw new Error(`Progetto \`${projectSlug}\` non trovato per ${clientObj.name}`)

          projectId = project.id
          scopeLabel = ` | *${clientObj.name}* / *${project.name}*`

          // Reset stuck project status when launching new work
          if (project.status === 'blocked' || project.status === 'review') {
            await updateProjectStatus(project.id, 'active').catch(() => { /* non-fatal */ })
          }

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

      // T109 — deduplication guard: block if project already has an active task
      if (projectId) {
        const activeTasks = await getInProgressTasksByProject(projectId)
        if (activeTasks.length > 0) {
          const active = activeTasks[0]!
          return `⚠️ *Task non creato* — il progetto ha già un task in lavorazione (\`${active.id.slice(0, 8)}\`): *${active.title}*\n\nAspetta che finisca o usa \`retry_task\` se è bloccato.`
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

    // ── retry_qa ──────────────────────────────────────────────────────────
    case 'retry_qa': {
      const taskRef = getString(params, 'task_ref') ?? getString(params, 'task_id')

      if (!taskRef) throw new Error('task_ref mancante per retry_qa')

      const task = await getTaskByReference(taskRef)
      if (!task) throw new Error(`Task non trovato: ${taskRef}`)

      if (task.status !== 'blocked' && task.status !== 'in_progress') {
        throw new Error(
          `Task è in stato "${task.status}" — retry_qa supporta solo task bloccati o in corso`
        )
      }

      await recordEvent('founder_command', {
        taskId: task.id,
        payload: {
          command: 'retry_qa_only',
          source: 'natural_language',
          task_ref: taskRef,
          resolved_task_id: task.id,
        },
      })

      void runQaAgent(task, notify).catch((err: unknown) => {
        log.error({ err, taskId: task.id }, 'retry_qa: QA agent failed')
      })

      return [
        `🔁 *QA rilanciato (solo gate QA)*`,
        ``,
        `ID: \`${task.id.slice(0, 8)}\``,
        `Title: ${task.title}`,
        `Agent: qa`,
        ``,
        `Il gate QA è in esecuzione — Architect e Dev General saltati.`,
      ].join('\n')
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

    // ── capture_screenshot ───────────────────────────────────────────────
    case 'capture_screenshot': {
      const url = getString(params, 'url')
      const caption = getString(params, 'caption')

      if (!url) throw new Error('url mancante per capture_screenshot')

      const personalContext = await getPersonalContext()
      const outputDir = personalContext.outputPath
      await mkdir(outputDir, { recursive: true })

      const screenshotPath = join(outputDir, 'screenshot.png')
      const result = await captureScreenshot(url, screenshotPath)

      if (!result.ok) {
        throw new Error(`Screenshot fallito: ${result.error}`)
      }

      await recordEvent('founder_command', {
        payload: {
          command: 'nl_capture_screenshot',
          source: 'natural_language',
          url,
          path: screenshotPath,
        },
      })

      // Send the photo via Telegram
      await sendFounderPhoto(screenshotPath, caption || `📸 Screenshot di ${url}`)

      return `📸 Screenshot di ${url} catturato e inviato.`
    }

    // ── read_url ─────────────────────────────────────────────────────────
    case 'read_url': {
      const url = getString(params, 'url')
      if (!url) throw new Error('url mancante per read_url')

      const scrapeResult = await scrapeUrl(url)
      if (!scrapeResult.ok) {
        throw new Error(`Lettura URL fallita: ${scrapeResult.error}`)
      }

      const title = scrapeResult.title || `Deep Read — ${url}`
      const filename = `read-${slugify(title.slice(0, 50))}-${Date.now()}.md`

      const exportResult = await executeTool('file_export', {
        title,
        filename,
        format: 'md',
        content: scrapeResult.markdown || '',
        mode: 'personal',
      }, {
        agentId: 'ceo',
      })

      await recordEvent('founder_command', {
        payload: {
          command: 'nl_read_url',
          source: 'natural_language',
          url,
          title: scrapeResult.title,
          path: exportResult.relativePath,
        },
      })

      const excerpt = scrapeResult.excerpt ? `\n\n> ${scrapeResult.excerpt}` : ''
      return `📖 *${title}* ${excerpt}\n\nContenuto estratto e salvato in \`${exportResult.relativePath}\`.`.trim()
    }

    // ── browser_navigate ─────────────────────────────────────────────────
    case 'browser_navigate': {
      const url = getString(params, 'url')
      if (!url) throw new Error('url mancante per browser_navigate')

      const ptUnavailable = await isPinchTabAvailable().then((ok) => !ok)
      if (ptUnavailable) {
        return '⚠️ PinchTab non disponibile. Assicurati che PinchTab sia in esecuzione su http://127.0.0.1:9867 e riprova.'
      }

      const navResult = await browserNavigate(url, { blockImages: true })
      if (!navResult.ok) {
        return `⚠️ PinchTab: impossibile aprire ${url} (${navResult.error}). Alcuni siti bloccano i browser automatizzati.`
      }

      await recordEvent('founder_command', {
        payload: { command: 'nl_browser_navigate', source: 'natural_language', url },
      })

      return `🌐 Browser aperto su ${url}`
    }

    // ── browser_read ─────────────────────────────────────────────────────
    case 'browser_read': {
      const url = getString(params, 'url')

      const ptUnavailable = await isPinchTabAvailable().then((ok) => !ok)
      if (ptUnavailable) {
        return '⚠️ PinchTab non disponibile. Assicurati che PinchTab sia in esecuzione su http://127.0.0.1:9867 e riprova.'
      }

      if (url) {
        const navResult = await browserNavigate(url, { blockImages: true })
        if (!navResult.ok) {
          return `⚠️ PinchTab: impossibile navigare a ${url} (${navResult.error}). Il sito potrebbe bloccare browser automatizzati. Prova con \`read_url\` per pagine statiche.`
        }
      }

      const textResult = await browserText({ mode: 'readability' })
      if (!textResult.ok) {
        return `⚠️ PinchTab: estrazione testo fallita (${textResult.error}).`
      }

      const rawTextData = textResult.data as Record<string, unknown>
      const pageText = typeof rawTextData?.['text'] === 'string'
        ? rawTextData['text']
        : typeof rawTextData?.['content'] === 'string'
          ? rawTextData['content']
          : String(textResult.data ?? '')
      const pageTitle = typeof rawTextData?.['title'] === 'string'
        ? rawTextData['title']
        : url ? `Browser Read — ${url}` : 'Browser Read'

      if (!pageText.trim()) {
        return `⚠️ PinchTab: nessun testo estratto dalla pagina${url ? ` ${url}` : ''}. Il sito potrebbe richiedere JavaScript avanzato o autenticazione.`
      }

      const filename = `browser-read-${slugify(pageTitle.slice(0, 50))}-${Date.now()}.md`
      const exportResult = await executeTool('file_export', {
        title: pageTitle,
        filename,
        format: 'md',
        content: pageText,
        mode: 'personal',
      }, { agentId: 'ceo' })

      await recordEvent('founder_command', {
        payload: { command: 'nl_browser_read', source: 'natural_language', url: url ?? '(current page)', title: pageTitle, path: exportResult.relativePath },
      })

      const textExcerpt = pageText.slice(0, 400).replace(/\n+/g, ' ').trim()
      return `🌐 *${pageTitle}*\n\n> ${textExcerpt}…\n\nContenuto estratto e salvato in \`${exportResult.relativePath}\`.`
    }

    // ── browser_screenshot ───────────────────────────────────────────────
    case 'browser_screenshot': {
      const url = getString(params, 'url')
      const caption = getString(params, 'caption')

      const ptUnavailable = await isPinchTabAvailable().then((ok) => !ok)
      if (ptUnavailable) {
        return '⚠️ PinchTab non disponibile. Assicurati che PinchTab sia in esecuzione su http://127.0.0.1:9867 e riprova.'
      }

      if (url) {
        const navResult = await browserNavigate(url, { blockImages: false })
        if (!navResult.ok) {
          return `⚠️ PinchTab: impossibile navigare a ${url} (${navResult.error}).`
        }
      }

      const screenshotResult = await pinchTabScreenshot()
      if (!screenshotResult.ok) {
        return `⚠️ PinchTab: screenshot fallito (${screenshotResult.error}).`
      }

      const rawScreenData = screenshotResult.data as Record<string, unknown>
      const base64 =
        typeof rawScreenData?.['base64'] === 'string' ? rawScreenData['base64'] :
        typeof rawScreenData?.['image'] === 'string' ? rawScreenData['image'] :
        typeof rawScreenData?.['screenshot'] === 'string' ? rawScreenData['screenshot'] :
        typeof rawScreenData?.['data'] === 'string' ? rawScreenData['data'] :
        typeof screenshotResult.data === 'string' ? screenshotResult.data : null

      if (!base64) {
        return '⚠️ PinchTab: risposta screenshot non riconosciuta — campo immagine assente. Controlla la versione API.'
      }

      const cleanBase64 = base64.replace(/^data:image\/[a-z]+;base64,/, '')
      const personalContext = await getPersonalContext()
      const outputDir = personalContext.outputPath
      await mkdir(outputDir, { recursive: true })

      const screenshotPath = join(outputDir, `browser-screenshot-${Date.now()}.png`)
      await writeFile(screenshotPath, Buffer.from(cleanBase64, 'base64'))

      await sendFounderPhoto(screenshotPath, caption ?? `📸 Browser screenshot${url ? ` di ${url}` : ''}`)

      await recordEvent('founder_command', {
        payload: { command: 'nl_browser_screenshot', source: 'natural_language', url: url ?? '(current page)', path: screenshotPath },
      })

      return `📸 Browser screenshot${url ? ` di ${url}` : ''} catturato e inviato.`
    }

    // ── browser_snapshot ─────────────────────────────────────────────────
    case 'browser_snapshot': {
      const url = getString(params, 'url')

      const ptUnavailable = await isPinchTabAvailable().then((ok) => !ok)
      if (ptUnavailable) {
        return '⚠️ PinchTab non disponibile. Assicurati che PinchTab sia in esecuzione su http://127.0.0.1:9867 e riprova.'
      }

      if (url) {
        const navResult = await browserNavigate(url, { blockImages: true })
        if (!navResult.ok) {
          return `⚠️ PinchTab: impossibile navigare a ${url} (${navResult.error}).`
        }
      }

      const snapshotResult = await browserSnapshot({ format: 'compact', maxTokens: 2000 })
      if (!snapshotResult.ok) {
        return `⚠️ PinchTab: snapshot DOM fallito (${snapshotResult.error}).`
      }

      const rawSnapData = snapshotResult.data as Record<string, unknown>
      const snapshotText =
        typeof rawSnapData?.['snapshot'] === 'string' ? rawSnapData['snapshot'] :
        typeof rawSnapData?.['content'] === 'string' ? rawSnapData['content'] :
        typeof snapshotResult.data === 'string' ? snapshotResult.data :
        JSON.stringify(snapshotResult.data).slice(0, 2000)

      await recordEvent('founder_command', {
        payload: { command: 'nl_browser_snapshot', source: 'natural_language', url: url ?? '(current page)' },
      })

      return `🔍 DOM Snapshot${url ? ` di ${url}` : ''}:\n\n\`\`\`\n${snapshotText}\n\`\`\``
    }

    // ── configure_delivery ───────────────────────────────────────────────
    case 'configure_delivery': {
      const clientSlug = getString(params, 'client_slug')
      const projectSlug = getString(params, 'project_slug')
      const configPatch = sanitizeDeliveryConfigPatch(params['config_patch'])

      if (!clientSlug) throw new Error('client_slug mancante per configure_delivery')
      if (!projectSlug) throw new Error('project_slug mancante per configure_delivery')
      if (Object.keys(configPatch).length === 0) {
        throw new Error('config_patch mancante o non valido per configure_delivery')
      }

      const client = await getClientBySlug(clientSlug)
      if (!client) throw new Error(`Cliente \`${clientSlug}\` non trovato`)

      const project = await getProjectBySlug(client.id, projectSlug)
      if (!project) throw new Error(`Progetto \`${projectSlug}\` non trovato per ${client.name}`)

      const nextConfig = await updateProjectDeliveryConfig(project.id, configPatch)

      await recordEvent('founder_command', {
        payload: {
          command: 'nl_configure_delivery',
          source: 'natural_language',
          client_slug: clientSlug,
          project_slug: projectSlug,
          project_id: project.id,
          config_patch: configPatch,
        },
      })

      return [
        `✅ Delivery config aggiornata per *${project.name}*`,
        ``,
        formatDeliveryConfigSummary(nextConfig),
      ].join('\n')
    }

    case 'brain_save': {
      const text = getString(params, 'text') || getString(params, 'content') || getString(params, 'note')
      if (!text) return '⚠️ brain_save: testo mancante.'
      const tags = Array.isArray(params['tags']) ? (params['tags'] as string[]) : undefined
      const item = await ingestNote('neb', text, tags)
      if (!item) return '⚠️ Second Brain: nota troppo simile a un contenuto già esistente — salvataggio saltato.'
      return `🧠 Nota salvata nel Second Brain: *${item.title}*`
    }

    case 'brain_url': {
      const rawUrl = getString(params, 'url')
      if (!rawUrl) return '⚠️ brain_url: URL mancante.'
      const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`
      const tags = Array.isArray(params['tags']) ? (params['tags'] as string[]) : undefined
      try {
        const item = await ingestKnowledgeUrl('neb', url, tags)
        if (!item) return '⚠️ Second Brain: contenuto troppo simile a un elemento già esistente — salvataggio saltato.'
        return `🧠 URL salvato nel Second Brain: *${item.title}*`
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (/name.*not.*resolved|invalid url|navigation|timeout/i.test(msg)) {
          return `⚠️ Impossibile raggiungere \`${url}\` — verifica che il dominio sia online e accessibile.`
        }
        throw err
      }
    }

    case 'brain_search': {
      const query = getString(params, 'query') || getString(params, 'q')
      if (!query) return '⚠️ brain_search: query mancante.'
      const matches = await searchKnowledge('neb', query, 5)
      if (matches.length === 0) return `🧠 Nessun risultato trovato nel Second Brain per: "${query}"`
      const lines = matches.map((m, i) => `${i + 1}. *${m.title}* (${Math.round(m.similarity * 100)}%)\n${m.content.slice(0, 200)}…`)
      return `🧠 Second Brain — risultati per "${query}":\n\n${lines.join('\n\n')}`
    }

    case 'crm_add_contact': {
      const name = getString(params, 'name')
      if (!name) return '⚠️ crm_add_contact: name mancante.'
      const contact = await crmUpsertContact({
        name,
        email: getString(params, 'email') || null,
        company: getString(params, 'company') || null,
        notes: getString(params, 'notes') || '',
        tags: Array.isArray(params['tags']) ? (params['tags'] as string[]) : [],
      })
      const companyStr = contact.company ? ` (${contact.company})` : ''
      return `✅ Contatto salvato: *${contact.name}*${companyStr}`
    }

    case 'crm_log_interaction': {
      const contactQuery = getString(params, 'contact') || getString(params, 'name')
      if (!contactQuery) return '⚠️ crm_log_interaction: contact mancante.'
      const intType = getString(params, 'type')
      const validTypes = ['email_in', 'email_out', 'meeting', 'note', 'call']
      if (!intType || !validTypes.includes(intType)) return `⚠️ crm_log_interaction: type non valido. Valori: ${validTypes.join(', ')}`
      const summary = getString(params, 'summary')
      if (!summary) return '⚠️ crm_log_interaction: summary mancante.'
      const rawOccurredAt = getString(params, 'occurred_at')
      const occurredAt = rawOccurredAt && !isNaN(Date.parse(rawOccurredAt))
        ? new Date(rawOccurredAt).toISOString()
        : new Date().toISOString()

      let contact = await findContactByNameOrEmail(contactQuery)
      if (!contact) {
        contact = await crmUpsertContact({ name: contactQuery })
      }

      await crmAddInteraction(contact.id, {
        type: intType as 'email_in' | 'email_out' | 'meeting' | 'note' | 'call',
        summary,
        source: 'manual',
        occurred_at: occurredAt,
      })
      return `✅ Interazione loggata per *${contact.name}*: ${summary.slice(0, 80)}${summary.length > 80 ? '…' : ''}`
    }

    case 'crm_get_contacts': {
      const statusParam = getString(params, 'status')
      const validStatuses = ['active', 'follow_up', 'dormant']
      const filter = statusParam && validStatuses.includes(statusParam)
        ? { status: statusParam as 'active' | 'follow_up' | 'dormant' }
        : undefined
      const contacts = await crmGetContacts(filter)
      if (contacts.length === 0) {
        return filter
          ? `📋 Nessun contatto con status "${filter.status}".`
          : '📋 Nessun contatto nel CRM.'
      }
      const list = contacts.slice(0, 15).map((c, i) => {
        const statusEmoji = c.status === 'follow_up' ? '🟡' : c.status === 'active' ? '🟢' : '⚫'
        const companyStr = c.company ? ` — ${c.company}` : ''
        const lastContact = c.last_contact_at
          ? ` | ultimo contatto: ${new Date(c.last_contact_at).toLocaleDateString('it-IT')}`
          : ''
        return `${i + 1}. ${statusEmoji} *${c.name}*${companyStr}${lastContact}`
      })
      const header = filter ? `📋 Contatti (${filter.status}):` : `📋 Tutti i contatti (${contacts.length}):`
      return [header, ...list].join('\n')
    }

    case 'crm_follow_up_due': {
      const contacts = await crmGetContacts({ status: 'follow_up' })
      if (contacts.length === 0) return '✅ Nessun follow-up in sospeso.'
      const list = contacts.map((c, i) => {
        const lastContact = c.last_contact_at
          ? `ultimo contatto: ${new Date(c.last_contact_at).toLocaleDateString('it-IT')}`
          : 'nessun contatto registrato'
        const notesSnippet = c.notes ? ` — ${c.notes.slice(0, 80)}${c.notes.length > 80 ? '…' : ''}` : ''
        return `${i + 1}. *${c.name}* | ${lastContact}${notesSnippet}`
      })
      return [`🔔 Follow-up in sospeso (${contacts.length}):`, ...list].join('\n')
    }

    case 'meeting_save': {
      const title = getString(params, 'title') || 'Meeting'
      const rawNotes = getString(params, 'notes') || getString(params, 'raw_notes') || ''
      const attendeesRaw = getString(params, 'attendees') || ''
      const attendees = attendeesRaw
        ? attendeesRaw.split(',').map((a) => a.trim()).filter(Boolean)
        : []
      const dateParam = getString(params, 'date') || ''
      const meetingDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
        ? dateParam
        : new Date().toISOString().slice(0, 10)

      let summary = ''
      let actionItems: import('../types/index.js').ActionItem[] = []
      if (rawNotes.trim().length > 0) {
        try {
          const result = await summarizeMeetingNotes(title, rawNotes, attendees)
          summary = result.summary
          actionItems = result.action_items
        } catch (err) {
          log.warn({ err }, 'CEO Intake: meeting summarization failed — saving without summary')
        }
      }

      const note = await saveMeetingNote({
        title,
        meeting_date: meetingDate,
        attendees,
        raw_notes: rawNotes,
        summary,
        action_items: actionItems,
      })

      const attendeesStr = attendees.length > 0 ? ` con ${attendees.join(', ')}` : ''
      const actionStr = actionItems.length > 0
        ? `\n\n📌 Action items:\n${actionItems.map((a, i) => `${i + 1}. ${a.text}`).join('\n')}`
        : ''
      const summaryStr = summary ? `\n\n📝 Summary: ${summary}` : ''
      return `✅ Note riunione salvate: *${note.title}*${attendeesStr} (${meetingDate})${summaryStr}${actionStr}`
    }

    case 'meeting_list': {
      const notes = await listMeetingNotes(10)
      if (notes.length === 0) return '📅 Nessuna nota riunione salvata.'
      const list = notes.map((n, i) => {
        const attendeesStr = n.attendees.length > 0 ? ` — ${n.attendees.join(', ')}` : ''
        const actionCount = Array.isArray(n.action_items) ? n.action_items.length : 0
        const doneCount = Array.isArray(n.action_items)
          ? (n.action_items as import('../types/index.js').ActionItem[]).filter((a) => a.done).length
          : 0
        const actionStr = actionCount > 0 ? ` | ${doneCount}/${actionCount} action items` : ''
        return `${i + 1}. 📅 *${n.title}*${attendeesStr} (${n.meeting_date})${actionStr}`
      })
      return [`📅 Ultime riunioni (${notes.length}):`, ...list].join('\n')
    }

    case 'leads_harvest': {
      const query = getString(params, 'query') || 'aziende'
      const location = getString(params, 'location') || 'Italy'
      const limitRaw = params['limit']
      const limit = typeof limitRaw === 'number' ? Math.min(limitRaw, 20) : 10
      // Non-blocking harvest
      void (async () => {
        try {
          await harvestLeads({ query, location, limit, sector: query })
        } catch (err) {
          log.error({ err }, 'CEO Intake: leads_harvest background error')
        }
      })()
      return `🔍 Harvest avviata: cerco ${limit} ${query} a ${location}. I lead appariranno nel dashboard Leads entro 2-3 minuti.`
    }

    case 'leads_show': {
      const leads = await crmGetLeads()
      if (leads.length === 0) return '📋 Nessun lead nel sistema ancora. Avvia una harvest per trovare potenziali clienti.'
      const statusCounts: Record<string, number> = {}
      for (const l of leads) {
        statusCounts[l.status] = (statusCounts[l.status] ?? 0) + 1
      }
      const statusSummary = Object.entries(statusCounts)
        .map(([s, n]) => `${n} ${s}`)
        .join(' | ')
      const top5 = leads
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((l, i) => {
          const finding = l.findings[0]?.description?.slice(0, 60) ?? 'n/a'
          return `${i + 1}. *${l.company_name}* (score: ${l.score}) — ${finding}`
        })
      return [`📋 Proposal Inbox: ${statusSummary}`, '', 'Top 5 per score:', ...top5].join('\n')
    }

    case 'leads_send_approved': {
      const approved = await crmGetLeads({ status: 'approved' })
      const withEmail = approved.filter((l) => !!l.contact_email)
      if (withEmail.length === 0) return '📋 Nessun lead approvato con email disponibile.'
      const sent: string[] = []
      const failed: string[] = []
      for (const lead of withEmail) {
        try {
          await executeOutreach(lead.id)
          sent.push(lead.company_name)
        } catch (err) {
          log.error({ err, leadId: lead.id }, 'CEO Intake: leads_send_approved executeOutreach failed')
          failed.push(lead.company_name)
        }
      }
      const result = [`✅ Outreach inviato a ${sent.length} contatti: ${sent.join(', ')}`]
      if (failed.length > 0) result.push(`⚠️ Fallito per: ${failed.join(', ')}`)
      return result.join('\n')
    }

    case 'leads_approve_top': {
      const rawLimit = params['limit']
      const limit = typeof rawLimit === 'number' && rawLimit > 0
        ? Math.min(rawLimit, 50)
        : 10
      const qualified = await crmGetLeads({ status: 'qualified' })
      if (qualified.length === 0) return '📋 Nessun lead qualificato disponibile.'
      const toApprove = qualified
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
      for (const lead of toApprove) {
        await updateLeadStatus(lead.id, 'approved')
      }
      const names = toApprove.map((l) => `• ${l.company_name} (score: ${l.score})`).join('\n')
      return `✅ Approvati ${toApprove.length} lead:\n${names}`
    }

    case 'leads_mark_replied': {
      const company = getString(params, 'company')
      if (!company) return '⚠️ Specifica il nome dell\'azienda. Es: "X ha risposto".'
      // Search among sent leads (follow-up leaves status as 'sent', only follow_up_count changes)
      const allSent = await crmGetLeads({ status: 'sent' })
      const match = allSent.find(
        (l) => l.company_name.toLowerCase().includes(company.toLowerCase()),
      )
      if (!match) return `⚠️ Nessun lead "sent" trovato per "${company}". Controlla il nome.`
      await updateLeadStatus(match.id, 'replied', { replied_at: new Date().toISOString() })
      return `✅ ${match.company_name} segnato come replied. Status → replied.`
    }

    case 'harvest_automation_status': {
      const status = await getPersonalAutomationStatus()
      const h = status.weeklyLeadHarvest
      const lines = [
        `🌱 Weekly Lead Harvest Automation`,
        `Stato: ${h.enabled ? '✅ Attiva' : '⏸ Disattivata'}`,
        `Scheduling: ${h.scheduleDay} alle ${h.scheduleLocalTime} (${h.timezone})`,
        `Settori configurati: ${h.sectors.length > 0 ? h.sectors.map((s) => `${s.query} @ ${s.location}`).join(', ') : 'nessuno'}`,
        `Ultimo run: ${h.lastRunAt ? new Date(h.lastRunAt).toLocaleString('it-IT') : 'mai'}`,
        h.lastLeadsFound !== undefined ? `Lead trovati l'ultima volta: ${h.lastLeadsFound}` : null,
        h.nextPlannedRunLabel ? `Prossimo run: ${h.nextPlannedRunLabel}` : null,
        h.lastError ? `⚠️ Ultimo errore: ${h.lastError}` : null,
      ].filter(Boolean).join('\n')
      return lines
    }

    case 'harvest_automation_config': {
      const input: Parameters<typeof updateWeeklyLeadHarvestAutomation>[0] = {}
      if (typeof params['enabled'] === 'boolean') input.enabled = params['enabled']
      if (typeof params['scheduleDay'] === 'string') input.scheduleDay = params['scheduleDay'] as WeekDay
      if (typeof params['scheduleLocalTime'] === 'string') input.scheduleLocalTime = params['scheduleLocalTime'] as string
      if (Array.isArray(params['sectors'])) input.sectors = params['sectors'] as HarvestSector[]

      const status = await updateWeeklyLeadHarvestAutomation(input, undefined, 'telegram')
      const h = status.weeklyLeadHarvest
      return [
        `✅ Harvest automation aggiornata`,
        `Stato: ${h.enabled ? 'Attiva' : 'Disattivata'} — ${h.scheduleDay} alle ${h.scheduleLocalTime}`,
        `Settori: ${h.sectors.length > 0 ? h.sectors.map((s) => `${s.query} @ ${s.location}`).join(', ') : 'nessuno'}`,
        h.nextPlannedRunLabel ? `Prossimo run: ${h.nextPlannedRunLabel}` : null,
      ].filter(Boolean).join('\n')
    }

    case 'harvest_automation_run': {
      const status = await getPersonalAutomationStatus()
      const h = status.weeklyLeadHarvest
      if (h.sectors.length === 0) {
        return '⚠️ Nessun settore configurato. Prima configura i settori con "imposta harvest settimanale: ristoranti a Milano, dentisti a Roma".'
      }
      if (h.status === 'running') {
        return '⏳ Harvest già in corso, attendi che finisca.'
      }
      void runWeeklyLeadHarvestNow('manual').catch((err: unknown) => {
        log.error({ err }, 'CEO Intake: harvest_automation_run failed')
      })
      return `🔍 Harvest manuale avviata per ${h.sectors.length} settore${h.sectors.length !== 1 ? 'i' : ''}: ${h.sectors.map((s) => `${s.query} @ ${s.location}`).join(', ')}. Riceverai una notifica Telegram al termine.`
    }

    case 'content_generate': {
      const contentType = getString(params, 'type') ?? 'blog'
      const topic = getString(params, 'topic')
      if (!topic) return '⚠️ content_generate: topic mancante.'

      const tone = getString(params, 'tone') ?? 'professional'
      const clientSlug = getString(params, 'client_slug')
      const projectSlug = getString(params, 'project_slug')

      // Resolve project_id (best-effort, non-fatal)
      let projectId: string | undefined
      if (clientSlug && projectSlug) {
        try {
          const client = await getClientBySlug(clientSlug)
          if (client) {
            const project = await getProjectBySlug(client.id, projectSlug)
            if (project) projectId = project.id
          }
        } catch {
          // non-fatal
        }
      }

      const task = await createTask({
        title: `Genera ${contentType}: ${topic}`,
        description: `Genera un contenuto di tipo "${contentType}" sul topic "${topic}". Tone: ${tone}.${clientSlug ? ` Cliente: ${clientSlug}.` : ''}${projectSlug ? ` Progetto: ${projectSlug}.` : ''}`,
        type: 'content',
        priority: 2,
        ...(projectId ? { project_id: projectId } : {}),
        delegator_agent_id: 'ceo_intake',
        assignee_agent_id: 'content_writer',
        requires_human_review: false,
        metadata: {
          content_type: contentType,
          topic,
          tone,
          ...(clientSlug ? { client_slug: clientSlug } : {}),
          ...(projectSlug ? { project_slug: projectSlug } : {}),
          ...(projectId ? { project_id: projectId } : {}),
        },
      })

      // Fire content_writer asynchronously (dynamic import avoids circular dep at load time)
      void (async () => {
        try {
          const { runContentWriterAgent } = await import('./content_writer.js')
          await runContentWriterAgent(task, notify)
        } catch (err) {
          log.error({ err, taskId: task.id }, 'CEO Intake: content_generate background error')
        }
      })()

      return [
        `✍️ *Content Writer avviato*`,
        ``,
        `📂 Tipo: ${contentType}`,
        `📝 Topic: ${topic}`,
        `🎨 Tone: ${tone}`,
        `🆔 Task: \`${task.id.slice(0, 8)}\``,
        ``,
        `L'anteprima arriverà su Telegram con il bottone di approvazione.`,
      ].join('\n')
    }

    // reply is not a real command — the LLM sometimes wraps informational
    // responses as { type: "reply", message: "..." } instead of leaving commands empty.
    case 'reply': {
      const msg = getString(params, 'message') || getString(params, 'content') || getString(params, 'text')
      return msg || ''
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
        const cleanMsg = sanitizeErrorForTelegram(msg)
        summaries.push(`❌ Errore in \`${command.type}\`: ${cleanMsg}${msg.length > 500 ? '...' : ''}`)
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
          const cleanMsg = sanitizeErrorForTelegram(msg)
        summaries.push(`❌ Errore in \`${command.type}\`: ${cleanMsg}${msg.length > 500 ? '...' : ''}`)
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

      // Non-blocking: extract any client/project facts from the founder's message.
      // Never blocks the Telegram reply — fails silently.
      void scheduleCeoFactExtraction(text).catch((err: unknown) => {
        logMemoryWarning(err, 'scheduleCeoFactExtraction')
      })
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
