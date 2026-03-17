// ============================================================
// WAI – Social Manager Agent
// Produce calendari di distribuzione e posting plan social.
// ============================================================

import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

import { runAgent } from '../services/llm.js'
import { updateTaskStatus } from '../services/supabase.js'
import { log, recordEvent } from '../services/logger.js'
import { appendProjectProgress } from '../services/workspace.js'
import { maybeMoveMarketingProjectToReview, resolveMarketingWorkspacePath } from './marketing_utils.js'
import type { Task } from '../types/index.js'

interface CalendarEntry {
  dayLabel: string
  channel: string
  content: string
  objective: string
  cta: string
}

interface SocialCalendarOutput {
  title: string
  summary: string
  channelStrategy: string
  postingCadence: string
  calendarEntries: CalendarEntry[]
  monitoringNotes: string[]
}

function normalizeStringArray(items: unknown): string[] {
  if (!Array.isArray(items)) return []
  return items.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function parseCalendarEntries(value: unknown): CalendarEntry[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []

    const entry = item as Record<string, unknown>
    if (
      typeof entry['dayLabel'] !== 'string' ||
      typeof entry['channel'] !== 'string' ||
      typeof entry['content'] !== 'string' ||
      typeof entry['objective'] !== 'string' ||
      typeof entry['cta'] !== 'string'
    ) {
      return []
    }

    return [{
      dayLabel: entry['dayLabel'],
      channel: entry['channel'],
      content: entry['content'],
      objective: entry['objective'],
      cta: entry['cta'],
    }]
  })
}

function parseSocialCalendar(raw: string): SocialCalendarOutput | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  } catch {
    return null
  }

  const calendarEntries = parseCalendarEntries(parsed['calendarEntries'])
  if (
    typeof parsed['title'] !== 'string' ||
    typeof parsed['summary'] !== 'string' ||
    typeof parsed['channelStrategy'] !== 'string' ||
    typeof parsed['postingCadence'] !== 'string' ||
    calendarEntries.length === 0
  ) {
    return null
  }

  return {
    title: parsed['title'],
    summary: parsed['summary'],
    channelStrategy: parsed['channelStrategy'],
    postingCadence: parsed['postingCadence'],
    calendarEntries,
    monitoringNotes: normalizeStringArray(parsed['monitoringNotes']),
  }
}

function socialCalendarToMarkdown(
  output: SocialCalendarOutput,
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
    `**Owner:** Social Manager`,
    ``,
    `---`,
    ``,
    `## Summary`,
    ``,
    output.summary,
    ``,
    `## Channel Strategy`,
    ``,
    output.channelStrategy,
    ``,
    `## Posting Cadence`,
    ``,
    output.postingCadence,
    ``,
    `## Calendar`,
    ``,
    `| Slot | Channel | Content | Objective | CTA |`,
    `|------|---------|---------|-----------|-----|`,
    ...output.calendarEntries.map((entry) =>
      `| ${entry.dayLabel} | ${entry.channel} | ${entry.content} | ${entry.objective} | ${entry.cta} |`
    ),
    ``,
  ]

  if (output.monitoringNotes.length > 0) {
    lines.push(`## Monitoring Notes`, ``, ...output.monitoringNotes.map((item) => `- ${item}`), ``)
  }

  return lines.join('\n')
}

