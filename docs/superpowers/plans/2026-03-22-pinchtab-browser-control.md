# T122 — PinchTab Browser Control Capability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register PinchTab as a `plugin.pinchtab` capability in the WAI capability platform with a typed HTTP client service, health check, policy, and audit.

**Architecture:** Add `backend/src/services/pinchtab.ts` as a thin HTTP client over the PinchTab REST API on `http://127.0.0.1:9867`. Add the capability ID constant to `config/capabilities.ts`. Register the full capability entry (capability + assignments + policy + health + audit) in `services/capabilities.ts` following the exact same pattern as `integration.github`. Update docs.

**Tech Stack:** Node.js 22 built-in `fetch` with `AbortController`, TypeScript strict mode, WAI capability registry pattern.

---

## Spec Reference

[docs/superpowers/specs/2026-03-22-pinchtab-browser-control-design.md](../specs/2026-03-22-pinchtab-browser-control-design.md)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/src/services/pinchtab.ts` | CREATE | HTTP client for PinchTab API: `isPinchTabAvailable`, `browserNavigate`, `browserSnapshot`, `browserAction`, `browserText`, `browserScreenshot` |
| `backend/src/config/capabilities.ts` | MODIFY | Add `PINCHTAB_CAPABILITY_ID = 'plugin.pinchtab'` constant |
| `backend/src/services/capabilities.ts` | MODIFY | (1) Import `isPinchTabAvailable` + add to `Promise.all`; (2) Add `plugin.pinchtab` entry to `catalogBase` |
| `docs/PROJECT_TRACKING.md` | MODIFY | Mark T122 done, add Recent Changes entry |
| `docs/MCP_SETUP.md` | MODIFY | Add PinchTab setup section |

---

## Task 1: Create `pinchtab.ts` service

**Files:**
- Create: `backend/src/services/pinchtab.ts`

### Context

This is an HTTP client. It wraps the PinchTab REST API. All exports are pure async functions that never throw — they catch every error and return `{ ok: false, error }`. Uses Node 22 built-in `fetch` (no new npm dep). Two timeout values: 800 ms for health check (must not block the capability registry endpoint), 30 000 ms for all browser operations.

The PinchTab HTTP API uses:
- `POST /navigate` with JSON body `{ url, timeout?, blockImages?, newTab? }`
- `GET /snapshot` with query params `filter`, `format`, `maxTokens`
- `POST /action` with JSON body `{ kind, ref?, text?, value?, key? }`
- `GET /text` with query params `mode`
- `GET /screenshot` (no params needed for basic use)

- [ ] **Step 1.1: Write the service file**

Create `backend/src/services/pinchtab.ts` with exactly this content:

```typescript
const BASE_URL = process.env['PINCHTAB_BASE_URL']?.trim() || 'http://127.0.0.1:9867'
const TOKEN = process.env['PINCHTAB_TOKEN']?.trim() || ''

const HEALTH_TIMEOUT_MS = 800
const OP_TIMEOUT_MS = 30_000

export interface PinchTabResult {
  ok: boolean
  data?: unknown
  error?: string
}

function buildHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (TOKEN) h['Authorization'] = `Bearer ${TOKEN}`
  return h
}

async function ptFetch(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
  timeoutMs = OP_TIMEOUT_MS,
): Promise<PinchTabResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  try {
    const url = BASE_URL + path
    const init: RequestInit = {
      method,
      headers: buildHeaders(),
      signal: controller.signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }
    const res = await fetch(url, init)
    const text = await res.text()
    const data: unknown = text ? JSON.parse(text) : {}
    if (!res.ok) return { ok: false, error: `HTTP ${String(res.status)}: ${res.statusText}`, data }
    return { ok: true, data }
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: name === 'AbortError' ? 'timeout' : msg }
  } finally {
    clearTimeout(timer)
  }
}

