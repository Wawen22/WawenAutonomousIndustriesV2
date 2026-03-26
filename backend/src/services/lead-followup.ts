// ============================================================
// WAI – Lead Follow-up Service (T136)
// Finds sent leads with no response after N days and sends
// a single follow-up email via Gmail MCP.
// ============================================================

import { log } from './logger.js'
import { callGoogleWorkspaceMcpTool } from './google-workspace-mcp.js'
import { getLead } from './leads.js'
import { addInteraction } from './crm.js'
import { getSupabaseClient } from './supabase.js'

const DEFAULT_FOLLOWUP_DAYS = parseInt(process.env['FOLLOWUP_DAYS'] ?? '3', 10)

// Returns leads that are: status='sent', sent >= N days ago, follow_up_count=0
export async function getLeadsNeedingFollowUp(daysAfterSend = DEFAULT_FOLLOWUP_DAYS): Promise<import('../types/index.js').Lead[]> {
  const cutoff = new Date(Date.now() - daysAfterSend * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await getSupabaseClient()
    .from('leads')
    .select('*')
    .eq('status', 'sent')
    .eq('follow_up_count', 0)
    .not('contact_email', 'is', null)
    .lte('sent_at', cutoff)
    .order('score', { ascending: false })

  if (error) {
    log.error({ err: error }, 'LeadFollowup: getLeadsNeedingFollowUp failed')
    throw new Error(error.message)
  }

  return (data ?? []) as import('../types/index.js').Lead[]
}

// Sends a single follow-up email to one lead and updates its follow_up_count.
export async function executeFollowUp(
  leadId: string,
): Promise<{ sent: boolean; draftOnly: boolean }> {
  const lead = await getLead(leadId)
  if (!lead) throw new Error(`Lead not found: ${leadId}`)
  if (lead.status !== 'sent') throw new Error(`Lead ${leadId} is not in 'sent' status`)
  if (lead.follow_up_count > 0) throw new Error(`Lead ${leadId} already followed up`)
  if (!lead.contact_email) throw new Error(`Lead ${leadId} has no contact_email`)

  const contactName = lead.contact_name ?? lead.company_name
  const originalSubject = lead.outreach_subject || `Working together — ${lead.company_name}`
  const followUpSubject = `Re: ${originalSubject}`
  const followUpBody =
    `Hi ${contactName},\n\n` +
    `I wanted to follow up on my previous message. ` +
    `Happy to share more details or answer any questions you might have.\n\n` +
    `Is this something worth a quick conversation?\n\n` +
    `Best,\nWAI Team`

  let sent = false
  let draftOnly = false

  try {
    await callGoogleWorkspaceMcpTool('gmail_send_email', {
      to: lead.contact_email,
      subject: followUpSubject,
      body: followUpBody,
    })
    sent = true
    log.info({ leadId, email: lead.contact_email }, 'LeadFollowup: follow-up email sent')
  } catch (sendErr) {
    log.warn({ sendErr }, 'LeadFollowup: gmail_send_email failed, falling back to draft')
    try {
      await callGoogleWorkspaceMcpTool('gmail_create_draft', {
        to: lead.contact_email,
        subject: followUpSubject,
        body: followUpBody,
      })
      draftOnly = true
      log.info({ leadId, email: lead.contact_email }, 'LeadFollowup: follow-up draft created')
    } catch (draftErr) {
      const msg = draftErr instanceof Error ? draftErr.message : String(draftErr)
      throw new Error(`Gmail not connected for follow-up. Details: ${msg}`)
    }
  }

  // Update lead: increment follow_up_count, set followed_up_at
  const now = new Date().toISOString()
  const { error: updateErr } = await getSupabaseClient()
    .from('leads')
    .update({ follow_up_count: 1, followed_up_at: now })
    .eq('id', leadId)

  if (updateErr) {
    log.error({ err: updateErr, leadId }, 'LeadFollowup: failed to update follow_up_count (non-fatal)')
  }

  // Log CRM interaction (non-fatal)
  if (lead.contact_id) {
    addInteraction(lead.contact_id, {
      type: 'email_out',
      summary: `Follow-up outreach: ${followUpSubject}`,
      source: 'gmail',
      occurred_at: now,
    }).catch((err: unknown) => {
      log.error({ err, leadId }, 'LeadFollowup: CRM interaction log failed (non-fatal)')
    })
  }

  return { sent, draftOnly }
}

// Orchestrator: find eligible leads and follow up each one.
export async function runFollowUpCycle(
  daysAfterSend = DEFAULT_FOLLOWUP_DAYS,
): Promise<{ processed: number; sent: number; draftOnly: number; failed: number }> {
  const leads = await getLeadsNeedingFollowUp(daysAfterSend)

  if (leads.length === 0) {
    return { processed: 0, sent: 0, draftOnly: 0, failed: 0 }
  }

  log.info({ count: leads.length, daysAfterSend }, 'LeadFollowup: starting follow-up cycle')

  let sent = 0
  let draftOnly = 0
  let failed = 0

  for (const lead of leads) {
    try {
      const result = await executeFollowUp(lead.id)
      if (result.sent) sent++
      else if (result.draftOnly) draftOnly++
    } catch (err) {
      log.error({ err, leadId: lead.id }, 'LeadFollowup: executeFollowUp failed (non-fatal)')
      failed++
    }
  }

  return { processed: leads.length, sent, draftOnly, failed }
}
