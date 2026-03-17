-- ============================================================
-- WAI – Initial Database Schema
-- Run: psql $DATABASE_URL -f migrations/001_initial_schema.sql
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================
-- MODELS
-- ============================================================

CREATE TABLE IF NOT EXISTS models (
  id                          TEXT PRIMARY KEY,
  provider                    TEXT NOT NULL CHECK (provider IN ('azure', 'google', 'openai', 'local')),
  display_name                TEXT NOT NULL,
  cost_per_1k_input_tokens    NUMERIC(10, 6) NOT NULL DEFAULT 0,
  cost_per_1k_output_tokens   NUMERIC(10, 6) NOT NULL DEFAULT 0,
  context_window              INT NOT NULL DEFAULT 128000,
  is_active                   BOOLEAN NOT NULL DEFAULT true,
  notes                       TEXT
);

-- ============================================================
-- AGENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS agents (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  role         TEXT NOT NULL,
  team         TEXT NOT NULL CHECK (team IN ('executive', 'saas', 'dev', 'consulting', 'marketing', 'ops')),
  model_id     TEXT NOT NULL REFERENCES models(id),
  status       TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'error', 'busy')),
  config       JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TASKS
-- ============================================================

CREATE TABLE IF NOT EXISTS tasks (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title                 TEXT NOT NULL,
  description           TEXT NOT NULL DEFAULT '',
  status                TEXT NOT NULL DEFAULT 'todo'
                          CHECK (status IN ('todo', 'in_progress', 'done', 'blocked', 'cancelled')),
  type                  TEXT NOT NULL DEFAULT 'dev'
                          CHECK (type IN (
                            'dev', 'dev_complex', 'dev_simple',
                            'marketing', 'content',
                            'consulting', 'analysis',
                            'ops', 'finance', 'hr',
                            'strategy', 'architecture', 'planning',
                            'support', 'routing'
                          )),
  priority              INT NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  assignee_agent_id     TEXT REFERENCES agents(id),
  delegator_agent_id    TEXT,  -- can be 'founder' (not in agents table)
  parent_task_id        UUID REFERENCES tasks(id),
  requires_human_review BOOLEAN NOT NULL DEFAULT false,
  metadata              JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ
);

-- ============================================================
-- RUNS (agent_runs)
-- ============================================================

CREATE TABLE IF NOT EXISTS runs (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id         TEXT NOT NULL REFERENCES agents(id),
  task_id          UUID REFERENCES tasks(id),
  model_id         TEXT NOT NULL REFERENCES models(id),
  input_summary    TEXT NOT NULL DEFAULT '',
  output_summary   TEXT NOT NULL DEFAULT '',
  tokens_input     INT NOT NULL DEFAULT 0,
  tokens_output    INT NOT NULL DEFAULT 0,
  cost_usd         NUMERIC(10, 6) NOT NULL DEFAULT 0,
  tools_used       TEXT[] NOT NULL DEFAULT '{}',
  outcome          TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'partial')),
  error_message    TEXT,
  duration_ms      INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- EVENTS (activity_log)
-- ============================================================

CREATE TABLE IF NOT EXISTS events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type       TEXT NOT NULL,
  agent_id   TEXT REFERENCES agents(id),
  task_id    UUID REFERENCES tasks(id),
  payload    JSONB NOT NULL DEFAULT '{}',
  severity   TEXT NOT NULL DEFAULT 'info'
               CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PROJECT_STATE (singleton)
-- ============================================================

CREATE TABLE IF NOT EXISTS project_state (
  id                    INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version               TEXT NOT NULL DEFAULT '0.1.0',
  phase                 TEXT NOT NULL DEFAULT 'local'
                          CHECK (phase IN ('local', 'hetzner', 'mini_pc')),
  active_agents_count   INT NOT NULL DEFAULT 0,
  monthly_cost_usd      NUMERIC(10, 2) NOT NULL DEFAULT 0,
  monthly_budget_usd    NUMERIC(10, 2) NOT NULL DEFAULT 500,
  total_tasks_done      INT NOT NULL DEFAULT 0,
  current_milestone     TEXT NOT NULL DEFAULT 'M1 - Local Development Stack',
  last_updated          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata              JSONB NOT NULL DEFAULT '{}'
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_tasks_status     ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee   ON tasks(assignee_agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_created    ON tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_priority   ON tasks(priority);

CREATE INDEX IF NOT EXISTS idx_runs_agent       ON runs(agent_id);
CREATE INDEX IF NOT EXISTS idx_runs_created     ON runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_model       ON runs(model_id);
CREATE INDEX IF NOT EXISTS idx_runs_task        ON runs(task_id);

CREATE INDEX IF NOT EXISTS idx_events_type      ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_created   ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_severity  ON events(severity);
CREATE INDEX IF NOT EXISTS idx_events_agent     ON events(agent_id);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agents_updated_at
  BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW-LEVEL SECURITY
-- ============================================================

ALTER TABLE agents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE models        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE runs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_state ENABLE ROW LEVEL SECURITY;

-- Service role: full access (backend uses this)
-- anon: no access by default
-- authenticated: read-only (dashboard user)

CREATE POLICY "authenticated_read_agents" ON agents
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_read_models" ON models
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_read_tasks" ON tasks
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_read_runs" ON runs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_read_events" ON events
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_read_project_state" ON project_state
  FOR SELECT TO authenticated USING (true);

-- ============================================================
-- REALTIME
-- Supabase: enable via Dashboard > Database > Replication
-- or via SQL:
-- ============================================================

-- ALTER PUBLICATION supabase_realtime ADD TABLE agents;
-- ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
-- ALTER PUBLICATION supabase_realtime ADD TABLE events;
-- ALTER PUBLICATION supabase_realtime ADD TABLE runs;
-- ALTER PUBLICATION supabase_realtime ADD TABLE project_state;

COMMENT ON TABLE agents IS 'WAI agent registry';
COMMENT ON TABLE models IS 'LLM model registry with pricing';
COMMENT ON TABLE tasks IS 'Task management system';
COMMENT ON TABLE runs IS 'Agent execution log with token/cost tracking';
COMMENT ON TABLE events IS 'High-level activity log for dashboard';
COMMENT ON TABLE project_state IS 'Singleton aggregate project state';
