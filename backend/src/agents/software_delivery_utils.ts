import { existsSync } from 'fs'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'

import { getProjectById } from '../services/supabase.js'
import { getProjectWorkspacePath } from '../services/workspace.js'
import { buildRepoContext } from './software_repo_runtime.js'
import type { Task } from '../types/index.js'

export const DEV_GENERAL_WORKERS = new Set(['dev_general_1', 'dev_general_2'])
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

export async function repoNeedsBootstrap(repoLocalPath?: string): Promise<boolean> {
  if (!repoLocalPath || !existsSync(repoLocalPath)) {
    return false
  }

  try {
    const entries = await readdir(repoLocalPath, { withFileTypes: true })
    const meaningfulEntries = entries.filter((entry) => entry.name !== '.git')
    return meaningfulEntries.length === 0
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
