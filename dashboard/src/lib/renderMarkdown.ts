function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function normalizeDocLinkTarget(href: string): string | null {
  const decoded = decodeURIComponent(href.trim())
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

function renderLink(label: string, href: string): string {
  const normalized = normalizeDocLinkTarget(href)
  if (normalized) {
    return `<a href="${escapeHtml(normalized)}" data-doc-path="${escapeHtml(normalized)}">${label}</a>`
  }

  const safeHref = escapeHtml(href)
  return `<a href="${safeHref}" target="_blank" rel="noreferrer">${label}</a>`
}

function parseInline(markdown: string): string {
  const codeTokens: string[] = []
  let html = escapeHtml(markdown)

  html = html.replace(/`([^`]+)`/g, (_match, code: string) => {
    const token = `@@INLINE_CODE_${codeTokens.length}@@`
    codeTokens.push(`<code>${escapeHtml(code)}</code>`)
    return token
  })

  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, href: string) => renderLink(escapeHtml(label), href))
  html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/(^|[^\*])\*([^*]+)\*/g, '$1<em>$2</em>')

  return codeTokens.reduce((acc, tokenHtml, index) => acc.replaceAll(`@@INLINE_CODE_${index}@@`, tokenHtml), html)
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s:-]+(\|[\s:-]+)+\|?\s*$/.test(line)
}

function isTableRow(line: string): boolean {
  return line.includes('|')
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => parseInline(cell.trim()))
}

function renderTable(lines: string[]): string {
  const [headerLine, , ...bodyLines] = lines
  const headers = parseTableRow(headerLine)
  const rows = bodyLines.map((line) => parseTableRow(line))

  const headerHtml = headers.map((cell) => `<th>${cell}</th>`).join('')
  const bodyHtml = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('')

  return `<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`
}

export function renderMarkdown(markdown: string): string {
  const codeBlocks: string[] = []
  const normalized = markdown
    .replace(/\r\n/g, '\n')
    .replace(/```([\w-]*)\n([\s\S]*?)```/g, (_match, language: string, code: string) => {
      const token = `@@CODE_BLOCK_${codeBlocks.length}@@`
      const languageLabel = language ? `<div class="code-label">${escapeHtml(language)}</div>` : ''
      codeBlocks.push(`${languageLabel}<pre><code>${escapeHtml(code.trimEnd())}</code></pre>`)
      return `\n${token}\n`
    })

  const lines = normalized.split('\n')
  const blocks: string[] = []
  let index = 0

  const isSpecialBlockStart = (line: string, nextLine?: string) =>
    /^#{1,4}\s+/.test(line) ||
    /^---+$/.test(line.trim()) ||
    /^>\s?/.test(line) ||
    /^[-*]\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    line.startsWith('@@CODE_BLOCK_') ||
    (isTableRow(line) && typeof nextLine === 'string' && isTableSeparator(nextLine))

  while (index < lines.length) {
    const rawLine = lines[index] ?? ''
    const line = rawLine.trimEnd()

    if (!line.trim()) {
      index += 1
      continue
    }

    const codeMatch = line.match(/^@@CODE_BLOCK_(\d+)@@$/)
    if (codeMatch) {
      const codeIndex = Number(codeMatch[1])
      blocks.push(codeBlocks[codeIndex] ?? '')
      index += 1
      continue
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      blocks.push(`<h${level}>${parseInline(headingMatch[2])}</h${level}>`)
      index += 1
      continue
    }

    if (/^---+$/.test(line.trim())) {
      blocks.push('<hr />')
      index += 1
      continue
    }

    if (isTableRow(line) && isTableSeparator(lines[index + 1] ?? '')) {
      const tableLines = [line, lines[index + 1] ?? '']
      index += 2
      while (index < lines.length && isTableRow(lines[index] ?? '')) {
        tableLines.push(lines[index] ?? '')
        index += 1
      }
      blocks.push(renderTable(tableLines))
      continue
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index] ?? '')) {
        quoteLines.push((lines[index] ?? '').replace(/^>\s?/, '').trim())
        index += 1
      }
      blocks.push(`<blockquote>${quoteLines.map((quoteLine) => parseInline(quoteLine)).join('<br />')}</blockquote>`)
      continue
    }

    if (/^[-*]\s+/.test(line)) {
      const listItems: string[] = []
      while (index < lines.length && /^[-*]\s+/.test(lines[index] ?? '')) {
        const itemContent = (lines[index] ?? '').replace(/^[-*]\s+/, '').trim()
        listItems.push(`<li>${parseInline(itemContent)}</li>`)
        index += 1
      }
      blocks.push(`<ul>${listItems.join('')}</ul>`)
      continue
    }

    if (/^\d+\.\s+/.test(line)) {
      const listItems: string[] = []
      while (index < lines.length && /^\d+\.\s+/.test(lines[index] ?? '')) {
        const itemContent = (lines[index] ?? '').replace(/^\d+\.\s+/, '').trim()
        listItems.push(`<li>${parseInline(itemContent)}</li>`)
        index += 1
      }
      blocks.push(`<ol>${listItems.join('')}</ol>`)
      continue
    }

    const paragraphLines: string[] = []
    while (index < lines.length) {
      const current = (lines[index] ?? '').trim()
      const next = lines[index + 1]
      if (!current) break
      if (paragraphLines.length > 0 && isSpecialBlockStart(current, next)) break
      paragraphLines.push(current)
      index += 1
    }

    blocks.push(`<p>${paragraphLines.map((paragraphLine) => parseInline(paragraphLine)).join('<br />')}</p>`)
  }

  return blocks.join('\n')
}
