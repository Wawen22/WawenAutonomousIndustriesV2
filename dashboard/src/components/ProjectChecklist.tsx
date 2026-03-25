// ============================================================
// WAI Dashboard – Project Checklist (T130)
// Read-only view of per-project delivery checklist items.
// Updated live via Supabase Realtime subscription.
// ============================================================

import { useProjectChecklist } from '../hooks/useSupabaseRealtime.js'
import type { ChecklistCategory, ChecklistStatus, ProjectChecklistItem } from '../types/index.js'

// ---------------------------------------------------------------------------
// Status icon + color mapping
// ---------------------------------------------------------------------------

const STATUS_ICON: Record<ChecklistStatus, string> = {
  done:        '✅',
  in_progress: '🔄',
  failed:      '❌',
  pending:     '⏳',
  skipped:     '⏭',
}

const STATUS_LABEL: Record<ChecklistStatus, string> = {
  done:        'Done',
  in_progress: 'In Progress',
  failed:      'Failed',
  pending:     'Pending',
  skipped:     'Skipped',
}

const STATUS_COLOR: Record<ChecklistStatus, string> = {
  done:        'text-emerald-400 border-emerald-400/20 bg-emerald-400/5',
  in_progress: 'text-[#00D4FF] border-[#00D4FF]/20 bg-[#00D4FF]/5',
  failed:      'text-rose-400 border-rose-400/20 bg-rose-400/5',
  pending:     'text-slate-500 border-white/10 bg-white/[0.02]',
  skipped:     'text-amber-500 border-amber-500/20 bg-amber-500/5',
}

const CATEGORY_COLOR: Record<ChecklistCategory, string> = {
  delivery:  'text-violet-400 border-violet-400/20 bg-violet-400/5',
  technical: 'text-[#00D4FF] border-[#00D4FF]/20 bg-[#00D4FF]/5',
  quality:   'text-emerald-400 border-emerald-400/20 bg-emerald-400/5',
  business:  'text-amber-400 border-amber-400/20 bg-amber-400/5',
}

// ---------------------------------------------------------------------------
// Single checklist row
// ---------------------------------------------------------------------------

function ChecklistRow({ item }: { item: ProjectChecklistItem }) {
  const statusCls = STATUS_COLOR[item.status]
  const categoryCls = CATEGORY_COLOR[item.category]

  return (
    <div className="flex items-start gap-4 p-4 rounded-2xl bg-white/[0.015] border border-white/5 hover:border-white/10 hover:bg-white/[0.03] transition-all">
      {/* Status icon */}
      <span className="text-lg shrink-0 mt-0.5" title={STATUS_LABEL[item.status]}>
        {STATUS_ICON[item.status]}
      </span>

      {/* Label + notes */}
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-black text-slate-200 uppercase tracking-tight leading-snug">
          {item.label}
        </p>
        {item.notes && (
          <p className="mt-1 text-[10px] font-mono text-slate-500 leading-relaxed">
            {item.notes}
          </p>
        )}
        {item.agent_id && (
          <p className="mt-1 text-[9px] font-mono text-slate-600 uppercase tracking-wider">
            Agent: {item.agent_id}
          </p>
        )}
      </div>

      {/* Badges */}
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest border ${statusCls}`}>
          {STATUS_LABEL[item.status]}
        </span>
        <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest border ${categoryCls}`}>
          {item.category}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Category group
// ---------------------------------------------------------------------------

function CategoryGroup({ category, items }: { category: ChecklistCategory; items: ProjectChecklistItem[] }) {
  const done = items.filter(i => i.status === 'done').length
  const total = items.length
  const allDone = done === total

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.25em]">
          {category}
        </h4>
        <span className={`text-[9px] font-mono font-bold ${allDone ? 'text-emerald-400' : 'text-slate-600'}`}>
          {done}/{total}
        </span>
      </div>
      <div className="space-y-2">
        {items.map(item => (
          <ChecklistRow key={item.id} item={item} />
        ))}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Summary bar
// ---------------------------------------------------------------------------

function ChecklistSummaryBar({ items }: { items: ProjectChecklistItem[] }) {
  const counts: Record<ChecklistStatus, number> = {
    done: 0, in_progress: 0, failed: 0, pending: 0, skipped: 0,
  }
  items.forEach(i => { counts[i.status]++ })
  const total = items.length
  const doneWidth = total > 0 ? (counts.done / total) * 100 : 0
  const inProgressWidth = total > 0 ? (counts.in_progress / total) * 100 : 0
  const failedWidth = total > 0 ? (counts.failed / total) * 100 : 0

  return (
    <div className="space-y-3 p-4 rounded-2xl bg-black/30 border border-white/5">
      <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
        <span className="font-black uppercase tracking-widest">Delivery Progress</span>
        <span className="text-emerald-400 font-bold">{counts.done}/{total} done</span>
      </div>

      {/* Progress track */}
      <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden flex">
        <div className="h-full bg-emerald-400 transition-all duration-700" style={{ width: `${doneWidth}%` }} />
        <div className="h-full bg-[#00D4FF] transition-all duration-700" style={{ width: `${inProgressWidth}%` }} />
        <div className="h-full bg-rose-500 transition-all duration-700" style={{ width: `${failedWidth}%` }} />
      </div>

      {/* Status pills */}
      <div className="flex flex-wrap gap-2">
        {(Object.entries(counts) as [ChecklistStatus, number][])
          .filter(([, n]) => n > 0)
          .map(([status, n]) => (
            <span key={status} className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase border ${STATUS_COLOR[status]}`}>
              {STATUS_ICON[status]} {n} {STATUS_LABEL[status]}
            </span>
          ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const CATEGORY_ORDER: ChecklistCategory[] = ['delivery', 'technical', 'quality', 'business']

export function ProjectChecklist({ projectId }: { projectId: string }) {
  const { data: items, loading, error } = useProjectChecklist(projectId)

  if (loading) {
    return (
      <div className="py-20 flex flex-col items-center gap-4 opacity-30">
        <div className="w-8 h-8 border-2 border-[#00D4FF]/20 border-t-[#00D4FF] rounded-full animate-spin" />
        <span className="text-[10px] font-black uppercase tracking-[0.3em]">Loading Checklist...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="py-12 text-center text-rose-400 font-mono text-xs">
        Error: {error}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="py-16 text-center space-y-2">
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-600">No checklist items yet</p>
        <p className="text-[9px] font-mono text-slate-700">Items are seeded when the Architect starts planning.</p>
      </div>
    )
  }

  // Group by category
  const grouped = CATEGORY_ORDER.reduce<Record<ChecklistCategory, ProjectChecklistItem[]>>(
    (acc, cat) => {
      acc[cat] = items.filter(i => i.category === cat)
      return acc
    },
    { delivery: [], technical: [], quality: [], business: [] }
  )

  return (
    <div className="space-y-6">
      <ChecklistSummaryBar items={items} />
      {CATEGORY_ORDER.filter(cat => grouped[cat].length > 0).map(cat => (
        <CategoryGroup key={cat} category={cat} items={grouped[cat]} />
      ))}
    </div>
  )
}
