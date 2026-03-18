// ============================================================
// WAI Dashboard – Runs View (T067)
// Advanced Agent Run History with Pagination and Detail Sidebar
// ============================================================

import { useState, useMemo } from 'react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { Panel } from './ui/Panel.js'
import { Badge } from './ui/Badge.js'
import { Stat } from './ui/Stat.js'
import { Pagination } from './ui/Pagination.js'
import { DetailSidebar } from './ui/DetailSidebar.js'
import { useRecentRunsWithContext } from '../hooks/useSupabaseRealtime.js'
import { getClientColor } from '../lib/clientColors.js'
import type { AgentRunWithContext } from '../types/index.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 12

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRunMeta(run: AgentRunWithContext, key: string): string {
  const v = run.task?.metadata?.[key]
  return typeof v === 'string' && v.trim() ? v.trim() : ''
}

// ---------------------------------------------------------------------------
// Run Row (Table)
// ---------------------------------------------------------------------------

function RunRow({ run, onSelect }: { run: AgentRunWithContext; onSelect: (r: AgentRunWithContext) => void }) {
  const isGpt    = run.model_id.includes('gpt')
  const clientName  = getRunMeta(run, 'client_name')
  const projectName = getRunMeta(run, 'project_name')
  const clientColor = clientName ? getClientColor(clientName) : null

  return (
    <tr
      onClick={() => onSelect(run)}
      className="group border-b border-white/[0.04] transition-all hover:bg-[#00D4FF]/[0.03] cursor-pointer"
    >
      {/* Timestamp */}
      <td className="py-3 px-4">
        <p className="text-[11px] font-mono text-slate-500 group-hover:text-slate-300 transition-colors">
          {format(new Date(run.created_at), 'MM-dd HH:mm:ss')}
        </p>
      </td>

      {/* Agent & Context */}
      <td className="py-3 px-4">
        <div className="flex flex-col">
          <span className="text-[12px] font-black text-white uppercase tracking-tight">{run.agent_id}</span>
          {clientName && clientColor && (
            <div className="flex items-center gap-1.5 mt-1">
              <span className={clsx('text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider', clientColor.bg, clientColor.text, clientColor.border, 'border')}>
                {clientName}
              </span>
              {projectName && <span className="text-[8px] text-slate-600 font-mono font-bold">/ {projectName}</span>}
            </div>
          )}
        </div>
      </td>

      {/* Summary Preview */}
      <td className="py-3 px-4 max-w-[300px]">
        <p className="text-[11px] text-slate-400 font-medium line-clamp-1 group-hover:text-slate-200 transition-colors italic">
          {run.output_summary || run.input_summary || '—'}
        </p>
      </td>

      {/* Model */}
      <td className="py-3 px-4">
        <span className={clsx(
          'font-mono font-black px-2 py-0.5 rounded text-[9px] border',
          isGpt ? 'text-[#00D4FF] bg-[#00D4FF]/5 border-[#00D4FF]/20' : 'text-violet-400 bg-violet-400/5 border-violet-400/20'
        )}>
          {run.model_id.toUpperCase()}
        </span>
      </td>

      {/* Outcome */}
      <td className="py-3 px-4">
        <Badge variant={run.outcome === 'success' ? 'done' : run.outcome === 'partial' ? 'warning' : 'error'}>
          {run.outcome}
        </Badge>
      </td>

      {/* Stats */}
      <td className="py-3 px-4 text-right">
        <p className="text-[10px] font-mono font-bold text-slate-400">${run.cost_usd.toFixed(4)}</p>
        <p className="text-[9px] text-slate-600 font-mono">{(run.tokens_input + run.tokens_output).toLocaleString()} tokens</p>
      </td>

      {/* Action */}
      <td className="py-3 px-4 text-right opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-[#00D4FF] text-lg">→</span>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function RunsView() {
  const { data: runs, loading } = useRecentRunsWithContext(200)
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedRun, setSelectedRun] = useState<AgentRunWithContext | null>(null)
  
  // Filters state
  const [agentFilter, setAgentFilter] = useState('')
  const [outcomeFilter, setOutcomeFilter] = useState('all')

  const filteredRuns = useMemo(() => {
    return runs.filter(r => {
      if (agentFilter && r.agent_id !== agentFilter) return false
      if (outcomeFilter !== 'all' && r.outcome !== outcomeFilter) return false
      return true
    })
  }, [runs, agentFilter, outcomeFilter])

  const paginatedRuns = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filteredRuns.slice(start, start + PAGE_SIZE)
  }, [filteredRuns, currentPage])

  // Derived filter options
  const agents = useMemo(() => [...new Set(runs.map(r => r.agent_id))].sort(), [runs])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-[#00D4FF]/20 border-t-[#00D4FF] rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="animate-fade-in space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat label="Selection Total" value={filteredRuns.length} sub="Matching filters" color="sky" />
        <Stat 
          label="Total Cost" 
          value={`$${filteredRuns.reduce((s, r) => s + (r.cost_usd ?? 0), 0).toFixed(4)}`} 
          sub="Filtered usage" 
          color="cyan" 
        />
        <Stat 
          label="Efficiency" 
          value={filteredRuns.length > 0 ? `${Math.round((filteredRuns.filter(r => r.outcome === 'success').length / filteredRuns.length) * 100)}%` : '—'} 
          sub="Success rate" 
          color="emerald" 
        />
        <Stat 
          label="Avg Duration" 
          value={filteredRuns.length > 0 ? `${Math.round(filteredRuns.reduce((s, r) => s + r.duration_ms, 0) / filteredRuns.length)}ms` : '—'} 
          sub="Per execution" 
          color="default" 
        />
      </div>

      {/* Filter Bar */}
      <div className="bg-white/[0.02] border border-white/[0.05] p-4 rounded-2xl flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-6">
          <div className="flex flex-col gap-1">
            <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Filter Node</span>
            <select 
              value={agentFilter} 
              onChange={(e) => { setAgentFilter(e.target.value); setCurrentPage(1); }}
              className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-[11px] font-bold text-slate-300 focus:outline-none focus:border-[#00D4FF]/40"
            >
              <option value="">All Agents</option>
              {agents.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Filter Outcome</span>
            <div className="flex bg-black/40 rounded-lg p-1 border border-white/5">
              {['all', 'success', 'failure', 'partial'].map((o) => (
                <button
                  key={o}
                  onClick={() => { setOutcomeFilter(o); setCurrentPage(1); }}
                  className={clsx(
                    "px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all",
                    outcomeFilter === o ? "bg-[#00D4FF] text-black shadow-[0_0_15px_rgba(0,212,255,0.3)]" : "text-slate-500 hover:text-slate-300"
                  )}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="text-[10px] text-slate-500 font-mono font-bold uppercase tracking-widest italic">
          Audit Log Active
        </p>
      </div>

      {/* Table */}
      <Panel noPad className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/[0.02] border-b border-white/[0.05]">
                <th className="py-3 px-4 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Timestamp</th>
                <th className="py-3 px-4 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Execution Node</th>
                <th className="py-3 px-4 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Summary</th>
                <th className="py-3 px-4 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Model</th>
                <th className="py-3 px-4 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Status</th>
                <th className="py-3 px-4 text-right text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Usage</th>
                <th className="py-3 px-4 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.02]">
              {paginatedRuns.map((run) => (
                <RunRow key={run.id} run={run} onSelect={setSelectedRun} />
              ))}
            </tbody>
          </table>
        </div>
        
        {paginatedRuns.length === 0 && (
          <div className="py-20 text-center">
            <p className="text-slate-600 font-black uppercase tracking-widest italic text-sm">No execution logs found</p>
          </div>
        )}

        <Pagination 
          currentPage={currentPage}
          totalItems={filteredRuns.length}
          pageSize={PAGE_SIZE}
          onPageChange={setCurrentPage}
        />
      </Panel>

      {/* Detail Sidebar */}
      {selectedRun && (
        <DetailSidebar
          title="Agent Execution Detail"
          subtitle={`${selectedRun.agent_id} • ${selectedRun.outcome}`}
          data={selectedRun}
          taskId={selectedRun.task_id}
          onClose={() => setSelectedRun(null)}
        />
      )}
    </div>
  )
}
