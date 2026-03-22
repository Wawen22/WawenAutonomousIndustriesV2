// ============================================================
// WAI – Agent Memory Service
// Persistent per-agent memory backed by Supabase + pgvector.
// Uses deterministic local hashed embeddings to avoid an extra
// external embedding dependency in the critical path.
// ============================================================

import { getSupabaseClient } from './supabase.js'
import type { AgentMemory } from '../types/index.js'

const MEMORY_VECTOR_DIM = 256
const DEFAULT_MEMORY_LIMIT = 5
const DEFAULT_MEMORY_TTL_DAYS = 30
const DEFAULT_MIN_SIMILARITY = 0.25
const DEDUP_SIMILARITY_THRESHOLD = 0.65
const MAX_MEMORY_CONTENT_CHARS = 2_400
const MAX_PROMPT_MEMORY_CHARS = 700

interface CreateAgentMemoryInput {
  agentId: string
  content: string
  entityType?: string | undefined
  ttl?: string | undefined
  projectId?: string | undefined
  clientId?: string | undefined
}

interface RecallAgentMemoriesInput {
  agentId: string
  query: string
  entityType?: string | undefined
  limit?: number
  minSimilarity?: number
}

interface GetAgentMemoriesInput {
  agentId?: string | undefined
  entityType?: string | undefined
  limit?: number
  includeExpired?: boolean
}

export interface AgentMemoryMatch extends AgentMemory {
  similarity: number
}

function truncate(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
}

function normalizeForMemory(text: string): string {
  return truncate(text, MAX_MEMORY_CONTENT_CHARS)
}

function tokenize(text: string): string[] {
  const baseTokens = text
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9._/-]{1,}/g) ?? []

  const tokens = [...baseTokens]
  for (let i = 0; i < baseTokens.length - 1; i += 1) {
    tokens.push(`${baseTokens[i]}__${baseTokens[i + 1]}`)
  }

  return tokens
}

function hashToken(token: string): number {
  let hash = 2166136261
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function createEmbedding(text: string): number[] {
  const vector = Array.from({ length: MEMORY_VECTOR_DIM }, () => 0)
  const tokens = tokenize(text)

  for (const token of tokens) {
    const hash = hashToken(token)
    const index = hash % MEMORY_VECTOR_DIM
    const sign = ((hash >>> 8) & 1) === 0 ? 1 : -1
    const weight = token.includes('__') ? 1.35 : Math.min(2.2, 1 + token.length / 18)
    vector[index] = (vector[index] ?? 0) + sign * weight
  }

  let squaredNorm = 0
  for (const value of vector) {
    squaredNorm += value * value
  }

  const norm = Math.sqrt(squaredNorm) || 1
  return vector.map((value) => Number((value / norm).toFixed(6)))
}

function vectorToSqlLiteral(values: number[]): string {
  return `[${values.map((value) => value.toFixed(6)).join(',')}]`
}

function getDefaultTtl(): string {
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + DEFAULT_MEMORY_TTL_DAYS)
  return expiresAt.toISOString()
}

function isActiveMemory(memory: AgentMemory): boolean {
  return memory.ttl === null || new Date(memory.ttl).getTime() > Date.now()
}

function formatMemoryAge(createdAt: string): string {
  const diffMs = Date.now() - new Date(createdAt).getTime()
  const diffMinutes = Math.max(1, Math.round(diffMs / 60_000))

  if (diffMinutes < 60) return `${String(diffMinutes)}m ago`

  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 48) return `${String(diffHours)}h ago`

  const diffDays = Math.round(diffHours / 24)
  return `${String(diffDays)}d ago`
}

export async function createAgentMemory(input: CreateAgentMemoryInput): Promise<AgentMemory | null> {
  const normalizedContent = normalizeForMemory(input.content)
  if (normalizedContent.length < 40) return null

  // Scope auto-detection:
  //   projectId set                    → scope='project', agent_id='_system'
  //   clientId set (no projectId)      → scope='client',  agent_id='_system'
  //   neither                          → scope='agent',   agent_id=input.agentId
  //   both set                         → scope='project' wins, clientId still stored
  let scope: 'agent' | 'project' | 'client'
  let resolvedAgentId: string
  if (input.projectId) {
    scope = 'project'
    resolvedAgentId = '_system'
  } else if (input.clientId) {
    scope = 'client'
    resolvedAgentId = '_system'
  } else {
    scope = 'agent'
    resolvedAgentId = input.agentId
  }

  // Deduplication: skip saving if a very similar active memory already exists.
  // Uses the resolved agent_id (sentinel '_system' for project/client scopes)
  // so dedup correctly spans all agents writing facts about the same project/client.
  const queryEmbedding = vectorToSqlLiteral(createEmbedding(normalizedContent))
  const { data: existingMatches, error: recallErr } = await getSupabaseClient().rpc('match_agent_memories', {
    p_agent_id: resolvedAgentId,
    p_query_embedding: queryEmbedding,
    p_match_count: 1,
    p_entity_type: input.entityType ?? 'general',
  })

  if (!recallErr && Array.isArray(existingMatches) && existingMatches.length > 0) {
    const top = existingMatches[0] as AgentMemoryMatch
    if (top.similarity >= DEDUP_SIMILARITY_THRESHOLD && isActiveMemory(top)) {
      return null // Near-duplicate detected — skip insert
    }
  }

  const { data, error } = await getSupabaseClient()
    .from('agent_memories')
    .insert({
      agent_id: resolvedAgentId,
      content: normalizedContent,
      embedding: queryEmbedding,
      entity_type: input.entityType ?? 'general',
      scope,
      ...(input.projectId ? { project_id: input.projectId } : {}),
      ...(input.clientId ? { client_id: input.clientId } : {}),
      ttl: input.ttl ?? (scope === 'agent' ? getDefaultTtl() : null),
    })
    .select('id, agent_id, content, entity_type, scope, project_id, client_id, created_at, ttl')
    .single()

  if (error) throw new Error(`Failed to create agent memory: ${error.message}`)
  return (data ?? null) as AgentMemory | null
}

