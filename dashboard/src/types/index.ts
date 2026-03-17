// ============================================================
// WAI Dashboard – TypeScript Types
// Keep in sync with backend/src/types/index.ts
// ============================================================

export type AgentStatus = 'online' | 'offline' | 'error' | 'busy'

export type AgentTeam =
  | 'executive'
  | 'saas'
  | 'dev'
  | 'consulting'
  | 'marketing'
  | 'ops'

export interface Agent {
  id: string
  name: string
  role: string
  team: AgentTeam
  model_id: string
  status: AgentStatus
  config: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked' | 'cancelled'

export type TaskPriority = 1 | 2 | 3 | 4 | 5

export interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  type: string
  priority: TaskPriority
  assignee_agent_id: string | null
  delegator_agent_id: string | null
  parent_task_id: string | null
  project_id: string | null
  requires_human_review: boolean
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  completed_at: string | null
}

export type ClientStatus = 'prospect' | 'active' | 'completed' | 'archived'

export interface Client {
  id: string
  name: string
  slug: string
  email: string | null
  phone: string | null
  status: ClientStatus
  metadata: Record<string, unknown>
  created_at: string
}

export type ProjectType = 'website' | 'app' | 'consulting' | 'marketing' | 'other'

export type ProjectStatus =
  | 'discovery'
  | 'active'
  | 'paused'
  | 'review'
  | 'delivered'
  | 'invoiced'

export interface Project {
  id: string
  client_id: string
  name: string
  slug: string
  type: ProjectType
  status: ProjectStatus
  workspace_path: string | null
  contract_value_usd: number
  metadata: Record<string, unknown>
  created_at: string
}

export type EventSeverity = 'info' | 'warning' | 'error' | 'critical'

export interface SystemEvent {
  id: string
  type: string
  agent_id: string | null
  task_id: string | null
  payload: Record<string, unknown>
  severity: EventSeverity
  created_at: string
}

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
  outcome: 'success' | 'failure' | 'partial'
  error_message: string | null
  duration_ms: number
  created_at: string
}

export interface ProjectState {
  id: number
  version: string
  phase: string
  active_agents_count: number
  monthly_cost_usd: number
  monthly_budget_usd: number
  total_tasks_done: number
  current_milestone: string
  last_updated: string
  metadata: Record<string, unknown>
}

export interface ModelConfig {
  id: string
  provider: string
  display_name: string
  cost_per_1k_input_tokens: number
  cost_per_1k_output_tokens: number
  context_window: number
  is_active: boolean
}
