// ============================================================
// WAI – Google Workspace MCP Runtime
// Handles OAuth, persistent client state, tool discovery, and
// concrete tool execution against the local workspace-mcp server.
// ============================================================

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import {
  inferGoogleWorkspaceCapabilityIdsFromToolName,
  GOOGLE_WORKSPACE_PLUGIN_CAPABILITY_ID,
} from '../config/capabilities.js'
import { recordCapabilityEvent } from './logger.js'
import { log } from './logger.js'
import { createPersonalWorkspace, getPersonalWorkspacePath } from './workspace.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = join(__dirname, '..', '..', '..')
const MCP_CONFIG_PATH = join(REPO_ROOT, '.mcp.json')
const DEFAULT_OWNER_SLUG = 'neb'
const GOOGLE_WORKSPACE_SERVER_NAME = 'google_workspace'

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

export interface GoogleWorkspaceMcpToolResult {
  name: string
  args: Record<string, unknown>
  isError: boolean
  text: string
  structuredContent?: unknown
  content: unknown[]
}

interface RawMcpServer {
  type?: unknown
  url?: unknown
}

interface RawMcpConfig {
  mcpServers?: Record<string, RawMcpServer>
}

interface PersistedOAuthState {
  clientInformation?: OAuthClientInformationMixed
  tokens?: OAuthTokens
  codeVerifier?: string
  redirectUri?: string
  authorizationUrl?: string
  lastAuthRequestedAt?: string
  lastConnectedAt?: string
  lastError?: string
  tools?: GoogleWorkspaceToolSummary[]
}

function sanitizeOwnerSlug(ownerSlug: string | undefined): string {
  const normalized = ownerSlug?.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-') ?? DEFAULT_OWNER_SLUG
  return normalized || DEFAULT_OWNER_SLUG
}

function getStatePath(ownerSlug: string): string {
  return join(getPersonalWorkspacePath(ownerSlug), 'integrations', 'google-workspace-mcp-oauth.json')
}

async function ensureStateDirectory(ownerSlug: string): Promise<void> {
  await createPersonalWorkspace(ownerSlug)
  await mkdir(join(getPersonalWorkspacePath(ownerSlug), 'integrations'), { recursive: true })
}

async function readState(ownerSlug: string): Promise<PersistedOAuthState> {
  await ensureStateDirectory(ownerSlug)
  const statePath = getStatePath(ownerSlug)
  if (!existsSync(statePath)) {
    return {}
  }

  try {
    const raw = await readFile(statePath, 'utf-8')
    return JSON.parse(raw) as PersistedOAuthState
  } catch (err) {
    log.warn({ err, statePath }, 'Failed to read Google Workspace MCP OAuth state, resetting')
    return {}
  }
}

async function writeState(ownerSlug: string, state: PersistedOAuthState): Promise<void> {
  await ensureStateDirectory(ownerSlug)
  const statePath = getStatePath(ownerSlug)
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8')
}

