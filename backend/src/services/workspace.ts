// ============================================================
// WAI – Workspace Service
// Creates and manages on-disk project folders.
// Root: <repo>/workspace/{client-slug}/{project-slug}/
// ============================================================

import { mkdir, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// workspace/ is at repo root, 3 levels up from backend/src/services/
const WORKSPACE_ROOT = join(__dirname, '..', '..', '..', 'workspace')

export function getWorkspaceRoot(): string {
  return WORKSPACE_ROOT
}

export function getClientWorkspacePath(clientSlug: string): string {
  return join(WORKSPACE_ROOT, clientSlug)
}

export function getProjectWorkspacePath(clientSlug: string, projectSlug: string): string {
  return join(WORKSPACE_ROOT, clientSlug, projectSlug)
}

/** Relative path stored in Supabase (portable across machines) */
export function getRelativeProjectPath(clientSlug: string, projectSlug: string): string {
  return `workspace/${clientSlug}/${projectSlug}`
}

// ---------------------------------------------------------------------------
// Client workspace
// ---------------------------------------------------------------------------

export async function createClientWorkspace(clientSlug: string): Promise<string> {
  const clientPath = getClientWorkspacePath(clientSlug)

  if (!existsSync(clientPath)) {
    await mkdir(clientPath, { recursive: true })
  }

  return clientPath
}

// ---------------------------------------------------------------------------
// Project workspace
// ---------------------------------------------------------------------------

export async function createProjectWorkspace(
  clientSlug: string,
  projectSlug: string,
  projectName: string,
  projectType: string = 'other',
  clientName: string = clientSlug
): Promise<string> {
  const projectPath = getProjectWorkspacePath(clientSlug, projectSlug)

  // Ensure client dir exists
  await createClientWorkspace(clientSlug)

  // Create project dir and subdirs
  for (const subdir of ['deliverables', 'assets', 'drafts']) {
    await mkdir(join(projectPath, subdir), { recursive: true })
  }

  const now = new Date().toISOString().split('T')[0]

  // brief.md
  const brief = `# Project Brief — ${projectName}

**Client:** ${clientName}
**Project:** ${projectName}
**Type:** ${projectType}
**Date:** ${now}
**Status:** Discovery

---

## Objective

_Describe the project goal here._

## Scope

_List deliverables and boundaries._

## Timeline

_Key milestones and deadlines._

## Notes

_Any additional context._
`

  // PROGRESS.md
  const progress = `# Progress Log — ${projectName}

**Client:** ${clientName}
**Started:** ${now}

---

## Updates

### ${now}
- Project workspace created.

---

## Deliverables Checklist

- [ ] Brief approved
- [ ] Work in progress
- [ ] Review
- [ ] Delivered
- [ ] Invoiced
`

  await writeFile(join(projectPath, 'brief.md'), brief, 'utf-8')
  await writeFile(join(projectPath, 'PROGRESS.md'), progress, 'utf-8')

  return projectPath
}
