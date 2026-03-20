// ============================================================
// WAI Dashboard – Models View (T105)
// Registry + agent assignments + governance dropdowns.
// ============================================================

import { useState, useEffect, useCallback } from 'react'
import { clsx } from 'clsx'
import { Icon } from './ui/Icon.js'
import type { ModelConfig, ModelsResponse } from '../types/index.js'

const BACKEND = import.meta.env['VITE_BACKEND_URL'] ?? 'http://localhost:3001'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDER_COLOR: Record<string, string> = {
  azure: 'text-sky-400 border-sky-400/30 bg-sky-400/10',
  google: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10',
  openai: 'text-violet-400 border-violet-400/30 bg-violet-400/10',
  openrouter: 'text-amber-400 border-amber-400/30 bg-amber-400/10',
  local: 'text-slate-400 border-slate-400/30 bg-slate-400/10',
}

function providerColor(provider: string): string {
  return PROVIDER_COLOR[provider] ?? 'text-slate-400 border-slate-400/30 bg-slate-400/10'
}

function formatContext(ctx: number): string {
  if (ctx >= 1_000_000) return `${(ctx / 1_000_000).toFixed(0)}M`
  if (ctx >= 1_000) return `${(ctx / 1_000).toFixed(0)}k`
  return String(ctx)
}

function formatCost(perK: number): string {
  if (perK === 0) return 'FREE'
  if (perK < 0.001) return `$${(perK * 1000).toFixed(3)}/M`
  return `$${perK.toFixed(4)}/k`
}

// ---------------------------------------------------------------------------
// Model registry table
// ---------------------------------------------------------------------------

