# T133: Lead Generation Engine — Design Spec

**Date:** 2026-03-25
**Status:** Draft
**Scope:** Autonomous outbound lead harvesting with supervised approval (Proposal Inbox)
**Milestone:** Fase 3+ — Growth & Autonomy

---

## Problem

WAI can deliver work and track revenue, but every new client comes from Neb manually. There is no autonomous acquisition loop. To scale revenue, WAI must find potential clients, qualify them, prepare personalized outreach, and execute it — while Neb retains governance control via a single approval step.

## Goal

Build a **supervised-autonomy lead generation engine** that:

1. Discovers potential clients via Website Audit Prospector (Google PageSpeed + scraper) and Google Maps Business Finder
2. Qualifies each lead with LLM scoring (0–100) based on findings severity and contact availability
3. Generates a personalized outreach email referencing specific, real audit findings per lead
4. Surfaces all qualified leads in a **Proposal Inbox** (new `LeadsView` dashboard) for Neb's one-click approval
5. Executes outreach via Gmail MCP after approval — no further action required from Neb
6. Logs every sent outreach into the CRM (`contacts` + `contact_interactions` from T124)

## What Is NOT in Scope (V2 / Later)

- Freelance platform monitoring (Upwork, Freelancer.com) — T134
- Multi-step follow-up email sequencing — T135
- LinkedIn prospecting (ToS risk, separate tooling needed)
- Job board monitoring (Indeed, LinkedIn Jobs) — T136
- Cold calling or phone outreach
- Payment automation — separate T132
- Inbound lead handling (already partially covered by Gmail MCP + CEO Intake)

---

## Architecture

```
Trigger: Cron daily | CEO NL 'leads_harvest' | Dashboard "Run Harvest"
                ↓
        Lead Harvester (lead-harvester.ts)
        ├─ Google Maps Prospector ─── find businesses by sector + location
        └─ Website Auditor ────────── PageSpeed API + scraper per business
                ↓
        Lead Qualifier (lead-qualifier.ts)
        ├─ Score 0-100 (LLM)
        ├─ Generate subject + email body
        └─ Dedup against existing leads + contacts
                ↓
        leads table (Supabase) ← harvest_runs table (logging)
                ↓
        LeadsView (Dashboard) — Proposal Inbox
        ├─ Cards: company, score badge, findings, draft email
        ├─ Inline edit of outreach draft
        ├─ Approve / Reject / Send buttons
        └─ Bulk approve
                ↓ (on Send)
        Outreach Executor (outreach-executor.ts)
        ├─ Send email via callGoogleWorkspaceMcpTool (Gmail)
        ├─ Update lead status → 'sent'
        └─ Upsert CRM contact + log 'email_out' interaction (T124)
```

---

## Data Model

### Table: `leads`

```sql
CREATE TABLE leads (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source            text        NOT NULL DEFAULT 'website_audit'
                                CHECK (source IN ('website_audit', 'google_maps', 'manual', 'freelance')),
  status            text        NOT NULL DEFAULT 'qualified'
                                CHECK (status IN ('new', 'qualified', 'approved', 'sent', 'replied', 'won', 'lost', 'rejected')),
  company_name      text        NOT NULL,
  contact_name      text,
  contact_email     text,
  website           text,
  phone             text,
  location          text,
  sector            text,
  score             integer     NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  findings          jsonb       NOT NULL DEFAULT '[]',
  outreach_subject  text        NOT NULL DEFAULT '',
  outreach_draft    text        NOT NULL DEFAULT '',
  source_url        text,
  contact_id        uuid        REFERENCES contacts(id) ON DELETE SET NULL,
  notes             text        NOT NULL DEFAULT '',
  sent_at           timestamptz,
  replied_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_score ON leads(score DESC);
CREATE INDEX idx_leads_created_at ON leads(created_at DESC);
```

