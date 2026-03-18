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
- **Reporting:** `/status` and NL `status_report` now include active/blocked tasks, monthly invoiced vs paid revenue, recent errors, and problematic agents

### Founder (Neb)
- **ID:** `founder`
- **Type:** Human super-user (not an LLM agent)
- **Interface:** Telegram Bot, WAI Dashboard, direct DB
- **Permissions:** Full system access
- **Commands:** `/start`, `/new_client`, `/new_project`, `/link_repo`, `/init_repo`, `/brief`, `/task`, `/projects`, `/clients`, `/assign_model`, `/status`, `/logs`, `/budget`, `/invoice`, `/mark_paid`, `/retry`, `/approve`, `/reject`
- **Natural language founder ops:** retry/approve/reject task, invoice project, mark payment received, list clients/projects, status report
- **Dashboard ops:** dedicated `Founder Ops` action center for blocked-task recovery, invoice queue, and outstanding payments
- **Operational Guide:** `docs/FOUNDER_OPERATIONS_PLAYBOOK.md`

---

## Runtime Implementation Status

All 17 agents are fully operational. The backend marks all agents as `online` at startup. All agents have a real runtime implementation — see the table below.

| Agent / Group | Registry Status | Runtime Status | Notes |
|--------------|-----------------|----------------|-------|
| `ceo` | configured | ✅ implemented | Delegation loop active |
| `pm_saas` | configured | ✅ implemented | User story generation active |
| `dev_lead_saas` | configured | ✅ implemented | Sprint planning + worker orchestration active |
| `dev_saas_1`, `dev_saas_2` | configured | ✅ implemented | Worker runtime active; can read/edit linked repos, run defensive checks, and writes implementation + `repo-execution-*.md` deliverables |
| `consulting_lead` | configured | ✅ implemented | Proposal delivery active |
| `analyst` | configured | ✅ implemented | Analysis delivery active |
| `architect` | configured | ✅ implemented | Architecture plan + worker orchestration active; reads real repo inventory/git status when linked |
| `dev_general_1`, `dev_general_2` | configured | ✅ implemented | Worker runtime active; can read/edit linked repos, run defensive checks, and writes custom software + `repo-execution-*.md` deliverables |
| `qa` | configured | ✅ implemented | QA gate active; re-checks linked repo state, writes `qa_report.md`, and sets final project status |
| `marketing_strategist` | configured | ✅ implemented | Marketing plan + worker orchestration active |
| `content_creator` | configured | ✅ implemented | Content package delivery active |
| `social_manager` | configured | ✅ implemented | Social calendar delivery active |
| `ops` | configured | ✅ implemented | Runtime monitora task/agent stuck >30 min, registra `ops_alert` e notifica Neb |
| `finance` | configured | ✅ implemented | Runtime esegue `checkBudget()`, genera report settimanale su `runs`, registra `finance_report_generated` |
| `hr` | configured | ✅ implemented | Runtime aggrega `tasks/runs/events`, genera digest settimanale e registra `hr_digest_generated` |

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
- **Orchestration:** Independent implementation subtasks may run in parallel; if the linked repo is empty and needs bootstrap, `dev_saas_1` owns the foundation phase and `dev_saas_2` is queued until that dependency closes

### Dev SaaS
- **ID:** `dev_saas_1`, `dev_saas_2` (scalable)
- **Role:** Code implementation, tests, PRs, deploy prep
- **Model:** GPT-5.4 (complex features) | Gemini 2.5 Flash (boilerplate, docs)
- **Tools:** GitHub, Shell, Vercel CLI, Supabase, File system
- **Outputs:** Working code, passing tests, merged PRs
- **Runtime:** If `repo_local_path` is present, workers inspect the real repo, apply safe file edits, run defensive `install`/`typecheck`/`build`/`test` checks only where scripts exist, and save both implementation deliverables and `repo-execution-*.md` summaries
- **Failure handling:** If the predecessor worker fails on a queued bootstrap chain, the dependent task is automatically marked `blocked` instead of remaining `todo`

