# T136 — Lead Gen Follow-up Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three open gaps in the lead funnel: automatic 3-day follow-up for non-responding leads, batch approval of top N leads from Telegram or dashboard, and manual reply marking to track conversion.

**Architecture:** New `lead-followup.ts` service handles follow-up logic (find eligible sent leads, send email via Gmail MCP, update DB). The follow-up check is wired into the existing `runFounderAutomationCycle()` in `personal-automation.ts` (already called every minute). Two new CEO intake commands and two new API routes handle batch approval and reply marking. Dashboard `LeadsView` gets an "Approve Top 10" button, "Mark Replied" buttons, and a `follow_up_count` badge.

**Tech Stack:** TypeScript, Supabase, Gmail MCP via `callGoogleWorkspaceMcpTool`, existing `leads.ts` service, existing `personal-automation.ts` scheduler pattern.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/20260327000000_leads_followup.sql` | Add `followed_up_at`, `follow_up_count` columns |
| Create | `backend/src/services/lead-followup.ts` | Follow-up logic: find eligible leads, send email, update DB |
| Modify | `backend/src/services/personal-automation.ts` | Wire daily follow-up cycle into `runFounderAutomationCycle()` |
| Modify | `backend/src/agents/ceo_intake.ts` | Add `leads_approve_top` + `leads_mark_replied` commands |
| Modify | `backend/src/index.ts` | Add `POST /api/leads/approve-top` + `POST /api/leads/:id/replied` routes |
| Modify | `backend/src/types/index.ts` | Add `followed_up_at`, `follow_up_count` to `Lead` interface |
| Modify | `dashboard/src/types/index.ts` | Same type additions |
| Modify | `dashboard/src/components/LeadsView.tsx` | Approve Top 10 button, Mark Replied button, follow_up_count badge |

---

## Task 1 — DB Migration

**Files:**
- Create: `supabase/migrations/20260327000000_leads_followup.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- ============================================================
-- T136: Lead Gen Follow-up Loop — add follow-up tracking columns
-- ============================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS followed_up_at  timestamptz,
  ADD COLUMN IF NOT EXISTS follow_up_count integer NOT NULL DEFAULT 0;
```

- [ ] **Step 2: Apply migration in Supabase**

Open the Supabase SQL Editor and run the SQL above.
Expected: query returns `ALTER TABLE` with no errors.

Verify:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'leads' AND column_name IN ('followed_up_at', 'follow_up_count');
```
Expected: 2 rows returned.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260327000000_leads_followup.sql
git commit -m "feat(T136): add followed_up_at + follow_up_count to leads table"
```

---

## Task 2 — Extend Lead types

**Files:**
- Modify: `backend/src/types/index.ts`
- Modify: `dashboard/src/types/index.ts`

- [ ] **Step 1: Update Lead interface in backend types**

In `backend/src/types/index.ts`, find the `Lead` interface (search for `export interface Lead`). It currently ends with fields like `sent_at`, `replied_at`, `created_at`, `updated_at`. Add the two new fields before `created_at`:

```typescript
  followed_up_at: string | null
  follow_up_count: number
```

The full tail of the interface should look like:
```typescript
  sent_at: string | null
  replied_at: string | null
  followed_up_at: string | null
  follow_up_count: number
  created_at: string
  updated_at: string
```

- [ ] **Step 2: Update Lead interface in dashboard types**

Apply the same identical addition to `dashboard/src/types/index.ts`.

- [ ] **Step 3: Typecheck**

```bash
cd backend && pnpm typecheck
cd dashboard && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/types/index.ts dashboard/src/types/index.ts
git commit -m "feat(T136): add followed_up_at + follow_up_count to Lead type"
```

---

## Task 3 — Create lead-followup.ts service

**Files:**
- Create: `backend/src/services/lead-followup.ts`

- [ ] **Step 1: Create the service file**

```typescript
// ============================================================
// WAI – Lead Follow-up Service (T136)
// Finds sent leads with no response after N days and sends
// a single follow-up email via Gmail MCP.
// ============================================================

