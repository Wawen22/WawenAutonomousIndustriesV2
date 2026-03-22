# WAI Project Tracking

> Live status only.

---

## Current Direction

**Primary objective:** turn WAI into a dual operating system:

- **Business OS** for autonomous client delivery, revenue, and operations
- **Personal Assistant** for Neb, with Gmail / Calendar / Drive workflows and controlled automations

This now implies a platform decision:

- WAI should use **one shared capability platform**
- both Company and Personal must consume it
- dashboard should become the control plane for capability visibility and governance

**Current focus:** consolidate the first real capability control plane while continuing founder workflow depth:

- keep founder-side MCP workflows reliable and visible through the capability platform
- make the personal assistant a daily habit with clearer governance around what is active and usable
- expand the new capabilities MVP without forking Company and Personal into separate systems
- keep the documentation understandable as the project grows

---

## Milestones

| ID | Milestone | Status | Notes |
|----|-----------|--------|-------|
| M1 | Local development stack running | ✅ Done | Local backend, dashboard, LiteLLM and Supabase connected |
| M2 | CEO Agent first autonomous task | ✅ Done | CEO delegation loop operational |
| M3 | Dashboard real-time monitoring | ✅ Done | Core dashboard live |
| M4 | Client & Project Management System | ✅ Done | Clients, projects, briefs, repos, tasks |
| M5 | First autonomous deliverable | ✅ Done | Delivery chains working end-to-end |
| M6 | Deploy to Hetzner VPS | ⏸ Deferred | Final infra step, not current priority |
| M7 | First revenue-generating output | ✅ Done | Wawen22 LandingPage invoiced and paid |
| M8 | Migrate to personal mini PC | ⬜ Todo | Infra milestone after product readiness |
| M9 | Tool Foundation + Personal Assistant Mode | 🔄 In Progress | Personal workspace, email, search, quick actions live |
| M10 | MCP Integration (Gmail, Calendar, Drive) | 🔄 In Progress | Google Workspace runtime live, founder workflows live, automations started |
| M11 | Shared Capability Platform | 🔄 In Progress | Registry, assignments, policy, health, audit foundation now live as MVP |
| M12 | Dashboard Capabilities Control Plane | 🔄 In Progress | `Capabilities` view now exposes catalog, assignments, health, audit, and safe governance editing |
| M13 | Multi-channel (WhatsApp/Slack) | ✅ Done | WhatsApp via Baileys live — QR scan flow, notification router, capability in control plane |

---

## What WAI Can Do Today

### Business OS

- Create clients and projects
- Link or initialize repos
- Write and update project briefs
- Launch autonomous work through CEO routing
- Run software, consulting, marketing, and SaaS delivery chains
- Govern per-project delivery gates from Telegram or dashboard (`gitPush`, `autoDeploy`, provider, founder approval, client email, auto invoice)
- Push approved repos to GitHub and publish governed deploys to Vercel or Netlify when enabled
- Track blocked tasks, pending review, invoicing, and payments
- Inspect shared capabilities for company runtime, including assignments by runtime/team/agent
- Adjust selected capability policy fields and assignment state from the shared `Capabilities` dashboard view

### Personal Assistant

- Maintain a personal workspace in `workspace/personal/neb/`
- Run founder quick actions from `Assistant HQ`
- Read latest email and inbox summaries through Gmail MCP
- Read today’s agenda through Calendar MCP
- Search and read Google Drive files
- Generate a `Daily Founder Brief`
- Run a daily brief automation with persistent on/off control
- Inspect personal and shared capabilities from the same dashboard control plane used by Company mode

---

## Active Build Queue

| ID | Title | Status | Owner | Priority | Next step |
|----|-------|--------|-------|----------|-----------|
| T106 | Governed Delivery Pipeline | ✅ Done | Codex | 1 | — |
| T107 | Security hardening (CORS + bearer token + path traversal) | ✅ Done | Codex | 1 | — |
| T108 | Invoice email automation | ✅ Done | Claude | 1 | — |
| T109 | Task deduplication guard | ✅ Done | Claude | 2 | — |
| T110 | Partial retry (QA-only retry) | ✅ Done | Claude | 2 | — |
| T111 | MCP GitHub integration | ✅ Done | Claude | 2 | — |
| T112 | Browser/screenshot QA tool | ✅ Done | Claude | 3 | — |
| T113 | Web Scraper / Deep Reader | ✅ Done | Claude | 2 | — |
| T114 | Agent memory system (pgvector + learning) | ✅ Done | Claude | 2 | — |
| T115 | Daily brief automation scheduler | ✅ Done | Claude | 2 | — |
| T083 | File Export tool | ✅ Done | Claude | 2 | — |
| T084 | Skills system | ✅ Done | Claude | 2 | — |
| T086 | MCP integration layer | ✅ Done | Codex | 2 | — |
| T099 | Capability health depth | ✅ Done | Codex | 2 | — |
| T100 | Skill execution context | ✅ Done | Claude | 2 | — |
| T101 | Multi-channel: WhatsApp via Baileys | ✅ Done | Claude | 3 | — |
| T102 | WhatsApp incoming messages | ✅ Done | Claude | 1 | — |
| T103 | OpenRouter free models | ✅ Done | Claude | 1 | — |
| T104 | CEO Intake pre-routing | ✅ Done | Claude | 1 | — |
| T105 | Dashboard Models view | ✅ Done | Claude | 2 | — |

