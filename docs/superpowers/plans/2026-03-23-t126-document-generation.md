# T126 — Document Generation (PDF Output) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable WAI agents to produce PDF documents from markdown/HTML content, starting with `proposal_strategist` which will generate a `proposal-strategy.pdf` alongside its existing markdown output.

**Architecture:** A new `document-generator.ts` service wraps Playwright headless PDF export. The `file_export` tool in `tool-executor.ts` gains a `pdf` format option that routes through this service. `proposal_strategist.ts` calls the service directly after its markdown write. A `tool.document_generation` capability is registered in the capability registry with a live Chromium binary health check.

**Tech Stack:** Node.js 22, TypeScript strict, Playwright (already in `package.json`), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-03-23-t126-document-generation-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `backend/src/services/document-generator.ts` | `isPlaywrightBrowserAvailable`, `markdownToPdfHtml`, `generatePdfFromHtml` |
| Modify | `backend/src/services/tool-executor.ts` | Extend `FileExportInput.format` with `'pdf'`; add PDF branch in `executeFileExport` |
| Modify | `backend/src/config/capabilities.ts` | Add `DOCUMENT_GENERATION_CAPABILITY_ID` constant |
| Modify | `backend/src/services/capabilities.ts` | Import `isPlaywrightBrowserAvailable`, add to `Promise.all`, add capability entry at end of catalog |
| Modify | `backend/src/agents/proposal_strategist.ts` | After markdown write, attempt PDF generation non-fatally; add `pdf_output_path` to event payload |

---

## Task 1: Create `document-generator.ts`

**Files:**
- Create: `backend/src/services/document-generator.ts`

### Context

This is the core service. It has three exports:
1. `isPlaywrightBrowserAvailable()` — checks if the Chromium binary is physically present on disk
2. `markdownToPdfHtml(markdown, meta)` — converts markdown to a styled HTML document ready for PDF rendering
3. `generatePdfFromHtml(html, outputPath)` — renders HTML to PDF via Playwright headless Chromium

Playwright's `chromium.executablePath()` returns the path where Playwright expects to find the Chromium binary. If that path doesn't exist on disk, the launch will fail. We check it upfront so health checks can surface the problem before any agent tries to use the capability.

For `markdownToPdfHtml`: since there is no markdown parser installed, convert the most common markdown patterns manually (headings, bold, lists, horizontal rules, line breaks). This is sufficient for the structured proposal output. The HTML uses inline CSS only — no external fonts, no network requests — so it works offline and produces consistent output.

- [ ] **Step 1: Create `document-generator.ts`**

```typescript
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
```

- [ ] **Step 2: Run typecheck to verify the new file compiles**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2/backend" && pnpm typecheck
```

Expected: no errors related to `document-generator.ts`. If Playwright types are missing, run `pnpm add -D @types/playwright` — but Playwright ships its own types so this should not be needed.

- [ ] **Step 3: Commit**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2"
git add backend/src/services/document-generator.ts
git commit -m "feat(T126): add document-generator service — Playwright HTML→PDF with health check"
```

---

## Task 2: Extend `tool-executor.ts` with PDF format

**Files:**
- Modify: `backend/src/services/tool-executor.ts`

### Context

`FileExportInput.format` currently accepts `'md' | 'txt' | 'csv' | 'json' | 'html'`. We add `'pdf'` to this union.

In `executeFileExport`, there is currently one write path: `writeFile(absolutePath, input.content, 'utf-8')`. For PDF we route through `generatePdfFromHtml` instead. Content is treated as HTML if it starts with `<`, otherwise it is passed to `markdownToPdfHtml` first with a minimal `DocumentMeta` (title from filename/title field).

The `recordCapabilityEvent` call after the write passes `size_bytes: Buffer.byteLength(input.content, 'utf-8')` — this reflects the source HTML/markdown size, not the PDF binary size. This is acceptable and a comment documents the distinction.

- [ ] **Step 1: Add import at top of `tool-executor.ts`**

Add after the existing imports (around line 24, after `recordCapabilityEvent` import):

```typescript
import { generatePdfFromHtml, markdownToPdfHtml } from './document-generator.js'
```

- [ ] **Step 2: Extend `FileExportInput.format` type**

Find line ~37 in `tool-executor.ts`:

```typescript
  format?: 'md' | 'txt' | 'csv' | 'json' | 'html'
```