export async function runSocialManagerAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  log.info({ taskId: task.id, title: task.title }, 'Social Manager Agent: starting')

  const projectId = task.project_id ?? (task.metadata['project_id'] as string | undefined)
  const projectName = (task.metadata['project_name'] as string | undefined) ?? task.title
  const clientName = (task.metadata['client_name'] as string | undefined) ?? 'the client'
  const campaignTitle = (task.metadata['marketing_plan_title'] as string | undefined) ?? 'Marketing delivery'
  const targetAudience = (task.metadata['target_audience'] as string | undefined) ?? ''
  const channels = normalizeStringArray(task.metadata['recommended_channels'])
  const keyMessages = normalizeStringArray(task.metadata['key_messages'])
  const requestedOutputs = normalizeStringArray(task.metadata['requested_outputs'])
  const workspaceAbsPath = await resolveMarketingWorkspacePath(task, projectId)

  const systemPrompt = `You are the Social Manager Agent of WAI (Wawen Autonomous Industries).
Your role: transform campaign direction into a practical publishing calendar and channel execution plan.

Respond with ONLY a JSON object — no markdown, no text outside JSON:
{
  "title": "<calendar title>",
  "summary": "<short overview of the posting plan>",
  "channelStrategy": "<how channels should work together>",
  "postingCadence": "<cadence overview>",
  "calendarEntries": [
    {
      "dayLabel": "<day or slot label>",
      "channel": "<platform or distribution channel>",
      "content": "<what gets published>",
      "objective": "<why it is published>",
      "cta": "<primary CTA>"
    }
  ],
  "monitoringNotes": ["<metric or monitoring instruction 1>", "<note 2>"]
}

Constraints:
- Produce a realistic short campaign calendar, not vague advice.
- Include at least 4 calendar entries when the scope is broad.
- Keep distribution aligned with the client context and requested outputs.` 

  const userMessage = [
    `Campaign: ${campaignTitle}`,
    `Client: ${clientName}`,
    `Project: ${projectName}`,
    `Task title: ${task.title}`,
    `Task description: ${task.description}`,
    targetAudience ? `Target audience: ${targetAudience}` : '',
    channels.length > 0 ? `Recommended channels: ${channels.join(', ')}` : '',
    keyMessages.length > 0 ? `Key messages: ${keyMessages.join(' | ')}` : '',
    requestedOutputs.length > 0 ? `Requested outputs: ${requestedOutputs.join(', ')}` : '',
    ``,
    `Build a practical social distribution calendar.`,
  ].filter(Boolean).join('\n')

  await updateTaskStatus(task.id, 'in_progress')

  try {
    const result = await runAgent(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      {
        agentId: 'social_manager',
        taskId: task.id,
        taskType: 'marketing',
      }
    )

    const socialCalendar = parseSocialCalendar(result.content)
    if (!socialCalendar) {
      throw new Error(
        `Social Manager could not parse social calendar from LLM response: ${result.content.substring(0, 200)}`
      )
    }

    let artifactPath: string | null = null
    if (workspaceAbsPath) {
      const deliverableDir = join(workspaceAbsPath, 'deliverables')
      await mkdir(deliverableDir, { recursive: true })
      const filename = `social-calendar-${task.id.slice(0, 8)}.md`
      artifactPath = join(deliverableDir, filename)
      await writeFile(
        artifactPath,
        socialCalendarToMarkdown(socialCalendar, task, clientName, projectName),
        'utf-8'
      )

      await appendProjectProgress(workspaceAbsPath, 'Social calendar prepared', [
        `Task: ${task.title}`,
        `Artifact: ${filename}`,
        `Summary: ${socialCalendar.summary}`,
      ])
    }

    await recordEvent('task_completed', {
      agentId: 'social_manager',
      taskId: task.id,
      payload: {
        social_calendar_title: socialCalendar.title,
        artifact_path: artifactPath,
        entries_count: socialCalendar.calendarEntries.length,
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
      `📣 *Social Manager — Calendar Ready*`,
      ``,
      `📌 Task: ${task.title}`,
      `👤 Client: ${clientName} | Project: ${projectName}`,
      `📝 ${socialCalendar.summary}`,
      artifactPath ? `\n💾 Saved: \`${artifactPath}\`` : '',
      projectMovedToReview ? `\n🔎 Project status moved to *review*` : '',
    ].filter((line) => line !== '').join('\n')

    await notify(lines)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    log.error({ err, taskId: task.id }, 'Social Manager Agent error')

    await recordEvent('agent_error', {
      agentId: 'social_manager',
      taskId: task.id,
      payload: { error: errorMessage },
      severity: 'error',
    })

    await notify(`❌ *Social Manager Error*\n\nTask: ${task.title}\nError: ${errorMessage}`)

    throw err
  }
}
