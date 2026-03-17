// ============================================================
// WAI – Shared TypeScript Types
// ============================================================

// --- Agents ---

export type AgentStatus = 'online' | 'offline' | 'error' | 'busy'

export type AgentTeam =
  | 'executive'
  | 'saas'
  | 'dev'
  | 'consulting'
  | 'marketing'
  | 'ops'

export interface AgentConfig {
  tools: string[]
  permissions: AgentPermissions
  maxCostPerTaskUsd: number
  thinkingLevel?: 'low' | 'medium' | 'high'
}

export interface AgentPermissions {
  canReadAllTasks: boolean
  canWriteTasks: boolean
  canWriteEvents: boolean
  canUseShell: boolean
  canUseGitHub: boolean
  canSendEmail: boolean
  canSendTelegram: boolean
  canChangeModels: boolean
}

export interface Agent {
  id: string
  name: string
  role: string
  team: AgentTeam
  model_id: string
  status: AgentStatus
  config: AgentConfig
  created_at: string
  updated_at: string
}

// --- Models ---

export type ModelProvider = 'azure' | 'google' | 'openai' | 'local'

export interface ModelConfig {
  id: string
  provider: ModelProvider
  display_name: string
  cost_per_1k_input_tokens: number
  cost_per_1k_output_tokens: number
  context_window: number
  is_active: boolean
  notes?: string
}

// --- Tasks ---

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked' | 'cancelled'

export type TaskType =
  | 'dev'
  | 'dev_complex'
  | 'dev_simple'
  | 'marketing'
  | 'content'
  | 'consulting'
  | 'analysis'
  | 'ops'
  | 'finance'
  | 'hr'
  | 'strategy'
  | 'architecture'
  | 'planning'
  | 'support'
  | 'routing'

export type TaskPriority = 1 | 2 | 3 | 4 | 5

export interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  type: TaskType
  priority: TaskPriority
  assignee_agent_id: string | null
  delegator_agent_id: string | null
  parent_task_id: string | null
  requires_human_review: boolean
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface CreateTaskInput {
  title: string
  description: string
  type: TaskType
  priority?: TaskPriority
  assignee_agent_id?: string
  delegator_agent_id?: string
  parent_task_id?: string
  requires_human_review?: boolean
  metadata?: Record<string, unknown>
}

// --- Runs ---

export type RunOutcome = 'success' | 'failure' | 'partial'

export interface AgentRun {
  id: string
  agent_id: string
  task_id: string | null
  model_id: string
  input_summary: string
  output_summary: string
  tokens_input: number
  tokens_output: number
  cost_usd: number
  tools_used: string[]
  outcome: RunOutcome
  error_message: string | null
  duration_ms: number
  created_at: string
}

export interface LogRunInput {
  agent_id: string
  task_id?: string
  model_id: string
  input_summary: string
  output_summary: string
  tokens_input: number
  tokens_output: number
  tools_used?: string[]
  outcome: RunOutcome
  error_message?: string
  duration_ms: number
}

// --- Events ---

export type EventSeverity = 'info' | 'warning' | 'error' | 'critical'

export type EventType =
  | 'task_created'
  | 'task_assigned'
  | 'task_started'
  | 'task_completed'
  | 'task_blocked'
  | 'agent_online'
  | 'agent_offline'
  | 'agent_error'
  | 'model_changed'
  | 'model_failover'
  | 'budget_alert'
  | 'budget_exceeded'
  | 'human_review_requested'
  | 'human_approved'
  | 'human_rejected'
  | 'run_completed'
  | 'run_failed'
  | 'system_startup'
  | 'system_shutdown'
  | 'founder_command'

export interface SystemEvent {
  id: string
  type: EventType
  agent_id: string | null
  task_id: string | null
  payload: Record<string, unknown>
  severity: EventSeverity
  created_at: string
}

export interface LogEventInput {
  type: EventType
  agent_id?: string
  task_id?: string
  payload?: Record<string, unknown>
  severity?: EventSeverity
}

// --- Project State ---

export interface ProjectState {
  id: number
  version: string
  phase: 'local' | 'hetzner' | 'mini_pc'
  active_agents_count: number
  monthly_cost_usd: number
  monthly_budget_usd: number
  total_tasks_done: number
  current_milestone: string
  last_updated: string
  metadata: Record<string, unknown>
}

// --- Telegram ---

export interface FounderCommand {
  command: string
  args: string[]
  rawText: string
  timestamp: string
}

// --- Model Routing ---

export interface ModelRoutingContext {
  agentId: string
  taskType?: TaskType
  estimatedTokens?: number
  requiresComplex?: boolean
  override?: string
}
