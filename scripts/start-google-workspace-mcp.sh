#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Create it from .env.example first." >&2
  exit 1
fi

set -a
source "${ENV_FILE}"
set +a

required_vars=(
  GOOGLE_OAUTH_CLIENT_ID
  GOOGLE_OAUTH_CLIENT_SECRET
)

missing=()
for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    missing+=("${var_name}")
  fi
done

if [[ "${#missing[@]}" -gt 0 ]]; then
  echo "Missing required env vars: ${missing[*]}" >&2
  echo "Fill them in .env, then rerun this script." >&2
  exit 1
fi

if ! command -v uvx >/dev/null 2>&1; then
  echo "uvx is not installed. Install uv first: https://docs.astral.sh/uv/" >&2
  exit 1
fi

export WORKSPACE_MCP_PORT="${WORKSPACE_MCP_PORT:-8000}"
raw_base_uri="${WORKSPACE_MCP_BASE_URI:-http://127.0.0.1}"
normalized_base_uri="$(printf '%s' "${raw_base_uri%/}" | sed -E 's#^(https?://[^/:]+):[0-9]+$#\1#')"

export PORT="${WORKSPACE_MCP_PORT}"
export WORKSPACE_MCP_BASE_URI="${normalized_base_uri:-http://127.0.0.1}"
export GOOGLE_OAUTH_REDIRECT_URI="${GOOGLE_OAUTH_REDIRECT_URI:-${WORKSPACE_MCP_BASE_URI}:${WORKSPACE_MCP_PORT}/oauth2callback}"
export MCP_ENABLE_OAUTH21="${MCP_ENABLE_OAUTH21:-true}"
export MCP_SINGLE_USER_MODE="${MCP_SINGLE_USER_MODE:-true}"
export OAUTHLIB_INSECURE_TRANSPORT="${OAUTHLIB_INSECURE_TRANSPORT:-1}"

echo "Starting Google Workspace MCP on ${WORKSPACE_MCP_BASE_URI}:${WORKSPACE_MCP_PORT}/mcp"
echo "Enabled tools: gmail, drive, calendar"

exec uvx workspace-mcp --transport streamable-http --tools gmail drive calendar
