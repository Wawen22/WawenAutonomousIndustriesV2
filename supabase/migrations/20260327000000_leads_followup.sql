-- ============================================================
-- T136: Lead Gen Follow-up Loop — add follow-up tracking columns
-- ============================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS followed_up_at  timestamptz,
  ADD COLUMN IF NOT EXISTS follow_up_count integer NOT NULL DEFAULT 0;