---

## Recent Completed Work

| ID | Title | Status | Impact |
|----|-------|--------|--------|
| T106 | Governed Delivery Pipeline | ✅ Done | Per-project delivery config, governed QA delivery gates, deploy services, dashboard Delivery tab, and capability-governed push/deploy/email/invoice path are now live |
| T107 | Security hardening | ✅ Done | Dashboard API now uses origin-aware CORS, optional bearer auth for sensitive routes, and hardened workspace path resolution for file-serving endpoints |
| T108 | Invoice email automation | ✅ Done | On `invoice_project`: HTML invoice email sent to client via Resend; invoice number `INV-YYYYMMDD-<slug>`; non-fatal if no client email; `invoice_email_sent` event logged |
| T109 | Task deduplication guard | ✅ Done | Atomic CAS pickup in CEO agent + `create_task` guard in CEO Intake blocks duplicate agent spawning on same project |
| T110 | QA-only partial retry | ✅ Done | `retry qa <task_ref>` and `/retry-qa <task_ref>` now skip Architect + Dev General and re-run only the QA gate on the existing task |
| T111 | MCP GitHub integration | ✅ Done | `backend/src/services/github.ts` added with `createGitHubRepo`, `createPullRequest`, `createIssue`. `initWorkspaceRepo` auto-creates a GitHub remote and pushes initial commit when `GITHUB_TOKEN` + `GITHUB_OWNER` are set. `integration.github` registered in the capability registry |
| T113 | Model routing alignment + LLM diagnostics | ✅ Done | Model assignments from the Models view are authoritative for normal runs, special workflow overrides are founder-governed, and LLM transport failures now retry with clearer diagnostics |
| T114 | Agent memory system | ✅ Done | pgvector-backed per-agent memory (`agent_memories` table, migrations 005+008), `memory.ts` for store/recall/dedup, `memory_learning.ts` extracts preferences from founder feedback and persists as memories; `entity_type` field for categorization |
| T115 | Daily brief automation scheduler | ✅ Done | `personal-automation.ts` `startFounderAutomationRuntime()` runs every minute via `setInterval`, fires `daily_founder_brief` at the configured local time (default 08:30 Europe/Rome); on/off toggle + schedule editor live in Assistant HQ |
| T085 | CEO personal task routing | ✅ Done | Personal mode can create docs, send reports, do research, build digests |
| T093 | Capability platform contracts | ✅ Done | Backend now has shared contracts for capability catalog, assignments, policy, health, and audit summary |
| T094 | Capability registry API MVP | ✅ Done | Read-only backend registry now exposes current capabilities for dashboard consumption |
| T095 | Dashboard Capabilities view MVP | ✅ Done | New `Capabilities` dashboard view ships catalog, filters, assignments, health, and policy visibility |
| T096 | Company + Personal capability assignment model | ✅ Done | One shared model now maps capabilities to runtime, team, and agent targets without splitting systems |
| T099 | Capability health depth | ✅ Done | Freshness state, drift warnings, reason codes, event-derived last-success/failure, health depth panel in dashboard |
| T097 | Capability audit depth | ✅ Done | Persisted `capability_events` now back the audit summary and recent activity timeline in `Capabilities` |
| T098 | Capability policy editing | ✅ Done | Dashboard now supports safe governance editing for policy mode, policy notes, and assignment active/disabled state |
| T088 | Dual-mode shell: Company / Personal | ✅ Done | Founder can switch cleanly between business and personal operating modes |
| T089 | Personal dashboard shell + transition | ✅ Done | `Assistant HQ` and personal documents shell live |
| T090 | Personal workspace + identity context | ✅ Done | Profile, workspace, recent docs and personal context are live |
| T091 | Documentation cleanup + knowledge base IA | ✅ Done | New docs home, shorter live tracking, archive split, founder guide cleanup |
| T092 | Dashboard docs viewer MVP | ✅ Done | Company mode now exposes the real markdown knowledge base with index, sidebar, archive split, and search |

---

## Next Steps

Backlog ordinato per valore / rischio:

| ID | Title | Priority | Rationale |
|----|-------|----------|-----------|
| T116 | WhatsApp delivery for scheduled brief | ✅ Done | — |
| T117 | Stuck-task proactive alert | ✅ Done | — |
| T118 | Finance weekly + Settings page + Notification channels | ✅ Done | — |
| T119 | Memory visibility in dashboard | 3 | Vista delle memorie per agente nella sezione Capabilities — utile per debug e governance delle preferenze apprese. |

---

## Recent Changes

### 2026-03-22 — T118: Finance weekly + Settings page + Notification channels

**New services (backend):**
- `notification-preferences.ts` — persists `{ telegram, whatsapp }` to `workspace/system/notification-preferences.json`; default both true
- `company-automations.ts` — persists `{ financeWeeklyReport: { enabled, dayOfWeek, lastSentWeekKey } }` to `workspace/system/company-automations.json`; default enabled=true, dayOfWeek=1 (Monday)

