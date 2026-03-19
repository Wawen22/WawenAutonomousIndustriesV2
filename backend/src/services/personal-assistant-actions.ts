import { runCeoNaturalLanguageHandler } from '../agents/ceo_intake.js'

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

  return {
    actionId,
    prompt,
    reply: replies.join('\n\n').trim(),
    replies,
    notifications,
  }
}
