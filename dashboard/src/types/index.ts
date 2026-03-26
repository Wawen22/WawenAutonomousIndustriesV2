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

export type DeliveryDeployProvider = 'vercel' | 'netlify' | null

export interface DeliveryConfig {
  gitPush: boolean
  autoDeploy: boolean
  deployProvider: DeliveryDeployProvider
  requireFounderApproval: boolean
  clientEmailOnDelivery: boolean
  autoInvoice: boolean
}

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

export interface AgentMemory {
  id: string
  agent_id: string
  content: string
  entity_type: string
  scope: 'agent' | 'project' | 'client'
  project_id: string | null
  client_id: string | null
  created_at: string
  ttl: string | null
}

export type KnowledgeSourceType = 'note' | 'url' | 'file'

export interface KnowledgeItem {
  id: string
  owner_slug: string
  title: string
  content: string
  source_type: KnowledgeSourceType
  source_url: string | null
  tags: string[]
  created_at: string
  updated_at: string
}

export interface KnowledgeItemMatch extends KnowledgeItem {
  similarity: number
}

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

export interface PersonalProfile {
  ownerSlug: string
  displayName: string
  role: string
  primaryEmail: string | null
  timezone: string
  preferredLanguage: string
  assistantStyle: string
  priorities: string[]
}

export interface PersonalDocumentSummary {
  name: string
  relativePath: string
  modifiedAt: string
  sizeBytes: number
}

export interface McpConnectorStatus {
  id: 'supabase' | 'gmail' | 'google_calendar' | 'google_drive' | 'filesystem'
  label: string
  status: 'ready' | 'missing'
  configured: boolean
  serverName?: string
  transport?: string
  notes: string
}

export interface McpBridgeStatus {
  configPath: string
  configPresent: boolean
  serversConfigured: number
  connectors: McpConnectorStatus[]
}

export type GoogleWorkspaceMcpRuntimeState =
  | 'missing_config'
  | 'offline'
  | 'auth_required'
  | 'connected'
  | 'error'

export interface GoogleWorkspaceToolSummary {
  name: string
  description?: string
}

export interface GoogleWorkspaceMcpRuntimeStatus {
  state: GoogleWorkspaceMcpRuntimeState
  serverName: string
  serverUrl?: string
  redirectUri: string
  userGoogleEmail: string | null
  serverReachable: boolean
  hasTokens: boolean
  hasClientRegistration: boolean
  authorizationUrl?: string
  lastAuthRequestedAt?: string
  lastConnectedAt?: string
  lastError?: string
  toolCount: number
  tools: GoogleWorkspaceToolSummary[]
}

export type PersonalAutomationRunStatus =
  | 'idle'
  | 'running'
  | 'success'
  | 'error'

export interface DailyFounderBriefAutomationStatus {
  id: 'daily_founder_brief'
  label: string
  enabled: boolean
  scheduleLocalTime: string
  timezone: string
  status: PersonalAutomationRunStatus
  lastRunAt?: string
  lastSuccessAt?: string
  lastError?: string
  lastOutputPath?: string
  nextPlannedRunLabel?: string
}

export type WeekDay = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'

export interface HarvestSector {
  query: string
  location: string
  limit?: number
}

export interface WeeklyLeadHarvestAutomationStatus {
  id: 'weekly_lead_harvest'
  label: string
  enabled: boolean
  scheduleDay: WeekDay
  scheduleLocalTime: string
  timezone: string
  sectors: HarvestSector[]
  status: PersonalAutomationRunStatus
  lastRunAt?: string
  lastSuccessAt?: string
  lastError?: string
  lastLeadsFound?: number
  nextPlannedRunLabel?: string
}

export interface PersonalAutomationStatus {
  dailyFounderBrief: DailyFounderBriefAutomationStatus
  weeklyLeadHarvest: WeeklyLeadHarvestAutomationStatus
}

export type ExportedFileType = 'md' | 'txt' | 'json' | 'csv' | 'html' | 'other'
export type ExportedFileContext = 'personal' | 'company'

export interface ExportedFile {
  name: string
  relativePath: string
  sizeBytes: number
  createdAt: string
  type: ExportedFileType
  context: ExportedFileContext
}

export interface ExportsResponse {
  exports: ExportedFile[]
  total: number
}

export interface PersonalContext {
  profile: PersonalProfile
  workspacePath: string
  outputPath: string
  recentDocuments: PersonalDocumentSummary[]
  connectors: {
    email: boolean
    telegram: boolean
  }
  mcp: McpBridgeStatus
  mcpRuntime: GoogleWorkspaceMcpRuntimeStatus
}

export type KnowledgeBaseBadge =
  | 'product'
  | 'status'
  | 'founder'
  | 'technical'
  | 'reference'
  | 'archive'