`findings` JSONB schema: `Array<{ type: 'performance'|'security'|'seo'|'ux'|'missing_website'|'other', severity: 'low'|'medium'|'high', description: string }>`

### Table: `harvest_runs`

```sql
CREATE TABLE harvest_runs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  harvester     text        NOT NULL,
  query         text,
  location      text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  leads_found   integer     NOT NULL DEFAULT 0,
  status        text        NOT NULL DEFAULT 'running'
                            CHECK (status IN ('running', 'done', 'failed')),
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

Both tables get `set_updated_at()` trigger on `leads` only (harvest_runs is append-only).
Full RLS policies: anon/authenticated SELECT, service_role ALL.

---

## TypeScript Types (both `backend/src/types/index.ts` and `dashboard/src/types/index.ts`)

```typescript
export type LeadStatus = 'new' | 'qualified' | 'approved' | 'sent' | 'replied' | 'won' | 'lost' | 'rejected'
export type LeadSource = 'website_audit' | 'google_maps' | 'manual' | 'freelance'

export interface LeadFinding {
  type: 'performance' | 'security' | 'seo' | 'ux' | 'missing_website' | 'other'
  severity: 'low' | 'medium' | 'high'
  description: string
}

export interface Lead {
  id: string
  source: LeadSource
  status: LeadStatus
  company_name: string
  contact_name: string | null
  contact_email: string | null
  website: string | null
  phone: string | null
  location: string | null
  sector: string | null
  score: number
  findings: LeadFinding[]
  outreach_subject: string
  outreach_draft: string
  source_url: string | null
  contact_id: string | null
  notes: string
  sent_at: string | null
  replied_at: string | null
  created_at: string
  updated_at: string
}

export interface HarvestRun {
  id: string
  harvester: string
  query: string | null
  location: string | null
  started_at: string
  completed_at: string | null
  leads_found: number
  status: 'running' | 'done' | 'failed'
  error: string | null
  created_at: string
}
```

---

## Backend Services

### `backend/src/services/leads.ts`
CRUD service — same pattern as `crm.ts`. Named exports:

- `getLeads(filter?: { status?: LeadStatus; source?: LeadSource; minScore?: number; limit?: number })` → `Lead[]`
- `getLead(id: string)` → `Lead | null`
- `saveLead(input: SaveLeadInput)` → `Lead` (upsert on `id`)
- `updateLeadStatus(id: string, status: LeadStatus, extra?: { sent_at?: string; replied_at?: string })` → `Lead`
- `deleteLead(id: string)` → `void`
- `getHarvestRuns(limit?: number)` → `HarvestRun[]`
- `startHarvestRun(harvester: string, query: string | null, location: string | null)` → `HarvestRun`
- `completeHarvestRun(id: string, leadsFound: number)` → `void`
- `failHarvestRun(id: string, error: string)` → `void`

`SaveLeadInput` interface: all Lead fields except id (optional), created_at, updated_at.
Uses `exactOptionalPropertyTypes`-safe imperative row building (same pattern as PUT route in crm routes).

---

### `backend/src/services/website-auditor.ts`

```typescript
export interface WebsiteAuditResult {
  url: string
  isReachable: boolean
  isHttps: boolean
  mobileScore: number    // 0–100 from PageSpeed API, -1 if unavailable
  desktopScore: number
  findings: LeadFinding[]
  contactInfo: { email: string | null; phone: string | null }
  pageTitle: string | null
  metaDescription: string | null
}