Change to:

```typescript
  format?: 'md' | 'txt' | 'csv' | 'json' | 'html' | 'pdf'
```

- [ ] **Step 3: Add PDF branch in `executeFileExport`**

Find the write block in `executeFileExport` (around line 150–155). Current code:

```typescript
  const absolutePath = join(absoluteDir, filename)
  const relativePath = `${relativeDir}/${filename}`.replace(/\\/g, '/')
  await writeFile(absolutePath, input.content, 'utf-8')
```

Replace with:

```typescript
  const absolutePath = join(absoluteDir, filename)
  const relativePath = `${relativeDir}/${filename}`.replace(/\\/g, '/')

  if (input.format === 'pdf') {
    // Route through Playwright headless PDF renderer
    const html = input.content.trimStart().startsWith('<')
      ? input.content
      : markdownToPdfHtml(input.content, {
          title: input.title ?? input.filename ?? 'Document',
        })
    await generatePdfFromHtml(html, absolutePath)
  } else {
    await writeFile(absolutePath, input.content, 'utf-8')
  }
```

- [ ] **Step 4: Add note on `size_bytes` in the `recordCapabilityEvent` call**

Find the `recordCapabilityEvent` call (around line 157). The `size_bytes` field currently reads `Buffer.byteLength(input.content, 'utf-8')`. Add an inline comment:

```typescript
      // size_bytes reflects source content (markdown/html), not the PDF binary size
      size_bytes: Buffer.byteLength(input.content, 'utf-8'),
```

- [ ] **Step 5: Run typecheck**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2/backend" && pnpm typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2"
git add backend/src/services/tool-executor.ts
git commit -m "feat(T126): extend file_export tool with 'pdf' format via document-generator"
```

---

## Task 3: Register `tool.document_generation` capability

**Files:**
- Modify: `backend/src/config/capabilities.ts`
- Modify: `backend/src/services/capabilities.ts`

### Context

First, add the constant to `config/capabilities.ts` so other files can reference it without hardcoding the string.

Then in `services/capabilities.ts`:
1. Import `isPlaywrightBrowserAvailable` from `document-generator.ts`
2. Add it to the `Promise.all` destructuring in `getCapabilityRegistrySnapshot`
3. Add a new capability entry at the end of the `catalogBase` array (just before the closing `]` on line 1561)

The catalog entry follows the exact same pattern as `plugin.pinchtab`: use the boolean from `Promise.all` to set `state`, `label`, `message`, and `reasonCode` on the health object.

- [ ] **Step 1: Add constant to `backend/src/config/capabilities.ts`**

Add after the `PINCHTAB_CAPABILITY_ID` line (line 9):

```typescript
export const DOCUMENT_GENERATION_CAPABILITY_ID = 'tool.document_generation'
```

- [ ] **Step 2: Add import to `backend/src/services/capabilities.ts`**

Add after the `isPinchTabAvailable` import (line 25):

```typescript
import { isPlaywrightBrowserAvailable } from './document-generator.js'
```

- [ ] **Step 3: Extend `Promise.all` in `getCapabilityRegistrySnapshot`**

Find line 555 in `capabilities.ts`:

```typescript
  const [mcpBridgeStatus, googleWorkspaceRuntime, automationStatus, recentEvents, pinchTabAvailable] = await Promise.all([
    getMcpBridgeStatus(),
    getGoogleWorkspaceMcpRuntimeStatus(DEFAULT_OWNER_SLUG),
    getPersonalAutomationStatus(DEFAULT_OWNER_SLUG),
    getCapabilityEvents({ limit: 200 }),
    isPinchTabAvailable(),
  ])
```

Change to:

```typescript
  const [mcpBridgeStatus, googleWorkspaceRuntime, automationStatus, recentEvents, pinchTabAvailable, playwrightBrowserAvailable] = await Promise.all([
    getMcpBridgeStatus(),
    getGoogleWorkspaceMcpRuntimeStatus(DEFAULT_OWNER_SLUG),
    getPersonalAutomationStatus(DEFAULT_OWNER_SLUG),
    getCapabilityEvents({ limit: 200 }),
    isPinchTabAvailable(),
    Promise.resolve(isPlaywrightBrowserAvailable()),
  ])