**Modified (backend):**
- `notification-router.ts` `sendFounderNotification`: now reads prefs and filters channels before routing; silently skips if all disabled
- `finance.ts` `runFinanceCycle`: checks `enabled` + `dayOfWeek` before building summary; calls `markFinanceWeeklyReportSent()` after send
- `index.ts`: 4 new endpoints — `GET/POST /api/settings/notifications`, `GET/POST /api/settings/automations`

**New (dashboard):**
- `SettingsView.tsx` — Automations tab (Finance Weekly: toggle + day picker + last-sent status) + Notifications tab (Telegram/WhatsApp toggles with live connection status)
- `'settings'` view added to both Company and Personal nav (CORE section), icon: gear

**Run Now button (Settings → Automations):**
- `runFinanceCycleNow()` in `finance.ts` — bypassa enabled/dayOfWeek/dedup, invia subito
- Endpoint `POST /api/settings/automations/finance-weekly/run` — usa `priority: 'critical'` per bypassare il dedup in-memory 60s di `sendNotification`; rispetta channel prefs (legge `getNotificationPreferences()`)
- Dashboard: pulsante Run Now con spinner + feedback 4s "Sent to active channels ✓" / "Send failed"

**Bug fix — Telegram markdown parser:**
- `sendTelegramNotification` ora ritenta senza `parse_mode` se Telegram rifiuta il messaggio (backtick/markdown non valido nel contenuto LLM)

**Typecheck:** backend + dashboard green

### 2026-03-22 — T114+T115+T117: Retroactive tracking alignment

- **T114** — Agent memory system: `memory.ts` (pgvector store/recall/dedup) + `memory_learning.ts` (extract learning points from founder feedback) + migrations `005`+`008`. Already live, not tracked.
- **T115** — Daily brief automation scheduler: `personal-automation.ts` `startFounderAutomationRuntime()` runs every minute, fires brief at configured local time. Already live, not tracked.
- **T117** — Stuck-task proactive alert: `ops.ts` `startOpsMonitor()` checks every 15 min for tasks stuck > 30 min in `in_progress`/`blocked`, sends via `sendFounderNotification`. Already live, not tracked.

### 2026-03-22 — T116: WhatsApp delivery for scheduled brief

- In `runDailyFounderBriefAutomationNow` (success path), after logging the `succeeded` event, now calls `sendFounderNotification(briefText)` — routes to Telegram always, WhatsApp if connected
- Message capped at 3800 chars (Telegram hard limit is 4096) — truncated messages append `…[brief completo nel workspace]`
- Send is non-fatal: `.catch()` so notification failure never breaks automation state recording
- Applies to both `manual` and `scheduled` triggers
- Import of `sendFounderNotification` added from `notification-router.ts`
- Typecheck green

### 2026-03-20 — Sessione 66: Governed Delivery Pipeline + security hardening (T106/T107)

**Governed delivery pipeline live:**
- Added `backend/src/services/delivery-config.ts` with global defaults in `workspace/system/delivery-config.json`, per-project merge against `project.metadata.delivery_config`, and update helpers
- Added `backend/src/services/deploy.ts` with governed `pushToGitHub()`, Vercel deploy, and Netlify deploy services; missing tokens are warning-only and never block the pipeline
- `qa.ts` now runs governed delivery gates after QA pass: founder approval hold, git push, provider deploy, client email, auto invoice, and final delivery summary
- Founder `/approve` now resumes pending delivery gates instead of only closing the blocked QA task; `/reject` clears review state and moves the project back to `review`
- Added `configure_delivery` to CEO Intake so Neb can change per-project delivery policy from natural language
- Added `GET /api/delivery/defaults` and `GET/PATCH /api/projects/:id/delivery-config`
- Added delivery/deploy capabilities to the shared capability registry so push/deploy/email/invoice can be disabled globally from Capabilities
- Projects modal now has a `Delivery` tab with toggle controls, provider dropdown, `CUSTOM` badge, save action, and latest `deployUrl`

**Security hardening:**
- Replaced wildcard CORS with whitelist-driven origin reflection via `isAllowedDashboardOrigin()`
- Added optional bearer auth via `WAI_DASHBOARD_TOKEN` on sensitive dashboard/backend routes while preserving local founder access
- Hardened `/api/deliverables`, `/api/file`, and repo file serving with resolved-path containment checks under `workspace/`
- Backend and dashboard typechecks verified green

### 2026-03-21 — T111: GitHub integration

- Created `backend/src/services/github.ts`: `createGitHubRepo()`, `createPullRequest()`, `createIssue()`, `isGitHubConfigured()` — plain fetch to GitHub REST API, no Octokit dependency
- `initWorkspaceRepo` in `software_repo_runtime.ts`: after initial git commit, if `GITHUB_TOKEN` + `GITHUB_OWNER` are set, auto-creates a private GitHub repo, sets origin remote (tokenized URL), and pushes; failure is non-fatal (warning added)
- `WorkspaceRepoInitResult` now carries `repoUrl?: string` from the auto-init
- `architect.ts`: on new-project auto-init, stores `repo_url` + `repo_provider: 'github'` in Supabase project; propagates `repo_url` into child task metadata so QA and delivery gates can use it directly
- `integration.github` capability registered in `capabilities.ts` — shows `connected` / `disabled` depending on env vars
- Add `GITHUB_OWNER` env var to enable (existing `GITHUB_TOKEN` already required for push)
- Typechecks green

