# WAI Architecture

## Overview

WAI is currently built on four pillars:

1. **Backend (Node.js 22)** — Agent orchestration, task routing, Telegram bot, HTTP API
2. **LiteLLM Proxy** — Single gateway to Azure GPT-5.4 and Google Gemini 2.5 Flash
3. **Supabase** — Postgres + pgvector: agents, tasks, runs, events, memory, clients, projects, payments
4. **Dashboard (React 18)** — Real-time founder interface via Supabase Realtime

The next architectural evolution adds a fifth pillar:

5. **Capability Platform** — shared registry, assignments, policy, health, and audit for skills, plugins, integrations, channels, and memory providers

This fifth pillar is what allows WAI to scale both `Company` and `Personal` mode without building two separate systems.

---

## Capability Platform

The Capability Platform is the shared control layer between WAI runtimes and the concrete tools or integrations they use.

### Core responsibilities

- register what capabilities exist
- decide which runtime, team, or agent can use them
- enforce policy before use
- expose health and config state
- record audit and usage events

### Capability types

- `skill`
- `plugin`
- `integration`
- `memory_provider`
- `channel`

### Main backend layers

#### Capability Registry

Source of truth for all known capabilities in WAI.

#### Assignment Engine

Maps capabilities to:

- `personal`
- `company`
- individual agents
- teams

#### Policy Engine

Controls:

- permissions
- execution constraints
- path and command limits
- approval requirements
- environment requirements

#### Health Layer

Tracks:

- connected
- degraded
- missing config
- auth expired
- disabled

#### Audit Layer

Records:

- enable/disable changes
- assignment changes
- last success / failure
- run or task usage

### Architectural intent

The key design rule is:

- capabilities are defined once
- governance is shared
- Company and Personal consume the same system with different policies and UX

This prevents drift between founder-side tooling and company-agent tooling.

### Current MVP implementation

The first real implementation is now live as a governance-light MVP.

Backend:

- shared capability contracts in `backend/src/types/index.ts`
- registry builder in `backend/src/services/capabilities.ts`
- persisted capability audit events in `capability_events`
- local governance override store in `workspace/system/capability-governance.json`
- HTTP read endpoints:
  - `GET /api/capabilities`
  - `GET /api/capabilities/:id`
- HTTP governance endpoint:
  - `POST /api/capabilities/:id/governance`

Dashboard:

- shared `Capabilities` view in both Company and Personal mode
- simple search/filter controls
- catalog + assignment visibility + health badges + policy/audit snapshot
- safe governance editing for:
  - policy mode
  - policy notes
  - assignment state `active` / `disabled`
- recent persisted capability activity timeline

Current seeded capability set:

- Google Workspace MCP runtime and related Gmail / Calendar / Drive integrations
- founder quick actions
- founder daily brief automation
- agent vector memory + personal workspace context
- shared filesystem and channel capabilities

This is intentionally governance-light rather than full CRUD.
Only selected fields are editable today; richer policy mutation and deeper health telemetry come later.

---

## Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      NEB (Founder)                          │
│         Telegram Bot (@wai_v2_bot)   WAI Dashboard          │
└──────────────┬──────────────────────────┬───────────────────┘
               │                          │
               ▼                          ▼
┌──────────────────────┐    ┌─────────────────────────────────┐
│  Telegram Handler    │    │       WAI Dashboard             │
│  (grammy)            │    │  React 18 / Vite / Tailwind     │
│  backend port 3001   │    │  Port 3000                      │
└──────────┬───────────┘    └───────────────┬─────────────────┘
           │                                │ Supabase Realtime
           │ Task creation / commands        │ WebSocket
           ▼                                ▼
