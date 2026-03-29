// ============================================================
// WAI Dashboard – Neural Knowledge Browser (T071 / T119)
// Vector Database Browser aesthetic for long-term memories.
// T119: entity_type filter, delete single, delete all.
// ============================================================

import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { Badge } from './ui/Badge.js'
import { Icon } from './ui/Icon.js'
import { ExpandableText } from './ui/ExpandableText.js'
import { AgentDetailSidebar } from './AgentDetailSidebar.js'
import { useAgentMemories, useAgents, useAgentStats } from '../hooks/useSupabaseRealtime.js'
import { getAgentColor } from '../lib/agentColors.js'
import type { AgentMemory, Agent } from '../types/index.js'

const API_BASE = (import.meta.env['VITE_BACKEND_URL'] as string | undefined) ?? ''

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getExpiryVariant(memory: AgentMemory): 'done' | 'warning' | 'blocked' {
  if (!memory.ttl) return 'done'
  const ttlMs = new Date(memory.ttl).getTime()
  const nowMs = Date.now()
  if (ttlMs <= nowMs) return 'blocked'
  if (ttlMs - nowMs <= 7 * 24 * 60 * 60 * 1000) return 'warning'
  return 'done'
}

function getExpiryLabel(memory: AgentMemory): string {
  if (!memory.ttl) return 'PERSISTENT'
  const ttlDate = new Date(memory.ttl)
  if (ttlDate.getTime() <= Date.now()) return 'EXPIRED'
  return `TTL: ${formatDistanceToNowStrict(ttlDate, { addSuffix: true }).toUpperCase()}`
}

// ---------------------------------------------------------------------------
// Sub-component: Memory Knowledge Cell
// ---------------------------------------------------------------------------