### 2026-03-21 — T110: QA-only partial retry

- Added `retry_qa` shortcut in `detectFounderShortcutIntent`: matches `retry qa <id>` / `/retry-qa <id>` / `retry-qa <id>` — zero LLM call
- Added `retry_qa` action to CEO system prompt ACTIONS list with planning rule 23
- Added `retry_qa` case to command dispatcher in `ceo_intake.ts`: validates task is `blocked` or `in_progress`, fires `runQaAgent()` directly (fire-and-forget), logs `founder_command` event with `command: 'retry_qa_only'`
- No new files; only `backend/src/agents/ceo_intake.ts` modified

### 2026-03-21 — T108 + T109: Invoice email + Task deduplication

**T108 — Invoice email:**
- `executeInvoiceProject` ora genera e invia una HTML invoice email al cliente via Resend immediatamente dopo aver marcato il progetto come `invoiced`
- Invoice number format: `INV-YYYYMMDD-<PROJECT_PREFIX>`
- Se `client.email` è null: email skippata silenziosamente (warning loggato), pipeline non bloccata
- Evento `invoice_email_sent` emesso nella tabella `events` in caso di successo
- `formatInvoiceProjectMessage` ora mostra lo stato di consegna email nella conferma Telegram

**T109 — Task deduplication:**
- `ceo_intake.ts` `create_task`: controlla `getInProgressTasksByProject` prima di creare — ritorna warning chiaro se il progetto ha già un task attivo
- `ceo.ts` `runCeoAgent`: sostituisce `updateTaskStatus` con `transitionTaskStatus('todo' → 'in_progress')` — CAS atomico impedisce a due CEO agent concorrenti di reclamare lo stesso task

### 2026-03-20 — Sessione 67: Model routing alignment + LLM diagnostics (T113)

- Made the Models view/runtime assignment authoritative for normal agent runs by moving `getModelForAgent()` precedence to: explicit override → runtime override → agent assignment/default → task-type fallback
- Removed drift between the static agent registry and the model routing defaults so config surfaces no longer disagree about `dev_general_*`, `architect`, `qa`, and other agents
- Model assignment saves now clear redundant overrides when the selected model matches the agent default, and best-effort sync the effective model into the `agents` table for dashboard consistency
- `/api/models` now explains current routing policy and exposes founder-governed special workflow overrides instead of hardcoded model forcing; the cross-model fallback is now disabled by default unless explicitly configured
- Added retry-once behavior for transient LLM transport failures such as `Premature close`, with clearer error messages that include model, attempt, and failure class
- Repo-aware edit planning now inherits the agent assignment by default and only forces a model when Neb configures a special override from the Models view; the old hardcoded `gpt-5.4` fallback path is gone, and errors now bubble up with stage context instead of a bare transport string

### 2026-03-20 — Sessione 68: Coding model default swap + upstream rate-limit diagnostics

- Switched the coding-path defaults from `qwen3-coder` to `nemotron-120b` for `dev_saas_*`, `architect`, `dev_general_*`, and `qa` so the main delivery path no longer depends on the unstable OpenRouter free Qwen route
- Startup model assignment restore now also syncs non-overridden agent defaults back into Supabase, keeping dashboard agent cards aligned with the runtime routing defaults
- Upstream LLM failures now log clearer diagnostics for provider-side issues, including explicit `rate_limit` classification, HTTP status code, and provider name when available
- Kept `qwen3-coder` in the registry for manual checks only, with lightweight reminders in LiteLLM config and the Models dashboard to revisit it later against stronger coding candidates such as future GLM 4.7 / 5 options

### 2026-03-20 — Sessione 65: Bug fixes delivery pipeline + deliverable update + project status reset + QA npm fix

**software_repo_runtime.ts — QA false-positive su npm install:**
- `npm install` failure downgraded from `blockingIssues` → `warnings`
- Rationale: install failure non prova che il codice sia rotto (comune per siti statici, problemi di rete, o package.json senza build scripts); i veri blockers arrivano solo da `build`/`typecheck`/`test` failures
- QA continua a segnalare l'install failure come warning visibile nel report, ma non blocca più la delivery

### 2026-03-20 — Sessione 65: Bug fixes delivery pipeline + deliverable update + project status reset

**CEO Intake — rule 9 fix ("Lancia il lavoro"):**
- Fixed ambiguity: "Lancia il lavoro" was interpreted as `retry_task` even when no blocked task existed, causing the CEO to ask for a task ID
- Updated planning rule 9 in `buildSystemPrompt()`: if project has NO blocked task → use `create_task`; if blocked task exists → use `retry_task`; NEVER ask for a task ID

**software_repo_runtime.ts — modelOverride for code gen:**
- `executeRepoImplementation` now forces `modelOverride: 'gpt-5.4'` — free models (qwen3-coder, nemotron-120b) truncate large JSON responses for full HTML/CSS files, causing `parseRepoEditPlan` to return null
- All other agents continue using free models; override is scoped only to the code generation step

