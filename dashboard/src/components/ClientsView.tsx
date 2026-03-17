// ============================================================
// WAI Dashboard – Clients View
// Lista clienti con status, count progetti e contract value.
// ============================================================

import { useState, useMemo } from 'react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { Panel } from './ui/Panel.js'
import { Badge } from './ui/Badge.js'
import { Stat } from './ui/Stat.js'
import { useClients, useProjects } from '../hooks/useSupabaseRealtime.js'
import type { Client, ClientStatus } from '../types/index.js'

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

// Maps ClientStatus → Badge variant (must exist in Badge.tsx VARIANT_STYLES)
const STATUS_BADGE: Record<ClientStatus, string> = {
  active:    'done',
  prospect:  'todo',
  completed: 'info',
  archived:  'cancelled',
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

type StatusFilter = 'all' | ClientStatus

interface FilterBarProps {
  statusFilter: StatusFilter
  onStatus: (v: StatusFilter) => void
  search: string
  onSearch: (v: string) => void
}

function FilterBar({ statusFilter, onStatus, search, onSearch }: FilterBarProps) {
  const selectClass = clsx(
    'text-xs font-mono bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-1.5',
    'text-slate-300 focus:outline-none focus:border-[#00D4FF]/40 transition-colors'
  )
  const inputClass = clsx(
    'text-xs font-mono bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-1.5',
    'text-slate-300 placeholder-slate-600 focus:outline-none focus:border-[#00D4FF]/40 transition-colors w-44'
  )

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-slate-600 uppercase tracking-wider font-medium mr-1">Filter:</span>

      <input
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search name / slug…"
        className={inputClass}
      />

      <select value={statusFilter} onChange={(e) => onStatus(e.target.value as StatusFilter)} className={selectClass}>
        <option value="all">All statuses</option>
        <option value="prospect">prospect</option>
        <option value="active">active</option>
        <option value="completed">completed</option>
        <option value="archived">archived</option>
      </select>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Client row
// ---------------------------------------------------------------------------

interface ClientRowProps {
  client: Client
  projectCount: number
  totalContractValue: number
}

function ClientRow({ client, projectCount, totalContractValue }: ClientRowProps) {
  return (
    <tr className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors group">
      <td className="px-4 py-3 font-medium text-white text-sm">
        {client.name}
      </td>
      <td className="px-4 py-3 font-mono text-[11px] text-slate-500">
        {client.slug}
      </td>
      <td className="px-4 py-3">
        <Badge variant={STATUS_BADGE[client.status]}>{client.status}</Badge>
      </td>
      <td className="px-4 py-3 text-center">
        <span className="text-sm font-mono text-slate-300">{projectCount}</span>
      </td>
      <td className="px-4 py-3 text-right font-mono text-sm text-slate-300">
        {totalContractValue > 0 ? `$${totalContractValue.toLocaleString()}` : '—'}
      </td>
      <td className="px-4 py-3 text-right font-mono text-[11px] text-slate-600">
        {format(new Date(client.created_at), 'MMM d, yyyy')}
      </td>
      <td className="px-4 py-3 text-right">
        {client.email ? (
          <span className="text-[11px] text-slate-500 font-mono">{client.email}</span>
        ) : (
          <span className="text-[11px] text-slate-700">—</span>
        )}
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// ClientsView
// ---------------------------------------------------------------------------

export function ClientsView() {
  const { data: clients, loading: clientsLoading, error: clientsError } = useClients()
  const { data: projects } = useProjects()

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')

  // Build per-client stats from projects
  const clientStats = useMemo(() => {
    const map = new Map<string, { count: number; value: number }>()
    for (const p of projects) {
      const existing = map.get(p.client_id) ?? { count: 0, value: 0 }
      map.set(p.client_id, {
        count: existing.count + 1,
        value: existing.value + (p.contract_value_usd ?? 0),
      })
    }
    return map
  }, [projects])

  const filtered = useMemo(() => {
    return clients.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!c.name.toLowerCase().includes(q) && !c.slug.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [clients, statusFilter, search])

  // KPI stats
  const totalClients = clients.length
  const activeClients = clients.filter((c) => c.status === 'active').length
  const totalRevenue = projects.reduce((s, p) => s + (p.contract_value_usd ?? 0), 0)
  const totalProjects = projects.length

  if (clientsError) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-rose-400 text-sm font-mono">{clientsError}</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Total Clients"   value={totalClients}  color="cyan"    />
        <Stat label="Active"          value={activeClients} color="emerald" />
        <Stat label="Total Projects"  value={totalProjects} color="violet"  />
        <Stat
          label="Pipeline Value"
          value={totalRevenue > 0 ? `$${totalRevenue.toLocaleString()}` : '—'}
          color="amber"
        />
      </div>

      {/* Table */}
      <Panel title="Clients" accent="cyan">
        <div className="space-y-3">
          <FilterBar
            statusFilter={statusFilter}
            onStatus={setStatusFilter}
            search={search}
            onSearch={setSearch}
          />

          {clientsLoading ? (
            <div className="flex items-center justify-center h-32">
              <span className="text-[11px] text-slate-600 font-mono animate-pulse">Loading clients…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-32">
              <span className="text-[11px] text-slate-600 font-mono">
                {clients.length === 0 ? 'No clients yet — use /new_client on Telegram' : 'No results for current filter'}
              </span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06] text-left">
                    {['Name', 'Slug', 'Status', 'Projects', 'Value', 'Created', 'Email'].map((h) => (
                      <th
                        key={h}
                        className={clsx(
                          'px-4 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-slate-600',
                          h === 'Value' && 'text-right',
                          h === 'Created' && 'text-right',
                          h === 'Email' && 'text-right',
                          h === 'Projects' && 'text-center',
                        )}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((client) => {
                    const stats = clientStats.get(client.id) ?? { count: 0, value: 0 }
                    return (
                      <ClientRow
                        key={client.id}
                        client={client}
                        projectCount={stats.count}
                        totalContractValue={stats.value}
                      />
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Panel>
    </div>
  )
}
