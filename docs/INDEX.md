# WAI Knowledge Base

> This is the canonical entry point for WAI documentation.
> If a document is not linked from here, it is specialized reference material or simply not part of the canonical docs path.

---

## Start Here

| Goal | Read This First | Then |
|------|------------------|------|
| Understand what WAI is | [VISION.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/VISION.md) | [PROJECT_TRACKING.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/PROJECT_TRACKING.md) |
| See where the project stands now | [PROJECT_TRACKING.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/PROJECT_TRACKING.md) | `Recent Changes` section in the same file |
| Use WAI as founder | [FOUNDER_OPERATIONS_PLAYBOOK.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/FOUNDER_OPERATIONS_PLAYBOOK.md) | [MCP_SETUP.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/MCP_SETUP.md) |
| Understand the system architecture | [ARCHITECTURE.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/ARCHITECTURE.md) | [AGENTS_AND_TEAMS.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/AGENTS_AND_TEAMS.md) |
| Understand the next platform evolution | [CAPABILITY_PLATFORM_AND_OPENCLAW_PLAN.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/CAPABILITY_PLATFORM_AND_OPENCLAW_PLAN.md) | [ARCHITECTURE.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/ARCHITECTURE.md) |
| Operate or debug the stack | [OPERATIONS_AND_MONITORING.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/OPERATIONS_AND_MONITORING.md) | [SECURITY.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/SECURITY.md) |
| Work on DB or events | [SUPABASE_SCHEMA.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/SUPABASE_SCHEMA.md) | [TASKS_AND_PROJECT_STATE.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/TASKS_AND_PROJECT_STATE.md) |
| Configure Gmail / Calendar / Drive | [MCP_SETUP.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/MCP_SETUP.md) | [FOUNDER_OPERATIONS_PLAYBOOK.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/FOUNDER_OPERATIONS_PLAYBOOK.md) |

---

## Canonical Docs

These are the documents that should cover almost all day-to-day needs.

### 1. Product and status

- [VISION.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/VISION.md)
- [PROJECT_TRACKING.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/PROJECT_TRACKING.md)

### 2. Founder usage

- [FOUNDER_OPERATIONS_PLAYBOOK.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/FOUNDER_OPERATIONS_PLAYBOOK.md)
- [MCP_SETUP.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/MCP_SETUP.md)

### 3. Technical handbook

- [ARCHITECTURE.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/ARCHITECTURE.md)
- [CAPABILITY_PLATFORM_AND_OPENCLAW_PLAN.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/CAPABILITY_PLATFORM_AND_OPENCLAW_PLAN.md)
- [AGENTS_AND_TEAMS.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/AGENTS_AND_TEAMS.md)
- [SUPABASE_SCHEMA.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/SUPABASE_SCHEMA.md)

### 4. Operations and safety

- [OPERATIONS_AND_MONITORING.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/OPERATIONS_AND_MONITORING.md)
- [SECURITY.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/SECURITY.md)
- [COSTS_AND_BUDGET.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/COSTS_AND_BUDGET.md)

---

## Reference Docs

These are useful, but not the first files to open unless you already know the area.

- [TASKS_AND_PROJECT_STATE.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/TASKS_AND_PROJECT_STATE.md)
- [DEPLOYMENT_PLAN.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/DEPLOYMENT_PLAN.md)

---

## Documentation Rules

1. `PROJECT_TRACKING.md` is the live status file, not the full historical log.
2. Keep canonical docs short enough to stay usable, but complete enough that separate shadow docs are not needed.
3. Each topic should have one primary document only.
4. README should stay short and point here instead of duplicating half the docs tree.
5. Future `/wiki` or `/docs` in the dashboard should render this structure, not a second parallel structure.

---

## Dashboard Viewer

The dashboard docs viewer is now live as `Knowledge Base` in both Company and Personal mode.

It is intentionally grounded in the real repository structure:

- default document is [INDEX.md](/home/rnebili/Progetti/NEB/WAI%20V2/docs/INDEX.md)
- navigation reflects canonical and reference docs directly from the repository structure
- markdown is rendered directly from the markdown files already present in `docs/`
- simple search/filter works on file titles
- badges distinguish status, founder, technical, reference, and archive material when applicable

This means the dashboard is a surface over the real knowledge base, not a second documentation system.
