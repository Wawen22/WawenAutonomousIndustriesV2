# T122 — PinchTab Browser Control Capability: Design Spec

**Date:** 2026-03-22
**Status:** Approved
**Task ID:** T122

---

## Problem

WAI currently has two stateless browser tools (`screenshot.ts`, `scraper.ts`) built on Playwright. Both spin up a new Chromium process per request, discard all session state, and return raw HTML or images — expensive in tokens (10k+ for a screenshot) and incapable of interactive workflows (login, form fill, multi-step navigation).

There is no capability in WAI today that gives agents a persistent, controllable browser with structured DOM extraction.

---

## Solution

Integrate **PinchTab** as a registered capability in the WAI capability platform.

PinchTab is a standalone Go HTTP server (port 9867) that manages Chrome instances, profiles, and tabs. It exposes a REST API and an accessibility-tree snapshot format that reduces page representation to ~800 tokens — 5–13x cheaper than screenshots.

The integration adds:

1. A typed HTTP client service (`pinchtab.ts`) wrapping the PinchTab REST API
2. A capability registry entry (`plugin.pinchtab`) with health check, policy, and audit
3. One capability ID constant in `config/capabilities.ts`
4. Documentation updates

The existing Playwright tools (`screenshot.ts`, `scraper.ts`) are **not modified**. They remain the right tool for stateless QA screenshots. PinchTab adds a complementary stateful browser control layer.

---

## Architecture

### Components

```
WAI Backend (Node.js 22)
  └── services/pinchtab.ts          ← NEW: HTTP client for PinchTab API
  └── config/capabilities.ts        ← MODIFIED: add PINCHTAB_CAPABILITY_ID
  └── services/capabilities.ts      ← MODIFIED: register plugin.pinchtab entry

PinchTab (standalone Go binary)
  └── HTTP API on http://127.0.0.1:9867
      ├── GET  /health
      ├── POST /navigate
      ├── GET  /snapshot
      ├── POST /action
      ├── GET  /text
      └── GET  /screenshot
```

### Dependency boundary

`pinchtab.ts` communicates with PinchTab exclusively over HTTP using Node 22 built-in `fetch`. No npm dependency is introduced. PinchTab is treated as an external local service — like Google Workspace MCP on port 8000.

---

## Service: `backend/src/services/pinchtab.ts`

### Environment variables

| Variable | Default | Required |
|---|---|---|
| `PINCHTAB_BASE_URL` | `http://127.0.0.1:9867` | No |
| `PINCHTAB_TOKEN` | — | No (only if PinchTab token auth is enabled) |

### Timeouts

All `fetch` calls use an `AbortController` signal:

- `isPinchTabAvailable()`: **800 ms** timeout (loopback health check; must not block `GET /api/capabilities`)
- All five service functions: **30 000 ms** timeout (navigation and page interactions can be slow)

If the signal fires, the function catches the `AbortError` and returns `{ ok: false, error: 'timeout' }`. Never throws.

### Public API

```typescript
isPinchTabAvailable(): Promise<boolean>
// GET /health with 800 ms timeout → true if status 200, false on any error

browserNavigate(url: string, opts?: { timeout?: number; blockImages?: boolean; newTab?: boolean }): Promise<PinchTabResult>
// POST /navigate

browserSnapshot(opts?: { filter?: 'interactive' | 'all'; format?: 'json' | 'text' | 'compact'; maxTokens?: number }): Promise<PinchTabResult>
// GET /snapshot — accessibility tree, ~800 tokens/page

browserAction(kind: 'click' | 'type' | 'press' | 'fill' | 'hover' | 'select' | 'scroll', opts: { ref?: string; text?: string; value?: string; key?: string }): Promise<PinchTabResult>
// POST /action

browserText(opts?: { mode?: 'readability' | 'raw' }): Promise<PinchTabResult>
// GET /text — token-efficient page text

browserScreenshot(): Promise<PinchTabResult>
// GET /screenshot — returns base64 image data
```

### Return type

```typescript
interface PinchTabResult {
  ok: boolean
  data?: unknown   // narrowed at call site — see "Type contract" below
  error?: string
}
```

### Type contract for `data`

`data` is typed as `unknown` intentionally. All call sites must narrow before use. This prevents accidental `as` casts. Example pattern:

```typescript
const result = await browserText()
if (result.ok && result.data && typeof result.data === 'object') {
  const text = (result.data as { text?: string }).text ?? ''
  // use text
}
```

Typed response shapes per endpoint (e.g. `SnapshotResult`, `NavigateResult`) are out of scope for T122 but should be introduced in the follow-on tool-registration task when agent code needs to consume specific fields. For T122, `unknown` is correct: the service layer must not make assumptions about which fields downstream code needs.

### Error handling

All functions catch network errors, `AbortError`, and non-OK HTTP responses and return `{ ok: false, error: message }`. Never throw. The caller decides whether to surface the error.

---

## Capability Registry Entry

### Capability

