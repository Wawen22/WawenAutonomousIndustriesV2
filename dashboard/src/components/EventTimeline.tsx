import { clsx } from 'clsx'
import { format, formatDistanceToNow } from 'date-fns'
import { Panel } from './ui/Panel.js'
import { Badge } from './ui/Badge.js'
import { useEventsWithContext } from '../hooks/useSupabaseRealtime.js'
import { getClientColor } from '../lib/clientColors.js'
import type { EventSeverity, SystemEventWithContext } from '../types/index.js'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SEV_STYLES: Record<EventSeverity, { dot: string; label: string }> = {
  info:     { dot: 'bg-sky-400',    label: 'INFO'     },
  warning:  { dot: 'bg-amber-400',  label: 'WARN'     },
  error:    { dot: 'bg-rose-400',   label: 'ERROR'    },
  critical: { dot: 'bg-rose-600',   label: 'CRITICAL' },
}

const EVENT_LABELS: Record<string, string> = {
  task_created:            'Task Created',
  task_assigned:           'Task Assigned',
  task_started:            'Task Started',
  task_completed:          'Task Completed',
  task_blocked:            'Task Blocked',
  agent_online:            'Agent Online',
  agent_offline:           'Agent Offline',
  agent_error:             'Agent Error',
  model_changed:           'Model Changed',
  model_failover:          'Model Failover',
  budget_alert:            'Budget Alert',
  budget_exceeded:         'Budget Exceeded',
  human_review_requested:  'Review Requested',
  human_approved:          'Approved',
  human_rejected:          'Rejected',
  run_completed:           'Run Completed',
  run_failed:              'Run Failed',
  system_startup:          'System Started',
  system_shutdown:         'System Stopped',
  founder_command:         'Founder Command',
}

// ---------------------------------------------------------------------------
// EventRow
// ---------------------------------------------------------------------------

function EventRow({ event, showDate }: { event: SystemEventWithContext; showDate: boolean }) {
  const sev = SEV_STYLES[event.severity] ?? SEV_STYLES.info
  const ts  = new Date(event.created_at)

  // Client/project from joined task metadata
  const clientName  = ((): string => {
    const v = event.task?.metadata?.['client_name']
    return typeof v === 'string' && v.trim() ? v.trim() : ''
  })()
  const projectName = ((): string => {
    const v = event.task?.metadata?.['project_name']
    return typeof v === 'string' && v.trim() ? v.trim() : ''
  })()
  const clientColor = clientName ? getClientColor(clientName) : null

  return (
    <div className="relative pl-6 pb-4 last:pb-0 group animate-slide-up">
      {/* Timeline line */}
      <div className="absolute left-[7px] top-4 bottom-0 w-px bg-white/[0.06] group-last:hidden" />

      {/* Dot */}
      <span
        className={clsx(
          'absolute left-0 top-1.5 w-3.5 h-3.5 rounded-full border-2 border-[#0A1628] flex-shrink-0',
          sev.dot
        )}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Event type */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-slate-200">
              {EVENT_LABELS[event.type] ?? event.type.replace(/_/g, ' ')}
            </span>
            {event.severity !== 'info' && (
              <Badge variant={event.severity}>{sev.label}</Badge>
            )}
          </div>

          {/* Agent + task + client/project */}
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {event.agent_id && (
              <span className="text-[11px] text-slate-500 font-mono">{event.agent_id}</span>
            )}
            {event.task_id && (
              <span className="text-[11px] text-slate-600 font-mono truncate max-w-[140px]" title={event.task_id}>
                #{event.task_id.slice(0, 8)}
              </span>
            )}
            {clientName && clientColor && (
              <span
                className={clsx(
                  'text-[9px] font-mono px-1.5 py-0.5 rounded border',
                  clientColor.bg, clientColor.border, clientColor.text
                )}
              >
                {projectName ? `${clientName} · ${projectName}` : clientName}
              </span>
            )}
          </div>

          {/* Payload preview */}
          {Object.keys(event.payload).length > 0 && (
            <div className="mt-1.5 rounded-lg bg-white/[0.03] border border-white/[0.05] px-2.5 py-1.5">
              <pre className="text-[11px] text-slate-500 font-mono whitespace-pre-wrap break-all line-clamp-2">
                {JSON.stringify(event.payload, null, 0).slice(0, 160)}
              </pre>
            </div>
          )}
        </div>

        {/* Timestamp */}
        <div className="flex-shrink-0 text-right">
          <p className="text-[11px] text-slate-500 font-mono">
            {formatDistanceToNow(ts, { addSuffix: true })}
          </p>
          {showDate && (
            <p className="text-[10px] text-slate-700 font-mono">{format(ts, 'HH:mm:ss')}</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function EventTimeline() {
  const { data: events, loading, error } = useEventsWithContext(50)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-5 h-5 border-2 border-[#00D4FF]/30 border-t-[#00D4FF] rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <Panel className="border-rose-500/20">
        <p className="text-rose-400 text-sm">Error: {error}</p>
      </Panel>
    )
  }

  // Group events by relative day
  const bySeverity = {
    critical: events.filter((e) => e.severity === 'critical').length,
    error:    events.filter((e) => e.severity === 'error').length,
    warning:  events.filter((e) => e.severity === 'warning').length,
    info:     events.filter((e) => e.severity === 'info').length,
  }

  return (
    <div className="animate-fade-in space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-semibold text-white font-tabular">{events.length} events</span>
        <div className="flex gap-2 flex-wrap">
          {(Object.entries(bySeverity) as [EventSeverity, number][])
            .filter(([, c]) => c > 0)
            .map(([sev, count]) => (
              <Badge key={sev} variant={sev} dot>
                {count} {sev}
              </Badge>
            ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-slow" />
          <span className="text-[11px] text-emerald-400 font-mono uppercase tracking-wider">Live</span>
        </div>
      </div>

      {/* Timeline */}
      <Panel noPad>
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <span className="text-2xl">◌</span>
            <p className="text-sm text-slate-600">No events recorded yet</p>
          </div>
        ) : (
          <div className="p-5">
            {events.map((e, i) => (
              <EventRow key={e.id} event={e} showDate={i === 0 || i % 10 === 0} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}
