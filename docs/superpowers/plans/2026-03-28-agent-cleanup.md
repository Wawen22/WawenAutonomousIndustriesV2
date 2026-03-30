# Agent Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove 7 redundant/unused agents from WAI's active registry, consolidating the system from 28 to 21 agents (13 core + 8 on-demand specialists), making CEO routing cleaner and the system more concrete.

**Architecture:** Agent files are moved to an `_archived/` folder (not deleted, preserving history). All references are removed from the registry, model config, CEO routing prompt, dispatch switch, and startup. Existing DB tasks that referenced removed agents are handled with graceful redirects in the dispatch switch.

**Tech Stack:** TypeScript, Node.js — no new dependencies.

---

## Agents being removed (7)

| Agent | Reason | Successor in dispatch |
|---|---|---|
| `pm_saas` | Fully absorbed by `dev_lead_saas` | → `runDevLeadSaasAgent` |
| `ai_engineer` | Absorbed by `dev_general` | → `runDevGeneralAgent` |
| `automation_specialist` | Absorbed by `dev_general` / `devops_engineer` | → `runDevGeneralAgent` |
| `content_creator` | Duplicate of `content_writer` (which is the active one) | → `runContentWriterAgent` |
| `social_manager` | Never wired to a real posting workflow | throw "retired" |
| `hr` | Meta-agent, no real delivery output | throw "retired" |
| `behavioral_coach` | Never wired to any workflow | throw "retired" |

## Files touched

| File | Change |
|---|---|
| `backend/src/agents/_archived/` (new dir) | Archive destination for 7 removed agent files |
| `backend/src/config/agents.ts` | Remove 7 agent definitions |
| `backend/src/config/models.ts` | Remove 7 model assignments + remove `hr` from `SIMPLE_TASK_TYPES` set |
| `backend/src/agents/ceo.ts` | Remove imports + routing hints for 7 agents |
| `backend/src/services/founder_task_actions.ts` | Remove imports, replace switch cases with redirects/retired throws |
| `backend/src/index.ts` | Remove `startHrRuntime` import + call |

---

## Task 1: Create archive folder and move agent files

**Files:**
- Create: `backend/src/agents/_archived/` (directory)
- Move: `behavioral_coach.ts`, `hr.ts`, `content_creator.ts`, `social_manager.ts`, `pm_saas.ts`, `ai_engineer.ts`, `automation_specialist.ts`

- [ ] **Step 1: Create archive folder and move the 7 files**

```bash
mkdir -p backend/src/agents/_archived
mv backend/src/agents/behavioral_coach.ts backend/src/agents/_archived/
mv backend/src/agents/hr.ts backend/src/agents/_archived/
mv backend/src/agents/content_creator.ts backend/src/agents/_archived/
mv backend/src/agents/social_manager.ts backend/src/agents/_archived/
mv backend/src/agents/pm_saas.ts backend/src/agents/_archived/
mv backend/src/agents/ai_engineer.ts backend/src/agents/_archived/
mv backend/src/agents/automation_specialist.ts backend/src/agents/_archived/
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/agents/_archived/
git add backend/src/agents/behavioral_coach.ts backend/src/agents/hr.ts backend/src/agents/content_creator.ts backend/src/agents/social_manager.ts backend/src/agents/pm_saas.ts backend/src/agents/ai_engineer.ts backend/src/agents/automation_specialist.ts
git commit -m "chore: archive 7 unused agent files"
```

---

## Task 2: Clean agents.ts registry

**Files:**
- Modify: `backend/src/config/agents.ts`

Remove the following blocks from `AGENTS`:
- `pm_saas` (lines ~69–80)
- `ai_engineer` (lines ~170–183)
- `automation_specialist` (lines ~185–197)
- `content_creator` (lines ~259–269)
- `social_manager` (lines ~271–282)
- `hr` (lines ~315–325)
- `behavioral_coach` (lines ~420–431)

- [ ] **Step 1: Remove pm_saas from agents.ts**

Delete the entire block:
```typescript
  pm_saas: {
    id: 'pm_saas',
    name: 'Product Manager – SaaS',
    role: 'Roadmap, feature prioritization, user stories, acceptance criteria',
    team: 'saas',
    model_id: assignedModel('pm_saas'),
    config: makeConfig({
      tools: ['supabase_read', 'supabase_write_tasks', 'github_issues', 'browser'],
      thinkingLevel: 'high',
      canReadAllTasks: true,
    }),
  },
```

- [ ] **Step 2: Remove ai_engineer from agents.ts**

Delete the entire block:
```typescript
  ai_engineer: {
    id: 'ai_engineer',
    name: 'AI Engineer',
    role: 'LLM integrations, prompt engineering, RAG pipelines, vector search, embeddings',
    team: 'dev',
    model_id: assignedModel('ai_engineer'),
    config: makeConfig({
      tools: ['shell', 'file_system', 'github', 'supabase_read'],
      maxCostPerTaskUsd: 10,
      thinkingLevel: 'high',
      canUseShell: true,
      canUseGitHub: true,
    }),
  },
```

- [ ] **Step 3: Remove automation_specialist from agents.ts**

