// ============================================================
// WAI – Memory Learning Service
// Extracts preferences and standards from founder feedback.
// Also extracts compact project facts at task completion milestones.
// ============================================================

import { log } from './logger.js'
import { runAgent } from './llm.js'
import { createAgentMemory } from './memory.js'
import type { Task } from '../types/index.js'

const MAX_FACT_CHARS = 200
const MAX_FACTS_PER_TASK = 3

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

// ---------------------------------------------------------------------------
// extractAndSaveProjectFacts
// Called non-blocking after a task is approved/completed.
// Uses a cheap model to extract compact project facts and saves them.
// ---------------------------------------------------------------------------

export async function extractAndSaveProjectFacts(
  task: Task,
  output: string
): Promise<void> {
  if (!task.project_id) return

  const inputContext = [
    `Task: ${task.title}`,
    output ? `Output (first 1000 chars):\n${output.slice(0, 1000)}` : '',
  ].filter(Boolean).join('\n\n')

  const prompt = `You are WAI's "Project Memory" module. Extract compact, reusable facts about the project from this completed task.

${inputContext}

Return a JSON array of max ${String(MAX_FACTS_PER_TASK)} facts. Each fact must be ≤${String(MAX_FACT_CHARS)} chars and describe something permanent about the project (tech stack, architecture decisions, deploy config, integrations).

Rules:
- Only extract facts that will still be relevant in future tasks.
- Skip transient details (bug fixes, one-off commands, test results).
- Be concise: "Stack: React 18 + Vite + TypeScript strict" not a paragraph.
- If no permanent project facts can be extracted, return an empty array [].

Return ONLY valid JSON like: ["Stack: React 18 + Vite", "Deploy: Vercel auto-deploy enabled"]`

  try {
    const result = await runAgent(
      [{ role: 'user', content: prompt }],
      {
        agentId: 'system_learning',
        modelOverride: 'nemotron-120b',
        captureMemory: false,
      }
    )

    const jsonMatch = result.content.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return

    const facts = JSON.parse(jsonMatch[0]) as unknown
    if (!Array.isArray(facts)) return

    for (const fact of facts) {
      if (typeof fact !== 'string' || fact.trim().length < 10) continue
      const truncatedFact = fact.trim().slice(0, MAX_FACT_CHARS)
      try {
        await createAgentMemory({
          agentId: '_system',
          content: truncatedFact,
          entityType: 'project_fact',
          projectId: task.project_id,
          ttl: undefined, // No TTL — project facts persist until deleted
        })
        log.info({ taskId: task.id, projectId: task.project_id, fact: truncatedFact }, 'Project fact saved to memory')
      } catch (err) {
        log.warn({ err, taskId: task.id, fact: truncatedFact }, 'Failed to save project fact')
      }
    }
  } catch (err) {
    log.warn({ err, taskId: task.id }, 'extractAndSaveProjectFacts: extraction failed')
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
