// ============================================================
// WAI Dashboard – Revenue View
// Progetti fatturati: totale ricavi, medie, filtro per tipo.
// ============================================================

import { useState, useMemo } from 'react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { Panel } from './ui/Panel.js'
import { Badge } from './ui/Badge.js'
import { Stat } from './ui/Stat.js'
import { useClients, useInvoicedProjects } from '../hooks/useSupabaseRealtime.js'
import type { Project, ProjectType } from '../types/index.js'

// ---------------------------------------------------------------------------
// Type filter
// ---------------------------------------------------------------------------

const ALL_TYPES: (ProjectType | 'all')[] = [
  'all',
  'website', 'app', 'saas', 'consulting', 'ai',
  'marketing', 'content', 'copywriting', 'design', 'automation', 'other',
]

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

// ---------------------------------------------------------------------------
// RevenueView
// ---------------------------------------------------------------------------

export function RevenueView() {
  const { data: projects, loading, error } = useInvoicedProjects()
  const { data: clients } = useClients()
  const [typeFilter, setTypeFilter] = useState<ProjectType | 'all'>('all')

  // Build client map for name lookup
  const clientMap = useMemo(
    () => new Map(clients.map((c) => [c.id, c.name])),
    [clients]
  )

  // Apply type filter
  const filtered = useMemo(() => {
    if (typeFilter === 'all') return projects
    return projects.filter((p) => p.type === typeFilter)
  }, [projects, typeFilter])

  // Stats
  const totalRevenue = useMemo(
    () => filtered.reduce((sum, p) => sum + (p.contract_value_usd ?? 0), 0),
    [filtered]
  )
  const avgRevenue = filtered.length > 0 ? totalRevenue / filtered.length : 0

  // Select style
  const selectClass = clsx(
    'text-xs font-mono bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-1.5',
    'text-slate-300 focus:outline-none focus:border-emerald-400/40 transition-colors'
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-white">Revenue</h2>
          <p className="text-[11px] text-slate-600 mt-0.5">Progetti fatturati — dati real-time</p>
        </div>
        {/* Type filter */}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as ProjectType | 'all')}
          className={selectClass}
        >
          {ALL_TYPES.map((t) => (
            <option key={t} value={t}>
              {t === 'all' ? 'All types' : t}
            </option>
          ))}
        </select>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat
          label="Totale Ricavi"
          value={`$${totalRevenue.toFixed(2)}`}
          color="emerald"
        />
        <Stat
          label="Progetti Fatturati"
          value={String(filtered.length)}
          color="cyan"
        />
        <Stat
          label="Ricavo Medio"
          value={filtered.length > 0 ? `$${avgRevenue.toFixed(2)}` : '—'}
          color="violet"
        />
      </div>

      {/* Table */}
      <Panel title="Progetti Fatturati" accent="emerald">
        {loading && (
          <p className="text-[11px] text-slate-600 font-mono animate-pulse py-4">Caricamento...</p>
        )}

        {error && (
          <p className="text-[11px] text-rose-400 font-mono py-4">Errore: {error}</p>
        )}

        {!loading && !error && filtered.length === 0 && (
          <p className="text-[11px] text-slate-600 font-mono py-6 text-center">
            Nessun progetto fatturato
            {typeFilter !== 'all' ? ` di tipo "${typeFilter}"` : ''}.
            <br />
            Usa <span className="text-slate-400">/invoice client/project amount</span> per registrare un ricavo.
          </p>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[600px]">
              <thead>
                <tr className="border-b border-white/[0.06] text-left">
                  <th className="pb-3 text-[10px] uppercase tracking-wider font-semibold text-slate-600 pr-4">
                    Cliente
                  </th>
                  <th className="pb-3 text-[10px] uppercase tracking-wider font-semibold text-slate-600 pr-4">
                    Progetto
                  </th>
                  <th className="pb-3 text-[10px] uppercase tracking-wider font-semibold text-slate-600 pr-4">
                    Tipo
                  </th>
                  <th className="pb-3 text-[10px] uppercase tracking-wider font-semibold text-slate-600 pr-4 text-right">
                    Valore (USD)
                  </th>
                  <th className="pb-3 text-[10px] uppercase tracking-wider font-semibold text-slate-600 text-right">
                    Data
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((project: Project) => (
                  <RevenueRow
                    key={project.id}
                    project={project}
                    clientName={clientMap.get(project.client_id) ?? '—'}
                  />
                ))}
              </tbody>
              {/* Footer totals */}
              <tfoot>
                <tr className="border-t border-white/[0.08]">
                  <td colSpan={3} className="pt-3 text-[10px] text-slate-600 font-semibold uppercase tracking-wider">
                    Totale ({filtered.length})
                  </td>
                  <td className="pt-3 text-right font-bold text-emerald-400 font-mono tabular-nums">
                    ${totalRevenue.toFixed(2)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

interface RevenueRowProps {
  project: Project
  clientName: string
}

function RevenueRow({ project, clientName }: RevenueRowProps) {
  const isHighValue = project.contract_value_usd >= 5000

  return (
    <tr className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
      {/* Client */}
      <td className="py-3 pr-4">
        <span className="text-slate-300 font-medium">{clientName}</span>
      </td>

      {/* Project */}
      <td className="py-3 pr-4">
        <span className="text-white font-medium">{project.name}</span>
      </td>

      {/* Type */}
      <td className="py-3 pr-4">
        <Badge variant={TYPE_BADGE[project.type] ?? 'default'}>
          {project.type}
        </Badge>
      </td>

      {/* Value */}
      <td className="py-3 pr-4 text-right">
        <span
          className={clsx(
            'font-bold font-mono tabular-nums',
            isHighValue ? 'text-emerald-400' : 'text-slate-200'
          )}
        >
          ${project.contract_value_usd.toFixed(2)}
        </span>
      </td>

      {/* Date */}
      <td className="py-3 text-right">
        <span className="text-slate-600 font-mono text-[10px]">
          {format(new Date(project.created_at), 'MMM d, yyyy')}
        </span>
      </td>
    </tr>
  )
}
