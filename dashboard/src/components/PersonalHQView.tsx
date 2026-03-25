import { useCallback, useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Icon } from './ui/Icon.js'
import { Badge } from './ui/Badge.js'
import { usePersonalContext } from '../hooks/usePersonalContext.js'
import { SecondBrainPanel } from './SecondBrainPanel.js'
import { MeetingNotesPanel } from './MeetingNotesPanel.js'
import type { PersonalAutomationStatus, WhatsAppStatus } from '../types/index.js'

const BACKEND_URL = (import.meta.env['VITE_BACKEND_URL'] as string | undefined) ?? ''

interface SaveState {
  status: 'idle' | 'saving' | 'done' | 'error'
  message?: string
}

interface McpActionState {
  status: 'idle' | 'working' | 'done' | 'error'
  message?: string
}

type FounderQuickActionId =
  | 'latest_email'
  | 'calendar_today'
  | 'drive_recent_files'
  | 'daily_founder_brief'
  | 'important_emails_today'
  | 'pre_meeting_brief'

interface FounderQuickAction {
  id: FounderQuickActionId
  label: string
  description: string
}

interface FounderQuickActionState {
  status: 'idle' | 'working' | 'done' | 'error'
  actionId?: FounderQuickActionId
  message?: string
  prompt?: string
  result?: string
  notifications: string[]
  executedAt?: string
}

interface AutomationActionState {
  status: 'idle' | 'working' | 'done' | 'error'
  message?: string
}

const FOUNDER_QUICK_ACTIONS: FounderQuickAction[] = [
  {
    id: 'important_emails_today',
    label: 'Important Emails Today',
    description: 'High-priority and unread emails with sender, subject, preview and urgency.',
  },
  {
    id: 'pre_meeting_brief',
    label: 'Pre-meeting Brief',
    description: 'Structured brief for every upcoming meeting: attendees, topic, notes.',
  },
  {
    id: 'latest_email',
    label: 'Latest Email',
    description: 'Read the newest inbox message without opening Gmail.',
  },
  {
    id: 'calendar_today',
    label: 'Today Agenda',
    description: 'Pull the current day schedule from Google Calendar.',
  },
  {
    id: 'drive_recent_files',
    label: 'Recent Drive Files',
    description: 'List the latest modified Google Drive files.',
  },
  {
    id: 'daily_founder_brief',
    label: 'Daily Founder Brief',
    description: 'Generate and save the full inbox-calendar-drive briefing.',
  },
]

type HQTab = 'exec' | 'automations' | 'setup' | 'profile' | 'brain' | 'meetings'

const HQ_TABS: { id: HQTab; label: string }[] = [
  { id: 'exec', label: 'Exec' },
  { id: 'automations', label: 'Automations' },
  { id: 'brain', label: 'Second Brain' },
  { id: 'meetings', label: 'Meeting Notes' },
  { id: 'setup', label: 'Setup' },
  { id: 'profile', label: 'Profile' },
]

