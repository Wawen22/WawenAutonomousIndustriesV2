# WAI Project Tracking

> This file is the canonical human-readable task board and changelog.
> It MUST be updated by Claude/agents after every significant change.
> It mirrors (partially) the data in Supabase `tasks` table.

---

## Current Milestone: M9 – Tool Foundation + Personal Assistant Mode

**Target:** 2026-Q2
**Status:** 🔄 In Progress

> WAI è sia un'azienda autonoma (Business OS) che un assistente personale per Neb.
> La prossima fase porta agli agenti tool reali (web search, email, file export) e
> abilita CEO Intake a gestire richieste personali oltre che business.
> M8 (mini PC) e M6 (deploy) rimangono step infrastrutturali finali, non prerequisiti.

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
| M7 | First revenue-generating output | 2026-Q3 | ✅ Done — Wawen22 LandingPage $222 |
| M8 | Migrate to personal mini PC | 2026-Q3 | ⬜ Todo (infra — after M9) |
| M9 | Tool Foundation + Personal Assistant Mode | 2026-Q2 | 🔄 In Progress |
| M10 | MCP Integration (Gmail, Calendar, Search) | 2026-Q2 | ⬜ Todo |
| M11 | Multi-channel (WhatsApp/Slack) | 2026-Q3 | ⬜ Todo |

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
| T040 | Custom software delivery chain | ✅ Done | Claude | 1 | Runtime `architect` → `dev_general_*` → `qa` per website/app/automation/custom software |
| T041 | QA review gate + final delivery status | ✅ Done | Claude | 2 | Report QA, criterio per `review`/`blocked`/`delivered`, notifiche Neb e deliverable QA |
| T042 | Repo onboarding ergonomics | ✅ Done | Codex | 1 | `/link_repo` con path quotati e auto-clone; `/init_repo` aggiunto; playbook founder documentato |
| T043 | Repo-aware software execution + defensive QA | ✅ Done | Codex | 1 | Gli agenti software leggono/modificano la repo linkata, salvano `repo-execution-*.md`, eseguono check difensivi reali e il QA incorpora stato git + esito comandi |
| T044 | Intelligent worker orchestration + stuck run hardening | ✅ Done | Codex | 1 | Parallelismo mantenuto per subtasks indipendenti; bootstrap repo e dipendenze software ora sono queued/sequenziali, con timeout LLM hard, block cascade e QA/status finali senza task appese |

| T045 | Revenue flow: /invoice command + consulting chain completion | ✅ Done | Claude | 1 | Consulting chain → `delivered`; `/invoice` command; `revenue_recorded` event |
| T046 | Invoice prompt: SaaS + Marketing chain completion | ✅ Done | Claude | 1 | `dev_saas`, `content_creator`, `social_manager` ora includono `/invoice client/project` quando il progetto va in `review` |
| T047 | Natural Language CEO Interface | ✅ Done | Claude | 1 | Testo libero su Telegram → CEO analizza intento, chiede info mancanti, esegue azioni autonome |
| T048 | Revenue View nel Dashboard | ✅ Done | Claude | 2 | View "Revenue" con tabella progetti invoiced, stats totale/media, filtro per tipo, real-time |
| T049 | CEO Intake multi-action + workspace file generation | ✅ Done | Claude | 1 | CEO Intake esegue sequenze multi-step autonome; dev_general scrive file reali in workspace/output/ senza repo git; streaming LLM abilitato |
| T050 | LLM streaming + timeout fix + model fallback | ✅ Done | Claude | 1 | callLLM usa stream:true per evitare timeout proxy; fallback gpt-5.4 su errore modello primario; timeoutMs override per call |
| T051 | Auto-git-init nel Architect | ✅ Done | Claude | 1 | Architect crea repo git in workspace/{client}/{project}/repo/ quando progetto non ha repo_local_path; aggiorna Supabase; dev_general usa executeRepoImplementation() |
| T052 | Dashboard deliverables + output/ files | ✅ Done | Claude | 2 | API /api/deliverables ora include anche output/ (HTML/CSS/JS/py); dashboard mostra 2 sezioni separate: Agent Deliverables + Output Files |
| T053 | File modification support in workspace file creation | ✅ Done | Claude | 1 | executeWorkspaceFileCreation legge file esistenti in output/ e passa al LLM in modify mode; il LLM estende/modifica invece di ricreare |
| T054 | Notifiche errore più ricche su Telegram | ✅ Done | Claude | 2 | catch block in architect/dev_general/qa include task ID, agent, error reale (400 chars), retry hint con /task |
| T056 | TaskBoard improvements: client/project context + filter bar | ✅ Done | Claude | 2 | TaskCard mostra client chip + project chip da metadata; routing agent chain; expand on click; FilterBar con search/client/project/agent; Done capped a 12 task |
| T057 | Dashboard UX: per-client dynamic colors + Runs/Activity/Overview context | ✅ Done | Claude | 2 | Palette deterministica 8 colori per cliente; RunsView mostra client+project chip + filtro cliente; EventTimeline mostra client chip; Overview ActiveTaskCard mostra cliente |
| T058 | Fixed deliverable filenames + Project Files tab in dashboard | ✅ Done | Claude | 2 | Tutti gli agenti usano filename fisso (dev-general-1.md, marketing-plan.md, ecc.); backend scansiona anche repo/ per file codice; tab "Output Files" → "Project Files" mostra file da output/ e repo/ con badge origine |
| T059 | E2E test bootstrap nuovo cliente | ✅ Done | Codex | 1 | Verificato founder flow NL reale: cliente+progetto `website` → CEO → Architect → dev_general_1/2 → QA → `review`; `repo/index.html`, `qa_report.md`, API Project Files e dipendenze ok |
| T069 | Ops / Finance / HR runtime minimi ma reali | ✅ Done | Codex | 1 | `ops.ts`, `finance.ts`, `hr.ts` live nel repo; monitor/report/digest reali, eventi Supabase, notifiche Neb e wiring startup + task runtime smoke-tested |
| T070 | CEO status report arricchito | ✅ Done | Codex | 2 | `/status` e il path NL `status_report` usano un builder unico con task attivi/bloccati, fatturato mese, incassato mese, milestone corrente, errori recenti e agenti problematici |
| T072 | Revenue correctness: invoiced vs paid | ✅ Done | Codex | 1 | Migration `payments` applicata sul cloud; `/invoice` + `/mark_paid` verificati live con riga reale in `payments`, eventi coerenti e revenue split operativo |
| T075 | Founder blocked-task recovery flow | ✅ Done | Codex | 1 | `/retry` Telegram, endpoint backend per dashboard, pulsanti Retry/Cancel nel TaskBoard, evento `task_unblocked`, hint/notifiche founder aggiornati |
| T076 | Founder natural-language operational actions | ✅ Done | Codex | 1 | CEO Intake ora esegue retry/approve/reject task e invoice/mark_paid via testo libero; short task IDs supportati; playbook founder completato con tutti i comandi ed esempi |
| T077 | Founder dashboard action center | ✅ Done | Codex | 1 | Nuova view dashboard `Founder Ops`: blocked-task recovery, invoice queue, outstanding payments e recent founder decisions; nuove API backend locali per revenue actions |
| T060 | CEO update_brief action | ✅ Done | Claude | 2 | `ceo_intake.ts`: nuova action `update_brief` — legge brief.md esistente e fa append sezione datata; LLM sceglie write_brief per nuovi progetti, update_brief per follow-up |
| T061 | Scaffold tipo-aware in initWorkspaceRepo | ✅ Done | Claude | 2 | `software_repo_runtime.ts`: `writeTypeAwareStubs()` scrive nel repo iniziale — website: index.html+style.css+script.js; app/saas: package.json+src/index.ts+tsconfig.json; marketing/content: brief-template.md |
| T062 | HTML preview inline in ProjectsView | ✅ Done | Claude | 3 | `index.ts`: endpoint GET /api/file?path= per servire file testo/HTML; `ProjectsView.tsx`: pulsante Preview per .html → iframe sandboxed collassabile nel pannello Project Files |
| T063 | Unified file viewer in ProjectsView | ✅ Done | Claude | 2 | Viewer per tutti i tipi: HTML in repo/→iframe con CSS/JS via /api/repo static route; .md→rendered markdown; code→pre/code; click su qualsiasi riga per aprire |
| T064 | Team Org screen | ✅ Done | Claude | 1 | `TeamOrgView.tsx`: org chart Neb→CEO→teams; avatar generativi; status+model badge; slide-in panel con runs+tasks; `useAgentStats` hook; sidebar entry |
| T065 | Virtual Office screen | ✅ Done | Claude | 2 | `VirtualOffice3DView.tsx`: ufficio 3D con Three.js/R3F; 17 agent avatar animati; zone (Desk/Meeting/Lounge/Neb Corner); monitor glow; click info panel; idle wandering; working pulse; fog+lighting |
| T066 | Memory system (backend + UI) | ✅ Done | Codex | 1 | `agent_memories` + pgvector recall + dashboard Memory view |
| T067 | Virtual Office 2D view | ✅ Done | Claude | 2 | `VirtualOffice2DView.tsx`: mappa 2D flat con 4 zone (Desk/Meeting/HotDesk/Lounge); AgentAvatar2D con bordo team-color, badge tool arancione, pulse working; meeting zone con tavolo SVG + dashed lines; sidebar con stats/agent list/event timeline; popup agente con runs/tools/eventi; toggle 2D/3D in topbar sia in 2D che in 3D |
| T068 | Virtual Office 3D — polish v3 | ✅ Done | Claude | 2 | Rimozione CeilingLights; reset camera button (⊙ reset view) con animazione lerp verso default [2,30,28]; Neb Founder 3D avatar gold con body+head+halo+ring+sonar pulse+head bob; fix z-index AgentInfoPanel (WebGL stacking issue: Canvas zIndex:0, panel z-[50]) |
| T074 | Blocked-task recovery pass | ✅ Done | Claude | 1 | Task sintetico T076 cancellato; LandingPage dev_general_2 + QA pronti per retry dalla Founder Ops view; `FounderOpsTaskCard` ora mostra fallback chiaro per task senza blocked_reason; `approveTask` ha status guard per `done`/`cancelled` |
| T078 | Founder approval inbox | ✅ Done | Claude | 1 | Sezione `Pending Review` in Founder Ops; hook `useReviewRequestedTasks`; event `human_review_requested` emesso in `createTask` quando `requires_human_review = true`; azioni Approve/Reject inline; stat counter in header |
| T073 | Founder payment/revenue operational loop | ✅ Done | Claude | 2 | Revenue loop verificato su 4 progetti invoiced: contract_value_usd ↔ payments ↔ outstanding tutti consistenti; matematica corretta; nessun dato incoerente; evento `revenue_recorded` + `payment_received` coerenti |

