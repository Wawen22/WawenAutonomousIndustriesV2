# WAI Founder Operations Playbook

This document is the practical command guide for Neb. It explains the current founder-facing workflow end to end, with concrete Telegram examples.

---

## Core Principle

WAI is a multi-service AI company. Not every project needs a repo, but every project should follow a clear intake flow:

1. Create the client
2. Create the project
3. Link or initialize the repo only if the project needs code
4. Write the brief
5. Launch the task
6. Review outputs, deliverables, and status

Deploy is intentionally **not** part of this playbook. Production rollout remains a final-stage activity.

---

## Quick Start Flows

### Flow A: Software project with existing local repo

```text
/new_client Acme Corp info@acme.com
/new_project acme-corp "Client Portal" app
/link_repo acme-corp/client-portal "/home/rnebili/Repos/Acme Client Portal" main
/brief acme-corp/client-portal Portale clienti con login, dashboard, documenti e ticket.
/task acme-corp/client-portal Progetta e implementa la piattaforma
```

### Flow B: Software project with remote repo to auto-clone

```text
/new_project acmecorp collab-drawing app
/link_repo acmecorp/collab-drawing https://github.com/Wawen22/collab-air-drawing-app main
/brief acmecorp/collab-drawing Lavagna collaborativa real-time con autenticazione e condivisione stanze.
/task acmecorp/collab-drawing Progetta e implementa la piattaforma
```

Effect:
- WAI clones the repo into `workspace/acmecorp/collab-drawing/repo`
- WAI saves repo metadata into the project record
- Agent tasks receive repo context automatically
- Software workers can now read and modify the linked repo, then save a `repo-execution-*.md` report alongside the normal deliverables

### Flow C: Software project with empty local repo

```text
/new_project acmecorp internal-automation automation
/init_repo acmecorp/internal-automation main
/brief acmecorp/internal-automation Sistema interno per orchestrare task, CRM e automazioni.
/task acmecorp/internal-automation Disegna l'architettura e implementa il primo increment
```

### Flow D: Non-code project

```text
/new_project acmecorp q2-campaign marketing
/brief acmecorp/q2-campaign Campagna Q2 con focus lead generation B2B e contenuti founder-led.
/task acmecorp/q2-campaign Crea piano marketing, content package e calendario social
```

No repo is required for consulting, marketing, content, copywriting, design, or strategy-only work.

---

## Command Reference

### `/new_client`

Creates a new client and its workspace root.

```text
/new_client "Acme Corp" info@acme.com
/new_client Acme Corp
```

Behavior:
- Creates the client in Supabase
- Creates `workspace/<client-slug>/`

### `/new_project`

Creates a project under an existing client.

```text
/new_project acme-corp "Landing Page" website
/new_project acmecorp collab-drawing app
```

Behavior:
- Creates the project in Supabase
- Creates `workspace/<client-slug>/<project-slug>/`
- Creates `brief.md`, `PROGRESS.md`, `deliverables/`, `assets/`, `drafts/`

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

Links a repo to a project. It supports two modes.

#### Mode 1: Link an existing local git repo

```text
/link_repo acmecorp/client-portal "/home/rnebili/client portal repo" main
/link_repo acmecorp/client-portal "/home/rnebili/client portal repo" https://github.com/org/repo.git
/link_repo acmecorp/client-portal "/home/rnebili/client portal repo" main https://github.com/org/repo.git
```

Behavior:
- Supports absolute paths with spaces if quoted
- Verifies the path exists
- Verifies the path is a real git repo
- Normalizes the saved path to the repo root
- Infers branch and remote when possible

#### Mode 2: Auto-clone a remote repo into the project workspace

```text
/link_repo acmecorp/client-portal https://github.com/org/repo.git
/link_repo acmecorp/client-portal https://github.com/org/repo.git main
```

Behavior:
- Clones into `workspace/<client>/<project>/repo`
- Creates missing directories automatically
- Refuses to overwrite non-empty non-git directories
- Reuses an existing workspace checkout if already present and coherent

Saved project fields:
- `repo_local_path`
- `repo_url`
- `repo_default_branch`
- `repo_provider`

### `/init_repo`

Initializes an empty git repo inside the canonical project workspace repo path.

```text
/init_repo acmecorp/client-portal
/init_repo acmecorp/client-portal main
/init_repo acmecorp/client-portal https://github.com/org/repo.git main
```

Behavior:
- Creates `workspace/<client>/<project>/repo` if missing
- Runs `git init`
- Optionally sets the default branch
- Optionally registers `origin`
- Refuses to initialize over non-empty existing directories

### `/brief`

Writes or replaces the project brief.

```text
/brief acmecorp/client-portal Portale B2B con login, dashboard, upload documenti e ticketing.
```

