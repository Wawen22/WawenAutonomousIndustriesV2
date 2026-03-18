# CLAUDE.md – WAI Agent Instructions

This file defines how Claude Code (or any AI coding agent) must behave when working on the WAI repository. Read this BEFORE making any changes.

---

## What is WAI?

**WAI (Wawen Autonomous Industries)** is a Zero Human Company: a fully autonomous, multi-agent AI business.

- **Backend:** Node.js 22 + TypeScript, porta 3001 — agenti, routing, Telegram bot (grammy)
- **LLM Proxy:** LiteLLM Docker, porta 4000 → Azure GPT-5.4 + Google Gemini 2.5 Flash
- **Database:** Supabase cloud `nxrgwbwhauuusuuytipf` (Postgres + pgvector) — source of truth
- **Dashboard:** React 18 + Vite + Tailwind, porta 3000 — 11 views, Supabase Realtime
- **Founder:** Neb – the only human, gives orders via Telegram (@wai_v2_bot) or WAI Dashboard

### Agent Teams

| Team | Agents |
|------|--------|
| Executive | CEO Agent |
| SaaS | PM_SaaS, Dev Lead SaaS, Dev SaaS |
| Software Dev | Architect, Dev, QA |
| Consulting | Consulting Lead, Analyst |
| Marketing | Strategist, Content Creator, Social Manager |
| Ops/Finance/HR | Ops, Finance, HR |

Full details: `docs/AGENTS_AND_TEAMS.md`

---

## Mandatory Workflow

### BEFORE making any code change:

1. **Read relevant docs** in `docs/` for the task area:
   - Architecture changes → read `docs/ARCHITECTURE.md`
   - Agent changes → read `docs/AGENTS_AND_TEAMS.md`
   - DB changes → read `docs/SUPABASE_SCHEMA.md`
   - Deployment → read `docs/DEPLOYMENT_PLAN.md`

2. **Check `docs/PROJECT_TRACKING.md`** for existing tasks related to the request.
   - If a task exists: note its ID, update status to `in_progress`
   - If no task exists: create a new entry in `PROJECT_TRACKING.md` with a unique ID

3. **State your plan** briefly before writing code (2–3 bullet points max).

### DURING implementation:

- Track sub-steps as you go
- Keep changes focused – do NOT refactor unrelated code
- Respect security rules: no hardcoded API keys, no exposed secrets
- Use TypeScript types defined in `backend/src/types/` and `dashboard/src/types/`
- All agent actions must be logged to Supabase `runs` and `events` tables
- Model routing: use `backend/src/config/models.ts` – never hardcode model names

### AFTER completing a change:

1. **Update `docs/PROJECT_TRACKING.md`:**
   - Mark the task as `done`
   - Add a line to the CHANGELOG section

2. **Provide a concise summary:**
   - What was changed (files modified)
   - How to test it (exact commands or steps)
   - Suggested next tasks (if any)

---

## Code Conventions

### TypeScript
- Strict mode enabled everywhere
- Use named exports, not default exports (except React components)
- Types live in `types/index.ts` files in each package
- No `any` – use `unknown` and type guards

### Supabase
- Never query Supabase directly from components – use hooks in `dashboard/src/hooks/`
- All writes go through service functions in `backend/src/services/supabase.ts`
- RLS is enabled – test queries with the correct role

### OpenClaw / Agents
- Agent configs are in `backend/src/config/agents.ts`
- Never hardcode model IDs in agent files – always use `getModelForAgent(agentId)` from `backend/src/config/models.ts`
- All agent runs must call `logRun(...)` from `backend/src/services/logger.ts`

### Security
- API keys only via environment variables (see `.env.example`)
- Never commit `.env` files
- OpenClaw Gateway listens on loopback only (127.0.0.1)
- See `docs/SECURITY.md` for full guidelines

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `backend/src/config/agents.ts` | All agent definitions (role, model, tools, permissions) |
| `backend/src/config/models.ts` | Model registry + routing logic |
| `backend/src/services/supabase.ts` | Supabase client + typed query helpers |
| `backend/src/services/logger.ts` | Centralized run/event logger |
| `backend/src/services/llm.ts` | LiteLLM client + streaming + memory integration |
| `dashboard/src/hooks/useSupabaseRealtime.ts` | Realtime subscription hooks |
| `supabase/migrations/001_initial_schema.sql` | Full DB schema |
| `docs/PROJECT_TRACKING.md` | Live task board + changelog |

---

## DO NOT

- Do NOT expose LiteLLM or the backend to the public internet without auth
- Do NOT hardcode model names, API keys, or Supabase URLs
- Do NOT skip updating `PROJECT_TRACKING.md` after changes
- Do NOT create new agents without adding them to `backend/src/config/agents.ts`
- Do NOT change the DB schema without updating `docs/SUPABASE_SCHEMA.md` and adding a new migration file
- Do NOT add new npm packages without noting the reason in the PR/task description

---

## Useful Commands

```bash
# Start LiteLLM proxy (Docker)
sg docker -c "docker compose up litellm -d"

# Run backend in dev mode
cd backend && pnpm dev

# Run dashboard in dev mode
cd dashboard && pnpm dev

# Typechecks (run before committing)
cd backend && pnpm typecheck
cd dashboard && pnpm typecheck

# Apply DB migrations (via Supabase SQL editor or CLI)
# supabase/migrations/001_initial_schema.sql ... 006_payments.sql
```
