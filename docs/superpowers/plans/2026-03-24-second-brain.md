# T123 Second Brain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal knowledge base (Second Brain) for Neb — ingest notes/URLs/files, search semantically, access from Telegram and Dashboard.

**Architecture:** New `knowledge_items` Supabase table with vector(1536) embeddings. Embeddings use LiteLLM `text-embedding-3-small` with local FNV hash fallback. New `knowledge.ts` service consumed by 4 API routes, CEO Intake shortcuts, a `SecondBrainPanel` dashboard component, and a lightweight daily brief integration.

**Tech Stack:** TypeScript (Node 22), Supabase pgvector, LiteLLM embeddings API, React 18 + Vite, existing `scraper.ts` for URL ingestion.

---

## File Map

| Status | File | Change |
|--------|------|--------|
| Create | `supabase/migrations/010_knowledge_items.sql` | New table + RPC |
| Modify | `backend/src/types/index.ts` | Add `KnowledgeItem`, `KnowledgeItemMatch` |
| Create | `backend/src/services/knowledge.ts` | Full knowledge service |
| Modify | `backend/src/config/capabilities.ts` | Add `SECOND_BRAIN_CAPABILITY_ID` |
| Modify | `backend/src/services/capabilities.ts` | Register `personal.second_brain` capability |
| Modify | `backend/src/index.ts` | Add 4 API routes + DELETE to CORS |
| Modify | `backend/src/agents/ceo_intake.ts` | Brain shortcuts + executeAction cases + system prompt |
| Modify | `dashboard/src/types/index.ts` | Add `KnowledgeItem`, `KnowledgeItemMatch` |
| Create | `dashboard/src/components/SecondBrainPanel.tsx` | New dashboard panel |
| Modify | `dashboard/src/components/PersonalHQView.tsx` | Add `brain` tab |
| Modify | `backend/src/agents/ceo_intake.ts` | `buildFounderDailyBriefReport` — add Second Brain section |
| Modify | `docs/SUPABASE_SCHEMA.md` | Document knowledge_items table |
| Modify | `docs/PROJECT_TRACKING.md` | T123 → Done, add Recent Changes |

---

## Task 1: Supabase Migration

**Files:**
- Create: `supabase/migrations/010_knowledge_items.sql`

- [ ] **Step 1: Create migration file**

```sql
-- ============================================================
-- WAI – Migration 010: knowledge_items (T123 Second Brain)
-- Personal knowledge base with pgvector semantic search.
-- ============================================================

CREATE TABLE IF NOT EXISTS knowledge_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_slug  text        NOT NULL DEFAULT 'neb',
  title       text        NOT NULL,
  content     text        NOT NULL,
  source_type text        NOT NULL CHECK (source_type IN ('note', 'url', 'file')),
  source_url  text,
  tags        text[]      NOT NULL DEFAULT '{}',
  embedding   vector(1536) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_owner
  ON knowledge_items(owner_slug);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_created
  ON knowledge_items(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_embedding
  ON knowledge_items USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

CREATE OR REPLACE FUNCTION match_knowledge_items(
  p_owner_slug   text,
  p_query_embedding text,
  p_match_count  int     DEFAULT 5,
  p_min_similarity float DEFAULT 0.3
)
RETURNS TABLE (
  id          uuid,
  owner_slug  text,
  title       text,
  content     text,
  source_type text,
  source_url  text,
  tags        text[],
  created_at  timestamptz,
  similarity  double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    ki.id,
    ki.owner_slug,
    ki.title,
    ki.content,
    ki.source_type,
    ki.source_url,
    ki.tags,
    ki.created_at,
    1 - (ki.embedding <=> (p_query_embedding)::vector(1536)) AS similarity
  FROM knowledge_items ki
  WHERE
    ki.owner_slug = p_owner_slug
    AND 1 - (ki.embedding <=> (p_query_embedding)::vector(1536)) >= p_min_similarity
  ORDER BY ki.embedding <=> (p_query_embedding)::vector(1536)
  LIMIT GREATEST(p_match_count, 1)
$$;

ALTER TABLE knowledge_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_knowledge_items" ON knowledge_items
  FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_select_knowledge_items" ON knowledge_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "service_role_all_knowledge_items" ON knowledge_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Apply migration to Supabase**

Open Supabase dashboard → SQL Editor → paste and run the migration.
OR if using Supabase CLI: `supabase db push`

Verify: `SELECT count(*) FROM knowledge_items;` → returns `0`
Verify RPC exists: `SELECT proname FROM pg_proc WHERE proname = 'match_knowledge_items';`

- [ ] **Step 3: Commit migration**

```bash
git add supabase/migrations/010_knowledge_items.sql
git commit -m "feat(T123): add knowledge_items table with pgvector 1536-dim and match RPC"
```

---

## Task 2: Backend Types

**Files:**
- Modify: `backend/src/types/index.ts`

- [ ] **Step 1: Add KnowledgeItem types to backend/src/types/index.ts**

Find the `AgentMemory` interface block and add after it:

```typescript
// --- Knowledge Items (Second Brain) ---

export type KnowledgeSourceType = 'note' | 'url' | 'file'

export interface KnowledgeItem {
  id: string
  owner_slug: string
  title: string
  content: string
  source_type: KnowledgeSourceType
  source_url: string | null
  tags: string[]
  created_at: string
  updated_at: string
}

