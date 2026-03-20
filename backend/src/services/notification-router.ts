// ============================================================
// WAI – Notification Router (T101)
// Sends founder notifications via Telegram always,
// and via WhatsApp additionally if the session is connected.
// ============================================================

import { log } from './logger.js'
import { sendTelegramNotification } from './telegram.js'
import { getWhatsAppStatus, sendWhatsAppNotification } from './whatsapp.js'

/**
 * Send a notification to the founder on all available channels.
 * - Telegram: always (primary)
 * - WhatsApp: if connected and WHATSAPP_FOUNDER_JID is set (secondary)
 */
export async function sendFounderNotification(message: string): Promise<void> {
  // Primary: Telegram (always)
  await sendTelegramNotification(message)

  // Secondary: WhatsApp (if connected)
  const jid = process.env['WHATSAPP_FOUNDER_JID']?.trim()
  if (!jid) return

  const { state } = getWhatsAppStatus()
  if (state !== 'connected') return

  try {
    await sendWhatsAppNotification(jid, message)
  } catch (err) {
    // WhatsApp failure is non-fatal — Telegram was already sent
    log.warn({ err }, 'WhatsApp notification failed (Telegram already delivered)')
  }
}
