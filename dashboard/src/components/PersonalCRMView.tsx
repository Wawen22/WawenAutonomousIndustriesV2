// ============================================================
// WAI – Personal CRM View (T124)
// Split-panel: contact list (left) + contact detail (right).
// Founder-focused: status, notes, tags, interaction history.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { formatDistanceToNow, format } from 'date-fns'
import type { Contact, ContactInteraction, ContactStatus, InteractionType } from '../types/index.js'

const BACKEND_URL = (import.meta.env['VITE_BACKEND_URL'] as string | undefined) ?? ''

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function relativeDate(iso: string | null | undefined): string {
  if (!iso) return 'never'
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return iso.slice(0, 10)
  }
}

const STATUS_LABELS: Record<ContactStatus, string> = {
  active: 'Active',
  follow_up: 'Follow-up',
  dormant: 'Dormant',
}

const STATUS_BADGE: Record<ContactStatus, string> = {
  active: 'bg-emerald-400/10 text-emerald-400 ring-1 ring-emerald-400/20',
  follow_up: 'bg-amber-400/10 text-amber-400 ring-1 ring-amber-400/20',
  dormant: 'bg-slate-400/10 text-slate-400 ring-1 ring-slate-400/20',
}

const STATUS_BTN_ACTIVE: Record<ContactStatus, string> = {
  active: 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40',
  follow_up: 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/40',
  dormant: 'bg-slate-500/20 text-slate-300 ring-1 ring-slate-400/40',
}

const INTERACTION_ICONS: Record<InteractionType, string> = {
  email_in: '📥',
  email_out: '📤',
  meeting: '📅',
  note: '📝',
  call: '📞',
}

const INTERACTION_LABELS: Record<InteractionType, string> = {
  email_in: 'Email in',
  email_out: 'Email out',
  meeting: 'Meeting',
  note: 'Note',
  call: 'Call',
}

interface ActionState {
  status: 'idle' | 'working' | 'done' | 'error'
  message?: string
}

// ── Main component ───────────────────────────────────────────────────────────

