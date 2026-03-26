// ============================================================
// WAI – Leads Service (T133 Lead Generation Engine)
// CRUD for leads + harvest_runs tables.
// ============================================================

import { getSupabaseClient } from './supabase.js'
import { log } from './logger.js'
import type { Lead, LeadStatus, LeadSource, HarvestRun } from '../types/index.js'

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export async function getLeads(filter?: {
  status?: LeadStatus
  source?: LeadSource
  minScore?: number
  limit?: number
}): Promise<Lead[]> {
  let query = getSupabaseClient()
    .from('leads')
    .select('*')
    .order('score', { ascending: false })
    .order('created_at', { ascending: false })

  if (filter?.status) {
    query = query.eq('status', filter.status)
  }
  if (filter?.source) {
    query = query.eq('source', filter.source)
  }
  if (filter?.minScore !== undefined) {
    query = query.gte('score', filter.minScore)
  }
  if (filter?.limit) {
    query = query.limit(filter.limit)
  }

  const { data, error } = await query

  if (error) {
    log.error({ err: error }, 'Leads: getLeads failed')
    throw new Error(error.message)
  }

  return (data ?? []) as Lead[]
}

export async function getLead(id: string): Promise<Lead | null> {
  const { data, error } = await getSupabaseClient()
    .from('leads')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    log.error({ err: error, id }, 'Leads: getLead failed')
    throw new Error(error.message)
  }

  return data as Lead | null
}

export interface SaveLeadInput {
  id?: string
  source?: LeadSource
  status?: LeadStatus
  company_name: string
  contact_name?: string | null
  contact_email?: string | null
  website?: string | null
  phone?: string | null
  location?: string | null
  sector?: string | null
  score?: number
  findings?: import('../types/index.js').LeadFinding[]
  outreach_subject?: string
  outreach_draft?: string
  source_url?: string | null
  contact_id?: string | null
  notes?: string
  sent_at?: string | null
  replied_at?: string | null
  thread_id?: string | null
}

export async function saveLead(input: SaveLeadInput): Promise<Lead> {
  const supabase = getSupabaseClient()

  if (input.id) {
    // Update — build row imperatively for exactOptionalPropertyTypes safety
    const row: Record<string, unknown> = {}
    if (input.source !== undefined) row['source'] = input.source
    if (input.status !== undefined) row['status'] = input.status
    if (input.company_name !== undefined) row['company_name'] = input.company_name
    if (input.contact_name !== undefined) row['contact_name'] = input.contact_name
    if (input.contact_email !== undefined) row['contact_email'] = input.contact_email
    if (input.website !== undefined) row['website'] = input.website
    if (input.phone !== undefined) row['phone'] = input.phone
    if (input.location !== undefined) row['location'] = input.location
    if (input.sector !== undefined) row['sector'] = input.sector
    if (input.score !== undefined) row['score'] = input.score
    if (input.findings !== undefined) row['findings'] = input.findings
    if (input.outreach_subject !== undefined) row['outreach_subject'] = input.outreach_subject
    if (input.outreach_draft !== undefined) row['outreach_draft'] = input.outreach_draft
    if (input.source_url !== undefined) row['source_url'] = input.source_url
    if (input.contact_id !== undefined) row['contact_id'] = input.contact_id
    if (input.notes !== undefined) row['notes'] = input.notes
    if (input.sent_at !== undefined) row['sent_at'] = input.sent_at
    if (input.replied_at !== undefined) row['replied_at'] = input.replied_at
    if (input.thread_id !== undefined) row['thread_id'] = input.thread_id

    const { data, error } = await supabase
      .from('leads')
      .update(row)
      .eq('id', input.id)
      .select()
      .single()

    if (error) {
      log.error({ err: error, id: input.id }, 'Leads: saveLead (update) failed')
      throw new Error(error.message)
    }
    return data as Lead
  }

  // Insert new
  const row: Record<string, unknown> = {
    company_name: input.company_name,
    source: input.source ?? 'website_audit',
    status: input.status ?? 'qualified',
    score: input.score ?? 0,
    findings: input.findings ?? [],
    outreach_subject: input.outreach_subject ?? '',
    outreach_draft: input.outreach_draft ?? '',
    notes: input.notes ?? '',
  }
  if (input.contact_name != null) row['contact_name'] = input.contact_name
  if (input.contact_email != null) row['contact_email'] = input.contact_email
  if (input.website != null) row['website'] = input.website
  if (input.phone != null) row['phone'] = input.phone
  if (input.location != null) row['location'] = input.location
  if (input.sector != null) row['sector'] = input.sector
  if (input.source_url != null) row['source_url'] = input.source_url
  if (input.contact_id != null) row['contact_id'] = input.contact_id
  if (input.sent_at != null) row['sent_at'] = input.sent_at
  if (input.replied_at != null) row['replied_at'] = input.replied_at
  if (input.thread_id != null) row['thread_id'] = input.thread_id

  const { data, error } = await supabase
    .from('leads')
    .insert(row)
    .select()
    .single()

  if (error) {
    log.error({ err: error }, 'Leads: saveLead (insert) failed')
    throw new Error(error.message)
  }
  return data as Lead
}

export async function updateLeadStatus(
  id: string,
  status: LeadStatus,
  extra?: { sent_at?: string; replied_at?: string },
): Promise<Lead> {
  const row: Record<string, unknown> = { status }
  if (extra?.sent_at) row['sent_at'] = extra.sent_at
  if (extra?.replied_at) row['replied_at'] = extra.replied_at

  const { data, error } = await getSupabaseClient()
    .from('leads')
    .update(row)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    log.error({ err: error, id, status }, 'Leads: updateLeadStatus failed')
    throw new Error(error.message)
  }
  return data as Lead
}

export async function deleteLead(id: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('leads')
    .delete()
    .eq('id', id)

  if (error) {
    log.error({ err: error, id }, 'Leads: deleteLead failed')
    throw new Error(error.message)
  }
}

// ---------------------------------------------------------------------------
// Harvest Runs
// ---------------------------------------------------------------------------

export async function getHarvestRuns(limit = 10): Promise<HarvestRun[]> {
  const { data, error } = await getSupabaseClient()
    .from('harvest_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit)

  if (error) {
    log.error({ err: error }, 'Leads: getHarvestRuns failed')
    throw new Error(error.message)
  }

  return (data ?? []) as HarvestRun[]
}

export async function startHarvestRun(
  harvester: string,
  query: string | null,
  location: string | null,
): Promise<HarvestRun> {
  const row: Record<string, unknown> = {
    harvester,
    leads_found: 0,
    status: 'running',
  }
  if (query != null) row['query'] = query
  if (location != null) row['location'] = location

  const { data, error } = await getSupabaseClient()
    .from('harvest_runs')
    .insert(row)
    .select()
    .single()

  if (error) {
    log.error({ err: error }, 'Leads: startHarvestRun failed')
    throw new Error(error.message)
  }
  return data as HarvestRun
}

export async function completeHarvestRun(id: string, leadsFound: number): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('harvest_runs')
    .update({
      status: 'done',
      leads_found: leadsFound,
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) {
    log.error({ err: error, id }, 'Leads: completeHarvestRun failed')
  }
}

export async function failHarvestRun(id: string, errorMsg: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('harvest_runs')
    .update({
      status: 'failed',
      error: errorMsg,
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) {
    log.error({ err: error, id }, 'Leads: failHarvestRun failed')
  }
}
