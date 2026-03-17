# Deployment Plan

## Phase 1: Local Development

**Goal:** Working system on developer machine, all services via Docker Compose.

### Requirements
- Machine: any modern laptop/desktop (8GB+ RAM)
- Docker Desktop or Docker Engine + Compose
- Node.js ≥ 22, pnpm
- OpenClaw installed globally

### Setup

```bash
docker compose up -d
openclaw onboard --install-daemon
openclaw gateway --port 18789
```

### Services
| Service | Port | Notes |
|---------|------|-------|
| WAI Backend | 3001 | Node.js, hot-reload in dev |
| WAI Dashboard | 3000 | Vite dev server |
| PostgreSQL | 5432 | Local Supabase-compatible |
| Supabase Realtime | 4000 | WebSocket subscriptions |
| OpenClaw Gateway | 18789 | Loopback only |

### Security in Phase 1
- All services on localhost only
- No internet exposure
- API keys in `.env` (gitignored)

---

## Phase 2: Hetzner VPS

**Goal:** WAI running 24/7 on a cloud server, accessible to Neb via Tailscale/SSH.

### Recommended Hetzner Server
- **Type:** CPX21 (3 vCPU, 4GB RAM) or CPX31 (4 vCPU, 8GB RAM)
- **OS:** Ubuntu 22.04 LTS
- **Location:** nbg1 (Nuremberg) or fsn1 (Falkenstein)

### Provisioning Steps

```bash
# 1. Create server on Hetzner Cloud Console
# 2. Add SSH key
# 3. SSH in
ssh root@<server-ip>

# 4. Install Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker ubuntu

# 5. Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# 6. Install pnpm + OpenClaw
npm install -g pnpm openclaw@latest

# 7. Install Tailscale (for secure remote access)
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up

# 8. Clone and configure WAI
git clone <repo> /opt/wai
cd /opt/wai
cp .env.example .env
# Edit .env with production values
nano .env

# 9. Start WAI
docker compose -f docker-compose.yml up -d
```

### Reverse Proxy (Nginx)

```bash
apt install -y nginx
# Copy config from infrastructure/nginx/nginx.conf
cp infrastructure/nginx/nginx.conf /etc/nginx/sites-available/wai
ln -s /etc/nginx/sites-available/wai /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

Dashboard accessible at `https://wai.yourdomain.com` (via Tailscale) or internal IP.

### Auto-restart on Boot

```bash
# Create systemd service for OpenClaw Gateway
cat > /etc/systemd/system/openclaw-gateway.service << 'EOF'
[Unit]
Description=OpenClaw Gateway
After=network.target

[Service]
Type=simple
User=ubuntu
ExecStart=/usr/bin/openclaw gateway --port 18789
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl enable openclaw-gateway
systemctl start openclaw-gateway
```

Docker Compose already handles auto-restart via `restart: unless-stopped`.

### Security in Phase 2
- Firewall: only 22 (SSH), 80, 443 open; all else blocked
- OpenClaw Gateway on loopback only
- Dashboard behind Nginx with Tailscale auth (or basic auth)
- All env vars set as system environment (not in .env on server)
- Fail2ban installed for SSH protection

---

## Phase 3: Personal Mini PC

**Goal:** WAI migrated to owned hardware for cost savings and full control.

### Recommended Hardware
- **Mini PC:** Intel NUC, Beelink Mini PC, or similar
- **RAM:** 16GB minimum, 32GB recommended
- **Storage:** 500GB SSD
- **OS:** Ubuntu 22.04 LTS or Ubuntu Server

### Optional: Proxmox

For isolation and easy VM management:
```bash
# Install Proxmox VE on mini PC
# Create VM: Ubuntu 22.04, 8GB RAM, 100GB disk
# Follow same steps as Hetzner VPS inside VM
```

### Migration Steps

```bash
# 1. Export DB from Hetzner
pg_dump $PROD_DATABASE_URL | gzip > wai-migration.sql.gz

# 2. Set up new server (same steps as Hetzner)

# 3. Import DB
gunzip -c wai-migration.sql.gz | psql $NEW_DATABASE_URL

# 4. Update DNS / Tailscale routes

# 5. Test all functionality

# 6. Decommission Hetzner server
```

### Home Network Setup
- Static local IP for mini PC (router DHCP reservation)
- Tailscale for remote access (no port forwarding needed)
- UPS (uninterruptible power supply) recommended for 24/7 uptime

---

## Environment Comparison

| Aspect | Local Dev | Hetzner VPS | Mini PC |
|--------|-----------|-------------|---------|
| Cost | €0/month | ~€10-20/month | ~€0/month (hardware owned) |
| Uptime | Dev only | 24/7 | 24/7 |
| Internet | Dev only | Yes | Via Tailscale |
| Backup | Manual | Hetzner snapshots | Manual + cloud |
| Scaling | No | Limited | No |
| Latency | Local | ~10ms | Local/remote |