export function PersonalCRMView() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | ContactStatus>('all')

  // Add-contact modal
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', email: '', company: '' })
  const [addState, setAddState] = useState<ActionState>({ status: 'idle' })

  const selectedContact = useMemo(
    () => contacts.find((c) => c.id === selectedId) ?? null,
    [contacts, selectedId],
  )

  const counts = useMemo(
    () => ({
      all: contacts.length,
      active: contacts.filter((c) => c.status === 'active').length,
      follow_up: contacts.filter((c) => c.status === 'follow_up').length,
      dormant: contacts.filter((c) => c.status === 'dormant').length,
    }),
    [contacts],
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return contacts.filter((c) => {
      const matchStatus = statusFilter === 'all' || c.status === statusFilter
      const matchSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        (c.email?.toLowerCase().includes(q) ?? false) ||
        (c.company?.toLowerCase().includes(q) ?? false)
      return matchStatus && matchSearch
    })
  }, [contacts, statusFilter, search])

  const fetchContacts = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`${BACKEND_URL}/api/crm/contacts`)
      const data = await res.json() as { contacts?: Contact[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setContacts(data.contacts ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contacts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchContacts() }, [fetchContacts])

  async function handleAddContact() {
    if (!addForm.name.trim()) return
    setAddState({ status: 'working' })
    try {
      const res = await fetch(`${BACKEND_URL}/api/crm/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: addForm.name.trim(),
          email: addForm.email.trim() || null,
          company: addForm.company.trim() || null,
        }),
      })
      const data = await res.json() as { contact?: Contact; error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      if (data.contact) {
        setContacts((prev) => [data.contact!, ...prev])
        setSelectedId(data.contact.id)
        setShowAddForm(false)
        setAddForm({ name: '', email: '', company: '' })
        setAddState({ status: 'idle' })
      }
    } catch (err) {
      setAddState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to add contact' })
    }
  }

  function updateContactInList(updated: Contact) {
    setContacts((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
  }

  function removeContactFromList(id: string) {
    setContacts((prev) => prev.filter((c) => c.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── LEFT: Contact List ─────────────────────────────────── */}
      <div className="flex w-80 flex-shrink-0 flex-col border-r border-slate-700/60">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700/60 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-200">Contacts</h2>
          <button
            onClick={() => setShowAddForm(true)}
            className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500 transition-colors"
          >
            + Add
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-slate-700/60 px-3 py-2">
          <input
            type="text"
            placeholder="Search name, email, company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded bg-slate-800 px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 outline-none ring-1 ring-slate-700 focus:ring-indigo-500"
          />
        </div>

        {/* Status filter pills */}
        <div className="flex flex-wrap gap-1 border-b border-slate-700/60 px-3 py-2">
          {(['all', 'active', 'follow_up', 'dormant'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={clsx(
                'rounded px-2 py-0.5 text-xs font-medium transition-colors',
                statusFilter === s ? 'bg-slate-600 text-slate-100' : 'text-slate-500 hover:text-slate-300',
              )}
            >
              {s === 'all' ? 'All' : STATUS_LABELS[s]}
              <span className="ml-1 text-slate-600">{counts[s]}</span>
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading && <p className="px-4 py-6 text-xs text-slate-500">Loading…</p>}
          {error && <p className="px-4 py-6 text-xs text-red-400">{error}</p>}
          {!loading && filtered.length === 0 && (
            <p className="px-4 py-6 text-xs text-slate-500">
              {search || statusFilter !== 'all' ? 'No contacts match this filter.' : 'No contacts yet. Add one.'}
            </p>
          )}
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={clsx(
                'w-full border-b border-slate-700/40 px-4 py-3 text-left transition-colors',
                selectedId === c.id ? 'bg-slate-700/60' : 'hover:bg-slate-800/50',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-slate-200">{c.name}</span>
                <span className={clsx('flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium', STATUS_BADGE[c.status])}>
                  {STATUS_LABELS[c.status]}
                </span>
              </div>
              {c.company && (
                <p className="mt-0.5 truncate text-xs text-slate-500">{c.company}</p>
              )}
              <p className="mt-0.5 text-[10px] text-slate-600">{relativeDate(c.last_contact_at)}</p>
              {c.tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {c.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="rounded bg-slate-700/80 px-1.5 py-0.5 text-[10px] text-slate-400">
                      {tag}
                    </span>
                  ))}
                  {c.tags.length > 3 && (
                    <span className="text-[10px] text-slate-600">+{c.tags.length - 3}</span>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── RIGHT: Contact Detail ──────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {selectedContact ? (
          <ContactDetail
            contact={selectedContact}
            onUpdate={updateContactInList}
            onDelete={removeContactFromList}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-slate-500">Select a contact to view details.</p>
              <button
                onClick={() => setShowAddForm(true)}
                className="mt-3 text-xs text-indigo-400 hover:text-indigo-300"
              >
                Or add a new one →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Add Contact Modal ──────────────────────────────────── */}
      {showAddForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowAddForm(false); setAddState({ status: 'idle' }) } }}
        >
          <div className="w-96 rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-xl">
            <h3 className="mb-4 text-sm font-semibold text-slate-200">New Contact</h3>
            <div className="space-y-3">
              <input
                autoFocus
                type="text"
                placeholder="Name *"
                value={addForm.name}
                onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleAddContact() }}
                className="w-full rounded bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none ring-1 ring-slate-700 focus:ring-indigo-500"
              />
              <input
                type="email"
                placeholder="Email"
                value={addForm.email}
                onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full rounded bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none ring-1 ring-slate-700 focus:ring-indigo-500"
              />
              <input
                type="text"
                placeholder="Company"
                value={addForm.company}
                onChange={(e) => setAddForm((f) => ({ ...f, company: e.target.value }))}
                className="w-full rounded bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none ring-1 ring-slate-700 focus:ring-indigo-500"
              />
            </div>
            {addState.status === 'error' && (
              <p className="mt-2 text-xs text-red-400">{addState.message}</p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => void handleAddContact()}
                disabled={addState.status === 'working' || !addForm.name.trim()}
                className="flex-1 rounded bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
              >
                {addState.status === 'working' ? 'Saving…' : 'Add Contact'}
              </button>
              <button
                onClick={() => { setShowAddForm(false); setAddForm({ name: '', email: '', company: '' }); setAddState({ status: 'idle' }) }}
                className="rounded px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── ContactDetail sub-component ───────────────────────────────────────────────

interface ContactDetailProps {
  contact: Contact
  onUpdate: (contact: Contact) => void
  onDelete: (id: string) => void
}

function ContactDetail({ contact, onUpdate, onDelete }: ContactDetailProps) {
  const [interactions, setInteractions] = useState<ContactInteraction[]>([])
  const [intLoading, setIntLoading] = useState(true)

  const [editingName, setEditingName] = useState(contact.name)
  const [editingEmail, setEditingEmail] = useState(contact.email ?? '')
  const [editingCompany, setEditingCompany] = useState(contact.company ?? '')
  const [editingNotes, setEditingNotes] = useState(contact.notes)
  const [notesSaveState, setNotesSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [newTag, setNewTag] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [intForm, setIntForm] = useState<{ type: InteractionType; summary: string; occurred_at: string }>({
    type: 'note',
    summary: '',
    occurred_at: todayIso(),
  })
  const [intState, setIntState] = useState<ActionState>({ status: 'idle' })
  const [deletingIntId, setDeletingIntId] = useState<string | null>(null)

  // Sync local editing state when contact prop changes (different contact selected)
  useEffect(() => {
    setEditingName(contact.name)
    setEditingEmail(contact.email ?? '')
    setEditingCompany(contact.company ?? '')
    setEditingNotes(contact.notes)
    setNotesSaveState('idle')
    setConfirmDelete(false)
    setIntForm({ type: 'note', summary: '', occurred_at: todayIso() })
    setIntState({ status: 'idle' })
  }, [contact.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchInteractions = useCallback(async () => {
    setIntLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/crm/contacts/${contact.id}/interactions`)
      const data = await res.json() as { interactions?: ContactInteraction[]; error?: string }
      setInteractions(data.interactions ?? [])
    } catch {
      // non-fatal
    } finally {
      setIntLoading(false)
    }
  }, [contact.id])

  useEffect(() => { void fetchInteractions() }, [fetchInteractions])

  async function patchContact(fields: Partial<Contact>): Promise<Contact | null> {
    try {
      const res = await fetch(`${BACKEND_URL}/api/crm/contacts/${contact.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...contact, ...fields }),
      })
      const data = await res.json() as { contact?: Contact; error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      if (data.contact) { onUpdate(data.contact); return data.contact }
      return null
    } catch {
      return null
    }
  }

  async function handleStatusChange(status: ContactStatus) {
    onUpdate({ ...contact, status }) // optimistic
    await patchContact({ status })
  }

  async function handleNameBlur() {
    const name = editingName.trim()
    if (!name || name === contact.name) { setEditingName(contact.name); return }
    await patchContact({ name })
  }

  async function handleEmailBlur() {
    const email = editingEmail.trim() || null
    if (email === (contact.email ?? null)) return
    await patchContact({ email })
  }

  async function handleCompanyBlur() {
    const company = editingCompany.trim() || null
    if (company === (contact.company ?? null)) return
    await patchContact({ company })
  }

  async function handleNotesBlur() {
    if (editingNotes === contact.notes) return
    setNotesSaveState('saving')
    const result = await patchContact({ notes: editingNotes })
    setNotesSaveState(result ? 'saved' : 'error')
    if (result) setTimeout(() => setNotesSaveState('idle'), 2000)
  }

  async function handleAddTag() {
    const tag = newTag.trim().toLowerCase()
    if (!tag || contact.tags.includes(tag)) { setNewTag(''); return }
    const tags = [...contact.tags, tag]
    onUpdate({ ...contact, tags }) // optimistic
    setNewTag('')
    await patchContact({ tags })
  }

  async function handleRemoveTag(tag: string) {
    const tags = contact.tags.filter((t) => t !== tag)
    onUpdate({ ...contact, tags }) // optimistic
    await patchContact({ tags })
  }

  async function handleAddInteraction() {
    if (!intForm.summary.trim()) return
    setIntState({ status: 'working' })
    try {
      // Parse the date input as local noon to avoid timezone off-by-one
      const occurred_at = new Date(`${intForm.occurred_at}T12:00:00`).toISOString()
      const res = await fetch(`${BACKEND_URL}/api/crm/contacts/${contact.id}/interactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: intForm.type, summary: intForm.summary.trim(), occurred_at }),
      })
      const data = await res.json() as { interaction?: ContactInteraction; error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      if (data.interaction) {
        setInteractions((prev) => [data.interaction!, ...prev])
        onUpdate({ ...contact, last_contact_at: data.interaction.occurred_at })
        setIntForm({ type: 'note', summary: '', occurred_at: todayIso() })
        setIntState({ status: 'idle' })
      }
    } catch (err) {
      setIntState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to log interaction' })
    }
  }

  async function handleDeleteInteraction(id: string) {
    setDeletingIntId(id)
    setInteractions((prev) => prev.filter((i) => i.id !== id)) // optimistic
    try {
      const res = await fetch(`${BACKEND_URL}/api/crm/interactions/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        // revert on failure
        void fetchInteractions()
      }
    } finally {
      setDeletingIntId(null)
    }
  }

  async function handleDeleteContact() {
    await fetch(`${BACKEND_URL}/api/crm/contacts/${contact.id}`, { method: 'DELETE' })
    onDelete(contact.id)
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-5">
      {/* ── Header ── */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <input
            type="text"
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onBlur={() => void handleNameBlur()}
            className="w-full bg-transparent text-lg font-semibold text-slate-100 outline-none hover:bg-slate-800/40 focus:bg-slate-800/40 rounded px-2 py-0.5 -mx-2 transition-colors"
          />
          <input
            type="text"
            value={editingCompany}
            onChange={(e) => setEditingCompany(e.target.value)}
            onBlur={() => void handleCompanyBlur()}
            placeholder="Company"
            className="w-full bg-transparent text-sm text-slate-400 outline-none hover:bg-slate-800/40 focus:bg-slate-800/40 rounded px-2 py-0.5 -mx-2 placeholder-slate-600 transition-colors"
          />
          <input
            type="email"
            value={editingEmail}
            onChange={(e) => setEditingEmail(e.target.value)}
            onBlur={() => void handleEmailBlur()}
            placeholder="Email"
            className="w-full bg-transparent text-sm text-slate-400 outline-none hover:bg-slate-800/40 focus:bg-slate-800/40 rounded px-2 py-0.5 -mx-2 placeholder-slate-600 transition-colors"
          />
        </div>
        <div className="flex-shrink-0">
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs text-slate-600 hover:text-red-400 transition-colors"
            >
              Delete
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => void handleDeleteContact()} className="text-xs text-red-400 hover:text-red-300">
                Confirm delete
              </button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs text-slate-500 hover:text-slate-300">
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Status ── */}
      <div className="mb-4">
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-slate-500">Status</p>
        <div className="flex gap-2">
          {(['active', 'follow_up', 'dormant'] as ContactStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => void handleStatusChange(s)}
              className={clsx(
                'rounded px-3 py-1 text-xs font-medium transition-colors',
                contact.status === s ? STATUS_BTN_ACTIVE[s] : 'text-slate-500 hover:text-slate-300',
              )}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* ── Notes ── */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Notes</p>
          {notesSaveState === 'saving' && <span className="text-[10px] text-slate-500">Saving…</span>}
          {notesSaveState === 'saved' && <span className="text-[10px] text-emerald-400">Saved ✓</span>}
          {notesSaveState === 'error' && <span className="text-[10px] text-red-400">Save failed</span>}
        </div>
        <textarea
          value={editingNotes}
          onChange={(e) => setEditingNotes(e.target.value)}
          onBlur={() => void handleNotesBlur()}
          rows={3}
          placeholder="Add notes about this contact…"
          className="w-full rounded bg-slate-800/60 px-3 py-2 text-sm text-slate-300 placeholder-slate-600 outline-none ring-1 ring-slate-700 focus:ring-indigo-500 resize-none"
        />
      </div>

      {/* ── Tags ── */}
      <div className="mb-6">
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-slate-500">Tags</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {contact.tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded bg-slate-700 px-2 py-0.5 text-xs text-slate-300"
            >
              {tag}
              <button
                onClick={() => void handleRemoveTag(tag)}
                className="text-slate-500 hover:text-red-400 transition-colors leading-none"
                aria-label={`Remove tag ${tag}`}
              >
                ×
              </button>
            </span>
          ))}
          <input
            type="text"
            placeholder="+ tag"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleAddTag() }}
            onBlur={() => { if (newTag.trim()) void handleAddTag() }}
            className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 placeholder-slate-600 outline-none ring-1 ring-slate-700 focus:ring-indigo-500 w-20"
          />
        </div>
      </div>

      {/* ── Interaction History ── */}
      <div>
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-slate-500">Interaction History</p>

        {/* Add interaction form */}
        <div className="mb-4 rounded-lg bg-slate-800/60 p-3 ring-1 ring-slate-700">
          <div className="mb-2 flex gap-2">
            <select
              value={intForm.type}
              onChange={(e) => setIntForm((f) => ({ ...f, type: e.target.value as InteractionType }))}
              className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-200 outline-none cursor-pointer"
            >
              {(Object.keys(INTERACTION_LABELS) as InteractionType[]).map((t) => (
                <option key={t} value={t}>
                  {INTERACTION_ICONS[t]} {INTERACTION_LABELS[t]}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={intForm.occurred_at}
              onChange={(e) => setIntForm((f) => ({ ...f, occurred_at: e.target.value }))}
              className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-200 outline-none"
            />
          </div>
          <textarea
            value={intForm.summary}
            onChange={(e) => setIntForm((f) => ({ ...f, summary: e.target.value }))}
            placeholder="What happened?"
            rows={2}
            className="mb-2 w-full rounded bg-slate-700/60 px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 outline-none ring-1 ring-slate-600 focus:ring-indigo-500 resize-none"
          />
          {intState.status === 'error' && (
            <p className="mb-1.5 text-xs text-red-400">{intState.message}</p>
          )}
          <button
            onClick={() => void handleAddInteraction()}
            disabled={intState.status === 'working' || !intForm.summary.trim()}
            className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
          >
            {intState.status === 'working' ? 'Logging…' : 'Log Interaction'}
          </button>
        </div>

        {/* Timeline */}
        {intLoading && <p className="text-xs text-slate-500">Loading history…</p>}
        {!intLoading && interactions.length === 0 && (
          <p className="text-xs text-slate-600">No interactions logged yet.</p>
        )}
        <div className="space-y-2">
          {interactions.map((i) => (
            <div
              key={i.id}
              className="group relative rounded-lg bg-slate-800/40 px-3 py-2.5 ring-1 ring-slate-700/60"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-base leading-none">{INTERACTION_ICONS[i.type]}</span>
                  <div>
                    <span className="text-xs font-medium text-slate-300">{INTERACTION_LABELS[i.type]}</span>
                    {i.source !== 'manual' && (
                      <span className="ml-1.5 rounded bg-slate-700 px-1 py-0.5 text-[10px] text-slate-500">
                        {i.source}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <time className="text-[10px] text-slate-600">
                    {format(new Date(i.occurred_at), 'dd MMM yyyy')}
                  </time>
                  <button
                    onClick={() => void handleDeleteInteraction(i.id)}
                    disabled={deletingIntId === i.id}
                    className="hidden text-slate-600 hover:text-red-400 group-hover:inline text-xs transition-colors disabled:opacity-50"
                    aria-label="Delete interaction"
                  >
                    ×
                  </button>
                </div>
              </div>
              <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">{i.summary}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
