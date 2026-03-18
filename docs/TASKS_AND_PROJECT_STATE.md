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

### Dependency-aware software tasks

Software worker tasks may carry `dependency_task_ids` in metadata.

- If there is no dependency, the worker can start immediately and may run in parallel with unrelated workers.
- If dependencies are still open, the worker remains `todo` (queued) instead of moving to `in_progress`.
- If all dependencies reach `done`, the worker is auto-started.
- If any dependency reaches `blocked`, the worker is auto-marked `blocked` so the chain does not stall indefinitely.

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

[CEO] Deliver client portal (priority: 1)
├── [ARCHITECTURE] Define delivery architecture
│   ├── [DEV] Implement core backend/integrations
│   ├── [DEV] Implement frontend/supporting flows
│   └── [SUPPORT] Run QA review gate
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

---

## Project Delivery States

For client projects, the high-level lifecycle is currently:

```
discovery → active → review → delivered → invoiced
                   └→ blocked ──────────────↑
```

### Meaning

| State | Meaning |
|-------|---------|
| `discovery` | Briefing, intake, or planning only |
| `active` | Delivery execution is in progress |
| `review` | Internal review or QA gate is running, or fixes are still needed before release |
| `blocked` | Severe issues found by QA are stopping release |
| `delivered` | Delivery package passed QA (software) or all consulting deliverables produced; ready for client handoff |
| `invoiced` | Revenue billed via `/invoice`; actual cash received is tracked separately in `payments` |

### Revenue Flow

When a project reaches `delivered` (or stays at `review`/`blocked` in some cases), the delivery chain notifies Neb with a `/invoice client/project [amount_usd]` shortcut.

Revenue is now split into two separate signals:

- **Invoiced revenue**: `/invoice` transitions the project to `invoiced`, sets `contract_value_usd`, and emits `revenue_recorded`.
- **Paid revenue**: `/mark_paid client/project amount_usd` inserts one row into `payments` and emits `payment_received`.

This allows partial payments and accurate outstanding balance tracking in the Revenue dashboard.

Chains that produce `delivered` automatically:
- **Custom Software**: QA → `delivered` (pass) / `blocked` / `review`
- **Consulting**: Consulting Lead → `delivered` (no analysis) or Analyst → `delivered` (with analysis)

Chains that end at `review` — notification includes `/invoice` prompt:
- **SaaS**: all workers done → `review` + `/invoice` prompt sent to Neb
- **Marketing**: all workers done → `review` + `/invoice` prompt sent to Neb

### Repo-aware QA Rules

If a project has `repo_local_path`, QA must evaluate both deliverables and the real repo state.

- `blocked`: at least one blocking issue exists, or an applicable `install` / `typecheck` / `build` / `test` command fails
- `review`: no blockers, but there are warnings, missing applicable checks, unclear implementation coverage, or the repo state still needs human inspection
- `delivered`: applicable checks pass, no blocking repo issue remains, and the delivery package is coherent

Typical software artifacts in this flow are:

- `architecture_plan.md`
- `dev-general-*.md` or `dev-saas-*.md`
- `repo-execution-*.md`
- `qa_report.md`

---

## Founder Project Onboarding Sequence

For projects managed from Telegram, the recommended operational order is:

```text
/new_client
→ /new_project
→ /link_repo or /init_repo (only if code is involved)
→ /brief
→ /task
```

### Notes

- `/link_repo` supports quoted absolute paths with spaces.
- `/link_repo` can also auto-clone a remote repo into `workspace/<client>/<project>/repo`.
- `/init_repo` creates an empty canonical repo in `workspace/<client>/<project>/repo` and can optionally attach `origin`.
- Non-code projects can skip the repo step entirely.
- For software projects, `/task` now produces not only markdown briefs but also repo execution reports and repo-aware QA output when a linked repo is present.
- On empty repos created with `/init_repo`, it is expected that the second software worker may stay queued until the bootstrap worker closes; this is normal orchestration, not a stall.
- The full founder command guide with examples lives in `docs/FOUNDER_OPERATIONS_PLAYBOOK.md`.
