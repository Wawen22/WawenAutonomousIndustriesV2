# WAI Project Tracking

> This file is the canonical human-readable task board and changelog.
> It MUST be updated by Claude/agents after every significant change.
> It mirrors (partially) the data in Supabase `tasks` table.

---

## Current Milestone: M7 – First revenue-generating output

**Target:** 2026-Q2
**Status:** 🔄 In Progress

> Note: production deployment is intentionally deferred until the final functional development gate.
> Hetzner/VPS rollout remains a last-step infrastructure milestone, not the current focus.

---

## Roadmap

| ID | Milestone | Target | Status |
|----|-----------|--------|--------|
| M1 | Local development stack running | 2026-Q1 | ✅ Done |
| M2 | CEO Agent esegue primo task autonomo | 2026-Q1 | ✅ Done |
| M3 | WAI Dashboard live con dati real-time | 2026-Q1 | ✅ Done |
| M4 | Client & Project Management System | 2026-Q2 | ✅ Done |
| M5 | First autonomous deliverable for a real client | 2026-Q2 | ✅ Done |
| M6 | Deploy to Hetzner VPS | 2026-Q2 | ⏸ Deferred (final infrastructure step) |
| M7 | First revenue-generating output | 2026-Q3 | 🔄 In Progress |
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
| T010 | Docker compose: aggiungere backend containerizzato | ✅ Done | Claude | 3 | Compose backend allineato al Dockerfile; persistenza `workspace/` montata |
| T011 | /approve e /reject su Telegram | ✅ Done | Claude | 1 | telegram.ts — aggiorna status task Supabase, logga human_approved/rejected |
| T012 | PM SaaS Agent loop | ✅ Done | Claude | 1 | backend/src/agents/pm_saas.ts — produce user stories, crea sub-subtask, notifica Neb |
| T013 | Fix FK events.agent_id per founder | ✅ Done | Claude | 1 | rimosso agentId: 'founder' da recordEvent in telegram.ts |
| T014 | Dashboard view "Runs" (M3 completamento) | ✅ Done | Claude | 2 | RunsView.tsx — tabella filtrabile agente/modello/outcome, costo, tokens, sticky header |
| T015 | Finance Agent cron (collegare budget.ts) | ✅ Done | Claude | 2 | startBudgetMonitor(3_600_000) già in index.ts riga 80 — nessuna modifica necessaria |
| T016 | E2E test pm_saas loop verificato | ✅ Done | Neb | 1 | Verificato 2026-03-17 — 5 user stories complete via Telegram |
| T017 | DB schema: clients + projects tables | ✅ Done | Claude | 1 | Migration 002 scritta — da applicare via Supabase SQL Editor |
| T018 | Backend: CRUD clients/projects in supabase.ts | ✅ Done | Claude | 1 | createClient, createProject, getClients, getProjectsByClient, workspace.ts |
| T019 | Telegram: /new_client /new_project commands | ✅ Done | Claude | 1 | + /clients /projects — workspace folder creation |
| T020 | CEO Agent: project-aware delegation | ✅ Done | Claude | 2 | project_id ereditato nei subtask, project context nel prompt |
| T021 | Dashboard: Clients view + Projects view | ✅ Done | Claude | 2 | ClientsView + ProjectsView — 8 views totali, sidebar updated |
| T022 | Consulting Lead Agent | ✅ Done | Claude | 1 | backend/src/agents/consulting_lead.ts — legge brief.md, produce proposal.md, crea analyst sub-task |
| T023 | CEO routing → consulting_lead + analyst | ✅ Done | Claude | 1 | ceo.ts — fire-and-forget per consulting_lead e analyst; AGENT_ROSTER aggiornato |
| T024 | /task con scope progetto | ✅ Done | Claude | 1 | telegram.ts — /task client/project desc; lookup client+project; metadata iniettato |
| T025 | Analyst Agent | ✅ Done | Claude | 2 | backend/src/agents/analyst.ts — produce analysis.md; invocato da consulting_lead |
| T026 | Dashboard: deliverables viewer | ✅ Done | Claude | 2 | backend GET /api/deliverables; ProjectsView — click riga → panel deliverables con lista file |
| T027 | Dev Lead SaaS chain | ✅ Done | Claude | 1 | PM SaaS invoca dev_lead_saas; `sprint_plan.md` + subtask `dev_saas_1`/`dev_saas_2` creati |
| T028 | Telegram /brief command | ✅ Done | Claude | 1 | `/brief client/project testo` aggiorna `workspace/{client}/{project}/brief.md` |
| T029 | Project status update da agent | ✅ Done | Claude | 2 | `updateProjectStatus(id, status)` in Supabase; consulting/dev lead allineano stato progetto |
| T030 | Dashboard milestone pill → M5 | ✅ Done | Claude | 2 | Topbar aggiornata a `M5 Done` |
| T031 | Backend Dockerfile + deploy prep | ✅ Done | Claude | 3 | Dockerfile allineato, `docker-compose.yml` usa mount persistente `./workspace:/workspace`, docs deploy aggiornate |
| T032 | Dev SaaS worker runtime | ✅ Done | Claude | 1 | `dev_saas_1`/`dev_saas_2` ora eseguono i task, scrivono deliverable markdown e notificano Neb |
| T033 | Workspace progress + review automation | ✅ Done | Claude | 2 | `PROGRESS.md` aggiornato automaticamente; completamento worker porta il progetto a `review` |
| T034 | Docs: deploy come ultimo step | ✅ Done | Claude | 2 | Roadmap/docs allineate: deploy posticipato all’ultimo gate infrastrutturale |
| T035 | Docs: matrice stato operativo agenti | ✅ Done | Claude | 2 | Distinzione esplicita tra agenti configurati/online e runtime realmente implementati |
| T036 | Multi-service projects schema | ✅ Done | Claude | 1 | Migration 003: tassonomia `projects.type` ampliata + contesto repo opzionale |
| T037 | Telegram repo linkage + context propagation | ✅ Done | Claude | 1 | `/link_repo` aggiunto; task scoped propagano metadata repo agli agenti |
| T038 | Marketing delivery chain | ✅ Done | Claude | 1 | Runtime per `marketing_strategist`, `content_creator`, `social_manager` con deliverable workspace |
| T039 | Docs sync + next-phase handoff | ✅ Done | Claude | 2 | Vision/architecture/tracking riallineati allo stato multi-service e al prossimo target runtime |
| T040 | Custom software delivery chain | ⬜ Todo | Claude | 1 | Runtime `architect` → `dev_general_*` → `qa` per website/app/automation/custom software |
| T041 | QA review gate + final delivery status | ⬜ Todo | Claude | 2 | Report QA, criterio per `review`/`delivered`, notifiche Neb e deliverable QA |

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

