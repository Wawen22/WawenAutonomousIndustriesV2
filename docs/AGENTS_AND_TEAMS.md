# WAI Agents and Teams

## Agent Structure Overview

```
CEO Agent (GPT-5.4)
├── Team SaaS
│   ├── PM_SaaS (GPT-5.4)
│   ├── Dev Lead SaaS (GPT-5.4)
│   └── Dev SaaS (GPT-5.4 / Gemini 2.5 Flash)
├── Team Software Dev
│   ├── Architect (GPT-5.4)
│   ├── Dev General (GPT-5.4 / Gemini 2.5 Flash)
│   └── QA (Gemini 2.5 Flash)
├── Team Consulting
│   ├── Consulting Lead (GPT-5.4)
│   └── Analyst (GPT-5.4 / Gemini 2.5 Flash)
├── Team Marketing
│   ├── Marketing Strategist (GPT-5.4)
│   ├── Content Creator (Gemini 2.5 Flash)
│   └── Social Manager (Gemini 2.5 Flash)
└── Team Ops / Finance / HR
    ├── Ops Agent (Gemini 2.5 Flash)
    ├── Finance Agent (GPT-5.4)
    └── HR Agent (Gemini 2.5 Flash)
```

---

## Executive Layer

### CEO Agent
- **ID:** `ceo`
- **Role:** Global vision, orchestration, high-level task assignment, Neb reporting
- **Model:** GPT-5.4 (Azure Foundry)
- **Tools:** Supabase read-all, task create/update, event log, Telegram notify
- **Reports to:** Neb (Founder)
- **Manages:** All team leads
- **Trigger:** New tasks from Neb, daily review cron, agent escalations
- **Permissions:** Read all tables; write to `tasks`, `events`; cannot override model assignments

### Founder (Neb)
- **ID:** `founder`
- **Type:** Human super-user (not an LLM agent)
- **Interface:** Telegram Bot, WAI Dashboard, direct DB
- **Permissions:** Full system access
- **Commands:** `/task`, `/assign_model`, `/status`, `/logs`, `/budget`, `/approve`, `/reject`

---

## Runtime Implementation Status (2026-03-17)

Important: the backend currently marks all registered agents as `online` at startup. That means the agent exists in the registry and is reachable from the system perspective. It does **not** automatically mean the agent already has a dedicated autonomous runtime loop implemented.

| Agent / Group | Registry Status | Runtime Status | Notes |
|--------------|-----------------|----------------|-------|
| `ceo` | configured | ✅ implemented | Delegation loop active |
| `pm_saas` | configured | ✅ implemented | User story generation active |
| `dev_lead_saas` | configured | ✅ implemented | Sprint planning + worker orchestration active |
| `dev_saas_1`, `dev_saas_2` | configured | ✅ implemented | Worker runtime active; writes implementation deliverables |
| `consulting_lead` | configured | ✅ implemented | Proposal delivery active |
| `analyst` | configured | ✅ implemented | Analysis delivery active |
| `architect` | configured | ⬜ not yet implemented | Registry/model/tools only |
| `dev_general_1`, `dev_general_2` | configured | ⬜ not yet implemented | Registry/model/tools only |
| `qa` | configured | ⬜ not yet implemented | Registry/model/tools only |
| `marketing_strategist` | configured | ✅ implemented | Marketing plan + worker orchestration active |
| `content_creator` | configured | ✅ implemented | Content package delivery active |
| `social_manager` | configured | ✅ implemented | Social calendar delivery active |
| `ops` | configured | ⬜ not yet implemented | Monitoring role defined, no autonomous loop yet |
| `finance` | configured | ⚠️ partial | Budget monitor exists; dedicated finance agent runtime loop not implemented |
| `hr` | configured | ⬜ not yet implemented | Registry/model/tools only |

---

## Team SaaS

Responsible for WAI's own SaaS products: from idea to deployed product.

### PM_SaaS (Product Manager)
- **ID:** `pm_saas`
- **Role:** Roadmap, feature prioritization, user stories, acceptance criteria
- **Model:** GPT-5.4
- **Tools:** Supabase (tasks r/w), GitHub (issues), Dashboard (read)
- **Outputs:** Feature specs, prioritized backlog, milestone plans

### Dev Lead SaaS
- **ID:** `dev_lead_saas`
- **Role:** Technical planning, sprint planning, subtask creation for Dev agents
- **Model:** GPT-5.4
- **Tools:** Supabase, GitHub, Shell (read-only)
- **Outputs:** Technical specs, task breakdowns, PR reviews

