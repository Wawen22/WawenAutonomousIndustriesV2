# Supabase Schema – WAI Database

## Overview

Supabase serves as WAI's source of truth. All agent state, task tracking, execution logs, and cost data live here. Supabase Realtime is enabled on key tables to power the live Dashboard.

---

## Tables

### `agents`

Stores the registry of all WAI agents.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `text` PK | Unique agent ID (e.g., `ceo`, `dev_saas_1`) |
| `name` | `text` | Display name |
| `role` | `text` | Short role description |
| `team` | `text` | Team name (saas, dev, marketing, ops, consulting, executive) |
| `model_id` | `text` FK→models | Current assigned model |
| `status` | `text` | `online` \| `offline` \| `error` |
| `config` | `jsonb` | Agent-specific config (tools, permissions, thresholds) |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

---

### `models`

Registry of all available LLM models.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `text` PK | Model ID (e.g., `gpt-5.4`, `gemini-2.5-flash`) |
| `provider` | `text` | `azure` \| `google` \| `local` \| `openai` |
| `display_name` | `text` | Human-readable name |
| `cost_per_1k_input_tokens` | `numeric` | USD cost per 1K input tokens |
| `cost_per_1k_output_tokens` | `numeric` | USD cost per 1K output tokens |
| `context_window` | `int` | Max context window in tokens |
| `is_active` | `bool` | Whether model is available |
| `notes` | `text` | Any relevant notes |

---

### `clients`

Registry of WAI clients (prospects and active).

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` PK | Auto-generated |
| `name` | `text` | Display name |
| `slug` | `text` UNIQUE | URL-safe identifier (e.g., `acme-corp`) |
| `email` | `text` | Contact email (optional) |
| `phone` | `text` | Contact phone (optional) |
| `status` | `text` | `prospect` \| `active` \| `completed` \| `archived` |
| `metadata` | `jsonb` | Extra data (notes, links, contacts) |
| `created_at` | `timestamptz` | |

**RLS:** `anon` SELECT, `service_role` full access.

---

### `projects`

Projects linked to a client, each with a workspace folder.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` PK | Auto-generated |
| `client_id` | `uuid` FK→clients | Owning client |
| `name` | `text` | Display name |
| `slug` | `text` | URL-safe identifier (unique per client) |
| `type` | `text` | `website` \| `app` \| `consulting` \| `marketing` \| `other` |
| `status` | `text` | `discovery` \| `active` \| `paused` \| `review` \| `delivered` \| `invoiced` |
| `workspace_path` | `text` | Relative path to project folder (e.g., `workspace/acme/website`) |
| `contract_value_usd` | `numeric` | Contract value in USD (default 0) |
| `metadata` | `jsonb` | Extra data |
| `created_at` | `timestamptz` | |

**RLS:** `anon` SELECT, `service_role` full access.

---

### `tasks`

The core task management table.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` PK | Auto-generated |
| `title` | `text` | Short task title |
| `description` | `text` | Full task description |
| `status` | `text` | `todo` \| `in_progress` \| `done` \| `blocked` \| `cancelled` |
| `type` | `text` | `dev` \| `marketing` \| `consulting` \| `ops` \| `finance` \| `hr` \| `strategy` |
| `priority` | `int` | 1 (highest) to 5 (lowest) |
| `assignee_agent_id` | `text` FK→agents | Currently assigned agent |
| `delegator_agent_id` | `text` FK→agents | Who assigned the task (agent or `founder`) |
| `parent_task_id` | `uuid` FK→tasks | For subtask hierarchies |
| `project_id` | `uuid` FK→projects | Linked project (optional, added in migration 002) |
| `requires_human_review` | `bool` | If true, Neb must approve before proceeding |
| `metadata` | `jsonb` | Extra data (URLs, context, links) |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |
| `completed_at` | `timestamptz` | When status became `done` |

---

### `runs` (agent_runs)

Records every LLM invocation or tool execution.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` PK | |
| `agent_id` | `text` FK→agents | Which agent ran |
| `task_id` | `uuid` FK→tasks | Related task (optional) |
| `model_id` | `text` FK→models | Which model was used |
| `input_summary` | `text` | Truncated input (first 500 chars) |
| `output_summary` | `text` | Truncated output (first 500 chars) |
| `tokens_input` | `int` | Input tokens consumed |
| `tokens_output` | `int` | Output tokens consumed |
| `cost_usd` | `numeric` | Estimated cost in USD |
| `tools_used` | `text[]` | List of tools invoked in this run |
| `outcome` | `text` | `success` \| `failure` \| `partial` |
| `error_message` | `text` | If outcome is failure |
| `duration_ms` | `int` | Wall-clock time in milliseconds |
| `created_at` | `timestamptz` | |

