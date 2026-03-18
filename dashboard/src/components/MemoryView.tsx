// ============================================================
// WAI Dashboard – Memory View
// Browse persistent per-agent memories with TTL visibility.
// ============================================================

import { useMemo, useState } from 'react'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { Panel } from './ui/Panel.js'
import { Stat } from './ui/Stat.js'
import { Badge } from './ui/Badge.js'
import { useAgentMemories, useAgents } from '../hooks/useSupabaseRealtime.js'
import type { AgentMemory } from '../types/index.js'

type AgentFilter = 'all' | string

function normalize(text: string): string {
  return text.toLowerCase().trim()
}

function previewContent(content: string, maxChars = 520): string {
  const compact = content.replace(/\s+/g, ' ').trim()
  if (compact.length <= maxChars) return compact
  return `${compact.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
}

function getExpiryVariant(memory: AgentMemory): 'done' | 'warning' | 'blocked' {
  if (!memory.ttl) return 'done'

  const ttlMs = new Date(memory.ttl).getTime()
  const nowMs = Date.now()
  if (ttlMs <= nowMs) return 'blocked'
  if (ttlMs - nowMs <= 7 * 24 * 60 * 60 * 1000) return 'warning'
  return 'done'
}

function getExpiryLabel(memory: AgentMemory): string {
  if (!memory.ttl) return 'persistent'

  const ttlDate = new Date(memory.ttl)
  if (ttlDate.getTime() <= Date.now()) return 'expired'
  return `ttl ${formatDistanceToNowStrict(ttlDate, { addSuffix: true })}`
}

function getAgentName(agentId: string, agentMap: Map<string, { name: string; team: string }>): string {
  return agentMap.get(agentId)?.name ?? agentId
}

export function MemoryView() {
  const { data: memories, loading, error } = useAgentMemories(500)
  const { data: agents } = useAgents()
  const [agentFilter, setAgentFilter] = useState<AgentFilter>('all')
  const [search, setSearch] = useState('')
  const [showExpired, setShowExpired] = useState(false)

  const agentMap = useMemo(
    () => new Map(agents.map((agent) => [agent.id, { name: agent.name, team: agent.team }])),
    [agents]
  )

  const filteredMemories = useMemo(() => {
    const searchTerm = normalize(search)

    return memories.filter((memory) => {
      const isExpired = memory.ttl ? new Date(memory.ttl).getTime() <= Date.now() : false
      if (!showExpired && isExpired) return false
      if (agentFilter !== 'all' && memory.agent_id !== agentFilter) return false
      if (!searchTerm) return true

      const agentName = normalize(getAgentName(memory.agent_id, agentMap))
      const content = normalize(memory.content)
      return agentName.includes(searchTerm) || content.includes(searchTerm) || memory.agent_id.includes(searchTerm)
    })
  }, [agentFilter, agentMap, memories, search, showExpired])

  const activeMemories = useMemo(
    () => filteredMemories.filter((memory) => getExpiryVariant(memory) !== 'blocked'),
    [filteredMemories]
  )

  const expiringSoonCount = useMemo(
    () => filteredMemories.filter((memory) => getExpiryVariant(memory) === 'warning').length,
    [filteredMemories]
  )

  const memoryByAgent = useMemo(() => {
    const grouped = new Map<string, { count: number; latestAt: string }>()

    for (const memory of filteredMemories) {
      const current = grouped.get(memory.agent_id)
      if (!current) {
        grouped.set(memory.agent_id, { count: 1, latestAt: memory.created_at })
        continue
      }

      grouped.set(memory.agent_id, {
        count: current.count + 1,
        latestAt: current.latestAt > memory.created_at ? current.latestAt : memory.created_at,
      })
    }

    return Array.from(grouped.entries())
      .map(([agentId, value]) => ({
        agentId,
        count: value.count,
        latestAt: value.latestAt,
        agentName: getAgentName(agentId, agentMap),
      }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count
        return b.latestAt.localeCompare(a.latestAt)
      })
  }, [agentMap, filteredMemories])

  const selectClass = 'text-xs font-mono bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-1.5 text-slate-300 focus:outline-none focus:border-[#00D4FF]/40 transition-colors'
  const inputClass = 'w-full text-xs font-mono bg-white/[0.04] border border-white/[0.08] rounded-md px-3 py-2 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-[#00D4FF]/40 transition-colors'

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="text-sm font-bold text-white">Memory</h2>
          <p className="text-[11px] text-slate-600 mt-0.5">
            Long-term agent memory backed by pgvector recall
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_180px_auto] xl:min-w-[620px]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search memory content or agent..."
            className={inputClass}
          />

          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className={selectClass}
          >
            <option value="all">All agents</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-2 text-[11px] text-slate-400 font-mono px-1">
            <input
              type="checkbox"
              checked={showExpired}
              onChange={(e) => setShowExpired(e.target.checked)}
              className="rounded border-white/10 bg-white/5 text-[#00D4FF] focus:ring-0"
            />
            Show expired
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Visible Memories" value={String(filteredMemories.length)} color="cyan" />
        <Stat label="Active Recall Pool" value={String(activeMemories.length)} color="emerald" />
        <Stat label="Agents With Memory" value={String(memoryByAgent.length)} color="violet" />
        <Stat label="Expiring Soon" value={String(expiringSoonCount)} color="amber" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.85fr)]">
        <Panel title="Recent Memory Stream" accent="cyan" noPad>
          {loading && (
            <p className="px-5 py-6 text-[11px] text-slate-600 font-mono animate-pulse">
              Loading memories...
            </p>
          )}

          {error && (
            <p className="px-5 py-6 text-[11px] text-rose-400 font-mono">
              Error: {error}
            </p>
          )}

          {!loading && !error && filteredMemories.length === 0 && (
            <p className="px-5 py-8 text-center text-[11px] text-slate-600 font-mono">
              No memories found for the current filter.
            </p>
          )}

          {!loading && !error && filteredMemories.length > 0 && (
            <div className="divide-y divide-white/[0.05]">
              {filteredMemories.map((memory) => (
                <article key={memory.id} className="px-5 py-4 hover:bg-white/[0.02] transition-colors">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-white">
                      {getAgentName(memory.agent_id, agentMap)}
                    </span>
                    <Badge variant="default">{memory.agent_id}</Badge>
                    <Badge variant={getExpiryVariant(memory)}>
                      {getExpiryLabel(memory)}
                    </Badge>
                    <span className="text-[10px] text-slate-600 font-mono ml-auto">
                      {format(new Date(memory.created_at), 'MMM d, yyyy HH:mm')}
                    </span>
                  </div>

                  <p className="mt-2 text-[12px] leading-relaxed text-slate-300 whitespace-pre-wrap">
                    {previewContent(memory.content)}
                  </p>
                </article>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Memory Density By Agent" accent="violet" noPad>
          {!loading && !error && memoryByAgent.length === 0 && (
            <p className="px-5 py-8 text-center text-[11px] text-slate-600 font-mono">
              No agent memory available yet.
            </p>
          )}

          {(loading || error) ? (
            <div className="px-5 py-6 text-[11px] text-slate-600 font-mono">
              {loading ? 'Loading distribution...' : 'Distribution unavailable.'}
            </div>
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {memoryByAgent.map((entry) => (
                <div key={entry.agentId} className="px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{entry.agentName}</p>
                      <p className="text-[10px] text-slate-600 font-mono truncate">{entry.agentId}</p>
                    </div>

                    <div className="text-right">
                      <p className="text-lg font-bold text-violet-400 leading-none">{entry.count}</p>
                      <p className="text-[10px] text-slate-600 font-mono mt-1">
                        latest {formatDistanceToNowStrict(new Date(entry.latestAt), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
