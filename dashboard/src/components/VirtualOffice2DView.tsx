// ============================================================
// WAI Dashboard – Virtual Office 2D View  v3
//
// Behaviour mirrors the 3D view:
//  • Desks are empty by default — only Neb (Founder) and CEO
//    are always at their workstation.
//  • An agent's avatar appears at their desk ONLY when they are
//    working (status=busy OR has an active task).
//  • On arrival a CSS animation plays (slide-up + scale-in).
//  • The monitor screen changes colour to show where the agent
//    is even when they are away from their desk:
//      cyan  → working at desk
//      dim   → CEO idle at desk
//      purple→ in meeting room
//      amber → in lounge
//      dark  → offline
//      red   → error
//
// Desk Zone is divided by department:
//   Executive Suite · SaaS · Dev · Ops / Marketing
// ============================================================

import { useState, useMemo, useCallback, useEffect, memo } from 'react'
import type { Agent, AgentTeam, SystemEventWithContext, AgentRun, Task } from '../types/index.js'
import { useAgents, useAgentStats, useTasks, useEventsWithContext } from '../hooks/useSupabaseRealtime.js'

// ── CSS keyframes (injected once into document.head) ──────────────────────

const KEYFRAMES = `
@keyframes deskArrive {
  0%   { opacity: 0; transform: translateY(8px) scale(0.72); }
  62%  { transform: translateY(-2px) scale(1.06); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes softPulse {
  0%, 100% { opacity: 0.55; }
  50%       { opacity: 1; }
}
`

function useKeyframeInjection() {
  useEffect(() => {
    if (document.getElementById('wai-office-2d-kf')) return
    const style = document.createElement('style')
    style.id = 'wai-office-2d-kf'
    style.textContent = KEYFRAMES
    document.head.appendChild(style)
    return () => {
      const el = document.getElementById('wai-office-2d-kf')
      if (el) document.head.removeChild(el)
    }
  }, [])
}

// ── Constants ──────────────────────────────────────────────────────────────

const TEAM_COLORS: Record<AgentTeam, string> = {
  executive:  '#00D4FF',
  saas:       '#818CF8',
  dev:        '#34D399',
  consulting: '#22D3EE',
  marketing:  '#FBBF24',
  ops:        '#94A3B8',
}

const AGENT_EMOJI: Record<string, string> = {
  ceo:                  '👑',
  consulting_lead:      '📊',
  analyst:              '🔍',
  pm_saas:              '📋',
  dev_lead_saas:        '🏗',
  dev_saas_1:           '⚡',
  dev_saas_2:           '⚡',
  architect:            '🧩',
  dev_general_1:        '💻',
  dev_general_2:        '💻',
  qa:                   '🔬',
  ops:                  '⚙️',
  finance:              '💰',
  hr:                   '🤝',
  marketing_strategist: '📣',
  content_creator:      '✍️',
  social_manager:       '📱',
}

type ActivityState = 'working' | 'idle_desk' | 'idle_lounge' | 'idle_meeting' | 'offline' | 'error'

function getActivity(agent: Agent, hasActiveTask = false): ActivityState {
  if (agent.status === 'busy' || hasActiveTask) return 'working'
  if (agent.status === 'error')   return 'error'
  if (agent.status === 'offline') return 'offline'
  if (agent.id === 'ceo')         return 'idle_desk'
  const hash = agent.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return hash % 3 === 0 ? 'idle_meeting' : 'idle_lounge'
}

// Whether agent should physically appear at their desk
function isAtDesk(activity: ActivityState): boolean {
  return activity === 'working' || activity === 'idle_desk'
}

// Monitor screen appearance based on agent location
type ScreenState = { fill: string; stroke: string; glow?: string }

const SCREEN: Record<ActivityState, ScreenState> = {
  working:      { fill: 'rgba(34,211,238,0.16)',  stroke: '#22D3EE',              glow: '0 0 6px rgba(34,211,238,0.5)'  },
  idle_desk:    { fill: 'rgba(34,211,238,0.06)',  stroke: 'rgba(34,211,238,0.35)' },
  idle_meeting: { fill: 'rgba(129,140,248,0.08)', stroke: 'rgba(129,140,248,0.3)' },
  idle_lounge:  { fill: 'rgba(251,191,36,0.05)',  stroke: 'rgba(255,255,255,0.12)' },
  offline:      { fill: 'none',                   stroke: 'rgba(255,255,255,0.07)' },
  error:        { fill: 'rgba(239,68,68,0.1)',    stroke: 'rgba(239,68,68,0.4)',   glow: '0 0 4px rgba(239,68,68,0.35)' },
}

// ── Desk section definitions ───────────────────────────────────────────────

interface DeskSubgroupDef {
  label: string
  accent: string
  ids: readonly string[]
}

interface DeskSectionDef {
  id: string
  label: string
  accent: string
  hasFounder: boolean      // show static Neb slot at start of section
  subgroups: DeskSubgroupDef[]
}

const DESK_SECTIONS: DeskSectionDef[] = [
  {
    id: 'exec',
    label: 'Executive Suite',
    accent: '#FBBF24',
    hasFounder: true,
    subgroups: [
      { label: '', accent: '#FBBF24', ids: ['ceo', 'consulting_lead', 'analyst'] },
    ],
  },
  {
    id: 'saas',
    label: 'SaaS',
    accent: '#818CF8',
    hasFounder: false,
    subgroups: [
      { label: '', accent: '#818CF8', ids: ['pm_saas', 'dev_lead_saas', 'dev_saas_1', 'dev_saas_2'] },
    ],
  },
  {
    id: 'dev',
    label: 'Dev',
    accent: '#34D399',
    hasFounder: false,
    subgroups: [
      { label: '', accent: '#34D399', ids: ['architect', 'dev_general_1', 'dev_general_2', 'qa'] },
    ],
  },
  {
    id: 'ops_mkt',
    label: 'Ops / Marketing',
    accent: '#94A3B8',
    hasFounder: false,
    subgroups: [
      { label: 'OPS', accent: '#94A3B8', ids: ['ops', 'finance', 'hr'] },
      { label: 'MKT', accent: '#FBBF24', ids: ['marketing_strategist', 'content_creator', 'social_manager'] },
    ],
  },
]

