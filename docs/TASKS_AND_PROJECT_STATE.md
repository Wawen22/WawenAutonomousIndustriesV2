# Tasks and Project State

## Task Lifecycle

```
todo → in_progress → done
           │
           ↓
         blocked ──→ in_progress (after founder retry)
           │
           ↓
         cancelled
```

### States

| State | Meaning |
|-------|---------|
| `todo` | Created, not yet started |
| `in_progress` | Agent is actively working on it |
| `done` | Completed, output available |
| `blocked` | Cannot proceed — awaiting founder action or dependency |
| `cancelled` | Abandoned, will not be completed |

### Dependency-aware Software Tasks

Software worker tasks may carry `dependency_task_ids` in metadata.

- No dependency → worker can start immediately (may run in parallel)
- Dependencies still open → worker remains `todo` (queued)
- All dependencies reach `done` → worker auto-starts
- Any dependency reaches `blocked` → worker is auto-marked `blocked` (chain closes cleanly via QA)

### Founder Recovery of Blocked Tasks

Blocked tasks are not terminal dead ends.

| Action | How | Effect |
|--------|-----|--------|
| Retry | `/retry <task_id>`, NL, Dashboard | task → `todo`, agent relaunched |
| Cancel | `/reject <task_id>`, Dashboard | task → `cancelled` |
| Approve | `/approve <task_id>`, NL, Dashboard | task → `done` (Pending Review) |

- Retry is refused if the task still depends on another blocked task
- Approve is for tasks in `Pending Review` (e.g., QA blocked with `requires_human_review`)
- Task references can be a full UUID or a unique short prefix (e.g., `abc12345`)

---

## Task Priorities

| Value | Meaning |
|-------|---------|
| 1 | Critical — do now |
| 2 | High — do today |
| 3 | Normal — this sprint |
| 4 | Low — when capacity allows |
| 5 | Backlog — maybe someday |

---

## Subtask Hierarchy

Tasks can have subtasks via `parent_task_id`. Max recommended depth: 3 levels.

```
[CEO] Deliver client portal (priority: 1)
├── [ARCHITECT] Define architecture
│   ├── [DEV] Implement core (dev_general_1)
│   ├── [DEV] Implement secondary (dev_general_2)
│   └── [QA] QA review gate
└── ...
```

**One task per project rule:** The CEO Intake NL interface creates exactly ONE task per project to avoid multiple Architect agents running in parallel and colliding on the same repository.

---

## Project Delivery States

```
discovery → active → review ──────→ delivered → invoiced
                   └→ blocked ─────────────↑
```

| State | Meaning |
|-------|---------|
| `discovery` | Briefing, intake, planning only |
| `active` | Delivery execution in progress |
| `review` | QA gate running, or output ready for human inspection |
| `blocked` | Severe QA issues stop release — founder decision required |
| `delivered` | QA passed, ready for client handoff |
| `invoiced` | Revenue billed via `/invoice` |

### Who sets which state

| State | Set by |
|-------|--------|
| `active` | Architect / team leads (when workers start) |
| `review` | Dev SaaS workers / Marketing workers (at completion) |
| `blocked` | QA agent (blocking issues found) |
| `delivered` | QA agent (pass) / Consulting Lead / Analyst |
| `invoiced` | Founder via `/invoice` or NL or Dashboard |

---

## Revenue Flow

Revenue is tracked in two separate signals:

1. **Invoiced**: `/invoice client/project [amount]` → `project.status = invoiced`, `contract_value_usd` set, `revenue_recorded` event
2. **Paid**: `/mark_paid client/project amount` → row inserted in `payments`, `payment_received` event

The Dashboard **Revenue** view shows invoiced vs paid vs outstanding balance.

Partial payments are supported via multiple `/mark_paid` calls.

---

## Chains → Final Status

| Chain | Final project status |
|-------|---------------------|
| Custom Software (QA pass) | `delivered` → founder `/invoice` |
| Custom Software (QA issues) | `blocked` → founder Approve/Reject |
| Consulting | `delivered` → auto `/invoice` prompt |
| Marketing | `review` → auto `/invoice` prompt |
| SaaS | `review` → auto `/invoice` prompt |

All four chains send an `/invoice` shortcut notification to Neb at completion.

---

## Milestones

| ID | Milestone | Status |
|----|-----------|--------|
| M1 | Local development stack running | ✅ Done |
| M2 | CEO Agent — first autonomous task | ✅ Done |
| M3 | Dashboard live with real-time data | ✅ Done |
| M4 | Client & Project Management System | ✅ Done |
| M5 | First autonomous deliverable | ✅ Done |
| M6 | Deploy to Hetzner VPS | ⏸ Deferred (final infra step) |
| M7 | First revenue-generating output | ✅ Done — Wawen22 LandingPage $222 |
| M8 | Migrate to personal mini PC | ⬜ Todo |

---

## How Claude/Agents Must Handle Tasks

### On receiving a new request from Neb

1. Check `docs/PROJECT_TRACKING.md` and Supabase `tasks` for an existing related task
2. If found: note its ID, update status to `in_progress`
3. If not found: create new task in `PROJECT_TRACKING.md` AND insert into Supabase

### During work

- Log progress to `runs` table after each meaningful step
- Log events to `events` table for major milestones
- Update `tasks.status` as work progresses

### After completing

- Set `tasks.status = 'done'`, `tasks.completed_at = now()`
- Insert completion event to `events`
- Update `docs/PROJECT_TRACKING.md` (status + changelog entry)
- If `requires_human_review = true`: Telegram notification to Neb already sent by the agent

---

## Project Onboarding Sequence

For projects managed from Telegram, the recommended order is:

```text
/new_client "Client Name" email@client.com
  → /new_project client-slug "Project Name" type
    → /link_repo or /init_repo   (only if code is involved)
    → /brief client/project Brief text here
    → /task client/project Descrizione del lavoro
```

Non-code projects (consulting, marketing, content) skip the repo step entirely.