---

## M9 — Tool Foundation + Personal Assistant (In Progress)

### Fase 1 — Tool Foundation

| ID | Title | Status | Owner | Priority | Notes |
|----|-------|--------|-------|----------|-------|
| T080 | Tool Registry per agente | ✅ Done | Codex | 1 | `backend/src/services/tool-executor.ts` live — validazione permessi/env, esecuzione tool e logging su `runs/events` |
| T081 | Web Search tool | ✅ Done | Codex | 1 | Provider `Serper` live con `backend/src/services/search.ts`; `web_search` eseguibile nel ToolExecutor e concesso a CEO, Analyst, Consulting Lead |
| T082 | Send Email tool | ✅ Done | Codex | 1 | Wrapper Resend live con `backend/src/services/email.ts`; integrato nel ToolExecutor e nel CEO per `send_report` |
| T083 | File Export tool | 🔄 In Progress | Codex | 2 | MVP live: export reale in `workspace/output/` / `workspace/personal/neb/output/` via ToolExecutor; deep-link Telegram/UI pending |

### Fase 2 — Skills System

| ID | Title | Status | Owner | Priority | Notes |
|----|-------|--------|-------|----------|-------|
| T084 | Skills per agente (SKILL.md pattern) | ⬜ Todo | Claude | 2 | `backend/src/skills/` — file Markdown per skill (research, write_report, send_email, web_search); iniettate nel system prompt prima di ogni LLM call |

### Fase 3 — Personal Assistant Mode

| ID | Title | Status | Owner | Priority | Notes |
|----|-------|--------|-------|----------|-------|
| T085 | CEO personal task routing | ✅ Done | Codex | 1 | `create_document`, `send_report`, `personal_research` e `weekly_digest` live nel CEO Intake con output personale automatico |

### Fase 4 — MCP Integration (M10)

| ID | Title | Status | Owner | Priority | Notes |
|----|-------|--------|-------|----------|-------|
| T086 | MCP integration layer | ⬜ Todo | Claude | 2 | `backend/src/services/mcp-bridge.ts` — bridge MCP → tool calls agenti; priorità: Gmail, Google Calendar, Filesystem, OneDrive |

### Fase 5 — Multi-channel (M11)

| ID | Title | Status | Owner | Priority | Notes |
|----|-------|--------|-------|----------|-------|
| T087 | WhatsApp via Baileys o Slack | ⬜ Todo | Claude | 3 | Canale secondario — solo dopo Fase 3 stabile |
| T088 | Dual-mode shell: Company / Personal | ✅ Done | Codex | 1 | Switch globale dashboard persistente, view state separato per mode e routing semplificato in Personal |
| T089 | Personal dashboard shell + JARVIS transition | ✅ Done | Codex | 2 | Nuove view `Assistant HQ` + `Documents`; transizione mode-shift tra Company e Personal live nel dashboard |
| T090 | Personal workspace + identity context | ✅ Done | Codex | 1 | `workspace/personal/neb/` + `profile.json` + API backend; profilo e documenti personali letti dal CEO Intake e dal dashboard |

---

## Backlog

| ID | Title | Owner | Notes |
|----|-------|-------|-------|
| B001 | Tune memory relevance, summarization, and TTL policies | architect | ✅ Done (sessione 34): dedup + min_similarity 0.25 |
| B002 | Add Ollama local model support | dev_general_1 | Phase 3 |
| B003 | Build Consulting delivery pipeline | consulting_lead | Q2 |
| B004 | Marketing automation: blog → social | content_creator | Q2 |
| B005 | Multi-SaaS product management | pm_saas | Q2 |

---

## CHANGELOG

### 2026-03-19 — Sessione 39: Serper web search live + personal routing completed

- **T081 DONE** nuovo `backend/src/services/search.ts` con provider `Serper.dev`, output normalizzato (`answerBox`, risultati organici, related queries) e timeout/error handling
- **TOOL EXECUTION** `web_search` aggiunto al `ToolExecutor`, con validazione env (`SERPER_API_KEY`), logging `runs/events` e permessi attivi per `ceo`, `analyst`, `consulting_lead`
- **T085 DONE** `backend/src/agents/ceo_intake.ts` ora supporta `personal_research` e `weekly_digest`: ricerca live, sintesi markdown e digest founder-oriented salvati automaticamente in `workspace/personal/neb/output/`
- **ENV** `.env.example` aggiornato con variabili `SERPER_*` per il provider di ricerca scelto
- **VERIFY** `SERPER_API_KEY` configurata in `.env`; smoke test reale ok sia su `searchWeb()` sia su `executeTool('web_search')` con risultati live restituiti da Serper

### 2026-03-19 — Sessione 38: Personal mode foundation — Resend + personal context + dual-mode shell

- **T082 DONE** nuovo `backend/src/services/email.ts` basato su Resend; `email` è ora un tool eseguibile nel ToolExecutor e il CEO può usarlo per `send_report`
- **T085 PROGRESS** `backend/src/agents/ceo_intake.ts` ora supporta anche `send_report`; il prompt CEO legge sia contesto business sia contesto personale del founder
- **T090 DONE** nuovo `backend/src/services/personal-context.ts`: crea/gestisce `workspace/personal/neb/profile.json`, espone documenti recenti e stato connector; nuove API `GET/POST /api/personal/context`
- **T088 DONE** dashboard con operating mode persistente (`Company` / `Personal`), stato view separato per mode e ticker nascosto in Personal
- **T089 DONE** nuove view `PersonalHQView` e `PersonalDocumentsView` con shell dedicata e transizione `mode-shift` stile JARVIS-lite
- **VERIFY** `pnpm typecheck` verde su backend e dashboard; smoke test `getPersonalContext()` ok con `workspace/personal/neb/profile.json` creato automaticamente

### 2026-03-19 — Sessione 37: M9 foundation avviata — dashboard green + ToolExecutor + File Export MVP

- **STABILITY** dashboard tornata `typecheck` green: rimossi import/tipi inutilizzati e fix ReactNode in `Overview.tsx`
- **T080 DONE** nuovo `backend/src/services/tool-executor.ts`: valida permessi agente e env vars, esegue tool concreti e logga `runs/events`
- **T083 MVP** nuovo tool `file_export` registrato e concesso agli agenti che producono documenti; export reale su `workspace/output/` e `workspace/personal/neb/output/`
- **CEO INTAKE** prima action personale live: `create_document` nel parser NL del CEO, basata su `file_export`
- **WORKSPACE** aggiunti helper per personal workspace e cartella `output/`; i nuovi project workspace includono `output/`
- **ALIGNMENT** backend description ripulita dal riferimento a OpenClaw; tool email riallineato a Resend; README aggiornato con milestone M9-M11
- **SMOKE TEST** verificato export reale di `workspace/personal/neb/output/ceo-note.md` (logging Supabase non verificato nel test shell senza `.env`)

### 2026-03-19 — Sessione 36: Nuova roadmap M9-M11 definita — Tool Foundation + Personal Assistant Mode

- **Analisi OpenClaw**: analizzato il framework `openclaw-main` (20+ file letti) — skills system, tool registry, multi-channel, context management. Decisione: non integrare come dipendenza, estrarre i pattern migliori nativamente in WAI
- **Visione PA**: WAI = Business OS (delivery chains M1-M7) + Personal Assistant (M9+); CEO Intake come entry point unico
- **Milestones aggiunti**: M9 (Tool Foundation + PA), M10 (MCP), M11 (Multi-channel)
- **Tasks aggiunti**: T080–T087 in `PROJECT_TRACKING.md`
- **Docs aggiornati**: `PROJECT_TRACKING.md`, `docs/TASKS_AND_PROJECT_STATE.md`, memory