export interface KnowledgeItemMatch extends KnowledgeItem {
  similarity: number
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd backend && pnpm typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/types/index.ts
git commit -m "feat(T123): add KnowledgeItem and KnowledgeItemMatch types"
```

---

## Task 3: Knowledge Service

**Files:**
- Create: `backend/src/services/knowledge.ts`

The service uses LiteLLM `/embeddings` endpoint first, falls back to a local 1536-dim FNV hash if LiteLLM fails. The hash function is identical to `memory.ts` but with `KNOWLEDGE_VECTOR_DIM = 1536`.

- [ ] **Step 1: Create backend/src/services/knowledge.ts**

```typescript
// ============================================================
// WAI – Knowledge Service (T123 Second Brain)
// Personal knowledge base: ingest notes/URLs/files, search semantically.
// Embeddings: LiteLLM text-embedding-3-small (1536-dim) with local hash fallback.
// ============================================================

import { readFile } from 'node:fs/promises'
import { getSupabaseClient } from './supabase.js'
import { scrapeUrl } from './scraper.js'
import { log } from './logger.js'
import type { KnowledgeItem, KnowledgeItemMatch, KnowledgeSourceType } from '../types/index.js'

const KNOWLEDGE_VECTOR_DIM = 1536
const DEFAULT_SEARCH_LIMIT = 5
const DEFAULT_MIN_SIMILARITY = 0.3
const DEDUP_SIMILARITY_THRESHOLD = 0.88
const MAX_CONTENT_CHARS = 12_000
const MAX_TITLE_CHARS = 200

// ---------------------------------------------------------------------------
// Embedding: LiteLLM first, local hash fallback
// ---------------------------------------------------------------------------

function truncateText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`
}

function hashToken(token: string): number {
  let hash = 2166136261
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function tokenize(text: string): string[] {
  const base = text.toLowerCase().match(/[a-z0-9][a-z0-9._/-]{1,}/g) ?? []
  const bigrams: string[] = []
  for (let i = 0; i < base.length - 1; i += 1) {
    bigrams.push(`${base[i]}__${base[i + 1]}`)
  }
  return [...base, ...bigrams]
}

function createLocalHashEmbedding(text: string): number[] {
  const vector = Array.from({ length: KNOWLEDGE_VECTOR_DIM }, () => 0)
  for (const token of tokenize(text)) {
    const hash = hashToken(token)
    const index = hash % KNOWLEDGE_VECTOR_DIM
    const sign = ((hash >>> 8) & 1) === 0 ? 1 : -1
    const weight = token.includes('__') ? 1.35 : Math.min(2.2, 1 + token.length / 18)
    vector[index] = (vector[index] ?? 0) + sign * weight
  }
  let squaredNorm = 0
  for (const v of vector) squaredNorm += v * v
  const norm = Math.sqrt(squaredNorm) || 1
  return vector.map((v) => Number((v / norm).toFixed(6)))
}

interface LiteLLMEmbeddingResponse {
  data: Array<{ embedding: number[] }>
}

async function createKnowledgeEmbedding(text: string): Promise<number[]> {
  const baseUrl = process.env['LITELLM_BASE_URL']
  const apiKey = process.env['LITELLM_API_KEY']

  if (baseUrl && apiKey) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => { controller.abort() }, 10_000)

      const response = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: truncateText(text, 8_000),
        }),
        signal: controller.signal,
      })

      clearTimeout(timeout)

      if (response.ok) {
        const data = await response.json() as LiteLLMEmbeddingResponse
        const embedding = data?.data?.[0]?.embedding
        if (Array.isArray(embedding) && embedding.length === KNOWLEDGE_VECTOR_DIM) {
          return embedding
        }
      }
    } catch (err) {
      log.warn({ err }, 'Knowledge: LiteLLM embedding failed — using local hash fallback')
    }
  }

  log.debug('Knowledge: using local hash embedding (LiteLLM unavailable or misconfigured)')
  return createLocalHashEmbedding(text)
}

function vectorToSqlLiteral(values: number[]): string {
  return `[${values.map((v) => v.toFixed(6)).join(',')}]`
}

// ---------------------------------------------------------------------------
// Title extraction
// ---------------------------------------------------------------------------

function extractTitle(content: string, fallback: string): string {
  const firstLine = content.split('\n').find((l) => l.trim().length > 0) ?? fallback
  return truncateText(firstLine.replace(/^#+\s*/, ''), MAX_TITLE_CHARS)
}

// ---------------------------------------------------------------------------
// Core ingest
// ---------------------------------------------------------------------------

export interface IngestKnowledgeInput {
  ownerSlug?: string
  title?: string
  content: string
  sourceType: KnowledgeSourceType
  sourceUrl?: string
  tags?: string[]
}

export async function ingestKnowledgeItem(input: IngestKnowledgeInput): Promise<KnowledgeItem | null> {
  const ownerSlug = input.ownerSlug ?? 'neb'
  const content = truncateText(input.content, MAX_CONTENT_CHARS)
  if (content.length < 10) return null

  const title = input.title
    ? truncateText(input.title, MAX_TITLE_CHARS)
    : extractTitle(content, input.sourceUrl ?? input.sourceType)

  const embedding = await createKnowledgeEmbedding(content)
  const embeddingLiteral = vectorToSqlLiteral(embedding)

  // Deduplication: skip if very similar item already exists for this owner
  const { data: existingMatches, error: recallErr } = await getSupabaseClient().rpc('match_knowledge_items', {
    p_owner_slug: ownerSlug,
    p_query_embedding: embeddingLiteral,
    p_match_count: 1,
    p_min_similarity: DEDUP_SIMILARITY_THRESHOLD,
  })

  if (!recallErr && Array.isArray(existingMatches) && existingMatches.length > 0) {
    log.info({ title, ownerSlug }, 'Knowledge: near-duplicate detected — skipping insert')
    return null
  }

  const { data, error } = await getSupabaseClient()
    .from('knowledge_items')
    .insert({
      owner_slug: ownerSlug,
      title,
      content,
      source_type: input.sourceType,
      source_url: input.sourceUrl ?? null,
      tags: input.tags ?? [],
      embedding: embeddingLiteral,
    })
    .select('id, owner_slug, title, content, source_type, source_url, tags, created_at, updated_at')
    .single()

  if (error) throw new Error(`Failed to ingest knowledge item: ${error.message}`)
  return (data ?? null) as KnowledgeItem | null
}

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

export async function ingestNote(
  ownerSlug: string,
  text: string,
  tags?: string[],
): Promise<KnowledgeItem | null> {
  return ingestKnowledgeItem({ ownerSlug, content: text, sourceType: 'note', tags })
}

export async function ingestUrl(
  ownerSlug: string,
  url: string,
  tags?: string[],
): Promise<KnowledgeItem | null> {
  const result = await scrapeUrl(url)
  if (!result.ok || !result.markdown) {
    throw new Error(result.error ?? `Failed to scrape ${url}`)
  }
  const title = result.title ?? url
  const content = result.markdown
  return ingestKnowledgeItem({ ownerSlug, title, content, sourceType: 'url', sourceUrl: url, tags })
}

export async function ingestFile(
  ownerSlug: string,
  filePath: string,
  tags?: string[],
): Promise<KnowledgeItem | null> {
  const raw = await readFile(filePath, 'utf-8')
  const filename = filePath.split('/').pop() ?? filePath
  return ingestKnowledgeItem({
    ownerSlug,
    title: filename,
    content: raw,
    sourceType: 'file',
    tags,
  })
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export async function searchKnowledge(
  ownerSlug: string,
  query: string,
  limit = DEFAULT_SEARCH_LIMIT,
  minSimilarity = DEFAULT_MIN_SIMILARITY,
): Promise<KnowledgeItemMatch[]> {
  if (query.trim().length < 3) return []

  const embedding = await createKnowledgeEmbedding(query)
  const embeddingLiteral = vectorToSqlLiteral(embedding)

  const { data, error } = await getSupabaseClient().rpc('match_knowledge_items', {
    p_owner_slug: ownerSlug,
    p_query_embedding: embeddingLiteral,
    p_match_count: limit,
    p_min_similarity: minSimilarity,
  })

  if (error) throw new Error(`Failed to search knowledge: ${error.message}`)
  return (data ?? []) as KnowledgeItemMatch[]
}

// ---------------------------------------------------------------------------
// List & Delete
// ---------------------------------------------------------------------------

export interface ListKnowledgeOptions {
  limit?: number
  offset?: number
}

export async function listKnowledgeItems(
  ownerSlug: string,
  options: ListKnowledgeOptions = {},
): Promise<KnowledgeItem[]> {
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0

  const { data, error } = await getSupabaseClient()
    .from('knowledge_items')
    .select('id, owner_slug, title, content, source_type, source_url, tags, created_at, updated_at')
    .eq('owner_slug', ownerSlug)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) throw new Error(`Failed to list knowledge items: ${error.message}`)
  return (data ?? []) as KnowledgeItem[]
}

export async function deleteKnowledgeItem(id: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('knowledge_items')
    .delete()
    .eq('id', id)
  if (error) throw new Error(`Failed to delete knowledge item: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Health check (for capability registry)
// ---------------------------------------------------------------------------

export async function checkSecondBrainHealth(): Promise<{ ok: boolean; error?: string; embeddingMode: 'llm' | 'hash' }> {
  // Check table accessibility
  const { error: tableError } = await getSupabaseClient()
    .from('knowledge_items')
    .select('id')
    .limit(1)

  if (tableError) {
    return { ok: false, error: tableError.message, embeddingMode: 'hash' }
  }

  // Check LiteLLM embedding availability
  const baseUrl = process.env['LITELLM_BASE_URL']
  const apiKey = process.env['LITELLM_API_KEY']
  let embeddingMode: 'llm' | 'hash' = 'hash'

  if (baseUrl && apiKey) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => { controller.abort() }, 5_000)
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: 'health check' }),
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (response.ok) embeddingMode = 'llm'
    } catch {
      // fallback to hash
    }
  }

  return { ok: true, embeddingMode }
}

