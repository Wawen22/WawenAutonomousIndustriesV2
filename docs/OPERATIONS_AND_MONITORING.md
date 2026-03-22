# Operations and Monitoring

## Starting WAI

### Local Development Stack

Run each in a separate terminal from the repo root (`/home/rnebili/Progetti/NEB/Projects/WAI V2`):

```bash
# Terminal 1 — LiteLLM proxy (Docker)
sg docker -c "docker compose up litellm -d"

# Terminal 2 — Backend (hot reload)
cd backend && pnpm dev

# Terminal 3 — Dashboard
cd dashboard && pnpm dev

# Terminal 4 — Google Workspace MCP (required for Gmail / Calendar / Drive)
./scripts/start-google-workspace-mcp.sh
```

Default ports (see `.env` to override):

| Service | Default port |
|---------|-------------|
| Backend | 3101 (formerly 3001) |
| Dashboard | 3100 (Vite may auto-increment if busy) |
| LiteLLM | 4000 |
| Google Workspace MCP | 8000 |

**Google Workspace MCP** requires `uvx` — install with:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```
Restart the terminal after installing, then run the script again. The server must be running for Gmail, Calendar, and Drive founder actions to work.

### Typechecks

```bash
cd backend && pnpm typecheck
cd dashboard && pnpm typecheck
```

---

## Stopping WAI

```bash
# Stop LiteLLM
docker compose stop

# Stop backend and dashboard: Ctrl+C in each terminal

# Full Docker teardown (keeps volumes)
docker compose down

# Full teardown with data reset (DANGER)
docker compose down -v
```

---

## Health Checks

### Backend

```bash
curl http://localhost:3001/api/health
```

### Database (via Supabase MCP or SQL editor)

```sql
SELECT COUNT(*) FROM agents WHERE status = 'online';
SELECT COUNT(*) FROM tasks WHERE status IN ('todo', 'in_progress', 'blocked');
```

### Dashboard

Open http://localhost:3000 — header should show active agent count and milestone.

### LiteLLM

```bash
curl http://localhost:4000/health
```

---

## Monitoring

### What to Monitor

| Metric | Source | Alert Threshold |
|--------|--------|----------------|
| Agent online count | `agents.status` | < 17 |
| Task failure rate | `runs.outcome = 'failure'` | > 10% in last hour |
| API cost (hourly) | `SUM(runs.cost_usd)` | > budget / 30 / 24 * 1.5 |
| Tasks stuck in_progress | `tasks.updated_at` | > 30 min with no update |
| Blocked tasks | `tasks.status = 'blocked'` | Any unacknowledged |
| DB connection errors | Backend logs | Any error |
| Dashboard Realtime | Connected indicator | Disconnected |

### Dashboard Views for Monitoring

- **Overview** — system heartbeat, active tasks, costs, revenue KPIs
- **Founder Ops** — blocked tasks, pending review, invoice queue
- **Activity** — event timeline with severity filtering
- **Costs** — LLM spend by agent and model
- **Runs** — every LLM invocation with outcome and cost

### Telegram Automatic Alerts

The following events trigger automatic Telegram notifications to Neb:

| Trigger | Agent | Severity |
|---------|-------|----------|
| Budget > 80% threshold | Finance | Warning |
| Budget > 100% | Finance | Critical |
| Task stuck > 30 min | Ops | Warning |
| Agent error > 30 min unresolved | Ops | Warning |
| QA blocks a project (requires_human_review) | QA | Warning |
| Any agent failure with task context | Runtime agent | Error |

### Logs

```bash
# Backend logs
docker logs wai-backend -f   # if running in Docker
# or: pnpm dev output in terminal

# All Docker containers
docker compose logs -f
```

---

## Alert Conditions

### Finance Agent (automatic, every hour)

```
monthly_cost > monthly_budget * (ALERT_THRESHOLD_PERCENT / 100)
  → severity: warning → Telegram notification