### 2026-03-18 — Sessione 35b: Complete documentation rewrite + final TypeScript fixes ✅

- **DOCS REWRITE** completo: tutti i file in `docs/` e `README.md` riscritti — rimosso OpenClaw (non usato), stack corretto (Node.js + LiteLLM + grammy), nessuna duplicazione
- **Files aggiornati**: `README.md`, `docs/ARCHITECTURE.md`, `docs/VISION.md`, `docs/OPERATIONS_AND_MONITORING.md`, `docs/DEPLOYMENT_PLAN.md`, `docs/SECURITY.md`, `docs/COSTS_AND_BUDGET.md`, `docs/TASKS_AND_PROJECT_STATE.md`, `docs/AGENTS_AND_TEAMS.md`, `docs/FOUNDER_OPERATIONS_PLAYBOOK.md`, `CLAUDE.md`
- **BUGFIX** `dashboard/src/components/FounderOpsView.tsx`: rimossi import unused (`clsx`, `Stat`, `getClientColor`, tipi `ProjectStatus`/`SystemEventWithContext`), rimossa interfaccia `OutstandingRow` unused, rimossa funzione `runFounderRevenueAction` unused, rimosso param `state` unused da `ReviewRequestCard`
- **VERIFY** `pnpm typecheck` dashboard → zero errori

### 2026-03-18 — Sessione 35: M7 COMPLETATO — LandingPage delivered+invoiced+paid + dashboard bugfix ✅

- **P1 LandingPage APPROVED**: QA blocking issues analizzati come falsi positivi — "repo clean" = tutti i cambiamenti già committati (15 commit), scope mismatch non esiste (brief chiedeva ENTRAMBE testimonials + Perché sceglierci), deliverable completo (382 righe HTML, dark/light mode, testimonials, pricing, sezione why-us). Founder ha approvato il QA.
- **QA task** `b9b121ea`: `requires_human_review → false`, evento `human_approved` registrato
- **Progetto LandingPage** (Wawen22): `blocked → delivered → invoiced`, `contract_value_usd = $222`, evento `revenue_recorded` inserito
- **M7 validato**: LandingPage è il primo deliverable custom software portato a `invoiced` con revenue reale ($222). Revenue loop completo funzionante.
- **Task sintetici cleanup**: 2 task stuck in `todo` (NL verify session 31: `1b15df3d`, `4e24042a`) cancellati
- **BUGFIX** `dashboard/src/components/TaskBoard.tsx`: rimossi import unused (`formatDistanceToNow`, `Panel`, `Badge`, `useClients`, `useProjects`), rimossi `clients`/`projects` unused, aggiunto `<div` mancante nel `return` di `TaskCard` (bug di sintassi JSX che rompeva il typecheck)
- **BUGFIX** `dashboard/src/components/Overview.tsx`: rimossi import unused (`Stat`, `useRecentRuns`, tipo `Task`), fix `e.payload['message']` wrappato in `String()` per ReactNode
- **mark_paid** `wawen22/landingpage 222` eseguito da Neb via Telegram → riga payments $222 creata (22:01 UTC); M7 layer business completo
- **M7 STATUS**: ✅ Done — primo revenue reale: LandingPage Wawen22 $222 invoiced + paid
- **VERIFY** `pnpm typecheck` verde su backend e dashboard

### 2026-03-18 — Sessione 34b: LandingPage retry verificato end-to-end ✅

- **LandingPage** task `dev_general_2` (`0b019a0a`) ritentato con successo: completato (`done`), QA (`b9b121ea`) attivato automaticamente dal fix P1
- **QA** ha trovato blocking issues sul codice LandingPage → task QA in `blocked` + `requires_human_review = true` → appare in Pending Review (P3 verificato live)
- **Founder Ops** sezione Pending Review funzionante: founder può Approve (procedi) o Reject (cancella e rifai il dev)
- **Docs** `docs/FOUNDER_OPERATIONS_PLAYBOOK.md` aggiornato con sezione "Come funziona il sistema di decisioni" (Blocked/Retry, Pending Review/Approve/Reject, Invoice Queue)

### 2026-03-18 — Sessione 34: P1 QA retry fix + B001 memory tuning + P3 human_review wiring ✅

- **P1 BUG FIX** `backend/src/agents/dev_general.ts` — `processDevGeneralFollowUps` ora tenta `transitionTaskStatus(qaTask.id, 'blocked', 'in_progress')` se il primo tentativo `'todo'→'in_progress'` fallisce; fix critico per il retry flow: quando dev_general_2 viene ritentato e la QA era `blocked`, la QA viene ora correttamente attivata
- **B001** `backend/src/services/memory.ts` — deduplication: prima di inserire una nuova memoria, il sistema richiama `match_agent_memories` con soglia `0.65`; se esiste già una memoria attiva molto simile, la nuova viene scartata; `DEFAULT_MIN_SIMILARITY` alzato da `0.18` a `0.25`; aggiunta costante `DEDUP_SIMILARITY_THRESHOLD = 0.65`
- **P3** `backend/src/services/supabase.ts` — aggiunto helper `updateTaskRequiresHumanReview(taskId, value)`
- **P3** `backend/src/agents/qa.ts` — quando `finalRecommendation === 'blocked'`: imposta `requires_human_review = true` sul task QA, mantiene il task in stato `blocked` (invece di chiuderlo `done`), emette evento `human_review_requested` con `severity: 'warning'`; la QA task appare ora nella sezione `Pending Review` della Founder Ops view; notifica Telegram aggiornata con hint founder
- **BUGFIX** `dashboard/src/components/Overview.tsx` — rimossi import inutilizzati (`Stat`, `useRecentRuns`, tipo `Task`); fix tipo `e.payload['message']` wrappato in `String()` per compatibilità ReactNode
- **VERIFY** `pnpm typecheck` verde su backend e dashboard

### 2026-03-18 — Sessione 33: T074 + T078 + T073 ✅

- **T074** blocked-task recovery pass: task sintetico `58dc2a32` (test T076) cancellato via Supabase; 2 task reali LandingPage (dev_general_2 + QA) identificati come retryable e pronti nella Founder Ops view; `FounderOpsTaskCard` (`dashboard/src/components/FounderOpsView.tsx`) ora mostra fallback descrittivo per task senza `blocked_reason` (include assignee, retry_count e hint); `approveTask` in `backend/src/services/founder_task_actions.ts` ora ha guard su `done`/`cancelled`
- **T078** founder approval inbox: nuova sezione `Pending Review` nella Founder Ops view con `ReviewTaskCard` (Approve/Reject), stat counter `Pending Review`, hook `useReviewRequestedTasks` in `dashboard/src/hooks/useSupabaseRealtime.ts` (tasks con `requires_human_review = true` e status attivo), `human_review_requested` event emesso da `createTask` in `backend/src/services/supabase.ts` quando flag è `true`, event type aggiunto alla timeline founder e al variant map; `FounderTaskAction` type ora include `'approve'`
- **T073** revenue loop validato su Supabase: 4 progetti `invoiced` con `contract_value_usd`, `payments` e `outstanding` tutti coerenti (math: Σ payments = paid, contract − paid = outstanding); eventi `revenue_recorded` e `payment_received` presenti per ogni operazione
- **BUGFIX** `dashboard/src/components/EventTimeline.tsx` — rimosso import `formatDistanceToNow`, `Panel`, `Badge` unused; fix ReactNode type su `event.payload['message']`; `dashboard/src/components/ui/DetailSidebar.tsx` e `ui/Pagination.tsx` — rimosso `clsx` unused
- **VERIFY** `pnpm typecheck` verde su backend e dashboard

### 2026-03-18 — Sessione 32: T077 founder dashboard action center + M7 clarification ✅

- **T077** `dashboard/src/components/FounderOpsView.tsx`, `dashboard/src/App.tsx`, `dashboard/src/components/Sidebar.tsx` — nuova view dashboard **Founder Ops**: coda founder con task `blocked`, progetti da fatturare, fatture con outstanding balance e timeline decisionale recente; pensata come pannello operativo Neb-centric, non come semplice vista dati
- **API** `backend/src/index.ts`, `backend/src/services/founder_revenue_actions.ts` — nuovo endpoint locale `POST /api/founder/revenue-action` per azioni dashboard `invoice` / `mark_paid`; il servizio revenue condiviso accetta anche `source = dashboard`
- **FLOW** la dashboard ora usa gli stessi servizi founder condivisi di Telegram/NL sia per i task action sia per le revenue actions, quindi retry/cancel/invoice/payment restano coerenti ovunque
- **DOCS** `docs/FOUNDER_OPERATIONS_PLAYBOOK.md`, `docs/ARCHITECTURE.md`, `docs/AGENTS_AND_TEAMS.md`, `docs/TASKS_AND_PROJECT_STATE.md`, `docs/PROJECT_TRACKING.md` — aggiunta la Founder Ops view e chiarito che in ambiente dev M7 va letto come **revenue-ready validation** su dati test; il “revenue reale” è un layer business separato, da usare solo con clienti paganti reali
- **VERIFY** `pnpm typecheck` verde su backend e dashboard

