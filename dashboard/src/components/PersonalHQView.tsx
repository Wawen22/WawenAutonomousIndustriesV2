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

export function PersonalHQView() {
  const { data, loading, error, refetch } = usePersonalContext()
  const [displayName, setDisplayName] = useState('')
  const [primaryEmail, setPrimaryEmail] = useState('')
  const [assistantStyle, setAssistantStyle] = useState('')
  const [prioritiesText, setPrioritiesText] = useState('')
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' })

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