---

### `events` (activity_log)

High-level audit log of important system events.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` PK | |
| `type` | `text` | Event type (see below) |
| `agent_id` | `text` FK→agents | Agent that triggered the event |
| `task_id` | `uuid` FK→tasks | Related task (optional) |
| `payload` | `jsonb` | Event-specific data |
| `severity` | `text` | `info` \| `warning` \| `error` \| `critical` |
| `created_at` | `timestamptz` | |

**Event Types:**
- `task_created`, `task_assigned`, `task_started`, `task_completed`, `task_blocked`
- `agent_online`, `agent_offline`, `agent_error`
- `model_changed`, `model_failover`
- `budget_alert`, `budget_exceeded`
- `human_review_requested`, `human_approved`, `human_rejected`
- `run_completed`, `run_failed`
- `system_startup`, `system_shutdown`

---

### `project_state`

Aggregate state of WAI as a whole.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `int` PK | Always 1 (singleton) |
| `version` | `text` | Current WAI version |
| `phase` | `text` | `local` \| `hetzner` \| `mini_pc` |
| `active_agents_count` | `int` | Currently online agents |
| `monthly_cost_usd` | `numeric` | Running total this month |
| `monthly_budget_usd` | `numeric` | Configured budget |
| `total_tasks_done` | `int` | All-time completed tasks |
| `current_milestone` | `text` | Active milestone name |
| `last_updated` | `timestamptz` | |
| `metadata` | `jsonb` | Anything else |

---

## Relationships

```
clients ←────────── projects (client_id)
projects ←────────── tasks (project_id)
agents ←────────── tasks (assignee_agent_id, delegator_agent_id)
agents ←────────── runs (agent_id)
agents ←────────── events (agent_id)
tasks  ←────────── runs (task_id)
tasks  ←────────── events (task_id)
tasks  ←────────── tasks (parent_task_id) -- self-referential
models ←────────── agents (model_id)
models ←────────── runs (model_id)
```

---

## Realtime Subscriptions

The following tables have Realtime enabled and are subscribed to by the Dashboard:

| Table | Events | Dashboard Component |
|-------|--------|-------------------|
| `agents` | UPDATE | Agent List (status, model) |
| `tasks` | INSERT, UPDATE | Task Board (Kanban) |
| `events` | INSERT | Event Timeline |
| `runs` | INSERT | Cost Panel, Agent Activity |
| `project_state` | UPDATE | Header stats |
| `clients` | INSERT, UPDATE | Clients View |
| `projects` | INSERT, UPDATE | Projects View |

---

## Row-Level Security (RLS)

All tables have RLS enabled. Policies:

| Role | Access |
|------|--------|
| `service_role` | Full access (backend uses this) |
| `anon` | No access (public not allowed) |
| `authenticated` | Read-only on `agents`, `tasks`, `events`, `project_state` (dashboard user) |

Agent-specific write policies are enforced at the service layer (not Supabase RLS) since all backend calls use `service_role`.

---

## Indexes

```sql
-- Fast task lookups by status and assignee
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_agent_id);
CREATE INDEX idx_tasks_created ON tasks(created_at DESC);

-- Fast run lookups for cost aggregation
CREATE INDEX idx_runs_agent ON runs(agent_id);
CREATE INDEX idx_runs_created ON runs(created_at DESC);
CREATE INDEX idx_runs_model ON runs(model_id);

-- Event log queries
CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_events_created ON events(created_at DESC);
CREATE INDEX idx_events_severity ON events(severity);
```
