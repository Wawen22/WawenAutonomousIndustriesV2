# T143 — Analytics Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose WAI's self-hosted analytics (`page_views` table) and lead funnel data as a Company mode dashboard view — total visits, top pages, referrer breakdown, and a 4-stage conversion funnel.

**Architecture:** Two new backend GET routes (`/api/analytics/summary` and `/api/analytics/funnel`) query Supabase directly and aggregate in JS. New `AnalyticsView.tsx` React component fetches these routes and renders stat cards + inline SVG-free bar charts (width% via inline style) + funnel row. Wired into `Sidebar.tsx` and `App.tsx` under Company mode.

**Tech Stack:** Node.js 22 + TypeScript (backend), React 18 + Vite + Tailwind (dashboard), Supabase (data source)

---

## File Map

| Action | File | Change |
|--------|------|--------|
| Modify | `backend/src/index.ts` | Add 2 analytics GET routes after `POST /api/analytics/pageview` |
| Create | `dashboard/src/components/AnalyticsView.tsx` | New dashboard view |
| Modify | `dashboard/src/components/Sidebar.tsx` | Add `analytics` to `CompanyViewId` + nav item |
| Modify | `dashboard/src/App.tsx` | Import + VIEW_META entry + ViewContent case |

---

## Task 1: Add analytics API routes

**Files:**
- Modify: `backend/src/index.ts` (after line ~2432, after `POST /api/analytics/pageview` block)

- [ ] **Step 1: Find the exact insertion point in index.ts**

```bash
grep -n "api/analytics/pageview\|Stripe webhook" backend/src/index.ts | head -5
```
Expected: shows line numbers. Insert new routes between end of pageview block and start of Stripe webhook block.

- [ ] **Step 2: Add the two GET analytics routes**

In `backend/src/index.ts`, find the comment line `// ── Stripe webhook (T141)` and insert the following block BEFORE it (after the closing `}` of the pageview route):

```typescript
    // ── Analytics summary + funnel (T143) ───────────────────────────────────

    // GET /api/analytics/summary?days=7|30
    if (url.pathname === '/api/analytics/summary' && req.method === 'GET') {
      void (async () => {
        try {
          const rawDays = url.searchParams.get('days')
          const days = Math.max(1, Math.min(90, parseInt(rawDays ?? '7', 10) || 7))
          const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

          const { getSupabaseClient } = await import('./services/supabase.js')
          const { data, error } = await getSupabaseClient()
            .from('page_views')
            .select('path, referrer, created_at')
            .gte('created_at', since)

          if (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: error.message }))
            return
          }

          const rows = data ?? []
          const totalViews = rows.length
          const avgPerDay = Math.round((totalViews / days) * 10) / 10

          // Count by path
          const pathCounts = new Map<string, number>()
          for (const row of rows) {
            const p = (row.path as string | null) || '/'
            pathCounts.set(p, (pathCounts.get(p) ?? 0) + 1)
          }
          const topPages = [...pathCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([path, count]) => ({ path, count }))

          // Count by referrer (normalize to hostname)
          const refCounts = new Map<string, number>()
          for (const row of rows) {
            const raw = ((row.referrer as string | null) ?? '').trim()
            let normalized = raw || '(direct)'
            if (normalized.startsWith('http')) {
              try { normalized = new URL(normalized).hostname } catch { /* keep as-is */ }
            }
            refCounts.set(normalized, (refCounts.get(normalized) ?? 0) + 1)
          }
          const topReferrers = [...refCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([referrer, count]) => ({ referrer, count }))

          const uniquePaths = pathCounts.size

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            period_days: days,
            total_views: totalViews,
            unique_paths: uniquePaths,
            avg_per_day: avgPerDay,
            top_pages: topPages,
            top_referrers: topReferrers,
          }))
        } catch (err) {
          log.error({ err }, 'Analytics summary error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      })()
      return
    }

    // GET /api/analytics/funnel
    if (url.pathname === '/api/analytics/funnel' && req.method === 'GET') {
      void (async () => {
        try {
          const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

          const { getSupabaseClient } = await import('./services/supabase.js')
          const [viewsResult, leadsResult] = await Promise.all([
            getSupabaseClient()
              .from('page_views')
              .select('id', { count: 'exact', head: true })
              .gte('created_at', since30),
            getSupabaseClient()
              .from('leads')
              .select('status, source'),
          ])

          const pageViews = viewsResult.count ?? 0
          const leads = (leadsResult.data ?? []) as Array<{ status: string; source: string }>

          const contactsInbound = leads.filter((l) => l.source === 'inbound').length
          const leadsQualified = leads.filter((l) =>
            ['qualified', 'approved', 'sent', 'replied', 'won'].includes(l.status)
          ).length
          const outreachSent = leads.filter((l) => l.status === 'sent').length

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            page_views: pageViews,
            contacts_inbound: contactsInbound,
            leads_qualified: leadsQualified,
            outreach_sent: outreachSent,
          }))
        } catch (err) {
          log.error({ err }, 'Analytics funnel error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      })()
      return
    }
```

