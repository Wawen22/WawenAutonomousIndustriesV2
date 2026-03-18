// ============================================================
// WAI Dashboard – Activity Log (T066)
// Advanced System Event Timeline with Filters and Detail Sidebar
// ============================================================

import { useState, useMemo } from 'react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { Pagination } from './ui/Pagination.js'
import { DetailSidebar } from './ui/DetailSidebar.js'
import { useEventsWithContext } from '../hooks/useSupabaseRealtime.js'
import { getClientColor } from '../lib/clientColors.js'
import type { EventSeverity, SystemEventWithContext } from '../types/index.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEV_STYLES: Record<EventSeverity, { border: string; bg: string; text: string; dot: string }> = {
  info:     { border: 'border-sky-500/20',    bg: 'bg-sky-500/5',    text: 'text-sky-400',    dot: 'bg-sky-400'    },
  warning:  { border: 'border-amber-500/20',  bg: 'bg-amber-500/5',  text: 'text-amber-400',  dot: 'bg-amber-400'  },
  error:    { border: 'border-rose-500/20',   bg: 'bg-rose-500/5',   text: 'text-rose-400',   dot: 'bg-rose-400'   },
  critical: { border: 'border-rose-600/40',   bg: 'bg-rose-600/10',  text: 'text-rose-500',   dot: 'bg-rose-600'   },
}

const PAGE_SIZE = 15

// ---------------------------------------------------------------------------
// Event Card
// ---------------------------------------------------------------------------

function EventCard({ 
  event, 
  onSelect 
}: { 
  event: SystemEventWithContext
  onSelect: (e: SystemEventWithContext) => void 
}) {
  const sev = SEV_STYLES[event.severity] ?? SEV_STYLES.info
  const ts  = new Date(event.created_at)

  const clientName  = event.task?.metadata?.['client_name'] as string | undefined
  const projectName = event.task?.metadata?.['project_name'] as string | undefined
  const clientColor = clientName ? getClientColor(clientName) : null

  return (
    <div 
      onClick={() => onSelect(event)}
      className={clsx(
        "group relative flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer",
        "bg-[#0A1628]/40 hover:bg-[#0F2040]/60",
        sev.border,
        "hover:shadow-[0_8px_30px_rgba(0,0,0,0.3)] hover:-translate-y-0.5"
      )}
    >
      {/* Status Bar */}
      <div className={clsx("absolute left-0 top-4 bottom-4 w-1 rounded-r-full", sev.dot)} />

      {/* Main Content */}
      <div className="flex-1 min-w-0 pl-2">
        <div className="flex items-center justify-between gap-4 mb-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-black text-white tracking-tight uppercase italic">
              {event.type.replace(/_/g, ' ')}
            </span>
            <span className={clsx("text-[9px] font-black px-1.5 py-0.5 rounded border uppercase tracking-widest", sev.bg, sev.text, sev.border)}>
              {event.severity}
            </span>
          </div>
          <span className="text-[10px] text-slate-600 font-mono font-bold whitespace-nowrap">
            {format(ts, 'HH:mm:ss')}
          </span>
        </div>

        {/* Tags Row */}
        <div className="flex items-center gap-2 flex-wrap mt-2">
          {event.agent_id && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.05]">
              <span className="w-1 h-1 rounded-full bg-[#00D4FF]" />
              <span className="text-[10px] text-slate-400 font-mono uppercase">{event.agent_id}</span>
            </div>
          )}
          {event.task_id && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.05]">
              <span className="text-[10px] text-slate-500 font-mono uppercase tracking-tighter">TASK: {event.task_id.slice(0, 8)}</span>
            </div>
          )}
          {clientName && clientColor && (
            <div className={clsx("px-2 py-0.5 rounded-md border text-[9px] font-black uppercase tracking-wider", clientColor.bg, clientColor.border, clientColor.text)}>
              {clientName} {projectName && `• ${projectName}`}
            </div>
          )}
        </div>

        {/* Quick Preview */}
        {Object.keys(event.payload).length > 0 && (
          <p className="mt-3 text-[11px] text-slate-500 line-clamp-1 font-medium italic opacity-80 group-hover:opacity-100 transition-opacity">
            {String(event.payload['message'] ?? JSON.stringify(event.payload)).slice(0, 100)}
          </p>
        )}
      </div>

      {/* Action Indicator */}
      <div className="flex items-center self-stretch px-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-[#00D4FF] text-lg">→</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function EventTimeline() {
  const { data: events, loading, error } = useEventsWithContext(200)
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedEvent, setSelectedEvent] = useState<SystemEventWithContext | null>(null)
  const [severityFilter, setSeverityFilter] = useState<string>('all')

  const filteredEvents = useMemo(() => {
    if (severityFilter === 'all') return events
    return events.filter(e => e.severity === severityFilter)
  }, [events, severityFilter])

  const paginatedEvents = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filteredEvents.slice(start, start + PAGE_SIZE)
  }, [filteredEvents, currentPage])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-[#00D4FF]/20 border-t-[#00D4FF] rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8 rounded-2xl border border-rose-500/20 bg-rose-500/[0.05] text-center">
        <p className="text-rose-400 font-black uppercase tracking-widest text-sm">Telemetry Failure</p>
        <p className="text-slate-500 text-xs mt-1">{error}</p>
      </div>
    )
  }

  return (
    <div className="animate-fade-in space-y-6">
      {/* Header & Filters */}
      <div className="flex items-center justify-between gap-4 flex-wrap bg-white/[0.02] border border-white/[0.05] p-4 rounded-2xl">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-sm font-black text-white uppercase tracking-widest italic">System Telemetry</h2>
            <p className="text-[10px] text-slate-500 font-bold uppercase mt-0.5">{filteredEvents.length} events matching criteria</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[10px] text-slate-600 font-black uppercase tracking-[0.2em]">Filter Severity:</span>
          <div className="flex bg-black/40 rounded-lg p-1 border border-white/5">
            {['all', 'info', 'warning', 'error', 'critical'].map((s) => (
              <button
                key={s}
                onClick={() => { setSeverityFilter(s); setCurrentPage(1); }}
                className={clsx(
                  "px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all",
                  severityFilter === s 
                    ? "bg-[#00D4FF] text-black shadow-[0_0_15px_rgba(0,212,255,0.3)]" 
                    : "text-slate-500 hover:text-slate-300"
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main List */}
      <div className="space-y-3">
        {paginatedEvents.length === 0 ? (
          <div className="py-20 text-center border-2 border-dashed border-white/5 rounded-2xl">
            <p className="text-slate-600 font-black uppercase tracking-widest italic text-sm">Zero events detected</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3">
              {paginatedEvents.map((e) => (
                <EventCard key={e.id} event={e} onSelect={setSelectedEvent} />
              ))}
            </div>
            
            <div className="mt-6">
              <Pagination 
                currentPage={currentPage}
                totalItems={filteredEvents.length}
                pageSize={PAGE_SIZE}
                onPageChange={setCurrentPage}
              />
            </div>
          </>
        )}
      </div>

      {/* Detail Sidebar */}
      {selectedEvent && (
        <DetailSidebar
          title={selectedEvent.type.replace(/_/g, ' ')}
          subtitle={`${selectedEvent.severity} System Event`}
          data={selectedEvent}
          taskId={selectedEvent.task_id}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  )
}