import { log } from './logger.js'
import { callGoogleWorkspaceMcpTool } from './google-workspace-mcp.js'
import { getLead, getLeads, updateLeadStatus } from './leads.js'
import { addInteraction } from './crm.js'
import { sendFounderNotification } from './notification-router.js'
import { getSupabaseClient } from './supabase.js'

const DEFAULT_FOLLOWUP_DAYS = parseInt(process.env['FOLLOWUP_DAYS'] ?? '3', 10)

// Returns leads that are: status='sent', sent >= N days ago, follow_up_count=0
export async function getLeadsNeedingFollowUp(daysAfterSend = DEFAULT_FOLLOWUP_DAYS): Promise<import('../types/index.js').Lead[]> {
  const cutoff = new Date(Date.now() - daysAfterSend * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await getSupabaseClient()
    .from('leads')
    .select('*')
    .eq('status', 'sent')
    .eq('follow_up_count', 0)
    .not('contact_email', 'is', null)
    .lte('sent_at', cutoff)
    .order('score', { ascending: false })

  if (error) {
    log.error({ err: error }, 'LeadFollowup: getLeadsNeedingFollowUp failed')
    throw new Error(error.message)
  }

  return (data ?? []) as import('../types/index.js').Lead[]
}

// Sends a single follow-up email to one lead and updates its follow_up_count.
export async function executeFollowUp(
  leadId: string,
): Promise<{ sent: boolean; draftOnly: boolean }> {
  const lead = await getLead(leadId)
  if (!lead) throw new Error(`Lead not found: ${leadId}`)
  if (lead.status !== 'sent') throw new Error(`Lead ${leadId} is not in 'sent' status`)
  if (lead.follow_up_count > 0) throw new Error(`Lead ${leadId} already followed up`)
  if (!lead.contact_email) throw new Error(`Lead ${leadId} has no contact_email`)

  const contactName = lead.contact_name ?? lead.company_name
  const originalSubject = lead.outreach_subject || `Working together — ${lead.company_name}`
  const followUpSubject = `Re: ${originalSubject}`
  const followUpBody =
    `Hi ${contactName},\n\n` +
    `I wanted to follow up on my previous message. ` +
    `Happy to share more details or answer any questions you might have.\n\n` +
    `Is this something worth a quick conversation?\n\n` +
    `Best,\nWAI Team`

  let sent = false
  let draftOnly = false

  try {
    await callGoogleWorkspaceMcpTool('gmail_send_email', {
      to: lead.contact_email,
      subject: followUpSubject,
      body: followUpBody,
    })
    sent = true
    log.info({ leadId, email: lead.contact_email }, 'LeadFollowup: follow-up email sent')
  } catch (sendErr) {
    log.warn({ sendErr }, 'LeadFollowup: gmail_send_email failed, falling back to draft')
    try {
      await callGoogleWorkspaceMcpTool('gmail_create_draft', {
        to: lead.contact_email,
        subject: followUpSubject,
        body: followUpBody,
      })
      draftOnly = true
      log.info({ leadId, email: lead.contact_email }, 'LeadFollowup: follow-up draft created')
    } catch (draftErr) {
      const msg = draftErr instanceof Error ? draftErr.message : String(draftErr)
      throw new Error(`Gmail not connected for follow-up. Details: ${msg}`)
    }
  }

  // Update lead: increment follow_up_count, set followed_up_at
  const now = new Date().toISOString()
  const { error: updateErr } = await getSupabaseClient()
    .from('leads')
    .update({ follow_up_count: 1, followed_up_at: now })
    .eq('id', leadId)

  if (updateErr) {
    log.error({ err: updateErr, leadId }, 'LeadFollowup: failed to update follow_up_count (non-fatal)')
  }

  // Log CRM interaction (non-fatal)
  if (lead.contact_id) {
    addInteraction(lead.contact_id, {
      type: 'email_out',
      summary: `Follow-up outreach: ${followUpSubject}`,
      source: 'gmail',
      occurred_at: now,
    }).catch((err: unknown) => {
      log.error({ err, leadId }, 'LeadFollowup: CRM interaction log failed (non-fatal)')
    })
  }

  return { sent, draftOnly }
}

// Orchestrator: find eligible leads and follow up each one.
export async function runFollowUpCycle(
  daysAfterSend = DEFAULT_FOLLOWUP_DAYS,
): Promise<{ processed: number; sent: number; draftOnly: number; failed: number }> {
  const leads = await getLeadsNeedingFollowUp(daysAfterSend)

  if (leads.length === 0) {
    return { processed: 0, sent: 0, draftOnly: 0, failed: 0 }
  }

  log.info({ count: leads.length, daysAfterSend }, 'LeadFollowup: starting follow-up cycle')

  let sent = 0
  let draftOnly = 0
  let failed = 0

  for (const lead of leads) {
    try {
      const result = await executeFollowUp(lead.id)
      if (result.sent) sent++
      else if (result.draftOnly) draftOnly++
    } catch (err) {
      log.error({ err, leadId: lead.id }, 'LeadFollowup: executeFollowUp failed (non-fatal)')
      failed++
    }
  }

  return { processed: leads.length, sent, draftOnly, failed }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd backend && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/lead-followup.ts
git commit -m "feat(T136): add lead-followup.ts service"
```

---

## Task 4 — Wire follow-up cycle into automation scheduler

**Files:**
- Modify: `backend/src/services/personal-automation.ts`

The existing `runFounderAutomationCycle()` (at the bottom of the file, around line 702) runs every minute and fires the daily brief + weekly harvest when scheduled. We add the daily follow-up check here.

- [ ] **Step 0: Add module-level variable**

Near the top of `backend/src/services/personal-automation.ts`, after the constant declarations (e.g. after `DEFAULT_AUTOMATION_INTERVAL_MS`), add:
```typescript
// Tracks the last date follow-up cycle ran (in-memory, resets on restart — intentional)
let lastFollowupRunDate: string | undefined = undefined
```

- [ ] **Step 1: Add follow-up check to runFounderAutomationCycle**

In `backend/src/services/personal-automation.ts`, find the function `runFounderAutomationCycle`. It currently looks like:

```typescript
export async function runFounderAutomationCycle(
  ownerSlug: string = DEFAULT_OWNER_SLUG,
): Promise<void> {
  const state = await ensurePersistedState(ownerSlug)
  const now = new Date()

  // Daily founder brief
  const brief = state.dailyFounderBrief
  // ... brief check ...

  // Weekly lead harvest
  const harvest = state.weeklyLeadHarvest
  // ... harvest check ...
}
```

Add the follow-up check at the **end of the function body**, after the weekly harvest block:

```typescript
  // Daily lead follow-up cycle (runs once per day at 10:00 local time)
  const followupHour = parseInt(process.env['FOLLOWUP_HOUR'] ?? '10', 10)
  const followupTimezone = state.dailyFounderBrief.timezone
  const followupDateParts = getDateTimeParts(now, followupTimezone)
  // lastFollowupRunDate is a module-level variable declared at the top of personal-automation.ts:
  // let lastFollowupRunDate: string | undefined = undefined

  if (
    followupDateParts.hour === followupHour &&
    followupDateParts.minute === 0 &&
    lastFollowupRunDate !== followupDateParts.dateKey
  ) {
    lastFollowupRunDate = followupDateParts.dateKey
    void (async () => {
      try {
        const { runFollowUpCycle } = await import('./lead-followup.js')
        const result = await runFollowUpCycle()
        if (result.sent > 0 || result.draftOnly > 0) {
          await sendFounderNotification(
            `📬 Follow-up cycle: ${result.sent} sent, ${result.draftOnly} draft, ${result.failed} failed (${result.processed} leads checked)`,
          ).catch(() => {})
        }
      } catch (err) {
        log.error({ err, ownerSlug }, 'runFounderAutomationCycle: follow-up cycle failed')
      }
    })()
  }
```

**Note on the daily-once guard:** `lastFollowupRunDate` is a module-level `let` variable. If the process restarts, the follow-up will re-check the same day, but this is safe — the `follow_up_count = 0` guard in `executeFollowUp` prevents double sends.

- [ ] **Step 2: Typecheck**

```bash
cd backend && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/personal-automation.ts
git commit -m "feat(T136): wire daily follow-up cycle into automation scheduler"
```

---

## Task 5 — CEO intake: two new commands

**Files:**
- Modify: `backend/src/agents/ceo_intake.ts`

There are two changes to make: (1) the system prompt command list + routing rules, and (2) the switch-case handler.

### Part A — System prompt additions

- [ ] **Step 1: Add commands to the system prompt command list**

In `backend/src/agents/ceo_intake.ts`, find the system prompt section that lists commands (search for `- leads_send_approved`). It looks like:

```
- leads_send_approved → no params  — invia l'outreach email a tutti i lead con status 'approved'
```

Add these two lines immediately after it:

```
- leads_approve_top → params: limit? (integer, default 10)  — approva i top N lead qualificati per score
- leads_mark_replied → params: company (string)  — segna un lead come replied (ha risposto all'email)
```

- [ ] **Step 2: Add routing rules**

Find the numbered routing rules near the end of the system prompt. They look like:
```
42. Use leads_send_approved when Neb wants to send outreach...
43. Use harvest_automation_status when...
```

After rule 42 (and before 43), add:

```
43. Use leads_approve_top when Neb wants to approve multiple leads at once (e.g. "approva i top 10 lead", "batch approve lead", "approva i migliori qualificati", "approva top 5").  Extract limit from the message if specified, default 10.
44. Use leads_mark_replied when Neb reports that a lead has replied (e.g. "X ha risposto", "mark replied X", "risposta da X", "ho ricevuto risposta da X"). Extract the company name from the message.
```

Then renumber the subsequent rules (the old 43 becomes 45, etc.).

### Part B — Switch-case handlers

- [ ] **Step 3: Add leads_approve_top case**

In `backend/src/agents/ceo_intake.ts`, find the `case 'leads_send_approved':` block. Add the following new case **immediately after** the `leads_send_approved` case closes (after its `return` statement and before the next `case`):

```typescript
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
      const { updateLeadStatus } = await import('../services/leads.js')
      for (const lead of toApprove) {
        await updateLeadStatus(lead.id, 'approved')
      }
      const names = toApprove.map((l) => `• ${l.company_name} (score: ${l.score})`).join('\n')
      return `✅ Approvati ${toApprove.length} lead:\n${names}`
    }
```

- [ ] **Step 4: Add leads_mark_replied case**

Immediately after the `leads_approve_top` case, add:

```typescript
    case 'leads_mark_replied': {
      const company = getString(params, 'company')
      if (!company) return '⚠️ Specifica il nome dell\'azienda. Es: "X ha risposto".'
      // Search among sent leads (follow-up leaves status as 'sent', only follow_up_count changes)
      const allSent = await crmGetLeads({ status: 'sent' })
      const match = allSent.find(
        (l) => l.company_name.toLowerCase().includes(company.toLowerCase()),
      )
      if (!match) return `⚠️ Nessun lead "sent" trovato per "${company}". Controlla il nome.`
      const { updateLeadStatus } = await import('../services/leads.js')
      await updateLeadStatus(match.id, 'replied', { replied_at: new Date().toISOString() })
      return `✅ ${match.company_name} segnato come replied. Status → replied.`
    }
```

**Note:** `crmGetLeads` already imports `getLeads` from `leads.ts` in this file — check the top of `ceo_intake.ts` to confirm the import name. If it's `getLeads` imported as `crmGetLeads`, use it directly. If it's imported differently, use whatever alias is established at the top.

- [ ] **Step 5: Typecheck**

```bash
cd backend && pnpm typecheck
```
Expected: no errors. Fix any import aliases if the `crmGetLeads` reference doesn't match.

- [ ] **Step 6: Commit**

```bash
git add backend/src/agents/ceo_intake.ts
git commit -m "feat(T136): add leads_approve_top + leads_mark_replied CEO commands"
```

---

## Task 6 — Backend: two new API routes

**Files:**
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Add POST /api/leads/approve-top route**

In `backend/src/index.ts`, find the leads routes section. Specifically, find:
```typescript
    // GET /api/leads/harvest-runs — harvest run history
```

Add the following block **immediately before** that comment:

```typescript
    // POST /api/leads/approve-top?limit=10 — batch approve top N qualified leads
    if (url.pathname === '/api/leads/approve-top' && req.method === 'POST') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Unauthorized' }))
            return
          }
          const limitParam = parseInt(url.searchParams.get('limit') ?? '10', 10)
          const limit = isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 50) : 10

          const { getLeads, updateLeadStatus } = await import('./services/leads.js')
          const qualified = await getLeads({ status: 'qualified' })
          const toApprove = qualified
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)

          for (const lead of toApprove) {
            await updateLeadStatus(lead.id, 'approved')
          }

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ approved: toApprove.length, leads: toApprove.map((l) => ({ id: l.id, company_name: l.company_name, score: l.score })) }))
        } catch (err) {
          log.error({ err }, 'Leads: POST /api/leads/approve-top error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      })()
      return
    }
```

- [ ] **Step 2: Add POST /api/leads/:id/replied route**

In the existing parameterized leads routes block (inside the `if (url.pathname.startsWith('/api/leads/'))` handler), find the `POST /api/leads/:id/send` case. Add the following immediately after it:

```typescript
      // POST /api/leads/:id/replied — mark lead as replied
      if (parts.length === 2 && parts[1] === 'replied' && req.method === 'POST') {
        void (async () => {
          try {
            if (!isAuthorizedDashboardRequest(req)) {
              res.writeHead(401, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Unauthorized' }))
              return
            }
            const { updateLeadStatus } = await import('./services/leads.js')
            const lead = await updateLeadStatus(leadId, 'replied', {
              replied_at: new Date().toISOString(),
            })
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(lead))
          } catch (err) {
            log.error({ err, leadId }, 'Leads: POST /api/leads/:id/replied error')
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }))
          }
        })()
        return
      }
