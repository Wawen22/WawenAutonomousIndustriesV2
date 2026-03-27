// ============================================================
// WAI – Content Writer Agent
// Genera contenuti (blog, social, newsletter) con ricerca web
// e invia preview Telegram con approvazione inline keyboard.
// ============================================================

import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

import { runAgent } from '../services/llm.js'
import { updateTaskStatus } from '../services/supabase.js'
import { log, recordEvent } from '../services/logger.js'
import { getProjectWorkspacePath } from '../services/workspace.js'
import { searchWeb } from '../services/search.js'
import type { Task } from '../types/index.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ContentType = 'blog' | 'social' | 'newsletter'

// ---------------------------------------------------------------------------
// System prompts per tipo
// ---------------------------------------------------------------------------

function buildSystemPrompt(contentType: ContentType, tone: string): string {
  const toneNote = `Tone: ${tone}.`

  switch (contentType) {
    case 'blog':
      return `You are WAI's Content Writer Agent. ${toneNote}
Write a high-quality blog post in markdown format.
Requirements:
- Length: 800–1200 words
- Structure: H2 and H3 headings, no H1 (title is provided separately)
- Include: engaging introduction, 3-4 main sections, conclusion with CTA
- SEO-aware: use the topic keyword naturally throughout
- Write in the same language as the topic (Italian or English)
Respond with ONLY the markdown body — no title, no preamble.`

    case 'social':
      return `You are WAI's Content Writer Agent. ${toneNote}
Write 4 social media post variants for the topic.
Requirements:
- LinkedIn variant: 2-4 sentences, professional, 3-5 hashtags at end
- Instagram variant: engaging, 1-2 sentences + emojis + hashtags
- Twitter/X variant: punchy, max 240 chars + 1-2 hashtags
- General variant: clean, platform-neutral, no hashtags

Respond with ONLY this JSON (no markdown, no text outside JSON):
{
  "linkedin": "post text with #hashtags",
  "instagram": "post text with emojis and #hashtags",
  "twitter": "post text #hashtag",
  "general": "post text"
}`

    case 'newsletter':
      return `You are WAI's Content Writer Agent. ${toneNote}
Write a newsletter email in markdown format.
Requirements:
- Structure: intro paragraph (2-3 sentences), 3 content sections (## H2 headers), closing CTA paragraph
- Conversational but professional tone
- Total length: 400–600 words
- End with a clear call to action
- Write in the same language as the topic
Respond with ONLY the markdown body — no title, no preamble.`
  }
}

// ---------------------------------------------------------------------------
// Research helper
// ---------------------------------------------------------------------------

