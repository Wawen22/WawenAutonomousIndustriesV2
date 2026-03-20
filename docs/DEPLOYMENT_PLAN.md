# Deployment Plan

> Production deployment is intentionally **not** the current milestone.
> WAI stays local-first until the autonomous build/delivery/revenue loops are stable and the hardware is ready.
> Deploy is the final infrastructure hardening step — not the active development track.

---

## Governed Delivery Pipeline (T106)

The delivery pipeline is **fully governable** — every step can be enabled/disabled globally (via Capability Platform) or per-project (via DeliveryConfig). No hardwired behavior.

### Delivery Gates — pipeline con step configurabili

```
QA passes
  ↓
[requireFounderApproval?]  → Telegram "Approvi la delivery di mario-rossi/landing?" → founder risponde sì/no
  ↓
[gitPush?]                 → git push origin main → GitHub
  ↓
[autoDeploy?]              → Vercel / Netlify deploy → ottieni URL live
  ↓
[clientEmailOnDelivery?]   → email al cliente con link + messaggio
  ↓
project.status = delivered
  ↓
[autoInvoice?]             → genera fattura PDF + email fattura al cliente
```

Ogni `[gate?]` è un toggle. Se off: step skippato silenziosamente.

### DeliveryConfig — struttura per-progetto

Ogni progetto ha una `DeliveryConfig` in `project.metadata.delivery_config`:

```typescript
interface DeliveryConfig {
  gitPush: boolean              // default: true  — pusha su GitHub dopo QA
  autoDeploy: boolean           // default: true  — deploya su Vercel/Netlify
  deployProvider: 'vercel' | 'netlify' | null  // default: 'vercel'
  requireFounderApproval: boolean  // default: false — richiede OK founder prima di delivery
  clientEmailOnDelivery: boolean   // default: false — email al cliente con URL
  autoInvoice: boolean             // default: false — crea fattura automaticamente
}
```

Default globali: `workspace/system/delivery-config.json`
Override per-progetto: `project.metadata.delivery_config` (merge con defaults)

### Governance — due livelli

**Livello 1 — Globale (Capability Platform esistente)**

| Capability ID | Cosa governa |
|--------------|--------------|
| `deployment.git_push` | Abilita/disabilita git push globalmente |
| `deployment.vercel_deploy` | Abilita/disabilita Vercel deploy globalmente |
| `deployment.netlify_deploy` | Abilita/disabilita Netlify deploy globalmente |
| `delivery.client_email` | Abilita/disabilita email cliente globalmente |
| `delivery.auto_invoice` | Abilita/disabilita fatturazione automatica |
| `delivery.founder_approval_gate` | Se `approval_required`: ogni progetto richiede OK |

Se una capability globale è `disabled` → override il config per-progetto. Nessun deploy avviene.

**Livello 2 — Per-progetto (DeliveryConfig)**

Ogni progetto può avere config diversa dalla global. Esempio:
- Progetto interno: `gitPush: true, autoDeploy: false, autoInvoice: false`
- Cliente pagante: `gitPush: true, autoDeploy: true, clientEmailOnDelivery: true, autoInvoice: true`

### Come controllare

**Da Telegram** (nuovi shortcut CEO Intake):
```
"disabilita deploy per mario-rossi/landing"
"attiva email cliente per wawen22/app"
"richiedi mia approvazione per tutti i progetti"
"disabilita git push globalmente"
"abilita fatturazione automatica per mario-rossi/landing"
```

**Da Dashboard** — nuovo tab "Delivery" nel modal ProjectsView:
- Toggle per ogni gate con badge ON/OFF
- Dropdown provider (Vercel / Netlify / nessuno)
- Badge "CUSTOM" se config progetto diversa dal default globale
- Sezione "Global Defaults" con link alla Capabilities view

### Implementazione (T106)

**Backend — nuovi file:**
- `backend/src/services/delivery-config.ts` — `getDeliveryConfig(projectId)` merge global+project, `updateProjectDeliveryConfig(projectId, patch)`, `getGlobalDeliveryDefaults()`
- `backend/src/services/deploy.ts` — `pushToGitHub(repoPath)`, `deployToVercel(repoPath, name)`, `deployToNetlify(repoPath, name)`, ritornano `{ url } | null`

**Backend — modifiche:**
- `backend/src/agents/qa.ts` — dopo QA pass, chiama `runDeliveryGates(task, deliveryConfig, deployUrl)` che esegue i gates in sequenza
- `backend/src/agents/ceo_intake.ts` — nuovi comandi `configure_delivery` per progetto
- `backend/src/index.ts` — `GET/PATCH /api/projects/:id/delivery-config`

**Dashboard:**
- `dashboard/src/components/ProjectsView.tsx` — nuovo tab "Delivery" nel modal con toggle switches