### 2026-03-18 — Sessione 31: T076 founder NL ops + docs complete ✅

- **T076** `backend/src/agents/ceo_intake.ts` — il CEO Intake ora supporta founder actions operative via linguaggio naturale: `retry_task`, `approve_task`, `reject_task`, `invoice_project`, `mark_project_paid`; il prompt privilegia queste azioni quando Neb chiede sblocchi, approvazioni o revenue ops invece di creare task nuovi
- **BUGFIX** `backend/src/services/supabase.ts`, `backend/src/services/founder_task_actions.ts` — fixato un bug reale emerso durante la verifica live: `getTaskByReference()` non poteva usare `LIKE` su una colonna UUID; ora risolve i short task ID filtrando lato applicazione su task recenti. `founder_task_actions` accetta anche `source = natural_language`
- **DOCS/UX** `backend/src/services/telegram.ts`, `docs/FOUNDER_OPERATIONS_PLAYBOOK.md`, `docs/ARCHITECTURE.md`, `docs/AGENTS_AND_TEAMS.md`, `docs/TASKS_AND_PROJECT_STATE.md` — `/start` aggiornato con esempi NL operativi; playbook founder espanso a riferimento completo di tutti i comandi con descrizioni, esempi ed equivalenti NL; architettura e task lifecycle riallineati
- **VERIFY T076** verifica live con `runCeoNaturalLanguageHandler(...)`: `Sblocca la task <short_id>`, `Approva la task <short_id>`, `Cancella la task <short_id>`, `Fattura client/project per 1234`, `Segna pagato client/project 234` → esiti reali coerenti su Supabase (`blocked → in_progress`, `done`, `cancelled`, `project.status = invoiced`, nuova riga in `payments`)

### 2026-03-18 — Sessione 30: T075 blocked-task recovery ✅

- **T075** nuovo servizio condiviso `backend/src/services/founder_task_actions.ts`: centralizza le founder actions `retry`, `approve`, `reject`; `retry` riapre davvero un task `blocked`, incrementa `retry_count` in metadata, emette `task_unblocked` e rilancia il runtime corretto in base all’assignee
- **TELEGRAM** `backend/src/services/telegram.ts` ora espone `/retry <task_id> [reason]`; `/approve` e `/reject` passano dallo stesso servizio condiviso; help `/start` aggiornato
- **DASHBOARD** `backend/src/index.ts` espone `POST /api/founder/task-action` per uso dashboard locale; `dashboard/src/components/TaskBoard.tsx` aggiunge sui task `blocked` i pulsanti `Retry` e `Cancel`, feedback inline e hint Telegram con task ID completo
- **EVENTS/UX** aggiunto `task_unblocked` ai tipi backend e all’EventTimeline dashboard; Ops alert e retry hints agenti ora puntano a `/retry <task_id>` invece di dire di ricreare il task da zero
- **VERIFY T075** test reale con task sintetici `blocked` assegnati a `ops`: retry via service e via Telegram hanno entrambi prodotto `task_unblocked` e chiusura finale del task in `done`

### 2026-03-18 — Sessione 29: T072 live verify + T070 ✅

- **T072** migration `supabase/migrations/006_payments.sql` applicata sul Supabase cloud `wai-v2` e verificata live: sul progetto test `t059-e2e-202603181823/revenue-website-202603181823` il founder flow ha registrato `/invoice ... 1200` → `project.status = invoiced`, `contract_value_usd = 1200`, poi `/mark_paid ... 400` → riga reale in `payments`, evento `payment_received`, totale pagato `$400`, outstanding `$800`
- **VERIFY T072** eseguito con handler Telegram reale inizializzato via `grammy` e query dirette Supabase: confermati `revenue_recorded`, `payment_received`, `payments.amount_usd = 400` e coerenza dei numeri che alimentano la Revenue view
- **T070** nuovo builder condiviso `backend/src/services/status_report.ts`: `/status` e il path NL `status_report` ora riportano milestone corrente, task attivi, task bloccati, revenue mese fatturato vs incassato, errori recenti e agenti problematici
- **FIX** `project_state.current_milestone` nel DB cloud era ancora fermo a `M1 - Local Development Stack`; riallineato a `M7 - First revenue-generating output` e seed aggiornato per nuovi bootstrap
- **VERIFY** `pnpm typecheck` verde su backend e dashboard

### 2026-03-18 — Sessione 28: T059 + T069 + T072 (partial) ✅

- **T059** E2E founder flow NL reale verificato su progetto `website`: creato cliente/progetto/brief/task in un unico messaggio, chain completa `CEO → Architect → dev_general_1 → dev_general_2 → QA`, repo auto-init con 3 commit, `workspace/.../repo/index.html` reale, `qa_report.md` presente, file visibile nell’API `/api/deliverables` che alimenta il tab **Project Files**, stato finale `review` e nessun task/dipendenza appesa
- **T069** nuovi runtime reali `backend/src/agents/ops.ts`, `backend/src/agents/finance.ts`, `backend/src/agents/hr.ts`: Ops monitora task/agent stuck oltre soglia e notifica Neb; Finance esegue `checkBudget()` + report settimanale su `runs`; HR genera team digest su `tasks/runs/events`; tutti e 3 registrano run/eventi su Supabase e supportano anche task espliciti delegati dal CEO
- **WIRE** `backend/src/index.ts` ora avvia `startOpsMonitor(sendTelegramNotification)`, `startFinanceRuntime(sendTelegramNotification)` e `startHrRuntime(sendTelegramNotification)`; `backend/src/agents/ceo.ts` può invocare direttamente `ops`, `finance` e `hr`
- **VERIFY T069** smoke test reale con task creati per `ops`, `finance`, `hr`: tutti chiusi in `done`; Ops ha rilevato task storici bloccati e notificato; Finance ha prodotto report costi settimanale su run reali; HR ha prodotto digest team reale
- **T072 (partial)** aggiunti `supabase/migrations/006_payments.sql`, tipi/service `payments`, comando founder `/mark_paid client/project amount`, evento `payment_received`, hook dashboard `usePayments()` e nuova Revenue view con distinzione **fatturato / incassato / saldo**
- **LIMIT** la migration `006_payments.sql` non è stata applicata al Supabase cloud in questa sessione, quindi `/mark_paid` e la lettura live di `payments` sono pronti nel codice ma non ancora verificati end-to-end sul database remoto

### 2026-03-18 — Sessione 27: T066 — Agent memory system ✅

- **T066** `supabase/migrations/005_agent_memories.sql` — nuova tabella `agent_memories` con `embedding vector(256)`, `ttl`, indice `ivfflat`, RLS read-only per dashboard e funzione SQL `match_agent_memories(...)` per similarity recall su pgvector
- **T066** `backend/src/services/memory.ts` — nuovo service typed per store/list/recall delle memorie; embedding locale deterministico hashed → pgvector-safe senza dipendere da un embedding provider esterno; helper prompt `formatMemoriesForPrompt()`
- **T066** `backend/src/services/llm.ts` — `runAgent()` ora esegue recall automatico delle memorie rilevanti prima di ogni run e persiste una memoria sintetica dopo i run task-bound di successo; aggiunto cooldown per evitare log spam se la migration non è ancora applicata
- **T066** `backend/src/agents/software_repo_runtime.ts` — i run interni di repo-edit/file-generation impostano `captureMemory: false` per non inquinare la memoria a lungo termine con step intermedi
- **T066** `dashboard/src/hooks/useSupabaseRealtime.ts`, `dashboard/src/components/MemoryView.tsx`, `dashboard/src/App.tsx`, `dashboard/src/types/index.ts` — Memory view reale con stats, filtro agente, ricerca full-text client-side, visibilità TTL/expired e distribuzione per agente via Supabase Realtime
- **DOCS** `docs/SUPABASE_SCHEMA.md` e `docs/ARCHITECTURE.md` aggiornati per includere `agent_memories`, recall flow e service `memory.ts`
- **VERIFY** `pnpm typecheck` verde su backend e dashboard

### 2026-03-18 — Sessione 26: T068 — Virtual Office 3D polish v3 ✅

- **T068** `dashboard/src/components/VirtualOffice3DView.tsx` — rimossa `CeilingLights()` (7 pannelli soffitto che coprivano la scena); aggiunto `cameraResetRef: MutableRefObject<boolean>` passato da root → `OfficeScene` → `CameraController`; `CameraController.useFrame` ora anima lerp verso default `[2,30,28]` / target `[-4,0,0]` quando `cameraResetRef.current = true`; bottone `⊙ reset view` nella status bar in alto; `NebCorner3D` ampliato con avatar 3D completo (body cilindro + head sfera + halo + ring + sonar pulse espandente + head bob in useFrame) in posizione `[0,0,1.9]` davanti alla scrivania, color scheme gold #FBBF24; HTML label 👑 NEB · FOUNDER spostata sopra l'avatar; fix WebGL stacking: Canvas con `style={{ zIndex:0 }}`, `AgentInfoPanel` da `z-20` → `z-[50]`

### 2026-03-18 — Sessione 25: T067 — Virtual Office 2D view ✅

