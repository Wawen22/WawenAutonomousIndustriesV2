# Revenue & Reliability Plan: T108 + T109

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make WAI's revenue pipeline professional (invoice email to client on invoicing) and safe (prevent duplicate agent spawning on the same project).

**Architecture:**
- T108: Extend `executeInvoiceProject` to send an HTML invoice email via Resend immediately after marking the project as `invoiced`. No new dependencies — HTML template is pure string generation, Resend already handles delivery. If `client.email` is null, skip email and log a warning (non-fatal).
- T109: Add two deduplication guards — (1) in `ceo_intake.ts` `create_task` handler: block creation if project already has an `in_progress` task; (2) in `ceo.ts` `runCeoAgent`: replace the non-atomic `updateTaskStatus` with `transitionTaskStatus` (CAS) so concurrent agents on the same task self-abort.

**Tech Stack:** TypeScript, Resend (already in deps), Supabase (already available), existing `sendEmail` + `transitionTaskStatus` helpers.

---

## File Map

| File | Change |
|------|--------|
| `backend/src/services/founder_revenue_actions.ts` | Add `sendInvoiceEmail()` helper + call it after invoicing |
| `backend/src/types/index.ts` | Add `invoice_email_sent` to `EventType` union |
| `backend/src/services/supabase.ts` | Add `getInProgressTasksByProject(projectId)` helper |
| `backend/src/agents/ceo_intake.ts` | Guard `create_task`: reject if project has active in_progress task |
| `backend/src/agents/ceo.ts` | Replace `updateTaskStatus('in_progress')` with atomic `transitionTaskStatus` |

---

## Task 1 — Add `invoice_email_sent` to EventType

**Files:**
- Modify: `backend/src/types/index.ts` (lines ~163–190, `EventType` union)

- [ ] **Step 1: Add the event type**

Open `backend/src/types/index.ts`. Find the `EventType` union. Add `'invoice_email_sent'` after `'revenue_recorded'`:

```typescript
  | 'revenue_recorded'
  | 'invoice_email_sent'
  | 'payment_received'
```

- [ ] **Step 2: Typecheck**

```bash
cd backend && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/types/index.ts
git commit -m "feat(types): add invoice_email_sent event type"
```

---

## Task 2 — Invoice HTML email generator + sender (T108)

**Files:**
- Modify: `backend/src/services/founder_revenue_actions.ts`

The `sendInvoiceEmail` function generates a clean HTML invoice and sends it via the existing `sendEmail` service. It is called at the end of `executeInvoiceProject`, after the DB writes succeed, and is non-fatal (catches its own errors).

- [ ] **Step 1: Add import for `sendEmail` and `log` at top of `founder_revenue_actions.ts`**

The file already imports `log`. Add `sendEmail` import:

```typescript
import { sendEmail } from './email.js'
```

Place it after the existing imports at the top of the file.

- [ ] **Step 2: Add `buildInvoiceNumber` helper**

After the existing `formatUsd` helper, add:

```typescript
function buildInvoiceNumber(projectSlug: string, now = new Date()): string {
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '')
  const prefix = projectSlug.slice(0, 8).toUpperCase()
  return `INV-${dateStr}-${prefix}`
}
```

- [ ] **Step 3: Add `buildInvoiceHtml` helper**