- [ ] **Step 3: Typecheck**

```bash
cd backend && pnpm typecheck
```
Expected: no errors

- [ ] **Step 4: Quick API test (backend must be running)**

```bash
curl "http://localhost:3001/api/analytics/summary?days=7"
curl "http://localhost:3001/api/analytics/funnel"
```
Expected: JSON responses (counts may be 0 if no data yet, that's fine)

- [ ] **Step 5: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat(T143): add /api/analytics/summary and /api/analytics/funnel routes"
```

---

## Task 2: Create `AnalyticsView.tsx` dashboard component

**Files:**
- Create: `dashboard/src/components/AnalyticsView.tsx`

- [ ] **Step 1: Create the component**

Create `dashboard/src/components/AnalyticsView.tsx`:

```typescript
// ============================================================
// WAI – Analytics View (T143)
// Landing page traffic stats + lead conversion funnel.
// No external chart libraries — bars via inline CSS width%.
// ============================================================

import { useEffect, useState } from 'react'

const BACKEND_URL = (import.meta.env['VITE_BACKEND_URL'] as string | undefined) ?? ''

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AnalyticsSummary {
  period_days: number
  total_views: number
  unique_paths: number
  avg_per_day: number
  top_pages: Array<{ path: string; count: number }>
  top_referrers: Array<{ referrer: string; count: number }>
}

interface AnalyticsFunnel {
  page_views: number
  contacts_inbound: number
  leads_qualified: number
  outreach_sent: number
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">{label}</p>
      <p className="mt-1 text-xl font-black text-white">{value}</p>
      {sub && <p className="text-[10px] text-slate-600 mt-0.5">{sub}</p>}
    </div>
  )
}

function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100)
  return (
    <div className="space-y-1">
      <span className="text-[11px] text-slate-400 font-mono truncate block">{label}</span>
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </div>
        <span className="text-[10px] font-mono text-slate-500 w-7 text-right flex-shrink-0">{value}</span>
      </div>
    </div>
  )
}

