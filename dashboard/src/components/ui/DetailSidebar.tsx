import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTask } from '../../hooks/useSupabaseRealtime.js'
import { Badge } from './Badge.js'
import { format } from 'date-fns'

interface DetailSidebarProps {
  title: string
  subtitle?: string
  data: any
  taskId?: string | null
  onClose: () => void
}

function TaskContext({ taskId }: { taskId: string }) {
  const { data: task, loading } = useTask(taskId)

  if (loading) return <div className="h-20 animate-pulse bg-white/5 rounded-xl" />
  if (!task) return null

  return (
    <div className="rounded-xl border border-[#00D4FF]/20 bg-[#00D4FF]/[0.03] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black text-[#00D4FF] uppercase tracking-widest text-[8px]">Linked Task</span>
        <Badge variant={task.status}>{task.status}</Badge>
      </div>
      <div>
        <h4 className="text-sm font-bold text-white leading-tight">{task.title}</h4>
        <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">{task.description}</p>
      </div>
      <div className="flex items-center gap-3 pt-2 border-t border-white/5">
        <div className="flex flex-col">
          <span className="text-[8px] text-slate-600 uppercase font-black">Priority</span>
          <span className="text-[10px] text-slate-300 font-mono">P{task.priority}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[8px] text-slate-600 uppercase font-black">Type</span>
          <span className="text-[10px] text-slate-300 font-mono uppercase">{task.type}</span>
        </div>
      </div>
    </div>
  )
}

export function DetailSidebar({ title, subtitle, data, taskId, onClose }: DetailSidebarProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[250] flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" />
      
      <div
        className="relative w-full max-w-[500px] h-full bg-[#070C1A] border-l border-white/[0.08] flex flex-col shadow-[-20px_0_80px_rgba(0,0,0,0.8)] animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-6 border-b border-white/[0.07] flex items-center justify-between bg-white/[0.01]">
          <div className="min-w-0">
            <h2 className="text-base font-black text-white truncate tracking-tight uppercase italic">{title}</h2>
            {subtitle && <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em] mt-1">{subtitle}</p>}
          </div>
          <button 
            onClick={onClose} 
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/[0.03] text-slate-500 hover:text-white hover:bg-white/[0.08] transition-all"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
          {/* Context Section (Task) */}
          {taskId && (
            <section>
              <h3 className="text-[10px] text-slate-500 uppercase tracking-[0.2em] font-black mb-3">Context Awareness</h3>
              <TaskContext taskId={taskId} />
            </section>
          )}

          {/* Data Payload Section */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[10px] text-slate-500 uppercase tracking-[0.2em] font-black">Data Payload</h3>
              <span className="text-[9px] font-mono text-slate-600">application/json</span>
            </div>
            <div className="rounded-xl border border-white/[0.05] bg-black/40 p-4 font-mono text-[11px] leading-relaxed text-slate-300 overflow-x-auto whitespace-pre">
              {JSON.stringify(data, null, 2)}
            </div>
          </section>

          {/* Metadata Section */}
          <section className="pb-8">
            <h3 className="text-[10px] text-slate-500 uppercase tracking-[0.2em] font-black mb-3">System Metadata</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]">
                <p className="text-[8px] text-slate-600 uppercase font-black mb-1">Created At</p>
                <p className="text-[10px] text-slate-300 font-mono">
                  {data.created_at ? format(new Date(data.created_at), 'yyyy-MM-dd HH:mm:ss') : 'N/A'}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]">
                <p className="text-[8px] text-slate-600 uppercase font-black mb-1">Entity ID</p>
                <p className="text-[10px] text-slate-300 font-mono truncate">{data.id || 'N/A'}</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body
  )
}
