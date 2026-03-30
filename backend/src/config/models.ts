// ============================================================
// WAI – Model Registry and Routing
// Single point of truth for all model decisions.
// ============================================================

import type { ModelConfig, ModelRoutingContext, TaskType } from '../types/index.js'

// ---------------------------------------------------------------------------
// LiteLLM Client Config
// All LLM calls go through LiteLLM proxy (http://litellm:4000/v1).
// Use getLiteLLMConfig() to get the OpenAI-compatible client config.
// ---------------------------------------------------------------------------

export interface LiteLLMClientConfig {
  baseURL: string
  apiKey: string
}

export type ModelRoutingSource =
  | 'explicit_override'
  | 'runtime_override'
  | 'agent_assignment'
  | 'task_type_fallback'
  | 'global_fallback'

export interface ModelRoutingDecision {
  model: ModelConfig
  source: ModelRoutingSource
  reason: string
}

export function getLiteLLMConfig(): LiteLLMClientConfig {
  const baseURL = process.env['LITELLM_BASE_URL'] ?? 'http://litellm:4000/v1'
  const apiKey = process.env['LITELLM_API_KEY'] ?? 'sk-wai-master-key'
  return { baseURL, apiKey }
}

// ---------------------------------------------------------------------------
// Model Registry
// Keep in sync with Supabase `models` table (seed.sql).
// litellm_model_name = the model name to pass to LiteLLM proxy.
// ---------------------------------------------------------------------------

export const MODELS: Record<string, ModelConfig & { litellm_model_name: string }> = {
  'gpt-5.4': {
    id: 'gpt-5.4',
    provider: 'azure',
    display_name: 'GPT-5.4 (Azure Foundry)',
    litellm_model_name: 'gpt-5.4',          // matches model_name in litellm/config.yaml
    cost_per_1k_input_tokens: 0.01,
    cost_per_1k_output_tokens: 0.03,
    context_window: 128000,
    is_active: true,
    notes: 'Complex reasoning, planning, architecture, development',
  },
  'gemini-2.5-flash': {
    id: 'gemini-2.5-flash',
    provider: 'google',
    display_name: 'Gemini 2.5 Flash',
    litellm_model_name: 'gemini-2.5-flash', // matches model_name in litellm/config.yaml
    cost_per_1k_input_tokens: 0.00035,
    cost_per_1k_output_tokens: 0.00105,
    context_window: 1000000,
    is_active: true,
    notes: 'Fast, low-latency operations, marketing, support, routing',
  },

  // --- OpenRouter free models ---
  'glm-4.5-air': {
    id: 'glm-4.5-air',
    provider: 'openrouter',
    display_name: 'GLM 4.5 Air (Free)',
    litellm_model_name: 'glm-4.5-air',
    cost_per_1k_input_tokens: 0,
    cost_per_1k_output_tokens: 0,
    context_window: 128000,
    is_active: true,
    notes: 'Free via OpenRouter — content, social, marketing, ops, HR',
  },
  'nemotron-120b': {
    id: 'nemotron-120b',
    provider: 'openrouter',
    display_name: 'Nemotron 3 Super 120B (Free)',
    litellm_model_name: 'nemotron-120b',
    cost_per_1k_input_tokens: 0,
    cost_per_1k_output_tokens: 0,
    context_window: 128000,
    is_active: true,
    notes: 'Free via OpenRouter — CEO, PM, finance, complex tasks, temporary coding default',
  },
  'step-flash': {
    id: 'step-flash',
    provider: 'openrouter',
    display_name: 'Step 3.5 Flash (Free)',
    litellm_model_name: 'step-flash',
    cost_per_1k_input_tokens: 0,
    cost_per_1k_output_tokens: 0,
    context_window: 32000,
    is_active: true,
    notes: 'Free via OpenRouter — ultra-fast routing and simple tasks',
  },
  'qwen3-coder': {
    id: 'qwen3-coder',
    provider: 'openrouter',
    display_name: 'Qwen3 Coder (Free)',
    litellm_model_name: 'qwen3-coder',
    cost_per_1k_input_tokens: 0,
    cost_per_1k_output_tokens: 0,
    context_window: 128000,
    is_active: true,
    notes: 'Free via OpenRouter — keep only for manual tests; revisit when GLM 4.7/5 coding options are validated',
  },
  'minimax-m2.7': {
    id: 'minimax-m2.7',
    provider: 'openrouter',
    display_name: 'MiniMax M2.7',
    litellm_model_name: 'minimax-m2.7',
    cost_per_1k_input_tokens: 0.0008,
    cost_per_1k_output_tokens: 0.0032,
    context_window: 1000000,
    is_active: true,
    notes: 'Via OpenRouter (minimax/minimax-m2.7) — 1M context, strong coding; assigned to architect and all dev agents',
  },
}

// ---------------------------------------------------------------------------
// Default model per agent ID
// Override via Models view persisted runtime assignments or Neb's /assign_model command.
// ---------------------------------------------------------------------------

