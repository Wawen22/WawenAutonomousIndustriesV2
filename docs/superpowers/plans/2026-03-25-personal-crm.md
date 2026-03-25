# T124 Personal CRM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a founder-focused contact tracking system with Supabase persistence, backend CRUD API, CEO Telegram NL commands, and a split-panel dashboard view in Personal mode.

**Architecture:** New `contacts` + `contact_interactions` tables in Supabase; `crm.ts` service; 8 routes added to `backend/src/index.ts`; 4 CEO NL commands; `PersonalCRMView.tsx` wired as a new Personal sidebar entry (`crm`).

**Tech Stack:** TypeScript, Supabase (postgres), Node.js HTTP server, React 18, Tailwind CSS, date-fns, clsx

**Spec:** `docs/superpowers/specs/2026-03-25-personal-crm-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `supabase/migrations/20260326010000_contacts.sql` | Create | Schema for `contacts` + `contact_interactions`, indexes, RLS, trigger |
| `backend/src/services/crm.ts` | Create | All DB operations for contacts and interactions |
| `backend/src/types/index.ts` | Modify | Add `Contact`, `ContactInteraction`, `ContactStatus`, `InteractionType`, `InteractionSource` |
| `backend/src/index.ts` | Modify | Import crm service + 8 new routes |
| `backend/src/agents/ceo_intake.ts` | Modify | Add 4 CRM commands to system prompt + executor |
| `dashboard/src/types/index.ts` | Modify | Same 5 CRM types (mirror of backend) |
| `dashboard/src/components/ui/Icon.tsx` | Modify | Add `contacts` icon name + SVG |
| `dashboard/src/components/Sidebar.tsx` | Modify | `PersonalViewId` += `'crm'`; nav item "Contacts" |
| `dashboard/src/App.tsx` | Modify | Import `PersonalCRMView`; `case 'crm'` in `ViewContent` switch |
| `dashboard/src/components/PersonalCRMView.tsx` | Create | Full CRM view: contact list + detail panel + interaction timeline |
| `docs/PROJECT_TRACKING.md` | Modify | T124 marked done; next step set |

---

## Task 1: Supabase Migration

**Files:**
- Create: `supabase/migrations/20260326010000_contacts.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================================
-- WAI – Migration: contacts + contact_interactions (T124 Personal CRM)
-- Founder-focused contact tracking with interaction history.
-- ============================================================

-- ── contacts ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contacts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text        NOT NULL,
  email           text,
  company         text,
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'follow_up', 'dormant')),
  last_contact_at timestamptz,
  notes           text        NOT NULL DEFAULT '',
  tags            text[]      NOT NULL DEFAULT '{}',
  metadata        jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Email uniqueness: partial index allows multiple NULL emails
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_email_unique
  ON contacts(email) WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_status
  ON contacts(status);

CREATE INDEX IF NOT EXISTS idx_contacts_last_contact
  ON contacts(last_contact_at DESC NULLS LAST);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_contacts"
  ON contacts FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_select_contacts"
  ON contacts FOR SELECT TO authenticated USING (true);

CREATE POLICY "service_role_all_contacts"
  ON contacts FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── contact_interactions ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contact_interactions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  uuid        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type        text        NOT NULL
                          CHECK (type IN ('email_in', 'email_out', 'meeting', 'note', 'call')),
  summary     text        NOT NULL,
  source      text        NOT NULL DEFAULT 'manual'
                          CHECK (source IN ('gmail', 'manual', 'calendar')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_interactions_contact_id
  ON contact_interactions(contact_id);

CREATE INDEX IF NOT EXISTS idx_contact_interactions_occurred_at
  ON contact_interactions(occurred_at DESC);

-- RLS
ALTER TABLE contact_interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_contact_interactions"
  ON contact_interactions FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_select_contact_interactions"
  ON contact_interactions FOR SELECT TO authenticated USING (true);

CREATE POLICY "service_role_all_contact_interactions"
  ON contact_interactions FOR ALL TO service_role USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use the `mcp__supabase__apply_migration` tool (or the Supabase dashboard SQL editor) with the content above.

Expected: migration runs without error; tables `contacts` and `contact_interactions` appear in Supabase.

- [ ] **Step 3: Verify tables exist**

Run via Supabase MCP `execute_sql`:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('contacts', 'contact_interactions');
```
Expected: 2 rows returned.

- [ ] **Step 4: Commit**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2"
git add supabase/migrations/20260326010000_contacts.sql
git commit -m "feat(crm): add contacts + contact_interactions migration (T124)"
```

---

## Task 2: Shared TypeScript Types

**Files:**
- Modify: `backend/src/types/index.ts` (append to end of file)
- Modify: `dashboard/src/types/index.ts` (append to end of file)

- [ ] **Step 1: Add CRM types to backend types**

Append to the end of `backend/src/types/index.ts`:

```typescript
// --- CRM ---

export type ContactStatus = 'active' | 'follow_up' | 'dormant'

export type InteractionType = 'email_in' | 'email_out' | 'meeting' | 'note' | 'call'

export type InteractionSource = 'gmail' | 'manual' | 'calendar'

export interface Contact {
  id: string
  name: string
  email?: string | null
  company?: string | null
  status: ContactStatus
  last_contact_at?: string | null
  notes: string
  tags: string[]
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface ContactInteraction {
  id: string
  contact_id: string
  type: InteractionType
  summary: string
  source: InteractionSource
  occurred_at: string
  created_at: string
}
```

- [ ] **Step 2: Add identical CRM types to dashboard types**

Append the exact same block to the end of `dashboard/src/types/index.ts`.

- [ ] **Step 3: Typecheck backend**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2/backend" && pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 4: Typecheck dashboard**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2/dashboard" && pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2"
git add backend/src/types/index.ts dashboard/src/types/index.ts
git commit -m "feat(crm): add Contact and ContactInteraction shared types (T124)"
```

---

## Task 3: Backend CRM Service

**Files:**
- Create: `backend/src/services/crm.ts`

- [ ] **Step 1: Create the CRM service**

Create `backend/src/services/crm.ts` with the following content:

```typescript
// ============================================================
// WAI – CRM Service (T124 Personal CRM)
// Contact tracking + interaction history for founder Neb.
// ============================================================

import { getSupabaseClient } from './supabase.js'
import { log } from './logger.js'
import type { Contact, ContactInteraction, ContactStatus, InteractionType, InteractionSource } from '../types/index.js'

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export async function getContacts(filter?: { status?: ContactStatus }): Promise<Contact[]> {
  let query = getSupabaseClient()
    .from('contacts')
    .select('*')
    .order('last_contact_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (filter?.status) {
    query = query.eq('status', filter.status)
  }

  const { data, error } = await query

  if (error) {
    log.error({ err: error }, 'CRM: getContacts failed')
    throw new Error(error.message)
  }

  return (data ?? []) as Contact[]
}

export async function getContact(id: string): Promise<Contact | null> {
  const { data, error } = await getSupabaseClient()
    .from('contacts')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    log.error({ err: error, id }, 'CRM: getContact failed')
    throw new Error(error.message)
  }

  return data as Contact | null
}