```

- [ ] **Step 3: Typecheck**

```bash
cd backend && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat(T136): add /api/leads/approve-top + /api/leads/:id/replied routes"
```

---

## Task 7 — Dashboard: LeadsView additions

**Files:**
- Modify: `dashboard/src/components/LeadsView.tsx`

Three visual additions: (1) "Approve Top 10" toolbar button, (2) `follow_up_count` badge on sent leads, (3) "Mark Replied" button on sent/followed_up leads.

- [ ] **Step 1: Add apiPost helper for approve-top (if not already present)**

`LeadsView.tsx` already has `apiPost`. Confirm it's there by searching for `apiPost` in the file. It should be defined around line 62-70. If it's there, skip this step.

- [ ] **Step 2: Add "Approve Top 10" button in the toolbar**

In `LeadsView.tsx`, find the section where the "Run Harvest" button or the harvest modal trigger button is rendered (search for `Run Harvest` or `harvest`). Add an "Approve Top 10" button next to it:

```tsx
<button
  onClick={() => {
    apiPost<{ approved: number }>('/api/leads/approve-top?limit=10')
      .then((r) => {
        if (r.approved > 0) loadLeads()
      })
      .catch(() => {})
  }}
  className="px-3 py-1.5 text-xs font-medium rounded bg-violet-500/15 text-violet-400 ring-1 ring-violet-500/30 hover:bg-violet-500/25 transition-colors"
