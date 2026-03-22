# T116 — WhatsApp delivery for scheduled brief

**Date:** 2026-03-22
**Status:** Approved

---

## Problem

The daily brief automation (`personal-automation.ts`) generates a full founder brief (Gmail + Calendar + Drive) every morning at 08:30 and saves it to the workspace. However, it does not send the brief to the founder via any notification channel. The founder must actively open the dashboard or workspace to read it.

## Goal

After a successful brief generation (scheduled or manual), send the brief content to the founder via `sendFounderNotification()`, which routes to Telegram always and to WhatsApp when connected.

---

## Design

### Scope

One file: `backend/src/services/personal-automation.ts`

### Change 1 — Import

Add `sendFounderNotification` import from `./notification-router.js`.

### Change 2 — Send after success

In `runDailyFounderBriefAutomationNow`, in the success path (after state is saved and `succeeded` capability event is logged), send the brief:

```typescript
const briefText = result.reply.trim()
if (briefText) {
  const MAX_CHARS = 3_800
  const message = briefText.length > MAX_CHARS
    ? `${briefText.slice(0, MAX_CHARS)}\n\n…[brief completo nel workspace]`
    : briefText
  await sendFounderNotification(message).catch((err: unknown) => {
    log.warn({ err }, 'Failed to send daily brief notification — brief saved to workspace')
  })
}
```

### Key decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Manual vs scheduled? | Both | Manual trigger from dashboard is also useful to receive on mobile |
| New config flag? | No | Automation already has on/off. Router already handles WhatsApp offline |
| Chunking? | No — truncate at 3800 chars | Keeps code trivial; Telegram hard limit is 4096 |
| Fatal on failure? | No — non-fatal `.catch()` | Notification failure must never break automation state recording |

### What does NOT change

- No DB migrations
- No new endpoints
- No dashboard changes
- No changes to notification-router, agents, or any other service

---

## Testing

1. Enable the automation from Assistant HQ
2. Trigger a manual run ("Run Now" button)
3. Verify: brief arrives on Telegram + WhatsApp (if connected)
4. Verify: if WhatsApp is offline, brief still arrives on Telegram
5. Verify: automation status in dashboard shows `success` regardless of notification outcome