┌──────────────────────────────────────────────────────────────┐
│                    WAI Backend (Node.js 22)                   │
│                    TypeScript + tsx — Port 3001               │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                Capability Platform                      │ │
│  │  Registry │ Assignments │ Policy │ Health │ Audit      │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌──────────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  CEO Agent +     │  │ Model Router │  │  Founder      │  │
│  │  CEO Intake (NL) │  │ models.ts    │  │  Services     │  │
│  └────────┬─────────┘  └──────┬───────┘  └───────────────┘  │
│           │                   │                              │
│  ┌────────┴───────────────────────────────────────────────┐  │
│  │                    Agent Teams                          │  │
│  │  SaaS │ Software Dev │ Consulting │ Marketing │ Ops    │  │
│  └──────────────────────────────────────────────────────┘  │
└──────────────────────────┬───────────────────────────────────┘
                           │ HTTP + streaming
                           ▼
              ┌────────────────────────┐
              │   LiteLLM Proxy        │
              │   Docker — Port 4000   │
              ├────────────────────────┤
              │  Azure GPT-5.4         │
              │  Google Gemini 2.5 F.  │
              └────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  Supabase Cloud        │
              │  nxrgwbwhauuusuuytipf  │
              │                        │
              │  agents, models        │
              │  clients, projects     │
              │  tasks, runs, events   │
              │  payments              │
              │  agent_memories        │
              │  project_state         │
              │  capability_events     │
              │                        │
              │  pgvector (256-dim)    │
              │  Realtime WebSocket    │
              └────────────────────────┘
```

---

## Runtime Surfaces

WAI should now be understood as two runtimes over one shared platform:

### Company Runtime

Used by CEO, team leads, workers, ops, finance, and other business agents.

Characteristics:

- stricter assignment rules
- stronger policy defaults
- business memory boundaries
- higher audit requirements

### Personal Runtime

Used by Neb through dashboard, Telegram, and future founder-centric channels.

Characteristics:

- faster setup flows
- more direct UX
- same capabilities underneath
- founder-oriented control surface

The same Gmail integration, filesystem adapter, or memory provider may serve both runtimes, but under different assignment and policy rules.

---

## Model Router

All LLM calls go through a single routing function:

```typescript
// backend/src/config/models.ts
getModelForAgent(agentId: string): ModelConfig
```

| Task Type | Model | Reason |
|-----------|-------|--------|
| Planning, architecture, development | GPT-5.4 (Azure) | Complex reasoning |
| Simple dev, marketing, ops, routing | Gemini 2.5 Flash | Speed + cost |
| Research, analysis, synthesis | GPT-5.4 (Azure) | Depth |
| Content, copy, social | Gemini 2.5 Flash | Volume throughput |

Model assignment can be overridden per-agent by Neb via `/assign_model`.

---

## Data Flows

### 1. Founder creates a task via Telegram

```
Neb → Telegram Bot (grammy)
→ Telegram Handler (backend/src/services/telegram.ts)
→ INSERT into supabase.tasks (status: todo, assignee: ceo)
→ runCeoAgent(task) dispatched
→ CEO delegates to appropriate team lead
→ Team lead creates subtasks
→ Worker agents execute
→ Deliverables written to workspace/{client}/{project}/
→ Results logged to supabase.runs + supabase.events
→ Telegram notification to Neb
```

### 2. Founder uses Natural Language (NL interface)

```
Neb → Telegram free text
→ runCeoNaturalLanguageHandler() (backend/src/agents/ceo_intake.ts)
→ GPT-5.4 parses intent → one or more commands
→ Commands: create_client, create_project, write_brief, update_brief,
            create_task, list_clients, list_projects, status_report,
            retry_task, approve_task, reject_task,
            invoice_project, mark_project_paid
→ Executes via shared founder services
→ Reply to Neb with outcome
```

### 3. Custom software delivery chain

```
Neb → /task client/project description
→ CEO routes to architect
→ Architect reads brief.md + repo state → writes architecture_plan.md
  → creates dev_general_1 + dev_general_2 subtasks (+ QA staged)
→ dev_general_1 (bootstrap if repo empty) → reads repo, writes files,
  commits, runs defensive checks, writes dev-general-1.md + repo-execution-1.md
→ dev_general_2 (parallel or queued on dep) → same
→ QA activated when both workers reach terminal state
  → reads repo state + deliverables → writes qa_report.md
  → sets project status: delivered / review / blocked
→ If blocked + requires_human_review: appears in Founder Ops Pending Review
→ Neb approves or rejects → project proceeds to invoicing
```

### 4. Consulting delivery chain

```
Neb → /task client/project description
→ CEO routes to consulting_lead
→ Consulting Lead reads brief → writes proposal.md
  → creates analyst subtask if analysis is needed
