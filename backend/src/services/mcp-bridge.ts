// ============================================================
// WAI – MCP Bridge Foundation
// Reads local MCP configuration and exposes connector readiness.
// This is the control plane before wiring concrete MCP actions.
// ============================================================

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = join(__dirname, '..', '..', '..')
const MCP_CONFIG_PATH = join(REPO_ROOT, '.mcp.json')

export type McpConnectorId =
  | 'supabase'
  | 'gmail'
  | 'google_calendar'
  | 'google_drive'
  | 'filesystem'

export type McpConnectorStatusValue = 'ready' | 'missing'

export interface McpServerDefinition {
  name: string
  type: string
  url?: string
  command?: string
  args?: string[]
}

export interface McpConnectorStatus {
  id: McpConnectorId
  label: string
  status: McpConnectorStatusValue
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

interface RawMcpServer {
  type?: unknown
  url?: unknown
  command?: unknown
  args?: unknown
}

interface RawMcpConfig {
  mcpServers?: Record<string, RawMcpServer>
}

interface DesiredConnectorDefinition {
  id: McpConnectorId
  label: string
  notesWhenMissing: string
  requiredEnvVars?: string[]
  matches: Array<(server: McpServerDefinition) => boolean>
}

function serverText(server: McpServerDefinition): string {
  return [
    server.name,
    server.type,
    server.url ?? '',
    server.command ?? '',
    ...(server.args ?? []),
  ].join(' ').toLowerCase()
}

const DESIRED_CONNECTORS: DesiredConnectorDefinition[] = [
  {
    id: 'supabase',
    label: 'Supabase MCP',
    notesWhenMissing: 'Needed for DB-side MCP workflows and direct project ops.',
    matches: [
      (server) => server.name === 'supabase',
      (server) => (server.url ?? '').toLowerCase().includes('supabase'),
    ],
  },
  {
    id: 'gmail',
    label: 'Gmail MCP',
    notesWhenMissing: 'Needed for personal inbox workflows and founder-side email automation.',
    requiredEnvVars: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
    matches: [
      (server) => serverText(server).includes('google_workspace'),
      (server) => serverText(server).includes('workspace-mcp'),
      (server) => server.name.toLowerCase().includes('gmail'),
      (server) => (server.url ?? '').toLowerCase().includes('gmail'),
      (server) => (server.command ?? '').toLowerCase().includes('gmail'),
    ],
  },
  {
    id: 'google_calendar',
    label: 'Google Calendar MCP',
    notesWhenMissing: 'Needed for scheduling, reminders, and calendar-aware assistance.',
    requiredEnvVars: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
    matches: [
      (server) => serverText(server).includes('google_workspace'),
      (server) => serverText(server).includes('workspace-mcp'),
      (server) => server.name.toLowerCase().includes('calendar'),
      (server) => (server.url ?? '').toLowerCase().includes('calendar'),
      (server) => (server.command ?? '').toLowerCase().includes('calendar'),
    ],
  },
  {
    id: 'google_drive',
    label: 'Google Drive MCP',
    notesWhenMissing: 'Needed for personal file retrieval, document handling, and founder workspace sync.',
    requiredEnvVars: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
    matches: [
      (server) => serverText(server).includes('google_workspace'),
      (server) => serverText(server).includes('workspace-mcp'),
      (server) => server.name.toLowerCase().includes('drive'),
      (server) => (server.url ?? '').toLowerCase().includes('drive'),
      (server) => (server.command ?? '').toLowerCase().includes('drive'),
    ],
  },
  {
    id: 'filesystem',
    label: 'Filesystem MCP',
    notesWhenMissing: 'Useful for MCP-native file access outside the current WAI local workspace helpers.',
    matches: [
      (server) => server.name.toLowerCase().includes('filesystem'),
      (server) => server.name.toLowerCase().includes('file-system'),
      (server) => (server.url ?? '').toLowerCase().includes('filesystem'),
      (server) => (server.command ?? '').toLowerCase().includes('filesystem'),
    ],
  },
]

function normalizeServer(name: string, raw: RawMcpServer): McpServerDefinition {
  return {
    name,
    type: typeof raw.type === 'string' ? raw.type : 'unknown',
    ...(typeof raw.url === 'string' ? { url: raw.url } : {}),
    ...(typeof raw.command === 'string' ? { command: raw.command } : {}),
    ...(Array.isArray(raw.args) ? { args: raw.args.filter((item): item is string => typeof item === 'string') } : {}),
  }
}

async function readMcpServers(): Promise<McpServerDefinition[]> {
  if (!existsSync(MCP_CONFIG_PATH)) {
    return []
  }

  const raw = await readFile(MCP_CONFIG_PATH, 'utf-8')
  const parsed = JSON.parse(raw) as RawMcpConfig
  const servers = parsed.mcpServers ?? {}
  return Object.entries(servers).map(([name, value]) => normalizeServer(name, value))
}

function findMatchingServer(
  connector: DesiredConnectorDefinition,
  servers: McpServerDefinition[]
): McpServerDefinition | undefined {
  return servers.find((server) => connector.matches.some((matcher) => matcher(server)))
}

function getMissingEnvVars(requiredEnvVars: string[] | undefined): string[] {
  return (requiredEnvVars ?? []).filter((envVar) => !process.env[envVar])
}

export async function getMcpBridgeStatus(): Promise<McpBridgeStatus> {
  const servers = await readMcpServers()

  return {
    configPath: '.mcp.json',
    configPresent: existsSync(MCP_CONFIG_PATH),
    serversConfigured: servers.length,
    connectors: DESIRED_CONNECTORS.map((connector) => {
      const server = findMatchingServer(connector, servers)
      if (!server) {
        return {
          id: connector.id,
          label: connector.label,
          status: 'missing',
          configured: false,
          notes: connector.notesWhenMissing,
        }
      }

      const missingEnvVars = getMissingEnvVars(connector.requiredEnvVars)
      if (missingEnvVars.length > 0) {
        return {
          id: connector.id,
          label: connector.label,
          status: 'missing',
          configured: true,
          serverName: server.name,
          transport: server.type,
          notes: `Server configured, but missing env vars: ${missingEnvVars.join(', ')}.`,
        }
      }

      return {
        id: connector.id,
        label: connector.label,
        status: 'ready',
        configured: true,
        serverName: server.name,
        transport: server.type,
        notes: `Configured via MCP server "${server.name}".`,
      }
    }),
  }
}

export function formatMcpConnectorsForPrompt(status: McpBridgeStatus): string {
  return status.connectors
    .map((connector) => `${connector.id}=${connector.status}`)
    .join(' ')
}
