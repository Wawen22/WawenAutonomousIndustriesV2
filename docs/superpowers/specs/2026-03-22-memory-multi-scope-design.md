# WAI Memory — Multi-Scope Architecture Design

**Date:** 2026-03-22
**Status:** Approved (v2 — post spec-review)
**Scope:** T120 — Memory v2: multi-scope, tiered recall, intelligent auto-capture
**Replaces:** flat per-agent memory (T114)

---

## Problem Statement

The current memory system (T114) has three critical deficiencies:

1. **No project/client scope.** All memories are keyed only by `agent_id`. An agent working on project A recalls memories from project B, C, and D — irrelevant noise injected into every prompt.

2. **Verbose auto-capture.** Every `runAgent` call with a `taskId` stores the entire run output (up to 2,400 chars) as a "general" memory. These noisy blobs are then recalled and injected as context — high token cost, low signal.

3. **Learning only on explicit feedback.** The `memory_learning.ts` system only triggers when the founder approves/rejects a task. Most project and client knowledge is never captured.

**Impact:** inflated LLM costs, agents that lack relevant project context, agents that recall irrelevant context from other projects.

---

## Design Goals

1. Agents always have the right context for **the specific project and client** they're working on.
2. LLM token cost per run is **reduced**, not increased, despite richer context.
3. The founder can **tell WAI things** about a client/project in natural language and they're remembered.
4. The change is **backward-compatible**: existing agent code continues to work; context just gets better.

---

## Architecture Decision

### Memory Scopes

Three orthogonal scopes, each with a clear responsibility:

| Scope | Key | Purpose | TTL |
|-------|-----|---------|-----|
| `agent` | `agent_id` | HOW an agent works — style, technical preferences | 90 days |
| `project` | `project_id` | WHAT a project is — decisions, stack, constraints | No TTL (persists until deleted) |
| `client` | `client_id` | WHO a client is — preferences, billing, communication style | No TTL |

### Memory Types (entity_type)

| Type | Scope | Example | Saved by |
|------|-------|---------|---------|
| `preference` | agent | "Use vanilla CSS, never Tailwind" | memory_learning.ts (feedback) |
| `project_fact` | project | "Uses React 18 + Vite, deployed on Vercel" | Auto-extraction at milestone |
| `client_fact` | client | "Wawen22 prefers quarterly billing, Italian reports" | CEO Intake extraction |
| `task_outcome` | project | "Task abc123: implemented auth flow with JWT + refresh tokens" | Milestone extraction (compact) |

### What is NOT built

- Pluggable memory provider adapters (mem0, MemOS, etc.) — V3
- Episodic vs. semantic distinction at storage level — not needed yet
- `browse()` / `sync()` / `profile()` capabilities — V3
- Per-run memory for every internal agent call — see Tiered Recall

---

## DB Migration (009_memory_scopes.sql)

### Schema changes

```sql
-- 1. Add sentinel agent for system-level memories (project/client scope)
-- This must be inserted before the FK constraint is enforced.
INSERT INTO agents (id, name, description)
VALUES ('_system', 'System', 'Sentinel agent for project- and client-scoped memories')
ON CONFLICT (id) DO NOTHING;

-- 2. Extend agent_memories
ALTER TABLE agent_memories
  ADD COLUMN scope TEXT NOT NULL DEFAULT 'agent'
    CHECK (scope IN ('agent', 'project', 'client')),
  ADD COLUMN project_id UUID REFERENCES projects(id)  ON DELETE CASCADE,
  ADD COLUMN client_id  UUID REFERENCES clients(id)   ON DELETE CASCADE;

CREATE INDEX idx_agent_memories_project ON agent_memories(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_agent_memories_client  ON agent_memories(client_id)  WHERE client_id  IS NOT NULL;
```

### Why the sentinel agent

The existing schema has `agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE`. Project-scoped and client-scoped memories do not belong to a specific agent. Rather than make `agent_id` nullable (wide ripple effects), we use a sentinel value `'_system'` inserted into the `agents` table. This satisfies the FK, is stable across deployments, and is explicitly named to avoid confusion.