monthly_cost > monthly_budget
  → severity: critical → Telegram + log budget_exceeded event
```

### Ops Agent (automatic, every 15 min)

```
task.status IN ('in_progress', 'blocked') AND updated_at < now() - interval '30 min'
  → INSERT ops_alert event + Telegram notification

agent_error event unresolved > 30 min
  → INSERT ops_alert event + Telegram notification
```

---

## Proactive Agent Communication

WAI is not purely reactive. The system uses `NotificationRouter` to reach out to the Founder across multiple channels (Telegram, WhatsApp, Dashboard) when specific triggers occur.

### Trigger Matrix

| Event | Channel Priority | Logic |
|-------|------------------|-------|
| `human_review_requested` | Telegram (High) | Immediate alert with action buttons. |
| `task_blocked` | WhatsApp (High) | Alert if the block is severe or requires external input. |
| `project_delivered` | Telegram / WhatsApp | Status update + link to output. |
| `payment_received` | WhatsApp (Low) | Confirmation of revenue. |
| `daily_briefing` | WhatsApp (Scheduled) | Summary of previous 24h at 08:00. |
| `budget_exceeded` | Telegram (Critical) | Immediate system halt warning. |

### Throttling & Smart Routing

To avoid notification fatigue, the `NotificationRouter`:
1. **Deduplicates**: Similar events within a 5-minute window are batched.
2. **Channel Switching**: If a High priority alert is not acknowledged on Telegram within 15 minutes, it may fail over to WhatsApp.
3. **Quiet Hours**: Non-critical notifications (Daily Briefing, Payment Received) are held between 23:00 and 07:00 unless explicitly overridden.

---

## Incident Response

### Runbook: Task Blocked

1. Check Founder Ops view on dashboard — see blocked task + reason
2. Read `deliverables/` files for the project to understand what failed
3. If transient error (API timeout, LLM failure): `/retry <task_id>` or Dashboard → Retry
4. If logic/code error: update brief, then retry
5. If unresolvable: `/reject <task_id>` and restart project

### Runbook: Agent Failure

1. Check Activity view on dashboard — filter by `agent_error`
2. Check `runs` table for last 5 runs of the failing agent:
   ```sql
   SELECT * FROM runs WHERE agent_id = 'X' ORDER BY created_at DESC LIMIT 5;
   ```
3. If model error: try `/assign_model agent_id gemini-2.5-flash` as fallback
4. If LiteLLM issue: check `docker compose logs litellm`
5. Restart backend if needed: `Ctrl+C` + `pnpm dev`

### Runbook: Budget Exceeded

1. Check current costs in Dashboard → Costs view
2. Identify expensive agents:
   ```sql
   SELECT agent_id, SUM(cost_usd) as total
   FROM runs
   WHERE created_at > date_trunc('month', now())
   GROUP BY agent_id ORDER BY total DESC;
   ```
3. Switch expensive agents to Gemini 2.5 Flash: `/assign_model architect gemini-2.5-flash`
4. Cancel non-critical in-progress tasks from Founder Ops

### Runbook: LiteLLM Down

```bash
# Check status
docker compose ps

# Restart
docker compose restart litellm

# Check logs
docker compose logs litellm -f
```

---

## Backup

### Supabase Cloud (automatic)

Supabase Pro plan includes automatic daily backups. Access via Supabase Dashboard → Project Settings → Backups.

### Manual Export

```bash
# Export via Supabase CLI
supabase db dump --project-ref nxrgwbwhauuusuuytipf > backup-$(date +%Y%m%d).sql
```

### Workspace Files

```bash
# Backup all project deliverables
tar -czf workspace-backup-$(date +%Y%m%d).tar.gz workspace/
```

---

## Rollback

```bash
# Revert to previous commit
git checkout <previous-commit>

# Restart backend
cd backend && pnpm dev

# Revert DB migration (if needed)
# Apply rollback SQL manually via Supabase SQL editor
```
