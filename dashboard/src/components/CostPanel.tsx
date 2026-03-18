// ============================================================
// WAI Dashboard – Resource Burn Terminal (T074)
// High-tech cost tracking with Odometer and Model diagnostics.
// ============================================================

import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { Panel } from './ui/Panel.js'
import { Stat } from './ui/Stat.js'
import { Badge } from './ui/Badge.js'
import { Odometer } from './ui/Odometer.js'
import { Icon } from './ui/Icon.js'
import { useProjectState, useRecentRuns } from '../hooks/useSupabaseRealtime.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COST_INFO = {
  session: "Total API infrastructure costs accrued during the current active monitoring session.",
  quota: "Accumulated monthly expenditure compared against the predefined operational budget.",
  efficiency: "The ratio of successful agent executions vs total attempts in the last 50 cycles.",
  tokens: "Total neural data volume (Input + Output) processed by the system models."
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function InfoTooltip({ text }: { text: string }) {
  return (
    <div className="group relative inline-block ml-2">
      <Icon name="info" size={10} className="text-slate-600 hover:text-cyan-400 cursor-help transition-colors" />
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 rounded-lg bg-[#0A1628] border border-white/10 shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[150] pointer-events-none">
        <p className="text-[8px] leading-relaxed text-slate-400 font-black uppercase tracking-widest">{text}</p>
        <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-[#0A1628] border-r border-b border-white/10 rotate-45 -mt-1" />
      </div>
    </div>
  )
}

function DiagnosticBar({ label, value, max, colorClass }: { label: string; value: number; max: number; colorClass: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{label}</span>
        <span className="text-[10px] font-mono font-bold text-white">${value.toFixed(4)}</span>
      </div>
      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden flex p-0.5">
        <div 
          className={clsx("h-full rounded-full transition-all duration-1000 shadow-[0_0_8px_currentColor]", colorClass)} 
          style={{ width: `${pct}%` }} 
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function CostPanel() {
  const { state, loading: sLoad } = useProjectState()
  const { data: runs, loading: rLoad } = useRecentRuns(100)

  // Derived metrics
  const stats = useMemo(() => {
    const totalCost = runs.reduce((s, r) => s + (r.cost_usd ?? 0), 0)
    const successRate = runs.length > 0 ? Math.round((runs.filter(r => r.outcome === 'success').length / runs.length) * 100) : 100
    const totalTokens = runs.reduce((s, r) => s + r.tokens_input + r.tokens_output, 0)
    
    const costByModel = runs.reduce<Record<string, number>>((acc, r) => {
      acc[r.model_id] = (acc[r.model_id] ?? 0) + (r.cost_usd ?? 0)
      return acc
    }, {})

    const costByAgent = runs.reduce<Record<string, number>>((acc, r) => {
      acc[r.agent_id] = (acc[r.agent_id] ?? 0) + (r.cost_usd ?? 0)
      return acc
    }, {})

    // Model efficiency (cost per run)
    const modelMetrics = Object.keys(costByModel).map(id => {
      const modelRuns = runs.filter(r => r.model_id === id)
      const avgCost = costByModel[id] / (modelRuns.length || 1)
      return { id, avgCost, count: modelRuns.length }
    })

    return { totalCost, successRate, totalTokens, costByModel, costByAgent, modelMetrics }
  }, [runs])

  const maxModelCost = Math.max(...Object.values(stats.costByModel), 0.0001)

  if (sLoad || rLoad) return (
    <div className="flex flex-col items-center justify-center h-64 gap-4 animate-pulse">
      <div className="w-10 h-10 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin" />
      <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em]">Synching Resource Matrix...</p>
    </div>
  )

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      
      {/* ── Burn Terminal Header ── */}
      <div className="bg-[#070C1A] border border-white/10 rounded-3xl p-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-[0.03] pointer-events-none" />
        
        <div className="relative z-10 flex flex-col md:flex-row items-center gap-12">
          <div className="flex items-center gap-6 border-r border-white/5 pr-12">
            <div className="w-16 h-16 rounded-2xl bg-cyan-500/5 border-2 border-cyan-500/20 flex items-center justify-center text-cyan-400 shadow-[0_0_30px_rgba(6,182,212,0.15)]">
              <Icon name="costs" size={32} />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white uppercase tracking-tighter italic leading-none">Resource Burn</h1>
              <p className="text-[11px] text-slate-500 font-mono tracking-[0.2em] mt-2 uppercase italic">Neural Infrastructure usage</p>
            </div>
          </div>

          <div className="flex-1 grid grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="space-y-1">
              <div className="flex items-center">
                <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Session Burn</span>
                <InfoTooltip text={COST_INFO.session} />
              </div>
              <p className="text-2xl font-mono font-black text-white tracking-tighter italic">
                <Odometer value={stats.totalCost} prefix="$" decimals={4} />
              </p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center">
                <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Monthly Quota</span>
                <InfoTooltip text={COST_INFO.quota} />
              </div>
              <p className="text-2xl font-mono font-black text-cyan-400 tracking-tighter italic">
                <Odometer value={state?.monthly_cost_usd || 0} prefix="$" decimals={2} />
              </p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center">
                <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Efficiency</span>
                <InfoTooltip text={COST_INFO.efficiency} />
              </div>
              <p className="text-2xl font-mono font-black text-emerald-400 tracking-tighter italic">{stats.successRate}%</p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center">
                <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Throughput</span>
                <InfoTooltip text={COST_INFO.tokens} />
              </div>
              <p className="text-2xl font-mono font-black text-violet-400 tracking-tighter italic">
                {Math.round(stats.totalTokens / 1000)}<span className="text-sm ml-1 text-slate-600">K</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Model Allocation */}
        <div className="lg:col-span-2 bg-[#070C1A] border border-white/5 rounded-3xl p-6 space-y-8 shadow-xl relative overflow-hidden group">
          <div className="absolute inset-0 bg-scanline opacity-[0.01] pointer-events-none" />
          <div className="flex items-center justify-between border-b border-white/5 pb-4">
            <h3 className="text-[11px] font-black text-white uppercase tracking-[0.3em]">Model Efficiency Matrix</h3>
            <span className="text-[9px] font-mono text-slate-600 uppercase">Avg Cost / Exec</span>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6">
              {Object.entries(stats.costByModel).sort(([, a], [, b]) => b - a).map(([id, cost]) => (
                <DiagnosticBar 
                  key={id} label={id} value={cost} max={maxModelCost} 
                  colorClass={id.includes('gpt') ? 'bg-[#00D4FF] text-[#00D4FF]' : 'bg-violet-500 text-violet-500'} 
                />
              ))}
            </div>
            <div className="flex flex-col justify-center gap-4 border-l border-white/5 pl-8">
               {stats.modelMetrics.map(m => (
                 <div key={m.id} className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-slate-500">{m.id.split('-').slice(0,2).join('-').toUpperCase()}</span>
                    <span className="text-[11px] font-mono font-bold text-white">${m.avgCost.toFixed(5)} <span className="text-[9px] text-slate-700 ml-1">/run</span></span>
                 </div>
               ))}
            </div>
          </div>
        </div>

        {/* High-Burn Nodes */}
        <div className="bg-[#070C1A] border border-white/5 rounded-3xl p-6 flex flex-col shadow-xl relative overflow-hidden">
          <div className="absolute inset-0 bg-grid opacity-[0.02] pointer-events-none" />
          <h3 className="text-[11px] font-black text-white uppercase tracking-[0.3em] border-b border-white/5 pb-4 text-center">Top Cost Center Nodes</h3>
          <div className="flex-1 overflow-y-auto custom-scrollbar mt-4">
            <div className="space-y-1">
              {Object.entries(stats.costByAgent).sort(([, a], [, b]) => b - a).slice(0, 10).map(([id, cost]) => (
                <div key={id} className="flex items-center justify-between p-3 rounded-xl hover:bg-white/[0.02] transition-colors border border-transparent hover:border-white/5 group">
                  <div className="flex items-center gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-500/40 group-hover:bg-cyan-400 transition-colors" />
                    <span className="text-[11px] font-black text-slate-400 group-hover:text-white uppercase tracking-tight transition-colors">{id}</span>
                  </div>
                  <span className="text-[11px] font-mono font-bold text-white">${cost.toFixed(4)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Execution Ledger */}
      <div className="bg-[#070C1A] border border-white/5 rounded-3xl overflow-hidden shadow-2xl">
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/[0.01]">
          <h3 className="text-[11px] font-black text-white uppercase tracking-[0.3em]">Resource Consumption Ledger</h3>
          <div className="flex items-center gap-4">
            <span className="text-[10px] font-mono text-slate-600 uppercase font-bold tracking-tighter italic">Live Audit Mode</span>
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_5px_#10b981]" />
          </div>
        </div>
        <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/[0.02] border-b border-white/5 sticky top-0 z-10 backdrop-blur-md">
                <th className="py-3 px-6 text-[9px] font-black text-slate-600 uppercase tracking-widest">Timestamp</th>
                <th className="py-3 px-6 text-[9px] font-black text-slate-600 uppercase tracking-widest">Node Identity</th>
                <th className="py-3 px-6 text-[9px] font-black text-slate-600 uppercase tracking-widest">Architecture</th>
                <th className="py-3 px-6 text-[9px] font-black text-slate-600 uppercase tracking-widest">Outcome</th>
                <th className="py-3 px-6 text-[9px] font-black text-slate-600 uppercase tracking-widest text-right">Burn Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.02]">
              {runs.map((r) => (
                <tr key={r.id} className="group hover:bg-cyan-500/[0.03] transition-colors">
                  <td className="py-3 px-6">
                    <span className="text-[10px] font-mono text-slate-500 group-hover:text-slate-300 transition-colors">
                      {format(new Date(r.created_at), 'dd MMM HH:mm:ss')}
                    </span>
                  </td>
                  <td className="py-3 px-6 text-[11px] font-black text-slate-300 uppercase truncate max-w-[120px] group-hover:text-white">{r.agent_id}</td>
                  <td className="py-3 px-6">
                    <span className={clsx(
                      "text-[9px] font-black px-1.5 py-0.5 rounded border uppercase",
                      r.model_id.includes('gpt') ? 'text-[#00D4FF] border-[#00D4FF]/20 bg-[#00D4FF]/5' : 'text-violet-400 border-violet-400/20 bg-violet-400/5'
                    )}>
                      {r.model_id}
                    </span>
                  </td>
                  <td className="py-3 px-6">
                    <Badge variant={r.outcome === 'success' ? 'done' : r.outcome === 'partial' ? 'warning' : 'error'}>
                      {r.outcome.toUpperCase()}
                    </Badge>
                  </td>
                  <td className="py-3 px-6 text-right font-mono text-[11px] font-bold text-white group-hover:text-cyan-400 transition-colors">${r.cost_usd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
