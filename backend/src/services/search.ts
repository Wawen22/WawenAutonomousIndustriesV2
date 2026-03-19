// ============================================================
// WAI – Web Search Service
// Provider abstraction for external search APIs.
// Current provider: Serper.dev
// ============================================================

import { z } from 'zod'

export interface WebSearchInput {
  query: string
  limit?: number
}

export interface WebSearchResultItem {
  title: string
  url: string
  snippet: string
  position: number
}

export interface WebSearchResponse {
  provider: 'serper'
  query: string
  answerBox?: string
  organic: WebSearchResultItem[]
  relatedQueries: string[]
}

const DEFAULT_SERPER_BASE_URL = 'https://google.serper.dev/search'
const DEFAULT_SEARCH_LIMIT = 6

const serperResponseSchema = z.object({
  answerBox: z.object({
    answer: z.string().optional(),
    snippet: z.string().optional(),
  }).partial().optional(),
  knowledgeGraph: z.object({
    description: z.string().optional(),
  }).partial().optional(),
  organic: z.array(z.object({
    title: z.string().optional(),
    link: z.string().optional(),
    snippet: z.string().optional(),
    position: z.number().optional(),
  }).passthrough()).optional(),
  relatedSearches: z.array(z.object({
    query: z.string().optional(),
  }).passthrough()).optional(),
}).passthrough()

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return DEFAULT_SEARCH_LIMIT
  return Math.max(1, Math.min(10, Math.trunc(limit)))
}

function getSerperConfig(): { apiKey: string; baseUrl: string; gl?: string; hl?: string } {
  const apiKey = process.env['SERPER_API_KEY']
  if (!apiKey) {
    throw new Error('Missing SERPER_API_KEY')
  }

  const baseUrl = process.env['SERPER_BASE_URL']?.trim() || DEFAULT_SERPER_BASE_URL
  const gl = process.env['SERPER_GL']?.trim()
  const hl = process.env['SERPER_HL']?.trim()

  return {
    apiKey,
    baseUrl,
    ...(gl ? { gl } : {}),
    ...(hl ? { hl } : {}),
  }
}

function normalizeAnswerBox(result: z.infer<typeof serperResponseSchema>): string | undefined {
  const candidates = [
    result.answerBox?.answer,
    result.answerBox?.snippet,
    result.knowledgeGraph?.description,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return undefined
}

export async function searchWeb(input: WebSearchInput): Promise<WebSearchResponse> {
  const query = input.query.trim()
  if (!query) {
    throw new Error('web_search requires a non-empty query')
  }

  const limit = clampLimit(input.limit)
  const config = getSerperConfig()
  const payload = {
    q: query,
    num: limit,
    ...(config.gl ? { gl: config.gl } : {}),
    ...(config.hl ? { hl: config.hl } : {}),
  }

  const response = await fetch(config.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': config.apiKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Serper request failed (${response.status}): ${errorText.slice(0, 240)}`)
  }

  const rawJson: unknown = await response.json()
  const parsed = serperResponseSchema.safeParse(rawJson)
  if (!parsed.success) {
    throw new Error('Invalid Serper response payload')
  }

  const organic = (parsed.data.organic ?? [])
    .filter((item) => typeof item.title === 'string' && typeof item.link === 'string')
    .slice(0, limit)
    .map((item, index) => ({
      title: item.title?.trim() ?? `Result ${index + 1}`,
      url: item.link?.trim() ?? '',
      snippet: item.snippet?.trim() ?? '',
      position: typeof item.position === 'number' ? item.position : index + 1,
    }))
    .filter((item) => item.url.length > 0)

  const relatedQueries = (parsed.data.relatedSearches ?? [])
    .map((item) => item.query?.trim() ?? '')
    .filter((item) => item.length > 0)
    .slice(0, 6)

  const answerBox = normalizeAnswerBox(parsed.data)

  return {
    provider: 'serper',
    query,
    organic,
    relatedQueries,
    ...(answerBox ? { answerBox } : {}),
  }
}
