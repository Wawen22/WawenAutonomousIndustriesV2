// ============================================================
// WAI – Notification Preferences
// Persists founder channel preferences (Telegram, WhatsApp…).
// ============================================================

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { log } from './logger.js'

const PREFS_PATH = join('workspace', 'system', 'notification-preferences.json')

export interface NotificationPreferences {
  telegram: boolean
  whatsapp: boolean
}

const DEFAULT_PREFS: NotificationPreferences = {
  telegram: true,
  whatsapp: true,
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  if (!existsSync(PREFS_PATH)) {
    return { ...DEFAULT_PREFS }
  }
  try {
    const raw = await readFile(PREFS_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<NotificationPreferences>
    return {
      telegram: parsed.telegram ?? DEFAULT_PREFS.telegram,
      whatsapp: parsed.whatsapp ?? DEFAULT_PREFS.whatsapp,
    }
  } catch {
    log.warn({ path: PREFS_PATH }, 'Failed to parse notification preferences — using defaults')
    return { ...DEFAULT_PREFS }
  }
}

export async function updateNotificationPreferences(
  patch: Partial<NotificationPreferences>,
): Promise<NotificationPreferences> {
  const current = await getNotificationPreferences()
  const updated: NotificationPreferences = {
    telegram: patch.telegram ?? current.telegram,
    whatsapp: patch.whatsapp ?? current.whatsapp,
  }
  await mkdir(join('workspace', 'system'), { recursive: true })
  await writeFile(PREFS_PATH, `${JSON.stringify(updated, null, 2)}\n`, 'utf-8')
  log.info({ prefs: updated }, 'Notification preferences updated')
  return updated
}