export interface UpsertContactInput {
  id?: string
  name: string
  email?: string | null
  company?: string | null
  status?: ContactStatus
  last_contact_at?: string | null
  notes?: string
  tags?: string[]
  metadata?: Record<string, unknown>
}

export async function upsertContact(input: UpsertContactInput): Promise<Contact> {
  const supabase = getSupabaseClient()

  if (input.id) {
    // Update existing
    const { id, ...fields } = input
    const { data, error } = await supabase
      .from('contacts')
      .update(fields)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      log.error({ err: error, id }, 'CRM: upsertContact (update) failed')
      throw new Error(error.message)
    }
    return data as Contact
  }

  // Insert new
  const { data, error } = await supabase
    .from('contacts')
    .insert({
      name: input.name,
      email: input.email ?? null,
      company: input.company ?? null,
      status: input.status ?? 'active',
      notes: input.notes ?? '',
      tags: input.tags ?? [],
      metadata: input.metadata ?? {},
    })
    .select()
    .single()

  if (error) {
    log.error({ err: error }, 'CRM: upsertContact (insert) failed')
    throw new Error(error.message)
  }
  return data as Contact
}

export async function deleteContact(id: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('contacts')
    .delete()
    .eq('id', id)

  if (error) {
    log.error({ err: error, id }, 'CRM: deleteContact failed')
    throw new Error(error.message)
  }
}