- **T067** `dashboard/src/components/VirtualOffice2DView.tsx` — nuova vista 2D piatta dell'ufficio: 4 zone in CSS grid 2×2 (Desk Zone, Meeting Zone, Hot Desk Zone, Lounge Zone); `AgentAvatar2D` con bordo colorato per team, badge arancione tool attivo da `events.payload.tool_name`, pulse ring animata su working, status dot; `DeskSlot` con monitor SVG (glow se working); `MeetingZone` con tavolo rotondo SVG + dashed lines tra agenti; `LoungeZone` con divani+piante decorativi e banner OPENCLAW; `HotDeskZone` per agenti senza desk fisso; `AgentPopup` con stats (runs/cost/tools), task attivi, eventi recenti; `RightSidebar` con stats row (Active/Tokens/Collab%), tab Overview/Activity, agent list con badge Idle/Busy/Offline, event timeline; topbar con toggle 2D/3D, active count, Connected; usa solo hook esistenti (`useAgents`, `useAgentStats`, `useTasks`, `useEventsWithContext`); no dipendenze esterne (solo React + SVG inline)
- **T067** `dashboard/src/components/VirtualOffice3DView.tsx` — aggiunto `mode: '2d' | '3d'` state; early return su `mode === '2d'` che renderizza `<VirtualOffice2DView onToggle3D={...} />`; toggle 2D/3D aggiunto nella status bar in alto a sinistra (2D dimmed, 3D highlighted quando in 3D mode)
- **VERIFY** `pnpm tsc --noEmit` da eseguire su dashboard

### 2026-03-18 — Sessione 24k: T065v2 — Virtual Office 3D (Three.js) ✅

- **T065v2** `dashboard/src/components/VirtualOffice3DView.tsx` — ufficio 3D completamente nuovo: Three.js + React Three Fiber v9 + @react-three/drei; layout office 4 zone (Desk Zone, Meeting Zone, Lounge Zone, Neb CEO Corner); 17 agent avatar (sfera+cilindro con glow emissive team-color + halo trasparente + ring base); movimento completamente in `useRef`/`useFrame` senza re-render React; idle wandering con timer random (6-12s) attorno a waypoint base; agent `busy`→desk (monitor acceso + pointLight pulsante); agent `online`→lounge o meeting (1/3 in meeting, 2/3 in lounge, deterministico per agent.id hash); bobiing sinusoidale differenziato (veloce=working, lento=idle); rotazione smooth verso direzione di movimento; nome tag HTML distanziale + badge WORKING; fog volumetrica + grid cyberpunk drei + zone tint planes + separatori neon; click su avatar → info panel DOM con role/stats/tasks/runs/events; OrbitControls con damping; status bar overlay; `@types/three` installato come devDep

### 2026-03-18 — Sessione 24k: T065 — Virtual Office + rimozione Agents view ✅

- **T065** `dashboard/src/components/VirtualOfficeView.tsx` — nuovo componente: Neb CEO Corner (carta speciale ambra in cima); grid di scrivania per ogni agente organizzata per team con header; componente `Monitor` (frame + screen + stand) con 3 stati: `working` (typing dots animati + glow), `recent` (run < 60s fa), `idle` (schermo spento); `AgentDesk` clicabile per ogni agente; `DeskModal` slide-in con portal su `document.body` (task attivi, ultimi 3 runs, ultimi 6 eventi per agente); easter egg "Office is quiet... 🌙" se tutti idle; `nowMs` state aggiornato ogni 10s per typing detection senza dati nuovi
- **T065** `dashboard/src/components/Sidebar.tsx` — rimossa voce `agents` da ViewId + NAV_ITEMS; Team e Office spostate sopra Tasks; ordine sidebar: Overview → Team → Office → Tasks → Clients → Projects → Revenue → Memory → Activity → Costs → Runs
- **T065** `dashboard/src/App.tsx` — rimosso import AgentList; rimosso `agents` da VIEW_META e switch; aggiunto import VirtualOfficeView; case `office` punta a VirtualOfficeView

### 2026-03-18 — Sessione 24k: T064 — Team Org View ✅

- **T064** `dashboard/src/components/TeamOrgView.tsx` — nuovo componente org chart: Neb (Founder) in cima → CEO → 5 team in colonne; avatar generativi (iniziali + colore da model); status dot (online/busy/offline/error); model badge (GPT-5.4/Gemini); run count da `useAgentStats`; click su qualsiasi nodo → slide-in panel (ruolo, stats, task attivi, ultimi 3 runs); linee di connessione gerarchiche; colori per team (emerald=software, violet=saas, amber=marketing, cyan=consulting, cyan=executive)
- **T064** `dashboard/src/hooks/useSupabaseRealtime.ts` — aggiunto `useAgentStats()`: fetch top-500 runs → conta per agent_id + raccoglie ultimi 3 run per agent; subscription realtime su `runs`
- **T064** `dashboard/src/components/ui/Icon.tsx` — aggiunti icon `team`, `office`, `memory`
- **T064** `dashboard/src/components/Sidebar.tsx` — ViewId esteso con `team | office | memory`; NAV_ITEMS aggiornati
- **T064** `dashboard/src/App.tsx` — import TeamOrgView; VIEW_META per team/office/memory; case switch

### 2026-03-18 — Sessione 24j: T063b — File viewer modale ✅

- **T063b** `dashboard/src/components/ProjectsView.tsx` — viewer convertito da espansione inline a **modale portal** (`createPortal` → `document.body`): backdrop blur con click-to-close, ESC-to-close, `overflow: hidden` su body mentre aperto; header modale con nome file / badge repo / size+date / link "open ↗" per HTML / pulsante ✕; `FileViewer` accetta prop `modal` — in modal mode iframe occupa `100%` altezza, TextViewer usa `flex-1 h-full`; `FileTable` diventa riga-cliccabile pura (no espansione inline), apre `FileModal`; rimosso `▾/▸` toggle — sostituito con `▸` statico che si illumina su hover

### 2026-03-18 — Sessione 24i: T063 — Unified file viewer in ProjectsView ✅

- **T063** `backend/src/index.ts` — nuova route `GET /api/repo/<workspace/client/project/repo/...>`: static serving dell'intera cartella `repo/` con risoluzione corretta dei path relativi (CSS/JS si caricano); mime map completa (.html/.css/.js/.ts/.json/.svg/.png/.jpg/.ico/.woff/.woff2/.txt/.md); path sanitization (reject traversal, richiede segmento `repo/`); immagini e font serviti come buffer binario
- **T063** `dashboard/src/components/ProjectsView.tsx` — rimossa colonna "Preview" separata; ogni riga della FileTable ora è cliccabile con ▸/▾ toggle; componente `FileViewer` unificato per tutti i tipi: HTML in `repo/` → `<iframe sandbox>` puntato a `/api/repo/` (CSS/JS caricati correttamente); tutti gli altri file → fetch testuale via `/api/file`; componente `TextViewer` con variante: `.md` → `dangerouslySetInnerHTML` con `renderMarkdown()` (headings, bold, italic, code, lists, blockquote, hr); altri estensioni → `<pre>` mono con scroll; accent color per estensione (.md=violet, .html=amber, .css=sky, .js=yellow, .ts=blue, .json=emerald); link "open ↗" per HTML preview
- **T063** `dashboard/src/index.css` — aggiunte classi `.prose-wai` per markdown rendering (h1/h2/h3/h4/p/strong/em/code/pre/li/blockquote/hr)
- **typecheck** verde su backend e dashboard

### 2026-03-18 — Sessione 24h: T060+T061+T062 — CEO update_brief + Scaffold tipo-aware + HTML preview ✅

- **T060** `backend/src/agents/ceo_intake.ts` — nuova action `update_brief` (params: client_slug, project_slug, update_text): legge `brief.md` esistente (o crea base se assente), appende sezione `---` datata con il testo Neb; il LLM ora distingue `write_brief` (nuovo progetto) da `update_brief` (follow-up su progetto esistente con brief già scritto); aggiunto `readFile`+`existsSync` da `fs/promises`+`fs`
- **T061** `backend/src/agents/software_repo_runtime.ts` — aggiunta `writeTypeAwareStubs()` chiamata da `initWorkspaceRepo()` prima del commit iniziale: type=website → `index.html` (HTML5 base con viewport+meta+link a style.css e script.js) + `style.css` (reset CSS + custom properties) + `script.js` (DOMContentLoaded vuoto); type=app/saas → `package.json` + `src/index.ts` + `tsconfig.json` (strict mode); type=marketing/content → `brief-template.md` con sezioni standard; tutti gli stub inclusi nel commit `chore: initial project scaffold`
- **T062** `backend/src/index.ts` — nuovo endpoint `GET /api/file?path=workspace/...`: sanitizza path (strip traversal, estensioni whitelist), serve file testo/HTML con Content-Type corretto; `dashboard/src/components/ProjectsView.tsx` — `FileTable` ora accetta `workspacePath`; `HtmlPreviewFrame` component con `<iframe sandbox="allow-scripts">`; pulsante Preview per ogni `.html` → toggle iframe collassabile (altezza 420px); colonna Preview aggiunta alla tabella
- **typecheck** `pnpm tsc --noEmit` verde su backend e dashboard

