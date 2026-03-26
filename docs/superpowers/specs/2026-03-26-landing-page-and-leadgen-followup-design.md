# Design Spec — WAI Landing Page + Lead Gen Follow-up Loop

**Date:** 2026-03-26
**Tasks:** T135 (Landing Page) + T136 (Lead Gen Follow-up)
**Status:** Approved — ready for implementation

---

## Context

WAI has a functioning lead generation engine (T133/T134): harvest → qualify → manual approval → outreach via Gmail. Two gaps block revenue conversion:

1. **No public presence** — outreach recipients land nowhere; no credibility signal
2. **Funnel drops after send** — no follow-up, no batch approval, no reply tracking

These two tasks are independent and built in parallel.

---

## T135 — WAI Landing Page

### Goal

A public-facing single-page site that:
- gives credibility to cold outreach recipients
- converts inbound interest into a qualified lead in the WAI pipeline
- is built by WAI itself (a live proof of capability)

### Stack

Vanilla HTML + CSS + minimal JS. No build step, no framework.
Served by Express via `express.static` at the root path `/`.
Lives in `landing/` at the repo root.

### Sections

| # | Section | Content |
|---|---------|---------|
| 1 | Hero | Headline: "WAI. Work runs autonomously." · Subline: "AI-powered delivery for software, marketing, and consulting — with zero agency overhead." · CTA button: "Get in touch" (scrolls to contact) |
| 2 | What We Do | 3 horizontal pills: "24/7 autonomous delivery" · "Founder-governed, not black-box" · "No account managers. No markup." |
| 3 | Services | 4 cards: Software Development · Digital Marketing · Business Consulting · AI Automation. Each card: icon + title + 1-line description |
| 4 | Case Study | Wawen22: "We built and delivered a landing page autonomously. Billed: $222. Time to delivery: same day." — the one real, honest proof point |
| 5 | Contact | Form: Name · Company · Email · "What do you need?" textarea · Submit button "Send" |

### Visual Direction

- Background: `#0a0a0a` (near-black)
- Typography: `Inter` from Google Fonts, white on dark
- Accent: `#c8ff00` (lime green) for CTA buttons and highlights
- Style: minimal, dense, no decorative gradients or illustrations — premium/technical feel
- Wordmark: "WAI" in mono font, subtitle "Wawen Autonomous Industries"
- Fully responsive (mobile-first)

### Contact Form Flow

1. User submits form → POST `/api/contact`
2. Backend validates (name, email required)
3. Lead saved to `leads` table: `source = 'inbound'`, `status = 'qualified'`, `score = 50` (inbound = already interested)
4. Telegram notification to Neb: "🔔 New inbound lead: {name} from {company} — {email}"
5. Auto-reply email via Gmail MCP: "Thanks {name}, we'll be in touch within 24h."
6. JSON response `{ ok: true }` → form shows "Sent. We'll be in touch."

### Express Wiring

```
// backend/src/index.ts
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const landingDir = path.resolve(__dirname, '../../../landing')
app.use(express.static(landingDir))
```

**Route priority:** static middleware registered after all `/api/*` routes so API calls are never intercepted.

### Files

```
landing/
  index.html      — full single-page site
  styles.css      — all styles
  main.js         — contact form fetch + success state
```

```
backend/src/index.ts   — add /api/contact route + static middleware
```

---

## T136 — Lead Gen Follow-up Loop

### Goal

Close the three gaps in the current funnel:

1. Automatic follow-up 5 days after initial outreach (no reply)
2. Batch approval (approve top N leads at once instead of one by one)
3. Reply tracking (mark leads as replied from Telegram or dashboard)

### Gap 1 — Automatic Follow-up

#### DB Migration

```sql
ALTER TABLE leads
  ADD COLUMN followed_up_at  timestamptz,
  ADD COLUMN follow_up_count integer NOT NULL DEFAULT 0;
```

New migration file: `supabase/migrations/20260327000000_leads_followup.sql`

#### Service — `backend/src/services/lead-followup.ts`

```typescript
getLeadsNeedingFollowUp(daysAfterSend?: number): Promise<Lead[]>
// Returns: status='sent', sent_at < now() - daysAfterSend, follow_up_count = 0

executeFollowUp(leadId: string): Promise<{ sent: boolean; draftOnly: boolean }>
// 1. Fetch lead, validate status='sent' + has email + follow_up_count=0
// 2. Build follow-up email body (short, references first email)
// 3. Send via Gmail MCP (same pattern as outreach-executor.ts)
// 4. Update: followed_up_at=now(), follow_up_count=1
// 5. Log CRM interaction: type='email_out', summary='Follow-up outreach'
// 6. Non-fatal: errors logged, not thrown

runFollowUpCycle(daysAfterSend?: number): Promise<{ processed: number; sent: number; failed: number }>
// Orchestrator: getLeadsNeedingFollowUp → executeFollowUp each → return summary
```

