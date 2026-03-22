// ============================================================
// WAI Dashboard – Settings View (T118)
// Company Automations + Notification Channel Preferences.
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { clsx } from 'clsx'
import type { CompanyAutomationsState, NotificationPreferences, WhatsAppStatus } from '../types/index.js'

const API_BASE = (import.meta.env['VITE_BACKEND_URL'] as string | undefined) ?? ''

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

type SettingsTab = 'automations' | 'notifications'

// ─── helpers ────────────────────────────────────────────────

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`)
  return res.json() as Promise<T>
}

// ─── Automations tab ────────────────────────────────────────

function AutomationsTab() {
  const [state, setState] = useState<CompanyAutomationsState | null>(null)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<'success' | 'error' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<CompanyAutomationsState>('/api/settings/automations')
      setState(data)
    } catch {
      setError('Failed to load automation settings')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const runNow = useCallback(async () => {
    setRunning(true)
    setRunResult(null)
    try {
      await apiFetch('/api/settings/automations/finance-weekly/run', { method: 'POST' })
      setRunResult('success')
    } catch {
      setRunResult('error')
    } finally {
      setRunning(false)
      setTimeout(() => setRunResult(null), 4000)
    }
  }, [])

  const patch = useCallback(
    async (update: Partial<CompanyAutomationsState['financeWeeklyReport']>) => {
      if (!state) return
      const optimistic: CompanyAutomationsState = {
        ...state,
        financeWeeklyReport: { ...state.financeWeeklyReport, ...update },
      }
      setState(optimistic)
      setSaving(true)
      setError(null)
      try {
        const updated = await apiFetch<CompanyAutomationsState>('/api/settings/automations', {
          method: 'POST',
          body: JSON.stringify({ financeWeeklyReport: update }),
        })
        setState(updated)
      } catch {
        setError('Failed to save — please retry')
        setState(state)
      } finally {
        setSaving(false)
      }
    },
    [state],
  )

  if (!state) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-500 text-xs">
        {error ?? 'Loading…'}
      </div>
    )
  }

  const fw = state.financeWeeklyReport

  return (
    <div className="space-y-4">
      {error && (
        <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
          {error}
        </div>
      )}

      {/* Finance Weekly Report */}
      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-5 space-y-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-widest text-white">
                Finance Weekly Report
              </span>
              <span className={clsx(
                'text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border',
                fw.enabled
                  ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                  : 'text-slate-500 border-white/10 bg-white/5',
              )}>
                {fw.enabled ? 'ACTIVE' : 'DISABLED'}
              </span>
              {saving && (
                <span className="text-[9px] text-slate-500 uppercase tracking-widest">Saving…</span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Weekly finance summary sent via Telegram + WhatsApp every {DAY_FULL[fw.dayOfWeek]}.
            </p>
            {fw.lastSentWeekKey && (
              <p className="mt-0.5 text-[10px] text-slate-600">
                Last sent: week {fw.lastSentWeekKey}
              </p>
            )}
          </div>

          {/* Enable toggle */}
          <button
            onClick={() => void patch({ enabled: !fw.enabled })}
            disabled={saving}
            className={clsx(
              'relative flex-shrink-0 h-6 w-11 rounded-full border transition-colors duration-200',
              fw.enabled
                ? 'bg-emerald-500/20 border-emerald-500/40'
                : 'bg-white/5 border-white/10',
              saving && 'opacity-50 cursor-not-allowed',
            )}
          >
            <span className={clsx(
              'absolute top-0.5 h-5 w-5 rounded-full border transition-all duration-200',
              fw.enabled
                ? 'left-[calc(100%-1.375rem)] bg-emerald-400 border-emerald-300'
                : 'left-0.5 bg-slate-600 border-slate-500',
            )} />
          </button>
        </div>

        {/* Run Now */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => void runNow()}
            disabled={running || saving}
            className={clsx(
              'px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all',
              running || saving
                ? 'opacity-40 cursor-not-allowed bg-white/5 border-white/10 text-slate-500'
                : 'bg-white/5 border-white/10 text-slate-300 hover:bg-[#00D4FF]/10 hover:border-[#00D4FF]/30 hover:text-[#00D4FF]',
            )}
          >
            {running ? 'Sending…' : 'Run Now'}
          </button>
          {runResult === 'success' && (
            <span className="text-[10px] text-emerald-400 font-black uppercase tracking-widest">
              Sent to active channels ✓
            </span>
          )}
          {runResult === 'error' && (
            <span className="text-[10px] text-red-400 font-black uppercase tracking-widest">
              Send failed — check logs
            </span>
          )}
        </div>

        {/* Day picker */}
        <div className="space-y-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-600">
            Send on
          </p>
          <div className="flex gap-1.5 flex-wrap">
            {DAY_LABELS.map((label, idx) => (
              <button
                key={label}
                onClick={() => void patch({ dayOfWeek: idx })}
                disabled={saving || !fw.enabled}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all',
                  fw.dayOfWeek === idx
                    ? 'bg-[#00D4FF]/10 border-[#00D4FF]/40 text-[#00D4FF]'
                    : 'bg-white/[0.02] border-white/8 text-slate-500 hover:text-slate-300 hover:border-white/15',
                  (saving || !fw.enabled) && 'opacity-40 cursor-not-allowed',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Notifications tab ───────────────────────────────────────

function NotificationsTab() {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null)
  const [whatsAppStatus, setWhatsAppStatus] = useState<WhatsAppStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void apiFetch<NotificationPreferences>('/api/settings/notifications')
      .then(setPrefs)
      .catch(() => setError('Failed to load notification settings'))
    void apiFetch<WhatsAppStatus>('/api/whatsapp/status')
      .then(setWhatsAppStatus)
      .catch(() => undefined)
  }, [])

  const toggle = useCallback(
    async (channel: keyof NotificationPreferences) => {
      if (!prefs) return
      const updated = { ...prefs, [channel]: !prefs[channel] }
      setPrefs(updated)
      setSaving(true)
      setError(null)
      try {
        const saved = await apiFetch<NotificationPreferences>('/api/settings/notifications', {
          method: 'POST',
          body: JSON.stringify({ [channel]: !prefs[channel] }),
        })
        setPrefs(saved)
      } catch {
        setError('Failed to save — please retry')
        setPrefs(prefs)
      } finally {
        setSaving(false)
      }
    },
    [prefs],
  )

  if (!prefs) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-500 text-xs">
        {error ?? 'Loading…'}
      </div>
    )
  }

  const channels: Array<{
    key: keyof NotificationPreferences
    label: string
    description: string
    badge?: string
    badgeColor?: string
  }> = [
    {
      key: 'telegram',
      label: 'Telegram',
      description: 'All founder notifications and agent alerts.',
      badge: 'Connected',
      badgeColor: 'emerald',
    },
    {
      key: 'whatsapp',
      label: 'WhatsApp',
      description: 'Parallel delivery for daily brief and high-priority alerts.',
      badge: whatsAppStatus?.state === 'connected'
        ? 'Connected'
        : whatsAppStatus?.state === 'qr_pending'
          ? 'QR Pending'
          : 'Offline',
      badgeColor: whatsAppStatus?.state === 'connected' ? 'emerald' : 'yellow',
    },
  ]

  return (
    <div className="space-y-4">
      {error && (
        <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
          {error}
        </div>
      )}

      <p className="text-[11px] text-slate-500">
        Control which channels receive founder notifications. Disabling a channel stops all routing to it, including briefings and ops alerts.
      </p>

      <div className="space-y-3">
        {channels.map(({ key, label, description, badge, badgeColor }) => (
          <div
            key={key}
            className="flex items-center justify-between gap-4 rounded-xl border border-white/8 bg-white/[0.02] px-5 py-4"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black uppercase tracking-widest text-white">
                  {label}
                </span>
                {badge && (
                  <span className={clsx(
                    'text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border',
                    badgeColor === 'emerald'
                      ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                      : 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10',
                  )}>
                    {badge}
                  </span>
                )}
                {saving && (
                  <span className="text-[9px] text-slate-500 uppercase tracking-widest">Saving…</span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500">{description}</p>
            </div>

            <button
              onClick={() => void toggle(key)}
              disabled={saving}
              className={clsx(
                'relative flex-shrink-0 h-6 w-11 rounded-full border transition-colors duration-200',
                prefs[key]
                  ? 'bg-[#00D4FF]/15 border-[#00D4FF]/40'
                  : 'bg-white/5 border-white/10',
                saving && 'opacity-50 cursor-not-allowed',
              )}
            >
              <span className={clsx(
                'absolute top-0.5 h-5 w-5 rounded-full border transition-all duration-200',
                prefs[key]
                  ? 'left-[calc(100%-1.375rem)] bg-[#00D4FF] border-[#00D4FF]/80'
                  : 'left-0.5 bg-slate-600 border-slate-500',
              )} />
            </button>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-slate-600">
        Future channels (Discord, Slack, email) will appear here once configured.
      </p>
    </div>
  )
}

// ─── Main view ──────────────────────────────────────────────

export function SettingsView() {
  const [tab, setTab] = useState<SettingsTab>('automations')

  const tabs: Array<{ id: SettingsTab; label: string }> = [
    { id: 'automations', label: 'Automations' },
    { id: 'notifications', label: 'Notifications' },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-white/5">
        <h1 className="text-sm font-black uppercase tracking-widest text-white">Settings</h1>
        <p className="mt-1 text-[11px] text-slate-500">Automations and notification routing.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 pt-4">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={clsx(
              'px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all',
              tab === id
                ? 'bg-[#00D4FF]/10 border-[#00D4FF]/30 text-[#00D4FF]'
                : 'bg-transparent border-transparent text-slate-500 hover:text-slate-300',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-8">
        {tab === 'automations' && <AutomationsTab />}
        {tab === 'notifications' && <NotificationsTab />}
      </div>
    </div>
  )
}
