# T111 — MCP GitHub Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual/missing GitHub remote setup with automatic GitHub repo creation via REST API during `initWorkspaceRepo`, so the delivery pipeline can push without manual configuration. Also add PR and issue creation for future agent use.

**Architecture:** New `backend/src/services/github.ts` wraps the GitHub REST API using `GITHUB_TOKEN` + `GITHUB_OWNER`. After `initWorkspaceRepo` creates the local git repo and initial commit, it optionally calls `createGitHubRepo`, sets the origin remote, and pushes. The result carries `repoUrl` back to `architect.ts` which persists it to the project. PR/issue helpers are added for future agent use. A `integration.github` capability is registered.

**Tech Stack:** Node.js 22, TypeScript strict, GitHub REST API (no Octokit dep, plain fetch), `GITHUB_TOKEN` + `GITHUB_OWNER` env vars.

---

## File Map

| File | Change |
|------|--------|
| `backend/src/services/github.ts` | NEW: GitHub REST API client — createRepo, createPullRequest, createIssue, isGitHubConfigured |
| `backend/src/agents/software_repo_runtime.ts` | Integrate GitHub repo creation + push after local init |
| `backend/src/agents/architect.ts` | Persist `repo_url` + `repo_provider` from init result |
| `backend/src/services/capabilities.ts` | Register `integration.github` capability |

---

### Task 1: Create `backend/src/services/github.ts`

**Files:**
- Create: `backend/src/services/github.ts`

- [ ] **Step 1: Write the github service file**

```typescript
// ============================================================
// WAI – GitHub REST API client
// Wraps repo create, PR, and issue operations.
// Requires GITHUB_TOKEN + GITHUB_OWNER env vars.
// ============================================================

import { log } from './logger.js'

export interface GitHubRepoCreateResult {
  name: string
  fullName: string
  cloneUrl: string
  htmlUrl: string
  owner: string
  defaultBranch: string
}

export interface GitHubPrResult {
  number: number
  url: string
}

export interface GitHubIssueResult {
  number: number
  url: string
}

function getToken(): string | null {
  return process.env['GITHUB_TOKEN']?.trim() ?? null
}

function getOwner(): string | null {
  return process.env['GITHUB_OWNER']?.trim() ?? null
}

export function isGitHubConfigured(): boolean {
  return Boolean(getToken() && getOwner())
}

async function githubFetch<T>(path: string, init: RequestInit): Promise<T> {
  const token = getToken()
  if (!token) throw new Error('GITHUB_TOKEN not configured')

  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${text.slice(0, 300)}`)
  }

  return JSON.parse(text) as T
}

function sanitizeRepoName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'wai-project'
}

interface GitHubApiRepo {
  name: string
  full_name: string
  clone_url: string
  html_url: string
  owner: { login: string }
  default_branch: string
}

export async function createGitHubRepo(
  projectName: string,
  options: { description?: string; isPrivate?: boolean } = {}
): Promise<GitHubRepoCreateResult> {
  const owner = getOwner()
  if (!owner) throw new Error('GITHUB_OWNER not configured')

  const repoName = sanitizeRepoName(projectName)
  const isOrg = owner.includes('/')

  const path = isOrg
    ? `/orgs/${encodeURIComponent(owner)}/repos`
    : '/user/repos'

  const repo = await githubFetch<GitHubApiRepo>(path, {
    method: 'POST',
    body: JSON.stringify({
      name: repoName,
      description: options.description ?? `WAI — ${projectName}`,
      private: options.isPrivate ?? true,
      auto_init: false,
    }),
  })

  log.info({ repoName, htmlUrl: repo.html_url }, 'GitHub: repo created')

  return {
    name: repo.name,
    fullName: repo.full_name,
    cloneUrl: repo.clone_url,
    htmlUrl: repo.html_url,
    owner: repo.owner.login,
    defaultBranch: repo.default_branch,
  }
}

interface GitHubApiPr {
  number: number
  html_url: string
}