export function PersonalHQView() {
  const { data, loading, error, refetch } = usePersonalContext()
  const [activeTab, setActiveTab] = useState<HQTab>('exec')
  const [displayName, setDisplayName] = useState('')
  const [primaryEmail, setPrimaryEmail] = useState('')
  const [assistantStyle, setAssistantStyle] = useState('')
  const [prioritiesText, setPrioritiesText] = useState('')
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' })
  const [mcpActionState, setMcpActionState] = useState<McpActionState>({ status: 'idle' })
  const [quickActionState, setQuickActionState] = useState<FounderQuickActionState>({
    status: 'idle',
    notifications: [],
  })
  const [automationStatus, setAutomationStatus] = useState<PersonalAutomationStatus | null>(null)
  const [automationLoading, setAutomationLoading] = useState(true)
  const [automationError, setAutomationError] = useState<string | null>(null)
  const [automationActionState, setAutomationActionState] = useState<AutomationActionState>({ status: 'idle' })
  const [scheduleInput, setScheduleInput] = useState('')
  const [scheduleEditMode, setScheduleEditMode] = useState(false)
  const [harvestActionState, setHarvestActionState] = useState<AutomationActionState>({ status: 'idle' })
  const [harvestSectorInput, setHarvestSectorInput] = useState('')   // "ristoranti, Milano"
  const [harvestSectorMode, setHarvestSectorMode] = useState(false)
  const [whatsAppStatus, setWhatsAppStatus] = useState<WhatsAppStatus | null>(null)
  const [whatsAppLoading, setWhatsAppLoading] = useState(false)
  const [whatsAppActionState, setWhatsAppActionState] = useState<{ status: 'idle' | 'working' | 'done' | 'error'; message?: string }>({ status: 'idle' })

  useEffect(() => {
    if (!data) return
    setDisplayName(data.profile.displayName)
    setPrimaryEmail(data.profile.primaryEmail ?? '')
    setAssistantStyle(data.profile.assistantStyle)
    setPrioritiesText(data.profile.priorities.join('\n'))
  }, [data])

  const readiness = useMemo(() => {
    if (!data) return 0
    return [
      data.connectors.email,
      data.connectors.telegram,
      Boolean(data.profile.primaryEmail),
      data.recentDocuments.length > 0,
    ].filter(Boolean).length
  }, [data])

  const fetchAutomationStatus = useCallback(async () => {
    try {
      setAutomationLoading(true)
      const response = await fetch(`${BACKEND_URL}/api/personal/automation/status`)
      const payload = await response.json() as PersonalAutomationStatus & { error?: string }
      if (!response.ok) {
        throw new Error(payload.error ?? `HTTP ${response.status}`)
      }
      setAutomationStatus(payload)
      setAutomationError(null)
    } catch (err) {
      setAutomationError(err instanceof Error ? err.message : 'Automation status failed')
    } finally {
      setAutomationLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchAutomationStatus()
  }, [fetchAutomationStatus])

  const fetchWhatsAppStatus = useCallback(async () => {
    try {
      setWhatsAppLoading(true)
      const response = await fetch(`${BACKEND_URL}/api/whatsapp/status`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json() as WhatsAppStatus
      setWhatsAppStatus(payload)
    } catch {
      // silently ignore — WhatsApp is optional
    } finally {
      setWhatsAppLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchWhatsAppStatus()
    // Poll for QR code while pending
    const timer = setInterval(() => {
      if (whatsAppStatus?.state === 'qr_pending') {
        void fetchWhatsAppStatus()
      }
    }, 3000)
    return () => clearInterval(timer)
  }, [fetchWhatsAppStatus, whatsAppStatus?.state])

  async function handleWhatsAppConnect() {
    try {
      setWhatsAppActionState({ status: 'working', message: 'Starting WhatsApp session...' })
      const response = await fetch(`${BACKEND_URL}/api/whatsapp/connect`, { method: 'POST' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setWhatsAppActionState({ status: 'done', message: 'Session starting — scan the QR code below.' })
      setTimeout(() => void fetchWhatsAppStatus(), 2000)
    } catch (err) {
      setWhatsAppActionState({ status: 'error', message: err instanceof Error ? err.message : 'Connect failed' })
    }
  }

  async function handleWhatsAppDisconnect() {
    try {
      setWhatsAppActionState({ status: 'working', message: 'Disconnecting...' })
      const response = await fetch(`${BACKEND_URL}/api/whatsapp/disconnect`, { method: 'POST' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setWhatsAppActionState({ status: 'done', message: 'Disconnected.' })
      await fetchWhatsAppStatus()
    } catch (err) {
      setWhatsAppActionState({ status: 'error', message: err instanceof Error ? err.message : 'Disconnect failed' })
    }
  }

  async function handleWhatsAppTestSend() {
    try {
      setWhatsAppActionState({ status: 'working', message: 'Sending test...' })
      const response = await fetch(`${BACKEND_URL}/api/whatsapp/test-send`, { method: 'POST' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setWhatsAppActionState({ status: 'done', message: 'Test sent — check Telegram and WhatsApp.' })
    } catch (err) {
      setWhatsAppActionState({ status: 'error', message: err instanceof Error ? err.message : 'Test send failed' })
    }
  }

  async function handleSave() {
    try {
      setSaveState({ status: 'saving' })
      const response = await fetch(`${BACKEND_URL}/api/personal/context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          primaryEmail: primaryEmail.trim() || null,
          assistantStyle,
          priorities: prioritiesText.split('\n').map((item) => item.trim()).filter(Boolean),
        }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      await refetch()
      setSaveState({ status: 'done', message: 'Personal context updated' })
    } catch (err) {
      setSaveState({ status: 'error', message: err instanceof Error ? err.message : 'Save failed' })
    }
  }

  async function handleGoogleMcpAuth() {
    try {
      setMcpActionState({ status: 'working', message: 'Starting Google Workspace auth...' })
      const response = await fetch(`${BACKEND_URL}/api/mcp/google-workspace/auth/start`, {
        method: 'POST',
      })
      const payload = await response.json() as { status?: { authorizationUrl?: string }; error?: string }
      if (!response.ok) {
        throw new Error(payload.error ?? `HTTP ${response.status}`)
      }

      const authorizationUrl = payload.status?.authorizationUrl
      if (authorizationUrl) {
        window.open(authorizationUrl, '_blank', 'noopener,noreferrer')
        setMcpActionState({ status: 'done', message: 'Browser auth opened. Complete Google login, then refresh this panel.' })
      } else {
        setMcpActionState({ status: 'done', message: 'Google Workspace MCP already connected.' })
      }
      await refetch()
    } catch (err) {
      setMcpActionState({ status: 'error', message: err instanceof Error ? err.message : 'Auth start failed' })
    }
  }

  async function handleFounderQuickAction(action: FounderQuickAction) {
    try {
      setQuickActionState({
        status: 'working',
        actionId: action.id,
        message: `Running ${action.label}...`,
        notifications: [],
      })

      const response = await fetch(`${BACKEND_URL}/api/personal/assistant/quick-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: action.id }),
      })

      const payload = await response.json() as {
        reply?: string
        prompt?: string
        notifications?: string[]
        error?: string
      }

      if (!response.ok) {
        throw new Error(payload.error ?? `HTTP ${response.status}`)
      }

      setQuickActionState({
        status: 'done',
        actionId: action.id,
        message: `${action.label} completed`,
        prompt: payload.prompt,
        result: payload.reply,
        notifications: Array.isArray(payload.notifications) ? payload.notifications : [],
        executedAt: new Date().toISOString(),
      })

      await refetch()
    } catch (err) {
      setQuickActionState({
        status: 'error',
        actionId: action.id,
        message: err instanceof Error ? err.message : 'Quick action failed',
        notifications: [],
      })
    }
  }

  async function handleAutomationToggle(enabled: boolean) {
    try {
      setAutomationActionState({
        status: 'working',
        message: enabled ? 'Enabling automation...' : 'Disabling automation...',
      })

      const response = await fetch(`${BACKEND_URL}/api/personal/automation/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })

      const payload = await response.json() as { status?: PersonalAutomationStatus; error?: string }
      if (!response.ok || !payload.status) {
        throw new Error(payload.error ?? `HTTP ${response.status}`)
      }

      setAutomationStatus(payload.status)
      setAutomationActionState({
        status: 'done',
        message: enabled ? 'Automation enabled' : 'Automation disabled',
      })
    } catch (err) {
      setAutomationActionState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Automation update failed',
      })
    }
  }

  async function handleScheduleUpdate() {
    if (!scheduleInput.trim()) return
    try {
      setAutomationActionState({ status: 'working', message: 'Updating schedule...' })
      const response = await fetch(`${BACKEND_URL}/api/personal/automation/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduleLocalTime: scheduleInput.trim() }),
      })
      const payload = await response.json() as { status?: PersonalAutomationStatus; error?: string }
      if (!response.ok || !payload.status) {
        throw new Error(payload.error ?? `HTTP ${response.status}`)
      }
      setAutomationStatus(payload.status)
      setScheduleEditMode(false)
      setAutomationActionState({ status: 'done', message: 'Schedule updated' })
    } catch (err) {
      setAutomationActionState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Schedule update failed',
      })
    }
  }

  async function handleAutomationRunNow() {
    try {
      setAutomationActionState({
        status: 'working',
        message: 'Running daily founder brief now...',
      })

      const response = await fetch(`${BACKEND_URL}/api/personal/automation/run`, {
        method: 'POST',
      })

      const payload = await response.json() as { status?: PersonalAutomationStatus; error?: string }
      if (!response.ok || !payload.status) {
        throw new Error(payload.error ?? `HTTP ${response.status}`)
      }

      setAutomationStatus(payload.status)
      setAutomationActionState({
        status: 'done',
        message: 'Daily founder brief executed',
      })

      await refetch()
    } catch (err) {
      setAutomationActionState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Automation run failed',
      })
    } finally {
      await fetchAutomationStatus()
    }
  }

  async function handleHarvestToggle(enabled: boolean) {
    try {
      setHarvestActionState({ status: 'working', message: enabled ? 'Enabling...' : 'Disabling...' })
      const response = await fetch(`${BACKEND_URL}/api/personal/automation/harvest/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      const payload = await response.json() as { status?: PersonalAutomationStatus; error?: string }
      if (!response.ok || !payload.status) throw new Error(payload.error ?? `HTTP ${response.status}`)
      setAutomationStatus(payload.status)
      setHarvestActionState({ status: 'done', message: enabled ? 'Enabled' : 'Disabled' })
    } catch (err) {
      setHarvestActionState({ status: 'error', message: err instanceof Error ? err.message : 'Update failed' })
    }
  }

  async function handleHarvestAddSector() {
    const trimmed = harvestSectorInput.trim()
    if (!trimmed) return
    const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean)
    if (parts.length < 2) {
      setHarvestActionState({ status: 'error', message: 'Format: "query, location" (e.g. "ristoranti, Milano")' })
      return
    }
    const newSector = { query: parts[0] ?? '', location: parts[1] ?? '', limit: 10 }
    const current = automationStatus?.weeklyLeadHarvest.sectors ?? []
    try {
      setHarvestActionState({ status: 'working', message: 'Adding sector...' })
      const response = await fetch(`${BACKEND_URL}/api/personal/automation/harvest/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectors: [...current, newSector] }),
      })
      const payload = await response.json() as { status?: PersonalAutomationStatus; error?: string }
      if (!response.ok || !payload.status) throw new Error(payload.error ?? `HTTP ${response.status}`)
      setAutomationStatus(payload.status)
      setHarvestSectorInput('')
      setHarvestSectorMode(false)
      setHarvestActionState({ status: 'done', message: 'Sector added' })
    } catch (err) {
      setHarvestActionState({ status: 'error', message: err instanceof Error ? err.message : 'Add sector failed' })
    }
  }

  async function handleHarvestRemoveSector(index: number) {
    const current = automationStatus?.weeklyLeadHarvest.sectors ?? []
    const updated = current.filter((_, i) => i !== index)
    try {
      setHarvestActionState({ status: 'working', message: 'Removing...' })
      const response = await fetch(`${BACKEND_URL}/api/personal/automation/harvest/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectors: updated }),
      })
      const payload = await response.json() as { status?: PersonalAutomationStatus; error?: string }
      if (!response.ok || !payload.status) throw new Error(payload.error ?? `HTTP ${response.status}`)
      setAutomationStatus(payload.status)
      setHarvestActionState({ status: 'idle' })
    } catch (err) {
      setHarvestActionState({ status: 'error', message: err instanceof Error ? err.message : 'Remove failed' })
    }
  }

  async function handleHarvestRunNow() {
    try {
      setHarvestActionState({ status: 'working', message: 'Starting harvest...' })
      const response = await fetch(`${BACKEND_URL}/api/personal/automation/harvest/run`, { method: 'POST' })
      const payload = await response.json() as { ok?: boolean; error?: string }
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`)
      setHarvestActionState({ status: 'done', message: 'Harvest started — you\'ll get a Telegram notification when done' })
      setTimeout(() => void fetchAutomationStatus(), 3000)
    } catch (err) {
      setHarvestActionState({ status: 'error', message: err instanceof Error ? err.message : 'Run failed' })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[420px]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-[#7CF6E6]/20 border-t-[#7CF6E6] rounded-full animate-spin" />
          <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em]">Loading Personal Cortex...</p>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="rounded-3xl border border-rose-500/20 bg-rose-500/5 p-8">
        <p className="text-sm font-bold text-rose-400">Personal mode unavailable</p>
        <p className="text-xs text-slate-500 mt-2">{error ?? 'Unknown error'}</p>
      </div>
    )
  }

  const googleWorkspaceReady = data.mcpRuntime.state === 'connected'

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <div className="relative overflow-hidden rounded-[2rem] border border-[#7CF6E6]/20 bg-[radial-gradient(circle_at_top_left,rgba(124,246,230,0.18),transparent_45%),linear-gradient(135deg,#08111d_0%,#05080f_65%,#091a17_100%)] p-8">
        <div className="absolute inset-0 bg-scanline opacity-[0.02] pointer-events-none" />
        <div className="relative z-10 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#7CF6E6]/20 bg-[#7CF6E6]/10 text-[#7CF6E6] shadow-[0_0_30px_rgba(124,246,230,0.15)]">
                <Icon name="overview" size={26} />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.35em] text-[#7CF6E6]/80">Personal Mode</p>
                <h1 className="mt-1 text-3xl font-black uppercase italic tracking-tight text-white">Assistant HQ</h1>
              </div>
            </div>
            <p className="mt-5 max-w-2xl text-sm leading-relaxed text-slate-300">
              This surface is optimized for Neb-facing execution: documents, reports, connectors, and focus-preserving automation.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-white/8 bg-black/25 px-4 py-3">
              <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-500">Readiness</p>
              <p className="mt-2 text-2xl font-mono font-black text-[#7CF6E6]">{readiness}/4</p>
            </div>
            <div className="rounded-2xl border border-white/8 bg-black/25 px-4 py-3">
              <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-500">Documents</p>
              <p className="mt-2 text-2xl font-mono font-black text-white">{data.recentDocuments.length}</p>
            </div>
            <div className="rounded-2xl border border-white/8 bg-black/25 px-4 py-3">
              <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-500">Email</p>
              <p className="mt-2 text-xs font-black uppercase tracking-[0.25em] text-white">
                {data.connectors.email ? 'Ready' : 'Missing'}
              </p>
            </div>
            <div className="rounded-2xl border border-white/8 bg-black/25 px-4 py-3">
              <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-500">Workspace</p>
              <p className="mt-2 text-xs font-mono font-bold text-slate-300">personal/neb</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 rounded-2xl border border-white/5 bg-white/[0.02] p-1">
        {HQ_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              'flex-1 rounded-xl px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] transition',
              activeTab === tab.id
                ? 'bg-[#7CF6E6]/15 text-[#7CF6E6]'
                : 'text-slate-500 hover:text-slate-300',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab: Exec */}
      {activeTab === 'exec' && (
        <div className="space-y-6">
          <section className="rounded-3xl border border-white/5 bg-white/[0.02] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-black uppercase tracking-[0.25em] text-white">Founder Quick Actions</h2>
                <p className="mt-1 text-xs text-slate-500">Direct execution layer for Gmail, Calendar, Drive and the daily founder brief.</p>
              </div>
              <Badge variant={googleWorkspaceReady ? 'done' : 'warning'}>
                {googleWorkspaceReady ? 'LIVE' : 'LOCKED'}
              </Badge>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FOUNDER_QUICK_ACTIONS.map((action) => {
                const active = quickActionState.actionId === action.id && quickActionState.status === 'working'

                return (
                  <button
                    key={action.id}
                    type="button"
                    disabled={!googleWorkspaceReady || quickActionState.status === 'working'}
                    onClick={() => void handleFounderQuickAction(action)}
                    className={clsx(
                      'rounded-2xl border px-4 py-4 text-left transition',
                      !googleWorkspaceReady || quickActionState.status === 'working'
                        ? 'cursor-not-allowed border-white/5 bg-black/20 opacity-50'
                        : 'border-[#7CF6E6]/15 bg-[#7CF6E6]/[0.04] hover:border-[#7CF6E6]/35 hover:bg-[#7CF6E6]/[0.08]',
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[11px] font-black uppercase tracking-[0.2em] text-white">{action.label}</p>
                      {active && <Badge variant="warning">RUNNING</Badge>}
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-400">{action.description}</p>
                  </button>
                )
              })}
            </div>

            {!googleWorkspaceReady && (
              <p className="mt-4 text-[11px] text-amber-300/80">
                Connect Google Workspace MCP first (Setup tab). These actions depend on live Gmail, Calendar and Drive access.
              </p>
            )}

            {quickActionState.message && (
              <div className="mt-5 rounded-2xl border border-white/5 bg-black/25 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-500">Execution Output</p>
                  <Badge variant={quickActionState.status === 'done' ? 'done' : quickActionState.status === 'error' ? 'error' : 'warning'}>
                    {quickActionState.status.toUpperCase()}
                  </Badge>
                </div>
                <p className={clsx('mt-3 text-xs font-bold', quickActionState.status === 'error' ? 'text-rose-400' : 'text-[#7CF6E6]')}>
                  {quickActionState.message}
                </p>
                {quickActionState.result && (
                  <div className="mt-3 rounded-2xl border border-white/5 bg-[#03060b] px-4 py-3">
                    <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-200">
                      {quickActionState.result}
                    </p>
                  </div>
                )}
                {quickActionState.notifications.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {quickActionState.notifications.map((notification) => (
                      <p key={notification} className="text-[11px] text-slate-500">
                        <span className="text-slate-400">{notification}</span>
                      </p>
                    ))}
                  </div>
                )}
                {quickActionState.executedAt && (
                  <p className="mt-3 text-[11px] text-slate-600">
                    Executed at {new Date(quickActionState.executedAt).toLocaleString()}
                  </p>
                )}
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-white/5 bg-white/[0.02] p-6">
            <h2 className="text-sm font-black uppercase tracking-[0.25em] text-white">Recent Personal Docs</h2>
            <div className="mt-4 space-y-3">
              {data.recentDocuments.slice(0, 5).map((doc) => (
                <div key={doc.relativePath} className="rounded-2xl border border-white/5 bg-black/25 px-4 py-3">
                  <p className="text-xs font-black uppercase tracking-[0.15em] text-white">{doc.name}</p>
                  <p className="mt-1 text-[10px] font-mono text-slate-600">{doc.relativePath}</p>
                </div>
              ))}
              {data.recentDocuments.length === 0 && (
                <p className="text-xs text-slate-500">No personal documents yet. Use CEO Intake with a `create_document` or `send_report` flow.</p>
              )}
            </div>
          </section>
        </div>
      )}

      {/* Tab: Automations */}
      {activeTab === 'automations' && (
        <section className="rounded-3xl border border-white/5 bg-white/[0.02] p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-black uppercase tracking-[0.25em] text-white">Automation Control</h2>
              <p className="mt-1 text-xs text-slate-500">Founder automations can be paused any time to avoid unnecessary token spend or noise.</p>
            </div>
            <Badge variant={(automationStatus?.dailyFounderBrief.enabled || automationStatus?.weeklyLeadHarvest.enabled) ? 'done' : 'warning'}>
              {(automationStatus?.dailyFounderBrief.enabled || automationStatus?.weeklyLeadHarvest.enabled) ? 'ACTIVE' : 'IDLE'}
            </Badge>
          </div>

          {automationLoading ? (
            <p className="mt-5 text-xs text-slate-500">Loading automation state...</p>
          ) : automationError ? (
            <p className="mt-5 text-xs text-rose-400">{automationError}</p>
          ) : automationStatus ? (
            <div className="mt-5 rounded-2xl border border-white/5 bg-black/25 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.25em] text-[#7CF6E6]/80">
                    {automationStatus.dailyFounderBrief.label}
                  </p>

                  {/* Schedule display + editor */}
                  <div className="mt-2">
                    {scheduleEditMode ? (
                      <div className="flex items-center gap-3">
                        <input
                          type="text"
                          value={scheduleInput}
                          onChange={(e) => setScheduleInput(e.target.value)}
                          placeholder="HH:MM"
                          className="w-24 rounded-xl border border-[#7CF6E6]/30 bg-black/40 px-3 py-1.5 text-xs font-mono text-white outline-none focus:border-[#7CF6E6]/60"
                        />
                        <button
                          type="button"
                          disabled={automationActionState.status === 'working'}
                          onClick={() => void handleScheduleUpdate()}
                          className="rounded-xl border border-[#7CF6E6]/30 bg-[#7CF6E6]/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-[#7CF6E6] transition hover:bg-[#7CF6E6]/18"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setScheduleEditMode(false)}
                          className="text-[10px] text-slate-500 transition hover:text-slate-300"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <p className="text-xs text-slate-300">
                          Schedule: <span className="font-mono text-slate-400">{automationStatus.dailyFounderBrief.scheduleLocalTime}</span>
                          {' '}<span className="text-slate-500">({automationStatus.dailyFounderBrief.timezone})</span>
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setScheduleInput(automationStatus.dailyFounderBrief.scheduleLocalTime)
                            setScheduleEditMode(true)
                          }}
                          className="text-[10px] font-black uppercase tracking-[0.2em] text-[#7CF6E6]/60 transition hover:text-[#7CF6E6]"
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </div>

                  <p className="mt-1 text-xs text-slate-300">
                    Runtime status: <span className="font-mono text-slate-400">{automationStatus.dailyFounderBrief.status}</span>
                  </p>
                  {automationStatus.dailyFounderBrief.nextPlannedRunLabel && (
                    <p className="mt-1 text-xs text-slate-300">
                      Next run: <span className="text-slate-400">{automationStatus.dailyFounderBrief.nextPlannedRunLabel}</span>
                    </p>
                  )}
                  {automationStatus.dailyFounderBrief.lastRunAt && (
                    <p className="mt-1 text-xs text-slate-300">
                      Last run: <span className="text-slate-400">{new Date(automationStatus.dailyFounderBrief.lastRunAt).toLocaleString()}</span>
                    </p>
                  )}
                  {automationStatus.dailyFounderBrief.lastOutputPath && (
                    <p className="mt-1 text-xs text-slate-300">
                      Last output: <span className="font-mono text-slate-500">{automationStatus.dailyFounderBrief.lastOutputPath}</span>
                    </p>
                  )}
                  {automationStatus.dailyFounderBrief.lastError && (
                    <p className="mt-2 text-xs text-rose-400">{automationStatus.dailyFounderBrief.lastError}</p>
                  )}
                </div>

                <Badge
                  variant={
                    automationStatus.dailyFounderBrief.status === 'success'
                      ? 'done'
                      : automationStatus.dailyFounderBrief.status === 'error'
                        ? 'error'
                        : 'warning'
                  }
                >
                  {automationStatus.dailyFounderBrief.status.toUpperCase()}
                </Badge>
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={automationActionState.status === 'working'}
                  onClick={() => void handleAutomationToggle(!automationStatus.dailyFounderBrief.enabled)}
                  className={clsx(
                    'rounded-2xl border px-4 py-2 text-[10px] font-black uppercase tracking-[0.25em] transition',
                    automationStatus.dailyFounderBrief.enabled
                      ? 'border-rose-400/30 bg-rose-400/10 text-rose-300 hover:bg-rose-400/18'
                      : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/18',
                  )}
                >
                  {automationStatus.dailyFounderBrief.enabled ? 'Disable Auto Run' : 'Enable Auto Run'}
                </button>
                <button
                  type="button"
                  disabled={automationActionState.status === 'working' || !googleWorkspaceReady}
                  onClick={() => void handleAutomationRunNow()}
                  className={clsx(
                    'rounded-2xl border border-[#7CF6E6]/30 bg-[#7CF6E6]/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.25em] text-[#7CF6E6] transition hover:bg-[#7CF6E6]/18',
                    (!googleWorkspaceReady || automationActionState.status === 'working') && 'cursor-not-allowed opacity-50',
                  )}
                >
                  Run Now
                </button>
              </div>

              {automationActionState.message && (
                <p className={clsx('mt-4 text-xs', automationActionState.status === 'error' ? 'text-rose-400' : 'text-slate-400')}>
                  {automationActionState.message}
                </p>
              )}
            </div>
          ) : null}

          {/* Weekly Lead Harvest */}
          {automationStatus?.weeklyLeadHarvest && (
            <div className="mt-4 rounded-2xl border border-white/5 bg-black/25 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-black uppercase tracking-[0.25em] text-amber-400/80">
                    {automationStatus.weeklyLeadHarvest.label}
                  </p>
                  <p className="mt-1 text-xs text-slate-300">
                    Schedule: <span className="font-mono text-slate-400">
                      {automationStatus.weeklyLeadHarvest.scheduleDay} @ {automationStatus.weeklyLeadHarvest.scheduleLocalTime}
                    </span>
                    {' '}<span className="text-slate-500">({automationStatus.weeklyLeadHarvest.timezone})</span>
                  </p>
                  <p className="mt-1 text-xs text-slate-300">
                    Status: <span className="font-mono text-slate-400">{automationStatus.weeklyLeadHarvest.status}</span>
                  </p>
                  {automationStatus.weeklyLeadHarvest.nextPlannedRunLabel && (
                    <p className="mt-1 text-xs text-slate-300">
                      Next: <span className="text-slate-400">{automationStatus.weeklyLeadHarvest.nextPlannedRunLabel}</span>
                    </p>
                  )}
                  {automationStatus.weeklyLeadHarvest.lastRunAt && (
                    <p className="mt-1 text-xs text-slate-300">
                      Last run: <span className="text-slate-400">{new Date(automationStatus.weeklyLeadHarvest.lastRunAt).toLocaleString()}</span>
                      {automationStatus.weeklyLeadHarvest.lastLeadsFound !== undefined && (
                        <span className="ml-2 rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] font-black text-amber-300">
                          {automationStatus.weeklyLeadHarvest.lastLeadsFound} leads
                        </span>
                      )}
                    </p>
                  )}
                  {automationStatus.weeklyLeadHarvest.lastError && (
                    <p className="mt-2 text-xs text-rose-400">{automationStatus.weeklyLeadHarvest.lastError}</p>
                  )}

                  {/* Sector list */}
                  <div className="mt-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">Sectors</p>
                    {automationStatus.weeklyLeadHarvest.sectors.length === 0 ? (
                      <p className="text-xs text-slate-600 italic">No sectors configured — add one to enable harvest</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {automationStatus.weeklyLeadHarvest.sectors.map((s, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/8 px-3 py-1 text-[11px] text-amber-300"
                          >
                            {s.query} @ {s.location}
                            <button
                              type="button"
                              onClick={() => void handleHarvestRemoveSector(i)}
                              disabled={harvestActionState.status === 'working'}
                              className="ml-1 text-slate-500 hover:text-rose-400 transition"
                              aria-label="Remove sector"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    {harvestSectorMode ? (
                      <div className="mt-3 flex items-center gap-2">
                        <input
                          type="text"
                          value={harvestSectorInput}
                          onChange={(e) => setHarvestSectorInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') void handleHarvestAddSector() }}
                          placeholder="ristoranti, Milano"
                          className="flex-1 rounded-xl border border-amber-400/30 bg-black/40 px-3 py-1.5 text-xs font-mono text-white outline-none focus:border-amber-400/60"
                        />
                        <button
                          type="button"
                          onClick={() => void handleHarvestAddSector()}
                          disabled={harvestActionState.status === 'working'}
                          className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-amber-300 transition hover:bg-amber-400/18"
                        >
                          Add
                        </button>
                        <button type="button" onClick={() => setHarvestSectorMode(false)} className="text-[10px] text-slate-500 hover:text-slate-300 transition">
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setHarvestSectorMode(true)}
                        className="mt-2 text-[10px] font-black uppercase tracking-[0.2em] text-amber-400/60 hover:text-amber-400 transition"
                      >
                        + Add Sector
                      </button>
                    )}
                  </div>
                </div>

                <Badge
                  variant={
                    automationStatus.weeklyLeadHarvest.status === 'success' ? 'done'
                      : automationStatus.weeklyLeadHarvest.status === 'error' ? 'error'
                        : 'warning'
                  }
                >
                  {automationStatus.weeklyLeadHarvest.status.toUpperCase()}
                </Badge>
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={harvestActionState.status === 'working'}
                  onClick={() => void handleHarvestToggle(!automationStatus.weeklyLeadHarvest.enabled)}
                  className={clsx(
                    'rounded-2xl border px-4 py-2 text-[10px] font-black uppercase tracking-[0.25em] transition',
                    automationStatus.weeklyLeadHarvest.enabled
                      ? 'border-rose-400/30 bg-rose-400/10 text-rose-300 hover:bg-rose-400/18'
                      : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/18',
                  )}
                >
                  {automationStatus.weeklyLeadHarvest.enabled ? 'Disable Auto Run' : 'Enable Auto Run'}
                </button>
                <button
                  type="button"
                  disabled={harvestActionState.status === 'working' || automationStatus.weeklyLeadHarvest.sectors.length === 0}
                  onClick={() => void handleHarvestRunNow()}
                  className={clsx(
                    'rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.25em] text-amber-300 transition hover:bg-amber-400/18',
                    (harvestActionState.status === 'working' || automationStatus.weeklyLeadHarvest.sectors.length === 0) && 'cursor-not-allowed opacity-50',
                  )}
                >
                  Run Now
                </button>
              </div>

              {harvestActionState.message && (
                <p className={clsx('mt-4 text-xs', harvestActionState.status === 'error' ? 'text-rose-400' : 'text-slate-400')}>
                  {harvestActionState.message}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {/* Tab: Setup */}
      {activeTab === 'setup' && (
        <div className="space-y-6">
          <section className="rounded-3xl border border-white/5 bg-white/[0.02] p-6">
            <h2 className="text-sm font-black uppercase tracking-[0.25em] text-white">Connector Status</h2>
            <div className="mt-5 space-y-3">
              {[
                { label: 'Email / Resend', ready: data.connectors.email },
                { label: 'Telegram Founder Link', ready: data.connectors.telegram },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-2xl border border-white/5 bg-black/25 px-4 py-3">
                  <span className="text-xs font-bold text-slate-300">{item.label}</span>
                  <Badge variant={item.ready ? 'done' : 'warning'}>{item.ready ? 'READY' : 'SETUP'}</Badge>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-white/5 bg-white/[0.02] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-black uppercase tracking-[0.25em] text-white">MCP Bridge</h2>
                <p className="mt-1 text-xs text-slate-500">Control plane for Gmail, Calendar, Drive and MCP-native file access.</p>
              </div>
              <Badge variant={data.mcp.configPresent ? 'done' : 'warning'}>
                {data.mcp.configPresent ? `${data.mcp.serversConfigured} SERVERS` : 'NO CONFIG'}
              </Badge>
            </div>

            <div className="mt-5 space-y-3">
              {data.mcp.connectors.map((item) => (
                <div key={item.id} className="rounded-2xl border border-white/5 bg-black/25 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-bold text-slate-300">{item.label}</span>
                    <Badge variant={item.status === 'ready' ? 'done' : 'warning'}>{item.status === 'ready' ? 'READY' : 'SETUP'}</Badge>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">{item.notes}</p>
                  {item.serverName && (
                    <p className="mt-1 text-[10px] font-mono text-slate-600">{item.serverName}{item.transport ? ` · ${item.transport}` : ''}</p>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-2xl border border-[#7CF6E6]/10 bg-[#7CF6E6]/[0.03] p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.25em] text-[#7CF6E6]/80">Google Workspace Runtime</p>
                  <p className="mt-2 text-xs text-slate-300">
                    Account: <span className="font-mono text-slate-400">{data.mcpRuntime.userGoogleEmail ?? 'not set'}</span>
                  </p>
                  <p className="mt-1 text-xs text-slate-300">
                    Redirect: <span className="font-mono text-slate-500">{data.mcpRuntime.redirectUri}</span>
                  </p>
                </div>
                <Badge variant={data.mcpRuntime.state === 'connected' ? 'done' : data.mcpRuntime.state === 'error' ? 'error' : 'warning'}>
                  {data.mcpRuntime.state.toUpperCase()}
                </Badge>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/5 bg-black/25 px-4 py-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-500">Server</p>
                  <p className="mt-2 text-xs font-black uppercase tracking-[0.18em] text-white">
                    {data.mcpRuntime.serverReachable ? 'Reachable' : 'Offline'}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/5 bg-black/25 px-4 py-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-500">Tools</p>
                  <p className="mt-2 text-2xl font-mono font-black text-white">{data.mcpRuntime.toolCount}</p>
                </div>
              </div>

              {data.mcpRuntime.tools.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {data.mcpRuntime.tools.slice(0, 8).map((tool) => (
                    <span key={tool.name} className="rounded-full border border-white/8 bg-black/25 px-3 py-1 text-[10px] font-mono text-slate-400">
                      {tool.name}
                    </span>
                  ))}
                </div>
              )}

              {(data.mcpRuntime.lastConnectedAt || data.mcpRuntime.lastError) && (
                <div className="mt-4 space-y-1">
                  {data.mcpRuntime.lastConnectedAt && (
                    <p className="text-[11px] text-slate-500">Last connected: {new Date(data.mcpRuntime.lastConnectedAt).toLocaleString()}</p>
                  )}
                  {data.mcpRuntime.lastError && (
                    <p className="text-[11px] text-rose-400">{data.mcpRuntime.lastError}</p>
                  )}
                </div>
              )}

              <div className="mt-4 flex items-center justify-between gap-4">
                <p className="text-[11px] text-slate-500">
                  Complete OAuth once, then all founder actions can use Gmail and Calendar directly.
                </p>
                <button
                  onClick={() => void handleGoogleMcpAuth()}
                  className="rounded-2xl border border-[#7CF6E6]/30 bg-[#7CF6E6]/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.25em] text-[#7CF6E6] transition hover:bg-[#7CF6E6]/18"
                >
                  {data.mcpRuntime.state === 'connected' ? 'Refresh MCP' : 'Start Google Auth'}
                </button>
              </div>
              {mcpActionState.message && (
                <p className={clsx('mt-3 text-xs', mcpActionState.status === 'error' ? 'text-rose-400' : 'text-slate-500')}>
                  {mcpActionState.message}
                </p>
              )}
            </div>
          </section>

          {/* WhatsApp Channel */}
          <section className="rounded-3xl border border-white/5 bg-white/[0.02] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-black uppercase tracking-[0.25em] text-white">WhatsApp Channel</h2>
                <p className="mt-1 text-xs text-slate-500">Secondary founder notification channel. Runs alongside Telegram.</p>
              </div>
              {whatsAppLoading ? (
                <Badge variant="warning">LOADING</Badge>
              ) : whatsAppStatus?.state === 'connected' ? (
                <Badge variant="done">CONNECTED</Badge>
              ) : whatsAppStatus?.state === 'qr_pending' ? (
                <Badge variant="warning">QR PENDING</Badge>
              ) : (
                <Badge variant="warning">OFFLINE</Badge>
              )}
            </div>

            {whatsAppStatus?.state === 'connected' && (
              <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-emerald-400">Session Active</p>
                {whatsAppStatus.connectedPhone && (
                  <p className="mt-2 font-mono text-xs text-slate-300">{whatsAppStatus.connectedPhone}</p>
                )}
                <p className="mt-1 text-[11px] text-slate-500">Notifications will be duplicated to WhatsApp in addition to Telegram.</p>
              </div>
            )}

            {whatsAppStatus?.state === 'qr_pending' && whatsAppStatus.qrCode && (
              <div className="mt-4 flex flex-col items-center gap-4">
                <p className="text-xs text-slate-400">Open WhatsApp on your phone → Linked Devices → Link a Device, then scan:</p>
                <img
                  src={whatsAppStatus.qrCode}
                  alt="WhatsApp QR Code"
                  className="h-48 w-48 rounded-2xl border border-white/10 bg-white p-2"
                />
                <p className="text-[11px] text-slate-500">QR refreshes automatically. Do not close this page until connected.</p>
              </div>
            )}

            {whatsAppStatus?.state === 'offline' && (
              <div className="mt-4 rounded-2xl border border-white/5 bg-black/25 px-4 py-3">
                <p className="text-[11px] text-slate-500">
                  Set <span className="font-mono text-slate-400">WHATSAPP_FOUNDER_JID</span> in your <span className="font-mono text-slate-400">.env</span> file
                  (format: <span className="font-mono text-slate-400">39333XXXXXXX@s.whatsapp.net</span>), then connect below.
                </p>
              </div>
            )}

            <div className="mt-4 flex items-center justify-between gap-4">
              <p className="text-[11px] text-slate-500">
                {whatsAppStatus?.state === 'connected'
                  ? 'Session active. Disconnect removes the local session files.'
                  : 'Connect starts a QR session. Scan to authorize.'}
              </p>
              <div className="flex gap-2">
                {whatsAppStatus?.state === 'connected' && (
                  <>
                    <button
                      onClick={() => void handleWhatsAppTestSend()}
                      disabled={whatsAppActionState.status === 'working'}
                      className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.25em] text-emerald-400 transition hover:bg-emerald-500/18 disabled:opacity-50"
                    >
                      {whatsAppActionState.status === 'working' ? '...' : 'Send Test'}
                    </button>
                    <button
                      onClick={() => void handleWhatsAppDisconnect()}
                      disabled={whatsAppActionState.status === 'working'}
                      className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.25em] text-rose-400 transition hover:bg-rose-500/18 disabled:opacity-50"
                    >
                      {whatsAppActionState.status === 'working' ? '...' : 'Disconnect'}
                    </button>
                  </>
                )}
                <button
                  onClick={() => void handleWhatsAppConnect()}
                  disabled={whatsAppActionState.status === 'working'}
                  className="rounded-2xl border border-fuchsia-500/30 bg-fuchsia-500/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.25em] text-fuchsia-400 transition hover:bg-fuchsia-500/18 disabled:opacity-50"
                >
                  {whatsAppActionState.status === 'working'
                    ? '...'
                    : whatsAppStatus?.state === 'connected' ? 'Reconnect' : 'Connect'}
                </button>
              </div>
            </div>
            {whatsAppActionState.message && (
              <p className={clsx('mt-3 text-xs', whatsAppActionState.status === 'error' ? 'text-rose-400' : 'text-slate-500')}>
                {whatsAppActionState.message}
              </p>
            )}
          </section>
        </div>
      )}

      {/* Tab: Second Brain */}
      {activeTab === 'brain' && (
        <section className="rounded-3xl border border-white/5 bg-white/[0.02] p-6">
          <div className="mb-6">
            <h2 className="text-sm font-black uppercase tracking-[0.25em] text-white">Second Brain</h2>
            <p className="mt-1 text-xs text-slate-500">Personal knowledge base — save notes, URLs, and files; search semantically.</p>
          </div>
          <SecondBrainPanel />
        </section>
      )}

      {/* Tab: Meeting Notes */}
      {activeTab === 'meetings' && (
        <section className="rounded-3xl border border-white/5 bg-white/[0.02] p-6">
          <div className="mb-6">
            <h2 className="text-sm font-black uppercase tracking-[0.25em] text-white">Meeting Notes</h2>
            <p className="mt-1 text-xs text-slate-500">Save raw notes from any meeting — AI generates summary and action items automatically.</p>
          </div>
          <MeetingNotesPanel />
        </section>
      )}

      {/* Tab: Profile */}
      {activeTab === 'profile' && (
        <section className="rounded-3xl border border-white/5 bg-white/[0.02] p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-black uppercase tracking-[0.25em] text-white">Identity Context</h2>
              <p className="mt-1 text-xs text-slate-500">What the assistant should know and use by default.</p>
            </div>
            {saveState.status !== 'idle' && (
              <Badge variant={saveState.status === 'done' ? 'done' : saveState.status === 'error' ? 'error' : 'warning'}>
                {saveState.status === 'saving' ? 'SAVING' : saveState.status === 'done' ? 'SAVED' : 'ERROR'}
              </Badge>
            )}
          </div>

          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-500">Display Name</span>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-[#7CF6E6]/40" />
            </label>
            <label className="space-y-2">
              <span className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-500">Primary Email</span>
              <input value={primaryEmail} onChange={(e) => setPrimaryEmail(e.target.value)} placeholder="neb@example.com" className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-[#7CF6E6]/40" />
            </label>
            <label className="space-y-2 md:col-span-2">
              <span className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-500">Assistant Style</span>
              <input value={assistantStyle} onChange={(e) => setAssistantStyle(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-[#7CF6E6]/40" />
            </label>
            <label className="space-y-2 md:col-span-2">
              <span className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-500">Priorities</span>
              <textarea value={prioritiesText} onChange={(e) => setPrioritiesText(e.target.value)} rows={5} className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-[#7CF6E6]/40" />
            </label>
          </div>

          <div className="mt-6 flex items-center justify-between gap-4">
            <p className="text-xs text-slate-500">
              The CEO Intake reads this context before planning personal actions.
            </p>
            <button onClick={() => void handleSave()} className="rounded-2xl border border-[#7CF6E6]/30 bg-[#7CF6E6]/10 px-5 py-2.5 text-[11px] font-black uppercase tracking-[0.25em] text-[#7CF6E6] transition hover:bg-[#7CF6E6]/18">
              Save Profile
            </button>
          </div>
          {saveState.message && <p className={clsx('mt-3 text-xs', saveState.status === 'error' ? 'text-rose-400' : 'text-slate-500')}>{saveState.message}</p>}
        </section>
      )}
    </div>
  )
}
