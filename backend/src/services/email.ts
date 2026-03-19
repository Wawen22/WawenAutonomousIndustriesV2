// ============================================================
// WAI – Email Service
// Sends transactional emails through Resend.
// ============================================================

import { Resend } from 'resend'

export interface SendEmailInput {
  to: string | string[]
  subject: string
  text?: string
  html?: string
  cc?: string[]
  bcc?: string[]
  replyTo?: string
}

export interface SendEmailResult {
  id: string | null
  to: string[]
  subject: string
}

let _client: Resend | null = null

function getResendClient(): Resend {
  const apiKey = process.env['RESEND_API_KEY']
  if (!apiKey) {
    throw new Error('Missing RESEND_API_KEY')
  }

  if (!_client) {
    _client = new Resend(apiKey)
  }

  return _client
}

function normalizeRecipients(value: string | string[]): string[] {
  const list = Array.isArray(value) ? value : [value]
  return list
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const from = process.env['RESEND_FROM_EMAIL']
  if (!from) {
    throw new Error('Missing RESEND_FROM_EMAIL')
  }

  const to = normalizeRecipients(input.to)
  if (to.length === 0) {
    throw new Error('sendEmail requires at least one recipient')
  }
  if (!input.subject.trim()) {
    throw new Error('sendEmail requires a non-empty subject')
  }

  const text = input.text?.trim()
  const html = input.html?.trim()
  if (!text && !html) {
    throw new Error('sendEmail requires text or html content')
  }

  const resend = getResendClient()
  const emailPayload = html
    ? {
        from,
        to,
        subject: input.subject,
        html,
        ...(text ? { text } : {}),
        ...(input.cc && input.cc.length > 0 ? { cc: input.cc } : {}),
        ...(input.bcc && input.bcc.length > 0 ? { bcc: input.bcc } : {}),
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      }
    : {
        from,
        to,
        subject: input.subject,
        text: text ?? '',
        ...(input.cc && input.cc.length > 0 ? { cc: input.cc } : {}),
        ...(input.bcc && input.bcc.length > 0 ? { bcc: input.bcc } : {}),
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      }

  const response = await resend.emails.send(emailPayload)

  if (response.error) {
    throw new Error(`Resend error: ${response.error.message}`)
  }

  return {
    id: response.data?.id ?? null,
    to,
    subject: input.subject,
  }
}