**dev_general.ts — deliverable execution result:**
- Added `appendExecutionResult()` function: after execution (repo or workspace), updates `dev-general-1.md` in-place
- Checklist items in `## Acceptance Checklist` are updated to `[x]` if the corresponding file was actually touched during execution
- Appends `## Execution Result` section with: status ✅/⚠️, files written, commands executed, blockers, warnings
- On re-run, previous execution section is replaced (not appended)
- Failure is non-fatal (`.catch(() => {})`)

**ceo_intake.ts — project status reset on new work:**
- In `create_task` handler: if the project is `blocked` or `review`, immediately calls `updateProjectStatus(project.id, 'active')` before creating the task
- Dashboard shows the project as active instantly without waiting for the Architect to run
- Import of `updateProjectStatus` added to supabase imports

**docker-compose.yml:**
- Added `- OPENROUTER_API_KEY=${OPENROUTER_API_KEY}` to litellm service environment (was missing, causing OpenRouter models to fail)

**Supabase schema fixes:**
- Inserted 4 new OpenRouter models into `models` table (FK required by `runs.model_id_fkey`)
- Dropped and recreated `models_provider_check` constraint to include `'openrouter'`
- Updated `agents` table `model_id` values to match new `AGENT_MODEL_DEFAULTS` routing

### 2026-03-20 — Sessione 64: OpenRouter free models + CEO Intake pre-routing + Models view (T103/T104/T105)

**T103 — OpenRouter models:**
- Added 4 free models to `infrastructure/litellm/config.yaml` under `openrouter/` prefix: `glm-4.5-air`, `nemotron-120b`, `step-flash`, `qwen3-coder`
- Added `'openrouter'` to `ModelProvider` type in `backend/src/types/index.ts`
- Added all 4 models to `MODELS` registry in `backend/src/config/models.ts` (cost = 0, is_active = true)
- Updated `AGENT_MODEL_DEFAULTS`: CEO/PM/finance/consulting → nemotron-120b; all dev/QA/architect → qwen3-coder; content/social/ops/HR → glm-4.5-air
- `COMPLEX_TASK_TYPES` → nemotron-120b; `SIMPLE_TASK_TYPES` → step-flash; fallback → step-flash
- Exported `AGENT_MODEL_DEFAULTS` and added `getModelOverrides()` helper

**T104 — CEO Intake pre-routing:**
- Expanded `detectFounderShortcutIntent` in `backend/src/agents/ceo_intake.ts`
- New zero-LLM shortcuts: `status`/`stato`/`report` → status_report; `clienti`/`lista clienti` → list_clients; `progetti`/`lista progetti` → list_projects; `weekly digest`/`recap settimanale` → weekly_digest
- All existing shortcuts (daily brief, Drive, Gmail, calendar) preserved
- Result: for direct one-word commands, no LLM call is made at all

**T105 — Models governance view:**
- Created `backend/src/services/model-assignments.ts` — persists agent model overrides to `workspace/system/model-assignments.json`; restores on startup via `restorePersistedModelAssignments()`
- Added `GET /api/models` → returns registry + defaults + overrides + effective assignments
- Added `POST /api/models/assign` → `{ agentId, modelId }` → persists + updates in-memory routing
- Added `ModelsResponse` and enriched `ModelConfig` types to `dashboard/src/types/index.ts`
- Created `dashboard/src/components/ModelsView.tsx` — registry table with FREE badge + provider pills, agent assignment table with dropdowns, Save button, override indicators
- Added `'models'` icon to `Icon.tsx` (stacked-rows SVG)
- Wired `models` view into Sidebar (both Company CORE section and Personal section) and App.tsx
- Typechecks green for both backend and dashboard

### 2026-03-20 — Sessione 63: WhatsApp incoming messages (T102)

- Added `registerWhatsAppIncomingHandler(socket)` in `backend/src/services/whatsapp.ts` — listens to Baileys `messages.upsert` events (type `notify` only), filters by `WHATSAPP_FOUNDER_JID`, extracts plain text from `message.conversation` or `extendedTextMessage.text`
- Auth gate: only messages from the exact normalized `WHATSAPP_FOUNDER_JID` are processed — any other sender is silently ignored
- Text is routed to `runCeoNaturalLanguageHandler` (same CEO Intake used by Telegram bot) with `reply`/`notify` functions both bound to `sendWhatsAppNotification` to the sender JID
- Handler is registered inside the `connection === 'open'` event block — so it's re-registered on each reconnect
- Capability event `used` with actor `founder` and source `whatsapp_incoming` logged on every processed message
- Errors in the CEO handler reply with `❌ Errore interno. Riprova.` back via WhatsApp
- Typechecks green

### 2026-03-20 — Sessione 62: WhatsApp test flow + Telegram retry (T101 post-merge fixes)

