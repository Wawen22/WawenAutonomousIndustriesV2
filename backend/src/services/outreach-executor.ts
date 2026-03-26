// ============================================================
// WAI – Outreach Executor (T133 Lead Generation Engine)
// Sends approved lead outreach via Gmail MCP, logs to CRM.
// ============================================================

import { log } from './logger.js'
import { callGoogleWorkspaceMcpTool } from './google-workspace-mcp.js'
import { getLead, saveLead, updateLeadStatus } from './leads.js'
import { upsertContact, addInteraction } from './crm.js'
import { sendFounderNotification } from './notification-router.js'

export async function executeOutreach(leadId: string): Promise<{ sent: boolean; draftOnly: boolean }> {
  const lead = await getLead(leadId)
  if (!lead) throw new Error(`Lead not found: ${leadId}`)
  if (lead.status !== 'approved') throw new Error(`Lead ${leadId} is not approved (status: ${lead.status})`)
  if (!lead.contact_email) throw new Error(`Lead ${leadId} has no contact_email — cannot send outreach`)

  let sent = false
  let draftOnly = false
  let capturedThreadId: string | null = null

  // 1. Attempt send via Gmail MCP
  try {
    const sendResult = await callGoogleWorkspaceMcpTool('gmail_send_email', {
      to: lead.contact_email,
      subject: lead.outreach_subject,
      body: lead.outreach_draft,
    })
    sent = true
    draftOnly = false

    // Capture thread_id from Gmail MCP structured response
    const sc = sendResult.structuredContent
    if (sc && typeof sc === 'object' && 'threadId' in sc && typeof (sc as Record<string, unknown>)['threadId'] === 'string') {
      capturedThreadId = (sc as Record<string, string>)['threadId'] ?? null
    }

    log.info({ leadId, email: lead.contact_email, threadId: capturedThreadId }, 'OutreachExecutor: email sent')
  } catch (sendErr) {
    log.warn({ sendErr }, 'OutreachExecutor: gmail_send_email failed, falling back to draft')

    // Fallback: create draft
    try {
      await callGoogleWorkspaceMcpTool('gmail_create_draft', {
        to: lead.contact_email,
        subject: lead.outreach_subject,
        body: lead.outreach_draft,
      })
      sent = false
      draftOnly = true
      log.info({ leadId, email: lead.contact_email }, 'OutreachExecutor: draft created')

      // Notify founder about draft
      await sendFounderNotification(
        `✉️ Email draft created for ${lead.company_name} — check Gmail Drafts to send`,
      ).catch(() => {})
    } catch (draftErr) {
      const msg = draftErr instanceof Error ? draftErr.message : String(draftErr)
      throw new Error(`Gmail not connected — start Google auth in Assistant HQ. Details: ${msg}`)
    }
  }

  // 2. Update lead status to sent (+ thread_id for reply tracking)
  const sentAt = new Date().toISOString()
  await updateLeadStatus(leadId, 'sent', { sent_at: sentAt })
  if (capturedThreadId) {
    await saveLead({ id: leadId, company_name: lead.company_name, thread_id: capturedThreadId })
  }

  // 3. CRM integration — upsert contact + log interaction
  try {
    let contactId = lead.contact_id

    if (!contactId) {
      const contact = await upsertContact({
        name: lead.contact_name ?? lead.company_name,
        email: lead.contact_email,
        company: lead.company_name,
        status: 'active',
      })
      contactId = contact.id

      // Link contact to lead
      await saveLead({
        id: leadId,
        company_name: lead.company_name,
        contact_id: contactId,
      })
    }

    await addInteraction(contactId, {
      type: 'email_out',
      summary: `Cold outreach: ${lead.outreach_subject}`,
      source: 'gmail',
      occurred_at: sentAt,
    })

    log.info({ leadId, contactId }, 'OutreachExecutor: CRM contact + interaction logged')
  } catch (crmErr) {
    // CRM logging is non-fatal
    log.error({ crmErr, leadId }, 'OutreachExecutor: CRM logging failed (non-fatal)')
  }

  return { sent, draftOnly }
}
