import { existsSync } from 'node:fs'
import { AGENTS } from '../config/agents.js'
import { getWhatsAppStatus } from './whatsapp.js'
import type {
  AgentTeam,
  Capability,
  CapabilityAssignment,
  CapabilityCatalogEntry,
  CapabilityEvent,
  CapabilityFreshnessState,
  CapabilityHealth,
  CapabilityHealthState,
  CapabilityPolicy,
  CapabilityRegistrySnapshot,
  CapabilityRuntimeTarget,
  CapabilityType,
  CapabilityAuditSummary,
} from '../types/index.js'
import { applyCapabilityGovernanceOverrides } from './capability-governance.js'
import { isGitHubConfigured } from './github.js'
import { getGoogleWorkspaceMcpRuntimeStatus } from './google-workspace-mcp.js'
import { getMcpBridgeStatus, type McpConnectorStatus } from './mcp-bridge.js'
import { getPersonalAutomationStatus } from './personal-automation.js'
import { getCapabilityEvents } from './supabase.js'
import { getPersonalWorkspacePath, getWorkspaceRoot } from './workspace.js'

const DEFAULT_OWNER_SLUG = 'neb'

const TEAM_LABELS: Record<AgentTeam, string> = {
  executive: 'Executive Team',
  saas: 'SaaS Team',
  dev: 'Software Dev Team',
  consulting: 'Consulting Team',
  marketing: 'Marketing Team',
  ops: 'Ops / Finance / HR',
}

const QUICK_ACTIONS = [
  {
    id: 'important_emails_today',
    label: 'Important Emails Today',
    description: 'Reads the founder inbox and surfaces high-priority or unread messages with sender, subject, preview, and urgency score.',
    integrationId: 'integration.google_workspace.gmail',
    usageInstructions: 'Trigger from Assistant HQ > Exec tab. Ask: "What are my important emails today?" or click the action button. CEO Intake filters by unread and urgency, logs the result to the Gmail integration capability.',
    examples: [
      'Show me the most important emails from today',
      'Any urgent emails I should read right now?',
      'What emails need my attention this morning?',
    ],
  },
  {
    id: 'pre_meeting_brief',
    label: 'Pre-Meeting Brief',
    description: 'Reads today\'s and tomorrow\'s Calendar events and produces a structured brief per meeting with participants, topic, and prep notes.',
    integrationId: 'integration.google_workspace.calendar',
    usageInstructions: 'Trigger from Assistant HQ > Exec tab. Ask: "Brief me before my next meeting" or use the action button. CEO Intake reads upcoming events for the next 48 h and produces a structured per-meeting output.',
    examples: [
      'Brief me before my next meeting',
      'What meetings do I have today and what do I need to prepare?',
      'Give me a pre-meeting brief for this afternoon',
    ],
  },
  {
    id: 'latest_email',
    label: 'Latest Email',
    description: 'Reads the single most recent Gmail message and surfaces sender, subject, and full body for the founder.',
    integrationId: 'integration.google_workspace.gmail',
    usageInstructions: 'Trigger from Assistant HQ > Exec tab. Ask: "What is my latest email?" or click the action button. The result is the last message in your inbox, including subject line and full content.',
    examples: [
      'What is my latest email?',
      'Show me the last email I received',
      'Read my most recent message',
    ],
  },
  {
    id: 'calendar_today',
    label: 'Today Agenda',
    description: 'Summarises today\'s Calendar events with times, attendees, and relevant context for the founder.',
    integrationId: 'integration.google_workspace.calendar',
    usageInstructions: 'Trigger from Assistant HQ > Exec tab. Ask: "What is on my agenda today?" or click the action button. Returns a chronological list of events with time slots and participant context.',
    examples: [
      'What is on my agenda today?',
      'Show me today\'s calendar',
      'Any meetings this afternoon?',
    ],
  },
  {
    id: 'drive_recent_files',
    label: 'Recent Drive Files',
    description: 'Lists the most recently modified Google Drive files accessible to the founder.',
    integrationId: 'integration.google_workspace.drive',
    usageInstructions: 'Trigger from Assistant HQ > Exec tab. Ask: "Show me my recent Drive files" or click the action button. Returns a list of recently modified files with names, types, and last-modified timestamps.',
    examples: [
      'Show me my recent Drive files',
      'What documents did I work on recently?',
      'List the latest files from Google Drive',
    ],
  },
  {
    id: 'daily_founder_brief',
    label: 'Daily Founder Brief',
    description: 'Combines inbox summary, today\'s calendar, and recent Drive files into a single consolidated briefing for the founder.',
    integrationId: 'plugin.google_workspace.mcp',
    usageInstructions: 'Trigger from Assistant HQ > Exec tab or let the daily automation run it. Ask: "Give me my daily brief" or click the action button. Output is written to the personal workspace and summarised inline.',
    examples: [
      'Give me my daily brief',
      'What do I need to know to start my day?',
      'Run the daily founder brief now',
    ],
  },
] as const

function hasEnvVars(required: string[]): boolean {
  return required.every((envVar) => Boolean(process.env[envVar]?.trim()))
}

function getMissingEnvVars(required: string[]): string[] {
  return required.filter((envVar) => !process.env[envVar]?.trim())
}

// T099 – freshness / health depth helpers
const HOUR_MS = 3_600_000

function computeFreshness(lastKnownGoodAt: string | undefined): CapabilityFreshnessState {
  if (!lastKnownGoodAt) return 'unknown'
  const ageMs = Date.now() - new Date(lastKnownGoodAt).getTime()
  if (ageMs < HOUR_MS) return 'fresh'
  if (ageMs < 24 * HOUR_MS) return 'aging'
  return 'stale'
}

function computeGoogleDriftWarnings(
  runtimeState: Awaited<ReturnType<typeof getGoogleWorkspaceMcpRuntimeStatus>>,
): string[] {
  const warnings: string[] = []
  if (runtimeState.state === 'connected' && runtimeState.lastConnectedAt) {
    const ageMs = Date.now() - new Date(runtimeState.lastConnectedAt).getTime()
    if (ageMs > 24 * HOUR_MS) {
      warnings.push('Last verified connection is more than 24 h ago — token freshness unconfirmed.')
    }
    if (ageMs > 7 * 24 * HOUR_MS) {
      warnings.push('Connection not verified for over 7 days — consider re-authorizing OAuth.')
    }
  }
  if (runtimeState.hasTokens && !runtimeState.hasClientRegistration) {
    warnings.push('OAuth tokens present but client registration is missing — may require re-auth.')
  }
  return warnings
}

function googleReasonCode(state: Awaited<ReturnType<typeof getGoogleWorkspaceMcpRuntimeStatus>>['state']): string {
  switch (state) {
    case 'connected': return 'oauth_connected'
    case 'auth_required': return 'oauth_required'
    case 'missing_config': return 'env_missing'
    case 'offline': return 'server_unreachable'
    case 'error': return 'runtime_error'
    default: return 'unknown'
  }
}

function runtimeAssignment(
  capabilityId: string,
  targetId: CapabilityRuntimeTarget,
  label: string,
  runtimeTarget: CapabilityRuntimeTarget,
  notes?: string,
): CapabilityAssignment {
  return {
    capabilityId,
    targetType: 'runtime',
    targetId,
    label,
    runtimeTarget,
    state: 'active',
    ...(notes ? { notes } : {}),
  }
}

function teamAssignment(
  capabilityId: string,
  team: AgentTeam,
  runtimeTarget: CapabilityRuntimeTarget,
  notes?: string,
): CapabilityAssignment {
  return {
    capabilityId,
    targetType: 'team',
    targetId: team,
    label: TEAM_LABELS[team],
    runtimeTarget,
    state: 'active',
    ...(notes ? { notes } : {}),
  }
}

function agentAssignment(
  capabilityId: string,
  agentId: keyof typeof AGENTS,
  runtimeTarget: CapabilityRuntimeTarget,
  notes?: string,
): CapabilityAssignment {
  const agent = AGENTS[agentId]
  if (!agent) {
    throw new Error(`Unknown capability assignment agent: ${String(agentId)}`)
  }

  return {
    capabilityId,
    targetType: 'agent',
    targetId: agentId,
    label: agent.name,
    runtimeTarget,
    state: 'active',
    ...(notes ? { notes } : {}),
  }
}

