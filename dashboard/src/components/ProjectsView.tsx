// ============================================================
// WAI Dashboard – Projects View
// Lista progetti filtrabili per client / status / tipo.
// ============================================================

import { useState, useMemo, useEffect } from 'react'
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
  return '📝'
}

interface DeliverablesPanelProps {
  project: Project
}

function DeliverablesPanel({ project }: DeliverablesPanelProps) {
  const { files, loading, error } = useDeliverables(project.workspace_path)

  return (
    <div className="mt-3 border border-white/[0.06] rounded-lg bg-white/[0.02] p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-violet-400">
          Deliverables — {project.name}
        </span>
        <span className="text-[10px] text-slate-600 font-mono">{project.workspace_path ?? '—'}</span>
      </div>

      {loading && (
        <p className="text-[11px] text-slate-600 font-mono animate-pulse">Loading…</p>
      )}
      {error && (
        <p className="text-[11px] text-rose-400 font-mono">Error: {error}</p>
      )}
      {!loading && !error && files.length === 0 && (
        <p className="text-[11px] text-slate-600 font-mono">
          No deliverables yet — run a consulting task to generate files.
        </p>
      )}
      {!loading && files.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/[0.04] text-left">
              <th className="pb-2 text-[10px] uppercase tracking-wider font-semibold text-slate-600">File</th>
              <th className="pb-2 text-[10px] uppercase tracking-wider font-semibold text-slate-600 text-right">Size</th>
              <th className="pb-2 text-[10px] uppercase tracking-wider font-semibold text-slate-600 text-right">Modified</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.name} className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors">
                <td className="py-2 text-slate-300 font-mono">
                  {fileIcon(f.name)} {f.name}
                </td>
                <td className="py-2 text-right text-slate-600 font-mono text-[10px]">
                  {f.size_bytes < 1024 ? `${f.size_bytes}B` : `${(f.size_bytes / 1024).toFixed(1)}KB`}
                </td>
                <td className="py-2 text-right text-slate-600 font-mono text-[10px]">
                  {format(new Date(f.modified_at), 'MMM d, HH:mm')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
  delivered: 'info',
  invoiced:  'finance',
}

const TYPE_BADGE: Record<ProjectType, string> = {
  website:    'dev',
  app:        'dev_complex',
  consulting: 'consulting',
  marketing:  'marketing',
  other:      'default',
}

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
        {(['discovery','active','paused','review','delivered','invoiced'] as ProjectStatus[]).map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      <select value={typeFilter} onChange={(e) => onType(e.target.value as ProjectType | AnyFilter)} className={selectClass}>
        <option value="all">All types</option>
        {(['website','app','consulting','marketing','other'] as ProjectType[]).map((t) => (
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
          !clientName.toLowerCase().includes(q)
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
                    <ProjectRow
                      key={project.id}
                      project={project}
                      clientName={clientMap.get(project.client_id) ?? '—'}
                      selected={selectedProject?.id === project.id}
                      onSelect={handleSelectProject}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selectedProject && (
            <DeliverablesPanel project={selectedProject} />
          )}
        </div>
      </Panel>
    </div>
  )
}
