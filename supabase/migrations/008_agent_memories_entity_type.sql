-- ============================================================
-- WAI – Migration 008: agent memories entity type
-- Add entity_type to agent_memories for better categorization.
-- ============================================================

ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS entity_type text NOT NULL DEFAULT 'general';

CREATE INDEX IF NOT EXISTS idx_agent_memories_entity_type
  ON agent_memories(entity_type);

-- Update match_agent_memories to optionally filter by entity_type
CREATE OR REPLACE FUNCTION match_agent_memories(
  p_agent_id text,
  p_query_embedding text,
  p_match_count int DEFAULT 5,
  p_entity_type text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  agent_id text,
  content text,
  entity_type text,
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
    am.entity_type,
    am.created_at,
    am.ttl,
    1 - (am.embedding <=> (p_query_embedding)::vector(256)) AS similarity
  FROM agent_memories am
  WHERE am.agent_id = p_agent_id
    AND (am.ttl IS NULL OR am.ttl > now())
    AND (p_entity_type IS NULL OR am.entity_type = p_entity_type)
  ORDER BY am.embedding <=> (p_query_embedding)::vector(256)
  LIMIT GREATEST(p_match_count, 1)
$$;
