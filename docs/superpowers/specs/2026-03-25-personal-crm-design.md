# T124 Personal CRM — Design Spec

**Date:** 2026-03-25
**Status:** Draft
**Scope:** Contact tracking + follow-up management for Neb as founder
**Milestone:** M9 / Fase 3 Personal mode expansion

---

## Problem

Neb interacts with many people — leads, partners, collaborators, investors, potential clients. Today there is no record of who they are, when they last spoke, what was discussed, or who needs a follow-up. Inboxes are noisy and context is lost between conversations.

This is not a generic CRM problem. It is a founder's daily operating problem: who should I talk to today, who is waiting for me, and what was the last thing we discussed?

---

## Goals

- Track contacts and categorize them by relationship health (active, needs follow-up, dormant)
- Log interactions manually (or via CEO NL from Telegram) without any auto-sync complexity
- Give Neb a fast, focused view in the dashboard: list → select → history
- Integrate naturally with the CEO Intake so the founder can update the CRM in natural language from Telegram

**Non-goals (this iteration):**
- Auto-sync from Gmail (future territory)
- Push notifications or scheduled reminders
- Multi-user or client-side CRM
- Deduplication logic or merge contacts

---

## Architecture

### Database layer (Supabase)

**`contacts` table**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| name | text NOT NULL | Full name |
| email | text | Optional, nullable |
| company | text | Optional, nullable |
| status | text NOT NULL CHECK | `active` \| `follow_up` \| `dormant` — DEFAULT `'active'` |
| last_contact_at | timestamptz | Nullable, updated on interaction log |
| notes | text NOT NULL | DEFAULT `''` — always a string, never NULL |
| tags | text[] NOT NULL | DEFAULT `'{}'` |
| metadata | jsonb NOT NULL | DEFAULT `'{}'` |
| created_at | timestamptz NOT NULL | DEFAULT now() |
| updated_at | timestamptz NOT NULL | DEFAULT now() |

Email uniqueness: enforced via partial unique index (not a column-level UNIQUE constraint, which would fail on multiple NULLs in some Postgres versions):
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_email_unique
  ON contacts(email) WHERE email IS NOT NULL;
```

`updated_at` auto-maintenance: requires a trigger function + trigger (same pattern as other tables):
```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

Indexes:
```sql
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
CREATE INDEX IF NOT EXISTS idx_contacts_last_contact ON contacts(last_contact_at DESC NULLS LAST);
```

---

**`contact_interactions` table**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| contact_id | uuid NOT NULL FK | → contacts(id) ON DELETE CASCADE |
| type | text NOT NULL CHECK | `email_in` \| `email_out` \| `meeting` \| `note` \| `call` |
| summary | text NOT NULL | What happened |
| source | text NOT NULL CHECK | `gmail` \| `manual` \| `calendar` — DEFAULT `'manual'` |
| occurred_at | timestamptz NOT NULL | DEFAULT now() — when it happened (not when logged) |
| created_at | timestamptz NOT NULL | DEFAULT now() |

Indexes (required for ordered queries — `getInteractions` queries `WHERE contact_id = $1 ORDER BY occurred_at DESC`):
```sql
CREATE INDEX IF NOT EXISTS idx_contact_interactions_contact_id
  ON contact_interactions(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_interactions_occurred_at
  ON contact_interactions(occurred_at DESC);
```

RLS (same pattern as `knowledge_items`):
```sql
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select_contacts" ON contacts FOR SELECT TO anon USING (true);
CREATE POLICY "authenticated_select_contacts" ON contacts FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_role_all_contacts" ON contacts FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE contact_interactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select_contact_interactions" ON contact_interactions FOR SELECT TO anon USING (true);
CREATE POLICY "authenticated_select_contact_interactions" ON contact_interactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_role_all_contact_interactions" ON contact_interactions FOR ALL TO service_role USING (true) WITH CHECK (true);
```

---

### Shared types

Added to both `backend/src/types/index.ts` and `dashboard/src/types/index.ts`:

```typescript
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
  notes: string              // always a string (DB: NOT NULL DEFAULT '')
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

---

### Backend service (`backend/src/services/crm.ts`)

Functions:

```typescript
getContacts(filter?: { status?: ContactStatus }): Promise<Contact[]>
// ORDER BY last_contact_at DESC NULLS LAST, created_at DESC

getContact(id: string): Promise<Contact | null>

upsertContact(data: Partial<Contact> & { name: string }): Promise<Contact>
// INSERT with id provided → UPDATE, without id → INSERT

