-- ============================================================
-- WAI – Migration 004
-- Add `blocked` to projects.status for QA gating
-- ============================================================

ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_status_check;

ALTER TABLE projects
  ADD CONSTRAINT projects_status_check
  CHECK (status IN ('discovery', 'active', 'paused', 'review', 'blocked', 'delivered', 'invoiced'));
