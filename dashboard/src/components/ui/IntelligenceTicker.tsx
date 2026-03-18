// ============================================================
// WAI Dashboard – Intelligence Ticker
// Horizontal scrolling bar with live system updates.
// ============================================================

import { useMemo } from 'react'
import { clsx } from 'clsx'
import { useEvents, useRecentRuns } from '../../hooks/useSupabaseRealtime.js'

export function IntelligenceTicker() {
  const { data: events } = useEvents(10)
  const { data: runs } = useRecentRuns(10)

  const tickerItems = useMemo(() => {
    const items: Array<{ id: string; text: string; type: 'event' | 'run' }> = []

    // Add runs
    runs.forEach(r => {
      items.push({
        id: `run-${r.id}`,
        type: 'run',
        text: `AGENT ${r.agent_id.toUpperCase()} EXECUTED RUN: ${r.outcome.toUpperCase()} [+$${r.cost_usd.toFixed(4)}]`
      })
    })

    // Add events
    events.forEach(e => {
      const msg = e.payload['message'] || e.type.replace(/_/g, ' ')
      items.push({
        id: `ev-${e.id}`,
        type: 'event',
        text: `SYSTEM ALERT: ${e.type.toUpperCase()} - ${String(msg).toUpperCase()}`
      })
    })

    // Shuffle and duplicate for infinite scroll effect
    return [...items].sort(() => Math.random() - 0.5)
  }, [events, runs])

  if (tickerItems.length === 0) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 h-7 bg-black/80 backdrop-blur-md border-t border-white/10 z-[200] overflow-hidden flex items-center">
      <div className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-black to-transparent z-10 pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-black to-transparent z-10 pointer-events-none" />
      
      <div className="animate-ticker">
        {/* We render twice to ensure seamless looping */}
        {[1, 2].map((loop) => (
          <div key={loop} className="flex items-center gap-12 pr-12">
            {tickerItems.map((item) => (
              <div key={`${loop}-${item.id}`} className="flex items-center gap-3">
                <span className={clsx(
                  "w-1 h-1 rounded-full",
                  item.type === 'run' ? "bg-[#00D4FF]" : "bg-amber-400"
                )} />
                <span className="text-[9px] font-black font-mono tracking-[0.15em] text-slate-400 whitespace-nowrap">
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
