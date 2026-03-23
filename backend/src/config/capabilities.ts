import type { PersonalAssistantQuickActionId } from '../services/personal-assistant-actions.js'

export const GOOGLE_WORKSPACE_PLUGIN_CAPABILITY_ID = 'plugin.google_workspace.mcp'
export const GMAIL_INTEGRATION_CAPABILITY_ID = 'integration.google_workspace.gmail'
export const CALENDAR_INTEGRATION_CAPABILITY_ID = 'integration.google_workspace.calendar'
export const DRIVE_INTEGRATION_CAPABILITY_ID = 'integration.google_workspace.drive'
export const DAILY_FOUNDER_BRIEF_AUTOMATION_CAPABILITY_ID = 'skill.founder.daily_founder_brief_automation'
export const PERSONAL_WORKSPACE_CONTEXT_CAPABILITY_ID = 'memory.personal_workspace_context'
export const PINCHTAB_CAPABILITY_ID = 'plugin.pinchtab'
export const DOCUMENT_GENERATION_CAPABILITY_ID = 'tool.document_generation'

export function getFounderQuickActionCapabilityId(
  actionId: PersonalAssistantQuickActionId,
): string {
  switch (actionId) {
    case 'important_emails_today':
      return GMAIL_INTEGRATION_CAPABILITY_ID
    case 'pre_meeting_brief':
      return CALENDAR_INTEGRATION_CAPABILITY_ID
    default:
      return `skill.founder.${actionId}`
  }
}

export function inferGoogleWorkspaceCapabilityIdsFromToolName(name: string): string[] {
  const normalized = name.trim().toLowerCase()

  if (!normalized) {
    return [GOOGLE_WORKSPACE_PLUGIN_CAPABILITY_ID]
  }

  if (normalized.includes('gmail')) {
    return [GOOGLE_WORKSPACE_PLUGIN_CAPABILITY_ID, GMAIL_INTEGRATION_CAPABILITY_ID]
  }

  if (normalized.includes('drive')) {
    return [GOOGLE_WORKSPACE_PLUGIN_CAPABILITY_ID, DRIVE_INTEGRATION_CAPABILITY_ID]
  }

  if (normalized === 'get_events' || normalized.includes('calendar') || normalized.includes('event')) {
    return [GOOGLE_WORKSPACE_PLUGIN_CAPABILITY_ID, CALENDAR_INTEGRATION_CAPABILITY_ID]
  }

  return [GOOGLE_WORKSPACE_PLUGIN_CAPABILITY_ID]
}
