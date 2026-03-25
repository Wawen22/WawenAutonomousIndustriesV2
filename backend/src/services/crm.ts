// ============================================================
// WAI – CRM Service (T124 Personal CRM)
// Contact tracking + interaction history for founder Neb.
// ============================================================

import { getSupabaseClient } from './supabase.js'
import { log } from './logger.js'
import type {
  Contact,
  ContactInteraction,
  ContactStatus,
  InteractionType,
  InteractionSource,
} from '../types/index.js'

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export async function getContacts(filter?: { status?: ContactStatus }): Promise<Contact[]> {
  let query = getSupabaseClient()
    .from('contacts')
    .select('*')
    .order('last_contact_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (filter?.status) {
    query = query.eq('status', filter.status)
  }

  const { data, error } = await query

  if (error) {
    log.error({ err: error }, 'CRM: getContacts failed')
    throw new Error(error.message)
  }

  return (data ?? []) as Contact[]
}

export async function getContact(id: string): Promise<Contact | null> {
  const { data, error } = await getSupabaseClient()
    .from('contacts')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    log.error({ err: error, id }, 'CRM: getContact failed')
    throw new Error(error.message)
  }

  return data as Contact | null
}

export interface UpsertContactInput {
  id?: string
  name: string
  email?: string | null
  company?: string | null
  status?: ContactStatus
  last_contact_at?: string | null
  notes?: string
  tags?: string[]
  metadata?: Record<string, unknown>
}

export async function upsertContact(input: UpsertContactInput): Promise<Contact> {
  const supabase = getSupabaseClient()

  if (input.id) {
    // Update existing — only send fields that were explicitly provided
    const { id, ...fields } = input
    const { data, error } = await supabase
      .from('contacts')
      .update(fields)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      log.error({ err: error, id }, 'CRM: upsertContact (update) failed')
      throw new Error(error.message)
    }
    return data as Contact
  }

  // Insert new
  const { data, error } = await supabase
    .from('contacts')
    .insert({
      name: input.name,
      email: input.email ?? null,
      company: input.company ?? null,
      status: input.status ?? 'active',
      notes: input.notes ?? '',
      tags: input.tags ?? [],
      metadata: input.metadata ?? {},
    })
    .select()
    .single()

  if (error) {
    log.error({ err: error }, 'CRM: upsertContact (insert) failed')
    throw new Error(error.message)
  }
  return data as Contact
}

export async function deleteContact(id: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('contacts')
    .delete()
    .eq('id', id)

  if (error) {
    log.error({ err: error, id }, 'CRM: deleteContact failed')
    throw new Error(error.message)
  }
}

export async function findContactByNameOrEmail(query: string): Promise<Contact | null> {
  const supabase = getSupabaseClient()

  // Try exact email match first (case-insensitive via lower)
  const { data: emailMatch } = await supabase
    .from('contacts')
    .select('*')
    .eq('email', query.toLowerCase())
    .maybeSingle()

  if (emailMatch) return emailMatch as Contact

  // Fall back to case-insensitive name substring match
  const { data: nameMatches } = await supabase
    .from('contacts')
    .select('*')
    .ilike('name', `%${query}%`)
    .limit(1)

  return (nameMatches?.[0] as Contact | undefined) ?? null
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

export async function getInteractions(contactId: string): Promise<ContactInteraction[]> {
  const { data, error } = await getSupabaseClient()
    .from('contact_interactions')
    .select('*')
    .eq('contact_id', contactId)
    .order('occurred_at', { ascending: false })

  if (error) {
    log.error({ err: error, contactId }, 'CRM: getInteractions failed')
    throw new Error(error.message)
  }

  return (data ?? []) as ContactInteraction[]
}

export interface AddInteractionInput {
  type: InteractionType
  summary: string
  source?: InteractionSource
  occurred_at?: string
}

export async function addInteraction(
  contactId: string,
  input: AddInteractionInput,
): Promise<ContactInteraction> {
  const supabase = getSupabaseClient()
  const occurredAt = input.occurred_at ?? new Date().toISOString()

  const { data, error } = await supabase
    .from('contact_interactions')
    .insert({
      contact_id: contactId,
      type: input.type,
      summary: input.summary,
      source: input.source ?? 'manual',
      occurred_at: occurredAt,
    })
    .select()
    .single()

  if (error) {
    log.error({ err: error, contactId }, 'CRM: addInteraction failed')
    throw new Error(error.message)
  }

  // Update contact's last_contact_at to the interaction's occurred_at
  await supabase
    .from('contacts')
    .update({ last_contact_at: occurredAt })
    .eq('id', contactId)

  return data as ContactInteraction
}

export async function deleteInteraction(id: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('contact_interactions')
    .delete()
    .eq('id', id)

  if (error) {
    log.error({ err: error, id }, 'CRM: deleteInteraction failed')
    throw new Error(error.message)
  }
}