/** Returns true if PinchTab is reachable (800 ms loopback timeout). */
export async function isPinchTabAvailable(): Promise<boolean> {
  const result = await ptFetch('GET', '/health', undefined, HEALTH_TIMEOUT_MS)
  return result.ok
}

export async function browserNavigate(
  url: string,
  opts?: { timeout?: number; blockImages?: boolean; newTab?: boolean },
): Promise<PinchTabResult> {
  const body: Record<string, unknown> = { url }
  if (opts?.timeout !== undefined) body['timeout'] = opts.timeout
  if (opts?.blockImages !== undefined) body['blockImages'] = opts.blockImages
  if (opts?.newTab !== undefined) body['newTab'] = opts.newTab
  return ptFetch('POST', '/navigate', body)
}

export async function browserSnapshot(opts?: {
  filter?: 'interactive' | 'all'
  format?: 'json' | 'text' | 'compact'
  maxTokens?: number
}): Promise<PinchTabResult> {
  const params = new URLSearchParams()
  if (opts?.filter) params.set('filter', opts.filter)
  if (opts?.format) params.set('format', opts.format)
  if (opts?.maxTokens !== undefined) params.set('maxTokens', String(opts.maxTokens))
  const qs = params.toString()
  return ptFetch('GET', `/snapshot${qs ? `?${qs}` : ''}`)
}

export async function browserAction(
  kind: 'click' | 'type' | 'press' | 'fill' | 'hover' | 'select' | 'scroll',
  opts: { ref?: string; text?: string; value?: string; key?: string; scrollY?: number; waitNav?: boolean },
): Promise<PinchTabResult> {
  const body: Record<string, unknown> = { kind }
  if (opts.ref) body['ref'] = opts.ref
  if (opts.text !== undefined) body['text'] = opts.text
  if (opts.value !== undefined) body['value'] = opts.value
  if (opts.key) body['key'] = opts.key
  if (opts.scrollY !== undefined) body['scrollY'] = opts.scrollY
  if (opts.waitNav) body['waitNav'] = true
  return ptFetch('POST', '/action', body)
}

export async function browserText(opts?: { mode?: 'readability' | 'raw' }): Promise<PinchTabResult> {
  const qs = opts?.mode ? `?mode=${opts.mode}` : ''
  return ptFetch('GET', `/text${qs}`)
}

export async function browserScreenshot(): Promise<PinchTabResult> {
  return ptFetch('GET', '/screenshot')
}
```

- [ ] **Step 1.2: Run typecheck to verify no errors**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2/backend" && pnpm typecheck
```

Expected: zero TypeScript errors. If errors appear in the new file, fix them before continuing.

- [ ] **Step 1.3: Commit**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2"
git add backend/src/services/pinchtab.ts
git commit -m "feat(T122): add PinchTab HTTP client service"
```

---

## Task 2: Add capability ID constant

**Files:**
- Modify: `backend/src/config/capabilities.ts` (line 8 — after the last existing `export const` line)

### Context

`config/capabilities.ts` exports string constants used across the codebase to reference capability IDs without magic strings. Current last constant is `PERSONAL_WORKSPACE_CONTEXT_CAPABILITY_ID` on line 8. Add `PINCHTAB_CAPABILITY_ID` after it.

- [ ] **Step 2.1: Add the constant**

Open `backend/src/config/capabilities.ts`. After line 8 (`export const PERSONAL_WORKSPACE_CONTEXT_CAPABILITY_ID = 'memory.personal_workspace_context'`), add:

```typescript
export const PINCHTAB_CAPABILITY_ID = 'plugin.pinchtab'
```

The file should now have this at the top (lines 1–9):

```typescript
import type { PersonalAssistantQuickActionId } from '../services/personal-assistant-actions.js'

