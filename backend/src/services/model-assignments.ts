// ============================================================
// WAI – Model Assignments Service
// Persists per-agent model overrides to workspace/system/model-assignments.json
// ============================================================

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getWorkspaceRoot } from './workspace.js'
import { MODELS, setModelOverride, clearModelOverride } from '../config/models.js'

const ASSIGNMENTS_DIR = join(getWorkspaceRoot(), 'system')
const ASSIGNMENTS_PATH = join(ASSIGNMENTS_DIR, 'model-assignments.json')

interface PersistedModelAssignments {
  overrides: Record<string, string>  // agentId -> modelId
  updated_at: string
}

async function loadPersistedAssignments(): Promise<PersistedModelAssignments> {
  if (!existsSync(ASSIGNMENTS_PATH)) {
    return { overrides: {}, updated_at: new Date().toISOString() }
  }
  try {
    const raw = await readFile(ASSIGNMENTS_PATH, 'utf-8')
    return JSON.parse(raw) as PersistedModelAssignments
  } catch {
    return { overrides: {}, updated_at: new Date().toISOString() }
  }
}

async function savePersistedAssignments(data: PersistedModelAssignments): Promise<void> {
  if (!existsSync(ASSIGNMENTS_DIR)) {
    await mkdir(ASSIGNMENTS_DIR, { recursive: true })
  }
  await writeFile(ASSIGNMENTS_PATH, JSON.stringify(data, null, 2), 'utf-8')
}

// Called once at startup to restore persisted overrides into the in-memory map
export async function restorePersistedModelAssignments(): Promise<void> {
  const data = await loadPersistedAssignments()
  for (const [agentId, modelId] of Object.entries(data.overrides)) {
    if (modelId in MODELS) {
      setModelOverride(agentId, modelId)
    }
  }
}

// Assign a model to an agent — persists to disk and updates in-memory routing
export async function assignModelToAgent(agentId: string, modelId: string): Promise<void> {
  if (!(modelId in MODELS)) {
    throw new Error(`Unknown model: ${modelId}`)
  }

  setModelOverride(agentId, modelId)

  const data = await loadPersistedAssignments()
  data.overrides[agentId] = modelId
  data.updated_at = new Date().toISOString()
  await savePersistedAssignments(data)
}

// Reset an agent to its default model
export async function resetAgentModelAssignment(agentId: string): Promise<void> {
  clearModelOverride(agentId)

  const data = await loadPersistedAssignments()
  delete data.overrides[agentId]
  data.updated_at = new Date().toISOString()
  await savePersistedAssignments(data)
}

// Return current persisted overrides map
export async function getPersistedModelOverrides(): Promise<Record<string, string>> {
  const data = await loadPersistedAssignments()
  return data.overrides
}
