// ============================================================
// WAI Dashboard – Runs View
// Tabella filtrabile di tutti gli agent runs con metriche.
// ============================================================

import { useState, useMemo } from 'react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { Panel } from './ui/Panel.js'
import { Badge } from './ui/Badge.js'
import { Stat } from './ui/Stat.js'
import { useRecentRunsWithContext } from '../hooks/useSupabaseRealtime.js'
import { getClientColor } from '../lib/clientColors.js'
import type { AgentRunWithContext } from '../types/index.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRunMeta(run: AgentRunWithContext, key: string): string {
  const v = run.task?.metadata?.[key]
  return typeof v === 'string' && v.trim() ? v.trim() : ''
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

type OutcomeFilter = 'all' | 'success' | 'failure' | 'partial'

interface FilterBarProps {
  agents: string[]
  models: string[]
  clients: string[]
  agentFilter: string
  modelFilter: string
  outcomeFilter: OutcomeFilter
  clientFilter: string
  onAgent: (v: string) => void
  onModel: (v: string) => void
  onOutcome: (v: OutcomeFilter) => void
  onClient: (v: string) => void
}

function FilterBar({
  agents, models, clients,
  agentFilter, modelFilter, outcomeFilter, clientFilter,
  onAgent, onModel, onOutcome, onClient,
}: FilterBarProps) {
  const selectClass = clsx(
    'text-xs font-mono bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-1.5',
    'text-slate-300 focus:outline-none focus:border-[#00D4FF]/40 transition-colors'
  )

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-slate-600 uppercase tracking-wider font-medium mr-1">Filter:</span>

      <select value={agentFilter} onChange={(e) => onAgent(e.target.value)} className={selectClass}>
        <option value="">All agents</option>
        {agents.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>

      <select value={clientFilter} onChange={(e) => onClient(e.target.value)} className={selectClass}>
        <option value="">All clients</option>
        {clients.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>

      <select value={modelFilter} onChange={(e) => onModel(e.target.value)} className={selectClass}>
        <option value="">All models</option>
        {models.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>

      <select value={outcomeFilter} onChange={(e) => onOutcome(e.target.value as OutcomeFilter)} className={selectClass}>
        <option value="all">All outcomes</option>
        <option value="success">success</option>
        <option value="failure">failure</option>
        <option value="partial">partial</option>
      </select>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Run row
// ---------------------------------------------------------------------------

function RunRow({ run }: { run: AgentRunWithContext }) {
  const [expanded, setExpanded] = useState(false)
  const isGpt    = run.model_id.includes('gpt')
  const isFailed = run.outcome === 'failure'
  const hasError = isFailed && !!run.error_message

  const clientName  = getRunMeta(run, 'client_name')
  const projectName = getRunMeta(run, 'project_name')
  const clientColor = clientName ? getClientColor(clientName) : null

  return (
    <>
      <tr
        className={clsx(
          'border-b border-white/[0.04] transition-colors text-xs',
          hasError ? 'cursor-pointer hover:bg-red-500/[0.04]' : 'hover:bg-white/[0.02]'
        )}
        onClick={hasError ? () => setExpanded((v) => !v) : undefined}
      >
        {/* Timestamp */}
        <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap">
          {format(new Date(run.created_at), 'MM-dd HH:mm:ss')}
        </td>

        {/* Agent + client/project context */}
        <td className="py-2.5 px-4">
          <span className="font-mono text-slate-300 whitespace-nowrap">{run.agent_id}</span>
          {clientName && clientColor && (
            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
              <span
                className={clsx(
                  'text-[9px] font-mono px-1 py-0.5 rounded border truncate max-w-[90px]',
                  clientColor.bg, clientColor.border, clientColor.text
                )}
                title={clientName}
              >
                {clientName}
              </span>
              {projectName && (
                <span className="text-[9px] font-mono text-slate-600 truncate max-w-[80px]" title={projectName}>
                  {projectName}
                </span>
              )}
            </div>
          )}
        </td>

        {/* Model */}
        <td className="py-2.5 px-4 whitespace-nowrap">
          <span className={clsx(
            'font-mono font-semibold px-1.5 py-0.5 rounded text-[10px]',
            isGpt
              ? 'text-[#00D4FF] bg-[#00D4FF]/[0.07]'
              : 'text-violet-400 bg-violet-400/[0.07]'
          )}>
            {run.model_id}
          </span>
        </td>

        {/* Outcome */}
        <td className="py-2.5 px-4">
          <div className="flex items-center gap-1.5">
            <Badge variant={
              run.outcome === 'success' ? 'done'
              : run.outcome === 'partial' ? 'warning'
              : 'error'
            }>
              {run.outcome}
            </Badge>
            {hasError && (
              <span className="text-red-400/70 text-[10px]">
                {expanded ? '▲' : '▼'}
              </span>
            )}
          </div>
        </td>

        {/* Tokens in */}
        <td className="py-2.5 px-4 font-mono font-tabular text-slate-400 text-right whitespace-nowrap">
          {run.tokens_input.toLocaleString()}
        </td>

        {/* Tokens out */}
        <td className="py-2.5 px-4 font-mono font-tabular text-slate-400 text-right whitespace-nowrap">
          {run.tokens_output.toLocaleString()}
        </td>

        {/* Cost */}
        <td className="py-2.5 px-4 font-mono font-tabular text-white font-semibold text-right whitespace-nowrap">
          ${run.cost_usd.toFixed(4)}
        </td>

        {/* Duration */}
        <td className="py-2.5 px-4 font-mono font-tabular text-slate-500 text-right whitespace-nowrap">
          {run.duration_ms < 1000
            ? `${run.duration_ms}ms`
            : `${(run.duration_ms / 1000).toFixed(1)}s`}
        </td>
      </tr>

      {/* Error detail row */}
      {hasError && expanded && (
        <tr className="border-b border-red-500/10 bg-red-500/[0.03]">
          <td colSpan={8} className="px-4 py-2.5">
            <p className="text-[11px] font-mono text-red-400/90 whitespace-pre-wrap break-all">
              {run.error_message}
            </p>
          </td>
        </tr>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function RunsView() {
  const { data: runs, loading } = useRecentRunsWithContext(200)

  const [agentFilter,   setAgentFilter]   = useState('')
  const [modelFilter,   setModelFilter]   = useState('')
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('all')
  const [clientFilter,  setClientFilter]  = useState('')

  // Derived filter options
  const agents  = useMemo(() => [...new Set(runs.map((r) => r.agent_id))].sort(), [runs])
  const models  = useMemo(() => [...new Set(runs.map((r) => r.model_id))].sort(), [runs])
  const clients = useMemo(() => {
    const s = new Set<string>()
    for (const r of runs) {
      const c = getRunMeta(r, 'client_name')
      if (c) s.add(c)
    }
    return Array.from(s).sort()
  }, [runs])

  // Apply filters
  const filtered = useMemo(() => {
    return runs.filter((r) => {
      if (agentFilter   && r.agent_id   !== agentFilter)   return false
      if (modelFilter   && r.model_id   !== modelFilter)   return false
      if (outcomeFilter !== 'all' && r.outcome !== outcomeFilter) return false
      if (clientFilter  && getRunMeta(r, 'client_name') !== clientFilter) return false
      return true
    })
  }, [runs, agentFilter, modelFilter, outcomeFilter, clientFilter])

  // Toolbar totals
  const totalCost      = filtered.reduce((s, r) => s + (r.cost_usd ?? 0), 0)
  const totalTokensIn  = filtered.reduce((s, r) => s + r.tokens_input, 0)
  const totalTokensOut = filtered.reduce((s, r) => s + r.tokens_output, 0)
  const successCount   = filtered.filter((r) => r.outcome === 'success').length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-5 h-5 border-2 border-[#00D4FF]/30 border-t-[#00D4FF] rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="animate-fade-in space-y-5">

      {/* Stats toolbar */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat
          label="Filtered Runs"
          value={filtered.length}
          sub={`of ${runs.length} total`}
          color="sky"
        />
        <Stat
          label="Total Cost"
          value={`$${totalCost.toFixed(4)}`}
          sub="filtered selection"
          color="cyan"
        />
        <Stat
          label="Tokens In"
          value={`${(totalTokensIn / 1000).toFixed(1)}k`}
          sub={`${(totalTokensOut / 1000).toFixed(1)}k out`}
          color="default"
        />
        <Stat
          label="Success Rate"
          value={filtered.length > 0 ? `${Math.round((successCount / filtered.length) * 100)}%` : '—'}
          sub={`${filtered.filter((r) => r.outcome === 'failure').length} failures`}
          color={filtered.length > 0 && successCount / filtered.length < 0.9 ? 'amber' : 'emerald'}
        />
      </div>

      {/* Filter bar + table */}
      <Panel
        title="Agent Runs"
        headerRight={
          <FilterBar
            agents={agents}
            models={models}
            clients={clients}
            agentFilter={agentFilter}
            modelFilter={modelFilter}
            outcomeFilter={outcomeFilter}
            clientFilter={clientFilter}
            onAgent={setAgentFilter}
            onModel={setModelFilter}
            onOutcome={setOutcomeFilter}
            onClient={setClientFilter}
          />
        }
        noPad
      >
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-600 text-center py-10">
            {runs.length === 0 ? 'No runs recorded yet' : 'No runs match the current filters'}
          </p>
        ) : (
          <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
            <table className="w-full min-w-[720px]">
              <thead className="sticky top-0 bg-[#07101F] z-10">
                <tr className="text-[10px] uppercase tracking-wider text-slate-600 border-b border-white/[0.06]">
                  <th className="py-2.5 px-4 text-left font-medium">Timestamp</th>
                  <th className="py-2.5 px-4 text-left font-medium">Agent / Client</th>
                  <th className="py-2.5 px-4 text-left font-medium">Model</th>
                  <th className="py-2.5 px-4 text-left font-medium">Outcome</th>
                  <th className="py-2.5 px-4 text-right font-medium">Tokens In</th>
                  <th className="py-2.5 px-4 text-right font-medium">Tokens Out</th>
                  <th className="py-2.5 px-4 text-right font-medium">Cost</th>
                  <th className="py-2.5 px-4 text-right font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((run) => (
                  <RunRow key={run.id} run={run} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