### 2026-03-18 — Sessione 24g: T058 — Fixed deliverable filenames + Project Files tab ✅

- **FIXED filenames** in tutti gli agenti che usavano filename dinamici con task-id suffix; ora ogni agente sovrascrive un file fisso:
  - `dev_general.ts`: `dev-general-1.md` / `dev-general-2.md` e `repo-execution-dev-general-1.md` / `repo-execution-dev-general-2.md`
  - `dev_saas.ts`: `dev-saas-1.md` / `dev-saas-2.md`
  - `marketing_strategist.ts`: `marketing-plan.md`
  - `content_creator.ts`: `content-package.md`
  - `social_manager.ts`: `social-calendar.md`
  - Già fissi (invariati): `architecture_plan.md`, `qa_report.md`, `proposal.md`, `analysis.md`, `sprint_plan.md`
- **Backend `index.ts`**: `/api/deliverables` ora scansiona anche `repo/` (ricorsiva, depth ≤3, skip .git/node_modules/dist/build/out); file codice (`.html`, `.css`, `.js`, `.ts`, `.jsx`, `.tsx`, `.py`, `.json`, `.yaml`, `.yml`, `.sh`) inclusi con `dir: 'repo'`; file `.md` esclusi da repo/ (già in deliverables/)
- **Dashboard `ProjectsView.tsx`**: tab "Output Files" → "**Project Files**"; unisce file da `output/` (progetti senza repo) e `repo/` (progetti con git repo); badge `repo` (blu) su ogni file per mostrare l'origine; interfaccia `DeliverableFile.dir` estesa con `'repo'`
- **VERIFY** `pnpm tsc --noEmit` verde su backend e dashboard

### 2026-03-18 — Sessione 24f: Fix pipeline modifica file esistenti (3 root cause) ✅

- **ROOT CAUSE 1** `getTrackedFiles()` usava solo `git ls-files` (file committati); file scritti da dev_general ma mai committati risultavano "untracked" → `isBootstrapRepo = true` → LLM riceveva "usa `create_file`" → safeguard rifiutava perché il file esisteva su disco → deadlock
  **FIX**: `getTrackedFiles()` ora esegue in parallelo `git ls-files` + `git ls-files --others --exclude-standard`; l'unione include tutti i file reali (tracciati + untracked non-ignored)
- **ROOT CAUSE 2** Nessun `git commit` dopo il primo dev_general run; ogni run successivo vedeva lo stesso stato untracked
  **FIX**: `executeRepoImplementation()` ora esegue `git add -A && git commit` automaticamente dopo ogni `applyRepoEdits` con almeno un file toccato; commit message: `feat(wai-agent): {summary}`; non-fatal se il commit fallisce
- **ROOT CAUSE 3** `repoFilesSection()` aveva una slice a 12,000 chars per file: footer di HTML lungo veniva troncato → LLM non vedeva il testo "2024" → impossibile fare `replace_in_file` corretto
  **FIX**: rimossa la slice `content.slice(0, 12000)`; il contenuto viene inviato completo (già cappato a 120KB da `MAX_REPO_FILE_BYTES` durante il caricamento)
- **VERIFY** `pnpm tsc --noEmit` verde su backend

### 2026-03-18 — Sessione 24e: T057 — Dashboard UX per-client colors + context propagation ✅

- **NEW** `dashboard/src/lib/clientColors.ts` — utility `getClientColor(clientName)`: palette di 8 colori (violet/sky/emerald/amber/rose/orange/pink/teal) con hash deterministico; stesso cliente → stesso colore sempre, cyan escluso (riservato ai chip progetto)
- **T057** `dashboard/src/components/TaskBoard.tsx` — chip cliente usa `getClientColor()` invece di violet fisso; colore dinamico e coerente su tutte le card
- **T057** `dashboard/src/hooks/useSupabaseRealtime.ts` — aggiunto `useRecentRunsWithContext(limit)`: join `runs ⟶ tasks(metadata, project_id)` via Supabase; aggiunto `useEventsWithContext(limit)`: join `events ⟶ tasks(metadata, project_id)`
- **T057** `dashboard/src/types/index.ts` — aggiunto `AgentRunWithContext` e `SystemEventWithContext` con campo `task?: { metadata, project_id } | null`
- **T057** `dashboard/src/components/RunsView.tsx` — usa `useRecentRunsWithContext`; `RunRow` mostra chip cliente colorato + nome progetto sotto l'agent ID; `FilterBar` include nuovo dropdown "All clients"; intestazione colonna rinominata "Agent / Client"
- **T057** `dashboard/src/components/EventTimeline.tsx` — usa `useEventsWithContext`; `EventRow` mostra chip cliente colorato (con "Cliente · Progetto" se entrambi disponibili) accanto all'agent ID e al task ID breve
- **T057** `dashboard/src/components/Overview.tsx` — `ActiveTaskCard` mostra chip cliente + nome progetto sopra il titolo task (dati da `task.metadata`, nessun hook aggiuntivo)
- **VERIFY** `pnpm tsc --noEmit` verde su dashboard

### 2026-03-18 — Sessione 24d: T056 — TaskBoard improvements ✅

- **T056** `dashboard/src/components/TaskBoard.tsx` — riscritta completamente: `TaskCard` ora mostra chip cliente (viola, da `task.metadata.client_name`) + chip progetto con tipo (cyan, da `task.metadata.project_name`); badge "sub" per task figlio (`parent_task_id`); preview descrizione quando non c'è contesto cliente; errore blocked da metadata; click-to-expand con descrizione completa, ID short (8 char), ID parent, hint comandi Telegram (`/approve`/`/reject`); footer con routing chain `delegator → assignee` e badge priorità + timestamp
- **T056** `dashboard/src/components/TaskBoard.tsx` — aggiunto `FilterBar` con: search testo (titolo/cliente/progetto), dropdown client, dropdown project (filtrato per client selezionato), dropdown agent, pulsante clear; contatore "N active (filtered from M)" nella status bar; `useClients()` + `useProjects()` integrati per i dropdown
- **T056** `dashboard/src/components/TaskBoard.tsx` — colonna "Done" cappata a 12 task (`DONE_LIMIT`) con indicatore "+N older tasks hidden"
- **VERIFY** `pnpm tsc --noEmit` verde su dashboard

### 2026-03-18 — Sessione 24c: Fix pipeline landing page (4 root cause) ✅

- **FIX-A** `backend/src/agents/software_delivery_utils.ts` — `repoNeedsBootstrap()` riscritta: ora esclude i file scaffold WAI (`README.md`, `.gitignore`) dal check "file significativi"; rileva bootstrap necessario se il repo non ha `package.json`, `requirements.txt`, `index.html`, `src/`, `app/`, ecc.; aggiornate costanti `BOOTSTRAP_INDICATOR_FILES` e `BOOTSTRAP_INDICATOR_DIRS`
- **FIX-B** `backend/src/agents/architect.ts` — quando il repo è stato appena auto-inizializzato (`!repoLocalPath && effectiveRepoLocalPath`), `bootstrapRepo` è forzato a `true` indipendentemente dal risultato di `repoNeedsBootstrap`; questo garantisce che `dev_general_2` attenda sempre `dev_general_1` su repo nuove
- **FIX-C** `backend/src/agents/software_repo_runtime.ts` — `executeRepoImplementation` rileva automaticamente `isBootstrapRepo` (≤3 file tracciati, nessun package.json/src/); in BOOTSTRAP MODE il system prompt include istruzioni esplicite: usare `create_file` per TUTTI i file di progetto, non tentare `replace_in_file` su README/gitignore; il `userMessage` ora include "Bootstrap mode: YES/NO" nella sezione repo inspection
- **FIX-D** `backend/src/agents/ceo_intake.ts` — aggiunta regola 8 al system prompt: "CRITICAL — ONE TASK PER PROJECT": il CEO Intake non deve creare più di un `create_task` per progetto in un singolo piano; previene 2+ Architect paralleli che collidono sulla stessa repo
- **ROOT CAUSE** del test fallito: CEO aveva creato 3 task → 2 Architect paralleli → collisione su `architecture_plan.md`; `repoNeedsBootstrap` restituiva `false` (README+.gitignore presenti) → dev_general_1 e dev_general_2 partivano in parallelo → blockers a cascata
- **VERIFY** `pnpm tsc --noEmit` verde su backend

### 2026-03-18 — Sessione 24b: Projects UI/UX fix ✅

- **FIX** `dashboard/src/components/ProjectsView.tsx` — il pannello dettaglio progetto è ora inline nella `<tbody>` usando `<Fragment>` + `<tr colSpan={7}>`: appare esattamente sotto la riga cliccata invece che in fondo a tutta la lista
- **FIX** `dashboard/src/components/ProjectsView.tsx` — `DeliverablesPanel` completamente ridisegnato con tab navigation elegante: "Agent Deliverables" (viola) / "Output Files" (verde) / "Project Info" (cyan); tab attivo con indicatore `border-b-2`; badge contatore per ogni tab; auto-switch al tab con contenuto al caricamento; path workspace come chip in alto a destra
- **VERIFY** `pnpm tsc --noEmit` verde su backend e dashboard