```

Note: `isPlaywrightBrowserAvailable()` is synchronous (uses `existsSync`). `Promise.all` accepts plain values; the `Promise.resolve` wrapper is optional and included only for type explicitness.

- [ ] **Step 4: Add capability entry to the catalog array**

Find the end of the `catalogBase` array in `capabilities.ts`. The last entry currently ends with the `plugin.pinchtab` block (around line 1560):

```typescript
    },
  ]
```

Replace with:

```typescript
    },
    {
      capability: baseCapability({
        id: 'tool.document_generation',
        type: 'integration',
        label: 'Document Generator (PDF)',
        description: 'Produces professional PDF documents from markdown or HTML content using Playwright headless Chromium. Used by delivery agents to generate client-ready proposals and reports.',
        owner: DEFAULT_OWNER_SLUG,
        runtimeTarget: 'company',
        riskLevel: 'low',
        tags: ['pdf', 'documents', 'playwright', 'delivery'],
        usageInstructions: 'Call generatePdfFromHtml(html, outputPath) or markdownToPdfHtml(markdown, meta) from document-generator.ts. Run `npx playwright install chromium` if the capability shows degraded.',
        examples: [
          'Generate a PDF proposal for a client after the Proposal Strategist completes',
          'Produce a PDF delivery report with client branding',
        ],
      }),
      assignments: [
        runtimeAssignment('tool.document_generation', 'company', 'Company Runtime', 'company'),
        teamAssignment('tool.document_generation', 'consulting', 'company', 'Consulting agents use this to produce client-ready PDF proposals.'),
        teamAssignment('tool.document_generation', 'marketing', 'company', 'Marketing agents use this to generate PDF reports and decks.'),
        agentAssignment('tool.document_generation', 'proposal_strategist', 'company', 'Proposal Strategist generates PDF proposals alongside markdown.'),
        agentAssignment('tool.document_generation', 'executive_summary', 'company', 'Executive Summary agent can produce PDF briefings.'),
      ],
      policy: basePolicy({
        capabilityId: 'tool.document_generation',
        mode: 'auto',
        allowedTools: ['file_export'],
        notes: 'PDF generation is local-only via Playwright. No network calls during rendering (inline CSS only). Requires Chromium binary: run `npx playwright install chromium` once.',
      }),
      health: baseHealth({
        capabilityId: 'tool.document_generation',
        state: playwrightBrowserAvailable ? 'connected' : 'degraded',
        label: playwrightBrowserAvailable ? 'Connected' : 'Browser Missing',
        message: playwrightBrowserAvailable
          ? 'Playwright Chromium binary is present. PDF generation is available.'
          : 'Playwright Chromium binary not found. Run: npx playwright install chromium',
        checkedAt: generatedAt,
        freshness: playwrightBrowserAvailable ? 'fresh' : 'unknown',
        reasonCode: playwrightBrowserAvailable ? 'chromium_available' : 'chromium_missing',
        details: playwrightBrowserAvailable
          ? ['PDF output via headless Chromium, A4 format, inline CSS only']
          : ['Fix: cd backend && npx playwright install chromium'],
      }),
      audit: baseAudit({
        capabilityId: 'tool.document_generation',
        summary: 'PDF document generation — enables client-ready proposal and report output from agent markdown.',
      }),
    },
  ]
```

- [ ] **Step 5: Run typecheck**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2/backend" && pnpm typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2"
git add backend/src/config/capabilities.ts backend/src/services/capabilities.ts
git commit -m "feat(T126): register tool.document_generation capability with Chromium binary health check"
```

---

## Task 4: Integrate PDF generation in `proposal_strategist.ts`

**Files:**
- Modify: `backend/src/agents/proposal_strategist.ts`

### Context

The existing markdown write is inside an `if (workspaceAbsPath)` guard (around line 304). After writing `proposal-strategy.md`, we attempt to generate `proposal-strategy.pdf` in the same `deliverables` directory.

PDF generation is wrapped in its own `try/catch` inside the same guard. If it fails, we log a warning but **do not re-throw** — the task still completes with the markdown output. This is graceful degradation.

The `task_completed` event payload currently has `output_path: outputPath` (the markdown path). We add `pdf_output_path: pdfOutputPath | null` alongside it. `pdfOutputPath` is `null` if PDF generation failed or `workspaceAbsPath` was null.

- [ ] **Step 1: Add import at top of `proposal_strategist.ts`**

Add after the existing imports (after line 15, `import type { Task }...`):