export async function auditWebsite(url: string): Promise<WebsiteAuditResult>
```

Implementation steps:
1. **HTTP basics**: `fetch(url, { signal: AbortSignal.timeout(8000) })` — check reachability + final URL (detect redirect to placeholder pages)
2. **HTTPS check**: `url.startsWith('https://')`
3. **Google PageSpeed API** (free, no key):
   `GET https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=URL&strategy=mobile&fields=lighthouseResult.categories.performance`
   Extract `lighthouseResult.categories.performance.score * 100`. Timeout: 15s. Non-fatal if fails.
4. **Scrape for contact info**: Use existing `scrapeUrl(url)` from `backend/src/services/scraper.ts`. Extract email regex + phone regex from the scraped markdown.
5. **Build findings** (thresholds):
   - `mobileScore < 50` → `{ type: 'performance', severity: 'high', description: 'Mobile performance score ${score}/100 — visitors likely abandoning the site on Google Search' }`
   - `mobileScore 50–74` → `{ severity: 'medium', ... }`
   - `!isHttps` → `{ type: 'security', severity: 'high', description: 'Site not HTTPS — Google penalizes non-secure sites in rankings' }`
   - `!metaDescription` → `{ type: 'seo', severity: 'medium', description: 'Missing meta description — reduced click-through rates on Google results' }`
   - `!contactInfo.email && !contactInfo.phone` → `{ type: 'ux', severity: 'low', description: 'No visible contact info — visitors cannot easily reach the business' }`

---

### `backend/src/services/lead-harvester.ts`

```typescript
export interface HarvestConfig {
  query: string      // e.g. 'ristoranti', 'dentisti', 'parrucchieri'
  location: string   // e.g. 'Milano', 'Roma, Italy'
  limit?: number     // default: 10, max: 20
  sector?: string    // for tagging, defaults to query
}

export async function harvestLeads(config: HarvestConfig): Promise<Lead[]>
```

Flow:
1. `startHarvestRun('website_audit', config.query, config.location)` → log run
2. **Discover businesses**:
   - Primary: If `GOOGLE_PLACES_API_KEY` env var is set → call Google Places API (Text Search) for `"${query} ${location}"`, get name, website, phone, address, place_id
   - Fallback: Construct Google search URL `https://www.google.com/search?q=${query}+${location}+sito+web` → scrape with existing `scrapeUrl()` → extract business names and URLs from results
   - Collect up to `config.limit` candidates
3. **Audit each website** (cap at 3 concurrent with `Promise.all` + chunking, 500ms between chunks to respect PageSpeed rate limits):
   - If business has no website → immediate findings: `[{ type: 'missing_website', severity: 'high', description: 'No website found — completely invisible online' }]`, score: 85
   - If has website → call `auditWebsite(website)`
4. **Qualify each lead** via `qualifyLead()`
5. **Dedup**: skip if `leads` table already has same `website` domain OR same `company_name` + `location` combo
6. **Save qualified leads** to DB (status: `'qualified'`)
7. `completeHarvestRun(runId, savedCount)` — even if some audits failed
8. Return saved `Lead[]`

---

### `backend/src/services/lead-qualifier.ts`

```typescript
export async function qualifyLead(
  companyName: string,
  website: string | null,
  sector: string,
  location: string,
  findings: LeadFinding[],
  contactEmail: string | null,
): Promise<{ score: number; outreach_subject: string; outreach_draft: string }>
```

Uses `runAgent()` with `agentId: 'system_learning'`, `modelOverride: 'nemotron-120b'`, `captureMemory: false`.

System prompt excerpt:
```
You are WAI's lead qualification and outreach specialist.
WAI is an autonomous AI agency that builds websites, web apps, automations, and marketing systems for SMBs.

Given audit findings about a potential client, return JSON:
{ "score": <0-100>, "subject": "<email subject>", "email": "<email body under 130 words>" }

Score factors:
- 0-30: minor issues, contact info missing
- 31-60: moderate issues, some contact info
- 61-80: serious issues (slow site / no HTTPS), has contact email
- 81-100: no website at all OR multiple critical issues + has email

Email rules:
- Open with ONE specific finding (proof we analyzed their actual site)
- Offer a concrete result ("we can bring your mobile score above 90 in 2 weeks")
- CTA: a 15-minute call or "interested? reply to this email"
- Under 130 words
- Sound human, helpful, not salesy
- Do NOT mention AI, "autonomous", or "WAI"
- Write in Italian if business appears Italian, English otherwise
```

