# WAI Project Tracking

> This file is the canonical human-readable task board and changelog.
> It MUST be updated by Claude/agents after every significant change.
> It mirrors (partially) the data in Supabase `tasks` table.

---

## Current Milestone: M4 – Client & Project Management System

**Target:** 2026-Q2
**Status:** ⬜ Todo

---

## Roadmap

| ID | Milestone | Target | Status |
|----|-----------|--------|--------|
| M1 | Local development stack running | 2026-Q1 | ✅ Done |
| M2 | CEO Agent esegue primo task autonomo | 2026-Q1 | ✅ Done |
| M3 | WAI Dashboard live con dati real-time | 2026-Q1 | ✅ Done |
| M4 | Client & Project Management System | 2026-Q2 | ⬜ Todo |
| M5 | First autonomous deliverable for a real client | 2026-Q2 | ⬜ Todo |
| M6 | Deploy to Hetzner VPS | 2026-Q2 | ⬜ Todo |
| M7 | First revenue-generating output | 2026-Q3 | ⬜ Todo |
| M8 | Migrate to personal mini PC | 2026-Q3 | ⬜ Todo |

---

## Active Tasks

| ID | Title | Status | Owner | Priority | Notes |
|----|-------|--------|-------|----------|-------|
| T001 | Initialize WAI project structure | ✅ Done | Claude | 1 | Repo completo |
| T002 | Supabase schema + seed applicati | ✅ Done | Claude | 1 | Via Management API |
| T003 | LiteLLM proxy configurato e testato | ✅ Done | Claude | 1 | GPT-5.4 + Gemini 2.5 Flash ok |
| T004 | Backend TypeScript avviato | ✅ Done | Claude | 1 | 17 agenti online, Telegram ok |
| T005 | Telegram bot @wai_v2_bot funzionante | ✅ Done | Claude | 1 | /start /status /budget /logs ok |
| T006 | Implementare CEO Agent loop | ✅ Done | Claude | 1 | backend/src/agents/ceo.ts — GPT-5.4 delega via JSON |
| T007 | WAI Dashboard: installare deps e avviare | ✅ Done | Claude | 2 | Dashboard live su localhost:3000, refactor UI completo |
| T008 | Set up Finance Agent cron in backend | ⬜ Todo | ops | 2 | Già c'è budget.ts, collegare a cron |
| T009 | Test end-to-end: /task su Telegram → CEO → Supabase | ✅ Done | Neb | 1 | Verificato 2026-03-17: task + subtask creati, CEO delega a pm_saas |
| T010 | Docker compose: aggiungere backend containerizzato | ⬜ Todo | ops | 3 | Ora gira solo in locale |
| T011 | /approve e /reject su Telegram | ✅ Done | Claude | 1 | telegram.ts — aggiorna status task Supabase, logga human_approved/rejected |
| T012 | PM SaaS Agent loop | ✅ Done | Claude | 1 | backend/src/agents/pm_saas.ts — produce user stories, crea sub-subtask, notifica Neb |
| T013 | Fix FK events.agent_id per founder | ✅ Done | Claude | 1 | rimosso agentId: 'founder' da recordEvent in telegram.ts |
| T014 | Dashboard view "Runs" (M3 completamento) | ✅ Done | Claude | 2 | RunsView.tsx — tabella filtrabile agente/modello/outcome, costo, tokens, sticky header |
| T015 | Finance Agent cron (collegare budget.ts) | ✅ Done | Claude | 2 | startBudgetMonitor(3_600_000) già in index.ts riga 80 — nessuna modifica necessaria |
| T016 | E2E test pm_saas loop verificato | ✅ Done | Neb | 1 | Verificato 2026-03-17 — 5 user stories complete via Telegram |
| T017 | DB schema: clients + projects tables | ⬜ Todo | Claude | 1 | Migration 002 — FK tasks.project_id, revenue tracking |
| T018 | Backend: CRUD clients/projects in supabase.ts | ⬜ Todo | Claude | 1 | createClient, createProject, getClientBySlug ecc. |
| T019 | Telegram: /new_client /new_project commands | ⬜ Todo | Claude | 1 | + workspace folder creation (Node fs) |
| T020 | CEO Agent: project-aware delegation | ⬜ Todo | Claude | 2 | Passa project_id alle task quando disponibile |
| T021 | Dashboard: Clients view + Projects view | ⬜ Todo | Claude | 2 | 2 nuove views con liste filtrabili + KPI per client |

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

### 2026-03-17 — Sessione 6: UI/UX Redesign + M4 Client/Project planning ✅

