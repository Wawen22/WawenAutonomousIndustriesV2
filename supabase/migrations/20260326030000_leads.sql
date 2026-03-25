-- ============================================================
-- T133: Lead Generation Engine — leads + harvest_runs tables
-- ============================================================

CREATE TABLE leads (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source            text        NOT NULL DEFAULT 'website_audit'
                                CHECK (source IN ('website_audit', 'google_maps', 'manual', 'freelance')),
  status            text        NOT NULL DEFAULT 'qualified'
                                CHECK (status IN ('new', 'qualified', 'approved', 'sent', 'replied', 'won', 'lost', 'rejected')),
  company_name      text        NOT NULL,
  contact_name      text,
  contact_email     text,
  website           text,
  phone             text,
  location          text,
  sector            text,
  score             integer     NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  findings          jsonb       NOT NULL DEFAULT '[]',
  outreach_subject  text        NOT NULL DEFAULT '',
  outreach_draft    text        NOT NULL DEFAULT '',
  source_url        text,
  contact_id        uuid        REFERENCES contacts(id) ON DELETE SET NULL,
  notes             text        NOT NULL DEFAULT '',
  sent_at           timestamptz,
  replied_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_score ON leads(score DESC);
CREATE INDEX idx_leads_created_at ON leads(created_at DESC);

CREATE TABLE harvest_runs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  harvester     text        NOT NULL,
  query         text,
  location      text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  leads_found   integer     NOT NULL DEFAULT 0,
  status        text        NOT NULL DEFAULT 'running'
                            CHECK (status IN ('running', 'done', 'failed')),
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Updated_at trigger for leads only (harvest_runs is append-only)
CREATE OR REPLACE FUNCTION set_leads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_leads_updated_at();

-- RLS
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE harvest_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon select leads" ON leads FOR SELECT TO anon USING (true);
CREATE POLICY "auth select leads" ON leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "service all leads" ON leads FOR ALL TO service_role USING (true);

CREATE POLICY "anon select harvest_runs" ON harvest_runs FOR SELECT TO anon USING (true);
CREATE POLICY "auth select harvest_runs" ON harvest_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY "service all harvest_runs" ON harvest_runs FOR ALL TO service_role USING (true);
