// ============================================================
// WAI – Behavioral Coach Agent
// Personal mode only. Tracker abitudini, accountability
// check-in, nudge produttività per Neb via Telegram.
// ============================================================

import { runAgent } from '../services/llm.js'
import { updateTaskStatus } from '../services/supabase.js'
import { log, recordEvent } from '../services/logger.js'
import type { Task } from '../types/index.js'

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

type CheckinStatus = 'done' | 'partial' | 'missed' | 'skipped'

interface HabitCheckin {
  habit: string
  status: CheckinStatus
  streak: number
  note: string
}

interface WeeklyMetrics {
  focusScore: number
  completionRate: number
  bestDay: string
  mainBlocker: string
}

interface BehavioralCoachOutput {
  greeting: string
  overallMood: 'energized' | 'steady' | 'sluggish' | 'blocked'
  habitCheckins: HabitCheckin[]
  wins: string[]
  nudge: string
  weeklyFocus: string
  weeklyMetrics?: WeeklyMetrics
  motivationalNote: string
  actionForToday: string
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

function parseHabitCheckin(value: unknown): HabitCheckin | null {
  if (typeof value !== 'object' || value === null) return null
  const h = value as Record<string, unknown>
  if (typeof h['habit'] !== 'string') return null

  return {
    habit: h['habit'],
    status: ['done', 'partial', 'missed', 'skipped'].includes(h['status'] as string)
      ? (h['status'] as CheckinStatus)
      : 'skipped',
    streak: typeof h['streak'] === 'number' ? h['streak'] : 0,
    note: typeof h['note'] === 'string' ? h['note'] : '',
  }
}

function parseBehavioralCoach(raw: string): BehavioralCoachOutput | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  } catch {
    return null
  }

  const { greeting, nudge, motivationalNote, actionForToday } = parsed
  if (
    typeof greeting !== 'string' ||
    typeof nudge !== 'string' ||
    typeof motivationalNote !== 'string'
  ) {
    return null
  }

  let weeklyMetrics: WeeklyMetrics | undefined
  if (typeof parsed['weeklyMetrics'] === 'object' && parsed['weeklyMetrics'] !== null) {
    const m = parsed['weeklyMetrics'] as Record<string, unknown>
    weeklyMetrics = {
      focusScore: typeof m['focusScore'] === 'number' ? m['focusScore'] : 0,
      completionRate: typeof m['completionRate'] === 'number' ? m['completionRate'] : 0,
      bestDay: typeof m['bestDay'] === 'string' ? m['bestDay'] : '',
      mainBlocker: typeof m['mainBlocker'] === 'string' ? m['mainBlocker'] : '',
    }
  }

  return {
    greeting,
    overallMood: ['energized', 'steady', 'sluggish', 'blocked'].includes(parsed['overallMood'] as string)
      ? (parsed['overallMood'] as BehavioralCoachOutput['overallMood'])
      : 'steady',
    habitCheckins: Array.isArray(parsed['habitCheckins'])
      ? parsed['habitCheckins'].map(parseHabitCheckin).filter((h): h is HabitCheckin => h !== null)
      : [],
    wins: Array.isArray(parsed['wins']) ? (parsed['wins'] as string[]) : [],
    nudge,
    weeklyFocus: typeof parsed['weeklyFocus'] === 'string' ? parsed['weeklyFocus'] : '',
    ...(weeklyMetrics !== undefined ? { weeklyMetrics } : {}),
    motivationalNote,
    actionForToday: typeof actionForToday === 'string' ? actionForToday : '',
  }
}

// ---------------------------------------------------------------------------
// Build Telegram notification (primary output for personal mode)
// ---------------------------------------------------------------------------

function buildCoachMessage(output: BehavioralCoachOutput): string {
  const moodEmoji: Record<string, string> = {
    energized: '⚡', steady: '🟢', sluggish: '🟡', blocked: '🔴',
  }
  const statusEmoji: Record<string, string> = {
    done: '✅', partial: '🔸', missed: '❌', skipped: '⏭️',
  }

  const lines = [
    `${moodEmoji[output.overallMood] ?? ''} *Behavioral Coach Check-in*`,
    ``,
    output.greeting,
    ``,
  ]

  if (output.habitCheckins.length > 0) {
    lines.push(`📋 *Habits:*`)
    for (const h of output.habitCheckins) {
      const streakBadge = h.streak > 0 ? ` 🔥${h.streak}` : ''
      lines.push(`${statusEmoji[h.status] ?? ''} ${h.habit}${streakBadge}${h.note ? ` — _${h.note}_` : ''}`)
    }
    lines.push(``)
  }

  if (output.wins.length > 0) {
    lines.push(`🏆 *Wins:*`, ...output.wins.map((w) => `• ${w}`), ``)
  }

  lines.push(`💡 *Nudge:* ${output.nudge}`)

  if (output.weeklyFocus) {
    lines.push(``, `🎯 *Weekly focus:* ${output.weeklyFocus}`)
  }

  if (output.weeklyMetrics) {
    const m = output.weeklyMetrics
    lines.push(
      ``,
      `📊 *Weekly metrics:*`,
      `• Focus score: ${m.focusScore}/10`,
      `• Completion rate: ${m.completionRate}%`,
      m.bestDay ? `• Best day: ${m.bestDay}` : '',
      m.mainBlocker ? `• Main blocker: ${m.mainBlocker}` : '',
    )
  }

  if (output.actionForToday) {
    lines.push(``, `➡️ *Today's action:* ${output.actionForToday}`)
  }

  lines.push(``, `_${output.motivationalNote}_`)

  return lines.filter((l) => l !== '').join('\n')
}

