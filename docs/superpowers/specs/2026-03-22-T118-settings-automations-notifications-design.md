# T118 — Finance Weekly Automation + Settings Page + Notification Channels

**Date:** 2026-03-22
**Status:** Approved

---

## Problem

1. Finance weekly report runs automatically but has no enable/disable control and no configurable day.
2. No way to control which channels (Telegram, WhatsApp, future Discord) receive notifications.
3. Company mode has no Settings/Automations page — the gap vs Personal HQ.

---

## Design

### Backend — 2 new services

#### `notification-preferences.ts`
- Persists to `workspace/system/notification-preferences.json`
- Shape: `{ telegram: boolean, whatsapp: boolean }`
- Default: both `true` (preserves current behavior)
- Exports: `getNotificationPreferences()`, `updateNotificationPreferences(patch)`

#### `company-automations.ts`
- Persists to `workspace/system/company-automations.json`
- Shape: `{ financeWeeklyReport: { enabled: boolean, dayOfWeek: number, lastSentWeekKey: string | null } }`
- `dayOfWeek`: 0=Sunday … 6=Saturday, default `1` (Monday)
- `lastSentWeekKey`: ISO week key written by `finance.ts` after each send, used for status display
- Exports: `getCompanyAutomations()`, `updateCompanyAutomations(patch)`, `markFinanceWeeklyReportSent(weekKey)`

### Backend — modified files

#### `notification-router.ts` — `sendFounderNotification`
Reads notification preferences and builds the effective channel list before calling `sendNotification`. If both channels are disabled, returns early silently.

```typescript
export async function sendFounderNotification(message: string): Promise<void> {
  const prefs = await getNotificationPreferences()
  const channels = (['telegram', 'whatsapp'] as const).filter(c => prefs[c])
  if (channels.length === 0) return
  await sendNotification(message, { priority: 'high', channels })
}
```

#### `finance.ts` — `runFinanceCycle`
Before building the summary, checks:
1. `automations.financeWeeklyReport.enabled` — if false, return null silently
2. `new Date().getDay() === automations.financeWeeklyReport.dayOfWeek` — if not today's day, return null
After successful send, calls `markFinanceWeeklyReportSent(weekKey)`.

### Backend — new endpoints

| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/api/settings/notifications` | — | Returns `{ telegram, whatsapp }` |
| POST | `/api/settings/notifications` | `{ telegram?, whatsapp? }` | Updates channel prefs |
| GET | `/api/settings/automations` | — | Returns company automations state |
| POST | `/api/settings/automations` | `{ financeWeeklyReport?: { enabled?, dayOfWeek? } }` | Updates automation config |

### Dashboard — new `SettingsView.tsx`

Two tabs: **Automations** | **Notifications**

**Automations tab:**
- Finance Weekly Report card
  - Toggle on/off
  - Day picker: Sun Mon Tue Wed Thu Fri Sat (pill buttons, default Mon)
  - Status: "Last sent: week 2026-W12" or "Never sent"
  - Schedule description: "Sends every Monday"

**Notifications tab:**
- Telegram toggle (on/off)
- WhatsApp toggle (on/off + live connection status from existing WhatsApp status endpoint)
- Expandable: future channels appear here

### Dashboard — modified files

- `Sidebar.tsx`: add `'settings'` to `CompanyViewId` and `PersonalViewId`; add to COMPANY_NAV_SECTIONS (CORE section) and PERSONAL_NAV_SECTIONS; label "Settings", icon "settings"
- `Icon.tsx`: add `settings` gear icon (SVG)
- `App.tsx`: render `<SettingsView />` for `view === 'settings'`
- `types/index.ts`: add `NotificationPreferences`, `CompanyAutomationsState`, `FinanceWeeklyAutomationStatus`

---

## What does NOT change

- Personal HQ daily brief automation stays in PersonalHQView (no move)
- No DB migrations
- No changes to Telegram/WhatsApp transport layers
- `sendNotification()` signature unchanged — prefs applied only at `sendFounderNotification` level

---

## Testing

1. Disable Telegram in Settings → trigger any action → verify no Telegram message, WhatsApp still receives
2. Disable finance weekly → verify `runFinanceCycle` returns null without sending
3. Change day to Tuesday → verify report only fires on Tuesday
4. Re-enable both → verify normal behavior restored
