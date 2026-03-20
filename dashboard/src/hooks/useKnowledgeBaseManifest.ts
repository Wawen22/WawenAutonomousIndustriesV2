import { useCallback, useEffect, useState } from 'react'
import type { KnowledgeBaseManifest } from '../types/index.js'

const BACKEND_URL = (import.meta.env['VITE_BACKEND_URL'] as string | undefined) ?? ''

export function useKnowledgeBaseManifest() {
  const [data, setData] = useState<KnowledgeBaseManifest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchManifest = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch(`${BACKEND_URL}/api/docs/manifest`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json() as KnowledgeBaseManifest
      setData(payload)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Knowledge base unavailable')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchManifest()
  }, [fetchManifest])

  return { data, loading, error, refetch: fetchManifest }
}