function FunnelStage({ label, value, color, isLast }: { label: string; value: number; color: string; isLast: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="rounded-xl border border-white/[0.07] bg-black/30 px-4 py-3 text-center min-w-[110px]">
        <p className="text-lg font-black" style={{ color }}>{value.toLocaleString()}</p>
        <p className="text-[9px] text-slate-600 uppercase tracking-[0.18em] mt-0.5 leading-tight">{label}</p>
      </div>
      {!isLast && <span className="text-slate-700 text-base">→</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function AnalyticsView() {
  const [period, setPeriod] = useState<7 | 30>(7)
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [funnel, setFunnel] = useState<AnalyticsFunnel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`${BACKEND_URL}/api/analytics/summary?days=${period}`)
      .then((r) => (r.ok ? (r.json() as Promise<AnalyticsSummary>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setSummary)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [period])

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/analytics/funnel`)
      .then((r) => (r.ok ? (r.json() as Promise<AnalyticsFunnel>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setFunnel)
      .catch(() => { /* non-fatal: funnel stays null */ })
  }, [])

  const maxPage = Math.max(...(summary?.top_pages.map((p) => p.count) ?? [0]), 1)
  const maxRef = Math.max(...(summary?.top_referrers.map((r) => r.count) ?? [0]), 1)
  const conversionRate =
    funnel && funnel.page_views > 0
      ? `${Math.round((funnel.contacts_inbound / funnel.page_views) * 100)}%`
      : '—'

  const funnelStages = funnel
    ? [
        { label: 'Page Views', value: funnel.page_views, color: '#00D4FF' },
        { label: 'Contatti Inbound', value: funnel.contacts_inbound, color: '#7CF6E6' },
        { label: 'Lead Qualificati', value: funnel.leads_qualified, color: '#a78bfa' },
        { label: 'Outreach Inviato', value: funnel.outreach_sent, color: '#34d399' },
      ]
    : []

  return (
    <div className="flex flex-col h-full overflow-auto p-6 gap-6">

      {/* Header + period toggle */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-black text-white uppercase tracking-tight italic">Site Analytics</h2>
          <p className="text-[11px] text-slate-600 mt-0.5">Landing page traffic + lead conversion funnel</p>
        </div>
        <div className="flex rounded-lg overflow-hidden border border-white/[0.07]">
          {([7, 30] as const).map((d) => (
            <button
              key={d}
              onClick={() => setPeriod(d)}
              className={`px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] transition-all ${
                period === d
                  ? 'bg-[#00D4FF] text-black'
                  : 'text-slate-500 hover:text-white bg-transparent'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-[#00D4FF]/30 border-t-[#00D4FF] rounded-full animate-spin" />
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-[12px] text-rose-400">
          Errore nel caricamento analytics: {error}
        </div>
      )}

      {/* Content */}
      {!loading && !error && summary && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Visite totali" value={summary.total_views} sub={`Ultimi ${period} giorni`} />
            <StatCard label="Pagine uniche" value={summary.unique_paths} />
            <StatCard label="Media / giorno" value={summary.avg_per_day} />
            <StatCard label="Conversione" value={conversionRate} sub="Visite → Contatti" />
          </div>

          {/* Top pages + referrers */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
              <h3 className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-600 mb-4">
                Top Pages
              </h3>
              {summary.top_pages.length === 0 ? (
                <p className="text-[11px] text-slate-600">Nessun dato disponibile.</p>
              ) : (
                <div className="space-y-3">
                  {summary.top_pages.map((p) => (
                    <BarRow key={p.path} label={p.path} value={p.count} max={maxPage} color="#00D4FF" />
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
              <h3 className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-600 mb-4">
                Referrer Breakdown
              </h3>
              {summary.top_referrers.length === 0 ? (
                <p className="text-[11px] text-slate-600">Nessun dato disponibile.</p>
              ) : (
                <div className="space-y-3">
                  {summary.top_referrers.map((r) => (
                    <BarRow key={r.referrer} label={r.referrer} value={r.count} max={maxRef} color="#7CF6E6" />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Conversion funnel */}
          {funnel && (
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
              <h3 className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-600 mb-4">
                Conversion Funnel — Ultimi 30 giorni
              </h3>
              <div className="flex items-center gap-2 flex-wrap">
                {funnelStages.map((stage, i) => (
                  <FunnelStage
                    key={stage.label}
                    label={stage.label}
                    value={stage.value}
                    color={stage.color}
                    isLast={i === funnelStages.length - 1}
                  />
                ))}
              </div>
              {funnel.page_views === 0 && (
                <p className="text-[11px] text-slate-600 mt-3">
                  Nessun dato analytics ancora. Le visite alla landing page appariranno qui automaticamente.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* Empty state when no data and no error */}
      {!loading && !error && summary && summary.total_views === 0 && (
        <div className="rounded-xl border border-dashed border-white/[0.08] p-8 text-center">
          <p className="text-sm text-slate-500">Nessuna visita registrata negli ultimi {period} giorni.</p>
          <p className="text-[11px] text-slate-600 mt-1">Le visite alla landing page WAI vengono tracciate automaticamente.</p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck dashboard**

```bash
cd dashboard && pnpm typecheck
```
Expected: no errors (note: `AnalyticsView` not yet imported anywhere, so no "unused" errors)

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/AnalyticsView.tsx
git commit -m "feat(T143): add AnalyticsView dashboard component"
```

---

## Task 3: Wire `analytics` into Sidebar + App

**Files:**
- Modify: `dashboard/src/components/Sidebar.tsx`
- Modify: `dashboard/src/App.tsx`

- [ ] **Step 1: Add `'analytics'` to `CompanyViewId` type in Sidebar.tsx**

In `dashboard/src/components/Sidebar.tsx`, find:
```typescript
export type CompanyViewId = 'overview' | 'tasks' | 'activity' | 'costs' | 'runs' | 'clients' | 'projects' | 'revenue' | 'founder' | 'team' | 'office' | 'memory' | 'capabilities' | 'models' | 'settings' | 'docs' | 'leads'
```

Replace with:
```typescript
export type CompanyViewId = 'overview' | 'tasks' | 'activity' | 'costs' | 'runs' | 'clients' | 'projects' | 'revenue' | 'founder' | 'team' | 'office' | 'memory' | 'capabilities' | 'models' | 'settings' | 'docs' | 'leads' | 'analytics'
```

- [ ] **Step 2: Add the nav item to COMPANY_NAV_SECTIONS**

In `dashboard/src/components/Sidebar.tsx`, find the `CLIENTS & WORK` section:
```typescript
  {
    title: 'CLIENTS & WORK',
    items: [
      { id: 'clients',   label: 'Clients',          icon: 'clients'   },
      { id: 'projects',  label: 'Projects',         icon: 'projects'  },
      { id: 'tasks',     label: 'Task Board',       icon: 'tasks'     },
      { id: 'leads',     label: 'Leads',            icon: 'leads'     },
    ]
  },
```

Replace with:
```typescript
  {
    title: 'CLIENTS & WORK',
    items: [
      { id: 'clients',   label: 'Clients',          icon: 'clients'      },
      { id: 'projects',  label: 'Projects',         icon: 'projects'     },
      { id: 'tasks',     label: 'Task Board',       icon: 'tasks'        },
      { id: 'leads',     label: 'Leads',            icon: 'leads'        },
      { id: 'analytics', label: 'Analytics',        icon: 'trending-up'  },
    ]
  },
```

- [ ] **Step 3: Add `analytics` to VIEW_META in App.tsx**

In `dashboard/src/App.tsx`, find the `VIEW_META` record and add:
```typescript
  analytics: { title: 'Analytics', description: 'Site traffic, top pages, referrer breakdown, lead funnel' },
```

- [ ] **Step 4: Import and wire `AnalyticsView` in App.tsx**

In `dashboard/src/App.tsx`, add the import after the existing view imports:
```typescript
import { AnalyticsView } from './components/AnalyticsView.js'
```

In the `ViewContent` switch, add the case:
```typescript
    case 'analytics': return <AnalyticsView />
```

- [ ] **Step 5: Typecheck dashboard**

```bash
cd dashboard && pnpm typecheck
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/components/Sidebar.tsx dashboard/src/App.tsx
git commit -m "feat(T143): wire AnalyticsView into Company mode sidebar and App"
```

---

## Task 4: Manual end-to-end test + docs update

- [ ] **Step 1: Start both services**

```bash
cd backend && pnpm dev &
cd dashboard && pnpm dev
```

- [ ] **Step 2: Open dashboard and navigate to Analytics**

Open `http://localhost:3000`, switch to Company mode, click "Analytics" in the sidebar.
Expected: Analytics view loads, shows 0 or real data, no errors in console.

- [ ] **Step 3: Test period toggle**

Click "30d" and "7d" buttons.
Expected: stat cards update, spinner appears briefly.

- [ ] **Step 4: Update PROJECT_TRACKING.md**

In `docs/PROJECT_TRACKING.md`:
1. Add T142 and T143 to Active Build Queue as ✅ Done
2. Add entries to the Recent Changes section

For Active Build Queue, add/update:
```markdown
| T142 | Content Factory | ✅ Done | Claude | 1 | content_writer agent, CEO NL content_generate, Telegram inline keyboard approval |
| T143 | Analytics Dashboard | ✅ Done | Claude | 1 | /api/analytics/summary, /api/analytics/funnel, AnalyticsView in Company sidebar |
```

For Recent Changes, add a new section at the top:
```markdown
### 2026-03-27 — T142: Content Factory + T143: Analytics Dashboard

**T142 — Content Factory:**
- `backend/src/agents/content_writer.ts`: new agent — 2 Serper web searches for research, type-specific LLM prompt (blog 800-1200w / social 4 variants / newsletter 400-600w), saves `.md` to `workspace/<client>/<project>/deliverables/` or `workspace/personal/neb/content/`. Sends Telegram preview + inline keyboard [✅ Approva / ❌ Rigetta]. Task stays `in_progress` until founder taps a button.
- `backend/src/services/telegram.ts`: `sendContentApprovalRequest(taskId, title, type, preview, path)` — sends message with Grammy inline keyboard. `bot.on('callback_query:data', ...)` handler in `registerHandlers` — `content_approve:` → `updateTaskStatus(done)`, `content_reject:` → `updateTaskStatus(blocked)`.
- `backend/src/agents/ceo_intake.ts`: `content_generate` command added (rule 48) — creates task + fires `runContentWriterAgent` non-blocking.
- `backend/src/agents/ceo.ts`: import + routing case for `content_writer`.
- `backend/src/config/agents.ts`: `content_writer` entry (team: marketing, tools: web_search/file_write).

**T143 — Analytics Dashboard:**
- `backend/src/index.ts`: `GET /api/analytics/summary?days=7|30` — aggregates `page_views` table by path and referrer. `GET /api/analytics/funnel` — `page_views` last 30d + leads by source/status.
- `dashboard/src/components/AnalyticsView.tsx`: stat cards (visits, unique pages, avg/day, conversion%), top pages bar list, referrer breakdown bar list, 4-stage funnel row. Period toggle 7d/30d. No external chart libraries.
- `dashboard/src/components/Sidebar.tsx`: `analytics` added to `CompanyViewId` + `CLIENTS & WORK` section.
- `dashboard/src/App.tsx`: `AnalyticsView` imported, `VIEW_META` + `ViewContent` wired.

**How to test T142:**
1. Telegram: `genera blog su "Come usare l'AI nel marketing digitale"` → CEO Intake replies with task ID → preview + inline keyboard arrives in ~30-60s → tap ✅
2. With client: `genera newsletter su "Offerta primavera" per cliente <slug> progetto <slug>`

**How to test T143:**
1. Dashboard → Company mode → Analytics → verify view loads
2. Toggle 7d/30d → counts update
```

- [ ] **Step 5: Commit docs**

```bash
git add docs/PROJECT_TRACKING.md
git commit -m "docs: update PROJECT_TRACKING for T142 Content Factory + T143 Analytics Dashboard"
```

- [ ] **Step 6: Final typecheck both services**

```bash
cd backend && pnpm typecheck && cd ../dashboard && pnpm typecheck
```
Expected: clean output on both
