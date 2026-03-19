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

## Complete Founder Interface Reference

Founder operations now have two equivalent entry points:

- **Slash commands** when you want deterministic syntax and copy-paste precision.
- **Natural language** when you want to talk to WAI normally on Telegram.
- **Founder Ops dashboard view** when you want a decision queue for blocked tasks, invoice candidates, and outstanding payments.

Rule of thumb:
- Use slash commands for repetitive exact operations or when sharing a precise instruction with someone else.
- Use natural language for day-to-day founder control, especially blocked task recovery and revenue operations.

Natural language operational actions now use the same backend services as the direct commands for:
- task retry / approve / reject
- project invoice
- payment registration
- status / client / project inspection

Dashboard founder actions now use the same shared backend services for:
- task retry / cancel
- project invoice
- payment registration

Important:
- Task references in founder actions can be either the full UUID or a unique short prefix such as `abc12345`.
- If a short ID is ambiguous, WAI asks for a longer one.
- The canonical implementation lives in `backend/src/agents/ceo_intake.ts`, `backend/src/services/founder_task_actions.ts`, and `backend/src/services/founder_revenue_actions.ts`.

### Command Index

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

### Natural Language Quick Reference

These are all supported founder intents today, with examples that map to the same operational flows as the slash commands.

| Intent | Example |
|--------|---------|
| Create client | `Crea un cliente chiamato Acme Corp con email info@acme.com` |
| Create project | `Crea un progetto website per acme-corp chiamato Landing Page` |
| Write brief | `Aggiorna il brief di acme-corp/landing-page: landing page B2B con CTA demo e sezione pricing` |
| Launch work | `Lancia il lavoro per acme-corp/landing-page e costruisci il sito completo` |
| List clients | `Mostrami i clienti` |
| List projects | `Fammi vedere i progetti di acme-corp` |
| Status | `Come stiamo messi oggi?` |
| Retry blocked task | `Sblocca la task abc12345 e rilanciala` |
| Approve task | `Approva la task abc12345` |
| Reject task | `Cancella la task abc12345 perché non serve più` |
| Invoice project | `Fattura acme-corp/landing-page per 2500` |
| Mark payment received | `Segna pagato acme-corp/landing-page 400` |

If the request is unambiguous, WAI executes directly. If a required identifier is missing or ambiguous, WAI asks one focused question.

### `/start`

Shows the founder help message on Telegram.

```text
/start
```

### Founder Ops dashboard

The dashboard has a dedicated **Founder Ops** view — the main decision panel for Neb.

---

#### Come funziona il sistema di decisioni

Il sistema distingue tre tipi di situazioni che richiedono l'intervento del founder:

---

**1. Blocked Tasks → Retry / Cancel**

Un task diventa `blocked` quando un agente non riesce a completare il suo lavoro (errore LLM, dipendenza non risolta, problema nel codice del progetto).

Il task appare nella sezione **Blocked Tasks** con due azioni:

| Azione | Cosa fa |
|--------|---------|
| **Retry** | Rilancia l'agente sullo stesso task. Il sistema controlla le dipendenze: se mancano task precedenti, il retry viene messo in coda; se tutto è pronto, l'agente parte subito. |
| **Cancel** | Cancella il task definitivamente. Il progetto non avanza. |

Quando usare Retry: quando pensi che il problema fosse temporaneo (errore API, timeout, contesto insufficiente).
Quando usare Cancel: quando il task non ha più senso o il brief è cambiato.

Comportamento automatico dopo il Retry di un task software (`dev_general_*`):
- Se il task completato sblocca tutti i dev worker, il sistema attiva **QA automaticamente** senza che Neb debba fare nulla.

---

**2. Pending Review → Approve / Reject**

Un task entra in **Pending Review** quando il sistema non può decidere da solo e ha bisogno di una decisione umana.

Quando succede:
- **QA trova problemi bloccanti** → il task QA rimane aperto con `requires_human_review = true`, progetto in stato `blocked`
- Altri task strategici creati con flag `requires_human_review` esplicito

| Azione | Cosa fa |
|--------|---------|
| **Approve** | Chiude il task come `done`. Significa: "ho letto il report, decido di procedere comunque". |
| **Reject** | Cancella il task (`cancelled`). Significa: "il lavoro non va, non procedo". |

Esempio concreto — QA blocca una LandingPage:
1. QA analizza il codice e trova problemi seri (es. CSS non funziona, layout rotto)
2. Invece di chiudersi da solo, il task QA va in Pending Review con il summary dei problemi
3. Neb legge il report QA (`deliverables/qa_report.md`) e decide:
   - **Approve** → si procede a `delivered` / fatturazione
   - **Reject** → si cancella il task QA; poi si fa Retry del dev per correggere i problemi

---

**3. Invoice Queue e Outstanding Payments**

Sezioni puramente revenue:
- **Invoice Queue**: progetti `delivered` o `review` pronti per essere fatturati
- **Outstanding Payments**: progetti `invoiced` con saldo ancora da incassare

---

What the Founder Ops view shows:
- blocked tasks with `Retry` and `Cancel`
- tasks awaiting founder decision (`Pending Review`) with `Approve` and `Reject`
- projects ready to invoice
- invoiced projects with outstanding balance
- recent founder decisions (`task_unblocked`, approvals/rejections, invoicing, payments)

What it is for:
- clearing operational bottlenecks
- reviewing QA escalations before delivery
- moving projects from delivery to invoicing
- tracking collections without switching back to Telegram

