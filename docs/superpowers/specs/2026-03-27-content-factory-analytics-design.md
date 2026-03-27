# WAI — T142 Content Factory + T143 Analytics Dashboard
**Date:** 2026-03-27
**Status:** Approved by founder

---

## T142 — Content Factory

### Purpose
WAI generates content (blog, social, newsletter) autonomously on founder command. The founder approves or rejects via Telegram inline keyboard before the file is considered delivered.

### Scope
- New agent: `content_writer`
- New CEO NL command: `content_generate`
- Telegram inline keyboard approval gate
- No publish automation — output is a `.md` file in the client workspace

### Agent: `content_writer`

**File:** `backend/src/agents/content_writer.ts`

**Input** (via `task.metadata`):
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `content_type` | `'blog' \| 'social' \| 'newsletter'` | yes | Drives prompt template |
| `topic` | string | yes | Free text |
| `tone` | string | no | Default: `professional` |
| `client_slug` | string | no | For workspace path |
| `project_slug` | string | no | For workspace path |

**Execution flow:**
1. **Research** — 2 Serper web searches on the topic. Aggregate title + snippet from top 5 organic results as context. Non-fatal if `SERPER_API_KEY` missing (proceeds without context).
2. **Draft** — Single LLM call with type-specific prompt:
   - `blog`: 800–1200 words, markdown H2/H3 structure, SEO-aware, concludes with CTA
   - `social`: 3–5 post variants (LinkedIn-first tone), each ≤ 280 chars, with hashtag suggestions
   - `newsletter`: Intro paragraph + 3 content sections + CTA closer, conversational tone
3. **Save** — Write to `workspace/<client_slug>/<project_slug>/deliverables/content-<slug>-<date>.md`. If no client/project slug, save to `workspace/personal/neb/content/`.
4. **Preview + gate** — Send Telegram message with: title, first 600 chars of content, file path. Attach inline keyboard: `[✅ Approva] [❌ Rigetta]`. Task stays `in_progress`.

**Output type in types/index.ts:** `TaskType` already includes `'content'` — no change needed.

### Telegram Callback Handler

**In:** `backend/src/services/telegram.ts`

Add `bot.on('callback_query:data', ...)` handler.

Callback data format:
- `content_approve:<task_id>` → `updateTaskStatus(task_id, 'done')` + `recordEvent('task_completed')` + answer callback "✅ Contenuto approvato"
- `content_reject:<task_id>` → `updateTaskStatus(task_id, 'blocked')` + answer callback "❌ Contenuto rigettato"

The handler answers the callback query immediately (prevents "loading" spinner in Telegram), then updates the task async.

### CEO Intake: `content_generate` command

**In:** `backend/src/agents/ceo_intake.ts`

Add to system prompt action list:
```
- content_generate → params: type (blog|social|newsletter), topic, tone?, client_slug?, project_slug?
```

Add rule 48: Use `content_generate` when Neb wants WAI to write content for a client or personal use. Creates a `content_writer` task. If client_slug + project_slug present, output is saved to that project's workspace. If not, saved to personal workspace.

**Execution in `executeCeoIntakeCommand`**: creates a task with `type: 'content'`, `assignee_agent_id: 'content_writer'`, and all params in `metadata`.

### CEO Routing

Add case in CEO agent routing: when `task.assignee_agent_id === 'content_writer'` or `task.type === 'content'` → `runContentWriterAgent(task, notify)`.

### Agent Registry

Add `content_writer` to `backend/src/config/agents.ts` with team `'marketing'`, tools: `['web_search', 'file_write']`, no shell, no GitHub.

---

## T143 — Analytics Dashboard

### Purpose
Expose WAI's self-hosted analytics data (page_views table + leads table) as a readable dashboard. Founder can see site traffic, top pages, referrer breakdown, and the lead conversion funnel.

### Scope
- 2 new backend API routes
- New dashboard component `AnalyticsView`
- Wired into Company mode sidebar and App.tsx

### Backend Routes

**File:** `backend/src/index.ts`

