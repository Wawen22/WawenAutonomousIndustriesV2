# WAI Founder Guide

> Canonical founder manual for WAI.
> This document now includes the practical command reference and concrete examples.

---

## What WAI Is For

WAI gives Neb two operating modes:

- **Business OS** for clients, projects, briefs, delivery, invoicing, and task recovery
- **Personal Assistant** for email, calendar, Drive, briefs, personal docs, and founder automations

Core rule:

1. use **Business OS** when the work belongs to a client or a project
2. use **Personal Assistant** when the work belongs directly to Neb

---

## Choose the Right Interface

| Need | Best Interface |
|------|----------------|
| Fast deterministic action | Telegram slash command |
| Natural day-to-day control | Telegram natural language |
| Review, unblock, invoice, inspect visually | Dashboard |
| Personal quick actions and automations | `Assistant HQ` |

Rule of thumb:

- use slash commands for exact, repetitive founder actions
- use natural language for day-to-day control
- use dashboard views when you need visual decision context

---

## Quick Start Flows

### 1. Software project with existing local repo

```text
/new_client Acme Corp info@acme.com
/new_project acme-corp "Client Portal" app
/link_repo acme-corp/client-portal "/home/rnebili/Repos/Acme Client Portal" main
/brief acme-corp/client-portal Portale clienti con login, dashboard, documenti e ticket.
/task acme-corp/client-portal Progetta e implementa la piattaforma
```

### 2. Software project with remote repo to auto-clone

```text
/new_project acme-corp collab-drawing app
/link_repo acme-corp/collab-drawing https://github.com/org/repo.git main
/brief acme-corp/collab-drawing Lavagna collaborativa real-time con autenticazione e stanze.
/task acme-corp/collab-drawing Progetta e implementa la piattaforma
```

Effect:

- WAI clones the repo into `workspace/<client>/<project>/repo`
- repo metadata is saved on the project
- downstream software workers receive repo context automatically

### 3. Software project without repo yet

```text
/new_project acme-corp internal-automation automation
/init_repo acme-corp/internal-automation main
/brief acme-corp/internal-automation Sistema interno per orchestrare task, CRM e automazioni.
/task acme-corp/internal-automation Disegna l'architettura e implementa il primo increment
```

### 4. Non-code project

```text
/new_project acme-corp q2-campaign marketing
/brief acme-corp/q2-campaign Campagna Q2 con focus lead generation B2B.
/task acme-corp/q2-campaign Crea piano marketing, content package e calendario social
```

### 5. Personal assistant usage

Use `Assistant HQ` when you want:

- latest email
- today agenda
- recent Drive files
- daily founder brief
- founder automation on/off control

---

## Founder Command Index

| Command | Purpose | Example |
|---------|---------|---------|
| `/start` | Show founder help and examples | `/start` |
| `/new_client` | Create a client and root workspace | `/new_client "Acme Corp" info@acme.com` |
| `/new_project` | Create a project under an existing client | `/new_project acme-corp "Landing Page" website` |
| `/link_repo` | Link a local repo or auto-clone a remote repo into workspace | `/link_repo acme-corp/landing-page https://github.com/org/repo.git main` |
| `/init_repo` | Initialize the canonical workspace repo | `/init_repo acme-corp/landing-page main` |
| `/brief` | Write or replace `brief.md` | `/brief acme-corp/landing-page Landing page B2B con CTA demo.` |
| `/task` | Launch work through CEO routing | `/task acme-corp/landing-page Progetta e implementa la landing` |
| `/clients` | List clients | `/clients` |
| `/projects` | List projects globally or for one client | `/projects acme-corp` |
| `/status` | Executive system status snapshot | `/status` |
| `/logs` | Show recent events | `/logs` |
| `/budget` | Show API cost snapshot | `/budget` |
| `/assign_model` | Override model for one agent | `/assign_model qa gemini-2.5-flash` |
| `/invoice` | Mark a project as invoiced | `/invoice acme-corp/landing-page 2500` |
| `/mark_paid` | Register money actually received | `/mark_paid acme-corp/landing-page 500` |
| `/retry` | Unblock and relaunch a blocked task | `/retry abc12345 Dipendenza risolta` |
| `/approve` | Approve a task output | `/approve abc12345` |
| `/reject` | Cancel or reject a task output | `/reject abc12345 Non serve più` |

