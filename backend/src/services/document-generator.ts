// ============================================================
// WAI – Document Generator
// Converts markdown/HTML content to PDF via Playwright headless.
// No external dependencies beyond Playwright (already installed).
// ============================================================

import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

export interface DocumentMeta {
  title: string
  clientName?: string
  projectName?: string
  date?: string
}

/**
 * Checks whether the Playwright Chromium binary is present on disk.
 * Returns false if Playwright is installed but `playwright install chromium`
 * has not been run.
 */
export function isPlaywrightBrowserAvailable(): boolean {
  try {
    const execPath = chromium.executablePath()
    return existsSync(execPath)
  } catch {
    return false
  }
}

/**
 * Converts a markdown string to a complete HTML document suitable for
 * headless PDF rendering. Inline CSS only — no external resources.
 * Handles the markdown patterns produced by WAI agents (headings, bold,
 * bullet lists, horizontal rules, numbered lists, checkboxes).
 */
export function markdownToPdfHtml(markdown: string, meta: DocumentMeta): string {
  const date = meta.date ?? new Date().toISOString().split('T')[0]!

  // Convert markdown to HTML (minimal but sufficient for WAI agent output)
  let body = markdown
    // Escape HTML special chars first (before adding HTML tags)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Headings
    .replace(/^#{4}\s+(.+)$/gm, '<h4>$1</h4>')
    .replace(/^#{3}\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^#{2}\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#{1}\s+(.+)$/gm, '<h1>$1</h1>')
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr>')
    // Checkbox items (must come before unordered list)
    .replace(/^- \[x\] (.+)$/gm, '<li class="checked">✅ $1</li>')
    .replace(/^- \[ \] (.+)$/gm, '<li class="unchecked">☐ $1</li>')
    // Unordered list items
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    // Ordered list items
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Wrap consecutive <li> blocks in <ul>
    .replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
    // Paragraphs: blank-line separated blocks that aren't already HTML tags
    .replace(/\n\n(?!<)/g, '\n</p>\n<p>')

  body = `<p>${body}</p>`
  // Remove empty paragraphs
  body = body.replace(/<p>\s*<\/p>/g, '')

  const headerSection = [
    meta.clientName ? `<div class="meta-item"><span class="meta-label">Client:</span> ${meta.clientName}</div>` : '',
    meta.projectName ? `<div class="meta-item"><span class="meta-label">Project:</span> ${meta.projectName}</div>` : '',
    `<div class="meta-item"><span class="meta-label">Date:</span> ${date}</div>`,
  ].filter(Boolean).join('\n    ')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${meta.title}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.6;
    color: #1a1a1a;
    padding: 20mm 20mm 20mm 20mm;
    max-width: 100%;
  }
  .doc-header {
    border-bottom: 2px solid #1a1a1a;
    padding-bottom: 12px;
    margin-bottom: 24px;
  }
  .doc-title {
    font-size: 20pt;
    font-weight: 700;
    color: #0d0d0d;
    margin-bottom: 8px;
  }
  .doc-meta {
    display: flex;
    gap: 24px;
    flex-wrap: wrap;
  }
  .meta-item {
    font-size: 9.5pt;
    color: #555;
  }
  .meta-label {
    font-weight: 600;
    color: #333;
  }
  h1 { font-size: 16pt; font-weight: 700; margin: 20px 0 10px; color: #0d0d0d; }
  h2 { font-size: 14pt; font-weight: 600; margin: 18px 0 8px; color: #111; border-bottom: 1px solid #e0e0e0; padding-bottom: 4px; }
  h3 { font-size: 12pt; font-weight: 600; margin: 14px 0 6px; color: #222; }
  h4 { font-size: 11pt; font-weight: 600; margin: 12px 0 4px; color: #333; }
  p { margin: 8px 0; }
  ul { margin: 6px 0 6px 20px; }
  li { margin: 3px 0; }
  li.checked, li.unchecked { list-style: none; margin-left: -20px; }
  hr { border: none; border-top: 1px solid #ddd; margin: 16px 0; }
  code { background: #f4f4f4; border: 1px solid #e0e0e0; border-radius: 3px; padding: 1px 4px; font-family: 'Courier New', monospace; font-size: 9.5pt; }
  strong { font-weight: 600; }
  em { font-style: italic; }
  @page { margin: 15mm; }
</style>
</head>
<body>
  <div class="doc-header">
    <div class="doc-title">${meta.title}</div>
    <div class="doc-meta">
    ${headerSection}
    </div>
  </div>
  <div class="doc-body">
    ${body}
  </div>
</body>
</html>`
}

/**
 * Renders an HTML string to a PDF file using Playwright headless Chromium.
 * The outputPath must be an absolute filesystem path ending in .pdf.
 * Throws if Playwright is unavailable or rendering fails.
 */
export async function generatePdfFromHtml(html: string, outputPath: string): Promise<void> {
  if (!html.trim()) {
    throw new Error('generatePdfFromHtml: html content is empty')
  }

  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle' })
    await page.pdf({
      path: outputPath,
      format: 'A4',
      margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
      printBackground: true,
    })
  } finally {
    await browser.close()
  }
}
