import { runCeoNaturalLanguageHandler } from '../agents/ceo_intake.js'
import { getFounderQuickActionCapabilityId } from '../config/capabilities.js'
import { recordCapabilityEvent } from './logger.js'

export type PersonalAssistantQuickActionId =
  | 'latest_email'
  | 'calendar_today'
  | 'drive_recent_files'
  | 'daily_founder_brief'

export interface PersonalAssistantQuickActionResult {
  actionId: PersonalAssistantQuickActionId
  prompt: string
  reply: string
  replies: string[]
  notifications: string[]
}

export function getPersonalAssistantQuickActionPrompt(
  actionId: string,
): string | null {
  switch (actionId as PersonalAssistantQuickActionId) {
    case 'latest_email':
      return "Leggi l'ultima email ricevuta"
    case 'calendar_today':
      return "Mostrami l'agenda di oggi"
    case 'drive_recent_files':
      return 'Mostrami i file recenti su Google Drive'
    case 'daily_founder_brief':
      return 'Genera il daily founder brief di oggi'
    default:
      return null
  }
}

export async function executePersonalAssistantQuickAction(
  actionId: PersonalAssistantQuickActionId,
  chatId: string,
): Promise<PersonalAssistantQuickActionResult> {
  const prompt = getPersonalAssistantQuickActionPrompt(actionId)
  if (!prompt) {
    throw new Error(`Unsupported quick action: ${actionId}`)
  }

  const replies: string[] = []
  const notifications: string[] = []
  const capabilityId = getFounderQuickActionCapabilityId(actionId)

  await recordCapabilityEvent({
    capability_id: capabilityId,
    event_type: 'used',
    actor_type: chatId.startsWith('dashboard:') ? 'dashboard' : chatId.startsWith('automation:') ? 'runtime' : 'founder',
    actor_id: 'neb',
    source: chatId,
    summary: `Founder quick action started: ${actionId}.`,
    payload: {
      action_id: actionId,
      chat_id: chatId,
      prompt,
    },
  })

  try {
    await runCeoNaturalLanguageHandler(
      chatId,
      prompt,
      async (msg) => {
        replies.push(msg)
      },
      async (msg) => {
        notifications.push(msg)
      },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await recordCapabilityEvent({
      capability_id: capabilityId,
      event_type: 'failed',
      actor_type: chatId.startsWith('dashboard:') ? 'dashboard' : chatId.startsWith('automation:') ? 'runtime' : 'founder',
      actor_id: 'neb',
      source: chatId,
      summary: `Founder quick action failed: ${actionId}.`,
      payload: {
        action_id: actionId,
        error: message,
      },
    })
    throw err
  }

  await recordCapabilityEvent({
    capability_id: capabilityId,
    event_type: 'succeeded',
    actor_type: chatId.startsWith('dashboard:') ? 'dashboard' : chatId.startsWith('automation:') ? 'runtime' : 'founder',
    actor_id: 'neb',
    source: chatId,
    summary: `Founder quick action completed: ${actionId}.`,
    payload: {
      action_id: actionId,
      reply_count: replies.length,
      notification_count: notifications.length,
    },
  })

  return {
    actionId,
    prompt,
    reply: replies.join('\n\n').trim(),
    replies,
    notifications,
  }
}