export async function findContactByNameOrEmail(query: string): Promise<Contact | null> {
  const supabase = getSupabaseClient()

  // Try exact email match first
  const { data: emailMatch } = await supabase
    .from('contacts')
    .select('*')
    .eq('email', query.toLowerCase())
    .maybeSingle()

  if (emailMatch) return emailMatch as Contact

  // Fall back to case-insensitive name substring match
  const { data: nameMatches } = await supabase
    .from('contacts')
    .select('*')
    .ilike('name', `%${query}%`)
    .limit(1)

  return (nameMatches?.[0] as Contact) ?? null
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

export async function getInteractions(contactId: string): Promise<ContactInteraction[]> {
  const { data, error } = await getSupabaseClient()
    .from('contact_interactions')
    .select('*')
    .eq('contact_id', contactId)
    .order('occurred_at', { ascending: false })

  if (error) {
    log.error({ err: error, contactId }, 'CRM: getInteractions failed')
    throw new Error(error.message)
  }

  return (data ?? []) as ContactInteraction[]
}

export interface AddInteractionInput {
  type: InteractionType
  summary: string
  source?: InteractionSource
  occurred_at?: string
}

export async function addInteraction(
  contactId: string,
  input: AddInteractionInput,
): Promise<ContactInteraction> {
  const supabase = getSupabaseClient()
  const occurredAt = input.occurred_at ?? new Date().toISOString()

  const { data, error } = await supabase
    .from('contact_interactions')
    .insert({
      contact_id: contactId,
      type: input.type,
      summary: input.summary,
      source: input.source ?? 'manual',
      occurred_at: occurredAt,
    })
    .select()
    .single()

  if (error) {
    log.error({ err: error, contactId }, 'CRM: addInteraction failed')
    throw new Error(error.message)
  }

  // Update contact's last_contact_at to the interaction's occurred_at
  await supabase
    .from('contacts')
    .update({ last_contact_at: occurredAt })
    .eq('id', contactId)

  return data as ContactInteraction
}

export async function deleteInteraction(id: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('contact_interactions')
    .delete()
    .eq('id', id)

  if (error) {
    log.error({ err: error, id }, 'CRM: deleteInteraction failed')
    throw new Error(error.message)
  }
}
```

- [ ] **Step 2: Typecheck backend**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2/backend" && pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2"
git add backend/src/services/crm.ts
git commit -m "feat(crm): add CRM service with contact + interaction CRUD (T124)"
```

---

## Task 4: Backend API Routes

**Files:**
- Modify: `backend/src/index.ts`

The project's backend uses raw Node.js HTTP with `url.pathname` matching (no Express). Study existing patterns in the file (e.g. `/api/memory/:id` at line ~1556) before editing.

- [ ] **Step 1: Add CRM service import to `backend/src/index.ts`**

Find the block of `import` statements near line 76–82 where `knowledge.js` is imported. Add immediately after it:

```typescript
import {
  getContacts,
  getContact,
  upsertContact,
  deleteContact,
  getInteractions,
  addInteraction,
  deleteInteraction,
} from './services/crm.js'
// Note: findContactByNameOrEmail is imported in ceo_intake.ts, not here
```

- [ ] **Step 2: Add all 8 CRM routes to `backend/src/index.ts`**

Find the block of knowledge routes near line 1792. Add the following CRM routes immediately BEFORE the knowledge routes block (i.e. before the comment `// ── GET /api/personal/knowledge`):

```typescript
    // ── CRM routes (T124 Personal CRM) ─────────────────────────────────────

    // GET /api/crm/contacts — list all contacts (optional ?status= filter)
    if (url.pathname === '/api/crm/contacts' && req.method === 'GET') {
      void (async () => {
        try {
          const status = url.searchParams.get('status') as string | null
          const validStatuses = ['active', 'follow_up', 'dormant']
          const filter = status && validStatuses.includes(status)
            ? { status: status as 'active' | 'follow_up' | 'dormant' }
            : undefined
          const contacts = await getContacts(filter)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ contacts }))
        } catch (err) {
          log.error({ err }, 'CRM: list contacts API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      })()
      return
    }

    // POST /api/crm/contacts — create a new contact
    if (url.pathname === '/api/crm/contacts' && req.method === 'POST') {
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }
          const body = await readJsonBody(req)
          const payload = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
          const name = typeof payload['name'] === 'string' ? payload['name'].trim() : ''
          if (!name) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'name is required' }))
            return
          }
          const contact = await upsertContact({
            name,
            email: typeof payload['email'] === 'string' ? payload['email'] : null,
            company: typeof payload['company'] === 'string' ? payload['company'] : null,
            status: (payload['status'] as 'active' | 'follow_up' | 'dormant') ?? 'active',
            notes: typeof payload['notes'] === 'string' ? payload['notes'] : '',
            tags: Array.isArray(payload['tags']) ? payload['tags'] as string[] : [],
            metadata: typeof payload['metadata'] === 'object' && payload['metadata'] !== null
              ? payload['metadata'] as Record<string, unknown>
              : {},
          })
          res.writeHead(201, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ contact }))
        } catch (err) {
          log.error({ err }, 'CRM: create contact API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      })()
      return
    }

    // Routes under /api/crm/contacts/:id and /api/crm/interactions/:id
    if (url.pathname.startsWith('/api/crm/contacts/') && req.method !== undefined) {
      const rest = url.pathname.slice('/api/crm/contacts/'.length)
      const parts = rest.split('/')
      const contactId = parts[0] ?? ''

      // GET /api/crm/contacts/:id
      if (parts.length === 1 && req.method === 'GET') {
        void (async () => {
          try {
            const contact = await getContact(contactId)
            if (!contact) {
              res.writeHead(404, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Not found' }))
              return
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ contact }))
          } catch (err) {
            log.error({ err, contactId }, 'CRM: get contact API error')
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Internal server error' }))
          }
        })()
        return
      }

      // PUT /api/crm/contacts/:id
      if (parts.length === 1 && req.method === 'PUT') {
        void (async () => {
          try {
            if (!isAuthorizedDashboardRequest(req)) {
              res.writeHead(403, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Forbidden' }))
              return
            }
            const body = await readJsonBody(req)
            const payload = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
            const name = typeof payload['name'] === 'string' ? payload['name'].trim() : ''
            if (!name) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'name is required' }))
              return
            }
            const contact = await upsertContact({
              id: contactId,
              name,
              email: 'email' in payload ? (typeof payload['email'] === 'string' ? payload['email'] : null) : undefined,
              company: 'company' in payload ? (typeof payload['company'] === 'string' ? payload['company'] : null) : undefined,
              status: payload['status'] as 'active' | 'follow_up' | 'dormant' | undefined,
              notes: typeof payload['notes'] === 'string' ? payload['notes'] : undefined,
              tags: Array.isArray(payload['tags']) ? payload['tags'] as string[] : undefined,
              metadata: typeof payload['metadata'] === 'object' && payload['metadata'] !== null
                ? payload['metadata'] as Record<string, unknown>
                : undefined,
            })
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ contact }))
          } catch (err) {
            log.error({ err, contactId }, 'CRM: update contact API error')
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Internal server error' }))
          }
        })()
        return
      }

      // DELETE /api/crm/contacts/:id
      if (parts.length === 1 && req.method === 'DELETE') {
        void (async () => {
          try {
            if (!isAuthorizedDashboardRequest(req)) {
              res.writeHead(403, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Forbidden' }))
              return
            }
            await deleteContact(contactId)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))
          } catch (err) {
            log.error({ err, contactId }, 'CRM: delete contact API error')
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Internal server error' }))
          }
        })()
        return
      }

      // GET /api/crm/contacts/:id/interactions
      if (parts.length === 2 && parts[1] === 'interactions' && req.method === 'GET') {
        void (async () => {
          try {
            const interactions = await getInteractions(contactId)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ interactions }))
          } catch (err) {
            log.error({ err, contactId }, 'CRM: list interactions API error')
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Internal server error' }))
          }
        })()
        return
      }

      // POST /api/crm/contacts/:id/interactions
      if (parts.length === 2 && parts[1] === 'interactions' && req.method === 'POST') {
        void (async () => {
          try {
            if (!isAuthorizedDashboardRequest(req)) {
              res.writeHead(403, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Forbidden' }))
              return
            }
            const body = await readJsonBody(req)
            const payload = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
            const type = typeof payload['type'] === 'string' ? payload['type'] : ''
            const summary = typeof payload['summary'] === 'string' ? payload['summary'].trim() : ''
            const validTypes = ['email_in', 'email_out', 'meeting', 'note', 'call']
            if (!validTypes.includes(type) || !summary) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'type and summary are required' }))
              return
            }
            const interaction = await addInteraction(contactId, {
              type: type as 'email_in' | 'email_out' | 'meeting' | 'note' | 'call',
              summary,
              source: typeof payload['source'] === 'string' ? payload['source'] as 'gmail' | 'manual' | 'calendar' : 'manual',
              occurred_at: typeof payload['occurred_at'] === 'string' ? payload['occurred_at'] : undefined,
            })
            res.writeHead(201, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ interaction }))
          } catch (err) {
            log.error({ err, contactId }, 'CRM: add interaction API error')
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Internal server error' }))
          }
        })()
        return
      }
    }

    // DELETE /api/crm/interactions/:id
    if (url.pathname.startsWith('/api/crm/interactions/') && req.method === 'DELETE') {
      const interactionId = url.pathname.slice('/api/crm/interactions/'.length)
      void (async () => {
        try {
          if (!isAuthorizedDashboardRequest(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden' }))
            return
          }
          if (!interactionId) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing interaction id' }))
            return
          }
          await deleteInteraction(interactionId)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } catch (err) {
          log.error({ err, interactionId }, 'CRM: delete interaction API error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      })()
      return
    }

    // ── /api/personal/knowledge routes follow below ──
```

- [ ] **Step 3: Typecheck backend**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2/backend" && pnpm typecheck
```
Expected: 0 errors. If you get "X is not exported from", verify the import from `./services/crm.js` uses the exact function names defined in `crm.ts`.

- [ ] **Step 4: Smoke-test the API (backend must be running)**

```bash
# Start backend if not running: cd backend && pnpm dev

# List contacts (empty)
curl -s http://localhost:3001/api/crm/contacts | jq .
# Expected: {"contacts":[]}

# Create a contact
curl -s -X POST http://localhost:3001/api/crm/contacts \
  -H 'Content-Type: application/json' \
  -d '{"name":"Mario Rossi","email":"mario@test.com","company":"Acme"}' | jq .
# Expected: {"contact":{"id":"...","name":"Mario Rossi",...}}

# Store the id from above and test GET by id
ID="<paste-id-here>"
curl -s http://localhost:3001/api/crm/contacts/$ID | jq .
```

- [ ] **Step 5: Commit**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2"
git add backend/src/index.ts
git commit -m "feat(crm): add 8 CRM API routes to backend (T124)"
```

---

## Task 5: CEO Intake Integration

**Files:**
- Modify: `backend/src/agents/ceo_intake.ts`

This file is large (~2500 lines). Use precise grep to locate insertion points before editing.

- [ ] **Step 1: Add CRM import to ceo_intake.ts**

Find the imports at the top of `ceo_intake.ts`. Add the CRM import near the other service imports:

```typescript
import {
  getContacts,
  upsertContact,
  addInteraction,
  findContactByNameOrEmail,
} from '../services/crm.js'
```

- [ ] **Step 2: Add 4 CRM actions to the system prompt**

Find the line containing `brain_search` in `buildSystemPrompt` (around line 258). It reads:
```
- brain_search       → params: query        (cerca semanticamente nel Second Brain)
```

After that line (still inside the same `## ACTIONS YOU CAN EXECUTE` block, before the blank line that precedes `Valid project types`), add:

```
- crm_add_contact    → params: name, email?, company?, notes?, tags?  (aggiunge un nuovo contatto al CRM)
- crm_log_interaction → params: contact, type (email_in|email_out|meeting|note|call), summary, occurred_at? (ISO 8601)  (logga un'interazione con un contatto)
- crm_get_contacts   → params: status? (active|follow_up|dormant)  (recupera lista contatti, opzionale filtro per status)
- crm_follow_up_due  → no params  (mostra i contatti con status follow_up che aspettano risposta)
```

- [ ] **Step 3: Add 4 planning rules to the system prompt**

Find rule 33 in the `## PLANNING RULES` block (around line 298). It reads:
```
33. Use brain_search when Neb wants to search/recall something from his Second Brain...
```

After that line, add:

```
34. Use crm_add_contact when Neb wants to save a new contact (e.g. "aggiungi contatto X", "salva contatto", "nuovo contatto", "add contact").
35. Use crm_log_interaction when Neb logs an interaction with someone (e.g. "ho parlato con X", "ho incontrato X", "ho chiamato X", "log call con X", "email a X"). Infer type from wording: "chiamato/call" → call, "incontrato/meeting/riunione" → meeting, "email/risposto" → email_out, "ricevuto email da" → email_in. For occurred_at, if Neb says "ieri" use yesterday's ISO date; if not specified use current datetime.
36. Use crm_get_contacts when Neb wants to see his contacts (e.g. "mostra contatti", "lista contatti", "chi ho nel CRM", "chi conosco"). Optional status filter if Neb specifies "attivi", "follow-up", "dormienti".
37. Use crm_follow_up_due when Neb asks who needs follow-up (e.g. "follow-up da fare", "chi devo seguire", "chi aspetta risposta", "follow up pending", "pending follow-ups").
```

- [ ] **Step 4: Add 4 executor cases**

Find the `case 'brain_search':` block (around line 2439). Add the following four cases immediately after the `brain_search` case closes (after its closing `}`):

```typescript
    case 'crm_add_contact': {
      const name = getString(params, 'name')
      if (!name) return '⚠️ crm_add_contact: name mancante.'
      const email = getString(params, 'email') || undefined
      const company = getString(params, 'company') || undefined
      const notes = getString(params, 'notes') || undefined
      const tags = Array.isArray(params['tags']) ? (params['tags'] as string[]) : undefined
      const contact = await upsertContact({ name, email, company, notes, tags })
      const companyStr = contact.company ? ` (${contact.company})` : ''
      return `✅ Contatto salvato: *${contact.name}*${companyStr}`
    }

    case 'crm_log_interaction': {
      const contactQuery = getString(params, 'contact') || getString(params, 'name')
      if (!contactQuery) return '⚠️ crm_log_interaction: contact mancante.'
      const type = getString(params, 'type')
      const validTypes = ['email_in', 'email_out', 'meeting', 'note', 'call']
      if (!type || !validTypes.includes(type)) return `⚠️ crm_log_interaction: type non valido. Valori: ${validTypes.join(', ')}`
      const summary = getString(params, 'summary')
      if (!summary) return '⚠️ crm_log_interaction: summary mancante.'
      const rawOccurredAt = getString(params, 'occurred_at')
      const occurredAt = rawOccurredAt && !isNaN(Date.parse(rawOccurredAt))
        ? new Date(rawOccurredAt).toISOString()
        : new Date().toISOString()

      let contact = await findContactByNameOrEmail(contactQuery)
      if (!contact) {
        // Auto-create contact if not found
        contact = await upsertContact({ name: contactQuery })
      }

      await addInteraction(contact.id, {
        type: type as 'email_in' | 'email_out' | 'meeting' | 'note' | 'call',
        summary,
        source: 'manual',
        occurred_at: occurredAt,
      })
      return `✅ Interazione loggata per *${contact.name}*: ${summary.slice(0, 80)}${summary.length > 80 ? '…' : ''}`
    }

    case 'crm_get_contacts': {
      const statusParam = getString(params, 'status')
      const validStatuses = ['active', 'follow_up', 'dormant']
      const filter = statusParam && validStatuses.includes(statusParam)
        ? { status: statusParam as 'active' | 'follow_up' | 'dormant' }
        : undefined
      const contacts = await getContacts(filter)
      if (contacts.length === 0) {
        return filter
          ? `📋 Nessun contatto con status "${filter.status}".`
          : '📋 Nessun contatto nel CRM.'
      }
      const list = contacts.slice(0, 15).map((c, i) => {
        const status = c.status === 'follow_up' ? '🟡' : c.status === 'active' ? '🟢' : '⚫'
        const company = c.company ? ` — ${c.company}` : ''
        const lastContact = c.last_contact_at
          ? ` | ultimo contatto: ${new Date(c.last_contact_at).toLocaleDateString('it-IT')}`
          : ''
        return `${i + 1}. ${status} *${c.name}*${company}${lastContact}`
      })
      const header = filter ? `📋 Contatti (${filter.status}):` : `📋 Tutti i contatti (${contacts.length}):`
      return [header, ...list].join('\n')
    }

    case 'crm_follow_up_due': {
      const contacts = await getContacts({ status: 'follow_up' })
      if (contacts.length === 0) return '✅ Nessun follow-up in sospeso.'
      const list = contacts.map((c, i) => {
        const lastContact = c.last_contact_at
          ? `ultimo contatto: ${new Date(c.last_contact_at).toLocaleDateString('it-IT')}`
          : 'nessun contatto registrato'
        const notesSnippet = c.notes ? ` — ${c.notes.slice(0, 80)}${c.notes.length > 80 ? '…' : ''}` : ''
        return `${i + 1}. *${c.name}* | ${lastContact}${notesSnippet}`
      })
      return [`🔔 Follow-up in sospeso (${contacts.length}):`, ...list].join('\n')
    }
```

Note: `getString` is an existing helper in `ceo_intake.ts` — do not redefine it.

- [ ] **Step 5: Typecheck backend**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2/backend" && pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2"
git add backend/src/agents/ceo_intake.ts
git commit -m "feat(crm): add 4 CRM NL commands to CEO intake (T124)"
```

---

## Task 6: Dashboard Wiring

**Files:**
- Modify: `dashboard/src/components/ui/Icon.tsx`
- Modify: `dashboard/src/components/Sidebar.tsx`
- Modify: `dashboard/src/App.tsx`

These are small changes — do them all in this task.

- [ ] **Step 1: Add `contacts` icon to `Icon.tsx`**

In `dashboard/src/components/ui/Icon.tsx`:

1. In the `IconName` type (around line 3–9), add `'contacts'` to the union. The type currently ends with `| 'play' | 'models' | 'settings'`. Change it to:

```typescript
  | 'play' | 'models' | 'settings' | 'contacts'
```

2. In the `switch(name)` block, before `default:`, add:

```typescript
    case 'contacts':
      return (
        <svg {...p}>
          <circle cx="7" cy="8" r="3" />
          <path d="M1 20v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
          <path d="M17 3h5M17 7h5M17 11h4" />
        </svg>
      )
```

This renders as a person silhouette (left) + three contact-card lines (right) — classic contact book icon.

- [ ] **Step 2: Add `crm` to `PersonalViewId` in `Sidebar.tsx`**

In `dashboard/src/components/Sidebar.tsx` line 13, change:
```typescript
export type PersonalViewId = 'assistant' | 'capabilities' | 'models' | 'documents' | 'activity' | 'settings' | 'docs'
```
to:
```typescript
export type PersonalViewId = 'assistant' | 'crm' | 'capabilities' | 'models' | 'documents' | 'activity' | 'settings' | 'docs'
```

- [ ] **Step 3: Add nav item in `Sidebar.tsx`**

In the `PERSONAL` nav items array (around line 74–80), add the `crm` item after `assistant`:

```typescript
      { id: 'assistant', label: 'Assistant HQ', icon: 'overview' },
      { id: 'crm', label: 'Contacts', icon: 'contacts' },
```

- [ ] **Step 4: Add import and case to `App.tsx`**

1. After line 17 (`import { PersonalHQView } from './components/PersonalHQView.js'`), add:

```typescript
import { PersonalCRMView } from './components/PersonalCRMView.js'
```

2. In the `ViewContent` function (around line 206–207), after `case 'assistant': return <PersonalHQView />`, add:

```typescript
    case 'crm':       return <PersonalCRMView />
```

- [ ] **Step 5: Typecheck dashboard**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2/dashboard" && pnpm typecheck
```
Expected: errors like `Cannot find module './components/PersonalCRMView.js'` — this is expected since the component doesn't exist yet. All other errors must be 0.

- [ ] **Step 6: Commit**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2"
git add dashboard/src/components/ui/Icon.tsx dashboard/src/components/Sidebar.tsx dashboard/src/App.tsx
git commit -m "feat(crm): add contacts icon, sidebar nav, and App.tsx wiring (T124)"
```

---

## Task 7: PersonalCRMView Component

**Files:**
- Create: `dashboard/src/components/PersonalCRMView.tsx`

This is the main UI component. It follows the same structure as `SecondBrainPanel.tsx`. Study that file first to understand the pattern.

- [ ] **Step 1: Create `PersonalCRMView.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { formatDistanceToNow, format } from 'date-fns'
import type { Contact, ContactInteraction, ContactStatus, InteractionType } from '../types/index.js'

const BACKEND_URL = (import.meta.env['VITE_BACKEND_URL'] as string | undefined) ?? ''

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function relativeDate(iso: string | null | undefined): string {
  if (!iso) return 'never'
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return iso.slice(0, 10)
  }
}