function baseCapability(input: {
  id: string
  type: CapabilityType
  label: string
  description: string
  owner: string
  runtimeTarget: CapabilityRuntimeTarget
  status?: Capability['status']
  riskLevel?: Capability['riskLevel']
  tags?: string[]
  dependsOn?: string[]
  isPlaceholder?: boolean
  usageInstructions?: string
  examples?: string[]
}): Capability {
  return {
    id: input.id,
    type: input.type,
    label: input.label,
    description: input.description,
    owner: input.owner,
    runtimeTarget: input.runtimeTarget,
    status: input.status ?? 'active',
    riskLevel: input.riskLevel ?? 'low',
    tags: input.tags ?? [],
    dependsOn: input.dependsOn ?? [],
    isPlaceholder: input.isPlaceholder ?? false,
    ...(input.usageInstructions ? { usageInstructions: input.usageInstructions } : {}),
    ...(input.examples?.length ? { examples: input.examples } : {}),
  }
}

function basePolicy(input: {
  capabilityId: string
  mode: CapabilityPolicy['mode']
  allowedTools?: string[]
  envRequirements?: string[]
  restrictedPaths?: string[]
  notes?: string
}): CapabilityPolicy {
  return {
    capabilityId: input.capabilityId,
    mode: input.mode,
    allowedTools: input.allowedTools ?? [],
    envRequirements: input.envRequirements ?? [],
    restrictedPaths: input.restrictedPaths ?? [],
    ...(input.notes ? { notes: input.notes } : {}),
  }
}

function baseAudit(input: {
  capabilityId: string
  lastChangedAt?: string | undefined
  lastChangedBy?: string | undefined
  lastSuccessfulAt?: string | undefined
  lastFailedAt?: string | undefined
  lastUsedAt?: string | undefined
  summary?: string | undefined
}): CapabilityAuditSummary {
  return {
    capabilityId: input.capabilityId,
    ...(input.lastChangedAt ? { lastChangedAt: input.lastChangedAt } : {}),
    ...(input.lastChangedBy ? { lastChangedBy: input.lastChangedBy } : {}),
    ...(input.lastSuccessfulAt ? { lastSuccessfulAt: input.lastSuccessfulAt } : {}),
    ...(input.lastFailedAt ? { lastFailedAt: input.lastFailedAt } : {}),
    ...(input.lastUsedAt ? { lastUsedAt: input.lastUsedAt } : {}),
    ...(input.summary ? { summary: input.summary } : {}),
  }
}

function baseHealth(input: {
  capabilityId: string
  state: CapabilityHealthState
  label: string
  message: string
  checkedAt: string
  missingRequirements?: string[]
  freshness?: CapabilityFreshnessState
  lastSuccessAt?: string | undefined
  lastFailedAt?: string | undefined
  driftWarnings?: string[]
  reasonCode?: string
  details?: string[]
}): CapabilityHealth {
  return {
    capabilityId: input.capabilityId,
    state: input.state,
    label: input.label,
    message: input.message,
    checkedAt: input.checkedAt,
    missingRequirements: input.missingRequirements ?? [],
    ...(input.freshness !== undefined ? { freshness: input.freshness } : {}),
    ...(input.lastSuccessAt ? { lastSuccessAt: input.lastSuccessAt } : {}),
    ...(input.lastFailedAt ? { lastFailedAt: input.lastFailedAt } : {}),
    ...(input.driftWarnings?.length ? { driftWarnings: input.driftWarnings } : {}),
    ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
    ...(input.details?.length ? { details: input.details } : {}),
  }
}

function findConnector(connectors: McpConnectorStatus[], id: McpConnectorStatus['id']): McpConnectorStatus | undefined {
  return connectors.find((connector) => connector.id === id)
}

function healthFromGoogleRuntime(
  capabilityId: string,
  checkedAt: string,
  runtimeState: Awaited<ReturnType<typeof getGoogleWorkspaceMcpRuntimeStatus>>,
): CapabilityHealth {
  const missingRequirements = getMissingEnvVars([
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'USER_GOOGLE_EMAIL',
  ])
  const freshness = computeFreshness(runtimeState.lastConnectedAt)
  const driftWarnings = computeGoogleDriftWarnings(runtimeState)
  const reasonCode = googleReasonCode(runtimeState.state)

  switch (runtimeState.state) {
    case 'connected': {
      const details: string[] = [
        `${String(runtimeState.toolCount)} MCP tool${runtimeState.toolCount !== 1 ? 's' : ''} visible`,
      ]
      if (runtimeState.userGoogleEmail) {
        details.push(`Authorized as ${runtimeState.userGoogleEmail}`)
      }
      if (runtimeState.lastConnectedAt) {
        const ageMs = Date.now() - new Date(runtimeState.lastConnectedAt).getTime()
        const ageHours = Math.round(ageMs / HOUR_MS)
        details.push(`Last verified ${ageHours < 1 ? 'less than 1 h' : `${String(ageHours)} h`} ago`)
      }
      return baseHealth({
        capabilityId,
        state: 'connected',
        label: freshness === 'stale' ? 'Connected (stale)' : 'Connected',
        message: `OAuth completed for ${runtimeState.userGoogleEmail ?? 'configured user'} and ${String(runtimeState.toolCount)} MCP tools are visible.`,
        checkedAt,
        freshness,
        lastSuccessAt: runtimeState.lastConnectedAt,
        driftWarnings,
        reasonCode,
        details,
      })
    }
    case 'auth_required':
      return baseHealth({
        capabilityId,
        state: 'auth_required',
        label: 'Auth Required',
        message: 'Google Workspace MCP is configured but OAuth must be completed again.',
        checkedAt,
        missingRequirements,
        freshness: 'unknown',
        lastSuccessAt: runtimeState.lastConnectedAt,
        reasonCode,
        details: runtimeState.lastConnectedAt
          ? [`Last successful connection: ${new Date(runtimeState.lastConnectedAt).toLocaleString()}`]
          : [],
      })
    case 'missing_config':
      return baseHealth({
        capabilityId,
        state: 'missing_config',
        label: 'Missing Config',
        message: 'The google_workspace MCP server or required OAuth env vars are missing.',
        checkedAt,
        missingRequirements,
        freshness: 'unknown',
        reasonCode,
      })
    case 'offline':
      return baseHealth({
        capabilityId,
        state: 'degraded',
        label: 'Server Offline',
        message: 'The google_workspace MCP server is configured but not reachable right now.',
        checkedAt,
        freshness: 'unknown',
        lastSuccessAt: runtimeState.lastConnectedAt,
        driftWarnings: ['MCP server unreachable — check that the local google_workspace server is running.'],
        reasonCode,
      })
    case 'error':
    default:
      return baseHealth({
        capabilityId,
        state: 'failing',
        label: 'Failing',
        message: runtimeState.lastError ?? 'Google Workspace MCP reported an unexpected runtime error.',
        checkedAt,
        freshness: 'unknown',
        lastSuccessAt: runtimeState.lastConnectedAt,
        lastFailedAt: checkedAt,
        reasonCode,
        details: runtimeState.lastError ? [`Error: ${runtimeState.lastError}`] : [],
      })
  }
}

function healthFromGoogleConnector(
  capabilityId: string,
  checkedAt: string,
  label: string,
  connector: McpConnectorStatus | undefined,
  runtimeState: Awaited<ReturnType<typeof getGoogleWorkspaceMcpRuntimeStatus>>,
): CapabilityHealth {
  if (!connector || connector.status !== 'ready') {
    return baseHealth({
      capabilityId,
      state: 'missing_config',
      label: 'Missing Config',
      message: connector?.notes ?? `${label} is not configured in the MCP bridge.`,
      checkedAt,
      missingRequirements: getMissingEnvVars(['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET']),
      freshness: 'unknown',
      reasonCode: 'connector_missing',
    })
  }

  // Connector is ready — delegate to the parent Google runtime health
  const parentHealth = healthFromGoogleRuntime(capabilityId, checkedAt, runtimeState)
  // Inherit parent health but tag with connector-specific context
  return {
    ...parentHealth,
    details: [
      `Connector ${connector.id} is ready`,
      ...(parentHealth.details ?? []),
    ],
  }
}

