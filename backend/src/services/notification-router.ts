// ============================================================
// WAI – Notification Router (T101)
// Sends founder notifications via Telegram always,
// and via WhatsApp additionally if the session is connected.
// ============================================================

import { log } from './logger.js'
import { sendTelegramNotification, sendTelegramPhoto } from './telegram.js'
import { getWhatsAppStatus, sendWhatsAppNotification } from './whatsapp.js'

export type NotificationPriority = 'low' | 'normal' | 'high' | 'critical'

interface NotificationOptions {
  priority?: NotificationPriority
  tag?: string // used for deduplication/batching
  channels?: ('telegram' | 'whatsapp' | 'dashboard')[]
}

// Memory-based simple deduplication to avoid spamming the same alert
const lastNotificationTimes = new Map<string, number>()
const DEDUPE_WINDOW_MS = 60_000 // 1 minute

/**
 * Send a notification with smart routing and priority-based channel selection.
 */
export async function sendNotification(
  message: string,
  opts: NotificationOptions = {}
): Promise<void> {
  const priority = opts.priority ?? 'normal'
  const tag = opts.tag ?? message.substring(0, 50)
  
  // Basic deduplication
  const now = Date.now()
  const lastTime = lastNotificationTimes.get(tag)
  if (lastTime && now - lastTime < DEDUPE_WINDOW_MS && priority !== 'critical') {
    log.debug({ tag }, 'Deduplicating notification (spam prevention)')
    return
  }
  lastNotificationTimes.set(tag, now)

  const channels = opts.channels ?? ['telegram', 'whatsapp']
  const promises: Promise<unknown>[] = []

  // 1. Telegram (Always if in channels list)
  if (channels.includes('telegram')) {
    promises.push(sendTelegramNotification(message).catch(err => {
      log.error({ err }, 'Telegram notification failed')
    }))
  }

  // 2. WhatsApp (Only for normal/high/critical or if explicitly requested)
  if (channels.includes('whatsapp') && priority !== 'low') {
    const jid = process.env['WHATSAPP_FOUNDER_JID']?.trim()
    const { state } = getWhatsAppStatus()

    if (jid && state === 'connected') {
      promises.push(sendWhatsAppNotification(jid, message).catch(err => {
        log.warn({ err }, 'WhatsApp notification failed (Telegram may have been delivered)')
      }))
    }
  }

  await Promise.all(promises)
}

/**
 * Send a notification to the founder on all available channels (legacy wrapper).
 */
export async function sendFounderNotification(message: string): Promise<void> {
  await sendNotification(message, { priority: 'high' })
}

/**
 * Send a photo notification to the founder.
 * Currently only Telegram supports photo files.
 */
export async function sendFounderPhoto(photoPath: string, caption?: string): Promise<void> {
  // Primary: Telegram
  await sendTelegramPhoto(photoPath, caption)

  // Secondary: WhatsApp (WhatsApp implementation for files would require Baileys media upload)
  // For now we skip WhatsApp for photos to keep it simple unless needed.
}