async function readGoogleWorkspaceServerUrl(): Promise<string | undefined> {
  if (!existsSync(MCP_CONFIG_PATH)) {
    return undefined
  }

  try {
    const raw = await readFile(MCP_CONFIG_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as RawMcpConfig
    const server = parsed.mcpServers?.[GOOGLE_WORKSPACE_SERVER_NAME]
    return typeof server?.url === 'string' ? server.url : undefined
  } catch (err) {
    log.warn({ err, configPath: MCP_CONFIG_PATH }, 'Failed to parse .mcp.json for Google Workspace MCP')
    return undefined
  }
}

function getBackendBaseUrl(): string {
  const explicit = process.env['PUBLIC_BACKEND_URL']?.trim()
  if (explicit) {
    return explicit.replace(/\/$/, '')
  }

  const port = process.env['BACKEND_PORT'] ?? process.env['PORT'] ?? '3001'
  return `http://127.0.0.1:${port}`
}

function buildRedirectUri(baseUrl?: string): string {
  const normalizedBaseUrl = (baseUrl?.trim() || getBackendBaseUrl()).replace(/\/$/, '')
  return `${normalizedBaseUrl}/api/mcp/google-workspace/callback`
}

function buildClientMetadata(redirectUri: string): OAuthClientMetadata {
  return {
    client_name: 'WAI Google Workspace MCP Client',
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_post',
  }
}

function extractToolTextContent(content: unknown[]): string {
  return content
    .map((item) => {
      if (typeof item === 'string') {
        return item
      }
      if (typeof item !== 'object' || item === null) {
        return String(item)
      }
      const text = (item as Record<string, unknown>)['text']
      if (typeof text === 'string') {
        return text
      }
      return JSON.stringify(item)
    })
    .filter((item) => item.trim().length > 0)
    .join('\n\n')
    .trim()
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function buildProtectedResourceMetadataUrl(serverUrl: string): string {
  const resourceUrl = new URL(serverUrl)
  return new URL(`/.well-known/oauth-protected-resource${resourceUrl.pathname}`, resourceUrl.origin).toString()
}

async function isServerReachable(serverUrl: string): Promise<boolean> {
  try {
    const response = await fetch(buildProtectedResourceMetadataUrl(serverUrl), {
      method: 'GET',
      signal: AbortSignal.timeout(4_000),
    })
    return response.ok
  } catch {
    return false
  }
}

class PersistedOAuthProvider implements OAuthClientProvider {
  clientMetadataUrl?: string
  private store: PersistedOAuthState

  constructor(
    private readonly ownerSlug: string,
    state: PersistedOAuthState,
    private readonly redirectUriValue: string
  ) {
    this.store = state
  }

  get redirectUrl(): string {
    return this.redirectUriValue
  }

  get clientMetadata(): OAuthClientMetadata {
    return buildClientMetadata(this.redirectUriValue)
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.store.clientInformation
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    this.store.clientInformation = clientInformation
    await this.flush()
  }

  tokens(): OAuthTokens | undefined {
    return this.store.tokens
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    this.store.tokens = tokens
    delete this.store.lastError
    await this.flush()
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    this.store.redirectUri = this.redirectUriValue
    this.store.authorizationUrl = authorizationUrl.toString()
    this.store.lastAuthRequestedAt = new Date().toISOString()
    await this.flush()
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.store.codeVerifier = codeVerifier
    await this.flush()
  }

  codeVerifier(): string {
    if (!this.store.codeVerifier) {
      throw new Error('No OAuth code verifier saved for Google Workspace MCP')
    }
    return this.store.codeVerifier
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier'): Promise<void> {
    if (scope === 'all' || scope === 'client') {
      delete this.store.clientInformation
    }
    if (scope === 'all' || scope === 'tokens') {
      delete this.store.tokens
    }
    if (scope === 'all' || scope === 'verifier') {
      delete this.store.codeVerifier
    }
    if (scope === 'all') {
      delete this.store.authorizationUrl
      delete this.store.lastAuthRequestedAt
    }
    await this.flush()
  }

  getAuthorizationUrl(): string | undefined {
    return this.store.authorizationUrl
  }

  async markConnected(tools: GoogleWorkspaceToolSummary[]): Promise<void> {
    delete this.store.authorizationUrl
    delete this.store.codeVerifier
    this.store.lastConnectedAt = new Date().toISOString()
    delete this.store.lastError
    this.store.tools = tools
    await this.flush()
  }

  async markError(message: string): Promise<void> {
    this.store.lastError = message
    await this.flush()
  }

  getState(): PersistedOAuthState {
    return this.store
  }

  private async flush(): Promise<void> {
    await writeState(this.ownerSlug, this.store)
  }
}

async function createClientSession(ownerSlug: string, baseUrl?: string) {
  const serverUrl = await readGoogleWorkspaceServerUrl()
  if (!serverUrl) {
    throw new Error('google_workspace MCP server not configured in .mcp.json')
  }

  const state = await readState(ownerSlug)
  const redirectUri = baseUrl ? buildRedirectUri(baseUrl) : state.redirectUri ?? buildRedirectUri()
  const provider = new PersistedOAuthProvider(ownerSlug, state, redirectUri)
  const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
    authProvider: provider,
  })
  const client = new Client({
    name: 'wai-google-workspace-client',
    version: '0.1.0',
  }, { capabilities: {} })

  return {
    client,
    provider,
    serverUrl,
    transport,
  }
}

function normalizeToolList(tools: Array<{ name: string; description?: string | undefined }>): GoogleWorkspaceToolSummary[] {
  return tools.map((tool) => ({
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
  }))
}

function needsReauth(state: PersistedOAuthState): boolean {
  return !state.tokens || /invalid_token|oauth|required|unauthorized/i.test(state.lastError ?? '')
}

export async function getGoogleWorkspaceUserEmail(): Promise<string> {
  const email = process.env['USER_GOOGLE_EMAIL']?.trim()
  if (!email) {
    throw new Error('USER_GOOGLE_EMAIL missing for Google Workspace MCP')
  }
  return email
}

