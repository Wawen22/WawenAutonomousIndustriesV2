// ============================================================
// WAI – Supabase Service
// Typed query helpers. Always use service_role key server-side.
// ============================================================

import { createClient as createSupabaseSdkClient } from '@supabase/supabase-js'
import type {
  Agent,
  AgentRun,
  AgentStatus,
  CapabilityEvent,
  Client,
  CreateClientInput,
  CreatePaymentInput,
  CreateProjectInput,
  CreateTaskInput,
  LogCapabilityEventInput,
  LogEventInput,
  LogRunInput,
  ModelConfig,
  Payment,
  Project,
  RepoProvider,
  ProjectStatus,
  ProjectState,
  SystemEvent,
  Task,
  TaskStatus,
  UpdateProjectRepoInput,
} from '../types/index.js'
import { estimateCost, getModelById } from '../config/models.js'
import { sendNotification } from './notification-router.js'

// ---------------------------------------------------------------------------
// Client (singleton)
// ---------------------------------------------------------------------------

function createSupabaseClient() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables')
  }

  return createSupabaseSdkClient(url, key, {
    auth: { persistSession: false },
  })
}

function isMissingRelationError(error: { code?: string; message?: string } | null | undefined, relation: string): boolean {
  if (!error) return false
  return error.code === '42P01' || error.message?.toLowerCase().includes(relation) === true
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

export async function upsertAgentRecord(agent: {
  id: string
  name: string
  role: string
  team: string
  model_id: string
  config: Record<string, unknown>
}): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('agents')
    .upsert(
      {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        team: agent.team,
        model_id: agent.model_id,
        config: agent.config,
        status: 'online',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id', ignoreDuplicates: false }
    )

  if (error) throw new Error(`Failed to upsert agent ${agent.id}: ${error.message}`)
}

export async function upsertModelRecord(model: {
  id: string
  display_name: string
  provider: string
  context_window: number
  cost_per_1k_input_tokens: number
  cost_per_1k_output_tokens: number
  is_active: boolean
  notes?: string
}): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('models')
    .upsert(
      {
        id: model.id,
        display_name: model.display_name,
        provider: model.provider,
        context_window: model.context_window,
        cost_per_1k_input_tokens: model.cost_per_1k_input_tokens,
        cost_per_1k_output_tokens: model.cost_per_1k_output_tokens,
        is_active: model.is_active,
        notes: model.notes ?? null,
      },
      { onConflict: 'id', ignoreDuplicates: false }
    )

  if (error) throw new Error(`Failed to upsert model ${model.id}: ${error.message}`)
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
  const task = data as Task

  // Emit human_review_requested event so the Founder Ops inbox surfaces the task
  if (task.requires_human_review) {
    void sendNotification(
      `👀 *Human Review Required*\n\n` +
      `Task: ${task.title}\n` +
      `Agent: ${task.assignee_agent_id ?? 'n/a'}\n` +
      `ID: \`${task.id.slice(0, 8)}\`\n\n` +
      `Use \`/approve ${task.id.slice(0, 8)}\` o \`/reject ${task.id.slice(0, 8)}\` per rispondere.`,
      { priority: 'high', tag: `review_${task.id}` }
    ).catch(() => {})

    void getSupabaseClient()
      .from('events')
      .insert({
        type: 'human_review_requested',
        agent_id: input.delegator_agent_id && input.delegator_agent_id !== 'founder' ? input.delegator_agent_id : null,
        task_id: task.id,
        payload: {
          title: task.title,
          assignee: task.assignee_agent_id,
          delegator: input.delegator_agent_id ?? null,
        },
        severity: 'info',
      })
      .then(({ error: evErr }) => {
        if (evErr) console.warn('[supabase] human_review_requested event insert failed:', evErr.message)
      })
  }

  return task
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

export async function transitionTaskStatus(
  id: string,
  fromStatus: TaskStatus,
  toStatus: TaskStatus
): Promise<boolean> {
  const updates: Partial<Task> = {
    status: toStatus,
    updated_at: new Date().toISOString(),
  }

  if (toStatus === 'done') {
    updates.completed_at = new Date().toISOString()
  }

  const { data, error } = await getSupabaseClient()
    .from('tasks')
    .update(updates)
    .eq('id', id)
    .eq('status', fromStatus)
    .select('id')

  if (error) throw new Error(`Failed to transition task status: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}

export async function getTaskById(id: string): Promise<Task | null> {
  const { data, error } = await getSupabaseClient()
    .from('tasks')
    .select('*')
    .eq('id', id)
    .single()

  if (error?.code === 'PGRST116') return null
  if (error) throw new Error(`Failed to get task ${id}: ${error.message}`)
  return data as Task
}

export async function getTaskByReference(reference: string): Promise<Task | null> {
  const normalized = reference.trim().toLowerCase()
  if (!normalized) return null

  if (/^[0-9a-f-]{36}$/.test(normalized)) {
    return getTaskById(normalized)
  }

  // Supabase stores `tasks.id` as UUID, so SQL LIKE/ILIKE prefix matching is not
  // available directly on the column without an explicit cast. Resolve short IDs
  // client-side from a recent task window instead.
  const { data, error } = await getSupabaseClient()
    .from('tasks')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) throw new Error(`Failed to resolve task reference ${reference}: ${error.message}`)

  const matches = ((data ?? []) as Task[]).filter((task) => task.id.toLowerCase().startsWith(normalized))
  if (matches.length === 0) return null
  if (matches.length > 1) {
    throw new Error(`Task reference ${reference} is ambiguous; use a longer ID`)
  }
  return matches[0] ?? null
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

export async function getInProgressTasksByProject(projectId: string): Promise<Task[]> {
  const { data, error } = await getSupabaseClient()
    .from('tasks')
    .select('*')
    .eq('project_id', projectId)
    .eq('status', 'in_progress')
    .order('created_at')

  if (error) throw new Error(`Failed to get in-progress tasks for project ${projectId}: ${error.message}`)
  return data as Task[]
}

export async function getChildTasks(parentTaskId: string): Promise<Task[]> {
  const { data, error } = await getSupabaseClient()
    .from('tasks')
    .select('*')
    .eq('parent_task_id', parentTaskId)
    .order('created_at')

  if (error) throw new Error(`Failed to get child tasks for ${parentTaskId}: ${error.message}`)
  return data as Task[]
}

export async function updateTaskRequiresHumanReview(taskId: string, value: boolean): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('tasks')
    .update({ requires_human_review: value, updated_at: new Date().toISOString() })
    .eq('id', taskId)

  if (error) throw new Error(`Failed to update task requires_human_review: ${error.message}`)

  if (value) {
    void getTaskById(taskId).then(task => {
      if (task) {
        void sendNotification(
          `👀 *Human Review Required*\n\n` +
          `Task: ${task.title}\n` +
          `Agent: ${task.assignee_agent_id ?? 'n/a'}\n` +
          `ID: \`${task.id.slice(0, 8)}\`\n\n` +
          `Usa \`/approve ${task.id.slice(0, 8)}\` o \`/reject ${task.id.slice(0, 8)}\` per rispondere.`,
          { priority: 'high', tag: `review_${task.id}` }
        ).catch(() => {})
      }
    }).catch(() => {})
  }
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
// Client Queries
// ---------------------------------------------------------------------------