deleteContact(id: string): Promise<void>

getInteractions(contactId: string): Promise<ContactInteraction[]>
// ORDER BY occurred_at DESC

addInteraction(
  contactId: string,
  data: { type: InteractionType; summary: string; source?: InteractionSource; occurred_at?: string }
): Promise<ContactInteraction>
// Also runs: UPDATE contacts SET last_contact_at = occurred_at, updated_at = now() WHERE id = contactId

deleteInteraction(id: string): Promise<void>

findContactByNameOrEmail(query: string): Promise<Contact | null>
// Used by CEO intake: tries exact email match first, then case-insensitive ILIKE on name
```

---

### Backend API routes (added to `backend/src/index.ts`)

All routes protected by `isAuthorizedDashboardRequest`. Same pattern as `/api/personal/knowledge`.

```
GET    /api/crm/contacts                    → getContacts (optional ?status= filter)
POST   /api/crm/contacts                    → upsertContact (body: Contact fields, no id = create)
GET    /api/crm/contacts/:id                → getContact
PUT    /api/crm/contacts/:id                → upsertContact (with id in body or merged from param)
DELETE /api/crm/contacts/:id                → deleteContact
GET    /api/crm/contacts/:id/interactions   → getInteractions
POST   /api/crm/contacts/:id/interactions   → addInteraction
DELETE /api/crm/interactions/:id            → deleteInteraction
```

---

### CEO NL Intake integration (`backend/src/agents/ceo_intake.ts`)

#### System prompt additions (append to `## ACTIONS YOU CAN EXECUTE` block)

```
- crm_add_contact    → params: name, email?, company?, notes?, tags?
- crm_log_interaction → params: contact (name or email), type (email_in|email_out|meeting|note|call), summary, occurred_at? (ISO 8601, defaults to now)
- crm_get_contacts   → params: status? (active|follow_up|dormant)
- crm_follow_up_due  → no params
```

Append to `## PLANNING RULES` numbered list:

```
34. Use crm_add_contact when Neb wants to save a new contact (e.g. "aggiungi contatto X", "salva contatto", "nuovo contatto").
35. Use crm_log_interaction when Neb logs an interaction with someone (e.g. "ho parlato con X", "ho incontrato X", "ho chiamato X", "log call con X"). Type is inferred from wording: "chiamato" → call, "incontrato/meeting" → meeting, "email" → email_out. occurred_at is ISO 8601; if not specified use current datetime.
36. Use crm_get_contacts when Neb wants to see his contacts (e.g. "mostra contatti", "lista contatti", "chi ho nel CRM"). Optional status filter if Neb specifies "attivi", "follow-up", "dormienti".
37. Use crm_follow_up_due when Neb asks who needs follow-up (e.g. "follow-up da fare", "chi devo seguire", "chi aspetta risposta", "follow up pending").
```

#### Executor additions (new `case` blocks in `executeCommand`)

**`crm_add_contact`**
- Reads: `name`, `email?`, `company?`, `notes?`, `tags?`
- Calls: `upsertContact({ name, email, company, notes, tags })`
- Returns: `✅ Contatto salvato: *Name* (Company)`

**`crm_log_interaction`**
- Reads: `contact` (string), `type`, `summary`, `occurred_at?`
- `occurred_at`: parse the string; if missing or unparseable, fallback to `new Date().toISOString()`
- Calls: `findContactByNameOrEmail(contact)`
  - If not found: auto-creates contact first (`upsertContact({ name: contact })`), then logs interaction
- Calls: `addInteraction(contactId, { type, summary, source: 'manual', occurred_at })`
- Returns: `✅ Interazione loggata per *Name*: [summary]`

**`crm_get_contacts`**
- Reads: `status?`
- Calls: `getContacts({ status })`
- Returns: numbered list (max 15), format: `N. *Name* — Company | status | last contact: relative date`

**`crm_follow_up_due`**
- Calls: `getContacts({ status: 'follow_up' })`
- Returns: if empty → `✅ Nessun follow-up in sospeso`; else numbered list with name + last contact + notes snippet (first 80 chars)

---

## Dashboard component (`PersonalCRMView.tsx`)

### Integration point

**`Sidebar.tsx`:** `PersonalViewId` gains `'crm'`. Add to the PERSONAL nav items array (after `'assistant'`):
```typescript
{ id: 'crm', label: 'Contacts', icon: 'users' }
```
(Use the closest available icon to `users` in the existing icon system — check `Icon.tsx` for available names.)

