// ============================================================
// WAI Dashboard – Projects View
// Lista progetti filtrabili per client / status / tipo.
// ============================================================

import { useState, useMemo, useEffect, Fragment, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { Panel } from './ui/Panel.js'
import { Badge } from './ui/Badge.js'
import { Stat } from './ui/Stat.js'
import { useClients, useProjects } from '../hooks/useSupabaseRealtime.js'
import type { Project, ProjectStatus, ProjectType } from '../types/index.js'

// ---------------------------------------------------------------------------
// Deliverables panel
// ---------------------------------------------------------------------------

interface DeliverableFile {
  name: string
  modified_at: string
  size_bytes: number
  dir: 'deliverable' | 'output' | 'repo'
}

function useDeliverables(workspacePath: string | null) {
  const [files, setFiles] = useState<DeliverableFile[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspacePath) {
      setFiles([])
      return
    }

    setLoading(true)
    setError(null)

    const backendUrl = import.meta.env['VITE_BACKEND_URL'] ?? 'http://localhost:3001'
    const url = `${backendUrl}/api/deliverables?path=${encodeURIComponent(workspacePath)}`

    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<{ files: DeliverableFile[] }>
      })
      .then((data) => {
        setFiles(data.files)
        setLoading(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Error fetching deliverables')
        setLoading(false)
      })
  }, [workspacePath])

  return { files, loading, error }
}

function fileIcon(name: string): string {
  if (name.endsWith('.pdf')) return '📕'
  if (name === 'proposal.md') return '📄'
  if (name === 'analysis.md') return '📊'
  if (name === 'architecture_plan.md') return '🏗️'
  if (name === 'qa_report.md') return '🧪'
  if (name === 'sprint_plan.md') return '🗺️'
  if (name.startsWith('repo-execution')) return '⚙️'
  if (name.startsWith('marketing-plan')) return '📈'
  if (name.startsWith('content-package')) return '✍️'
  if (name.startsWith('social-calendar')) return '📣'
  if (name.startsWith('dev-saas')) return '💻'
  if (name.startsWith('dev-general')) return '🛠️'
  if (name.endsWith('.html')) return '🌐'
  if (name.endsWith('.css')) return '🎨'
  if (name.endsWith('.js') || name.endsWith('.ts')) return '📜'
  if (name.endsWith('.py')) return '🐍'
  if (name.endsWith('.json') || name.endsWith('.yaml') || name.endsWith('.yml')) return '⚙️'
  if (name === 'README.md') return '📖'
  if (name === '.gitignore') return '🚫'
  return '📝'
}

// ---------------------------------------------------------------------------
// File viewer — unified viewer for all file types
// ---------------------------------------------------------------------------

type FileTab = 'deliverables' | 'output' | 'info'

const BACKEND_URL = (import.meta.env['VITE_BACKEND_URL'] as string | undefined) ?? 'http://localhost:3001'

/** Returns a relative "workspace/..." path for the /api/file endpoint */
function buildApiPath(f: DeliverableFile, workspacePath: string): string {
  const relBase = workspacePath.startsWith('workspace/')
    ? workspacePath
    : `workspace/${workspacePath}`
  const subdir = f.dir === 'deliverable' ? 'deliverables' : f.dir === 'output' ? 'output' : 'repo'
  return `${relBase}/${subdir}/${f.name}`
}

/** Returns the URL for the /api/repo static route (HTML with CSS/JS resolved) */
function buildStaticUrl(f: DeliverableFile, workspacePath: string): string {
  const relBase = workspacePath.startsWith('workspace/')
    ? workspacePath
    : `workspace/${workspacePath}`
  return `${BACKEND_URL}/api/repo/${relBase}/repo/${f.name}`
}

/** Minimal markdown → HTML (headings, bold, italic, inline code, fenced code, hr, lists) */
function renderMarkdown(md: string): string {
  let html = md
    // Fenced code blocks
    .replace(/```[\w]*\n([\s\S]*?)```/g, (_m, code: string) =>
      `<pre><code>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`)
    // Headings
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Horizontal rule
    .replace(/^---+$/gm, '<hr />')
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Unordered lists
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    // Blockquote
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // Paragraphs: double newline → <p>
    .replace(/\n{2,}/g, '</p><p>')
  return `<p>${html}</p>`
}