function ModelRegistryTable({ models }: { models: Record<string, ModelConfig> }) {
  const sorted = Object.values(models).sort((a, b) => {
    // Free models first, then by provider
    if (a.cost_per_1k_input_tokens === 0 && b.cost_per_1k_input_tokens > 0) return -1
    if (a.cost_per_1k_input_tokens > 0 && b.cost_per_1k_input_tokens === 0) return 1
    return a.provider.localeCompare(b.provider)
  })

  return (
    <div className="rounded-xl border border-white/[0.06] overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/[0.06] bg-white/[0.02]">
            <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.22em] text-slate-600">Model</th>
            <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.22em] text-slate-600">Provider</th>
            <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.22em] text-slate-600">Input</th>
            <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.22em] text-slate-600">Output</th>
            <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.22em] text-slate-600">Context</th>
            <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.22em] text-slate-600">State</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((model) => {
            const isFree = model.cost_per_1k_input_tokens === 0 && model.cost_per_1k_output_tokens === 0
            const isWatchModel = model.id === 'qwen3-coder'
            return (
              <tr key={model.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-bold text-[11px]">{model.display_name}</span>
                    {isFree && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-[0.15em] bg-amber-400/10 text-amber-400 border border-amber-400/30">
                        FREE
                      </span>
                    )}
                    {isWatchModel && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-[0.15em] bg-white/5 text-slate-400 border border-white/10">
                        WATCH
                      </span>
                    )}
                  </div>
                  {model.notes && (
                    <p className="text-[10px] text-slate-600 mt-0.5 max-w-[320px] leading-relaxed">{model.notes}</p>
                  )}
                  {isWatchModel && (
                    <p className="text-[10px] text-slate-500 mt-1 max-w-[320px] leading-relaxed">
                      Reminder: keep out of the default coding path until a better coding candidate is promoted.
                    </p>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span className={clsx('px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-[0.15em] border', providerColor(model.provider))}>
                    {model.provider}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-slate-400">{formatCost(model.cost_per_1k_input_tokens)}</td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-slate-400">{formatCost(model.cost_per_1k_output_tokens)}</td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-slate-400">{formatContext(model.context_window)}</td>
                <td className="px-4 py-2.5">
                  <span className={clsx(
                    'px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-[0.15em] border',
                    model.is_active
                      ? 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10'
                      : 'text-slate-500 border-slate-500/30 bg-slate-500/10'
                  )}>
                    {model.is_active ? 'active' : 'disabled'}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Agent assignments table
// ---------------------------------------------------------------------------

const AGENT_LABELS: Record<string, string> = {
  ceo: 'CEO',
  pm_saas: 'PM SaaS',
  dev_lead_saas: 'Dev Lead SaaS',
  dev_saas_1: 'Dev SaaS 1',
  dev_saas_2: 'Dev SaaS 2',
  architect: 'Architect',
  dev_general_1: 'Dev General 1',
  dev_general_2: 'Dev General 2',
  qa: 'QA',
  consulting_lead: 'Consulting Lead',
  analyst: 'Analyst',
  marketing_strategist: 'Marketing Strategist',
  content_creator: 'Content Creator',
  social_manager: 'Social Manager',
  ops: 'Ops',
  finance: 'Finance',
  hr: 'HR',
}

interface AssignmentsTableProps {
  models: Record<string, ModelConfig>
  assignments: Record<string, string>
  defaults: Record<string, string>
  overrides: Record<string, string>
  pendingChanges: Record<string, string>
  onChangePending: (agentId: string, modelId: string) => void
}

function AgentAssignmentsTable({
  models,
  assignments,
  defaults,
  overrides,
  pendingChanges,
  onChangePending,
}: AssignmentsTableProps) {
  const modelOptions = Object.values(models)
  const agentIds = Object.keys(assignments)

  return (
    <div className="rounded-xl border border-white/[0.06] overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/[0.06] bg-white/[0.02]">
            <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.22em] text-slate-600">Agent</th>
            <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.22em] text-slate-600">Default</th>
            <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.22em] text-slate-600">Effective Model</th>
            <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.22em] text-slate-600">Override</th>
          </tr>
        </thead>
        <tbody>
          {agentIds.map((agentId) => {
            const defaultModelId = defaults[agentId] ?? 'step-flash'
            const effectiveModelId = assignments[agentId] ?? defaultModelId
            const hasOverride = agentId in overrides
            const pendingModelId = pendingChanges[agentId]
            const currentSelection = pendingModelId ?? effectiveModelId
            const effectiveModel = models[effectiveModelId]
            const isFree = effectiveModel && effectiveModel.cost_per_1k_input_tokens === 0

            return (
              <tr key={agentId} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                <td className="px-4 py-2.5">
                  <span className="text-white font-bold text-[11px]">{AGENT_LABELS[agentId] ?? agentId}</span>
                  <p className="text-[10px] text-slate-600 font-mono">{agentId}</p>
                </td>
                <td className="px-4 py-2.5">
                  <span className="text-slate-500 text-[11px] font-mono">{defaultModelId}</span>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className={clsx('text-[11px] font-bold', hasOverride ? 'text-[#00D4FF]' : 'text-slate-300')}>
                      {effectiveModelId}
                    </span>
                    {isFree && (
                      <span className="px-1 py-0.5 rounded text-[8px] font-black uppercase tracking-[0.15em] bg-amber-400/10 text-amber-400 border border-amber-400/30">
                        FREE
                      </span>
                    )}
                    {hasOverride && (
                      <span className="px-1 py-0.5 rounded text-[8px] font-black uppercase tracking-[0.15em] bg-[#00D4FF]/10 text-[#00D4FF] border border-[#00D4FF]/30">
                        OVERRIDE
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <select
                    value={currentSelection}
                    onChange={(e) => onChangePending(agentId, e.target.value)}
                    className={clsx(
                      'rounded-lg border px-2.5 py-1.5 text-[11px] bg-black/40 text-slate-200 outline-none transition',
                      pendingModelId && pendingModelId !== effectiveModelId
                        ? 'border-[#00D4FF]/40 text-[#00D4FF]'
                        : 'border-white/10 hover:border-white/20'
                    )}
                  >
                    {modelOptions.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.display_name}{m.cost_per_1k_input_tokens === 0 ? ' [FREE]' : ''}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function ModelsView() {
  const [data, setData] = useState<ModelsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingChanges, setPendingChanges] = useState<Record<string, string>>({})
  const [pendingSpecialOverrides, setPendingSpecialOverrides] = useState<Record<string, string | null>>({})
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ ok: boolean; message: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${BACKEND}/api/models`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json() as ModelsResponse
      setData(json)
      setPendingChanges({})
      setPendingSpecialOverrides({})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load models')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  function handleChangePending(agentId: string, modelId: string) {
    setPendingChanges((prev) => {
      const current = data?.assignments[agentId] ?? ''
      if (modelId === current) {
        const next = { ...prev }
        delete next[agentId]
        return next
      }
      return { ...prev, [agentId]: modelId }
    })
    setSaveResult(null)
  }

  function handleChangeSpecialOverride(id: string, modelId: string | null) {
    setPendingSpecialOverrides((prev) => {
      const current = data?.special_overrides.find((item) => item.id === id)?.model_id ?? null
      if (modelId === current) {
        const next = { ...prev }
        delete next[id]
        return next
      }
      return { ...prev, [id]: modelId }
    })
    setSaveResult(null)
  }

  const pendingAgentCount = Object.keys(pendingChanges).filter(
    (id) => pendingChanges[id] !== data?.assignments[id]
  ).length
  const pendingSpecialCount = Object.keys(pendingSpecialOverrides).filter((id) => {
    const current = data?.special_overrides.find((item) => item.id === id)?.model_id ?? null
    return pendingSpecialOverrides[id] !== current
  }).length
  const pendingCount = pendingAgentCount + pendingSpecialCount

  async function handleSave() {
    if (pendingCount === 0) return
    setSaving(true)
    setSaveResult(null)
    let errors = 0

    for (const [agentId, modelId] of Object.entries(pendingChanges)) {
      if (modelId === data?.assignments[agentId]) continue
      try {
        const res = await fetch(`${BACKEND}/api/models/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId, modelId }),
        })
        if (!res.ok) errors++
      } catch {
        errors++
      }
    }

    for (const [id, modelId] of Object.entries(pendingSpecialOverrides)) {
      const current = data?.special_overrides.find((item) => item.id === id)?.model_id ?? null
      if (modelId === current) continue
      try {
        const res = await fetch(`${BACKEND}/api/models/special-override`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, modelId }),
        })
        if (!res.ok) errors++
      } catch {
        errors++
      }
    }

    setSaving(false)
    if (errors > 0) {
      setSaveResult({ ok: false, message: `${errors} model policy change(s) failed to save.` })
    } else {
      setSaveResult({ ok: true, message: `${pendingCount} model policy change(s) saved.` })
      await load()
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[300px]">
        <div className="w-6 h-6 border-2 border-[#00D4FF]/30 border-t-[#00D4FF] rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[300px] gap-3">
        <p className="text-rose-400 text-sm">{error ?? 'No data'}</p>
        <button
          onClick={() => void load()}
          className="text-[11px] text-[#00D4FF] border border-[#00D4FF]/30 rounded px-3 py-1 hover:bg-[#00D4FF]/10 transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  const freeCount = Object.values(data.models).filter((m) => m.cost_per_1k_input_tokens === 0).length
  const overrideCount = Object.keys(data.overrides).length

  return (
    <div className="space-y-6 max-w-5xl">

      <div className="rounded-xl border border-[#00D4FF]/15 bg-[#00D4FF]/[0.04] px-4 py-4">
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#00D4FF]">Routing Policy</p>
        <div className="mt-3 space-y-2">
          {data.routing_notes.map((note) => (
            <p key={note} className="text-[12px] leading-relaxed text-slate-300">{note}</p>
          ))}
        </div>
        {data.special_overrides.length > 0 && (
          <div className="mt-4 space-y-3">
            {data.special_overrides.map((override) => (
              <div key={override.id} className="rounded-lg border border-white/10 bg-black/20 px-3 py-3">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white">{override.scope}</span>
                      <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-[0.15em] bg-[#00D4FF]/10 text-[#00D4FF] border border-[#00D4FF]/30">
                        {override.model_id ?? override.unset_label}
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-400">{override.reason}</p>
                    <p className="mt-2 text-[10px] font-mono text-slate-500">
                      Agents: {override.agents.join(', ')}
                    </p>
                  </div>
                  <div className="min-w-[260px]">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Founder override</p>
                    <select
                      value={pendingSpecialOverrides[override.id] ?? override.model_id ?? '__unset__'}
                      onChange={(event) => handleChangeSpecialOverride(
                        override.id,
                        event.target.value === '__unset__' ? null : event.target.value
                      )}
                      className="mt-2 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-[11px] text-slate-200 outline-none transition hover:border-white/20 focus:border-[#00D4FF]/40"
                    >
                      <option value="__unset__">{override.unset_label}</option>
                      {Object.values(data.models).map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.display_name}{model.cost_per_1k_input_tokens === 0 ? ' [FREE]' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Header stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Models', value: Object.keys(data.models).length, sub: 'in registry' },
          { label: 'Free', value: freeCount, sub: 'via OpenRouter', accent: 'text-amber-400' },
          { label: 'Overrides', value: overrideCount, sub: 'active assignments', accent: 'text-[#00D4FF]' },
        ].map(({ label, value, sub, accent }) => (
          <div key={label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-600">{label}</p>
            <p className={clsx('text-2xl font-black mt-1', accent ?? 'text-white')}>{value}</p>
            <p className="text-[10px] text-slate-600 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Model registry */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Icon name="models" size={14} className="text-[#00D4FF]" />
          <h2 className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Model Registry</h2>
          <button
            onClick={() => void load()}
            className="ml-auto p-1 rounded text-slate-600 hover:text-slate-300 transition-colors"
            title="Refresh"
          >
            <Icon name="refresh" size={13} />
          </button>
        </div>
        <ModelRegistryTable models={data.models} />
      </div>

      {/* Agent assignments */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Icon name="team" size={14} className="text-[#00D4FF]" />
          <h2 className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Agent Model Assignments</h2>

          {pendingCount > 0 && (
            <span className="ml-2 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-[0.15em] bg-[#00D4FF]/10 text-[#00D4FF] border border-[#00D4FF]/30">
              {pendingCount} pending
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            {saveResult && (
              <span className={clsx('text-[11px] font-bold', saveResult.ok ? 'text-emerald-400' : 'text-rose-400')}>
                {saveResult.message}
              </span>
            )}
            <button
              onClick={() => void handleSave()}
              disabled={pendingCount === 0 || saving}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-[0.15em] border transition-all',
                pendingCount > 0 && !saving
                  ? 'border-[#00D4FF]/40 text-[#00D4FF] hover:bg-[#00D4FF]/10 cursor-pointer'
                  : 'border-white/10 text-slate-600 cursor-not-allowed'
              )}
            >
              {saving ? (
                <div className="w-3 h-3 border border-[#00D4FF]/30 border-t-[#00D4FF] rounded-full animate-spin" />
              ) : (
                <Icon name="check" size={12} />
              )}
              Save
            </button>
          </div>
        </div>

        <AgentAssignmentsTable
          models={data.models}
          assignments={data.assignments}
          defaults={data.defaults}
          overrides={data.overrides}
          pendingChanges={pendingChanges}
          onChangePending={handleChangePending}
        />
        <p className="mt-3 text-[11px] text-slate-500">
          Saving an agent back to its default model removes the override. Normal runs use the assignment shown here immediately. Special policies above either inherit the agent assignment or stay disabled until you explicitly force a model.
        </p>
      </div>
    </div>
  )
}
