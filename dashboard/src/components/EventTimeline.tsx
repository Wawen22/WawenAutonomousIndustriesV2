import { useEvents } from '../hooks/useSupabaseRealtime.js'
import type { EventSeverity } from '../types/index.js'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'

const SEVERITY_STYLES: Record<EventSeverity, { dot: string; text: string }> = {
  info: { dot: 'bg-blue-500', text: 'text-blue-400' },
  warning: { dot: 'bg-yellow-500', text: 'text-yellow-400' },
  error: { dot: 'bg-orange-500', text: 'text-orange-400' },
  critical: { dot: 'bg-red-500', text: 'text-red-400' },
}

const EVENT_LABELS: Record<string, string> = {
  task_created: 'Task created',
  task_assigned: 'Task assigned',
  task_started: 'Task started',
  task_completed: 'Task completed',
  task_blocked: 'Task blocked',
  agent_online: 'Agent online',
  agent_offline: 'Agent offline',
  agent_error: 'Agent error',
  model_changed: 'Model changed',
  budget_alert: 'Budget alert',
  budget_exceeded: 'Budget exceeded',
  human_review_requested: 'Review requested',
  human_approved: 'Approved by Neb',
  human_rejected: 'Rejected by Neb',
  run_completed: 'Run completed',
  run_failed: 'Run failed',
  system_startup: 'System started',
  system_shutdown: 'System stopped',
  founder_command: 'Founder command',
}

export function EventTimeline() {
  const { data: events, loading, error } = useEvents(30)

  if (loading) return <div className="text-gray-400 text-sm p-4">Loading events...</div>
  if (error) return <div className="text-red-400 text-sm p-4">Error: {error}</div>

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-4">Activity Timeline</h2>
      {events.length === 0 ? (
        <p className="text-gray-600 text-sm">No events yet.</p>
      ) : (
        <div className="space-y-3">
          {events.map((event) => {
            const style = SEVERITY_STYLES[event.severity] ?? SEVERITY_STYLES.info
            return (
              <div key={event.id} className="flex gap-3 text-sm">
                <div className="flex-shrink-0 pt-1.5">
                  <span className={clsx('inline-block w-2 h-2 rounded-full', style.dot)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className={clsx('font-medium', style.text)}>
                      {EVENT_LABELS[event.type] ?? event.type}
                    </span>
                    {event.agent_id && (
                      <span className="text-xs text-gray-500">{event.agent_id}</span>
                    )}
                    <span className="text-xs text-gray-600 ml-auto">
                      {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
