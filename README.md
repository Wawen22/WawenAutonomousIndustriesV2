# WAI – Wawen Autonomous Industries

> **Zero Human Company** — A fully autonomous, multi-agent AI business.

WAI is an AI-native company that operates using a fleet of 17 specialized agents. Each agent has a defined role, model, memory, and runtime. The Founder (Neb) retains full oversight and issues commands via Telegram or the WAI Dashboard.

---

## Stack

| Component | Technology | Role |
|-----------|-----------|------|
| Backend | Node.js 22 + TypeScript | Agent orchestration, task routing, Telegram bot |
| LLM Proxy | LiteLLM (Docker, port 4000) | Routes calls to Azure GPT-5.4 and Gemini 2.5 Flash |
| LLM – Complex | Azure Foundry GPT-5.4 | Planning, architecture, complex reasoning |
| LLM – Fast | Google Gemini 2.5 Flash | Fast ops, content, monitoring |
| Database | Supabase cloud (Postgres + pgvector) | Source of truth: agents, tasks, runs, events, memory |
| Dashboard | React 18 + Vite + Tailwind | Real-time monitoring — 11 views |
| Telegram | grammy bot `@wai_v2_bot` | Primary founder interface |

---

## Architecture

```
Neb (Telegram / Dashboard)
        │
        ▼
  CEO Agent (GPT-5.4)          ← NL interface (ceo_intake.ts)
  ┌─────┴───────────────────────────────────────┐
  │  Team SaaS  │  Team Software Dev            │
  │  Team Consulting │ Team Marketing           │
  │  Team Ops / Finance / HR                    │
  └─────┬───────────────────────────────────────┘
        │  reads/writes
        ▼
   Supabase DB  ◄──► WAI Dashboard (Realtime WebSocket)
        ▲
        │
   LiteLLM Proxy (port 4000)
   ├── Azure GPT-5.4
   └── Google Gemini 2.5 Flash
```

---

## Quick Start (Local Development)

### Prerequisites

- Docker & Docker Compose
- Node.js ≥ 22, pnpm
- Supabase cloud project (`wai-v2`) with migrations applied
- `.env` with API keys (see `.env.example`)

### Start

```bash
# 1. Start LiteLLM proxy
sg docker -c "docker compose up litellm -d"

# 2. Start backend (dev mode with hot reload)
cd backend && pnpm dev

# 3. Start dashboard
cd dashboard && pnpm dev
```

Backend on port `3001`, Dashboard on port `3000`.

### Run Typechecks

```bash
cd backend && pnpm typecheck
cd dashboard && pnpm typecheck
```

---

## Project Structure

```
wai/
├── README.md                   # This file
├── CLAUDE.md                   # Instructions for Claude Code / AI agents
├── .env.example                # Environment variable template
├── docker-compose.yml          # LiteLLM proxy service
├── docs/                       # Documentation
│   ├── VISION.md               # Zero Human Company vision and goals
│   ├── ARCHITECTURE.md         # Technical architecture and data flows
│   ├── AGENTS_AND_TEAMS.md     # All 17 agents: roles, models, runtime status
│   ├── SUPABASE_SCHEMA.md      # DB schema: tables, columns, relations, RLS
│   ├── FOUNDER_OPERATIONS_PLAYBOOK.md  # Telegram commands + NL reference guide
│   ├── TASKS_AND_PROJECT_STATE.md      # Task lifecycle, project states, milestones
│   ├── OPERATIONS_AND_MONITORING.md    # Start/stop, monitoring, incident runbooks
│   ├── DEPLOYMENT_PLAN.md      # Phases: local → Hetzner VPS → mini PC
│   ├── SECURITY.md             # Security guidelines and key management
│   ├── COSTS_AND_BUDGET.md     # Budget policy, model costs, alert thresholds
│   └── PROJECT_TRACKING.md     # Live roadmap, task board, changelog
├── backend/                    # Node.js backend — agents + services
│   └── src/
│       ├── agents/             # 17 agent runtimes
│       ├── config/             # Model registry, agent registry
│       ├── services/           # Supabase, Telegram, memory, logger, budget
│       ├── tools/              # Tool definitions (GitHub, email, browser)
│       └── types/              # TypeScript types
├── dashboard/                  # React 18 + Vite dashboard (11 views)
│   └── src/
│       ├── components/         # Views: Overview, TaskBoard, FounderOps, Revenue, ...
│       ├── hooks/              # Supabase Realtime hooks
│       ├── lib/                # clientColors, agentColors, supabase client
│       └── types/              # Dashboard TypeScript types
└── supabase/
    ├── migrations/             # 001–006: schema, clients, multi-service, blocked, memory, payments
    └── seed.sql                # Initial agents + models data
```

