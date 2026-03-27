# T142 — Content Factory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `content_writer` agent that generates blog posts, social posts, and newsletters with web research, saves them to client workspace, and sends a Telegram preview with inline [✅ Approva / ❌ Rigetta] buttons.

**Architecture:** New agent `content_writer.ts` follows the same pattern as `executive_summary.ts` — receives `task` + `notify`, does async work, saves file. Telegram inline keyboard approval is wired via `sendContentApprovalRequest` (new export in `telegram.ts`) + callback handler in `registerHandlers`. CEO Intake gets a `content_generate` command that creates and fires the task directly (bypassing CEO routing). CEO routing also updated for cases where CEO agent delegates to `content_writer`.

**Tech Stack:** Node.js 22 + TypeScript, Grammy (Telegram bot), Serper web search, LiteLLM via `runAgent`

---

## File Map

| Action | File | Change |
|--------|------|--------|
| Create | `backend/src/agents/content_writer.ts` | New agent |
| Modify | `backend/src/config/agents.ts` | Add `content_writer` entry |
| Modify | `backend/src/agents/ceo.ts` | Import + routing case |
| Modify | `backend/src/agents/ceo_intake.ts` | `content_generate` command + action handler |
| Modify | `backend/src/services/telegram.ts` | `sendContentApprovalRequest` + callback handler |

---

## Task 1: Add `content_writer` to agent registry

**Files:**
- Modify: `backend/src/config/agents.ts` (after `executive_summary` entry)

- [ ] **Step 1: Find the last agent entry in agents.ts to know where to insert**

Run:
```bash
grep -n "executive_summary\|behavioral_coach\|feedback_synthesizer" backend/src/config/agents.ts | tail -5
```

- [ ] **Step 2: Add the `content_writer` entry to the AGENTS record**

In `backend/src/config/agents.ts`, inside the `AGENTS` object (after the last existing agent entry), add:

```typescript
  content_writer: {
    id: 'content_writer',
    name: 'Content Writer Agent',
    role: 'Autonomous content generation with web research — blog posts, social media posts, newsletters',
    team: 'marketing',
    model_id: assignedModel('content_writer'),
    config: makeConfig({
      tools: ['web_search', 'file_write'],
      maxCostPerTaskUsd: 3,
      thinkingLevel: 'medium',
    }),
  },
```

- [ ] **Step 3: Typecheck**

```bash
cd backend && pnpm typecheck
```
Expected: no errors related to agents.ts

- [ ] **Step 4: Commit**

```bash
git add backend/src/config/agents.ts
git commit -m "feat(T142): add content_writer to agent registry"
```

---

## Task 2: Create `content_writer.ts` agent

**Files:**
- Create: `backend/src/agents/content_writer.ts`

- [ ] **Step 1: Create the file with full implementation**

Create `backend/src/agents/content_writer.ts`:

```typescript
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
```

- [ ] **Step 2: Typecheck**

```bash
cd backend && pnpm typecheck
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/agents/content_writer.ts
git commit -m "feat(T142): add content_writer agent (research + draft + file save)"
```

---

## Task 3: Add Telegram approval sender + callback handler

**Files:**
- Modify: `backend/src/services/telegram.ts`

- [ ] **Step 1: Add `updateTaskStatus` and `recordEvent` imports to telegram.ts**

In `backend/src/services/telegram.ts`, find the existing supabase import block (around line 30) and add `updateTaskStatus` to it:

```typescript
import {
  createClient,
  createProject,
  createTask,
  getClientBySlug,
  getClients,
  getMonthlyCost,
  getProjectBySlug,
  getProjectState,
  getProjectsByClient,
  getRecentEvents,
  updateProjectRepo,
  updateProjectWorkspacePath,
  updateTaskStatus,
} from './supabase.js'
```

Also add `recordEvent` to the logger import. Find this line (approximately line 19-20):
```typescript
import { log, recordEvent } from './logger.js'
```
If `recordEvent` is not already imported, add it. If there is no logger import, add:
```typescript
import { log, recordEvent } from './logger.js'
```

- [ ] **Step 2: Add `sendContentApprovalRequest` export function**

In `backend/src/services/telegram.ts`, add after the closing brace of `sendTelegramPhoto` (at the very end of the file):

