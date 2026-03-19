// ============================================================
// WAI – Agent Registry
// Defines all agents: role, team, model, tools, permissions
// ============================================================

import type { Agent, AgentConfig } from '../types/index.js'

const defaultPermissions = {
  canReadAllTasks: false,
  canWriteTasks: true,
  canWriteEvents: true,
  canUseShell: false,
  canUseGitHub: false,
  canSendEmail: false,
  canSendTelegram: false,
  canChangeModels: false,
}

function makeConfig(overrides: Partial<AgentConfig['permissions']> & {
  tools: string[]
  maxCostPerTaskUsd?: number
  thinkingLevel?: AgentConfig['thinkingLevel']
}): AgentConfig {
  return {
    tools: overrides.tools,
    maxCostPerTaskUsd: overrides.maxCostPerTaskUsd ?? 5,
    thinkingLevel: overrides.thinkingLevel ?? 'medium',
    permissions: {
      ...defaultPermissions,
      ...overrides,
    },
  }
}

// ---------------------------------------------------------------------------
// Agent Definitions
// ---------------------------------------------------------------------------

export const AGENTS: Record<string, Omit<Agent, 'status' | 'created_at' | 'updated_at'>> = {

  // --- Executive ---

  ceo: {
    id: 'ceo',
    name: 'CEO Agent',
    role: 'Global vision, orchestration, task delegation, Neb reporting',
    team: 'executive',
    model_id: 'gpt-5.4',
    config: makeConfig({
      tools: ['supabase_read', 'supabase_write_tasks', 'supabase_write_events', 'telegram_notify', 'file_export', 'email', 'web_search'],
      maxCostPerTaskUsd: 20,
      thinkingLevel: 'high',
      canReadAllTasks: true,
      canWriteTasks: true,
      canSendEmail: true,
      canSendTelegram: true,
    }),
  },

  // --- Team SaaS ---

  pm_saas: {
    id: 'pm_saas',
    name: 'Product Manager – SaaS',
    role: 'Roadmap, feature prioritization, user stories, acceptance criteria',
    team: 'saas',
    model_id: 'gpt-5.4',
    config: makeConfig({
      tools: ['supabase_read', 'supabase_write_tasks', 'github_issues', 'browser'],
      thinkingLevel: 'high',
      canReadAllTasks: true,
    }),
  },

  dev_lead_saas: {
    id: 'dev_lead_saas',
    name: 'Dev Lead – SaaS',
    role: 'Technical planning, sprint planning, subtask creation, PR reviews',
    team: 'saas',
    model_id: 'gpt-5.4',
    config: makeConfig({
      tools: ['supabase_read', 'supabase_write_tasks', 'github', 'shell_readonly'],
      thinkingLevel: 'high',
      canReadAllTasks: true,
      canUseGitHub: true,
    }),
  },

  dev_saas_1: {
    id: 'dev_saas_1',
    name: 'Developer SaaS #1',
    role: 'Code implementation, tests, PRs, deploy prep',
    team: 'saas',
    model_id: 'gpt-5.4',
    config: makeConfig({
      tools: ['github', 'shell', 'vercel', 'supabase_read', 'file_system'],
      maxCostPerTaskUsd: 10,
      thinkingLevel: 'medium',
      canUseShell: true,
      canUseGitHub: true,
    }),
  },

  dev_saas_2: {
    id: 'dev_saas_2',
    name: 'Developer SaaS #2',
    role: 'Boilerplate, documentation, simple features',
    team: 'saas',
    model_id: 'gemini-2.5-flash',
    config: makeConfig({
      tools: ['github', 'shell', 'file_system'],
      maxCostPerTaskUsd: 3,
      canUseShell: true,
      canUseGitHub: true,
    }),
  },

  // --- Team Dev ---

  architect: {
    id: 'architect',
    name: 'Architect',
    role: 'System design, tech stack decisions, architecture diagrams',
    team: 'dev',
    model_id: 'gpt-5.4',
    config: makeConfig({
      tools: ['github', 'browser', 'supabase_read', 'file_system'],
      maxCostPerTaskUsd: 15,
      thinkingLevel: 'high',
      canReadAllTasks: true,
      canUseGitHub: true,
    }),
  },

  dev_general_1: {
    id: 'dev_general_1',
    name: 'Developer General #1',
    role: 'Implementation, refactoring, debugging',
    team: 'dev',
    model_id: 'gpt-5.4',
    config: makeConfig({
      tools: ['github', 'shell', 'file_system', 'supabase_read'],
      maxCostPerTaskUsd: 10,
      canUseShell: true,
      canUseGitHub: true,
    }),
  },

  dev_general_2: {
    id: 'dev_general_2',
    name: 'Developer General #2',
    role: 'Simple implementations, boilerplate',
    team: 'dev',
    model_id: 'gemini-2.5-flash',
    config: makeConfig({
      tools: ['github', 'shell', 'file_system'],
      maxCostPerTaskUsd: 3,
      canUseShell: true,
      canUseGitHub: true,
    }),
  },

  qa: {
    id: 'qa',
    name: 'QA Agent',
    role: 'Test writing, test execution, quality checklists, bug reports',
    team: 'dev',
    model_id: 'gemini-2.5-flash',
    config: makeConfig({
      tools: ['shell', 'github', 'supabase_read'],
      maxCostPerTaskUsd: 2,
      canUseShell: true,
      canUseGitHub: true,
    }),
  },

  // --- Team Consulting ---

  consulting_lead: {
    id: 'consulting_lead',
    name: 'Consulting Lead',
    role: 'Client request intake, scope definition, delivery management',
    team: 'consulting',
    model_id: 'gpt-5.4',
    config: makeConfig({
      tools: ['supabase_read', 'supabase_write_tasks', 'email', 'browser', 'file_export', 'web_search'],
      maxCostPerTaskUsd: 15,
      thinkingLevel: 'high',
      canReadAllTasks: true,
      canSendEmail: true,
    }),
  },

  analyst: {
    id: 'analyst',
    name: 'Analyst',
    role: 'Research, data gathering, report writing',
    team: 'consulting',
    model_id: 'gpt-5.4',
    config: makeConfig({
      tools: ['browser', 'file_system', 'supabase_read', 'file_export', 'web_search'],
      maxCostPerTaskUsd: 10,
    }),
  },

  // --- Team Marketing ---

  marketing_strategist: {
    id: 'marketing_strategist',
    name: 'Marketing Strategist',
    role: 'Marketing strategy, campaign planning, funnel design',
    team: 'marketing',
    model_id: 'gpt-5.4',
    config: makeConfig({
      tools: ['supabase_read', 'browser', 'email', 'file_export'],
      maxCostPerTaskUsd: 10,
      thinkingLevel: 'high',
      canSendEmail: true,
    }),
  },

  content_creator: {
    id: 'content_creator',
    name: 'Content Creator',
    role: 'Blog posts, social copy, video scripts, email newsletters',
    team: 'marketing',
    model_id: 'gemini-2.5-flash',
    config: makeConfig({
      tools: ['file_system', 'browser', 'supabase_read', 'file_export'],
      maxCostPerTaskUsd: 2,
    }),
  },

  social_manager: {
    id: 'social_manager',
    name: 'Social Media Manager',
    role: 'Content scheduling, engagement monitoring, metrics reporting',
    team: 'marketing',
    model_id: 'gemini-2.5-flash',
    config: makeConfig({
      tools: ['browser', 'supabase_read', 'email', 'file_export'],
      maxCostPerTaskUsd: 1,
      canSendEmail: true,
    }),
  },

  // --- Team Ops/Finance/HR ---

  ops: {
    id: 'ops',
    name: 'Ops Agent',
    role: 'System monitoring, uptime checks, incident response',
    team: 'ops',
    model_id: 'gemini-2.5-flash',
    config: makeConfig({
      tools: ['supabase_read', 'supabase_write_events', 'shell_readonly', 'telegram_notify'],
      maxCostPerTaskUsd: 1,
      canReadAllTasks: true,
      canSendTelegram: true,
    }),
  },

  finance: {
    id: 'finance',
    name: 'Finance Agent',
    role: 'API cost tracking, budget alerts, monthly reports',
    team: 'ops',
    model_id: 'gpt-5.4',
    config: makeConfig({
      tools: ['supabase_read', 'supabase_write_events', 'email', 'telegram_notify', 'file_export'],
      maxCostPerTaskUsd: 2,
      canReadAllTasks: true,
      canSendEmail: true,
      canSendTelegram: true,
    }),
  },

  hr: {
    id: 'hr',
    name: 'HR Agent',
    role: 'Agent documentation, role definitions, process docs',
    team: 'ops',
    model_id: 'gemini-2.5-flash',
    config: makeConfig({
      tools: ['file_system', 'supabase_read', 'supabase_write_events', 'file_export'],
      maxCostPerTaskUsd: 2,
    }),
  },
}

export function getAgent(id: string): Omit<Agent, 'status' | 'created_at' | 'updated_at'> {
  const agent = AGENTS[id]
  if (!agent) throw new Error(`Unknown agent: ${id}`)
  return agent
}

export function getAllAgentIds(): string[] {
  return Object.keys(AGENTS)
}