→ Analyst → writes analysis.md
→ Project status → delivered
→ Neb notified with /invoice prompt
```

### 5. Marketing delivery chain

```
Neb → /task client/project description
→ CEO routes to marketing_strategist
→ Marketing Strategist → writes marketing-plan.md
  → creates content_creator + social_manager subtasks
→ Content Creator → writes content-package.md
→ Social Manager → writes social-calendar.md
→ Project status → review
→ Neb notified with /invoice prompt
```

### 6. SaaS delivery chain

```
Neb → /task description
→ CEO routes to pm_saas
→ PM SaaS → writes user stories, creates dev_lead_saas subtask
→ Dev Lead SaaS → writes sprint plan, creates dev_saas_1/2 subtasks
→ Dev SaaS workers → implement, write deliverables, update PROGRESS.md
→ Project status → review
→ Neb notified with /invoice prompt
```

### 7. Revenue recording flow

```
Neb → /invoice client/project [amount]
   or NL: "Fattura client/project 2500"
   or Dashboard Founder Ops → Invoice
→ project.status → invoiced
→ projects.contract_value_usd updated
→ INSERT revenue_recorded event

Neb → /mark_paid client/project amount
   or NL: "Segna pagato client/project 400"
   or Dashboard Founder Ops → Mark Paid
→ INSERT into payments (amount_usd, project_id)
→ INSERT payment_received event
→ Dashboard Revenue view: invoiced vs paid vs outstanding
```

### 8. Founder blocked-task recovery

```
Task fails → task.status = blocked
→ ops_alert / task_blocked event stored
→ Appears in Dashboard Task Board + Founder Ops

Neb chooses:
→ /retry <task_id> [reason]
   or NL: "Sblocca la task abc12345"
   or Dashboard → Retry
→ shared founder_task_actions.ts service called
→ task.status → todo, retry_count incremented
→ INSERT task_unblocked event
→ assignee runtime re-dispatched (if dependencies clear)

→ /reject <task_id> or Dashboard → Cancel
→ task.status → cancelled
→ INSERT human_rejected event
```

### 9. Founder approval flow (Pending Review)

```
QA finds blocking issues:
→ task.status = blocked, requires_human_review = true
→ INSERT human_review_requested event
→ Task appears in Founder Ops → Pending Review

Neb → Approve
→ task.status → done, requires_human_review = false
→ INSERT human_approved event
→ Project can proceed to delivered / invoiced

Neb → Reject
→ task.status → cancelled
→ INSERT human_rejected event
→ Neb retries dev task to fix the issues
```

### 10. Status report flow

```
Neb → /status
   or NL: "Come stiamo oggi?"
→ shared status_report.ts builder
→ reads: project_state + active tasks + blocked tasks
         + monthly runs cost + revenue_recorded events
         + payments + recent error events
→ returns: current milestone, active tasks, blocked tasks,
           monthly invoiced, monthly paid, recent errors,
           problematic agents
```

### 11. Monitoring crons (automatic)

```
[Every 15 min] Ops Agent
→ checks tasks in_progress/blocked > 30 min
→ checks unresolved agent_error events > 30 min
→ INSERT ops_alert event + Telegram notification

[Every 1 hour] Finance Agent
→ checkBudget() → compares month-to-date cost vs MONTHLY_BUDGET_USD
→ weekly: aggregate runs/cost by agent and model
→ INSERT finance_report_generated event
→ Telegram alert if budget threshold exceeded

