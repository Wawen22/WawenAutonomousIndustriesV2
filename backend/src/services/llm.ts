// ============================================================
// WAI – LLM Service
// Chiama LiteLLM come endpoint unico per tutti i modelli.
// Non chiamare mai Azure/Google direttamente — passa sempre da qui.
// ============================================================

import OpenAI from 'openai'
import { getModelForAgent, getModelById, estimateCost } from '../config/models.js'
import { log, recordRun } from './logger.js'
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

const FALLBACK_MODEL_ID = 'gpt-5.4'

async function callLLM(
  client: OpenAI,
  modelId: string,
  messages: ChatMessage[],
  signal: AbortSignal
): Promise<{ content: string; tokensInput: number; tokensOutput: number }> {
  const completion = await client.chat.completions.create({
    model: modelId,
    messages,
    store: false,
  }, { signal })

  return {
    content: completion.choices[0]?.message?.content ?? '',
    tokensInput: completion.usage?.prompt_tokens ?? 0,
    tokensOutput: completion.usage?.completion_tokens ?? 0,
  }
}

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
  let usedModelId = model.id
  const abortController = new AbortController()
  const timeoutHandle = setTimeout(() => {
    abortController.abort(`LLM run exceeded ${String(timeoutMs)}ms`)
  }, timeoutMs)

  try {
    try {
      const result = await callLLM(client, model.id, messages, abortController.signal)
      content = result.content
      tokensInput = result.tokensInput
      tokensOutput = result.tokensOutput
    } catch (primaryErr) {
      // If the primary model is not gpt-5.4, attempt a fallback
      if (model.id !== FALLBACK_MODEL_ID && !abortController.signal.aborted) {
        const primaryErrMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr)
        log.warn(
          { agentId: opts.agentId, primaryModel: model.id, error: primaryErrMsg },
          `LLM primary model failed, retrying with ${FALLBACK_MODEL_ID}`
        )

        // Log the failed primary attempt
        void recordRun({
          agent_id: opts.agentId,
          ...(opts.taskId !== undefined && { task_id: opts.taskId }),
          model_id: model.id,
          input_summary: messages[messages.length - 1]?.content?.substring(0, 500) ?? '',
          output_summary: '',
          tokens_input: 0,
          tokens_output: 0,
          tools_used: opts.tools ?? [],
          outcome: 'failure',
          error_message: `Primary model failed, fell back to ${FALLBACK_MODEL_ID}: ${primaryErrMsg}`,
          duration_ms: Date.now() - startMs,
        })

        const fallbackResult = await callLLM(client, FALLBACK_MODEL_ID, messages, abortController.signal)
        content = fallbackResult.content
        tokensInput = fallbackResult.tokensInput
        tokensOutput = fallbackResult.tokensOutput
        usedModelId = FALLBACK_MODEL_ID
      } else {
        throw primaryErr
      }
    }
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
      model_id: usedModelId,
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
  const usedModel = usedModelId === model.id ? model : getModelById(usedModelId)
  return { content, modelId: usedModelId, tokensInput, tokensOutput, costUsd: estimateCost(usedModel, tokensInput, tokensOutput), durationMs }
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