### 2026-03-17 — Sessione 14: Documentation sync + next-phase handoff ✅

- **T039** `docs/VISION.md` — vision aggiornata per riflettere WAI come azienda multi-servizio ampia: SaaS, software custom, consulting, AI services, marketing, content, copywriting, design, automation e futuri verticali creativi
- **T039** `docs/ARCHITECTURE.md` — aggiunta una vista esplicita delle chain runtime oggi operative e del nuovo flusso `Neb → CEO → Marketing Strategist → Content Creator / Social Manager`
- **T039** `docs/PROJECT_TRACKING.md` — aggiunti i prossimi target operativi **T040** e **T041** per aprire la chain software custom con `architect`, `dev_general_*` e `qa`
- **HANDOFF** prossimo step consigliato: chiudere il gap tra progetti SaaS e progetti software client custom con un runtime `architect/dev_general/qa` prima di tornare su deploy o hardening infrastrutturale

### 2026-03-17 — Sessione 13: Marketing delivery chain operativa ✅

- **T038** `backend/src/agents/marketing_strategist.ts` — nuovo runtime `runMarketingStrategistAgent(task, notify)`: genera un piano marketing strutturato, salva `marketing-plan-*.md`, crea task figli per `content_creator` e `social_manager`, aggiorna il progetto a `active`, logga run/eventi e notifica Neb
- **T038** `backend/src/agents/content_creator.ts`, `backend/src/agents/social_manager.ts`, `backend/src/agents/marketing_utils.ts` — nuovi worker runtime per content package e social calendar; scrivono `content-package-*.md` / `social-calendar-*.md`, aggiornano `PROGRESS.md`, e portano il progetto in `review` quando i worker marketing risultano completati
- **WIRE** `backend/src/agents/ceo.ts` — il CEO ora può invocare in fire-and-forget `marketing_strategist`, `content_creator` e `social_manager`; aggiunti routing hints per task marketing/content/copywriting/design
- **UI/DOCS** `dashboard/src/App.tsx`, `dashboard/src/components/ProjectsView.tsx`, `docs/AGENTS_AND_TEAMS.md`, `docs/TASKS_AND_PROJECT_STATE.md` — milestone pill riallineata a `M7 In Progress`, nuove icone deliverable marketing, stato runtime agenti marketing aggiornato e nuova gerarchia task multi-servizio documentata
- **VERIFY** `pnpm typecheck` + `pnpm build` verdi su backend e dashboard

### 2026-03-17 — Sessione 12: Multi-service projects + repo linkage ✅