>
  Approve Top 10
</button>
```

- [ ] **Step 3: Add follow_up_count badge in lead list item**

In `LeadsView.tsx`, find where the status badge for each lead is rendered in the list panel (search for `STATUS_BADGE` usage). After the status badge `<span>`, add:

```tsx
{lead.follow_up_count > 0 && (
  <span className="text-xs text-slate-500">↩ {lead.follow_up_count} follow-up</span>
)}
```

- [ ] **Step 4: Add "Mark Replied" button in lead detail panel**

In `LeadsView.tsx`, find the detail panel where the "Approve" / "Reject" / "Send" action buttons are rendered for the selected lead. Add a "Mark Replied" button that shows only when `selectedLead.status === 'sent'`:

```tsx
{selectedLead.status === 'sent' && (
  <button
    onClick={() => {
      apiPost<Lead>(`/api/leads/${selectedLead.id}/replied`)
        .then((updated) => {
          setLeads((prev) => prev.map((l) => l.id === updated.id ? updated : l))
          setSelectedLead(updated)
        })
        .catch(() => {})
    }}
    className="px-3 py-1.5 text-xs font-medium rounded bg-teal-500/15 text-teal-400 ring-1 ring-teal-500/30 hover:bg-teal-500/25 transition-colors"
  >
    ✓ Mark Replied
  </button>
)}
```

- [ ] **Step 5: Typecheck**

```bash
cd dashboard && pnpm typecheck
```
Expected: no errors. If `Lead` type is not imported where the Mark Replied button is added, check the existing imports at the top of `LeadsView.tsx` — `Lead` is already imported there.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/components/LeadsView.tsx
git commit -m "feat(T136): add Approve Top 10, Mark Replied, follow_up_count badge to LeadsView"
```