```
id:            'plugin.pinchtab'
type:          'plugin'
label:         'PinchTab Browser Control'
description:   'Stateful browser control via PinchTab HTTP server.
                Gives agents persistent Chrome sessions with
                token-efficient DOM snapshots, click/type/fill
                actions, and multi-step navigation.'
owner:         'neb'
runtimeTarget: 'shared'        ← both company and personal runtimes
status:        active (always registered; health reflects availability)
riskLevel:     'medium'
tags:          ['browser', 'automation', 'scraping', 'qa']
dependsOn:     []
```

### Assignments

| Target | Type | Runtime | Notes |
|---|---|---|---|
| Company Runtime | runtime | company | All company agents can use browser control |
| Personal Runtime | runtime | personal | Founder personal automations |
| Dev Team | team | company | Primary consumers: dev, QA workflows |
| Ops Team | team | company | Monitoring, screenshot capture |

### Policy

```
mode:             'restricted'
allowedTools:     ['browser_navigate', 'browser_snapshot',
                   'browser_action', 'browser_text', 'browser_screenshot']
envRequirements:  []  (PINCHTAB_BASE_URL has a safe default)
restrictedPaths:  []
notes:            'PinchTab must be running on localhost:9867.
                   PINCHTAB_BASE_URL and PINCHTAB_TOKEN are optional
                   overrides. Default security posture: loopback only,
                   IDPI restricts navigation to locally hosted URLs
                   until explicitly widened in PinchTab config.'
```

### Health

Health state is derived from `isPinchTabAvailable()` (with 800 ms timeout):

| State | Condition |
|---|---|
| `connected` | `GET /health` returns 200 within 800 ms |
| `degraded` | Connection refused, timeout, or non-200 response |

Note: `'offline'` is not a valid `CapabilityHealthState`. When PinchTab is not reachable the correct state is `'degraded'`, consistent with how other unreachable local runtimes are reported.

Checked at registry build time on each `GET /api/capabilities` call.

### Audit

Standard `baseAudit` with summary: `'PinchTab browser control — stateful Chrome sessions for agent automation.'`

---

## Capability ID Constant

Added to `backend/src/config/capabilities.ts`:

```typescript
export const PINCHTAB_CAPABILITY_ID = 'plugin.pinchtab'
```

---

## Relationship to Existing Browser Tools

| Tool | Type | Session | Token cost | Use case |
|---|---|---|---|---|
| `screenshot.ts` | Playwright | Stateless | High (image) | QA screenshots, visual checks |
| `scraper.ts` | Playwright | Stateless | Medium (HTML) | One-shot content extraction |
| PinchTab (`pinchtab.ts`) | HTTP client | **Stateful** | Low (~800 tokens) | Interactive workflows, login, form fill, multi-step |

No tools are removed. The three coexist with clear boundaries.

---

## Prerequisites

PinchTab must be installed and running before the health check can report `connected`:

```bash
# Option 1 — daemon (recommended for daily use)
npm install -g pinchtab
pinchtab daemon install

# Option 2 — manual server
pinchtab server   # runs on http://127.0.0.1:9867

# Option 3 — Docker
docker run -d --name pinchtab -p 127.0.0.1:9867:9867 \
  -v pinchtab-data:/data --shm-size=2g pinchtab/pinchtab
```

Optional `.env` additions:

```env
PINCHTAB_BASE_URL=http://127.0.0.1:9867
PINCHTAB_TOKEN=
```

---

## Out of Scope (T122)

- Exposing PinchTab tools as LLM tool calls in agent system prompts (next step, separate task)
- Dashboard UI beyond CapabilitiesView (not needed)
- Multi-instance or profile management (advanced PinchTab feature, future)
- Replacing `screenshot.ts` / `scraper.ts`
- Typed response shapes per endpoint (deferred to tool-registration task)

---

## Files Changed

| File | Change |
|---|---|
| `backend/src/services/pinchtab.ts` | NEW — PinchTab HTTP client service |
| `backend/src/config/capabilities.ts` | ADD `PINCHTAB_CAPABILITY_ID` constant |
| `backend/src/services/capabilities.ts` | ADD `plugin.pinchtab` entry to registry |
| `docs/PROJECT_TRACKING.md` | Mark T122 done, add Recent Changes entry |
| `docs/MCP_SETUP.md` | Add PinchTab setup section |

---

## Test Plan

1. **Health check (degraded):** start backend with PinchTab not running → `GET /api/capabilities` shows `plugin.pinchtab` with state `degraded`; response time < 2 s (AbortController fires at 800 ms)
2. **Health check (connected):** start PinchTab (`pinchtab server`) → `GET /api/capabilities` shows `plugin.pinchtab` with state `connected`
2b. **Health check (stalled):** PinchTab process running but hung → `isPinchTabAvailable()` returns `false` within 800 ms (timeout fires, does not hang indefinitely)
3. **Navigate:** call `browserNavigate('https://example.com')` → returns `{ ok: true }`
4. **Text extraction:** `browserText()` returns page text, `result.ok === true`, `data` narrowable to `{ text: string }`
5. **Snapshot:** `browserSnapshot({ filter: 'interactive' })` returns `{ ok: true }` with element refs in `data`
6. **Dashboard:** `Capabilities` view shows `PinchTab Browser Control` with correct health badge
7. **Typecheck:** `cd backend && pnpm typecheck` → no errors
8. **Typecheck:** `cd dashboard && pnpm typecheck` → no errors (no dashboard changes expected)
