// ============================================================
// WAI Dashboard – Revenue Terminal (T073)
// Live Cash-Flow Terminal with Bloomberg/Cyberpunk aesthetic.
// ============================================================

import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay } from 'date-fns'
import { Panel } from './ui/Panel.js'
import { Badge } from './ui/Badge.js'
import { Odometer } from './ui/Odometer.js'
import { Icon } from './ui/Icon.js'
import { useClients, useInvoicedProjects, usePayments } from '../hooks/useSupabaseRealtime.js'
import type { Payment, Project, ProjectType } from '../types/index.js'

// ---------------------------------------------------------------------------
// Constants & Styles
// ---------------------------------------------------------------------------

const ALL_TYPES: (ProjectType | 'all')[] = [
  'all', 'website', 'app', 'saas', 'consulting', 'ai', 'marketing', 'content', 'copywriting', 'design', 'automation', 'other',
]

const TYPE_BADGE: Record<ProjectType, string> = {
  website: 'dev', app: 'dev_complex', saas: 'dev_complex', consulting: 'consulting', ai: 'analysis',
  marketing: 'marketing', content: 'content', copywriting: 'content', design: 'default', automation: 'ops', other: 'default',
}

// ---------------------------------------------------------------------------
// Sub-component: Weekly Glitch Chart
// ---------------------------------------------------------------------------