---

## Task 8 — Manual verification

- [ ] **Step 1: Start backend and dashboard**

```bash
cd backend && pnpm dev   # terminal 1
cd dashboard && pnpm dev  # terminal 2
```

- [ ] **Step 2: Test batch approval via dashboard**

Open dashboard → Company mode → Leads tab.
Click "Approve Top 10" → confirm some qualified leads move to `approved` status.

- [ ] **Step 3: Test batch approval via Telegram**

Send to Telegram bot: `"approva i top 5 lead"`
Expected: reply lists approved leads with their scores.

- [ ] **Step 4: Test Mark Replied via dashboard**

Find a lead with status `sent` → click "✓ Mark Replied".
Expected: status updates to `replied` immediately.

- [ ] **Step 5: Test leads_mark_replied via Telegram**

Send: `"[CompanyName] ha risposto"`
Expected: bot replies "✅ [CompanyName] segnato come replied."

- [ ] **Step 6: Verify follow-up service logic (dry run)**

```bash
node --input-type=module << 'EOF'
import { getLeadsNeedingFollowUp } from './backend/dist/services/lead-followup.js'
const leads = await getLeadsNeedingFollowUp(3)
console.log(`Leads needing follow-up: ${leads.length}`)
EOF
```

Expected: number (likely 0 if no leads have been sent 3+ days ago — that's correct).

- [ ] **Step 7: Check follow-up badge in dashboard**

Send a test outreach to a lead, wait (or manually update `sent_at` in Supabase to 3 days ago), then check that `↩ 1 follow-up` badge appears after the automation runs.

- [ ] **Step 8: Final commit**

```bash
git add .
git commit -m "feat(T136): lead gen follow-up loop complete — auto follow-up + batch approval + reply tracking"
```

---

## How to Test End-to-End

1. Backend + dashboard running
2. Leads dashboard: "Approve Top 10" button approves qualified leads
3. Telegram: `"approva i top 10 lead"` → batch approval with names listed
4. Telegram: `"Acme ha risposto"` → lead marked replied
5. Dashboard: `✓ Mark Replied` button on `sent` leads
6. After 3 days without reply, `runFollowUpCycle()` fires, follow-up email sent, `follow_up_count=1`
7. Telegram notification: `"📬 Follow-up cycle: N sent..."` when cycle processes leads