[Every 6 hours] HR Agent
→ aggregate last-7-day tasks/runs/events by team
→ INSERT hr_digest_generated event
→ weekly digest sent to Neb
```

---

## Delivery Chains — All Operational

| Chain | Path | Final project status |
|-------|------|---------------------|
| Custom Software | CEO → Architect → dev_general_1/2 → QA | `delivered` / `review` / `blocked` |
| Consulting | CEO → Consulting Lead → (Analyst) | `delivered` |
| Marketing | CEO → Marketing Strategist → Content Creator + Social Manager | `review` |
| SaaS | CEO → PM SaaS → Dev Lead SaaS → Dev SaaS 1/2 | `review` |

All four chains send an `/invoice` prompt to Neb at completion.

---

## Directory Structure

```
wai/
├── backend/src/
│   ├── agents/
│   │   ├── ceo.ts                      # CEO delegation loop
│   │   ├── ceo_intake.ts               # NL intent parser + command executor
│   │   ├── architect.ts                # Architecture plan + worker orchestration
│   │   ├── dev_general.ts              # Custom software worker runtime
│   │   ├── software_repo_runtime.ts    # Repo inspection, safe edits, defensive checks
│   │   ├── software_delivery_utils.ts  # Dependency graph helpers
│   │   ├── qa.ts                       # QA gate: repo check + report + project status
│   │   ├── pm_saas.ts                  # SaaS PM runtime
│   │   ├── dev_lead_saas.ts            # SaaS Dev Lead runtime
│   │   ├── dev_saas.ts                 # SaaS worker runtime
│   │   ├── consulting_lead.ts          # Consulting Lead runtime
│   │   ├── analyst.ts                  # Analyst runtime
│   │   ├── marketing_strategist.ts     # Marketing Strategist runtime
│   │   ├── content_creator.ts          # Content Creator runtime
│   │   ├── social_manager.ts           # Social Manager runtime
│   │   ├── ops.ts                      # Ops monitoring runtime
│   │   ├── finance.ts                  # Finance reporting runtime
│   │   └── hr.ts                       # HR digest runtime
│   ├── config/
│   │   ├── agents.ts                   # Agent registry (id, role, model)
│   │   ├── capabilities.ts             # Shared capability IDs + capability/tool mapping helpers
│   │   └── models.ts                   # Model registry + routing logic
│   ├── services/
│   │   ├── supabase.ts                 # DB client + typed query helpers
│   │   ├── capabilities.ts             # Capability registry, assignments, policy, health, audit snapshot
│   │   ├── screenshot.ts               # Browser screenshot service (Playwright)
│   │   ├── scraper.ts                  # Web scraper / deep reader (Playwright + Readability)
│   │   ├── personal-context.ts         # Founder profile + personal workspace context
│   │   ├── memory.ts                   # Agent memory store + pgvector recall
│   │   ├── telegram.ts                 # grammy bot handler + slash commands
│   │   ├── logger.ts                   # Centralized run/event logger
│   │   ├── budget.ts                   # Cost tracking + alert service
│   │   ├── llm.ts                      # LiteLLM client + streaming + memory integration
│   │   ├── status_report.ts            # Shared CEO status report builder
│   │   ├── founder_task_actions.ts     # Shared retry/approve/reject logic
│   │   ├── founder_revenue_actions.ts  # Shared invoice/mark_paid logic
│   │   └── workspace.ts                # Workspace folder management
│   └── types/index.ts                  # Shared TypeScript types
├── dashboard/src/
│   ├── components/                     # Core views incl. Overview, TaskBoard, FounderOps,
│   │   │                               #   Revenue, Clients, Projects, Memory,
│   │   │                               #   Activity, Costs, Runs, TeamOrg, VirtualOffice,
│   │   │                               #   Docs, Personal HQ, Capabilities
│   ├── components/CapabilitiesView.tsx # Capability catalog + health + assignments view
│   ├── hooks/useCapabilitiesRegistry.ts# Capability registry fetch hook
│   ├── hooks/useSupabaseRealtime.ts    # All Realtime subscription hooks
│   ├── lib/
│   │   ├── clientColors.ts             # Deterministic palette per client
│   │   └── agentColors.ts              # Deterministic palette per agent
│   └── types/index.ts                  # Dashboard TypeScript types
└── supabase/
    ├── migrations/
    │   ├── 001_initial_schema.sql      # agents, models, tasks, runs, events, project_state
    │   ├── 002_clients_projects.sql    # clients + projects + RLS
    │   ├── 003_multi_service.sql       # extended project type enum + repo fields
    │   ├── 004_project_blocked.sql     # projects.status += 'blocked'
    │   ├── 005_agent_memories.sql      # agent_memories + pgvector + match function
    │   └── 006_payments.sql            # payments table
    └── seed.sql                        # 17 agents + models initial data
```

---

## Security Perimeter

- LiteLLM: Docker internal network only, exposed on `localhost:4000`
- Backend HTTP: CORS `*` for localhost dashboard only
- API keys: env vars only, never in code (see `docs/SECURITY.md`)
- Supabase RLS: enabled on all tables
- Telegram: only `TELEGRAM_FOUNDER_CHAT_ID` is whitelisted
- File operations: limited to `workspace/` paths; no traversal allowed
