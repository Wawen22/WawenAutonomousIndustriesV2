-- ============================================================
-- WAI – Seed Data
-- Populates models, agents, and initial project state
-- ============================================================

-- ============================================================
-- MODELS
-- ============================================================

INSERT INTO models (id, provider, display_name, cost_per_1k_input_tokens, cost_per_1k_output_tokens, context_window, is_active, notes)
VALUES
  ('gpt-5.4', 'azure', 'GPT-5.4 (Azure Foundry)', 0.010000, 0.030000, 128000, true,
   'Complex reasoning, planning, architecture, development. Estimate – update with actual pricing.'),
  ('gemini-2.5-flash', 'google', 'Gemini 2.5 Flash', 0.000350, 0.001050, 1000000, true,
   'Fast, low-latency operations. Marketing, support, routing, content.')
ON CONFLICT (id) DO UPDATE SET
  cost_per_1k_input_tokens  = EXCLUDED.cost_per_1k_input_tokens,
  cost_per_1k_output_tokens = EXCLUDED.cost_per_1k_output_tokens,
  is_active                 = EXCLUDED.is_active,
  notes                     = EXCLUDED.notes;

-- ============================================================
-- AGENTS
-- ============================================================

INSERT INTO agents (id, name, role, team, model_id, status, config)
VALUES
  -- Executive
  ('ceo', 'CEO Agent', 'Global vision, orchestration, task delegation, Neb reporting',
   'executive', 'gpt-5.4', 'offline',
   '{"tools": ["supabase_read", "supabase_write_tasks", "telegram_notify"], "maxCostPerTaskUsd": 20, "thinkingLevel": "high", "permissions": {"canReadAllTasks": true, "canWriteTasks": true, "canSendTelegram": true}}'),

  -- Team SaaS
  ('pm_saas', 'Product Manager – SaaS', 'Roadmap, feature prioritization, user stories',
   'saas', 'gpt-5.4', 'offline',
   '{"tools": ["supabase_read", "github_issues", "browser"], "maxCostPerTaskUsd": 10, "thinkingLevel": "high"}'),
  ('dev_lead_saas', 'Dev Lead – SaaS', 'Technical planning, sprint planning, subtask creation',
   'saas', 'gpt-5.4', 'offline',
   '{"tools": ["supabase_read", "github", "shell_readonly"], "maxCostPerTaskUsd": 10, "thinkingLevel": "high"}'),
  ('dev_saas_1', 'Developer SaaS #1', 'Code implementation, tests, PRs, deploy prep',
   'saas', 'gpt-5.4', 'offline',
   '{"tools": ["github", "shell", "vercel", "file_system"], "maxCostPerTaskUsd": 10}'),
  ('dev_saas_2', 'Developer SaaS #2', 'Boilerplate, documentation, simple features',
   'saas', 'gemini-2.5-flash', 'offline',
   '{"tools": ["github", "shell", "file_system"], "maxCostPerTaskUsd": 3}'),

  -- Team Dev
  ('architect', 'Architect', 'System design, tech stack decisions, architecture diagrams',
   'dev', 'gpt-5.4', 'offline',
   '{"tools": ["github", "browser", "file_system"], "maxCostPerTaskUsd": 15, "thinkingLevel": "high"}'),
  ('dev_general_1', 'Developer General #1', 'Implementation, refactoring, debugging',
   'dev', 'gpt-5.4', 'offline',
   '{"tools": ["github", "shell", "file_system"], "maxCostPerTaskUsd": 10}'),
  ('dev_general_2', 'Developer General #2', 'Simple implementations, boilerplate',
   'dev', 'gemini-2.5-flash', 'offline',
   '{"tools": ["github", "shell", "file_system"], "maxCostPerTaskUsd": 3}'),
  ('qa', 'QA Agent', 'Test writing, test execution, quality checklists, bug reports',
   'dev', 'gemini-2.5-flash', 'offline',
   '{"tools": ["shell", "github"], "maxCostPerTaskUsd": 2}'),

  -- Team Consulting
  ('consulting_lead', 'Consulting Lead', 'Client request intake, scope definition',
   'consulting', 'gpt-5.4', 'offline',
   '{"tools": ["supabase_read", "email", "browser"], "maxCostPerTaskUsd": 15, "thinkingLevel": "high"}'),
  ('analyst', 'Analyst', 'Research, data gathering, report writing',
   'consulting', 'gpt-5.4', 'offline',
   '{"tools": ["browser", "file_system"], "maxCostPerTaskUsd": 10}'),

  -- Team Marketing
  ('marketing_strategist', 'Marketing Strategist', 'Marketing strategy, campaign planning, funnel design',
   'marketing', 'gpt-5.4', 'offline',
   '{"tools": ["browser", "email"], "maxCostPerTaskUsd": 10, "thinkingLevel": "high"}'),
  ('content_creator', 'Content Creator', 'Blog posts, social copy, video scripts, newsletters',
   'marketing', 'gemini-2.5-flash', 'offline',
   '{"tools": ["file_system", "browser"], "maxCostPerTaskUsd": 2}'),
  ('social_manager', 'Social Media Manager', 'Content scheduling, engagement monitoring',
   'marketing', 'gemini-2.5-flash', 'offline',
   '{"tools": ["browser", "email"], "maxCostPerTaskUsd": 1}'),

  -- Team Ops / Finance / HR
  ('ops', 'Ops Agent', 'System monitoring, uptime checks, incident response',
   'ops', 'gemini-2.5-flash', 'offline',
   '{"tools": ["supabase_read", "shell_readonly", "telegram_notify"], "maxCostPerTaskUsd": 1}'),
  ('finance', 'Finance Agent', 'API cost tracking, budget alerts, monthly reports',
   'ops', 'gpt-5.4', 'offline',
   '{"tools": ["supabase_read", "email", "telegram_notify"], "maxCostPerTaskUsd": 2}'),
  ('hr', 'HR Agent', 'Agent documentation, role definitions, process docs',
   'ops', 'gemini-2.5-flash', 'offline',
   '{"tools": ["file_system", "supabase_read"], "maxCostPerTaskUsd": 2}'),

  -- Specialist agents (T121)
  ('executive_summary', 'Executive Summary Agent',
   'Transform long documents, agent outputs, and reports into concise actionable summaries',
   'ops', 'glm-4.5-air', 'offline',
   '{"tools": ["file_system", "supabase_read", "file_export"], "maxCostPerTaskUsd": 2}'),
  ('feedback_synthesizer', 'Feedback Synthesizer',
   'Analyze feedback from clients and users, identify patterns, priority scores, and action items',
   'consulting', 'nemotron-120b', 'offline',
   '{"tools": ["file_system", "supabase_read", "file_export"], "maxCostPerTaskUsd": 5}'),
  ('security_auditor', 'Security Auditor',
   'Analyze code, infrastructure, and dependencies for security vulnerabilities and OWASP Top 10',
   'ops', 'nemotron-120b', 'offline',
   '{"tools": ["file_system", "supabase_read", "shell_readonly", "file_export"], "maxCostPerTaskUsd": 10, "thinkingLevel": "high"}'),
  ('api_tester', 'API Tester',
   'Test API endpoints for authentication, edge cases, contract testing, and response validation',
   'dev', 'nemotron-120b', 'offline',
   '{"tools": ["file_system", "supabase_read", "shell_readonly", "file_export"], "maxCostPerTaskUsd": 5}'),
  ('db_optimizer', 'DB Optimizer',
   'Review DB schema, query performance, missing indexes, and N+1 query patterns',
   'dev', 'nemotron-120b', 'offline',
   '{"tools": ["supabase_read", "file_system", "file_export"], "maxCostPerTaskUsd": 5}'),
  ('legal_compliance', 'Legal Compliance Agent',
   'Review contracts, GDPR compliance, privacy policies, and terms of service — analysis only, not legal advice',
   'ops', 'nemotron-120b', 'offline',
   '{"tools": ["file_system", "supabase_read", "file_export"], "maxCostPerTaskUsd": 10, "thinkingLevel": "high"}'),
  ('proposal_strategist', 'Proposal Strategist',
   'Build complete commercial proposals with executive summary, scope, tiered pricing, and ROI',
   'consulting', 'nemotron-120b', 'offline',
   '{"tools": ["file_system", "supabase_read", "file_export"], "maxCostPerTaskUsd": 10, "thinkingLevel": "high"}'),
  ('behavioral_coach', 'Behavioral Coach',
   'Personal habit tracker, accountability check-ins, and productivity nudges for Neb via Telegram',
   'ops', 'glm-4.5-air', 'offline',
   '{"tools": ["supabase_read", "telegram_notify"], "maxCostPerTaskUsd": 1}')

