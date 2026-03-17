// ============================================================
// WAI – Supabase Service
// Typed query helpers. Always use service_role key server-side.
// ============================================================

import { createClient } from '@supabase/supabase-js'
import type {
  Agent,
  AgentRun,
  AgentStatus,
  CreateTaskInput,
  LogEventInput,
  LogRunInput,
  ModelConfig,
  ProjectState,
  SystemEvent,
  Task,
  TaskStatus,
} from '../types/index.js'
import { estimateCost, getModelById } from '../config/models.js'

// ---------------------------------------------------------------------------
// Client (singleton)
// ---------------------------------------------------------------------------

function createSupabaseClient() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables')
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  })
}

let _client: ReturnType<typeof createSupabaseClient> | null = null

export function getSupabaseClient() {
  if (!_client) {
    _client = createSupabaseClient()
  }
  return _client
}

// ---------------------------------------------------------------------------
// Agent Queries
// ---------------------------------------------------------------------------

export async function getAgents(): Promise<Agent[]> {
  const { data, error } = await getSupabaseClient()
    .from('agents')
    .select('*')
    .order('team')

  if (error) throw new Error(`Failed to get agents: ${error.message}`)
  return data as Agent[]
}

export async function getAgent(id: string): Promise<Agent | null> {
  const { data, error } = await getSupabaseClient()
    .from('agents')
    .select('*')
    .eq('id', id)
    .single()

  if (error?.code === 'PGRST116') return null
  if (error) throw new Error(`Failed to get agent ${id}: ${error.message}`)
  return data as Agent
}

export async function updateAgentStatus(id: string, status: AgentStatus): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('agents')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw new Error(`Failed to update agent status: ${error.message}`)
}

export async function updateAgentModel(id: string, modelId: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('agents')
    .update({ model_id: modelId, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw new Error(`Failed to update agent model: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Task Queries
// ---------------------------------------------------------------------------

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const { data, error } = await getSupabaseClient()
    .from('tasks')
    .insert({
      ...input,
      status: 'todo',
      priority: input.priority ?? 3,
      requires_human_review: input.requires_human_review ?? false,
      metadata: input.metadata ?? {},
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create task: ${error.message}`)
  return data as Task
}

export async function updateTaskStatus(id: string, status: TaskStatus): Promise<void> {
  const updates: Partial<Task> = {
    status,
    updated_at: new Date().toISOString(),
  }

  if (status === 'done') {
    updates.completed_at = new Date().toISOString()
  }

  const { error } = await getSupabaseClient()
    .from('tasks')
    .update(updates)
    .eq('id', id)

  if (error) throw new Error(`Failed to update task status: ${error.message}`)
}

export async function getTasksByStatus(status: TaskStatus): Promise<Task[]> {
  const { data, error } = await getSupabaseClient()
    .from('tasks')
    .select('*')
    .eq('status', status)
    .order('priority')
    .order('created_at')

  if (error) throw new Error(`Failed to get tasks: ${error.message}`)
  return data as Task[]
}

export async function assignTask(taskId: string, agentId: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('tasks')
    .update({
      assignee_agent_id: agentId,
      status: 'in_progress',
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId)

  if (error) throw new Error(`Failed to assign task: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Run Logging
// ---------------------------------------------------------------------------

export async function logRun(input: LogRunInput): Promise<AgentRun> {
  const model = getModelById(input.model_id)
  const cost = estimateCost(model, input.tokens_input, input.tokens_output)

  const { data, error } = await getSupabaseClient()
    .from('runs')
    .insert({
      ...input,
      cost_usd: cost,
      tools_used: input.tools_used ?? [],
      error_message: input.error_message ?? null,
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to log run: ${error.message}`)
  return data as AgentRun
}

// ---------------------------------------------------------------------------
// Event Logging
// ---------------------------------------------------------------------------

export async function logEvent(input: LogEventInput): Promise<SystemEvent> {
  const { data, error } = await getSupabaseClient()
    .from('events')
    .insert({
      type: input.type,
      agent_id: input.agent_id ?? null,
      task_id: input.task_id ?? null,
      payload: input.payload ?? {},
      severity: input.severity ?? 'info',
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to log event: ${error.message}`)
  return data as SystemEvent
}

export async function getRecentEvents(limit = 50): Promise<SystemEvent[]> {
  const { data, error } = await getSupabaseClient()
    .from('events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Failed to get events: ${error.message}`)
  return data as SystemEvent[]
}

// ---------------------------------------------------------------------------
// Cost / Budget Queries
// ---------------------------------------------------------------------------

export async function getMonthlyCost(): Promise<number> {
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const { data, error } = await getSupabaseClient()
    .from('runs')
    .select('cost_usd')
    .gte('created_at', startOfMonth.toISOString())

  if (error) throw new Error(`Failed to get monthly cost: ${error.message}`)

  return (data as Array<{ cost_usd: number }>).reduce((sum, row) => sum + (row.cost_usd ?? 0), 0)
}

export async function getCostByModel(): Promise<Array<{ model_id: string; total_cost: number }>> {
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const { data, error } = await getSupabaseClient()
    .from('runs')
    .select('model_id, cost_usd')
    .gte('created_at', startOfMonth.toISOString())

  if (error) throw new Error(`Failed to get costs by model: ${error.message}`)

  const grouped = new Map<string, number>()
  for (const row of data as Array<{ model_id: string; cost_usd: number }>) {
    grouped.set(row.model_id, (grouped.get(row.model_id) ?? 0) + (row.cost_usd ?? 0))
  }

  return Array.from(grouped.entries()).map(([model_id, total_cost]) => ({ model_id, total_cost }))
}

// ---------------------------------------------------------------------------
// Project State
// ---------------------------------------------------------------------------

export async function getProjectState(): Promise<ProjectState | null> {
  const { data, error } = await getSupabaseClient()
    .from('project_state')
    .select('*')
    .eq('id', 1)
    .single()

  if (error?.code === 'PGRST116') return null
  if (error) throw new Error(`Failed to get project state: ${error.message}`)
  return data as ProjectState
}

export async function updateProjectState(updates: Partial<ProjectState>): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('project_state')
    .update({ ...updates, last_updated: new Date().toISOString() })
    .eq('id', 1)

  if (error) throw new Error(`Failed to update project state: ${error.message}`)
}

export async function getModels(): Promise<ModelConfig[]> {
  const { data, error } = await getSupabaseClient()
    .from('models')
    .select('*')
    .eq('is_active', true)

  if (error) throw new Error(`Failed to get models: ${error.message}`)
  return data as ModelConfig[]
}
