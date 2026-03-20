import { useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Badge } from './ui/Badge.js'
import { Icon } from './ui/Icon.js'
import { Panel } from './ui/Panel.js'
import { useCapabilitiesRegistry } from '../hooks/useCapabilitiesRegistry.js'
import type {
  CapabilityAssignment,
  CapabilityCatalogEntry,
  CapabilityEvent,
  CapabilityFreshnessState,
  CapabilityHealthState,
  CapabilityRuntimeTarget,
  CapabilityType,
  SkillRunResult,
} from '../types/index.js'

const BACKEND_URL = (import.meta.env['VITE_BACKEND_URL'] as string | undefined) ?? ''

// ─── Labels ────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<CapabilityType, string> = {
  skill: 'Skill',
  plugin: 'Plugin',
  integration: 'Integration',
  memory_provider: 'Memory',
  channel: 'Channel',
}

const RUNTIME_LABELS: Record<CapabilityRuntimeTarget, string> = {
  personal: 'Personal',
  company: 'Company',
  shared: 'Shared',
}

const TARGET_LABELS: Record<CapabilityAssignment['targetType'], string> = {
  runtime: 'Runtime',
  team: 'Team',
  agent: 'Agent',
}

const EVENT_LABELS: Record<CapabilityEvent['event_type'], string> = {
  used: 'Used',
  succeeded: 'Succeeded',
  failed: 'Failed',
  configured: 'Configured',
  enabled: 'Enabled',
  disabled: 'Disabled',
  auth_started: 'Auth Started',
  auth_completed: 'Auth Completed',
}

// ─── Type colour system ─────────────────────────────────────────────────────
// Each capability type has one accent colour used consistently everywhere.

const TYPE_COLORS: Record<CapabilityType, { dot: string; text: string; tab: string; bg: string }> = {
  skill:           { dot: 'bg-cyan-400',    text: 'text-cyan-400',    tab: 'border-cyan-400/60 text-cyan-300',    bg: 'bg-cyan-400/8'    },
  integration:     { dot: 'bg-emerald-400', text: 'text-emerald-400', tab: 'border-emerald-400/60 text-emerald-300', bg: 'bg-emerald-400/8' },
  plugin:          { dot: 'bg-indigo-400',  text: 'text-indigo-400',  tab: 'border-indigo-400/60 text-indigo-300',  bg: 'bg-indigo-400/8'  },
  memory_provider: { dot: 'bg-amber-400',   text: 'text-amber-400',   tab: 'border-amber-400/60 text-amber-300',   bg: 'bg-amber-400/8'   },
  channel:         { dot: 'bg-fuchsia-400', text: 'text-fuchsia-400', tab: 'border-fuchsia-400/60 text-fuchsia-300', bg: 'bg-fuchsia-400/8' },
}

const HEALTH_COLORS: Record<CapabilityHealthState, { dot: string; text: string }> = {
  connected:     { dot: 'bg-emerald-400', text: 'text-emerald-400' },
  degraded:      { dot: 'bg-amber-400',   text: 'text-amber-400'   },
  missing_config:{ dot: 'bg-orange-400',  text: 'text-orange-400'  },
  auth_required: { dot: 'bg-yellow-400',  text: 'text-yellow-400'  },
  failing:       { dot: 'bg-rose-400',    text: 'text-rose-400'    },
  disabled:      { dot: 'bg-slate-600',   text: 'text-slate-500'   },
}

const FRESHNESS_COLORS: Record<CapabilityFreshnessState, string> = {
  fresh:   'text-emerald-400',
  aging:   'text-amber-400',
  stale:   'text-rose-400',
  unknown: 'text-slate-500',
}

// ─── Detail tab types ───────────────────────────────────────────────────────

type DetailTab = 'overview' | 'usage' | 'assignments' | 'policy' | 'activity'

// ─── Governance state ───────────────────────────────────────────────────────

interface GovernanceDraft {
  policyMode: 'open' | 'restricted' | 'approval_required' | 'read_only'
  policyNotes: string
  assignments: Record<string, 'active' | 'disabled'>
}