Parse JSON from response with regex fallback. If LLM returns garbage → score: 50, draft: `''`.

---

### `backend/src/services/outreach-executor.ts`

```typescript
export async function executeOutreach(leadId: string): Promise<{ sent: boolean; draftOnly: boolean }>
```

Flow:
1. Fetch lead, verify `status === 'approved'` and `contact_email` is set — throw if not
2. Attempt send via `callGoogleWorkspaceMcpTool`:
   - Try `gmail_send_email` (if MCP exposes it) → `{ sent: true, draftOnly: false }`
   - Fallback: `gmail_create_draft` → `{ sent: false, draftOnly: true }`
3. If `draftOnly: true` → send Telegram notification: `"✉️ Email draft created for ${companyName} — check Gmail Drafts to send"`
4. `updateLeadStatus(leadId, 'sent', { sent_at: new Date().toISOString() })`
5. **CRM integration**: if `lead.contact_id` is null:
   - `upsertContact({ name: contact_name || company_name, email: contact_email, company: company_name, status: 'active' })` from `crm.ts`
   - `addInteraction(contact.id, { type: 'email_out', summary: 'Cold outreach: ${outreach_subject}', source: 'gmail' })` from `crm.ts`
   - Link contact: use `saveLead({ id: leadId, title: lead.company_name, contact_id: contact.id })` (not `updateLeadStatus` — that only accepts `sent_at`/`replied_at`)

---

## API Routes (8 new routes in `backend/src/index.ts`)

Place before the `// ── GET /api/personal/knowledge` comment, after the meeting-notes routes.

```
GET  /api/leads                             list leads (qs: status, source, minScore, limit)
POST /api/leads/harvest                     trigger harvest (auth required)
GET  /api/leads/harvest-runs                harvest run history
GET  /api/leads/:id                         single lead
PUT  /api/leads/:id                         update (edit draft, notes, contact_email)
POST /api/leads/:id/approve                 status → 'approved' (auth)
POST /api/leads/:id/reject                  status → 'rejected' (auth)
POST /api/leads/:id/send                    execute outreach (requires approved + auth)
```

Route matching pattern — same as CRM routes:
- Exact pathname routes first (`/api/leads`, `/api/leads/harvest`, `/api/leads/harvest-runs`)
- Then parameterized: `url.pathname.startsWith('/api/leads/')` → extract `leadId = url.pathname.slice('/api/leads/'.length)`
- Then sub-action: `leadId.endsWith('/approve')` → `actualId = leadId.slice(0, -8)`

POST `/api/leads/harvest` body: `{ query: string, location: string, limit?: number }`. Non-blocking: starts harvest, responds immediately with `{ ok: true, runId: string }`. The harvest runs in background via detached `void (async () => { ... })()` pattern.

PUT `/api/leads/:id` uses imperative input building (exactOptionalPropertyTypes safe — same pattern as CRM PUT route).

---

## CEO Intake Integration (`backend/src/agents/ceo_intake.ts`)

### Import
```typescript
import {
  getLeads as crmGetLeads,
  saveLead,
  updateLeadStatus as updateLead,
} from '../services/leads.js'
import { harvestLeads } from '../services/lead-harvester.js'
import { executeOutreach } from '../services/outreach-executor.js'
```

### 3 New ACTIONS (append after `crm_follow_up_due` line)
```
- leads_harvest     → params: query (es. "ristoranti"), location (es. "Milano"), limit? (default 10)  — avvia una harvest di lead
- leads_show        → no params  — mostra il riepilogo del proposal inbox (count per status, top 5 scored)
- leads_send_approved → no params  — invia l'outreach email a tutti i lead con status 'approved'
```