export interface KnowledgeBaseDocument {
  title: string
  fileName: string
  relativePath: string
  description?: string
  badges: KnowledgeBaseBadge[]
  lastModified: string
  isEntry: boolean
}

export interface KnowledgeBaseSection {
  id: 'home' | 'canonical' | 'reference' | 'archive' | 'unindexed'
  title: string
  description: string
  items: KnowledgeBaseDocument[]
}

export interface KnowledgeBaseManifest {
  generatedAt: string
  rootDocumentPath: string
  sections: KnowledgeBaseSection[]
}

// Enriched variants used when hooks join runs/events with task metadata
export interface AgentRunWithContext extends AgentRun {
  task?: { metadata: Record<string, unknown>; project_id: string | null } | null
}

export interface SystemEventWithContext extends SystemEvent {
  task?: { metadata: Record<string, unknown>; project_id: string | null } | null
}

export interface ModelConfig {
  id: string
  provider: string
  display_name: string
  litellm_model_name?: string
  cost_per_1k_input_tokens: number
  cost_per_1k_output_tokens: number
  context_window: number
  is_active: boolean
  notes?: string
}

export interface ModelsResponse {
  models: Record<string, ModelConfig>
  defaults: Record<string, string>
  overrides: Record<string, string>
  assignments: Record<string, string>
  routing_notes: string[]
  special_overrides: Array<{
    id: string
    scope: string
    agents: string[]
    model_id: string | null
    reason: string
    unset_label: string
  }>
}

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
  /** Base64 data URL (PNG) of the QR code — present when state === 'qr_pending' */
  qrCode?: string
  /** Connected phone number — present when state === 'connected' */
  connectedPhone?: string
}

// --- Settings: Notification Preferences + Company Automations (T118) ---

export interface NotificationPreferences {
  telegram: boolean
  whatsapp: boolean
}

export interface FinanceWeeklyAutomationState {
  enabled: boolean
  /** Day of week: 0=Sunday … 6=Saturday */
  dayOfWeek: number
  lastSentWeekKey: string | null
}

export interface CompanyAutomationsState {
  financeWeeklyReport: FinanceWeeklyAutomationState
}

// --- Project Checklists (T130) ---

export type ChecklistStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped'

export type ChecklistCategory = 'delivery' | 'technical' | 'quality' | 'business'

export interface ProjectChecklistItem {
  id: string
  project_id: string
  key: string
  label: string
  status: ChecklistStatus
  category: ChecklistCategory
  agent_id: string | null
  notes: string | null
  order_index: number
  created_at: string
  updated_at: string
}

// --- CRM (T124 Personal CRM) ---

export type ContactStatus = 'active' | 'follow_up' | 'dormant'

export type InteractionType = 'email_in' | 'email_out' | 'meeting' | 'note' | 'call'

export type InteractionSource = 'gmail' | 'manual' | 'calendar'

export interface Contact {
  id: string
  name: string
  email?: string | null
  company?: string | null
  status: ContactStatus
  last_contact_at?: string | null
  notes: string
  tags: string[]
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface ContactInteraction {
  id: string
  contact_id: string
  type: InteractionType
  summary: string
  source: InteractionSource
  occurred_at: string
  created_at: string
}

// --- Meeting Notes (T125) ---

export interface ActionItem {
  text: string
  done: boolean
}

export interface MeetingNote {
  id: string
  title: string
  meeting_date: string
  attendees: string[]
  raw_notes: string
  summary: string
  action_items: ActionItem[]
  calendar_event_id: string | null
  contact_ids: string[]
  created_at: string
  updated_at: string
}

// --- Lead Generation Engine (T133) ---

export type LeadStatus = 'new' | 'qualified' | 'approved' | 'sent' | 'replied' | 'won' | 'lost' | 'rejected'
export type LeadSource = 'website_audit' | 'google_maps' | 'manual' | 'freelance' | 'inbound'

export interface LeadFinding {
  type: 'performance' | 'security' | 'seo' | 'ux' | 'missing_website' | 'other'
  severity: 'low' | 'medium' | 'high'
  description: string
}

export interface Lead {
  id: string
  source: LeadSource
  status: LeadStatus
  company_name: string
  contact_name: string | null
  contact_email: string | null
  website: string | null
  phone: string | null
  location: string | null
  sector: string | null
  score: number
  findings: LeadFinding[]
  outreach_subject: string
  outreach_draft: string
  source_url: string | null
  contact_id: string | null
  notes: string
  sent_at: string | null
  replied_at: string | null
  followed_up_at: string | null
  follow_up_count: number
  created_at: string
  updated_at: string
}

export interface HarvestRun {
  id: string
  harvester: string
  query: string | null
  location: string | null
  started_at: string
  completed_at: string | null
  leads_found: number
  status: 'running' | 'done' | 'failed'
  error: string | null
  created_at: string
}
