-- ============================================================
-- WAI – Migration 010: knowledge_items (T123 Second Brain)
-- Personal knowledge base with pgvector semantic search.
-- ============================================================

CREATE TABLE IF NOT EXISTS knowledge_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_slug  text        NOT NULL DEFAULT 'neb',
  title       text        NOT NULL,
  content     text        NOT NULL,
  source_type text        NOT NULL CHECK (source_type IN ('note', 'url', 'file')),
  source_url  text,
  tags        text[]      NOT NULL DEFAULT '{}',
  embedding   vector(1536) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_owner
  ON knowledge_items(owner_slug);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_created
  ON knowledge_items(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_embedding
  ON knowledge_items USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

CREATE OR REPLACE FUNCTION match_knowledge_items(
  p_owner_slug      text,
  p_query_embedding text,
  p_match_count     int     DEFAULT 5,
  p_min_similarity  float   DEFAULT 0.3
)
RETURNS TABLE (
  id          uuid,
  owner_slug  text,
  title       text,
  content     text,
  source_type text,
  source_url  text,
  tags        text[],
  created_at  timestamptz,
  similarity  double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    ki.id,
    ki.owner_slug,
    ki.title,
    ki.content,
    ki.source_type,
    ki.source_url,
    ki.tags,
    ki.created_at,
    1 - (ki.embedding <=> (p_query_embedding)::vector(1536)) AS similarity
  FROM knowledge_items ki
  WHERE
    ki.owner_slug = p_owner_slug
    AND 1 - (ki.embedding <=> (p_query_embedding)::vector(1536)) >= p_min_similarity
  ORDER BY ki.embedding <=> (p_query_embedding)::vector(1536)
  LIMIT GREATEST(p_match_count, 1)
$$;

ALTER TABLE knowledge_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_knowledge_items" ON knowledge_items
  FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_select_knowledge_items" ON knowledge_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "service_role_all_knowledge_items" ON knowledge_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);
