import { getChildTasks, getProjectById, updateProjectStatus } from '../services/supabase.js'
import { appendProjectProgress, getProjectWorkspacePath } from '../services/workspace.js'
import type { Task } from '../types/index.js'

const MARKETING_WORKERS = new Set(['content_creator', 'social_manager'])

function parseRelativeWorkspacePath(relPath: string): string | null {
  const stripped = relPath.replace(/^workspace\//, '')
  const parts = stripped.split('/').filter(Boolean)
  if (parts.length < 2) return null
  return getProjectWorkspacePath(parts[0]!, parts[1]!)
}

export async function resolveMarketingWorkspacePath(
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

export async function maybeMoveMarketingProjectToReview(
  task: Task,
  projectId?: string,
  workspaceAbsPath?: string | null
): Promise<boolean> {
  if (!task.parent_task_id || !projectId) {
    return false
  }

  const siblings = await getChildTasks(task.parent_task_id)
  const workerTasks = siblings.filter((item) =>
    item.assignee_agent_id ? MARKETING_WORKERS.has(item.assignee_agent_id) : false
  )

  if (workerTasks.length === 0 || workerTasks.some((item) => item.status !== 'done')) {
    return false
  }

  await updateProjectStatus(projectId, 'review')

  if (workspaceAbsPath) {
    await appendProjectProgress(workspaceAbsPath, 'Marketing delivery phase complete', [
      'All marketing worker tasks are done.',
      'Project moved to review status.',
    ])
  }

  return true
}
