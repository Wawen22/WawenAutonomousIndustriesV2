// ============================================================
// WAI Dashboard – Projects View (T072)
// Categorized "Blueprint Browser" with Immersive Command Modal.
// ============================================================

import { useState, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { Stat } from './ui/Stat.js'
import { Icon, type IconName } from './ui/Icon.js'
import { AgentDetailSidebar } from './AgentDetailSidebar.js'
import {
  useClients,
  useProjects,
  useTasks,
  useAgents,
  useAgentStats,
  useEventsWithContext,
  useProjectChecklist,
} from '../hooks/useSupabaseRealtime.js'
import { getClientColor } from '../lib/clientColors.js'
import { getAgentColor } from '../lib/agentColors.js'
import { renderMarkdown } from '../lib/renderMarkdown.js'
import { ProjectChecklist } from './ProjectChecklist.js'
import type { Agent, DeliveryConfig, DeliveryDeployProvider, Project, ProjectStatus, ProjectType } from '../types/index.js'

// ---------------------------------------------------------------------------
// Constants & Mappings
// ---------------------------------------------------------------------------

const TYPE_ICONS: Record<ProjectType, IconName> = {
  website:    'office',
  app:        'cpu',
  saas:       'cpu',
  consulting: 'building',
  ai:         'memory',
  marketing:  'trending-up',
  content:    'folder',
  copywriting:'folder',
  design:     'overview',
  automation: 'zap',
  other:      'folder',
}

const STATUS_LEVEL: Record<ProjectStatus, number> = {
  discovery: 10, active: 40, review: 75, delivered: 90, invoiced: 100, blocked: 0, paused: 0,
}

const STATUS_COLOR: Record<ProjectStatus, string> = {
  discovery: 'bg-slate-500',
  active:    'bg-[#00D4FF]',
  review:    'bg-violet-500',
  delivered: 'bg-emerald-500',
  invoiced:  'bg-emerald-400',
  blocked:   'bg-rose-500 shadow-[0_0_10px_#f43f5e]',
  paused:    'bg-amber-500',
}

const BACKEND_URL = (import.meta.env['VITE_BACKEND_URL'] as string | undefined) ?? ''

type ProjectCategory = 'active' | 'completed' | 'all'

// ---------------------------------------------------------------------------
// Filesystem Logic
// ---------------------------------------------------------------------------

interface DeliverableFile {
  name: string
  modified_at: string
  size_bytes: number
  dir: 'deliverable' | 'output' | 'repo'
}

type ProjectCommandTab = 'agent' | 'project' | 'delivery' | 'checklist'

function deliveryProviderLabel(provider: DeliveryDeployProvider): string {
  if (provider === 'vercel') return 'Vercel'
  if (provider === 'netlify') return 'Netlify'
  return 'None'
}

function deliveryConfigEquals(a: DeliveryConfig | null, b: DeliveryConfig | null): boolean {
  if (!a || !b) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

function isBooleanSettingKey(
  key: keyof DeliveryConfig
): key is 'gitPush' | 'autoDeploy' | 'requireFounderApproval' | 'clientEmailOnDelivery' | 'autoInvoice' {
  return key !== 'deployProvider'
}

function useDeliverables(workspacePath: string | null) {
  const [files, setFiles] = useState<DeliverableFile[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspacePath) { setFiles([]); return }
    setLoading(true); setError(null)
    fetch(`${BACKEND_URL}/api/deliverables?path=${encodeURIComponent(workspacePath)}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<{ files: DeliverableFile[] }> })
      .then((data) => { setFiles(data.files); setLoading(false) })
      .catch((err: unknown) => { setError(err instanceof Error ? err.message : 'Error'); setLoading(false) })
  }, [workspacePath])

  return { files, loading, error }
}

function fileIcon(name: string): string {
  if (name.endsWith('.pdf')) return '📕'
  if (name === 'proposal.md') return '📄'
  if (name === 'analysis.md') return '📊'
  if (name === 'architecture_plan.md') return '🏗️'
  if (name.endsWith('.html')) return '🌐'
  if (name.endsWith('.css')) return '🎨'
  if (name.endsWith('.js') || name.endsWith('.ts')) return '📜'
  return '📝'
}

function useTextContent(fetchUrl: string | null) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!fetchUrl) return
    setLoading(true); setContent(null); setError(null)
    fetch(fetchUrl)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text() })
      .then((text) => { setContent(text); setLoading(false) })
      .catch((err: unknown) => { setError(err instanceof Error ? err.message : 'Error'); setLoading(false) })
  }, [fetchUrl])

  return { content, loading, error }
}

function FileModal({ file, workspacePath, onClose }: { file: DeliverableFile; workspacePath: string | null; onClose: () => void }) {
  const { content, loading, error } = useTextContent(workspacePath ? `${BACKEND_URL}/api/file?path=${encodeURIComponent(`${workspacePath.startsWith('workspace/') ? workspacePath : `workspace/${workspacePath}`}/${file.dir === 'deliverable' ? 'deliverables' : file.dir === 'output' ? 'output' : 'repo'}/${file.name}`)}` : null)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[350] flex items-center justify-center p-6 bg-black/90 backdrop-blur-xl animate-fade-in" onClick={onClose}>
      <div className="relative w-full max-w-5xl h-[85vh] flex flex-col rounded-3xl border border-white/10 bg-[#070C1A] shadow-[0_0_80px_rgba(0,0,0,1)] overflow-hidden animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <span className="text-xl">{fileIcon(file.name)}</span>
            <h3 className="text-base font-black text-white uppercase tracking-tight font-mono">{file.name}</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/5 text-slate-500 hover:text-white transition-colors">✕</button>
        </div>
        <div className="flex-1 overflow-auto p-8 custom-scrollbar text-slate-300">
          {loading && <div className="animate-pulse text-slate-600 font-mono text-xs uppercase tracking-widest text-center py-20 italic">Parsing Neural Stream...</div>}
          {error && <div className="text-rose-400 font-mono text-xs text-center py-20">{error}</div>}
          {content && (
            file.name.endsWith('.md') 
              ? <div className="prose-wai" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
              : <pre className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap">{content}</pre>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

function FileTable({ items, workspacePath }: { items: DeliverableFile[]; workspacePath: string | null }) {
  const [openFile, setOpenFile] = useState<DeliverableFile | null>(null)
  if (items.length === 0) return <div className="py-12 text-center opacity-30 italic text-[10px] font-black uppercase tracking-widest">No sector data found</div>

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.map((f) => (
          <div 
            key={`${f.dir}-${f.name}`}
            onClick={() => setOpenFile(f)}
            className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-[#00D4FF]/30 hover:bg-white/[0.04] transition-all cursor-pointer group"
          >
            <div className="flex items-center gap-4 min-w-0">
              <span className="text-xl grayscale group-hover:grayscale-0 transition-all">{fileIcon(f.name)}</span>
              <div className="min-w-0">
                <p className="text-[12px] font-black text-slate-200 group-hover:text-white truncate uppercase tracking-tight">{f.name}</p>
                <p className="text-[9px] text-slate-600 font-mono mt-0.5">{f.dir.toUpperCase()} ARCHIVE</p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-black text-[#00D4FF]/60 group-hover:text-[#00D4FF] uppercase transition-colors">Open Schematics</span>
            </div>
          </div>
        ))}
      </div>
      {openFile && <FileModal file={openFile} workspacePath={workspacePath} onClose={() => setOpenFile(null)} />}
    </>
  )
}

function DeliveryTabContent({ project }: { project: Project }) {
  const [defaults, setDefaults] = useState<DeliveryConfig | null>(null)
  const [config, setConfig] = useState<DeliveryConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      setLoading(true)
      setError(null)
      setMessage(null)

      try {
        const [defaultsResponse, configResponse] = await Promise.all([
          fetch(`${BACKEND_URL}/api/delivery/defaults`),
          fetch(`${BACKEND_URL}/api/projects/${encodeURIComponent(project.id)}/delivery-config`),
        ])

        if (!defaultsResponse.ok || !configResponse.ok) {
          throw new Error(`HTTP ${!defaultsResponse.ok ? defaultsResponse.status : configResponse.status}`)
        }

        const [defaultsJson, configJson] = await Promise.all([
          defaultsResponse.json() as Promise<DeliveryConfig>,
          configResponse.json() as Promise<DeliveryConfig>,
        ])

        if (cancelled) return
        setDefaults(defaultsJson)
        setConfig(configJson)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [project.id])

  const isCustom = !deliveryConfigEquals(config, defaults)
  const deployUrl = typeof project.metadata['deployUrl'] === 'string' ? project.metadata['deployUrl'] : null

  function setBooleanField(key: keyof DeliveryConfig): void {
    if (!config || !isBooleanSettingKey(key)) return
    setConfig({
      ...config,
      [key]: !config[key],
    })
  }

  async function saveConfig(): Promise<void> {
    if (!config) return
    setSaving(true)
    setError(null)
    setMessage(null)

    try {
      const response = await fetch(`${BACKEND_URL}/api/projects/${encodeURIComponent(project.id)}/delivery-config`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const nextConfig = await response.json() as DeliveryConfig
      setConfig(nextConfig)
      setMessage('Saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  const toggleRows: Array<{ key: keyof DeliveryConfig; label: string; hint: string }> = [
    { key: 'gitPush', label: 'Git Push', hint: 'Push to GitHub after QA pass' },
    { key: 'autoDeploy', label: 'Auto Deploy', hint: 'Publish live build after push' },
    { key: 'requireFounderApproval', label: 'Require Approval', hint: 'Pause delivery until founder approves' },
    { key: 'clientEmailOnDelivery', label: 'Client Email', hint: 'Send delivery email via Resend' },
    { key: 'autoInvoice', label: 'Auto Invoice', hint: 'Trigger invoice creation after delivery' },
  ]

  if (loading) {
    return (
      <div className="py-20 flex flex-col items-center gap-4 opacity-30">
        <div className="w-8 h-8 border-2 border-amber-300/20 border-t-amber-300 rounded-full animate-spin" />
        <span className="text-[10px] font-black uppercase tracking-[0.3em]">Syncing Delivery Policy...</span>
      </div>
    )
  }

  if (!config || !defaults) {
    return <div className="py-12 text-center text-rose-400 font-mono text-xs">{error ?? 'Delivery config unavailable'}</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-5 rounded-3xl border border-white/10 bg-black/30">
        <div>
          <div className="flex items-center gap-3">
            <h4 className="text-sm font-black uppercase tracking-[0.18em] text-white">Governed Delivery</h4>
            {isCustom && <span className="px-2 py-1 rounded-full border border-amber-300/30 bg-amber-300/10 text-[9px] font-black uppercase tracking-[0.2em] text-amber-200">Custom</span>}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">Per-project delivery gates override the global defaults only for this project.</p>
        </div>
        <div className="flex items-center gap-3">
          {message && <span className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300">{message}</span>}
          {error && <span className="text-[10px] font-black uppercase tracking-[0.2em] text-rose-300">{error}</span>}
          <button
            onClick={() => void saveConfig()}
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-amber-300 text-black text-[10px] font-black uppercase tracking-[0.2em] transition hover:brightness-110 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_0.7fr] gap-6">
        <div className="space-y-4">
          {toggleRows.map((row) => {
            if (!isBooleanSettingKey(row.key)) return null
            const value = config[row.key]
            const defaultValue = defaults[row.key]
            return (
              <div key={row.key} className="flex items-center justify-between gap-4 p-4 rounded-2xl border border-white/5 bg-white/[0.02]">
                <div>
                  <p className="text-[12px] font-black uppercase tracking-[0.16em] text-white">{row.label}</p>
                  <p className="mt-1 text-[11px] text-slate-500">{row.hint}</p>
                  <p className="mt-1 text-[10px] font-mono text-slate-600">Default: {defaultValue ? 'ON' : 'OFF'}</p>
                </div>
                <button
                  onClick={() => setBooleanField(row.key)}
                  className={clsx(
                    'relative h-8 w-16 rounded-full border transition-all',
                    value
                      ? 'border-emerald-300/30 bg-emerald-300/20'
                      : 'border-white/10 bg-black/40'
                  )}
                >
                  <span
                    className={clsx(
                      'absolute top-1 h-6 w-6 rounded-full transition-all',
                      value ? 'left-9 bg-emerald-300' : 'left-1 bg-slate-500'
                    )}
                  />
                  <span className={clsx('absolute inset-0 flex items-center justify-center text-[9px] font-black uppercase tracking-[0.2em]', value ? 'text-emerald-100' : 'text-slate-500')}>
                    {value ? 'ON' : 'OFF'}
                  </span>
                </button>
              </div>
            )
          })}

          <div className="p-4 rounded-2xl border border-white/5 bg-white/[0.02]">
            <p className="text-[12px] font-black uppercase tracking-[0.16em] text-white">Deploy Provider</p>
            <p className="mt-1 text-[11px] text-slate-500">Default: {deliveryProviderLabel(defaults.deployProvider)}</p>
            <select
              value={config.deployProvider ?? 'none'}
              onChange={(event) => setConfig({
                ...config,
                deployProvider: event.target.value === 'none' ? null : event.target.value as DeliveryDeployProvider,
              })}
              className="mt-3 w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-[12px] font-bold text-white focus:border-amber-300/40 focus:outline-none"
            >
              <option value="vercel">Vercel</option>
              <option value="netlify">Netlify</option>
              <option value="none">None</option>
            </select>
          </div>
        </div>

        <div className="space-y-4">
          <div className="p-5 rounded-3xl border border-white/10 bg-black/30">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Current Effective Config</p>
            <div className="mt-4 space-y-3 text-[11px] font-mono text-slate-300">
              <div className="flex justify-between gap-4"><span>Git Push</span><span>{config.gitPush ? 'ON' : 'OFF'}</span></div>
              <div className="flex justify-between gap-4"><span>Auto Deploy</span><span>{config.autoDeploy ? 'ON' : 'OFF'}</span></div>
              <div className="flex justify-between gap-4"><span>Provider</span><span>{deliveryProviderLabel(config.deployProvider)}</span></div>
              <div className="flex justify-between gap-4"><span>Founder Approval</span><span>{config.requireFounderApproval ? 'ON' : 'OFF'}</span></div>
              <div className="flex justify-between gap-4"><span>Client Email</span><span>{config.clientEmailOnDelivery ? 'ON' : 'OFF'}</span></div>
              <div className="flex justify-between gap-4"><span>Auto Invoice</span><span>{config.autoInvoice ? 'ON' : 'OFF'}</span></div>
            </div>
          </div>

          <div className="p-5 rounded-3xl border border-white/10 bg-black/30">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Latest Deployment</p>
            {deployUrl ? (
              <a
                href={deployUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 block break-all text-[12px] font-bold text-[#00D4FF] hover:underline"
              >
                {deployUrl}
              </a>
            ) : (
              <p className="mt-4 text-[11px] text-slate-500">No deploy URL stored in project metadata yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Project Command Center (Modal)
// ---------------------------------------------------------------------------

function ProjectCommandCenter({ 
  project, 
  clientName, 
  involvedAgents, 
  onClose,
  onAgentClick
}: { 
  project: Project; 
  clientName: string; 
  involvedAgents: Agent[]; 
  onClose: () => void;
  onAgentClick: (a: Agent) => void;
}) {
  const { files, loading } = useDeliverables(project.workspace_path)
  const { data: checklistItems } = useProjectChecklist(project.id)
  const [tab, setTab] = useState<ProjectCommandTab>('agent')
  const agentFiles = files.filter(f => f.dir === 'deliverable')
  const projectFiles = files.filter(f => f.dir === 'output' || f.dir === 'repo')
  const color = STATUS_COLOR[project.status] ?? 'bg-slate-500'

  // Derive progress from checklist completion when items exist; fall back to status-based
  const progress = (() => {
    const total = checklistItems.filter(i => i.status !== 'skipped').length
    if (total === 0) return STATUS_LEVEL[project.status] ?? 0
    const done = checklistItems.filter(i => i.status === 'done').length
    return Math.round((done / total) * 100)
  })()

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 sm:p-8 bg-black/80 backdrop-blur-md animate-fade-in" onClick={onClose}>
      <div 
        className="relative w-full max-w-6xl h-full max-h-[90vh] flex flex-col rounded-[2.5rem] border-2 border-white/10 bg-[#070C1A] shadow-[0_0_100px_rgba(0,0,0,0.8)] overflow-hidden animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-8 py-6 border-b border-white/5 flex items-center justify-between bg-white/[0.01]">
          <div className="flex items-center gap-6">
            <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-[#00D4FF]">
              <Icon name={TYPE_ICONS[project.type]} size={28} />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <span className="px-2 py-0.5 rounded bg-[#00D4FF]/10 text-[#00D4FF] text-[9px] font-black uppercase tracking-widest border border-[#00D4FF]/20">{clientName}</span>
                <span className="text-[10px] font-mono text-slate-600 font-bold uppercase">SEC_ID: {project.id.slice(0,8)}</span>
              </div>
              <h2 className="text-2xl font-black text-white uppercase tracking-tighter italic mt-1">{project.name}</h2>
            </div>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-full flex items-center justify-center bg-white/5 text-slate-500 hover:text-white transition-all text-xl">✕</button>
        </div>

        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          <div className="w-full lg:w-80 border-r border-white/5 p-8 space-y-8 bg-black/20 overflow-y-auto custom-scrollbar">
            <section className="space-y-4">
              <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">Operational Status</h4>
              <div className="space-y-2">
                <div className="flex justify-between text-[11px] font-bold text-slate-300">
                  <span>Progress</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono text-slate-600 uppercase tracking-tight">
                      {checklistItems.filter(i => i.status !== 'skipped').length > 0 ? 'checklist' : 'status'}
                    </span>
                    <span>{progress}%</span>
                  </div>
                </div>
                <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                  <div
                    className={clsx("h-full transition-all duration-1000", project.status === 'blocked' ? 'bg-emerald-400' : color)}
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className={clsx("text-[10px] font-black uppercase tracking-widest", color.replace('bg-', 'text-'))}>{project.status}</span>
                  {project.status === 'blocked' && (
                    <span className="text-[9px] font-mono text-rose-400 uppercase tracking-wide">⛔ blocked</span>
                  )}
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">Project Metrics</h4>
              <div className="grid gap-3">
                <div className="p-4 rounded-2xl bg-black/40 border border-white/5">
                  <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest mb-1">Contract Valuation</p>
                  <p className="text-lg font-mono font-black text-emerald-400">{project.contract_value_usd > 0 ? `$${project.contract_value_usd.toLocaleString()}` : 'INTERNAL'}</p>
                </div>
                <div className="p-4 rounded-2xl bg-black/40 border border-white/5">
                  <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest mb-1">Deployment Date</p>
                  <p className="text-sm font-mono font-black text-slate-300">{format(new Date(project.created_at), 'dd MMMM yyyy').toUpperCase()}</p>
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">Assigned Neural Nodes</h4>
              <div className="grid grid-cols-4 gap-2">
                {involvedAgents.map(a => (
                  <button 
                    key={a.id} onClick={() => onAgentClick(a)}
                    className={clsx("w-12 h-12 rounded-xl border flex items-center justify-center font-black text-xs transition-transform hover:scale-110", getAgentColor(a.id).bg, getAgentColor(a.id).border, getAgentColor(a.id).text)}
                    title={a.name}
                  >
                    {a.name.split(' ').map(n => n[0]).join('')}
                  </button>
                ))}
              </div>
            </section>
          </div>

          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-8 pb-4 flex items-center justify-between gap-4">
              <div className="flex gap-2 p-1 bg-black/40 border border-white/10 rounded-2xl">
                <button onClick={() => setTab('agent')} className={clsx("px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all", tab === 'agent' ? "bg-[#00D4FF] text-black shadow-[0_0_20px_rgba(0,212,255,0.3)]" : "text-slate-500 hover:text-slate-300")}>Neural Output Clusters</button>
                <button onClick={() => setTab('project')} className={clsx("px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all", tab === 'project' ? "bg-violet-500 text-white shadow-[0_0_15px_rgba(139,92,246,0.3)]" : "text-slate-500 hover:text-slate-300")}>System Source Tree</button>
                <button onClick={() => setTab('delivery')} className={clsx("px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all", tab === 'delivery' ? "bg-amber-300 text-black shadow-[0_0_20px_rgba(252,211,77,0.28)]" : "text-slate-500 hover:text-slate-300")}>Delivery</button>
                <button onClick={() => setTab('checklist')} className={clsx("px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all", tab === 'checklist' ? "bg-emerald-400 text-black shadow-[0_0_20px_rgba(52,211,153,0.3)]" : "text-slate-500 hover:text-slate-300")}>Checklist</button>
              </div>
              <span className="text-[10px] font-mono text-slate-700 uppercase font-bold tracking-tighter">Root: {project.workspace_path}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-8 pt-4 custom-scrollbar">
              {tab === 'checklist' ? (
                <ProjectChecklist projectId={project.id} />
              ) : tab === 'delivery' ? (
                <DeliveryTabContent project={project} />
              ) : loading ? (
                <div className="py-20 flex flex-col items-center gap-4 opacity-30">
                  <div className="w-8 h-8 border-2 border-[#00D4FF]/20 border-t-[#00D4FF] rounded-full animate-spin" />
                  <span className="text-[10px] font-black uppercase tracking-[0.3em]">Accessing Filesystem...</span>
                </div>
              ) : (
                <FileTable items={tab === 'agent' ? agentFiles : projectFiles} workspacePath={project.workspace_path ?? null} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ---------------------------------------------------------------------------
// Sub-component: Blueprint Card
// ---------------------------------------------------------------------------

function BlueprintCard({ project, involvedAgents, onSelect }: { project: Project; involvedAgents: Agent[]; onSelect: (p: Project) => void }) {
  const progress = STATUS_LEVEL[project.status] ?? 0
  const color = STATUS_COLOR[project.status] ?? 'bg-slate-500'

  return (
    <div 
      onClick={() => onSelect(project)}
      className="group relative flex flex-col rounded-2xl border border-white/5 bg-white/[0.01] p-5 transition-all duration-300 cursor-pointer hover:bg-white/[0.03] hover:border-white/10 hover:-translate-y-1"
    >
      <div className="absolute inset-0 bg-grid opacity-[0.02] pointer-events-none" style={{ backgroundSize: '15px 15px' }} />
      <div className="flex items-center justify-between gap-4 mb-4 relative z-10">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-500 group-hover:text-[#00D4FF] group-hover:border-[#00D4FF]/20 transition-all shrink-0">
            <Icon name={TYPE_ICONS[project.type]} size={20} />
          </div>
          <div className="min-w-0">
            <h3 className="text-[13px] font-black text-white uppercase tracking-tight line-clamp-2 leading-tight group-hover:text-[#00D4FF] transition-colors">{project.name}</h3>
            <p className="text-[9px] font-mono text-slate-600 uppercase mt-1 tracking-tighter truncate opacity-60">ID: {project.id.slice(0,8)}</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] font-mono font-bold text-white tracking-tighter leading-none">{progress}%</p>
          <div className="w-12 h-1 bg-white/5 rounded-full mt-1.5 overflow-hidden">
            <div className={clsx("h-full", color)} style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between relative z-10 pt-4 border-t border-white/5 mt-auto">
        <div className="flex -space-x-2">
          {involvedAgents.slice(0, 4).map(a => (
            <div key={a.id} className={clsx("w-6 h-6 rounded-full border-2 border-[#05080F] flex items-center justify-center font-black text-[7px]", getAgentColor(a.id).bg, getAgentColor(a.id).text)}>
              {a.name.split(' ').map(n => n[0]).join('')}
            </div>
          ))}
          {involvedAgents.length > 4 && <div className="w-6 h-6 rounded-full border-2 border-[#05080F] bg-slate-800 text-white flex items-center justify-center font-black text-[7px]">+{involvedAgents.length - 4}</div>}
        </div>
        <span className="text-[10px] font-mono font-bold text-emerald-400 group-hover:underline underline-offset-4 decoration-emerald-400/30">
          {project.contract_value_usd > 0 ? `$${project.contract_value_usd.toLocaleString()}` : 'INTERNAL'}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function ProjectsView() {
  const { data: projects, loading: pLoad } = useProjects()
  const { data: clients } = useClients()
  const { data: agents } = useAgents()
  const { data: tasks } = useTasks()
  const { runCounts, lastRuns } = useAgentStats()
  const { data: events } = useEventsWithContext(50)

  const [activeCategory, setActiveCategory] = useState<ProjectCategory>('active')
  const [search, setSearch] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)

  const organizedData = useMemo(() => {
    const q = search.toLowerCase().trim()
    const filtered = projects.filter(p => {
      if (!q) return true;
      const client = clients.find(c => c.id === p.client_id);
      const clientName = client?.name.toLowerCase() || '';
      return p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q) || clientName.includes(q);
    })
    const categories: Record<ProjectCategory, Project[]> = {
      active: filtered.filter(p => ['discovery', 'active', 'review', 'blocked'].includes(p.status)),
      completed: filtered.filter(p => ['delivered', 'invoiced'].includes(p.status)),
      all: filtered
    }
    const currentList = categories[activeCategory]
    const groupedByClient = currentList.reduce<Record<string, Project[]>>((acc, p) => {
      acc[p.client_id] = [...(acc[p.client_id] ?? []), p]
      return acc
    }, {})
    return { categories, groupedByClient }
  }, [projects, clients, search, activeCategory])

  const projectAgentsMap = useMemo(() => {
    const map = new Map<string, Agent[]>()
    projects.forEach(p => {
      const agentIds = new Set(tasks.filter(t => t.project_id === p.id).map(t => t.assignee_agent_id).filter(Boolean))
      map.set(p.id, agents.filter(a => agentIds.has(a.id)))
    })
    return map
  }, [projects, tasks, agents])

  const selectedProject = useMemo(() => projects.find(p => p.id === selectedProjectId), [projects, selectedProjectId])

  if (pLoad) return <div className="flex flex-col items-center justify-center h-64 gap-4 animate-pulse"><div className="w-10 h-10 border-4 border-[#00D4FF]/20 border-t-[#00D4FF] rounded-full animate-spin" /><p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em]">Accessing Matrix...</p></div>

  return (
    <div className="space-y-8 animate-fade-in pb-20">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Total Schematics" value={projects.length} color="violet" />
        <Stat label="Active Threads" value={organizedData.categories.active.length} color="cyan" />
        <Stat label="Verified Output" value={organizedData.categories.completed.length} color="emerald" />
        <Stat label="Asset Valuation" value={`$${projects.reduce((s,p) => s + (p.contract_value_usd || 0), 0).toLocaleString()}`} color="amber" />
      </div>

      <div className="flex flex-col md:flex-row items-center justify-between gap-6 bg-white/[0.02] border border-white/5 rounded-3xl p-4">
        <div className="flex items-center gap-2 p-1 bg-black/40 border border-white/10 rounded-2xl overflow-x-auto no-scrollbar">
          {['active', 'completed', 'all'].map(cat => (
            <button
              key={cat} onClick={() => setActiveCategory(cat as ProjectCategory)}
              className={clsx("px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap", activeCategory === cat ? "bg-[#00D4FF] text-black shadow-[0_0_20px_rgba(0,212,255,0.3)]" : "text-slate-500 hover:text-slate-300")}
            >
              {cat === 'active' ? 'Active Ops' : cat === 'completed' ? 'Archived Assets' : 'Total Matrix'}
            </button>
          ))}
        </div>
        <div className="relative group">
          <Icon name="overview" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-[#00D4FF]" />
          <input 
            value={search} onChange={e => setSearch(e.target.value)} placeholder="SCAN SCHEMATICS OR CLIENTS..."
            className="bg-black/40 border border-white/10 rounded-xl pl-10 pr-6 py-2.5 text-[11px] font-bold text-white placeholder:text-slate-700 focus:outline-none focus:border-[#00D4FF]/40 w-80 transition-all shadow-inner"
          />
        </div>
      </div>

      <div className="space-y-12">
        {Object.entries(organizedData.groupedByClient).map(([clientId, prjs]) => {
          const client = clients.find(c => c.id === clientId)
          return (
            <section key={clientId} className="space-y-5">
              <div className="flex items-center gap-4">
                <div className={clsx("px-3 py-1 rounded-lg border text-[10px] font-black uppercase tracking-[0.2em]", getClientColor(client?.name || 'Unknown').bg, getClientColor(client?.name || 'Unknown').text, getClientColor(client?.name || 'Unknown').border)}>
                  {client?.name || 'System Asset'}
                </div>
                <div className="h-px flex-1 bg-white/5" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {prjs.map(p => (
                  <BlueprintCard key={p.id} project={p} involvedAgents={projectAgentsMap.get(p.id) || []} onSelect={(p) => setSelectedProjectId(p.id)} />
                ))}
              </div>
            </section>
          )
        })}
      </div>

      {selectedProject && (
        <ProjectCommandCenter 
          project={selectedProject} 
          clientName={clients.find(c => c.id === selectedProject.client_id)?.name || '—'} 
          involvedAgents={projectAgentsMap.get(selectedProject.id) || []}
          onClose={() => setSelectedProjectId(null)}
          onAgentClick={setSelectedAgent}
        />
      )}

      {selectedAgent && (
        <AgentDetailSidebar
          agent={selectedAgent} lastRuns={lastRuns[selectedAgent.id] ?? []}
          runCount={runCounts[selectedAgent.id] ?? 0} activeTasks={tasks.filter(t => t.status === 'in_progress')}
          recentEvents={events || []} onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  )
}