function healthFromEnv(
  capabilityId: string,
  checkedAt: string,
  label: string,
  requiredEnvVars: string[],
  description: string,
): CapabilityHealth {
  const missingRequirements = getMissingEnvVars(requiredEnvVars)
  const connected = missingRequirements.length === 0
  return baseHealth({
    capabilityId,
    state: connected ? 'connected' : 'missing_config',
    label,
    message: connected
      ? description
      : `Missing required environment: ${missingRequirements.join(', ')}.`,
    checkedAt,
    missingRequirements,
    freshness: connected ? 'fresh' : 'unknown',
    reasonCode: connected ? 'env_present' : 'env_missing',
  })
}

function sortCatalog(a: CapabilityCatalogEntry, b: CapabilityCatalogEntry): number {
  if (a.capability.runtimeTarget !== b.capability.runtimeTarget) {
    return a.capability.runtimeTarget.localeCompare(b.capability.runtimeTarget)
  }
  if (a.capability.type !== b.capability.type) {
    return a.capability.type.localeCompare(b.capability.type)
  }
  return a.capability.label.localeCompare(b.capability.label)
}

function actorLabelFromEvent(event: CapabilityEvent): string {
  return event.actor_id ?? event.actor_type
}

// T099 – enrich health signals using persisted capability events
function enrichHealthFromEvents(
  health: CapabilityHealth,
  events: CapabilityEvent[],
): CapabilityHealth {
  if (events.length === 0) return health

  const lastSuccess = events.find((event) =>
    ['succeeded', 'auth_completed', 'enabled', 'configured'].includes(event.event_type)
  )
  const lastFailure = events.find((event) => event.event_type === 'failed')

  const eventLastSuccessAt = lastSuccess?.created_at
  const eventLastFailedAt = lastFailure?.created_at

  // Use event-derived signals only if they are more recent than what we have
  const updatedLastSuccessAt = mostRecentTimestamp(health.lastSuccessAt, eventLastSuccessAt)
  const updatedLastFailedAt = mostRecentTimestamp(health.lastFailedAt, eventLastFailedAt)

  // Recompute freshness if we got a better lastSuccessAt from events
  const updatedFreshness = updatedLastSuccessAt !== health.lastSuccessAt
    ? computeFreshness(updatedLastSuccessAt)
    : health.freshness

  return {
    ...health,
    ...(updatedLastSuccessAt ? { lastSuccessAt: updatedLastSuccessAt } : {}),
    ...(updatedLastFailedAt ? { lastFailedAt: updatedLastFailedAt } : {}),
    ...(updatedFreshness !== undefined ? { freshness: updatedFreshness } : {}),
  }
}

function mostRecentTimestamp(a: string | undefined, b: string | undefined): string | undefined {
  if (!a && !b) return undefined
  if (!a) return b
  if (!b) return a
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b
}

function deriveAuditFromEvents(
  baseAuditSummary: CapabilityAuditSummary,
  events: CapabilityEvent[],
): CapabilityAuditSummary {
  if (events.length === 0) return baseAuditSummary

  const latest = events[0]
  if (!latest) return baseAuditSummary
  const lastChanged = events.find((event) => ['configured', 'enabled', 'disabled', 'auth_started', 'auth_completed'].includes(event.event_type))
  const lastSuccess = events.find((event) => ['succeeded', 'auth_completed', 'enabled', 'configured'].includes(event.event_type))
  const lastFailure = events.find((event) => event.event_type === 'failed')
  const lastUsed = events.find((event) => ['used', 'succeeded', 'failed'].includes(event.event_type))

  return {
    ...baseAuditSummary,
    ...(lastChanged ? {
      lastChangedAt: lastChanged.created_at,
      lastChangedBy: actorLabelFromEvent(lastChanged),
    } : {}),
    ...(lastSuccess ? { lastSuccessfulAt: lastSuccess.created_at } : {}),
    ...(lastFailure ? { lastFailedAt: lastFailure.created_at } : {}),
    ...(lastUsed ? { lastUsedAt: lastUsed.created_at } : {}),
    summary: latest.summary,
  }
}

