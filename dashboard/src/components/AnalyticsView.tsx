// ============================================================
// WAI – Analytics View (T143)
// Landing page traffic stats + lead conversion funnel.
// No external chart libraries — bars via inline CSS width%.
// ============================================================

import { useEffect, useState } from 'react'

const BACKEND_URL = (import.meta.env['VITE_BACKEND_URL'] as string | undefined) ?? ''

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AnalyticsSummary {
  period_days: number
  total_views: number
  unique_paths: number
  avg_per_day: number
  top_pages: Array<{ path: string; count: number }>
  top_referrers: Array<{ referrer: string; count: number }>
}

interface AnalyticsFunnel {
  page_views: number
  contacts_inbound: number
  leads_qualified: number
  outreach_sent: number
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">{label}</p>
      <p className="mt-1 text-xl font-black text-white">{value}</p>
      {sub && <p className="text-[10px] text-slate-600 mt-0.5">{sub}</p>}
    </div>
  )
}

function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100)
  return (
    <div className="space-y-1">
      <span className="text-[11px] text-slate-400 font-mono truncate block">{label}</span>
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </div>
        <span className="text-[10px] font-mono text-slate-500 w-7 text-right flex-shrink-0">{value}</span>
      </div>
    </div>
  )
}

function FunnelStage({ label, value, color, isLast }: { label: string; value: number; color: string; isLast: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="rounded-xl border border-white/[0.07] bg-black/30 px-4 py-3 text-center min-w-[110px]">
        <p className="text-lg font-black" style={{ color }}>{value.toLocaleString()}</p>
        <p className="text-[9px] text-slate-600 uppercase tracking-[0.18em] mt-0.5 leading-tight">{label}</p>
      </div>
      {!isLast && <span className="text-slate-700 text-base">→</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function AnalyticsView() {
  const [period, setPeriod] = useState<7 | 30>(7)
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [funnel, setFunnel] = useState<AnalyticsFunnel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`${BACKEND_URL}/api/analytics/summary?days=${period}`)
      .then((r) => (r.ok ? (r.json() as Promise<AnalyticsSummary>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setSummary)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [period])

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/analytics/funnel`)
      .then((r) => (r.ok ? (r.json() as Promise<AnalyticsFunnel>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setFunnel)
      .catch(() => { /* non-fatal: funnel stays null */ })
  }, [])

  const maxPage = Math.max(...(summary?.top_pages.map((p) => p.count) ?? [0]), 1)
  const maxRef = Math.max(...(summary?.top_referrers.map((r) => r.count) ?? [0]), 1)
  const conversionRate =
    funnel && funnel.page_views > 0
      ? `${Math.round((funnel.contacts_inbound / funnel.page_views) * 100)}%`
      : '—'

  const funnelStages = funnel
    ? [
        { label: 'Page Views', value: funnel.page_views, color: '#00D4FF' },
        { label: 'Contatti Inbound', value: funnel.contacts_inbound, color: '#7CF6E6' },
        { label: 'Lead Qualificati', value: funnel.leads_qualified, color: '#a78bfa' },
        { label: 'Outreach Inviato', value: funnel.outreach_sent, color: '#34d399' },
      ]
    : []

  return (
    <div className="flex flex-col h-full overflow-auto p-6 gap-6">

      {/* Header + period toggle */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-black text-white uppercase tracking-tight italic">Site Analytics</h2>
          <p className="text-[11px] text-slate-600 mt-0.5">Landing page traffic + lead conversion funnel</p>
        </div>
        <div className="flex rounded-lg overflow-hidden border border-white/[0.07]">
          {([7, 30] as const).map((d) => (
            <button
              key={d}
              onClick={() => setPeriod(d)}
              className={`px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] transition-all ${
                period === d
                  ? 'bg-[#00D4FF] text-black'
                  : 'text-slate-500 hover:text-white bg-transparent'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-[#00D4FF]/30 border-t-[#00D4FF] rounded-full animate-spin" />
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-[12px] text-rose-400">
          Errore nel caricamento analytics: {error}
        </div>
      )}

      {/* Content */}
      {!loading && !error && summary && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Visite totali" value={summary.total_views} sub={`Ultimi ${period} giorni`} />
            <StatCard label="Pagine uniche" value={summary.unique_paths} />
            <StatCard label="Media / giorno" value={summary.avg_per_day} />
            <StatCard label="Conversione" value={conversionRate} sub="Visite → Contatti" />
          </div>

          {/* Top pages + referrers */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
              <h3 className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-600 mb-4">
                Top Pages
              </h3>
              {summary.top_pages.length === 0 ? (
                <p className="text-[11px] text-slate-600">Nessun dato disponibile.</p>
              ) : (
                <div className="space-y-3">
                  {summary.top_pages.map((p) => (
                    <BarRow key={p.path} label={p.path} value={p.count} max={maxPage} color="#00D4FF" />
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
              <h3 className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-600 mb-4">
                Referrer Breakdown
              </h3>
              {summary.top_referrers.length === 0 ? (
                <p className="text-[11px] text-slate-600">Nessun dato disponibile.</p>
              ) : (
                <div className="space-y-3">
                  {summary.top_referrers.map((r) => (
                    <BarRow key={r.referrer} label={r.referrer} value={r.count} max={maxRef} color="#7CF6E6" />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Conversion funnel */}
          {funnel && (
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
              <h3 className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-600 mb-4">
                Conversion Funnel — Ultimi 30 giorni
              </h3>
              <div className="flex items-center gap-2 flex-wrap">
                {funnelStages.map((stage, i) => (
                  <FunnelStage
                    key={stage.label}
                    label={stage.label}
                    value={stage.value}
                    color={stage.color}
                    isLast={i === funnelStages.length - 1}
                  />
                ))}
              </div>
              {funnel.page_views === 0 && (
                <p className="text-[11px] text-slate-600 mt-3">
                  Nessun dato analytics ancora. Le visite alla landing page appariranno qui automaticamente.
                </p>
              )}
            </div>
          )}

          {/* Empty state */}
          {summary.total_views === 0 && (
            <div className="rounded-xl border border-dashed border-white/[0.08] p-8 text-center">
              <p className="text-sm text-slate-500">Nessuna visita registrata negli ultimi {period} giorni.</p>
              <p className="text-[11px] text-slate-600 mt-1">Le visite alla landing page WAI vengono tracciate automaticamente.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