Delete the entire block:
```typescript
  automation_specialist: {
    id: 'automation_specialist',
    name: 'Automation Specialist',
    role: 'Workflow automations, n8n/Zapier/Make integrations, webhooks, data pipelines',
    team: 'dev',
    model_id: assignedModel('automation_specialist'),
    config: makeConfig({
      tools: ['shell', 'file_system', 'github', 'supabase_read', 'browser'],
      maxCostPerTaskUsd: 10,
      canUseShell: true,
      canUseGitHub: true,
    }),
  },
```

- [ ] **Step 4: Remove content_creator from agents.ts**

Delete the entire block:
```typescript
  content_creator: {
    id: 'content_creator',
    name: 'Content Creator',
    role: 'Blog posts, social copy, video scripts, email newsletters',
    team: 'marketing',
    model_id: assignedModel('content_creator'),
    config: makeConfig({
      tools: ['file_system', 'browser', 'supabase_read', 'file_export'],
      maxCostPerTaskUsd: 2,
    }),
  },
```

- [ ] **Step 5: Remove social_manager from agents.ts**

Delete the entire block:
```typescript
  social_manager: {
    id: 'social_manager',
    name: 'Social Media Manager',
    role: 'Content scheduling, engagement monitoring, metrics reporting',
    team: 'marketing',
    model_id: assignedModel('social_manager'),
    config: makeConfig({
      tools: ['browser', 'supabase_read', 'email', 'file_export'],
      maxCostPerTaskUsd: 1,
      canSendEmail: true,
    }),
  },
```

- [ ] **Step 6: Remove hr from agents.ts**

Delete the entire block:
```typescript
  hr: {
    id: 'hr',
    name: 'HR Agent',
    role: 'Agent documentation, role definitions, process docs',
    team: 'ops',
    model_id: assignedModel('hr'),
    config: makeConfig({
      tools: ['file_system', 'supabase_read', 'supabase_write_events', 'file_export'],
      maxCostPerTaskUsd: 2,
    }),
  },
```

- [ ] **Step 7: Remove behavioral_coach from agents.ts**

Delete the entire block:
```typescript
  behavioral_coach: {
    id: 'behavioral_coach',
    name: 'Behavioral Coach',
    role: 'Personal habit tracker, accountability check-ins, and productivity nudges for Neb via Telegram',
    team: 'ops',
    model_id: assignedModel('behavioral_coach'),
    config: makeConfig({
      tools: ['supabase_read', 'telegram_notify'],
      maxCostPerTaskUsd: 1,
      canSendTelegram: true,
    }),
  },
```

- [ ] **Step 8: Commit**

```bash
git add backend/src/config/agents.ts
git commit -m "chore: remove 7 retired agents from registry"
```

---

## Task 3: Clean models.ts

**Files:**
- Modify: `backend/src/config/models.ts`

- [ ] **Step 1: Remove 7 model assignments from AGENT_MODEL_DEFAULTS**

Find and delete these 7 lines from the `AGENT_MODEL_DEFAULTS` object:
```typescript
  pm_saas: 'nemotron-120b',
  ai_engineer: 'minimax-m2.7',
  automation_specialist: 'minimax-m2.7',
  content_creator: 'glm-4.5-air',
  social_manager: 'glm-4.5-air',
  hr: 'glm-4.5-air',
  behavioral_coach: 'glm-4.5-air',
```

- [ ] **Step 2: Remove 'hr' from SIMPLE_TASK_TYPES set**

Find the `SIMPLE_TASK_TYPES` set and remove `'hr'` from it:
```typescript
// Before:
const SIMPLE_TASK_TYPES = new Set<TaskType>([
  'dev_simple',
  'marketing',
  'content',
  'support',
  'routing',
  'hr',
])

// After:
const SIMPLE_TASK_TYPES = new Set<TaskType>([
  'dev_simple',
  'marketing',
  'content',
  'support',
  'routing',
])
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/config/models.ts
git commit -m "chore: remove model assignments for retired agents"
```

---

## Task 4: Update CEO routing (ceo.ts)

**Files:**
- Modify: `backend/src/agents/ceo.ts`

Remove imports and routing hint lines for the 7 retired agents. CEO should route content tasks to `content_writer`, SaaS tasks directly to `dev_lead_saas`, dev/automation tasks to `dev_general`.

- [ ] **Step 1: Remove 7 imports at the top of ceo.ts**

Find and delete:
```typescript
import { runPmSaasAgent } from './pm_saas.js'
import { runContentCreatorAgent } from './content_creator.js'
import { runSocialManagerAgent } from './social_manager.js'
import { runAiEngineerAgent } from './ai_engineer.js'
import { runAutomationSpecialistAgent } from './automation_specialist.js'
import { runHrAgent } from './hr.js'
import { runBehavioralCoachAgent } from './behavioral_coach.js'
```

- [ ] **Step 2: Remove routing hints from CEO prompt**