// ---------------------------------------------------------------------------
// runBehavioralCoachAgent – entry point
// ---------------------------------------------------------------------------

export async function runBehavioralCoachAgent(
  task: Task,
  notify: (message: string) => Promise<void>
): Promise<void> {
  log.info({ taskId: task.id, title: task.title }, 'Behavioral Coach Agent: starting')

  const checkInType = (task.metadata['checkin_type'] as string | undefined) ?? 'daily'
  const currentHabits = (task.metadata['habits'] as string | undefined) ?? ''
  const recentContext = (task.metadata['recent_context'] as string | undefined) ?? ''
  const weeklyGoal = (task.metadata['weekly_goal'] as string | undefined) ?? ''

  const today = new Date()
  const dayName = today.toLocaleDateString('en-US', { weekday: 'long' })
  const dateStr = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })

  const systemPrompt = `You are Neb's personal Behavioral Coach, an AI accountability partner inside WAI.

Neb is a solo founder building WAI (Wawen Autonomous Industries), a zero-human company powered by AI agents. He is ambitious, technical, and works best with direct, no-bullshit communication.

Your role:
- Track habit consistency and streaks
- Celebrate wins without being sycophantic
- Give direct, specific nudges when momentum is low
- Help Neb maintain clarity on his most important weekly focus
- Be concise — Neb reads this on Telegram between tasks

Tone: direct, warm, briefly motivational. Like a trusted coach, not a cheerleader.
Language: Italian (Neb's primary language for personal communications).

Respond with ONLY a JSON object — no markdown, no text outside JSON:
{
  "greeting": "<short personal greeting in Italian, referencing the day>",
  "overallMood": "<energized | steady | sluggish | blocked>",
  "habitCheckins": [
    {
      "habit": "<habit name>",
      "status": "<done | partial | missed | skipped>",
      "streak": <consecutive days/weeks completed>,
      "note": "<brief contextual note>"
    }
  ],
  "wins": ["<win 1>", "<win 2>"],
  "nudge": "<1 specific, actionable nudge for today>",
  "weeklyFocus": "<the one thing Neb should focus on this week>",
  "weeklyMetrics": {
    "focusScore": <1-10>,
    "completionRate": <percentage 0-100>,
    "bestDay": "<day name>",
    "mainBlocker": "<what's slowing Neb down>"
  },
  "motivationalNote": "<1 sentence in Italian: grounding, honest, not cheesy>",
  "actionForToday": "<the single most important action for today>"
}`

  const userMessage = [
    `Today is ${dayName}, ${dateStr}.`,
    `Check-in type: ${checkInType}`,
    currentHabits ? `\nHabits to track:\n${currentHabits}` : '',
    recentContext ? `\nRecent context / what Neb shared:\n${recentContext}` : '',
    weeklyGoal ? `\nWeekly goal: ${weeklyGoal}` : '',
    task.description ? `\nAdditional context: ${task.description}` : '',
    `\nGenerate a ${checkInType} check-in for Neb.`,
  ].filter(Boolean).join('\n')

  await updateTaskStatus(task.id, 'in_progress')

  try {
    const result = await runAgent(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      {
        agentId: 'behavioral_coach',
        taskId: task.id,
        taskType: 'ops',
        requiresComplex: false,
      }
    )

    const coachOutput = parseBehavioralCoach(result.content)
    if (!coachOutput) {
      throw new Error(
        `Behavioral Coach could not parse output: ${result.content.substring(0, 200)}`
      )
    }

    await recordEvent('task_completed', {
      agentId: 'behavioral_coach',
      taskId: task.id,
      payload: {
        checkin_type: checkInType,
        overall_mood: coachOutput.overallMood,
        habits_checked: coachOutput.habitCheckins.length,
        done_habits: coachOutput.habitCheckins.filter((h) => h.status === 'done').length,
        model_used: result.modelId,
        cost_usd: result.costUsd,
      },
    })

    await updateTaskStatus(task.id, 'done')

    await notify(buildCoachMessage(coachOutput))
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    log.error({ err, taskId: task.id }, 'Behavioral Coach Agent error')

    await recordEvent('agent_error', {
      agentId: 'behavioral_coach',
      taskId: task.id,
      payload: { error: errorMessage },
      severity: 'error',
    })

    await updateTaskStatus(task.id, 'blocked').catch(() => {})

    await notify(
      [
        `❌ *Behavioral Coach Error*`,
        ``,
        `🆔 Task: \`${task.id.slice(0, 8)}\` — ${task.title}`,
        `💥 Error: ${errorMessage.slice(0, 400)}`,
        ``,
        `💡 Riprova: \`/retry ${task.id}\``,
      ].join('\n')
    )

    throw err
  }
}
