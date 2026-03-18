// ============================================================
// WAI – LLM Service
// Chiama LiteLLM come endpoint unico per tutti i modelli.
// Non chiamare mai Azure/Google direttamente — passa sempre da qui.
// ============================================================

import OpenAI from 'openai'
import { getModelForAgent, getModelById, estimateCost } from '../config/models.js'
import { log, recordRun } from './logger.js'
import { createAgentMemory, formatMemoriesForPrompt, recallAgentMemories } from './memory.js'
import type { ModelRoutingContext, RunOutcome, TaskType } from '../types/index.js'

const DEFAULT_RUN_TIMEOUT_MS = 300_000 // 5 min default; file generation uses 6 min override
const MEMORY_WARNING_COOLDOWN_MS = 300_000
let lastMemoryWarningAt = 0

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
  timeoutMs?: number
  captureMemory?: boolean
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

// ---------------------------------------------------------------------------
// callLLM — uses streaming so the connection stays alive during long responses.
// Without streaming, a silent 4-5 min generation causes proxy/network timeouts
// even before our AbortController fires.
// ---------------------------------------------------------------------------

async function callLLM(
  client: OpenAI,
  modelId: string,
  messages: ChatMessage[],
  signal: AbortSignal
): Promise<{ content: string; tokensInput: number; tokensOutput: number }> {
  const stream = await client.chat.completions.create({
    model: modelId,
    messages,
    store: false,
    stream: true,
    stream_options: { include_usage: true },
  }, { signal })

  let content = ''
  let tokensInput = 0
  let tokensOutput = 0

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content
    if (delta) content += delta

    // Usage is included in the final chunk when stream_options.include_usage = true
    if (chunk.usage) {
      tokensInput = chunk.usage.prompt_tokens ?? 0
      tokensOutput = chunk.usage.completion_tokens ?? 0
    }
  }

  return { content, tokensInput, tokensOutput }
}

function buildMemoryQuery(messages: ChatMessage[]): string {
  const relevantMessages = messages.filter((message) => message.role !== 'system')
  if (relevantMessages.length === 0) return ''

  return relevantMessages
    .slice(-2)
    .map((message) => message.content)
    .join('\n\n')
    .trim()
}

function buildRunMemoryContent(messages: ChatMessage[], output: string, taskType?: TaskType): string {
  const query = buildMemoryQuery(messages)
  return [
    taskType ? `Task type: ${taskType}` : '',
    query ? `Task context:\n${query}` : '',
    output ? `Result:\n${output}` : '',
  ].filter(Boolean).join('\n\n')
}

function logMemoryWarning(err: unknown, agentId: string, message: string, taskId?: string): void {
  const now = Date.now()
  if (now - lastMemoryWarningAt < MEMORY_WARNING_COOLDOWN_MS) return

  lastMemoryWarningAt = now
  log.warn({ err, agentId, taskId }, message)
}

async function injectMemoryRecall(messages: ChatMessage[], agentId: string): Promise<ChatMessage[]> {
  const query = buildMemoryQuery(messages)
  if (query.length < 24) return messages

  try {
    const memories = await recallAgentMemories({ agentId, query })
    const memoryPrompt = formatMemoriesForPrompt(memories)
    if (!memoryPrompt) return messages

    const firstNonSystemIndex = messages.findIndex((message) => message.role !== 'system')
    if (firstNonSystemIndex < 0) {
      return [...messages, { role: 'system', content: memoryPrompt }]
    }

    return [
      ...messages.slice(0, firstNonSystemIndex),
      { role: 'system', content: memoryPrompt },
      ...messages.slice(firstNonSystemIndex),
    ]
  } catch (err) {
    logMemoryWarning(err, agentId, 'Memory recall unavailable; continuing without long-term memory context')
    return messages
  }
}

export async function runAgent(
  messages: ChatMessage[],
  opts: RunOptions
): Promise<RunResult> {
  const preparedMessages = await injectMemoryRecall(messages, opts.agentId)
  const routingCtx: ModelRoutingContext = {
    agentId: opts.agentId,
    ...(opts.taskType !== undefined && { taskType: opts.taskType }),
    ...(opts.requiresComplex !== undefined && { requiresComplex: opts.requiresComplex }),
    ...(opts.modelOverride !== undefined && { override: opts.modelOverride }),
  }

  const model = getModelForAgent(routingCtx)
  const client = getClient()
  const startMs = Date.now()
  const timeoutMs = opts.timeoutMs ?? getRunTimeoutMs()

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
      const result = await callLLM(client, model.id, preparedMessages, abortController.signal)
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
          input_summary: preparedMessages[preparedMessages.length - 1]?.content?.substring(0, 500) ?? '',
          output_summary: '',
          tokens_input: 0,
          tokens_output: 0,
          tools_used: opts.tools ?? [],
          outcome: 'failure',
          error_message: `Primary model failed, fell back to ${FALLBACK_MODEL_ID}: ${primaryErrMsg}`,
          duration_ms: Date.now() - startMs,
        })

        const fallbackResult = await callLLM(client, FALLBACK_MODEL_ID, preparedMessages, abortController.signal)
        content = fallbackResult.content
        tokensInput = fallbackResult.tokensInput
        tokensOutput = fallbackResult.tokensOutput
        usedModelId = FALLBACK_MODEL_ID
      } else {
        throw primaryErr
      }
    }

    if ((opts.captureMemory ?? true) && opts.taskId && content.trim().length >= 80) {
      void createAgentMemory({
        agentId: opts.agentId,
        content: buildRunMemoryContent(messages, content, opts.taskType),
      }).catch((err: unknown) => {
        logMemoryWarning(err, opts.agentId, 'Failed to persist agent memory', opts.taskId)
      })
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
      input_summary: preparedMessages[preparedMessages.length - 1]?.content?.substring(0, 500) ?? '',
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