async function gatherResearch(topic: string): Promise<string> {
  try {
    const [r1, r2] = await Promise.allSettled([
      searchWeb({ query: topic, limit: 5 }),
      searchWeb({ query: `${topic} examples best practices`, limit: 5 }),
    ])

    const lines: string[] = []
    for (const result of [r1, r2]) {
      if (result.status === 'rejected') continue
      const s = result.value
      if (s.answerBox) lines.push(`Quick answer: ${s.answerBox}`, '')
      for (const item of s.organic.slice(0, 4)) {
        lines.push(`- ${item.title}: ${item.snippet}`)
      }
      lines.push('')
    }
    return lines.join('\n').trim()
  } catch {
    return '' // non-fatal
  }
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatSocialPostsAsMarkdown(posts: Record<string, string>, topic: string): string {
  return [
    `# Social Posts — ${topic}`,
    '',
    '## LinkedIn',
    '',
    posts['linkedin'] ?? '',
    '',
    '## Instagram',
    '',
    posts['instagram'] ?? '',
    '',
    '## Twitter / X',
    '',
    posts['twitter'] ?? '',
    '',
    '## General',
    '',
    posts['general'] ?? '',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// runContentWriterAgent – entry point
// ---------------------------------------------------------------------------

export async function runContentWriterAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  log.info({ taskId: task.id }, 'Content Writer Agent: starting')

  const contentType: ContentType =
    (['blog', 'social', 'newsletter'] as const).includes(
      task.metadata['content_type'] as ContentType
    )
      ? (task.metadata['content_type'] as ContentType)
      : 'blog'

  const topic = (task.metadata['topic'] as string | undefined) ?? task.title
  const tone = (task.metadata['tone'] as string | undefined) ?? 'professional'
  const clientSlug = task.metadata['client_slug'] as string | undefined
  const projectSlug = task.metadata['project_slug'] as string | undefined
  const projectId = task.project_id ?? (task.metadata['project_id'] as string | undefined)

  await updateTaskStatus(task.id, 'in_progress')

  try {
    // 1. Research (non-fatal)
    const research = await gatherResearch(topic)
    log.info({ taskId: task.id, hasResearch: research.length > 0 }, 'Content Writer: research done')

    const userMessage = [
      `Topic: ${topic}`,
      research ? `\nResearch context:\n${research}` : '',
      '\nProduce the content now.',
    ].filter(Boolean).join('\n')

    // 2. Generate
    const result = await runAgent(
      [
        { role: 'system', content: buildSystemPrompt(contentType, tone) },
        { role: 'user', content: userMessage },
      ],
      {
        agentId: 'content_writer',
        taskId: task.id,
        taskType: 'content',
        requiresComplex: false,
        ...(projectId ? { projectId } : {}),
      }
    )

    const rawContent = result.content.trim()

    // 3. Build final markdown
    let finalMarkdown: string
    let title: string

    if (contentType === 'social') {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        try {
          const posts = JSON.parse(jsonMatch[0]) as Record<string, string>
          finalMarkdown = formatSocialPostsAsMarkdown(posts, topic)
        } catch {
          finalMarkdown = rawContent
        }
      } else {
        finalMarkdown = rawContent
      }
      title = `Social Posts — ${topic}`
    } else {
      finalMarkdown = `# ${topic}\n\n${rawContent}`
      title = topic
    }

    // 4. Save to workspace
    const dateStr = new Date().toISOString().slice(0, 10)
    const topicSlug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
    const filename = `content-${contentType}-${topicSlug}-${dateStr}.md`

    let outputPath: string
    if (clientSlug && projectSlug) {
      const workspacePath = getProjectWorkspacePath(clientSlug, projectSlug)
      const deliverableDir = join(workspacePath, 'deliverables')
      await mkdir(deliverableDir, { recursive: true })
      outputPath = join(deliverableDir, filename)
    } else {
      const personalDir = join(process.cwd(), 'workspace', 'personal', 'neb', 'content')
      await mkdir(personalDir, { recursive: true })
      outputPath = join(personalDir, filename)
    }

    await writeFile(outputPath, finalMarkdown, 'utf-8')
    log.info({ taskId: task.id, outputPath }, 'Content Writer: file saved')

    // 5. Send Telegram preview + approval keyboard (dynamic import avoids circular dep)
    const preview = finalMarkdown.slice(0, 600)
    const previewText = finalMarkdown.length > 600 ? `${preview}…` : preview

    const { sendContentApprovalRequest } = await import('../services/telegram.js')
    await sendContentApprovalRequest(task.id, title, contentType, previewText, outputPath)

    await recordEvent('task_completed', {
      agentId: 'content_writer',
      taskId: task.id,
      payload: {
        content_type: contentType,
        topic,
        output_path: outputPath,
        model_used: result.modelId,
        cost_usd: result.costUsd,
      },
    })

    // Task intentionally stays in_progress until founder approves/rejects via Telegram callback

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    log.error({ err, taskId: task.id }, 'Content Writer Agent error')

    await recordEvent('agent_error', {
      agentId: 'content_writer',
      taskId: task.id,
      payload: { error: errorMessage },
      severity: 'error',
    })

    await updateTaskStatus(task.id, 'blocked').catch(() => {})

    await notify(
      [
        `❌ *Content Writer Error*`,
        ``,
        `🆔 Task: \`${task.id.slice(0, 8)}\` — ${task.title}`,
        `💥 ${errorMessage.slice(0, 400)}`,
        ``,
        `💡 Riprova: \`/retry ${task.id}\``,
      ].join('\n')
    )

    throw err
  }
}