---

## Docs Reference

| File | Purpose |
|------|---------|
| [docs/VISION.md](docs/VISION.md) | Vision, business lines, long-term goals |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, component diagram, all data flows |
| [docs/AGENTS_AND_TEAMS.md](docs/AGENTS_AND_TEAMS.md) | Agent roster, models, runtime status |
| [docs/FOUNDER_OPERATIONS_PLAYBOOK.md](docs/FOUNDER_OPERATIONS_PLAYBOOK.md) | **Start here** — all commands and NL examples |
| [docs/SUPABASE_SCHEMA.md](docs/SUPABASE_SCHEMA.md) | Database schema and RLS policies |
| [docs/TASKS_AND_PROJECT_STATE.md](docs/TASKS_AND_PROJECT_STATE.md) | Task states, project lifecycle, milestones |
| [docs/OPERATIONS_AND_MONITORING.md](docs/OPERATIONS_AND_MONITORING.md) | Start/stop, logs, alerts, incident runbooks |
| [docs/DEPLOYMENT_PLAN.md](docs/DEPLOYMENT_PLAN.md) | Deployment phases: local → VPS → mini PC |
| [docs/SECURITY.md](docs/SECURITY.md) | Security guidelines, key management |
| [docs/COSTS_AND_BUDGET.md](docs/COSTS_AND_BUDGET.md) | Budget policy, cost tracking, optimization |
| [docs/PROJECT_TRACKING.md](docs/PROJECT_TRACKING.md) | Live task board and changelog |

---

## Founder Quick Reference

| Action | Telegram | Natural Language |
|--------|----------|-----------------|
| New client | `/new_client "Acme" info@acme.com` | `Crea cliente Acme Corp` |
| New project | `/new_project acme "Landing" website` | `Crea progetto website per acme` |
| Write brief | `/brief acme/landing Testo del brief` | `Aggiorna il brief di acme/landing: ...` |
| Launch work | `/task acme/landing Progetta e implementa` | `Lancia il lavoro per acme/landing` |
| Status | `/status` | `Come stiamo?` |
| Unblock task | `/retry abc12345` | `Sblocca la task abc12345` |
| Invoice | `/invoice acme/landing 2500` | `Fattura acme/landing per 2500` |
| Mark paid | `/mark_paid acme/landing 2500` | `Segna pagato acme/landing 2500` |

Full reference → [docs/FOUNDER_OPERATIONS_PLAYBOOK.md](docs/FOUNDER_OPERATIONS_PLAYBOOK.md)

---

## Milestones

| ID | Milestone | Status |
|----|-----------|--------|
| M1 | Local dev stack running | ✅ Done |
| M2 | CEO Agent — first autonomous task | ✅ Done |
| M3 | Dashboard live with real-time data | ✅ Done |
| M4 | Client & Project Management System | ✅ Done |
| M5 | First autonomous deliverable | ✅ Done |
| M6 | Deploy to Hetzner VPS | ⏸ Deferred (final infra step) |
| M7 | First revenue-generating output | ✅ Done — Wawen22 LandingPage $222 |
| M8 | Migrate to personal mini PC | ⬜ Todo |

---

## License

Proprietary — Wawen Autonomous Industries © 2026. All rights reserved.
