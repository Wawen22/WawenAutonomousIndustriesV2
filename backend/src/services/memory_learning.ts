// ============================================================
// WAI – Memory Learning Service
// Extracts preferences and standards from founder feedback.
// ============================================================

import { log } from './logger.js'
import { runAgent } from './llm.js'
import { createAgentMemory } from './memory.js'
import type { Task } from '../types/index.js'

export async function extractLearningPoints(
  task: Task,
  feedback: string
): Promise<string[]> {
  const prompt = `
You are WAI's "Adaptive Learning" module. Your job is to extract permanent preferences, quality standards, and stylistic choices from the Founder's feedback on a completed or rejected task.

### CONTEXT
Task Title: ${task.title}
Task Description: ${task.description}
Agent: ${task.assignee_agent_id}

### FOUNDER FEEDBACK
"${feedback}"

### INSTRUCTIONS
1. Extract "Learning Points" that should be remembered for FUTURE tasks.
2. Focus on:
   - Technical preferences (e.g., "Use Vanilla CSS", "No Tailwind").
   - Formatting standards (e.g., "Always include an Executive Summary", "Bullet points for results").
   - Tone and Style (e.g., "Be more concise", "Use professional Italian").
   - Logic/Workflow (e.g., "Always check the README first").
3. Each point must be a single, standalone sentence.
4. If the feedback is just "good job" or "thanks", return an empty list.
5. Do NOT include temporary feedback like "Fix the typo in line 10". Only extract reusable preferences.

Return the points as a simple JSON array of strings.
Example: ["Preference: Use Vanilla CSS instead of Tailwind.", "Standard: Reports must include a 'Next Steps' section."]
`.trim()

  try {
    const result = await runAgent(
      [{ role: 'user', content: prompt }],
      {
        agentId: 'system_learning',
        modelOverride: 'nemotron-120b',
        captureMemory: false,
      }
    )

    const content = result.content.trim()
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      const points = JSON.parse(jsonMatch[0]) as string[]
      return Array.isArray(points) ? points : []
    }
    return []
  } catch (err) {
    log.error({ err, taskId: task.id }, 'Failed to extract learning points from feedback')
    return []
  }
}

export async function processFeedbackLearning(
  task: Task,
  feedback: string
): Promise<void> {
  if (!feedback || feedback.trim().length < 5) return

  log.info({ taskId: task.id, agentId: task.assignee_agent_id }, 'Processing feedback for adaptive learning')

  const points = await extractLearningPoints(task, feedback)
  if (points.length === 0) return

  for (const point of points) {
    try {
      await createAgentMemory({
        agentId: task.assignee_agent_id ?? 'ceo',
        content: point,
        entityType: 'preference',
      })
      log.info({ taskId: task.id, point }, 'Learning point saved to agent memory')
    } catch (err) {
      log.error({ err, taskId: task.id, point }, 'Failed to save learning point')
    }
  }
}