export async function getGoogleWorkspaceMcpRuntimeStatus(ownerSlugInput?: string): Promise<GoogleWorkspaceMcpRuntimeStatus> {
  const ownerSlug = sanitizeOwnerSlug(ownerSlugInput)
  const serverUrl = await readGoogleWorkspaceServerUrl()
  const state = await readState(ownerSlug)
  const userGoogleEmail = process.env['USER_GOOGLE_EMAIL']?.trim() || null
  const redirectUri = state.redirectUri ?? buildRedirectUri()

  if (!serverUrl) {
    return {
      state: 'missing_config',
      serverName: GOOGLE_WORKSPACE_SERVER_NAME,
      redirectUri,
      userGoogleEmail,
      serverReachable: false,
      hasTokens: Boolean(state.tokens),
      hasClientRegistration: Boolean(state.clientInformation),
      ...(state.authorizationUrl ? { authorizationUrl: state.authorizationUrl } : {}),
      ...(state.lastAuthRequestedAt ? { lastAuthRequestedAt: state.lastAuthRequestedAt } : {}),
      ...(state.lastConnectedAt ? { lastConnectedAt: state.lastConnectedAt } : {}),
      ...(state.lastError ? { lastError: state.lastError } : {}),
      toolCount: state.tools?.length ?? 0,
      tools: state.tools ?? [],
    }
  }

  const serverReachable = await isServerReachable(serverUrl)
  const stateValue: GoogleWorkspaceMcpRuntimeState = !serverReachable
    ? 'offline'
    : state.lastConnectedAt && !needsReauth(state)
      ? 'connected'
      : state.lastError && state.tokens
        ? 'error'
        : 'auth_required'

  return {
    state: stateValue,
    serverName: GOOGLE_WORKSPACE_SERVER_NAME,
    serverUrl,
    redirectUri,
    userGoogleEmail,
    serverReachable,
    hasTokens: Boolean(state.tokens),
    hasClientRegistration: Boolean(state.clientInformation),
    ...(state.authorizationUrl ? { authorizationUrl: state.authorizationUrl } : {}),
    ...(state.lastAuthRequestedAt ? { lastAuthRequestedAt: state.lastAuthRequestedAt } : {}),
    ...(state.lastConnectedAt ? { lastConnectedAt: state.lastConnectedAt } : {}),
    ...(state.lastError ? { lastError: state.lastError } : {}),
    toolCount: state.tools?.length ?? 0,
    tools: state.tools ?? [],
  }
}

export async function startGoogleWorkspaceMcpAuth(ownerSlugInput?: string, baseUrl?: string): Promise<GoogleWorkspaceMcpRuntimeStatus> {
  const ownerSlug = sanitizeOwnerSlug(ownerSlugInput)
  const { client, provider, transport } = await createClientSession(ownerSlug, baseUrl)
  await recordCapabilityEvent({
    capability_id: GOOGLE_WORKSPACE_PLUGIN_CAPABILITY_ID,
    event_type: 'auth_started',
    actor_type: 'dashboard',
    actor_id: ownerSlug,
    source: 'google-workspace-mcp:start-auth',
    summary: 'Google Workspace MCP OAuth flow started.',
    payload: {
      owner_slug: ownerSlug,
    },
  })

  try {
    await client.connect(transport as never)
    const toolResult = await client.listTools()
    await provider.markConnected(normalizeToolList(toolResult.tools))
    await recordCapabilityEvent({
      capability_id: GOOGLE_WORKSPACE_PLUGIN_CAPABILITY_ID,
      event_type: 'auth_completed',
      actor_type: 'dashboard',
      actor_id: ownerSlug,
      source: 'google-workspace-mcp:start-auth',
      summary: 'Google Workspace MCP OAuth flow completed during start-auth.',
      payload: {
        owner_slug: ownerSlug,
        tool_count: toolResult.tools.length,
      },
    })
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      await provider.markError('OAuth authorization required for Google Workspace MCP')
    } else {
      const message = getErrorMessage(err)
      await provider.markError(message)
      await recordCapabilityEvent({
        capability_id: GOOGLE_WORKSPACE_PLUGIN_CAPABILITY_ID,
        event_type: 'failed',
        actor_type: 'dashboard',
        actor_id: ownerSlug,
        source: 'google-workspace-mcp:start-auth',
        summary: 'Google Workspace MCP auth start failed.',
        payload: {
          owner_slug: ownerSlug,
          error: message,
        },
      })
      throw err
    }
  } finally {
    await client.close().catch(() => undefined)
  }

  return getGoogleWorkspaceMcpRuntimeStatus(ownerSlug)
}