- **T036** `supabase/migrations/003_projects_delivery_context.sql` — nuova migration per allargare `projects.type` a `website`, `app`, `saas`, `consulting`, `ai`, `marketing`, `content`, `copywriting`, `design`, `automation`, `other`; aggiunti campi opzionali `repo_url`, `repo_local_path`, `repo_default_branch`, `repo_provider` con constraint/index dedicati
- **T036** `backend/src/types/index.ts`, `dashboard/src/types/index.ts`, `backend/src/services/supabase.ts`, `docs/SUPABASE_SCHEMA.md` — tipi condivisi e service layer aggiornati per supportare il nuovo contesto progetto multi-servizio e il repo linkage opzionale
- **T037** `backend/src/services/telegram.ts` — `/start` aggiornato; `/new_project` ora accetta i nuovi tipi; aggiunto `/link_repo client/project /absolute/path [branch] [repo_url]`; `/task client/project ...` propaga nel metadata anche `repo_url`, `repo_local_path`, `repo_default_branch`, `repo_provider`
- **WIRE** `backend/src/agents/dev_lead_saas.ts` e `backend/src/agents/dev_saas.ts` — se presente, il contesto repo viene iniettato nei prompt dei worker SaaS per rendere il planning e gli implementation brief più vicini al codebase reale
- **UI** `dashboard/src/components/ProjectsView.tsx` — filtri e badge aggiornati ai nuovi tipi progetto; progetti con repo collegato mostrano marker `repo`; deliverables panel con messaggio più generico e icone per sprint/worker artifacts
- **VERIFY** `pnpm typecheck` + `pnpm build` verdi su backend e dashboard

### 2026-03-17 — Sessione 11: Roadmap riallineata + stato operativo agenti chiarito ✅

- **T034** `docs/PROJECT_TRACKING.md`, `docs/TASKS_AND_PROJECT_STATE.md`, `docs/DEPLOYMENT_PLAN.md`, `docs/VISION.md` — roadmap riallineata alla decisione strategica: il deploy su Hetzner non è più la milestone corrente ma un passaggio finale di infrastruttura dopo la chiusura delle milestone funzionali/revenue
- **T035** `docs/AGENTS_AND_TEAMS.md` — aggiunta matrice di implementazione operativa: chiarisce quali agenti hanno un runtime eseguibile oggi e quali sono solo registrati/configurati. Nota esplicita che lo stato `online` nel sistema indica registrazione/boot del backend, non necessariamente autonomia completa
- **STATUS** milestone corrente aggiornata a **M7 — First revenue-generating output**; **M6** resta definita ma marcata come **deferred/final infrastructure step**

### 2026-03-17 — Sessione 10: SaaS worker runtime + review automation ✅

- **T032** `backend/src/agents/dev_saas.ts` — nuovo worker runtime `runDevSaasAgent(task, notify)` per `dev_saas_1` e `dev_saas_2`: riceve il task implementativo, genera un execution brief strutturato via modello assegnato (`dev_complex` per `dev_saas_1`, `dev_simple` per `dev_saas_2`), salva un deliverable markdown univoco in `workspace/.../deliverables/`, logga run/evento e notifica Neb
- **WIRE** `backend/src/agents/dev_lead_saas.ts` — dopo la creazione dei task di implementazione, invoca i worker SaaS in fire-and-forget; `backend/src/agents/ceo.ts` ora supporta anche l’invocazione diretta di `dev_saas_1` / `dev_saas_2`
- **T033** `backend/src/services/workspace.ts` — aggiunto `appendProjectProgress(...)` per aggiornare `PROGRESS.md` senza refactor invasivi; `backend/src/services/supabase.ts` — aggiunto `getChildTasks(parentTaskId)` per rilevare il completamento dei sibling task
- **FLOW** quando tutti i task figli `dev_saas_1` / `dev_saas_2` dello stesso task Dev Lead risultano `done`, il worker aggiorna lo stato progetto a `review` e appende una nota finale in `PROGRESS.md`
- **VERIFY** `pnpm typecheck` + `pnpm build` verdi su backend e dashboard
- **ARCH** la chain SaaS ora arriva fino a un output persistito per worker: `Neb /task → CEO → PM SaaS → Dev Lead SaaS → dev_saas_1/dev_saas_2 → deliverables + progress + review`

### 2026-03-17 — Sessione 9: M5 ufficiale completa + M6 prep avviata ✅

