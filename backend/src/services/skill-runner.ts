// ============================================================
// WAI – Skill Runner Service (T100)
// Structured execution layer for capability-registry skills.
// ============================================================

import { getCapabilityById } from './capabilities.js'
import { log, recordCapabilityEvent } from './logger.js'
import { logRun } from './supabase.js'
import { runAgent } from './llm.js'
import type { SkillRunResult } from '../types/index.js'

export class SkillPolicyError extends Error {
  constructor(message: string, public readonly requiresApproval = false) {
    super(message)
    this.name = 'SkillPolicyError'
  }
}

// ---------------------------------------------------------------------------
// CEO agent ID used as the execution surface
// ---------------------------------------------------------------------------

const SKILL_RUNNER_AGENT_ID = 'ceo'

// ---------------------------------------------------------------------------
// Build the prompt sent to the LLM
// ---------------------------------------------------------------------------

function buildSkillPrompt(
  label: string,
  description: string,
  usageInstructions: string | undefined,
  examples: string[] | undefined,
  input: Record<string, unknown>,
): string {
  const parts: string[] = []

  parts.push(`You are executing the following WAI skill: "${label}"`)
  parts.push(`Description: ${description}`)

  if (usageInstructions) {
    parts.push(`\nUsage instructions:\n${usageInstructions}`)
  }

  if (examples && examples.length > 0) {
    parts.push(`\nExample uses of this skill:\n${examples.map((ex) => `- ${ex}`).join('\n')}`)
  }

  const hasInput = Object.keys(input).length > 0
  if (hasInput) {
    const inputStr = typeof input['prompt'] === 'string'
      ? input['prompt']
      : JSON.stringify(input, null, 2)
    parts.push(`\nCaller input:\n${inputStr}`)
  } else {
    parts.push('\nNo additional caller input was provided. Execute the skill with reasonable defaults.')
  }

  parts.push('\nExecute the skill now and return a clear, complete response.')

  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// runSkill — main entry point
// ---------------------------------------------------------------------------

export async function runSkill(
  skillId: string,
  input: Record<string, unknown>,
  context: { source: string; actorId?: string },
  forceApproval = false,
): Promise<SkillRunResult> {
  const startMs = Date.now()

  // 1. Look up the capability
  const entry = await getCapabilityById(skillId)
  if (!entry) {
    throw new Error(`Skill not found: ${skillId}`)
  }

  const { capability, policy } = entry

  // 2. Must be a skill type
  if (capability.type !== 'skill') {
    throw new Error(`Capability ${skillId} is not a skill (type: ${capability.type})`)
  }

  // 3. Policy checks
  if (capability.status === 'disabled' || policy.mode === 'open' && capability.status !== 'active') {
    throw new SkillPolicyError(`Skill "${capability.label}" is disabled and cannot be executed.`)
  }

  if (policy.mode === 'approval_required' && !forceApproval) {
    throw new SkillPolicyError(
      `Skill "${capability.label}" requires explicit approval before execution. Set forceApproval: true to proceed.`,
      true,
    )
  }

  // Log 'used' event
  await recordCapabilityEvent({
    capability_id: skillId,
    event_type: 'used',
    actor_type: context.actorId ? 'founder' : 'dashboard',
    ...(context.actorId ? { actor_id: context.actorId } : {}),
    source: context.source,
    summary: `Skill "${capability.label}" execution started.`,
    payload: { input_keys: Object.keys(input), force_approval: forceApproval },
  })

  // 4. Build prompt and call LLM via CEO agent
  const prompt = buildSkillPrompt(
    capability.label,
    capability.description,
    capability.usageInstructions,
    capability.examples,
    input,
  )

  let runId: string | null = null
  let output = ''

  try {
    const result = await runAgent(
      [
        {
          role: 'system',
          content: 'You are the WAI CEO Agent, executing a structured skill request. Produce a complete, clear output for the founder.',
        },
        { role: 'user', content: prompt },
      ],
      {
        agentId: SKILL_RUNNER_AGENT_ID,
        tools: ['skill_runner', ...policy.allowedTools],
        requiresComplex: false,
        captureMemory: false,
      },
    )

    output = result.content
    const durationMs = Date.now() - startMs

    // 5. Log run to Supabase (get the ID back)
    try {
      const run = await logRun({
        agent_id: SKILL_RUNNER_AGENT_ID,
        model_id: result.modelId,
        input_summary: `Skill: ${capability.label} — ${prompt.substring(0, 300)}`,
        output_summary: output.substring(0, 500),
        tokens_input: result.tokensInput,
        tokens_output: result.tokensOutput,
        tools_used: ['skill_runner', ...policy.allowedTools],
        outcome: 'success',
        duration_ms: durationMs,
      })
      runId = run.id
    } catch (runErr) {
      log.warn({ err: runErr, skillId }, 'skill-runner: failed to persist run record')
    }

    // 6. Log 'succeeded' event
    await recordCapabilityEvent({
      capability_id: skillId,
      event_type: 'succeeded',
      actor_type: context.actorId ? 'founder' : 'dashboard',
      ...(context.actorId ? { actor_id: context.actorId } : {}),
      source: context.source,
      summary: `Skill "${capability.label}" completed successfully.`,
      payload: {
        run_id: runId,
        duration_ms: durationMs,
        tokens_input: result.tokensInput,
        tokens_output: result.tokensOutput,
      },
    })

    return { skillId, output, runId, durationMs }

  } catch (err) {
    const durationMs = Date.now() - startMs
    const errorMessage = err instanceof Error ? err.message : String(err)

    log.error({ err, skillId }, 'skill-runner: execution failed')

    // Log 'failed' event
    await recordCapabilityEvent({
      capability_id: skillId,
      event_type: 'failed',
      actor_type: context.actorId ? 'founder' : 'dashboard',
      ...(context.actorId ? { actor_id: context.actorId } : {}),
      source: context.source,
      summary: `Skill "${capability.label}" execution failed.`,
      payload: { error: errorMessage, duration_ms: durationMs },
    })

    // Log failed run
    try {
      await logRun({
        agent_id: SKILL_RUNNER_AGENT_ID,
        model_id: 'unknown',
        input_summary: `Skill: ${capability.label}`,
        output_summary: '',
        tokens_input: 0,
        tokens_output: 0,
        tools_used: ['skill_runner'],
        outcome: 'failure',
        error_message: errorMessage,
        duration_ms: durationMs,
      })
    } catch {
      // best-effort
    }

    throw err
  }
}
