// ============================================================
// WAI – Tool Executor
// Validates agent permissions, executes concrete tools, and logs
// tool runs into Supabase so they appear in WAI telemetry.
// ============================================================

import { mkdir, writeFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import { getAgent } from '../config/agents.js'
import { getModelForAgent } from '../config/models.js'
import { log, recordEvent, recordRun } from './logger.js'
import {
  createPersonalWorkspace,
  getPersonalOutputPath,
  getProjectOutputPath,
  getProjectWorkspacePath,
  resolveWorkspacePath,
} from './workspace.js'
import { getClientBySlug, getProjectBySlug } from './supabase.js'
import { getToolsForAgent, validateToolEnvVars } from '../tools/index.js'

export type ExecutableToolId = 'file_export'

export interface ToolExecutionContext {
  agentId: string
  taskId?: string
}

export interface FileExportInput {
  content: string
  filename?: string
  title?: string
  format?: 'md' | 'txt' | 'csv' | 'json' | 'html'
  clientSlug?: string
  projectSlug?: string
  workspacePath?: string
  mode?: 'company' | 'personal'
  ownerSlug?: string
}

export interface ToolExecutionResult {
  toolId: ExecutableToolId
  summary: string
  relativePath: string
  absolutePath: string
}

function sanitizeSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function buildFilename(input: FileExportInput): string {
  const fallbackBase = sanitizeSegment(input.title ?? input.filename ?? 'document') || 'document'
  const rawFilename = input.filename?.trim() ? basename(input.filename.trim()) : fallbackBase
  const sanitized = sanitizeSegment(rawFilename.replace(/\.[a-z0-9]+$/i, '')) || fallbackBase
  const extension = extname(rawFilename).replace(/^\./, '') || input.format || 'md'
  return `${sanitized}.${extension}`
}

async function resolveOutputDirectory(input: FileExportInput): Promise<{ absoluteDir: string; relativeDir: string }> {
  if (input.workspacePath) {
    const workspacePath = resolveWorkspacePath(input.workspacePath)
    return {
      absoluteDir: join(workspacePath, 'output'),
      relativeDir: join(input.workspacePath.replace(/\/$/, ''), 'output'),
    }
  }

  if (input.clientSlug && input.projectSlug) {
    return {
      absoluteDir: getProjectOutputPath(input.clientSlug, input.projectSlug),
      relativeDir: `workspace/${input.clientSlug}/${input.projectSlug}/output`,
    }
  }

  if (input.mode === 'company') {
    throw new Error('file_export in company mode requires workspacePath or clientSlug/projectSlug')
  }

  const ownerSlug = sanitizeSegment(input.ownerSlug ?? 'neb') || 'neb'
  await createPersonalWorkspace(ownerSlug)
  return {
    absoluteDir: getPersonalOutputPath(ownerSlug),
    relativeDir: `workspace/personal/${ownerSlug}/output`,
  }
}

async function assertToolAccess(agentId: string, toolId: ExecutableToolId): Promise<void> {
  const agent = getAgent(agentId)
  if (!agent.config.tools.includes(toolId)) {
    throw new Error(`Agent ${agentId} is not allowed to use tool ${toolId}`)
  }

  const toolDefs = getToolsForAgent([toolId])
  const missingEnvVars = validateToolEnvVars(toolDefs)
  if (missingEnvVars.length > 0) {
    throw new Error(`Missing environment variables for ${toolId}: ${missingEnvVars.join(', ')}`)
  }
}

async function executeFileExport(
  input: FileExportInput
): Promise<ToolExecutionResult> {
  if (!input.content.trim()) {
    throw new Error('file_export requires non-empty content')
  }

  if (input.clientSlug && !input.projectSlug) {
    throw new Error('file_export requires projectSlug when clientSlug is provided')
  }

  if (input.clientSlug && input.projectSlug) {
    const client = await getClientBySlug(input.clientSlug)
    if (!client) {
      throw new Error(`Client ${input.clientSlug} not found`)
    }

    const project = await getProjectBySlug(client.id, input.projectSlug)
    if (!project) {
      throw new Error(`Project ${input.clientSlug}/${input.projectSlug} not found`)
    }

    void getProjectWorkspacePath(input.clientSlug, input.projectSlug)
  }

  const filename = buildFilename(input)
  const { absoluteDir, relativeDir } = await resolveOutputDirectory(input)
  await mkdir(absoluteDir, { recursive: true })

  const absolutePath = join(absoluteDir, filename)
  const relativePath = `${relativeDir}/${filename}`.replace(/\\/g, '/')
  await writeFile(absolutePath, input.content, 'utf-8')

  return {
    toolId: 'file_export',
    summary: `Documento esportato in \`${relativePath}\``,
    relativePath,
    absolutePath,
  }
}

export async function executeTool(
  toolId: ExecutableToolId,
  input: FileExportInput,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  await assertToolAccess(context.agentId, toolId)

  const startedAt = Date.now()
  const model = getModelForAgent({ agentId: context.agentId })
  const inputSummary = `${toolId} ${input.filename ?? input.title ?? 'document'}`

  try {
    const result = await executeFileExport(input)

    await recordRun({
      agent_id: context.agentId,
      ...(context.taskId ? { task_id: context.taskId } : {}),
      model_id: model.id,
      input_summary: inputSummary.slice(0, 500),
      output_summary: result.summary.slice(0, 500),
      tokens_input: 0,
      tokens_output: 0,
      tools_used: [toolId],
      outcome: 'success',
      duration_ms: Date.now() - startedAt,
    })

    await recordEvent('run_completed', {
      agentId: context.agentId,
      ...(context.taskId ? { taskId: context.taskId } : {}),
      payload: {
        tool_id: toolId,
        path: result.relativePath,
        message: result.summary,
      },
    })

    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error({ err, toolId, agentId: context.agentId, taskId: context.taskId }, 'Tool execution failed')

    await recordRun({
      agent_id: context.agentId,
      ...(context.taskId ? { task_id: context.taskId } : {}),
      model_id: model.id,
      input_summary: inputSummary.slice(0, 500),
      output_summary: '',
      tokens_input: 0,
      tokens_output: 0,
      tools_used: [toolId],
      outcome: 'failure',
      error_message: message.slice(0, 500),
      duration_ms: Date.now() - startedAt,
    })

    await recordEvent('run_failed', {
      agentId: context.agentId,
      ...(context.taskId ? { taskId: context.taskId } : {}),
      severity: 'warning',
      payload: {
        tool_id: toolId,
        message,
      },
    })

    throw err
  }
}