export async function getKnowledgeItemCount(ownerSlug: string): Promise<number> {
  const { count, error } = await getSupabaseClient()
    .from('knowledge_items')
    .select('id', { count: 'exact', head: true })
    .eq('owner_slug', ownerSlug)

  if (error) return 0
  return count ?? 0
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd backend && pnpm typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/knowledge.ts
git commit -m "feat(T123): add knowledge service with LiteLLM embeddings + hash fallback"
```

---

## Task 4: Capability Registration

**Files:**
- Modify: `backend/src/config/capabilities.ts`
- Modify: `backend/src/services/capabilities.ts`

- [ ] **Step 1: Add constant to backend/src/config/capabilities.ts**

Add after `DOCUMENT_GENERATION_CAPABILITY_ID`:

```typescript
export const SECOND_BRAIN_CAPABILITY_ID = 'personal.second_brain'
```

- [ ] **Step 2: Add imports + capability entry in backend/src/services/capabilities.ts**

At top of file, add to imports:
```typescript
import { checkSecondBrainHealth, getKnowledgeItemCount } from './knowledge.js'
import { SECOND_BRAIN_CAPABILITY_ID } from '../config/capabilities.js'
```

In `getCapabilityRegistrySnapshot`, extend the `Promise.all` array to also resolve the Second Brain health and item count. Change:

```typescript
const [mcpBridgeStatus, googleWorkspaceRuntime, automationStatus, recentEvents, pinchTabAvailable, playwrightBrowserAvailable] = await Promise.all([
  getMcpBridgeStatus(),
  getGoogleWorkspaceMcpRuntimeStatus(DEFAULT_OWNER_SLUG),
  getPersonalAutomationStatus(DEFAULT_OWNER_SLUG),
  getCapabilityEvents({ limit: 200 }),
  isPinchTabAvailable(),
  Promise.resolve(isPlaywrightBrowserAvailable()),
])
```

To:

```typescript
const [mcpBridgeStatus, googleWorkspaceRuntime, automationStatus, recentEvents, pinchTabAvailable, playwrightBrowserAvailable, secondBrainHealth, secondBrainCount] = await Promise.all([
  getMcpBridgeStatus(),
  getGoogleWorkspaceMcpRuntimeStatus(DEFAULT_OWNER_SLUG),
  getPersonalAutomationStatus(DEFAULT_OWNER_SLUG),
  getCapabilityEvents({ limit: 200 }),
  isPinchTabAvailable(),
  Promise.resolve(isPlaywrightBrowserAvailable()),
  checkSecondBrainHealth().catch(() => ({ ok: false as const, error: 'health check failed', embeddingMode: 'hash' as const })),
  getKnowledgeItemCount('neb').catch(() => 0),
])
```

Then add the Second Brain capability entry at the end of `catalogBase`, just before the closing `]`, following the exact same pattern as `tool.document_generation`:

```typescript
{
  capability: baseCapability({
    id: SECOND_BRAIN_CAPABILITY_ID,
    type: 'memory_provider',
    label: 'Second Brain',
    description: 'Personal knowledge base for ingesting notes, URLs, and files with semantic search via pgvector.',
    owner: DEFAULT_OWNER_SLUG,
    runtimeTarget: 'personal',
    riskLevel: 'low',
    tags: ['knowledge', 'memory', 'search', 'personal'],
    usageInstructions: 'From Telegram: "ricorda: <text>", "salva url <url>", "cosa so su <query>". From Dashboard: Personal HQ → Second Brain tab.',
    examples: [
      'ricorda: la riunione con Acme è ogni giovedì mattina',
      'salva url https://example.com/article',
      'cosa so su competitor pricing?',
    ],
  }),
  assignments: [
    runtimeAssignment(SECOND_BRAIN_CAPABILITY_ID, 'personal', 'Personal Runtime (neb)', 'personal'),
    agentAssignment(SECOND_BRAIN_CAPABILITY_ID, 'ceo', 'personal'),
  ],
  policy: basePolicy({
    capabilityId: SECOND_BRAIN_CAPABILITY_ID,
    mode: 'open',
    notes: 'Personal knowledge base — accessible only to neb runtime.',
  }),
  health: baseHealth({
    capabilityId: SECOND_BRAIN_CAPABILITY_ID,
    state: !secondBrainHealth.ok ? 'error' : secondBrainHealth.embeddingMode === 'llm' ? 'connected' : 'degraded',
    label: !secondBrainHealth.ok ? 'DB Error' : secondBrainHealth.embeddingMode === 'llm' ? 'Connected' : 'Hash Fallback',
    message: !secondBrainHealth.ok
      ? `DB error: ${secondBrainHealth.error ?? 'unknown'}`
      : secondBrainHealth.embeddingMode === 'llm'
        ? `LLM semantic embeddings active (text-embedding-3-small). Items: ${String(secondBrainCount)}.`
        : `Local hash embeddings active (LiteLLM unavailable). Items: ${String(secondBrainCount)}.`,
    checkedAt: generatedAt,
    freshness: 'fresh',
    reasonCode: !secondBrainHealth.ok ? 'db_error' : secondBrainHealth.embeddingMode === 'llm' ? 'llm_embeddings_active' : 'hash_fallback_active',
  }),
  audit: baseAudit({
    capabilityId: SECOND_BRAIN_CAPABILITY_ID,
    summary: 'Personal knowledge base — notes, URLs, files with semantic search.',
  }),
},
```

- [ ] **Step 3: Run typecheck**

```bash
cd backend && pnpm typecheck
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add backend/src/config/capabilities.ts backend/src/services/capabilities.ts
git commit -m "feat(T123): register personal.second_brain capability with health check"
```

---

## Task 5: API Routes

**Files:**
- Modify: `backend/src/index.ts`

Add four routes and extend CORS to support DELETE method.

- [ ] **Step 1: Add DELETE to CORS header in backend/src/index.ts**

Find this line:
```typescript
res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
```

Change to:
```typescript
res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
```

- [ ] **Step 2: Add import at top of index.ts**

After `import { getAgentMemories, deleteAgentMemory, deleteAgentMemories } from './services/memory.js'`, add:

```typescript
import {
  ingestKnowledgeItem,
  ingestUrl,
  listKnowledgeItems,
  searchKnowledge,
  deleteKnowledgeItem,
} from './services/knowledge.js'
```

- [ ] **Step 3: Add four routes to index.ts**

Add the following four route handlers inside the `createServer` callback, before the final `res.writeHead(404)` fallthrough. Group them together with a comment.

**Route 1 — GET /api/personal/knowledge (list)**
```typescript
if (url.pathname === '/api/personal/knowledge' && req.method === 'GET') {
  void (async () => {
    try {
      const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200)
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10))
      const items = await listKnowledgeItems('neb', { limit, offset })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ items }))
    } catch (err) {
      log.error({ err }, 'Knowledge list API error')
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
  })()
  return
}
```

**Route 2 — GET /api/personal/knowledge/search (search)**
```typescript
if (url.pathname === '/api/personal/knowledge/search' && req.method === 'GET') {
  void (async () => {
    try {
      const query = url.searchParams.get('q') ?? ''
      const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '5', 10), 20)
      if (!query.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing q param' }))
        return
      }
      const results = await searchKnowledge('neb', query, limit)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ results }))
    } catch (err) {
      log.error({ err }, 'Knowledge search API error')
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
  })()
  return
}
```

**Route 3 — POST /api/personal/knowledge (ingest)**
```typescript
if (url.pathname === '/api/personal/knowledge' && req.method === 'POST') {
  void (async () => {
    try {
      if (!isAuthorizedDashboardRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Forbidden' }))
        return
      }
      const body = await readJsonBody(req)
      const payload = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
      const sourceType = payload['sourceType'] as string
      const tags = Array.isArray(payload['tags']) ? (payload['tags'] as unknown[]).filter((t): t is string => typeof t === 'string') : []

      let item
      if (sourceType === 'url') {
        const url_param = typeof payload['url'] === 'string' ? payload['url'] : null
        if (!url_param) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Missing url' }))
          return
        }
        item = await ingestUrl('neb', url_param, tags)
      } else {
        const content = typeof payload['content'] === 'string' ? payload['content'] : null
        if (!content) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Missing content' }))
          return
        }
        const title = typeof payload['title'] === 'string' ? payload['title'] : undefined
        item = await ingestKnowledgeItem({ ownerSlug: 'neb', content, title, sourceType: 'note', tags })
      }

      if (!item) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, duplicate: true, item: null }))
        return
      }

      res.writeHead(201, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, item }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ingest failed'
      log.error({ err }, 'Knowledge ingest API error')
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: message }))
    }
  })()
  return
}
```

**Route 4 — DELETE /api/personal/knowledge/:id**
```typescript
const knowledgeDeleteMatch = url.pathname.match(/^\/api\/personal\/knowledge\/([a-f0-9-]{36})$/)
if (knowledgeDeleteMatch && req.method === 'DELETE') {
  void (async () => {
    try {
      if (!isAuthorizedDashboardRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Forbidden' }))
        return
      }
      const id = knowledgeDeleteMatch[1]!
      await deleteKnowledgeItem(id)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Delete failed'
      log.error({ err }, 'Knowledge delete API error')
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: message }))
    }
  })()
  return
}
```

- [ ] **Step 4: Run typecheck**

```bash
cd backend && pnpm typecheck
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat(T123): add 4 knowledge API routes (list/search/ingest/delete) + DELETE CORS"
```

---

## Task 6: CEO Intake Integration

**Files:**
- Modify: `backend/src/agents/ceo_intake.ts`

Three changes: add import, add shortcuts to `detectFounderShortcutIntent`, add `brain_save` / `brain_url` / `brain_search` cases to `executeAction`, and update the system prompt action list + planning rules.

- [ ] **Step 1: Add import**

At the top of `ceo_intake.ts`, after the `createAgentMemory` import line:

```typescript
import { ingestNote, ingestUrl as ingestKnowledgeUrl, searchKnowledge } from '../services/knowledge.js'
```

- [ ] **Step 2: Add shortcuts to detectFounderShortcutIntent**

Inside `detectFounderShortcutIntent`, after the existing `// --- Read URL ---` block, add:

```typescript
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
const brainUrlMatch = text.match(/^(?:brain\s+url|salva\s+(?:url|articolo|link)|secondo\s+cervello\s+(?:url|link))[:\s]+(https?:\/\/[^\s]+)$/i)
if (brainUrlMatch?.[1]) {
  const targetUrl = brainUrlMatch[1].trim()
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
```

- [ ] **Step 3: Add cases to executeAction switch**

Inside the `executeAction` `switch (type)` block, add three new cases (place them near the bottom, before the `default` case):

```typescript
// ── brain_save ────────────────────────────────────────────────────────
case 'brain_save': {
  const text = getString(params, 'text') ?? getString(params, 'content')
  if (!text) throw new Error('Testo mancante per brain_save')
  const tags = Array.isArray(params['tags'])
    ? (params['tags'] as unknown[]).filter((t): t is string => typeof t === 'string')
    : []
  const item = await ingestNote('neb', text, tags)
  if (!item) return '🧠 Nota già presente nel Second Brain (duplicato rilevato).'
  return `🧠 Salvato nel Second Brain: *${item.title}* (id: \`${item.id.slice(0, 8)}\`)`
}

// ── brain_url ─────────────────────────────────────────────────────────
case 'brain_url': {
  const targetUrl = getString(params, 'url')
  if (!targetUrl) throw new Error('URL mancante per brain_url')
  const tags = Array.isArray(params['tags'])
    ? (params['tags'] as unknown[]).filter((t): t is string => typeof t === 'string')
    : []
  const item = await ingestKnowledgeUrl('neb', targetUrl, tags)
  if (!item) return `🧠 URL già presente nel Second Brain (duplicato rilevato): ${targetUrl}`
  return `🧠 Articolo salvato nel Second Brain: *${item.title}*\nSource: \`${targetUrl}\` (id: \`${item.id.slice(0, 8)}\`)`
}