export async function getCapabilityRegistrySnapshot(): Promise<CapabilityRegistrySnapshot> {
  const generatedAt = new Date().toISOString()
  const [mcpBridgeStatus, googleWorkspaceRuntime, automationStatus, recentEvents] = await Promise.all([
    getMcpBridgeStatus(),
    getGoogleWorkspaceMcpRuntimeStatus(DEFAULT_OWNER_SLUG),
    getPersonalAutomationStatus(DEFAULT_OWNER_SLUG),
    getCapabilityEvents({ limit: 200 }),
  ])

  const gmailConnector = findConnector(mcpBridgeStatus.connectors, 'gmail')
  const calendarConnector = findConnector(mcpBridgeStatus.connectors, 'google_calendar')
  const driveConnector = findConnector(mcpBridgeStatus.connectors, 'google_drive')

  const googleWorkspaceAssignments = [
    runtimeAssignment('plugin.google_workspace.mcp', 'personal', 'Personal Runtime', 'personal', 'Founder-side runtime plugin for Gmail, Calendar, and Drive flows.'),
    teamAssignment('plugin.google_workspace.mcp', 'executive', 'personal', 'Founder workflows route through the executive layer.'),
    agentAssignment('plugin.google_workspace.mcp', 'ceo', 'personal', 'CEO intake is the execution surface for founder quick actions.'),
  ]

  const catalogBase: CapabilityCatalogEntry[] = [
    {
      capability: baseCapability({
        id: 'plugin.google_workspace.mcp',
        type: 'plugin',
        label: 'Google Workspace MCP Runtime',
        description: 'OAuth-backed runtime plugin that exposes Gmail, Calendar, and Drive tools to founder workflows.',
        owner: 'Founder Runtime',
        runtimeTarget: 'personal',
        riskLevel: 'medium',
        tags: ['mcp', 'google', 'oauth'],
      }),
      assignments: googleWorkspaceAssignments,
      policy: basePolicy({
        capabilityId: 'plugin.google_workspace.mcp',
        mode: 'restricted',
        allowedTools: ['google_workspace_mcp', 'mcp_bridge'],
        envRequirements: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'USER_GOOGLE_EMAIL'],
        notes: 'Requires local google_workspace MCP server plus founder OAuth completion.',
      }),
      health: healthFromGoogleRuntime('plugin.google_workspace.mcp', generatedAt, googleWorkspaceRuntime),
      audit: baseAudit({
        capabilityId: 'plugin.google_workspace.mcp',
        lastChangedAt: googleWorkspaceRuntime.lastAuthRequestedAt ?? googleWorkspaceRuntime.lastConnectedAt,
        lastChangedBy: 'founder',
        lastSuccessfulAt: googleWorkspaceRuntime.lastConnectedAt,
        lastFailedAt: googleWorkspaceRuntime.state === 'error' ? generatedAt : undefined,
        summary: googleWorkspaceRuntime.lastError ?? 'Google Workspace MCP runtime already linked into Assistant HQ.',
      }),
    },
    {
      capability: baseCapability({
        id: 'integration.google_workspace.gmail',
        type: 'integration',
        label: 'Gmail Inbox Access',
        description: 'Reads founder inbox data via the Google Workspace MCP runtime.',
        owner: 'Founder Runtime',
        runtimeTarget: 'personal',
        riskLevel: 'medium',
        tags: ['gmail', 'inbox', 'email'],
        dependsOn: ['plugin.google_workspace.mcp'],
      }),
      assignments: [
        runtimeAssignment('integration.google_workspace.gmail', 'personal', 'Personal Runtime', 'personal'),
        agentAssignment('integration.google_workspace.gmail', 'ceo', 'personal', 'Used by CEO intake to satisfy founder inbox requests.'),
      ],
      policy: basePolicy({
        capabilityId: 'integration.google_workspace.gmail',
        mode: 'restricted',
        allowedTools: ['gmail_mcp_read'],
        envRequirements: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'USER_GOOGLE_EMAIL'],
        notes: 'Read-only founder inbox access through MCP.',
      }),
      health: healthFromGoogleConnector('integration.google_workspace.gmail', generatedAt, 'Gmail', gmailConnector, googleWorkspaceRuntime),
      audit: baseAudit({
        capabilityId: 'integration.google_workspace.gmail',
        lastChangedAt: googleWorkspaceRuntime.lastConnectedAt ?? googleWorkspaceRuntime.lastAuthRequestedAt,
        lastSuccessfulAt: googleWorkspaceRuntime.lastConnectedAt,
        summary: gmailConnector?.notes ?? 'Gmail capability depends on the shared Google Workspace MCP runtime.',
      }),
    },
    {
      capability: baseCapability({
        id: 'integration.google_workspace.calendar',
        type: 'integration',
        label: 'Google Calendar Access',
        description: 'Reads founder agenda and event context through the Google Workspace MCP runtime.',
        owner: 'Founder Runtime',
        runtimeTarget: 'personal',
        riskLevel: 'medium',
        tags: ['calendar', 'agenda', 'schedule'],
        dependsOn: ['plugin.google_workspace.mcp'],
      }),
      assignments: [
        runtimeAssignment('integration.google_workspace.calendar', 'personal', 'Personal Runtime', 'personal'),
        agentAssignment('integration.google_workspace.calendar', 'ceo', 'personal', 'Used by CEO intake to build agenda summaries.'),
      ],
      policy: basePolicy({
        capabilityId: 'integration.google_workspace.calendar',
        mode: 'restricted',
        allowedTools: ['calendar_mcp_read'],
        envRequirements: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'USER_GOOGLE_EMAIL'],
        notes: 'Read-only agenda access through MCP.',
      }),
      health: healthFromGoogleConnector('integration.google_workspace.calendar', generatedAt, 'Google Calendar', calendarConnector, googleWorkspaceRuntime),
      audit: baseAudit({
        capabilityId: 'integration.google_workspace.calendar',
        lastChangedAt: googleWorkspaceRuntime.lastConnectedAt ?? googleWorkspaceRuntime.lastAuthRequestedAt,
        lastSuccessfulAt: googleWorkspaceRuntime.lastConnectedAt,
        summary: calendarConnector?.notes ?? 'Calendar capability depends on the shared Google Workspace MCP runtime.',
      }),
    },
    {
      capability: baseCapability({
        id: 'integration.google_workspace.drive',
        type: 'integration',
        label: 'Google Drive Access',
        description: 'Reads founder Drive file metadata and contents through the Google Workspace MCP runtime.',
        owner: 'Founder Runtime',
        runtimeTarget: 'personal',
        riskLevel: 'medium',
        tags: ['drive', 'files', 'documents'],
        dependsOn: ['plugin.google_workspace.mcp'],
      }),
      assignments: [
        runtimeAssignment('integration.google_workspace.drive', 'personal', 'Personal Runtime', 'personal'),
        agentAssignment('integration.google_workspace.drive', 'ceo', 'personal', 'Used by CEO intake for founder file retrieval.'),
      ],
      policy: basePolicy({
        capabilityId: 'integration.google_workspace.drive',
        mode: 'restricted',
        allowedTools: ['drive_mcp_read'],
        envRequirements: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'USER_GOOGLE_EMAIL'],
        notes: 'Read-only file discovery through MCP.',
      }),
      health: healthFromGoogleConnector('integration.google_workspace.drive', generatedAt, 'Google Drive', driveConnector, googleWorkspaceRuntime),
      audit: baseAudit({
        capabilityId: 'integration.google_workspace.drive',
        lastChangedAt: googleWorkspaceRuntime.lastConnectedAt ?? googleWorkspaceRuntime.lastAuthRequestedAt,
        lastSuccessfulAt: googleWorkspaceRuntime.lastConnectedAt,
        summary: driveConnector?.notes ?? 'Drive capability depends on the shared Google Workspace MCP runtime.',
      }),
    },
    ...QUICK_ACTIONS.map((action) => ({
      capability: baseCapability({
        id: `skill.founder.${action.id}`,
        type: 'skill',
        label: action.label,
        description: action.description,
        owner: 'Neb',
        runtimeTarget: 'personal',
        riskLevel: action.id === 'daily_founder_brief' ? 'medium' : 'low',
        tags: ['quick_action', 'assistant_hq'],
        dependsOn: [action.integrationId],
        usageInstructions: action.usageInstructions,
        examples: [...action.examples],
      }),
      assignments: [
        runtimeAssignment(`skill.founder.${action.id}`, 'personal', 'Personal Runtime', 'personal'),
        teamAssignment(`skill.founder.${action.id}`, 'executive', 'personal', 'Founder quick actions are routed by the executive layer.'),
        agentAssignment(`skill.founder.${action.id}`, 'ceo', 'personal', 'Executed via CEO natural-language intake.'),
      ],
      policy: basePolicy({
        capabilityId: `skill.founder.${action.id}`,
        mode: 'restricted',
        allowedTools: ['ceo_intake', action.integrationId],
        envRequirements: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'USER_GOOGLE_EMAIL'],
        notes: 'Skill metadata only. Execution still flows through the current CEO intake path.',
      }),
      health: healthFromGoogleRuntime(`skill.founder.${action.id}`, generatedAt, googleWorkspaceRuntime),
      audit: baseAudit({
        capabilityId: `skill.founder.${action.id}`,
        lastChangedAt: googleWorkspaceRuntime.lastConnectedAt ?? googleWorkspaceRuntime.lastAuthRequestedAt,
        lastSuccessfulAt: action.id === 'daily_founder_brief'
          ? automationStatus.dailyFounderBrief.lastSuccessAt
          : googleWorkspaceRuntime.lastConnectedAt,
        lastFailedAt: action.id === 'daily_founder_brief'
          ? automationStatus.dailyFounderBrief.lastError
            ? automationStatus.dailyFounderBrief.lastRunAt
            : undefined
          : undefined,
        summary: action.id === 'daily_founder_brief'
          ? 'Manual quick action plus scheduled automation share the same founder briefing flow.'
          : 'Current MVP exposes the live Assistant HQ quick action as a capability object.',
      }),
    })),
    {
      capability: baseCapability({
        id: 'skill.founder.daily_founder_brief_automation',
        type: 'skill',
        label: 'Daily Founder Brief Automation',
        description: 'Scheduled founder briefing that runs daily and writes output into the personal workspace.',
        owner: 'Neb',
        runtimeTarget: 'personal',
        status: 'beta',
        riskLevel: 'medium',
        tags: ['automation', 'assistant_hq', 'briefing'],
        dependsOn: ['skill.founder.daily_founder_brief'],
        usageInstructions: 'Enable from Assistant HQ > Automations tab. Set a schedule time (HH:MM), toggle on, and the automation runs at that local time each day. Results are written to workspace/personal/neb/output. Use "Run now" to trigger immediately without waiting for the schedule.',
        examples: [
          'Enable the daily brief automation at 08:00',
          'Run the daily brief now',
          'Check when the last brief ran',
        ],
      }),
      assignments: [
        runtimeAssignment('skill.founder.daily_founder_brief_automation', 'personal', 'Personal Runtime', 'personal'),
      ],
      policy: basePolicy({
        capabilityId: 'skill.founder.daily_founder_brief_automation',
        mode: 'restricted',
        allowedTools: ['automation_runtime', 'skill.founder.daily_founder_brief'],
        restrictedPaths: [`workspace/personal/${DEFAULT_OWNER_SLUG}/output`],
        notes: 'Writes briefing artifacts into founder personal output only.',
      }),
      health: (() => {
        const auto = automationStatus.dailyFounderBrief
        const isDisabled = !auto.enabled
        const isFailing = auto.status === 'error'
        const isConnected = googleWorkspaceRuntime.state === 'connected'
        const state: CapabilityHealthState = isDisabled
          ? 'disabled'
          : isFailing
            ? 'failing'
            : isConnected
              ? 'connected'
              : 'degraded'
        const freshness = computeFreshness(auto.lastSuccessAt)
        const details: string[] = []
        if (auto.scheduleLocalTime && auto.timezone) {
          details.push(`Schedule: ${auto.scheduleLocalTime} (${auto.timezone})`)
        }
        if (auto.nextPlannedRunLabel) {
          details.push(`Next run: ${auto.nextPlannedRunLabel}`)
        }
        if (auto.lastRunAt) {
          details.push(`Last run: ${new Date(auto.lastRunAt).toLocaleString()}`)
        }
        const driftWarnings: string[] = []
        if (!isDisabled && !isConnected) {
          driftWarnings.push('Automation is enabled but Google Workspace MCP is not connected — runs will fail.')
        }
        if (!isDisabled && freshness === 'stale') {
          driftWarnings.push('No successful brief run in over 24 h — automation may be stalled.')
        }
        return baseHealth({
          capabilityId: 'skill.founder.daily_founder_brief_automation',
          state,
          label: isDisabled ? 'Disabled' : isFailing ? 'Failing' : isConnected ? 'Scheduled' : 'Degraded',
          message: isDisabled
            ? 'Automation is configured but currently switched off.'
            : auto.lastError ?? `${auto.nextPlannedRunLabel ?? 'Schedule active'} via ${auto.timezone}.`,
          checkedAt: generatedAt,
          freshness,
          lastSuccessAt: auto.lastSuccessAt ?? undefined,
          lastFailedAt: isFailing ? auto.lastRunAt ?? undefined : undefined,
          driftWarnings,
          reasonCode: isDisabled ? 'automation_disabled' : isFailing ? 'last_run_failed' : isConnected ? 'scheduled' : 'dependency_degraded',
          details,
        })
      })(),
      audit: baseAudit({
        capabilityId: 'skill.founder.daily_founder_brief_automation',
        lastChangedAt: automationStatus.dailyFounderBrief.lastRunAt,
        lastChangedBy: 'founder',
        lastSuccessfulAt: automationStatus.dailyFounderBrief.lastSuccessAt,
        lastFailedAt: automationStatus.dailyFounderBrief.lastError ? automationStatus.dailyFounderBrief.lastRunAt : undefined,
        lastUsedAt: automationStatus.dailyFounderBrief.lastRunAt,
        summary: automationStatus.dailyFounderBrief.enabled
          ? `Schedule ${automationStatus.dailyFounderBrief.scheduleLocalTime} (${automationStatus.dailyFounderBrief.timezone}).`
          : 'Automation exists but is currently disabled by founder preference.',
      }),
    },
    // T084 – Company skills
    {
      capability: baseCapability({
        id: 'skill.company.proposal_writing',
        type: 'skill',
        label: 'Proposal Writing',
        description: 'Produces structured client proposals from a project brief, including scope, timeline, team, and pricing sections.',
        owner: 'Consulting Team',
        runtimeTarget: 'company',
        riskLevel: 'low',
        tags: ['consulting', 'proposal', 'delivery'],
        usageInstructions: 'Assign to the Consulting Lead agent or trigger via CEO delegation with a project brief. The skill expects: client name, project type, scope summary, and optionally a budget range. Output is a formatted proposal document written to the project workspace.',
        examples: [
          'Write a proposal for Acme Corp web platform redesign, budget 15k',
          'Generate a consulting proposal from the Wawen22 brief',
          'Create a proposal for a 3-month SaaS audit engagement',
        ],
      }),
      assignments: [
        runtimeAssignment('skill.company.proposal_writing', 'company', 'Company Runtime', 'company'),
        teamAssignment('skill.company.proposal_writing', 'consulting', 'company', 'Primary skill for consulting lead agent deliverables.'),
        teamAssignment('skill.company.proposal_writing', 'executive', 'company', 'CEO can delegate proposal requests to the consulting team.'),
        agentAssignment('skill.company.proposal_writing', 'ceo', 'company', 'CEO intake routes proposal requests to consulting lead.'),
      ],
      policy: basePolicy({
        capabilityId: 'skill.company.proposal_writing',
        mode: 'restricted',
        allowedTools: ['file_export', 'file_system', 'llm_call'],
        notes: 'Output is written to project workspace. No external API calls required.',
      }),
      health: baseHealth({
        capabilityId: 'skill.company.proposal_writing',
        state: 'connected',
        label: 'Active',
        message: 'Proposal writing skill is available to the consulting team and CEO delegation path.',
        checkedAt: generatedAt,
        freshness: 'fresh',
        reasonCode: 'skill_active',
      }),
      audit: baseAudit({
        capabilityId: 'skill.company.proposal_writing',
        summary: 'Company skill: proposal generation via consulting lead agent. First real revenue output (Wawen22) was produced through this flow.',
      }),
    },
    {
      capability: baseCapability({
        id: 'skill.company.repo_bootstrap',
        type: 'skill',
        label: 'Repo Bootstrap',
        description: 'Initialises a new project repository with standard structure, tooling, and CI configuration based on project type.',
        owner: 'Dev Team',
        runtimeTarget: 'company',
        riskLevel: 'medium',
        tags: ['dev', 'repo', 'bootstrap', 'saas'],
        usageInstructions: 'Trigger via CEO delegation or Dev Lead agent with a project type (saas / api / static). The skill scaffolds the repo structure, installs base dependencies, and writes a README and initial CI config. Output lands in workspace/<project-slug>/.',
        examples: [
          'Bootstrap a new SaaS repo for the Acme project',
          'Initialise a TypeScript API project under workspace/acme-api',
          'Create a Next.js starter for the Wawen landing page',
        ],
      }),
      assignments: [
        runtimeAssignment('skill.company.repo_bootstrap', 'company', 'Company Runtime', 'company'),
        teamAssignment('skill.company.repo_bootstrap', 'dev', 'company', 'Dev lead and dev agents use this for project initialisation.'),
        teamAssignment('skill.company.repo_bootstrap', 'saas', 'company', 'SaaS team uses this when spinning up new product repos.'),
        agentAssignment('skill.company.repo_bootstrap', 'ceo', 'company', 'CEO can delegate repo bootstrap to the dev team.'),
      ],
      policy: basePolicy({
        capabilityId: 'skill.company.repo_bootstrap',
        mode: 'restricted',
        allowedTools: ['file_system', 'shell', 'git'],
        restrictedPaths: ['workspace/'],
        notes: 'Shell and git access scoped to the workspace directory. No write outside workspace.',
      }),
      health: baseHealth({
        capabilityId: 'skill.company.repo_bootstrap',
        state: 'connected',
        label: 'Active',
        message: 'Repo bootstrap skill is available to dev and SaaS teams.',
        checkedAt: generatedAt,
        freshness: 'fresh',
        reasonCode: 'skill_active',
      }),
      audit: baseAudit({
        capabilityId: 'skill.company.repo_bootstrap',
        summary: 'Company skill: repository initialisation for new client and internal projects.',
      }),
    },
    {
      capability: baseCapability({
        id: 'skill.company.invoice_followup',
        type: 'skill',
        label: 'Invoice Follow-up',
        description: 'Generates and sends a professional invoice follow-up message for unpaid or overdue client invoices.',
        owner: 'Ops / Finance / HR',
        runtimeTarget: 'company',
        riskLevel: 'low',
        tags: ['invoicing', 'finance', 'ops', 'client'],
        usageInstructions: 'Trigger via CEO delegation or Finance agent with: client name, invoice number, amount due, and due date. The skill drafts a polite but firm follow-up message and can optionally write it to the client workspace folder. Human review is recommended before sending.',
        examples: [
          'Follow up on invoice #42 for Acme Corp, 3000 EUR, due March 1st',
          'Draft an overdue invoice reminder for Wawen22',
          'Send a payment follow-up for the landing page project',
        ],
      }),
      assignments: [
        runtimeAssignment('skill.company.invoice_followup', 'company', 'Company Runtime', 'company'),
        teamAssignment('skill.company.invoice_followup', 'ops', 'company', 'Finance and ops agents handle invoice follow-ups.'),
        teamAssignment('skill.company.invoice_followup', 'executive', 'company', 'CEO can delegate follow-ups through the executive layer.'),
        agentAssignment('skill.company.invoice_followup', 'finance', 'company', 'Finance agent is the primary executor of invoice actions.'),
        agentAssignment('skill.company.invoice_followup', 'ceo', 'company', 'CEO intake can initiate or review invoice follow-ups.'),
      ],
      policy: basePolicy({
        capabilityId: 'skill.company.invoice_followup',
        mode: 'approval_required',
        allowedTools: ['file_system', 'telegram_notify'],
        notes: 'Human review required before any external communication. Draft output only unless founder approves.',
      }),
      health: baseHealth({
        capabilityId: 'skill.company.invoice_followup',
        state: 'connected',
        label: 'Active',
        message: 'Invoice follow-up skill is available to the ops and finance teams.',
        checkedAt: generatedAt,
        freshness: 'fresh',
        reasonCode: 'skill_active',
      }),
      audit: baseAudit({
        capabilityId: 'skill.company.invoice_followup',
        summary: 'Company skill: invoice follow-up drafting for unpaid client invoices. Approval-required policy enforced.',
      }),
    },
    {
      capability: baseCapability({
        id: 'memory.agent_vector_recall',
        type: 'memory_provider',
        label: 'Agent Vector Memory',
        description: 'Persistent per-agent memory backed by Supabase + pgvector recall.',
        owner: 'Platform',
        runtimeTarget: 'company',
        riskLevel: 'medium',
        tags: ['memory', 'pgvector', 'supabase'],
      }),
      assignments: [
        runtimeAssignment('memory.agent_vector_recall', 'company', 'Company Runtime', 'company'),
        teamAssignment('memory.agent_vector_recall', 'executive', 'company'),
        teamAssignment('memory.agent_vector_recall', 'saas', 'company'),
        teamAssignment('memory.agent_vector_recall', 'dev', 'company'),
        teamAssignment('memory.agent_vector_recall', 'consulting', 'company'),
        teamAssignment('memory.agent_vector_recall', 'marketing', 'company'),
        teamAssignment('memory.agent_vector_recall', 'ops', 'company'),
      ],
      policy: basePolicy({
        capabilityId: 'memory.agent_vector_recall',
        mode: 'restricted',
        allowedTools: ['supabase_read', 'memory_service'],
        envRequirements: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
        notes: 'Scoped to agent-specific recall. Retention and similarity thresholds are enforced by backend service.',
      }),
      health: healthFromEnv(
        'memory.agent_vector_recall',
        generatedAt,
        hasEnvVars(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) ? 'Connected' : 'Missing Config',
        ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
        'Supabase-backed memory provider is configured for company agents.',
      ),
      audit: baseAudit({
        capabilityId: 'memory.agent_vector_recall',
        summary: 'Memory provider is live in backend runtime; this MVP does not yet expose detailed usage history.',
      }),
    },
    {
      capability: baseCapability({
        id: 'memory.personal_workspace_context',
        type: 'memory_provider',
        label: 'Personal Workspace Context',
        description: 'Founder profile, recent documents, and personal workspace context used by Assistant HQ.',
        owner: 'Neb',
        runtimeTarget: 'personal',
        status: 'beta',
        riskLevel: 'low',
        tags: ['personal', 'workspace', 'context'],
      }),
      assignments: [
        runtimeAssignment('memory.personal_workspace_context', 'personal', 'Personal Runtime', 'personal'),
      ],
      policy: basePolicy({
        capabilityId: 'memory.personal_workspace_context',
        mode: 'read_only',
        restrictedPaths: [`workspace/personal/${DEFAULT_OWNER_SLUG}`],
        notes: 'Assistant HQ reads founder profile and generated output from the personal workspace.',
      }),
      health: (() => {
        const workspacePresent = existsSync(getPersonalWorkspacePath(DEFAULT_OWNER_SLUG))
        return baseHealth({
          capabilityId: 'memory.personal_workspace_context',
          state: workspacePresent ? 'connected' : 'degraded',
          label: workspacePresent ? 'Connected' : 'Bootstrap Pending',
          message: workspacePresent
            ? 'Founder personal workspace is present and can be read by Assistant HQ.'
            : 'Personal workspace will be initialized on first founder interaction.',
          checkedAt: generatedAt,
          freshness: workspacePresent ? 'fresh' : 'unknown',
          reasonCode: workspacePresent ? 'filesystem_present' : 'filesystem_missing',
          details: workspacePresent
            ? [`Workspace path: ${getPersonalWorkspacePath(DEFAULT_OWNER_SLUG)}`]
            : [],
        })
      })(),
      audit: baseAudit({
        capabilityId: 'memory.personal_workspace_context',
        summary: 'Current MVP exposes workspace context as a first-class capability, not a hidden Assistant HQ assumption.',
      }),
    },
    {
      capability: baseCapability({
        id: 'integration.local_workspace_filesystem',
        type: 'integration',
        label: 'Local Workspace Filesystem',
        description: 'Read and write access to the WAI workspace for repo execution, deliverables, and founder documents.',
        owner: 'Platform',
        runtimeTarget: 'shared',
        riskLevel: 'high',
        tags: ['filesystem', 'workspace', 'repo'],
      }),
      assignments: [
        runtimeAssignment('integration.local_workspace_filesystem', 'company', 'Company Runtime', 'shared'),
        runtimeAssignment('integration.local_workspace_filesystem', 'personal', 'Personal Runtime', 'shared'),
        teamAssignment('integration.local_workspace_filesystem', 'saas', 'shared'),
        teamAssignment('integration.local_workspace_filesystem', 'dev', 'shared'),
        teamAssignment('integration.local_workspace_filesystem', 'ops', 'shared'),
        agentAssignment('integration.local_workspace_filesystem', 'ceo', 'shared', 'Used for founder report output and repo-linked operations.'),
      ],
      policy: basePolicy({
        capabilityId: 'integration.local_workspace_filesystem',
        mode: 'restricted',
        allowedTools: ['file_system', 'file_export', 'shell'],
        restrictedPaths: ['workspace/', 'workspace/personal/'],
        notes: 'Dangerous broad writes stay behind agent-level permissions and path conventions.',
      }),
      health: (() => {
        const workspaceRoot = getWorkspaceRoot()
        const rootPresent = existsSync(workspaceRoot)
        return baseHealth({
          capabilityId: 'integration.local_workspace_filesystem',
          state: rootPresent ? 'connected' : 'degraded',
          label: rootPresent ? 'Connected' : 'Workspace Missing',
          message: rootPresent
            ? `Workspace root available at ${workspaceRoot}.`
            : 'Workspace root is not available on disk.',
          checkedAt: generatedAt,
          freshness: rootPresent ? 'fresh' : 'unknown',
          reasonCode: rootPresent ? 'filesystem_present' : 'filesystem_missing',
          driftWarnings: rootPresent ? [] : ['Workspace root not found — agent file operations will fail.'],
        })
      })(),
      audit: baseAudit({
        capabilityId: 'integration.local_workspace_filesystem',
        summary: 'Shared filesystem surface backs both repo execution and founder document output.',
      }),
    },
    {
      capability: baseCapability({
        id: 'deployment.git_push',
        type: 'integration',
        label: 'GitHub Push Delivery',
        description: 'Pushes the project repository to GitHub as a governed delivery step after QA pass.',
        owner: 'Dev Team',
        runtimeTarget: 'company',
        riskLevel: 'high',
        tags: ['delivery', 'git', 'github'],
        dependsOn: ['integration.local_workspace_filesystem'],
      }),
      assignments: [
        runtimeAssignment('deployment.git_push', 'company', 'Company Runtime', 'company'),
        agentAssignment('deployment.git_push', 'qa', 'company', 'QA executes the governed delivery gates after release pass.'),
      ],
      policy: basePolicy({
        capabilityId: 'deployment.git_push',
        mode: 'restricted',
        allowedTools: ['git', 'shell'],
        envRequirements: ['GITHUB_TOKEN'],
        restrictedPaths: ['workspace/'],
        notes: 'Global disable here overrides per-project gitPush config.',
      }),
      health: healthFromEnv(
        'deployment.git_push',
        generatedAt,
        hasEnvVars(['GITHUB_TOKEN']) ? 'Connected' : 'Missing Config',
        ['GITHUB_TOKEN'],
        'GitHub token is configured for governed repository push delivery.',
      ),
      audit: baseAudit({
        capabilityId: 'deployment.git_push',
        summary: 'Global delivery gate for pushing approved project repos to GitHub.',
      }),
    },
    {
      capability: baseCapability({
        id: 'integration.github',
        type: 'integration',
        label: 'GitHub Integration',
        description: 'Automatic GitHub repo creation, PR and issue management via REST API. Used by Architect to set up remote repos on project init.',
        owner: 'Dev Team',
        runtimeTarget: 'company',
        status: isGitHubConfigured() ? 'active' : 'disabled',
        tags: ['github', 'git', 'delivery', 'repo'],
        dependsOn: [],
      }),
      assignments: [
        runtimeAssignment('integration.github', 'company', 'Company Runtime', 'company'),
        agentAssignment('integration.github', 'architect', 'company', 'Architect auto-creates GitHub repos on project init when GITHUB_TOKEN + GITHUB_OWNER are configured.'),
      ],
      policy: basePolicy({
        capabilityId: 'integration.github',
        mode: 'restricted',
        allowedTools: ['github_api'],
        envRequirements: ['GITHUB_TOKEN', 'GITHUB_OWNER'],
        notes: 'Requires GITHUB_TOKEN and GITHUB_OWNER. When configured, Architect automatically creates a private GitHub repo and pushes the initial commit.',
      }),
      health: healthFromEnv(
        'integration.github',
        generatedAt,
        isGitHubConfigured() ? 'Connected' : 'Missing Config',
        ['GITHUB_TOKEN', 'GITHUB_OWNER'],
        'GitHub token and owner are configured for automatic repo creation and delivery.',
      ),
      audit: baseAudit({
        capabilityId: 'integration.github',
        summary: 'GitHub REST API integration for repo create, PR, and issue management.',
      }),
    },
    {
      capability: baseCapability({
        id: 'deployment.vercel_deploy',
        type: 'integration',
        label: 'Vercel Deploy',
        description: 'Publishes governed project deployments to Vercel after QA and git delivery gates.',
        owner: 'Dev Team',
        runtimeTarget: 'company',
        riskLevel: 'medium',
        tags: ['delivery', 'deploy', 'vercel'],
        dependsOn: ['deployment.git_push'],
      }),
      assignments: [
        runtimeAssignment('deployment.vercel_deploy', 'company', 'Company Runtime', 'company'),
        agentAssignment('deployment.vercel_deploy', 'qa', 'company', 'QA can publish the live build when the project delivery config allows it.'),
      ],
      policy: basePolicy({
        capabilityId: 'deployment.vercel_deploy',
        mode: 'restricted',
        allowedTools: ['deploy_api'],
        envRequirements: ['VERCEL_TOKEN'],
        notes: 'Global disable here overrides per-project autoDeploy when provider=vercel.',
      }),
      health: healthFromEnv(
        'deployment.vercel_deploy',
        generatedAt,
        hasEnvVars(['VERCEL_TOKEN']) ? 'Connected' : 'Missing Config',
        ['VERCEL_TOKEN'],
        'Vercel token is configured for governed live deployments.',
      ),
      audit: baseAudit({
        capabilityId: 'deployment.vercel_deploy',
        summary: 'Global delivery gate for Vercel production deployments.',
      }),
    },
    {
      capability: baseCapability({
        id: 'deployment.netlify_deploy',
        type: 'integration',
        label: 'Netlify Deploy',
        description: 'Publishes governed project deployments to Netlify after QA and git delivery gates.',
        owner: 'Dev Team',
        runtimeTarget: 'company',
        riskLevel: 'medium',
        tags: ['delivery', 'deploy', 'netlify'],
        dependsOn: ['deployment.git_push'],
      }),
      assignments: [
        runtimeAssignment('deployment.netlify_deploy', 'company', 'Company Runtime', 'company'),
        agentAssignment('deployment.netlify_deploy', 'qa', 'company', 'QA can publish the live build when the project delivery config allows it.'),
      ],
      policy: basePolicy({
        capabilityId: 'deployment.netlify_deploy',
        mode: 'restricted',
        allowedTools: ['deploy_api'],
        envRequirements: ['NETLIFY_TOKEN'],
        notes: 'Global disable here overrides per-project autoDeploy when provider=netlify.',
      }),
      health: healthFromEnv(
        'deployment.netlify_deploy',
        generatedAt,
        hasEnvVars(['NETLIFY_TOKEN']) ? 'Connected' : 'Missing Config',
        ['NETLIFY_TOKEN'],
        'Netlify token is configured for governed live deployments.',
      ),
      audit: baseAudit({
        capabilityId: 'deployment.netlify_deploy',
        summary: 'Global delivery gate for Netlify production deployments.',
      }),
    },
    {
      capability: baseCapability({
        id: 'delivery.client_email',
        type: 'integration',
        label: 'Client Delivery Email',
        description: 'Sends the post-delivery client email with repository and live deployment links.',
        owner: 'Ops / Finance / HR',
        runtimeTarget: 'company',
        riskLevel: 'medium',
        tags: ['delivery', 'email', 'client'],
      }),
      assignments: [
        runtimeAssignment('delivery.client_email', 'company', 'Company Runtime', 'company'),
        agentAssignment('delivery.client_email', 'qa', 'company', 'QA can send the governed delivery confirmation email to the client.'),
      ],
      policy: basePolicy({
        capabilityId: 'delivery.client_email',
        mode: 'restricted',
        allowedTools: ['resend_email'],
        envRequirements: ['RESEND_API_KEY', 'RESEND_FROM_EMAIL'],
        notes: 'Global disable here overrides per-project clientEmailOnDelivery.',
      }),
      health: healthFromEnv(
        'delivery.client_email',
        generatedAt,
        hasEnvVars(['RESEND_API_KEY', 'RESEND_FROM_EMAIL']) ? 'Connected' : 'Missing Config',
        ['RESEND_API_KEY', 'RESEND_FROM_EMAIL'],
        'Resend is configured for governed client delivery emails.',
      ),
      audit: baseAudit({
        capabilityId: 'delivery.client_email',
        summary: 'Global delivery gate for client-facing notification email after release.',
      }),
    },
    {
      capability: baseCapability({
        id: 'delivery.auto_invoice',
        type: 'skill',
        label: 'Auto Invoice After Delivery',
        description: 'Creates the project invoice automatically after a successful governed delivery.',
        owner: 'Ops / Finance / HR',
        runtimeTarget: 'company',
        riskLevel: 'medium',
        tags: ['delivery', 'invoice', 'finance'],
      }),
      assignments: [
        runtimeAssignment('delivery.auto_invoice', 'company', 'Company Runtime', 'company'),
        agentAssignment('delivery.auto_invoice', 'qa', 'company', 'QA can trigger the post-delivery invoice only when capability policy allows it.'),
      ],
      policy: basePolicy({
        capabilityId: 'delivery.auto_invoice',
        mode: 'approval_required',
        allowedTools: ['finance_runtime'],
        notes: 'Approval-required by default so invoice automation stays founder-governed until explicitly opened.',
      }),
      health: baseHealth({
        capabilityId: 'delivery.auto_invoice',
        state: 'connected',
        label: 'Active',
        message: 'Auto invoice capability is available, but its global policy governs whether the step can run automatically.',
        checkedAt: generatedAt,
        freshness: 'fresh',
        reasonCode: 'skill_active',
      }),
      audit: baseAudit({
        capabilityId: 'delivery.auto_invoice',
        summary: 'Global delivery gate for automatic invoicing after successful QA delivery.',
      }),
    },
    {
      capability: baseCapability({
        id: 'tool.playwright_screenshot',
        type: 'integration',
        label: 'Browser Screenshot Tool',
        description: 'Automated headless browser capture via Playwright. Used by QA to take a visual snapshot of live deploys.',
        owner: 'Dev Team',
        runtimeTarget: 'company',
        riskLevel: 'low',
        tags: ['browser', 'screenshot', 'playwright', 'qa'],
      }),
      assignments: [
        runtimeAssignment('tool.playwright_screenshot', 'company', 'Company Runtime', 'company'),
        agentAssignment('tool.playwright_screenshot', 'qa', 'company', 'QA uses this to take screenshots of live deployments for the report.'),
      ],
      policy: basePolicy({
        capabilityId: 'tool.playwright_screenshot',
        mode: 'restricted',
        allowedTools: ['playwright'],
        notes: 'Headless Chromium screenshot utility.',
      }),
      health: baseHealth({
        capabilityId: 'tool.playwright_screenshot',
        state: 'connected',
        label: 'Connected',
        message: 'Playwright (Chromium) is available in the backend runtime.',
        checkedAt: generatedAt,
        freshness: 'fresh',
        reasonCode: 'playwright_available',
      }),
      audit: baseAudit({
        capabilityId: 'tool.playwright_screenshot',
        summary: 'Added to provide visual feedback in the QA delivery report.',
      }),
    },
    {
      capability: baseCapability({
        id: 'tool.browser_read',
        type: 'integration',
        label: 'Deep Web Reader',
        description: 'Extracts clean text/markdown from any URL using Playwright and Readability. Allows agents to "read" specific web pages.',
        owner: 'Product / CEO',
        runtimeTarget: 'company',
        riskLevel: 'low',
        tags: ['browser', 'scraping', 'research', 'readability'],
      }),
      assignments: [
        runtimeAssignment('tool.browser_read', 'company', 'Company Runtime', 'company'),
        agentAssignment('tool.browser_read', 'ceo', 'company', 'CEO can read URLs to answer founder questions.'),
        agentAssignment('tool.browser_read', 'analyst', 'company', 'Analyst uses this for deep research into specific sources.'),
        agentAssignment('tool.browser_read', 'marketing_strategist', 'company', 'Marketing reads competitor sites and industry news.'),
      ],
      policy: basePolicy({
        capabilityId: 'tool.browser_read',
        mode: 'restricted',
        allowedTools: ['playwright', 'readability'],
        notes: 'Strictly text extraction, no interaction/form submission.',
      }),
      health: baseHealth({
        capabilityId: 'tool.browser_read',
        state: 'connected',
        label: 'Connected',
        message: 'Playwright and Readability are available.',
        checkedAt: generatedAt,
        freshness: 'fresh',
        reasonCode: 'scraper_available',
      }),
      audit: baseAudit({
        capabilityId: 'tool.browser_read',
        summary: 'Gives WAI the ability to ingest knowledge from specific web pages.',
      }),
    },
    {
      capability: baseCapability({
        id: 'channel.dashboard_control_plane',
        type: 'channel',
        label: 'Dashboard Control Plane',
        description: 'Founder-facing visual control surface for company and personal runtime operations.',
        owner: 'Founder',
        runtimeTarget: 'shared',
        riskLevel: 'medium',
        tags: ['dashboard', 'control-plane', 'visibility'],
      }),
      assignments: [
        runtimeAssignment('channel.dashboard_control_plane', 'company', 'Company Runtime', 'shared'),
        runtimeAssignment('channel.dashboard_control_plane', 'personal', 'Personal Runtime', 'shared'),
      ],
      policy: basePolicy({
        capabilityId: 'channel.dashboard_control_plane',
        mode: 'restricted',
        allowedTools: ['dashboard_http_api'],
        notes: 'Founder control surface only; privileged POST actions remain local-origin guarded.',
      }),
      health: baseHealth({
        capabilityId: 'channel.dashboard_control_plane',
        state: 'connected',
        label: 'Connected',
        message: 'Dashboard and backend control plane are wired in the current local stack.',
        checkedAt: generatedAt,
      }),
      audit: baseAudit({
        capabilityId: 'channel.dashboard_control_plane',
        summary: 'This MVP makes capability visibility itself part of the dashboard control plane.',
      }),
    },
    {
      capability: baseCapability({
        id: 'channel.telegram_founder_interface',
        type: 'channel',
        label: 'Telegram Founder Interface',
        description: 'Primary founder command and notification channel for company and personal operations.',
        owner: 'Founder',
        runtimeTarget: 'shared',
        riskLevel: 'medium',
        tags: ['telegram', 'commands', 'notifications'],
      }),
      assignments: [
        runtimeAssignment('channel.telegram_founder_interface', 'company', 'Company Runtime', 'shared'),
        runtimeAssignment('channel.telegram_founder_interface', 'personal', 'Personal Runtime', 'shared'),
        teamAssignment('channel.telegram_founder_interface', 'executive', 'shared'),
        teamAssignment('channel.telegram_founder_interface', 'ops', 'shared'),
        agentAssignment('channel.telegram_founder_interface', 'ceo', 'shared'),
        agentAssignment('channel.telegram_founder_interface', 'ops', 'shared'),
        agentAssignment('channel.telegram_founder_interface', 'finance', 'shared'),
      ],
      policy: basePolicy({
        capabilityId: 'channel.telegram_founder_interface',
        mode: 'restricted',
        allowedTools: ['telegram_notify'],
        envRequirements: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_FOUNDER_CHAT_ID'],
        notes: 'Founder chat is the command ingress and incident notification surface.',
      }),
      health: healthFromEnv(
        'channel.telegram_founder_interface',
        generatedAt,
        hasEnvVars(['TELEGRAM_BOT_TOKEN', 'TELEGRAM_FOUNDER_CHAT_ID']) ? 'Connected' : 'Missing Config',
        ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_FOUNDER_CHAT_ID'],
        'Telegram founder channel is configured for commands and notifications.',
      ),
      audit: baseAudit({
        capabilityId: 'channel.telegram_founder_interface',
        summary: 'Telegram remains the fastest founder control path while dashboard visibility catches up.',
      }),
    },
    // T101 – WhatsApp channel
    (() => {
      const waStatus = getWhatsAppStatus()
      const waHealth = (() => {
        if (waStatus.state === 'connected') {
          return baseHealth({
            capabilityId: 'channel.whatsapp_founder_interface',
            state: 'connected',
            label: 'Connected',
            message: `WhatsApp session active${waStatus.connectedPhone ? ` (${waStatus.connectedPhone})` : ''}.`,
            checkedAt: generatedAt,
            freshness: 'fresh',
            reasonCode: 'wa_connected',
          })
        }
        if (waStatus.state === 'qr_pending') {
          return baseHealth({
            capabilityId: 'channel.whatsapp_founder_interface',
            state: 'auth_required',
            label: 'QR Pending',
            message: 'WhatsApp QR code ready — scan from the Setup tab in Assistant HQ.',
            checkedAt: generatedAt,
            freshness: 'unknown',
            reasonCode: 'wa_qr_pending',
          })
        }
        return baseHealth({
          capabilityId: 'channel.whatsapp_founder_interface',
          state: 'missing_config',
          label: 'Offline',
          message: 'WhatsApp not initialized. Use Connect in the Assistant HQ Setup tab.',
          checkedAt: generatedAt,
          freshness: 'unknown',
          reasonCode: 'wa_offline',
          driftWarnings: process.env['WHATSAPP_FOUNDER_JID']
            ? []
            : ['WHATSAPP_FOUNDER_JID env var not set — notifications will not be routed.'],
        })
      })()

      return {
        capability: baseCapability({
          id: 'channel.whatsapp_founder_interface',
          type: 'channel',
          label: 'WhatsApp Founder Interface',
          description: 'Secondary founder notification channel via WhatsApp, running alongside Telegram. QR-scan based auth, session persisted locally.',
          owner: 'Founder',
          runtimeTarget: 'shared',
          riskLevel: 'medium',
          tags: ['whatsapp', 'notifications', 'founder'],
          dependsOn: ['channel.telegram_founder_interface'],
        }),
        assignments: [
          runtimeAssignment('channel.whatsapp_founder_interface', 'company', 'Company Runtime', 'shared'),
          runtimeAssignment('channel.whatsapp_founder_interface', 'personal', 'Personal Runtime', 'shared'),
        ],
        policy: basePolicy({
          capabilityId: 'channel.whatsapp_founder_interface',
          mode: 'restricted',
          allowedTools: ['whatsapp_notify'],
          envRequirements: ['WHATSAPP_FOUNDER_JID'],
          notes: 'Notification-only channel. WHATSAPP_FOUNDER_JID must be set for routing. No inbound command handling.',
        }),
        health: waHealth,
        audit: baseAudit({
          capabilityId: 'channel.whatsapp_founder_interface',
          summary: 'WhatsApp is a secondary notification channel — Telegram remains primary. Requires local QR scan to activate.',
        }),
      }
    })(),
  ]

  const catalogWithGovernance = await applyCapabilityGovernanceOverrides(catalogBase)

  const catalog = catalogWithGovernance
    .map((entry) => {
      const capabilityEvents = recentEvents.filter((event) => event.capability_id === entry.capability.id)
      return {
        ...entry,
        health: enrichHealthFromEvents(entry.health, capabilityEvents),
        audit: deriveAuditFromEvents(entry.audit, capabilityEvents),
      }
    })
    .sort(sortCatalog)

  const assignments = catalog.flatMap((entry) => entry.assignments)
  const summary = {
    total: catalog.length,
    byType: {
      skill: 0,
      plugin: 0,
      integration: 0,
      memory_provider: 0,
      channel: 0,
    },
    byRuntimeTarget: {
      personal: 0,
      company: 0,
      shared: 0,
    },
    byHealth: {
      connected: 0,
      degraded: 0,
      missing_config: 0,
      auth_required: 0,
      failing: 0,
      disabled: 0,
    },
  }

  for (const entry of catalog) {
    summary.byType[entry.capability.type] += 1
    summary.byRuntimeTarget[entry.capability.runtimeTarget] += 1
    summary.byHealth[entry.health.state] += 1
  }

  return {
    generatedAt,
    catalog,
    assignments,
    summary,
    recentEvents: recentEvents.slice(0, 60),
  }
}

export async function getCapabilityById(capabilityId: string): Promise<CapabilityCatalogEntry | null> {
  const snapshot = await getCapabilityRegistrySnapshot()
  return snapshot.catalog.find((entry) => entry.capability.id === capabilityId) ?? null
}
