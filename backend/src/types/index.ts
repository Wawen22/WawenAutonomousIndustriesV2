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

export type ModelProvider = 'azure' | 'google' | 'openai' | 'openrouter' | 'local'

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
  project_id: string | null
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
  assignee_agent_id?: string | undefined
  delegator_agent_id?: string | undefined
  parent_task_id?: string | undefined
  project_id?: string | undefined
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

export interface AgentMemory {
  id: string
  agent_id: string
  content: string
  created_at: string
  ttl: string | null
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
  | 'task_unblocked'
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
  | 'project_delivered'
  | 'revenue_recorded'
  | 'payment_received'
  | 'ops_alert'
  | 'finance_report_generated'
  | 'hr_digest_generated'

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

// --- Clients ---

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

export interface CreateClientInput {
  name: string
  slug: string
  email?: string | undefined
  phone?: string | undefined
  status?: ClientStatus
  metadata?: Record<string, unknown>
}

// --- Projects ---

export type ProjectType =
  | 'website'
  | 'app'
  | 'saas'
  | 'consulting'
  | 'ai'
  | 'marketing'
  | 'content'
  | 'copywriting'
  | 'design'
  | 'automation'
  | 'other'

export type RepoProvider = 'github' | 'gitlab' | 'bitbucket' | 'other'

export type ProjectStatus =
  | 'discovery'
  | 'active'
  | 'paused'
  | 'review'
  | 'blocked'
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
  repo_url: string | null
  repo_local_path: string | null
  repo_default_branch: string | null
  repo_provider: RepoProvider | null
  contract_value_usd: number
  metadata: Record<string, unknown>
  created_at: string
}

export interface CreateProjectInput {
  client_id: string
  name: string
  slug: string
  type?: ProjectType
  status?: ProjectStatus
  workspace_path?: string | undefined
  repo_url?: string | undefined
  repo_local_path?: string | undefined
  repo_default_branch?: string | undefined
  repo_provider?: RepoProvider | undefined
  contract_value_usd?: number
  metadata?: Record<string, unknown>
}

export interface UpdateProjectRepoInput {
  repo_url?: string | undefined
  repo_local_path?: string | undefined
  repo_default_branch?: string | undefined
  repo_provider?: RepoProvider | undefined
}

// --- Payments ---

export interface Payment {
  id: string
  project_id: string
  amount_usd: number
  currency: string
  notes: string | null
  received_at: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface CreatePaymentInput {
  project_id: string
  amount_usd: number
  currency?: string | undefined
  notes?: string | undefined
  metadata?: Record<string, unknown>
  received_at?: string | undefined
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

// --- Capabilities ---

export type CapabilityType =
  | 'skill'
  | 'plugin'
  | 'integration'
  | 'memory_provider'
  | 'channel'

export type CapabilityRuntimeTarget =
  | 'personal'
  | 'company'
  | 'shared'

export type CapabilityStatus =
  | 'active'
  | 'beta'
  | 'planned'
  | 'disabled'

export type CapabilityRiskLevel =
  | 'low'
  | 'medium'
  | 'high'

export type CapabilityPolicyMode =
  | 'open'
  | 'restricted'
  | 'approval_required'
  | 'read_only'

export type CapabilityAssignmentTargetType =
  | 'runtime'
  | 'team'
  | 'agent'

export type CapabilityAssignmentState =
  | 'active'
  | 'planned'
  | 'disabled'

export type CapabilityHealthState =
  | 'connected'
  | 'degraded'
  | 'missing_config'
  | 'auth_required'
  | 'failing'
  | 'disabled'

export type CapabilityFreshnessState =
  | 'fresh'
  | 'aging'
  | 'stale'
  | 'unknown'

export interface Capability {
  id: string
  type: CapabilityType
  label: string
  description: string
  owner: string
  runtimeTarget: CapabilityRuntimeTarget
  status: CapabilityStatus
  riskLevel: CapabilityRiskLevel
  tags: string[]
  dependsOn: string[]
  isPlaceholder: boolean
  // T084 – skill-specific metadata (optional, present when type === 'skill')
  usageInstructions?: string
  examples?: string[]
}

export interface CapabilityAssignment {
  capabilityId: string
  targetType: CapabilityAssignmentTargetType
  targetId: string
  label: string
  runtimeTarget: CapabilityRuntimeTarget
  state: CapabilityAssignmentState
  notes?: string
}

export interface CapabilityPolicy {
  capabilityId: string
  mode: CapabilityPolicyMode
  allowedTools: string[]
  envRequirements: string[]
  restrictedPaths: string[]
  notes?: string
}

export interface CapabilityHealth {
  capabilityId: string
  state: CapabilityHealthState
  label: string
  message: string
  checkedAt: string
  missingRequirements: string[]
  // T099 – health depth
  freshness?: CapabilityFreshnessState
  lastSuccessAt?: string
  lastFailedAt?: string
  driftWarnings?: string[]
  reasonCode?: string
  details?: string[]
}

export interface CapabilityAuditSummary {
  capabilityId: string
  lastChangedAt?: string
  lastChangedBy?: string
  lastSuccessfulAt?: string
  lastFailedAt?: string
  lastUsedAt?: string
  summary?: string
}

export interface CapabilityCatalogEntry {
  capability: Capability
  assignments: CapabilityAssignment[]
  policy: CapabilityPolicy
  health: CapabilityHealth
  audit: CapabilityAuditSummary
}

export type CapabilityEventType =
  | 'used'
  | 'succeeded'
  | 'failed'
  | 'configured'
  | 'enabled'
  | 'disabled'
  | 'auth_started'
  | 'auth_completed'

export type CapabilityEventActorType =
  | 'founder'
  | 'agent'
  | 'system'
  | 'dashboard'
  | 'runtime'

export interface CapabilityEvent {
  id: string
  capability_id: string
  event_type: CapabilityEventType
  actor_type: CapabilityEventActorType
  actor_id: string | null
  source: string
  summary: string
  payload: Record<string, unknown>
  created_at: string
}

export interface LogCapabilityEventInput {
  capability_id: string
  event_type: CapabilityEventType
  actor_type: CapabilityEventActorType
  actor_id?: string
  source: string
  summary: string
  payload?: Record<string, unknown>
}

export interface CapabilityRegistrySummary {
  total: number
  byType: Record<CapabilityType, number>
  byRuntimeTarget: Record<CapabilityRuntimeTarget, number>
  byHealth: Record<CapabilityHealthState, number>
}

export interface CapabilityRegistrySnapshot {
  generatedAt: string
  catalog: CapabilityCatalogEntry[]
  assignments: CapabilityAssignment[]
  summary: CapabilityRegistrySummary
  recentEvents: CapabilityEvent[]
}

// --- Skill Runner (T100) ---

export interface SkillRunResult {
  skillId: string
  output: string
  runId: string | null
  durationMs: number
}

// --- WhatsApp Channel (T101) ---

export type WhatsAppState = 'connected' | 'qr_pending' | 'offline'

export interface WhatsAppStatus {
  state: WhatsAppState
  /** Base64 data URL (PNG) of the QR code to scan — present only when state === 'qr_pending' */
  qrCode?: string
  /** Phone number of the connected account — present only when state === 'connected' */
  connectedPhone?: string
}
