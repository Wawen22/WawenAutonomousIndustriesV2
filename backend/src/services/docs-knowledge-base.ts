import { readFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = join(__dirname, '..', '..', '..')
const DOCS_ROOT = join(REPO_ROOT, 'docs')
const INDEX_RELATIVE_PATH = 'docs/INDEX.md'

export type KnowledgeBaseBadge =
  | 'product'
  | 'status'
  | 'founder'
  | 'technical'
  | 'reference'
  | 'archive'

export interface KnowledgeBaseManifestItem {
  title: string
  fileName: string
  relativePath: string
  description?: string
  badges: KnowledgeBaseBadge[]
  lastModified: string
  isEntry: boolean
}

export interface KnowledgeBaseManifestSection {
  id: 'home' | 'canonical' | 'reference' | 'archive' | 'unindexed'
  title: string
  description: string
  items: KnowledgeBaseManifestItem[]
}

export interface KnowledgeBaseManifest {
  generatedAt: string
  rootDocumentPath: string
  sections: KnowledgeBaseManifestSection[]
}

interface IndexedSectionConfig {
  id: KnowledgeBaseManifestSection['id']
  title: string
  description: string
}

interface IndexedSectionLink {
  sectionId: KnowledgeBaseManifestSection['id']
  order: number
}

const INDEXED_SECTIONS: Array<{ heading: string; config: IndexedSectionConfig }> = [
  {
    heading: 'Canonical Docs',
    config: {
      id: 'canonical',
      title: 'Canonical Docs',
      description: 'Daily operating knowledge base for product, founder use, architecture, and operations.',
    },
  },
  {
    heading: 'Reference Docs',
    config: {
      id: 'reference',
      title: 'Reference Docs',
      description: 'Useful deep dives and specialized reference material.',
    },
  },
  {
    heading: 'Archive',
    config: {
      id: 'archive',
      title: 'Archive',
      description: 'Historical material kept separate from the live knowledge base.',
    },
  },
]

function prettyTitleFromFilename(fileName: string): string {
  const name = fileName.replace(/\.md$/i, '')
  return name
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function extractTitle(markdown: string, fileName: string): string {
  const match = markdown.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim() || prettyTitleFromFilename(fileName)
}

function extractDescription(markdown: string): string | undefined {
  const quote = markdown.match(/^>\s+(.+)$/m)?.[1]?.trim()
  if (quote) return quote

  const lines = markdown.split('\n').map((line) => line.trim())
  let passedTitle = false
  for (const line of lines) {
    if (!passedTitle) {
      if (line.startsWith('# ')) passedTitle = true
      continue
    }

    if (!line) continue
    if (
      line.startsWith('#') ||
      line.startsWith('|') ||
      line.startsWith('- ') ||
      line.startsWith('* ') ||
      line.startsWith('>') ||
      line === '---'
    ) {
      continue
    }

    return line
  }

  return undefined
}

function normalizeKnowledgeBasePath(input: string): string | null {
  const decoded = decodeURIComponent(input.trim())
  if (!decoded) return null

  if (decoded.startsWith('docs/')) return decoded
  if (decoded.startsWith('archive/')) return `docs/${decoded}`

  const docsMarker = '/docs/'
  const docsIndex = decoded.indexOf(docsMarker)
  if (docsIndex >= 0) {
    return decoded.slice(docsIndex + 1)
  }

  return null
}

function badgeForDocument(relativePath: string, sectionId: KnowledgeBaseManifestSection['id']): KnowledgeBaseBadge[] {
  const base = basename(relativePath).toUpperCase()

  if (sectionId === 'archive' || relativePath.startsWith('docs/archive/')) return ['archive']
  if (base === 'INDEX.MD') return ['product']
  if (base === 'PROJECT_TRACKING.MD') return ['status']
  if (base.includes('FOUNDER') || base === 'MCP_SETUP.MD') return ['founder']
  if (sectionId === 'reference') return ['reference']
  return ['technical']
}

async function readKnowledgeBaseFile(relativePath: string): Promise<KnowledgeBaseManifestItem | null> {
  const normalized = normalizeKnowledgeBasePath(relativePath)
  if (!normalized) return null

  const absolutePath = resolve(REPO_ROOT, normalized)
  if (!absolutePath.startsWith(resolve(DOCS_ROOT))) return null
  if (!existsSync(absolutePath)) return null

  const [content, fileStat] = await Promise.all([
    readFile(absolutePath, 'utf-8'),
    stat(absolutePath),
  ])

  const description = extractDescription(content)

  return {
    title: extractTitle(content, basename(normalized)),
    fileName: basename(normalized),
    relativePath: normalized,
    badges: [],
    lastModified: fileStat.mtime.toISOString(),
    isEntry: normalized === INDEX_RELATIVE_PATH,
    ...(description ? { description } : {}),
  }
}

function parseIndexNavigation(indexMarkdown: string): Map<string, IndexedSectionLink> {
  const map = new Map<string, IndexedSectionLink>()
  const lines = indexMarkdown.split('\n')
  let activeSection: IndexedSectionConfig | null = null
  let order = 0

  for (const rawLine of lines) {
    const headingMatch = rawLine.match(/^##\s+(.+)$/)
    if (headingMatch) {
      activeSection = INDEXED_SECTIONS.find((section) => section.heading === headingMatch[1]?.trim())?.config ?? null
      continue
    }

    if (!activeSection) continue

    const matches = [...rawLine.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    for (const match of matches) {
      const normalized = normalizeKnowledgeBasePath(match[1] ?? '')
      if (!normalized || normalized === INDEX_RELATIVE_PATH || map.has(normalized)) continue
      map.set(normalized, { sectionId: activeSection.id, order })
      order += 1
    }
  }

  return map
}

async function listMarkdownFiles(directory: string, prefix: string): Promise<string[]> {
  if (!existsSync(directory)) return []

  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(`${prefix}/${entry.name}`)
    }
  }

  return files.sort((a, b) => a.localeCompare(b))
}

export async function getKnowledgeBaseManifest(): Promise<KnowledgeBaseManifest> {
  const indexAbsolutePath = join(DOCS_ROOT, 'INDEX.md')
  const indexMarkdown = await readFile(indexAbsolutePath, 'utf-8')
  const indexedLinks = parseIndexNavigation(indexMarkdown)

  const [rootFiles, archiveFiles] = await Promise.all([
    listMarkdownFiles(DOCS_ROOT, 'docs'),
    listMarkdownFiles(join(DOCS_ROOT, 'archive'), 'docs/archive'),
  ])

  const allFiles = Array.from(new Set([...rootFiles, ...archiveFiles]))
  const items = (await Promise.all(allFiles.map((relativePath) => readKnowledgeBaseFile(relativePath))))
    .filter((item): item is KnowledgeBaseManifestItem => item !== null)

  const rootItem = items.find((item) => item.relativePath === INDEX_RELATIVE_PATH)
  if (!rootItem) {
    throw new Error('docs/INDEX.md not found in knowledge base')
  }

  const sectionMap = new Map<KnowledgeBaseManifestSection['id'], KnowledgeBaseManifestSection>()
  sectionMap.set('home', {
    id: 'home',
    title: 'Home',
    description: 'Canonical entry point for the WAI knowledge base.',
    items: [],
  })

  for (const { config } of INDEXED_SECTIONS) {
    sectionMap.set(config.id, { ...config, items: [] })
  }

  sectionMap.set('unindexed', {
    id: 'unindexed',
    title: 'Unindexed',
    description: 'Markdown files present in docs/ but not linked from docs/INDEX.md.',
    items: [],
  })

  sectionMap.get('home')?.items.push({
    ...rootItem,
    badges: badgeForDocument(rootItem.relativePath, 'home'),
  })

  const restItems = items.filter((item) => item.relativePath !== INDEX_RELATIVE_PATH)
  const indexedItems = restItems
    .filter((item) => indexedLinks.has(item.relativePath))
    .sort((a, b) => {
      const aOrder = indexedLinks.get(a.relativePath)?.order ?? Number.MAX_SAFE_INTEGER
      const bOrder = indexedLinks.get(b.relativePath)?.order ?? Number.MAX_SAFE_INTEGER
      return aOrder - bOrder
    })

  for (const item of indexedItems) {
    const sectionId = indexedLinks.get(item.relativePath)?.sectionId ?? 'unindexed'
    sectionMap.get(sectionId)?.items.push({
      ...item,
      badges: badgeForDocument(item.relativePath, sectionId),
    })
  }

  const indexedPaths = new Set(indexedItems.map((item) => item.relativePath))
  const unindexedItems = restItems
    .filter((item) => !indexedPaths.has(item.relativePath))
    .sort((a, b) => a.title.localeCompare(b.title))

  for (const item of unindexedItems) {
    const sectionId = item.relativePath.startsWith('docs/archive/') ? 'archive' : 'unindexed'
    sectionMap.get(sectionId)?.items.push({
      ...item,
      badges: badgeForDocument(item.relativePath, sectionId),
    })
  }

  const sections = Array.from(sectionMap.values()).filter((section) => section.items.length > 0)

  return {
    generatedAt: new Date().toISOString(),
    rootDocumentPath: INDEX_RELATIVE_PATH,
    sections,
  }
}

export async function readKnowledgeBaseDocument(relativePath: string): Promise<string> {
  const normalized = normalizeKnowledgeBasePath(relativePath)
  if (!normalized) {
    throw new Error('Invalid knowledge base path')
  }

  const absolutePath = resolve(REPO_ROOT, normalized)
  if (!absolutePath.startsWith(resolve(DOCS_ROOT))) {
    throw new Error('Knowledge base path outside docs root')
  }

  const fileStat = await stat(absolutePath)
  if (!fileStat.isFile() || !absolutePath.endsWith('.md')) {
    throw new Error('Knowledge base document not found')
  }

  return readFile(absolutePath, 'utf-8')
}