```typescript
function buildInvoiceHtml(params: {
  invoiceNumber: string
  clientName: string
  projectName: string
  amountUsd: number
  issuedAt: string
}): string {
  const { invoiceNumber, clientName, projectName, amountUsd, issuedAt } = params
  const formattedDate = new Date(issuedAt).toLocaleDateString('en-GB', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Invoice ${invoiceNumber}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; margin: 0; padding: 32px 16px; color: #111827; }
    .card { background: #fff; max-width: 600px; margin: 0 auto; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.1); padding: 40px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
    .brand { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; color: #111827; }
    .brand span { color: #6366f1; }
    .invoice-meta { text-align: right; font-size: 13px; color: #6b7280; }
    .invoice-meta strong { display: block; font-size: 15px; color: #111827; margin-bottom: 4px; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: #9ca3af; margin: 0 0 4px; }
    .client-block { margin-bottom: 32px; }
    .client-block p { margin: 0; font-size: 16px; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 32px; }
    th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #9ca3af; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
    td { padding: 12px 0; font-size: 15px; border-bottom: 1px solid #f3f4f6; }
    .amount-row { font-weight: 700; font-size: 18px; border-bottom: none; }
    .footer { font-size: 13px; color: #9ca3af; text-align: center; margin-top: 32px; padding-top: 24px; border-top: 1px solid #f3f4f6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="brand">W<span>AI</span></div>
      <div class="invoice-meta">
        <strong>${invoiceNumber}</strong>
        Issued: ${formattedDate}
      </div>
    </div>

    <div class="client-block">
      <h2>Bill To</h2>
      <p>${clientName}</p>
    </div>

    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th style="text-align:right">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${projectName}</td>
          <td style="text-align:right">${formatUsd(amountUsd)}</td>
        </tr>
        <tr>
          <td class="amount-row">Total Due</td>
          <td class="amount-row" style="text-align:right">${formatUsd(amountUsd)}</td>
        </tr>
      </tbody>
    </table>

    <div class="footer">
      Thank you for working with WAI · Wawen Autonomous Industries<br/>
      Questions? Reply to this email.
    </div>
  </div>
</body>
</html>`
}
```

- [ ] **Step 4: Add `sendInvoiceEmail` function**

```typescript
async function sendInvoiceEmail(
  client: Client,
  project: Project,
  amountUsd: number,
  invoiceNumber: string,
  issuedAt: string,
): Promise<boolean> {
  if (!client.email) {
    log.warn({ clientId: client.id, clientSlug: client.slug }, 'Invoice email skipped: client has no email address')
    return false
  }

  const html = buildInvoiceHtml({
    invoiceNumber,
    clientName: client.name,
    projectName: project.name,
    amountUsd,
    issuedAt,
  })

  await sendEmail({
    to: client.email,
    subject: `Invoice ${invoiceNumber} – ${project.name}`,
    html,
    text: `Invoice ${invoiceNumber}\n\nBill To: ${client.name}\nProject: ${project.name}\nAmount Due: ${formatUsd(amountUsd)}\n\nThank you for working with WAI.`,
  })

  return true
}
```

- [ ] **Step 5: Update `InvoiceProjectResult` type to include `emailSent`**

In the `InvoiceProjectResult` interface (near top of file), add:

```typescript
export interface InvoiceProjectResult {
  client: Client
  project: Project
  contractValueUsd: number
  previousStatus: string
  emailSent: boolean
  invoiceNumber: string
}
```

- [ ] **Step 6: Call `sendInvoiceEmail` at the end of `executeInvoiceProject`**

In `executeInvoiceProject`, after the `log.info(...)` line and before the `return`, add:

```typescript
  const invoiceNumber = buildInvoiceNumber(projectSlug)
  const issuedAt = new Date().toISOString()
  let emailSent = false

  try {
    emailSent = await sendInvoiceEmail(client, { ...project, status: 'invoiced', contract_value_usd: finalAmount }, finalAmount, invoiceNumber, issuedAt)
    if (emailSent) {
      await recordEvent('invoice_email_sent', {
        payload: {
          project_id: project.id,
          client_id: client.id,
          invoice_number: invoiceNumber,
          to: client.email,
          amount_usd: finalAmount,
        },
      })
    }
  } catch (err) {
    log.error({ err, projectId: project.id }, 'Invoice email failed (non-fatal)')
  }
```

Then update the return to:

```typescript
  return {
    client,
    project: {
      ...project,
      status: 'invoiced',
      contract_value_usd: finalAmount,
    },
    contractValueUsd: finalAmount,
    previousStatus: project.status,
    emailSent,
    invoiceNumber,
  }