---

## Team Software Dev

Handles custom software projects for clients or internal tooling.

### Architect
- **ID:** `architect`
- **Role:** System design, tech stack decisions, architecture diagrams
- **Model:** GPT-5.4
- **Tools:** Supabase, GitHub, Browser (research)
- **Outputs:** Architecture docs, ADRs, component diagrams
- **Runtime:** Reads `brief.md` plus linked repo inventory/git status when present, writes `deliverables/architecture_plan.md`, creates worker tasks for `dev_general_1` and `dev_general_2`, stages QA
- **Orchestration:** Independent subtasks can run in parallel, but on empty/bootstrap repos the architect queues `dev_general_2` behind `dev_general_1` with explicit dependency metadata

### Dev General
- **ID:** `dev_general_1`, `dev_general_2` (scalable)
- **Role:** Implementation, refactoring, debugging
- **Model:** GPT-5.4 (complex) | Gemini 2.5 Flash (simple)
- **Tools:** GitHub, Shell, File system, Supabase
- **Runtime:** Produces `dev-general-*.md` implementation deliverables, can edit the linked repo with safe targeted file operations, runs defensive `install`/`typecheck`/`build`/`test` checks where applicable, writes `repo-execution-*.md`, updates `PROGRESS.md`, and activates the QA gate once sibling worker tasks reach a terminal state
- **Failure handling:** If a dependency fails or times out, downstream queued worker tasks are moved to `blocked` automatically so the chain can still close via QA instead of stalling

### QA Agent
- **ID:** `qa`
- **Role:** Test writing, test execution, quality checklists, bug reports
- **Model:** Gemini 2.5 Flash
- **Tools:** Shell (test runner), GitHub, Supabase
- **Runtime:** Reviews architecture plus worker outputs, re-checks linked repo git status and applicable `typecheck`/`build`/`test` commands, distinguishes blocking issues vs warnings, writes `deliverables/qa_report.md`, and sets project status to `review`, `blocked`, or `delivered`

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
- **Runtime:** monitora task `in_progress` / `blocked` fermi oltre soglia e agenti con `agent_error` non recuperato; emette `ops_alert` e notifica Neb; può anche eseguire snapshot on-demand se delegato dal CEO

### Finance Agent
- **ID:** `finance`
- **Role:** API cost tracking, budget alerts, monthly reports
- **Model:** GPT-5.4 (for report synthesis)
- **Tools:** Supabase (runs table), Email, Telegram notify
- **Cron:** Hourly cost check; monthly report on 1st of month
- **Runtime:** esegue `checkBudget()` dal service `budget.ts`, aggiorna `project_state.monthly_cost_usd`, genera un report settimanale reale su costi/runs per agente e modello, e supporta task finance espliciti

### HR Agent
- **ID:** `hr`
- **Role:** Agent documentation, role definitions, process docs, onboarding new agents
- **Model:** Gemini 2.5 Flash
- **Tools:** Supabase, File system
- **Runtime:** aggrega attività team da `tasks`, `runs`, `events`, genera weekly digest utile per Neb e supporta task HR espliciti

---

## Delegation and Reporting Rules

1. **Neb → CEO**: Neb gives strategic direction; CEO breaks into team-level tasks
2. **CEO → Team Leads**: Each task is assigned to exactly one team lead
3. **Team Lead → Workers**: Lead breaks task into subtasks for worker agents
4. **Worker → Team Lead**: Worker updates task status and reports output
5. **Team Lead → CEO**: Lead reports completion or escalates blockers
6. **CEO → Neb**: CEO summarizes and notifies via Telegram

Rule of thumb for orchestration:
- Different teams or truly independent subtasks may run in parallel.
- Worker subtasks with explicit dependencies remain queued until prerequisites are terminal.
- If a prerequisite is `blocked`, the dependent task is auto-blocked rather than left pending forever.

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
