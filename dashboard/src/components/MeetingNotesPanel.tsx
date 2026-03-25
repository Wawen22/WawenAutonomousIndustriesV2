// ============================================================
// WAI – Meeting Notes Panel (T125)
// Save raw meeting notes; AI auto-generates summary + action items.
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { clsx } from 'clsx'
import type { ActionItem, MeetingNote } from '../types/index.js'

const BACKEND_URL = (import.meta.env['VITE_BACKEND_URL'] as string | undefined) ?? ''

interface ActionState {
  status: 'idle' | 'working' | 'done' | 'error'
  message?: string
}

interface NewNoteForm {
  title: string
  meeting_date: string
  attendees: string   // comma-separated input
  raw_notes: string
}

const EMPTY_FORM: NewNoteForm = {
  title: '',
  meeting_date: new Date().toISOString().slice(0, 10),
  attendees: '',
  raw_notes: '',
}

// ---------------------------------------------------------------------------
// NoteCard — expandable single meeting note
// ---------------------------------------------------------------------------

function NoteCard({
  note,
  onDelete,
  onToggleActionItem,
}: {
  note: MeetingNote
  onDelete: (id: string) => void
  onToggleActionItem: (noteId: string, index: number, done: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const actionItems = Array.isArray(note.action_items) ? note.action_items : []
  const doneCount = actionItems.filter((a) => a.done).length

  async function handleDelete() {
    if (!confirm(`Delete meeting note "${note.title}"?`)) return
    setDeleting(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/meeting-notes/${note.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      onDelete(note.id)
    } catch {
      setDeleting(false)
    }
  }

  return (
    <div className={clsx(
      'rounded-2xl border transition-all',
      expanded ? 'border-[#7CF6E6]/15 bg-[#7CF6E6]/[0.03]' : 'border-white/5 bg-white/[0.02] hover:border-white/10',
    )}>
      {/* Header row */}
      <button
        className="w-full flex items-start gap-3 p-4 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="mt-0.5 text-base leading-none select-none">{expanded ? '▼' : '▶'}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-mono text-slate-500">
              {format(parseISO(note.meeting_date), 'dd MMM yyyy')}
            </span>
            {actionItems.length > 0 && (
              <span className={clsx(
                'text-[9px] font-black uppercase tracking-[0.2em] px-2 py-0.5 rounded-full',
                doneCount === actionItems.length
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'bg-[#7CF6E6]/10 text-[#7CF6E6]',
              )}>
                {doneCount}/{actionItems.length} tasks
              </span>
            )}
            {note.summary && (
              <span className="text-[9px] font-black uppercase tracking-[0.2em] px-2 py-0.5 rounded-full bg-white/5 text-slate-500">
                summarized
              </span>
            )}
          </div>
          <p className="mt-1 text-xs font-black text-white truncate">{note.title}</p>
          {note.attendees.length > 0 && (
            <p className="mt-0.5 text-[11px] text-slate-500 truncate">
              👥 {note.attendees.join(', ')}
            </p>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); void handleDelete() }}
          disabled={deleting}
          className="mt-0.5 text-slate-700 hover:text-rose-400 transition-colors text-xs flex-shrink-0"
          title="Delete note"
        >
          ✕
        </button>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-white/5 pt-4">
          {/* Summary */}
          {note.summary ? (
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.28em] text-slate-600 mb-2">Summary</p>
              <p className="text-xs text-slate-300 leading-relaxed">{note.summary}</p>
            </div>
          ) : (
            <p className="text-[11px] text-slate-600 italic">No summary — raw notes only.</p>
          )}

          {/* Action items */}
          {actionItems.length > 0 && (
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.28em] text-slate-600 mb-2">
                Action Items ({doneCount}/{actionItems.length})
              </p>
              <div className="space-y-1.5">
                {actionItems.map((item, idx) => (
                  <label
                    key={idx}
                    className="flex items-start gap-2.5 cursor-pointer group"
                  >
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={(e) => onToggleActionItem(note.id, idx, e.target.checked)}
                      className="mt-0.5 accent-[#7CF6E6] flex-shrink-0"
                    />
                    <span className={clsx(
                      'text-xs leading-relaxed transition-colors',
                      item.done ? 'line-through text-slate-600' : 'text-slate-300 group-hover:text-white',
                    )}>
                      {item.text}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Raw notes toggle */}
          {note.raw_notes && (
            <div>
              <button
                onClick={() => setShowRaw((v) => !v)}
                className="text-[9px] font-black uppercase tracking-[0.28em] text-slate-600 hover:text-slate-400 transition-colors"
              >
                {showRaw ? '▲ Hide Raw Notes' : '▼ Show Raw Notes'}
              </button>
              {showRaw && (
                <pre className="mt-2 text-[11px] text-slate-500 leading-relaxed whitespace-pre-wrap font-mono bg-black/30 rounded-xl p-3 max-h-64 overflow-y-auto">
                  {note.raw_notes}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function MeetingNotesPanel() {
  const [notes, setNotes] = useState<MeetingNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<NewNoteForm>(EMPTY_FORM)
  const [saveState, setSaveState] = useState<ActionState>({ status: 'idle' })

  const fetchNotes = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`${BACKEND_URL}/api/meeting-notes`)
      const data = await res.json() as { notes?: MeetingNote[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setNotes(data.notes ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load meeting notes')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchNotes() }, [fetchNotes])

  async function handleSave() {
    if (!form.title.trim()) return
    setSaveState({ status: 'working' })
    try {
      const body = {
        title: form.title.trim(),
        meeting_date: form.meeting_date,
        raw_notes: form.raw_notes.trim(),
        attendees: form.attendees
          ? form.attendees.split(',').map((a) => a.trim()).filter(Boolean)
          : [],
        auto_summarize: form.raw_notes.trim().length > 0,
      }
      const res = await fetch(`${BACKEND_URL}/api/meeting-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json() as { note?: MeetingNote; error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setNotes((prev) => data.note ? [data.note, ...prev] : prev)
      setForm(EMPTY_FORM)
      setShowForm(false)
      setSaveState({ status: 'done' })
      setTimeout(() => setSaveState({ status: 'idle' }), 2000)
    } catch (err) {
      setSaveState({ status: 'error', message: err instanceof Error ? err.message : 'Save failed' })
    }
  }

  function handleDelete(id: string) {
    setNotes((prev) => prev.filter((n) => n.id !== id))
  }

  async function handleToggleActionItem(noteId: string, index: number, done: boolean) {
    const note = notes.find((n) => n.id === noteId)
    if (!note) return
    const updatedItems = note.action_items.map((item, i): ActionItem =>
      i === index ? { ...item, done } : item,
    )
    // Optimistic update
    setNotes((prev) => prev.map((n) => n.id === noteId ? { ...n, action_items: updatedItems } : n))
    try {
      await fetch(`${BACKEND_URL}/api/meeting-notes/${noteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: note.title, action_items: updatedItems }),
      })
    } catch {
      // revert on failure
      setNotes((prev) => prev.map((n) => n.id === noteId ? note : n))
    }
  }

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          {notes.length > 0 ? `${notes.length} meeting note${notes.length === 1 ? '' : 's'}` : 'No notes yet'}
        </p>
        <button
          onClick={() => { setShowForm((v) => !v); setForm(EMPTY_FORM) }}
          className={clsx(
            'text-[10px] font-black uppercase tracking-[0.2em] px-3 py-1.5 rounded-lg border transition-all',
            showForm
              ? 'border-white/10 text-slate-400 hover:text-white'
              : 'border-[#7CF6E6]/25 text-[#7CF6E6] hover:bg-[#7CF6E6]/10',
          )}
        >
          {showForm ? '✕ Cancel' : '+ New Note'}
        </button>
      </div>

      {/* New note form */}
      {showForm && (
        <div className="rounded-2xl border border-[#7CF6E6]/10 bg-[#7CF6E6]/[0.03] p-5 space-y-4">
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-[#7CF6E6]">New Meeting Note</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-black uppercase tracking-[0.24em] text-slate-600 block mb-1">Title *</label>
              <input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && void handleSave()}
                placeholder="Q1 planning meeting"
                className="w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2 text-xs text-slate-200 outline-none focus:border-[#7CF6E6]/30 transition"
              />
            </div>
            <div>
              <label className="text-[9px] font-black uppercase tracking-[0.24em] text-slate-600 block mb-1">Date</label>
              <input
                type="date"
                value={form.meeting_date}
                onChange={(e) => setForm((f) => ({ ...f, meeting_date: e.target.value }))}
                className="w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2 text-xs text-slate-200 outline-none focus:border-[#7CF6E6]/30 transition"
              />
            </div>
          </div>

          <div>
            <label className="text-[9px] font-black uppercase tracking-[0.24em] text-slate-600 block mb-1">Attendees (comma-separated)</label>
            <input
              value={form.attendees}
              onChange={(e) => setForm((f) => ({ ...f, attendees: e.target.value }))}
              placeholder="Alice, Bob, Charlie"
              className="w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2 text-xs text-slate-200 outline-none focus:border-[#7CF6E6]/30 transition"
            />
          </div>

          <div>
            <label className="text-[9px] font-black uppercase tracking-[0.24em] text-slate-600 block mb-1">
              Raw Notes
              <span className="ml-2 text-slate-700 normal-case tracking-normal">(AI will generate summary + action items)</span>
            </label>
            <textarea
              value={form.raw_notes}
              onChange={(e) => setForm((f) => ({ ...f, raw_notes: e.target.value }))}
              placeholder="Paste your raw meeting notes, transcript, or bullet points here…"
              rows={6}
              className="w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2 text-xs text-slate-200 outline-none focus:border-[#7CF6E6]/30 transition resize-none font-mono"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => void handleSave()}
              disabled={!form.title.trim() || saveState.status === 'working'}
              className={clsx(
                'px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all',
                form.title.trim() && saveState.status !== 'working'
                  ? 'bg-[#7CF6E6] text-black hover:bg-[#7CF6E6]/90'
                  : 'bg-white/5 text-slate-600 cursor-not-allowed',
              )}
            >
              {saveState.status === 'working' ? 'Saving & Summarizing…' : 'Save & Summarize'}
            </button>
            {saveState.status === 'error' && (
              <p className="text-[11px] text-rose-400">{saveState.message}</p>
            )}
            {form.raw_notes.trim().length === 0 && form.title.trim() && (
              <p className="text-[10px] text-slate-600">No notes — will save without AI summary.</p>
            )}
          </div>
        </div>
      )}

      {/* State: loading / error / empty */}
      {loading && (
        <div className="flex items-center gap-2 text-[11px] text-slate-600">
          <div className="w-3.5 h-3.5 border border-slate-700 border-t-[#7CF6E6] rounded-full animate-spin" />
          Loading meeting notes…
        </div>
      )}
      {!loading && error && (
        <p className="text-[11px] text-rose-400">{error}</p>
      )}
      {!loading && !error && notes.length === 0 && !showForm && (
        <div className="rounded-2xl border border-dashed border-white/8 p-8 text-center">
          <p className="text-xs text-slate-500">No meeting notes yet.</p>
          <p className="mt-1 text-[11px] text-slate-600">
            Save notes from Telegram: <span className="font-mono text-slate-500">"salva note riunione Q1 planning..."</span>
          </p>
        </div>
      )}

      {/* Note list */}
      {!loading && notes.length > 0 && (
        <div className="space-y-2">
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onDelete={handleDelete}
              onToggleActionItem={handleToggleActionItem}
            />
          ))}
        </div>
      )}
    </div>
  )
}
