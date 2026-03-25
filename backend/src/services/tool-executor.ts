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
import { sendEmail } from './email.js'
import { searchWeb, type WebSearchResponse } from './search.js'
import {
  createPersonalWorkspace,
  getPersonalOutputPath,
  getProjectOutputPath,
  getProjectWorkspacePath,
  getWorkspaceRoot,
  resolveWorkspacePath,
} from './workspace.js'
import { getClientBySlug, getProjectBySlug } from './supabase.js'
import { getToolsForAgent, validateToolEnvVars } from '../tools/index.js'
import { ensurePersonalProfile } from './personal-context.js'
import { recordCapabilityEvent } from './logger.js'
import { generatePdfFromHtml, markdownToPdfHtml } from './document-generator.js'
import { captureScreenshot } from './screenshot.js'

export type ExecutableToolId = 'file_export' | 'email' | 'web_search' | 'screenshot'

export interface ToolExecutionContext {
  agentId: string
  taskId?: string
}

export interface ScreenshotToolInput {
  url: string
  filename?: string
  clientSlug?: string
  projectSlug?: string
  workspacePath?: string
}

export interface FileExportInput {
  content: string
  filename?: string
  title?: string
  format?: 'md' | 'txt' | 'csv' | 'json' | 'html' | 'pdf'
  clientSlug?: string
  projectSlug?: string
  workspacePath?: string
  mode?: 'company' | 'personal'
  ownerSlug?: string
}

export interface EmailToolInput {
  to?: string | string[]
  subject: string
  body?: string
  html?: string
  ownerSlug?: string
}

export interface WebSearchToolInput {
  query: string
  limit?: number
}

export interface ToolExecutionResult {
  toolId: ExecutableToolId
  summary: string
  relativePath?: string
  absolutePath?: string
  search?: WebSearchResponse
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

  if (input.clientSlug) {
    const clientDir = join(getWorkspaceRoot(), input.clientSlug, 'output')
    return {
      absoluteDir: clientDir,
      relativeDir: `workspace/${input.clientSlug}/output`,
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

  if (input.format === 'pdf') {
    // Route through Playwright headless PDF renderer
    const html = input.content.trimStart().startsWith('<')
      ? input.content
      : markdownToPdfHtml(input.content, {
          title: input.title ?? input.filename ?? 'Document',
        })
    await generatePdfFromHtml(html, absolutePath)
  } else {
    await writeFile(absolutePath, input.content, 'utf-8')
  }

  await recordCapabilityEvent({
    capability_id: 'integration.local_workspace_filesystem',
    event_type: 'used',
    actor_type: 'agent',
    source: 'tool-executor:file_export',
    summary: `File exported: ${relativePath}`,
    payload: {
      filename,
      relative_path: relativePath,
      format: input.format ?? 'md',
      mode: input.mode ?? 'personal',
      // size_bytes reflects source content (markdown/html), not the PDF binary size
      size_bytes: Buffer.byteLength(input.content, 'utf-8'),
    },
  })

  return {
    toolId: 'file_export',
    summary: `Documento esportato in \`${relativePath}\``,
    relativePath,
    absolutePath,
  }
}

async function executeEmailTool(input: EmailToolInput): Promise<ToolExecutionResult> {
  const subject = input.subject.trim()
  if (!subject) {
    throw new Error('email requires a non-empty subject')
  }

  const ownerSlug = sanitizeSegment(input.ownerSlug ?? 'neb') || 'neb'
  const profile = await ensurePersonalProfile(ownerSlug)
  const recipients = input.to ?? profile.primaryEmail ?? undefined
  if (!recipients) {
    throw new Error(`No recipient configured for owner ${ownerSlug}; set primaryEmail in personal profile or pass "to" explicitly`)
  }

  const result = await sendEmail({
    to: recipients,
    subject,
    ...(input.body?.trim() ? { text: input.body.trim() } : {}),
    ...(input.html?.trim() ? { html: input.html.trim() } : {}),
  })

  return {
    toolId: 'email',
    summary: `Email inviata a ${result.to.join(', ')} con subject "${result.subject}"`,
  }
}

async function executeWebSearchTool(input: WebSearchToolInput): Promise<ToolExecutionResult> {
  const query = input.query.trim()
  if (!query) {
    throw new Error('web_search requires a non-empty query')
  }

  const searchResult = await searchWeb({
    query,
    ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
  })

  const answerSummary = searchResult.answerBox ? ` Risposta rapida: ${searchResult.answerBox}` : ''
  return {
    toolId: 'web_search',
    summary: `Ricerca web completata per "${query}" con ${searchResult.organic.length} risultati.${answerSummary}`.slice(0, 500),
    search: searchResult,
  }
}

async function executeScreenshotTool(input: ScreenshotToolInput): Promise<ToolExecutionResult> {
  const url = input.url.trim()
  if (!url) {
    throw new Error('screenshot requires a non-empty url')
  }

  const filename = input.filename?.trim() || `screenshot-${Date.now()}.png`
  const { absoluteDir, relativeDir } = await resolveOutputDirectory({
    content: '',
    filename,
    ...(input.clientSlug !== undefined ? { clientSlug: input.clientSlug } : {}),
    ...(input.projectSlug !== undefined ? { projectSlug: input.projectSlug } : {}),
    ...(input.workspacePath !== undefined ? { workspacePath: input.workspacePath } : {}),
  })

  await mkdir(absoluteDir, { recursive: true })
  const absolutePath = join(absoluteDir, filename)
  const relativePath = `${relativeDir}/${filename}`.replace(/\\/g, '/')

  const result = await captureScreenshot(url, absolutePath)
  if (!result.ok) {
    throw new Error(`Screenshot failed: ${result.error}`)
  }

  await recordCapabilityEvent({
    capability_id: 'research.browser_screenshot',
    event_type: 'used',
    actor_type: 'agent',
    source: 'tool-executor:screenshot',
    summary: `Screenshot captured: ${url}`,
    payload: {
      url,
      relative_path: relativePath,
    },
  })

  return {
    toolId: 'screenshot',
    summary: `Screenshot catturato per ${url} salvato in \`${relativePath}\``,
    relativePath,
    absolutePath,
  }
}

export async function executeTool(
  toolId: ExecutableToolId,
  input: FileExportInput | EmailToolInput | WebSearchToolInput | ScreenshotToolInput,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  await assertToolAccess(context.agentId, toolId)

  const startedAt = Date.now()
  const model = getModelForAgent({ agentId: context.agentId })
  const inputSummary = toolId === 'file_export'
    ? `${toolId} ${(input as FileExportInput).filename ?? (input as FileExportInput).title ?? 'document'}`
    : toolId === 'email'
      ? `${toolId} ${(input as EmailToolInput).subject ?? 'message'}`
      : toolId === 'web_search'
        ? `${toolId} ${(input as WebSearchToolInput).query ?? 'query'}`
        : `${toolId} ${(input as ScreenshotToolInput).url ?? 'url'}`

  try {
    const result = toolId === 'file_export'
      ? await executeFileExport(input as FileExportInput)
      : toolId === 'email'
        ? await executeEmailTool(input as EmailToolInput)
        : toolId === 'web_search'
          ? await executeWebSearchTool(input as WebSearchToolInput)
          : await executeScreenshotTool(input as ScreenshotToolInput)

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
