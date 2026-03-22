# WAI — Wawen Autonomous Industries

Dual OS: Business agent platform + Personal assistant for Neb.

→ Docs: [docs/INDEX.md](docs/INDEX.md) | Status: [docs/PROJECT_TRACKING.md](docs/PROJECT_TRACKING.md)

---

## Avvio servizi

| Servizio | Porta | Comando | Note |
|---|---|---|---|
| **LiteLLM** | 4000 | `sg docker -c "docker compose up litellm -d"` | Deve partire per primo |
| **Backend** | 3001 | `cd backend && pnpm dev` | Node.js + Telegram bot |
| **Dashboard** | 3000 | `cd dashboard && pnpm dev` | React + Vite |
| **Google Workspace MCP** | — | `./scripts/start-google-workspace-mcp.sh` | Gmail / Calendar / Drive |
| **PinchTab** | 9867 | `pinchtab server` | Browser automation — richiede Chrome installato |

### Ordine consigliato

```
1. LiteLLM     (docker)
2. Backend     (pnpm dev)
3. Dashboard   (pnpm dev)
4. Google MCP  (script)  ← solo se usi Gmail/Calendar/Drive
5. PinchTab    (server)  ← solo se usi browser tools
```

### WhatsApp

Al primo avvio del backend, se `WHATSAPP_ENABLED=true`, scansiona il QR code che appare nei log con WhatsApp → Dispositivi collegati → Collega un dispositivo.

---

## Variabili d'ambiente richieste

File `.env` nella root del backend. Variabili minime:

```
LITELLM_BASE_URL=http://localhost:4000/v1
LITELLM_API_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_FOUNDER_CHAT_ID=...
PINCHTAB_BASE_URL=http://127.0.0.1:9867
PINCHTAB_TOKEN=...
```

---

## Comandi utili

```bash
# Typecheck
cd backend && pnpm typecheck
cd dashboard && pnpm typecheck

# Verifica PinchTab
curl -s -H "Authorization: Bearer $PINCHTAB_TOKEN" http://127.0.0.1:9867/health

# Verifica LiteLLM
curl http://localhost:4000/health
```
