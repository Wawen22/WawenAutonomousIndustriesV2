// ============================================================
// WAI – LeadsView (T133 Lead Generation Engine)
// Split-panel Proposal Inbox: lead list + detail + outreach.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import type { Lead, LeadStatus, HarvestRun, LeadFinding } from '../types/index.js'

const BACKEND_URL = (import.meta.env['VITE_BACKEND_URL'] as string | undefined) ?? ''

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return iso.slice(0, 10)
  }
}

function scoreBadgeClass(score: number): string {
  if (score >= 80) return 'bg-emerald-400/15 text-emerald-400 ring-1 ring-emerald-400/30'
  if (score >= 60) return 'bg-amber-400/15 text-amber-400 ring-1 ring-amber-400/30'
  return 'bg-slate-400/15 text-slate-400 ring-1 ring-slate-400/30'
}

const STATUS_BADGE: Record<LeadStatus, string> = {
  new:      'bg-sky-400/10 text-sky-400 ring-1 ring-sky-400/20',
  qualified: 'bg-blue-400/10 text-blue-400 ring-1 ring-blue-400/20',
  approved: 'bg-violet-400/10 text-violet-400 ring-1 ring-violet-400/20',
  sent:     'bg-emerald-400/10 text-emerald-400 ring-1 ring-emerald-400/20',
  replied:  'bg-teal-400/10 text-teal-400 ring-1 ring-teal-400/20',
  won:      'bg-green-400/10 text-green-400 ring-1 ring-green-400/20',
  lost:     'bg-red-400/10 text-red-400 ring-1 ring-red-400/20',
  rejected: 'bg-slate-400/10 text-slate-400 ring-1 ring-slate-400/20',
}

const SEVERITY_DOT: Record<LeadFinding['severity'], string> = {
  high:   'bg-red-400',
  medium: 'bg-amber-400',
  low:    'bg-slate-400',
}

