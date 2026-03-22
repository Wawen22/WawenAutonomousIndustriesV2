-- ============================================================
-- WAI Migration 009: Memory Multi-Scope Architecture (T120)
-- Adds scope, project_id, client_id to agent_memories.
-- Inserts sentinel agent '_system' for project/client scoped memories.
-- ============================================================

-- 1. Sentinel agent for system-level memories (project/client scope)
--    Must be inserted before the FK constraint is enforced.
INSERT INTO agents (id, name, role, team, model_id, status, config)
VALUES ('_system', 'System', 'Sentinel agent for project- and client-scoped memories', 'ops', 'nemotron-120b', 'offline', '{}')
ON CONFLICT (id) DO NOTHING;

-- 2. Extend agent_memories with scope and FK columns
ALTER TABLE agent_memories
  ADD COLUMN scope TEXT NOT NULL DEFAULT 'agent'
    CHECK (scope IN ('agent', 'project', 'client')),
  ADD COLUMN project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  ADD COLUMN client_id  UUID REFERENCES clients(id)  ON DELETE CASCADE;

-- 3. Indexes for efficient project/client queries
CREATE INDEX idx_agent_memories_project ON agent_memories(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_agent_memories_client  ON agent_memories(client_id)  WHERE client_id  IS NOT NULL;
