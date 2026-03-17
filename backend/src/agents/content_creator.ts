// ============================================================
// WAI – Content Creator Agent
// Produce pacchetti contenuto client-facing per marketing,
// content creation, copywriting e campagne.
// ============================================================

import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

import { runAgent } from '../services/llm.js'
import { updateTaskStatus } from '../services/supabase.js'
import { log, recordEvent } from '../services/logger.js'
import { appendProjectProgress } from '../services/workspace.js'
import { maybeMoveMarketingProjectToReview, resolveMarketingWorkspacePath } from './marketing_utils.js'
import type { Task } from '../types/index.js'

interface ContentAsset {
  format: string
  title: string
  purpose: string
  draft: string
}

interface ContentPackageOutput {
  title: string
  summary: string
  contentAngle: string
  callToAction: string
  assets: ContentAsset[]
  usageNotes: string[]
}

function normalizeStringArray(items: unknown): string[] {
  if (!Array.isArray(items)) return []
  return items.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function parseAssets(value: unknown): ContentAsset[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []

    const asset = item as Record<string, unknown>
    if (
      typeof asset['format'] !== 'string' ||
      typeof asset['title'] !== 'string' ||
      typeof asset['purpose'] !== 'string' ||
      typeof asset['draft'] !== 'string'
    ) {
      return []
    }

    return [{
      format: asset['format'],
      title: asset['title'],
      purpose: asset['purpose'],
      draft: asset['draft'],
    }]
  })
}

function parseContentPackage(raw: string): ContentPackageOutput | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  } catch {
    return null
  }

  const assets = parseAssets(parsed['assets'])
  if (
    typeof parsed['title'] !== 'string' ||
    typeof parsed['summary'] !== 'string' ||
    typeof parsed['contentAngle'] !== 'string' ||
    typeof parsed['callToAction'] !== 'string' ||
    assets.length === 0
  ) {
    return null
  }

  return {
    title: parsed['title'],
    summary: parsed['summary'],
    contentAngle: parsed['contentAngle'],
    callToAction: parsed['callToAction'],
    assets,
    usageNotes: normalizeStringArray(parsed['usageNotes']),
  }
}

function contentPackageToMarkdown(
  output: ContentPackageOutput,
  task: Task,
  clientName: string,
  projectName: string
): string {
  const today = new Date().toISOString().split('T')[0]!
  const lines: string[] = [
    `# ${output.title}`,
    ``,
    `**Client:** ${clientName}`,
    `**Project:** ${projectName}`,
    `**Date:** ${today}`,
    `**Source Task:** ${task.title}`,
    `**Owner:** Content Creator`,
    ``,
    `---`,
    ``,
    `## Summary`,
    ``,
    output.summary,
    ``,
    `## Content Angle`,
    ``,
    output.contentAngle,
    ``,
    `## Primary Call To Action`,
    ``,
    output.callToAction,
    ``,
    `## Content Assets`,
    ``,
  ]

  for (const asset of output.assets) {
    lines.push(
      `### ${asset.title}`,
      ``,
      `**Format:** ${asset.format}`,
      `**Purpose:** ${asset.purpose}`,
      ``,
      asset.draft,
      ``
    )
  }

  if (output.usageNotes.length > 0) {
    lines.push(`## Usage Notes`, ``, ...output.usageNotes.map((item) => `- ${item}`), ``)
  }

  return lines.join('\n')
}

