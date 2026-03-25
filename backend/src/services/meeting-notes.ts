// ============================================================
// WAI – Meeting Notes Service (T125)
// CRUD + LLM-powered summarization of meeting notes.
// ============================================================

import { getSupabaseClient } from './supabase.js'
import { runAgent } from './llm.js'
import { log } from './logger.js'
import type { ActionItem, MeetingNote } from '../types/index.js'

export interface SaveMeetingNoteInput {
  id?: string
  title: string
  meeting_date?: string       // YYYY-MM-DD
  attendees?: string[]
  raw_notes?: string
  summary?: string
  action_items?: ActionItem[]
  calendar_event_id?: string | null
  contact_ids?: string[]
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getMeetingNotes(limit = 20): Promise<MeetingNote[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('meeting_notes')
    .select('*')
    .order('meeting_date', { ascending: false })
    .limit(limit)
  if (error) {
    log.error({ err: error }, 'getMeetingNotes failed')
    throw new Error(error.message)
  }
  return (data ?? []) as MeetingNote[]
}

export async function getMeetingNote(id: string): Promise<MeetingNote | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('meeting_notes')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    log.error({ err: error }, 'getMeetingNote failed')
    throw new Error(error.message)
  }
  return data as MeetingNote | null
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function saveMeetingNote(input: SaveMeetingNoteInput): Promise<MeetingNote> {
  const supabase = getSupabaseClient()

  const row: Record<string, unknown> = { title: input.title }
  if (input.id) row['id'] = input.id
  if (input.meeting_date !== undefined) row['meeting_date'] = input.meeting_date
  if (input.attendees !== undefined) row['attendees'] = input.attendees
  if (input.raw_notes !== undefined) row['raw_notes'] = input.raw_notes
  if (input.summary !== undefined) row['summary'] = input.summary
  if (input.action_items !== undefined) row['action_items'] = input.action_items
  if ('calendar_event_id' in input) row['calendar_event_id'] = input.calendar_event_id ?? null
  if (input.contact_ids !== undefined) row['contact_ids'] = input.contact_ids

  const { data, error } = await supabase
    .from('meeting_notes')
    .upsert(row, { onConflict: 'id' })
    .select()
    .single()
  if (error) {
    log.error({ err: error }, 'saveMeetingNote failed')
    throw new Error(error.message)
  }
  return data as MeetingNote
}

export async function deleteMeetingNote(id: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.from('meeting_notes').delete().eq('id', id)
  if (error) {
    log.error({ err: error }, 'deleteMeetingNote failed')
    throw new Error(error.message)
  }
}

// ---------------------------------------------------------------------------
// LLM summarization
// ---------------------------------------------------------------------------

export async function summarizeMeetingNotes(
  title: string,
  rawNotes: string,
  attendees: string[],
): Promise<{ summary: string; action_items: ActionItem[] }> {
  const attendeeStr = attendees.length > 0 ? attendees.join(', ') : 'unknown'

  const prompt = `You are WAI's meeting intelligence layer. Given raw meeting notes, generate a structured summary and extract action items.

Meeting: ${title}
Attendees: ${attendeeStr}
Raw Notes:
${rawNotes}

Return ONLY valid JSON in this exact format:
{
  "summary": "<2-4 sentences describing key outcomes, decisions, and context>",
  "action_items": [
    { "text": "<concrete action item>", "done": false }
  ]
}

Rules:
- summary: concise, factual, 2-4 sentences
- action_items: concrete assignable tasks only (e.g. "Send proposal to John by Friday")
- If no clear action items found, return empty array []
- Return ONLY the JSON object, no markdown, no extra text`

  const result = await runAgent(
    [{ role: 'user', content: prompt }],
    { agentId: 'system_learning', modelOverride: 'nemotron-120b', captureMemory: false },
  )

  const jsonMatch = result.content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return { summary: result.content.trim().slice(0, 500), action_items: [] }
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { summary?: unknown; action_items?: unknown }
    const summary = typeof parsed.summary === 'string' ? parsed.summary : ''
    const items = Array.isArray(parsed.action_items)
      ? (parsed.action_items as ActionItem[]).filter(
          (item) => typeof item === 'object' && item !== null && typeof item.text === 'string',
        )
      : []
    return { summary, action_items: items }
  } catch {
    return { summary: result.content.trim().slice(0, 500), action_items: [] }
  }
}
