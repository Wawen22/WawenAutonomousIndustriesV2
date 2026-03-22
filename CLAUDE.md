# CLAUDE.md – WAI Agent Instructions

Read this before changing the repository.

---

## What WAI Is

WAI is a dual operating system:

- **Business OS** for autonomous client delivery, task routing, invoicing, and operational control
- **Personal Assistant** for Neb, with Gmail / Calendar / Drive workflows, `Assistant HQ`, and founder automations

Core stack:

- backend: Node.js 22 + TypeScript on port `3001`
- dashboard: React 18 + Vite on port `3000`
- database: Supabase cloud
- LLM routing: LiteLLM on port `4000`
- founder control surface: Telegram + Dashboard

---

## Mandatory Workflow

### Before changing code

1. Read [docs/INDEX.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/INDEX.md) to find the canonical doc for the area.
2. Read [docs/PROJECT_TRACKING.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/PROJECT_TRACKING.md) for current state and active priorities.
3. If you need historical context, use the archive docs instead of bloating live docs again.
4. State a short plan before implementation.

### During implementation

- Keep changes focused.
- Do not refactor unrelated areas.
- Do not hardcode API keys, model names, or secrets.
- Use shared types from `backend/src/types/index.ts` and `dashboard/src/types/index.ts`.
- Log meaningful agent actions through `runs` and `events`.
- Keep documentation aligned when behavior changes.

### After completing work

1. Update docs if needed and update [docs/PROJECT_TRACKING.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/PROJECT_TRACKING.md) with the new live status.
2. If the change creates significant historical context, append or archive it under `docs/archive/`.
3. Explain what changed, how to test it, and the next sensible step.

---

## Documentation Rules

- `docs/INDEX.md` is the documentation entry point.
- `docs/PROJECT_TRACKING.md` is the live status file, not an infinite chronological dump.
- Archives go in `docs/archive/`.
- Each topic should have one canonical document.
- README should stay short and link into the knowledge base instead of duplicating it.
- Don't leave any drift between documentation and the actual state of the code.

---

## Key Docs

| Need | File |
|------|------|
| Current status | [docs/PROJECT_TRACKING.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/PROJECT_TRACKING.md) |
| Founder usage | [docs/FOUNDER_OPERATIONS_PLAYBOOK.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/FOUNDER_OPERATIONS_PLAYBOOK.md) |
| Architecture | [docs/ARCHITECTURE.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/ARCHITECTURE.md) |
| Agents and teams | [docs/AGENTS_AND_TEAMS.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/AGENTS_AND_TEAMS.md) |
| MCP and personal integrations | [docs/MCP_SETUP.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/MCP_SETUP.md) |
| DB schema | [docs/SUPABASE_SCHEMA.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/SUPABASE_SCHEMA.md) |
| Ops and monitoring | [docs/OPERATIONS_AND_MONITORING.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/OPERATIONS_AND_MONITORING.md) |
| Security | [docs/SECURITY.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/SECURITY.md) |

---

## Code Conventions

### TypeScript

- strict mode everywhere
- prefer named exports
- avoid `any`
- keep backend and dashboard types aligned

### Supabase

- dashboard components should not query Supabase directly
- writes go through backend/service functions
- keep schema docs in sync with migrations

### Models and agents

- agent registry: `backend/src/config/agents.ts`
- model routing: `backend/src/config/models.ts`
- never hardcode model IDs inside agent files

### Security

- only env vars for secrets
- never commit `.env`
- keep founder-local APIs loopback-only unless explicit auth is added

---

## Useful Commands

```bash
# LiteLLM
sg docker -c "docker compose up litellm -d"

# Backend
cd backend && pnpm dev

# Dashboard
cd dashboard && pnpm dev

# Typechecks
cd backend && pnpm typecheck
cd dashboard && pnpm typecheck

# Google Workspace MCP
./scripts/start-google-workspace-mcp.sh
```

---

## Do Not

- do not skip updating live docs after meaningful product changes
- do not keep appending giant logs to `PROJECT_TRACKING.md`
- do not create parallel documentation for the same topic
- do not expose secrets, loopback services, or local-only APIs without proper auth

## Key Sentence
When there's ambiguity, choose the option that makes WAI:
- more reliable
- more governable
- closer to delivering and monetizing real work
- not the one that just makes it more impressive to look at.


## Nota del founder
la cartella "openclaw" contiene il progetto OpenClaw da cui WAI prendere spunto per alcune implementazioni, architettura, e best practices. Non è un progetto monolitico da cui copiare tutto, ma una raccolta di esempi e ispirazioni. Consultala quando vuoi implementare qualcosa di nuovo o migliorare un'area esistente, ma adatta sempre le idee al contesto specifico di WAI invece di fare copia-incolla diretto.

La cartella "IDEE-E-INTEGRAZIONI-DI-RIFERIMENTO-PER-WAI" contiene invece una raccolta di idee, integrazioni, repository, e ispirazioni esterne a cui attingere per nuove funzionalità o miglioramenti. Non è una lista di cose da fare, ma un serbatoio di spunti da cui pescare quando si cerca di innovare o risolvere un problema specifico. Consultala regolarmente per trovare ispirazione e mantenere WAI all'avanguardia.