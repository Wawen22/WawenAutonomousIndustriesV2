# Agentic Loop + Team Software Dev Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static plan-then-execute model with an iterative agentic loop (LLM sees command output and reacts) and restructure Team Software Dev from 2 generic devs to 4 specialized roles.

**Architecture:** `executeAgenticLoop()` added to `software_repo_runtime.ts` — drives dev workers through an LLM→action→result cycle (up to 20 iterations). The Architect orchestrates 3 phases: Scaffold (devops_engineer) → Implement (dev_general + ai_engineer in parallel) → QA. All 3 dev worker agents use the agentic loop. `automation_specialist` is a specialist cross-team agent (no repo work).

**Tech Stack:** Node.js 22, TypeScript strict, execFileAsync (safe shell), existing runAgent/recordEvent/recordRun infrastructure.

---

## File Map

| Status | File | Change |
|--------|------|--------|
| MODIFY | `backend/src/agents/software_repo_runtime.ts` | Add `executeAgenticLoop`, `AgentLoopAction`, `parseAgentLoopAction`, loop helpers |
| MODIFY | `backend/src/agents/dev_general.ts` | Switch from `executeRepoImplementation` to `executeAgenticLoop` |
| MODIFY | `backend/src/agents/architect.ts` | New assignee types (devops_engineer, dev_general, ai_engineer), 3-phase orchestration |
| MODIFY | `backend/src/agents/software_delivery_utils.ts` | Update `DEV_GENERAL_WORKERS` to include all 3 new worker IDs |
| MODIFY | `backend/src/config/agents.ts` | Rename dev_general_1→dev_general, replace dev_general_2 with devops_engineer+ai_engineer, add automation_specialist |
| CREATE | `backend/src/agents/devops_engineer.ts` | New agent: scaffold, npm init, CI/CD, env setup — uses executeAgenticLoop |
| CREATE | `backend/src/agents/ai_engineer.ts` | New agent: AI/LLM integrations, RAG, embeddings — uses executeAgenticLoop |
| CREATE | `backend/src/agents/automation_specialist.ts` | New specialist: n8n, Zapier, webhooks — produces markdown deliverable |
| MODIFY | `docs/AGENTS_AND_TEAMS.md` | Updated team structure |
| MODIFY | `docs/PROJECT_TRACKING.md` | T128 logged |

---

## Task 1: Add `executeAgenticLoop` to software_repo_runtime.ts

**Files:**
- Modify: `backend/src/agents/software_repo_runtime.ts`

- [ ] **Step 1.1: Add AgentLoopAction types** after the existing interfaces (~line 128)

```typescript
// ── Agentic Loop ────────────────────────────────────────────────────────────

export type AgentLoopActionType = 'exec_command' | 'create_file' | 'edit_file' | 'read_file' | 'done'

export interface AgentLoopAction {
  type: AgentLoopActionType
  // exec_command
  command?: string          // executable only: "npm", "npx", "pnpm", "node", "git"
  args?: string[]           // e.g. ["create-vite@latest", "myapp", "--template", "react-ts"]
  cwd?: string              // relative to repoPath, defaults to "."
  // create_file | edit_file | read_file
  path?: string             // relative to repoPath
  content?: string          // create_file only
  oldText?: string          // edit_file only
  newText?: string          // edit_file only
  // any action
  reason?: string
  // done
  summary?: string
  result?: 'success' | 'partial' | 'blocked'
  blockers?: string[]
}

interface AgentLoopStep {
  iteration: number
  action: AgentLoopAction
  output: string
  durationMs: number
  error?: string
}
```

- [ ] **Step 1.2: Add `EXEC_ALLOWED_COMMANDS` constant and helpers** (after the existing constants at top of file):

```typescript
const MAX_AGENTIC_ITERATIONS = 20

const EXEC_ALLOWED_COMMANDS = new Set([
  'npm', 'npx', 'pnpm', 'pnpx', 'yarn', 'bun', 'bunx',
  'node', 'git', 'tsc', 'vite', 'next', 'eslint', 'prettier',
  'mkdir', 'cp', 'mv', 'rm', 'chmod', 'touch', 'ls',
])
```

- [ ] **Step 1.3: Add `parseAgentLoopAction` function** (can go near `parseRepoEditPlan`):

```typescript
function parseAgentLoopAction(raw: string): AgentLoopAction | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
    const validTypes: AgentLoopActionType[] = ['exec_command', 'create_file', 'edit_file', 'read_file', 'done']
    if (!validTypes.includes(parsed['type'] as AgentLoopActionType)) return null
    return parsed as AgentLoopAction
  } catch {
    return null
  }
}
```

- [ ] **Step 1.4: Add `buildAgentLoopSystemPrompt` helper**:

```typescript
function buildAgentLoopSystemPrompt(agentRole: string, taskDescription: string, architecturePlan: string): string {
  return `You are ${agentRole}. Implement the assigned task by taking ONE action at a time and reacting to results.

## Your Task
${taskDescription}

## Architecture Plan
${architecturePlan}

## Available Actions — respond with exactly ONE JSON object per turn

exec_command — run a shell command:
{"type":"exec_command","command":"npm","args":["install"],"cwd":".","reason":"install dependencies"}

create_file — create a new file (fails if already exists):
{"type":"create_file","path":"src/index.ts","content":"export default {}","reason":"main entry point"}

edit_file — replace text in existing file (exact match required):
{"type":"edit_file","path":"package.json","oldText":"\\"version\\": \\"0.0.0\\"","newText":"\\"version\\": \\"1.0.0\\"","reason":"update version"}

read_file — read a file to inspect current state:
{"type":"read_file","path":"package.json","reason":"check current dependencies before editing"}

done — signal task completion:
{"type":"done","summary":"Implemented X, Y, Z. Build passes.","result":"success"}
or if blocked:
{"type":"done","summary":"Could not complete: reason.","result":"blocked","blockers":["missing env var FOO"]}

## Rules
- ONE action per turn — no explanation, only JSON
- exec_command: only allowed executables: npm, npx, pnpm, pnpx, yarn, bun, node, git, tsc, vite, next, eslint, prettier, mkdir, cp, mv, rm, chmod, touch, ls
- If a command fails, read the error output and try to fix it before giving up
- Use read_file before edit_file if unsure about current content
- If you run out of iterations, output done with result "partial"
- Never output markdown fences or prose — only the raw JSON object`
}
```

- [ ] **Step 1.5: Add `buildAgentLoopUserMessage` helper**:

