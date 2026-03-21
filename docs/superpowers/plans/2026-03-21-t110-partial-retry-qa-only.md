# T110 — Partial retry QA-only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the founder to re-run only the QA gate on an existing task via `retry qa <task_ref>` or `/retry-qa <task_ref>` on Telegram, skipping Architect + Dev General entirely.

**Architecture:** Add a `retry_qa` shortcut to `detectFounderShortcutIntent` (zero LLM call) and a matching `retry_qa` case in the command dispatcher in `ceo_intake.ts`. The dispatcher validates the task, fires `runQaAgent()` directly (fire-and-forget, same pattern as all other retries), and logs a `founder_command` event.

**Tech Stack:** Node.js 22 + TypeScript strict, `backend/src/agents/ceo_intake.ts` only.

---

## File Map

| File | Change |
|------|--------|
| `backend/src/agents/ceo_intake.ts` | Add import, shortcut regex, system prompt entry, command dispatcher case |

No new files. No other files touched.

---

### Task 1: Add `getTaskByReference` to supabase imports + `runQaAgent` import

**Files:**
- Modify: `backend/src/agents/ceo_intake.ts:14-27` (supabase imports block)
- Modify: `backend/src/agents/ceo_intake.ts:52` (after `runCeoAgent` import)

- [ ] **Step 1: Add `getTaskByReference` to the supabase import block**

Current block (lines 14–27):
```typescript
import {
  createClient,
  createProject,
  createTask,
  getClientBySlug,
  getClients,
  getInProgressTasksByProject,
  getPayments,
  getProjects,
  getProjectBySlug,
  getProjectsByClient,
  getRecentEvents,
  getTasksByStatus,
  updateProjectStatus,
  updateProjectWorkspacePath,
} from '../services/supabase.js'
```

Add `getTaskByReference` to the list (alphabetical position between `getRecentEvents` and `getTasksByStatus`):
```typescript
import {
  createClient,
  createProject,
  createTask,
  getClientBySlug,
  getClients,
  getInProgressTasksByProject,
  getPayments,
  getProjects,
  getProjectBySlug,
  getProjectsByClient,
  getRecentEvents,
  getTaskByReference,
  getTasksByStatus,
  updateProjectStatus,
  updateProjectWorkspacePath,
} from '../services/supabase.js'
```

- [ ] **Step 2: Add `runQaAgent` import from `../agents/qa.js`**

After line 52 (`import { runCeoAgent } from './ceo.js'`), add:
```typescript
import { runQaAgent } from './qa.js'
```

- [ ] **Step 3: Run typecheck**

```bash
cd backend && pnpm typecheck
```
Expected: no errors related to new imports.

- [ ] **Step 4: Commit**

```bash
git add backend/src/agents/ceo_intake.ts
git commit -m "feat(T110): add getTaskByReference + runQaAgent imports to ceo_intake"
```

---

### Task 2: Add `retry_qa` shortcut in `detectFounderShortcutIntent`

**Files:**
- Modify: `backend/src/agents/ceo_intake.ts` — `detectFounderShortcutIntent` function (currently ends with `return null` around line 308)

- [ ] **Step 1: Add the shortcut regex block before `return null`**

The regex must match:
- `retry qa <task_ref>`
- `/retry-qa <task_ref>`
- `retry-qa <task_ref>`

Where `<task_ref>` is a UUID or 4–36 hex char short ID.

Insert this block right before `return null` in `detectFounderShortcutIntent`:

```typescript
  // --- Retry QA only ---
  const retryQaMatch = text.match(/^(?:\/)?retry[-\s]qa\s+([a-f0-9-]{4,36})$/i)
  if (retryQaMatch?.[1]?.trim()) {
    return {
      action: 'execute',
      message: 'Rilancio il solo gate QA sul task.',
      commands: [{ type: 'retry_qa', params: { task_ref: retryQaMatch[1].trim() } }],
    }
  }
```

- [ ] **Step 2: Run typecheck**

