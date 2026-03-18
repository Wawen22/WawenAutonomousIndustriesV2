// ============================================================
// WAI Dashboard – Supabase Realtime Hooks
// ============================================================

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import type { Agent, AgentRun, Client, Project, ProjectState, SystemEvent, Task } from '../types/index.js'

// ---------------------------------------------------------------------------
// Generic realtime hook
// ---------------------------------------------------------------------------

function useRealtimeTable<T extends object>(
  table: string,
  fetchFn: () => Promise<T[]>
): { data: T[]; loading: boolean; error: string | null } {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
      .channel(`realtime-${table}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        void fetch()
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [table, fetch])

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