- Fixed `WHATSAPP_FOUNDER_JID` in `.env` — country code `39` mancante (`3890086705` → `393890086705@s.whatsapp.net`); le notifiche WhatsApp ora arrivano correttamente
- Added `POST /api/whatsapp/test-send` endpoint in `backend/src/index.ts` — chiama `sendFounderNotification()` direttamente per testare entrambi i canali senza dover creare task
- Added **Send Test** button (green) in `PersonalHQView` WhatsApp Channel panel — visibile solo quando connesso, trigger diretto del test-send endpoint
- Added **Disconnect** button (red) accanto a Send Test e Reconnect — chiama `POST /api/whatsapp/disconnect` e aggiorna lo stato in tempo reale
- Fixed Telegram 409 conflict on hot-reload: sostituito il `void bot.start().catch(warn)` con un loop di retry asincrono (15s × 5 tentativi) in `backend/src/index.ts` — dopo il conflitto transitorio dovuto al tsx watch che tiene vivo il vecchio processo, il bot riprende il polling automaticamente senza riavvio manuale
- Typechecks green per entrambi backend e dashboard

### 2026-03-20 — Sessione 61: Multi-channel WhatsApp (T101/M13)

**Library:** `@whiskeysockets/baileys` chosen over whatsapp-web.js — pure WebSocket, no Puppeteer/Chromium, TypeScript native, ESM module, filesystem-persistent sessions.

- Created `backend/src/services/whatsapp.ts` — initializes a Baileys session from `workspace/system/whatsapp-session/`; exposes `getWhatsAppStatus()` (sync, returns `connected | qr_pending | offline`), `initWhatsAppSession()` (starts or restarts), `sendWhatsAppNotification(to, text)` (sends + logs capability events); handles QR → PNG base64 via `qrcode.toDataURL`; auto-reconnects up to 5 attempts, clears session on logout
- Created `backend/src/services/notification-router.ts` — `sendFounderNotification(text)` always sends Telegram; if `WHATSAPP_FOUNDER_JID` is set and WhatsApp is connected, duplicates to WhatsApp (failure is non-fatal)
- Added `channel.whatsapp_founder_interface` to capability registry in `capabilities.ts` — type `channel`, target `shared`, policy `restricted`, health derived live from `getWhatsAppStatus()`; drift warning if `WHATSAPP_FOUNDER_JID` is not set
- Added `GET /api/whatsapp/status` and `POST /api/whatsapp/connect` endpoints to `backend/src/index.ts` — both local+dashboard-origin guarded
- Added `WhatsAppState` and `WhatsAppStatus` types to both `backend/src/types/index.ts` and `dashboard/src/types/index.ts`
- Replaced `sendTelegramNotification` with `sendFounderNotification` at startup (`startOpsMonitor/startFinanceRuntime/startHrRuntime`), task-action dashboard endpoint, and `budget.ts` budget alerts — Telegram calls inside telegram.ts bot handlers unchanged
- Added **WhatsApp Channel** section to `Setup` tab in `PersonalHQView.tsx` — shows CONNECTED/QR PENDING/OFFLINE badge; if `qr_pending` renders the QR code PNG (auto-polls every 3 s until connected); if `offline` shows `WHATSAPP_FOUNDER_JID` setup instructions; Connect/Reconnect button; fuchsia accent color consistent with channel type
- Typechecks and builds verified green for both backend and dashboard

### 2026-03-20 — Sessione 60: Skill Execution Context (T100)

- Created `backend/src/services/skill-runner.ts` — `runSkill(skillId, input, context, forceApproval)` validates capability exists, type === 'skill', policy is not `disabled`, `approval_required` requires explicit `forceApproval: true`; builds a structured prompt from `usageInstructions + examples + input`; calls CEO agent via `runAgent`; persists run via `logRun` and returns the run ID; logs `used`/`succeeded`/`failed` capability events on every execution
- Added `POST /api/skills/:id/run` endpoint to `backend/src/index.ts` — local+dashboard-origin guarded, body: `{ input?, forceApproval? }`, responds `{ ok, skillId, output, runId, durationMs }` or `{ error, requiresApproval: true }` on policy block
- Added `SkillRunResult` interface to `backend/src/types/index.ts` and `dashboard/src/types/index.ts`
- Extended `UsageTab` in `dashboard/src/components/CapabilitiesView.tsx` — inline `Run Skill` form with optional input textarea, Run button with spinner, approval-required gate with Confirm & Run secondary action, output block showing text + run ID + duration
- Added `play` icon to `dashboard/src/components/ui/Icon.tsx`
- Typechecks and builds verified green for both backend and dashboard

### 2026-03-20 — Sessione 59: File Export tool (T083)

- `executeFileExport` in `tool-executor.ts` now logs a `used` capability event to `integration.local_workspace_filesystem` on every export, with filename, relative path, format, mode, and size_bytes in the payload — events appear in the Capabilities Activity tab
- Added `GET /api/files/exports` endpoint: scans all `workspace/*/output/` and `workspace/personal/*/output/` dirs, returns sorted list of exported files with name, relativePath, sizeBytes, createdAt, type (md/txt/json/csv/html/other), and context (personal/company) — supports `?limit=` param, default 50
- Added `ExportedFile`, `ExportedFileType`, `ExportedFileContext`, `ExportsResponse` types to `dashboard/src/types/index.ts`
- Added **Exports** tab to `PersonalHQView` (Assistant HQ): shows the full list of workspace exports with type pill, context badge, size, timestamp, and a Copy Path button; lazy-loads when tab is opened, Refresh button for manual re-scan
- Typechecks and builds verified green for both backend and dashboard

