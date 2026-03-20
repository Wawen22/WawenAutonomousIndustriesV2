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
| M13 | Multi-channel (WhatsApp/Slack) | ⬜ Todo | Only after capability foundation and personal mode are stable |

---

## What WAI Can Do Today

### Business OS

- Create clients and projects
- Link or initialize repos
- Write and update project briefs
- Launch autonomous work through CEO routing
- Run software, consulting, marketing, and SaaS delivery chains
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
| T083 | File Export tool | ✅ Done | Claude | 2 | Capability event logging, /api/files/exports endpoint, Exports tab in Assistant HQ |
| T084 | Skills system | ✅ Done | Claude | 2 | Skill registry enriched; company skills added; SkillDetailPanel live in dashboard |
| T086 | MCP integration layer | ✅ Done | Codex | 2 | Important emails today + pre-meeting brief quick actions live; editable automation schedule; AssistantHQ tab refactor |
| T087 | WhatsApp via Baileys or Slack | ⬜ Todo | Claude | 3 | Evaluate only after capability foundation is stable |
| T099 | Capability health depth | ✅ Done | Codex | 2 | Freshness, auth age, drift warnings, reason codes, event-driven enrichment, dashboard health depth panel |
| T084 | Skills system | ✅ Done | Claude | 2 | Skill registry enriched with usageInstructions + examples; company skills added; SkillDetailPanel in dashboard |

---

## Recent Completed Work

| ID | Title | Status | Impact |
|----|-------|--------|--------|
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

## Immediate Next Steps

1. Consider WhatsApp/Slack channel (T087) now that capability foundation and file export are stable.
2. Consider WhatsApp/Slack channel (T087) only after capability foundation is stable.
3. Consider expanding company-side skill execution: skills currently have rich metadata and assignments but execution still flows through CEO delegation — a skill runner / execution context could make them more autonomous.

---

## Recent Changes

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
