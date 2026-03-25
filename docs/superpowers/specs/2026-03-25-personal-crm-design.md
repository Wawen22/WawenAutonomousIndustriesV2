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
- Auto-sync from Gmail (future T125+ territory)
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
| email | text | Optional — unique when present |
| company | text | Optional |
| status | text CHECK | `active` \| `follow_up` \| `dormant` — default `active` |
| last_contact_at | timestamptz | Updated manually or on interaction log |
| notes | text | Free-form founder notes |
| tags | text[] | e.g. ["lead", "partner", "investor"] |
| metadata | jsonb | Extension point — linkedin_url, role, etc. |
| created_at | timestamptz | DEFAULT now() |
| updated_at | timestamptz | DEFAULT now() |

**`contact_interactions` table**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| contact_id | uuid FK | → contacts(id) ON DELETE CASCADE |
| type | text CHECK | `email_in` \| `email_out` \| `meeting` \| `note` \| `call` |
| summary | text NOT NULL | What happened — written by founder or CEO agent |
| source | text CHECK | `gmail` \| `manual` \| `calendar` — default `manual` |
| occurred_at | timestamptz | When it happened (not when it was logged) |
| created_at | timestamptz | DEFAULT now() |

RLS: anon SELECT, authenticated SELECT, service_role ALL. Same pattern as knowledge_items.

### Backend service (`backend/src/services/crm.ts`)

Functions:
- `getContacts(filter?: { status?: ContactStatus }): Promise<Contact[]>` — ordered by last_contact_at DESC NULLS LAST, then created_at DESC
- `getContact(id: string): Promise<Contact | null>`
- `upsertContact(data: Partial<Contact> & { name: string }): Promise<Contact>` — INSERT or UPDATE
- `deleteContact(id: string): Promise<void>`
- `getInteractions(contactId: string): Promise<ContactInteraction[]>` — ordered by occurred_at DESC
- `addInteraction(contactId: string, data: Omit<ContactInteraction, 'id' | 'contact_id' | 'created_at'>): Promise<ContactInteraction>` — also updates contacts.last_contact_at
- `deleteInteraction(id: string): Promise<void>`
- `findContactByNameOrEmail(query: string): Promise<Contact | null>` — used by CEO intake fuzzy match

### Backend API routes (added to `backend/src/index.ts`)

```
GET    /api/crm/contacts                    → getContacts (optional ?status=)
POST   /api/crm/contacts                    → upsertContact
PUT    /api/crm/contacts/:id                → upsertContact (with id)
DELETE /api/crm/contacts/:id                → deleteContact
GET    /api/crm/contacts/:id/interactions   → getInteractions
POST   /api/crm/contacts/:id/interactions   → addInteraction
DELETE /api/crm/interactions/:id            → deleteInteraction
```

All routes protected by `isAuthorizedDashboardRequest`. Same pattern as `/api/personal/knowledge`.

### Shared types

Added to both `backend/src/types/index.ts` and `dashboard/src/types/index.ts`:

