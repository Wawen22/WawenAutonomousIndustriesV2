# WAI Project Tracking

> This file is the canonical human-readable task board and changelog.
> It MUST be updated by Claude/agents after every significant change.
> It mirrors (partially) the data in Supabase `tasks` table.

---

## Current Milestone: M1 – Local Development Stack

**Target:** 2025-Q1
**Status:** In Progress

---

## Roadmap

| ID | Milestone | Target | Status |
|----|-----------|--------|--------|
| M1 | Local development stack running | 2025-Q1 | In Progress |
| M2 | All agents configured in OpenClaw | 2025-Q1 | Todo |
| M3 | WAI Dashboard live with real-time data | 2025-Q1 | Todo |
| M4 | First autonomous task completed by agent | 2025-Q2 | Todo |
| M5 | Deploy to Hetzner VPS | 2025-Q2 | Todo |
| M6 | First revenue-generating output | 2025-Q3 | Todo |
| M7 | Migrate to personal mini PC | 2025-Q3 | Todo |

---

## Active Tasks

| ID | Title | Status | Owner | Priority | Notes |
|----|-------|--------|-------|----------|-------|
| T001 | Initialize WAI project structure | Done | Claude | 1 | Initial repo setup |
| T002 | Create Supabase schema migrations | Todo | dev_saas_1 | 1 | See docs/SUPABASE_SCHEMA.md |
| T003 | Configure OpenClaw agent sessions | Todo | dev_lead_saas | 1 | All agents in config/agents.ts |
| T004 | Build WAI Dashboard basic views | Todo | dev_saas_1 | 2 | AgentList, TaskBoard, EventTimeline |
| T005 | Set up Telegram bot handler | Todo | dev_saas_1 | 1 | Neb commands via Telegram |
| T006 | Implement model router | Todo | architect | 1 | config/models.ts routing logic |
| T007 | Set up Finance Agent cron | Todo | ops | 2 | Hourly cost alerts |
| T008 | Write Docker Compose production config | Todo | ops | 3 | For Hetzner deploy |
| T009 | Configure Supabase RLS policies | Todo | dev_saas_1 | 2 | Security |
| T010 | End-to-end test: Neb → CEO → task → done | Todo | qa | 1 | Full flow validation |

---

## Backlog

| ID | Title | Owner | Notes |
|----|-------|-------|-------|
| B001 | Implement pgvector for agent memory | architect | Future enhancement |
| B002 | Add Ollama local model support | dev_general_1 | Phase 3 |
| B003 | Build Consulting delivery pipeline | consulting_lead | Q2 |
| B004 | Marketing automation: blog → social | content_creator | Q2 |
| B005 | Multi-SaaS product management | pm_saas | Q2 |

---

## CHANGELOG

### 2025-03-17
- **T001** Done - Initialized complete WAI project structure
  - Created README.md, CLAUDE.md, .env.example, docker-compose.yml
  - Created all docs/ files (VISION, ARCHITECTURE, AGENTS_AND_TEAMS, SUPABASE_SCHEMA, OPERATIONS_AND_MONITORING, TASKS_AND_PROJECT_STATE, DEPLOYMENT_PLAN, SECURITY, COSTS_AND_BUDGET)
  - Created backend/ TypeScript structure with agents, config, services, tools, types
  - Created dashboard/ React/TypeScript structure
  - Created Supabase migrations
  - Created infrastructure/ configs