// ── brain_search ──────────────────────────────────────────────────────
case 'brain_search': {
  const query = getString(params, 'query') ?? getString(params, 'q')
  if (!query) throw new Error('Query mancante per brain_search')
  const results = await searchKnowledge('neb', query, 5)
  if (results.length === 0) {
    return `🧠 Nessun risultato nel Second Brain per: "${query}"`
  }
  const lines = results.map((r, i) => {
    const pct = Math.round(r.similarity * 100)
    const preview = r.content.slice(0, 200).replace(/\n+/g, ' ')
    return `${i + 1}. *${r.title}* [${r.source_type}, ${pct}%]\n   ${preview}${r.content.length > 200 ? '…' : ''}`
  })
  return `🧠 *Second Brain — risultati per "${query}":*\n\n${lines.join('\n\n')}`
}
```

- [ ] **Step 4: Update system prompt actions list and planning rules**

In `buildSystemPrompt`, find the `## ACTIONS YOU CAN EXECUTE` section and add three entries:

```
- brain_save         → params: text, tags?  (salva una nota nel Second Brain personale)
- brain_url          → params: url, tags?   (scarica e salva un articolo/URL nel Second Brain)
- brain_search       → params: query        (cerca semanticamente nel Second Brain)
```

In the `## PLANNING RULES` section, add three rules at the end:

```
31. Use brain_save when Neb asks to remember, save a note, or store a fact in the Second Brain (e.g. "ricordati che...", "salva nota: ...", "brain save: ...").
32. Use brain_url when Neb asks to save a URL, article or link to the Second Brain (e.g. "salva questo articolo", "brain url https://...").
33. Use brain_search when Neb asks what he knows about a topic or asks to search the Second Brain (e.g. "cosa so su X?", "cerca nel cervello: Y", "brain search: Z").
```

- [ ] **Step 5: Run typecheck**

```bash
cd backend && pnpm typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add backend/src/agents/ceo_intake.ts
git commit -m "feat(T123): add brain_save/brain_url/brain_search to CEO Intake (shortcuts + executeAction + system prompt)"
```

---

## Task 7: Daily Brief — Second Brain Section

**Files:**
- Modify: `backend/src/agents/ceo_intake.ts`

- [ ] **Step 1: Extend buildFounderDailyBriefReport signature**

Find `function buildFounderDailyBriefReport(input: {` and add a new optional field:

```typescript
recentKnowledgeSummary?: string
```

Then in the function body, after the `## Recent Drive Activity` section, add:

```typescript
if (input.recentKnowledgeSummary) {
  sections.push('')
  sections.push('## Recent Second Brain Additions')
  sections.push('')
  sections.push(input.recentKnowledgeSummary)
}
```

- [ ] **Step 2: Populate recentKnowledgeSummary in daily_founder_brief case**

In `executeAction`, inside `case 'daily_founder_brief':`, before the `buildFounderDailyBriefReport` call, add:

```typescript
// Non-fatal: fetch recent Second Brain items for brief enrichment
let recentKnowledgeSummary: string | undefined
try {
  const recentItems = await listKnowledgeItems('neb', { limit: 3 })
  if (recentItems.length > 0) {
    const lines = recentItems.map((item) => {
      const preview = item.content.slice(0, 120).replace(/\n+/g, ' ')
      return `- **${item.title}** [${item.source_type}] — ${preview}${item.content.length > 120 ? '…' : ''}`
    })
    recentKnowledgeSummary = lines.join('\n')
  }
} catch {
  // non-fatal — brief continues without this section
}
```

Then update the `buildFounderDailyBriefReport` call to include `recentKnowledgeSummary`.

You also need to add the import for `listKnowledgeItems` to the existing `import { ingestNote, ingestUrl as ingestKnowledgeUrl, searchKnowledge } from '../services/knowledge.js'` line:

```typescript
import { ingestNote, ingestUrl as ingestKnowledgeUrl, listKnowledgeItems, searchKnowledge } from '../services/knowledge.js'
```

- [ ] **Step 3: Run typecheck**

```bash
cd backend && pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/agents/ceo_intake.ts
git commit -m "feat(T123): enrich daily brief with recent Second Brain items"
```

---

## Task 8: Dashboard Types

