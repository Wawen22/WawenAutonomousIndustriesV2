-- ============================================================
-- WAI – Migration 005: agent memories (pgvector)
-- Persistent per-agent long-term memory with vector recall.
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_memories (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    text        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  content     text        NOT NULL,
  embedding   vector(256) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  ttl         timestamptz
);

CREATE INDEX IF NOT EXISTS idx_agent_memories_agent_id
  ON agent_memories(agent_id);

CREATE INDEX IF NOT EXISTS idx_agent_memories_created_at
  ON agent_memories(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_memories_ttl
  ON agent_memories(ttl);

CREATE INDEX IF NOT EXISTS idx_agent_memories_embedding
  ON agent_memories USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE OR REPLACE FUNCTION match_agent_memories(
  p_agent_id text,
  p_query_embedding text,
  p_match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  agent_id text,
  content text,
  created_at timestamptz,
  ttl timestamptz,
  similarity double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    am.id,
    am.agent_id,
    am.content,
    am.created_at,
    am.ttl,
    1 - (am.embedding <=> (p_query_embedding)::vector(256)) AS similarity
  FROM agent_memories am
  WHERE am.agent_id = p_agent_id
    AND (am.ttl IS NULL OR am.ttl > now())
  ORDER BY am.embedding <=> (p_query_embedding)::vector(256)
  LIMIT GREATEST(p_match_count, 1)
$$;

ALTER TABLE agent_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_agent_memories" ON agent_memories
  FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_select_agent_memories" ON agent_memories
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "service_role_all_agent_memories" ON agent_memories
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'agent_memories'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE agent_memories';
  END IF;
END $$;