// All desk-assigned agent IDs (for Hot Desk Zone exclusion logic)
const DESK_AGENT_IDS: readonly string[] = DESK_SECTIONS.flatMap(s => s.subgroups.flatMap(g => g.ids))

function getToolBadge(agentId: string, events: SystemEventWithContext[]): string | null {
  const recent = events.find(
    e => e.agent_id === agentId && typeof e.payload?.['tool_name'] === 'string',
  )
  if (!recent) return null
  const toolName = recent.payload['tool_name']
  return typeof toolName === 'string' && toolName.length > 0 ? toolName : null
}

function fmtTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000)    return `${Math.floor(diff / 1_000)}s`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  return `${Math.floor(diff / 3_600_000)}h`
}

// ── FounderSlot ────────────────────────────────────────────────────────────
// Static — Neb is always at their workstation.

function FounderSlot() {
  return (
    <div
      title="Neb — Founder"
      style={{
        width: 52, height: 56,
        background: 'rgba(251,191,36,0.06)',
        border: '1px solid rgba(251,191,36,0.18)',
        borderLeft: '2px solid #FBBF24',
        borderRadius: 5,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'space-between',
        padding: '3px 2px 3px',
        flexShrink: 0,
      }}
    >
      {/* Monitor — always lit (founder is always present) */}
      <svg width="26" height="16" viewBox="0 0 26 16" fill="none" style={{ opacity: 0.75 }}>
        <rect x="1" y="1" width="24" height="11" rx="2"
          stroke="#FBBF24" strokeWidth="1.2"
          fill="rgba(251,191,36,0.12)"
        />
        <text x="13" y="8.5" textAnchor="middle" fill="#FBBF24"
          fontSize="4.5" fontFamily="monospace" fontWeight="800" opacity="0.7">
          FOUNDER
        </text>
        <rect x="10" y="12" width="6" height="1.5" rx="0.5" fill="rgba(251,191,36,0.3)" />
        <rect x="7.5" y="13.5" width="11" height="1.2" rx="0.6" fill="rgba(251,191,36,0.2)" />
      </svg>

      {/* Avatar */}
      <div style={{
        width: 24, height: 24,
        borderRadius: '50%',
        background: 'rgba(251,191,36,0.12)',
        border: '1.5px solid #FBBF24',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13,
        boxShadow: '0 0 8px rgba(251,191,36,0.35)',
      }}>
        🧑‍💻
      </div>

      <span style={{
        fontSize: 7, fontFamily: 'monospace', fontWeight: 800,
        color: '#FBBF24', letterSpacing: '0.05em',
      }}>NEB</span>
    </div>
  )
}

// ── DeskSlot ───────────────────────────────────────────────────────────────
// 52×56px. Desk furniture always visible. Avatar appears only when isAtDesk.

interface DeskSlotProps {
  agent: Agent | null
  activity: ActivityState
  toolBadge: string | null
  selected: boolean
  onSelect: (a: Agent) => void
}