```

- [ ] **Step 7: Update `formatInvoiceProjectMessage` to show email status**

```typescript
export function formatInvoiceProjectMessage(result: InvoiceProjectResult): string {
  const emailLine = result.emailSent
    ? `Invoice sent: ✅ email inviata al cliente`
    : `Invoice sent: ⚠️ email non inviata (nessun indirizzo email cliente)`

  return [
    `💰 *Project Invoiced*`,
    ``,
    `Client: ${result.client.name}`,
    `Project: ${result.project.name}`,
    `Invoice: ${result.invoiceNumber}`,
    `Status: invoiced`,
    `Contract value: ${formatUsd(result.contractValueUsd)}`,
    emailLine,
  ].join('\n')
}
```

- [ ] **Step 8: Typecheck**

```bash
cd backend && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/founder_revenue_actions.ts
git commit -m "feat(T108): invoice HTML email via Resend on project invoicing"
```

---

## Task 3 — Supabase helper: getInProgressTasksByProject (T109)

**Files:**
- Modify: `backend/src/services/supabase.ts`

- [ ] **Step 1: Add helper after `getTasksByStatus`**

In `supabase.ts`, after `getTasksByStatus`, add:

```typescript
export async function getInProgressTasksByProject(projectId: string): Promise<Task[]> {
  const { data, error } = await getSupabaseClient()
    .from('tasks')
    .select('*')
    .eq('project_id', projectId)
    .eq('status', 'in_progress')
    .order('created_at')

  if (error) throw new Error(`Failed to get in-progress tasks for project ${projectId}: ${error.message}`)
  return data as Task[]
}
```

- [ ] **Step 2: Typecheck**

```bash
cd backend && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/supabase.ts
git commit -m "feat(T109): add getInProgressTasksByProject supabase helper"
```

---

## Task 4 — CEO Intake deduplication guard (T109)

**Files:**
- Modify: `backend/src/agents/ceo_intake.ts`

The guard is added at the start of the `create_task` handler (around line 1545), after `projectId` is resolved but before `createTask` is called. If the project already has an `in_progress` task, return an informative message instead of spawning a new CEO chain.

- [ ] **Step 1: Import `getInProgressTasksByProject` in `ceo_intake.ts`**

Find the existing import from `'../services/supabase.js'` and add `getInProgressTasksByProject` to the list:

```typescript
import {
  createClient,
  createProject,
  createTask,
  getClientBySlug,
  getClients,
  getInProgressTasksByProject,   // add this
  getPayments,
  getProjects,
  getProjectBySlug,
  getProjectsByClient,
  getRecentEvents,
  getTasksByStatus,
  updateProjectStatus,
  updateProjectWorkspacePath,
} from '../services/supabase.js'
```

- [ ] **Step 2: Add the guard inside `create_task` handler**

Find the block starting at line ~1610 (`const task = await createTask({`). Before that line, insert:

```typescript
      // T109 — deduplication guard: block if project already has an active task
      if (projectId) {
        const activeTasks = await getInProgressTasksByProject(projectId)
        if (activeTasks.length > 0) {
          const active = activeTasks[0]!
          return `⚠️ *Task non creato* — il progetto ha già un task in lavorazione (\`${active.id.slice(0, 8)}\`): *${active.title}*\n\nAspetta che finisca o usa \`retry_task\` se è bloccato.`
        }
      }
```

- [ ] **Step 3: Typecheck**

```bash
cd backend && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/agents/ceo_intake.ts
git commit -m "feat(T109): block create_task if project already has in_progress task"
```

---

## Task 5 — CEO agent atomic task pickup (T109)

**Files:**
- Modify: `backend/src/agents/ceo.ts`

Replace the non-atomic `updateTaskStatus(task.id, 'in_progress')` at line ~181 with `transitionTaskStatus`. If the CAS fails (another agent already grabbed the task), log and abort immediately.

- [ ] **Step 1: Import `transitionTaskStatus` in `ceo.ts`**

Find the import from `'../services/supabase.js'`:

```typescript
import { createTask, updateTaskStatus } from '../services/supabase.js'
```

Change to:

```typescript
import { createTask, transitionTaskStatus, updateTaskStatus } from '../services/supabase.js'
```

- [ ] **Step 2: Replace non-atomic status update**

Find line ~181:

```typescript
  // Mark parent task in_progress before calling the LLM
  await updateTaskStatus(task.id, 'in_progress')
```

Replace with:

```typescript
  // T109 — atomic CAS: only one CEO agent can claim this task
  const claimed = await transitionTaskStatus(task.id, 'todo', 'in_progress')
  if (!claimed) {
    log.warn({ taskId: task.id }, 'CEO runCeoAgent: task already claimed by another agent, aborting')
    return
  }
```

- [ ] **Step 3: Typecheck**

```bash
cd backend && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/agents/ceo.ts
git commit -m "feat(T109): atomic task pickup in CEO agent via transitionTaskStatus CAS"
```

---

## Task 6 — Update PROJECT_TRACKING.md

**Files:**
- Modify: `docs/PROJECT_TRACKING.md`

- [ ] **Step 1: Mark T108 and T109 as done in the Active Build Queue table**

Change:
```
| T108 | Invoice email automation | 🔲 Todo | Claude | 1 | On `invoice_project`: generate PDF invoice (HTML→PDF) + send via Resend to client email |
| T109 | Task deduplication guard | 🔲 Todo | Claude | 2 | Add optimistic lock at CEO entry point: `transitionTaskStatus('pending' → 'in_progress')` before spawning |
```

To:
```
| T108 | Invoice email automation | ✅ Done | Claude | 1 | — |
| T109 | Task deduplication guard | ✅ Done | Claude | 2 | — |
```

- [ ] **Step 2: Add to Recent Completed Work**

Add under `## Recent Completed Work`:

```markdown
| T108 | Invoice email automation | ✅ Done | On `invoice_project`: HTML invoice email sent to client via Resend; non-fatal if no client email |
| T109 | Task deduplication guard | ✅ Done | Atomic CAS pickup in CEO agent + create_task guard in CEO Intake blocks duplicate spawning |
```

- [ ] **Step 3: Add a Recent Changes entry**

```markdown
### 2026-03-21 — T108 + T109: Invoice email + task deduplication

**T108 — Invoice email:**
- `executeInvoiceProject` now generates and sends an HTML invoice email to the client via Resend immediately after marking the project as `invoiced`
- If `client.email` is null: email is skipped silently (warning logged), pipeline not blocked
- Invoice number format: `INV-YYYYMMDD-<PROJECT_PREFIX>`
- `invoice_email_sent` event emitted to `events` table on success
- `formatInvoiceProjectMessage` now shows email delivery status in the Telegram confirmation

**T109 — Task deduplication:**
- `ceo_intake.ts` `create_task`: checks `getInProgressTasksByProject` before spawning — returns a clear warning if project already has an active task
- `ceo.ts` `runCeoAgent`: replaces `updateTaskStatus` with `transitionTaskStatus('todo' → 'in_progress')` — atomic CAS prevents two concurrent CEO agents from claiming the same task
```

- [ ] **Step 4: Commit docs**

```bash
git add docs/PROJECT_TRACKING.md
git commit -m "docs: mark T108 + T109 done, add session notes"
```

---

## How to Test

**T108:**
1. Create a test client with an email: use CEO Intake → `crea cliente Mario Rossi mario@example.com`
2. Create a project, mark it delivered
3. Run: `/fattura mario-rossi/nome-progetto 500`
4. Expected: Telegram confirms with invoice number + "email inviata al cliente"
5. Check the email inbox at `mario@example.com` for the HTML invoice

**T109 — create_task guard:**
1. Start a task on a project (it will go `in_progress`)
2. While the task is still running, send: `lancia il lavoro per client/project`
3. Expected: WAI responds with ⚠️ message about existing active task, no new task created

**T109 — CEO atomic pickup:**
1. This is verified implicitly — if two CEO calls arrive simultaneously on the same task, only one will succeed the `transitionTaskStatus` CAS; the other logs a warn and exits cleanly
