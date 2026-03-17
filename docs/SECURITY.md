# Security Guidelines

## Principles

1. **Zero trust** – every component assumes others may be compromised
2. **Least privilege** – agents only have access to what they need
3. **Defense in depth** – multiple layers of security
4. **Audit everything** – all actions logged, all costs tracked

---

## API Key Management

### Rules
- API keys ONLY in `.env` files (gitignored) or system environment
- Never in source code, comments, or logs
- Use separate keys per environment (dev/staging/prod)
- Rotate keys immediately if potentially compromised

### Services and Key Locations

| Service | Env Var | Where to generate |
|---------|---------|------------------|
| Azure OpenAI | `AZURE_OPENAI_API_KEY` | Azure Portal |
| Google AI | `GOOGLE_AI_API_KEY` | Google AI Studio |
| Supabase | `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Settings → API |
| Telegram | `TELEGRAM_BOT_TOKEN` | @BotFather on Telegram |
| GitHub | `GITHUB_TOKEN` | GitHub → Settings → Developer Settings → PAT |
| SendGrid | `SENDGRID_API_KEY` | SendGrid Dashboard |

---

## Network Security

### OpenClaw Gateway
- **Always** bind to loopback: `127.0.0.1:18789`
- Never expose directly to internet
- Remote access ONLY via:
  - SSH tunnel: `ssh -L 18789:localhost:18789 user@server`
  - Tailscale (preferred)

### Dashboard
- Local dev: `localhost:3000` only
- Production: behind Nginx with authentication
- Options: Tailscale auth, Cloudflare Access, or basic auth

### Database
- PostgreSQL: never expose port 5432 to internet
- Use Supabase cloud: connections via Supabase client with JWT auth
- Local: Docker network internal only

---

## Supabase Security

### Row-Level Security (RLS)
All tables have RLS enabled. Service role bypasses RLS (backend only).

```sql
-- Example: authenticated users can only read
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_only_for_authenticated" ON tasks
  FOR SELECT TO authenticated USING (true);
```

### JWT Tokens
- Anon key: read-only dashboard queries
- Service role key: backend writes (never expose to browser)
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only

---

## Agent Security

### Permissions Matrix

| Agent | Read | Write Tasks | Write Events | Write Runs | Admin |
|-------|------|-------------|--------------|------------|-------|
| CEO | All | Yes | Yes | Yes | No |
| Team Leads | Own team | Yes | Yes | Yes | No |
| Workers | Assigned only | Status only | Yes | Yes | No |
| Finance | runs, events | No | Yes | No | No |
| Ops | All | No | Yes | No | No |
| Founder | All | All | All | All | Yes |

### Tool Permissions
- Shell tool: restricted by agent role (CEO/Founder can't run shell; Dev agents can)
- GitHub tool: only Dev and Architect agents
- Email tool: only Consulting Lead, Marketing, Finance agents
- Budget override: Founder only

---

## Telegram Security

- Bot only responds to `TELEGRAM_FOUNDER_CHAT_ID`
- All other chat IDs are silently ignored
- Commands are logged to `events` table

```typescript
// Always validate sender
if (ctx.from?.id.toString() !== process.env.TELEGRAM_FOUNDER_CHAT_ID) {
  return; // Ignore unauthorized senders
}
```

---

## Incident Response

### If API key is compromised
1. Immediately revoke key in provider dashboard
2. Generate new key
3. Update `.env` on all environments
4. Restart services
5. Review logs for unauthorized usage
6. Log incident in `events` with `severity='critical'`

### If agent produces harmful output
1. Reject output via `/reject task_id "reason"`
2. Check agent logs in `runs` table
3. Review model and tool configuration
4. Consider model switch or task cancellation

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
