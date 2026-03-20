// ============================================================
// WAI – WhatsApp Channel Service (T101)
// Uses @whiskeysockets/baileys v6 (stable) for local, keyless,
// persistent sessions. Session stored in workspace/system/whatsapp-session/.
//
// Baileys is loaded via dynamic import so a Baileys load failure
// does NOT crash the backend — the service degrades to 'offline'.
// ============================================================

import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { log } from './logger.js'
import { recordCapabilityEvent } from './logger.js'
import { getWorkspaceRoot } from './workspace.js'
import type { WhatsAppStatus } from '../types/index.js'

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _status: WhatsAppStatus = { state: 'offline' }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _socket: any | null = null
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null
let _reconnectAttempts = 0
const MAX_RECONNECT_ATTEMPTS = 5
const RECONNECT_DELAY_MS = 8_000

function getSessionPath(): string {
  return join(getWorkspaceRoot(), 'system', 'whatsapp-session')
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getWhatsAppStatus(): WhatsAppStatus {
  return { ..._status }
}

export async function sendWhatsAppNotification(to: string, text: string): Promise<void> {
  if (_status.state !== 'connected' || !_socket) {
    throw new Error('WhatsApp not connected')
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await _socket.sendMessage(to, { text })

    await recordCapabilityEvent({
      capability_id: 'channel.whatsapp_founder_interface',
      event_type: 'used',
      actor_type: 'system',
      source: 'notification_router',
      summary: `WhatsApp notification sent to ${to.split('@')[0]}`,
      payload: { to: to.split('@')[0] },
    }).catch(() => {})
  } catch (err) {
    log.error({ err, to }, 'Failed to send WhatsApp notification')

    await recordCapabilityEvent({
      capability_id: 'channel.whatsapp_founder_interface',
      event_type: 'failed',
      actor_type: 'system',
      source: 'notification_router',
      summary: 'WhatsApp notification failed',
      payload: { error: err instanceof Error ? err.message : 'Unknown error' },
    }).catch(() => {})

    throw err
  }
}

export async function initWhatsAppSession(): Promise<void> {
  // Cancel any pending reconnect timer
  if (_reconnectTimer !== null) {
    clearTimeout(_reconnectTimer)
    _reconnectTimer = null
  }

  try {
    const sessionPath = getSessionPath()
    await mkdir(sessionPath, { recursive: true })

    // --- Lazy dynamic imports ---
    let baileys: Awaited<ReturnType<typeof loadBaileys>>
    let qrcodeLib: Awaited<ReturnType<typeof loadQrcode>>
    try {
      ;[baileys, qrcodeLib] = await Promise.all([loadBaileys(), loadQrcode()])
    } catch (err) {
      log.error({ err }, 'WhatsApp: failed to load Baileys or qrcode — channel stays offline')
      _status = { state: 'offline' }
      return
    }

    const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = baileys
    const { toDataURL } = qrcodeLib

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath)

    // Fetch the latest WhatsApp version to avoid 405 rejections
    let version: [number, number, number] = [2, 3000, 1023531943]
    try {
      const fetched = await fetchLatestBaileysVersion()
      version = fetched.version
      log.info({ version }, 'WhatsApp: using fetched version')
    } catch {
      log.warn('WhatsApp: could not fetch latest version, using fallback')
    }

    const pino = (await import('pino')).default
    const silentLogger = pino({ level: 'silent' })

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const socket = makeWASocket({
      version,
      auth: state,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      logger: silentLogger as any,
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Desktop'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    })

    _socket = socket

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    socket.ev.on('creds.update', saveCreds)

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    socket.ev.on('connection.update', async (update: Record<string, unknown>) => {
      const { connection, lastDisconnect, qr } = update

      if (typeof qr === 'string') {
        try {
          const qrDataUrl = await toDataURL(qr)
          _status = { state: 'qr_pending', qrCode: qrDataUrl }
          log.info('WhatsApp QR code ready for scan')
        } catch (err) {
          log.error({ err }, 'Failed to generate WhatsApp QR image')
        }
      }

      if (connection === 'open') {
        _reconnectAttempts = 0
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const rawId = (socket.user?.id as string | undefined) ?? ''
        const phone = rawId.split(':')[0] ?? rawId.split('@')[0] ?? ''
        _status = { state: 'connected', connectedPhone: phone }
        log.info({ phone }, 'WhatsApp connected')

        await recordCapabilityEvent({
          capability_id: 'channel.whatsapp_founder_interface',
          event_type: 'auth_completed',
          actor_type: 'system',
          source: 'whatsapp_service',
          summary: `WhatsApp session connected: ${phone}`,
          payload: { phone },
        }).catch(() => {})
      }

      if (connection === 'close') {
        const err = lastDisconnect as { error?: { output?: { statusCode?: number } } } | undefined
        const statusCode = err?.error?.output?.statusCode
        const loggedOut = statusCode === DisconnectReason.loggedOut

        log.info({ statusCode, loggedOut }, 'WhatsApp connection closed')
        _status = { state: 'offline' }
        _socket = null

        if (loggedOut) {
          _reconnectAttempts = 0
          try {
            await rm(getSessionPath(), { recursive: true, force: true })
            log.info('WhatsApp session cleared after logout')
          } catch {}
        } else if (_reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          _reconnectAttempts += 1
          log.info({ attempt: _reconnectAttempts }, 'WhatsApp reconnecting...')
          _reconnectTimer = setTimeout(() => {
            void initWhatsAppSession()
          }, RECONNECT_DELAY_MS)
        } else {
          log.warn({ _reconnectAttempts }, 'WhatsApp max reconnect attempts reached')
        }
      }
    })
  } catch (err) {
    log.error({ err }, 'Failed to initialize WhatsApp session')
    _status = { state: 'offline' }
  }
}

export async function disconnectWhatsApp(): Promise<void> {
  if (_reconnectTimer !== null) {
    clearTimeout(_reconnectTimer)
    _reconnectTimer = null
  }
  _reconnectAttempts = MAX_RECONNECT_ATTEMPTS

  if (_socket) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await _socket.logout()
    } catch {
      // ignore — might already be disconnected
    }
    _socket = null
  }
  _status = { state: 'offline' }
}

// ---------------------------------------------------------------------------
// Lazy loaders
// ---------------------------------------------------------------------------

async function loadBaileys() {
  const mod = await import('@whiskeysockets/baileys')
  const makeWASocket = (mod.default ?? mod.makeWASocket) as typeof mod.makeWASocket
  const { useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = mod
  return { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion }
}

async function loadQrcode() {
  const mod = await import('qrcode')
  // qrcode is CJS — default export carries all methods
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const root = (mod.default ?? mod) as any
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
  const toDataURL: (text: string) => Promise<string> = root.toDataURL ?? mod.toDataURL
  return { toDataURL }
}
