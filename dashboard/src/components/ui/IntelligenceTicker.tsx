// ============================================================
// WAI Dashboard – Intelligence Ticker (Composite Feed)
// Mixed signal: Financials, Operations, Strategy, Performance.
// ============================================================

import { useMemo } from 'react'
import { clsx } from 'clsx'
import { 
  useEvents, 
  useRecentRuns, 
  useProjectState, 
  useTasks 
} from '../../hooks/useSupabaseRealtime.js'

export function IntelligenceTicker() {
  const { data: events } = useEvents(10)
  const { data: runs } = useRecentRuns(20)
  const { state } = useProjectState()
  const { data: tasks } = useTasks('in_progress')

  const tickerItems = useMemo(() => {
    const items: Array<{ id: string; text: string; type: 'biz' | 'ops' | 'tech' | 'alert' }> = []

    // 1. FINANCIAL SIGNAL (BIZ)
    if (state) {
      const budgetPct = Math.round((state.monthly_cost_usd / state.monthly_budget_usd) * 100)
      items.push({
        id: 'biz-budget',
        type: 'biz',
        text: `FINANCIAL PULSE: $${state.monthly_cost_usd.toFixed(2)} BURNED (${budgetPct}% OF BUDGET)`
      })
      items.push({
        id: 'biz-milestone',
        type: 'biz',
        text: `STRATEGIC TARGET: ${state.current_milestone.toUpperCase()}`
      })
    }

    // 2. OPERATIONAL SIGNAL (OPS) - Active agent actions
    tasks.slice(0, 3).forEach(t => {
      if (t.assignee_agent_id) {
        items.push({
          id: `ops-task-${t.id}`,
          type: 'ops',
          text: `NODE ${t.assignee_agent_id.toUpperCase()} IS PROCESSING: ${t.title.toUpperCase()}`
        })
      }
    })

    // 3. PERFORMANCE SIGNAL (TECH) - Latency & Success
    if (runs.length > 0) {
      const avgLat = Math.round(runs.reduce((acc, r) => acc + r.duration_ms, 0) / runs.length)
      const successRate = Math.round((runs.filter(r => r.outcome === 'success').length / runs.length) * 100)
      items.push({
        id: 'tech-perf',
        type: 'tech',
        text: `NEURAL LATENCY: ${avgLat}MS • SYSTEM EFFICIENCY: ${successRate}%`
      })
    }

    // 4. ALERTS (Highest Priority)
    const criticals = events.filter(e => e.severity === 'error' || e.severity === 'critical')
    criticals.slice(0, 2).forEach(e => {
      items.push({
        id: `alert-${e.id}`,
        type: 'alert',
        text: `CRITICAL BLOCK DETECTED: ${e.type.toUpperCase()} - INTERVENTION REQUIRED`
      })
    })

    // Shuffle slightly but keep biz first
    return items
  }, [events, runs, state, tasks])

  if (tickerItems.length === 0) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 h-7 bg-[#05080F]/90 backdrop-blur-md border-t border-white/10 z-[200] overflow-hidden flex items-center shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
      {/* Decorative side fades */}
      <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-[#05080F] to-transparent z-10 pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-[#05080F] to-transparent z-10 pointer-events-none" />
      
      <div className="animate-ticker">
        {[1, 2].map((loop) => (
          <div key={loop} className="flex items-center gap-16 pr-16">
            {tickerItems.map((item) => (
              <div key={`${loop}-${item.id}`} className="flex items-center gap-3">
                <span className={clsx(
                  "w-1 h-1 rounded-full shadow-[0_0_5px_currentColor]",
                  item.type === 'biz'   ? "text-emerald-400 bg-emerald-400" : 
                  item.type === 'ops'   ? "text-[#00D4FF] bg-[#00D4FF]" : 
                  item.type === 'tech'  ? "text-violet-400 bg-violet-400" : 
                  "text-rose-500 bg-rose-500 animate-ping"
                )} />
                <span className={clsx(
                  "text-[9px] font-black font-mono tracking-[0.2em] whitespace-nowrap transition-colors",
                  item.type === 'alert' ? "text-rose-500" : "text-slate-400"
                )}>
                  {item.text}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