const DeskSlot = memo(function DeskSlot({ agent, activity, toolBadge, selected, onSelect }: DeskSlotProps) {
  const atDesk    = isAtDesk(activity)
  const screen    = agent ? SCREEN[activity] : SCREEN.offline
  const teamColor = agent ? (TEAM_COLORS[agent.team] ?? '#94A3B8') : '#1f2937'
  const leftBorder = agent ? teamColor : '#1f2937'
  const emoji      = agent ? AGENT_EMOJI[agent.id] : undefined
  const initials   = agent ? agent.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : ''
  const slotOpacity = agent ? (activity === 'offline' ? 0.3 : 1) : 0.22

  // Tool text on monitor screen (max 8 chars, only when working)
  const screenText = activity === 'working' && toolBadge
    ? toolBadge.replace(/_/g, '·').slice(0, 8)
    : ''

  const dotColor = !agent ? '#111'
    : activity === 'error'   ? '#EF4444'
    : activity === 'offline' ? '#374151'
    : activity === 'working' ? '#FBBF24'
    : '#34D399'

  return (
    <div
      className="group"
      style={{
        width: 52, height: 56, flexShrink: 0,
        background: selected ? 'rgba(255,255,255,0.07)' : 'rgba(10,18,35,0.85)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderLeft: `2px solid ${leftBorder}`,
        borderRadius: 5,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'space-between',
        padding: '3px 2px 2px',
        opacity: slotOpacity,
        cursor: agent ? 'pointer' : 'default',
        transition: 'background 0.15s, opacity 0.3s',
        boxShadow: selected ? `0 0 0 1px ${teamColor}50` : undefined,
      }}
      onClick={() => agent && onSelect(agent)}
      title={agent ? `${agent.name} — ${activity}` : 'Empty desk'}
    >
      {/* Monitor SVG */}
      <svg width="26" height="16" viewBox="0 0 26 16" fill="none"
        style={{ filter: screen.glow ? `drop-shadow(${screen.glow})` : undefined, flexShrink: 0 }}
      >
        <rect x="1" y="1" width="24" height="11" rx="2"
          stroke={screen.stroke} strokeWidth="1.2" fill={screen.fill}
        />
        {screenText && (
          <text x="13" y="8.5" textAnchor="middle" fill="#22D3EE"
            fontSize="4.5" fontFamily="monospace" fontWeight="700" opacity="0.9">
            {screenText}
          </text>
        )}
        {activity === 'error' && (
          <text x="13" y="8.5" textAnchor="middle" fill="#EF4444"
            fontSize="5" fontFamily="monospace" fontWeight="800">ERR</text>
        )}
        <rect x="10" y="12" width="6" height="1.5" rx="0.5" fill="rgba(255,255,255,0.2)" />
        <rect x="7.5" y="13.5" width="11" height="1.2" rx="0.6" fill="rgba(255,255,255,0.15)" />
      </svg>

      {/* Agent — only rendered when at desk (triggers deskArrive animation on mount) */}
      {agent && atDesk ? (
        <div
          key={`${agent.id}-atdesk`}
          style={{ animation: 'deskArrive 0.48s cubic-bezier(0.34,1.4,0.64,1) both' }}
          className="flex flex-col items-center"
        >
          <div
            className="relative group-hover:scale-110 transition-transform"
            style={{ width: 22, height: 22, borderRadius: '50%' }}
          >
            {/* Pulse ring when working */}
            {activity === 'working' && (
              <div
                className="absolute inset-0 rounded-full animate-ping"
                style={{ border: `1.5px solid ${teamColor}`, opacity: 0.3, animationDuration: '2.2s' }}
              />
            )}
            <div
              className="relative rounded-full flex items-center justify-center select-none"
              style={{
                width: 22, height: 22,
                background: '#070C1A',
                border: `1.5px solid ${teamColor}`,
                fontSize: 10,
                boxShadow: activity === 'working'
                  ? `0 0 6px ${teamColor}60`
                  : selected ? `0 0 8px ${teamColor}80` : undefined,
              }}
            >
              {emoji !== undefined
                ? <span style={{ fontSize: 10 }}>{emoji}</span>
                : <span style={{ fontSize: 7, fontWeight: 700, color: teamColor }}>{initials}</span>
              }
            </div>
            {/* Status dot */}
            <div style={{
              position: 'absolute', bottom: 0, right: 0,
              width: 6, height: 6, borderRadius: '50%',
              background: dotColor, border: '1px solid #070C1A',
            }} />
          </div>
          <span style={{
            fontSize: 6.5, fontFamily: 'sans-serif',
            color: '#94A3B8', maxWidth: 48,
            overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap', marginTop: 1, lineHeight: 1,
          }}>
            {agent.name.split(' ')[0]}
          </span>
        </div>
      ) : (
        // Empty desk — small area indicator dot
        <div style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {agent && activity !== 'offline' && (
            <div style={{
              width: 4, height: 4, borderRadius: '50%',
              background: activity === 'idle_meeting' ? 'rgba(129,140,248,0.5)'
                : activity === 'idle_lounge' ? 'rgba(251,191,36,0.35)'
                : 'rgba(255,255,255,0.1)',
              animation: 'softPulse 3s ease-in-out infinite',
            }} />
          )}
        </div>
      )}
    </div>
  )
})

// ── DeskSection ────────────────────────────────────────────────────────────

interface DeskSectionProps {
  section: DeskSectionDef
  byId: Record<string, Agent>
  taskMap: Record<string, string>
  events: SystemEventWithContext[]
  selected: Agent | null
  onSelect: (a: Agent) => void
}