```typescript
import { generatePdfFromHtml, markdownToPdfHtml } from '../services/document-generator.js'
```

- [ ] **Step 2: Add `pdfOutputPath` variable and PDF generation block**

Find the existing markdown write block inside `if (workspaceAbsPath)` (around lines 304–309):

```typescript
    let outputPath: string | null = null
    if (workspaceAbsPath) {
      const deliverableDir = join(workspaceAbsPath, 'deliverables')
      await mkdir(deliverableDir, { recursive: true })
      outputPath = join(deliverableDir, 'proposal-strategy.md')
      await writeFile(outputPath, proposalToMarkdown(proposal, projectName, clientName), 'utf-8')
    }
```

Replace with:

```typescript
    let outputPath: string | null = null
    let pdfOutputPath: string | null = null
    if (workspaceAbsPath) {
      const deliverableDir = join(workspaceAbsPath, 'deliverables')
      await mkdir(deliverableDir, { recursive: true })
      outputPath = join(deliverableDir, 'proposal-strategy.md')
      const markdownContent = proposalToMarkdown(proposal, projectName, clientName)
      await writeFile(outputPath, markdownContent, 'utf-8')

      try {
        const pdfHtml = markdownToPdfHtml(markdownContent, {
          title: proposal.title,
          clientName,
          projectName,
        })
        pdfOutputPath = join(deliverableDir, 'proposal-strategy.pdf')
        await generatePdfFromHtml(pdfHtml, pdfOutputPath)
      } catch (pdfErr) {
        log.warn({ err: pdfErr, taskId: task.id }, 'Proposal Strategist: PDF generation failed (non-fatal, markdown saved)')
        pdfOutputPath = null
      }
    }
```

- [ ] **Step 3: Add `pdf_output_path` to the `task_completed` event payload**

Find the `recordEvent('task_completed', ...)` call (around line 312). Current payload:

```typescript
        payload: {
          proposal_title: proposal.title,
          pricing_tiers: proposal.pricingTiers.length,
          deliverables_count: proposal.deliverables.length,
          has_roi: Boolean(proposal.roi),
          output_path: outputPath,
          model_used: result.modelId,
          cost_usd: result.costUsd,
        },
```

Change to:

```typescript
        payload: {
          proposal_title: proposal.title,
          pricing_tiers: proposal.pricingTiers.length,
          deliverables_count: proposal.deliverables.length,
          has_roi: Boolean(proposal.roi),
          output_path: outputPath,
          pdf_output_path: pdfOutputPath,
          model_used: result.modelId,
          cost_usd: result.costUsd,
        },
```

- [ ] **Step 4: Update the Telegram notification to include PDF status**

Find the `notifyLines` array (around line 328). Add PDF status after the markdown save line:

```typescript
      outputPath ? `\n💾 Saved: \`${outputPath}\`` : '',
      pdfOutputPath ? `📄 PDF: \`${pdfOutputPath}\`` : '',
```

- [ ] **Step 5: Run typecheck**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2/backend" && pnpm typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2"
git add backend/src/agents/proposal_strategist.ts
git commit -m "feat(T126): proposal_strategist generates PDF alongside markdown, non-fatal degradation"
```

---

## Task 5: Verify Playwright browser is installed + integration test

**Files:** None (verification only)

### Context

Playwright ships as an npm package but the browser binary must be downloaded separately. If `isPlaywrightBrowserAvailable()` returns false, the capability will show `degraded` and PDF generation will fail at runtime. This step ensures everything works end-to-end.

- [ ] **Step 1: Check if Chromium binary is present**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2/backend" && node -e "const { chromium } = require('playwright'); const { existsSync } = require('fs'); const p = chromium.executablePath(); console.log('Path:', p); console.log('Exists:', existsSync(p));"
```

If output is `Exists: false`, run:

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2/backend" && npx playwright install chromium
```

- [ ] **Step 2: Test capability health via API**

Start the backend (`cd backend && pnpm dev`), then in another terminal:

```bash
curl -s http://localhost:3001/api/capabilities | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
const cap = d.catalog.find(e => e.capability.id === 'tool.document_generation');
console.log('State:', cap?.health.state);
console.log('Label:', cap?.health.label);
"
```

Expected: `State: connected`, `Label: Connected`

- [ ] **Step 3: Test `generatePdfFromHtml` directly (smoke test)**

