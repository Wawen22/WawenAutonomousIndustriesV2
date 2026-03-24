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
    bigrams.push(`${base[i] ?? ''}__${base[i + 1] ?? ''}`)
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
  return ingestKnowledgeItem({ ownerSlug, content: text, sourceType: 'note', ...(tags ? { tags } : {}) })
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
  return ingestKnowledgeItem({ ownerSlug, title, content: result.markdown, sourceType: 'url', sourceUrl: url, ...(tags ? { tags } : {}) })
}

export async function ingestFile(
  ownerSlug: string,
  filePath: string,
  tags?: string[],
): Promise<KnowledgeItem | null> {
  const raw = await readFile(filePath, 'utf-8')
  const filename = filePath.split('/').pop() ?? filePath
  return ingestKnowledgeItem({ ownerSlug, title: filename, content: raw, sourceType: 'file', ...(tags ? { tags } : {}) })
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
