# WAI Founder Guide

> This is the canonical founder manual for WAI.
> The older, longer version was archived to [archive/FOUNDER_PLAYBOOK_ARCHIVE_2026-03-19.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/archive/FOUNDER_PLAYBOOK_ARCHIVE_2026-03-19.md).

---

## What WAI Is For

WAI gives Neb two operating modes:

- **Business OS** for clients, projects, briefs, delivery, invoicing, and task recovery
- **Personal Assistant** for email, calendar, Drive, briefs, personal docs, and founder automations

The core rule is simple:

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

---

## Quick Start Flows

### 1. Software project with repo

```text
/new_client Acme Corp info@acme.com
/new_project acme-corp "Client Portal" app
/link_repo acme-corp/client-portal https://github.com/org/repo.git main
/brief acme-corp/client-portal Portale clienti con login, dashboard, documenti e ticket.
/task acme-corp/client-portal Progetta e implementa la piattaforma
```

### 2. Software project without repo yet

```text
/new_project acme-corp internal-automation automation
/init_repo acme-corp/internal-automation main
/brief acme-corp/internal-automation Sistema interno per orchestrare task, CRM e automazioni.
/task acme-corp/internal-automation Disegna l'architettura e implementa il primo increment
```

### 3. Non-code project

```text
/new_project acme-corp q2-campaign marketing
/brief acme-corp/q2-campaign Campagna Q2 con focus lead generation B2B.
/task acme-corp/q2-campaign Crea piano marketing, content package e calendario social
```

### 4. Personal assistant usage

Use `Assistant HQ` when you want:

- latest email
- today agenda
- recent Drive files
- daily founder brief
- founder automation on/off control

---

## Business OS Commands

### Clients and projects

| Action | Command |
|--------|---------|
| Create client | `/new_client "Acme Corp" info@acme.com` |
| Create project | `/new_project acme-corp "Landing Page" website` |
| List clients | `/clients` |
| List projects | `/projects acme-corp` |

### Repo and brief

| Action | Command |
|--------|---------|
| Link repo | `/link_repo acme-corp/landing-page https://github.com/org/repo.git main` |
| Init empty repo | `/init_repo acme-corp/landing-page main` |
| Write brief | `/brief acme-corp/landing-page Landing page B2B con CTA demo.` |

### Delivery and control

| Action | Command |
|--------|---------|
| Launch work | `/task acme-corp/landing-page Progetta e implementa la landing` |
| Status | `/status` |
| Logs | `/logs` |
| Budget | `/budget` |
| Assign model override | `/assign_model qa gemini-2.5-flash` |

### Founder decisions and revenue

| Action | Command |
|--------|---------|
| Retry blocked task | `/retry abc12345` |
| Approve task | `/approve abc12345` |
| Reject task | `/reject abc12345 Non serve più` |
| Invoice project | `/invoice acme-corp/landing-page 2500` |
| Mark payment received | `/mark_paid acme-corp/landing-page 500` |

---

## Natural Language Examples

WAI supports natural language for the same founder operations.

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
```

---

## Founder Ops View

Use **Founder Ops** in the dashboard when you want a decision queue instead of chat.

What it is good for:

- reviewing blocked tasks
- approving or rejecting tasks that require human judgment
- invoicing delivered projects
- monitoring outstanding balances

Main sections:

- **Blocked Tasks** → `Retry` or `Cancel`
- **Pending Review** → `Approve` or `Reject`
- **Invoice Queue** → invoice ready projects
- **Outstanding Payments** → see what is still unpaid

---

## Assistant HQ

`Assistant HQ` is the control surface for Neb’s personal mode.

### What is already live

- profile and identity context
- Google Workspace MCP status
- quick actions for founder-side Gmail / Calendar / Drive workflows
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

This is intentional so Neb can control cost, noise, and daily cadence.

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

---

## Related Docs

- [INDEX.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/INDEX.md)
- [PROJECT_TRACKING.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/PROJECT_TRACKING.md)
- [MCP_SETUP.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/MCP_SETUP.md)
