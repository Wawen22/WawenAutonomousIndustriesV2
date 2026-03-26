-- ============================================================
-- T139: Self-hosted analytics — page_views table
-- No cookies, GDPR-safe.
-- ============================================================

CREATE TABLE page_views (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  path        text        NOT NULL DEFAULT '/',
  referrer    text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_page_views_path ON page_views(path);
CREATE INDEX idx_page_views_created_at ON page_views(created_at DESC);

-- RLS — write-only for anon (landing page), read for service_role
ALTER TABLE page_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon insert page_views" ON page_views FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "service all page_views" ON page_views FOR ALL TO service_role USING (true);
