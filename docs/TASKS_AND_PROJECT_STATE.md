# Tasks and Project State

## Task Lifecycle

```
todo → in_progress → done
           │
           ↓
         blocked → in_progress (after unblocking)
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
| `blocked` | Cannot proceed, awaiting something |
| `cancelled` | Abandoned, will not be completed |

### Priorities

| Value | Meaning |
|-------|---------|
| 1 | Critical – do now |
| 2 | High – do today |
| 3 | Normal – this sprint |
| 4 | Low – when capacity allows |
| 5 | Backlog – maybe someday |

---

## Task Naming Conventions

Format: `[TEAM] Short imperative description`

Examples:
- `[DEV] Implement Supabase schema migrations`
- `[MARKETING] Write launch blog post for SaaS v1`
- `[OPS] Set up daily cost reporting cron`
- `[CEO] Plan Q1 roadmap for SaaS team`

---

## Subtask Hierarchy

Tasks can have subtasks via `parent_task_id`. Max recommended depth: 3 levels.

```
[CEO] Launch SaaS v1 (priority: 1)
├── [DEV] Build auth module (priority: 1)
│   ├── [DEV] Implement Supabase auth
│   └── [DEV] Write auth tests
├── [MARKETING] Create launch page (priority: 2)
└── [OPS] Set up production deploy (priority: 1)

[CEO] Launch AI consulting offer (priority: 1)
├── [STRATEGY] Build offer positioning and campaign plan
│   ├── [CONTENT] Draft lead magnet / newsletter / page copy
│   └── [MARKETING] Build social distribution calendar
└── [CONSULTING] Produce proposal and analysis
```

---

## How Claude/Agents Must Handle Tasks

### On receiving a new request from Neb:

1. Search `docs/PROJECT_TRACKING.md` and `tasks` table for existing related task
2. If found: update status to `in_progress`
3. If not found: create new task entry in both `PROJECT_TRACKING.md` AND insert into Supabase

### During work:

- Log progress to `runs` table after each meaningful step
- Log events to `events` table for major milestones
- Update `tasks.status` as work progresses

### After completing:

- Set `tasks.status = 'done'`, set `tasks.completed_at = now()`
- Insert completion event to `events`
- Update `docs/PROJECT_TRACKING.md`
- If `requires_human_review = true`: send Telegram notification to Neb

---

## Milestones

Milestones represent major project phases. Tracked in `project_state.current_milestone` and in `PROJECT_TRACKING.md`.

Deployment is intentionally deferred until the last functional gate. The canonical roadmap lives in `docs/PROJECT_TRACKING.md`; if this file and the DB snapshot diverge, `PROJECT_TRACKING.md` is the source of truth for planning.

| ID | Milestone | Target | Status |
|----|-----------|--------|--------|
| M1 | Local development stack running | 2026-Q1 | done |
| M2 | CEO Agent esegue primo task autonomo | 2026-Q1 | done |
| M3 | WAI Dashboard live con dati real-time | 2026-Q1 | done |
| M4 | Client & Project Management System | 2026-Q2 | done |
| M5 | First autonomous deliverable for a real client | 2026-Q2 | done |
| M6 | Deploy to Hetzner VPS | 2026-Q2 | deferred (final infrastructure step) |
| M7 | First revenue-generating output | 2026-Q3 | in_progress |
| M8 | Migrate to personal mini PC | 2026-Q3 | todo |

---

## Project State Snapshot

The `project_state` table holds a live snapshot. Additionally, `docs/PROJECT_TRACKING.md` holds a human-readable version updated by agents after each significant change.

### Update Frequency

- `project_state` table: updated by Finance and Ops agents automatically
- `PROJECT_TRACKING.md`: updated by Claude Code / agents after each task completion