- **T027** `backend/src/agents/dev_lead_saas.ts` — nuovo `runDevLeadSaasAgent(task, notify)`: legge la user story dal task PM, genera piano tecnico strutturato via GPT-5.4, scrive `deliverables/sprint_plan.md` quando il progetto ha `workspace_path`, crea 2 task di implementazione per `dev_saas_1` e `dev_saas_2`, logga run/evento e notifica Neb. `backend/src/agents/pm_saas.ts` ora propaga `project_id` + metadata della story e invoca `dev_lead_saas` in fire-and-forget; `backend/src/agents/ceo.ts` supporta anche l’invocazione diretta di `dev_lead_saas`
- **T028** `backend/src/services/telegram.ts` — aggiunto `/brief client/project testo`; risolve client/progetto, crea la cartella se manca, sovrascrive `workspace/{client}/{project}/brief.md`, logga evento founder command e conferma il path a Neb. `/start` aggiornato con il nuovo comando
- **T029** `backend/src/services/supabase.ts` — aggiunto `updateProjectStatus(id, status)`; `backend/src/agents/consulting_lead.ts` promuove il progetto a `active` quando produce `proposal.md`; `backend/src/agents/dev_lead_saas.ts` riallinea il progetto a `active` durante il piano tecnico
- **T030** `dashboard/src/App.tsx` — milestone pill topbar aggiornata a `M5 Done`
- **T031** `backend/Dockerfile` — allineato a Node 22 Alpine + `pnpm install --frozen-lockfile` + runtime `node dist/index.js`; `docker-compose.yml` backend ora persiste `workspace/` via bind mount dedicato invece di sovrascrivere l’immagine buildata; `docs/DEPLOYMENT_PLAN.md` documenta il comportamento del container backend e il flusso locale vs deploy. Questo chiude anche il task storico **T010**
- **M5** ufficialmente completata: la chain target ora copre `Neb /task → CEO → PM SaaS → Dev Lead SaaS → sprint plan → dev subtask` e `Neb /task client/project → CEO → Consulting Lead → proposal.md → Analyst`

### 2026-03-17 — Sessione 8: M5 First Autonomous Deliverable (T022–T026) 🔄

- **T022** `backend/src/agents/consulting_lead.ts` — `runConsultingLeadAgent(task, notify)`: legge `brief.md` da workspace, chiama GPT-5.4, produce proposta strutturata JSON → converte in `deliverables/proposal.md`, crea sub-subtask Analyst se `requiresAnalysis: true`, logga run+evento, notifica Neb con preview
- **T023** `backend/src/agents/ceo.ts` — import `runConsultingLeadAgent` + `runAnalystAgent`; fire-and-forget per entrambi; AGENT_ROSTER aggiornato con descrizione precisa per consulting_lead e analyst
- **T024** `backend/src/services/telegram.ts` — `/task` ora accetta prefisso opzionale `client_slug/project_slug`; lookup Supabase client+project; inietta `project_id`, `project_name`, `client_name`, `client_slug`, `project_slug`, `project_type`, `workspace_path` nel metadata del task; backward-compatible
- **T025** `backend/src/agents/analyst.ts` — `runAnalystAgent(task, notify)`: produce report di ricerca strutturato → `deliverables/analysis.md`; invocato da consulting_lead o direttamente da CEO
- **T026** `backend/src/index.ts` — API `GET /api/deliverables?path=workspace/client/project` con CORS; lista file in `deliverables/` con nome/size/modified_at; `dashboard/src/components/ProjectsView.tsx` — click su riga progetto → panel deliverables con fetch API; `dashboard/.env.local` — aggiunta `VITE_BACKEND_URL`
- **DB** `backend/src/services/supabase.ts` — aggiunti `getProjectById(id)` e `getProjectBySlug(clientId, slug)`

### 2026-03-17 — Sessione 7: M4 Client & Project Management System ✅

- **T017** `supabase/migrations/002_clients_projects.sql` — tabelle `clients` + `projects` con RLS, FK `tasks.project_id` — ⚠️ **applicare manualmente via Supabase Dashboard SQL Editor**
- **T018** `backend/src/services/supabase.ts` — `createClient`, `createProject`, `getClients`, `getClientBySlug`, `getProjectsByClient`, `updateProjectWorkspacePath` — `backend/src/services/workspace.ts` — `createClientWorkspace`, `createProjectWorkspace` (brief.md + PROGRESS.md + dir structure) — tipi `Client`, `Project` in `backend/src/types/index.ts`
- **T019** `backend/src/services/telegram.ts` — `/new_client`, `/new_project`, `/clients`, `/projects` — crea record Supabase + workspace su disco + risposta Telegram
- **T020** `backend/src/agents/ceo.ts` — `project_id` propagato ai subtask dal metadata del task padre; project context iniettato nel system prompt del CEO
- **T021** `dashboard/src/components/ClientsView.tsx` + `ProjectsView.tsx` — 8 views nella dashboard; `useClients`, `useProjects` hooks; `Client`, `Project` types in dashboard; icons in Icon.tsx; Sidebar + App.tsx aggiornati — **milestone pill aggiornata a "M4 In Progress"**



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