export async function getAgentMemories(input: GetAgentMemoriesInput = {}): Promise<AgentMemory[]> {
  const limit = input.limit ?? 200

  let query = getSupabaseClient()
    .from('agent_memories')
    .select('id, agent_id, content, entity_type, scope, project_id, client_id, created_at, ttl')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (input.agentId) {
    query = query.eq('agent_id', input.agentId)
  }
  if (input.entityType) {
    query = query.eq('entity_type', input.entityType)
  }

  const { data, error } = await query
  if (error) throw new Error(`Failed to get agent memories: ${error.message}`)

  const rows = ((data ?? []) as AgentMemory[])
  if (input.includeExpired) return rows
  return rows.filter(isActiveMemory)
}

export async function recallAgentMemories(
  input: RecallAgentMemoriesInput
): Promise<AgentMemoryMatch[]> {
  const normalizedQuery = input.query.replace(/\s+/g, ' ').trim()
  if (normalizedQuery.length < 24) return []

  const queryEmbedding = vectorToSqlLiteral(createEmbedding(normalizedQuery))
  const { data, error } = await getSupabaseClient().rpc('match_agent_memories', {
    p_agent_id: input.agentId,
    p_query_embedding: queryEmbedding,
    p_match_count: input.limit ?? DEFAULT_MEMORY_LIMIT,
    p_entity_type: input.entityType ?? null,
  })

  if (error) throw new Error(`Failed to recall agent memories: ${error.message}`)

  const minSimilarity = input.minSimilarity ?? DEFAULT_MIN_SIMILARITY
  return ((data ?? []) as AgentMemoryMatch[])
    .filter((row) => row.similarity >= minSimilarity)
    .filter(isActiveMemory)
}

export async function deleteAgentMemory(id: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('agent_memories')
    .delete()
    .eq('id', id)
  if (error) throw new Error(`Failed to delete agent memory: ${error.message}`)
}

export async function deleteAgentMemories(agentId?: string): Promise<number> {
  let query = getSupabaseClient().from('agent_memories').delete()
  if (agentId) {
    query = query.eq('agent_id', agentId)
  }
  const { data, error } = await query.select('id')
  if (error) throw new Error(`Failed to delete agent memories: ${error.message}`)
  return (data ?? []).length
}

export async function getProjectMemories(
  projectId: string,
  clientId?: string
): Promise<AgentMemory[]> {
  // Direct table query — no vector search, no RPC.
  // Fetches project_fact + task_outcome for the project, and optionally client_fact for the client.
  const supabase = getSupabaseClient()

  const allResults: AgentMemory[] = []

  // Project-scoped facts and task outcomes
  if (projectId) {
    const { data: projectData, error: projectError } = await supabase
      .from('agent_memories')
      .select('id, agent_id, content, entity_type, scope, project_id, client_id, created_at, ttl')
      .eq('project_id', projectId)
      .in('entity_type', ['project_fact', 'task_outcome'])
      .order('created_at', { ascending: false })

    if (projectError) throw new Error(`Failed to get project memories: ${projectError.message}`)
    allResults.push(...((projectData ?? []) as AgentMemory[]).filter(isActiveMemory))
  }

  // Client-scoped facts (if clientId provided)
  if (clientId) {
    const { data: clientData, error: clientError } = await supabase
      .from('agent_memories')
      .select('id, agent_id, content, entity_type, scope, project_id, client_id, created_at, ttl')
      .eq('client_id', clientId)
      .eq('entity_type', 'client_fact')
      .order('created_at', { ascending: false })

    if (clientError) throw new Error(`Failed to get client memories: ${clientError.message}`)
    allResults.push(...((clientData ?? []) as AgentMemory[]).filter(isActiveMemory))
  }

  return allResults
}

export function formatMemoriesForPrompt(memories: AgentMemoryMatch[]): string {
  if (memories.length === 0) return ''

  const items = memories
    .map((memory, index) => {
      const summary = truncate(memory.content, MAX_PROMPT_MEMORY_CHARS)
      const similarity = `${Math.round(memory.similarity * 100)}%`
      return `${index + 1}. [${formatMemoryAge(memory.created_at)} | relevance ${similarity}] ${summary}`
    })
    .join('\n')

  return [
    'Relevant long-term memory recall:',
    items,
    '',
    'Use these memories only when they help with the current task. Current instructions override memory if they conflict.',
  ].join('\n')
}