### 2026-03-20 — Sessione 58: Capabilities UI/UX refactor

- Full rewrite of `dashboard/src/components/CapabilitiesView.tsx` — same data model, completely new layout
- **Header**: collapsed from 5 stacked zones (~250px) to 3 compact rows — title/refresh · type pill tabs · health status dots
- **Type filtering**: single pill row in header (All · Skills · Integrations · Plugins · Memory · Channels) — eliminates the redundant dropdown + quick-chips duplication
- **Runtime filter**: inline pill buttons next to search bar, replacing the separate dropdown
- **Health filter**: health dots in header are now clickable toggles — click "12 connected" to filter, click again to clear
- **List items**: from dense cards (title + owner + description + 4 badges + 3 metadata fields) to compact 2-row rows — type dot + label + one meta line + health dot on right
- **Color system**: each capability type now has one semantic accent color used everywhere: Skill=cyan, Integration=emerald, Plugin=indigo, Memory=amber, Channel=fuchsia
- **Detail panel**: replaced 6 stacked Panel components (infinite scroll) with tabbed navigation — Overview / Usage (skill only) / Assignments / Policy / Activity
- All governance editing (policy mode, assignment states, save button) moved into the Policy tab
- All audit + event history moved into the Activity tab
- Typecheck and build verified green for dashboard

### 2026-03-20 — Sessione 57: Skills system (T084)

- Added `usageInstructions?: string` and `examples?: string[]` to `Capability` interface in both backend and dashboard types (T084 first-class skill metadata)
- Enriched all founder quick-action skills with usage instructions and example prompts: `important_emails_today`, `pre_meeting_brief`, `latest_email`, `calendar_today`, `drive_recent_files`, `daily_founder_brief`, `daily_founder_brief_automation`
- Added `important_emails_today` and `pre_meeting_brief` as explicit `skill.founder.*` capability objects (previously these only logged to integration IDs, now they have full skill entries with metadata)
- Added 3 company skills to the shared capability registry: `skill.company.proposal_writing`, `skill.company.repo_bootstrap`, `skill.company.invoice_followup` — each with assignments, policy, health, and full audit entries
- `proposal_writing` and `repo_bootstrap` use `restricted` policy; `invoice_followup` uses `approval_required` to enforce human review before external communication
- Added `?type=` query-param filtering to `GET /api/capabilities` endpoint (e.g. `?type=skill` returns only skill entries with filtered assignments)
- Added `SkillDetailPanel` component to `CapabilitiesView`: appears in the detail panel for any selected skill, shows Usage Instructions block and Example Prompts list
- Added quick-filter shortcut chips to the capabilities header: **Skills (N)**, **Integrations (N)**, **All (N)** buttons for fast filtering without using the dropdown
- Stat card changed from "Shared" to "Skills" count for immediate skill visibility at a glance
- Typechecks and builds verified green for both backend and dashboard

### 2026-03-20 — Sessione 56: MCP integration layer depth (T086)

- Added `important_emails_today` quick action: prompts CEO Intake to filter high-priority/unread emails with sender, subject, preview and urgency — logs to `integration.google_workspace.gmail`
- Added `pre_meeting_brief` quick action: reads Calendar events for today+tomorrow, produces structured brief per meeting with participants and topic — logs to `integration.google_workspace.calendar`
- Updated `getFounderQuickActionCapabilityId` to map new actions to their integration-level capability IDs instead of generic skill IDs
- Added editable automation schedule in `Automations` tab: inline `HH:MM` input with Save/Cancel, persisted via existing `POST /api/personal/automation/config` endpoint
- Refactored `Assistant HQ` into 4 tabs: **Exec** (quick actions + recent docs), **Automations** (schedule editor + enable/run controls), **Setup** (MCP bridge + connector status), **Profile** (identity context)
- Typechecks and builds verified green for both backend and dashboard

### 2026-03-20 — Sessione 55: Capability health depth (T099)

- Extended `CapabilityHealth` type with `freshness`, `lastSuccessAt`, `lastFailedAt`, `driftWarnings`, `reasonCode`, and `details` fields
- Added `computeFreshness` helper: `fresh` (< 1 h) / `aging` (1–24 h) / `stale` (> 24 h) / `unknown`, driven by real runtime timestamps
- Added `computeGoogleDriftWarnings`: surfaces stale-connection and missing-registration drift for Google Workspace MCP
- Added `googleReasonCode`: structured reason codes for all Google runtime states (`oauth_connected`, `oauth_required`, `env_missing`, `server_unreachable`, `runtime_error`)
- Enriched all health constructors with new signals: `healthFromGoogleRuntime`, `healthFromGoogleConnector`, `healthFromEnv`, automation health, filesystem/workspace health
- Added `enrichHealthFromEvents`: after fetching recent `capability_events`, updates health `lastSuccessAt`/`lastFailedAt` and recomputes freshness from real event history
- Added `mostRecentTimestamp` utility for safe event-vs-runtime timestamp comparison
- Dashboard `CapabilitiesView`: added health summary bar (connected / degraded / auth-required / failing / stale / drift counts) at top of page
- Dashboard `CapabilitiesView`: added `FreshnessPill` and `HealthDepthPanel` components — freshness, reason code, last success/failure, drift warnings, details breakdown — rendered for every selected capability
- Dashboard list items now show staleness and drift count indicators inline
- Freshness pill shown in the health message block of the selected capability panel
- Typechecks and builds verified green for both backend and dashboard