export async function finishGoogleWorkspaceMcpAuth(
  authorizationCode: string,
  ownerSlugInput?: string
): Promise<GoogleWorkspaceMcpRuntimeStatus> {
  const ownerSlug = sanitizeOwnerSlug(ownerSlugInput)
  const { client, provider, transport } = await createClientSession(ownerSlug)

  try {
    await transport.finishAuth(authorizationCode)
    await client.connect(transport as never)
    const toolResult = await client.listTools()
    await provider.markConnected(normalizeToolList(toolResult.tools))
    await recordCapabilityEvent({
      capability_id: GOOGLE_WORKSPACE_PLUGIN_CAPABILITY_ID,
      event_type: 'auth_completed',
      actor_type: 'founder',
      actor_id: ownerSlug,
      source: 'google-workspace-mcp:callback',
      summary: 'Google Workspace MCP OAuth callback completed.',
      payload: {
        owner_slug: ownerSlug,
        tool_count: toolResult.tools.length,
      },
    })
  } catch (err) {
    const message = getErrorMessage(err)
    await provider.markError(message)
    await recordCapabilityEvent({
      capability_id: GOOGLE_WORKSPACE_PLUGIN_CAPABILITY_ID,
      event_type: 'failed',
      actor_type: 'founder',
      actor_id: ownerSlug,
      source: 'google-workspace-mcp:callback',
      summary: 'Google Workspace MCP OAuth callback failed.',
      payload: {
        owner_slug: ownerSlug,
        error: message,
      },
    })
    throw err
  } finally {
    await client.close().catch(() => undefined)
  }

  return getGoogleWorkspaceMcpRuntimeStatus(ownerSlug)
}

export async function callGoogleWorkspaceMcpTool(
  name: string,
  args: Record<string, unknown>,
  ownerSlugInput?: string
): Promise<GoogleWorkspaceMcpToolResult> {
  const ownerSlug = sanitizeOwnerSlug(ownerSlugInput)
  const { client, provider, transport } = await createClientSession(ownerSlug)
  const capabilityIds = inferGoogleWorkspaceCapabilityIdsFromToolName(name)

  await Promise.all(capabilityIds.map((capabilityId) => recordCapabilityEvent({
    capability_id: capabilityId,
    event_type: 'used',
    actor_type: 'agent',
    actor_id: 'ceo',
    source: `google-workspace-mcp:tool:${name}`,
    summary: `Google Workspace MCP tool invoked: ${name}.`,
    payload: {
      owner_slug: ownerSlug,
      tool_name: name,
      args,
    },
  })))

  try {
    await client.connect(transport as never)
    const toolResult = await client.listTools()
    await provider.markConnected(normalizeToolList(toolResult.tools))

    const result = await client.callTool({
      name,
      arguments: args,
    })

    const content = Array.isArray(result.content) ? result.content : []
    const text = extractToolTextContent(content)

    await Promise.all(capabilityIds.map((capabilityId) => recordCapabilityEvent({
      capability_id: capabilityId,
      event_type: result.isError ? 'failed' : 'succeeded',
      actor_type: 'agent',
      actor_id: 'ceo',
      source: `google-workspace-mcp:tool:${name}`,
      summary: result.isError
        ? `Google Workspace MCP tool returned an error: ${name}.`
        : `Google Workspace MCP tool completed: ${name}.`,
      payload: {
        owner_slug: ownerSlug,
        tool_name: name,
        is_error: Boolean(result.isError),
      },
    })))

    return {
      name,
      args,
      isError: Boolean(result.isError),
      text,
      ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
      content,
    }
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      await provider.markError('OAuth authorization required for Google Workspace MCP')
      await Promise.all(capabilityIds.map((capabilityId) => recordCapabilityEvent({
        capability_id: capabilityId,
        event_type: 'failed',
        actor_type: 'agent',
        actor_id: 'ceo',
        source: `google-workspace-mcp:tool:${name}`,
        summary: `Google Workspace MCP tool authorization failed: ${name}.`,
        payload: {
          owner_slug: ownerSlug,
          tool_name: name,
          error: 'OAuth authorization required',
        },
      })))
      throw new Error('Google Workspace MCP authorization required. Start OAuth and retry.')
    }

    const message = getErrorMessage(err)
    await provider.markError(message)
    await Promise.all(capabilityIds.map((capabilityId) => recordCapabilityEvent({
      capability_id: capabilityId,
      event_type: 'failed',
      actor_type: 'agent',
      actor_id: 'ceo',
      source: `google-workspace-mcp:tool:${name}`,
      summary: `Google Workspace MCP tool failed: ${name}.`,
      payload: {
        owner_slug: ownerSlug,
        tool_name: name,
        error: message,
      },
    })))
    throw err
  } finally {
    await client.close().catch(() => undefined)
  }
}
