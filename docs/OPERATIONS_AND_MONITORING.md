# Operations and Monitoring

## Starting WAI

### Full Local Stack

```bash
# 1. Start infrastructure
docker compose up -d

# 2. Apply DB schema (first time only)
psql $DATABASE_URL -f supabase/migrations/001_initial_schema.sql
psql $DATABASE_URL -f supabase/seed.sql

# 3. Start OpenClaw Gateway
openclaw gateway --port 18789 --verbose

# 4. Start backend (dev mode)
cd backend && pnpm dev

# 5. Start dashboard (dev mode)
cd dashboard && pnpm dev
```

### Production Mode (Docker)

```bash
docker compose -f docker-compose.yml up -d --build
```

---

## Stopping WAI

```bash
# Graceful stop
docker compose stop

# Full teardown (keeps volumes)
docker compose down

# Full teardown with data reset (DANGER)
docker compose down -v
```

---

## Health Checks

### OpenClaw Gateway

```bash
openclaw doctor
# Should show all channels connected and no critical errors
```

### Database

```bash
psql $DATABASE_URL -c "SELECT COUNT(*) FROM agents WHERE status='online';"
```

### Dashboard

Check [http://localhost:3000](http://localhost:3000) – header should show active agent count.

---

## Monitoring

### What to Monitor

| Metric | Source | Alert Threshold |
|--------|--------|----------------|
| Agent online count | `agents.status` | < expected count |
| Task failure rate | `runs.outcome = 'failure'` | > 10% in last hour |
| API cost (hourly) | `SUM(runs.cost_usd)` | > budget / 30 / 24 * 1.5 |
| Gateway uptime | OpenClaw process | Any restart |
| DB connection errors | Backend logs | Any error |
| Realtime latency | Dashboard indicator | > 5s |

### Logs

```bash
# Backend logs
docker logs wai-backend -f

# All containers
docker compose logs -f

# OpenClaw Gateway
openclaw gateway --verbose 2>&1 | tee ~/.openclaw/gateway.log
```

### Supabase Dashboard

Access your Supabase project dashboard for:
- Table Editor (live data)
- Logs (DB queries, auth, realtime)
- Usage metrics

---

## Alert Types

Alerts are surfaced via:
1. **Telegram notification** to Neb
2. **`events` table** entry with `severity='critical'`
3. **WAI Dashboard** red badge

### Alert Conditions (Finance Agent)

```
monthly_cost > monthly_budget * (alert_threshold / 100)
  → severity: warning

monthly_cost > monthly_budget
  → severity: critical, notify Neb immediately
```

### Alert Conditions (Ops Agent)

```
agent.status = 'error' for any agent
  → severity: warning, attempt auto-restart

consecutive_failures > 3 for same agent
  → severity: critical, notify Neb

gateway_process_down
  → severity: critical, attempt restart, notify Neb
```

---

## Incident Response

### Runbook: Agent Failure

1. Check logs: `docker logs wai-backend -f`
2. Identify failing agent ID from `events` table
3. Check last 5 runs: `SELECT * FROM runs WHERE agent_id='X' ORDER BY created_at DESC LIMIT 5;`
4. Check error messages in `runs.error_message`
5. If model error: try `/assign_model agent_id gemini-2.5-flash` as fallback
6. If tool error: check tool config in `backend/src/tools/`
7. Restart backend if needed: `docker compose restart backend`

### Runbook: Budget Exceeded

1. Check current costs: `SELECT model_id, SUM(cost_usd) FROM runs WHERE created_at > date_trunc('month', now()) GROUP BY model_id;`
2. Identify expensive agents
3. Switch expensive agents to Gemini 2.5 Flash temporarily
4. Review and cancel non-critical in-progress tasks
5. Set temporary budget override if justified

### Runbook: Gateway Down

```bash
# Check status
openclaw doctor

# Restart
pkill -f "openclaw gateway"
openclaw gateway --port 18789 --verbose &

# Verify
openclaw doctor
```

---

## Backup

### Database

```bash
# Manual backup
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql

# Restore
psql $DATABASE_URL < backup-20250101.sql
```

### Automated (add to cron)

```bash
# Daily backup at 2am
0 2 * * * pg_dump $DATABASE_URL | gzip > /backups/wai-$(date +\%Y\%m\%d).sql.gz
```

---

## Rollback

```bash
# Revert to previous Docker image
docker compose down
git checkout <previous-commit>
docker compose up -d --build

# Revert DB migration
psql $DATABASE_URL -f supabase/migrations/rollback_XXX.sql
```