export const GOOGLE_WORKSPACE_PLUGIN_CAPABILITY_ID = 'plugin.google_workspace.mcp'
export const GMAIL_INTEGRATION_CAPABILITY_ID = 'integration.google_workspace.gmail'
export const CALENDAR_INTEGRATION_CAPABILITY_ID = 'integration.google_workspace.calendar'
export const DRIVE_INTEGRATION_CAPABILITY_ID = 'integration.google_workspace.drive'
export const DAILY_FOUNDER_BRIEF_AUTOMATION_CAPABILITY_ID = 'skill.founder.daily_founder_brief_automation'
export const PERSONAL_WORKSPACE_CONTEXT_CAPABILITY_ID = 'memory.personal_workspace_context'
export const PINCHTAB_CAPABILITY_ID = 'plugin.pinchtab'
```

- [ ] **Step 2.2: Run typecheck**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2/backend" && pnpm typecheck
```

Expected: zero errors.

- [ ] **Step 2.3: Commit**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2"
git add backend/src/config/capabilities.ts
git commit -m "feat(T122): add PINCHTAB_CAPABILITY_ID constant"
```

---

## Task 3: Register `plugin.pinchtab` in the capability registry

**Files:**
- Modify: `backend/src/services/capabilities.ts`

This is the most involved task. There are three edits:
1. Import `isPinchTabAvailable` at the top of the file
2. Add it to the `Promise.all` inside `getCapabilityRegistrySnapshot`
3. Add the full `plugin.pinchtab` entry to `catalogBase`

### Context on the file structure

- Imports are at lines 1–26
- `getCapabilityRegistrySnapshot()` starts at line 552
- The `Promise.all` destructure is at lines 554–559
- `catalogBase` starts at line 571
- The last entry in `catalogBase` before the closing bracket is around line 1490 (channel capabilities)
- The closing of `catalogBase` and the rest of the function follow after

**Important:** The `getCapabilityRegistrySnapshot` function is `async`. Adding `isPinchTabAvailable()` to the `Promise.all` is safe because it has its own 800 ms timeout and never throws.

- [ ] **Step 3.1: Add the import**

At the top of `backend/src/services/capabilities.ts`, after the existing imports (after line 26, which is `import { getPersonalWorkspacePath, getWorkspaceRoot } from './workspace.js'`), add:

```typescript
import { isPinchTabAvailable } from './pinchtab.js'
```

- [ ] **Step 3.2: Add `isPinchTabAvailable` to the Promise.all**

Find the `Promise.all` block in `getCapabilityRegistrySnapshot` (around line 554):

```typescript
const [mcpBridgeStatus, googleWorkspaceRuntime, automationStatus, recentEvents] = await Promise.all([
  getMcpBridgeStatus(),
  getGoogleWorkspaceMcpRuntimeStatus(DEFAULT_OWNER_SLUG),
  getPersonalAutomationStatus(DEFAULT_OWNER_SLUG),
  getCapabilityEvents({ limit: 200 }),
])
```

Replace with:

```typescript
const [mcpBridgeStatus, googleWorkspaceRuntime, automationStatus, recentEvents, pinchTabAvailable] = await Promise.all([
  getMcpBridgeStatus(),
  getGoogleWorkspaceMcpRuntimeStatus(DEFAULT_OWNER_SLUG),
  getPersonalAutomationStatus(DEFAULT_OWNER_SLUG),
  getCapabilityEvents({ limit: 200 }),
  isPinchTabAvailable(),
])
```

- [ ] **Step 3.3: Add the `plugin.pinchtab` entry to `catalogBase`**

Find the end of the `catalogBase` array. The last entry ends just before the line `]` that closes the array (somewhere around line 1490). Add the new entry as the **last** item in `catalogBase`, before the closing `]`:

```typescript
    {
      capability: baseCapability({
        id: 'plugin.pinchtab',
        type: 'plugin',
        label: 'PinchTab Browser Control',
        description: 'Stateful browser control via PinchTab HTTP server. Gives agents persistent Chrome sessions with token-efficient DOM snapshots (~800 tokens/page), click/type/fill actions, and multi-step navigation.',
        owner: DEFAULT_OWNER_SLUG,
        runtimeTarget: 'shared',
        riskLevel: 'medium',
        tags: ['browser', 'automation', 'scraping', 'qa'],
        usageInstructions: 'Start PinchTab (npm install -g pinchtab && pinchtab daemon install) then call browserNavigate / browserSnapshot / browserAction / browserText from pinchtab.ts. Health check is live — state reflects whether PinchTab is reachable on localhost:9867.',
        examples: [
          'Navigate to a URL and extract page text token-efficiently',
          'Click a button or fill a form on a web page',
          'Take a screenshot of a running web application',
          'Get an accessibility-tree snapshot for structured DOM interaction',
        ],
      }),
      assignments: [
        runtimeAssignment('plugin.pinchtab', 'company', 'Company Runtime', 'company'),
        runtimeAssignment('plugin.pinchtab', 'personal', 'Personal Runtime', 'personal'),
        teamAssignment('plugin.pinchtab', 'dev', 'company', 'Dev and QA agents use browser control for interactive testing and scraping.'),
        teamAssignment('plugin.pinchtab', 'ops', 'company', 'Ops agents can use browser control for monitoring and screenshot capture.'),
      ],
      policy: basePolicy({
        capabilityId: 'plugin.pinchtab',
        mode: 'restricted',
        allowedTools: ['browser_navigate', 'browser_snapshot', 'browser_action', 'browser_text', 'browser_screenshot'],
        envRequirements: [],
        notes: 'PinchTab must be running on localhost:9867. PINCHTAB_BASE_URL and PINCHTAB_TOKEN are optional env overrides. Default security posture: loopback only, IDPI restricts navigation to locally hosted URLs until explicitly widened in PinchTab config.',
      }),
      health: baseHealth({
        capabilityId: 'plugin.pinchtab',
        state: pinchTabAvailable ? 'connected' : 'degraded',
        label: pinchTabAvailable ? 'Connected' : 'Offline',
        message: pinchTabAvailable
          ? 'PinchTab server is reachable on localhost:9867 and ready for browser control.'
          : 'PinchTab server is not reachable. Run: pinchtab daemon install  or  pinchtab server',
        checkedAt: generatedAt,
        freshness: pinchTabAvailable ? 'fresh' : 'unknown',
        reasonCode: pinchTabAvailable ? 'server_reachable' : 'server_unreachable',
        details: pinchTabAvailable
          ? [`PinchTab HTTP API responding on ${process.env['PINCHTAB_BASE_URL'] ?? 'http://127.0.0.1:9867'}`]
          : ['Install: npm install -g pinchtab', 'Start: pinchtab daemon install'],
      }),
      audit: baseAudit({
        capabilityId: 'plugin.pinchtab',
        summary: 'PinchTab browser control — stateful Chrome sessions for agent automation.',
      }),
    },
