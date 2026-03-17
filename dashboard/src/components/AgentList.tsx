import { useAgents } from '../hooks/useSupabaseRealtime.js'
import type { Agent, AgentStatus } from '../types/index.js'
import { clsx } from 'clsx'

const STATUS_COLORS: Record<AgentStatus, string> = {
  online: 'bg-green-500',
  busy: 'bg-yellow-500',
  offline: 'bg-gray-400',
  error: 'bg-red-500',
}

const TEAM_LABELS: Record<string, string> = {
  executive: 'Executive',
  saas: 'SaaS',
  dev: 'Development',
  consulting: 'Consulting',
  marketing: 'Marketing',
  ops: 'Operations',
}

function AgentCard({ agent }: { agent: Agent }) {
  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 hover:border-gray-500 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={clsx('inline-block w-2 h-2 rounded-full flex-shrink-0', STATUS_COLORS[agent.status])}
              title={agent.status}
            />
            <span className="font-medium text-white truncate">{agent.name}</span>
          </div>
          <p className="text-gray-400 text-xs mt-1 truncate">{agent.role}</p>
        </div>
        <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded flex-shrink-0">
          {agent.model_id}
        </span>
      </div>
    </div>
  )
}

export function AgentList() {
  const { data: agents, loading, error } = useAgents()

  if (loading) return <div className="text-gray-400 text-sm p-4">Loading agents...</div>
  if (error) return <div className="text-red-400 text-sm p-4">Error: {error}</div>

  const byTeam = agents.reduce<Record<string, Agent[]>>((acc, agent) => {
    const team = agent.team
    if (!acc[team]) acc[team] = []
    acc[team]!.push(agent)
    return acc
  }, {})

  const onlineCount = agents.filter((a) => a.status === 'online').length

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Agents</h2>
        <span className="text-sm text-gray-400">
          {onlineCount}/{agents.length} online
        </span>
      </div>

      <div className="space-y-6">
        {Object.entries(byTeam).map(([team, teamAgents]) => (
          <div key={team}>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              {TEAM_LABELS[team] ?? team}
            </h3>
            <div className="space-y-2">
              {teamAgents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