- **T016** E2E pm_saas verificato — 5 user stories complete su Telegram, fix troncatura titoli
- **UI** Overview redesign: Mission Banner + Active Work + Live Feed + Agent Matrix compatto
- **UI** Panel.tsx: prop `accent` con border-top colorata per identità visiva
- **UI** Stat.tsx: corner glow + bottom accent line + numero `text-2xl`
- **UI** Topbar: milestone pill + orologio live che si aggiorna ogni 30s
- **ARCH** Definita vision M4: Client & Project Management System (T017-T021)

### 2026-03-17 — Sessione 5: Dashboard view Runs + M3 completata ✅

- **T014** `dashboard/src/components/RunsView.tsx` — 6a view "Runs": tabella filtrable (agente/modello/outcome), colonne timestamp/agent/model/outcome/tokens_in/tokens_out/cost_usd/duration_ms, stats toolbar (totale cost + tokens + success rate), sticky header, scroll verticale 60vh. Wiratura in App.tsx + Sidebar.tsx + Icon.tsx
- **T015** Confermato già wired: `startBudgetMonitor(3_600_000)` in `backend/src/index.ts` riga 80 — nessuna modifica necessaria
- **M3** Completata — Dashboard a 6 views live con dati real-time

### 2026-03-17 — Sessione 4: /approve /reject + PM SaaS Agent loop ✅

- **T011** `/approve <task_id>` e `/reject <task_id> [reason]` in `telegram.ts` — aggiornano status Supabase, loggano `human_approved`/`human_rejected`, rispondono a Neb. Aggiunta `getTaskById` in `supabase.ts`
- **T012** `backend/src/agents/pm_saas.ts` — `runPmSaasAgent(task, notify)`: chiama GPT-5.4, produce 3-6 user stories strutturate in JSON (titolo, descrizione, acceptance criteria, priority, story points), crea un sub-subtask per ciascuna (assignee: dev_lead_saas), logga evento `task_completed`, notifica Neb via Telegram
- **WIRE** `ceo.ts`: dopo delega a `pm_saas`, invoca `runPmSaasAgent` in fire-and-forget con stesso pattern callback (no circular dep)
- **ARCH** Chain ora completa: Neb `/task` → CEO Agent → PM SaaS Agent → user stories in Supabase → notifica Neb

### 2026-03-17 — Sessione 3: Dashboard refactor + M3 avviata ✅

- **T007** Dashboard live su `localhost:3000` — fix RLS Supabase (policy anon read su 6 tabelle), fix `.env.local` con variabili `VITE_`
- **DESIGN** Refactor completo dashboard: design system "Neural Command Center" — sidebar collassabile, 5 views (Overview, Agents, Tasks, Activity, Costs), componenti UI riusabili (Panel, Badge, Stat, Icon), font Inter + JetBrains Mono, dot-grid background, colori semantici cyan/emerald/amber/rose
- **FIX** TypeScript: `useRealtimeTable<T extends object>`, aggiunto `"types": ["vite/client"]` in tsconfig
- **TEST** E2E verificato: `/task` Telegram → CEO Agent (GPT-5.4) → delega a `pm_saas` → subtask Supabase → notifica Telegram
- **M2** Completata — CEO Agent loop funzionante

### 2026-03-17 — Sessione 2: CEO Agent loop implementato ✅

- **T006** Creato `backend/src/agents/ceo.ts`: `runCeoAgent(task, notify)` chiama GPT-5.4 via LiteLLM, parsa JSON delegation decision, crea subtask su Supabase, notifica Neb via Telegram
- **WIRE** `telegram.ts` aggiornato: dopo `/task`, invoca CEO Agent in fire-and-forget con `sendTelegramNotification` come callback (no circular dep)
- **ARCH** Pattern: callback injection per evitare circular dependency `telegram ↔ ceo`

### 2026-03-17 — Sessione 1: Foundation completa ✅

- **T001** Inizializzato repo WAI completo: README, CLAUDE.md, docs/ (10 file), backend/ TypeScript, dashboard/ React, supabase/, infrastructure/
- **T002** Supabase project `nxrgwbwhauuusuuytipf` (wai-v2): schema applicato via Management API, seed 17 agenti + 2 modelli, Realtime abilitato su 5 tabelle
- **T003** LiteLLM Docker container up: `gpt-5.4` (Azure) + `gemini-2.5-flash` (Google) — entrambi testati e funzionanti
- **T004** Backend Node.js/TypeScript avviato in dev mode: 17 agenti marcati online su Supabase, budget monitor attivo
- **T005** Telegram bot `@wai_v2_bot` operativo: /start /status /logs /budget /assign_model funzionanti, Neb autenticato (chat_id: 854149335)
- **ARCH** Decisione: no OpenClaw per ora — architettura custom Node.js + LiteLLM + Supabase + grammy