In the CEO system prompt, find and remove the routing lines for retired agents. Specifically remove:
- The `pm_saas` routing hint (merge its description into `dev_lead_saas` hint)
- The `content_creator` routing hint line
- The `social_manager` routing hint line
- The `ai_engineer` routing hint line
- The `automation_specialist` routing hint line
- The `hr` routing hint line
- The `behavioral_coach` routing hint line

Update the `content_writer` hint to clarify it handles all content (blog, social, newsletter):
```
- content_writer – Content Writer: web research + autonomous content generation — blog posts, social posts, newsletters, scripts. USE THIS for all content creation tasks.
```

Update the `dev_general` hint to absorb AI engineering and automation:
```
- dev_general     – Developer General: full implementation, refactoring, debugging, tests, LLM integrations, automation scripts, webhooks — USE THIS for all implementation tasks not requiring full SaaS team coordination
```

Update the `dev_lead_saas` hint to absorb pm_saas:
```
- dev_lead_saas   – Dev Lead SaaS: technical planning, sprint planning, roadmap, feature prioritization, user stories, subtask creation, PR reviews — USE THIS for SaaS product coordination
```

- [ ] **Step 3: Remove delegation check for pm_saas in CEO dispatch logic**

Search for `delegation.delegateTo === 'pm_saas'` in ceo.ts and replace the handler to redirect to `dev_lead_saas`:
```typescript
if (delegation.delegateTo === 'dev_lead_saas' || delegation.delegateTo === 'pm_saas') {
  await runDevLeadSaasAgent(delegatedTask, notify)
}
```
Actually check exact usage first and update accordingly.

- [ ] **Step 4: Commit**

```bash
git add backend/src/agents/ceo.ts
git commit -m "chore: remove retired agents from CEO routing"
```

---

## Task 5: Update founder_task_actions.ts dispatch

**Files:**
- Modify: `backend/src/services/founder_task_actions.ts`

The dispatch switch handles task retries. We keep the cases for retired agents but redirect to successor agents (for backwards compat with existing DB tasks). For agents with no successor, throw a descriptive error.

- [ ] **Step 1: Replace 7 imports with the appropriate successor imports**

Remove these 7 imports:
```typescript
import { runPmSaasAgent } from '../agents/pm_saas.js'
import { runContentCreatorAgent } from '../agents/content_creator.js'
import { runSocialManagerAgent } from '../agents/social_manager.js'
import { runAiEngineerAgent } from '../agents/ai_engineer.js'
import { runAutomationSpecialistAgent } from '../agents/automation_specialist.js'
import { runHrAgent } from '../agents/hr.js'
import { runBehavioralCoachAgent } from '../agents/behavioral_coach.js'
```

Add import for content_writer if not already present:
```typescript
import { runContentWriterAgent } from '../agents/content_writer.js'
```

(Verify `runDevLeadSaasAgent`, `runDevGeneralAgent` are already imported — they should be.)

- [ ] **Step 2: Update switch cases for redirected agents**

Replace the `pm_saas`, `ai_engineer`, `automation_specialist`, `content_creator` cases to redirect:
```typescript
    case 'pm_saas':
      await runDevLeadSaasAgent(task, notify)
      return
    case 'ai_engineer':
    case 'automation_specialist':
      await runDevGeneralAgent(task, notify)
      return
    case 'content_creator':
      await runContentWriterAgent(task, notify)
      return
```

Replace `social_manager`, `hr`, `behavioral_coach` cases with a clear retired error:
```typescript
    case 'social_manager':
    case 'hr':
    case 'behavioral_coach':
      throw new Error(`Agent '${task.assignee_agent_id}' has been retired. This task cannot be retried.`)
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/founder_task_actions.ts
git commit -m "chore: redirect retired agents in dispatch switch"
```

---

## Task 6: Update index.ts startup

**Files:**
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Remove startHrRuntime import and call**

Find and remove:
```typescript
import { startHrRuntime } from './agents/hr.js'
```

And the call (around line 3223):
```typescript
startHrRuntime(sendFounderNotification)
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/index.ts
git commit -m "chore: remove HR runtime startup"
```

---

## Task 7: Typecheck

- [ ] **Step 1: Run typecheck**

```bash
cd backend && pnpm typecheck
```

Expected: 0 errors. If errors appear, they will be residual references to retired agents — fix each one by removing the reference or redirecting to the successor.

---

## Task 8: Update documentation

**Files:**
- Modify: `docs/AGENTS_AND_TEAMS.md`
- Modify: `docs/PROJECT_TRACKING.md`

- [ ] **Step 1: Update AGENTS_AND_TEAMS.md**

Remove retired agents from the agent list. Add a note that `content_creator`, `pm_saas`, `ai_engineer`, `automation_specialist` have been merged into their successors. Add a section `_archived/` listing them for historical reference.

- [ ] **Step 2: Update PROJECT_TRACKING.md**

Add a note in "What WAI Can Do Today" reflecting the consolidated agent set (21 agents: 13 core + 8 on-demand specialists). Update Active Build Queue if needed.

- [ ] **Step 3: Commit**

```bash
git add docs/AGENTS_AND_TEAMS.md docs/PROJECT_TRACKING.md
git commit -m "docs: update agent list after cleanup"
```
