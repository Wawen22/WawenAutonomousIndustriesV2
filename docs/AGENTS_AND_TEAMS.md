# WAI Agents and Teams

## Agent Structure Overview

```
CEO Agent (nemotron-120b)
├── Team SaaS
│   ├── Dev Lead SaaS (nemotron-120b)      ← planning, sprints, user stories
│   └── Dev SaaS #1/#2 (nemotron-120b)    ← implementation workers
├── Team Software Dev
│   ├── Architect (minimax-m2.7)           ← orchestrates devops_engineer + dev_general
│   ├── DevOps Engineer (minimax-m2.7)     ← scaffold phase (always first)
│   ├── Dev General (minimax-m2.7)         ← all implementation (incl. AI/LLM features)
│   └── QA (minimax-m2.7)
├── Team Consulting
│   ├── Consulting Lead (nemotron-120b)
│   └── Analyst (nemotron-120b)
├── Team Marketing
│   ├── Marketing Strategist (glm-4.5-air)
│   └── Content Writer (glm-4.5-air)       ← all content: blog, social, newsletter, scripts
└── Team Ops / Finance
    ├── Ops Agent (glm-4.5-air)
    └── Finance Agent (nemotron-120b)

Specialist Agents (on-demand only):
├── Executive Summary   (glm-4.5-air)
├── Feedback Synthesizer (nemotron-120b)
├── Security Auditor    (nemotron-120b)
├── API Tester          (nemotron-120b)
├── DB Optimizer        (nemotron-120b)
├── Legal Compliance    (nemotron-120b)
└── Proposal Strategist (nemotron-120b)
```

---

## Runtime Status

| Agent | Status | Notes |
|---|---|---|
| `ceo` | ✅ active | Delegation loop + NL intake |
| `dev_lead_saas` | ✅ active | Sprint planning + worker orchestration |
| `dev_saas_1`, `dev_saas_2` | ✅ active | Worker runtime; reads/edits repos |
| `architect` | ✅ active | Architecture plan → devops_engineer + dev_general orchestration |
| `devops_engineer` | ✅ active | Scaffold phase; activates sibling dev tasks when done |
| `dev_general` | ✅ active | Agentic loop; handles all implementation incl. AI/LLM features |
| `qa` | ✅ active | QA gate; writes `qa_report.md`, sets project status |
| `consulting_lead` | ✅ active | Proposal delivery |
| `analyst` | ✅ active | Analysis delivery |
| `marketing_strategist` | ✅ active | Marketing plan → content_writer subtasks |
| `content_writer` | ✅ active | Web research + content generation (blog, social, newsletter, scripts) |
| `ops` | ✅ active | Health check every 15 min; stuck-task detection |
| `finance` | ✅ active | Hourly cost check; monthly report |
| `executive_summary` | ✅ active | On-demand: summarizes docs/reports/meeting notes |
| `feedback_synthesizer` | ✅ active | On-demand: pattern analysis + priority scores |
| `security_auditor` | ✅ active | On-demand: OWASP audit + secrets detection |
| `api_tester` | ✅ active | On-demand: endpoint testing + contract validation |
| `db_optimizer` | ✅ active | On-demand: schema review + SQL fix suggestions |
| `legal_compliance` | ✅ active | On-demand: GDPR/privacy/contract review |
| `proposal_strategist` | ✅ active | On-demand: full commercial proposals |

**Archived agents** (retired, files in `backend/src/agents/_archived/`):
`pm_saas` → `dev_lead_saas`, `ai_engineer` → `dev_general`, `automation_specialist` → `dev_general`, `content_creator` → `content_writer`, `social_manager` → `content_writer`, `hr` → retired, `behavioral_coach` → retired

---

## Executive Layer

### CEO Agent
- **ID:** `ceo`
- **Role:** Global vision, orchestration, high-level task assignment, Neb reporting
- **Model:** nemotron-120b
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
- **Commands:** `/start`, `/new_client`, `/new_project`, `/link_repo`, `/init_repo`, `/brief`, `/task`, `/projects`, `/clients`, `/assign_model`, `/status`, `/logs`, `/budget`, `/invoice`, `/mark_paid`, `/retry`, `/approve`, `/reject`
- **Operational Guide:** `docs/FOUNDER_OPERATIONS_PLAYBOOK.md`

---

## Team SaaS

Handles WAI's own SaaS products: from idea to deployed product.

### Dev Lead SaaS
- **ID:** `dev_lead_saas`
- **Role:** Technical planning, sprint planning, roadmap, feature prioritization, user stories, subtask creation for Dev agents
- **Model:** nemotron-120b
- **Tools:** Supabase, GitHub, Shell (read-only)
- **Outputs:** Technical specs, task breakdowns, PR reviews
- **Absorbs:** `pm_saas` (retired — all SaaS PM work now handled here)

### Dev SaaS
- **ID:** `dev_saas_1`, `dev_saas_2`
- **Role:** Code implementation, tests, PRs, deploy prep
- **Model:** nemotron-120b
- **Tools:** GitHub, Shell, Vercel CLI, Supabase, File system
- **Outputs:** Working code, passing tests, merged PRs

---

## Team Software Dev

Handles custom software projects for clients or internal tooling.

### Architect
- **ID:** `architect`
- **Role:** System design, tech stack decisions, worker orchestration
- **Model:** minimax-m2.7
- **Tools:** Supabase, GitHub, Browser
- **Outputs:** `deliverables/architecture_plan.md`, worker tasks
- **Runtime:** Creates 2 worker tasks: `devops_engineer` (first, no deps) + `dev_general` (depends on devops). `dev_general` handles all implementation including AI/LLM features.