export async function createClient(input: CreateClientInput): Promise<Client> {
  const { data, error } = await getSupabaseClient()
    .from('clients')
    .insert({
      name: input.name,
      slug: input.slug,
      email: input.email ?? null,
      phone: input.phone ?? null,
      status: input.status ?? 'prospect',
      metadata: input.metadata ?? {},
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create client: ${error.message}`)
  return data as Client
}

export async function getClients(): Promise<Client[]> {
  const { data, error } = await getSupabaseClient()
    .from('clients')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to get clients: ${error.message}`)
  return data as Client[]
}

export async function getClientBySlug(slug: string): Promise<Client | null> {
  const { data, error } = await getSupabaseClient()
    .from('clients')
    .select('*')
    .eq('slug', slug)
    .single()

  if (error?.code === 'PGRST116') return null
  if (error) throw new Error(`Failed to get client ${slug}: ${error.message}`)
  return data as Client
}

export async function findClientFuzzy(query: string): Promise<Client | null> {
  // 1. Try exact slug match first
  const exact = await getClientBySlug(query.toLowerCase())
  if (exact) return exact

  // 2. Load all clients for fuzzy matching
  const allClients = await getClients()
  if (allClients.length === 0) return null

  const target = query.toLowerCase()
  
  // 3. Check for substring match (e.g. "neb" matches "nebili")
  const substringMatch = allClients.find(c => 
    c.slug.includes(target) || target.includes(c.slug) || 
    c.name.toLowerCase().includes(target)
  )
  if (substringMatch) return substringMatch

  // 4. Simple Levenshtein-like check (allow 1-2 char diff)
  // Since we don't have a library, we do a simple char overlap check
  for (const client of allClients) {
    const source = client.slug.toLowerCase()
    if (Math.abs(source.length - target.length) > 3) continue
    
    let diffs = 0
    let i = 0, j = 0
    while (i < source.length && j < target.length) {
      if (source[i] !== target[j]) {
        diffs++
        // Try skipping char in either string to handle insertion/deletion
        if (source[i+1] === target[j]) i++
        else if (source[i] === target[j+1]) j++
      }
      i++
      j++
    }
    
    // Allow max 2 errors for short strings, 3 for long
    const threshold = source.length > 6 ? 3 : 2
    if (diffs <= threshold) return client
  }

  return null
}

export async function getClientById(id: string): Promise<Client | null> {
  const { data, error } = await getSupabaseClient()
    .from('clients')
    .select('*')
    .eq('id', id)
    .single()

  if (error?.code === 'PGRST116') return null
  if (error) throw new Error(`Failed to get client ${id}: ${error.message}`)
  return data as Client
}

// ---------------------------------------------------------------------------
// Project Queries
// ---------------------------------------------------------------------------

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const { data, error } = await getSupabaseClient()
    .from('projects')
    .insert({
      client_id: input.client_id,
      name: input.name,
      slug: input.slug,
      type: input.type ?? 'other',
      status: input.status ?? 'discovery',
      workspace_path: input.workspace_path ?? null,
      repo_url: input.repo_url ?? null,
      repo_local_path: input.repo_local_path ?? null,
      repo_default_branch: input.repo_default_branch ?? null,
      repo_provider: input.repo_provider ?? null,
      contract_value_usd: input.contract_value_usd ?? 0,
      metadata: input.metadata ?? {},
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create project: ${error.message}`)
  return data as Project
}

export async function getProjects(): Promise<Project[]> {
  const { data, error } = await getSupabaseClient()
    .from('projects')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to get projects: ${error.message}`)
  return data as Project[]
}

export async function getProjectById(id: string): Promise<Project | null> {
  const { data, error } = await getSupabaseClient()
    .from('projects')
    .select('*')
    .eq('id', id)
    .single()

  if (error?.code === 'PGRST116') return null
  if (error) throw new Error(`Failed to get project ${id}: ${error.message}`)
  return data as Project
}

export async function getProjectBySlug(clientId: string, slug: string): Promise<Project | null> {
  const { data, error } = await getSupabaseClient()
    .from('projects')
    .select('*')
    .eq('client_id', clientId)
    .eq('slug', slug)
    .single()

  if (error?.code === 'PGRST116') return null
  if (error) throw new Error(`Failed to get project ${slug}: ${error.message}`)
  return data as Project
}

export async function getProjectsByClient(clientSlug: string): Promise<Project[]> {
  const client = await getClientBySlug(clientSlug)
  if (!client) return []

  const { data, error } = await getSupabaseClient()
    .from('projects')
    .select('*')
    .eq('client_id', client.id)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to get projects for client ${clientSlug}: ${error.message}`)
  return data as Project[]
}

export async function updateProjectWorkspacePath(id: string, workspacePath: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('projects')
    .update({ workspace_path: workspacePath })
    .eq('id', id)

  if (error) throw new Error(`Failed to update project workspace path: ${error.message}`)
}

export async function updateProjectStatus(id: string, status: ProjectStatus): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('projects')
    .update({ status })
    .eq('id', id)

  if (error) throw new Error(`Failed to update project status: ${error.message}`)
}

export async function updateProjectContractValue(id: string, contractValueUsd: number): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('projects')
    .update({ contract_value_usd: contractValueUsd })
    .eq('id', id)

  if (error) throw new Error(`Failed to update project contract value: ${error.message}`)
}

export async function updateProjectRepo(id: string, input: UpdateProjectRepoInput): Promise<void> {
  const updates: {
    repo_url?: string | null
    repo_local_path?: string | null
    repo_default_branch?: string | null
    repo_provider?: RepoProvider | null
  } = {}

  if (input.repo_url !== undefined) updates.repo_url = input.repo_url || null
  if (input.repo_local_path !== undefined) updates.repo_local_path = input.repo_local_path || null
  if (input.repo_default_branch !== undefined) updates.repo_default_branch = input.repo_default_branch || null
  if (input.repo_provider !== undefined) updates.repo_provider = input.repo_provider || null

  const { error } = await getSupabaseClient()
    .from('projects')
    .update(updates)
    .eq('id', id)

  if (error) throw new Error(`Failed to update project repo: ${error.message}`)
}

export async function updateProjectMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('projects')
    .update({ metadata })
    .eq('id', id)

  if (error) throw new Error(`Failed to update project metadata: ${error.message}`)
}

export async function updateTaskMetadata(taskId: string, metadata: Record<string, unknown>): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('tasks')
    .update({
      metadata,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId)

  if (error) throw new Error(`Failed to update task metadata: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Payment Queries
// ---------------------------------------------------------------------------

export async function createPayment(input: CreatePaymentInput): Promise<Payment> {
  const { data, error } = await getSupabaseClient()
    .from('payments')
    .insert({
      project_id: input.project_id,
      amount_usd: input.amount_usd,
      currency: input.currency ?? 'USD',
      notes: input.notes ?? null,
      received_at: input.received_at ?? new Date().toISOString(),
      metadata: input.metadata ?? {},
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create payment: ${error.message}`)
  return data as Payment
}

export async function getPayments(): Promise<Payment[]> {
  const { data, error } = await getSupabaseClient()
    .from('payments')
    .select('*')
    .order('received_at', { ascending: false })

  if (error) throw new Error(`Failed to get payments: ${error.message}`)
  return (data ?? []) as Payment[]
}

export async function getPaymentsByProject(projectId: string): Promise<Payment[]> {
  const { data, error } = await getSupabaseClient()
    .from('payments')
    .select('*')
    .eq('project_id', projectId)
    .order('received_at', { ascending: false })

  if (error) throw new Error(`Failed to get payments for project ${projectId}: ${error.message}`)
  return (data ?? []) as Payment[]
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

// ---------------------------------------------------------------------------
// Capability Event Logging
// ---------------------------------------------------------------------------

export async function logCapabilityEvent(
  input: LogCapabilityEventInput,
): Promise<CapabilityEvent | null> {
  const { data, error } = await getSupabaseClient()
    .from('capability_events')
    .insert({
      capability_id: input.capability_id,
      event_type: input.event_type,
      actor_type: input.actor_type,
      actor_id: input.actor_id ?? null,
      source: input.source,
      summary: input.summary,
      payload: input.payload ?? {},
    })
    .select()
    .single()

  if (isMissingRelationError(error, 'capability_events')) {
    return null
  }

  if (error) throw new Error(`Failed to log capability event: ${error.message}`)
  return data as CapabilityEvent
}

export async function getCapabilityEvents(options: {
  capabilityId?: string
  limit?: number
} = {}): Promise<CapabilityEvent[]> {
  const limit = options.limit ?? 100

  let query = getSupabaseClient()
    .from('capability_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (options.capabilityId) {
    query = query.eq('capability_id', options.capabilityId)
  }

  const { data, error } = await query

  if (isMissingRelationError(error, 'capability_events')) {
    return []
  }

  if (error) throw new Error(`Failed to get capability events: ${error.message}`)
  return (data ?? []) as CapabilityEvent[]
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