Create a quick test script:

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2/backend"
node --loader tsx/esm -e "
import { generatePdfFromHtml, markdownToPdfHtml } from './src/services/document-generator.js';
import { join } from 'path';
import os from 'os';

const md = '# Test Proposal\n\nThis is a **test** document.\n\n## Section\n\n- Item 1\n- Item 2\n\n---\n\nEnd.';
const html = markdownToPdfHtml(md, { title: 'Test Proposal', clientName: 'ACME', projectName: 'Test Project' });
const outPath = join(os.tmpdir(), 'wai-test-proposal.pdf');
await generatePdfFromHtml(html, outPath);
console.log('PDF generated at:', outPath);
"
```

Expected: no errors, prints the output path. Open the PDF to verify layout.

- [ ] **Step 4: Test `proposal_strategist` end-to-end**

From Telegram or dashboard, trigger a proposal task on a project that has a brief. Example CEO Intake command:
```
crea proposta per [client-slug]/[project-slug]
```

After the task completes:
1. Check `workspace/[client-slug]/[project-slug]/deliverables/` — should contain both `proposal-strategy.md` and `proposal-strategy.pdf`
2. Open the PDF — verify title, client name, pricing tiers, and overall layout
3. Telegram notification should include `📄 PDF: <path>` line

- [ ] **Step 5: Test graceful degradation**

Temporarily rename the Chromium binary to simulate its absence:

```bash
# Find the binary path
node -e "const { chromium } = require('playwright'); console.log(chromium.executablePath());"

# Rename it (replace /path/to/chromium with actual path)
mv /path/to/chromium /path/to/chromium.bak
```

Then:
1. Restart backend
2. Check `GET /api/capabilities` — `tool.document_generation` should show `state: degraded`
3. Run a proposal task — should complete successfully with markdown, log a `warn` for PDF, no PDF file created
4. Restore: `mv /path/to/chromium.bak /path/to/chromium`

- [ ] **Step 6: Final typecheck**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2/backend" && pnpm typecheck
```

Expected: clean.

---

## Task 6: Update documentation

**Files:**
- Modify: `docs/PROJECT_TRACKING.md`

- [ ] **Step 1: Update PROJECT_TRACKING.md**

In the `Fase 4` table, mark T126 as done:

```markdown
| T126 | Document generation — DOCX/PDF/PPTX output reale | 2 | ✅ Done | PDF via Playwright headless. `proposal_strategist` generates PDF + MD. Capability `tool.document_generation` in registry. |
```

Add to `Recent Changes` section:

```markdown
### 2026-03-23 — T126: Document Generation (PDF output)

**New:**
- `backend/src/services/document-generator.ts`: new service with `isPlaywrightBrowserAvailable()` (Chromium binary check via existsSync), `markdownToPdfHtml(markdown, meta)` (converts to styled HTML with inline CSS), `generatePdfFromHtml(html, outputPath)` (Playwright headless PDF, A4 format, 15mm margins)
- `backend/src/config/capabilities.ts`: `DOCUMENT_GENERATION_CAPABILITY_ID = 'tool.document_generation'`
- `backend/src/services/capabilities.ts`: `tool.document_generation` in capability registry with live Chromium binary health check; health shows `degraded` if `npx playwright install chromium` hasn't been run
- `backend/src/services/tool-executor.ts`: `FileExportInput.format` extended with `'pdf'`; `file_export` tool now routes PDF exports through `generatePdfFromHtml`
- `backend/src/agents/proposal_strategist.ts`: generates `proposal-strategy.pdf` alongside `proposal-strategy.md` in deliverables dir; PDF failure is non-fatal (task completes with markdown); `task_completed` event gains `pdf_output_path` field

**How to test:**
1. Ensure Chromium binary installed: `cd backend && npx playwright install chromium`
2. Run a proposal task → check `deliverables/` for `.pdf` alongside `.md`
3. `GET /api/capabilities` → `tool.document_generation` shows `state: connected`
4. Dashboard `Capabilities` view shows `Document Generator (PDF)` with green health badge

**Next step:** T123 — Second Brain (personal knowledge ingestion + search)
```

- [ ] **Step 2: Commit documentation**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2"
git add docs/PROJECT_TRACKING.md
git commit -m "docs(T126): update PROJECT_TRACKING for document generation feature"
```
