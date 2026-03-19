# MCP Setup

## Goal

Configure WAI to use a local Google Workspace MCP server for:

- Gmail
- Google Calendar
- Google Drive

The WAI repo already supports:

- MCP connector discovery in `.mcp.json`
- MCP status visibility in Personal HQ
- local HTTP MCP endpoint registration
- backend OAuth callback handling on port `3001`
- Google Workspace runtime status + tool discovery

What is still needed is one-time Google authorization from WAI after both servers are running.

## 1. Create Google Cloud credentials

In Google Cloud Console:

1. Create or choose a project.
2. Enable these APIs:
   - Gmail API
   - Google Calendar API
   - Google Drive API
3. Configure the OAuth consent screen.
4. Create an OAuth client ID.

For this local MCP setup, use a redirect URI matching the local callback server:

- `http://127.0.0.1:8000/oauth2callback`

## 2. Fill `.env`

Add these values to `.env`:

```env
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
USER_GOOGLE_EMAIL=rad.nebili@gmail.com
WORKSPACE_MCP_PORT=8000
WORKSPACE_MCP_BASE_URI=http://127.0.0.1
GOOGLE_OAUTH_REDIRECT_URI=http://127.0.0.1:8000/oauth2callback
MCP_ENABLE_OAUTH21=true
MCP_SINGLE_USER_MODE=true
OAUTHLIB_INSECURE_TRANSPORT=1
```

## 3. Start the local MCP server

Use the helper script:

```bash
./scripts/start-google-workspace-mcp.sh
```

If `uvx` is missing, install `uv` first.

## 4. Register the server in `.mcp.json`

The repo is already configured to look for a local MCP HTTP server at:

- `http://127.0.0.1:8000/mcp`

## 5. Start WAI backend

Run the backend so the OAuth callback exists:

```bash
cd backend
pnpm dev
```

WAI must be reachable on:

- `http://127.0.0.1:3001`

## 6. Complete Google auth from WAI

You now have two options:

### Option A — Dashboard

1. Open Personal mode in the dashboard.
2. Go to `Assistant HQ`.
3. In the `Google Workspace Runtime` card, click `Start Google Auth`.
4. Complete the Google login/consent flow in the browser popup.
5. Wait for the callback page to show `Google Workspace MCP connected`.

### Option B — Terminal

```bash
curl -X POST http://127.0.0.1:3001/api/mcp/google-workspace/auth/start
```

Open the returned `authorizationUrl` in your browser and complete the flow.

## 7. Expected result

After auth is completed:

- Personal HQ should show `Gmail`, `Google Calendar`, and `Google Drive` as configured
- `GET /api/mcp/status` should report the Google Workspace MCP connector as ready
- `GET /api/mcp/google-workspace/runtime` should report:
  - `state: "connected"`
  - `toolCount > 0`
- CEO Intake can use:
  - `gmail_inbox_summary`
  - `calendar_today`

## 8. What we do next in WAI

Once this is up:

1. keep Gmail + Calendar + Drive founder actions active
2. expose high-frequency founder actions directly in `Assistant HQ`
3. add recurring/scheduled automations on top of the same MCP layer

## 9. Founder actions currently live

After Google Workspace MCP is connected, CEO Intake can already use:

- `gmail_inbox_summary`
- `gmail_latest_message`
- `calendar_today`
- `drive_find_file`
- `drive_read_file`
- `drive_recent_files`
- `daily_founder_brief`

## 10. Assistant HQ quick actions

Once the runtime is `connected`, the dashboard `Assistant HQ` can trigger these founder actions directly:

- `Latest Email`
- `Today Agenda`
- `Recent Drive Files`
- `Daily Founder Brief`

These buttons call the local backend endpoint `POST /api/personal/assistant/quick-action`, which reuses the CEO Intake routing instead of maintaining a second MCP execution path in the dashboard.