```bash
cd backend && pnpm typecheck
```
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/agents/ceo_intake.ts
git commit -m "feat(T110): add retry_qa shortcut detection in detectFounderShortcutIntent"
```

---

### Task 3: Add `retry_qa` to the CEO system prompt

**Files:**
- Modify: `backend/src/agents/ceo_intake.ts` — `buildSystemPrompt` function, ACTIONS list (around line 128)

- [ ] **Step 1: Add `retry_qa` to the ACTIONS list**

After the `retry_task` line (line 128):
```
- retry_task         → params: task_ref, reason?
```
Add:
```
- retry_qa           → params: task_ref  (re-runs ONLY the QA gate — skips Architect + Dev General)
```

Also add a planning rule after rule 12. Append after rule 22 (line 164) or insert as rule 23:
```
23. Use retry_qa when Neb explicitly asks to redo/retry only QA (e.g. "rifai il QA", "retry qa <id>", "ri-lancia solo QA"). This skips Architect and Dev General and runs only the final QA gate.
```

- [ ] **Step 2: Run typecheck**

```bash
cd backend && pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/agents/ceo_intake.ts
git commit -m "feat(T110): add retry_qa action to CEO system prompt"
```

---

### Task 4: Add `retry_qa` case in the command dispatcher

**Files:**
- Modify: `backend/src/agents/ceo_intake.ts` — command dispatcher switch-case (after the `retry_task` case, around line 1668)

- [ ] **Step 1: Add the `retry_qa` case after `retry_task`**

Insert immediately after the closing `}` of the `retry_task` case:

```typescript
    // ── retry_qa ──────────────────────────────────────────────────────────
    case 'retry_qa': {
      const taskRef = getString(params, 'task_ref') ?? getString(params, 'task_id')

      if (!taskRef) throw new Error('task_ref mancante per retry_qa')

      const task = await getTaskByReference(taskRef)
      if (!task) throw new Error(`Task non trovato: ${taskRef}`)

      if (task.status !== 'blocked' && task.status !== 'in_progress') {
        throw new Error(
          `Task è in stato "${task.status}" — retry_qa supporta solo task bloccati o in corso`
        )
      }

      await recordEvent('founder_command', {
        taskId: task.id,
        payload: {
          command: 'retry_qa_only',
          source: 'natural_language',
          task_ref: taskRef,
          resolved_task_id: task.id,
        },
      })

      void runQaAgent(task, notify).catch((err: unknown) => {
        log.error({ err, taskId: task.id }, 'retry_qa: QA agent failed')
      })

      return [
        `🔁 *QA rilanciato (solo gate QA)*`,
        ``,
        `ID: \`${task.id.slice(0, 8)}\``,
        `Title: ${task.title}`,
        `Agent: qa`,
        ``,
        `Il gate QA è in esecuzione — Architect e Dev General saltati.`,
      ].join('\n')
    }
```

- [ ] **Step 2: Run typecheck**

```bash
cd backend && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/agents/ceo_intake.ts
git commit -m "feat(T110): add retry_qa command dispatcher case in ceo_intake"
```

---

### Task 5: Update PROJECT_TRACKING.md

**Files:**
- Modify: `docs/PROJECT_TRACKING.md`

- [ ] **Step 1: Mark T110 done in the build queue table**

Change:
```
| T110 | Partial retry (QA-only retry) | 🔲 Todo | Claude | 2 | Allow founder to retry only QA step without re-running Architect + Dev General |
```
To:
```
| T110 | Partial retry (QA-only retry) | ✅ Done | Claude | 2 | — |
```

- [ ] **Step 2: Add to Recent Completed Work table and Recent Changes section**

In the Recent Completed Work table, add:
```
| T110 | QA-only partial retry | ✅ Done | `retry qa <task_ref>` and `/retry-qa <task_ref>` now skip Architect + Dev General and re-run only the QA gate on the existing task |
```

In the Recent Changes section, add a new entry:
```markdown
### 2026-03-21 — T110: QA-only partial retry

- Added `retry_qa` shortcut in `detectFounderShortcutIntent`: matches `retry qa <id>` / `/retry-qa <id>` / `retry-qa <id>` — zero LLM call
- Added `retry_qa` action to CEO system prompt ACTIONS list with planning rule 23
- Added `retry_qa` case to the command dispatcher in `ceo_intake.ts`: validates task is `blocked` or `in_progress`, fires `runQaAgent()` directly (fire-and-forget), logs `founder_command` event with `command: 'retry_qa_only'`
- No new files; only `backend/src/agents/ceo_intake.ts` modified
```

- [ ] **Step 3: Commit**

```bash
git add docs/PROJECT_TRACKING.md
git commit -m "docs: mark T110 done, add session notes"
```

---

## Testing

After implementation, manual test flow:
1. Have a task in `blocked` status with a QA-fail history
2. Send `retry qa <short-id>` on Telegram
3. Expected: immediate `🔁 QA rilanciato` confirmation, then QA agent runs and sends its normal report
4. Verify `founder_command` event with `command: retry_qa_only` in Supabase `events` table
5. Verify task status transitions: `blocked` → `in_progress` (set by `runQaAgent` internally) → `done` or `blocked` depending on QA result