**Files:**
- Modify: `dashboard/src/types/index.ts`

- [ ] **Step 1: Add KnowledgeItem to dashboard types**

Add after the last interface/type in `dashboard/src/types/index.ts`:

```typescript
// --- Knowledge Items (Second Brain) ---

export type KnowledgeSourceType = 'note' | 'url' | 'file'

export interface KnowledgeItem {
  id: string
  owner_slug: string
  title: string
  content: string
  source_type: KnowledgeSourceType
  source_url: string | null
  tags: string[]
  created_at: string
  updated_at: string
}

export interface KnowledgeItemMatch extends KnowledgeItem {
  similarity: number
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd dashboard && pnpm typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/types/index.ts
git commit -m "feat(T123): add KnowledgeItem dashboard types"
```

---

## Task 9: SecondBrainPanel Component

**Files:**
- Create: `dashboard/src/components/SecondBrainPanel.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Icon } from './ui/Icon.js'
import type { KnowledgeItem, KnowledgeItemMatch } from '../types/index.js'

const BACKEND_URL = (import.meta.env['VITE_BACKEND_URL'] as string | undefined) ?? ''

type IngestTab = 'note' | 'url'

interface IngestState {
  status: 'idle' | 'loading' | 'done' | 'error' | 'duplicate'
  message?: string
}

interface SearchState {
  status: 'idle' | 'loading' | 'done' | 'error'
  results: KnowledgeItemMatch[]
  query: string
}

interface ListState {
  status: 'idle' | 'loading' | 'done' | 'error'
  items: KnowledgeItem[]
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}

function SourceBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    note: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    url: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    file: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  }
  return (
    <span className={clsx('text-xs px-2 py-0.5 rounded border font-mono', colors[type] ?? colors['note'])}>
      {type}
    </span>
  )
}

function KnowledgeItemCard({
  item,
  similarity,
  onDelete,
}: {
  item: KnowledgeItem | KnowledgeItemMatch
  similarity?: number
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const preview = item.content.slice(0, 180)
  const hasMore = item.content.length > 180

  return (
    <div className="border border-white/10 rounded-lg p-3 bg-white/5 hover:bg-white/8 transition-colors group">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <SourceBadge type={item.source_type} />
            {similarity !== undefined && (
              <span className="text-xs text-white/40 font-mono">{Math.round(similarity * 100)}%</span>
            )}
            <span className="text-xs text-white/40">{formatDate(item.created_at)}</span>
          </div>
          <p className="text-sm font-medium text-white/90 mb-1 truncate" title={item.title}>{item.title}</p>
          {item.source_url && (
            <p className="text-xs text-white/40 truncate mb-1">{item.source_url}</p>
          )}
          <p className="text-xs text-white/60 leading-relaxed">
            {expanded ? item.content : preview}
            {!expanded && hasMore && '…'}
          </p>
          {hasMore && (
            <button
              onClick={() => { setExpanded(!expanded) }}
              className="text-xs text-blue-400 hover:text-blue-300 mt-1"
            >
              {expanded ? 'Mostra meno' : 'Mostra tutto'}
            </button>
          )}
          {item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {item.tags.map((tag) => (
                <span key={tag} className="text-xs px-1.5 py-0.5 bg-white/10 rounded text-white/50">
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => { onDelete(item.id) }}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-white/40 hover:text-red-400 p-1 rounded flex-shrink-0"
          title="Elimina"
        >
          <Icon name="x" size={14} />
        </button>
      </div>
    </div>
  )
}

export function SecondBrainPanel() {
  const [activeTab, setActiveTab] = useState<IngestTab>('note')
  const [noteText, setNoteText] = useState('')
  const [urlText, setUrlText] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [ingestState, setIngestState] = useState<IngestState>({ status: 'idle' })
  const [searchQuery, setSearchQuery] = useState('')
  const [searchState, setSearchState] = useState<SearchState>({ status: 'idle', results: [], query: '' })
  const [listState, setListState] = useState<ListState>({ status: 'idle', items: [] })
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadItems = useCallback(async () => {
    setListState((s) => ({ ...s, status: 'loading' }))
    try {
      const response = await fetch(`${BACKEND_URL}/api/personal/knowledge?limit=20`)
      const data = await response.json() as { items?: KnowledgeItem[]; error?: string }
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
      setListState({ status: 'done', items: data.items ?? [] })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Load failed'
      setListState({ status: 'error', items: [] })
      console.error('Second Brain load error:', message)
    }
  }, [])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query)
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    if (!query.trim()) {
      setSearchState({ status: 'idle', results: [], query: '' })
      return
    }
    searchDebounce.current = setTimeout(async () => {
      setSearchState((s) => ({ ...s, status: 'loading', query }))
      try {
        const response = await fetch(`${BACKEND_URL}/api/personal/knowledge/search?q=${encodeURIComponent(query)}&limit=5`)
        const data = await response.json() as { results?: KnowledgeItemMatch[]; error?: string }
        if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
        setSearchState({ status: 'done', results: data.results ?? [], query })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Search failed'
        setSearchState({ status: 'error', results: [], query })
        console.error('Second Brain search error:', message)
      }
    }, 400)
  }, [])

  const handleIngest = useCallback(async () => {
    setIngestState({ status: 'loading' })
    try {
      const tags = tagsText.split(',').map((t) => t.trim()).filter(Boolean)

      let body: Record<string, unknown>
      if (activeTab === 'url') {
        if (!urlText.trim()) {
          setIngestState({ status: 'error', message: 'Inserisci un URL valido' })
          return
        }
        body = { sourceType: 'url', url: urlText.trim(), tags }
      } else {
        if (!noteText.trim()) {
          setIngestState({ status: 'error', message: 'La nota è vuota' })
          return
        }
        body = { sourceType: 'note', content: noteText.trim(), tags }
      }

      const response = await fetch(`${BACKEND_URL}/api/personal/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json() as { ok?: boolean; duplicate?: boolean; item?: KnowledgeItem; error?: string }

      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)

      if (data.duplicate) {
        setIngestState({ status: 'duplicate', message: 'Contenuto già presente nel Second Brain.' })
      } else {
        setIngestState({ status: 'done', message: `Salvato: "${data.item?.title ?? 'item'}"` })
        setNoteText('')
        setUrlText('')
        setTagsText('')
        void loadItems()
      }

      setTimeout(() => { setIngestState({ status: 'idle' }) }, 3000)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ingest failed'
      setIngestState({ status: 'error', message })
    }
  }, [activeTab, noteText, urlText, tagsText, loadItems])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await fetch(`${BACKEND_URL}/api/personal/knowledge/${id}`, { method: 'DELETE' })
      setListState((s) => ({ ...s, items: s.items.filter((item) => item.id !== id) }))
      if (searchState.results.some((r) => r.id === id)) {
        setSearchState((s) => ({ ...s, results: s.results.filter((r) => r.id !== id) }))
      }
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }, [searchState.results])

  const showingSearch = searchQuery.trim().length > 0
  const displayItems = showingSearch ? searchState.results : listState.items

  return (
    <div className="space-y-5">
      {/* Search */}
      <div>
        <div className="relative">
          <Icon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { handleSearch(e.target.value) }}
            placeholder="Cerca nel Second Brain…"
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30"
          />
          {searchState.status === 'loading' && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 text-xs">…</span>
          )}
        </div>
      </div>

      {/* Ingest panel */}
      <div className="border border-white/10 rounded-lg p-4 bg-white/3">
        <div className="flex gap-3 mb-3">
          {(['note', 'url'] as IngestTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setIngestState({ status: 'idle' }) }}
              className={clsx(
                'text-xs px-3 py-1 rounded-md border transition-colors',
                activeTab === tab
                  ? 'bg-white/15 border-white/25 text-white'
                  : 'border-white/10 text-white/50 hover:text-white/70',
              )}
            >
              {tab === 'note' ? '📝 Nota' : '🔗 URL'}
            </button>
          ))}
        </div>

        {activeTab === 'note' ? (
          <textarea
            value={noteText}
            onChange={(e) => { setNoteText(e.target.value) }}
            placeholder="Scrivi una nota da salvare nel Second Brain…"
            rows={3}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30 resize-none mb-2"
          />
        ) : (
          <input
            type="url"
            value={urlText}
            onChange={(e) => { setUrlText(e.target.value) }}
            placeholder="https://example.com/article…"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30 mb-2"
          />
        )}

        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={tagsText}
            onChange={(e) => { setTagsText(e.target.value) }}
            placeholder="tag1, tag2 (opzionale)"
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-white/30"
          />
          <button
            onClick={() => { void handleIngest() }}
            disabled={ingestState.status === 'loading'}
            className={clsx(
              'px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
              ingestState.status === 'loading'
                ? 'bg-white/10 text-white/40 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-500 text-white',
            )}
          >
            {ingestState.status === 'loading' ? 'Salvo…' : 'Salva'}
          </button>
        </div>

        {ingestState.status !== 'idle' && ingestState.status !== 'loading' && (
          <p className={clsx(
            'mt-2 text-xs',
            ingestState.status === 'done' ? 'text-emerald-400' :
            ingestState.status === 'duplicate' ? 'text-yellow-400' :
            'text-red-400'
          )}>
            {ingestState.status === 'done' && '✓ '}
            {ingestState.status === 'duplicate' && '⚠ '}
            {ingestState.status === 'error' && '✗ '}
            {ingestState.message}
          </p>
        )}
      </div>

      {/* Items list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-white/50">
            {showingSearch
              ? searchState.status === 'done'
                ? `${searchState.results.length} risultat${searchState.results.length === 1 ? 'o' : 'i'} per "${searchState.query}"`
                : 'Ricerca…'
              : listState.status === 'done'
                ? `${listState.items.length} item${listState.items.length === 1 ? '' : 's'} nel Second Brain`
                : listState.status === 'loading'
                  ? 'Caricamento…'
                  : ''}
          </p>
          {!showingSearch && (
            <button
              onClick={() => { void loadItems() }}
              className="text-xs text-white/40 hover:text-white/60 transition-colors"
            >
              ↻ Aggiorna
            </button>
          )}
        </div>

        {displayItems.length === 0 && (showingSearch ? searchState.status === 'done' : listState.status === 'done') && (
          <p className="text-sm text-white/30 text-center py-8">
            {showingSearch ? `Nessun risultato per "${searchState.query}"` : 'Nessun item nel Second Brain. Aggiungi note, URL o file.'}
          </p>
        )}

        <div className="space-y-2">
          {displayItems.map((item) => (
            <KnowledgeItemCard
              key={item.id}
              item={item}
              similarity={'similarity' in item ? item.similarity : undefined}
              onDelete={(id) => { void handleDelete(id) }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd dashboard && pnpm typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/SecondBrainPanel.tsx
git commit -m "feat(T123): add SecondBrainPanel dashboard component"
```

---

## Task 10: PersonalHQView Integration

**Files:**
- Modify: `dashboard/src/components/PersonalHQView.tsx`

- [ ] **Step 1: Add import**

At the top of `PersonalHQView.tsx`, add:

```typescript
import { SecondBrainPanel } from './SecondBrainPanel.js'
```

- [ ] **Step 2: Add 'brain' to HQTab type**

Find:
```typescript
type HQTab = 'exec' | 'automations' | 'setup' | 'profile'
```

Replace with:
```typescript
type HQTab = 'exec' | 'brain' | 'automations' | 'setup' | 'profile'
```

- [ ] **Step 3: Add tab to HQ_TABS array**

Find:
```typescript
const HQ_TABS: { id: HQTab; label: string }[] = [
  { id: 'exec', label: 'Exec' },
```

Add after `exec`:
```typescript
  { id: 'brain', label: 'Second Brain' },
```

- [ ] **Step 4: Render SecondBrainPanel in the tab content**

Find the section that renders tab content conditionally (the `{activeTab === 'exec' && ...}` block). Add:

```tsx
{activeTab === 'brain' && (
  <SecondBrainPanel />
)}
```

- [ ] **Step 5: Run typecheck + build check**

```bash
cd dashboard && pnpm typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/components/PersonalHQView.tsx
git commit -m "feat(T123): add Second Brain tab to Personal HQ"
```

---

## Task 11: Manual Testing

- [ ] **Step 1: Start the backend**

```bash
cd backend && pnpm dev
```

Verify startup log shows no errors.

- [ ] **Step 2: Test API — list (empty)**

```bash
curl http://localhost:3001/api/personal/knowledge
```

Expected: `{"items":[]}`

- [ ] **Step 3: Test API — ingest note**

```bash
curl -X POST http://localhost:3001/api/personal/knowledge \
  -H "Content-Type: application/json" \
  -d '{"sourceType":"note","content":"WAI ha generato la prima fattura reale il 18 marzo 2026, cliente Wawen22, importo $222","tags":["fatture","milestone"]}'
```

Expected: `{"ok":true,"item":{"id":"...","title":"WAI ha generato la prima fattura reale...","source_type":"note",...}}`

- [ ] **Step 4: Test API — search**

```bash
curl "http://localhost:3001/api/personal/knowledge/search?q=fattura+cliente"
```

Expected: `{"results":[{"id":"...","title":"...","similarity":0.XX,...}]}`

- [ ] **Step 5: Test capability health**

```bash
curl http://localhost:3001/api/capabilities | jq '.catalog[] | select(.capability.id == "personal.second_brain")'
```

Expected: `"state": "connected"` or `"degraded"` (if LiteLLM embedding not configured)

- [ ] **Step 6: Test Telegram shortcut (if backend connected)**

Send on Telegram: `ricordati: il cliente Acme preferisce comunicazioni via WhatsApp`

Expected: `🧠 Salvato nel Second Brain: "il cliente Acme preferisce comunicazioni via WhatsApp"`

Send: `cosa so su Acme`

Expected: results list with similarity scores

- [ ] **Step 7: Start dashboard and verify UI**

```bash
cd dashboard && pnpm dev
```

Open `http://localhost:3000` → Personal HQ → Second Brain tab.
Verify search bar, ingest form (note/url tabs), items list all render correctly.

---

## Task 12: Docs Update

**Files:**
- Modify: `docs/SUPABASE_SCHEMA.md`
- Modify: `docs/PROJECT_TRACKING.md`

- [ ] **Step 1: Add knowledge_items table to docs/SUPABASE_SCHEMA.md**

After the `agent_memories` section, add:

```markdown
### `knowledge_items`

Personal knowledge base for the Second Brain (T123). Stores notes, scraped URLs, and files with vector embeddings for semantic search.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` PK | Auto-generated |
| `owner_slug` | `text` | Owner (default `'neb'`) |
| `title` | `text` | Item title (extracted or provided) |
| `content` | `text` | Full content in markdown |
| `source_type` | `text` | `note` \| `url` \| `file` |
| `source_url` | `text?` | Source URL for `url` type items |
| `tags` | `text[]` | Optional tag list |
| `embedding` | `vector(1536)` | LLM embedding (text-embedding-3-small) or local hash fallback |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

**RLS:** `anon` + `authenticated` SELECT, `service_role` full access.

**RPC:** `match_knowledge_items(owner_slug, query_embedding, match_count, min_similarity)` — cosine similarity search.

Notes:
- No TTL — knowledge items persist indefinitely until explicitly deleted.
- Embeddings use `text-embedding-3-small` via LiteLLM when available; fallback to local FNV hash if LiteLLM is unavailable.
- Dedup threshold: 0.88 similarity — near-duplicate items are silently skipped on ingest.
```

Also update the Relationships section:

```
knowledge_items (standalone — no FK to agents/projects)
```

- [ ] **Step 2: Update docs/PROJECT_TRACKING.md**

Mark T123 as Done in Fase 3 table:

```markdown
| T123 | Second Brain — personal knowledge ingestion + search | 2 | ✅ Done | `knowledge_items` table, `knowledge.ts` service, LiteLLM embeddings + hash fallback, 4 API routes, CEO Intake shortcuts (brain_save/brain_url/brain_search), SecondBrainPanel in Personal HQ, daily brief enrichment |
```

Add a Recent Changes entry:

```markdown
### 2026-03-24 — T123: Second Brain (Personal Knowledge Base)

**New:**
- `supabase/migrations/010_knowledge_items.sql`: `knowledge_items` table with `vector(1536)`, `match_knowledge_items` RPC, RLS policies
- `backend/src/services/knowledge.ts`: full knowledge service — `ingestNote`, `ingestUrl` (via scraper), `ingestFile`, `searchKnowledge`, `listKnowledgeItems`, `deleteKnowledgeItem`, `checkSecondBrainHealth`. LiteLLM `text-embedding-3-small` embeddings with 1536-dim local FNV hash fallback. Dedup at 0.88 similarity.
- `backend/src/config/capabilities.ts`: `SECOND_BRAIN_CAPABILITY_ID = 'personal.second_brain'`
- `backend/src/services/capabilities.ts`: `personal.second_brain` capability — health shows `connected` (LLM embeddings) or `degraded` (hash fallback), item count in notes
- `backend/src/index.ts`: 4 new routes — `GET /api/personal/knowledge`, `GET /api/personal/knowledge/search`, `POST /api/personal/knowledge`, `DELETE /api/personal/knowledge/:id`. `DELETE` added to CORS allowed methods.
- `backend/src/agents/ceo_intake.ts`: 3 CEO shortcuts (`brain_save`, `brain_url`, `brain_search`), 3 executeAction cases, 3 system prompt rules (31-33), daily brief enriched with recent knowledge items
- `dashboard/src/components/SecondBrainPanel.tsx`: search bar (debounced semantic search), note/URL ingest form with tags, knowledge items list with expand/delete, source type badges
- `dashboard/src/components/PersonalHQView.tsx`: new "Second Brain" tab

**How to test:**
1. Apply migration `010_knowledge_items.sql` in Supabase SQL Editor
2. `cd backend && pnpm dev` → `curl http://localhost:3001/api/personal/knowledge` → `{"items":[]}`
3. `POST /api/personal/knowledge` with `{"sourceType":"note","content":"..."}` → returns saved item
4. `GET /api/personal/knowledge/search?q=<query>` → returns ranked results
5. Telegram: `ricordati: <testo>` → `🧠 Salvato nel Second Brain`
6. Telegram: `cosa so su <topic>` → results with similarity scores
7. Dashboard → Personal HQ → Second Brain tab → full UI

**Next step:** T124 — Personal CRM (contact tracking + follow-up automation)
```

- [ ] **Step 3: Run typecheck one final time**

```bash
cd backend && pnpm typecheck && cd ../dashboard && pnpm typecheck
```

Expected: no errors in either

- [ ] **Step 4: Final commit**

```bash
git add docs/SUPABASE_SCHEMA.md docs/PROJECT_TRACKING.md
git commit -m "docs(T123): update schema docs and project tracking for Second Brain"
```