const STATUS_FILTERS: Array<{ key: 'all' | LeadStatus; label: string }> = [
  { key: 'all',       label: 'All' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'approved',  label: 'Approved' },
  { key: 'sent',      label: 'Sent' },
  { key: 'won',       label: 'Won' },
]

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`)
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

// ── Harvest Modal ─────────────────────────────────────────────────────────────

interface HarvestModalProps {
  onClose: () => void
  onStarted: () => void
}

function HarvestModal({ onClose, onStarted }: HarvestModalProps) {
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('Milano, Italy')
  const [limit, setLimit] = useState<5 | 10 | 20>(10)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    try {
      await apiPost('/api/leads/harvest', { query: query.trim(), location, limit })
      onStarted()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Harvest failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#1a1f2e] p-6 shadow-2xl">
        <h2 className="mb-4 text-lg font-semibold text-white">Start Lead Harvest</h2>

        <form onSubmit={(e) => { void handleSubmit(e) }} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Sector / Query</label>
            <input
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-violet-400/50 focus:outline-none"
              placeholder="ristoranti"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Location</label>
            <input
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-violet-400/50 focus:outline-none"
              placeholder="Milano, Italy"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Limit</label>
            <select
              className="w-full rounded-lg border border-white/10 bg-[#1a1f2e] px-3 py-2 text-sm text-white focus:border-violet-400/50 focus:outline-none"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value) as 5 | 10 | 20)}
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
            </select>
          </div>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="flex-1 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {loading ? 'Starting…' : 'Start Harvest'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Lead Detail Panel ─────────────────────────────────────────────────────────

interface DetailPanelProps {
  lead: Lead
  onUpdate: (updated: Lead) => void
  onRemove: (id: string) => void
}

function DetailPanel({ lead, onUpdate, onRemove }: DetailPanelProps) {
  const [subject, setSubject] = useState(lead.outreach_subject)
  const [draft, setDraft] = useState(lead.outreach_draft)
  const [notes, setNotes] = useState(lead.notes)
  const [email, setEmail] = useState(lead.contact_email ?? '')
  const [actionState, setActionState] = useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const [actionMsg, setActionMsg] = useState('')

  // Keep local state in sync when lead changes
  useEffect(() => {
    setSubject(lead.outreach_subject)
    setDraft(lead.outreach_draft)
    setNotes(lead.notes)
    setEmail(lead.contact_email ?? '')
    setActionState('idle')
    setActionMsg('')
  }, [lead.id])

  async function saveField(field: Record<string, unknown>) {
    try {
      const updated = await apiPut<Lead>(`/api/leads/${lead.id}`, field)
      onUpdate(updated)
    } catch {
      // non-fatal inline save
    }
  }

  async function handleApprove() {
    setActionState('working')
    try {
      const updated = await apiPost<Lead>(`/api/leads/${lead.id}/approve`)
      onUpdate(updated)
      setActionState('done')
      setActionMsg('Approved')
    } catch (err) {
      setActionState('error')
      setActionMsg(err instanceof Error ? err.message : 'Failed')
    }
  }

  async function handleReject() {
    setActionState('working')
    try {
      const updated = await apiPost<Lead>(`/api/leads/${lead.id}/reject`)
      onUpdate(updated)
      onRemove(lead.id)
      setActionState('idle')
    } catch (err) {
      setActionState('error')
      setActionMsg(err instanceof Error ? err.message : 'Failed')
    }
  }

  async function handleSend() {
    // Ensure email is saved first
    if (email && email !== lead.contact_email) {
      await saveField({ contact_email: email })
    }
    setActionState('working')
    try {
      await apiPost<{ sent: boolean; draftOnly: boolean }>(`/api/leads/${lead.id}/send`)
      const updated = await apiGet<Lead>(`/api/leads/${lead.id}`)
      onUpdate(updated)
      setActionState('done')
      setActionMsg('Sent ✓')
    } catch (err) {
      setActionState('error')
      setActionMsg(err instanceof Error ? err.message : 'Send failed')
    }
  }

  const canApprove = lead.status === 'qualified' || lead.status === 'new'
  const canSend = lead.status === 'approved'
  const hasSent = lead.status === 'sent' || lead.status === 'replied'

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="border-b border-white/5 p-6">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1">
            <h2 className="text-xl font-bold text-white">{lead.company_name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
              {lead.sector && <span>{lead.sector}</span>}
              {lead.location && <span>📍 {lead.location}</span>}
              {lead.website && (
                <a
                  href={lead.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-violet-400 hover:underline"
                >
                  {new URL(lead.website).hostname}
                </a>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={clsx('rounded-full px-2 py-0.5 text-xs font-bold', scoreBadgeClass(lead.score))}>
              {lead.score}
            </span>
            <span className={clsx('rounded-full px-2 py-0.5 text-xs', STATUS_BADGE[lead.status])}>
              {lead.status}
            </span>
          </div>
        </div>
      </div>

      {/* Findings */}
      {lead.findings.length > 0 && (
        <div className="border-b border-white/5 p-6">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Audit Findings</h3>
          <div className="space-y-2">
            {lead.findings.map((f, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className={clsx('mt-1.5 h-2 w-2 flex-shrink-0 rounded-full', SEVERITY_DOT[f.severity])} />
                <p className="text-sm text-slate-300">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Outreach draft */}
      <div className="border-b border-white/5 p-6 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Outreach Draft</h3>

        <div>
          <label className="mb-1 block text-xs text-slate-500">Subject</label>
          <input
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-violet-400/50 focus:outline-none"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onBlur={() => { if (subject !== lead.outreach_subject) void saveField({ outreach_subject: subject }) }}
            placeholder="Email subject…"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-slate-500">Body</label>
          <textarea
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-violet-400/50 focus:outline-none"
            rows={6}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { if (draft !== lead.outreach_draft) void saveField({ outreach_draft: draft }) }}
            placeholder="Email body…"
          />
        </div>

        {/* Contact email input if missing */}
        {!hasSent && (
          <div>
            <label className="mb-1 block text-xs text-slate-500">Contact Email</label>
            <input
              type="email"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-violet-400/50 focus:outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => { if (email !== (lead.contact_email ?? '')) void saveField({ contact_email: email }) }}
              placeholder="contact@company.com"
            />
          </div>
        )}

        {/* Action buttons */}
        {!hasSent && (
          <div className="flex flex-wrap gap-2 pt-1">
            {canApprove && (
              <button
                onClick={() => { void handleApprove() }}
                disabled={actionState === 'working'}
                className="rounded-lg bg-violet-600/80 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-600 disabled:opacity-50"
              >
                ✓ Approve
              </button>
            )}
            {canSend && (
              <button
                onClick={() => { void handleSend() }}
                disabled={actionState === 'working' || !email.includes('@')}
                className="rounded-lg bg-emerald-600/80 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                ▶ Send Outreach
              </button>
            )}
            {!hasSent && (
              <button
                onClick={() => { void handleReject() }}
                disabled={actionState === 'working'}
                className="rounded-lg border border-red-400/20 px-4 py-1.5 text-sm text-red-400 hover:bg-red-400/10 disabled:opacity-50"
              >
                ✗ Reject
              </button>
            )}
          </div>
        )}

        {actionState === 'done' && (
          <p className="text-sm text-emerald-400">{actionMsg}</p>
        )}
        {actionState === 'error' && (
          <p className="text-sm text-red-400">{actionMsg}</p>
        )}

        {hasSent && lead.sent_at && (
          <p className="text-sm text-slate-400">Sent {fmt(lead.sent_at)}</p>
        )}

        {lead.status === 'sent' && (
          <div className="pt-1">
            <button
              onClick={() => {
                setActionState('working')
                apiPost<Lead>(`/api/leads/${lead.id}/replied`)
                  .then((updated) => {
                    onUpdate(updated)
                    setActionState('idle')
                  })
                  .catch((err: unknown) => {
                    setActionState('error')
                    setActionMsg(err instanceof Error ? err.message : 'Failed to mark replied')
                  })
              }}
              disabled={actionState === 'working'}
              className="px-3 py-1.5 text-xs font-medium rounded bg-teal-500/15 text-teal-400 ring-1 ring-teal-500/30 hover:bg-teal-500/25 transition-colors disabled:opacity-50"
            >
              ✓ Mark Replied
            </button>
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="p-6">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Notes</h3>
        <textarea
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-violet-400/50 focus:outline-none"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => { if (notes !== lead.notes) void saveField({ notes }) }}
          placeholder="Internal notes…"
        />
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function LeadsView() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | LeadStatus>('all')
  const [showHarvestModal, setShowHarvestModal] = useState(false)
  const [activeRun, setActiveRun] = useState<HarvestRun | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wasHarvestingRef = useRef(false)

  const isHarvesting = activeRun?.status === 'running'

  async function refreshLeads() {
    try {
      const data = await apiGet<Lead[]>('/api/leads')
      setLeads(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leads')
    } finally {
      setLoading(false)
    }
  }

  async function checkHarvestStatus() {
    try {
      const runs = await apiGet<HarvestRun[]>('/api/leads/harvest-runs')
      const latest = runs[0] ?? null
      setActiveRun(latest?.status === 'running' ? latest : null)

      if (latest?.status !== 'running') {
        // Harvest just completed or never started
        if (wasHarvestingRef.current) {
          // Was harvesting before — refresh leads to show new results
          wasHarvestingRef.current = false
          void refreshLeads()
        }
      } else {
        wasHarvestingRef.current = true
      }
    } catch {
      // ignore
    }
  }

  // On mount: initial load + start polling every 5s
  // Polling continues always so the dashboard auto-detects harvests from Telegram
  useEffect(() => {
    void refreshLeads()
    void checkHarvestStatus()

    pollRef.current = setInterval(() => { void checkHarvestStatus() }, 5_000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const filtered = statusFilter === 'all'
    ? leads
    : leads.filter((l) => l.status === statusFilter)

  const selected = leads.find((l) => l.id === selectedId) ?? null

  // Stats
  const qualifiedCount = leads.filter((l) => l.status === 'qualified').length
  const approvedCount = leads.filter((l) => l.status === 'approved').length
  const sentCount = leads.filter((l) => l.status === 'sent' || l.status === 'replied').length

  function handleUpdate(updated: Lead) {
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))
  }

  function handleRemove(id: string) {
    setLeads((prev) => prev.filter((l) => l.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left panel ── */}
      <div className="flex w-80 flex-shrink-0 flex-col border-r border-white/5 overflow-hidden">
        {/* Stats row */}
        <div className="border-b border-white/5 px-4 py-3">
          <div className="flex gap-4 text-xs text-slate-400">
            <span><span className="font-semibold text-blue-400">{qualifiedCount}</span> new</span>
            <span><span className="font-semibold text-violet-400">{approvedCount}</span> approved</span>
            <span><span className="font-semibold text-emerald-400">{sentCount}</span> sent</span>
          </div>
        </div>

        {/* Status filter pills */}
        <div className="flex flex-wrap gap-1 border-b border-white/5 px-4 py-2">
          {STATUS_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={clsx(
                'rounded-full px-3 py-0.5 text-xs transition-colors',
                statusFilter === key
                  ? 'bg-violet-600/80 text-white'
                  : 'text-slate-400 hover:text-white',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Harvest button + active indicator */}
        <div className="border-b border-white/5 px-4 py-2 space-y-1.5">
          {isHarvesting && activeRun ? (
            <div className="rounded-lg bg-amber-400/10 border border-amber-400/20 px-3 py-2">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                <span className="text-xs font-medium text-amber-300">
                  Harvesting {activeRun.query ?? '…'} — {activeRun.location ?? ''}
                </span>
              </div>
              {/* Animated progress bar */}
              <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full bg-amber-400/70 animate-progress-indeterminate" />
              </div>
              <p className="mt-1 text-xs text-slate-500">Leads will appear here automatically</p>
            </div>
          ) : (
            <button
              onClick={() => setShowHarvestModal(true)}
              className="w-full rounded-lg border border-dashed border-white/15 py-1.5 text-xs text-slate-400 hover:border-violet-400/40 hover:text-violet-300 transition-colors"
            >
              + Run Harvest
            </button>
          )}
          <button
            onClick={() => {
              apiPost<{ approved: number }>('/api/leads/approve-top?limit=10')
                .then((r) => {
                  if (r.approved > 0) void refreshLeads()
                })
                .catch(() => {})
            }}
            className="px-3 py-1.5 text-xs font-medium rounded bg-violet-500/15 text-violet-400 ring-1 ring-violet-500/30 hover:bg-violet-500/25 transition-colors w-full"
          >
            Approve Top 10
          </button>
        </div>

        {/* Lead list */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12 text-slate-500 text-sm">Loading…</div>
          )}
          {!loading && error && (
            <div className="px-4 py-4 text-xs text-red-400">{error}</div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500 text-sm gap-2">
              <span>No leads</span>
              <button
                onClick={() => setShowHarvestModal(true)}
                className="text-xs text-violet-400 hover:text-violet-300"
              >
                Start a harvest →
              </button>
            </div>
          )}
          {filtered.map((lead) => (
            <button
              key={lead.id}
              onClick={() => setSelectedId(lead.id)}
              className={clsx(
                'w-full border-b border-white/5 px-4 py-3 text-left transition-colors hover:bg-white/3',
                selectedId === lead.id && 'bg-white/5',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="flex-1 truncate text-sm font-medium text-white">{lead.company_name}</p>
                <span className={clsx('flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-bold', scoreBadgeClass(lead.score))}>
                  {lead.score}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                {lead.sector && <span>{lead.sector}</span>}
                {lead.location && <span>· {lead.location}</span>}
              </div>
              {lead.findings.length > 0 && (
                <div className="mt-1.5 flex items-center gap-1">
                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-xs text-slate-400">
                    {lead.findings.length} finding{lead.findings.length > 1 ? 's' : ''}
                  </span>
                  <span className={clsx('rounded-full px-2 py-0.5 text-xs', STATUS_BADGE[lead.status])}>
                    {lead.status}
                  </span>
                </div>
              )}
              {lead.follow_up_count > 0 && (
                <span className="mt-1 block text-xs text-slate-500">↩ {lead.follow_up_count} follow-up</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 overflow-hidden">
        {selected ? (
          <DetailPanel
            key={selected.id}
            lead={selected}
            onUpdate={handleUpdate}
            onRemove={handleRemove}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-slate-500 gap-3">
            <p className="text-sm">Select a lead to review the outreach draft</p>
            {!isHarvesting && leads.length === 0 && !loading && (
              <button
                onClick={() => setShowHarvestModal(true)}
                className="rounded-lg bg-violet-600/80 px-5 py-2 text-sm text-white hover:bg-violet-600"
              >
                + Run First Harvest
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Harvest Modal ── */}
      {showHarvestModal && (
        <HarvestModal
          onClose={() => setShowHarvestModal(false)}
          onStarted={() => {
            wasHarvestingRef.current = true
            void checkHarvestStatus()
          }}
        />
      )}
    </div>
  )
}
