import { useEffect, useMemo, useState } from 'react'
import { Badge } from './ui/Badge.js'
import { Icon } from './ui/Icon.js'
import { renderMarkdown } from '../lib/renderMarkdown.js'
import { useKnowledgeBaseManifest } from '../hooks/useKnowledgeBaseManifest.js'
import type { KnowledgeBaseDocument, KnowledgeBaseManifest } from '../types/index.js'

const BACKEND_URL = (import.meta.env['VITE_BACKEND_URL'] as string | undefined) ?? ''

const BADGE_LABELS: Record<string, string> = {
  product: 'Product',
  status: 'Status',
  founder: 'Founder',
  technical: 'Technical',
  reference: 'Reference',
  archive: 'Archive',
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString('it-IT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function findDocument(manifest: KnowledgeBaseManifest | null, relativePath: string | null): KnowledgeBaseDocument | null {
  if (!manifest || !relativePath) return null
  return manifest.sections.flatMap((section) => section.items).find((item) => item.relativePath === relativePath) ?? null
}

function findSectionTitle(manifest: KnowledgeBaseManifest | null, relativePath: string | null): string | null {
  if (!manifest || !relativePath) return null
  return manifest.sections.find((section) => section.items.some((item) => item.relativePath === relativePath))?.title ?? null
}

interface DocsViewProps {
  selectedPath: string | null
  onSelectPath: (path: string) => void
}

export function DocsView({ selectedPath, onSelectPath }: DocsViewProps) {
  const { data: manifest, loading: manifestLoading, error: manifestError } = useKnowledgeBaseManifest()
  const [content, setContent] = useState('')
  const [contentLoading, setContentLoading] = useState(false)
  const [contentError, setContentError] = useState<string | null>(null)

  useEffect(() => {
    if (!manifest) return
    const currentDocument = findDocument(manifest, selectedPath)
    if (currentDocument) return
    onSelectPath(manifest.rootDocumentPath)
  }, [manifest, onSelectPath, selectedPath])

  useEffect(() => {
    if (!selectedPath) return
    const path = selectedPath

    let cancelled = false

    async function loadContent() {
      try {
        setContentLoading(true)
        setContentError(null)
        const response = await fetch(`${BACKEND_URL}/api/docs/content?path=${encodeURIComponent(path)}`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const text = await response.text()
        if (!cancelled) {
          setContent(text)
        }
      } catch (err) {
        if (!cancelled) {
          setContentError(err instanceof Error ? err.message : 'Document load failed')
          setContent('')
        }
      } finally {
        if (!cancelled) {
          setContentLoading(false)
        }
      }
    }

    void loadContent()

    return () => {
      cancelled = true
    }
  }, [selectedPath])

  const selectedDocument = useMemo(
    () => findDocument(manifest, selectedPath),
    [manifest, selectedPath]
  )
  const totalDocuments = manifest?.sections.reduce((count, section) => count + section.items.length, 0) ?? 0
  const selectedSectionTitle = useMemo(
    () => findSectionTitle(manifest, selectedPath),
    [manifest, selectedPath]
  )

  function handleContentClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-doc-path]')
    if (!target) return
    const nextPath = target.dataset.docPath
    if (!nextPath) return
    event.preventDefault()
    onSelectPath(nextPath)
  }

  if (manifestLoading) {
    return (
      <div className="flex items-center justify-center h-[420px]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-[#00D4FF]/20 border-t-[#00D4FF] rounded-full animate-spin" />
          <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em]">Indexing Knowledge Base...</p>
        </div>
      </div>
    )
  }

  if (manifestError || !manifest) {
    return (
      <div className="rounded-3xl border border-rose-500/20 bg-rose-500/5 p-8">
        <p className="text-sm font-bold text-rose-400">Knowledge base unavailable</p>
        <p className="text-xs text-slate-500 mt-2">{manifestError ?? 'Unknown error'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/5 bg-white/[0.02] p-5">
        <div className="rounded-3xl border border-white/6 bg-black/20 p-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#00D4FF]/15 bg-[#00D4FF]/[0.08] text-[#00D4FF]">
                  <Icon name="book" size={16} />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#00D4FF]">Knowledge Base</p>
                  <h2 className="mt-1 text-lg font-black text-white tracking-tight">Repository-backed wiki</h2>
                </div>
              </div>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-400">
                Reading directly from the markdown files in `docs/`. Navigation now lives in the left sidebar while this surface stays focused on content.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="product">Total {totalDocuments}</Badge>
                {selectedSectionTitle && <Badge variant="technical">{selectedSectionTitle}</Badge>}
              </div>
            </div>

            <div className="rounded-2xl border border-white/8 bg-black/30 px-4 py-3 xl:min-w-[240px]">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-600">Current Doc</p>
              <p className="mt-1 truncate text-sm font-black text-white">
                {selectedDocument?.title ?? 'No document selected'}
              </p>
              <p className="mt-1 truncate text-[10px] font-mono text-slate-600">
                {selectedDocument?.relativePath ?? 'Select a document'}
              </p>
              {selectedSectionTitle && (
                <p className="mt-2 text-[10px] font-black uppercase tracking-[0.18em] text-[#00D4FF]">
                  {selectedSectionTitle}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-white/5 bg-[#070C1A] p-6">
        <div className="flex flex-col gap-4 border-b border-white/5 pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-black tracking-tight text-white">
                {selectedDocument?.title ?? 'Document Preview'}
              </h2>
              {selectedDocument?.badges.map((badge) => (
                <Badge key={`selected-${badge}`} variant={badge}>
                  {BADGE_LABELS[badge]}
                </Badge>
              ))}
            </div>
            <p className="mt-2 text-xs font-mono text-slate-500">
              {selectedDocument?.relativePath ?? 'Select a knowledge base document'}
            </p>
            {selectedDocument?.description && (
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-400">{selectedDocument.description}</p>
            )}
          </div>

          <div className="rounded-2xl border border-white/8 bg-black/30 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-600">Last Updated</p>
            <p className="mt-1 text-sm font-mono text-slate-300">
              {selectedDocument ? formatTimestamp(selectedDocument.lastModified) : 'N/A'}
            </p>
          </div>
        </div>

        <div className="mt-5 min-h-[560px] rounded-3xl border border-white/5 bg-black/30 p-6">
          {contentLoading && <p className="text-xs uppercase tracking-[0.25em] text-slate-600">Loading markdown...</p>}
          {contentError && <p className="text-xs text-rose-400">{contentError}</p>}
          {!contentLoading && !contentError && selectedDocument && (
            <div
              className="prose-wai max-w-none"
              onClick={handleContentClick}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
            />
          )}
          {!selectedDocument && <p className="text-xs text-slate-500">Choose a document from the left sidebar.</p>}
        </div>
      </section>
    </div>
  )
}