### 3 New Planning Rules (append after rule 39)
```
40. Use leads_harvest when Neb wants to find potential clients or do prospecting (e.g. "trova lead a Milano", "cerca aziende senza sito a Roma", "prospecting ristoranti Torino", "trova clienti nel settore X").
41. Use leads_show when Neb asks about the lead pipeline or proposal inbox (e.g. "mostra i lead", "quanti lead ho?", "cosa c'è nell'inbox dei lead?").
42. Use leads_send_approved when Neb wants to send outreach to already-approved leads (e.g. "manda le email ai lead approvati", "invia l'outreach", "procedi con i lead approvati").
```

### Executor Cases (before `case 'reply':`)

**`case 'leads_harvest'`**:
- Extract `query` (required), `location` (default: 'Italy'), `limit` (default: 10, max: 20)
- Call `harvestLeads({ query, location, limit, sector: query })` in background (non-blocking)
- Return: `"🔍 Harvest avviata: cerco ${limit} ${query} a ${location}. I lead appariranno nel dashboard Leads entro 2-3 minuti."`

**`case 'leads_show'`**:
- Call `crmGetLeads()` (all statuses), group by status
- Return formatted summary: count per status + top 5 by score with company + score + 1-line finding

**`case 'leads_send_approved'`**:
- Get all leads with `status === 'approved'` that have `contact_email`
- For each: call `executeOutreach(lead.id)` sequentially (avoid Gmail rate limit)
- Return: `"✅ Outreach inviato a N contatti: [company1, company2, ...]"`

---

## Dashboard: `LeadsView`

**New Company mode view** — file: `dashboard/src/components/LeadsView.tsx`

### Sidebar Update
- Add `'leads'` to `CompanyViewId` in `Sidebar.tsx`
- Add to `COMPANY_NAV_SECTIONS` under `CLIENTS & WORK` section: `{ id: 'leads', label: 'Leads', icon: 'leads' }`
- Add `leads` to `VIEW_META` in `App.tsx`: `{ title: 'Leads', description: 'Proposal inbox — qualified leads, audit findings, outreach' }`
- Add `case 'leads': return <LeadsView />` to `ViewContent` switch
- Import `LeadsView` in `App.tsx`

### Icon
Add `'leads'` to `IconName` in `Icon.tsx` and implement SVG — a funnel/filter icon:
```svg
<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
```

### Layout (split-panel, same pattern as `PersonalCRMView`)

**Left panel (w-80):**
- Stats row: `{qualified} new | {approved} approved | {sent} sent`
- Status filter pills: All | Qualified | Approved | Sent | Won
- Lead cards: score badge (color-coded: 80+ green, 60-79 yellow, <60 grey) + company_name + sector + location + finding count chip
- Button: `"+ Run Harvest"` → opens harvest modal (overlay, same pattern as add-contact in CRM)

**Right panel (flex-1, detail view):**
- Header: company_name (large), score badge, status badge, website link (if set)
- Findings list: each finding as a row with severity color dot + description
- Editable outreach: subject `<input>` + draft `<textarea>` (blur → PUT /api/leads/:id)
- Action buttons:
  - `✓ Approve` (when status qualified) → POST .../approve, optimistic update
  - `✗ Reject` → POST .../reject, remove from list
  - `▶ Send Outreach` (when status approved + contact_email set) → POST .../send, shows "Sent ✓"
  - If no contact_email: input field to add email inline (saves via PUT before send is enabled)
- Notes textarea (blur to save)
- If sent: "Sent {date} → View in CRM" link that navigates to crm view (out of scope for V1 — just show timestamp)

**Harvest Modal (fixed overlay):**
- Query input: "ristoranti" placeholder
- Location input: "Milano, Italy" placeholder
- Limit select: 5 | 10 | 20 (default 10)
- "Start Harvest" button → POST /api/leads/harvest → shows spinner with "Harvesting leads..." → closes modal, list refreshes every 5s while a run is active

