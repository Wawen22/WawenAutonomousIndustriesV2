-- ============================================================
-- WAI – Migration: contacts + contact_interactions (T124 Personal CRM)
-- Founder-focused contact tracking with interaction history.
-- ============================================================

-- ── contacts ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contacts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text        NOT NULL,
  email           text,
  company         text,
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'follow_up', 'dormant')),
  last_contact_at timestamptz,
  notes           text        NOT NULL DEFAULT '',
  tags            text[]      NOT NULL DEFAULT '{}',
  metadata        jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Email uniqueness: partial index allows multiple NULL emails
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_email_unique
  ON contacts(email) WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_status
  ON contacts(status);

CREATE INDEX IF NOT EXISTS idx_contacts_last_contact
  ON contacts(last_contact_at DESC NULLS LAST);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_contacts"
  ON contacts FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_select_contacts"
  ON contacts FOR SELECT TO authenticated USING (true);

CREATE POLICY "service_role_all_contacts"
  ON contacts FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── contact_interactions ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contact_interactions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  uuid        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type        text        NOT NULL
                          CHECK (type IN ('email_in', 'email_out', 'meeting', 'note', 'call')),
  summary     text        NOT NULL,
  source      text        NOT NULL DEFAULT 'manual'
                          CHECK (source IN ('gmail', 'manual', 'calendar')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_interactions_contact_id
  ON contact_interactions(contact_id);

CREATE INDEX IF NOT EXISTS idx_contact_interactions_occurred_at
  ON contact_interactions(occurred_at DESC);

-- RLS
ALTER TABLE contact_interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_contact_interactions"
  ON contact_interactions FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_select_contact_interactions"
  ON contact_interactions FOR SELECT TO authenticated USING (true);

CREATE POLICY "service_role_all_contact_interactions"
  ON contact_interactions FOR ALL TO service_role USING (true) WITH CHECK (true);