export async function createPullRequest(
  owner: string,
  repo: string,
  options: { title: string; body?: string; head: string; base?: string }
): Promise<GitHubPrResult> {
  const pr = await githubFetch<GitHubApiPr>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title: options.title,
      body: options.body ?? '',
      head: options.head,
      base: options.base ?? 'main',
    }),
  })

  log.info({ owner, repo, prNumber: pr.number }, 'GitHub: PR created')

  return { number: pr.number, url: pr.html_url }
}

interface GitHubApiIssue {
  number: number
  html_url: string
}

export async function createIssue(
  owner: string,
  repo: string,
  options: { title: string; body?: string; labels?: string[] }
): Promise<GitHubIssueResult> {
  const issue = await githubFetch<GitHubApiIssue>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, {
    method: 'POST',
    body: JSON.stringify({
      title: options.title,
      body: options.body ?? '',
      labels: options.labels ?? [],
    }),
  })

  log.info({ owner, repo, issueNumber: issue.number }, 'GitHub: issue created')

  return { number: issue.number, url: issue.html_url }
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd backend && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/github.ts
git commit -m "feat(T111): add GitHub REST API service (createRepo, createPR, createIssue)"
```

---

### Task 2: Integrate GitHub repo creation into `initWorkspaceRepo`

**Files:**
- Modify: `backend/src/agents/software_repo_runtime.ts`
  - `WorkspaceRepoInitResult` interface: add `repoUrl?: string`
  - `initWorkspaceRepo`: after initial commit, optionally call `createGitHubRepo`, set remote, push

- [ ] **Step 1: Add `repoUrl` to `WorkspaceRepoInitResult`**

Change:
```typescript
export interface WorkspaceRepoInitResult {
  repoPath: string
  alreadyExisted: boolean
  committed: boolean
  warnings: string[]
}
```
To:
```typescript
export interface WorkspaceRepoInitResult {
  repoPath: string
  alreadyExisted: boolean
  committed: boolean
  warnings: string[]
  repoUrl?: string
}
```

- [ ] **Step 2: Add import for GitHub service**

Near the top imports of `software_repo_runtime.ts`, add:
```typescript
import { createGitHubRepo, isGitHubConfigured } from '../services/github.js'
```

- [ ] **Step 3: Add GitHub remote creation after initial commit**

After the `return { repoPath, alreadyExisted: false, committed, warnings }` block but before it returns, insert GitHub integration:

Replace:
```typescript
  return { repoPath, alreadyExisted: false, committed, warnings }
}
```
With:
```typescript
  // Optionally create a GitHub remote repo and push
  let repoUrl: string | undefined
  if (committed && isGitHubConfigured()) {
    try {
      const ghRepo = await createGitHubRepo(projectName, { description: `WAI — ${projectName}` })
      const tokenizedUrl = `https://x-access-token:${process.env['GITHUB_TOKEN']}@github.com/${ghRepo.fullName}.git`
      await runGit(repoPath, ['remote', 'add', 'origin', tokenizedUrl])
      await runGit(repoPath, ['push', '-u', 'origin', 'main'])
      repoUrl = ghRepo.htmlUrl
    } catch (err) {
      warnings.push(
        `GitHub remote setup failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  return { repoPath, alreadyExisted: false, committed, warnings, repoUrl }
}
```

- [ ] **Step 4: Run typecheck**

```bash
cd backend && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/software_repo_runtime.ts
git commit -m "feat(T111): initWorkspaceRepo auto-creates GitHub remote + pushes initial commit"
```

---

### Task 3: Persist `repo_url` from init result in `architect.ts`

**Files:**
- Modify: `backend/src/agents/architect.ts` — after `initWorkspaceRepo` block (around line 221–226)

- [ ] **Step 1: Update the `updateProjectRepo` call to include `repo_url`**

Change:
```typescript
      if (!initResult.alreadyExisted) {
        await updateProjectRepo(projectId, { repo_local_path: initResult.repoPath })
        log.info(
          { taskId: task.id, repoPath: initResult.repoPath, committed: initResult.committed },
          'Architect: auto-initialized workspace repo'
        )
      }
```
To:
```typescript
      if (!initResult.alreadyExisted) {
        await updateProjectRepo(projectId, {
          repo_local_path: initResult.repoPath,
          ...(initResult.repoUrl ? { repo_url: initResult.repoUrl, repo_provider: 'github' } : {}),
        })
        log.info(
          {
            taskId: task.id,
            repoPath: initResult.repoPath,
            committed: initResult.committed,
            repoUrl: initResult.repoUrl,
          },
          'Architect: auto-initialized workspace repo'
        )
      }
```

- [ ] **Step 2: Propagate `repoUrl` into task metadata**

After the `if (!initResult.alreadyExisted)` block, find where `effectiveRepoLocalPath` is set. The task metadata is built later in the `runArchitectAgent` function when spawning dev_general tasks. Find the line that builds `metadata` for child tasks and add:

In the metadata spread for child tasks (search for `repo_local_path: effectiveRepoLocalPath`), add:
```typescript
repo_url: initResult.repoUrl ?? repoUrl,
```
if `initResult.repoUrl` is available in scope.

Actually, store the repoUrl from init and use it when available:

After the `initWorkspaceRepo` try/catch block, add:
```typescript
      const effectiveRepoUrl = initResult.repoUrl ?? repoUrl
```

Then where `repoUrl` is referenced in task metadata creation, use `effectiveRepoUrl` instead.

- [ ] **Step 3: Run typecheck**

```bash
cd backend && pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/agents/architect.ts
git commit -m "feat(T111): persist repo_url from auto-init into project + task metadata"
```

---

### Task 4: Register `integration.github` capability

**Files:**
- Modify: `backend/src/services/capabilities.ts`

- [ ] **Step 1: Find where integrations are registered and add GitHub**

Search for where other integrations like `integration.google_workspace` are defined and add:

```typescript
{
  id: 'integration.github',
  name: 'GitHub Integration',
  description: 'Automatic GitHub repo creation, PR and issue management via REST API',
  type: 'integration',
  status: isGitHubConfigured() ? 'active' : 'missing_config',
  owner: 'company',
  health: isGitHubConfigured()
    ? { state: 'connected', message: 'GITHUB_TOKEN + GITHUB_OWNER configured' }
    : { state: 'missing_config', message: 'Set GITHUB_TOKEN and GITHUB_OWNER to enable GitHub integration' },
  policy: { mode: 'active', notes: 'Used by Architect for auto-repo-create on software projects' },
  assignments: [
    { targetType: 'runtime', targetId: 'company', state: 'active' },
    { targetType: 'agent', targetId: 'architect', state: 'active' },
  ],
}
```

- [ ] **Step 2: Import `isGitHubConfigured` at the top of capabilities.ts**

```typescript
import { isGitHubConfigured } from './github.js'
```

- [ ] **Step 3: Run typecheck**

```bash
cd backend && pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/capabilities.ts
git commit -m "feat(T111): register integration.github capability in registry"
```

---

### Task 5: Update PROJECT_TRACKING.md

- [ ] **Step 1: Mark T111 done and add session notes**

Update build queue: `🔲 Todo` → `✅ Done`

Add to Recent Completed Work:
```
| T111 | MCP GitHub integration | ✅ Done | Auto GitHub repo creation on project init; PR/issue helpers added; integration.github capability registered |
```

Add Recent Changes entry for today.

- [ ] **Step 2: Commit**

```bash
git add docs/PROJECT_TRACKING.md
git commit -m "docs: mark T111 done, add session notes"
```

---

## Testing

1. Set `GITHUB_OWNER=<your-username>` in `.env` (+ existing `GITHUB_TOKEN`)
2. Send "crea progetto test-t111 per test-client di tipo website" on Telegram
3. Observe: Architect auto-init creates a GitHub repo named `test-t111`; `repo_url` is stored in the project
4. Verify: `integration.github` appears as `connected` in the Capabilities dashboard
5. If `GITHUB_OWNER` is not set: `initWorkspaceRepo` returns `repoUrl: undefined` + a warning; delivery pipeline is not blocked