**Polling behavior:** The frontend determines if a harvest is active by calling `GET /api/leads/harvest-runs` (returns last 10 runs). If `runs[0]?.status === 'running'`, the harvest is active and polling continues every 5s. When it transitions to `'done'` or `'failed'`, polling stops and the leads list does a final refresh. No additional backend endpoint is needed.

---

## Environment Variables

```env
GOOGLE_PLACES_API_KEY=   # Optional — improves business discovery quality
                         # Without it: uses Google Search scraping (slower, less structured)
                         # Get it: console.cloud.google.com → Places API → enable → API key
```

No other new required env vars. Gmail MCP must be connected (existing requirement from T115).

---

## Key Constraints & Error Handling

| Scenario | Handling |
|---|---|
| PageSpeed API rate limit (5 req/s) | 500ms delay between requests in chunked parallel processing |
| Website unreachable / timeout | findings: `[{ type: 'other', severity: 'high', desc: 'Website not reachable' }]`, score: 40 |
| LLM qualifier returns invalid JSON | score: 50, outreach_draft: '' (lead saved, Neb edits manually) |
| Gmail MCP not connected | `executeOutreach` throws: "Gmail not connected — start Google auth in Assistant HQ" |
| Duplicate lead (same domain) | Skip silently, not counted in leads_found |
| No contact email found | Lead saved with `contact_email: null`, score -10 penalty; Neb can add manually in dashboard |
| harvest runs > 3 min | Harvest is async background task — dashboard polls status every 5s |

---

## File Change List

| File | Action |
|---|---|
| `supabase/migrations/20260326030000_leads.sql` | CREATE — leads + harvest_runs tables |
| `backend/src/types/index.ts` | MODIFY — append Lead, HarvestRun, LeadFinding, LeadStatus, LeadSource |
| `dashboard/src/types/index.ts` | MODIFY — same types |
| `backend/src/services/leads.ts` | CREATE — CRUD service |
| `backend/src/services/website-auditor.ts` | CREATE — PageSpeed + scraper audit |
| `backend/src/services/lead-harvester.ts` | CREATE — orchestrator (Google Maps/Search + audit pipeline) |
| `backend/src/services/lead-qualifier.ts` | CREATE — LLM scoring + outreach draft |
| `backend/src/services/outreach-executor.ts` | CREATE — Gmail MCP send + CRM logging |
| `backend/src/index.ts` | MODIFY — import 5 new services, add 8 routes |
| `backend/src/agents/ceo_intake.ts` | MODIFY — import 3 services, add 3 actions, 3 rules, 3 executor cases |
| `dashboard/src/components/LeadsView.tsx` | CREATE — full split-panel Proposal Inbox |
| `dashboard/src/components/ui/Icon.tsx` | MODIFY — add 'leads' icon |
| `dashboard/src/components/Sidebar.tsx` | MODIFY — add 'leads' to CompanyViewId + COMPANY_NAV_SECTIONS |
| `dashboard/src/App.tsx` | MODIFY — import LeadsView, add VIEW_META, add case in ViewContent |

---

## Success Criteria

1. `POST /api/leads/harvest` with `{ query: "ristoranti", location: "Milano", limit: 5 }` → returns within 200ms, harvests 5 leads in background within 3 minutes
2. Each harvested lead has: score > 0, at least 1 finding, outreach_draft populated
3. `GET /api/leads?status=qualified` returns the harvested leads
4. Dashboard LeadsView shows leads list + detail with editable draft
5. Clicking "Approve" → status becomes 'approved'
6. Clicking "Send Outreach" on an approved lead with email → creates Gmail draft or sends → status becomes 'sent' → contact appears in CRM
7. CEO NL: `"trova 5 dentisti a Roma"` → triggers harvest, responds with confirmation message
8. Both `pnpm typecheck` (backend + dashboard) pass clean