```typescript
// ---------------------------------------------------------------------------
// Content approval request (T142 — Content Factory)
// ---------------------------------------------------------------------------

export async function sendContentApprovalRequest(
  taskId: string,
  title: string,
  contentType: string,
  preview: string,
  outputPath: string
): Promise<void> {
  const chatId = process.env['TELEGRAM_FOUNDER_CHAT_ID']
  if (!chatId) {
    log.warn('TELEGRAM_FOUNDER_CHAT_ID not set, skipping content approval request')
    return
  }

  try {
    const bot = getTelegramBot()
    // Escape backticks in preview to avoid breaking Markdown code block
    const safePreview = preview.replace(/`/g, "'")
    const message = [
      `✍️ *Contenuto pronto — approvazione richiesta*`,
      ``,
      `📝 *${title}*`,
      `📂 Tipo: \`${contentType}\``,
      `💾 \`${outputPath}\``,
      ``,
      `*Preview:*`,
      `\`\`\``,
      safePreview,
      `\`\`\``,
    ].join('\n')

    await bot.api.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Approva', callback_data: `content_approve:${taskId}` },
          { text: '❌ Rigetta', callback_data: `content_reject:${taskId}` },
        ]],
      },
    })
  } catch (err) {
    log.error({ err, taskId }, 'Failed to send content approval request')
  }
}
```

- [ ] **Step 3: Add callback_query handler inside `registerHandlers`**

In `backend/src/services/telegram.ts`, find the closing of `registerHandlers` — this is the line `})` that ends the `bot.on('message:text', ...)` block (around line 1304), followed by the closing `}` of `registerHandlers` itself (line 1305).

Add the callback handler BEFORE the closing `}` of `registerHandlers`:

```typescript
  // ── Inline keyboard callback handler (T142 Content Approval) ────────────
  bot.on('callback_query:data', async (ctx) => {
    if (!requireFounder(ctx)) {
      await ctx.answerCallbackQuery({ text: '⛔ Unauthorized' })
      return
    }

    const data = ctx.callbackQuery.data ?? ''

    if (data.startsWith('content_approve:') || data.startsWith('content_reject:')) {
      const colonIdx = data.indexOf(':')
      const action = data.slice(0, colonIdx)
      const taskId = data.slice(colonIdx + 1)

      if (!taskId) {
        await ctx.answerCallbackQuery({ text: '⚠️ Task ID mancante' })
        return
      }

      try {
        if (action === 'content_approve') {
          await updateTaskStatus(taskId, 'done')
          await recordEvent('task_completed', {
            agentId: 'content_writer',
            taskId,
            payload: { approved_by: 'founder', source: 'telegram_callback' },
          })
          await ctx.answerCallbackQuery({ text: '✅ Contenuto approvato!' })
          await ctx.reply(
            `✅ *Contenuto approvato*\n\nTask \`${taskId.slice(0, 8)}\` completato.`,
            { parse_mode: 'Markdown' }
          )
        } else {
          await updateTaskStatus(taskId, 'blocked')
          await recordEvent('agent_error', {
            agentId: 'content_writer',
            taskId,
            payload: { rejected_by: 'founder', source: 'telegram_callback' },
            severity: 'warning',
          })
          await ctx.answerCallbackQuery({ text: '❌ Contenuto rigettato' })
          await ctx.reply(
            `❌ *Contenuto rigettato*\n\nTask \`${taskId.slice(0, 8)}\` marcato come bloccato.`,
            { parse_mode: 'Markdown' }
          )
        }
      } catch (err) {
        log.error({ err, taskId }, 'Content approval callback error')
        await ctx.answerCallbackQuery({ text: '⚠️ Errore interno' })
      }
      return
    }

    // Unknown callback — dismiss silently
    await ctx.answerCallbackQuery()
  })