### `/new_client`

Creates a new client and its workspace root.

```text
/new_client "Acme Corp" info@acme.com
/new_client Acme Corp
```

Behavior:
- Creates the client in Supabase
- Creates `workspace/<client-slug>/`
- Natural language equivalent:
```text
Crea un cliente chiamato Acme Corp
Crea il cliente Acme Corp con email info@acme.com
```

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
- Natural language equivalent:
```text
Crea un progetto website per acme-corp chiamato Landing Page
Crea il progetto acme-corp/client-portal di tipo app
```

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

Natural language note:
- Repo linking is still best driven with the explicit slash command because of paths, branch names, and URLs.
- Natural language can describe the intent, but `/link_repo` remains the canonical exact interface for repo onboarding.

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

Natural language note:
- `/init_repo` remains the canonical exact interface for repo bootstrapping.

### `/brief`

Writes or replaces the project brief.

```text
/brief acmecorp/client-portal Portale B2B con login, dashboard, upload documenti e ticketing.
```

Behavior:
- Writes `workspace/<client>/<project>/brief.md`
- Gives agents concrete delivery context
- Natural language equivalent:
```text
Aggiorna il brief di acmecorp/client-portal: Portale B2B con login, dashboard e ticketing.
Scrivi nel brief di acmecorp/q2-campaign una campagna Q2 orientata alla lead generation.
```

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
- Natural language equivalent:
```text
Lancia il lavoro per acmecorp/client-portal e costruisci la piattaforma completa
Avvia il progetto acmecorp/q2-campaign e crea piano marketing e asset
```

For software/SaaS projects with `repo_local_path`, the downstream workers now:
- inspect the real repo
- apply safe targeted file edits inside the repo
- run defensive `install` / `typecheck` / `build` / `test` commands only when applicable
- save both the normal implementation artifact and a `repo-execution-*.md` summary

### `/invoice`

Moves a project to `invoiced` status and records billed revenue. Can be used once a project reaches `delivered`, `review`, `blocked`, or `active`.

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

Important:
- `/invoice` means **fatturato**.
- Cash actually received is tracked separately with `/mark_paid`.
- Natural language equivalent:
```text
Fattura acmecorp/client-portal per 2500
Segna come fatturato acmecorp/client-portal 1499.99
```

When to use:
- After QA marks a software project `delivered` — notification includes `/invoice` prompt
- After consulting_lead (or analyst) completes a consulting delivery — notification includes `/invoice` prompt
- After all SaaS workers finish and project moves to `review` — notification includes `/invoice` prompt
- After all marketing workers finish and project moves to `review` — notification includes `/invoice` prompt

All four delivery chains now send the `/invoice` prompt automatically. Neb just needs to confirm the amount and send the command.

### `/mark_paid`

Records money actually received from an already invoiced project.

```text
/mark_paid acmecorp/client-portal 500
/mark_paid acmecorp/client-portal 2500
```

Behavior:
- Validates the project exists and is already `invoiced`
- Inserts a row in `payments`
- Supports partial payments across multiple commands
- Fires a `payment_received` event in Supabase
- Confirms to Neb the amount received, total paid so far, and remaining outstanding balance
- Natural language equivalent:
```text
Segna pagato acmecorp/client-portal 500
Abbiamo incassato 2500 su acmecorp/client-portal
```

### `/retry`, `/approve` and `/reject`

Used after human review gates or when a task has entered `blocked`.

```text
/retry <task_id> [reason]
/approve <task_id>
/reject <task_id> Serve una revisione più forte del flusso onboarding
```

Behavior:
- `/retry` is the canonical founder unblock command
- Valid only for tasks currently in `blocked`
- Records a `task_unblocked` event
- Re-queues the task and relaunches the original assignee runtime when dependencies are clear
- If unresolved dependencies are still blocked, retry is refused with an explicit error
- `/reject` cancels the task; it does not "unblock and continue"
- Natural language equivalents:
```text
Sblocca la task abc12345 e rilanciala
Approva la task abc12345
Cancella la task abc12345 perché il brief è cambiato
```

Operational notes:
- `task_id` can be a full UUID or a unique short ID prefix from Telegram/dashboard.
- Founder task actions are now shared across Telegram direct commands, the CEO natural-language handler, and dashboard founder controls.

### `/clients` and `/projects`

Inspection commands.

```text
/clients
/projects
/projects acmecorp
```

Natural language equivalents:
```text
Mostrami i clienti
Fammi vedere i progetti di acmecorp
```

### `/status`, `/logs`, `/budget`

Operational monitoring commands.

```text
/status
/logs
/budget
```

`/status` now returns a compact executive snapshot with:
- current milestone
- active tasks
- blocked tasks
- monthly invoiced revenue
- monthly paid revenue
- recent errors
- problematic agents

Blocked tasks can now also be handled from the dashboard Task Board with founder buttons:
- `Retry`
- `Cancel`

Natural language equivalent currently supported:
```text
Come stiamo messi oggi?
```

Current scope note:
- `/status` is available in natural language.
- `/logs` and `/budget` remain explicit slash commands for now.

### `/assign_model`

Overrides the current model for one agent.

```text
/assign_model qa gemini-2.5-flash
/assign_model architect gpt-5.4
```

Use this when:
- one runtime needs a cheaper/faster model temporarily
- you want to force a higher-quality model for a critical flow
- you are debugging routing or cost issues

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