**Follow-up email template** (generated inline, not LLM — fast + cheap):
> Subject: Re: {original_subject}
> Body: "Hi {contact_name}, I wanted to follow up on my previous message about {company_name}. Happy to share more details or answer any questions. Is this something worth a quick chat?"

#### Scheduler

In `personal-automation.ts`, add a daily follow-up check alongside the daily brief:

```typescript
// Check at 10:00 local time (configurable via env FOLLOWUP_HOUR, default 10)
if (localHour === followupHour && localMinute === 0) {
  const result = await runFollowUpCycle()
  if (result.sent > 0) {
    await sendFounderNotification(
      `📬 Follow-up cycle: ${result.sent} sent, ${result.failed} failed, ${result.processed} checked`
    )
  }
}
```

**Max follow-ups:** 1 per lead (`follow_up_count = 0` guard). No second follow-up — avoids spam classification.

---

### Gap 2 — Batch Approval

#### CEO Intake Command

New command `leads_approve_top`:
- Params: `limit?` (integer, default 10)
- Logic: fetch `qualified` leads ordered by `score DESC`, limit N, update all to `status = 'approved'`
- Reply: "✅ Approved {n} leads: {list of company names}"

System prompt rule: "Use leads_approve_top when Neb wants to approve multiple leads at once (e.g. 'approva i top 10 lead', 'batch approve', 'approva tutti i qualificati')."

#### Dashboard

In `LeadsView`, add an "Approve Top 10" button in the toolbar (next to "Run Harvest"). On click: POST `/api/leads/approve-top?limit=10` → refresh list.

New API route: `POST /api/leads/approve-top` (query param `limit`, default 10).

---

### Gap 3 — Reply Tracking

#### CEO Intake Command

New command `leads_mark_replied`:
- Params: `company` (string)
- Logic: find lead by company_name (case-insensitive), set `replied_at = now()`, `status = 'replied'`, log CRM interaction `email_in`
- Reply: "✅ {company_name} marked as replied. Status → replied."

System prompt rule: "Use leads_mark_replied when Neb reports that a lead has replied (e.g. 'X ha risposto', 'mark replied X', 'risposta da X')."

#### Dashboard

On `sent` and `followed_up` leads in `LeadsView`: add a "✓ Replied" button → PATCH `/api/leads/:id` with `{ status: 'replied', replied_at: now() }`.

Display `follow_up_count` badge on sent leads: "↩ 1 follow-up sent" in small text under the status badge.

---

## Types

Add to `backend/src/types/index.ts` and `dashboard/src/types/index.ts`:

```typescript
// Extend Lead interface
interface Lead {
  // ... existing fields ...
  followed_up_at: string | null   // new
  follow_up_count: number          // new
}
```

`LeadSource` enum: add `'inbound'` (for contact form submissions).

---

## Success Criteria

### T135 Landing Page
- [ ] `GET /` serves `landing/index.html`
- [ ] Contact form POSTs to `/api/contact`, lead appears in `LeadsView` with `source='inbound'`
- [ ] Neb receives Telegram notification on form submit
- [ ] Page is mobile-responsive
- [ ] All 5 sections render correctly

### T136 Follow-up Loop
- [ ] Migration applies cleanly; `leads` table has `followed_up_at` + `follow_up_count`
- [ ] `runFollowUpCycle()` sends follow-up emails to eligible `sent` leads
- [ ] Follow-up runs daily at 10:00; Telegram digest sent when leads are processed
- [ ] `leads_approve_top` CEO command approves top N leads and replies with list
- [ ] "Approve Top 10" button in dashboard works
- [ ] `leads_mark_replied` CEO command marks a lead as replied
- [ ] "Mark Replied" button in dashboard sets `status = 'replied'`
- [ ] `follow_up_count` badge visible on sent leads in dashboard

---

## What This Does Not Include

- Gmail inbox polling for automatic reply detection (requires thread_id tracking — future T137)
- A/B testing outreach copy
- Multi-follow-up sequences (max 1 follow-up by design)
- Domain/DNS setup (future — when domain is acquired)