function useTextContent(fetchUrl: string | null) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!fetchUrl) return
    setLoading(true)
    setContent(null)
    setError(null)
    fetch(fetchUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.text()
      })
      .then((text) => { setContent(text); setLoading(false) })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Error')
        setLoading(false)
      })
  }, [fetchUrl])

  return { content, loading, error }
}

interface FileViewerProps {
  file: DeliverableFile
  workspacePath: string | null
  modal?: boolean
}

function FileViewer({ file, workspacePath, modal = false }: FileViewerProps) {
  const ext = file.name.includes('.') ? `.${file.name.split('.').pop()!.toLowerCase()}` : ''
  const isHtmlInRepo = ext === '.html' && file.dir === 'repo'

  // HTML inside repo/ → iframe via /api/repo static route (CSS/JS resolves correctly)
  // Zoom-out trick: render at 1/SCALE viewport, then scale down visually —
  // the browser lays out the full desktop page and we show it at ~72% zoom.
  if (isHtmlInRepo && workspacePath) {
    const staticUrl = buildStaticUrl(file, workspacePath)
    const SCALE = 0.72
    // Container fills the modal area; iframe is inflated then scaled back down.
    return (
      <div className="w-full bg-white overflow-hidden" style={{ height: modal ? '100%' : '460px' }}>
        <iframe
          src={staticUrl}
          sandbox="allow-scripts allow-same-origin"
          title={file.name}
          style={{
            display: 'block',
            border: 'none',
            width: `${100 / SCALE}%`,
            height: `${100 / SCALE}%`,
            transform: `scale(${SCALE})`,
            transformOrigin: 'top left',
          }}
        />
      </div>
    )
  }

  // All other files → fetch raw text and display
  const apiPath = workspacePath ? buildApiPath(file, workspacePath) : null
  const fetchUrl = apiPath ? `${BACKEND_URL}/api/file?path=${encodeURIComponent(apiPath)}` : null

  return <TextViewer fetchUrl={fetchUrl} ext={ext} filename={file.name} modal={modal} />
}

