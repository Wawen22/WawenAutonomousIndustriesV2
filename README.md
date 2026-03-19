# WAI – Wawen Autonomous Industries

> **Zero Human Company** — a multi-agent operating system for client delivery and founder execution.

WAI has two practical surfaces:

- **Business OS** for projects, briefs, repos, delivery chains, invoicing, and founder decisions
- **Personal Assistant** for Neb, with Gmail / Calendar / Drive workflows, quick actions, and controlled automations

---

## Stack

| Component | Technology | Role |
|-----------|-----------|------|
| Backend | Node.js 22 + TypeScript | Agent orchestration, founder APIs, Telegram bot |
| Dashboard | React 18 + Vite + Tailwind | Founder UI, monitoring, Assistant HQ |
| Database | Supabase cloud | Source of truth for agents, tasks, runs, events, memory |
| LLM Proxy | LiteLLM | Routes GPT-5.4 and Gemini traffic |
| Founder Interface | Telegram + Dashboard | Human control surface |
| Personal Integrations | Google Workspace MCP | Gmail, Calendar, Drive for personal mode |

---

## Quick Start

```bash
# 1. Start LiteLLM
sg docker -c "docker compose up litellm -d"

# 2. Start backend
cd backend && pnpm dev

# 3. Start dashboard
cd dashboard && pnpm dev
```

Local endpoints:

- backend: `http://localhost:3001`
- dashboard: `http://localhost:3000`
- LiteLLM: `http://localhost:4000`

Typechecks:

```bash
cd backend && pnpm typecheck
cd dashboard && pnpm typecheck
```

If you want Gmail / Calendar / Drive in personal mode:

```bash
./scripts/start-google-workspace-mcp.sh
```

Then connect it from `Assistant HQ`.

---

## Documentation

Start here:

- [docs/INDEX.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/INDEX.md)

Most important docs:

- [docs/PROJECT_TRACKING.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/PROJECT_TRACKING.md) — live status
- [docs/FOUNDER_OPERATIONS_PLAYBOOK.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/FOUNDER_OPERATIONS_PLAYBOOK.md) — founder manual
- [docs/ARCHITECTURE.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/ARCHITECTURE.md) — technical architecture
- [docs/MCP_SETUP.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/MCP_SETUP.md) — Google Workspace MCP setup

Archive:

- [docs/archive/PROJECT_TRACKING_ARCHIVE_2026-03-19.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/archive/PROJECT_TRACKING_ARCHIVE_2026-03-19.md)
- [docs/archive/FOUNDER_PLAYBOOK_ARCHIVE_2026-03-19.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/archive/FOUNDER_PLAYBOOK_ARCHIVE_2026-03-19.md)

---

## Current Status

| Milestone | Status |
|-----------|--------|
| M1–M7 | ✅ Done |
| M8 | ⬜ Todo |
| M9 | 🔄 In Progress |
| M10 | 🔄 In Progress |
| M11 | ⬜ Todo |

Live details always live in:

- [docs/PROJECT_TRACKING.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/PROJECT_TRACKING.md)

---

## Founder Surface

### Business OS

Use WAI for:

- clients and projects
- repo-aware software delivery
- consulting, marketing, and SaaS chains
- invoicing and payment tracking
- blocked-task recovery and human review

### Personal Assistant

Use `Assistant HQ` for:

- latest email
- today agenda
- recent Drive files
- daily founder brief
- automation control for the founder brief

---

## Repo Layout

```text
wai/
├── backend/      # agents, services, founder APIs
├── dashboard/    # founder UI
├── docs/         # knowledge base
├── supabase/     # schema, migrations, seed
├── workspace/    # generated outputs and linked repos
└── CLAUDE.md     # instructions for coding agents
```

---

## License

Proprietary — Wawen Autonomous Industries © 2026.
