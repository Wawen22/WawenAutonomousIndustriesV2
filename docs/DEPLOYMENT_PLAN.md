# Deployment Plan

> Production deployment is intentionally **not** the current milestone.
> WAI stays local-first until the autonomous build/delivery/revenue loops are stable and the hardware is ready.
> Deploy is the final infrastructure hardening step — not the active development track.

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