function TextViewer({ fetchUrl, ext, filename, modal = false }: { fetchUrl: string | null; ext: string; filename: string; modal?: boolean }) {
  const { content, loading, error } = useTextContent(fetchUrl)

  const isMarkdown = ext === '.md'

  return (
    <div className={clsx('flex flex-col', modal ? 'h-full' : 'max-h-[500px]')}>
      {loading && (
        <div className="flex items-center justify-center flex-1 p-6">
          <span className="text-[11px] text-slate-600 font-mono animate-pulse">Loading {filename}…</span>
        </div>
      )}
      {error && (
        <div className="p-4">
          <p className="text-[11px] text-rose-400 font-mono">Error: {error}</p>
        </div>
      )}
      {!loading && !error && content !== null && (
        <div className={clsx('overflow-auto', modal ? 'flex-1 p-5' : 'p-3')}>
          {isMarkdown ? (
            <div
              className="prose-wai leading-relaxed"
              style={{ fontSize: '87%' }}
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
            />
          ) : (
            <pre className="text-[10px] font-mono text-slate-300 whitespace-pre-wrap break-words leading-relaxed">
              {content}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// File modal — portal-based overlay for file preview
// ---------------------------------------------------------------------------

interface FileModalProps {
  file: DeliverableFile
  workspacePath: string | null
  onClose: () => void
}

function FileModal({ file, workspacePath, onClose }: FileModalProps) {
  const ext = file.name.includes('.') ? `.${file.name.split('.').pop()!.toLowerCase()}` : ''

  // Close on ESC
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [handleKey])

  const EXT_ACCENT: Record<string, string> = {
    '.md':   'text-violet-300 border-violet-700/50',
    '.html': ext === '.html' ? 'text-emerald-300 border-emerald-700/50' : 'text-amber-300 border-amber-700/50',
    '.css':  'text-sky-300 border-sky-700/50',
    '.js':   'text-yellow-300 border-yellow-700/50',
    '.ts':   'text-blue-300 border-blue-700/50',
    '.tsx':  'text-blue-300 border-blue-700/50',
    '.json': 'text-emerald-300 border-emerald-700/50',
  }
  const accentClass = EXT_ACCENT[ext] ?? 'text-slate-300 border-white/10'
  const [accentText] = accentClass.split(' ')

  const isHtmlInRepo = ext === '.html' && file.dir === 'repo'
  const modalHeight = isHtmlInRepo ? 'calc(100vh - 8rem)' : 'calc(100vh - 10rem)'

  return createPortal(
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 lg:p-10"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      {/* Modal panel — stop propagation so click inside doesn't close */}
      <div
        className="relative w-full max-w-[92vw] flex flex-col rounded-xl border border-white/[0.1] bg-[#0c0c14] shadow-2xl"
        style={{ maxHeight: 'calc(100vh - 4rem)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base">{fileIcon(file.name)}</span>
            <span className={`font-mono text-[13px] font-semibold truncate ${accentText}`}>
              {file.name}
            </span>
            {file.dir === 'repo' && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-sky-950/60 border border-sky-800/40 text-sky-500 shrink-0">
                repo
              </span>
            )}
            <span className="text-[10px] text-slate-600 font-mono shrink-0">
              {file.size_bytes < 1024 ? `${file.size_bytes}B` : `${(file.size_bytes / 1024).toFixed(1)}KB`}
              {' · '}
              {format(new Date(file.modified_at), 'MMM d, HH:mm')}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0 ml-4">
            {isHtmlInRepo && workspacePath && (
              <a
                href={buildStaticUrl(file, workspacePath)}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-mono text-slate-500 hover:text-slate-200 transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                open ↗
              </a>
            )}
            <button
              onClick={onClose}
              className="text-slate-500 hover:text-white transition-colors text-lg leading-none px-1"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="overflow-auto" style={{ height: modalHeight }}>
          <FileViewer file={file} workspacePath={workspacePath} modal />
        </div>
      </div>
    </div>,
    document.body
  )
}

// ---------------------------------------------------------------------------
// File table (shared between tabs)
// ---------------------------------------------------------------------------

function FileTable({ items, workspacePath }: { items: DeliverableFile[]; workspacePath: string | null }) {
  const [openFile, setOpenFile] = useState<DeliverableFile | null>(null)

  if (items.length === 0) {
    return (
      <p className="text-[11px] text-slate-600 font-mono py-4">
        No files in this category yet.
      </p>
    )
  }

  return (
    <>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/[0.05] text-left">
            <th className="pb-2.5 pt-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500">File</th>
            <th className="pb-2.5 pt-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500 text-right">Size</th>
            <th className="pb-2.5 pt-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500 text-right">Modified</th>
          </tr>
        </thead>
        <tbody>
          {items.map((f) => {
            const fileKey = `${f.dir}-${f.name}`
            return (
              <Fragment key={fileKey}>
                <tr
                  className="border-b border-white/[0.025] hover:bg-white/[0.02] transition-colors cursor-pointer group"
                  onClick={() => setOpenFile(f)}
                >
                  <td className="py-2 text-slate-300 font-mono text-[11px]">
                    <span className="mr-1 text-[10px] text-slate-600 group-hover:text-slate-400 select-none transition-colors">▸</span>
                    {fileIcon(f.name)}{' '}
                    <span className="group-hover:text-white transition-colors">{f.name}</span>
                    {f.dir === 'repo' && (
                      <span className="ml-1.5 text-[9px] font-mono px-1 py-0.5 rounded bg-sky-950/60 border border-sky-800/40 text-sky-500">repo</span>
                    )}
                  </td>
                  <td className="py-2 text-right text-slate-600 font-mono text-[10px]">
                    {f.size_bytes < 1024
                      ? `${f.size_bytes}B`
                      : `${(f.size_bytes / 1024).toFixed(1)}KB`}
                  </td>
                  <td className="py-2 text-right text-slate-600 font-mono text-[10px]">
                    {format(new Date(f.modified_at), 'MMM d, HH:mm')}
                  </td>
                </tr>
              </Fragment>
            )
          })}
        </tbody>
      </table>

      {openFile && (
        <FileModal
          file={openFile}
          workspacePath={workspacePath}
          onClose={() => setOpenFile(null)}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// DeliverablesPanel — inline expansion with tabs
// ---------------------------------------------------------------------------

interface DeliverablesPanelProps {
  project: Project
}

function DeliverablesPanel({ project }: DeliverablesPanelProps) {
  const { files, loading, error } = useDeliverables(project.workspace_path)
  const hasRepoContext = Boolean(project.repo_local_path || project.repo_url)

  const deliverableFiles = files.filter((f) => f.dir === 'deliverable')
  // "Project Files" = actual code files from output/ (no-repo projects) or repo/ (git projects)
  const projectFiles = files.filter((f) => f.dir === 'output' || f.dir === 'repo')

  // Default to whichever tab has content, or 'info'
  const defaultTab: FileTab =
    deliverableFiles.length > 0 ? 'deliverables' : projectFiles.length > 0 ? 'output' : 'info'
  const [activeTab, setActiveTab] = useState<FileTab>(defaultTab)

  // Switch to a tab with content when files load
  useEffect(() => {
    if (deliverableFiles.length > 0 && activeTab === 'info') setActiveTab('deliverables')
    else if (projectFiles.length > 0 && activeTab === 'info') setActiveTab('output')
  }, [deliverableFiles.length, projectFiles.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const tabs: Array<{ id: FileTab; label: string; count?: number; accent: string }> = [
    {
      id: 'deliverables',
      label: 'Agent Deliverables',
      count: deliverableFiles.length,
      accent: 'violet',
    },
    {
      id: 'output',
      label: 'Project Files',
      count: projectFiles.length,
      accent: 'emerald',
    },
    {
      id: 'info',
      label: 'Project Info',
      accent: 'cyan',
    },
  ]

  const accentColors: Record<string, string> = {
    violet:  'border-violet-500 text-violet-300',
    emerald: 'border-emerald-500 text-emerald-300',
    cyan:    'border-cyan-500 text-cyan-300',
  }
  const inactiveTabClass =
    'border-transparent text-slate-500 hover:text-slate-300 hover:border-slate-500'

  return (
    <div className="border border-white/[0.06] rounded-xl bg-[#0c0c14] shadow-xl overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 pt-3 pb-0 border-b border-white/[0.06]">
        {/* Tab list */}
        <div className="flex items-end gap-0">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id
            const colorClass = isActive ? accentColors[tab.accent] : inactiveTabClass
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  'flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-medium tracking-wide',
                  'border-b-2 transition-all duration-150 -mb-px focus:outline-none whitespace-nowrap',
                  colorClass
                )}
              >
                {tab.label}
                {tab.count !== undefined && (
                  <span
                    className={clsx(
                      'text-[9px] font-mono px-1.5 py-0.5 rounded-full',
                      isActive
                        ? 'bg-white/10 text-slate-300'
                        : 'bg-white/[0.04] text-slate-600'
                    )}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Project path chip */}
        <span className="text-[10px] text-slate-600 font-mono truncate max-w-[200px] pb-2.5" title={project.workspace_path ?? ''}>
          {project.workspace_path ?? '—'}
        </span>
      </div>

      {/* Tab content */}
      <div className="p-4">
        {loading && (
          <p className="text-[11px] text-slate-600 font-mono animate-pulse py-3">Loading…</p>
        )}
        {error && (
          <p className="text-[11px] text-rose-400 font-mono py-3">Error: {error}</p>
        )}

        {!loading && !error && (
          <>
            {activeTab === 'deliverables' && (
              <FileTable items={deliverableFiles} workspacePath={project.workspace_path ?? null} />
            )}

            {activeTab === 'output' && (
              <FileTable items={projectFiles} workspacePath={project.workspace_path ?? null} />
            )}

            {activeTab === 'info' && (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3">
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-cyan-400 mb-2">
                    Repo Context
                  </div>
                  {hasRepoContext ? (
                    <div className="space-y-1 text-[11px] font-mono text-slate-300">
                      <div className="truncate" title={project.repo_local_path ?? ''}>
                        local: {project.repo_local_path ?? '—'}
                      </div>
                      <div>branch: {project.repo_default_branch ?? '—'}</div>
                      <div className="truncate" title={project.repo_url ?? ''}>
                        remote: {project.repo_url ?? '—'}
                      </div>
                      <div>provider: {project.repo_provider ?? '—'}</div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500 font-mono">
                      No repo linked. Use `/link_repo` or the Architect auto-inits one.
                    </p>
                  )}
                </div>

                <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3">
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-amber-400 mb-2">
                    Founder Flow
                  </div>
                  <div className="space-y-1 text-[11px] font-mono text-slate-400">
                    <div>1. `/new_project client project type`</div>
                    <div>2. `/brief client/project ...`</div>
                    <div>3. `/task client/project ...`</div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Badge mappings
// ---------------------------------------------------------------------------

// Maps to existing Badge.tsx VARIANT_STYLES keys
const STATUS_BADGE: Record<ProjectStatus, string> = {
  active:    'done',
  discovery: 'todo',
  paused:    'cancelled',
  review:    'in_progress',
  blocked:   'blocked',
  delivered: 'info',
  invoiced:  'finance',
}

const TYPE_BADGE: Record<ProjectType, string> = {
  website:    'dev',
  app:        'dev_complex',
  saas:       'dev_complex',
  consulting: 'consulting',
  ai:         'analysis',
  marketing:  'marketing',
  content:    'content',
  copywriting:'content',
  design:     'default',
  automation: 'ops',
  other:      'default',
}

const PROJECT_TYPE_OPTIONS: ProjectType[] = [
  'website',
  'app',
  'saas',
  'consulting',
  'ai',
  'marketing',
  'content',
  'copywriting',
  'design',
  'automation',
  'other',
]

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

type AnyFilter = 'all'

interface FilterBarProps {
  clients: Array<{ id: string; name: string }>
  statusFilter: ProjectStatus | AnyFilter
  typeFilter: ProjectType | AnyFilter
  clientFilter: string
  search: string
  onStatus: (v: ProjectStatus | AnyFilter) => void
  onType: (v: ProjectType | AnyFilter) => void
  onClient: (v: string) => void
  onSearch: (v: string) => void
}

function FilterBar({
  clients, statusFilter, typeFilter, clientFilter, search,
  onStatus, onType, onClient, onSearch,
}: FilterBarProps) {
  const selectClass = clsx(
    'text-xs font-mono bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-1.5',
    'text-slate-300 focus:outline-none focus:border-[#00D4FF]/40 transition-colors'
  )
  const inputClass = clsx(
    'text-xs font-mono bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-1.5',
    'text-slate-300 placeholder-slate-600 focus:outline-none focus:border-[#00D4FF]/40 transition-colors w-40'
  )

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-slate-600 uppercase tracking-wider font-medium mr-1">Filter:</span>

      <input
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search…"
        className={inputClass}
      />

      <select value={clientFilter} onChange={(e) => onClient(e.target.value)} className={selectClass}>
        <option value="">All clients</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>

      <select value={statusFilter} onChange={(e) => onStatus(e.target.value as ProjectStatus | AnyFilter)} className={selectClass}>
        <option value="all">All statuses</option>
        {(['discovery','active','paused','review','blocked','delivered','invoiced'] as ProjectStatus[]).map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      <select value={typeFilter} onChange={(e) => onType(e.target.value as ProjectType | AnyFilter)} className={selectClass}>
        <option value="all">All types</option>
        {PROJECT_TYPE_OPTIONS.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Project row
// ---------------------------------------------------------------------------

interface ProjectRowProps {
  project: Project
  clientName: string
  selected: boolean
  onSelect: (p: Project) => void
}

function ProjectRow({ project, clientName, selected, onSelect }: ProjectRowProps) {
  return (
    <tr
      className={clsx(
        'border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors group cursor-pointer',
        selected && 'bg-violet-950/30 border-violet-800/30'
      )}
      onClick={() => onSelect(project)}
    >
      <td className="px-4 py-3 font-medium text-white text-sm max-w-[180px] truncate">
        {selected && <span className="text-violet-400 mr-1">▸</span>}
        {project.name}
        {project.repo_local_path && <span className="ml-2 text-[10px] text-cyan-400 font-mono">repo</span>}
      </td>
      <td className="px-4 py-3 text-sm text-slate-400">
        {clientName}
      </td>
      <td className="px-4 py-3">
        <Badge variant={TYPE_BADGE[project.type]}>{project.type}</Badge>
      </td>
      <td className="px-4 py-3">
        <Badge variant={STATUS_BADGE[project.status]}>{project.status}</Badge>
      </td>
      <td className="px-4 py-3 text-right font-mono text-sm text-slate-300">
        {project.contract_value_usd > 0 ? `$${project.contract_value_usd.toLocaleString()}` : '—'}
      </td>
      <td className="px-4 py-3 font-mono text-[10px] text-slate-600 max-w-[200px] truncate" title={project.workspace_path ?? ''}>
        {project.workspace_path ?? '—'}
      </td>
      <td className="px-4 py-3 text-right font-mono text-[11px] text-slate-600">
        {format(new Date(project.created_at), 'MMM d, yyyy')}
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// ProjectsView
// ---------------------------------------------------------------------------

export function ProjectsView() {
  const { data: projects, loading, error } = useProjects()
  const { data: clients } = useClients()

  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<ProjectType | 'all'>('all')
  const [clientFilter, setClientFilter] = useState('')
  const [search, setSearch] = useState('')
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)

  // Deselect if project is filtered out
  const handleSelectProject = (p: Project) => {
    setSelectedProject((prev) => (prev?.id === p.id ? null : p))
  }

  const clientMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of clients) m.set(c.id, c.name)
    return m
  }, [clients])

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      if (typeFilter !== 'all' && p.type !== typeFilter) return false
      if (clientFilter && p.client_id !== clientFilter) return false
      if (search) {
        const q = search.toLowerCase()
        const clientName = clientMap.get(p.client_id) ?? ''
        if (
          !p.name.toLowerCase().includes(q) &&
          !p.slug.toLowerCase().includes(q) &&
          !clientName.toLowerCase().includes(q) &&
          !(p.repo_local_path ?? '').toLowerCase().includes(q) &&
          !(p.repo_url ?? '').toLowerCase().includes(q)
        ) return false
      }
      return true
    })
  }, [projects, statusFilter, typeFilter, clientFilter, search, clientMap])

  // KPI
  const activeProjects = projects.filter((p) => p.status === 'active').length
  const totalRevenue = projects.reduce((s, p) => s + (p.contract_value_usd ?? 0), 0)
  const deliveredProjects = projects.filter((p) => p.status === 'delivered' || p.status === 'invoiced').length

  if (error) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-rose-400 text-sm font-mono">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Total Projects"  value={projects.length}  color="violet"  />
        <Stat label="Active"          value={activeProjects}   color="emerald" />
        <Stat label="Delivered"       value={deliveredProjects} color="cyan"   />
        <Stat
          label="Total Value"
          value={totalRevenue > 0 ? `$${totalRevenue.toLocaleString()}` : '—'}
          color="amber"
        />
      </div>

      {/* Table */}
      <Panel title="Projects" accent="violet">
        <div className="space-y-3">
          <FilterBar
            clients={clients.map((c) => ({ id: c.id, name: c.name }))}
            statusFilter={statusFilter}
            typeFilter={typeFilter}
            clientFilter={clientFilter}
            search={search}
            onStatus={setStatusFilter}
            onType={setTypeFilter}
            onClient={setClientFilter}
            onSearch={setSearch}
          />

          {loading ? (
            <div className="flex items-center justify-center h-32">
              <span className="text-[11px] text-slate-600 font-mono animate-pulse">Loading projects…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-32">
              <span className="text-[11px] text-slate-600 font-mono">
                {projects.length === 0
                  ? 'No projects yet — use /new_project on Telegram'
                  : 'No results for current filter'}
              </span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06] text-left">
                    {[
                      { label: 'Project', align: '' },
                      { label: 'Client',  align: '' },
                      { label: 'Type',    align: '' },
                      { label: 'Status',  align: '' },
                      { label: 'Value',   align: 'text-right' },
                      { label: 'Workspace', align: '' },
                      { label: 'Created', align: 'text-right' },
                    ].map(({ label, align }) => (
                      <th
                        key={label}
                        className={clsx(
                          'px-4 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-slate-600',
                          align
                        )}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((project) => (
                    <Fragment key={project.id}>
                      <ProjectRow
                        project={project}
                        clientName={clientMap.get(project.client_id) ?? '—'}
                        selected={selectedProject?.id === project.id}
                        onSelect={handleSelectProject}
                      />
                      {selectedProject?.id === project.id && (
                        <tr>
                          <td colSpan={7} className="px-2 pt-0 pb-3">
                            <DeliverablesPanel project={project} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Panel>
    </div>
  )
}