**`App.tsx`:** Inside the `ViewContent(view, ...)` switch function (around line 181), add:
```typescript
case 'crm': return <PersonalCRMView />
```
Also add the import at the top.

---

### Layout

Split panel: contact list (left, ~380px fixed) + contact detail panel (right, fills remaining space). On narrow viewports, the detail panel overlays the list.

**Left: Contact List**

- Search input (client-side filter on name / email / company — no debounce needed for <500 contacts)
- Status filter pills: All | Active | Follow-up | Dormant — each with a count badge
- List sorted by `last_contact_at DESC NULLS LAST` (fetched from backend)
- Each row: name (bold) + company (muted small) + status badge + last contact relative time + tag chips
- Status badge colors: `active` → emerald, `follow_up` → amber, `dormant` → slate
- "Add Contact" button at top-right of panel
- Selected contact has highlighted row (slate-700 bg or ring)

**Right: Contact Detail Panel**

When no contact selected: centered empty state, "Select a contact or add one."

When contact selected:

1. **Header**: name (editable `<input>` on click, blurs → PATCH), company (same), email (same). "Delete contact" danger button (confirmation required).
2. **Status selector**: three-button toggle group (Active / Follow-up / Dormant) — saves on click via PUT, optimistic update.
3. **Notes**: `<textarea>`, auto-saves on blur via PUT. Shows "Saved" indicator for 2s.
4. **Tags**: tag chips with × to remove. Inline `<input>` to add new tag (Enter to confirm). Saves on every change via PUT.
5. **Interaction history** heading + "Add interaction" form:
   - Type selector (dropdown: email_in ↓, email_out ↑, meeting, note, call) with icons
   - Summary `<textarea>` (required)
   - Date input (defaults to today, format YYYY-MM-DD)
   - "Log" button — optimistic add to list
6. **Timeline** (newest first):
   - Each entry: type icon + relative date + source badge + summary text
   - Delete button on hover (no confirmation — interactions are low-stakes)

### State management

- All saves are optimistic: update local state immediately, revert on error with a brief inline error message
- No Supabase Realtime needed — CRM is founder-only, single user, not a high-frequency stream
- List refreshes on: add contact, delete contact, status change (refetch the list)
- Interactions list refreshes on: add interaction, delete interaction (local contactId scope only)

---

## File change summary

| File | Action |
|------|--------|
| `supabase/migrations/20260326010000_contacts.sql` | Create |
| `backend/src/services/crm.ts` | Create |
| `backend/src/types/index.ts` | Extend (CRM types) |
| `backend/src/index.ts` | Extend (8 new routes) |
| `backend/src/agents/ceo_intake.ts` | Extend (4 commands: system prompt + executor) |
| `dashboard/src/types/index.ts` | Extend (same CRM types) |
| `dashboard/src/components/PersonalCRMView.tsx` | Create |
| `dashboard/src/components/Sidebar.tsx` | Extend (`crm` in PersonalViewId + nav item) |
| `dashboard/src/App.tsx` | Extend (import + case `'crm'` in ViewContent switch) |
| `docs/PROJECT_TRACKING.md` | Update (T124 done, next step) |
| `docs/superpowers/specs/2026-03-25-personal-crm-design.md` | Update (status: Draft → Implemented after delivery) |

---

## Testing checklist

1. Migration runs on Supabase without errors; both tables present with correct constraints
2. Partial unique index prevents duplicate emails; allows multiple NULL emails
3. `GET /api/crm/contacts` returns `[]` on fresh DB
4. `POST /api/crm/contacts` creates contact → `GET /api/crm/contacts/:id` returns it
5. `POST /api/crm/contacts/:id/interactions` creates interaction + updates `last_contact_at` on parent contact
6. `DELETE /api/crm/contacts/:id` cascades to interactions
7. Dashboard loads `PersonalCRMView` from "Contacts" sidebar nav in Personal mode
8. Add contact form creates row that appears in list with correct status badge
9. Status change button saves and updates badge immediately (optimistic)
10. Notes auto-save on blur
11. Tags: add tag → appears as chip; remove tag × → disappears
12. CEO NL: `"aggiungi contatto Mario Rossi di Acme"` → contact created, Telegram confirms
13. CEO NL: `"ho chiamato Mario Rossi, abbiamo discusso il contratto"` → interaction logged, `last_contact_at` updated
14. CEO NL: `"follow up da fare"` → returns only `follow_up` status contacts
15. CEO NL: `"mostra contatti attivi"` → returns only `active` status contacts
16. `pnpm typecheck` passes in both backend and dashboard
