import { useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Icon } from './ui/Icon.js'
import { Badge } from './ui/Badge.js'
import { usePersonalContext } from '../hooks/usePersonalContext.js'

const BACKEND_URL = (import.meta.env['VITE_BACKEND_URL'] as string | undefined) ?? 'http://localhost:3001'

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

const FOUNDER_QUICK_ACTIONS: FounderQuickAction[] = [
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

export function PersonalHQView() {
  const { data, loading, error, refetch } = usePersonalContext()
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

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
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
              The CEO Intake now reads this context before planning personal actions.
            </p>
            <button onClick={() => void handleSave()} className="rounded-2xl border border-[#7CF6E6]/30 bg-[#7CF6E6]/10 px-5 py-2.5 text-[11px] font-black uppercase tracking-[0.25em] text-[#7CF6E6] transition hover:bg-[#7CF6E6]/18">
              Save Profile
            </button>
          </div>
          {saveState.message && <p className={clsx('mt-3 text-xs', saveState.status === 'error' ? 'text-rose-400' : 'text-slate-500')}>{saveState.message}</p>}
        </section>

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

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                Connect Google Workspace MCP first. These actions depend on live Gmail, Calendar and Drive access.
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
                {quickActionState.prompt && (
                  <p className="mt-3 text-[11px] text-slate-500">
                    Prompt: <span className="font-mono text-slate-400">{quickActionState.prompt}</span>
                  </p>
                )}
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
                        Notification: <span className="text-slate-400">{notification}</span>
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
                  WAI now has a real OAuth callback and MCP tool discovery path. Complete auth once, then founder actions can use Gmail and Calendar directly.
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
      </div>
    </div>
  )
}