```typescript
export type ContactStatus = 'active' | 'follow_up' | 'dormant'

export type InteractionType = 'email_in' | 'email_out' | 'meeting' | 'note' | 'call'

export type InteractionSource = 'gmail' | 'manual' | 'calendar'

export interface Contact {
  id: string
  name: string
  email?: string
  company?: string
  status: ContactStatus
  last_contact_at?: string
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

---

## Dashboard component (`PersonalCRMView.tsx`)

### Integration point

New sidebar entry in Personal mode. `PersonalViewId` gains `'crm'`. Nav item label: **"Contacts"**, icon: `users` (or closest available in the icon system). `App.tsx` renders `<PersonalCRMView />` for case `'crm'`.

This is a deliberate choice over adding another tab to PersonalHQView: the CRM has a distinct two-panel layout that doesn't compress well into the HQ tab pattern. PersonalHQView stays focused on quick actions, automations, and Second Brain.

### Layout

Split panel: contact list (left, ~380px fixed) + contact detail panel (right, fills remaining space).

On narrow viewports, the detail panel overlays the list (slide-over behaviour) — not a priority but a clean fallback.

**Left: Contact List**

- Search input (filter by name / email / company — client-side, no debounce needed for <500 contacts)
- Status filter pills: All | Active | Follow-up | Dormant — with counts
- Sorted by last_contact_at DESC NULLS LAST
- Each row: name (bold) + company (muted) + status badge + last contact relative date + tag chips
- Status badge colors: `active` → emerald, `follow_up` → amber, `dormant` → slate
- "Add Contact" button at top
- Selected contact has a highlighted row

**Right: Contact Detail Panel**

When no contact is selected: empty state with "Select a contact or add one".

When contact selected:
1. **Header**: name (editable inline on click), company, email — with "Delete contact" danger button
2. **Status selector**: three-button toggle (Active / Follow-up / Dormant) — saves on click
3. **Notes**: textarea, auto-saves on blur (PATCH /api/crm/contacts/:id)
4. **Tags**: tag chips with × to remove, + to add inline
5. **Interaction history**: chronological timeline (newest first)
   - Each entry: type icon + date + source badge + summary text
   - Type icons: email_in ↓, email_out ↑, meeting 📅, note 📝, call 📞
   - Delete button on hover
6. **Add interaction form** (always visible at top of history):
   - Type selector (dropdown)
   - Summary textarea (required)
   - Date picker (defaults to today)
   - "Log" button

### UX decisions

- All saves are optimistic: update local state immediately, revert on error with toast
- No separate "Save" button for status — it saves on selection
- Notes auto-save on blur to avoid losing text
- List refresh happens after any add/update/delete operation (simple refetch, no real-time needed here — the CRM isn't a high-frequency stream)

---

## CEO NL Intake integration

Four new commands in the system prompt and executor:

### `crm_add_contact`
**Trigger phrases:** "aggiungi contatto", "nuovo contatto", "salva contatto X", "add contact"
**Params:** `{ name: string, email?: string, company?: string, notes?: string, tags?: string[] }`
**Executor:** calls `upsertContact`, responds with "✅ Contatto salvato: *Name* (Company)"

### `crm_log_interaction`
**Trigger phrases:** "log interazione", "ho parlato con X", "ho incontrato X", "ho chiamato X", "ho risposto a X"
**Params:** `{ contact: string (name or email), type: InteractionType, summary: string, occurred_at?: string }`
**Executor:** `findContactByNameOrEmail(contact)`, then `addInteraction`. If not found, auto-creates the contact first, then logs. Responds with "✅ Interazione loggata per *Name*: [summary]"

### `crm_get_contacts`
**Trigger phrases:** "mostra contatti", "lista contatti", "chi ho nel CRM", "contatti attivi"
**Params:** `{ status?: ContactStatus }`
**Executor:** `getContacts(filter)`, formats as numbered list with status + last contact date. Max 15 shown.

### `crm_follow_up_due`
**Trigger phrases:** "follow-up da fare", "chi devo seguire", "chi aspetta risposta", "follow up pending"
**Params:** none
**Executor:** `getContacts({ status: 'follow_up' })`, formats with name + last contact date + notes snippet.

---

## File change summary

| File | Action |
|------|--------|
| `supabase/migrations/20260326010000_contacts.sql` | Create |
| `backend/src/services/crm.ts` | Create |
| `backend/src/types/index.ts` | Extend (CRM types) |
| `backend/src/index.ts` | Extend (7 new routes) |
| `backend/src/agents/ceo_intake.ts` | Extend (4 commands: system prompt + executor) |
| `dashboard/src/types/index.ts` | Extend (same CRM types) |
| `dashboard/src/components/PersonalCRMView.tsx` | Create |
| `dashboard/src/components/Sidebar.tsx` | Extend (`crm` in PersonalViewId + nav item) |
| `dashboard/src/App.tsx` | Extend (import + case `'crm'`) |
| `docs/PROJECT_TRACKING.md` | Update (T124 done, next step) |

---

## Testing checklist

1. Migration runs on Supabase without errors
2. `GET /api/crm/contacts` returns empty array on fresh DB
3. `POST /api/crm/contacts` creates a contact and returns it
4. `POST /api/crm/contacts/:id/interactions` creates interaction and updates `last_contact_at` on the contact
5. Dashboard loads PersonalCRMView from sidebar nav
6. Add contact form creates a row that appears in the list
7. Status change saves and updates badge immediately
8. Notes save on blur
9. CEO NL: "aggiungi contatto Mario Rossi di Acme" → contact created, Telegram confirms
10. CEO NL: "follow up da fare" → returns contacts in follow_up status
