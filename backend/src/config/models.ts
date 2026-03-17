// ============================================================
// WAI – Model Registry and Routing
// Single point of truth for all model decisions.
// ============================================================

import type { ModelConfig, ModelRoutingContext, TaskType } from '../types/index.js'

// ---------------------------------------------------------------------------
// Model Registry
// Keep in sync with Supabase `models` table (seed.sql)
// ---------------------------------------------------------------------------

export const MODELS: Record<string, ModelConfig> = {
  'gpt-5.4': {
    id: 'gpt-5.4',
    provider: 'azure',
    display_name: 'GPT-5.4 (Azure Foundry)',
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
    cost_per_1k_input_tokens: 0.00035,
    cost_per_1k_output_tokens: 0.00105,
    context_window: 1000000,
    is_active: true,
    notes: 'Fast, low-latency operations, marketing, support, routing',
  },
}

// ---------------------------------------------------------------------------
// Default model per agent ID
// Override via Supabase agents.model_id or Neb's /assign_model command
// ---------------------------------------------------------------------------

const AGENT_MODEL_DEFAULTS: Record<string, string> = {
  // Executive
  ceo: 'gpt-5.4',

  // Team SaaS
  pm_saas: 'gpt-5.4',
  dev_lead_saas: 'gpt-5.4',
  dev_saas_1: 'gpt-5.4',
  dev_saas_2: 'gemini-2.5-flash',

  // Team Dev
  architect: 'gpt-5.4',
  dev_general_1: 'gpt-5.4',
  dev_general_2: 'gemini-2.5-flash',
  qa: 'gemini-2.5-flash',

  // Team Consulting
  consulting_lead: 'gpt-5.4',
  analyst: 'gpt-5.4',

  // Team Marketing
  marketing_strategist: 'gpt-5.4',
  content_creator: 'gemini-2.5-flash',
  social_manager: 'gemini-2.5-flash',

  // Team Ops/Finance/HR
  ops: 'gemini-2.5-flash',
  finance: 'gpt-5.4',
  hr: 'gemini-2.5-flash',
}

// ---------------------------------------------------------------------------
// Task type → model preference
// Used when agent default is overrideable by task complexity
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
  'hr',
])

// ---------------------------------------------------------------------------
// Runtime model overrides (from /assign_model command)
// Stored in memory; also persisted to Supabase agents.model_id
// ---------------------------------------------------------------------------

const runtimeOverrides = new Map<string, string>()

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

export function getModelForAgent(ctx: ModelRoutingContext): ModelConfig {
  const { agentId, taskType, requiresComplex, override } = ctx

  // 1. Explicit override (from Neb command)
  if (override) {
    const model = MODELS[override]
    if (!model) throw new Error(`Unknown override model: ${override}`)
    return model
  }

  // 2. Runtime override (from /assign_model)
  const runtimeOverride = runtimeOverrides.get(agentId)
  if (runtimeOverride) {
    const model = MODELS[runtimeOverride]
    if (model && model.is_active) return model
  }

  // 3. Task type routing
  if (taskType) {
    if (COMPLEX_TASK_TYPES.has(taskType) || requiresComplex === true) {
      return MODELS['gpt-5.4']!
    }
    if (SIMPLE_TASK_TYPES.has(taskType) && requiresComplex !== true) {
      return MODELS['gemini-2.5-flash']!
    }
  }

  // 4. Agent default
  const defaultModelId = AGENT_MODEL_DEFAULTS[agentId]
  if (defaultModelId) {
    const model = MODELS[defaultModelId]
    if (model && model.is_active) return model
  }

  // 5. Fallback
  return MODELS['gemini-2.5-flash']!
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
