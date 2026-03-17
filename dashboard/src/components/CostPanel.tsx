import { useProjectState, useRecentRuns } from '../hooks/useSupabaseRealtime.js'
import { clsx } from 'clsx'

function BudgetBar({ current, total }: { current: number; total: number }) {
  const pct = Math.min((current / total) * 100, 100)
  const color = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-yellow-500' : 'bg-green-500'

  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-400">Monthly spend</span>
        <span className={clsx('font-medium', pct >= 80 ? 'text-yellow-400' : 'text-white')}>
          ${current.toFixed(2)} / ${total.toFixed(2)}
        </span>
      </div>
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={clsx('h-full rounded-full transition-all duration-500', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-gray-500 mt-1">{pct.toFixed(1)}% of budget used</p>
    </div>
  )
}

export function CostPanel() {
  const { state, loading: stateLoading } = useProjectState()
  const { data: runs, loading: runsLoading } = useRecentRuns(50)

  const loading = stateLoading || runsLoading

  if (loading) return <div className="text-gray-400 text-sm p-4">Loading costs...</div>

  const costByModel = runs.reduce<Record<string, number>>((acc, run) => {
    acc[run.model_id] = (acc[run.model_id] ?? 0) + (run.cost_usd ?? 0)
    return acc
  }, {})

  const successRate =
    runs.length > 0
      ? Math.round((runs.filter((r) => r.outcome === 'success').length / runs.length) * 100)
      : 100

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-4">Costs & Performance</h2>

      {state && (
        <div className="mb-6">
          <BudgetBar current={state.monthly_cost_usd} total={state.monthly_budget_usd} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-gray-800 rounded-lg p-3">
          <p className="text-gray-500 text-xs">Success rate (last 50)</p>
          <p className={clsx('text-2xl font-bold mt-1', successRate < 90 ? 'text-orange-400' : 'text-green-400')}>
            {successRate}%
          </p>
        </div>
        <div className="bg-gray-800 rounded-lg p-3">
          <p className="text-gray-500 text-xs">Tasks done (all time)</p>
          <p className="text-2xl font-bold mt-1 text-white">{state?.total_tasks_done ?? 0}</p>
        </div>
      </div>

      {Object.keys(costByModel).length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-2">Cost by model (last 50 runs)</h3>
          <div className="space-y-2">
            {Object.entries(costByModel).map(([modelId, cost]) => (
              <div key={modelId} className="flex justify-between text-sm">
                <span className="text-gray-400">{modelId}</span>
                <span className="text-white font-medium">${cost.toFixed(4)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
