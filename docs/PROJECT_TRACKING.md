# WAI Project Tracking

> Live status only.

---

## Current Direction

**Primary objective:** turn WAI into a dual operating system:

- **Business OS** for autonomous client delivery, revenue, and operations
- **Personal Assistant** for Neb, with Gmail / Calendar / Drive workflows and controlled automations

**Current focus:** finish the highest-leverage part of M9/M10 without losing clarity:

- stabilize founder-side MCP workflows
- turn the personal assistant into a daily habit
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
| M11 | Multi-channel (WhatsApp/Slack) | ⬜ Todo | Only after personal mode is stable |

---

## What WAI Can Do Today

### Business OS

- Create clients and projects
- Link or initialize repos
- Write and update project briefs
- Launch autonomous work through CEO routing
- Run software, consulting, marketing, and SaaS delivery chains
- Track blocked tasks, pending review, invoicing, and payments

### Personal Assistant

- Maintain a personal workspace in `workspace/personal/neb/`
- Run founder quick actions from `Assistant HQ`
- Read latest email and inbox summaries through Gmail MCP
- Read today’s agenda through Calendar MCP
- Search and read Google Drive files
- Generate a `Daily Founder Brief`
- Run a daily brief automation with persistent on/off control

---

## Active Build Queue

| ID | Title | Status | Owner | Priority | Next step |
|----|-------|--------|-------|----------|-----------|
| T083 | File Export tool | 🔄 In Progress | Codex | 2 | Add deeper founder/dashboard linking and cleaner output access |
| T084 | Skills system | ⬜ Todo | Claude | 2 | Define canonical skill format and prompt injection path |
| T086 | MCP integration layer | 🔄 In Progress | Codex | 2 | Add richer founder automations, important-email layer, pre-meeting brief, schedule editor |
| T087 | WhatsApp via Baileys or Slack | ⬜ Todo | Claude | 3 | Evaluate only after founder-side loop is stable |

---

## Recent Completed Work

| ID | Title | Status | Impact |
|----|-------|--------|--------|
| T085 | CEO personal task routing | ✅ Done | Personal mode can create docs, send reports, do research, build digests |
| T088 | Dual-mode shell: Company / Personal | ✅ Done | Founder can switch cleanly between business and personal operating modes |
| T089 | Personal dashboard shell + transition | ✅ Done | `Assistant HQ` and personal documents shell live |
| T090 | Personal workspace + identity context | ✅ Done | Profile, workspace, recent docs and personal context are live |
| T091 | Documentation cleanup + knowledge base IA | ✅ Done | New docs home, shorter live tracking, archive split, founder guide cleanup |
| T092 | Dashboard docs viewer MVP | ✅ Done | Company mode now exposes the real markdown knowledge base with index, sidebar, archive split, and search |

---

## Immediate Next Steps

1. Make the founder automation schedule editable from `Assistant HQ`.
2. Add an `important emails today` founder flow so WAI prioritizes what matters instead of only returning the latest email.
3. Build a `pre-meeting brief` flow combining calendar, email and Drive context.
4. Refactor `Assistant HQ` information architecture so execution, automation, setup, and profile stop competing in one long page.

---

## Recent Changes

### 2026-03-19 — Sessione 49: Dashboard docs viewer MVP

- Added a dedicated `Knowledge Base` launcher, separate from the main navigation and available in both Company and Personal mode
- Viewer now starts from [INDEX.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/INDEX.md) and reads the real markdown files under `docs/`
- Added knowledge base navigation with canonical/reference/archive separation
- Reworked the docs navigator into a more compact indexed layout with section filters instead of a long scrolling card list
- Added markdown rendering plus simple document search/filter inside the dashboard
- Finalized the UX so the launcher is a small bottom-left icon and entering `Knowledge Base` replaces the normal sidebar with docs navigation until exit

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
