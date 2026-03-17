# WAI – Wawen Autonomous Industries

> **Zero Human Company** – A fully autonomous, multi-agent AI business running 24/7.

WAI is an AI-native company that operates autonomously using a fleet of specialized agents. Each agent has a defined role, model, and set of tools. The Founder (Neb) retains final oversight and can issue commands at any time via Telegram or the WAI Dashboard.

---

## Overview

| Component | Technology | Role |
|-----------|-----------|------|
| Agent Runtime | OpenClaw | Multi-agent orchestration, Telegram, tool/MCP integration |
| Database | Supabase (Postgres + pgvector) | Source of truth: agents, tasks, logs, costs |
| LLM – Complex | Azure Foundry GPT-5.4 | Reasoning, planning, architecture, development |
| LLM – Fast | Gemini 2.5 Flash | Speed, marketing, routing, support |
| Dashboard | React / TypeScript | Real-time monitoring of agents, tasks, costs |
| Deploy | Docker Compose → Hetzner VPS → Mini PC | Progressive deployment |

---

## Architecture in Brief

```
Neb (Telegram / Dashboard)
        │
        ▼
  CEO Agent (GPT-5.4)
  ┌─────┴───────────────────────────────────┐
  │  Team SaaS │ Team Dev │ Team Marketing  │
  │  Team Ops  │ Team Consulting │ Finance  │
  └─────┬───────────────────────────────────┘
        │  reads/writes
        ▼
   Supabase DB  ◄──► WAI Dashboard (Realtime)
```

All agent activity is logged to Supabase. The Dashboard shows live state via Supabase Realtime subscriptions.

---

## Quick Start (Local Development)

### Prerequisites

- Docker & Docker Compose
- Node.js ≥ 22
- pnpm
- OpenClaw installed: `npm install -g openclaw@latest`

### 1. Clone and configure

```bash
git clone <this-repo> wai
cd wai
cp .env.example .env
# Fill in your API keys in .env
```

### 2. Start infrastructure

```bash
docker compose up -d
```

This starts:
- Supabase stack (Postgres, Auth, Storage, Realtime)
- WAI Backend (OpenClaw agents)
- WAI Dashboard (React)

### 3. Run database migrations

```bash
cd supabase
psql $DATABASE_URL -f migrations/001_initial_schema.sql
psql $DATABASE_URL -f seed.sql
```

### 4. Start OpenClaw Gateway

```bash
openclaw gateway --port 18789 --verbose
```

### 5. Access Dashboard

Open [http://localhost:3000](http://localhost:3000)

---

## Project Structure

```
wai/
├── README.md                   # This file
├── CLAUDE.md                   # Instructions for Claude Code / AI agents
├── .env.example                # Environment variable template
├── docker-compose.yml          # Local development stack
├── docs/                       # Documentation
│   ├── VISION.md
│   ├── ARCHITECTURE.md
│   ├── AGENTS_AND_TEAMS.md
│   ├── SUPABASE_SCHEMA.md
│   ├── OPERATIONS_AND_MONITORING.md
│   ├── TASKS_AND_PROJECT_STATE.md
│   ├── DEPLOYMENT_PLAN.md
│   ├── PROJECT_TRACKING.md
│   ├── SECURITY.md
│   └── COSTS_AND_BUDGET.md
├── backend/                    # OpenClaw agent config + WAI backend services
│   ├── src/
│   │   ├── agents/             # Agent definitions and team configs
│   │   ├── config/             # Models, routing, OpenClaw config
│   │   ├── services/           # Supabase, Telegram, logger
│   │   ├── tools/              # Tool definitions (GitHub, email, browser)
│   │   └── types/              # TypeScript types
│   └── package.json
├── dashboard/                  # React/TypeScript WAI Dashboard
│   ├── src/
│   │   ├── components/         # AgentList, TaskBoard, EventTimeline, CostPanel
│   │   ├── hooks/              # Supabase Realtime hooks
│   │   ├── lib/                # Supabase client
│   │   └── types/
│   └── package.json
├── supabase/                   # DB migrations and seed data
│   ├── migrations/
│   └── seed.sql
└── infrastructure/             # Docker, Nginx, deployment configs
    ├── docker-compose.hetzner.yml
    └── nginx/
```

---

## Docs

| File | Description |
|------|-------------|
| [docs/VISION.md](docs/VISION.md) | WAI's vision as a Zero Human Company, long-term goals |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Full technical architecture, component diagram, data flows |
| [docs/AGENTS_AND_TEAMS.md](docs/AGENTS_AND_TEAMS.md) | All agents, their roles, models, tools, and team structure |
| [docs/SUPABASE_SCHEMA.md](docs/SUPABASE_SCHEMA.md) | Database schema: tables, columns, relations, RLS policies |
| [docs/OPERATIONS_AND_MONITORING.md](docs/OPERATIONS_AND_MONITORING.md) | How to start/stop, monitoring, alerts, incident handling |
| [docs/TASKS_AND_PROJECT_STATE.md](docs/TASKS_AND_PROJECT_STATE.md) | Task tracking conventions, states, milestone management |
| [docs/DEPLOYMENT_PLAN.md](docs/DEPLOYMENT_PLAN.md) | Phases: local → Hetzner VPS → mini PC |
| [docs/PROJECT_TRACKING.md](docs/PROJECT_TRACKING.md) | Live roadmap, task list, changelog |
| [docs/SECURITY.md](docs/SECURITY.md) | Security guidelines, key management, network hardening |
| [docs/COSTS_AND_BUDGET.md](docs/COSTS_AND_BUDGET.md) | Budget policy, model cost tracking, alert thresholds |

---

## Founder Commands (Telegram / CLI)

```
/task "description"              → Create a new task
/assign_model agent_id model_id  → Change model for an agent
/status                          → System overview
/logs [agent_id]                 → Recent logs
/budget                          → Current API costs
/approve task_id                 → Approve agent output
/reject task_id "reason"         → Reject with feedback
```

---

## License

Proprietary – Wawen Autonomous Industries © 2025. All rights reserved.
