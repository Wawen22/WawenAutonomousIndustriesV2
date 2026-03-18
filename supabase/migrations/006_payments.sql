-- ============================================================
-- WAI – Migration 006: payments table for paid revenue tracking
-- Separates invoiced revenue from cash actually received.
-- ============================================================

CREATE TABLE IF NOT EXISTS payments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  amount_usd  numeric     NOT NULL CHECK (amount_usd > 0),
  currency    text        NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  notes       text,
  received_at timestamptz NOT NULL DEFAULT now(),
  metadata    jsonb       NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_project_id
  ON payments(project_id);

CREATE INDEX IF NOT EXISTS idx_payments_received_at
  ON payments(received_at DESC);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_payments" ON payments
  FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_select_payments" ON payments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "service_role_all_payments" ON payments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'payments'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE payments';
  END IF;
END $$;
