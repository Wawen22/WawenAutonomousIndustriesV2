# Security Guidelines

## Principles

1. **Least privilege** — agents only have access to what they need
2. **Defense in depth** — multiple layers of security
3. **Audit everything** — all actions logged, all costs tracked
4. **Secrets in env only** — never in code, logs, or commits

---

## API Key Management

### Rules

- API keys ONLY in `.env` files (gitignored) or system environment variables
- Never in source code, comments, config files, or logs
- Rotate keys immediately if potentially compromised

### Required Environment Variables

| Variable | Service | Where to generate |
|----------|---------|------------------|
| `AZURE_OPENAI_API_KEY` | Azure OpenAI (GPT-5.4) | Azure Portal |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI | Azure Portal |
| `GOOGLE_AI_API_KEY` | Google AI (Gemini) | Google AI Studio |
| `SUPABASE_URL` | Supabase | Supabase Dashboard → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase (backend writes) | Supabase Dashboard → Settings → API |
| `SUPABASE_ANON_KEY` | Supabase (dashboard reads) | Supabase Dashboard → Settings → API |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot | @BotFather on Telegram |
| `TELEGRAM_FOUNDER_CHAT_ID` | Telegram (whitelist) | Your chat ID |
| `LITELLM_API_KEY` | LiteLLM proxy | Set in `.env`, used by backend |
| `LITELLM_BASE_URL` | LiteLLM proxy URL | `http://localhost:4000/v1` |
| `MONTHLY_BUDGET_USD` | Budget limit | Set manually |
| `ALERT_THRESHOLD_PERCENT` | Budget alert | Default: 80 |

---

## Network Security

### LiteLLM Proxy

- Docker internal — accessible only on `localhost:4000`
- Never expose to internet directly

### Backend HTTP API

- CORS configured for `localhost:3000` only (dashboard)
- Not exposed to internet in local dev

### Dashboard

- Local dev: `localhost:3000` only
- Production (mini PC / VPS): behind Nginx with Tailscale auth or Cloudflare Access
- The Supabase anon key in the dashboard only has read access (RLS enforced)

### Database

- Supabase cloud: connections via HTTPS + JWT auth, never raw Postgres port
- Service role key: backend only, never exposed to browser or client-side code

---

## Supabase Security

### Row-Level Security (RLS)

All tables have RLS enabled. Policies:

| Role | Access |
|------|--------|
| `service_role` | Full access (backend only) |
| `anon` | SELECT on clients, projects, tasks, events, runs, agents, memories, payments |
| `authenticated` | SELECT on all operational tables |

### JWT Tokens

- **Anon key**: used by dashboard for read-only Realtime subscriptions
- **Service role key**: used by backend for all writes — never expose to browser

---

## Telegram Security

- Bot only responds to `TELEGRAM_FOUNDER_CHAT_ID`
- All other chat IDs are silently ignored
- All commands are logged to `events` table

```typescript
// Always validate sender before processing any command
if (ctx.from?.id.toString() !== process.env.TELEGRAM_FOUNDER_CHAT_ID) {
  return; // Ignore unauthorized senders
}
```

---

## Agent Security

### Permissions Matrix

| Agent | Read | Write Tasks | Write Events | Write Runs | Admin |
|-------|------|-------------|--------------|------------|-------|
| CEO | All | Yes | Yes | Yes | No |
| Team Leads | Own scope | Yes | Yes | Yes | No |
| Workers | Assigned only | Status only | Yes | Yes | No |
| Finance | runs, events | No | Yes | No | No |
| Ops | All | No | Yes | No | No |
| Founder | All | All | All | All | Yes |

### File System Security

- Agent file operations are limited to `workspace/{client}/{project}/` paths
- Path traversal is explicitly blocked (`..` filtered, workspace prefix enforced)
- No agent can write outside the designated workspace

### Workspace Path Sanitization

```typescript
// backend/src/index.ts — deliverables API
// Strip 'workspace/' prefix from requests, reject '..' traversal
// All file reads are sandboxed to the workspace root
```

---

## Incident Response

### If API key is compromised

1. Immediately revoke key in provider dashboard
2. Generate new key
3. Update `.env` (and system env if on server)
4. Restart backend: `Ctrl+C` + `pnpm dev`
5. Review `runs` and `events` tables for unauthorized usage
6. Log incident: insert event with `type: 'security_incident'`, `severity: 'critical'`

### If agent produces harmful or incorrect output

1. Reject output: `/reject <task_id> "reason"` or Dashboard → Cancel
2. Check `runs` table for the last 5 runs of that agent
3. Review model assignment: consider `/assign_model agent_id gemini-2.5-flash`
4. Update brief or project scope if the issue was context-related
5. Retry with corrected context

---

## Dependency Security

```bash
# Audit npm packages
cd backend && pnpm audit
cd dashboard && pnpm audit

# Fix known vulnerabilities
pnpm audit --fix
```

Keep dependencies updated monthly.
