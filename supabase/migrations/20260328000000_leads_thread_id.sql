-- ============================================================
-- T137: Gmail Reply Tracking — add thread_id to leads
-- ============================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS thread_id text;

CREATE INDEX IF NOT EXISTS idx_leads_thread_id ON leads(thread_id)
  WHERE thread_id IS NOT NULL;
