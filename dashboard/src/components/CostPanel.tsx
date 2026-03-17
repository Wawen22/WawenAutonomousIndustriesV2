import { clsx } from 'clsx'
import { format } from 'date-fns'
import { Panel } from './ui/Panel.js'
import { Stat } from './ui/Stat.js'
import { Badge } from './ui/Badge.js'
import { useProjectState, useRecentRuns } from '../hooks/useSupabaseRealtime.js'

// ---------------------------------------------------------------------------
// Budget bar
// ---------------------------------------------------------------------------

function BudgetGauge({ current, total }: { current: number; total: number }) {
  const pct    = Math.min((current / total) * 100, 100)
  const color  = pct >= 90 ? 'bg-rose-500'    : pct >= 70 ? 'bg-amber-500'  : 'bg-emerald-500'
  const glow   = pct >= 90 ? 'shadow-glow-rose': pct >= 70 ? ''              : 'shadow-glow-emerald'
  const label  = pct >= 90 ? 'text-rose-400'  : pct >= 70 ? 'text-amber-400': 'text-emerald-400'

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-slate-500 uppercase tracking-wider font-medium">Monthly Budget</span>
        <span className={clsx('text-sm font-bold font-tabular', label)}>
          ${current.toFixed(2)} <span className="text-slate-600 font-normal">/ ${total.toFixed(0)}</span>
        </span>
      </div>

      {/* Track */}
      <div className="relative h-2 bg-white/[0.06] rounded-full overflow-hidden">
        <div
          className={clsx('h-full rounded-full transition-all duration-700', color, glow)}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex justify-between">
        <span className={clsx('text-[11px] font-semibold font-tabular', label)}>
          {pct.toFixed(1)}% used
        </span>
        <span className="text-[11px] text-slate-600">
          ${(total - current).toFixed(2)} remaining
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Model cost bar
// ---------------------------------------------------------------------------

function ModelBar({ modelId, cost, maxCost }: { modelId: string; cost: number; maxCost: number }) {
  const pct = maxCost > 0 ? (cost / maxCost) * 100 : 0
  const isGpt = modelId.includes('gpt')

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span
          className={clsx(
            'text-xs font-mono font-semibold px-1.5 py-0.5 rounded',
            isGpt
              ? 'text-[#00D4FF] bg-[#00D4FF]/[0.07]'
              : 'text-violet-400 bg-violet-400/[0.07]'
          )}
        >
          {modelId}
        </span>
        <span className="text-xs font-semibold font-tabular text-white">${cost.toFixed(4)}</span>
      </div>
      <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
        <div
          className={clsx('h-full rounded-full transition-all duration-500', isGpt ? 'bg-[#00D4FF]' : 'bg-violet-500')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Run row
// ---------------------------------------------------------------------------

function RunRow({ run }: { run: { id: string; agent_id: string; model_id: string; outcome: string; cost_usd: number; duration_ms: number; created_at: string } }) {
  const isSuccess = run.outcome === 'success'
  const isGpt     = run.model_id.includes('gpt')

  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center py-2.5 border-b border-white/[0.04] last:border-0 text-xs">
      <div className="min-w-0">
        <p className="text-slate-300 font-mono truncate">{run.agent_id}</p>
        <p className="text-slate-600 font-mono text-[10px]">{format(new Date(run.created_at), 'HH:mm:ss')}</p>
      </div>
      <span
        className={clsx(
          'text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded whitespace-nowrap',
          isGpt ? 'text-[#00D4FF] bg-[#00D4FF]/[0.07]' : 'text-violet-400 bg-violet-400/[0.07]'
        )}
      >
        {run.model_id.split('-').slice(0, 2).join('-')}
      </span>
      <Badge variant={isSuccess ? 'done' : run.outcome === 'partial' ? 'warning' : 'error'}>
        {run.outcome}
      </Badge>
      <span className="text-slate-400 font-mono font-tabular text-right whitespace-nowrap">
        ${run.cost_usd.toFixed(4)}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function CostPanel() {
  const { state, loading: sLoad } = useProjectState()
  const { data: runs, loading: rLoad } = useRecentRuns(50)

  if (sLoad || rLoad) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-5 h-5 border-2 border-[#00D4FF]/30 border-t-[#00D4FF] rounded-full animate-spin" />
      </div>
    )
  }

  // Derived metrics
  const totalCost   = runs.reduce((s, r) => s + (r.cost_usd ?? 0), 0)
  const successRate = runs.length > 0
    ? Math.round((runs.filter((r) => r.outcome === 'success').length / runs.length) * 100)
    : 100
  const avgDuration = runs.length > 0
    ? Math.round(runs.reduce((s, r) => s + r.duration_ms, 0) / runs.length)
    : 0
  const totalTokens = runs.reduce((s, r) => s + r.tokens_input + r.tokens_output, 0)

  // Cost by model
  const costByModel = runs.reduce<Record<string, number>>((acc, r) => {
    acc[r.model_id] = (acc[r.model_id] ?? 0) + (r.cost_usd ?? 0)
    return acc
  }, {})
  const maxModelCost = Math.max(...Object.values(costByModel), 0.0001)

  return (
    <div className="animate-fade-in space-y-5">

      {/* Budget gauge */}
      {state && (
        <Panel>
          <BudgetGauge current={state.monthly_cost_usd} total={state.monthly_budget_usd} />
        </Panel>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat
          label="Runs Tracked"
          value={runs.length}
          sub="last 50 shown"
          color="sky"
        />
        <Stat
          label="Success Rate"
          value={`${successRate}%`}
          sub={`${runs.filter((r) => r.outcome === 'failure').length} failures`}
          color={successRate < 90 ? 'amber' : 'emerald'}
        />
        <Stat
          label="Total Cost"
          value={`$${totalCost.toFixed(4)}`}
          sub="last 50 runs"
          color="cyan"
        />
        <Stat
          label="Avg Duration"
          value={`${(avgDuration / 1000).toFixed(1)}s`}
          sub={`${(totalTokens / 1000).toFixed(1)}k tokens`}
          color="default"
        />
      </div>

      {/* Two-col: model breakdown + run log */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

        {/* Model cost breakdown */}
        <Panel title="Cost by Model">
          {Object.keys(costByModel).length === 0 ? (
            <p className="text-sm text-slate-600 text-center py-4">No runs yet</p>
          ) : (
            <div className="space-y-4">
              {Object.entries(costByModel)
                .sort(([, a], [, b]) => b - a)
                .map(([modelId, cost]) => (
                  <ModelBar key={modelId} modelId={modelId} cost={cost} maxCost={maxModelCost} />
                ))}
            </div>
          )}
        </Panel>

        {/* Cost by agent (top 5) */}
        <Panel title="Top Agents by Cost">
          {runs.length === 0 ? (
            <p className="text-sm text-slate-600 text-center py-4">No runs yet</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(
                runs.reduce<Record<string, number>>((acc, r) => {
                  acc[r.agent_id] = (acc[r.agent_id] ?? 0) + (r.cost_usd ?? 0)
                  return acc
                }, {})
              )
                .sort(([, a], [, b]) => b - a)
                .slice(0, 6)
                .map(([agentId, cost]) => (
                  <div key={agentId} className="flex items-center justify-between">
                    <span className="text-xs text-slate-400 font-mono">{agentId}</span>
                    <span className="text-xs font-semibold font-tabular text-white">${cost.toFixed(4)}</span>
                  </div>
                ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Recent runs table */}
      <Panel title="Recent Runs" headerRight={
        <span className="text-[11px] text-slate-600 font-mono">{runs.length} total</span>
      } noPad>
        {runs.length === 0 ? (
          <p className="text-sm text-slate-600 text-center py-8">No runs recorded yet</p>
        ) : (
          <div className="px-5 py-1 max-h-72 overflow-y-auto">
            {runs.slice(0, 25).map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}
