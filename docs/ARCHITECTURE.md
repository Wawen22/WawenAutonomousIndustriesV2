# WAI Architecture

## Overview

WAI is built on four pillars:

1. **OpenClaw** – Agent runtime, multi-channel messaging (Telegram), tool/MCP execution
2. **Supabase** – Persistent data store: agents, tasks, logs, costs, project state
3. **WAI Backend** – TypeScript service layer: model routing, agent orchestration, tool registry
4. **WAI Dashboard** – React/TypeScript real-time UI for Neb

---

## Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      NEB (Founder)                          │
│           Telegram Bot        WAI Dashboard                 │
└─────────────┬───────────────────────┬───────────────────────┘
              │                       │
              ▼                       ▼
┌─────────────────────┐   ┌───────────────────────────────────┐
│  OpenClaw Gateway   │   │       WAI Dashboard               │
│  ws://127.0.0.1:    │   │  React / TypeScript / Vite        │
│  18789              │   │  Port 3000                        │
└────────┬────────────┘   └──────────────┬────────────────────┘
         │                               │ Supabase Realtime
         │ Sessions / Tools              │ WebSocket
         ▼                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    WAI Backend (Node.js)                     │
│                    Port 3001                                 │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  CEO Agent   │  │ Model Router │  │  Tool Registry   │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────┘  │
│         │                 │                                  │
│  ┌──────┴──────────────────────────────────────────────┐    │
│  │              Agent Teams                             │    │
│  │  SaaS │ Dev │ Consulting │ Marketing │ Ops/Finance  │    │
│  └──────────────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          │         Supabase            │
          │  ┌────────────────────────┐ │
          │  │  PostgreSQL + pgvector │ │
          │  │  tables:               │ │
          │  │  agents, tasks, runs,  │ │
          │  │  events, models,       │ │
          │  │  project_state         │ │
          │  └────────────────────────┘ │
          │  Realtime │ Auth │ Storage  │
          └───────────┴──────┴──────────┘
                         │
         ┌───────────────┴────────────────┐
         │      External Services          │
         │  Azure OpenAI  │  Google AI    │
         │  GitHub        │  SendGrid     │
         │  Telegram API  │  Vercel       │
         └────────────────────────────────┘
```

---

## OpenClaw Integration

OpenClaw is the agent runtime. WAI uses it for:

- **Gateway**: WebSocket control plane at `ws://127.0.0.1:18789`
- **Telegram channel**: Neb communicates with WAI via Telegram bot
- **Agent sessions**: Each WAI agent maps to an OpenClaw session
- **Tool execution**: GitHub, browser, shell, Supabase MCP
- **Agent-to-agent**: Via `sessions_send` / `sessions_list` tools

### OpenClaw Config Location

`~/.openclaw/config.yaml` – manages channels, models, sessions, security.

### Key OpenClaw Concepts

| Concept | WAI Usage |
|---------|-----------|
| Gateway | Control plane, always running locally |
| Session | One session per major agent (CEO, team leads) |
| Channel | Telegram (Neb interface) |
| Skills | Custom WAI tools registered as OpenClaw skills |
| Cron | Scheduled agent runs (daily reports, health checks) |

---

## Model Router

All LLM calls in WAI go through a single routing function:

```typescript
// backend/src/config/models.ts
getModelForAgent(agentId: string, taskType?: TaskType): ModelConfig
```

### Routing Logic

| Task Type | Model | Reason |
|-----------|-------|--------|
| `architecture`, `planning`, `dev_complex` | GPT-5.4 (Azure) | Complex reasoning |
| `dev_simple`, `marketing`, `support`, `routing` | Gemini 2.5 Flash | Speed + cost |
| `research`, `analysis` | GPT-5.4 (Azure) | Depth of synthesis |
| `content`, `copy` | Gemini 2.5 Flash | Volume throughput |

Agent-level defaults can be overridden by Neb via `/assign_model` command.

---

## Data Flows

### 1. Neb creates a task via Telegram

```
Neb → Telegram Bot → OpenClaw Gateway
→ Telegram Handler (backend/src/services/telegram.ts)
→ INSERT into supabase.tasks
→ CEO Agent session picks up new task
→ CEO delegates to appropriate team lead
→ Team lead creates subtasks
→ Worker agents execute
→ Results logged to supabase.runs + supabase.events
→ CEO summarizes → Telegram notification to Neb
```

### 2. Agent executes a development task

```
Dev Agent session (OpenClaw)
→ Calls getModelForAgent('dev_saas', 'dev_complex') → GPT-5.4
→ LLM generates code
→ Tool: shell (run tests)
→ Tool: github (create PR)
→ logRun() → INSERT into supabase.runs (tokens, cost, outcome)
→ UPDATE supabase.tasks SET status='done'
→ INSERT into supabase.events (task_completed)
→ Dashboard Realtime update (client sees instantly)
```

### 3. Finance Agent monitors costs

```
[Cron: every 1 hour]
Finance Agent
→ SELECT SUM(cost_usd) FROM supabase.runs WHERE created_at > now() - interval '1 month'
→ Compare to MONTHLY_BUDGET_USD
→ If > threshold: INSERT alert into supabase.events
→ Send Telegram notification to Neb
→ UPDATE supabase.project_state SET monthly_cost = ...
```

---

## Directory Structure

```
wai/
├── backend/src/
│   ├── agents/           # Agent session managers + team configs
│   ├── config/
│   │   ├── agents.ts     # Agent registry (id, role, model, tools)
│   │   ├── models.ts     # Model registry + routing
│   │   └── openclaw.ts   # OpenClaw Gateway config
│   ├── services/
│   │   ├── supabase.ts   # DB client + typed helpers
│   │   ├── telegram.ts   # Telegram bot handler
│   │   ├── logger.ts     # Centralized run/event logger
│   │   └── budget.ts     # Cost tracking + alert service
│   ├── tools/
│   │   ├── index.ts      # Tool registry
│   │   ├── github.ts     # GitHub operations
│   │   ├── email.ts      # SendGrid email
│   │   └── browser.ts    # HTTP/browser tool
│   └── types/index.ts    # Shared TypeScript types
├── dashboard/src/
│   ├── components/       # UI components
│   ├── hooks/            # Supabase Realtime hooks
│   ├── lib/supabase.ts   # Dashboard Supabase client
│   └── types/index.ts    # Dashboard types
└── supabase/
    ├── migrations/       # SQL migrations
    └── seed.sql          # Initial data (agents, models)
```

---

## Security Perimeter

- OpenClaw Gateway: loopback only (`127.0.0.1:18789`)
- External access: SSH tunnel or Tailscale (never direct internet exposure)
- API keys: env vars only, never in code
- Supabase RLS: enabled on all tables
- Telegram: only Neb's chat ID is whitelisted

See `docs/SECURITY.md` for full details.