### Dev SaaS
- **ID:** `dev_saas_1`, `dev_saas_2` (scalable)
- **Role:** Code implementation, tests, PRs, deploy prep
- **Model:** GPT-5.4 (complex features) | Gemini 2.5 Flash (boilerplate, docs)
- **Tools:** GitHub, Shell, Vercel CLI, Supabase, File system
- **Outputs:** Working code, passing tests, merged PRs

---

## Team Software Dev

Handles custom software projects for clients or internal tooling.

### Architect
- **ID:** `architect`
- **Role:** System design, tech stack decisions, architecture diagrams
- **Model:** GPT-5.4
- **Tools:** Supabase, GitHub, Browser (research)
- **Outputs:** Architecture docs, ADRs, component diagrams

### Dev General
- **ID:** `dev_general_1`, `dev_general_2` (scalable)
- **Role:** Implementation, refactoring, debugging
- **Model:** GPT-5.4 (complex) | Gemini 2.5 Flash (simple)
- **Tools:** GitHub, Shell, File system, Supabase

### QA Agent
- **ID:** `qa`
- **Role:** Test writing, test execution, quality checklists, bug reports
- **Model:** Gemini 2.5 Flash
- **Tools:** Shell (test runner), GitHub, Supabase

---

## Team Consulting

Delivers research, analysis, and strategic reports for clients.

### Consulting Lead
- **ID:** `consulting_lead`
- **Role:** Intake client requests, define scope, manage delivery
- **Model:** GPT-5.4
- **Tools:** Supabase, Email (SendGrid), Browser

### Analyst
- **ID:** `analyst`
- **Role:** Research, data gathering, report writing
- **Model:** GPT-5.4 (synthesis) | Gemini 2.5 Flash (data gathering)
- **Tools:** Browser, Supabase, File system

---

## Team Marketing

Drives awareness, content, and growth for WAI and its products.

### Marketing Strategist
- **ID:** `marketing_strategist`
- **Role:** Marketing strategy, campaign planning, funnel design
- **Model:** GPT-5.4
- **Tools:** Supabase, Browser, Email
- **Runtime:** Produces `marketing-plan-*.md`, creates worker tasks for `content_creator` and `social_manager`

### Content Creator
- **ID:** `content_creator`
- **Role:** Blog posts, social copy, video scripts, email newsletters
- **Model:** Gemini 2.5 Flash
- **Tools:** File system, Supabase, Browser
- **Runtime:** Produces `content-package-*.md` deliverables

### Social Manager
- **ID:** `social_manager`
- **Role:** Content scheduling, engagement monitoring, metrics reporting
- **Model:** Gemini 2.5 Flash
- **Tools:** Browser, Supabase, Email
- **Runtime:** Produces `social-calendar-*.md` delivery calendars

---

## Team Ops / Finance / HR

Keeps WAI running smoothly, solvent, and well-documented.

### Ops Agent
- **ID:** `ops`
- **Role:** System monitoring, uptime checks, incident response, auto-restart coordination
- **Model:** Gemini 2.5 Flash
- **Tools:** Supabase, Shell, Telegram notify
- **Cron:** Every 15 minutes health check

### Finance Agent
- **ID:** `finance`
- **Role:** API cost tracking, budget alerts, monthly reports
- **Model:** GPT-5.4 (for report synthesis)
- **Tools:** Supabase (runs table), Email, Telegram notify
- **Cron:** Hourly cost check; monthly report on 1st of month

### HR Agent
- **ID:** `hr`
- **Role:** Agent documentation, role definitions, process docs, onboarding new agents
- **Model:** Gemini 2.5 Flash
- **Tools:** Supabase, File system

---

## Delegation and Reporting Rules

1. **Neb → CEO**: Neb gives strategic direction; CEO breaks into team-level tasks
2. **CEO → Team Leads**: Each task is assigned to exactly one team lead
3. **Team Lead → Workers**: Lead breaks task into subtasks for worker agents
4. **Worker → Team Lead**: Worker updates task status and reports output
5. **Team Lead → CEO**: Lead reports completion or escalates blockers
6. **CEO → Neb**: CEO summarizes and notifies via Telegram

### Escalation Triggers

An agent MUST escalate to its manager when:
- A task is blocked for > 30 minutes
- An error rate exceeds 3 consecutive failures
- The task requires a decision outside defined parameters
- Budget consumption for a single task exceeds $5

### Approval Required (Neb review)

- Code deployed to production
- Client-facing emails sent
- Budget threshold exceeded
- New agent or model added to the system
- Tasks marked `requires_human_review = true`
