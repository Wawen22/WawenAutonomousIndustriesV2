-- ============================================================
-- WAI – project_checklists table
-- Per-project checklist items updated by agents and visible in dashboard.
-- Each item is identified by (project_id, key) — upsert-safe.
-- ============================================================

CREATE TABLE IF NOT EXISTS project_checklists (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key           text NOT NULL,               -- machine key, e.g. 'scaffold', 'qa_pass'
  label         text NOT NULL,               -- human label, e.g. 'Build passing'
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'in_progress', 'done', 'failed', 'skipped')),
  category      text NOT NULL DEFAULT 'delivery'
                  CHECK (category IN ('delivery', 'technical', 'quality', 'business')),
  agent_id      text REFERENCES agents(id) ON DELETE SET NULL,
  notes         text,
  order_index   int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, key)
);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION update_project_checklists_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_project_checklists_updated_at
  BEFORE UPDATE ON project_checklists
  FOR EACH ROW EXECUTE FUNCTION update_project_checklists_updated_at();

-- Indexes
CREATE INDEX idx_project_checklists_project ON project_checklists(project_id);
CREATE INDEX idx_project_checklists_status ON project_checklists(project_id, status);

-- RLS
ALTER TABLE project_checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full" ON project_checklists
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read" ON project_checklists
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "anon_read" ON project_checklists
  FOR SELECT TO anon USING (true);

COMMENT ON TABLE project_checklists IS
  'Per-project delivery checklist items. Created by architect, updated by agents as milestones are reached. Realtime-enabled for dashboard visibility.';
