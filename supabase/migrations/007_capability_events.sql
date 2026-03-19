-- ============================================================
-- WAI – Migration 007: capability events audit table
-- Persists capability usage and governance changes for the
-- shared capability platform MVP.
-- ============================================================

CREATE TABLE IF NOT EXISTS capability_events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_id text        NOT NULL,
  event_type    text        NOT NULL,
  actor_type    text        NOT NULL,
  actor_id      text,
  source        text        NOT NULL,
  summary       text        NOT NULL,
  payload       jsonb       NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_capability_events_capability_id
  ON capability_events(capability_id);

CREATE INDEX IF NOT EXISTS idx_capability_events_created_at
  ON capability_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_capability_events_capability_created_at
  ON capability_events(capability_id, created_at DESC);

ALTER TABLE capability_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_capability_events" ON capability_events
  FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_select_capability_events" ON capability_events
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "service_role_all_capability_events" ON capability_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'capability_events'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE capability_events';
  END IF;
END $$;