### DevOps Engineer
- **ID:** `devops_engineer`
- **Role:** Scaffold and infrastructure phase — runs first before any coding begins
- **Model:** minimax-m2.7
- **Tools:** Shell, File system, GitHub
- **Runtime:** Agentic loop (up to 20 iterations). Initializes project, installs dependencies, configures CI/CD, verifies build. After success, activates sibling `dev_general` tasks.
- **Outputs:** `deliverables/devops-scaffold-{taskId}.md`

### Dev General
- **ID:** `dev_general`
- **Role:** Full application implementation, refactoring, debugging, tests, LLM/AI integrations, automation scripts, webhooks
- **Model:** minimax-m2.7
- **Tools:** GitHub, Shell, File system, Supabase
- **Runtime:** Agentic loop (up to 20 iterations). Writes `deliverables/dev-general-{taskId}.md`. Activates QA gate when done.
- **Absorbs:** `ai_engineer` and `automation_specialist` (both retired)

### QA Agent
- **ID:** `qa`
- **Role:** Test writing, test execution, quality checklists, bug reports
- **Model:** minimax-m2.7
- **Tools:** Shell (test runner), GitHub, Supabase
- **Runtime:** Reviews worker outputs, re-checks repo, writes `deliverables/qa_report.md`, sets project status to `review`, `blocked`, or `delivered`

---

## Team Consulting

### Consulting Lead
- **ID:** `consulting_lead`
- **Role:** Intake client requests, define scope, manage delivery
- **Model:** nemotron-120b
- **Tools:** Supabase, Email (SendGrid), Browser

### Analyst
- **ID:** `analyst`
- **Role:** Research, data gathering, report writing
- **Model:** nemotron-120b
- **Tools:** Browser, Supabase, File system

---

## Team Marketing

### Marketing Strategist
- **ID:** `marketing_strategist`
- **Role:** Marketing strategy, campaign planning, funnel design
- **Model:** glm-4.5-air
- **Tools:** Supabase, Browser, Email
- **Runtime:** Produces `marketing-plan-*.md`, creates worker tasks for `content_writer` (both content and social copy)

### Content Writer
- **ID:** `content_writer`
- **Role:** Autonomous content generation with web research — blog posts, social media posts, newsletters, scripts
- **Model:** glm-4.5-air
- **Tools:** Web search, file write
- **Trigger:** CEO NL command `content_generate blog|social|newsletter <topic>`, or as subtask from marketing_strategist
- **Runtime:** Researches topic (Serper), drafts with type-specific LLM prompt, saves `.md` to workspace, sends Telegram preview with inline keyboard `[✅ Approva] [❌ Rigetta]`
- **Absorbs:** `content_creator` and `social_manager` (both retired)

---

## Team Ops / Finance

### Ops Agent
- **ID:** `ops`
- **Role:** System monitoring, uptime checks, incident response
- **Model:** glm-4.5-air
- **Tools:** Supabase, Shell, Telegram notify
- **Cron:** Every 15 minutes health check
- **Runtime:** Monitors tasks stuck >30 min and unrecovered `agent_error` events; emits `ops_alert` and notifies Neb

### Finance Agent
- **ID:** `finance`
- **Role:** API cost tracking, budget alerts, monthly reports
- **Model:** nemotron-120b
- **Tools:** Supabase (runs table), Email, Telegram notify
- **Cron:** Hourly cost check; monthly report on 1st of month

---

## Specialist Agents (on-demand)

These agents are in the registry and dispatch switch, but CEO only routes to them when explicitly needed. They are not in the default routing path.

### Executive Summary Agent
- **ID:** `executive_summary`
- **Role:** Transform long documents, agent outputs, meeting notes, or reports into concise actionable summaries with TL;DR, key points, action items, and urgency rating
- **Model:** glm-4.5-air
- **Output:** Structured summary + optional `exec-summary-*.md` deliverable

### Feedback Synthesizer
- **ID:** `feedback_synthesizer`
- **Role:** Analyze feedback from clients, users, or stakeholders; identify recurring themes and patterns with priority scores; produce action items
- **Model:** nemotron-120b
- **Output:** `feedback-synthesis.md` with patterns sorted by priority

### Security Auditor
- **ID:** `security_auditor`
- **Role:** Analyze code, infrastructure, and dependencies for security vulnerabilities. OWASP Top 10, secrets detection, auth flaws, injection vectors
- **Model:** nemotron-120b
- **Output:** `security-audit.md` with severity-sorted findings and action plan

### API Tester
- **ID:** `api_tester`
- **Role:** Test API endpoints for authentication, edge cases, contract compliance, and response validation
- **Model:** nemotron-120b
- **Output:** `api-test-report.md`

### DB Optimizer
- **ID:** `db_optimizer`
- **Role:** Review database schemas and query patterns; identify missing indexes, N+1 queries, anti-patterns, and slow queries. Provides exact SQL migration fixes
- **Model:** nemotron-120b
- **Output:** `db-optimization-report.md`

### Legal Compliance Agent
- **ID:** `legal_compliance`
- **Role:** Review contracts, GDPR compliance, privacy policies, and terms of service. Analysis and recommendations only — not binding legal advice
- **Model:** nemotron-120b
- **Output:** `legal-compliance-review.md`

### Proposal Strategist
- **ID:** `proposal_strategist`
- **Role:** Build complete commercial proposals with tiered pricing, scope of work, ROI, milestones, and next steps
- **Model:** nemotron-120b
- **Output:** `proposal-strategy.md`