const STATUS_LABELS: Record<ContactStatus, string> = {
  active: 'Active',
  follow_up: 'Follow-up',
  dormant: 'Dormant',
}

const STATUS_COLORS: Record<ContactStatus, string> = {
  active: 'bg-emerald-400/10 text-emerald-400 ring-1 ring-emerald-400/20',
  follow_up: 'bg-amber-400/10 text-amber-400 ring-1 ring-amber-400/20',
  dormant: 'bg-slate-400/10 text-slate-400 ring-1 ring-slate-400/20',
}

const STATUS_BTN_ACTIVE: Record<ContactStatus, string> = {
  active: 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40',
  follow_up: 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/40',
  dormant: 'bg-slate-500/20 text-slate-300 ring-1 ring-slate-400/40',
}

const INTERACTION_ICONS: Record<InteractionType, string> = {
  email_in: '📥',
  email_out: '📤',
  meeting: '📅',
  note: '📝',
  call: '📞',
}

const INTERACTION_LABELS: Record<InteractionType, string> = {
  email_in: 'Email in',
  email_out: 'Email out',
  meeting: 'Meeting',
  note: 'Note',
  call: 'Call',
}

// ── Types ────────────────────────────────────────────────────────────────────

interface ActionState {
  status: 'idle' | 'working' | 'done' | 'error'
  message?: string
}

