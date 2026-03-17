-- ============================================================
-- WAI – Migration 002: clients + projects tables
-- Run: psql $DATABASE_URL -f supabase/migrations/002_clients_projects.sql
-- ============================================================

-- ---------------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS clients (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  slug        text        NOT NULL UNIQUE,
  email       text,
  phone       text,
  status      text        NOT NULL DEFAULT 'prospect'
                CHECK (status IN ('prospect','active','completed','archived')),
  metadata    jsonb       NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_slug   ON clients(slug);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_clients" ON clients
  FOR SELECT TO anon USING (true);

CREATE POLICY "service_role_all_clients" ON clients
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS projects (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name                text        NOT NULL,
  slug                text        NOT NULL,
  type                text        NOT NULL DEFAULT 'other'
                        CHECK (type IN ('website','app','consulting','marketing','other')),
  status              text        NOT NULL DEFAULT 'discovery'
                        CHECK (status IN ('discovery','active','paused','review','delivered','invoiced')),
  workspace_path      text,
  contract_value_usd  numeric     NOT NULL DEFAULT 0,
  metadata            jsonb       NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_projects_status    ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_type      ON projects(type);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_projects" ON projects
  FOR SELECT TO anon USING (true);

CREATE POLICY "service_role_all_projects" ON projects
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Add project_id to tasks
-- ---------------------------------------------------------------------------

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
