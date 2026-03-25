import { existsSync } from 'fs'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'

import { getProjectById } from '../services/supabase.js'
import { getProjectWorkspacePath } from '../services/workspace.js'
import { buildRepoContext } from './software_repo_runtime.js'
import type { Task } from '../types/index.js'

export const DEV_GENERAL_WORKERS = new Set(['dev_general'])
export const DEV_WORKERS = new Set(['dev_general', 'devops_engineer', 'ai_engineer'])
export const DEV_SAAS_WORKERS = new Set(['dev_saas_1', 'dev_saas_2'])

function parseRelativeWorkspacePath(relPath: string): string | null {
  const stripped = relPath.replace(/^workspace\//, '')
  const parts = stripped.split('/').filter(Boolean)
  if (parts.length < 2) return null
  return getProjectWorkspacePath(parts[0]!, parts[1]!)
}

export async function resolveSoftwareWorkspacePath(
  task: Task,
  projectId?: string
): Promise<string | null> {
  const clientSlug = task.metadata['client_slug'] as string | undefined
  const projectSlug = task.metadata['project_slug'] as string | undefined

  if (clientSlug && projectSlug) {
    return getProjectWorkspacePath(clientSlug, projectSlug)
  }

  const relPath = task.metadata['workspace_path'] as string | undefined
  if (relPath) {
    return parseRelativeWorkspacePath(relPath)
  }

  if (projectId) {
    const project = await getProjectById(projectId)
    if (project?.workspace_path) {
      return parseRelativeWorkspacePath(project.workspace_path)
    }
  }

  return null
}

export async function readOptionalFile(path: string): Promise<string> {
  if (!existsSync(path)) return ''

  try {
    return await readFile(path, 'utf-8')
  } catch {
    return ''
  }
}

export async function loadRepoContext(repoLocalPath?: string): Promise<string> {
  return buildRepoContext(repoLocalPath)
}

// Files/dirs that indicate a real project is already bootstrapped.
// README.md and .gitignore are created by initWorkspaceRepo and do NOT count.
const BOOTSTRAP_INDICATOR_FILES = new Set([
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'setup.py',
  'Gemfile',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'CMakeLists.txt',
  'index.html',
  'index.htm',
])

const BOOTSTRAP_INDICATOR_DIRS = new Set([
  'src',
  'app',
  'lib',
  'public',
  'pages',
  'components',
])

// Scaffold-only files added by initWorkspaceRepo — not meaningful for bootstrap check
const WAI_SCAFFOLD_FILES = new Set(['README.md', '.gitignore'])

export async function repoNeedsBootstrap(repoLocalPath?: string): Promise<boolean> {
  if (!repoLocalPath || !existsSync(repoLocalPath)) {
    return false
  }

  try {
    const entries = await readdir(repoLocalPath, { withFileTypes: true })

    // If repo is completely empty (excluding .git), definitely needs bootstrap
    const nonGitEntries = entries.filter((entry) => entry.name !== '.git')
    if (nonGitEntries.length === 0) return true

    // If repo has only WAI scaffold files (README.md, .gitignore), still needs bootstrap
    const nonScaffoldEntries = nonGitEntries.filter(
      (entry) => !WAI_SCAFFOLD_FILES.has(entry.name)
    )
    if (nonScaffoldEntries.length === 0) return true

    // Check for real project indicator files or dirs
    for (const entry of nonScaffoldEntries) {
      if (entry.isFile() && BOOTSTRAP_INDICATOR_FILES.has(entry.name)) return false
      if (entry.isDirectory() && BOOTSTRAP_INDICATOR_DIRS.has(entry.name)) return false
    }

    // Has some files but none are known project indicators — still bootstrap
    return true
  } catch {
    return false
  }
}

export function normalizeTaskDependencyIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

export function getTaskDependencyIds(task: Task): string[] {
  return normalizeTaskDependencyIds(task.metadata['dependency_task_ids'])
}

export function getPendingDependencyIds(task: Task, siblings: Task[]): string[] {
  const dependencyIds = getTaskDependencyIds(task)
  if (dependencyIds.length === 0) return []

  return dependencyIds.filter((dependencyId) => {
    const dependencyTask = siblings.find((item) => item.id === dependencyId)
    return !dependencyTask || dependencyTask.status !== 'done'
  })
}

export function getBlockedDependencyIds(task: Task, siblings: Task[]): string[] {
  const dependencyIds = getTaskDependencyIds(task)
  if (dependencyIds.length === 0) return []

  return dependencyIds.filter((dependencyId) => {
    const dependencyTask = siblings.find((item) => item.id === dependencyId)
    return dependencyTask?.status === 'blocked'
  })
}

export async function loadRelevantDeliverables(workspaceAbsPath: string): Promise<string[]> {
  const deliverableDir = join(workspaceAbsPath, 'deliverables')
  if (!existsSync(deliverableDir)) {
    return []
  }

  try {
    const entries = await readdir(deliverableDir, { withFileTypes: true })
    const deliverables: string[] = []

    for (const entry of entries) {
      if (!entry.isFile()) continue

      const isRelevant =
        entry.name === 'architecture_plan.md' ||
        entry.name === 'qa_report.md' ||
        entry.name.startsWith('dev-general') ||
        entry.name.startsWith('repo-execution')

      if (!isRelevant) continue

      const content = await readOptionalFile(join(deliverableDir, entry.name))
      if (!content) continue

      deliverables.push(`## ${entry.name}\n${content.slice(0, 6000)}`)
    }

    return deliverables
  } catch {
    return []
  }
}

export function sanitizeFilePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// ---------------------------------------------------------------------------
// loadAllWorkspaceContext
// Reads brief.md + ALL deliverables and returns a formatted string suitable
// for injection into any agent's prompt. Used by CEO, Architect, etc.
// ---------------------------------------------------------------------------

const PLACEHOLDER_BRIEF = '_Describe the project goal here._'
const MAX_BRIEF_CHARS = 1500
const MAX_DELIVERABLE_CHARS = 4000

export async function loadAllWorkspaceContext(workspaceAbsPath: string): Promise<string> {
  const parts: string[] = []

  // brief.md
  const briefPath = join(workspaceAbsPath, 'brief.md')
  const brief = await readOptionalFile(briefPath)
  if (brief && !brief.includes(PLACEHOLDER_BRIEF)) {
    parts.push(`### Project Brief\n${brief.slice(0, MAX_BRIEF_CHARS)}`)
  }

  // All deliverables
  const deliverableDir = join(workspaceAbsPath, 'deliverables')
  if (!existsSync(deliverableDir)) return parts.join('\n\n')

  try {
    const entries = await readdir(deliverableDir, { withFileTypes: true })
    const files = entries.filter((e) => e.isFile()).sort((a, b) => a.name.localeCompare(b.name))

    if (files.length === 0) return parts.join('\n\n')

    parts.push(`### Existing Deliverables (${files.length} file${files.length > 1 ? 's' : ''})`)
    for (const file of files) {
      const content = await readOptionalFile(join(deliverableDir, file.name))
      if (!content) continue
      parts.push(`#### ${file.name}\n${content.slice(0, MAX_DELIVERABLE_CHARS)}`)
    }
  } catch {
    // ignore readdir failures
  }

  return parts.join('\n\n')
}
