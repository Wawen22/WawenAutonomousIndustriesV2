import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { MODELS } from '../config/models.js'
import { getWorkspaceRoot } from './workspace.js'

export type SpecialModelOverrideId = 'repo_edit_planning' | 'llm_primary_failure_fallback'

export interface SpecialModelOverrideDefinition {
  id: SpecialModelOverrideId
  scope: string
  agents: string[]
  reason: string
  model_id: string | null
  unset_label: string
}

interface PersistedModelRoutingPolicy {
  specialOverrides: Partial<Record<SpecialModelOverrideId, string | null>>
  updated_at: string
}

const POLICY_DIR = join(getWorkspaceRoot(), 'system')
const POLICY_PATH = join(POLICY_DIR, 'model-routing-policy.json')

const SPECIAL_OVERRIDE_DEFINITIONS: Record<SpecialModelOverrideId, Omit<SpecialModelOverrideDefinition, 'model_id' | 'unset_label'>> = {
  repo_edit_planning: {
    id: 'repo_edit_planning',
    scope: 'Repo-aware code generation and edit planning',
    agents: ['devops_engineer', 'dev_general', 'ai_engineer', 'automation_specialist', 'dev_saas_1', 'dev_saas_2'],
    reason: 'Leave this on inherit unless you explicitly want one model forced for large structured repo edits.',
  },
  llm_primary_failure_fallback: {
    id: 'llm_primary_failure_fallback',
    scope: 'Primary LLM failure fallback',
    agents: ['all_agents'],
    reason: 'If set, WAI will try this model only after the chosen primary model fails completely. Leave disabled unless you want an explicit second-chance model.',
  },
}

function defaultPolicy(): PersistedModelRoutingPolicy {
  return {
    specialOverrides: {
      repo_edit_planning: null,
      llm_primary_failure_fallback: null,
    },
    updated_at: new Date().toISOString(),
  }
}

async function savePolicy(policy: PersistedModelRoutingPolicy): Promise<void> {
  if (!existsSync(POLICY_DIR)) {
    await mkdir(POLICY_DIR, { recursive: true })
  }
  await writeFile(POLICY_PATH, JSON.stringify(policy, null, 2), 'utf-8')
}

export async function getModelRoutingPolicy(): Promise<PersistedModelRoutingPolicy> {
  if (!existsSync(POLICY_PATH)) {
    const policy = defaultPolicy()
    await savePolicy(policy)
    return policy
  }

  try {
    const raw = await readFile(POLICY_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as PersistedModelRoutingPolicy
    return {
      specialOverrides: {
        ...defaultPolicy().specialOverrides,
        ...(parsed.specialOverrides ?? {}),
      },
      updated_at: parsed.updated_at ?? new Date().toISOString(),
    }
  } catch {
    const policy = defaultPolicy()
    await savePolicy(policy)
    return policy
  }
}

export async function getSpecialModelOverrides(): Promise<SpecialModelOverrideDefinition[]> {
  const policy = await getModelRoutingPolicy()
  return Object.values(SPECIAL_OVERRIDE_DEFINITIONS).map((definition) => ({
    ...definition,
    model_id: policy.specialOverrides[definition.id] ?? null,
    unset_label: definition.id === 'repo_edit_planning' ? 'Inherit agent assignment' : 'Disabled',
  }))
}

export async function getSpecialModelOverride(id: SpecialModelOverrideId): Promise<string | null> {
  const policy = await getModelRoutingPolicy()
  return policy.specialOverrides[id] ?? null
}

export async function updateSpecialModelOverride(
  id: SpecialModelOverrideId,
  modelId: string | null
): Promise<SpecialModelOverrideDefinition> {
  if (!(id in SPECIAL_OVERRIDE_DEFINITIONS)) {
    throw new Error(`Unknown special override id: ${id}`)
  }

  if (modelId !== null && !(modelId in MODELS)) {
    throw new Error(`Unknown model: ${modelId}`)
  }

  const policy = await getModelRoutingPolicy()
  policy.specialOverrides[id] = modelId
  policy.updated_at = new Date().toISOString()
  await savePolicy(policy)

  const definition = SPECIAL_OVERRIDE_DEFINITIONS[id]
  return {
    ...definition,
    model_id: modelId,
    unset_label: definition.id === 'repo_edit_planning' ? 'Inherit agent assignment' : 'Disabled',
  }
}
