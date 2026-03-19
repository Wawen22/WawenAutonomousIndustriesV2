import { useEffect, useMemo, useState } from 'react'
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
} from '../types/index.js'

const BACKEND_URL = (import.meta.env['VITE_BACKEND_URL'] as string | undefined) ?? 'http://localhost:3001'

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

function formatTimestamp(value?: string): string {
  if (!value) return 'n/a'
  return new Date(value).toLocaleString('it-IT', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface GovernanceDraft {
  policyMode: 'open' | 'restricted' | 'approval_required' | 'read_only'
  policyNotes: string
  assignments: Record<string, 'active' | 'disabled'>
}

interface GovernanceSaveState {
  status: 'idle' | 'saving' | 'done' | 'error'
  message?: string
}

const FRESHNESS_CONFIG: Record<CapabilityFreshnessState, { label: string; color: string }> = {
  fresh:   { label: 'Fresh',   color: 'text-emerald-400' },
  aging:   { label: 'Aging',   color: 'text-amber-400' },
  stale:   { label: 'Stale',   color: 'text-rose-400' },
  unknown: { label: 'Unknown', color: 'text-slate-500' },
}

function FreshnessPill({ freshness }: { freshness: CapabilityFreshnessState }) {
  const cfg = FRESHNESS_CONFIG[freshness]
  return (
    <span className={clsx('text-[10px] font-black uppercase tracking-[0.18em]', cfg.color)}>
      {cfg.label}
    </span>
  )
}

function HealthDepthPanel({ entry }: { entry: CapabilityCatalogEntry }) {
  const { health } = entry
  const hasDepth = health.freshness !== undefined
    || health.lastSuccessAt
    || health.lastFailedAt
    || (health.driftWarnings && health.driftWarnings.length > 0)
    || health.reasonCode
    || (health.details && health.details.length > 0)

  if (!hasDepth) return null

  return (
    <Panel title="Health Depth" accent="violet">
      <div className="space-y-4">

        {/* Freshness + reason row */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {health.freshness !== undefined && (
            <div className="rounded-2xl border border-white/6 bg-black/20 p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Freshness</p>
              <div className="mt-2">
                <FreshnessPill freshness={health.freshness} />
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                {health.freshness === 'fresh' && 'Verified within the last hour'}
                {health.freshness === 'aging' && 'Last verified 1–24 h ago'}
                {health.freshness === 'stale' && 'Not verified in over 24 h'}
                {health.freshness === 'unknown' && 'No verification timestamp available'}
              </p>
            </div>
          )}
          {health.reasonCode && (
            <div className="rounded-2xl border border-white/6 bg-black/20 p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Reason Code</p>
              <p className="mt-2 font-mono text-sm text-[#00D4FF]">{health.reasonCode}</p>
            </div>
          )}
        </div>

        {/* Last success / last failure */}
        {(health.lastSuccessAt || health.lastFailedAt) && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {health.lastSuccessAt && (
              <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.04] p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Last Success</p>
                <p className="mt-2 text-sm text-emerald-300">{formatTimestamp(health.lastSuccessAt)}</p>
              </div>
            )}
            {health.lastFailedAt && (
              <div className="rounded-2xl border border-rose-500/15 bg-rose-500/[0.04] p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-rose-700">Last Failure</p>
                <p className="mt-2 text-sm text-rose-300">{formatTimestamp(health.lastFailedAt)}</p>
              </div>
            )}
          </div>
        )}

        {/* Drift warnings */}
        {health.driftWarnings && health.driftWarnings.length > 0 && (
          <div className="space-y-2">
            {health.driftWarnings.map((warning) => (
              <div key={warning} className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3">
                <span className="mt-0.5 text-amber-400 text-sm">⚠</span>
                <p className="text-sm leading-relaxed text-amber-300">{warning}</p>
              </div>
            ))}
          </div>
        )}

        {/* Detail breakdown */}
        {health.details && health.details.length > 0 && (
          <div className="rounded-2xl border border-white/6 bg-black/20 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Details</p>
            <ul className="mt-3 space-y-1">
              {health.details.map((line) => (
                <li key={line} className="flex items-start gap-2 text-sm text-slate-300">
                  <span className="mt-1 text-[#00D4FF] text-xs">›</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  )
}

function summarizeAssignments(assignments: CapabilityAssignment[]): string {
  const runtimeCount = assignments.filter((item) => item.targetType === 'runtime').length
  const teamCount = assignments.filter((item) => item.targetType === 'team').length
  const agentCount = assignments.filter((item) => item.targetType === 'agent').length
  return `${runtimeCount} runtime • ${teamCount} team • ${agentCount} agent`
}

function groupAssignments(assignments: CapabilityAssignment[]) {
  return {
    runtime: assignments.filter((item) => item.targetType === 'runtime'),
    team: assignments.filter((item) => item.targetType === 'team'),
    agent: assignments.filter((item) => item.targetType === 'agent'),
  }
}

function StatCard({
  label,
  value,
  accent,
  sub,
}: {
  label: string
  value: string
  accent: string
  sub: string
}) {
  return (
    <div className="rounded-2xl border border-white/6 bg-black/20 p-4">
      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-600">{label}</p>
      <p className={clsx('mt-2 text-2xl font-black tracking-tight', accent)}>{value}</p>
      <p className="mt-1 text-[11px] text-slate-500">{sub}</p>
    </div>
  )
}

function CapabilityListItem({
  entry,
  active,
  onSelect,
}: {
  entry: CapabilityCatalogEntry
  active: boolean
  onSelect: (capabilityId: string) => void
}) {
  const { capability, health, assignments } = entry

  return (
    <button
      onClick={() => onSelect(capability.id)}
      className={clsx(
        'w-full rounded-2xl border p-4 text-left transition-all',
        active
          ? 'border-[#00D4FF]/35 bg-[#00D4FF]/[0.08] shadow-[0_0_0_1px_rgba(0,212,255,0.12)]'
          : 'border-white/6 bg-black/20 hover:border-white/12 hover:bg-white/[0.03]'
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-black text-white">{capability.label}</p>
            {capability.isPlaceholder && <Badge variant="planned">Placeholder</Badge>}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">{capability.owner}</p>
        </div>
        <Badge variant={health.state}>{health.label}</Badge>
      </div>

      <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-slate-400">
        {capability.description}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Badge variant={capability.type}>{TYPE_LABELS[capability.type]}</Badge>
        <Badge variant={capability.runtimeTarget}>{RUNTIME_LABELS[capability.runtimeTarget]}</Badge>
        <Badge variant={capability.status}>{capability.status}</Badge>
        <Badge variant={capability.riskLevel}>{capability.riskLevel} risk</Badge>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <span className="text-[11px] text-slate-500">{summarizeAssignments(assignments)}</span>
        <div className="flex items-center gap-3">
          {health.freshness && health.freshness !== 'fresh' && health.freshness !== 'unknown' && (
            <FreshnessPill freshness={health.freshness} />
          )}
          {health.driftWarnings && health.driftWarnings.length > 0 && (
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-500">
              {health.driftWarnings.length} drift
            </span>
          )}
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">
            {assignments.length} assignments
          </span>
        </div>
      </div>
    </button>
  )
}

export function CapabilitiesView() {
  const { data, loading, error, refetch } = useCapabilitiesRegistry()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | CapabilityType>('all')
  const [runtimeFilter, setRuntimeFilter] = useState<'all' | CapabilityRuntimeTarget>('all')
  const [healthFilter, setHealthFilter] = useState<'all' | CapabilityHealthState>('all')
  const [selectedCapabilityId, setSelectedCapabilityId] = useState<string | null>(null)
  const [draft, setDraft] = useState<GovernanceDraft | null>(null)
  const [saveState, setSaveState] = useState<GovernanceSaveState>({ status: 'idle' })

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
        entry.assignments.map((assignment) => `${assignment.label} ${assignment.targetId}`).join(' '),
      ].join(' ').toLowerCase()

      return haystack.includes(query)
    })
  }, [data, healthFilter, runtimeFilter, search, typeFilter])

  useEffect(() => {
    if (filteredCatalog.length === 0) {
      setSelectedCapabilityId(null)
      return
    }

    const stillVisible = filteredCatalog.some((entry) => entry.capability.id === selectedCapabilityId)
    if (!stillVisible) {
      setSelectedCapabilityId(filteredCatalog[0].capability.id)
    }
  }, [filteredCatalog, selectedCapabilityId])

  const selectedEntry = useMemo(
    () => filteredCatalog.find((entry) => entry.capability.id === selectedCapabilityId) ?? filteredCatalog[0] ?? null,
    [filteredCatalog, selectedCapabilityId]
  )

  const groupedAssignments = useMemo(
    () => selectedEntry ? groupAssignments(selectedEntry.assignments) : null,
    [selectedEntry]
  )

  const selectedRecentEvents = useMemo(
    () => selectedEntry
      ? (data?.recentEvents ?? []).filter((event) => event.capability_id === selectedEntry.capability.id).slice(0, 8)
      : [],
    [data, selectedEntry]
  )

  useEffect(() => {
    if (!selectedEntry) {
      setDraft(null)
      return
    }

    setDraft({
      policyMode: selectedEntry.policy.mode,
      policyNotes: selectedEntry.policy.notes ?? '',
      assignments: Object.fromEntries(
        selectedEntry.assignments.map((assignment) => [
          `${assignment.targetType}:${assignment.targetId}`,
          assignment.state === 'disabled' ? 'disabled' : 'active',
        ])
      ),
    })
    setSaveState({ status: 'idle' })
  }, [selectedEntry])

  async function handleSaveGovernance() {
    if (!selectedEntry || !draft) return

    try {
      setSaveState({ status: 'saving' })
      const response = await fetch(`${BACKEND_URL}/api/capabilities/${encodeURIComponent(selectedEntry.capability.id)}/governance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          policyMode: draft.policyMode,
          policyNotes: draft.policyNotes.trim() || null,
          assignments: selectedEntry.assignments.map((assignment) => ({
            targetType: assignment.targetType,
            targetId: assignment.targetId,
            state: draft.assignments[`${assignment.targetType}:${assignment.targetId}`] ?? 'active',
            notes: assignment.notes ?? null,
          })),
        }),
      })

      const payload = await response.json() as { error?: string }
      if (!response.ok) {
        throw new Error(payload.error ?? `HTTP ${response.status}`)
      }

      await refetch()
      setSaveState({ status: 'done', message: 'Governance updated' })
    } catch (err) {
      setSaveState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Governance update failed',
      })
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[420px] gap-4">
        <div className="w-12 h-12 border-4 border-[#00D4FF]/20 border-t-[#00D4FF] rounded-full animate-spin" />
        <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em]">Indexing Capabilities...</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="rounded-3xl border border-rose-500/20 bg-rose-500/5 p-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-rose-400">Capabilities unavailable</p>
            <p className="mt-2 text-xs text-slate-500">{error ?? 'Unknown error'}</p>
          </div>
          <button
            onClick={() => void refetch()}
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-300 transition hover:border-[#00D4FF]/30 hover:text-[#00D4FF]"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-20 animate-fade-in">
      <section className="rounded-3xl border border-white/5 bg-[#070C1A] p-6">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#00D4FF]/20 bg-[#00D4FF]/[0.08] text-[#00D4FF]">
                <Icon name="cpu" size={24} />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#00D4FF]">Shared Capability Platform</p>
                <h2 className="mt-1 text-2xl font-black tracking-tight text-white">Catalog, governance, and runtime visibility</h2>
              </div>
            </div>
            <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-400">
              One shared model for Company and Personal capabilities: registry, assignment, policy, health, and audit in a single control-plane view.
            </p>
          </div>

          <div className="rounded-2xl border border-white/8 bg-black/30 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-600">Registry Snapshot</p>
            <p className="mt-1 text-sm font-mono text-slate-300">{formatTimestamp(data.generatedAt)}</p>
            <button
              onClick={() => void refetch()}
              className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-300 transition hover:border-[#00D4FF]/30 hover:text-[#00D4FF]"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Catalog" value={String(data.summary.total)} accent="text-white" sub="Live capability objects" />
          <StatCard label="Shared" value={String(data.summary.byRuntimeTarget.shared)} accent="text-[#00D4FF]" sub="Cross-runtime capabilities" />
          <StatCard label="Company" value={String(data.summary.byRuntimeTarget.company)} accent="text-amber-400" sub="Company-targeted surfaces" />
          <StatCard label="Personal" value={String(data.summary.byRuntimeTarget.personal)} accent="text-[#7CF6E6]" sub="Founder-targeted surfaces" />
        </div>

        {/* Health summary bar */}
        <div className="mt-4 flex flex-wrap gap-3">
          {data.summary.byHealth.connected > 0 && (
            <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-[11px] font-black text-emerald-400">{data.summary.byHealth.connected} connected</span>
            </div>
          )}
          {data.summary.byHealth.degraded > 0 && (
            <div className="flex items-center gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              <span className="text-[11px] font-black text-amber-400">{data.summary.byHealth.degraded} degraded</span>
            </div>
          )}
          {data.summary.byHealth.auth_required > 0 && (
            <div className="flex items-center gap-2 rounded-2xl border border-orange-500/20 bg-orange-500/[0.06] px-3 py-2">
              <span className="h-2 w-2 rounded-full bg-orange-400" />
              <span className="text-[11px] font-black text-orange-400">{data.summary.byHealth.auth_required} auth required</span>
            </div>
          )}
          {data.summary.byHealth.failing > 0 && (
            <div className="flex items-center gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] px-3 py-2">
              <span className="h-2 w-2 rounded-full bg-rose-400" />
              <span className="text-[11px] font-black text-rose-400">{data.summary.byHealth.failing} failing</span>
            </div>
          )}
          {data.summary.byHealth.missing_config > 0 && (
            <div className="flex items-center gap-2 rounded-2xl border border-slate-500/20 bg-slate-500/[0.06] px-3 py-2">
              <span className="h-2 w-2 rounded-full bg-slate-400" />
              <span className="text-[11px] font-black text-slate-400">{data.summary.byHealth.missing_config} missing config</span>
            </div>
          )}
          {data.summary.byHealth.disabled > 0 && (
            <div className="flex items-center gap-2 rounded-2xl border border-white/8 bg-black/20 px-3 py-2">
              <span className="h-2 w-2 rounded-full bg-slate-600" />
              <span className="text-[11px] font-black text-slate-500">{data.summary.byHealth.disabled} disabled</span>
            </div>
          )}
          {/* Stale count derived from catalog */}
          {(() => {
            const staleCount = data.catalog.filter((entry) => entry.health.freshness === 'stale').length
            return staleCount > 0 ? (
              <div className="flex items-center gap-2 rounded-2xl border border-rose-500/15 bg-rose-500/[0.04] px-3 py-2">
                <span className="h-2 w-2 rounded-full bg-rose-600" />
                <span className="text-[11px] font-black text-rose-500">{staleCount} stale</span>
              </div>
            ) : null
          })()}
          {/* Drift count */}
          {(() => {
            const driftCount = data.catalog.filter((entry) => (entry.health.driftWarnings?.length ?? 0) > 0).length
            return driftCount > 0 ? (
              <div className="flex items-center gap-2 rounded-2xl border border-amber-500/15 bg-amber-500/[0.04] px-3 py-2">
                <span className="h-2 w-2 rounded-full bg-amber-600" />
                <span className="text-[11px] font-black text-amber-500">{driftCount} with drift</span>
              </div>
            ) : null
          })()}
        </div>
      </section>

      <section className="rounded-3xl border border-white/5 bg-white/[0.02] p-5">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,2fr)_180px_180px_180px]">
          <label className="flex flex-col gap-2">
            <span className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-600">Search</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="gmail, memory, ceo, shared..."
              className="rounded-2xl border border-white/8 bg-black/30 px-4 py-3 text-sm text-slate-200 outline-none transition focus:border-[#00D4FF]/35"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-600">Type</span>
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as 'all' | CapabilityType)}
              className="rounded-2xl border border-white/8 bg-black/30 px-4 py-3 text-sm text-slate-200 outline-none transition focus:border-[#00D4FF]/35"
            >
              <option value="all">All types</option>
              <option value="skill">Skill</option>
              <option value="plugin">Plugin</option>
              <option value="integration">Integration</option>
              <option value="memory_provider">Memory</option>
              <option value="channel">Channel</option>
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-600">Runtime</span>
            <select
              value={runtimeFilter}
              onChange={(event) => setRuntimeFilter(event.target.value as 'all' | CapabilityRuntimeTarget)}
              className="rounded-2xl border border-white/8 bg-black/30 px-4 py-3 text-sm text-slate-200 outline-none transition focus:border-[#00D4FF]/35"
            >
              <option value="all">All runtimes</option>
              <option value="shared">Shared</option>
              <option value="company">Company</option>
              <option value="personal">Personal</option>
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-600">Health</span>
            <select
              value={healthFilter}
              onChange={(event) => setHealthFilter(event.target.value as 'all' | CapabilityHealthState)}
              className="rounded-2xl border border-white/8 bg-black/30 px-4 py-3 text-sm text-slate-200 outline-none transition focus:border-[#00D4FF]/35"
            >
              <option value="all">All states</option>
              <option value="connected">Connected</option>
              <option value="degraded">Degraded</option>
              <option value="missing_config">Missing config</option>
              <option value="auth_required">Auth required</option>
              <option value="failing">Failing</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)]">
        <Panel
          title={`Catalog • ${filteredCatalog.length} visible`}
          accent="cyan"
          headerRight={<Badge variant="technical">{data.assignments.length} assignments</Badge>}
          className="min-h-[720px]"
        >
          <div className="space-y-3">
            {filteredCatalog.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/8 px-4 py-12 text-center">
                <p className="text-sm text-slate-400">No capability matches this filter.</p>
              </div>
            ) : (
              filteredCatalog.map((entry) => (
                <CapabilityListItem
                  key={entry.capability.id}
                  entry={entry}
                  active={entry.capability.id === selectedEntry?.capability.id}
                  onSelect={setSelectedCapabilityId}
                />
              ))
            )}
          </div>
        </Panel>

        <div className="space-y-6">
          {selectedEntry ? (
            <>
              <Panel
                title="Selected Capability"
                accent="sky"
                headerRight={<Badge variant={selectedEntry.health.state}>{selectedEntry.health.label}</Badge>}
              >
                <div className="space-y-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-black text-white">{selectedEntry.capability.label}</h3>
                      <Badge variant={selectedEntry.capability.type}>{TYPE_LABELS[selectedEntry.capability.type]}</Badge>
                      <Badge variant={selectedEntry.capability.runtimeTarget}>{RUNTIME_LABELS[selectedEntry.capability.runtimeTarget]}</Badge>
                      <Badge variant={selectedEntry.capability.status}>{selectedEntry.capability.status}</Badge>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-slate-400">{selectedEntry.capability.description}</p>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/6 bg-black/20 p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Owner</p>
                      <p className="mt-2 text-sm font-semibold text-white">{selectedEntry.capability.owner}</p>
                    </div>
                    <div className="rounded-2xl border border-white/6 bg-black/20 p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Risk</p>
                      <p className="mt-2 text-sm font-semibold text-white">{selectedEntry.capability.riskLevel}</p>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/6 bg-black/20 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Health Message</p>
                      {selectedEntry.health.freshness && (
                        <FreshnessPill freshness={selectedEntry.health.freshness} />
                      )}
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-slate-300">{selectedEntry.health.message}</p>
                    <p className="mt-2 text-[11px] text-slate-500">Checked {formatTimestamp(selectedEntry.health.checkedAt)}</p>
                  </div>

                  {selectedEntry.capability.dependsOn.length > 0 && (
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Dependencies</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {selectedEntry.capability.dependsOn.map((dependency) => (
                          <Badge key={dependency} variant="reference">{dependency}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedEntry.capability.tags.length > 0 && (
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Tags</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {selectedEntry.capability.tags.map((tag) => (
                          <Badge key={tag} variant="default">{tag}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </Panel>

              <HealthDepthPanel entry={selectedEntry} />

              <Panel title="Assignments" accent="emerald">
                <div className="space-y-5">
                  {groupedAssignments && (Object.keys(groupedAssignments) as Array<keyof typeof groupedAssignments>).map((targetType) => (
                    <div key={targetType}>
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">{TARGET_LABELS[targetType]}</p>
                        <Badge variant="status">{groupedAssignments[targetType].length}</Badge>
                      </div>
                      <div className="mt-3 space-y-2">
                        {groupedAssignments[targetType].length === 0 ? (
                          <div className="rounded-xl border border-dashed border-white/8 px-3 py-3 text-[11px] text-slate-500">No {targetType} assignments.</div>
                        ) : (
                          groupedAssignments[targetType].map((assignment) => (
                            <div key={`${assignment.targetType}:${assignment.targetId}`} className="rounded-xl border border-white/6 bg-black/20 px-3 py-3">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-semibold text-white">{assignment.label}</p>
                                  <Badge variant={assignment.runtimeTarget}>{RUNTIME_LABELS[assignment.runtimeTarget]}</Badge>
                                  <Badge variant={assignment.state}>{assignment.state}</Badge>
                                </div>
                                <select
                                  value={draft?.assignments[`${assignment.targetType}:${assignment.targetId}`] ?? (assignment.state === 'disabled' ? 'disabled' : 'active')}
                                  onChange={(event) => setDraft((current) => current ? {
                                    ...current,
                                    assignments: {
                                      ...current.assignments,
                                      [`${assignment.targetType}:${assignment.targetId}`]: event.target.value as 'active' | 'disabled',
                                    },
                                  } : current)}
                                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[11px] text-slate-200 outline-none focus:border-[#00D4FF]/35"
                                >
                                  <option value="active">Active</option>
                                  <option value="disabled">Disabled</option>
                                </select>
                              </div>
                              <p className="mt-1 text-[11px] font-mono text-slate-600">{assignment.targetId}</p>
                              {assignment.notes && <p className="mt-2 text-[12px] leading-relaxed text-slate-400">{assignment.notes}</p>}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Policy And Audit" accent="amber">
                <div className="space-y-5">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Policy Mode</p>
                      <Badge variant={selectedEntry.policy.mode}>{selectedEntry.policy.mode}</Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[220px_minmax(0,1fr)]">
                      <select
                        value={draft?.policyMode ?? selectedEntry.policy.mode}
                        onChange={(event) => setDraft((current) => current ? {
                          ...current,
                          policyMode: event.target.value as GovernanceDraft['policyMode'],
                        } : current)}
                        className="rounded-2xl border border-white/8 bg-black/30 px-4 py-3 text-sm text-slate-200 outline-none transition focus:border-[#00D4FF]/35"
                      >
                        <option value="open">open</option>
                        <option value="restricted">restricted</option>
                        <option value="approval_required">approval_required</option>
                        <option value="read_only">read_only</option>
                      </select>
                      <textarea
                        value={draft?.policyNotes ?? selectedEntry.policy.notes ?? ''}
                        onChange={(event) => setDraft((current) => current ? {
                          ...current,
                          policyNotes: event.target.value,
                        } : current)}
                        rows={3}
                        placeholder="Founder note for this capability policy..."
                        className="rounded-2xl border border-white/8 bg-black/30 px-4 py-3 text-sm text-slate-200 outline-none transition focus:border-[#00D4FF]/35"
                      />
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Allowed Tools</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedEntry.policy.allowedTools.length === 0
                        ? <Badge variant="default">No explicit tools</Badge>
                        : selectedEntry.policy.allowedTools.map((tool) => <Badge key={tool} variant="technical">{tool}</Badge>)}
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Environment Requirements</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedEntry.policy.envRequirements.length === 0
                        ? <Badge variant="default">None</Badge>
                        : selectedEntry.policy.envRequirements.map((envVar) => <Badge key={envVar} variant="reference">{envVar}</Badge>)}
                    </div>
                    {selectedEntry.health.missingRequirements.length > 0 && (
                      <p className="mt-2 text-[12px] text-amber-400">
                        Missing now: {selectedEntry.health.missingRequirements.join(', ')}
                      </p>
                    )}
                  </div>

                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Restricted Paths</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedEntry.policy.restrictedPaths.length === 0
                        ? <Badge variant="default">No path restriction</Badge>
                        : selectedEntry.policy.restrictedPaths.map((path) => <Badge key={path} variant="archive">{path}</Badge>)}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/6 bg-black/20 p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Last Change</p>
                      <p className="mt-2 text-sm text-white">{formatTimestamp(selectedEntry.audit.lastChangedAt)}</p>
                      <p className="mt-1 text-[11px] text-slate-500">{selectedEntry.audit.lastChangedBy ?? 'n/a'}</p>
                    </div>
                    <div className="rounded-2xl border border-white/6 bg-black/20 p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Last Success</p>
                      <p className="mt-2 text-sm text-white">{formatTimestamp(selectedEntry.audit.lastSuccessfulAt)}</p>
                    </div>
                    <div className="rounded-2xl border border-white/6 bg-black/20 p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Last Failure</p>
                      <p className="mt-2 text-sm text-white">{formatTimestamp(selectedEntry.audit.lastFailedAt)}</p>
                    </div>
                    <div className="rounded-2xl border border-white/6 bg-black/20 p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Last Use</p>
                      <p className="mt-2 text-sm text-white">{formatTimestamp(selectedEntry.audit.lastUsedAt)}</p>
                    </div>
                  </div>

                  {selectedEntry.audit.summary && (
                    <div className="rounded-2xl border border-white/6 bg-black/20 p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Audit Summary</p>
                      <p className="mt-2 text-sm leading-relaxed text-slate-300">{selectedEntry.audit.summary}</p>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/6 bg-black/20 p-4">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Governance Editing</p>
                      <p className="mt-1 text-sm text-slate-400">This MVP edits only policy mode, policy notes, and active/disabled assignment state.</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {saveState.message && (
                        <p className={clsx(
                          'text-[12px]',
                          saveState.status === 'error' ? 'text-rose-400' : 'text-emerald-400'
                        )}>
                          {saveState.message}
                        </p>
                      )}
                      <button
                        onClick={() => void handleSaveGovernance()}
                        disabled={saveState.status === 'saving'}
                        className="rounded-xl border border-[#00D4FF]/25 bg-[#00D4FF]/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-[#00D4FF] transition hover:bg-[#00D4FF]/20 disabled:opacity-50"
                      >
                        {saveState.status === 'saving' ? 'Saving...' : 'Save Governance'}
                      </button>
                    </div>
                  </div>
                </div>
              </Panel>

              <Panel
                title="Recent Capability Activity"
                accent="violet"
                headerRight={<Badge variant="status">{selectedRecentEvents.length}</Badge>}
              >
                <div className="space-y-3">
                  {selectedRecentEvents.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/8 px-4 py-8 text-center">
                      <p className="text-sm text-slate-400">No persisted capability events yet.</p>
                      <p className="mt-2 text-[12px] text-slate-500">Apply migration `007_capability_events.sql` if the table is not live yet.</p>
                    </div>
                  ) : (
                    selectedRecentEvents.map((event) => (
                      <div key={event.id} className="rounded-2xl border border-white/6 bg-black/20 px-4 py-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={event.event_type}>{EVENT_LABELS[event.event_type]}</Badge>
                            <p className="text-sm font-semibold text-white">{event.summary}</p>
                          </div>
                          <p className="text-[11px] font-mono text-slate-500">{formatTimestamp(event.created_at)}</p>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                          <span>{event.actor_id ?? event.actor_type}</span>
                          <span>•</span>
                          <span>{event.source}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Panel>
            </>
          ) : (
            <Panel title="Selected Capability" accent="sky">
              <div className="rounded-2xl border border-dashed border-white/8 px-4 py-12 text-center">
                <p className="text-sm text-slate-400">Select a capability from the catalog.</p>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  )
}