```typescript
function buildAgentLoopUserMessage(
  repoState: string,
  history: AgentLoopStep[],
  iteration: number,
  maxIterations: number
): string {
  const historyText = history.length === 0
    ? 'No actions taken yet. Start with your first action.'
    : history.map((step) => {
        const actionLabel = step.action.type === 'exec_command'
          ? `exec_command: ${step.action.command} ${(step.action.args ?? []).join(' ')} (cwd: ${step.action.cwd ?? '.'})`
          : step.action.type === 'done'
          ? `done: ${step.action.result}`
          : `${step.action.type}: ${step.action.path ?? ''}`
        return `[Iteration ${step.iteration}/${maxIterations}] ${actionLabel}\nResult:\n${step.output.slice(0, 1000)}${step.error ? `\nError: ${step.error}` : ''}`
      }).join('\n\n---\n\n')

  return `## Current Repository State\n${repoState}\n\n## Action History (${history.length} steps taken, ${maxIterations - iteration + 1} remaining)\n${historyText}\n\nWhat is your next action? Output only JSON.`
}
```

- [ ] **Step 1.6: Add the main `executeAgenticLoop` exported function** (after `executeRepoImplementation`):

```typescript
export async function executeAgenticLoop(options: {
  task: Task
  repoPath: string
  agentId: string
  agentRole: string
  taskDescription: string
  architecturePlan: string
  maxIterations?: number
}): Promise<RepoExecutionResult> {
  const { task, repoPath, agentId, agentRole, taskDescription, architecturePlan } = options
  const maxIterations = options.maxIterations ?? MAX_AGENTIC_ITERATIONS
  const startMs = Date.now()

  const history: AgentLoopStep[] = []
  const allTouchedFiles = new Set<string>()
  const allCommands: RepoCommandResult[] = []
  const allWarnings: string[] = []
  const allBlockers: string[] = []

  const systemPrompt = buildAgentLoopSystemPrompt(agentRole, taskDescription, architecturePlan)
  const gitStatusBefore = await getGitStatusShort(repoPath)

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const repoState = await buildRepoContext(repoPath)
    const userMessage = buildAgentLoopUserMessage(repoState, history, iteration, maxIterations)

    let raw: string
    try {
      raw = await runAgent(systemPrompt, userMessage, { agentId, taskType: task.type as TaskType })
    } catch (err) {
      allWarnings.push(`LLM call failed at iteration ${iteration}: ${err instanceof Error ? err.message : String(err)}`)
      break
    }

    const action = parseAgentLoopAction(raw)
    if (!action) {
      allWarnings.push(`Iteration ${iteration}: could not parse agent action from response`)
      break
    }

    const stepStart = Date.now()
    let output = ''
    let stepError: string | undefined

    // ── done ──────────────────────────────────────────────────────────────
    if (action.type === 'done') {
      if (action.blockers?.length) allBlockers.push(...action.blockers)
      history.push({ iteration, action, output: action.summary ?? 'Done', durationMs: Date.now() - stepStart })
      break
    }

    // ── exec_command ───────────────────────────────────────────────────────
    if (action.type === 'exec_command') {
      const cmd = (action.command ?? '').trim()
      const args = action.args ?? []
      const cwdRel = action.cwd ?? '.'
      const cwd = resolve(repoPath, cwdRel)

      if (!EXEC_ALLOWED_COMMANDS.has(cmd)) {
        output = `Command not allowed: "${cmd}". Allowed: ${Array.from(EXEC_ALLOWED_COMMANDS).join(', ')}`
        stepError = output
        allWarnings.push(output)
      } else {
        try {
          const result = await runCommand(cmd, args, cwd, 300_000)
          const stdoutClean = result.stdout.trim()
          const stderrClean = result.stderr.trim()
          output = [
            stdoutClean ? `STDOUT:\n${stdoutClean}` : '',
            stderrClean ? `STDERR:\n${stderrClean}` : '',
          ].filter(Boolean).join('\n') || 'Command completed with no output.'

          allCommands.push({
            name: 'custom' as RepoCommandName,
            command: [cmd, ...args].join(' '),
            relativeDir: toRelativeRepoPath(repoPath, cwd),
            status: 'passed',
            blocking: true,
            summary: shortenOutput(stdoutClean || stderrClean, 300),
            stdoutExcerpt: shortenOutput(stdoutClean),
            stderrExcerpt: shortenOutput(stderrClean, 300),
          })
        } catch (err) {
          const execErr = err as Record<string, unknown>
          const stderr = String(execErr['stderr'] ?? '')
          const stdout = String(execErr['stdout'] ?? '')
          output = `FAILED:\n${stderr.trim() || stdout.trim() || String(err)}`
          stepError = shortenOutput(stderr || stdout, 200)
          allCommands.push({
            name: 'custom' as RepoCommandName,
            command: [cmd, ...args].join(' '),
            relativeDir: toRelativeRepoPath(repoPath, cwd),
            status: 'failed',
            blocking: false,
            summary: stepError ?? 'failed',
            stdoutExcerpt: shortenOutput(stdout),
            stderrExcerpt: shortenOutput(stderr),
          })
        }
      }
    }

    // ── create_file ────────────────────────────────────────────────────────
    if (action.type === 'create_file' && action.path) {
      const editResult = await applyRepoEdits(repoPath, [{
        type: 'create_file',
        path: action.path,
        content: action.content ?? '',
        reason: action.reason,
      }])
      editResult.touchedFiles.forEach((f) => allTouchedFiles.add(f))
      allBlockers.push(...editResult.blockers)
      allWarnings.push(...editResult.warnings)
      output = editResult.blockers.length > 0
        ? `FAILED: ${editResult.blockers.join('; ')}`
        : `Created ${action.path} (${action.content?.split('\n').length ?? 0} lines)`
      if (editResult.blockers.length > 0) stepError = editResult.blockers[0]
    }

    // ── edit_file ──────────────────────────────────────────────────────────
    if (action.type === 'edit_file' && action.path) {
      const editResult = await applyRepoEdits(repoPath, [{
        type: 'replace_in_file',
        path: action.path,
        oldText: action.oldText ?? '',
        newText: action.newText ?? '',
        reason: action.reason,
      }])
      editResult.touchedFiles.forEach((f) => allTouchedFiles.add(f))
      allBlockers.push(...editResult.blockers)
      allWarnings.push(...editResult.warnings)
      output = editResult.blockers.length > 0
        ? `FAILED: ${editResult.blockers.join('; ')}`
        : `Edited ${action.path}`
      if (editResult.blockers.length > 0) stepError = editResult.blockers[0]
    }

    // ── read_file ──────────────────────────────────────────────────────────
    if (action.type === 'read_file' && action.path) {
      try {
        const absolutePath = ensurePathInsideRepo(repoPath, action.path)
        if (existsSync(absolutePath)) {
          const content = await readFile(absolutePath, 'utf-8')
          output = content.length > 4000
            ? `${content.slice(0, 4000)}\n... [truncated — ${content.length} chars total]`
            : content
        } else {
          output = `File not found: ${action.path}`
          stepError = output
        }
      } catch (err) {
        output = `Error reading ${action.path}: ${err instanceof Error ? err.message : String(err)}`
        stepError = output
      }
    }

    history.push({
      iteration,
      action,
      output: output.slice(0, 1500),
      durationMs: Date.now() - stepStart,
      ...(stepError ? { error: stepError } : {}),
    })

    await recordEvent('agent_loop_step', {
      agentId,
      ...(task.id ? { taskId: task.id } : {}),
      payload: {
        iteration,
        action_type: action.type,
        path: action.path,
        command: action.command,
        status: stepError ? 'error' : 'ok',
        duration_ms: Date.now() - stepStart,
      },
    })
  }

  const gitStatusAfter = await getGitStatusShort(repoPath)
  const diffFiles = gitStatusAfter.filter((s) => !gitStatusBefore.includes(s))
  const lastDoneAction = history.findLast((s) => s.action.type === 'done')
  const summary = lastDoneAction?.action.summary
    ?? `Completed ${history.length} iterations, touched ${allTouchedFiles.size} files.`

  await recordToolRun(
    agentId,
    task.type as TaskType,
    task.id,
    ['shell', 'file_system'],
    taskDescription.slice(0, 500),
    summary,
    allBlockers.length > 0 ? 'partial' : 'success',
    Date.now() - startMs
  )

  return {
    repoPath,
    branch: await getGitBranch(repoPath),
    summary,
    inspectionWarnings: [],
    warnings: allWarnings,
    blockers: allBlockers,
    plannedFiles: [],
    resolvedFiles: [],
    touchedFiles: Array.from(allTouchedFiles),
    appliedEditCount: allTouchedFiles.size,
    commands: allCommands,
    gitStatusBefore,
    gitStatusAfter,
    diffFiles,
  }
}
```

- [ ] **Step 1.7: Add `resolve` to imports at top of software_repo_runtime.ts** (it uses `resolve` from path):

Find the existing import:
```typescript
import { dirname, join, relative, resolve } from 'node:path'
```
Verify `resolve` is already imported (it should be from existing code). If not, add it.

- [ ] **Step 1.8: Run typecheck**
```bash
cd backend && pnpm typecheck
```
Expected: no new errors. Fix any type errors before continuing.

- [ ] **Step 1.9: Commit**
```bash
git add backend/src/agents/software_repo_runtime.ts
git commit -m "feat: add executeAgenticLoop to software_repo_runtime — iterative LLM action loop"
```

---

## Task 2: Update dev_general.ts to use executeAgenticLoop

**Files:**
- Modify: `backend/src/agents/dev_general.ts`

- [ ] **Step 2.1: Add `executeAgenticLoop` to imports from software_repo_runtime**

Find:
```typescript
import {
  executeRepoImplementation,
  executeWorkspaceFileCreation,
  renderRepoExecutionMarkdown,
} from './software_repo_runtime.js'
```
Replace with:
```typescript
import {
  executeAgenticLoop,
  executeRepoImplementation,
  executeWorkspaceFileCreation,
  renderRepoExecutionMarkdown,
} from './software_repo_runtime.js'
```

- [ ] **Step 2.2: Locate the `executeRepoImplementation` call in dev_general.ts** (around line 521)

Find the block:
```typescript
const repoExecution = repoLocalPath ? await executeRepoImplementation({
```
Replace the entire `repoExecution` assignment block for `repoLocalPath` with the agentic loop call:

```typescript
const repoExecution = repoLocalPath ? await executeAgenticLoop({
  task,
  repoPath: repoLocalPath,
  agentId: task.assignee_agent_id ?? 'dev_general',
  agentRole: 'an expert software developer (Dev General). You implement custom software for clients.',
  taskDescription: [
    `Task: ${task.title}`,
    `Description: ${task.description ?? ''}`,
    `Project: ${projectName}`,
    `Client: ${clientName}`,
  ].join('\n'),
  architecturePlan: (await readOptionalFile(join(workspaceAbsPath ?? '', 'deliverables', 'architecture_plan.md'))) ?? 'No architecture plan available.',
}) : undefined
```

- [ ] **Step 2.3: Run typecheck**
```bash
cd backend && pnpm typecheck
```
Fix any type errors.

- [ ] **Step 2.4: Commit**
```bash
git add backend/src/agents/dev_general.ts
git commit -m "feat: migrate dev_general to executeAgenticLoop"
```

---

## Task 3: Create devops_engineer.ts

**Files:**
- Create: `backend/src/agents/devops_engineer.ts`

- [ ] **Step 3.1: Create the file**

```typescript
// ============================================================
// WAI – DevOps Engineer Agent
// Esegue la fase di scaffold e infrastruttura per Team Dev:
// inizializza il repo, installa dipendenze, configura CI/CD.
// Usa executeAgenticLoop per reagire ai risultati in tempo reale.
// ============================================================

import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

import {
  getChildTasks,
  getProjectById,
  getTaskById,
  transitionTaskStatus,
  updateTaskStatus,
} from '../services/supabase.js'
import { log, recordEvent } from '../services/logger.js'
import { appendProjectProgress } from '../services/workspace.js'
import {
  DEV_WORKERS,
  getBlockedDependencyIds,
  getPendingDependencyIds,
  loadAllWorkspaceContext,
  readOptionalFile,
  resolveSoftwareWorkspacePath,
} from './software_delivery_utils.js'
import {
  buildRepoContext,
  executeAgenticLoop,
  renderRepoExecutionMarkdown,
} from './software_repo_runtime.js'
import type { Task } from '../types/index.js'

export async function runDevOpsEngineerAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  log.info({ taskId: task.id, title: task.title }, 'DevOps Engineer Agent: starting')

  const projectId = task.project_id ?? (task.metadata['project_id'] as string | undefined)
  const projectName = (task.metadata['project_name'] as string | undefined) ?? task.title
  const clientName = (task.metadata['client_name'] as string | undefined) ?? 'the client'
  const repoLocalPath = (task.metadata['repo_local_path'] as string | undefined) ?? undefined
  const workspaceAbsPath = await resolveSoftwareWorkspacePath(task, projectId)

  // Dependency guard: check if this task has unresolved predecessors
  const siblingTasks = task.parent_task_id
    ? await getChildTasks(task.parent_task_id)
    : []

  const pendingDeps = getPendingDependencyIds(task, siblingTasks)
  if (pendingDeps.length > 0) {
    await updateTaskStatus(task.id, 'blocked', {
      block_reason: `Waiting on: ${pendingDeps.join(', ')}`,
    })
    return
  }

  const blockedDeps = getBlockedDependencyIds(task, siblingTasks)
  if (blockedDeps.length > 0) {
    await updateTaskStatus(task.id, 'blocked', {
      block_reason: `Dependency blocked: ${blockedDeps.join(', ')}`,
    })
    return
  }

  await updateTaskStatus(task.id, 'in_progress')
  await notify(`🔧 DevOps Engineer starting scaffold for **${projectName}**`)

  try {
    const architecturePlan = workspaceAbsPath
      ? (await readOptionalFile(join(workspaceAbsPath, 'deliverables', 'architecture_plan.md'))) ?? ''
      : ''

    const workspaceContext = workspaceAbsPath
      ? await loadAllWorkspaceContext(workspaceAbsPath)
      : ''

    const repoContext = repoLocalPath ? await buildRepoContext(repoLocalPath) : ''

    const taskDescription = [
      `Task: ${task.title}`,
      `Description: ${task.description ?? ''}`,
      `Project: ${projectName} | Client: ${clientName}`,
      `Your role: scaffold and infrastructure phase.`,
      ``,
      `Your responsibilities:`,
      `- Initialize the project structure (npx create-*, npm init, etc.)`,
      `- Write package.json, tsconfig.json, .gitignore, .env.example`,
      `- Run npm/pnpm install to confirm dependencies resolve`,
      `- Set up CI/CD config if needed (Dockerfile, .github/workflows)`,
      `- Verify the project builds (npm run build or npm run dev --dry)`,
      `- Leave the repo in a buildable state for the dev_general agent`,
      ``,
      workspaceContext ? `## Workspace Context\n${workspaceContext}` : '',
      repoContext ? `## Current Repo State\n${repoContext}` : '',
    ].filter(Boolean).join('\n')

    const deliverableLines: string[] = []

    if (repoLocalPath) {
      const repoExecution = await executeAgenticLoop({
        task,
        repoPath: repoLocalPath,
        agentId: task.assignee_agent_id ?? 'devops_engineer',
        agentRole: 'an expert DevOps Engineer. Your job is to scaffold projects, set up infrastructure, configure CI/CD, and ensure the repo is buildable before application code is written.',
        taskDescription,
        architecturePlan,
      })

      const repoMarkdown = renderRepoExecutionMarkdown(repoExecution)
      deliverableLines.push(repoMarkdown)

      if (workspaceAbsPath) {
        const deliverableDir = join(workspaceAbsPath, 'deliverables')
        await mkdir(deliverableDir, { recursive: true })
        const deliverablePath = join(deliverableDir, `devops-scaffold-${task.id}.md`)
        await writeFile(deliverablePath, repoMarkdown, 'utf-8')
      }

      const hasBlockers = repoExecution.blockers.length > 0
      if (hasBlockers) {
        await updateTaskStatus(task.id, 'blocked', {
          block_reason: repoExecution.blockers.slice(0, 3).join('; '),
          output_summary: repoExecution.summary,
        })
        await notify(`⚠️ DevOps Engineer blocked on **${projectName}**: ${repoExecution.blockers[0]}`)
        await recordEvent('task_blocked', {
          agentId: task.assignee_agent_id ?? 'devops_engineer',
          taskId: task.id,
          payload: { blockers: repoExecution.blockers },
        })
        return
      }
    }

    const summary = deliverableLines.join('\n\n') || `Scaffold complete for ${projectName}.`

    await updateTaskStatus(task.id, 'done', { output_summary: summary.slice(0, 800) })
    await recordEvent('task_completed', {
      agentId: task.assignee_agent_id ?? 'devops_engineer',
      taskId: task.id,
      payload: { project: projectName, summary: summary.slice(0, 300) },
    })

    if (workspaceAbsPath) {
      await appendProjectProgress(workspaceAbsPath, `DevOps Engineer completed scaffold for ${projectName}.`)
    }

    await notify(`✅ DevOps Engineer scaffold complete for **${projectName}**`)

    // Activate sibling implementation tasks
    const siblingsToActivate = siblingTasks.filter((s) =>
      s.status === 'todo' &&
      DEV_WORKERS.has(s.assignee_agent_id ?? '') &&
      s.id !== task.id
    )
    for (const sibling of siblingsToActivate) {
      const siblingTask = await getTaskById(sibling.id)
      if (siblingTask && siblingTask.status === 'todo') {
        await transitionTaskStatus(sibling.id, 'todo', 'in_progress')
        await recordEvent('task_unblocked_by_devops', {
          agentId: 'devops_engineer',
          taskId: sibling.id,
          payload: { unblocked_by: task.id },
        })
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error({ taskId: task.id, error }, 'DevOps Engineer Agent: fatal error')
    await updateTaskStatus(task.id, 'blocked', { block_reason: message })
    await notify(`❌ DevOps Engineer error on **${projectName}**: ${message}`)
  }
}
```

- [ ] **Step 3.2: Run typecheck** (will fail until software_delivery_utils.ts exports `DEV_WORKERS` — fix in Task 8, but check other errors now)
```bash
cd backend && pnpm typecheck 2>&1 | head -30
```

- [ ] **Step 3.3: Commit placeholder (even with typecheck pending)**
```bash
git add backend/src/agents/devops_engineer.ts
git commit -m "feat: add DevOps Engineer agent with agentic loop"
```

---

## Task 4: Create ai_engineer.ts

**Files:**
- Create: `backend/src/agents/ai_engineer.ts`

- [ ] **Step 4.1: Create the file**

```typescript
// ============================================================
// WAI – AI/LLM Engineer Agent
// Implementa funzionalità AI/LLM: RAG, embeddings, prompt eng,
// LLM API integrations, vector search, AI-powered features.
// Usa executeAgenticLoop per reagire ai risultati in tempo reale.
// ============================================================

import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

import {
  getChildTasks,
  getProjectById,
  getTaskById,
  transitionTaskStatus,
  updateTaskStatus,
} from '../services/supabase.js'
import { log, recordEvent } from '../services/logger.js'
import { appendProjectProgress } from '../services/workspace.js'
import {
  DEV_WORKERS,
  getBlockedDependencyIds,
  getPendingDependencyIds,
  loadAllWorkspaceContext,
  readOptionalFile,
  resolveSoftwareWorkspacePath,
} from './software_delivery_utils.js'
import {
  buildRepoContext,
  executeAgenticLoop,
  renderRepoExecutionMarkdown,
} from './software_repo_runtime.js'
import type { Task } from '../types/index.js'

export async function runAiEngineerAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  log.info({ taskId: task.id, title: task.title }, 'AI Engineer Agent: starting')

  const projectId = task.project_id ?? (task.metadata['project_id'] as string | undefined)
  const projectName = (task.metadata['project_name'] as string | undefined) ?? task.title
  const clientName = (task.metadata['client_name'] as string | undefined) ?? 'the client'
  const repoLocalPath = (task.metadata['repo_local_path'] as string | undefined) ?? undefined
  const workspaceAbsPath = await resolveSoftwareWorkspacePath(task, projectId)

  // Wait for devops_engineer scaffold to complete
  const siblingTasks = task.parent_task_id
    ? await getChildTasks(task.parent_task_id)
    : []

  const pendingDeps = getPendingDependencyIds(task, siblingTasks)
  if (pendingDeps.length > 0) {
    await updateTaskStatus(task.id, 'blocked', {
      block_reason: `Waiting on: ${pendingDeps.join(', ')}`,
    })
    return
  }

  const blockedDeps = getBlockedDependencyIds(task, siblingTasks)
  if (blockedDeps.length > 0) {
    await updateTaskStatus(task.id, 'blocked', {
      block_reason: `Dependency blocked: ${blockedDeps.join(', ')}`,
    })
    return
  }

  await updateTaskStatus(task.id, 'in_progress')
  await notify(`🤖 AI Engineer starting on **${projectName}**`)

  try {
    const architecturePlan = workspaceAbsPath
      ? (await readOptionalFile(join(workspaceAbsPath, 'deliverables', 'architecture_plan.md'))) ?? ''
      : ''

    const workspaceContext = workspaceAbsPath
      ? await loadAllWorkspaceContext(workspaceAbsPath)
      : ''

    const repoContext = repoLocalPath ? await buildRepoContext(repoLocalPath) : ''

    const taskDescription = [
      `Task: ${task.title}`,
      `Description: ${task.description ?? ''}`,
      `Project: ${projectName} | Client: ${clientName}`,
      `Your role: AI/LLM integration and intelligence layer.`,
      ``,
      `Your responsibilities:`,
      `- Implement AI-powered features (LLM calls, embeddings, RAG, vector search)`,
      `- Integrate with LLM APIs (OpenAI, Anthropic, LiteLLM, etc.)`,
      `- Build prompt templates, system prompts, and AI pipeline logic`,
      `- Implement semantic search, knowledge base, or recommendation features`,
      `- Write AI-related utility functions and test them`,
      `- Ensure AI integrations are resilient (fallbacks, rate limit handling)`,
      ``,
      workspaceContext ? `## Workspace Context\n${workspaceContext}` : '',
      repoContext ? `## Current Repo State\n${repoContext}` : '',
    ].filter(Boolean).join('\n')

    const deliverableLines: string[] = []

    if (repoLocalPath) {
      const repoExecution = await executeAgenticLoop({
        task,
        repoPath: repoLocalPath,
        agentId: task.assignee_agent_id ?? 'ai_engineer',
        agentRole: 'an expert AI/LLM Engineer. You specialize in building AI-powered features: RAG pipelines, embeddings, LLM API integrations, prompt engineering, vector search, and intelligent automation.',
        taskDescription,
        architecturePlan,
      })

      const repoMarkdown = renderRepoExecutionMarkdown(repoExecution)
      deliverableLines.push(repoMarkdown)

      if (workspaceAbsPath) {
        const deliverableDir = join(workspaceAbsPath, 'deliverables')
        await mkdir(deliverableDir, { recursive: true })
        const deliverablePath = join(deliverableDir, `ai-engineer-${task.id}.md`)
        await writeFile(deliverablePath, repoMarkdown, 'utf-8')
      }

      const hasBlockers = repoExecution.blockers.length > 0
      if (hasBlockers) {
        await updateTaskStatus(task.id, 'blocked', {
          block_reason: repoExecution.blockers.slice(0, 3).join('; '),
          output_summary: repoExecution.summary,
        })
        await notify(`⚠️ AI Engineer blocked on **${projectName}**: ${repoExecution.blockers[0]}`)
        return
      }
    }

    const summary = deliverableLines.join('\n\n') || `AI Engineer completed task for ${projectName}.`
    await updateTaskStatus(task.id, 'done', { output_summary: summary.slice(0, 800) })
    await recordEvent('task_completed', {
      agentId: task.assignee_agent_id ?? 'ai_engineer',
      taskId: task.id,
      payload: { project: projectName, summary: summary.slice(0, 300) },
    })

    if (workspaceAbsPath) {
      await appendProjectProgress(workspaceAbsPath, `AI Engineer completed AI features for ${projectName}.`)
    }

    await notify(`✅ AI Engineer done with **${projectName}**`)

    // Check if all sibling dev workers are done → trigger QA
    const allSiblings = await getChildTasks(task.parent_task_id ?? '')
    const devWorkersDone = allSiblings
      .filter((s) => DEV_WORKERS.has(s.assignee_agent_id ?? '') && s.id !== task.id)
      .every((s) => s.status === 'done')

    if (devWorkersDone) {
      const qaSibling = allSiblings.find((s) => s.assignee_agent_id === 'qa' && s.status === 'todo')
      if (qaSibling) {
        await transitionTaskStatus(qaSibling.id, 'todo', 'in_progress')
        await recordEvent('qa_gate_activated', {
          agentId: 'ai_engineer',
          taskId: qaSibling.id,
          payload: { triggered_by: task.id },
        })
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error({ taskId: task.id, error }, 'AI Engineer Agent: fatal error')
    await updateTaskStatus(task.id, 'blocked', { block_reason: message })
    await notify(`❌ AI Engineer error on **${projectName}**: ${message}`)
  }
}
```

- [ ] **Step 4.2: Run typecheck**
```bash
cd backend && pnpm typecheck 2>&1 | head -30
```

- [ ] **Step 4.3: Commit**
```bash
git add backend/src/agents/ai_engineer.ts
git commit -m "feat: add AI/LLM Engineer agent with agentic loop"
```

---

## Task 5: Create automation_specialist.ts

**Files:**
- Create: `backend/src/agents/automation_specialist.ts`

This agent is a cross-team specialist (like security_auditor, api_tester). It does NOT do repo work — it produces a markdown automation plan/config as a deliverable.

- [ ] **Step 5.1: Create the file**

```typescript
// ============================================================
// WAI – Automation Specialist Agent
// Agente specialista cross-team per automazioni:
// n8n, Zapier, Make, webhook design, API orchestration.
// Produce automation-plan.md come deliverable.
// ============================================================

import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

import { runAgent } from '../services/llm.js'
import { getProjectById, updateTaskStatus } from '../services/supabase.js'
import { log, recordEvent } from '../services/logger.js'
import { resolveSoftwareWorkspacePath } from './software_delivery_utils.js'
import type { Task } from '../types/index.js'

interface AutomationPlanOutput {
  title: string
  summary: string
  platform: string           // 'n8n' | 'zapier' | 'make' | 'webhook' | 'custom'
  triggers: string[]
  workflows: AutomationWorkflow[]
  webhookDesigns: WebhookDesign[]
  integrationMap: string[]
  testingSteps: string[]
  risks: string[]
  nextSteps: string[]
}

interface AutomationWorkflow {
  name: string
  trigger: string
  steps: string[]
  output: string
}

interface WebhookDesign {
  endpoint: string
  method: string
  payload: string
  handler: string
}

function parseAutomationPlan(raw: string): AutomationPlanOutput | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
    if (typeof parsed['title'] !== 'string' || typeof parsed['summary'] !== 'string') return null
    const workflows = Array.isArray(parsed['workflows'])
      ? (parsed['workflows'] as unknown[]).filter(
          (w): w is AutomationWorkflow =>
            typeof w === 'object' && w !== null && typeof (w as Record<string, unknown>)['name'] === 'string'
        )
      : []
    const webhookDesigns = Array.isArray(parsed['webhookDesigns'])
      ? (parsed['webhookDesigns'] as unknown[]).filter(
          (w): w is WebhookDesign =>
            typeof w === 'object' && w !== null && typeof (w as Record<string, unknown>)['endpoint'] === 'string'
        )
      : []
    return {
      title: parsed['title'],
      summary: parsed['summary'],
      platform: typeof parsed['platform'] === 'string' ? parsed['platform'] : 'custom',
      triggers: Array.isArray(parsed['triggers']) ? parsed['triggers'].filter((t): t is string => typeof t === 'string') : [],
      workflows,
      webhookDesigns,
      integrationMap: Array.isArray(parsed['integrationMap']) ? parsed['integrationMap'].filter((t): t is string => typeof t === 'string') : [],
      testingSteps: Array.isArray(parsed['testingSteps']) ? parsed['testingSteps'].filter((t): t is string => typeof t === 'string') : [],
      risks: Array.isArray(parsed['risks']) ? parsed['risks'].filter((t): t is string => typeof t === 'string') : [],
      nextSteps: Array.isArray(parsed['nextSteps']) ? parsed['nextSteps'].filter((t): t is string => typeof t === 'string') : [],
    }
  } catch {
    return null
  }
}

function automationPlanToMarkdown(plan: AutomationPlanOutput, task: Task): string {
  const today = new Date().toISOString().split('T')[0]!
  const lines: string[] = [
    `# ${plan.title}`,
    ``,
    `**Date:** ${today}`,
    `**Platform:** ${plan.platform}`,
    `**Source Task:** ${task.title}`,
    `**Owner:** Automation Specialist`,
    ``,
    `---`,
    ``,
    `## Summary`,
    ``,
    plan.summary,
    ``,
  ]

  if (plan.triggers.length > 0) {
    lines.push(`## Automation Triggers`, ``, ...plan.triggers.map((t) => `- ${t}`), ``)
  }

  if (plan.integrationMap.length > 0) {
    lines.push(`## Integration Map`, ``, ...plan.integrationMap.map((t) => `- ${t}`), ``)
  }

  if (plan.workflows.length > 0) {
    lines.push(`## Workflows`, ``)
    for (const wf of plan.workflows) {
      lines.push(
        `### ${wf.name}`,
        ``,
        `**Trigger:** ${wf.trigger}`,
        ``,
        `**Steps:**`,
        ...wf.steps.map((s, i) => `${i + 1}. ${s}`),
        ``,
        `**Output:** ${wf.output}`,
        ``
      )
    }
  }

  if (plan.webhookDesigns.length > 0) {
    lines.push(`## Webhook Designs`, ``)
    for (const wh of plan.webhookDesigns) {
      lines.push(
        `### \`${wh.method} ${wh.endpoint}\``,
        ``,
        `**Payload:** ${wh.payload}`,
        `**Handler:** ${wh.handler}`,
        ``
      )
    }
  }

  if (plan.testingSteps.length > 0) {
    lines.push(`## Testing Steps`, ``, ...plan.testingSteps.map((t) => `- [ ] ${t}`), ``)
  }

  if (plan.risks.length > 0) {
    lines.push(`## Risks`, ``, ...plan.risks.map((r) => `- ⚠️ ${r}`), ``)
  }

  if (plan.nextSteps.length > 0) {
    lines.push(`## Next Steps`, ``, ...plan.nextSteps.map((n) => `- ${n}`), ``)
  }

  return lines.join('\n')
}

export async function runAutomationSpecialistAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  log.info({ taskId: task.id, title: task.title }, 'Automation Specialist Agent: starting')

  const projectId = task.project_id ?? (task.metadata['project_id'] as string | undefined)
  const workspaceAbsPath = await resolveSoftwareWorkspacePath(task, projectId)

  await updateTaskStatus(task.id, 'in_progress')
  await notify(`⚙️ Automation Specialist starting on **${task.title}**`)

  const systemPrompt = `You are an expert Automation Specialist. You design automation workflows using n8n, Zapier, Make (formerly Integromat), webhooks, and custom API orchestration.

Your output must be a single JSON object with this structure:
{
  "title": "Automation Design: <task name>",
  "summary": "...",
  "platform": "n8n|zapier|make|webhook|custom",
  "triggers": ["trigger1", "trigger2"],
  "workflows": [
    {
      "name": "Workflow name",
      "trigger": "What triggers it",
      "steps": ["Step 1", "Step 2", "Step 3"],
      "output": "What it produces"
    }
  ],
  "webhookDesigns": [
    {
      "endpoint": "/webhook/event-name",
      "method": "POST",
      "payload": "{ event: string, data: object }",
      "handler": "What the handler does"
    }
  ],
  "integrationMap": ["Service A → Service B via webhook", "..."],
  "testingSteps": ["Step to test the automation", "..."],
  "risks": ["Potential issue 1", "..."],
  "nextSteps": ["Implementation action 1", "..."]
}

Output ONLY the JSON. No markdown fences, no prose.`

  const userMessage = `Design an automation solution for this task:

Title: ${task.title}
Description: ${task.description ?? '(no description)'}
Project metadata: ${JSON.stringify(task.metadata ?? {}, null, 2)}`

  try {
    const raw = await runAgent(systemPrompt, userMessage, {
      agentId: 'automation_specialist',
      taskType: task.type,
    })

    const plan = parseAutomationPlan(raw)
    const markdown = plan
      ? automationPlanToMarkdown(plan, task)
      : `# Automation Plan\n\n${task.title}\n\n${raw.slice(0, 2000)}`

    if (workspaceAbsPath) {
      const deliverableDir = join(workspaceAbsPath, 'deliverables')
      await mkdir(deliverableDir, { recursive: true })
      const deliverablePath = join(deliverableDir, 'automation-plan.md')
      await writeFile(deliverablePath, markdown, 'utf-8')
    }

    const summary = plan?.summary ?? 'Automation plan generated'
    await updateTaskStatus(task.id, 'done', { output_summary: summary.slice(0, 500) })
    await recordEvent('task_completed', {
      agentId: 'automation_specialist',
      taskId: task.id,
      payload: { summary: summary.slice(0, 200), platform: plan?.platform ?? 'unknown' },
    })
    await notify(`✅ Automation Specialist done: **${plan?.title ?? task.title}**`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error({ taskId: task.id, error }, 'Automation Specialist Agent: fatal error')
    await updateTaskStatus(task.id, 'blocked', { block_reason: message })
    await notify(`❌ Automation Specialist error: ${message}`)
  }
}
```

- [ ] **Step 5.2: Run typecheck**
```bash
cd backend && pnpm typecheck 2>&1 | head -30
```

- [ ] **Step 5.3: Commit**
```bash
git add backend/src/agents/automation_specialist.ts
git commit -m "feat: add Automation Specialist agent (n8n/Zapier/webhook)"
```

---

## Task 6: Update software_delivery_utils.ts

**Files:**
- Modify: `backend/src/agents/software_delivery_utils.ts`

- [ ] **Step 6.1: Read the current file**

Read `backend/src/agents/software_delivery_utils.ts` to see the full content.

- [ ] **Step 6.2: Update DEV_GENERAL_WORKERS and add DEV_WORKERS export**

Find:
```typescript
export const DEV_GENERAL_WORKERS = new Set(['dev_general_1', 'dev_general_2'])
```
Replace with:
```typescript
export const DEV_GENERAL_WORKERS = new Set(['dev_general'])
export const DEV_WORKERS = new Set(['dev_general', 'devops_engineer', 'ai_engineer'])
```

- [ ] **Step 6.3: Run typecheck**
```bash
cd backend && pnpm typecheck 2>&1 | head -40
```

- [ ] **Step 6.4: Commit**
```bash
git add backend/src/agents/software_delivery_utils.ts
git commit -m "feat: update DEV_GENERAL_WORKERS, add DEV_WORKERS for new team"
```

---

## Task 7: Update architect.ts

**Files:**
- Modify: `backend/src/agents/architect.ts`

- [ ] **Step 7.1: Update ArchitectureImplementationTask type**

Find:
```typescript
interface ArchitectureImplementationTask {
  assignee: 'dev_general_1' | 'dev_general_2'
```
Replace with:
```typescript
interface ArchitectureImplementationTask {
  assignee: 'devops_engineer' | 'dev_general' | 'ai_engineer'
```

- [ ] **Step 7.2: Update parseImplementationTask validation**

Find:
```typescript
  if (
    (task['assignee'] !== 'dev_general_1' && task['assignee'] !== 'dev_general_2') ||
```
Replace with:
```typescript
  if (
    (task['assignee'] !== 'devops_engineer' && task['assignee'] !== 'dev_general' && task['assignee'] !== 'ai_engineer') ||
```

- [ ] **Step 7.3: Update parseArchitecturePlan validation**

Find the block that validates `implementationTasks.length !== 2 || assignees.size !== 2`:
```typescript
  if (
    typeof parsed['title'] !== 'string' ||
    typeof parsed['executiveSummary'] !== 'string' ||
    typeof parsed['solutionOverview'] !== 'string' ||
    typeof parsed['technicalApproach'] !== 'string' ||
    implementationTasks.length !== 2 ||
    assignees.size !== 2
  ) {
    return null
```
Replace with:
```typescript
  if (
    typeof parsed['title'] !== 'string' ||
    typeof parsed['executiveSummary'] !== 'string' ||
    typeof parsed['solutionOverview'] !== 'string' ||
    typeof parsed['technicalApproach'] !== 'string' ||
    implementationTasks.length < 2 ||
    implementationTasks.length > 3
  ) {
    return null
```

- [ ] **Step 7.4: Update the Architect LLM system prompt** to instruct it to create 3 tasks (devops_engineer, dev_general, ai_engineer) instead of 2.

Find the Architect's `systemPrompt` string in `runArchitectAgent`. It should contain instructions to assign tasks. Add/update the section that describes worker assignment to say:

```
## Worker Task Assignment

You MUST create implementationTasks for these workers:

1. devops_engineer (REQUIRED, always first):
   - Scaffold and infrastructure: npm/pnpm init, package.json, tsconfig, .gitignore, Dockerfile if needed, install dependencies, verify build
   - This task has no dependencies (runs first)

2. dev_general (REQUIRED, runs after devops_engineer):
   - Main application implementation: routes, components, business logic, database models, API handlers
   - Depends on devops_engineer completing first

3. ai_engineer (OPTIONAL — include only if the project involves AI/LLM features, embeddings, RAG, semantic search, or AI integrations):
   - AI-powered features, LLM API calls, prompt templates, vector search
   - Runs in parallel with dev_general after devops_engineer completes
   - If not needed, output only 2 tasks (devops_engineer + dev_general)

The implementationTasks array must have 2 entries (no AI features) or 3 entries (with AI features).
```

- [ ] **Step 7.5: Update orchestration to route devops_engineer, dev_general, ai_engineer**

In `runArchitectAgent`, find where it creates child tasks and dispatches workers. The current code calls `runDevGeneralAgent` for both dev_general_1 and dev_general_2. Update it to:
- Import `runDevOpsEngineerAgent` from `./devops_engineer.js`
- Import `runAiEngineerAgent` from `./ai_engineer.js`
- Route tasks based on `assignee`:
  - `'devops_engineer'` → `runDevOpsEngineerAgent`
  - `'dev_general'` → `runDevGeneralAgent`
  - `'ai_engineer'` → `runAiEngineerAgent`
- devops_engineer task is created WITHOUT dependency metadata (runs first)
- dev_general and ai_engineer tasks are created WITH dependency on devops_engineer task ID

Read the full architect.ts task creation section first to understand exact flow before editing.

- [ ] **Step 7.6: Update `architecturePlanToMarkdown` to show 3 workers**

In `architecturePlanToMarkdown`, the worker breakdown loop iterates over `output.implementationTasks`. This already works for any count — no change needed.

- [ ] **Step 7.7: Run typecheck**
```bash
cd backend && pnpm typecheck 2>&1 | head -40
```
Fix all type errors.

- [ ] **Step 7.8: Commit**
```bash
git add backend/src/agents/architect.ts
git commit -m "feat: update Architect to orchestrate devops_engineer + dev_general + ai_engineer"
```

---

## Task 8: Update agents.ts registry

**Files:**
- Modify: `backend/src/config/agents.ts`

- [ ] **Step 8.1: Rename dev_general_1 → dev_general**

Find:
```typescript
  dev_general_1: {
    id: 'dev_general_1',
    name: 'Developer General #1',
```
Replace with:
```typescript
  dev_general: {
    id: 'dev_general',
    name: 'Developer General',
```

- [ ] **Step 8.2: Replace dev_general_2 with devops_engineer**

Find and replace the entire `dev_general_2` block:
```typescript
  dev_general_2: {
    id: 'dev_general_2',
    name: 'Developer General #2',
    role: 'Simple implementations, boilerplate',
    team: 'dev',
    model_id: assignedModel('dev_general_2'),
    config: makeConfig({
      tools: ['github', 'shell', 'file_system'],
      maxCostPerTaskUsd: 3,
      canUseShell: true,
      canUseGitHub: true,
    }),
  },
```
With:
```typescript
  devops_engineer: {
    id: 'devops_engineer',
    name: 'DevOps Engineer',
    role: 'Project scaffolding, infrastructure setup, CI/CD, dependency management, build verification',
    team: 'dev',
    model_id: assignedModel('devops_engineer'),
    config: makeConfig({
      tools: ['github', 'shell', 'file_system', 'supabase_read'],
      maxCostPerTaskUsd: 10,
      thinkingLevel: 'medium',
      canUseShell: true,
      canUseGitHub: true,
    }),
  },

  ai_engineer: {
    id: 'ai_engineer',
    name: 'AI/LLM Engineer',
    role: 'AI integrations, LLM API calls, RAG pipelines, embeddings, prompt engineering, vector search',
    team: 'dev',
    model_id: assignedModel('ai_engineer'),
    config: makeConfig({
      tools: ['github', 'shell', 'file_system', 'supabase_read', 'browser'],
      maxCostPerTaskUsd: 15,
      thinkingLevel: 'high',
      canUseShell: true,
      canUseGitHub: true,
    }),
  },
```

- [ ] **Step 8.3: Add automation_specialist** (after behavioral_coach or at end of specialists section):

```typescript
  automation_specialist: {
    id: 'automation_specialist',
    name: 'Automation Specialist',
    role: 'Design automation workflows for n8n, Zapier, Make, webhooks, and API orchestration',
    team: 'ops',
    model_id: assignedModel('automation_specialist'),
    config: makeConfig({
      tools: ['supabase_read', 'file_export', 'browser', 'web_search'],
      maxCostPerTaskUsd: 5,
      thinkingLevel: 'high',
    }),
  },
```

- [ ] **Step 8.4: Run typecheck**
```bash
cd backend && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 8.5: Commit**
```bash
git add backend/src/config/agents.ts
git commit -m "feat: update agent registry — dev_general, devops_engineer, ai_engineer, automation_specialist"
```

---

## Task 9: Wire new agents into the task dispatcher

**Files:**
- Modify: `backend/src/services/tool-executor.ts` (or wherever agent routing happens — check where `runDevGeneralAgent` is dispatched)

- [ ] **Step 9.1: Find the dispatcher**

Run:
```bash
grep -r "runDevGeneralAgent\|runArchitectAgent\|runQaAgent" backend/src --include="*.ts" -l
```

- [ ] **Step 9.2: Add imports for new agents**

In the file that dispatches to agent runners, add:
```typescript
import { runDevOpsEngineerAgent } from '../agents/devops_engineer.js'
import { runAiEngineerAgent } from '../agents/ai_engineer.js'
import { runAutomationSpecialistAgent } from '../agents/automation_specialist.js'
```

- [ ] **Step 9.3: Add routing cases**

In the agent dispatch switch/if-else, add:
```typescript
case 'devops_engineer':
  return runDevOpsEngineerAgent(task, notify)
case 'ai_engineer':
  return runAiEngineerAgent(task, notify)
case 'automation_specialist':
  return runAutomationSpecialistAgent(task, notify)
```

Also update `dev_general_1` routing to `dev_general`:
```typescript
case 'dev_general_1':   // backward compat
case 'dev_general':
  return runDevGeneralAgent(task, notify)
```

- [ ] **Step 9.4: Run typecheck**
```bash
cd backend && pnpm typecheck
```
Expected: no errors. This is the full typecheck — must be clean.

- [ ] **Step 9.5: Commit**
```bash
git add backend/src/services/tool-executor.ts
git commit -m "feat: wire devops_engineer, ai_engineer, automation_specialist into task dispatcher"
```

---

## Task 10: Update docs

**Files:**
- Modify: `docs/AGENTS_AND_TEAMS.md`
- Modify: `docs/PROJECT_TRACKING.md`

- [ ] **Step 10.1: Update AGENTS_AND_TEAMS.md Team Software Dev section**

Update the tree at the top to reflect new structure:
```
├── Team Software Dev
│   ├── Architect (GPT-5.4)
│   ├── Dev General (GPT-5.4 / Gemini 2.5 Flash)
│   ├── DevOps Engineer (GPT-5.4)
│   ├── AI/LLM Engineer (GPT-5.4)
│   └── QA (Gemini 2.5 Flash)
```

Update the Team Software Dev section docs to describe:
- Dev General (was dev_general_1) — main implementation
- DevOps Engineer (new) — scaffold, infrastructure, build verification
- AI/LLM Engineer (new) — AI features, LLM APIs, RAG

Add automation_specialist to Specialist Agents section.

Update the Runtime Implementation Status table.

- [ ] **Step 10.2: Update PROJECT_TRACKING.md**

Add T128 to the Active Build Queue table and Recent Completed Work.

Describe the agentic loop + team refactor. Mark it Done when complete.

- [ ] **Step 10.3: Commit docs**
```bash
git add docs/AGENTS_AND_TEAMS.md docs/PROJECT_TRACKING.md
git commit -m "docs: update AGENTS_AND_TEAMS for agentic loop + Team Dev refactor"
```

---

## Task 11: Final typecheck + smoke test

- [ ] **Step 11.1: Full typecheck**
```bash
cd backend && pnpm typecheck
```
Expected: zero errors.

- [ ] **Step 11.2: Start the backend**
```bash
cd backend && pnpm dev
```
Expected: starts without errors, all 28 agents marked online in logs.

- [ ] **Step 11.3: Smoke test via Telegram**

Send to the Telegram bot:
```
nuovo progetto: "Test App" — crea una semplice web app React con Vite che mostra "Hello WAI" sulla home page
```

Watch the logs:
1. CEO routes to Architect
2. Architect creates 2-3 worker tasks (devops_engineer, dev_general, optionally ai_engineer)
3. devops_engineer runs `npx create-vite@latest` or scaffolds manually
4. dev_general implements the component
5. QA runs typecheck/build
6. Task marked delivered

Expected log pattern:
```
Architect Agent: starting
DevOps Engineer Agent: starting
[agent_loop_step] iteration=1 action_type=exec_command
[agent_loop_step] iteration=2 action_type=exec_command
...
Developer General Agent: starting
[agent_loop_step] iteration=1 action_type=read_file
...
QA Agent: starting
```

- [ ] **Step 11.4: Verify deliverables**

Check `workspace/software/<project-slug>/deliverables/` for:
- `architecture_plan.md`
- `devops-scaffold-<taskid>.md`
- `dev-general-<taskid>.md` (or similar)
- `qa_report.md`

- [ ] **Step 11.5: Final commit if any fixes needed**
```bash
git add -A
git commit -m "fix: post-integration smoke test fixes"
```