function WeeklyRevenueChart({ payments }: { payments: Payment[] }) {
  const days = useMemo(() => {
    const start = startOfWeek(new Date(), { weekStartsOn: 1 })
    const end = endOfWeek(new Date(), { weekStartsOn: 1 })
    const interval = eachDayOfInterval({ start, end })
    
    return interval.map(day => {
      const dailyTotal = payments
        .filter(p => isSameDay(new Date(p.received_at), day))
        .reduce((sum, p) => sum + (p.amount_usd ?? 0), 0)
      return { day, total: dailyTotal }
    })
  }, [payments])

  const maxVal = Math.max(...days.map(d => d.total), 100)

  return (
    <div className="flex items-end justify-between h-24 gap-1 px-2 py-4 bg-black/40 border border-white/5 rounded-xl relative overflow-hidden">
      <div className="absolute inset-0 bg-scanline opacity-[0.02] pointer-events-none" />
      {days.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center group">
          <div 
            className="w-full bg-emerald-500/20 border-t border-emerald-500/40 transition-all duration-1000 relative group-hover:bg-emerald-500/40"
            style={{ height: `${(d.total / maxVal) * 100}%`, minHeight: '2px' }}
          >
            {d.total > 0 && <div className="absolute inset-0 bg-emerald-400 opacity-20 animate-pulse" />}
          </div>
          <span className="text-[7px] font-black text-slate-600 uppercase mt-2 group-hover:text-slate-400 transition-colors">
            {format(d.day, 'EEE')}
          </span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function RevenueView() {
  const { data: projects, loading: pLoad } = useInvoicedProjects()
  const { data: clients } = useClients()
  const { data: payments, loading: payLoad } = usePayments()
  const [typeFilter, setTypeFilter] = useState<ProjectType | 'all'>('all')

  const clientMap = useMemo(() => new Map(clients.map(c => [c.id, c.name])), [clients])

  const rows = useMemo(() => {
    const filtered = typeFilter === 'all' ? projects : projects.filter(p => p.type === typeFilter)
    return filtered.map(p => {
      const pays = payments.filter(pay => pay.project_id === p.id)
      const paid = pays.reduce((s, pay) => s + (pay.amount_usd ?? 0), 0)
      const balance = Math.max((p.contract_value_usd ?? 0) - paid, 0)
      return {
        project: p,
        clientName: clientMap.get(p.client_id) ?? '—',
        paid,
        balance,
        count: pays.length,
        lastAt: pays.length > 0 ? pays.sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime())[0].received_at : null
      }
    })
  }, [clientMap, projects, payments, typeFilter])

  const totals = useMemo(() => {
    const invoiced = rows.reduce((s, r) => s + (r.project.contract_value_usd ?? 0), 0)
    const paid = rows.reduce((s, r) => s + r.paid, 0)
    const balance = rows.reduce((s, r) => s + r.balance, 0)
    return { invoiced, paid, balance }
  }, [rows])

  if (pLoad || payLoad) return (
    <div className="flex flex-col items-center justify-center h-64 gap-4 animate-pulse">
      <div className="w-10 h-10 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
      <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em]">Accessing Financial Core...</p>
    </div>
  )

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      
      {/* ── Terminal Header ── */}
      <div className="bg-[#070C1A] border border-white/10 rounded-3xl p-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-[0.03] pointer-events-none" />
        <div className="absolute top-0 right-0 p-8">
           <div className="flex flex-col items-end">
              <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-1">Market Status</span>
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                 <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                 <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">Live Flow Active</span>
              </div>
           </div>
        </div>

        <div className="relative z-10 flex flex-col md:flex-row items-center gap-12">
          <div className="flex items-center gap-6 border-r border-white/5 pr-12">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/5 border-2 border-emerald-500/20 flex items-center justify-center text-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.15)]">
              <Icon name="revenue" size={32} />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white uppercase tracking-tighter italic leading-none">Revenue Terminal</h1>
              <p className="text-[11px] text-slate-500 font-mono tracking-[0.2em] mt-2 uppercase">Zero Human Asset Liquidity</p>
            </div>
          </div>

          <div className="flex-1 grid grid-cols-3 gap-12">
            <div className="space-y-1">
              <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Gross Invoiced</span>
              <p className="text-3xl font-mono font-black text-white tracking-tighter italic">
                <Odometer value={totals.invoiced} prefix="$" />
              </p>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Liquid Assets</span>
              <p className="text-3xl font-mono font-black text-emerald-400 tracking-tighter italic">
                <Odometer value={totals.paid} prefix="$" />
              </p>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Outstanding Debt</span>
              <p className="text-3xl font-mono font-black text-amber-400 tracking-tighter italic">
                <Odometer value={totals.balance} prefix="$" />
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Weekly Volume */}
        <div className="lg:col-span-1 space-y-4">
          <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] px-2">Weekly Volume Index</h3>
          <WeeklyRevenueChart payments={payments} />
          <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/5 space-y-4">
             <div className="flex justify-between items-center">
                <span className="text-[10px] font-black text-slate-500 uppercase">Collection Efficiency</span>
                <span className="text-xs font-mono font-bold text-emerald-400">
                  {totals.invoiced > 0 ? Math.round((totals.paid / totals.invoiced) * 100) : 100}%
                </span>
             </div>
             <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 shadow-[0_0_10px_#10b981]" style={{ width: `${totals.invoiced > 0 ? (totals.paid / totals.invoiced) * 100 : 100}%` }} />
             </div>
          </div>
        </div>

        {/* Ledger */}
        <div className="lg:col-span-2 flex flex-col h-full bg-[#070C1A] border border-white/5 rounded-3xl overflow-hidden shadow-2xl">
          <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/[0.01]">
            <h3 className="text-[11px] font-black text-white uppercase tracking-[0.3em]">Transaction Ledger</h3>
            <select 
              value={typeFilter} onChange={e => setTypeFilter(e.target.value as any)}
              className="bg-black/40 border border-white/10 rounded-lg px-3 py-1 text-[10px] font-black text-slate-400 uppercase tracking-widest focus:outline-none focus:border-emerald-500/40 transition-all"
            >
              {ALL_TYPES.map(t => <option key={t} value={t} className="bg-[#070C1A]">{t.toUpperCase()}</option>)}
            </select>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white/[0.02] border-b border-white/5">
                  <th className="py-3 px-6 text-[9px] font-black text-slate-600 uppercase tracking-widest">Identity / Sector</th>
                  <th className="py-3 px-6 text-[9px] font-black text-slate-600 uppercase tracking-widest text-right">Invoiced</th>
                  <th className="py-3 px-6 text-[9px] font-black text-slate-600 uppercase tracking-widest text-right">Settled</th>
                  <th className="py-3 px-6 text-[9px] font-black text-slate-600 uppercase tracking-widest">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.02]">
                {rows.map((row) => (
                  <tr key={row.project.id} className="group hover:bg-emerald-500/[0.02] transition-colors cursor-default">
                    <td className="py-4 px-6">
                      <p className="text-[12px] font-black text-white uppercase tracking-tight group-hover:text-emerald-400 transition-colors">{row.project.name}</p>
                      <p className="text-[9px] text-slate-600 font-mono mt-0.5 uppercase">{row.clientName}</p>
                    </td>
                    <td className="py-4 px-6 text-right font-mono text-[11px] font-bold text-slate-400">
                      ${row.project.contract_value_usd.toLocaleString()}
                    </td>
                    <td className="py-4 px-6 text-right font-mono text-[11px] font-bold text-emerald-400/80">
                      ${row.paid.toLocaleString()}
                    </td>
                    <td className="py-4 px-6">
                      <Badge variant={row.balance <= 0 ? 'done' : row.paid > 0 ? 'warning' : 'default'}>
                        {row.balance <= 0 ? 'SETTLED' : row.paid > 0 ? 'PARTIAL' : 'PENDING'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <div className="py-20 text-center text-[10px] font-black text-slate-700 uppercase tracking-[0.4em] italic italic">Ledger Empty: No matching assets</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