export const AGENT_MODEL_DEFAULTS: Record<string, string> = {
  // Executive — complex reasoning → nemotron-120b
  ceo: 'nemotron-120b',

  // Team SaaS
  dev_lead_saas: 'nemotron-120b',
  dev_saas_1: 'nemotron-120b',
  dev_saas_2: 'nemotron-120b',

  // Team Dev — coding → minimax-m2.7 (1M context, strong at code generation)
  architect: 'minimax-m2.7',
  devops_engineer: 'minimax-m2.7',
  dev_general: 'minimax-m2.7',
  qa: 'minimax-m2.7',

  // Team Consulting — analysis → nemotron-120b
  consulting_lead: 'nemotron-120b',
  analyst: 'nemotron-120b',

  // Team Marketing — content → glm-4.5-air
  marketing_strategist: 'glm-4.5-air',

  // Team Ops/Finance
  ops: 'glm-4.5-air',
  finance: 'nemotron-120b',

  // Specialist agents (T121)
  executive_summary: 'glm-4.5-air',       // fast summarization — no complex reasoning needed
  feedback_synthesizer: 'nemotron-120b',   // pattern analysis + priority scoring
  security_auditor: 'nemotron-120b',       // complex security reasoning
  api_tester: 'nemotron-120b',             // technical analysis
  db_optimizer: 'nemotron-120b',           // schema + query analysis
  legal_compliance: 'nemotron-120b',       // complex legal reasoning
  proposal_strategist: 'nemotron-120b',    // structured commercial output
}

// ---------------------------------------------------------------------------
// Task type → model fallback
// Used only when an agent has no assignment/default.
// ---------------------------------------------------------------------------

const COMPLEX_TASK_TYPES = new Set<TaskType>([
  'dev_complex',
  'architecture',
  'planning',
  'analysis',
  'strategy',
  'consulting',
])

const SIMPLE_TASK_TYPES = new Set<TaskType>([
  'dev_simple',
  'marketing',
  'content',
  'support',
  'routing',
])

// ---------------------------------------------------------------------------
// Runtime model overrides (from /assign_model command)
// Stored in memory; also persisted to workspace/system/model-assignments.json.
// ---------------------------------------------------------------------------

const runtimeOverrides = new Map<string, string>()

export function getModelOverrides(): Record<string, string> {
  return Object.fromEntries(runtimeOverrides.entries())
}

export function setModelOverride(agentId: string, modelId: string): void {
  if (!(modelId in MODELS)) {
    throw new Error(`Unknown model: ${modelId}`)
  }
  runtimeOverrides.set(agentId, modelId)
}

export function clearModelOverride(agentId: string): void {
  runtimeOverrides.delete(agentId)
}

// ---------------------------------------------------------------------------
// Main routing function
// This is the SINGLE point where model selection happens.
// ---------------------------------------------------------------------------

export function resolveModelForAgent(ctx: ModelRoutingContext): ModelRoutingDecision {
  const { agentId, taskType, requiresComplex, override } = ctx

  // 1. Explicit override (from Neb command)
  if (override) {
    const model = MODELS[override]
    if (!model) throw new Error(`Unknown override model: ${override}`)
    return {
      model,
      source: 'explicit_override',
      reason: `Explicit override requested for ${agentId}: ${override}`,
    }
  }

  // 2. Runtime override (from /assign_model)
  const runtimeOverride = runtimeOverrides.get(agentId)
  if (runtimeOverride) {
    const model = MODELS[runtimeOverride]
    if (model && model.is_active) {
      return {
        model,
        source: 'runtime_override',
        reason: `Runtime override active for ${agentId}: ${runtimeOverride}`,
      }
    }
  }

  // 3. Agent assignment/default
  const defaultModelId = AGENT_MODEL_DEFAULTS[agentId]
  if (defaultModelId) {
    const model = MODELS[defaultModelId]
    if (model && model.is_active) {
      return {
        model,
        source: 'agent_assignment',
        reason: `Agent assignment/default for ${agentId}: ${defaultModelId}`,
      }
    }
  }

  // 4. Task type fallback
  if (taskType) {
    if (COMPLEX_TASK_TYPES.has(taskType) || requiresComplex === true) {
      return {
        model: MODELS['nemotron-120b']!,
        source: 'task_type_fallback',
        reason: `Task ${taskType} requires complex reasoning`,
      }
    }
    if (SIMPLE_TASK_TYPES.has(taskType)) {
      return {
        model: MODELS['step-flash']!,
        source: 'task_type_fallback',
        reason: `Task ${taskType} routed to low-cost/simple fallback`,
      }
    }
  }

  // 5. Global fallback
  return {
    model: MODELS['step-flash']!,
    source: 'global_fallback',
    reason: `No assignment or task-type fallback found for ${agentId}`,
  }
}

export function getModelForAgent(ctx: ModelRoutingContext): ModelConfig {
  return resolveModelForAgent(ctx).model
}

// ---------------------------------------------------------------------------
// Cost calculation helper
// ---------------------------------------------------------------------------

export function estimateCost(
  model: ModelConfig,
  tokensInput: number,
  tokensOutput: number
): number {
  return (
    (tokensInput / 1000) * model.cost_per_1k_input_tokens +
    (tokensOutput / 1000) * model.cost_per_1k_output_tokens
  )
}

export function getModelById(id: string): ModelConfig {
  const model = MODELS[id]
  if (!model) throw new Error(`Model not found: ${id}`)
  return model
}