```

- [ ] **Step 3.4: Run typecheck**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2/backend" && pnpm typecheck
```

Expected: zero errors. Common issues to look for:
- `runtimeTarget: 'shared'` — valid (`CapabilityRuntimeTarget = 'personal' | 'company' | 'shared'`)
- `state: 'degraded'` — valid (`CapabilityHealthState` includes `'degraded'`)
- `pinchTabAvailable` is `boolean` from `Promise.all` — no type issues expected

If you get a type error on `pinchTabAvailable`, check that the destructure in Step 3.2 lists it in the **same position** (5th) as `isPinchTabAvailable()` in the `Promise.all` array.

- [ ] **Step 3.5: Run dashboard typecheck**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2/dashboard" && pnpm typecheck
```

Expected: zero errors (no dashboard files were changed).

- [ ] **Step 3.6: Commit**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2"
git add backend/src/services/capabilities.ts
git commit -m "feat(T122): register plugin.pinchtab capability with health check, policy, and audit"
```

---

## Task 4: Manual smoke test

**No code changes.** This task validates the runtime behaviour before updating docs.

- [ ] **Step 4.1: Start the backend**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2/backend" && pnpm dev
```

Leave running in a terminal.

- [ ] **Step 4.2: Verify health = degraded when PinchTab is NOT running**

In a second terminal:

```bash
curl -s http://localhost:3001/api/capabilities | \
  python3 -c "import sys,json; c=json.load(sys.stdin)['catalog']; pt=[x for x in c if x['capability']['id']=='plugin.pinchtab'][0]; print(pt['health']['state'], pt['health']['message'])"