Behavior:
- Writes `workspace/<client>/<project>/brief.md`
- Gives agents concrete delivery context

### `/task`

Creates a task and routes it to the CEO agent. If scoped to a project, the project and repo metadata are injected automatically.

```text
/task acmecorp/client-portal Progetta e implementa la piattaforma
/task acmecorp/q2-campaign Crea piano marketing e asset di contenuto
/task Build a new internal reporting flow
```

Behavior:
- Creates the task in Supabase
- Assigns it to `ceo`
- Triggers the appropriate runtime chain

For software/SaaS projects with `repo_local_path`, the downstream workers now:
- inspect the real repo
- apply safe targeted file edits inside the repo
- run defensive `install` / `typecheck` / `build` / `test` commands only when applicable
- save both the normal implementation artifact and a `repo-execution-*.md` summary

### `/invoice`

Moves a project to `invoiced` status and records revenue. Can be used once a project reaches `delivered`, `review`, `blocked`, or `active`.

```text
/invoice acmecorp/client-portal
/invoice acmecorp/client-portal 2500
/invoice acmecorp/client-portal 1499.99
```

Behavior:
- Validates the project exists and is in an invoiceable state
- Moves project status to `invoiced`
- Optionally sets `contract_value_usd` (if amount provided; otherwise keeps existing value)
- Fires a `revenue_recorded` event in Supabase
- Confirms to Neb with client, project, and final contract value

When to use:
- After QA marks a software project `delivered` — notification includes `/invoice` prompt
- After consulting_lead (or analyst) completes a consulting delivery — notification includes `/invoice` prompt
- After all SaaS workers finish and project moves to `review` — notification includes `/invoice` prompt
- After all marketing workers finish and project moves to `review` — notification includes `/invoice` prompt

All four delivery chains now send the `/invoice` prompt automatically. Neb just needs to confirm the amount and send the command.

### `/approve` and `/reject`

Used after human review gates.

```text
/approve <task_id>
/reject <task_id> Serve una revisione più forte del flusso onboarding
```

### `/clients` and `/projects`

Inspection commands.

```text
/clients
/projects
/projects acmecorp
```

### `/status`, `/logs`, `/budget`

Operational monitoring commands.

```text
/status
/logs
/budget
```

---

## What Happens After `/task`

### SaaS

`CEO → PM SaaS → Dev Lead SaaS → Dev SaaS → project: review` + `/invoice` prompt to Neb

### Consulting

`CEO → Consulting Lead → project: delivered` (if no analysis needed, `/invoice` prompt)

`CEO → Consulting Lead → Analyst → project: delivered` (if analysis requested, `/invoice` prompt after analyst)

### Marketing

`CEO → Marketing Strategist → Content Creator + Social Manager → project: review` + `/invoice` prompt to Neb

### Custom Software

`CEO → Architect → dev_general_1/dev_general_2 → QA → project: delivered/blocked/review`

When QA sets project to `delivered`, the notification includes a `/invoice` shortcut.

**All four chains send the `/invoice` prompt automatically at completion.**

For software projects, the repo context linked with `/link_repo` or `/init_repo` is propagated into the runtime chain automatically.

Important behavior on a brand new empty repo:
- `dev_general_1` gets the bootstrap/foundation work first
- `dev_general_2` may remain queued until the bootstrap task is terminal
- if bootstrap fails or times out, the dependent worker is auto-blocked and QA still closes the flow with an explicit project status

Expected artifacts after a healthy software run:
- `deliverables/architecture_plan.md`
- `deliverables/dev-general-*.md`
- `deliverables/repo-execution-*.md`
- `deliverables/qa_report.md`

Typical QA behavior with a linked repo:
- if applicable checks fail, the project can move to `blocked`
- if checks pass but warnings remain, the project stays in `review`
- if checks pass and no blocking issue remains, the project can move to `delivered`

---

## Practical Notes

- Quote absolute paths when they contain spaces.
- `/link_repo` is the fastest path when the repo already exists or when you want auto-clone from GitHub/GitLab.
- `/init_repo` is the clean path when the project should start from an empty local repo.
- `brief.md` should be written before the main `/task` whenever the project needs structured execution.
- The dashboard project panel mirrors this same flow and shows repo context when a project is selected.
- For code projects, verify not only `architecture_plan.md` and worker briefs, but also `repo-execution-*.md` and `qa_report.md` to understand exactly which files changed and which checks ran.

---

## Canonical Example For This Session

```text
/new_project acmecorp collab-drawing app
/link_repo acmecorp/collab-drawing https://github.com/Wawen22/collab-air-drawing-app main
/brief acmecorp/collab-drawing Lavagna collaborativa con stanze condivise, autenticazione e salvataggio stato.
/task acmecorp/collab-drawing Progetta e implementa la piattaforma
```
