import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Icon } from './ui/Icon.js'
import { usePersonalContext } from '../hooks/usePersonalContext.js'

const BACKEND_URL = (import.meta.env['VITE_BACKEND_URL'] as string | undefined) ?? 'http://localhost:3001'

function filePathFromRelative(relativePath: string): string {
  return `${BACKEND_URL}/api/file?path=${encodeURIComponent(relativePath)}`
}

export function PersonalDocumentsView() {
  const { data, loading, error, refetch } = usePersonalContext()
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [content, setContent] = useState<string>('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const selectedDoc = useMemo(
    () => data?.recentDocuments.find((doc) => doc.relativePath === selectedPath) ?? data?.recentDocuments[0] ?? null,
    [data, selectedPath]
  )

  useEffect(() => {
    if (!selectedDoc) {
      setContent('')
      setPreviewError(null)
      return
    }

    const doc = selectedDoc
    let cancelled = false
    async function loadFile() {
      try {
        setPreviewLoading(true)
        setPreviewError(null)
        const response = await fetch(filePathFromRelative(doc.relativePath))
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const text = await response.text()
        if (!cancelled) setContent(text)
      } catch (err) {
        if (!cancelled) {
          setPreviewError(err instanceof Error ? err.message : 'Preview failed')
          setContent('')
        }
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    }

    void loadFile()
    return () => {
      cancelled = true
    }
  }, [selectedDoc])

  useEffect(() => {
    if (!selectedPath && data?.recentDocuments[0]) {
      setSelectedPath(data.recentDocuments[0].relativePath)
    }
  }, [data, selectedPath])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[420px]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-[#7CF6E6]/20 border-t-[#7CF6E6] rounded-full animate-spin" />
          <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em]">Reading Personal Filesystem...</p>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="rounded-3xl border border-rose-500/20 bg-rose-500/5 p-8">
        <p className="text-sm font-bold text-rose-400">Documents unavailable</p>
        <p className="text-xs text-slate-500 mt-2">{error ?? 'Unknown error'}</p>
      </div>
    )
  }

  return (
    <div className="grid min-h-[640px] grid-cols-1 gap-6 xl:grid-cols-[360px_1fr]">
      <aside className="rounded-3xl border border-white/5 bg-white/[0.02] p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-black uppercase tracking-[0.25em] text-white">Personal Documents</h2>
            <p className="mt-1 text-xs text-slate-500">{data.outputPath}</p>
          </div>
          <button onClick={() => void refetch()} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-300 transition hover:border-[#7CF6E6]/30 hover:text-[#7CF6E6]">
            Refresh
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {data.recentDocuments.map((doc) => (
            <button
              key={doc.relativePath}
              onClick={() => setSelectedPath(doc.relativePath)}
              className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                selectedDoc?.relativePath === doc.relativePath
                  ? 'border-[#7CF6E6]/35 bg-[#7CF6E6]/10'
                  : 'border-white/5 bg-black/25 hover:border-white/10'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-[#7CF6E6]">
                  <Icon name="folder" size={16} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-black uppercase tracking-[0.15em] text-white">{doc.name}</p>
                  <p className="mt-1 text-[10px] font-mono text-slate-600">{format(new Date(doc.modifiedAt), 'dd MMM yyyy HH:mm')}</p>
                </div>
              </div>
            </button>
          ))}
          {data.recentDocuments.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/8 px-4 py-10 text-center">
              <p className="text-xs text-slate-500">No personal documents yet.</p>
            </div>
          )}
        </div>
      </aside>

      <section className="rounded-3xl border border-white/5 bg-[#070C1A] p-6">
        <div className="flex items-center justify-between border-b border-white/5 pb-4">
          <div>
            <h2 className="text-sm font-black uppercase tracking-[0.25em] text-white">{selectedDoc?.name ?? 'Preview'}</h2>
            <p className="mt-1 text-xs text-slate-500">{selectedDoc?.relativePath ?? 'Select a document'}</p>
          </div>
        </div>

        <div className="mt-5 min-h-[520px] rounded-3xl border border-white/5 bg-black/30 p-6">
          {previewLoading && <p className="text-xs uppercase tracking-[0.25em] text-slate-600">Loading preview...</p>}
          {previewError && <p className="text-xs text-rose-400">{previewError}</p>}
          {!previewLoading && !previewError && selectedDoc && (
            <pre className="whitespace-pre-wrap text-[12px] leading-relaxed text-slate-300">{content}</pre>
          )}
          {!selectedDoc && <p className="text-xs text-slate-500">Choose a personal document from the left panel.</p>}
        </div>
      </section>
    </div>
  )
}