### 2026-03-18 — Sessione 24: T051-T054 — Auto-git-init + Dashboard output + File modify + Rich errors ✅

- **T051** `backend/src/agents/software_repo_runtime.ts` — aggiunta `initWorkspaceRepo()`: crea `workspace/{client}/{project}/repo/` con `git init -b main`, scrive `.gitignore` ottimizzato per tipo progetto (website/app/saas/automation/ai), scrive `README.md`, esegue primo commit; `GITIGNORE_BY_TYPE` map per type-aware scaffold
- **T051** `backend/src/agents/architect.ts` — se `repoLocalPath` è null e il workspace esiste, l'Architect chiama `initWorkspaceRepo()` prima di generare il piano; aggiorna `projects.repo_local_path` su Supabase via `updateProjectRepo`; propaga `effectiveRepoLocalPath` nel `baseMetadata` di tutti i task dev_general; i worker usano ora `executeRepoImplementation()` invece di `executeWorkspaceFileCreation()`; notifica Telegram mostra il path del repo auto-inizializzato
- **T052** `backend/src/index.ts` — `/api/deliverables` esteso: scansiona sia `deliverables/` che `output/`; ogni file ha campo `dir: 'deliverable' | 'output'`; supporto esteso a `.html`, `.css`, `.js`, `.ts`, `.py`, `.json`, `.yaml` oltre ai `.md`/`.pdf`/`.txt`
- **T052** `dashboard/src/components/ProjectsView.tsx` — `DeliverableFile` interface aggiornata con campo `dir`; `fileIcon` estesa per HTML/CSS/JS/py/JSON; `DeliverablesPanel` mostra due sezioni separate: "Agent Deliverables" (viola) e "Output Files — workspace/output/" (verde); `FileTable` come componente interno riusabile
- **T053** `backend/src/agents/software_repo_runtime.ts` — aggiunta `loadExistingOutputFiles()`: carica tutti i file leggibili da `output/` entro limiti di dimensione; `executeWorkspaceFileCreation` rileva automaticamente se `output/` ha già file (`isModifyMode`); in modify mode usa system prompt "modifica/estendi" + inietta contenuto dei file esistenti nel user message; `MAX_FILES` portato a 20 in modify mode; `summary` suffisso con `[modify mode — N existing file(s) updated]`
- **T054** `backend/src/agents/architect.ts`, `dev_general.ts`, `qa.ts` — catch block ora include: task ID breve (`task.id.slice(0,8)`), agent ID, project info, error troncato a 400 chars, retry hint con `/task client/project titolo` se slug disponibili
- **VERIFY** `pnpm tsc --noEmit` verde su backend e dashboard

### 2026-03-18 — Sessione 23: T049+T050 — Multi-action CEO + File generation + LLM streaming ✅

- **T049** `backend/src/agents/ceo_intake.ts` — riscritta la logica da single-action a **multi-action sequenziale**: il LLM ora pianifica TUTTI gli step in un colpo solo (`commands: []` array), li esegue in sequenza e risponde con un unico messaggio riassuntivo; rimossi i testi "Prossimo step: dimmi..." dall'output; ogni `executeAction` ritorna una stringa di summary (non più `ExecResult` con `clarificationNeeded`); gestione errori blocca la sequenza e segnala il punto di failure
- **T049** `backend/src/agents/software_repo_runtime.ts` — aggiunto `executeWorkspaceFileCreation()`: quando un progetto non ha `repo_local_path`, i dev_general scrivono file reali (HTML, CSS, Python, ecc.) in `workspace/{client}/{project}/output/`; formato output **marker-based** (`=== FILE: index.html ===`) per evitare JSON escaping su file grandi; l'agente decide autonomamente quanti file creare e di che tipo in base al progetto e all'architecture plan
- **T049** `backend/src/agents/dev_general.ts` — aggiunto percorso workspace file creation: se `repoLocalPath` è null, chiama `executeWorkspaceFileCreation` invece di fermarsi; notifica Neb con path della cartella output e numero file scritti
- **T050** `backend/src/services/llm.ts` — `callLLM` usa ora **streaming** (`stream: true` + `stream_options: { include_usage: true }`): i token arrivano man mano, la connessione resta viva durante generazioni lunghe (HTML/CSS 500+ righe), eliminando i timeout del proxy LiteLLM/Azure; aggiunto `timeoutMs` override in `RunOptions` per configurare il timeout per singola call; `DEFAULT_RUN_TIMEOUT_MS` portato a 300s; file generation usa 360s espliciti
- **T050** modelli `dev_general_2` e `qa` spostati da `gemini-2.5-flash` a `gpt-5.4` (gemini causava timeout ~50s); errori LLM ora visibili nel dashboard RunsView (riga espandibile con `error_message`)
- **VERIFY** `pnpm tsc --noEmit` verde su backend e dashboard

### 2026-03-18 — Sessione 22: Agent workspace memory + CEO routing fix ✅

- **FIX** `backend/src/agents/software_delivery_utils.ts` — aggiunto `loadAllWorkspaceContext(workspaceAbsPath)`: legge brief.md + TUTTI i deliverables (marketing, consulting, software, QA) e restituisce un blocco di testo formattato per injection nei prompt; estende il pattern esistente `loadRelevantDeliverables` a tutti i tipi di artifact cross-chain
- **FIX** `backend/src/agents/ceo.ts` — il CEO ora legge il workspace context (brief + deliverables esistenti) prima di ogni decisione di routing; aggiunto import `loadAllWorkspaceContext` + `resolveSoftwareWorkspacePath`; aggiunti routing hint critici: task di tipo "crea file/HTML/codice" → architect indipendentemente dal tipo progetto; task che dice "usa i contenuti esistenti / usa quello che hai fatto" → workspace context consultato e routing verso architect
- **FIX** `backend/src/agents/architect.ts` — l'Architect ora legge TUTTI i deliverables del workspace (non solo architecture_plan.md/qa_report.md/dev-general-*); system prompt aggiornato: "se esistono deliverables, i worker DEVONO usarli come input, non ricrearli"; user message passa `fullWorkspaceContext` al posto del solo briefContent
- **FIX** `backend/src/agents/ceo_intake.ts` — `create_task` ora arricchisce la descrizione del task con il workspace context (brief + deliverables) prima di consegnarlo al CEO; import `loadAllWorkspaceContext`
- **VERIFY** `pnpm typecheck && pnpm build` verdi backend

### 2026-03-18 — Sessione 21: T047 + T048 — Natural Language CEO + Revenue View ✅

- **T047** `backend/src/agents/ceo_intake.ts` — nuovo modulo `runCeoNaturalLanguageHandler(chatId, text, reply, notify)`: gestisce conversazioni multi-turn con stato in-memory (Map<chatId, IntakeContext>, TTL 10 min); usa GPT-5.4 per analizzare l'intento e rispondere con JSON strutturato (`ask` / `execute` / `reply` / `unclear`); esegue direttamente: `create_client`, `create_project`, `write_brief`, `create_task` (+ fire-and-forget CEO agent), `list_clients`, `list_projects`, `status_report`; logga eventi `founder_command` su Supabase
- **T047** `backend/src/services/telegram.ts` — sostituito il catch-all `bot.on('message', ...)` con due handler separati: `/comando` non riconosciuto → "Unknown command"; testo libero → `runCeoNaturalLanguageHandler`; aggiornato `/start` con nota sulla NL interface; aggiunto import `runCeoNaturalLanguageHandler`
- **T048** `dashboard/src/hooks/useSupabaseRealtime.ts` — aggiunto `useInvoicedProjects()`: hook Realtime specializzato per `projects.status = invoiced`
- **T048** `dashboard/src/components/RevenueView.tsx` — nuova view "Revenue": 3 stat card (totale ricavi, n. progetti fatturati, ricavo medio), tabella con colonne cliente/progetto/tipo/valore USD/data, footer con totale, filtro per tipo progetto; dati real-time via `useInvoicedProjects` + `useClients`
- **T048** `dashboard/src/components/ui/Icon.tsx` — aggiunta icona `revenue` ($ con freccia)
- **T048** `dashboard/src/components/Sidebar.tsx` — aggiunto `revenue` a `ViewId` e `NAV_ITEMS`
- **T048** `dashboard/src/App.tsx` — aggiunto `revenue` a `VIEW_META` + `ViewContent` switch + import `RevenueView`
- **VERIFY** `pnpm typecheck && pnpm build` verdi su backend e dashboard

### 2026-03-18 — Sessione 20: T046 — Invoice prompt SaaS + Marketing chain ✅

- **T046** `backend/src/agents/dev_saas.ts` — estratti `clientSlug`/`projectSlug` dal metadata; quando tutti i worker SaaS terminano e il progetto va in `review`, la notifica a Neb include ora `💰 Pronto per la fattura: /invoice client/project`
- **T046** `backend/src/agents/content_creator.ts` — stesso pattern: invoice prompt aggiunto quando `maybeMoveMarketingProjectToReview` restituisce `true`
- **T046** `backend/src/agents/social_manager.ts` — idem: invoice prompt aggiunto sul trigger `projectMovedToReview`
- **GIT** `supabase/migrations/004_projects_blocked_status.sql` — migration committata (era untracked)
- **VERIFY** `pnpm typecheck && pnpm build` verdi su backend e dashboard

