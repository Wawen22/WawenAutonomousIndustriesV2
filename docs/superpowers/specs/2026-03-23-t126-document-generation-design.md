# T126 — Document Generation (PDF output)

**Date:** 2026-03-23
**Status:** Approved for implementation
**Decision authority:** Autonomous (founder delegated)

---

## Problem

All WAI delivery agents produce only markdown files. Client-facing documents (proposals, briefs, reports) must be manually converted before sending. This slows the path from "agent output" to "deliverable the client opens".

## Goal

Enable WAI agents to produce PDF documents from structured content. First integration: `proposal_strategist` generates a PDF alongside its existing markdown output. The PDF is client-sendable with no manual post-processing.

## Scope (this task only)

- PDF generation via Playwright (already installed, no new dependencies)
- One new service: `document-generator.ts`
- `file_export` tool extended with `'pdf'` format
- `proposal_strategist` generates PDF in addition to existing markdown
- Capability `tool.document_generation` registered with health check
- No DOCX, no PPTX, no new agents

---

## Architecture

### New file: `backend/src/services/document-generator.ts`

Exports two functions:

```ts
markdownToPdfHtml(markdown: string, meta: DocumentMeta): string
generatePdfFromHtml(html: string, outputPath: string): Promise<void>
```

`DocumentMeta`:
```ts
interface DocumentMeta {
  title: string
  clientName?: string
  projectName?: string
  date?: string
}
```

`markdownToPdfHtml` — converts markdown to a complete HTML document with:
- Inline CSS (professional corporate style, print-friendly)
- Header block: title, client, project, date
- No external resources (offline-safe)

`generatePdfFromHtml` — launches Playwright Chromium in headless mode, renders the HTML, exports to PDF with A4 format and 15mm margins.

### Changes to `tool-executor.ts`

`FileExportInput.format` extended: `'md' | 'txt' | 'csv' | 'json' | 'html' | 'pdf'`

In `executeFileExport`: when `format === 'pdf'`, call `generatePdfFromHtml` instead of `writeFile`. Content is treated as HTML if it starts with `<`, otherwise converted via `markdownToPdfHtml` first.

For the `recordCapabilityEvent` call after PDF export: `size_bytes` reflects the source content size (HTML/markdown input), not the PDF binary size. This is acceptable for telemetry purposes and consistent with how the event is already structured. A comment in the code notes this distinction.

### Changes to `proposal_strategist.ts`

After saving `proposal-strategy.md` (inside the existing `if (workspaceAbsPath)` guard), also attempt PDF generation for `proposal-strategy.pdf` in the same deliverables directory. PDF generation is wrapped in a try/catch inside the same guard — non-fatal if it fails (markdown remains the fallback, a `log.warn` is emitted).

The `task_completed` event payload gains a new nullable field `pdf_output_path` alongside the existing `output_path` (which continues to reference the markdown file). This preserves telemetry correctness even when PDF generation fails.

### Changes to `capabilities.ts`

Register `tool.document_generation`:
- health check: dedicated function `isPlaywrightBrowserAvailable()` in `document-generator.ts` that calls `chromium.executablePath()` and checks `existsSync(path)` — returns `true` only if the Chromium binary is physically present on disk, following the same pattern as `isPinchTabAvailable()` in `pinchtab.ts`. This result is passed into `getCapabilityRegistrySnapshot` via `Promise.all` alongside other health checks.
- assignments: company runtime, all teams, all agents
- policy: `auto`, no approval required

### No changes to `tools/index.ts`

PDF generation is not a new dispatched tool — it is a format extension to `file_export`. The `ExecutableToolId` union and `assertToolAccess` dispatch remain unchanged. The capability `tool.document_generation` is the governance surface; there is no separate tool registry entry (which would never be dispatched anyway).

---

## Error handling

- Playwright not available → capability shows `degraded`, `generatePdfFromHtml` throws a clear error
- PDF generation failure in `proposal_strategist` → logs warning, task still completes with markdown
- Empty content → throws before Playwright is launched

---

## Testing

1. Run `proposal_strategist` task for a project with a brief → check `deliverables/` for both `.md` and `.pdf`
2. Open the PDF — verify title, client name, pricing tiers, formatting
3. Kill Playwright (rename binary) → proposal task still completes, PDF generation logs warning only
4. `GET /api/capabilities` → `tool.document_generation` shows correct health state
5. `cd backend && pnpm typecheck` passes

---

## What is NOT in scope

- DOCX or PPTX output
- Any other agent integration beyond `proposal_strategist`
- Email attachment of generated PDFs
- Dashboard UI for document downloads (markdown files already accessible via file serving)