All `project_fact`, `client_fact`, and `task_outcome` memories are stored with `agent_id = '_system'`.

### Deduplication note

The existing `match_agent_memories` RPC filters by `p_agent_id`. For project/client-scoped memories, the dedup check in `createAgentMemory` will call this RPC with `agent_id = '_system'`, which correctly deduplicates across all agents writing facts about the same project or client. This is the correct behavior — if Agent A and Agent B both try to save "uses React", only the first one is stored.

**The `match_agent_memories` RPC does not need modification** because:
- `getProjectMemories` uses a direct table query, not the RPC
- The RPC is only called in dedup paths and `recallAgentMemories` (agent-scope preferences), where filtering by `agent_id` is still correct

### Existing data

Existing rows: `scope = 'agent'` (default), `project_id = NULL`, `client_id = NULL` — fully backward-compatible. Existing `general` memories will continue to be recalled during the fallback path until their TTLs expire (30-day TTL on all current rows). No backfill needed.

---

## Service Changes

### `memory.ts`

#### `CreateAgentMemoryInput` — new optional fields

```typescript
interface CreateAgentMemoryInput {
  agentId: string
  content: string
  entityType?: string
  ttl?: string
  projectId?: string   // NEW
  clientId?: string    // NEW
}
```

**Scope auto-detection rule:**
- `projectId` set → `scope = 'project'`, `agent_id = '_system'`
- `clientId` set AND `projectId` not set → `scope = 'client'`, `agent_id = '_system'`
- neither set → `scope = 'agent'`, `agent_id = input.agentId`
- both `projectId` AND `clientId` set → `scope = 'project'` wins (project is already linked to client via FK in projects table); `clientId` still stored for indexing

#### New function: `getProjectMemories`

```typescript
async function getProjectMemories(
  projectId: string,
  clientId?: string
): Promise<AgentMemory[]>
```

- Direct table query (no vector search, no RPC)
- Fetches all `project_fact` and `task_outcome` rows for `project_id = projectId`
- If `clientId` provided, also fetches all `client_fact` rows for `client_id = clientId`
- Applies `isActiveMemory` TTL filter (for future-proofing if TTLs are ever set on these types)
- No limit — structured facts are compact by design (max ~200 chars each)
- Returns ordered by `created_at DESC`

### `llm.ts` — `RunOptions` and tiered recall

```typescript
interface RunOptions {
  // existing fields unchanged...
  projectId?: string   // NEW — scopes memory recall to project
  clientId?: string    // NEW — scopes memory recall to client
}
```

`injectMemoryRecall` is renamed to `injectScopedMemory` internally. Logic:

```
IF projectId or clientId present:
  1. getProjectMemories(projectId, clientId)  → inject as "Project/Client Context" block
  2. recallAgentMemories(agentId, query, 'preference', 5) → inject as "Your Preferences"
  3. NO general memory recall
  Estimated injected tokens: ~200–350
ELSE (fallback, backward-compatible):
  1. recallAgentMemories(agentId, query, 'general', 3) → inject (drains naturally as TTLs expire)
  2. recallAgentMemories(agentId, query, 'preference', 5) → inject
  Note: general memories will naturally drain as 30-day TTLs expire. No explicit cleanup needed.
  Estimated injected tokens: ~400–800 (current behavior)
```

**Token measurement:** the injected system message character count is logged at `debug` level so it can be monitored via backend logs. Target: ≤ 1,400 characters (≈ 350 tokens at ~4 chars/token) for the project/client path.

### `memory_learning.ts` — milestone extraction

A new exported function `extractAndSaveProjectFacts(task, output)`:

- Called non-blocking (`void extractAndSaveProjectFacts(...).catch(...)`) after task reaches `completed` status
- Uses a cheap model (nemotron or equivalent) with a tight prompt:
  - Input: task title + first 1,000 chars of output
  - Output: JSON array of max 3 compact facts (each ≤ 200 chars)
  - Example output: `["Stack: React 18 + Vite + TypeScript strict", "Deploy: Vercel, auto-deploy enabled", "Auth: JWT + refresh tokens via Supabase Auth"]`