### 2026-03-18 — Sessione 19: Revenue flow — /invoice + consulting chain completion ✅

- **T045** `backend/src/agents/consulting_lead.ts` — se `requiresAnalysis: false`, il progetto si sposta ora a `delivered` (non più `active`) e la notifica include il prompt `/invoice client/project`; se analisi richiesta, il progetto resta `active` in attesa dell'Analyst
- **T045** `backend/src/agents/analyst.ts` — completamento della chain consulting: l'Analyst sposta il progetto a `delivered` al termine, emette `project_delivered` event, e notifica Neb con il prompt `/invoice`
- **T045** `backend/src/agents/qa.ts` — quando il QA porta il progetto a `delivered`, la notifica include il prompt `/invoice client/project`
- **T045** `backend/src/services/supabase.ts` — aggiunto `updateProjectContractValue(id, amount)` per aggiornare il valore contratto post-creazione
- **T045** `backend/src/types/index.ts` — aggiunti `project_delivered` e `revenue_recorded` a `EventType`
- **T045** `backend/src/services/telegram.ts` — nuovo comando `/invoice client/project [amount_usd]`: valida progetto, transizione a `invoiced`, aggiorna `contract_value_usd`, emette `revenue_recorded` event, risponde a Neb con conferma; aggiornato `/start` con il nuovo comando
- **VERIFY** `cd backend && pnpm typecheck && pnpm build`; `cd dashboard && pnpm typecheck && pnpm build` verdi



### 2026-03-18 — Sessione 18: Intelligent worker orchestration + stuck run hardening ✅

- **T044** `backend/src/agents/architect.ts`, `backend/src/agents/dev_lead_saas.ts`, `backend/src/agents/dev_general.ts`, `backend/src/agents/dev_saas.ts`, `backend/src/agents/software_delivery_utils.ts` — l’orchestrazione software è ora dependency-aware: i worker indipendenti continuano a poter partire in parallelo, ma sui repo bootstrap/empty `dev_general_2` dipende da `dev_general_1` e `dev_saas_2` dipende da `dev_saas_1`; i task dipendenti restano `todo` finché il predecessore non chiude, poi vengono sbloccati automaticamente
- **T044** `backend/src/agents/dev_general.ts`, `backend/src/agents/dev_saas.ts` — aggiunto il cascade difensivo quando una dipendenza fallisce: i task dipendenti vengono marcati `blocked` invece di restare `todo`, il QA custom software parte comunque quando tutti i worker sono terminali, e il flow SaaS porta il progetto a `blocked` se una worker chain si ferma
- **T044** `backend/src/services/llm.ts`, `backend/src/agents/architect.ts`, `backend/src/agents/dev_lead_saas.ts` — introdotto timeout hard sui run LLM via `AbortController` (`LLM_RUN_TIMEOUT_MS`, default 180s) e transizione esplicita a `blocked` anche per i planner software; questo elimina i casi in cui un task restava indefinitamente `in_progress`
- **VERIFY** `cd backend && pnpm typecheck`, `cd dashboard && pnpm typecheck`, `cd backend && pnpm build`, `cd dashboard && pnpm build` verdi. Test E2E mirato rieseguito su `acmecorp/qr-code-generator`: l’architect ha creato `dev_general_2` con `dependency_task_ids`, il worker bootstrap è andato a timeout controllato, il dipendente è stato marcato `blocked`, il QA si è attivato e il progetto è stato portato a `blocked` senza task appese
- **DOCS** `docs/ARCHITECTURE.md`, `docs/AGENTS_AND_TEAMS.md`, `docs/TASKS_AND_PROJECT_STATE.md`, `docs/FOUNDER_OPERATIONS_PLAYBOOK.md` — documentati queueing sequenziale su repo vuota, parallelismo solo per subtasks indipendenti, timeout LLM hard, e comportamento founder-facing dei task software staged

### 2026-03-17 — Sessione 17: Repo-aware software execution + defensive QA ✅

- **T043** `backend/src/agents/software_repo_runtime.ts`, `backend/src/agents/software_delivery_utils.ts` — aggiunto un runtime condiviso per repo inspection, safe file edits dentro `repo_local_path`, rilevamento `package.json` / script, esecuzione difensiva di `install` / `typecheck` / `build` / `test`, logging sintetico su `runs` + `events`, e rendering dei report `repo-execution-*.md`
- **T043** `backend/src/agents/dev_general.ts`, `backend/src/agents/dev_saas.ts`, `backend/src/agents/architect.ts` — i worker software leggono il codebase reale quando la repo è linkata, chiedono path repo-relativi ai modelli, possono modificare file reali con operazioni mirate, persistono summary di file toccati/comandi/check/blocker, e il flow custom software attiva QA quando i worker raggiungono uno stato terminale
- **T043** `backend/src/agents/qa.ts` — il QA gate ora valuta anche git status e check reali della repo, distingue blocker vs warning, fonde il verdetto LLM con i blocker oggettivi dei comandi, e produce `qa_report.md` coerente con il repo state
- **UI/DOCS** `dashboard/src/components/ProjectsView.tsx`, `docs/ARCHITECTURE.md`, `docs/AGENTS_AND_TEAMS.md`, `docs/TASKS_AND_PROJECT_STATE.md`, `docs/FOUNDER_OPERATIONS_PLAYBOOK.md` — la dashboard riconosce i nuovi artifact `repo-execution-*`; la documentazione spiega il runtime repo-aware, le regole di shell difensiva e il nuovo significato operativo di `review` / `blocked` / `delivered`
- **VERIFY** `cd backend && pnpm typecheck && pnpm build`; `cd dashboard && pnpm typecheck && pnpm build` verdi. Test mirato repo-aware eseguito su una fixture git locale: `architect` + `dev_general_2` hanno prodotto deliverable reali e `repo-execution-*.md`; il QA ha bloccato correttamente la release perché `typecheck` e `build` fallivano davvero sulla repo fixture
### 2026-03-17 — Sessione 16: Repo onboarding ergonomics + founder playbook ✅

- **T042** `backend/src/services/telegram.ts`, `backend/src/services/git.ts`, `backend/src/services/workspace.ts` — `/link_repo` ora usa un parser robusto con supporto a path assoluti quotati contenenti spazi; valida repo git reali; può auto-clonare una remote URL dentro `workspace/<client>/<project>/repo`; aggiunto `/init_repo` per inizializzare una repo locale vuota e collegare opzionalmente `origin`; logging `founder_command` esteso con `mode`, branch, provider e canonical workspace repo path
- **UI** `dashboard/src/components/ProjectsView.tsx` — il pannello progetto mostra contesto repo, path/remote/branch/provider e un promemoria operativo del flow founder `/new_project → /link_repo|/init_repo → /brief → /task`
- **DOCS** `docs/FOUNDER_OPERATIONS_PLAYBOOK.md`, `docs/AGENTS_AND_TEAMS.md`, `docs/ARCHITECTURE.md`, `docs/TASKS_AND_PROJECT_STATE.md` — aggiunta una guida completa con esempi reali dei comandi founder e documentato il nuovo onboarding repo locale/remoto
- **VERIFY** `cd backend && pnpm typecheck && pnpm build`; `cd dashboard && pnpm typecheck && pnpm build` verdi

### 2026-03-17 — Sessione 15: Custom software delivery chain + QA gate ✅

- **T040** `backend/src/agents/architect.ts`, `backend/src/agents/dev_general.ts`, `backend/src/agents/qa.ts`, `backend/src/agents/software_delivery_utils.ts` — nuova chain runtime per software custom: l’Architect legge brief/repo context, scrive `deliverables/architecture_plan.md`, crea task per `dev_general_1` / `dev_general_2`, predispone il task QA; i worker scrivono deliverable `dev-general-*.md`, aggiornano `PROGRESS.md` e attivano il QA gate; `qa` produce `deliverables/qa_report.md` e decide `review` / `blocked` / `delivered`
- **WIRE** `backend/src/agents/ceo.ts` — routing hints aggiornati per preferire `architect` sui progetti `website`, `app`, `automation` e custom software; supporto fire-and-forget aggiunto per `architect`, `dev_general_*` e `qa`
- **DB** `supabase/migrations/004_projects_blocked_status.sql`, `backend/src/types/index.ts`, `dashboard/src/types/index.ts`, `backend/src/services/supabase.ts`, `backend/src/services/telegram.ts` — introdotto `projects.status = blocked` per il QA gate e aggiunto helper atomico `transitionTaskStatus(...)` per evitare avvii duplicati del task QA
- **UI/DOCS** `dashboard/src/components/ProjectsView.tsx`, `docs/AGENTS_AND_TEAMS.md`, `docs/ARCHITECTURE.md`, `docs/TASKS_AND_PROJECT_STATE.md`, `docs/SUPABASE_SCHEMA.md` — nuove icone deliverable per `architecture_plan.md`, `qa_report.md` e `dev-general-*`; stato runtime agenti dev aggiornato; flow custom software e lifecycle `review/blocked/delivered` documentati
- **VERIFY** `pnpm typecheck` + `pnpm build` verdi su backend e dashboard

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