```

Expected output: `degraded PinchTab server is not reachable. ...`

If the command fails (Python not available), use:

```bash
curl -s http://localhost:3001/api/capabilities | grep -A 5 '"plugin.pinchtab"'
```

- [ ] **Step 4.3: Start PinchTab**

In a third terminal:

```bash
pinchtab server
```

If PinchTab is not installed:

```bash
npm install -g pinchtab
pinchtab server
```

- [ ] **Step 4.4: Verify health = connected**

Wait 2–3 seconds, then:

```bash
curl -s http://localhost:3001/api/capabilities | \
  python3 -c "import sys,json; c=json.load(sys.stdin)['catalog']; pt=[x for x in c if x['capability']['id']=='plugin.pinchtab'][0]; print(pt['health']['state'], pt['health']['message'])"
```

Expected output: `connected PinchTab server is reachable on localhost:9867 ...`

Note: the capability registry health is checked on each `GET /api/capabilities` request, so restarting the backend is NOT needed between steps 4.2 and 4.4.

- [ ] **Step 4.5: Verify navigate + text (with PinchTab running)**

The pinchtab.ts service functions are not exposed as HTTP endpoints in T122 (that's a future task). Verify them by running a quick inline Node script:

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2/backend"
node --input-type=module << 'EOF'
import { browserNavigate, browserText } from './src/services/pinchtab.js'
const nav = await browserNavigate('https://example.com')
console.log('navigate ok:', nav.ok, nav.error ?? '')
const txt = await browserText()
console.log('text ok:', txt.ok, txt.error ?? '')
if (txt.ok && txt.data && typeof txt.data === 'object') {
  const text = txt.data.text ?? ''
  console.log('text length:', typeof text === 'string' ? text.length : 'not a string')
}
EOF
```

Expected:
```
navigate ok: true
text ok: true
text length: <some number > 0>
```

If PinchTab's `/health` is up but navigation fails with IDPI restrictions, that is expected behaviour — PinchTab defaults to blocking external URLs. Run `pinchtab nav https://example.com` from PinchTab CLI first to confirm it works in your environment.

- [ ] **Step 4.6: Verify Dashboard Capabilities view**

Open `http://localhost:3000` → navigate to `Capabilities` view.

Expected:
- `PinchTab Browser Control` card visible
- Health badge shows green `Connected` (PinchTab running) or amber `Offline` (PinchTab stopped)
- Tags: `browser`, `automation`, `scraping`, `qa`
- Assignments: Company Runtime, Personal Runtime, Dev Team, Ops Team

---

## Task 5: Update documentation

**Files:**
- Modify: `docs/PROJECT_TRACKING.md`
- Modify: `docs/MCP_SETUP.md`

- [ ] **Step 5.1: Mark T122 done in `PROJECT_TRACKING.md`**

In `docs/PROJECT_TRACKING.md`, find the Fase 2 table (around line 153):

```markdown
| T122 | PinchTab integration — browser control capability | 2 | ⬜ Todo | Server Go standalone, MCP plugin, registrato come capability |
```

Change to:

```markdown
| T122 | PinchTab integration — browser control capability | 2 | ✅ Done | plugin.pinchtab nel capability registry, HTTP client service, health check live |
```

- [ ] **Step 5.2: Add Recent Changes entry to `PROJECT_TRACKING.md`**