- Each fact saved as `project_fact` with `projectId` from the task, `agent_id = '_system'`
- Called from wherever task status is set to `completed` (ceo_intake.ts task approval flow)

### CEO Intake — client/project fact extraction

When the CEO Intake receives free-text from the founder, after the normal intent classification and command execution, a lightweight background extraction runs if any `client_slug` or `project_slug` is mentioned.

**Approach:** rule-based first, LLM second.

1. If the message mentions a known client slug or project slug (from `clientContext` already in scope), run a cheap extraction prompt:
   - "Extract any persistent facts about the client or project from this message. Return JSON: `{ clientFacts: string[], projectFacts: string[] }`. If none, return empty arrays."
   - Model: nemotron or cheap equivalent
2. Resolved `client_id` and `project_id` come from the already-loaded `clientContext`
3. Non-blocking: `void extractAndSaveCeoFacts(...).catch(logMemoryWarning)` — never blocks Telegram reply

**Edge cases:**
- Ambiguous facts (e.g., "test1 ha un cliente difficile") → saved as `project_fact` on test1, not as `client_fact` (project context wins when ambiguous)
- Extraction fails → silently swallowed, logged at `warn` — Telegram reply is never affected
- No client/project slug recognized → extraction skipped entirely (avoids wasted LLM call)

---

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/009_memory_scopes.sql` | New migration — sentinel agent, scope/project_id/client_id columns, indexes |
| `backend/src/services/memory.ts` | Scope-aware create/recall/get; new `getProjectMemories` |
| `backend/src/services/llm.ts` | Tiered recall (`injectScopedMemory`), projectId/clientId in RunOptions |
| `backend/src/services/memory_learning.ts` | `extractAndSaveProjectFacts` at task completion milestone |
| `backend/src/agents/ceo_intake.ts` | Non-blocking client/project fact extraction; pass projectId/clientId to runAgent where task context available |
| `backend/src/agents/ceo.ts` | Pass projectId/clientId to runAgent |
| `backend/src/agents/architect.ts` | Pass projectId/clientId to runAgent |
| `backend/src/agents/dev_general.ts` | Pass projectId/clientId to runAgent |
| `backend/src/agents/qa.ts` | Pass projectId/clientId to runAgent |
| `backend/src/types/index.ts` | AgentMemory: add scope, project_id, client_id |
| `dashboard/src/types/index.ts` | AgentMemory: add scope, project_id, client_id |
| `docs/SUPABASE_SCHEMA.md` | Update memory schema section |
| `docs/PROJECT_TRACKING.md` | Mark T120 done when complete |

**Note on `software_delivery_utils.ts`:** if it calls `runAgent` directly, it should also be updated. Verify during implementation.

---

## What Stays The Same

- `recallAgentMemories` (semantic vector search) — unchanged, still used for preferences
- `formatMemoriesForPrompt` / `formatPreferencesForPrompt` — unchanged
- `processFeedbackLearning` — unchanged, still fires on founder feedback
- All agent logic — unchanged, they just receive better context
- MemoryView dashboard — already supports entity_type and scope filters

---

## Success Criteria

1. An agent working on project `test1` never recalls memories from `wawen22-site`
2. "Wawen22 vuole fatturazione trimestrale" → persisted as `client_fact`, visible in MemoryView filtered by entity_type = client_fact
3. Injected memory system message is ≤ 1,400 characters per run on the project/client path (verifiable via backend debug logs)
4. After a task completes, a compact `task_outcome` appears in MemoryView for that project within 30 seconds
5. `pnpm typecheck` passes on both backend and dashboard
6. Backend restarts clean, no FK violations on memory insert

---

## Out of Scope (V3)

- Pluggable memory providers
- Cross-client knowledge transfer
- Memory "forgetting" policies beyond TTL
- Dashboard UI for per-project memory management (MemoryView with filters already covers this)
