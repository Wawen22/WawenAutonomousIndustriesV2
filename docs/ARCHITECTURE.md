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

### 4. Marketing / content delivery chain

```
Neb → Telegram /task client/project ...
→ Telegram Handler enriches task metadata with client/project/workspace context
→ CEO Agent routes to marketing_strategist
→ Marketing Strategist generates plan + creates worker subtasks
→ Content Creator writes content-package-*.md
→ Social Manager writes social-calendar-*.md
→ Worker completion updates PROGRESS.md and project status → review
→ Dashboard deliverables panel shows generated assets
```

### 5. Custom software delivery chain

```
Neb → Telegram /task client/project ...
→ Telegram Handler enriches task metadata with client/project/workspace/repo context
→ CEO Agent routes to architect for website/app/automation/custom software work
→ Architect reads brief + real repo inventory/git status, writes architecture_plan.md, creates dev_general_* subtasks and stages QA
→ Independent subtasks can start in parallel; if the linked repo is effectively empty, dev_general_1 owns bootstrap/foundation and dev_general_2 stays queued behind it
→ Dev General workers inspect the linked repo, apply safe file edits, run defensive install/typecheck/build/test checks, write dev-general-*.md + repo-execution-*.md, and update PROGRESS.md
→ When both dev_general workers reach a terminal state, QA is activated; if a prerequisite worker fails, dependent queued tasks are auto-blocked so the chain still closes cleanly
→ QA re-checks git status plus applicable typecheck/build/test commands, merges repo blockers/warnings with the LLM review, writes qa_report.md, and sets project status to review / blocked / delivered
→ Dashboard deliverables panel shows architecture, worker, repo execution, and QA artifacts
```

### 5b. Defensive repo execution rules

For repo-aware software tasks, the backend does not execute arbitrary shell commands from the model.

- File edits are limited to safe targeted operations inside `repo_local_path`
- No delete/reset/deploy flow is allowed in the runtime
- Shell execution is derived from discovered project scripts only
- `install` runs only when dependencies appear missing
- `typecheck`, `build`, and `test` run only where the script actually exists
- Each LLM step in the software runtime has a hard timeout (`LLM_RUN_TIMEOUT_MS`, default 180s); timed out workers are moved to `blocked`
- Each command produces summarized logging in `runs`, `events`, and deliverable reports

### 6. Repo onboarding flow

```
Neb → Telegram /new_project client "Project Name" app
→ backend creates workspace/client/project with brief.md + PROGRESS.md + deliverables/

Neb → Telegram /link_repo client/project "/absolute/path with spaces" [branch] [repo_url]
→ Telegram parser supports quoted absolute paths
→ backend validates that the path exists and is a real git repo
→ repo metadata is normalized and saved into supabase.projects

or

Neb → Telegram /link_repo client/project https://github.com/org/repo.git [branch]
→ backend creates workspace/client/project/repo if needed
→ backend clones the remote repo defensively into the canonical workspace repo path
→ repo metadata is saved into supabase.projects

or

Neb → Telegram /init_repo client/project [repo_url] [branch]
→ backend initializes workspace/client/project/repo
→ optional origin remote is attached
→ repo metadata is saved into supabase.projects
```

Canonical operating examples live in `docs/FOUNDER_OPERATIONS_PLAYBOOK.md`.

---

## Implemented Runtime Chains

The agent registry is broader than the current runtime. The following chains are actually operational today:

- **SaaS delivery:** CEO → PM SaaS → Dev Lead SaaS → Dev SaaS workers
- **Consulting delivery:** CEO → Consulting Lead → Analyst
- **Marketing delivery:** CEO → Marketing Strategist → Content Creator / Social Manager
- **Custom software delivery:** CEO → Architect → Dev General workers → QA

When a software or SaaS project has `repo_local_path`, the worker runtime now becomes repo-aware instead of markdown-only: it reads the real codebase, can write focused file changes, executes defensive checks, persists repo execution summaries, and orchestrates workers according to real dependencies instead of blindly parallelizing all subtasks.

---

## Directory Structure

```
wai/
├── backend/src/
│   ├── agents/           # Agent session managers + team configs
│   │   └── software_repo_runtime.ts # Repo inspection, safe edits, and defensive check execution
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