function KnowledgeCell({
  memory,
  agent,
  onAgentClick,
  onDelete,
}: {
  memory: AgentMemory;
  agent?: Agent;
  onAgentClick: (a: Agent) => void;
  onDelete: (id: string) => void;
}) {
  const agentColor = agent ? getAgentColor(agent.id) : null
  const expVariant = getExpiryVariant(memory)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!confirm('Delete this memory?')) return
    setDeleting(true)
    try {
      await fetch(`${API_BASE}/api/memory/${memory.id}`, { method: 'DELETE' })
      onDelete(memory.id)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <article className="group relative rounded-2xl border border-white/5 bg-[#070C1A]/60 backdrop-blur-sm p-5 transition-all hover:bg-white/[0.03] hover:border-white/10 overflow-hidden">
      {/* Decorative vertical line */}
      <div className={clsx(
        "absolute left-0 top-0 bottom-0 w-1 opacity-40 transition-opacity group-hover:opacity-100",
        expVariant === 'done' ? 'bg-emerald-500' : expVariant === 'warning' ? 'bg-amber-500' : 'bg-rose-500'
      )} />

      <div className="relative z-10 flex flex-col gap-4">
        {/* Header: Agent + Expiry + Delete */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {agent && agentColor && (
              <button
                onClick={() => onAgentClick(agent)}
                className={clsx(
                  "w-10 h-10 rounded-lg flex items-center justify-center font-black text-[10px] border transition-transform hover:scale-110",
                  agentColor.bg, agentColor.border, agentColor.text
                )}
              >
                {agent.name.split(' ').map(n => n[0]).join('')}
              </button>
            )}
            <div className="min-w-0">
              <p className="text-[11px] font-black text-white uppercase tracking-tight truncate">{agent?.name || memory.agent_id}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[9px] text-slate-600 font-mono">ID: {memory.id.slice(0,8)}</span>
                <span className="w-1 h-1 rounded-full bg-slate-800" />
                <span className="text-[9px] text-slate-600 font-mono">{format(new Date(memory.created_at), 'dd MMM HH:mm')}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {memory.entity_type && memory.entity_type !== 'general' && (
              <span className="px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-[8px] font-black text-indigo-400 uppercase tracking-widest">
                {memory.entity_type}
              </span>
            )}
            <Badge variant={expVariant} className="text-[8px] tracking-[0.1em]">{getExpiryLabel(memory)}</Badge>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-600 hover:text-rose-400 ml-1"
              title="Delete memory"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="bg-black/20 rounded-xl p-4 border border-white/[0.03]">
          <ExpandableText
            text={memory.content}
            className="text-[13px] leading-relaxed text-slate-300 font-medium"
            maxLength={250}
            buttonColor="text-[#00D4FF]/60 hover:text-[#00D4FF]"
          />
        </div>

        {/* Metadata Footer */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
             <div className="px-2 py-0.5 rounded bg-white/[0.03] border border-white/5 text-[8px] font-black text-slate-500 uppercase tracking-widest">
               Vector Node: pg_memory
             </div>
          </div>
        </div>
      </div>
    </article>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function MemoryView() {
  const { data: memories, loading: mLoad } = useAgentMemories(500)
  const { data: agents,   loading: aLoad } = useAgents()
  const { runCounts, lastRuns } = useAgentStats()

  const [search, setSearch] = useState('')
  const [agentFilter, setAgentFilter] = useState('all')
  const [entityTypeFilter, setEntityTypeFilter] = useState('all')
  const [showExpired, setShowExpired] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [deletingAll, setDeletingAll] = useState(false)
  // Local set of deleted ids (optimistic) so realtime sync doesn't flicker
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set())

  const entityTypes = useMemo(() => {
    const types = new Set(memories.map(m => m.entity_type).filter(Boolean))
    return Array.from(types).sort()
  }, [memories])

  const filteredMemories = useMemo(() => {
    const q = search.toLowerCase().trim()
    return memories.filter(m => {
      if (deletedIds.has(m.id)) return false
      const isExpired = m.ttl ? new Date(m.ttl).getTime() <= Date.now() : false
      if (!showExpired && isExpired) return false
      if (agentFilter !== 'all' && m.agent_id !== agentFilter) return false
      if (entityTypeFilter !== 'all' && m.entity_type !== entityTypeFilter) return false
      if (!q) return true
      return m.content.toLowerCase().includes(q) || m.agent_id.toLowerCase().includes(q)
    })
  }, [memories, search, agentFilter, entityTypeFilter, showExpired, deletedIds])

  const handleDeleteOne = (id: string) => {
    setDeletedIds(prev => new Set([...prev, id]))
  }

  const handleDeleteAll = async () => {
    const scope = agentFilter !== 'all' ? `all memories for this agent` : `ALL agent memories`
    if (!confirm(`This will delete ${scope}. Are you sure?`)) return
    setDeletingAll(true)
    try {
      const params = agentFilter !== 'all' ? `?agentId=${encodeURIComponent(agentFilter)}` : ''
      await fetch(`${API_BASE}/api/memory${params}`, { method: 'DELETE' })
      // Mark all currently visible as deleted
      setDeletedIds(prev => new Set([...prev, ...filteredMemories.map(m => m.id)]))
    } finally {
      setDeletingAll(false)
    }
  }

  const loading = mLoad || aLoad

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="w-10 h-10 border-4 border-[#00D4FF]/20 border-t-[#00D4FF] rounded-full animate-spin" />
        <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em]">Accessing Neural Archive...</p>
      </div>
    )
  }

  const visibleCount = filteredMemories.length

  return (
    <div className="space-y-8 animate-fade-in pb-20">

      {/* ── Intelligence Header & Controls ── */}
      <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-6 flex flex-col xl:flex-row items-center justify-between gap-8">
        <div className="flex items-center gap-6">
          <div className="w-14 h-14 rounded-2xl bg-[#00D4FF]/5 border border-[#00D4FF]/20 flex items-center justify-center text-[#00D4FF] shadow-[0_0_20px_rgba(0,212,255,0.1)]">
            <Icon name="memory" size={28} />
          </div>
          <div>
            <h1 className="text-xl font-black text-white uppercase tracking-tighter italic">Knowledge Bank</h1>
            <p className="text-[11px] text-slate-500 font-mono tracking-widest mt-1 uppercase">Persistent Vector Recall • {visibleCount} / {memories.length - deletedIds.size} Cells</p>
          </div>
        </div>

        <div className="flex items-center gap-4 flex-wrap justify-center">
          <div className="relative group">
            <Icon name="overview" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-[#00D4FF] transition-colors" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="QUERY NEURAL CONTENT..."
              className="bg-black/40 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-[11px] font-bold text-white placeholder:text-slate-700 focus:outline-none focus:border-[#00D4FF]/40 focus:ring-1 focus:ring-[#00D4FF]/20 transition-all w-64"
            />
          </div>

          <select
            value={agentFilter}
            onChange={e => setAgentFilter(e.target.value)}
            className="bg-[#0A1628] border border-white/10 rounded-xl px-4 py-2.5 text-[11px] font-bold text-slate-400 focus:outline-none focus:border-[#00D4FF]/40 transition-all cursor-pointer"
          >
            <option value="all" className="bg-[#0A1628] text-white">ALL AGENTS</option>
            {agents.map(a => (
              <option key={a.id} value={a.id} className="bg-[#0A1628] text-white">
                {a.name.toUpperCase()}
              </option>
            ))}
          </select>

          {entityTypes.length > 0 && (
            <select
              value={entityTypeFilter}
              onChange={e => setEntityTypeFilter(e.target.value)}
              className="bg-[#0A1628] border border-white/10 rounded-xl px-4 py-2.5 text-[11px] font-bold text-slate-400 focus:outline-none focus:border-[#00D4FF]/40 transition-all cursor-pointer"
            >
              <option value="all" className="bg-[#0A1628] text-white">ALL TYPES</option>
              {entityTypes.map(t => (
                <option key={t} value={t} className="bg-[#0A1628] text-white">{t.toUpperCase()}</option>
              ))}
            </select>
          )}

          <button
            onClick={() => setShowExpired(!showExpired)}
            className={clsx(
              "px-4 py-2.5 rounded-xl border font-black text-[10px] uppercase tracking-widest transition-all",
              showExpired ? "bg-[#00D4FF] text-black border-[#00D4FF]" : "bg-white/[0.02] border-white/5 text-slate-500 hover:text-slate-300"
            )}
          >
            Show Expired
          </button>

          {visibleCount > 0 && (
            <button
              onClick={handleDeleteAll}
              disabled={deletingAll}
              className="px-4 py-2.5 rounded-xl border font-black text-[10px] uppercase tracking-widest transition-all bg-rose-500/10 border-rose-500/20 text-rose-400 hover:bg-rose-500/20 disabled:opacity-50"
            >
              {deletingAll ? 'Deleting...' : agentFilter !== 'all' ? 'Delete Agent Memories' : 'Delete All'}
            </button>
          )}
        </div>
      </div>

      {/* ── Knowledge Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredMemories.length === 0 ? (
          <div className="col-span-full py-24 border-2 border-dashed border-white/5 rounded-3xl flex flex-col items-center justify-center gap-4 opacity-30">
            <Icon name="memory" size={40} className="text-slate-800" />
            <p className="text-[11px] font-black text-slate-600 uppercase tracking-[0.3em]">No matching neural patterns found</p>
          </div>
        ) : (
          filteredMemories.map(m => (
            <KnowledgeCell
              key={m.id}
              memory={m}
              agent={agents.find(a => a.id === m.agent_id)}
              onAgentClick={setSelectedAgent}
              onDelete={handleDeleteOne}
            />
          ))
        )}
      </div>

      {/* Unified Agent Detail Sidebar */}
      {selectedAgent && (
        <AgentDetailSidebar
          agent={selectedAgent}
          lastRuns={lastRuns[selectedAgent.id] ?? []}
          runCount={runCounts[selectedAgent.id] ?? 0}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  )
}
