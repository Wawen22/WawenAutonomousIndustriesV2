-- ============================================================
-- WAI – Migration 003: projects delivery context
-- Run: psql $DATABASE_URL -f supabase/migrations/003_projects_delivery_context.sql
-- ============================================================

-- ---------------------------------------------------------------------------
-- Expand projects.type to support WAI's broader service lines
-- ---------------------------------------------------------------------------

ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_type_check;

ALTER TABLE projects
  ADD CONSTRAINT projects_type_check
  CHECK (
    type IN (
      'website',
      'app',
      'saas',
      'consulting',
      'ai',
      'marketing',
      'content',
      'copywriting',
      'design',
      'automation',
      'other'
    )
  );

-- ---------------------------------------------------------------------------
-- Optional repo context for software / SaaS projects
-- ---------------------------------------------------------------------------

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS repo_url text,
  ADD COLUMN IF NOT EXISTS repo_local_path text,
  ADD COLUMN IF NOT EXISTS repo_default_branch text,
  ADD COLUMN IF NOT EXISTS repo_provider text;

ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_repo_provider_check;

ALTER TABLE projects
  ADD CONSTRAINT projects_repo_provider_check
  CHECK (
    repo_provider IS NULL
    OR repo_provider IN ('github', 'gitlab', 'bitbucket', 'other')
  );

CREATE INDEX IF NOT EXISTS idx_projects_repo_provider ON projects(repo_provider);
CREATE INDEX IF NOT EXISTS idx_projects_repo_local_path ON projects(repo_local_path);