interface GovernanceSaveState {
  status: 'idle' | 'saving' | 'done' | 'error'
  message?: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTimestamp(value?: string): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('it-IT', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function groupAssignments(assignments: CapabilityAssignment[]) {
  return {
    runtime: assignments.filter((a) => a.targetType === 'runtime'),
    team:    assignments.filter((a) => a.targetType === 'team'),
    agent:   assignments.filter((a) => a.targetType === 'agent'),
  }
}

// ─── Compact list item ──────────────────────────────────────────────────────

function CapabilityListItem({
  entry,
  active,
  onSelect,
}: {
  entry: CapabilityCatalogEntry
  active: boolean
  onSelect: (id: string) => void
}) {
  const { capability, health } = entry
  const typeColor = TYPE_COLORS[capability.type]
  const healthColor = HEALTH_COLORS[health.state]
  const hasDrift = (health.driftWarnings?.length ?? 0) > 0
  const isStale = health.freshness === 'stale'

  return (
    <button
      onClick={() => onSelect(capability.id)}
      className={clsx(
        'group w-full rounded-2xl border px-4 py-3 text-left transition-all',
        active
          ? 'border-white/15 bg-white/[0.06] shadow-[0_0_0_1px_rgba(255,255,255,0.06)]'
          : 'border-white/5 bg-black/20 hover:border-white/10 hover:bg-white/[0.03]'
      )}
    >
      <div className="flex items-center gap-3">
        {/* Type dot */}
        <span className={clsx('mt-px h-2 w-2 flex-shrink-0 rounded-full', typeColor.dot)} />

        {/* Label + meta */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{capability.label}</p>
          <p className={clsx('mt-0.5 text-[11px]', typeColor.text)}>
            {TYPE_LABELS[capability.type]}
            <span className="text-slate-600"> · </span>
            <span className="text-slate-500">{RUNTIME_LABELS[capability.runtimeTarget]}</span>
            {capability.owner && (
              <>
                <span className="text-slate-600"> · </span>
                <span className="text-slate-600">{capability.owner}</span>
              </>
            )}
          </p>
        </div>

        {/* Right: warnings + health dot */}
        <div className="flex flex-shrink-0 items-center gap-2">
          {hasDrift && (
            <span className="text-[10px] font-black text-amber-500">⚠</span>
          )}
          {isStale && (
            <span className="text-[10px] font-black text-rose-500">STALE</span>
          )}
          <span
            className={clsx('h-2.5 w-2.5 rounded-full ring-2 ring-black/40', healthColor.dot)}
            title={health.label}
          />
        </div>
      </div>
    </button>
  )
}

// ─── Detail tabs ────────────────────────────────────────────────────────────

function TabBar({
  active,
  isSkill,
  onChange,
}: {
  active: DetailTab
  isSkill: boolean
  onChange: (tab: DetailTab) => void
}) {
  const tabs: { id: DetailTab; label: string; skillOnly?: boolean }[] = [
    { id: 'overview',    label: 'Overview' },
    { id: 'usage',       label: 'Usage',       skillOnly: true },
    { id: 'assignments', label: 'Assignments' },
    { id: 'policy',      label: 'Policy' },
    { id: 'activity',    label: 'Activity' },
  ]

  return (
    <div className="flex gap-1 border-b border-white/6 pb-1">
      {tabs.map((tab) => {
        if (tab.skillOnly && !isSkill) return null
        const isActive = active === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={clsx(
              'rounded-t px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.15em] transition-all',
              isActive
                ? 'text-white border-b-2 border-[#00D4FF] -mb-[3px] pb-[5px]'
                : 'text-slate-500 hover:text-slate-300'
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── Overview tab ───────────────────────────────────────────────────────────

function OverviewTab({ entry }: { entry: CapabilityCatalogEntry }) {
  const { capability, health } = entry
  const typeColor = TYPE_COLORS[capability.type]
  const healthColor = HEALTH_COLORS[health.state]

  return (
    <div className="space-y-5">
      {/* Identity */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-black text-white">{capability.label}</h3>
          {capability.isPlaceholder && <Badge variant="planned">Placeholder</Badge>}
          <Badge variant={capability.status}>{capability.status}</Badge>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className={clsx('text-[11px] font-semibold', typeColor.text)}>
            {TYPE_LABELS[capability.type]}
          </span>
          <span className="text-slate-600 text-xs">·</span>
          <Badge variant={capability.runtimeTarget}>{RUNTIME_LABELS[capability.runtimeTarget]}</Badge>
          <span className="text-slate-600 text-xs">·</span>
          <span className="text-[11px] text-slate-500">{capability.owner}</span>
          <span className="text-slate-600 text-xs">·</span>
          <Badge variant={capability.riskLevel}>{capability.riskLevel} risk</Badge>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">{capability.description}</p>
      </div>

      {/* Health card */}
      <div className={clsx(
        'rounded-2xl border p-4',
        health.state === 'connected' ? 'border-emerald-500/15 bg-emerald-500/[0.04]' :
        health.state === 'failing'   ? 'border-rose-500/15 bg-rose-500/[0.04]' :
        health.state === 'disabled'  ? 'border-white/6 bg-black/20' :
        'border-amber-500/15 bg-amber-500/[0.04]'
      )}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className={clsx('h-2.5 w-2.5 flex-shrink-0 rounded-full', healthColor.dot)} />
            <p className={clsx('text-sm font-bold', healthColor.text)}>{health.label}</p>
          </div>
          <div className="flex items-center gap-2">
            {health.freshness && (
              <span className={clsx('text-[10px] font-black uppercase tracking-[0.18em]', FRESHNESS_COLORS[health.freshness])}>
                {health.freshness}
              </span>
            )}
            <p className="text-[10px] font-mono text-slate-600">{formatTimestamp(health.checkedAt)}</p>
          </div>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">{health.message}</p>
        {health.driftWarnings && health.driftWarnings.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {health.driftWarnings.map((w) => (
              <div key={w} className="flex items-start gap-2 text-xs text-amber-400">
                <span className="flex-shrink-0">⚠</span>
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}
        {health.missingRequirements.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {health.missingRequirements.map((req) => (
              <Badge key={req} variant="missing_config">{req}</Badge>
            ))}
          </div>
        )}
      </div>

      {/* ID + deps + tags */}
      <div className="rounded-2xl border border-white/5 bg-black/20 px-4 py-3">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Capability ID</p>
        <p className="mt-1 font-mono text-xs text-slate-400">{capability.id}</p>
      </div>

      {capability.dependsOn.length > 0 && (
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Dependencies</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {capability.dependsOn.map((dep) => (
              <Badge key={dep} variant="reference">{dep}</Badge>
            ))}
          </div>
        </div>
      )}

      {capability.tags.length > 0 && (
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Tags</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {capability.tags.map((tag) => (
              <Badge key={tag} variant="default">{tag}</Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Usage tab (skills only) ────────────────────────────────────────────────

type SkillRunState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; result: SkillRunResult }
  | { status: 'approval_required'; message: string }
  | { status: 'error'; message: string }

function UsageTab({ entry }: { entry: CapabilityCatalogEntry }) {
  const { capability, policy } = entry
  const [inputText, setInputText] = useState('')
  const [runState, setRunState] = useState<SkillRunState>({ status: 'idle' })
  const outputRef = useRef<HTMLDivElement>(null)

  // Reset when capability changes
  useEffect(() => {
    setInputText('')
    setRunState({ status: 'idle' })
  }, [capability.id])

  if (capability.type !== 'skill') return null

  const isDisabled = capability.status === 'disabled'
  const needsApproval = policy.mode === 'approval_required'

  async function handleRun(forceApproval = false) {
    setRunState({ status: 'running' })
    try {
      let input: Record<string, unknown> = {}
      const trimmed = inputText.trim()
      if (trimmed) {
        try {
          const parsed = JSON.parse(trimmed) as unknown
          input = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : { prompt: trimmed }
        } catch {
          input = { prompt: trimmed }
        }
      }

      const res = await fetch(`${BACKEND_URL}/api/skills/${encodeURIComponent(capability.id)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, forceApproval }),
      })

      const payload = await res.json() as Record<string, unknown>

      if (!res.ok) {
        if (payload['requiresApproval'] === true) {
          setRunState({ status: 'approval_required', message: String(payload['error'] ?? 'Approval required') })
          return
        }
        throw new Error(String(payload['error'] ?? `HTTP ${res.status}`))
      }

      const result: SkillRunResult = {
        skillId: String(payload['skillId'] ?? capability.id),
        output: String(payload['output'] ?? ''),
        runId: typeof payload['runId'] === 'string' ? payload['runId'] : null,
        durationMs: typeof payload['durationMs'] === 'number' ? payload['durationMs'] : 0,
      }
      setRunState({ status: 'done', result })
      setTimeout(() => outputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80)
    } catch (err) {
      setRunState({ status: 'error', message: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  const hasContent = capability.usageInstructions || (capability.examples && capability.examples.length > 0)

  return (
    <div className="space-y-5">
      {/* Usage instructions */}
      {capability.usageInstructions && (
        <div className="rounded-2xl border border-cyan-500/15 bg-cyan-500/[0.04] p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-600">How to use</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">{capability.usageInstructions}</p>
        </div>
      )}
      {capability.examples && capability.examples.length > 0 && (
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Example Prompts</p>
          <ul className="mt-3 space-y-2">
            {capability.examples.map((ex) => (
              <li key={ex} className="flex items-start gap-3 rounded-xl border border-white/6 bg-black/20 px-4 py-3">
                <span className="mt-0.5 flex-shrink-0 font-mono text-xs text-cyan-500">›</span>
                <span className="text-sm text-slate-300">{ex}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!hasContent && (
        <div className="rounded-2xl border border-dashed border-white/8 px-4 py-6 text-center">
          <p className="text-sm text-slate-500">No usage instructions for this skill yet.</p>
        </div>
      )}

      {/* Run Skill form */}
      <div className="rounded-2xl border border-cyan-500/15 bg-black/30 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-600">Run Skill</p>
          {needsApproval && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-400 uppercase tracking-[0.1em]">
              Approval Required
            </span>
          )}
          {isDisabled && (
            <span className="rounded-full border border-slate-600/30 bg-slate-700/20 px-2 py-0.5 text-[10px] font-bold text-slate-500 uppercase tracking-[0.1em]">
              Disabled
            </span>
          )}
        </div>

        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Optional input — plain text or JSON object"
          disabled={isDisabled || runState.status === 'running'}
          rows={3}
          className="w-full resize-none rounded-xl border border-white/8 bg-black/40 px-3 py-2.5 font-mono text-xs text-slate-300 placeholder-slate-600 outline-none transition focus:border-cyan-500/30 disabled:opacity-40"
        />

        <div className="flex items-center gap-3">
          <button
            onClick={() => void handleRun(false)}
            disabled={isDisabled || runState.status === 'running'}
            className={clsx(
              'flex items-center gap-2 rounded-xl px-4 py-2 text-[11px] font-black uppercase tracking-[0.15em] transition',
              isDisabled
                ? 'cursor-not-allowed border border-slate-700/40 bg-slate-800/20 text-slate-600'
                : runState.status === 'running'
                  ? 'cursor-not-allowed border border-cyan-500/20 bg-cyan-500/10 text-cyan-400'
                  : 'border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:border-cyan-500/50 hover:bg-cyan-500/15'
            )}
          >
            {runState.status === 'running' ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-cyan-500/30 border-t-cyan-400" />
                Running…
              </>
            ) : (
              <>
                <Icon name="play" size={11} />
                Run Skill
              </>
            )}
          </button>

          {needsApproval && runState.status === 'approval_required' && (
            <button
              onClick={() => void handleRun(true)}
              className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[11px] font-black uppercase tracking-[0.15em] text-amber-300 transition hover:border-amber-500/50 hover:bg-amber-500/15"
            >
              Confirm & Run
            </button>
          )}

          {(runState.status === 'done' || runState.status === 'error' || runState.status === 'approval_required') && (
            <button
              onClick={() => setRunState({ status: 'idle' })}
              className="text-[10px] text-slate-600 transition hover:text-slate-400 uppercase tracking-[0.12em]"
            >
              Clear
            </button>
          )}
        </div>

        {/* Output */}
        <div ref={outputRef}>
          {runState.status === 'approval_required' && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.15em] text-amber-500">Approval Required</p>
              <p className="mt-1.5 text-xs leading-relaxed text-amber-300/80">{runState.message}</p>
              <p className="mt-2 text-[10px] text-slate-500">Click "Confirm & Run" above to execute with explicit approval.</p>
            </div>
          )}

          {runState.status === 'error' && (
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.06] px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.15em] text-rose-500">Error</p>
              <p className="mt-1.5 font-mono text-xs text-rose-300/80">{runState.message}</p>
            </div>
          )}

          {runState.status === 'done' && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-emerald-500">Output</p>
                <div className="flex items-center gap-3">
                  {runState.result.runId && (
                    <span className="font-mono text-[10px] text-slate-600">run {runState.result.runId.substring(0, 8)}</span>
                  )}
                  <span className="font-mono text-[10px] text-slate-600">{runState.result.durationMs}ms</span>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-300">{runState.result.output}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Assignments tab ────────────────────────────────────────────────────────

function AssignmentsTab({
  entry,
  draft,
  setDraft,
}: {
  entry: CapabilityCatalogEntry
  draft: GovernanceDraft | null
  setDraft: React.Dispatch<React.SetStateAction<GovernanceDraft | null>>
}) {
  const grouped = groupAssignments(entry.assignments)

  return (
    <div className="space-y-5">
      {(Object.keys(grouped) as Array<keyof typeof grouped>).map((targetType) => (
        <div key={targetType}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">
              {TARGET_LABELS[targetType]}
            </p>
            <Badge variant="status">{grouped[targetType].length}</Badge>
          </div>
          {grouped[targetType].length === 0 ? (
            <p className="text-[11px] text-slate-600 italic">No {targetType} assignments.</p>
          ) : (
            <div className="space-y-2">
              {grouped[targetType].map((assignment) => {
                const draftKey = `${assignment.targetType}:${assignment.targetId}`
                const draftState = draft?.assignments[draftKey] ?? (assignment.state === 'disabled' ? 'disabled' : 'active')
                return (
                  <div key={draftKey} className="rounded-xl border border-white/6 bg-black/20 px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-white">{assignment.label}</p>
                        <Badge variant={assignment.runtimeTarget}>{RUNTIME_LABELS[assignment.runtimeTarget]}</Badge>
                      </div>
                      <select
                        value={draftState}
                        onChange={(e) => setDraft((cur) => cur ? {
                          ...cur,
                          assignments: { ...cur.assignments, [draftKey]: e.target.value as 'active' | 'disabled' },
                        } : cur)}
                        className={clsx(
                          'rounded-lg border px-2 py-1 text-[11px] outline-none transition',
                          draftState === 'active'
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                            : 'border-slate-600/30 bg-slate-700/20 text-slate-400'
                        )}
                      >
                        <option value="active">Active</option>
                        <option value="disabled">Disabled</option>
                      </select>
                    </div>
                    <p className="mt-1 font-mono text-[10px] text-slate-600">{assignment.targetId}</p>
                    {assignment.notes && <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{assignment.notes}</p>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Policy tab ─────────────────────────────────────────────────────────────

function PolicyTab({
  entry,
  draft,
  setDraft,
  saveState,
  onSave,
}: {
  entry: CapabilityCatalogEntry
  draft: GovernanceDraft | null
  setDraft: React.Dispatch<React.SetStateAction<GovernanceDraft | null>>
  saveState: GovernanceSaveState
  onSave: () => void
}) {
  const { policy, health } = entry

  return (
    <div className="space-y-5">
      {/* Mode + notes */}
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 mb-2">Policy Mode</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
          <select
            value={draft?.policyMode ?? policy.mode}
            onChange={(e) => setDraft((cur) => cur ? { ...cur, policyMode: e.target.value as GovernanceDraft['policyMode'] } : cur)}
            className="rounded-xl border border-white/8 bg-black/30 px-3 py-2.5 text-sm text-slate-200 outline-none transition focus:border-[#00D4FF]/35"
          >
            <option value="open">open</option>
            <option value="restricted">restricted</option>
            <option value="approval_required">approval_required</option>
            <option value="read_only">read_only</option>
          </select>
          <textarea
            value={draft?.policyNotes ?? policy.notes ?? ''}
            onChange={(e) => setDraft((cur) => cur ? { ...cur, policyNotes: e.target.value } : cur)}
            rows={2}
            placeholder="Founder note..."
            className="rounded-xl border border-white/8 bg-black/30 px-3 py-2.5 text-sm text-slate-200 outline-none transition focus:border-[#00D4FF]/35 resize-none"
          />
        </div>
      </div>

      {/* Tools */}
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 mb-2">Allowed Tools</p>
        <div className="flex flex-wrap gap-1.5">
          {policy.allowedTools.length === 0
            ? <span className="text-[11px] text-slate-600 italic">No explicit tools</span>
            : policy.allowedTools.map((t) => <Badge key={t} variant="technical">{t}</Badge>)}
        </div>
      </div>

      {/* Env requirements */}
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 mb-2">Env Requirements</p>
        <div className="flex flex-wrap gap-1.5">
          {policy.envRequirements.length === 0
            ? <span className="text-[11px] text-slate-600 italic">None</span>
            : policy.envRequirements.map((e) => (
              <Badge key={e} variant={health.missingRequirements.includes(e) ? 'missing_config' : 'reference'}>{e}</Badge>
            ))}
        </div>
        {health.missingRequirements.length > 0 && (
          <p className="mt-2 text-xs text-amber-400">Missing: {health.missingRequirements.join(', ')}</p>
        )}
      </div>

      {/* Restricted paths */}
      {policy.restrictedPaths.length > 0 && (
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 mb-2">Restricted Paths</p>
          <div className="flex flex-wrap gap-1.5">
            {policy.restrictedPaths.map((p) => <Badge key={p} variant="archive">{p}</Badge>)}
          </div>
        </div>
      )}

      {/* Save governance */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/6 bg-black/20 px-4 py-3">
        {saveState.message && (
          <p className={clsx('text-xs', saveState.status === 'error' ? 'text-rose-400' : 'text-emerald-400')}>
            {saveState.message}
          </p>
        )}
        <div className="ml-auto">
          <button
            onClick={onSave}
            disabled={saveState.status === 'saving'}
            className="rounded-lg border border-[#00D4FF]/25 bg-[#00D4FF]/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-[#00D4FF] transition hover:bg-[#00D4FF]/20 disabled:opacity-50"
          >
            {saveState.status === 'saving' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Activity tab ────────────────────────────────────────────────────────────

function ActivityTab({
  entry,
  events,
}: {
  entry: CapabilityCatalogEntry
  events: CapabilityEvent[]
}) {
  const { health, audit } = entry

  return (
    <div className="space-y-5">
      {/* Health depth */}
      {(health.freshness || health.lastSuccessAt || health.lastFailedAt || health.reasonCode || (health.details?.length ?? 0) > 0) && (
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 mb-3">Health Signals</p>
          <div className="grid grid-cols-2 gap-2">
            {health.freshness && (
              <div className="rounded-xl border border-white/6 bg-black/20 px-3 py-2.5">
                <p className="text-[10px] text-slate-600 uppercase tracking-[0.15em]">Freshness</p>
                <p className={clsx('mt-1 text-xs font-bold uppercase', FRESHNESS_COLORS[health.freshness])}>{health.freshness}</p>
              </div>
            )}
            {health.reasonCode && (
              <div className="rounded-xl border border-white/6 bg-black/20 px-3 py-2.5">
                <p className="text-[10px] text-slate-600 uppercase tracking-[0.15em]">Reason</p>
                <p className="mt-1 font-mono text-xs text-[#00D4FF]">{health.reasonCode}</p>
              </div>
            )}
            {health.lastSuccessAt && (
              <div className="rounded-xl border border-emerald-500/12 bg-emerald-500/[0.04] px-3 py-2.5">
                <p className="text-[10px] text-emerald-700 uppercase tracking-[0.15em]">Last Success</p>
                <p className="mt-1 text-xs text-emerald-300">{formatTimestamp(health.lastSuccessAt)}</p>
              </div>
            )}
            {health.lastFailedAt && (
              <div className="rounded-xl border border-rose-500/12 bg-rose-500/[0.04] px-3 py-2.5">
                <p className="text-[10px] text-rose-700 uppercase tracking-[0.15em]">Last Failure</p>
                <p className="mt-1 text-xs text-rose-300">{formatTimestamp(health.lastFailedAt)}</p>
              </div>
            )}
          </div>
          {health.details && health.details.length > 0 && (
            <ul className="mt-2 space-y-1">
              {health.details.map((line) => (
                <li key={line} className="flex items-start gap-2 text-xs text-slate-400">
                  <span className="flex-shrink-0 text-[#00D4FF]">›</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Audit timeline */}
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 mb-3">Audit Timeline</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Last Change',   value: audit.lastChangedAt,   sub: audit.lastChangedBy },
            { label: 'Last Success',  value: audit.lastSuccessfulAt, sub: undefined },
            { label: 'Last Failure',  value: audit.lastFailedAt,     sub: undefined },
            { label: 'Last Used',     value: audit.lastUsedAt,       sub: undefined },
          ].map(({ label, value, sub }) => (
            <div key={label} className="rounded-xl border border-white/5 bg-black/20 px-3 py-2.5">
              <p className="text-[10px] text-slate-600 uppercase tracking-[0.15em]">{label}</p>
              <p className="mt-1 text-xs text-slate-300">{formatTimestamp(value)}</p>
              {sub && <p className="text-[10px] text-slate-600">{sub}</p>}
            </div>
          ))}
        </div>
        {audit.summary && (
          <p className="mt-3 text-xs leading-relaxed text-slate-500">{audit.summary}</p>
        )}
      </div>

      {/* Events */}
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 mb-3">
          Recent Events <span className="text-slate-700">({events.length})</span>
        </p>
        {events.length === 0 ? (
          <p className="text-xs text-slate-600 italic">No persisted events. Apply migration 007_capability_events.sql.</p>
        ) : (
          <div className="space-y-2">
            {events.map((event) => (
              <div key={event.id} className="rounded-xl border border-white/5 bg-black/20 px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={event.event_type}>{EVENT_LABELS[event.event_type]}</Badge>
                    <p className="text-xs font-semibold text-slate-300">{event.summary}</p>
                  </div>
                  <p className="flex-shrink-0 font-mono text-[10px] text-slate-600">{formatTimestamp(event.created_at)}</p>
                </div>
                <p className="mt-1 text-[10px] text-slate-600">
                  {event.actor_id ?? event.actor_type} · {event.source}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main view ───────────────────────────────────────────────────────────────

export function CapabilitiesView() {
  const { data, loading, error, refetch } = useCapabilitiesRegistry()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | CapabilityType>('all')
  const [runtimeFilter, setRuntimeFilter] = useState<'all' | CapabilityRuntimeTarget>('all')
  const [healthFilter, setHealthFilter] = useState<'all' | CapabilityHealthState>('all')
  const [selectedCapabilityId, setSelectedCapabilityId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<DetailTab>('overview')
  const [draft, setDraft] = useState<GovernanceDraft | null>(null)
  const [saveState, setSaveState] = useState<GovernanceSaveState>({ status: 'idle' })

  // ── filtered catalog ──

  const filteredCatalog = useMemo(() => {
    if (!data) return []
    const query = search.trim().toLowerCase()
    return data.catalog.filter((entry) => {
      if (typeFilter !== 'all' && entry.capability.type !== typeFilter) return false
      if (runtimeFilter !== 'all' && entry.capability.runtimeTarget !== runtimeFilter) return false
      if (healthFilter !== 'all' && entry.health.state !== healthFilter) return false
      if (!query) return true
      const haystack = [
        entry.capability.label,
        entry.capability.description,
        entry.capability.owner,
        entry.capability.id,
        entry.capability.tags.join(' '),
        entry.assignments.map((a) => `${a.label} ${a.targetId}`).join(' '),
      ].join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [data, healthFilter, runtimeFilter, search, typeFilter])

  useEffect(() => {
    if (filteredCatalog.length === 0) { setSelectedCapabilityId(null); return }
    const stillVisible = filteredCatalog.some((e) => e.capability.id === selectedCapabilityId)
    if (!stillVisible) setSelectedCapabilityId(filteredCatalog[0].capability.id)
  }, [filteredCatalog, selectedCapabilityId])

  const selectedEntry = useMemo(
    () => filteredCatalog.find((e) => e.capability.id === selectedCapabilityId) ?? filteredCatalog[0] ?? null,
    [filteredCatalog, selectedCapabilityId]
  )

  const selectedRecentEvents = useMemo(
    () => selectedEntry
      ? (data?.recentEvents ?? []).filter((ev) => ev.capability_id === selectedEntry.capability.id).slice(0, 8)
      : [],
    [data, selectedEntry]
  )

  // Reset tab and draft when selection changes
  useEffect(() => {
    setActiveTab('overview')
    if (!selectedEntry) { setDraft(null); return }
    setDraft({
      policyMode: selectedEntry.policy.mode,
      policyNotes: selectedEntry.policy.notes ?? '',
      assignments: Object.fromEntries(
        selectedEntry.assignments.map((a) => [
          `${a.targetType}:${a.targetId}`,
          a.state === 'disabled' ? 'disabled' : 'active',
        ])
      ),
    })
    setSaveState({ status: 'idle' })
  }, [selectedEntry])

  // ── save governance ──

  async function handleSaveGovernance() {
    if (!selectedEntry || !draft) return
    try {
      setSaveState({ status: 'saving' })
      const res = await fetch(`${BACKEND_URL}/api/capabilities/${encodeURIComponent(selectedEntry.capability.id)}/governance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          policyMode: draft.policyMode,
          policyNotes: draft.policyNotes.trim() || null,
          assignments: selectedEntry.assignments.map((a) => ({
            targetType: a.targetType,
            targetId: a.targetId,
            state: draft.assignments[`${a.targetType}:${a.targetId}`] ?? 'active',
            notes: a.notes ?? null,
          })),
        }),
      })
      const payload = await res.json() as { error?: string }
      if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`)
      await refetch()
      setSaveState({ status: 'done', message: 'Saved' })
    } catch (err) {
      setSaveState({ status: 'error', message: err instanceof Error ? err.message : 'Failed' })
    }
  }

  // ── loading / error ──

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[420px] gap-4">
        <div className="w-10 h-10 border-4 border-[#00D4FF]/20 border-t-[#00D4FF] rounded-full animate-spin" />
        <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em]">Loading…</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="rounded-3xl border border-rose-500/20 bg-rose-500/5 p-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-rose-400">Capabilities unavailable</p>
            <p className="mt-1 text-xs text-slate-500">{error ?? 'Unknown error'}</p>
          </div>
          <button onClick={() => void refetch()} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-300 transition hover:border-[#00D4FF]/30 hover:text-[#00D4FF]">
            Retry
          </button>
        </div>
      </div>
    )
  }

  const isSkillSelected = selectedEntry?.capability.type === 'skill'

  return (
    <div className="space-y-4 pb-20 animate-fade-in">

      {/* ── Compact header ─────────────────────────────────────────────── */}
      <section className="rounded-3xl border border-white/5 bg-[#070C1A] px-6 py-5">
        {/* Row 1: title + snapshot */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#00D4FF]/20 bg-[#00D4FF]/[0.08] text-[#00D4FF]">
              <Icon name="cpu" size={16} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#00D4FF]">Capability Platform</p>
              <p className="text-base font-black text-white">Control plane</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <p className="font-mono text-[11px] text-slate-600">{formatTimestamp(data.generatedAt)}</p>
            <button
              onClick={() => void refetch()}
              className="flex items-center gap-1.5 rounded-xl border border-white/8 bg-black/20 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 transition hover:border-[#00D4FF]/25 hover:text-[#00D4FF]"
            >
              <Icon name="refresh" size={11} />
              Refresh
            </button>
          </div>
        </div>

        {/* Row 2: type breakdown (clickable pills = primary type filter) */}
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'all' as const,             label: 'All',         count: data.summary.total,                      color: 'text-white border-white/15' },
              { id: 'skill' as const,            label: 'Skills',      count: data.summary.byType.skill,               color: 'text-cyan-400 border-cyan-400/25' },
              { id: 'integration' as const,      label: 'Integrations',count: data.summary.byType.integration,         color: 'text-emerald-400 border-emerald-400/25' },
              { id: 'plugin' as const,           label: 'Plugins',     count: data.summary.byType.plugin,              color: 'text-indigo-400 border-indigo-400/25' },
              { id: 'memory_provider' as const,  label: 'Memory',      count: data.summary.byType.memory_provider,     color: 'text-amber-400 border-amber-400/25' },
              { id: 'channel' as const,          label: 'Channels',    count: data.summary.byType.channel,             color: 'text-fuchsia-400 border-fuchsia-400/25' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setTypeFilter(tab.id)}
              className={clsx(
                'rounded-2xl border px-3 py-1.5 text-[11px] font-bold transition-all',
                typeFilter === tab.id
                  ? `${tab.color} bg-white/[0.07]`
                  : 'border-white/6 bg-black/20 text-slate-500 hover:border-white/10 hover:text-slate-300'
              )}
            >
              {tab.label}
              <span className="ml-1.5 font-mono opacity-60">{tab.count}</span>
            </button>
          ))}
        </div>

        {/* Row 3: health summary (read-only dots) */}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {(
            [
              { state: 'connected' as const,      count: data.summary.byHealth.connected,      label: 'connected' },
              { state: 'degraded' as const,        count: data.summary.byHealth.degraded,        label: 'degraded' },
              { state: 'auth_required' as const,   count: data.summary.byHealth.auth_required,   label: 'auth req' },
              { state: 'failing' as const,         count: data.summary.byHealth.failing,         label: 'failing' },
              { state: 'missing_config' as const,  count: data.summary.byHealth.missing_config,  label: 'no config' },
              { state: 'disabled' as const,        count: data.summary.byHealth.disabled,        label: 'disabled' },
            ] as const
          ).filter(({ count }) => count > 0).map(({ state, count, label }) => (
            <button
              key={state}
              onClick={() => setHealthFilter(healthFilter === state ? 'all' : state)}
              className={clsx(
                'flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[10px] font-bold transition-all',
                healthFilter === state
                  ? `${HEALTH_COLORS[state].text} border-current/30 bg-current/[0.06]`
                  : 'border-white/5 bg-transparent text-slate-600 hover:text-slate-400'
              )}
            >
              <span className={clsx('h-1.5 w-1.5 rounded-full flex-shrink-0', HEALTH_COLORS[state].dot)} />
              {count} {label}
            </button>
          ))}
        </div>
      </section>

      {/* ── Search + runtime filter (single compact row) ────────────── */}
      <section className="flex flex-wrap items-center gap-3 px-1">
        <div className="flex-1 min-w-[180px]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search capabilities…"
            className="w-full rounded-2xl border border-white/8 bg-black/30 px-4 py-2.5 text-sm text-slate-200 outline-none transition focus:border-[#00D4FF]/35 placeholder:text-slate-600"
          />
        </div>
        {/* Runtime filter pills */}
        <div className="flex items-center gap-1.5">
          {(['all', 'personal', 'company', 'shared'] as const).map((rt) => (
            <button
              key={rt}
              onClick={() => setRuntimeFilter(rt)}
              className={clsx(
                'rounded-xl border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] transition',
                runtimeFilter === rt
                  ? rt === 'personal' ? 'border-[#7CF6E6]/30 bg-[#7CF6E6]/10 text-[#7CF6E6]'
                    : rt === 'company' ? 'border-[#00D4FF]/30 bg-[#00D4FF]/10 text-[#00D4FF]'
                    : rt === 'shared'  ? 'border-violet-400/30 bg-violet-400/10 text-violet-300'
                    : 'border-white/15 bg-white/8 text-white'
                  : 'border-white/6 bg-black/20 text-slate-500 hover:text-slate-300'
              )}
            >
              {rt === 'all' ? 'All runtime' : rt}
            </button>
          ))}
        </div>
      </section>

      {/* ── Main grid ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">

        {/* Left: catalog list */}
        <Panel
          title={`${filteredCatalog.length} capability${filteredCatalog.length !== 1 ? 's' : ''}`}
          accent="cyan"
          className="min-h-[640px]"
        >
          {filteredCatalog.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/8 px-4 py-16 text-center">
              <p className="text-sm text-slate-500">No capabilities match this filter.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredCatalog.map((entry) => (
                <CapabilityListItem
                  key={entry.capability.id}
                  entry={entry}
                  active={entry.capability.id === selectedEntry?.capability.id}
                  onSelect={setSelectedCapabilityId}
                />
              ))}
            </div>
          )}
        </Panel>

        {/* Right: detail panel with tabs */}
        {selectedEntry ? (
          <div className="rounded-3xl border border-white/5 bg-white/[0.015] p-5">
            {/* Type accent strip */}
            <div className={clsx('mb-4 rounded-2xl px-4 py-3', TYPE_COLORS[selectedEntry.capability.type].bg)}>
              <div className="flex items-center gap-2">
                <span className={clsx('h-2 w-2 rounded-full flex-shrink-0', TYPE_COLORS[selectedEntry.capability.type].dot)} />
                <p className={clsx('text-xs font-black uppercase tracking-[0.18em]', TYPE_COLORS[selectedEntry.capability.type].text)}>
                  {TYPE_LABELS[selectedEntry.capability.type]}
                </p>
                <span className="mx-1 text-slate-600">·</span>
                <p className="text-sm font-black text-white truncate">{selectedEntry.capability.label}</p>
                <div className="ml-auto flex-shrink-0">
                  <span className={clsx('h-2.5 w-2.5 inline-block rounded-full ring-2 ring-black/30', HEALTH_COLORS[selectedEntry.health.state].dot)} />
                </div>
              </div>
            </div>

            {/* Tabs */}
            <TabBar active={activeTab} isSkill={isSkillSelected} onChange={setActiveTab} />

            {/* Tab content */}
            <div className="mt-5 min-h-[480px]">
              {activeTab === 'overview'    && <OverviewTab entry={selectedEntry} />}
              {activeTab === 'usage'       && isSkillSelected && <UsageTab entry={selectedEntry} />}
              {activeTab === 'assignments' && (
                <AssignmentsTab entry={selectedEntry} draft={draft} setDraft={setDraft} />
              )}
              {activeTab === 'policy'      && (
                <PolicyTab
                  entry={selectedEntry}
                  draft={draft}
                  setDraft={setDraft}
                  saveState={saveState}
                  onSave={() => void handleSaveGovernance()}
                />
              )}
              {activeTab === 'activity'    && <ActivityTab entry={selectedEntry} events={selectedRecentEvents} />}
            </div>
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-white/8 px-4 py-20 text-center">
            <p className="text-sm text-slate-500">Select a capability from the list.</p>
          </div>
        )}
      </div>
    </div>
  )
}
