// ============================================================
// WAI – Tool Registry
// Central registry of all tools available to WAI agents.
// Add new tools here to make them available system-wide.
// ============================================================

export interface ToolDefinition {
  id: string
  name: string
  description: string
  category: 'code' | 'data' | 'communication' | 'research' | 'system'
  requiredEnvVars: string[]
}

export const TOOL_REGISTRY: Record<string, ToolDefinition> = {
  supabase_read: {
    id: 'supabase_read',
    name: 'Supabase Read',
    description: 'Read data from Supabase tables (agents, tasks, runs, events)',
    category: 'data',
    requiredEnvVars: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
  },
  supabase_write_tasks: {
    id: 'supabase_write_tasks',
    name: 'Supabase Write Tasks',
    description: 'Create and update tasks in Supabase',
    category: 'data',
    requiredEnvVars: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
  },
  supabase_write_events: {
    id: 'supabase_write_events',
    name: 'Supabase Write Events',
    description: 'Log events to Supabase activity log',
    category: 'data',
    requiredEnvVars: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
  },
  github: {
    id: 'github',
    name: 'GitHub',
    description: 'GitHub operations: clone, branch, commit, PR, issues',
    category: 'code',
    requiredEnvVars: ['GITHUB_TOKEN'],
  },
  github_issues: {
    id: 'github_issues',
    name: 'GitHub Issues',
    description: 'Read and write GitHub issues only (no code operations)',
    category: 'code',
    requiredEnvVars: ['GITHUB_TOKEN'],
  },
  shell: {
    id: 'shell',
    name: 'Shell',
    description: 'Execute shell commands (tests, scripts, build)',
    category: 'system',
    requiredEnvVars: [],
  },
  shell_readonly: {
    id: 'shell_readonly',
    name: 'Shell (read-only)',
    description: 'Read-only shell commands (status checks, log reading)',
    category: 'system',
    requiredEnvVars: [],
  },
  vercel: {
    id: 'vercel',
    name: 'Vercel CLI',
    description: 'Deploy and manage Vercel projects',
    category: 'code',
    requiredEnvVars: ['VERCEL_TOKEN'],
  },
  email: {
    id: 'email',
    name: 'Email (Resend)',
    description: 'Send emails to clients and stakeholders via Resend',
    category: 'communication',
    requiredEnvVars: ['RESEND_API_KEY', 'RESEND_FROM_EMAIL'],
  },
  telegram_notify: {
    id: 'telegram_notify',
    name: 'Telegram Notify',
    description: 'Send notifications to Neb via Telegram',
    category: 'communication',
    requiredEnvVars: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_FOUNDER_CHAT_ID'],
  },
  browser: {
    id: 'browser',
    name: 'Browser / HTTP',
    description: 'Browse the web, fetch URLs, do research',
    category: 'research',
    requiredEnvVars: [],
  },
  web_search: {
    id: 'web_search',
    name: 'Web Search (Serper)',
    description: 'Execute live web searches via Serper and return normalized search results',
    category: 'research',
    requiredEnvVars: ['SERPER_API_KEY'],
  },
  file_system: {
    id: 'file_system',
    name: 'File System',
    description: 'Read and write files in the project workspace',
    category: 'system',
    requiredEnvVars: [],
  },
  file_export: {
    id: 'file_export',
    name: 'File Export',
    description: 'Export generated documents into workspace/output for founder or project workflows',
    category: 'system',
    requiredEnvVars: [],
  },
  screenshot: {
    id: 'screenshot',
    name: 'Screenshot',
    description: 'Capture a screenshot of a website or a running local application',
    category: 'research',
    requiredEnvVars: [],
  },
}

export function getToolsForAgent(toolIds: string[]): ToolDefinition[] {
  return toolIds.map((id) => {
    const tool = TOOL_REGISTRY[id]
    if (!tool) throw new Error(`Unknown tool: ${id}`)
    return tool
  })
}

export function validateToolEnvVars(tools: ToolDefinition[]): string[] {
  const missing: string[] = []
  for (const tool of tools) {
    for (const envVar of tool.requiredEnvVars) {
      if (!process.env[envVar]) {
        missing.push(`${envVar} (required by ${tool.name})`)
      }
    }
  }
  return missing
}