### 2026-03-19 — Sessione 54: Capability governance editing MVP

- Added persisted local governance overrides in `workspace/system/capability-governance.json`
- Added `POST /api/capabilities/:id/governance` for safe founder-side updates of policy mode, policy notes, and assignment state
- Extended the `Capabilities` dashboard view with save flow for governance edits without opening full CRUD scope
- Smoke-tested real backend behavior: governance change reflected in `GET /api/capabilities/:id`, emitted persisted `configured` / `disabled` audit events, then restored cleanly

### 2026-03-19 — Sessione 53: Capability audit events + activity timeline

- Added migration `007_capability_events.sql` for persisted capability audit history
- Added backend logging helpers and runtime instrumentation for founder quick actions, Google Workspace MCP auth/tool usage, founder profile updates, and daily brief automation changes/runs
- Capability audit summary is now derived from persisted events when available instead of relying only on static snapshot metadata
- Added `Recent Capability Activity` to the dashboard `Capabilities` view
- Kept safe fallback behavior if the `capability_events` table is not migrated yet, so existing environments do not break immediately

### 2026-03-19 — Sessione 52: Capabilities MVP backend + dashboard

- Added shared capability contracts to the backend for catalog, assignments, policy, health, and audit summary
- Added a live read-only capability registry service and API endpoints for dashboard consumption
- Seeded the registry with current Google Workspace MCP capabilities, founder quick actions, memory providers, shared channels, and filesystem capability coverage
- Modeled assignments across runtime, team, and agent targets without splitting Company and Personal into separate systems
- Added a new shared `Capabilities` dashboard view, available in both Company and Personal mode, with catalog, search/filter, health badges, policy snapshot, and assignment visibility
- Marked M11/M12 as in progress and closed the first four capability MVP tasks in the build queue

### 2026-03-19 — Sessione 49: Dashboard docs viewer MVP

- Added a dedicated `Knowledge Base` launcher, separate from the main navigation and available in both Company and Personal mode
- Viewer now starts from [INDEX.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/INDEX.md) and reads the real markdown files under `docs/`
- Added knowledge base navigation sourced from the real docs tree
- Reworked the docs navigator toward a more compact docs-first flow instead of a long generic card list
- Added markdown rendering plus simple document search/filter inside the dashboard
- Finalized the UX so the launcher is a small bottom-left icon and entering `Knowledge Base` replaces the normal sidebar with docs navigation until exit

### 2026-03-19 — Sessione 51: Capability platform documentation baseline

- Added [CAPABILITY_PLATFORM_AND_OPENCLAW_PLAN.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/CAPABILITY_PLATFORM_AND_OPENCLAW_PLAN.md) as the canonical strategic plan for shared skills, plugins, memory, integrations, and channels
- Updated [VISION.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/VISION.md) so WAI explicitly targets a shared capability platform across Company and Personal runtime
- Updated [ARCHITECTURE.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/ARCHITECTURE.md) with the new registry / assignment / policy / health / audit direction
- Updated this file so the next build queue prioritizes the `Capabilities` backend and dashboard MVP

### 2026-03-19 — Sessione 50: Founder guide consolidation + archive removal

- Integrated the practical founder command reference and concrete examples into [FOUNDER_OPERATIONS_PLAYBOOK.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/FOUNDER_OPERATIONS_PLAYBOOK.md)
- Removed the dependency on archived founder docs for day-to-day operations
- Removed live references to archive files from the canonical docs index and README

### 2026-03-19 — Sessione 48: Documentation cleanup + knowledge base structure

- Added [INDEX.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/INDEX.md) as the single entry point for docs
- Moved the previous long-form tracking log into archive
- Rewrote this file to be a live status snapshot instead of an endless session ledger
- Reworked the founder manual to be more usable as a daily reference
- Realigned README and `CLAUDE.md` to the new documentation model

### 2026-03-19 — Sessione 47: Founder automation control panel + daily brief runtime

- Daily founder brief automation runtime added
- Persistent enable/disable control added to `Assistant HQ`
- Manual `Run now` kept available even when automation is disabled

### 2026-03-19 — Sessione 46: Founder language lock for MCP summaries

- Founder-facing inbox and calendar summaries now follow `preferredLanguage`
- Fixed mixed-language drift in `Today Agenda`

### 2026-03-19 — Sessione 45: Assistant HQ quick actions wired to founder MCP flows

- `Latest Email`, `Today Agenda`, `Recent Drive Files`, `Daily Founder Brief` added to `Assistant HQ`
- Dashboard now triggers founder actions through the same CEO Intake path

### 2026-03-19 — Sessione 42–44: Google Workspace MCP foundation completed

- Google Workspace OAuth callback and runtime are live
- Gmail, Calendar and Drive founder actions are usable
- `Daily Founder Brief` became a real output, not a placeholder
