// ============================================================
// WAI – LLM Service
// Chiama LiteLLM come endpoint unico per tutti i modelli.
// Non chiamare mai Azure/Google direttamente — passa sempre da qui.
// ============================================================

import OpenAI from 'openai'
import { getModelForAgent, estimateCost } from '../config/models.js'
import { recordRun } from './logger.js'
import type { ModelRoutingContext, RunOutcome, TaskType } from '../types/index.js'

const DEFAULT_RUN_TIMEOUT_MS = 180_000

function getRunTimeoutMs(): number {
  const raw = process.env['LLM_RUN_TIMEOUT_MS']
  if (!raw) return DEFAULT_RUN_TIMEOUT_MS

  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RUN_TIMEOUT_MS
}

// ---------------------------------------------------------------------------
// Client LiteLLM (usa l'SDK OpenAI — LiteLLM è compatibile)
// ---------------------------------------------------------------------------

function createLiteLLMClient(): OpenAI {
  const baseURL = process.env['LITELLM_BASE_URL']
  const apiKey = process.env['LITELLM_API_KEY']

  if (!baseURL || !apiKey) {
    throw new Error('Missing LITELLM_BASE_URL or LITELLM_API_KEY')
  }

  return new OpenAI({ baseURL, apiKey })
}

let _client: OpenAI | null = null
function getClient(): OpenAI {
  if (!_client) _client = createLiteLLMClient()
  return _client
}

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface RunOptions {
  agentId: string
  taskId?: string
  taskType?: TaskType
  tools?: string[]
  requiresComplex?: boolean
  modelOverride?: string
}

export interface RunResult {
  content: string
  modelId: string
  tokensInput: number
  tokensOutput: number
  costUsd: number
  durationMs: number
}

// ---------------------------------------------------------------------------
// Funzione principale: esegui una chiamata LLM e logga il run
// ---------------------------------------------------------------------------

export async function runAgent(
  messages: ChatMessage[],
  opts: RunOptions
): Promise<RunResult> {
  const routingCtx: ModelRoutingContext = {
    agentId: opts.agentId,
    ...(opts.taskType !== undefined && { taskType: opts.taskType }),
    ...(opts.requiresComplex !== undefined && { requiresComplex: opts.requiresComplex }),
    ...(opts.modelOverride !== undefined && { override: opts.modelOverride }),
  }

  const model = getModelForAgent(routingCtx)
  const client = getClient()
  const startMs = Date.now()
  const timeoutMs = getRunTimeoutMs()

  let outcome: RunOutcome = 'success'
  let errorMessage: string | undefined
  let content = ''
  let tokensInput = 0
  let tokensOutput = 0
  const abortController = new AbortController()
  const timeoutHandle = setTimeout(() => {
    abortController.abort(`LLM run exceeded ${String(timeoutMs)}ms`)
  }, timeoutMs)

  try {
    const completion = await client.chat.completions.create({
      model: model.id,
      messages,
      store: false,
    }, {
      signal: abortController.signal,
    })

    content = completion.choices[0]?.message?.content ?? ''
    tokensInput = completion.usage?.prompt_tokens ?? 0
    tokensOutput = completion.usage?.completion_tokens ?? 0
  } catch (err) {
    outcome = 'failure'
    const rawMessage = err instanceof Error ? err.message : String(err)
    const loweredMessage = rawMessage.toLowerCase()
    const isTimeout =
      loweredMessage.includes('timeout') ||
      loweredMessage.includes('timed out') ||
      loweredMessage.includes('abort')

    errorMessage = isTimeout
      ? `LLM run timed out after ${String(timeoutMs)}ms: ${rawMessage}`
      : rawMessage

    throw new Error(errorMessage, {
      cause: err instanceof Error ? err : undefined,
    })
  } finally {
    clearTimeout(timeoutHandle)
    const durationMs = Date.now() - startMs

    // Log ogni run a Supabase (fire-and-forget)
    void recordRun({
      agent_id: opts.agentId,
      ...(opts.taskId !== undefined && { task_id: opts.taskId }),
      model_id: model.id,
      input_summary: messages[messages.length - 1]?.content?.substring(0, 500) ?? '',
      output_summary: content.substring(0, 500),
      tokens_input: tokensInput,
      tokens_output: tokensOutput,
      tools_used: opts.tools ?? [],
      outcome,
      ...(errorMessage !== undefined && { error_message: errorMessage }),
      duration_ms: durationMs,
    })
  }

  const durationMs = Date.now() - startMs
  return { content, modelId: model.id, tokensInput, tokensOutput, costUsd: estimateCost(model, tokensInput, tokensOutput), durationMs }
}

// ---------------------------------------------------------------------------
// Quick ping: verifica che LiteLLM sia raggiungibile
// ---------------------------------------------------------------------------

export async function pingLiteLLM(): Promise<boolean> {
  try {
    const baseURL = process.env['LITELLM_BASE_URL'] ?? 'http://localhost:4000/v1'
    const url = baseURL.replace('/v1', '/health')
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    // 401 = LiteLLM up ma richiede auth — è comunque raggiungibile
    return res.ok || res.status === 401
  } catch {
    return false
  }
}