```

- [ ] **Step 4: Typecheck**

```bash
cd backend && pnpm typecheck
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/telegram.ts
git commit -m "feat(T142): add Telegram inline keyboard approval for content_writer"
```

---

## Task 4: Add `content_generate` command to CEO Intake

**Files:**
- Modify: `backend/src/agents/ceo_intake.ts`

- [ ] **Step 1: Add the command to the system prompt actions list**

In `backend/src/agents/ceo_intake.ts`, find the line in `buildSystemPrompt` that reads:
```
- harvest_automation_run → no params  — avvia manualmente l'harvest settimanale ora (usa i settori configurati)
```

Add immediately after it (still inside the backtick template string, before `Valid project types:`):
```
- content_generate → params: type (blog|social|newsletter), topic, tone?, client_slug?, project_slug?
```

- [ ] **Step 2: Add rule 48 to the planning rules section**

Find rule 47:
```
47. Use harvest_automation_run when Neb wants to trigger the weekly harvest immediately...
```

Add after it:
```
48. Use content_generate when Neb wants WAI to write a content piece for a client or for himself. Required: type (blog|social|newsletter), topic. Optional: tone (default "professional"), client_slug, project_slug. Output is a .md file saved to the project workspace (or personal workspace if no client/project) — a Telegram preview with approval buttons will follow automatically. Do NOT use create_task for content generation requests.
```

- [ ] **Step 3: Add the `content_generate` case to `executeAction`**

In `backend/src/agents/ceo_intake.ts`, find the `case 'harvest_automation_run':` block (it returns a string). Add a new case block after it, before the closing `default:` or the next handler:

```typescript
    case 'content_generate': {
      const contentType = getString(params, 'type') ?? 'blog'
      const topic = getString(params, 'topic')
      if (!topic) return '⚠️ content_generate: topic mancante.'

      const tone = getString(params, 'tone') ?? 'professional'
      const clientSlug = getString(params, 'client_slug')
      const projectSlug = getString(params, 'project_slug')

      // Resolve project_id (best-effort, non-fatal)
      let projectId: string | undefined
      if (clientSlug && projectSlug) {
        try {
          const client = await getClientBySlug(clientSlug)
          if (client) {
            const project = await getProjectBySlug(client.id, projectSlug)
            if (project) projectId = project.id
          }
        } catch {
          // non-fatal
        }
      }

      const task = await createTask({
        title: `Genera ${contentType}: ${topic}`,
        description: `Genera un contenuto di tipo "${contentType}" sul topic "${topic}". Tone: ${tone}.${clientSlug ? ` Cliente: ${clientSlug}.` : ''}${projectSlug ? ` Progetto: ${projectSlug}.` : ''}`,
        type: 'content',
        priority: 2,
        ...(projectId ? { project_id: projectId } : {}),
        delegator_agent_id: 'ceo_intake',
        assignee_agent_id: 'content_writer',
        requires_human_review: false,
        metadata: {
          content_type: contentType,
          topic,
          tone,
          ...(clientSlug ? { client_slug: clientSlug } : {}),
          ...(projectSlug ? { project_slug: projectSlug } : {}),
          ...(projectId ? { project_id: projectId } : {}),
        },
      })

      // Fire content_writer asynchronously (dynamic import avoids circular dep at load time)
      void (async () => {
        try {
          const { runContentWriterAgent } = await import('./content_writer.js')
          await runContentWriterAgent(task, notify)
        } catch (err) {
          log.error({ err, taskId: task.id }, 'CEO Intake: content_generate background error')
        }
      })()

      return [
        `✍️ *Content Writer avviato*`,
        ``,
        `📂 Tipo: ${contentType}`,
        `📝 Topic: ${topic}`,
        `🎨 Tone: ${tone}`,
        `🆔 Task: \`${task.id.slice(0, 8)}\``,
        ``,
        `L'anteprima arriverà su Telegram con il bottone di approvazione.`,
      ].join('\n')
    }
```

- [ ] **Step 4: Typecheck**

```bash
cd backend && pnpm typecheck
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/ceo_intake.ts
git commit -m "feat(T142): add content_generate CEO NL command"
```

---

## Task 5: Add `content_writer` routing to CEO agent

**Files:**
- Modify: `backend/src/agents/ceo.ts`

- [ ] **Step 1: Add import**

At the top of `backend/src/agents/ceo.ts`, after the existing agent imports (e.g. after `import { runBehavioralCoachAgent } from './behavioral_coach.js'`), add:

```typescript
import { runContentWriterAgent } from './content_writer.js'
```

- [ ] **Step 2: Add to AGENT_ROSTER string**

In `backend/src/agents/ceo.ts`, in the `AGENT_ROSTER` const, add after the `content_creator` line:

```
- content_writer      – Content Writer Agent: autonomous content generation with web research — blog posts (800-1200 words), social media variants, newsletters — USE THIS when a task explicitly asks to write/generate a content piece for a client project with research backing
```

- [ ] **Step 3: Add routing case**

Find the last `else if` block in the CEO's dispatch chain (currently ends with `behavioral_coach`). Add after it, before the outer `try` closes with `} catch`:

```typescript
    } else if (delegation.delegateTo === 'content_writer') {
      void runContentWriterAgent(subtask, notify).catch((err: unknown) => {
        log.error({ err, subtaskId: subtask.id }, 'Content Writer Agent failed')
      })
    }
```

- [ ] **Step 4: Typecheck**

```bash
cd backend && pnpm typecheck
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add backend/src/agents/ceo.ts
git commit -m "feat(T142): add content_writer routing in CEO agent"
```

---

## Task 6: Manual end-to-end test + final commit

- [ ] **Step 1: Start backend**

```bash
cd backend && pnpm dev
```

- [ ] **Step 2: Send test command from Telegram**

Send to the WAI Telegram bot:
```
genera blog su "Come usare l'AI nel marketing digitale" tone professionale
```
Expected: CEO Intake replies "✍️ Content Writer avviato" with a task ID. Within 30-60 seconds, a Telegram preview message arrives with inline [✅ Approva] [❌ Rigetta] buttons.

- [ ] **Step 3: Tap [✅ Approva]**

Expected: Telegram replies "✅ Contenuto approvato — Task XXXXXXXX completato."

- [ ] **Step 4: Verify file was saved**

```bash
ls workspace/personal/neb/content/
```
Expected: a file like `content-blog-come-usare-l-ai-nel-marketing-digitale-2026-03-27.md`

- [ ] **Step 5: Test with client/project slugs**

```bash
# Check existing clients/projects
ls workspace/clients/
```
If you have a client + project, test: `genera newsletter su "Offerta primavera 2026" per cliente wawen22 progetto landing`

- [ ] **Step 6: Update PROJECT_TRACKING.md** (see end of T143 plan for combined update)
