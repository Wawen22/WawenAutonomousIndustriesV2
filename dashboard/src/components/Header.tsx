import { useProjectState } from '../hooks/useSupabaseRealtime.js'
import { clsx } from 'clsx'

export function Header() {
  const { state } = useProjectState()

  const budgetPct = state
    ? Math.round((state.monthly_cost_usd / state.monthly_budget_usd) * 100)
    : null

  return (
    <header className="bg-gray-900 border-b border-gray-700 px-6 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">
            WAI <span className="text-gray-500 font-normal">–</span>{' '}
            <span className="text-blue-400">Wawen Autonomous Industries</span>
          </h1>
          {state && (
            <p className="text-xs text-gray-500 mt-0.5">
              Phase: {state.phase} · Milestone: {state.current_milestone}
            </p>
          )}
        </div>

        <div className="flex items-center gap-4">
          {state && (
            <>
              <div className="text-right">
                <p className="text-xs text-gray-500">Online agents</p>
                <p className="text-sm font-semibold text-white">{state.active_agents_count}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">Monthly cost</p>
                <p className={clsx(
                  'text-sm font-semibold',
                  budgetPct !== null && budgetPct >= 80 ? 'text-yellow-400' : 'text-white'
                )}>
                  ${state.monthly_cost_usd.toFixed(2)}
                  {budgetPct !== null && (
                    <span className="text-gray-500 font-normal"> ({budgetPct}%)</span>
                  )}
                </p>
              </div>
            </>
          )}
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" title="System online" />
        </div>
      </div>
    </header>
  )
}