ON CONFLICT (id) DO UPDATE SET
  name     = EXCLUDED.name,
  role     = EXCLUDED.role,
  model_id = EXCLUDED.model_id,
  config   = EXCLUDED.config;

-- ============================================================
-- PROJECT STATE (singleton)
-- ============================================================

INSERT INTO project_state (id, version, phase, active_agents_count, monthly_cost_usd, monthly_budget_usd, total_tasks_done, current_milestone)
VALUES (1, '0.1.0', 'local', 0, 0, 500, 0, 'M7 - First revenue-generating output')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- INITIAL TASKS
-- ============================================================

INSERT INTO tasks (title, description, type, priority, delegator_agent_id, assignee_agent_id, status)
VALUES
  ('[SYS] Configure OpenClaw agent sessions', 'Set up all WAI agents in OpenClaw config. Map agent IDs to OpenClaw sessions.', 'dev', 1, 'founder', 'dev_lead_saas', 'todo'),
  ('[SYS] Apply Supabase Realtime to tables', 'Enable Realtime publication for agents, tasks, events, runs, project_state tables.', 'dev', 1, 'founder', 'dev_saas_1', 'todo'),
  ('[SYS] Configure Telegram bot webhook', 'Verify Telegram bot is receiving commands from Neb. Test /status, /task, /budget.', 'dev', 1, 'founder', 'dev_saas_1', 'todo'),
  ('[OPS] Set up Finance Agent hourly cron', 'Schedule Finance Agent to run budget check every hour via OpenClaw cron.', 'ops', 2, 'founder', 'ops', 'todo'),
  ('[OPS] Set up Ops Agent health check cron', 'Schedule Ops Agent to check agent statuses every 15 minutes.', 'ops', 2, 'founder', 'ops', 'todo')
ON CONFLICT DO NOTHING;

-- Initial event
INSERT INTO events (type, agent_id, payload, severity)
VALUES ('system_startup', null, '{"message": "WAI initialized from seed data", "version": "0.1.0"}', 'info');