#### `GET /api/analytics/summary?days=7|30`

Queries `page_views` table (columns: `path`, `referrer`, `created_at`).

Response shape:
```ts
{
  period_days: number           // 7 or 30
  total_views: number
  unique_paths: number
  avg_per_day: number           // total_views / period_days
  top_pages: Array<{ path: string; count: number }>   // top 10, sorted desc
  top_referrers: Array<{ referrer: string; count: number }>  // top 10, sorted desc
}
```

Implementation: Supabase query with `gte('created_at', cutoff)`. For grouping, use JavaScript Map to count by path/referrer (no raw SQL needed, volume is low).

#### `GET /api/analytics/funnel`

Queries both tables:
- `page_views`: total count last 30 days
- `leads` by source/status: count inbound contacts, qualified, sent

Response shape:
```ts
{
  page_views: number         // page_views count last 30 days
  contacts_inbound: number   // leads where source = 'inbound' (landed via contact form)
  leads_qualified: number    // leads with status IN ['qualified','approved','sent','replied','won']
  outreach_sent: number      // leads with status = 'sent'
}
```

### Dashboard Component: `AnalyticsView`

**File:** `dashboard/src/components/AnalyticsView.tsx`

**Layout:**
```
[ 7 days ] [ 30 days ]                      ← period toggle, top right

┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│  Visits  │ │ Uniq Pages│ │  Avg/day │ │ Funnel % │
└──────────┘ └──────────┘ └──────────┘ └──────────┘

┌─────────────────────────────┐  ┌──────────────────────────────┐
│  Top Pages                  │  │  Referrer Breakdown          │
│  /              ███████ 42  │  │  (direct)        ████ 30     │
│  /services     ████  28     │  │  google.com      ██ 12       │
│  ...                        │  │  ...                         │
└─────────────────────────────┘  └──────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Conversion Funnel                                               │
│  [Page Views 342] → [Contacts 18] → [Qualified 11] → [Sent 7]  │
└──────────────────────────────────────────────────────────────────┘
```

**No external chart libraries.** Bars are `<div>` with percentage `width` via inline style. Funnel is 4 stat boxes with `→` separators.

**Stat cards**: same pattern as existing `Stat` component (`dashboard/src/components/ui/Stat.tsx`).

**API calls**: `fetch('/api/analytics/summary?days=7')` on mount + period change. `fetch('/api/analytics/funnel')` once on mount.

**Error state**: show "Nessun dato disponibile" with a subtle empty state if no page_views exist yet.

### Sidebar Integration

**File:** `dashboard/src/components/Sidebar.tsx`

Add `analytics` to `CompanyViewId` type. Add to `CLIENTS & WORK` section after `leads`:
```ts
{ id: 'analytics', label: 'Analytics', icon: 'trending-up' }
```
Also add a new `'analytics'` icon to `Icon.tsx` (bar chart SVG) and update `IconName` type — OR just use the existing `'trending-up'` icon as-is (simpler, no new icon needed).

### App.tsx Integration

- Add `'analytics'` to `VIEW_META` record
- Add `case 'analytics': return <AnalyticsView />` in `ViewContent`
- Import `AnalyticsView`

---

## What is NOT in scope

- No publish automation (T142)
- No real-time analytics updates / WebSocket (T143) — manual refresh is fine
- No user segmentation, session tracking, or bounce rate
- No content scheduling or client delivery automation
- No content versioning or diff

## Testing

**T142:**
1. `content_generate blog "Come usare l'AI nel marketing" --client wawen22 --project landing` from Telegram CEO NL
2. Verify task created with correct metadata
3. Verify `.md` file saved in workspace
4. Verify Telegram preview message with inline keyboard appears
5. Tap [✅ Approva] → task status becomes `done`
6. Tap [❌ Rigetta] → task status becomes `blocked`

**T143:**
1. Navigate to Analytics in Company mode sidebar
2. Verify visit counts load (may be 0 if no landing page traffic yet)
3. Toggle 7/30 days — numbers update
4. Funnel section shows lead counts
