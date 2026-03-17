import { useTasks } from '../hooks/useSupabaseRealtime.js'
import type { Task, TaskStatus } from '../types/index.js'
import { clsx } from 'clsx'

const COLUMNS: { status: TaskStatus; label: string; color: string }[] = [
  { status: 'todo', label: 'Todo', color: 'border-gray-600' },
  { status: 'in_progress', label: 'In Progress', color: 'border-blue-500' },
  { status: 'blocked', label: 'Blocked', color: 'border-orange-500' },
  { status: 'done', label: 'Done', color: 'border-green-500' },
]

const PRIORITY_COLORS: Record<number, string> = {
  1: 'text-red-400',
  2: 'text-orange-400',
  3: 'text-yellow-400',
  4: 'text-blue-400',
  5: 'text-gray-400',
}

function TaskCard({ task }: { task: Task }) {
  return (
    <div className="bg-gray-800 rounded-lg p-3 border border-gray-700 text-sm">
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className={clsx('font-bold text-xs flex-shrink-0', PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS[3])}>
          P{task.priority}
        </span>
        <span className="text-xs text-gray-500 uppercase">{task.type}</span>
      </div>
      <p className="text-white font-medium leading-snug">{task.title}</p>
      {task.assignee_agent_id && (
        <p className="text-gray-500 text-xs mt-1 truncate">→ {task.assignee_agent_id}</p>
      )}
      {task.requires_human_review && (
        <span className="inline-block mt-1 text-xs bg-yellow-900 text-yellow-300 px-1.5 py-0.5 rounded">
          Needs review
        </span>
      )}
    </div>
  )
}

function Column({ status, label, color, tasks }: { status: TaskStatus; label: string; color: string; tasks: Task[] }) {
  return (
    <div className={clsx('flex-1 min-w-0 border-t-2', color)}>
      <div className="flex items-center justify-between py-3 px-1">
        <h3 className="text-sm font-semibold text-white">{label}</h3>
        <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded-full">
          {tasks.length}
        </span>
      </div>
      <div className="space-y-2 px-1 pb-4 max-h-96 overflow-y-auto">
        {tasks.length === 0 ? (
          <p className="text-gray-600 text-xs text-center py-4">Empty</p>
        ) : (
          tasks.map((task) => <TaskCard key={task.id} task={task} />)
        )}
      </div>
    </div>
  )
}

export function TaskBoard() {
  const { data: tasks, loading, error } = useTasks()

  if (loading) return <div className="text-gray-400 text-sm p-4">Loading tasks...</div>
  if (error) return <div className="text-red-400 text-sm p-4">Error: {error}</div>

  const byStatus = tasks.reduce<Record<TaskStatus, Task[]>>(
    (acc, task) => {
      const s = task.status
      if (s !== 'cancelled') {
        if (!acc[s]) acc[s] = []
        acc[s]!.push(task)
      }
      return acc
    },
    { todo: [], in_progress: [], done: [], blocked: [], cancelled: [] }
  )

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-4">Task Board</h2>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {COLUMNS.map((col) => (
          <Column
            key={col.status}
            status={col.status}
            label={col.label}
            color={col.color}
            tasks={byStatus[col.status] ?? []}
          />
        ))}
      </div>
    </div>
  )
}
