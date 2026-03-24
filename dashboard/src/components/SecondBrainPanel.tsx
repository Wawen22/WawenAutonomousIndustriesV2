import { useCallback, useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { clsx } from 'clsx'
import type { KnowledgeItem } from '../types/index.js'

const BACKEND_URL = (import.meta.env['VITE_BACKEND_URL'] as string | undefined) ?? ''

interface SearchResult extends KnowledgeItem {
  similarity: number
}

interface ActionState {
  status: 'idle' | 'working' | 'done' | 'error'
  message?: string
}

const SOURCE_ICONS: Record<string, string> = {
  note: '📝',
  url: '🔗',
  file: '📄',
}

export function SecondBrainPanel() {
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Search
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [searchState, setSearchState] = useState<ActionState>({ status: 'idle' })

  // Add note
  const [noteText, setNoteText] = useState('')
  const [addState, setAddState] = useState<ActionState>({ status: 'idle' })

  // Add URL
  const [urlInput, setUrlInput] = useState('')
  const [urlState, setUrlState] = useState<ActionState>({ status: 'idle' })

  // Delete
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch(`${BACKEND_URL}/api/personal/knowledge`)
      const data = await response.json() as { items?: KnowledgeItem[]; error?: string }
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
      setItems(data.items ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load knowledge items')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchItems()
  }, [fetchItems])

  // Debounced search
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)

    if (!searchQuery.trim()) {
      setSearchResults(null)
      setSearchState({ status: 'idle' })
      return
    }

    searchDebounceRef.current = setTimeout(() => {
      void (async () => {
        try {
          setSearchState({ status: 'working' })
          const response = await fetch(
            `${BACKEND_URL}/api/personal/knowledge/search?q=${encodeURIComponent(searchQuery.trim())}`
          )
          const data = await response.json() as { results?: SearchResult[]; error?: string }
          if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
          setSearchResults(data.results ?? [])
          setSearchState({ status: 'done' })
        } catch (err) {
          setSearchState({ status: 'error', message: err instanceof Error ? err.message : 'Search failed' })
          setSearchResults(null)
        }
      })()
    }, 400)

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    }
  }, [searchQuery])

  const handleAddNote = useCallback(async () => {
    const text = noteText.trim()
    if (!text) return
    try {
      setAddState({ status: 'working' })
      const response = await fetch(`${BACKEND_URL}/api/personal/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'note', text }),
      })
      const data = await response.json() as { item?: KnowledgeItem; skipped?: boolean; error?: string }
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
      if (data.skipped) {
        setAddState({ status: 'done', message: 'Near-duplicate detected — item skipped.' })
      } else {
        setNoteText('')
        setAddState({ status: 'done', message: 'Note saved.' })
        void fetchItems()
      }
    } catch (err) {
      setAddState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to save note' })
    }
  }, [noteText, fetchItems])

  const handleAddUrl = useCallback(async () => {
    const url = urlInput.trim()
    if (!url) return
    try {
      setUrlState({ status: 'working' })
      const response = await fetch(`${BACKEND_URL}/api/personal/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'url', url }),
      })
      const data = await response.json() as { item?: KnowledgeItem; skipped?: boolean; error?: string }
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
      if (data.skipped) {
        setUrlState({ status: 'done', message: 'Near-duplicate detected — item skipped.' })
      } else {
        setUrlInput('')
        setUrlState({ status: 'done', message: 'URL saved.' })
        void fetchItems()
      }
    } catch (err) {
      setUrlState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to save URL' })
    }
  }, [urlInput, fetchItems])

  const handleDelete = useCallback(async (id: string) => {
    try {
      setDeletingId(id)
      const response = await fetch(`${BACKEND_URL}/api/personal/knowledge/${id}`, { method: 'DELETE' })
      if (!response.ok) {
        const data = await response.json() as { error?: string }
        throw new Error(data.error ?? `HTTP ${response.status}`)
      }
      setItems((prev) => prev.filter((item) => item.id !== id))
    } catch {
      // silently fail — item stays in list
    } finally {
      setDeletingId(null)
    }
  }, [])

  const displayItems = searchResults ?? items

  return (
    <div className="space-y-6">
      {/* Add controls */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">Add to Second Brain</h3>

        {/* Note input */}
        <div className="space-y-2">
          <textarea
            value={noteText}
            onChange={(e) => { setNoteText(e.target.value) }}
            placeholder="Add a note, insight, or idea…"
            rows={3}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 resize-none focus:border-zinc-500 focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => { void handleAddNote() }}
              disabled={!noteText.trim() || addState.status === 'working'}
              className={clsx(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                !noteText.trim() || addState.status === 'working'
                  ? 'cursor-not-allowed bg-zinc-700 text-zinc-500'
                  : 'bg-indigo-600 text-white hover:bg-indigo-500'
              )}
            >
              {addState.status === 'working' ? 'Saving…' : '📝 Save Note'}
            </button>
            {addState.status !== 'idle' && addState.message && (
              <span className={clsx('text-xs', addState.status === 'error' ? 'text-red-400' : 'text-green-400')}>
                {addState.message}
              </span>
            )}
          </div>
        </div>

        {/* URL input */}
        <div className="flex gap-2">
          <input
            type="url"
            value={urlInput}
            onChange={(e) => { setUrlInput(e.target.value) }}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleAddUrl() }}
            placeholder="https://… — save a web page"
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
          />
          <button
            onClick={() => { void handleAddUrl() }}
            disabled={!urlInput.trim() || urlState.status === 'working'}
            className={clsx(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap',
              !urlInput.trim() || urlState.status === 'working'
                ? 'cursor-not-allowed bg-zinc-700 text-zinc-500'
                : 'bg-indigo-600 text-white hover:bg-indigo-500'
            )}
          >
            {urlState.status === 'working' ? 'Saving…' : '🔗 Save URL'}
          </button>
        </div>
        {urlState.status !== 'idle' && urlState.message && (
          <span className={clsx('text-xs', urlState.status === 'error' ? 'text-red-400' : 'text-green-400')}>
            {urlState.message}
          </span>
        )}
      </div>

      {/* Search */}
      <div className="space-y-2">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value) }}
            placeholder="Search your Second Brain…"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 pl-9 text-sm text-zinc-100 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
          />
          <span className="absolute left-3 top-2.5 text-zinc-500 text-sm">🔍</span>
          {searchState.status === 'working' && (
            <span className="absolute right-3 top-2.5 text-zinc-500 text-xs">searching…</span>
          )}
        </div>
        {searchState.status === 'error' && (
          <p className="text-xs text-red-400">{searchState.message}</p>
        )}
        {searchResults !== null && (
          <p className="text-xs text-zinc-500">
            {searchResults.length === 0 ? 'No results found.' : `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''}`}
          </p>
        )}
      </div>

      {/* Items list */}
      <div>
        <h3 className="mb-3 text-sm font-medium text-zinc-400 uppercase tracking-wide">
          {searchResults !== null ? 'Search Results' : `Knowledge Base (${items.length})`}
        </h3>

        {loading && (
          <p className="text-sm text-zinc-500">Loading…</p>
        )}

        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}

        {!loading && !error && displayItems.length === 0 && (
          <p className="text-sm text-zinc-500">
            {searchResults !== null ? 'No results match your search.' : 'No items yet. Add a note or URL above.'}
          </p>
        )}

        <div className="space-y-2">
          {displayItems.map((item) => {
            const isSearchResult = searchResults !== null
            const similarity = isSearchResult ? (item as SearchResult).similarity : undefined

            return (
              <div
                key={item.id}
                className="group rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm">{SOURCE_ICONS[item.source_type] ?? '📄'}</span>
                      <span className="text-sm font-medium text-zinc-100 truncate">{item.title}</span>
                      {similarity !== undefined && (
                        <span className="shrink-0 rounded-full bg-indigo-900/40 px-1.5 py-0.5 text-[10px] text-indigo-300">
                          {Math.round(similarity * 100)}%
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 line-clamp-2">{item.content.slice(0, 160)}</p>
                    <div className="mt-1.5 flex items-center gap-3 flex-wrap">
                      <span className="text-[10px] text-zinc-600">
                        {format(new Date(item.created_at), 'MMM d, yyyy')}
                      </span>
                      {item.source_url && (
                        <a
                          href={item.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-indigo-400 hover:text-indigo-300 truncate max-w-[200px]"
                        >
                          {item.source_url}
                        </a>
                      )}
                      {item.tags.length > 0 && item.tags.map((tag) => (
                        <span key={tag} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => { void handleDelete(item.id) }}
                    disabled={deletingId === item.id}
                    className="shrink-0 opacity-0 group-hover:opacity-100 rounded p-1 text-zinc-600 hover:text-red-400 transition-all"
                    title="Delete"
                  >
                    {deletingId === item.id ? '…' : '✕'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