export async function runContentCreatorAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  log.info({ taskId: task.id, title: task.title }, 'Content Creator Agent: starting')

  const projectId = task.project_id ?? (task.metadata['project_id'] as string | undefined)
  const projectName = (task.metadata['project_name'] as string | undefined) ?? task.title
  const clientName = (task.metadata['client_name'] as string | undefined) ?? 'the client'
  const clientSlug = (task.metadata['client_slug'] as string | undefined) ?? ''
  const projectSlug = (task.metadata['project_slug'] as string | undefined) ?? ''
  const campaignTitle = (task.metadata['marketing_plan_title'] as string | undefined) ?? 'Marketing delivery'
  const targetAudience = (task.metadata['target_audience'] as string | undefined) ?? ''
  const positioning = (task.metadata['positioning'] as string | undefined) ?? ''
  const keyMessages = normalizeStringArray(task.metadata['key_messages'])
  const requestedOutputs = normalizeStringArray(task.metadata['requested_outputs'])
  const workspaceAbsPath = await resolveMarketingWorkspacePath(task, projectId)

  const systemPrompt = `You are the Content Creator Agent of WAI (Wawen Autonomous Industries).
Your role: produce client-facing content packages for campaigns, launches, consulting offers, AI services, and multi-channel marketing work.

Respond with ONLY a JSON object — no markdown, no text outside JSON:
{
  "title": "<content package title>",
  "summary": "<short summary of the package>",
  "contentAngle": "<core narrative angle or editorial direction>",
  "callToAction": "<primary CTA>",
  "assets": [
    {
      "format": "<asset type such as blog post, caption set, email, script, landing page copy>",
      "title": "<asset title>",
      "purpose": "<why this asset exists>",
      "draft": "<draft copy or structured outline>"
    }
  ],
  "usageNotes": ["<note 1>", "<note 2>"]
}

Constraints:
- Produce at least 2 assets when the request is broad enough; otherwise produce the single strongest asset plus support notes.
- Keep the output immediately usable by a human reviewer or downstream publishing workflow.
- Ground the copy in the provided client/project context.` 

  const userMessage = [
    `Campaign: ${campaignTitle}`,
    `Client: ${clientName}`,
    `Project: ${projectName}`,
    `Task title: ${task.title}`,
    `Task description: ${task.description}`,
    targetAudience ? `Target audience: ${targetAudience}` : '',
    positioning ? `Positioning: ${positioning}` : '',
    keyMessages.length > 0 ? `Key messages: ${keyMessages.join(' | ')}` : '',
    requestedOutputs.length > 0 ? `Requested outputs: ${requestedOutputs.join(', ')}` : '',
    ``,
    `Produce a polished content package.`,
  ].filter(Boolean).join('\n')

  await updateTaskStatus(task.id, 'in_progress')

  try {
    const result = await runAgent(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      {
        agentId: 'content_creator',
        taskId: task.id,
        taskType: 'content',
      }
    )

    const contentPackage = parseContentPackage(result.content)
    if (!contentPackage) {
      throw new Error(
        `Content Creator could not parse content package from LLM response: ${result.content.substring(0, 200)}`
      )
    }

    let artifactPath: string | null = null
    if (workspaceAbsPath) {
      const deliverableDir = join(workspaceAbsPath, 'deliverables')
      await mkdir(deliverableDir, { recursive: true })
      const filename = `content-package-${task.id.slice(0, 8)}.md`
      artifactPath = join(deliverableDir, filename)
      await writeFile(
        artifactPath,
        contentPackageToMarkdown(contentPackage, task, clientName, projectName),
        'utf-8'
      )

      await appendProjectProgress(workspaceAbsPath, 'Content package prepared', [
        `Task: ${task.title}`,
        `Artifact: ${filename}`,
        `Summary: ${contentPackage.summary}`,
      ])
    }

    await recordEvent('task_completed', {
      agentId: 'content_creator',
      taskId: task.id,
      payload: {
        content_package_title: contentPackage.title,
        artifact_path: artifactPath,
        assets_count: contentPackage.assets.length,
        model_used: result.modelId,
        cost_usd: result.costUsd,
      },
    })

    await updateTaskStatus(task.id, 'done')

    const projectMovedToReview = await maybeMoveMarketingProjectToReview(
      task,
      projectId,
      workspaceAbsPath
    )

    const lines = [
      `✍️ *Content Creator — Package Ready*`,
      ``,
      `📌 Task: ${task.title}`,
      `👤 Client: ${clientName} | Project: ${projectName}`,
      `📝 ${contentPackage.summary}`,
      artifactPath ? `\n💾 Saved: \`${artifactPath}\`` : '',
      projectMovedToReview ? `\n🔎 Project status moved to *review*` : '',
      projectMovedToReview && clientSlug && projectSlug
        ? `💰 Pronto per la fattura: /invoice ${clientSlug}/${projectSlug}`
        : '',
    ].filter((line) => line !== '').join('\n')

    await notify(lines)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    log.error({ err, taskId: task.id }, 'Content Creator Agent error')

    await recordEvent('agent_error', {
      agentId: 'content_creator',
      taskId: task.id,
      payload: { error: errorMessage },
      severity: 'error',
    })

    await notify(`❌ *Content Creator Error*\n\nTask: ${task.title}\nError: ${errorMessage}`)

    throw err
  }
}