---

## Natural Language Quick Reference

These intents map to the same founder operations as the slash commands.

### Business examples

```text
Crea un cliente chiamato Acme Corp con email info@acme.com
Crea un progetto website per acme-corp chiamato Landing Page
Aggiorna il brief di acme-corp/landing-page: landing page B2B con CTA demo e sezione pricing
Lancia il lavoro per acme-corp/landing-page e costruisci il sito completo
Fammi vedere i progetti di acme-corp
Come stiamo messi oggi?
```

### Recovery and revenue examples

```text
Sblocca la task abc12345 e rilanciala
Approva la task abc12345
Cancella la task abc12345 perché non serve più
Fattura acme-corp/landing-page per 2500
Segna pagato acme-corp/landing-page 400
```

### Personal assistant examples

```text
Leggi l'ultima email ricevuta
Mostrami l'agenda di oggi
Mostrami i file recenti su Google Drive
Genera il daily founder brief di oggi
Fai uno screenshot di https://ansa.it
```

If the request is unambiguous, WAI executes directly. If a required identifier is missing or ambiguous, WAI asks one focused question.

---

## Visual QA & Screenshots

WAI can "see" live websites using a headless browser (Playwright).

### 1. Automatic Visual QA
When the **QA Agent** approves a software delivery that includes a `deployUrl` (e.g., via Vercel or Netlify), it automatically:
- Navigates to the live URL.
- Captures a screenshot of the homepage.
- Saves it as `screenshot.png` in the project's `deliverables/` folder.
- Embeds the image directly into the `qa_report.md`.

### 2. Manual Screenshots (On-Demand)
You can ask WAI to take a screenshot of any public URL at any time via Telegram.

**Natural Language examples:**
- *"Fai uno screenshot di google.it"*
- *"Snapshot di https://github.com"*
- *"Fammi vedere come appare il sito ansa.it"*

**Outcome:**
- WAI captures the image.
- Sends the image file directly to you on Telegram.
- Saves the file in your personal workspace: `workspace/personal/neb/output/screenshot.png`.

---

## Detailed Founder Reference

### `/new_client`

Creates a new client and its workspace root.

```text
/new_client "Acme Corp" info@acme.com
/new_client Acme Corp
```

Behavior:

- creates the client in Supabase
- creates `workspace/<client-slug>/`

Natural language equivalents:

```text
Crea un cliente chiamato Acme Corp
Crea il cliente Acme Corp con email info@acme.com
```

### `/new_project`

Creates a project under an existing client.

```text
/new_project acme-corp "Landing Page" website
/new_project acme-corp client-portal app
```

Behavior:

- creates the project in Supabase
- creates `workspace/<client-slug>/<project-slug>/`
- creates `brief.md`, `PROGRESS.md`, `deliverables/`, `assets/`, `drafts/`

Supported project types:

- `website`
- `app`
- `saas`
- `consulting`
- `ai`
- `marketing`
- `content`
- `copywriting`
- `design`
- `automation`
- `other`

### `/link_repo`

Links a repo to a software project.

Mode 1: link an existing local git repo

```text
/link_repo acme-corp/client-portal "/home/rnebili/client portal repo" main
/link_repo acme-corp/client-portal "/home/rnebili/client portal repo" https://github.com/org/repo.git
/link_repo acme-corp/client-portal "/home/rnebili/client portal repo" main https://github.com/org/repo.git
```

Mode 2: auto-clone a remote repo into the project workspace

```text
/link_repo acme-corp/client-portal https://github.com/org/repo.git
/link_repo acme-corp/client-portal https://github.com/org/repo.git main
```

Behavior:

- supports absolute paths with spaces if quoted
- verifies the path exists
- verifies the path is a real git repo when local
- clones into `workspace/<client>/<project>/repo` when remote
- saves `repo_local_path`, `repo_url`, `repo_default_branch`, `repo_provider`

Note:

- `/link_repo` remains the canonical exact interface for repo onboarding

### `/init_repo`

Initializes an empty git repo inside the canonical project workspace.

```text
/init_repo acme-corp/client-portal
/init_repo acme-corp/client-portal main
/init_repo acme-corp/client-portal https://github.com/org/repo.git main
```

Behavior:

- creates `workspace/<client>/<project>/repo` if missing
- runs `git init`
- optionally sets the default branch
- optionally registers `origin`
- refuses to initialize over non-empty existing directories

### `/brief`

Writes or replaces the project brief.

```text
/brief acme-corp/client-portal Portale B2B con login, dashboard, upload documenti e ticketing.
```

Behavior:

- writes `workspace/<client>/<project>/brief.md`
- gives agents concrete delivery context

Natural language equivalents:

```text
Aggiorna il brief di acme-corp/client-portal: Portale B2B con login, dashboard e ticketing.
Scrivi nel brief di acme-corp/q2-campaign una campagna Q2 orientata alla lead generation.
```

### `/task`

Creates a task and routes it to the CEO agent.

```text
/task acme-corp/client-portal Progetta e implementa la piattaforma
/task acme-corp/q2-campaign Crea piano marketing e asset di contenuto
/task Build a new internal reporting flow
```

Behavior:

- creates the task in Supabase
- assigns it to `ceo`
- triggers the appropriate runtime chain
- injects project and repo metadata automatically when scoped to a project

For software and SaaS projects with `repo_local_path`, downstream workers now:

- inspect the real repo
- apply safe targeted file edits inside the repo
- run defensive `install`, `typecheck`, `build`, and `test` commands when applicable
- save both the normal implementation artifact and a `repo-execution-*.md` summary

### `/clients` and `/projects`

Inspection commands.

```text
/clients
/projects
/projects acme-corp
```

Natural language equivalents:

```text
Mostrami i clienti
Fammi vedere i progetti di acme-corp
```

### `/status`, `/logs`, `/budget`

Operational monitoring commands.

```text
/status
/logs
/budget
```

`/status` returns a compact executive snapshot with:

- current milestone
- active tasks
- blocked tasks
- monthly invoiced revenue
- monthly paid revenue
- recent errors
- problematic agents

Natural language support currently exists for:

```text
Come stiamo messi oggi?
```

### `/assign_model`

Overrides the current model for one agent.

```text
/assign_model qa gemini-2.5-flash
/assign_model architect gpt-5.4
```

Use this when:

- one runtime needs a cheaper or faster model temporarily
- you want a higher-quality model for a critical flow
- you are debugging routing or cost issues

### `/invoice`

Moves a project to `invoiced` status and records billed revenue.

```text
/invoice acme-corp/client-portal
/invoice acme-corp/client-portal 2500
/invoice acme-corp/client-portal 1499.99
```

Behavior:

- validates the project exists and is in an invoiceable state
- moves project status to `invoiced`
- optionally sets `contract_value_usd`
- fires a `revenue_recorded` event in Supabase

Important:

- `/invoice` means **fatturato**
- cash actually received is tracked separately with `/mark_paid`

Natural language equivalents:

```text
Fattura acme-corp/client-portal per 2500
Segna come fatturato acme-corp/client-portal 1499.99
```

### `/mark_paid`

Records money actually received from an already invoiced project.

```text
/mark_paid acme-corp/client-portal 500
/mark_paid acme-corp/client-portal 2500
```

Behavior:

- validates the project exists and is already `invoiced`
- inserts a row in `payments`
- supports partial payments across multiple commands
- fires a `payment_received` event in Supabase

Natural language equivalents:

```text
Segna pagato acme-corp/client-portal 500
Abbiamo incassato 2500 su acme-corp/client-portal
```

### `/retry`, `/approve`, `/reject`

Used after human review gates or when a task has entered `blocked`.

```text
/retry <task_id> [reason]
/approve <task_id>
/reject <task_id> Serve una revisione più forte del flusso onboarding
```

Behavior:

- `/retry` is the canonical founder unblock command
- valid only for tasks currently in `blocked`
- records a `task_unblocked` event
- re-queues the task and relaunches the original assignee runtime when dependencies are clear
- `/reject` cancels the task; it does not "unblock and continue"

Operational notes:

- `task_id` can be a full UUID or a unique short prefix from Telegram or dashboard
- founder task actions are shared across Telegram direct commands, CEO natural-language handling, and dashboard founder controls

---

## Founder Ops Dashboard

Use **Founder Ops** in the dashboard when you want a decision queue instead of chat.

Main sections:

- **Blocked Tasks** → `Retry` or `Cancel`
- **Pending Review** → `Approve` or `Reject`
- **Invoice Queue** → invoice ready projects
- **Outstanding Payments** → see what is still unpaid

What it is good for:

- reviewing blocked tasks
- approving or rejecting tasks that require human judgment
- invoicing delivered projects
- monitoring outstanding balances

What it shows:

- blocked tasks with `Retry` and `Cancel`
- tasks awaiting founder decision with `Approve` and `Reject`
- projects ready to invoice
- invoiced projects with outstanding balance
- recent founder decisions

---

## Assistant HQ

`Assistant HQ` is the control surface for Neb’s personal mode.

### What is already live

- profile and identity context
- Google Workspace MCP status
- quick actions for founder-side Gmail, Calendar, and Drive workflows
- recent personal documents
- automation control for the daily founder brief

### Quick actions

Available quick actions today:

- `Latest Email`
- `Today Agenda`
- `Recent Drive Files`
- `Daily Founder Brief`

These actions run through the same founder routing path as Telegram, so behavior stays aligned.

### Automation control

Current automation live:

- `Daily Founder Brief`

Rules:

- it is **disabled by default**
- when disabled, it does **not** auto-run
- you can enable or disable it from the panel at any time
- `Run now` stays available even when automation is off

This is intentional so Neb can control cost, noise, and cadence.

---

## Gmail / Calendar / Drive Requirements

To use the personal assistant properly, Google Workspace MCP must be connected.

Setup guide:

- [MCP_SETUP.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/MCP_SETUP.md)

When the runtime is connected, WAI can:

- read Gmail
- read today’s calendar
- search Drive files
- read Drive file contents
- generate founder briefings based on real live data

---

## What Happens After `/task`

### SaaS

`CEO → PM SaaS → Dev Lead SaaS → Dev SaaS → project: review` + `/invoice` prompt

### Consulting

`CEO → Consulting Lead → project: delivered`

or

`CEO → Consulting Lead → Analyst → project: delivered`

### Marketing

`CEO → Marketing Strategist → Content Creator + Social Manager → project: review` + `/invoice` prompt

### Custom Software

`CEO → Architect → dev_general_1/dev_general_2 → QA → project: delivered/blocked/review`

Important software behavior:

- repo context linked with `/link_repo` or `/init_repo` is propagated automatically
- on a brand new empty repo, `dev_general_1` gets bootstrap work first
- if bootstrap fails, dependent workers can be auto-blocked and QA still closes the flow explicitly

Typical software artifacts:

- `deliverables/architecture_plan.md`
- `deliverables/dev-general-*.md`
- `deliverables/repo-execution-*.md`
- `deliverables/qa_report.md`

---

## Where Outputs Go

### Business outputs

- project deliverables and repo outputs live under `workspace/<client>/<project>/`

### Personal outputs

- founder documents and briefs live under `workspace/personal/neb/output/`

Important current example:

- `daily-founder-brief-YYYY-MM-DD.md`

---

## Rules of Thumb

1. If the work belongs to a client, always use a client/project flow.
2. If the work belongs only to Neb, use personal mode.
3. Use slash commands when precision matters.
4. Use natural language when speed matters.
5. Use dashboard views when you need decision context, not just execution.
6. Keep founder automations disabled unless they create clear value every day.
7. For code projects, inspect `repo-execution-*.md` and `qa_report.md`, not only the final deliverable.

---

## Related Docs

- [INDEX.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/INDEX.md)
- [PROJECT_TRACKING.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/PROJECT_TRACKING.md)
- [MCP_SETUP.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/MCP_SETUP.md)