### Required env vars

| Variable | Purpose |
|----------|---------|
| `GITHUB_TOKEN` | Already present — git push via HTTPS |
| `VERCEL_TOKEN` | New — Vercel deployment API |
| `VERCEL_TEAM_ID` | New (optional) — if deploying to a Vercel team |
| `NETLIFY_TOKEN` | New (optional) — Netlify deploy API |
| `RESEND_API_KEY` | Already present — client email + invoice email |

---

## Phase 1: Local Development (Current)

**Status: Active**

WAI runs on the developer machine. Backend and dashboard run directly via Node.js dev servers. LiteLLM runs in Docker.

### Services

| Service | Mode | Port |
|---------|------|------|
| WAI Backend | `pnpm dev` (hot reload) | 3001 |
| WAI Dashboard | `pnpm dev` (Vite) | 3000 |
| LiteLLM Proxy | Docker Compose | 4000 |
| Supabase | Cloud (wai-v2) | — |
| Telegram Bot | @wai_v2_bot | — |

### Start

```bash
sg docker -c "docker compose up litellm -d"
cd backend && pnpm dev
cd dashboard && pnpm dev
```

### Security in Phase 1

- All services on localhost only
- No internet exposure (except Supabase cloud and LLM APIs)
- API keys in `.env` (gitignored)
- Telegram: only founder chat_id whitelisted

---

## Phase 2: Personal Mini PC (M8)

**Status: Todo — next infrastructure milestone**

WAI migrated to owned always-on hardware. Same stack, just running 24/7 without depending on the developer's laptop.

### Recommended Hardware

- **Mini PC:** Intel NUC, Beelink Mini PC, or similar
- **RAM:** 16GB minimum, 32GB recommended
- **Storage:** 500GB SSD
- **OS:** Ubuntu 22.04 LTS or Ubuntu Server

### Setup Steps

```bash
# 1. Install Docker
curl -fsSL https://get.docker.com | sh

# 2. Install Node.js 22 + pnpm
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
npm install -g pnpm

# 3. Install Tailscale (for secure remote access)
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up

# 4. Clone repo and configure
git clone <repo> /opt/wai
cd /opt/wai
cp .env.example .env
# Edit .env with production values

# 5. Start services
docker compose up litellm -d
cd backend && pnpm build && node dist/index.js
```

### Auto-restart with PM2

```bash
npm install -g pm2

# Start backend with PM2
cd /opt/wai/backend
pm2 start "node dist/index.js" --name wai-backend
pm2 save
pm2 startup
```

### Dashboard in Production

```bash
cd /opt/wai/dashboard
pnpm build
# Serve dist/ with any static server (nginx, serve, etc.)
```

### Network Access

- **Local network:** http://mini-pc-ip:3000
- **Remote (Tailscale):** http://mini-pc-tailscale-ip:3000
- No port forwarding needed — Tailscale handles remote access

### Home Network Setup

- Static local IP for mini PC (router DHCP reservation)
- UPS (uninterruptible power supply) recommended for 24/7 uptime

---

## Phase 3: Hetzner VPS (Optional — M6)

**Status: Deferred — skip to mini PC if hardware is available**

Cloud server option if mini PC is not available or if higher availability is needed.

### Recommended Server

- **Type:** CPX21 (3 vCPU, 4GB RAM) or CPX31 (4 vCPU, 8GB RAM)
- **OS:** Ubuntu 22.04 LTS
- **Location:** nbg1 (Nuremberg) or fsn1 (Falkenstein)
- **Cost:** ~€10–20/month

### Setup

```bash
# 1. SSH into server
ssh root@<server-ip>

# 2. Install Docker + Node.js + pnpm (same as Phase 2)

# 3. Install Tailscale
curl -fsSL https://tailscale.com/install.sh | sh && tailscale up

# 4. Clone and configure
git clone <repo> /opt/wai
cd /opt/wai && cp .env.example .env

# 5. Start
docker compose up litellm -d
pm2 start "node dist/index.js" --name wai-backend
```

### Security in Phase 3

- Firewall: only ports 22 (SSH) and 443 open; all others blocked
- Dashboard behind Nginx with Tailscale auth or Cloudflare Access
- All env vars as system environment variables (not in .env file on server)
- Fail2ban for SSH protection

---

## Environment Comparison

| Aspect | Local Dev | Mini PC | Hetzner VPS |
|--------|-----------|---------|-------------|
| Cost | €0/month | ~€0/month (owned) | ~€10–20/month |
| Uptime | Dev only | 24/7 | 24/7 |
| Latency | Local | Local/Tailscale | ~10ms |
| Backup | Manual | Manual + cloud | Hetzner snapshots |
| Setup complexity | Low | Medium | Medium |
| Scaling | No | No | Limited |
