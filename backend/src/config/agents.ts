// ============================================================
// WAI – Agent Registry
// Defines all agents: role, team, model, tools, permissions
// ============================================================

import { AGENT_MODEL_DEFAULTS } from './models.js'
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

const DEFAULT_FALLBACK_MODEL = 'nemotron-120b'

function assignedModel(agentId: string): string {
  return AGENT_MODEL_DEFAULTS[agentId] ?? DEFAULT_FALLBACK_MODEL
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
    model_id: assignedModel('ceo'),
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
    model_id: assignedModel('pm_saas'),
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
    model_id: assignedModel('dev_lead_saas'),
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
    model_id: assignedModel('dev_saas_1'),
    config: makeConfig({
      tools: ['github', 'shell', 'vercel', 'supabase_read', 'file_system', 'screenshot'],
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
    model_id: assignedModel('dev_saas_2'),
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
    model_id: assignedModel('architect'),
    config: makeConfig({
      tools: ['github', 'browser', 'supabase_read', 'file_system'],
      maxCostPerTaskUsd: 15,
      thinkingLevel: 'high',
      canReadAllTasks: true,
      canUseGitHub: true,
    }),
  },

  devops_engineer: {
    id: 'devops_engineer',
    name: 'DevOps Engineer',
    role: 'Project scaffold, dependency install, CI/CD setup, build verification',
    team: 'dev',
    model_id: assignedModel('devops_engineer'),
    config: makeConfig({
      tools: ['shell', 'file_system', 'github', 'supabase_read'],
      maxCostPerTaskUsd: 10,
      canUseShell: true,
      canUseGitHub: true,
    }),
  },

  dev_general: {
    id: 'dev_general',
    name: 'Developer General',
    role: 'Full application implementation, refactoring, debugging, tests',
    team: 'dev',
    model_id: assignedModel('dev_general'),
    config: makeConfig({
      tools: ['github', 'shell', 'file_system', 'supabase_read', 'screenshot'],
      maxCostPerTaskUsd: 10,
      canUseShell: true,
      canUseGitHub: true,
    }),
  },

  ai_engineer: {
    id: 'ai_engineer',
    name: 'AI Engineer',
    role: 'LLM integrations, prompt engineering, RAG pipelines, vector search, embeddings',
    team: 'dev',
    model_id: assignedModel('ai_engineer'),
    config: makeConfig({
      tools: ['shell', 'file_system', 'github', 'supabase_read'],
      maxCostPerTaskUsd: 10,
      thinkingLevel: 'high',
      canUseShell: true,
      canUseGitHub: true,
    }),
  },

  automation_specialist: {
    id: 'automation_specialist',
    name: 'Automation Specialist',
    role: 'Workflow automations, n8n/Zapier/Make integrations, webhooks, data pipelines',
    team: 'dev',
    model_id: assignedModel('automation_specialist'),
    config: makeConfig({
      tools: ['shell', 'file_system', 'github', 'supabase_read', 'browser'],
      maxCostPerTaskUsd: 10,
      canUseShell: true,
      canUseGitHub: true,
    }),
  },

  qa: {
    id: 'qa',
    name: 'QA Agent',
    role: 'Test writing, test execution, quality checklists, bug reports',
    team: 'dev',
    model_id: assignedModel('qa'),
    config: makeConfig({
      tools: ['shell', 'github', 'supabase_read', 'screenshot'],
      maxCostPerTaskUsd: 5,
      thinkingLevel: 'high',
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
    model_id: assignedModel('consulting_lead'),
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
    model_id: assignedModel('analyst'),
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
    model_id: assignedModel('marketing_strategist'),
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
    model_id: assignedModel('content_creator'),
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
    model_id: assignedModel('social_manager'),
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
    model_id: assignedModel('ops'),
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
    model_id: assignedModel('finance'),
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
    model_id: assignedModel('hr'),
    config: makeConfig({
      tools: ['file_system', 'supabase_read', 'supabase_write_events', 'file_export'],
      maxCostPerTaskUsd: 2,
    }),
  },

  // --- New Specialist Agents (T121) ---

  executive_summary: {
    id: 'executive_summary',
    name: 'Executive Summary Agent',
    role: 'Transform long documents, agent outputs, and reports into concise actionable summaries',
    team: 'ops',
    model_id: assignedModel('executive_summary'),
    config: makeConfig({
      tools: ['file_system', 'supabase_read', 'file_export'],
      maxCostPerTaskUsd: 2,
    }),
  },

  feedback_synthesizer: {
    id: 'feedback_synthesizer',
    name: 'Feedback Synthesizer',
    role: 'Analyze feedback from clients and users, identify patterns, priority scores, and action items',
    team: 'consulting',
    model_id: assignedModel('feedback_synthesizer'),
    config: makeConfig({
      tools: ['file_system', 'supabase_read', 'file_export'],
      maxCostPerTaskUsd: 5,
    }),
  },

  security_auditor: {
    id: 'security_auditor',
    name: 'Security Auditor',
    role: 'Analyze code, infrastructure, and dependencies for security vulnerabilities and OWASP Top 10',
    team: 'ops',
    model_id: assignedModel('security_auditor'),
    config: makeConfig({
      tools: ['file_system', 'supabase_read', 'shell_readonly', 'file_export'],
      maxCostPerTaskUsd: 10,
      thinkingLevel: 'high',
      canReadAllTasks: true,
      canUseShell: true,
    }),
  },

  api_tester: {
    id: 'api_tester',
    name: 'API Tester',
    role: 'Test API endpoints for authentication, edge cases, contract testing, and response validation',
    team: 'dev',
    model_id: assignedModel('api_tester'),
    config: makeConfig({
      tools: ['file_system', 'supabase_read', 'shell_readonly', 'file_export'],
      maxCostPerTaskUsd: 5,
      canUseShell: true,
    }),
  },

  db_optimizer: {
    id: 'db_optimizer',
    name: 'DB Optimizer',
    role: 'Review DB schema, query performance, missing indexes, and N+1 query patterns',
    team: 'dev',
    model_id: assignedModel('db_optimizer'),
    config: makeConfig({
      tools: ['supabase_read', 'file_system', 'file_export'],
      maxCostPerTaskUsd: 5,
      canReadAllTasks: true,
    }),
  },

  legal_compliance: {
    id: 'legal_compliance',
    name: 'Legal Compliance Agent',
    role: 'Review contracts, GDPR compliance, privacy policies, and terms of service — analysis only, not legal advice',
    team: 'ops',
    model_id: assignedModel('legal_compliance'),
    config: makeConfig({
      tools: ['file_system', 'supabase_read', 'file_export'],
      maxCostPerTaskUsd: 10,
      thinkingLevel: 'high',
    }),
  },

  proposal_strategist: {
    id: 'proposal_strategist',
    name: 'Proposal Strategist',
    role: 'Build complete commercial proposals with executive summary, scope, tiered pricing, and ROI',
    team: 'consulting',
    model_id: assignedModel('proposal_strategist'),
    config: makeConfig({
      tools: ['file_system', 'supabase_read', 'file_export'],
      maxCostPerTaskUsd: 10,
      thinkingLevel: 'high',
    }),
  },

  behavioral_coach: {
    id: 'behavioral_coach',
    name: 'Behavioral Coach',
    role: 'Personal habit tracker, accountability check-ins, and productivity nudges for Neb via Telegram',
    team: 'ops',
    model_id: assignedModel('behavioral_coach'),
    config: makeConfig({
      tools: ['supabase_read', 'telegram_notify'],
      maxCostPerTaskUsd: 1,
      canSendTelegram: true,
    }),
  },

  content_writer: {
    id: 'content_writer',
    name: 'Content Writer Agent',
    role: 'Autonomous content generation with web research — blog posts, social media posts, newsletters',
    team: 'marketing',
    model_id: assignedModel('content_writer'),
    config: makeConfig({
      tools: ['web_search', 'file_write'],
      maxCostPerTaskUsd: 3,
      thinkingLevel: 'medium',
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