function DeskSection({ section, byId, taskMap, events, selected, onSelect }: DeskSectionProps) {
  const multiGroup = section.subgroups.length > 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, height: 10 }}>
        <div style={{ width: 2, height: 9, borderRadius: 1, background: section.accent, opacity: 0.75 }} />
        <span style={{
          fontSize: 7, fontFamily: 'monospace', fontWeight: 900,
          color: section.accent, opacity: 0.65,
          textTransform: 'uppercase', letterSpacing: '0.2em',
        }}>
          {section.label}
        </span>
        <div style={{ flex: 1, height: 1, background: `${section.accent}18` }} />
      </div>

      {/* Slots row */}
      {multiGroup ? (
        // Two subgroups side by side (Ops / Marketing)
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          {section.subgroups.map((grp, gi) => (
            <div key={gi} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {grp.label && (
                <span style={{
                  fontSize: 6, fontFamily: 'monospace', fontWeight: 700,
                  color: grp.accent, opacity: 0.5,
                  textTransform: 'uppercase', letterSpacing: '0.15em',
                }}>
                  {grp.label}
                </span>
              )}
              <div style={{ display: 'flex', gap: 3 }}>
                {grp.ids.map(id => {
                  const agent    = byId[id] ?? null
                  const activity = agent ? getActivity(agent, !!taskMap[id]) : 'offline'
                  return (
                    <DeskSlot
                      key={id}
                      agent={agent}
                      activity={activity}
                      toolBadge={agent ? getToolBadge(agent.id, events) : null}
                      selected={selected?.id === id}
                      onSelect={onSelect}
                    />
                  )
                })}
              </div>
            </div>
          ))}
          {/* Vertical divider between subgroups */}
          <div style={{ width: 1, background: 'rgba(255,255,255,0.05)', alignSelf: 'stretch', marginTop: 10 }} />
        </div>
      ) : (
        // Single subgroup — flat row with optional Neb slot
        <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end' }}>
          {section.hasFounder && <FounderSlot />}
          {(section.subgroups[0]?.ids ?? []).map(id => {
            const agent    = byId[id] ?? null
            const activity = agent ? getActivity(agent, !!taskMap[id]) : 'offline'
            return (
              <DeskSlot
                key={id}
                agent={agent}
                activity={activity}
                toolBadge={agent ? getToolBadge(agent.id, events) : null}
                selected={selected?.id === id}
                onSelect={onSelect}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── DeskZone ───────────────────────────────────────────────────────────────

interface ZoneProps {
  agents: Agent[]
  taskMap: Record<string, string>
  events: SystemEventWithContext[]
  selected: Agent | null
  onSelect: (a: Agent) => void
}

function DeskZone({ agents, taskMap, events, selected, onSelect }: ZoneProps) {
  const byId = useMemo(() => {
    const m: Record<string, Agent> = {}
    for (const a of agents) m[a.id] = a
    return m
  }, [agents])

  return (
    <div
      className="h-full overflow-hidden"
      style={{
        display: 'flex', flexDirection: 'column',
        padding: 9, gap: 6,
        borderTop: '2px solid rgba(0,212,255,0.3)',
      }}
    >
      {/* Zone label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
        <div style={{ width: 3, height: 10, borderRadius: 1.5, background: '#00D4FF', opacity: 0.7 }} />
        <span style={{
          fontSize: 8, fontFamily: 'monospace', fontWeight: 900,
          color: '#00D4FF', opacity: 0.6,
          textTransform: 'uppercase', letterSpacing: '0.2em',
        }}>
          Desk Zone
        </span>
      </div>

      {/* Sections */}
      {DESK_SECTIONS.map(section => (
        <DeskSection
          key={section.id}
          section={section}
          byId={byId}
          taskMap={taskMap}
          events={events}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

// ── AgentAvatar2D ──────────────────────────────────────────────────────────
// Used by Meeting Zone and Lounge Zone (not DeskSlot, which has its own avatar).

interface AgentAvatar2DProps {
  agent: Agent
  activity: ActivityState
  toolBadge: string | null
  selected: boolean
  onClick: (agent: Agent) => void
  size?: number
}

const AgentAvatar2D = memo(function AgentAvatar2D({
  agent, activity, toolBadge, selected, onClick, size = 38,
}: AgentAvatar2DProps) {
  const teamColor = TEAM_COLORS[agent.team] ?? '#94A3B8'
  const isWorking = activity === 'working'
  const isOffline = activity === 'offline'
  const isError   = activity === 'error'
  const borderCol = isError ? '#EF4444' : isOffline ? '#374151' : teamColor
  const initials  = agent.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const emoji     = AGENT_EMOJI[agent.id]
  const dotColor  = isError ? '#EF4444' : isOffline ? '#374151' : isWorking ? '#FBBF24' : '#34D399'

  return (
    <div
      className="flex flex-col items-center cursor-pointer group flex-shrink-0"
      style={{ width: size + 10 }}
      onClick={() => onClick(agent)}
      title={`${agent.name} — ${activity}`}
    >
      <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
        {isWorking && (
          <div className="absolute inset-0 rounded-full animate-ping"
            style={{ border: `2px solid ${teamColor}`, opacity: 0.28, animationDuration: '2s' }} />
        )}
        <div
          className="relative rounded-full flex items-center justify-center select-none transition-transform group-hover:scale-110"
          style={{
            width: size, height: size,
            background: isOffline ? '#111827' : '#0D1526',
            border: `2px solid ${borderCol}`,
            boxShadow: selected
              ? `0 0 0 2px ${teamColor}50, 0 0 10px ${teamColor}50`
              : isWorking ? `0 0 7px ${teamColor}50` : undefined,
            fontSize: size * 0.44,
            opacity: isOffline ? 0.4 : 1,
          }}
        >
          {emoji !== undefined
            ? <span>{emoji}</span>
            : <span style={{ fontSize: size * 0.34, fontWeight: 700, color: teamColor }}>{initials}</span>
          }
        </div>
        {/* Status dot */}
        <div style={{
          position: 'absolute', bottom: 0, right: 0,
          width: 9, height: 9, borderRadius: '50%',
          background: dotColor, border: '1.5px solid #070C1A',
        }} />
        {/* Tool badge — absolute, no extra height */}
        {toolBadge && (
          <div style={{
            position: 'absolute', top: -7, left: '50%',
            transform: 'translateX(-50%)',
            background: '#EA580C', color: '#fff',
            fontSize: 6.5, fontFamily: 'monospace', fontWeight: 700,
            padding: '1px 4px', borderRadius: 3,
            whiteSpace: 'nowrap', maxWidth: size + 14,
            overflow: 'hidden', textOverflow: 'ellipsis',
            lineHeight: 1.4, zIndex: 2,
          }}>
            {toolBadge.replace(/_/g, ' ').slice(0, 11)}
          </div>
        )}
      </div>
      <span style={{
        fontSize: 8, fontFamily: 'sans-serif',
        color: '#64748b', maxWidth: size + 8,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        marginTop: 2, lineHeight: 1,
      }}
        className="group-hover:text-slate-300 transition-colors"
      >
        {agent.name.split(' ')[0] ?? agent.name}
      </span>
    </div>
  )
})

// ── Meeting Zone ───────────────────────────────────────────────────────────

function MeetingZone({ agents, taskMap, events, selected, onSelect }: ZoneProps) {
  const meetingAgents = useMemo(
    () => agents.filter(a => getActivity(a, !!taskMap[a.id]) === 'idle_meeting'),
    [agents, taskMap],
  )

  const CX = 150, CY = 108, R = 75
  const positions = useMemo(() =>
    meetingAgents.map((_, i) => {
      const angle = (i / Math.max(meetingAgents.length, 1)) * 2 * Math.PI - Math.PI / 2
      return { x: CX + R * Math.cos(angle), y: CY + R * Math.sin(angle) }
    }),
  [meetingAgents])

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ padding: 9, borderTop: '2px solid rgba(129,140,248,0.4)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4, flexShrink: 0 }}>
        <div style={{ width: 3, height: 10, borderRadius: 1.5, background: '#818CF8', opacity: 0.7 }} />
        <span style={{ fontSize: 8, fontFamily: 'monospace', fontWeight: 900, color: '#818CF8', opacity: 0.6, textTransform: 'uppercase' as const, letterSpacing: '0.2em' }}>
          Meeting Zone
        </span>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <svg className="absolute inset-0 w-full h-full"
          viewBox="0 0 300 216" preserveAspectRatio="xMidYMid meet"
          style={{ pointerEvents: 'none' }}
        >
          {/* Connection lines */}
          {meetingAgents.length > 1 && meetingAgents.map((_, i) => {
            const a = positions[i]!, b = positions[(i + 1) % meetingAgents.length]!
            return (
              <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke="rgba(129,140,248,0.13)" strokeWidth="1" strokeDasharray="4 3" />
            )
          })}
          {/* Table outer */}
          <circle cx={CX} cy={CY} r={46}
            fill="rgba(129,140,248,0.04)" stroke="rgba(129,140,248,0.2)" strokeWidth="1.5" />
          {/* Table inner */}
          <circle cx={CX} cy={CY} r={38}
            fill="rgba(13,18,41,0.9)" stroke="rgba(129,140,248,0.08)" strokeWidth="1" />
          {/* Chair slots */}
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i / 8) * 2 * Math.PI
            return (
              <circle key={i}
                cx={CX + 50 * Math.cos(a)} cy={CY + 50 * Math.sin(a)} r={3.5}
                fill="rgba(129,140,248,0.08)" stroke="rgba(129,140,248,0.18)" strokeWidth="1" />
            )
          })}
          {/* Label */}
          <text x={CX} y={CY - 4} textAnchor="middle"
            fill="rgba(129,140,248,0.28)" fontSize="9" fontFamily="monospace" fontWeight="900" letterSpacing="4">
            MTG
          </text>
          <text x={CX} y={CY + 9} textAnchor="middle"
            fill="rgba(129,140,248,0.15)" fontSize="7" fontFamily="monospace">
            {meetingAgents.length} agents
          </text>
        </svg>

        {meetingAgents.map((agent, i) => {
          const pos = positions[i]!
          return (
            <div key={agent.id} className="absolute"
              style={{
                left: `${(pos.x / 300) * 100}%`,
                top: `${(pos.y / 216) * 100}%`,
                transform: 'translate(-50%, -50%)', zIndex: 1,
              }}
            >
              <AgentAvatar2D
                agent={agent}
                activity={getActivity(agent, !!taskMap[agent.id])}
                toolBadge={getToolBadge(agent.id, events)}
                selected={selected?.id === agent.id}
                onClick={onSelect}
                size={30}
              />
            </div>
          )
        })}

        {meetingAgents.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[9px] text-slate-700 font-mono">No meetings</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Hot Desk Zone ──────────────────────────────────────────────────────────

function HotDeskZone({ agents, taskMap, events, selected, onSelect }: ZoneProps) {
  const hotAgents = useMemo(
    () => agents.filter(a => !DESK_AGENT_IDS.includes(a.id)),
    [agents],
  )
  const slots = Array.from({ length: 6 }, (_, i) => hotAgents[i] ?? null)

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ padding: 9, borderTop: '2px solid rgba(34,211,238,0.3)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6, flexShrink: 0 }}>
        <div style={{ width: 3, height: 10, borderRadius: 1.5, background: '#22D3EE', opacity: 0.7 }} />
        <span style={{ fontSize: 8, fontFamily: 'monospace', fontWeight: 900, color: '#22D3EE', opacity: 0.6, textTransform: 'uppercase' as const, letterSpacing: '0.2em' }}>
          Hot Desk Zone
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {slots.map((agent, i) => (
          <DeskSlot
            key={i}
            agent={agent}
            activity={agent ? getActivity(agent, !!taskMap[agent.id]) : 'offline'}
            toolBadge={agent ? getToolBadge(agent.id, events) : null}
            selected={agent !== null && selected?.id === agent.id}
            onSelect={onSelect}
          />
        ))}
      </div>
      {hotAgents.length === 0 && (
        <p style={{ fontSize: 8, color: '#334155', fontFamily: 'monospace', marginTop: 4 }}>All agents assigned</p>
      )}
    </div>
  )
}

// ── Lounge Zone ────────────────────────────────────────────────────────────

function LoungeZone({ agents, taskMap, events, selected, onSelect }: ZoneProps) {
  const loungeAgents = useMemo(
    () => agents.filter(a => {
      const act = getActivity(a, !!taskMap[a.id])
      return act === 'idle_lounge' || act === 'offline'
    }),
    [agents, taskMap],
  )

  return (
    <div
      className="relative h-full overflow-hidden"
      style={{ borderTop: '2px solid rgba(251,191,36,0.3)' }}
    >
      {/* Furniture — percentage-based */}
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 0 }}>
        {/* Left sofa */}
        <div style={{
          position: 'absolute', left: '5%', bottom: '9%',
          width: '28%', height: '12%', minHeight: 12,
          background: 'rgba(26,40,69,0.9)', borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.06)',
        }} />
        {/* Right sofa */}
        <div style={{
          position: 'absolute', right: '5%', bottom: '9%',
          width: '28%', height: '12%', minHeight: 12,
          background: 'rgba(26,40,69,0.9)', borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.06)',
        }} />
        {/* Coffee table */}
        <div style={{
          position: 'absolute', left: '50%', bottom: '13%',
          transform: 'translateX(-50%)',
          width: '18%', height: '8%', minWidth: 24, minHeight: 9,
          background: 'rgba(15,23,42,0.85)', borderRadius: 5,
          border: '1px solid rgba(255,255,255,0.06)',
        }} />
        {/* Plants */}
        {([
          { l: '4%',  t: '22%', s: 13 },
          { r: '4%',  t: '20%', s: 15 },
          { l: '46%', t: '40%', s: 11 },
        ] as { l?: string; r?: string; t: string; s: number }[]).map((p, i) => (
          <div key={i} style={{
            position: 'absolute',
            left: p.l, right: p.r, top: p.t,
            width: p.s, height: p.s,
            background: '#14532d', borderRadius: '50%',
            border: '1px solid rgba(22,163,74,0.4)',
            boxShadow: '0 0 8px rgba(22,163,74,0.18)',
          }} />
        ))}
        {/* Watermark */}
        <div style={{
          position: 'absolute', left: '50%', top: '54%',
          transform: 'translate(-50%,-50%)',
          fontSize: 10, fontFamily: 'monospace', fontWeight: 900,
          color: 'rgba(255,255,255,0.04)', letterSpacing: '0.3em',
          whiteSpace: 'nowrap', userSelect: 'none',
        }}>
          OPENCLAW
        </div>
      </div>

      {/* Content */}
      <div className="relative h-full overflow-hidden flex flex-col"
        style={{ padding: 9, zIndex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4, flexShrink: 0 }}>
          <div style={{ width: 3, height: 10, borderRadius: 1.5, background: '#FBBF24', opacity: 0.7 }} />
          <span style={{ fontSize: 8, fontFamily: 'monospace', fontWeight: 900, color: '#FBBF24', opacity: 0.6, textTransform: 'uppercase' as const, letterSpacing: '0.2em' }}>
            Lounge Zone
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {loungeAgents.map(agent => (
            <AgentAvatar2D
              key={agent.id}
              agent={agent}
              activity={getActivity(agent, !!taskMap[agent.id])}
              toolBadge={getToolBadge(agent.id, events)}
              selected={selected?.id === agent.id}
              onClick={onSelect}
              size={32}
            />
          ))}
          {loungeAgents.length === 0 && (
            <span style={{ fontSize: 8, color: '#334155', fontFamily: 'monospace', marginTop: 6 }}>
              Everyone's busy
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Agent Popup ────────────────────────────────────────────────────────────

function AgentPopup({ agent, runs, runCount, tasks, events, onClose }: {
  agent: Agent
  runs: AgentRun[]
  runCount: number
  tasks: Task[]
  events: SystemEventWithContext[]
  onClose: () => void
}) {
  const teamColor  = TEAM_COLORS[agent.team] ?? '#94A3B8'
  const agentTasks = tasks.filter(t => t.assignee_agent_id === agent.id)
  const agentEvts  = events.filter(e => e.agent_id === agent.id).slice(0, 4)
  const totalCost  = runs.reduce((s, r) => s + (r.cost_usd ?? 0), 0)
  const allTools   = Array.from(new Set(runs.flatMap(r => r.tools_used ?? [])))
  const emoji      = AGENT_EMOJI[agent.id]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        className="relative w-72 rounded-xl border p-4 shadow-2xl"
        style={{ background: '#0D1526', borderColor: `${teamColor}30` }}
        onClick={e => e.stopPropagation()}
      >
        <button className="absolute top-3 right-3 text-slate-600 hover:text-slate-300 text-xs transition-colors"
          onClick={onClose}>✕</button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0"
            style={{ background: '#070C1A', border: `2px solid ${teamColor}` }}>
            {emoji ?? agent.name[0]}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-white truncate">{agent.name}</p>
            <p className="text-[10px] text-slate-400 truncate">{agent.role}</p>
            <p className="text-[9px] font-mono" style={{ color: teamColor }}>{agent.team}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { label: 'Runs',  value: runCount },
            { label: 'Cost',  value: `$${totalCost.toFixed(3)}` },
            { label: 'Tools', value: allTools.length },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-lg p-2 text-center" style={{ background: '#070C1A' }}>
              <p className="text-xs font-mono font-bold text-white">{value}</p>
              <p className="text-[9px] text-slate-600 uppercase tracking-wider">{label}</p>
            </div>
          ))}
        </div>

        {agentTasks.length > 0 && (
          <div className="mb-3">
            <p className="text-[9px] text-slate-600 uppercase tracking-widest font-mono mb-1.5">Active Tasks</p>
            {agentTasks.slice(0, 3).map(t => (
              <div key={t.id} className="flex items-center gap-1.5 mb-1">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                <span className="text-[10px] text-amber-300 truncate">{t.title}</span>
              </div>
            ))}
          </div>
        )}

        {allTools.length > 0 && (
          <div className="mb-3">
            <p className="text-[9px] text-slate-600 uppercase tracking-widest font-mono mb-1.5">Tools Used</p>
            <div className="flex flex-wrap gap-1">
              {allTools.slice(0, 8).map(t => (
                <span key={t} className="text-[8px] font-mono px-1.5 py-0.5 rounded"
                  style={{ background: '#070C1A', color: '#94A3B8', border: '1px solid rgba(255,255,255,0.08)' }}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {agentEvts.length > 0 && (
          <div>
            <p className="text-[9px] text-slate-600 uppercase tracking-widest font-mono mb-1.5">Recent Events</p>
            {agentEvts.map(e => (
              <div key={e.id} className="flex items-start gap-2 mb-1">
                <span className="text-[8px] text-slate-700 font-mono flex-shrink-0 mt-px">{fmtTime(e.created_at)}</span>
                <span className="text-[9px] text-slate-400 truncate">{e.type}</span>
              </div>
            ))}
          </div>
        )}

        {agentTasks.length === 0 && agentEvts.length === 0 && runCount === 0 && (
          <p className="text-[9px] text-slate-700 font-mono text-center py-2">No activity yet</p>
        )}
      </div>
    </div>
  )
}

// ── Right Sidebar ──────────────────────────────────────────────────────────

function RightSidebar({ agents, taskMap, events, lastRuns, selected, onSelect }: {
  agents: Agent[]
  taskMap: Record<string, string>
  events: SystemEventWithContext[]
  lastRuns: Record<string, AgentRun[]>
  selected: Agent | null
  onSelect: (a: Agent) => void
}) {
  const [tab, setTab] = useState<'overview' | 'activity'>('overview')

  const workingCount = agents.filter(a => a.status === 'busy' || !!taskMap[a.id]).length
  const onlineCount  = agents.filter(a => a.status !== 'offline').length
  const totalTokens  = Object.values(lastRuns).flat()
    .reduce((s, r) => s + (r.tokens_input ?? 0) + (r.tokens_output ?? 0), 0)
  const meetCount    = agents.filter(a => getActivity(a, !!taskMap[a.id]) === 'idle_meeting').length
  const collabPct    = agents.length > 0 ? Math.round((meetCount / agents.length) * 100) : 0

  return (
    <div
      className="flex flex-col border-l border-white/[0.07] flex-shrink-0"
      style={{ width: 256, background: '#070C1A' }}
    >
      <div className="px-4 py-2.5 border-b border-white/[0.07] flex items-center justify-between flex-shrink-0">
        <span className="text-[10px] font-black font-mono text-slate-300 uppercase tracking-widest">AGENTS</span>
        <span className="text-[8px] text-slate-600 font-mono">{onlineCount}/{agents.length} online</span>
      </div>

      <div className="grid grid-cols-3 border-b border-white/[0.07] flex-shrink-0">
        {[
          { label: 'Active',  value: `${workingCount}/${agents.length}`, color: '#00D4FF' },
          { label: 'Tokens',  value: totalTokens > 999 ? `${(totalTokens / 1000).toFixed(0)}k` : String(totalTokens), color: '#e2e8f0' },
          { label: 'Collab%', value: `${collabPct}%`, color: '#F97316' },
        ].map(({ label, value, color }, i) => (
          <div key={label} className="flex flex-col items-center py-2"
            style={{ borderRight: i < 2 ? '1px solid rgba(255,255,255,0.04)' : undefined }}>
            <span className="text-[11px] font-mono font-bold" style={{ color }}>{value}</span>
            <span className="text-[7px] text-slate-600 uppercase tracking-wider">{label}</span>
          </div>
        ))}
      </div>

      <div className="flex border-b border-white/[0.07] flex-shrink-0">
        {(['overview', 'activity'] as const).map(t => (
          <button key={t}
            className="flex-1 py-1.5 text-[8px] font-mono uppercase tracking-widest transition-colors"
            style={{
              color: tab === t ? '#00D4FF' : '#64748b',
              borderBottom: tab === t ? '1px solid #00D4FF' : '1px solid transparent',
              background: 'none',
            }}
            onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'overview' && (
          <div className="py-1">
            {agents.map(agent => {
              const activity   = getActivity(agent, !!taskMap[agent.id])
              const teamColor  = TEAM_COLORS[agent.team] ?? '#94A3B8'
              const isWorking  = activity === 'working'
              const isOffline  = activity === 'offline'
              const isSelected = selected?.id === agent.id
              const emoji      = AGENT_EMOJI[agent.id]
              return (
                <button key={agent.id}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-white/[0.03]"
                  style={{ background: isSelected ? 'rgba(255,255,255,0.04)' : undefined }}
                  onClick={() => onSelect(agent)}>
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: isOffline ? '#374151' : teamColor, boxShadow: isWorking ? `0 0 5px ${teamColor}` : undefined }} />
                  <span className="flex-shrink-0" style={{ fontSize: 12, opacity: isOffline ? 0.35 : 0.85 }}>
                    {emoji ?? '🤖'}
                  </span>
                  <span className="flex-1 text-[10px] truncate" style={{ color: isOffline ? '#4B5563' : '#CBD5E1' }}>
                    {agent.name}
                  </span>
                  <span className="text-[7px] font-mono px-1.5 py-0.5 rounded font-bold flex-shrink-0"
                    style={{
                      background: isWorking ? '#78350f' : isOffline ? '#1f2937' : '#052e16',
                      color:      isWorking ? '#FCD34D' : isOffline ? '#6B7280' : '#34D399',
                    }}>
                    {isWorking ? 'Busy' : isOffline ? 'Off' : 'Idle'}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {tab === 'activity' && (
          <div className="py-2 px-3 flex flex-col gap-1.5">
            <span className="text-[7px] text-slate-700 uppercase tracking-widest font-mono mb-0.5">Recent Events</span>
            {events.slice(0, 15).map(e => {
              const sevColor = e.severity === 'error' || e.severity === 'critical' ? '#EF4444'
                : e.severity === 'warning' ? '#FBBF24' : '#00D4FF'
              return (
                <div key={e.id} className="flex items-start gap-1.5">
                  <div className="w-1 h-1 rounded-full mt-1.5 flex-shrink-0" style={{ background: sevColor }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] text-slate-400 truncate">{e.type}</p>
                    {e.agent_id && <p className="text-[8px] text-slate-600 truncate">{e.agent_id}</p>}
                  </div>
                  <span className="text-[7px] text-slate-700 font-mono flex-shrink-0">{fmtTime(e.created_at)}</span>
                </div>
              )
            })}
            {events.length === 0 && <p className="text-[8px] text-slate-700 font-mono">No events yet</p>}
          </div>
        )}
      </div>

      <div className="border-t border-white/[0.07] px-3 py-2 flex-shrink-0">
        <span className="text-[7px] text-slate-700 font-mono uppercase tracking-widest">Timeline</span>
        <div className="mt-1 flex flex-col gap-0.5">
          {events.slice(0, 4).map(e => (
            <div key={e.id} className="flex items-center gap-1.5">
              <span className="text-[7px] text-slate-700 font-mono flex-shrink-0">{fmtTime(e.created_at)}</span>
              <span className="text-[7px] text-slate-500 truncate">{e.type}</span>
            </div>
          ))}
          {events.length === 0 && <span className="text-[7px] text-slate-700 font-mono">—</span>}
        </div>
      </div>
    </div>
  )
}

// ── Main Export ────────────────────────────────────────────────────────────

export interface VirtualOffice2DViewProps {
  onToggle3D: () => void
}

export function VirtualOffice2DView({ onToggle3D }: VirtualOffice2DViewProps) {
  useKeyframeInjection()

  const { data: agents, loading, error } = useAgents()
  const { runCounts, lastRuns }          = useAgentStats()
  const { data: activeTasks }            = useTasks('in_progress')
  const { data: recentEvents }           = useEventsWithContext(20)

  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)

  const taskMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const t of activeTasks) {
      if (t.assignee_agent_id && !map[t.assignee_agent_id])
        map[t.assignee_agent_id] = t.title
    }
    return map
  }, [activeTasks])

  const handleSelect = useCallback((agent: Agent) => {
    setSelectedAgent(prev => prev?.id === agent.id ? null : agent)
  }, [])
  const handleClose  = useCallback(() => setSelectedAgent(null), [])

  const busyCount = agents.filter(a => a.status === 'busy' || !!taskMap[a.id]).length

  if (loading) return (
    <div className="flex items-center justify-center bg-[#070C1A]"
      style={{ height: 'calc(100vh - 92px)' }}>
      <div className="flex flex-col items-center gap-3">
        <div className="w-6 h-6 border-2 border-[#00D4FF]/30 border-t-[#00D4FF] rounded-full animate-spin" />
        <p className="text-[11px] text-slate-600 font-mono tracking-wider">Initializing office…</p>
      </div>
    </div>
  )

  if (error) return (
    <div className="flex items-center justify-center bg-[#070C1A]"
      style={{ height: 'calc(100vh - 92px)' }}>
      <p className="text-rose-400 text-sm">Error: {error}</p>
    </div>
  )

  return (
    <div className="flex flex-col bg-[#070C1A]"
      style={{ height: 'calc(100vh - 92px)', overflow: 'hidden' }}>

      {/* ── Topbar ── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/[0.07] flex-shrink-0"
        style={{ background: 'rgba(7,12,26,0.98)' }}>
        <span className="text-[11px] font-black text-[#00D4FF] font-mono uppercase tracking-widest">WAI Office</span>
        <span className="text-[8px] text-slate-700 font-mono">v2.0</span>
        <span className="w-px h-4 bg-white/[0.08]" />

        <div className="flex rounded overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
          <button
            className="px-2.5 py-1 text-[9px] font-mono font-bold cursor-default"
            style={{ background: 'rgba(0,212,255,0.18)', color: '#00D4FF' }}>
            2D
          </button>
          <button
            className="px-2.5 py-1 text-[9px] font-mono text-slate-500 hover:text-slate-300 transition-colors"
            style={{ background: 'none' }}
            onClick={onToggle3D}>
            3D
          </button>
        </div>

        <span className="w-px h-4 bg-white/[0.08]" />
        <span className="text-[10px] text-slate-400 font-mono">
          Active{' '}
          <span className="font-bold" style={{ color: '#00D4FF' }}>{busyCount}</span>
          <span className="text-slate-600">/{agents.length}</span>
        </span>
        <span className="w-px h-4 bg-white/[0.08]" />
        <span className="flex items-center gap-1.5 text-[8px] text-emerald-400 font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Connected
        </span>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Office map */}
        <div className="flex-1 overflow-hidden min-w-0">
          <div
            className="w-full h-full grid"
            style={{
              gridTemplateColumns: '3fr 2fr',
              gridTemplateRows: '1fr 1fr',
              gap: 1,
              background: 'rgba(255,255,255,0.04)',
            }}
          >
            {/* Top-left: Desk Zone */}
            <div className="overflow-hidden" style={{ background: '#0D1526' }}>
              <DeskZone
                agents={agents} taskMap={taskMap} events={recentEvents}
                selected={selectedAgent} onSelect={handleSelect}
              />
            </div>

            {/* Top-right: Meeting Zone */}
            <div className="overflow-hidden" style={{ background: '#0E1229' }}>
              <MeetingZone
                agents={agents} taskMap={taskMap} events={recentEvents}
                selected={selectedAgent} onSelect={handleSelect}
              />
            </div>

            {/* Bottom-left: Hot Desk Zone */}
            <div className="overflow-hidden" style={{ background: '#0B1520' }}>
              <HotDeskZone
                agents={agents} taskMap={taskMap} events={recentEvents}
                selected={selectedAgent} onSelect={handleSelect}
              />
            </div>

            {/* Bottom-right: Lounge Zone */}
            <div className="overflow-hidden" style={{ background: '#0D120A' }}>
              <LoungeZone
                agents={agents} taskMap={taskMap} events={recentEvents}
                selected={selectedAgent} onSelect={handleSelect}
              />
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <RightSidebar
          agents={agents}
          taskMap={taskMap}
          events={recentEvents}
          lastRuns={lastRuns}
          selected={selectedAgent}
          onSelect={handleSelect}
        />
      </div>

      {/* Agent popup */}
      {selectedAgent && (
        <AgentPopup
          agent={selectedAgent}
          runs={lastRuns[selectedAgent.id] ?? []}
          runCount={runCounts[selectedAgent.id] ?? 0}
          tasks={activeTasks}
          events={recentEvents}
          onClose={handleClose}
        />
      )}
    </div>
  )
}