// ── Main component ───────────────────────────────────────────────────────────

export function PersonalCRMView() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | ContactStatus>('all')

  // Add-contact modal
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', email: '', company: '' })
  const [addState, setAddState] = useState<ActionState>({ status: 'idle' })

  const selectedContact = useMemo(
    () => contacts.find((c) => c.id === selectedId) ?? null,
    [contacts, selectedId],
  )

  const counts = useMemo(
    () => ({
      all: contacts.length,
      active: contacts.filter((c) => c.status === 'active').length,
      follow_up: contacts.filter((c) => c.status === 'follow_up').length,
      dormant: contacts.filter((c) => c.status === 'dormant').length,
    }),
    [contacts],
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return contacts.filter((c) => {
      const matchStatus = statusFilter === 'all' || c.status === statusFilter
      const matchSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        (c.email?.toLowerCase().includes(q) ?? false) ||
        (c.company?.toLowerCase().includes(q) ?? false)
      return matchStatus && matchSearch
    })
  }, [contacts, statusFilter, search])

  const fetchContacts = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`${BACKEND_URL}/api/crm/contacts`)
      const data = await res.json() as { contacts?: Contact[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setContacts(data.contacts ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contacts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchContacts() }, [fetchContacts])

  async function handleAddContact() {
    if (!addForm.name.trim()) return
    setAddState({ status: 'working' })
    try {
      const res = await fetch(`${BACKEND_URL}/api/crm/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: addForm.name.trim(),
          email: addForm.email.trim() || null,
          company: addForm.company.trim() || null,
        }),
      })
      const data = await res.json() as { contact?: Contact; error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      if (data.contact) {
        setContacts((prev) => [data.contact!, ...prev])
        setSelectedId(data.contact.id)
        setShowAddForm(false)
        setAddForm({ name: '', email: '', company: '' })
        setAddState({ status: 'idle' })
      }
    } catch (err) {
      setAddState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to add contact' })
    }
  }

  function updateContactInList(updated: Contact) {
    setContacts((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
  }

  function removeContactFromList(id: string) {
    setContacts((prev) => prev.filter((c) => c.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── LEFT: Contact List ─────────────────────────────────── */}
      <div className="flex w-80 flex-shrink-0 flex-col border-r border-slate-700/60">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700/60 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-200">Contacts</h2>
          <button
            onClick={() => setShowAddForm(true)}
            className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500"
          >
            + Add
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-slate-700/60 px-3 py-2">
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded bg-slate-800 px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 outline-none ring-1 ring-slate-700 focus:ring-indigo-500"
          />
        </div>

        {/* Status filter pills */}
        <div className="flex gap-1 border-b border-slate-700/60 px-3 py-2">
          {(['all', 'active', 'follow_up', 'dormant'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={clsx(
                'rounded px-2 py-0.5 text-xs font-medium transition-colors',
                statusFilter === s
                  ? 'bg-slate-600 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200',
              )}
            >
              {s === 'all' ? 'All' : STATUS_LABELS[s]}
              <span className="ml-1 text-slate-500">
                {counts[s]}
              </span>
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <p className="px-4 py-6 text-xs text-slate-500">Loading…</p>
          )}
          {error && (
            <p className="px-4 py-6 text-xs text-red-400">{error}</p>
          )}
          {!loading && filtered.length === 0 && (
            <p className="px-4 py-6 text-xs text-slate-500">No contacts.</p>
          )}
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={clsx(
                'w-full border-b border-slate-700/40 px-4 py-3 text-left transition-colors',
                selectedId === c.id
                  ? 'bg-slate-700/50'
                  : 'hover:bg-slate-800/50',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-slate-200">{c.name}</span>
                <span className={clsx('flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium', STATUS_COLORS[c.status])}>
                  {STATUS_LABELS[c.status]}
                </span>
              </div>
              {c.company && (
                <p className="mt-0.5 truncate text-xs text-slate-500">{c.company}</p>
              )}
              <p className="mt-0.5 text-[10px] text-slate-600">
                {relativeDate(c.last_contact_at)}
              </p>
              {c.tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {c.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── RIGHT: Contact Detail ──────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {selectedContact ? (
          <ContactDetail
            contact={selectedContact}
            onUpdate={updateContactInList}
            onDelete={removeContactFromList}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-slate-500">Select a contact or add one.</p>
          </div>
        )}
      </div>

      {/* ── Add Contact Modal ──────────────────────────────────── */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-96 rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-xl">
            <h3 className="mb-4 text-sm font-semibold text-slate-200">New Contact</h3>
            <div className="space-y-3">
              <input
                autoFocus
                type="text"
                placeholder="Name *"
                value={addForm.name}
                onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleAddContact() }}
                className="w-full rounded bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none ring-1 ring-slate-700 focus:ring-indigo-500"
              />
              <input
                type="email"
                placeholder="Email"
                value={addForm.email}
                onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full rounded bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none ring-1 ring-slate-700 focus:ring-indigo-500"
              />
              <input
                type="text"
                placeholder="Company"
                value={addForm.company}
                onChange={(e) => setAddForm((f) => ({ ...f, company: e.target.value }))}
                className="w-full rounded bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none ring-1 ring-slate-700 focus:ring-indigo-500"
              />
            </div>
            {addState.status === 'error' && (
              <p className="mt-2 text-xs text-red-400">{addState.message}</p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => void handleAddContact()}
                disabled={addState.status === 'working' || !addForm.name.trim()}
                className="flex-1 rounded bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {addState.status === 'working' ? 'Saving…' : 'Add Contact'}
              </button>
              <button
                onClick={() => { setShowAddForm(false); setAddForm({ name: '', email: '', company: '' }); setAddState({ status: 'idle' }) }}
                className="rounded px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── ContactDetail sub-component ───────────────────────────────────────────────

interface ContactDetailProps {
  contact: Contact
  onUpdate: (contact: Contact) => void
  onDelete: (id: string) => void
}

function ContactDetail({ contact, onUpdate, onDelete }: ContactDetailProps) {
  const [interactions, setInteractions] = useState<ContactInteraction[]>([])
  const [intLoading, setIntLoading] = useState(true)

  // Inline editing states
  const [editingName, setEditingName] = useState(contact.name)
  const [editingEmail, setEditingEmail] = useState(contact.email ?? '')
  const [editingCompany, setEditingCompany] = useState(contact.company ?? '')
  const [editingNotes, setEditingNotes] = useState(contact.notes)
  const [notesSaveState, setNotesSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [newTag, setNewTag] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Add interaction form
  const [intForm, setIntForm] = useState<{ type: InteractionType; summary: string; occurred_at: string }>({
    type: 'note',
    summary: '',
    occurred_at: todayIso(),
  })
  const [intState, setIntState] = useState<ActionState>({ status: 'idle' })
  const [deletingIntId, setDeletingIntId] = useState<string | null>(null)

  // Reset state when contact changes
  useEffect(() => {
    setEditingName(contact.name)
    setEditingEmail(contact.email ?? '')
    setEditingCompany(contact.company ?? '')
    setEditingNotes(contact.notes)
    setNotesSaveState('idle')
    setConfirmDelete(false)
  }, [contact.id, contact.name, contact.email, contact.company, contact.notes])

  // Fetch interactions when contact changes
  const fetchInteractions = useCallback(async () => {
    setIntLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/crm/contacts/${contact.id}/interactions`)
      const data = await res.json() as { interactions?: ContactInteraction[]; error?: string }
      setInteractions(data.interactions ?? [])
    } catch {
      // non-fatal
    } finally {
      setIntLoading(false)
    }
  }, [contact.id])

  useEffect(() => { void fetchInteractions() }, [fetchInteractions])

  // Patch contact field (any subset of fields)
  async function patchContact(fields: Partial<Contact>): Promise<Contact | null> {
    try {
      const res = await fetch(`${BACKEND_URL}/api/crm/contacts/${contact.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...contact, ...fields }),
      })
      const data = await res.json() as { contact?: Contact; error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      if (data.contact) { onUpdate(data.contact); return data.contact }
      return null
    } catch {
      return null
    }
  }

  async function handleStatusChange(status: ContactStatus) {
    const updated = { ...contact, status }
    onUpdate(updated) // optimistic
    await patchContact({ status })
  }

  async function handleNameBlur() {
    const name = editingName.trim()
    if (!name || name === contact.name) return
    await patchContact({ name })
  }

  async function handleEmailBlur() {
    const email = editingEmail.trim() || null
    if (email === (contact.email ?? null)) return
    await patchContact({ email })
  }

  async function handleCompanyBlur() {
    const company = editingCompany.trim() || null
    if (company === (contact.company ?? null)) return
    await patchContact({ company })
  }

  async function handleNotesBlur() {
    if (editingNotes === contact.notes) return
    setNotesSaveState('saving')
    const result = await patchContact({ notes: editingNotes })
    setNotesSaveState(result ? 'saved' : 'error')
    if (result) setTimeout(() => setNotesSaveState('idle'), 2000)
  }

  async function handleAddTag() {
    const tag = newTag.trim()
    if (!tag || contact.tags.includes(tag)) { setNewTag(''); return }
    const tags = [...contact.tags, tag]
    onUpdate({ ...contact, tags }) // optimistic
    setNewTag('')
    await patchContact({ tags })
  }

  async function handleRemoveTag(tag: string) {
    const tags = contact.tags.filter((t) => t !== tag)
    onUpdate({ ...contact, tags }) // optimistic
    await patchContact({ tags })
  }

  async function handleAddInteraction() {
    if (!intForm.summary.trim()) return
    setIntState({ status: 'working' })
    try {
      const occurred_at = new Date(`${intForm.occurred_at}T12:00:00`).toISOString()
      const res = await fetch(`${BACKEND_URL}/api/crm/contacts/${contact.id}/interactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: intForm.type, summary: intForm.summary.trim(), occurred_at }),
      })
      const data = await res.json() as { interaction?: ContactInteraction; error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      if (data.interaction) {
        setInteractions((prev) => [data.interaction!, ...prev])
        // Update last_contact_at in parent
        onUpdate({ ...contact, last_contact_at: data.interaction.occurred_at })
        setIntForm({ type: 'note', summary: '', occurred_at: todayIso() })
        setIntState({ status: 'idle' })
      }
    } catch (err) {
      setIntState({ status: 'error', message: err instanceof Error ? err.message : 'Failed' })
    }
  }

  async function handleDeleteInteraction(id: string) {
    setDeletingIntId(id)
    try {
      await fetch(`${BACKEND_URL}/api/crm/interactions/${id}`, { method: 'DELETE' })
      setInteractions((prev) => prev.filter((i) => i.id !== id))
    } finally {
      setDeletingIntId(null)
    }
  }

  async function handleDeleteContact() {
    await fetch(`${BACKEND_URL}/api/crm/contacts/${contact.id}`, { method: 'DELETE' })
    onDelete(contact.id)
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-5">
      {/* ── Header ── */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <input
            type="text"
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onBlur={() => void handleNameBlur()}
            className="w-full bg-transparent text-lg font-semibold text-slate-100 outline-none hover:bg-slate-800/40 focus:bg-slate-800/40 rounded px-2 py-0.5 -mx-2"
          />
          <input
            type="text"
            value={editingCompany}
            onChange={(e) => setEditingCompany(e.target.value)}
            onBlur={() => void handleCompanyBlur()}
            placeholder="Company"
            className="w-full bg-transparent text-sm text-slate-400 outline-none hover:bg-slate-800/40 focus:bg-slate-800/40 rounded px-2 py-0.5 -mx-2 placeholder-slate-600"
          />
          <input
            type="email"
            value={editingEmail}
            onChange={(e) => setEditingEmail(e.target.value)}
            onBlur={() => void handleEmailBlur()}
            placeholder="Email"
            className="w-full bg-transparent text-sm text-slate-400 outline-none hover:bg-slate-800/40 focus:bg-slate-800/40 rounded px-2 py-0.5 -mx-2 placeholder-slate-600"
          />
        </div>
        <div>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs text-slate-600 hover:text-red-400"
            >
              Delete
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => void handleDeleteContact()} className="text-xs text-red-400 hover:text-red-300">
                Confirm
              </button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs text-slate-500 hover:text-slate-300">
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Status ── */}
      <div className="mb-4">
        <p className="mb-1.5 text-xs font-medium text-slate-500">Status</p>
        <div className="flex gap-2">
          {(['active', 'follow_up', 'dormant'] as ContactStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => void handleStatusChange(s)}
              className={clsx(
                'rounded px-3 py-1 text-xs font-medium transition-colors',
                contact.status === s
                  ? STATUS_BTN_ACTIVE[s]
                  : 'text-slate-500 hover:text-slate-300',
              )}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* ── Notes ── */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-medium text-slate-500">Notes</p>
          {notesSaveState === 'saving' && <span className="text-[10px] text-slate-500">Saving…</span>}
          {notesSaveState === 'saved' && <span className="text-[10px] text-emerald-400">Saved</span>}
          {notesSaveState === 'error' && <span className="text-[10px] text-red-400">Error saving</span>}
        </div>
        <textarea
          value={editingNotes}
          onChange={(e) => setEditingNotes(e.target.value)}
          onBlur={() => void handleNotesBlur()}
          rows={3}
          placeholder="Add notes…"
          className="w-full rounded bg-slate-800/60 px-3 py-2 text-sm text-slate-300 placeholder-slate-600 outline-none ring-1 ring-slate-700 focus:ring-indigo-500 resize-none"
        />
      </div>

      {/* ── Tags ── */}
      <div className="mb-5">
        <p className="mb-1.5 text-xs font-medium text-slate-500">Tags</p>
        <div className="flex flex-wrap gap-1.5">
          {contact.tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded bg-slate-700 px-2 py-0.5 text-xs text-slate-300"
            >
              {tag}
              <button
                onClick={() => void handleRemoveTag(tag)}
                className="text-slate-500 hover:text-slate-200"
              >
                ×
              </button>
            </span>
          ))}
          <input
            type="text"
            placeholder="+ tag"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleAddTag() }}
            className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 placeholder-slate-600 outline-none ring-1 ring-slate-700 focus:ring-indigo-500 w-20"
          />
        </div>
      </div>

      {/* ── Interactions ── */}
      <div>
        <p className="mb-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Interaction History</p>

        {/* Add interaction form */}
        <div className="mb-4 rounded-lg bg-slate-800/60 p-3 ring-1 ring-slate-700">
          <div className="mb-2 flex gap-2">
            <select
              value={intForm.type}
              onChange={(e) => setIntForm((f) => ({ ...f, type: e.target.value as InteractionType }))}
              className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-200 outline-none"
            >
              {(Object.keys(INTERACTION_LABELS) as InteractionType[]).map((t) => (
                <option key={t} value={t}>{INTERACTION_ICONS[t]} {INTERACTION_LABELS[t]}</option>
              ))}
            </select>
            <input
              type="date"
              value={intForm.occurred_at}
              onChange={(e) => setIntForm((f) => ({ ...f, occurred_at: e.target.value }))}
              className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-200 outline-none"
            />
          </div>
          <textarea
            value={intForm.summary}
            onChange={(e) => setIntForm((f) => ({ ...f, summary: e.target.value }))}
            placeholder="What happened?"
            rows={2}
            className="mb-2 w-full rounded bg-slate-700/60 px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 outline-none ring-1 ring-slate-600 focus:ring-indigo-500 resize-none"
          />
          {intState.status === 'error' && (
            <p className="mb-1 text-xs text-red-400">{intState.message}</p>
          )}
          <button
            onClick={() => void handleAddInteraction()}
            disabled={intState.status === 'working' || !intForm.summary.trim()}
            className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {intState.status === 'working' ? 'Logging…' : 'Log'}
          </button>
        </div>

        {/* Timeline */}
        {intLoading && <p className="text-xs text-slate-500">Loading history…</p>}
        {!intLoading && interactions.length === 0 && (
          <p className="text-xs text-slate-600">No interactions logged yet.</p>
        )}
        <div className="space-y-2">
          {interactions.map((i) => (
            <div
              key={i.id}
              className="group relative rounded-lg bg-slate-800/40 px-3 py-2.5 ring-1 ring-slate-700/60"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-base">{INTERACTION_ICONS[i.type]}</span>
                  <div>
                    <span className="text-xs font-medium text-slate-300">{INTERACTION_LABELS[i.type]}</span>
                    {i.source !== 'manual' && (
                      <span className="ml-1.5 rounded bg-slate-700 px-1 py-0.5 text-[10px] text-slate-500">{i.source}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <time className="text-[10px] text-slate-600">
                    {format(new Date(i.occurred_at), 'dd MMM yyyy')}
                  </time>
                  <button
                    onClick={() => void handleDeleteInteraction(i.id)}
                    disabled={deletingIntId === i.id}
                    className="hidden text-slate-600 hover:text-red-400 group-hover:block text-xs"
                  >
                    ×
                  </button>
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-400">{i.summary}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck dashboard**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2/dashboard" && pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 3: Visual smoke test (dashboard must be running)**

```bash
cd dashboard && pnpm dev
```

1. Switch to Personal mode in the dashboard
2. Click "Contacts" in the left sidebar
3. Verify the split-panel layout loads without errors
4. Click "+ Add", fill in a name, click "Add Contact" → contact appears in list
5. Select the contact → detail panel shows with status buttons, notes textarea, tags input
6. Change status to "Follow-up" → badge updates immediately
7. Add a note, click elsewhere → "Saved" flashes
8. Add an interaction → appears in timeline below

- [ ] **Step 4: Commit**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2"
git add dashboard/src/components/PersonalCRMView.tsx
git commit -m "feat(crm): add PersonalCRMView split-panel component (T124)"
```

---

## Task 8: Final Typecheck + Docs Update

**Files:**
- Modify: `docs/PROJECT_TRACKING.md`
- Modify: `docs/superpowers/specs/2026-03-25-personal-crm-design.md`

- [ ] **Step 1: Final typecheck — both backend and dashboard**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2/backend" && pnpm typecheck
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2/dashboard" && pnpm typecheck
```
Expected: 0 errors in both. Fix any errors before proceeding.

- [ ] **Step 2: Update `docs/PROJECT_TRACKING.md`**

In the Active Build Queue table, change T124's row:

```
| T124 | Personal CRM — contact tracking + follow-up automation | ✅ Done | Claude | 2 | — |
```

In the `## Recent Changes` section, add a new entry at the top (above the T131 entry):

```markdown
### 2026-03-26 — T124: Personal CRM

**New:**
- `supabase/migrations/20260326010000_contacts.sql`: `contacts` table (status: active/follow_up/dormant, tags, notes, metadata) + `contact_interactions` table (type, summary, source, occurred_at). Partial unique index on email. `set_updated_at()` trigger. Full RLS.
- `backend/src/services/crm.ts`: `getContacts`, `getContact`, `upsertContact`, `deleteContact`, `getInteractions`, `addInteraction`, `deleteInteraction`, `findContactByNameOrEmail`
- `backend/src/index.ts`: 8 new routes under `/api/crm/*`
- `backend/src/agents/ceo_intake.ts`: 4 NL commands — `crm_add_contact`, `crm_log_interaction`, `crm_get_contacts`, `crm_follow_up_due`
- `dashboard/src/components/PersonalCRMView.tsx`: Split-panel view — contact list (search + status filters) + detail panel (inline editing, status toggle, notes, tags, interaction timeline)
- `dashboard/src/components/Sidebar.tsx`: "Contacts" nav entry in Personal mode
- Shared types: `Contact`, `ContactInteraction`, `ContactStatus`, `InteractionType`, `InteractionSource` in both backend and dashboard types

**How to test:**
1. Dashboard → Personal mode → "Contacts" → add a contact, log an interaction
2. Telegram: "aggiungi contatto Mario Rossi di Acme" → confirmed ✅
3. Telegram: "ho chiamato Mario Rossi, abbiamo discusso il contratto" → interaction logged ✅
4. Telegram: "follow up da fare" → returns follow_up contacts ✅
5. `pnpm typecheck` in backend and dashboard → 0 errors

**Next step:** T125 — Meeting Notes automation (Calendar + transcript + summary)
```

- [ ] **Step 3: Update spec status**

In `docs/superpowers/specs/2026-03-25-personal-crm-design.md`, change line 3 from `**Status:** Draft` to `**Status:** Implemented`.

- [ ] **Step 4: Commit**

```bash
cd "/home/rnebili/Progetti/NEB/Projects/WAI V2"
git add docs/PROJECT_TRACKING.md docs/superpowers/specs/2026-03-25-personal-crm-design.md
git commit -m "docs: mark T124 Personal CRM complete, update tracking"
```

---

## Implementation Order

Tasks **must** be done in this sequence (each task depends on the previous):

```
Task 1 (Migration) → Task 2 (Types) → Task 3 (Service) → Task 4 (Routes)
→ Task 5 (CEO Intake) → Task 6 (Dashboard wiring) → Task 7 (CRMView) → Task 8 (Docs)
```

Tasks 5 and 6 can be done in parallel after Task 4 is complete.
