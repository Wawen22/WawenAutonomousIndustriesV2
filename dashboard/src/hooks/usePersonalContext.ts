import { useCallback, useEffect, useState } from 'react'
import type { PersonalContext } from '../types/index.js'

const BACKEND_URL = (import.meta.env['VITE_BACKEND_URL'] as string | undefined) ?? 'http://localhost:3001'

export function usePersonalContext() {
  const [data, setData] = useState<PersonalContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchContext = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch(`${BACKEND_URL}/api/personal/context`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json() as PersonalContext
      setData(payload)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchContext()
  }, [fetchContext])

  return { data, loading, error, refetch: fetchContext }
}
