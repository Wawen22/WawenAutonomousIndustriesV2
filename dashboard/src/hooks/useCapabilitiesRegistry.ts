import { useCallback, useEffect, useState } from 'react'
import type { CapabilityRegistrySnapshot } from '../types/index.js'

const BACKEND_URL = (import.meta.env['VITE_BACKEND_URL'] as string | undefined) ?? 'http://localhost:3001'

export function useCapabilitiesRegistry() {
  const [data, setData] = useState<CapabilityRegistrySnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchRegistry = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch(`${BACKEND_URL}/api/capabilities`)
      const payload = await response.json() as CapabilityRegistrySnapshot & { error?: string }
      if (!response.ok) {
        throw new Error(payload.error ?? `HTTP ${response.status}`)
      }
      setData(payload)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Capabilities fetch failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchRegistry()
  }, [fetchRegistry])

  return { data, loading, error, refetch: fetchRegistry }
}
