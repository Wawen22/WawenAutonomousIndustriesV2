// ============================================================
// WAI Dashboard – Supabase Realtime Hooks
// ============================================================

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import type {
  Agent,
  AgentMemory,
  AgentRun,
  AgentRunWithContext,
  Client,
  Payment,
  Project,
  ProjectChecklistItem,
  ProjectState,
  SystemEvent,
  SystemEventWithContext,
  Task,
} from '../types/index.js'

// ---------------------------------------------------------------------------
// Generic realtime hook
// ---------------------------------------------------------------------------

// Unique counter so multiple hook instances on the same table never share
// the same Supabase channel (sharing causes removeChannel to silently kill
// a sibling subscription that is still alive).
let _channelSeq = 0

function useRealtimeTable<T extends object>(
  table: string,
  fetchFn: () => Promise<T[]>
): { data: T[]; loading: boolean; error: string | null } {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Stable channel id for the lifetime of this hook instance
  const channelId = useState(() => `rt-${table}-${++_channelSeq}`)[0]

  const fetch = useCallback(async () => {
    try {
      setLoading(true)
      const result = await fetchFn()
      setData(result)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [fetchFn])

  useEffect(() => {
    void fetch()

    const channel = supabase
      .channel(channelId)
      .on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        void fetch()
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [table, fetch, channelId])

  return { data, loading, error }
}

// ---------------------------------------------------------------------------
// Specific hooks
// ---------------------------------------------------------------------------

export function useAgents() {
  const fetchAgents = useCallback(async (): Promise<Agent[]> => {
    const { data, error } = await supabase
      .from('agents')
      .select('*')
      .order('team')
    if (error) throw new Error(error.message)
    return (data ?? []) as Agent[]
  }, [])

  return useRealtimeTable<Agent>('agents', fetchAgents)
}

export function useTasks(statusFilter?: string) {
  const fetchTasks = useCallback(async (): Promise<Task[]> => {
    let query = supabase.from('tasks').select('*').order('priority').order('created_at', { ascending: false })
    if (statusFilter) {
      query = query.eq('status', statusFilter)
    }
    const { data, error } = await query
    if (error) throw new Error(error.message)
    return (data ?? []) as Task[]
  }, [statusFilter])

  return useRealtimeTable<Task>('tasks', fetchTasks)
}

export function useTask(id: string | null) {
  const [data, setData] = useState<Task | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!id) {
      setData(null)
      return
    }
    try {
      setLoading(true)
      const { data: res, error: err } = await supabase.from('tasks').select('*').eq('id', id).single()
      if (err) throw new Error(err.message)
      setData(res as Task)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void fetch()
    if (!id) return

    const channel = supabase
      .channel(`task-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `id=eq.${id}` }, () => {
        void fetch()
      })
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [id, fetch])

  return { data, loading, error }
}

export function useEvents(limit = 50) {
  const fetchEvents = useCallback(async (): Promise<SystemEvent[]> => {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw new Error(error.message)
    return (data ?? []) as SystemEvent[]
  }, [limit])

  return useRealtimeTable<SystemEvent>('events', fetchEvents)
}

export function useRecentRuns(limit = 20) {
  const fetchRuns = useCallback(async (): Promise<AgentRun[]> => {
    const { data, error } = await supabase
      .from('runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw new Error(error.message)
    return (data ?? []) as AgentRun[]
  }, [limit])

  return useRealtimeTable<AgentRun>('runs', fetchRuns)
}

export function useClients() {
  const fetchClients = useCallback(async (): Promise<Client[]> => {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []) as Client[]
  }, [])

  return useRealtimeTable<Client>('clients', fetchClients)
}

export function useProjects(clientId?: string) {
  const fetchProjects = useCallback(async (): Promise<Project[]> => {
    let query = supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })
    if (clientId) {
      query = query.eq('client_id', clientId)
    }
    const { data, error } = await query
    if (error) throw new Error(error.message)
    return (data ?? []) as Project[]
  }, [clientId])

  return useRealtimeTable<Project>('projects', fetchProjects)
}

/** Runs joined with task metadata — provides client_name / project_name context. */
export function useRecentRunsWithContext(limit = 200) {
  const fetchRuns = useCallback(async (): Promise<AgentRunWithContext[]> => {
    const { data, error } = await supabase
      .from('runs')
      .select('*, task:tasks(metadata, project_id)')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw new Error(error.message)
    return (data ?? []) as AgentRunWithContext[]
  }, [limit])

  return useRealtimeTable<AgentRunWithContext>('runs', fetchRuns)
}

/** Events joined with task metadata — provides client_name / project_name context. */
export function useEventsWithContext(limit = 50) {
  const fetchEvents = useCallback(async (): Promise<SystemEventWithContext[]> => {
    const { data, error } = await supabase
      .from('events')
      .select('*, task:tasks(metadata, project_id)')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw new Error(error.message)
    return (data ?? []) as SystemEventWithContext[]
  }, [limit])

  return useRealtimeTable<SystemEventWithContext>('events', fetchEvents)
}

export function useInvoicedProjects() {
  const fetchProjects = useCallback(async (): Promise<Project[]> => {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('status', 'invoiced')
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []) as Project[]
  }, [])

  return useRealtimeTable<Project>('projects', fetchProjects)
}

export function usePayments() {
  const fetchPayments = useCallback(async (): Promise<Payment[]> => {
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .order('received_at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []) as Payment[]
  }, [])

  return useRealtimeTable<Payment>('payments', fetchPayments)
}

export function useAgentMemories(limit = 500, agentId?: string) {
  const fetchMemories = useCallback(async (): Promise<AgentMemory[]> => {
    let query = supabase
      .from('agent_memories')
      .select('id, agent_id, content, entity_type, scope, project_id, client_id, created_at, ttl')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (agentId) {
      query = query.eq('agent_id', agentId)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)
    return (data ?? []) as AgentMemory[]
  }, [agentId, limit])

  return useRealtimeTable<AgentMemory>('agent_memories', fetchMemories)
}

/** Per-project delivery checklist items — realtime, filtered by project_id. */
export function useProjectChecklist(projectId: string | null) {
  const fetchItems = useCallback(async (): Promise<ProjectChecklistItem[]> => {
    if (!projectId) return []
    const { data, error } = await supabase
      .from('project_checklists')
      .select('*')
      .eq('project_id', projectId)
      .order('order_index')
      .order('created_at')
    if (error) throw new Error(error.message)
    return (data ?? []) as ProjectChecklistItem[]
  }, [projectId])

  const [data, setData] = useState<ProjectChecklistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const channelId = useState(() => `rt-project_checklists-${++_channelSeq}`)[0]

  const doFetch = useCallback(async () => {
    try {
      setLoading(true)
      const result = await fetchItems()
      setData(result)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [fetchItems])

  useEffect(() => {
    void doFetch()

    if (!projectId) { setData([]); setLoading(false); return }

    const channel = supabase
      .channel(channelId)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'project_checklists',
        filter: `project_id=eq.${projectId}`,
      }, () => { void doFetch() })
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [projectId, doFetch, channelId])

  return { data, loading, error }
}

/** Per-project system events — realtime, filtered by project_id via task join. */
export function useProjectEvents(projectId: string | null, limit = 100) {
  const [data, setData] = useState<SystemEventWithContext[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const channelId = useState(() => `rt-project_events-${++_channelSeq}`)[0]

  const doFetch = useCallback(async () => {
    if (!projectId) { setData([]); setLoading(false); return }
    try {
      setLoading(true)
      // Step 1: get task IDs for the project
      const { data: taskRows, error: taskErr } = await supabase
        .from('tasks')
        .select('id')
        .eq('project_id', projectId)
      if (taskErr) throw new Error(taskErr.message)

      const taskIds = (taskRows ?? []).map((t) => t.id as string)
      if (taskIds.length === 0) { setData([]); setError(null); return }

      // Step 2: fetch events for those tasks
      const { data: evRows, error: evErr } = await supabase
        .from('events')
        .select('*, task:tasks(metadata, project_id)')
        .in('task_id', taskIds)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (evErr) throw new Error(evErr.message)

      setData((evRows ?? []) as SystemEventWithContext[])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [projectId, limit])

  useEffect(() => {
    void doFetch()
    if (!projectId) return
    const channel = supabase
      .channel(channelId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => {
        void doFetch()
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [projectId, doFetch, channelId])

  return { data, loading, error }
}

/** Per-agent run counts (total) and last 3 runs — for Team Org view. */
export function useAgentStats() {
  const [runCounts, setRunCounts] = useState<Record<string, number>>({})
  const [lastRuns, setLastRuns] = useState<Record<string, AgentRun[]>>({})
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('runs')
        .select('id, agent_id, model_id, input_summary, output_summary, outcome, created_at, cost_usd, duration_ms, tokens_input, tokens_output, tools_used, task_id, error_message')
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw new Error(error.message)
      const runs = (data ?? []) as AgentRun[]
      const counts: Record<string, number> = {}
      const last: Record<string, AgentRun[]> = {}
      for (const run of runs) {
        counts[run.agent_id] = (counts[run.agent_id] ?? 0) + 1
        if (!last[run.agent_id]) last[run.agent_id] = []
        if (last[run.agent_id].length < 3) last[run.agent_id].push(run)
      }
      setRunCounts(counts)
      setLastRuns(last)
    } catch {
      // silently ignore; stats are supplementary
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetch()
    const ch = supabase.channel('realtime-agent-stats')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'runs' }, () => { void fetch() })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [fetch])

  return { runCounts, lastRuns, loading }
}

/** Tasks with requires_human_review = true that are not yet done or cancelled. */
export function useReviewRequestedTasks() {
  const fetchTasks = useCallback(async (): Promise<Task[]> => {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('requires_human_review', true)
      .not('status', 'in', '("done","cancelled")')
      .order('priority')
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []) as Task[]
  }, [])

  return useRealtimeTable<Task>('tasks', fetchTasks)
}

export function useProjectState() {
  const [state, setState] = useState<ProjectState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    try {
      setLoading(true)
      const { data, error: err } = await supabase.from('project_state').select('*').eq('id', 1).single()
      if (err && err.code !== 'PGRST116') throw new Error(err.message)
      setState((data as ProjectState) ?? null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetch()

    const channel = supabase
      .channel('realtime-project_state')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_state' }, () => {
        void fetch()
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [fetch])

  return { state, loading, error }
}
