// ============================================================
// WAI – LLM Service
// Chiama LiteLLM come endpoint unico per tutti i modelli.
// Non chiamare mai Azure/Google direttamente — passa sempre da qui.
// ============================================================

import OpenAI from 'openai'
import { getModelForAgent, getModelById, estimateCost } from '../config/models.js'
import { log, recordRun } from './logger.js'
import { createAgentMemory, formatMemoriesForPrompt, getProjectMemories, recallAgentMemories } from './memory.js'
import { getSpecialModelOverride } from './model-routing-policy.js'
import type { AgentMemory, ModelRoutingContext, RunOutcome, TaskType } from '../types/index.js'

const DEFAULT_RUN_TIMEOUT_MS = 300_000 // 5 min default; file generation uses 6 min override
const MEMORY_WARNING_COOLDOWN_MS = 300_000
const RETRYABLE_LLM_ERROR_PATTERNS = [
  'premature close',
  'socket hang up',
  'econnreset',
  'terminated',
  'fetch failed',
  'connection closed',
  'stream ended',
  'other side closed',
]
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
  projectId?: string
  clientId?: string
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function extractStatusCode(error: unknown, rawMessage: string): number | null {
  if (typeof error === 'object' && error !== null) {
    const maybeStatus = Reflect.get(error, 'status')
    if (typeof maybeStatus === 'number' && Number.isFinite(maybeStatus)) {
      return maybeStatus
    }
    if (typeof maybeStatus === 'string') {
      const parsed = Number.parseInt(maybeStatus, 10)
      if (Number.isFinite(parsed)) return parsed
    }
  }

  const match = rawMessage.match(/\b(?:status(?: code)?|code)\D{0,8}(\d{3})\b/i)
  if (!match) return null

  const parsed = Number.parseInt(match[1] ?? '', 10)
  return Number.isFinite(parsed) ? parsed : null
}

function extractProviderName(rawMessage: string): string | null {
  const match = rawMessage.match(/provider_name["']?\s*[:=]\s*["']([^"']+)["']/i)
  return match?.[1]?.trim() || null
}

function classifyLlmError(error: unknown): {
  rawMessage: string
  retryable: boolean
  label: 'transport' | 'timeout' | 'provider' | 'rate_limit' | 'auth'
  statusCode: number | null
  providerName: string | null
} {
  const rawMessage = error instanceof Error ? error.message : String(error)
  const lowered = rawMessage.toLowerCase()
  const statusCode = extractStatusCode(error, rawMessage)
  const providerName = extractProviderName(rawMessage)
  const isTimeout =
    lowered.includes('timeout') ||
    lowered.includes('timed out') ||
    lowered.includes('abort')

  if (isTimeout) {
    return {
      rawMessage,
      retryable: false,
      label: 'timeout',
      statusCode,
      providerName,
    }
  }

  const isRateLimited =
    statusCode === 429 ||
    lowered.includes('rate limit') ||
    lowered.includes('rate-limit') ||
    lowered.includes('rate limited') ||
    lowered.includes('too many requests')

  if (isRateLimited) {
    return {
      rawMessage,
      retryable: false,
      label: 'rate_limit',
      statusCode,
      providerName,
    }
  }

  if (statusCode === 401 || statusCode === 403 || lowered.includes('unauthorized') || lowered.includes('forbidden')) {
    return {
      rawMessage,
      retryable: false,
      label: 'auth',
      statusCode,
      providerName,
    }
  }

  const retryable = RETRYABLE_LLM_ERROR_PATTERNS.some((pattern) => lowered.includes(pattern))
  return {
    rawMessage,
    retryable,
    label: retryable ? 'transport' : 'provider',
    statusCode,
    providerName,
  }
}

function formatLlmAttemptError(
  modelId: string,
  error: unknown,
  attempt: number,
  maxAttempts: number
): string {
  const classification = classifyLlmError(error)
  const details = [
    classification.providerName ? `provider ${classification.providerName}` : null,
    classification.statusCode ? `status ${String(classification.statusCode)}` : null,
    `attempt ${String(attempt)}/${String(maxAttempts)}`,
  ].filter(Boolean).join(', ')

  return `LLM ${classification.label} error on ${modelId} (${details}): ${classification.rawMessage}`
}

async function callLLMWithRetries(
  client: OpenAI,
  modelId: string,
  messages: ChatMessage[],
  signal: AbortSignal,
  context: { agentId: string; taskId?: string; maxAttempts?: number }
): Promise<{ content: string; tokensInput: number; tokensOutput: number }> {
  const maxAttempts = context.maxAttempts ?? 2

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await callLLM(client, modelId, messages, signal)
    } catch (error) {
      const classification = classifyLlmError(error)
      const formattedError = formatLlmAttemptError(modelId, error, attempt, maxAttempts)

      if (signal.aborted || !classification.retryable || attempt >= maxAttempts) {
        if (!signal.aborted && !classification.retryable) {
          log.warn(
            {
              agentId: context.agentId,
              taskId: context.taskId,
              modelId,
              statusCode: classification.statusCode,
              providerName: classification.providerName,
              errorClass: classification.label,
              error: classification.rawMessage,
            },
            classification.label === 'rate_limit'
              ? 'LLM provider rejected the request due to upstream rate limiting'
              : 'LLM provider rejected the request'
          )
        }

        throw new Error(formattedError, {
          cause: error instanceof Error ? error : undefined,
        })
      }

      log.warn(
        {
          agentId: context.agentId,
          taskId: context.taskId,
          modelId,
          attempt,
          maxAttempts,
          error: classification.rawMessage,
        },
        'Transient LLM transport error detected; retrying same model'
      )

      await sleep(Math.min(1_500, attempt * 400))
    }
  }

  throw new Error(`LLM retry loop exhausted unexpectedly for ${modelId}`)
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

