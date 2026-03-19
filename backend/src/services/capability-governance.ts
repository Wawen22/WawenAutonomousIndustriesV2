import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  CapabilityAssignmentState,
  CapabilityAssignmentTargetType,
  CapabilityCatalogEntry,
  CapabilityPolicyMode,
} from '../types/index.js'
import { getWorkspaceRoot } from './workspace.js'

interface PersistedCapabilityAssignmentOverride {
  targetType: CapabilityAssignmentTargetType
  targetId: string
  state: CapabilityAssignmentState
  notes?: string
}

interface PersistedCapabilityPolicyOverride {
  mode?: CapabilityPolicyMode
  notes?: string
}

interface PersistedCapabilityGovernanceOverride {
  updated_at: string
  updated_by: string
  policy?: PersistedCapabilityPolicyOverride
  assignments?: PersistedCapabilityAssignmentOverride[]
}

interface PersistedCapabilityGovernanceState {
  capabilities: Record<string, PersistedCapabilityGovernanceOverride>
}

export interface CapabilityGovernanceUpdateInput {
  policyMode?: CapabilityPolicyMode
  policyNotes?: string | null
  assignments?: Array<{
    targetType: CapabilityAssignmentTargetType
    targetId: string
    state: CapabilityAssignmentState
    notes?: string | null
  }>
}

const GOVERNANCE_DIR = join(getWorkspaceRoot(), 'system')
const GOVERNANCE_PATH = join(GOVERNANCE_DIR, 'capability-governance.json')

function emptyState(): PersistedCapabilityGovernanceState {
  return {
    capabilities: {},
  }
}

function normalizeText(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function assignmentKey(input: { targetType: CapabilityAssignmentTargetType; targetId: string }): string {
  return `${input.targetType}:${input.targetId}`
}

async function ensureGovernanceDirectory(): Promise<void> {
  await mkdir(GOVERNANCE_DIR, { recursive: true })
}

export async function readCapabilityGovernanceState(): Promise<PersistedCapabilityGovernanceState> {
  await ensureGovernanceDirectory()

  if (!existsSync(GOVERNANCE_PATH)) {
    return emptyState()
  }

  try {
    const raw = await readFile(GOVERNANCE_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<PersistedCapabilityGovernanceState>
    return {
      capabilities: parsed.capabilities ?? {},
    }
  } catch {
    return emptyState()
  }
}

async function writeCapabilityGovernanceState(
  state: PersistedCapabilityGovernanceState,
): Promise<void> {
  await ensureGovernanceDirectory()
  await writeFile(GOVERNANCE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf-8')
}

export async function applyCapabilityGovernanceOverrides(
  catalog: CapabilityCatalogEntry[],
): Promise<CapabilityCatalogEntry[]> {
  const state = await readCapabilityGovernanceState()

  return catalog.map((entry) => {
    const override = state.capabilities[entry.capability.id]
    if (!override) return entry

    const policy = {
      ...entry.policy,
      ...(override.policy?.mode ? { mode: override.policy.mode } : {}),
      ...(override.policy?.notes !== undefined ? { notes: override.policy.notes } : {}),
    }

    const assignmentOverrides = new Map(
      (override.assignments ?? []).map((item) => [assignmentKey(item), item])
    )

    const assignments = entry.assignments.map((assignment) => {
      const assignmentOverride = assignmentOverrides.get(assignmentKey(assignment))
      if (!assignmentOverride) return assignment

      return {
        ...assignment,
        state: assignmentOverride.state,
        ...(assignmentOverride.notes !== undefined ? { notes: assignmentOverride.notes } : {}),
      }
    })

    return {
      ...entry,
      policy,
      assignments,
    }
  })
}

export async function updateCapabilityGovernance(
  capabilityId: string,
  input: CapabilityGovernanceUpdateInput,
  updatedBy: string,
): Promise<void> {
  const state = await readCapabilityGovernanceState()
  const current = state.capabilities[capabilityId]

  const next: PersistedCapabilityGovernanceOverride = {
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
    ...(current?.policy ? { policy: current.policy } : {}),
    ...(current?.assignments ? { assignments: current.assignments } : {}),
  }

  if (input.policyMode !== undefined || input.policyNotes !== undefined) {
    const nextPolicy: PersistedCapabilityPolicyOverride = {
      ...(current?.policy?.mode !== undefined ? { mode: current.policy.mode } : {}),
      ...(current?.policy?.notes !== undefined ? { notes: current.policy.notes } : {}),
    }

    if (input.policyMode !== undefined) {
      nextPolicy.mode = input.policyMode
    }

    if (input.policyNotes !== undefined) {
      const normalizedNotes = normalizeText(input.policyNotes)
      if (normalizedNotes !== undefined) {
        nextPolicy.notes = normalizedNotes
      } else {
        delete nextPolicy.notes
      }
    }

    next.policy = nextPolicy
  }

  if (input.assignments) {
    const deduped = new Map<string, PersistedCapabilityAssignmentOverride>()
    for (const item of input.assignments) {
      const nextAssignment: PersistedCapabilityAssignmentOverride = {
        targetType: item.targetType,
        targetId: item.targetId,
        state: item.state,
      }

      if (item.notes !== undefined) {
        const normalizedNotes = normalizeText(item.notes)
        if (normalizedNotes !== undefined) {
          nextAssignment.notes = normalizedNotes
        }
      }

      deduped.set(assignmentKey(item), nextAssignment)
    }

    next.assignments = Array.from(deduped.values())
  }

  state.capabilities[capabilityId] = next
  await writeCapabilityGovernanceState(state)
}