Find the `## Recent Changes` section (at the top of the section, before the first `###` entry). Insert a new entry **before** the existing ones:

```markdown
### 2026-03-22 — T122: PinchTab Browser Control Capability

**New:**
- `backend/src/services/pinchtab.ts`: HTTP client for PinchTab REST API — `isPinchTabAvailable`, `browserNavigate`, `browserSnapshot`, `browserAction`, `browserText`, `browserScreenshot`. Uses Node 22 built-in `fetch` with `AbortController` (800 ms health timeout, 30 s op timeout). Never throws — all errors returned as `{ ok: false, error }`.
- `backend/src/config/capabilities.ts`: `PINCHTAB_CAPABILITY_ID = 'plugin.pinchtab'`
- `backend/src/services/capabilities.ts`: `plugin.pinchtab` registered in the capability catalog with live health check (`isPinchTabAvailable()` at registry build time), policy, assignments (company + personal runtime, dev + ops teams), and audit.

**How to test:**
1. Start backend without PinchTab → `GET /api/capabilities` shows `plugin.pinchtab` with `state: degraded`
2. Start PinchTab (`pinchtab server` or `pinchtab daemon install`) → capability shows `state: connected`
3. Dashboard `Capabilities` view shows `PinchTab Browser Control` with correct health badge

**Next step:** T122b — expose `browserNavigate` / `browserSnapshot` / `browserAction` / `browserText` as LLM tool calls in specific agent system prompts.

```

- [ ] **Step 5.3: Add PinchTab setup section to `docs/MCP_SETUP.md`**

Append to the end of `docs/MCP_SETUP.md`:

```markdown

---

## PinchTab Browser Control

PinchTab is a standalone Go HTTP server that gives agents direct browser control (navigate, click, fill, snapshot, text extraction).

### Install

```bash
# Option 1 — npm (recommended)
npm install -g pinchtab

# Option 2 — install script
curl -fsSL https://pinchtab.com/install.sh | bash

# Option 3 — Docker
docker run -d --name pinchtab -p 127.0.0.1:9867:9867 \
  -v pinchtab-data:/data --shm-size=2g pinchtab/pinchtab
```

### Start (daemon — recommended for daily use)

```bash
pinchtab daemon install   # installs and starts background daemon
```

Or manually:

```bash
pinchtab server   # foreground, port 9867
```

### Optional `.env`

```env
PINCHTAB_BASE_URL=http://127.0.0.1:9867   # default
PINCHTAB_TOKEN=                            # only if PinchTab token auth is enabled
```

### Verify

```bash
curl http://localhost:9867/health
# → {"status":"ok",...}
```

After PinchTab is running, the WAI capability `plugin.pinchtab` will show `state: connected` in `GET /api/capabilities` and the `Capabilities` dashboard view.

### Security note

PinchTab defaults to `loopback only` and restricts navigation to locally hosted URLs (IDPI). To allow external URLs, update the PinchTab config or use the `--allow` flag. Never expose port 9867 beyond localhost.
```

- [ ] **Step 5.4: Run typecheck one final time**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2/backend" && pnpm typecheck
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2/dashboard" && pnpm typecheck
```

Both expected: zero errors.

- [ ] **Step 5.5: Commit all docs**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2"
git add docs/PROJECT_TRACKING.md docs/MCP_SETUP.md
git commit -m "docs(T122): update PROJECT_TRACKING and MCP_SETUP for PinchTab integration"
```

---

## Done

T122 is complete when:

- [ ] `pnpm typecheck` passes on both backend and dashboard
- [ ] `GET /api/capabilities` returns `plugin.pinchtab` with `state: connected` when PinchTab is running
- [ ] `GET /api/capabilities` returns `plugin.pinchtab` with `state: degraded` and responds within 2 s when PinchTab is not running
- [ ] Dashboard `Capabilities` view shows the new capability with correct health badge
- [ ] `docs/PROJECT_TRACKING.md` marks T122 done