function formatPreferencesForPrompt(memories: AgentMemory[]): string {
  if (memories.length === 0) return ''

  const items = memories
    .map((m, i) => `${i + 1}. ${m.content}`)
    .join('\n')

  return [
    'CRITICAL FOUNDER PREFERENCES (DO NOT VIOLATE):',
    items,
    '',
    'The above preferences are established based on previous founder feedback. Adhere to them strictly.',
  ].join('\n')
}

function formatProjectMemoriesForPrompt(memories: AgentMemory[]): string {
  if (memories.length === 0) return ''

  const items = memories.map((m) => `- [${m.entity_type}] ${m.content}`).join('\n')
  return ['Project/Client Context (established facts — use as background, do not contradict):', items].join('\n')
}

async function injectScopedMemory(
  messages: ChatMessage[],
  agentId: string,
  projectId?: string,
  clientId?: string
): Promise<ChatMessage[]> {
  const query = buildMemoryQuery(messages)
  if (query.length < 24) return messages

  try {
    let extraContext: string

    if (projectId ?? clientId) {
      // Tiered recall: project/client facts first, then agent preferences — NO general memory
      const [projectMemories, preferences] = await Promise.all([
        getProjectMemories(projectId ?? '', clientId),
        recallAgentMemories({ agentId, query, entityType: 'preference', limit: 5 }),
      ])

      const projectPrompt = formatProjectMemoriesForPrompt(projectMemories)
      const preferencePrompt = formatPreferencesForPrompt(preferences)

      if (!projectPrompt && !preferencePrompt) return messages
      extraContext = [projectPrompt, preferencePrompt].filter(Boolean).join('\n\n---\n\n')

      log.debug(
        { agentId, projectId, clientId, contextChars: extraContext.length },
        'injectScopedMemory: project/client path'
      )
    } else {
      // Fallback (backward-compatible): general + preference recall
      // General memories drain naturally as 30-day TTLs expire.
      const [generalMemories, preferences] = await Promise.all([
        recallAgentMemories({ agentId, query, entityType: 'general', limit: 3 }),
        recallAgentMemories({ agentId, query, entityType: 'preference', limit: 5 }),
      ])

      const memoryPrompt = formatMemoriesForPrompt(generalMemories)
      const preferencePrompt = formatPreferencesForPrompt(preferences)

      if (!memoryPrompt && !preferencePrompt) return messages
      extraContext = [preferencePrompt, memoryPrompt].filter(Boolean).join('\n\n---\n\n')

      log.debug(
        { agentId, contextChars: extraContext.length },
        'injectScopedMemory: fallback path (no project/client scope)'
      )
    }

    const firstNonSystemIndex = messages.findIndex((message) => message.role !== 'system')
    if (firstNonSystemIndex < 0) {
      return [...messages, { role: 'system', content: extraContext }]
    }

    return [
      ...messages.slice(0, firstNonSystemIndex),
      { role: 'system', content: extraContext },
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
  const preparedMessages = await injectScopedMemory(messages, opts.agentId, opts.projectId, opts.clientId)
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
      const result = await callLLMWithRetries(client, model.id, preparedMessages, abortController.signal, {
        agentId: opts.agentId,
        ...(opts.taskId !== undefined && { taskId: opts.taskId }),
      })
      content = result.content
      tokensInput = result.tokensInput
      tokensOutput = result.tokensOutput
    } catch (primaryErr) {
      const configuredFallbackModelId = await getSpecialModelOverride('llm_primary_failure_fallback')
      const primaryFailure = classifyLlmError(primaryErr)

      if (
        configuredFallbackModelId &&
        configuredFallbackModelId !== model.id &&
        !abortController.signal.aborted
      ) {
        const primaryErrMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr)
        log.warn(
          {
            agentId: opts.agentId,
            primaryModel: model.id,
            fallbackModel: configuredFallbackModelId,
            error: primaryErrMsg,
            errorClass: primaryFailure.label,
            statusCode: primaryFailure.statusCode,
            providerName: primaryFailure.providerName,
          },
          `LLM primary model failed, retrying with configured fallback ${configuredFallbackModelId}`
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
          error_message: `Primary model failed, fell back to configured model ${configuredFallbackModelId}: ${primaryErrMsg}`,
          duration_ms: Date.now() - startMs,
        })

        const fallbackResult = await callLLMWithRetries(client, configuredFallbackModelId, preparedMessages, abortController.signal, {
          agentId: opts.agentId,
          ...(opts.taskId !== undefined && { taskId: opts.taskId }),
        })
        content = fallbackResult.content
        tokensInput = fallbackResult.tokensInput
        tokensOutput = fallbackResult.tokensOutput
        usedModelId = configuredFallbackModelId
      } else {
        log.warn(
          {
            agentId: opts.agentId,
            taskId: opts.taskId,
            primaryModel: model.id,
            fallbackModel: configuredFallbackModelId ?? null,
            error: primaryFailure.rawMessage,
            errorClass: primaryFailure.label,
            statusCode: primaryFailure.statusCode,
            providerName: primaryFailure.providerName,
          },
          primaryFailure.label === 'rate_limit'
            ? 'LLM primary model hit upstream rate limiting and no configured cross-model fallback is active'
            : 'LLM primary model failed and no configured cross-model fallback is active'
        )
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
