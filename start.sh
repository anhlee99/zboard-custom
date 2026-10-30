#!/usr/bin/env bash
# Start ZBoard on WSL, Linux or macOS: check Node, install, build the web app, start the server.
set -euo pipefail
cd "$(dirname "$0")"

need=22.13.0
if ! command -v node >/dev/null 2>&1; then
  echo "ZBoard needs Node.js $need or newer (https://nodejs.org, or nvm install 22)." >&2
  exit 1
fi
have=$(node -p 'process.versions.node')
if [ "$(printf '%s\n%s\n' "$need" "$have" | sort -V | head -1)" != "$need" ]; then
  echo "Node $have is too old: ZBoard needs $need or newer (for node:sqlite)." >&2
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Set APP_PASSWORD in it, then run ./start.sh again."
  exit 1
fi
if grep -qE '^APP_PASSWORD=(change-me)?[[:space:]]*$' .env; then
  echo "Set APP_PASSWORD in .env first (it is empty or still change-me)." >&2
  exit 1
fi

echo "Installing server packages…"
(cd server && npm ci --no-audit --no-fund --loglevel=error)
echo "Installing and building the web app…"
(cd web && npm ci --no-audit --no-fund --loglevel=error && npm run build --silent >/dev/null)

port=$(sed -n 's/^PORT=//p' .env | tr -d '[:space:]')
port=${port:-3000}
ip=$( (hostname -I 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || true) | awk '{print $1}')
echo
echo "ZBoard on http://localhost:$port"
[ -n "$ip" ] && echo "On your network: http://$ip:$port"
if grep -qi microsoft /proc/version 2>/dev/null; then
  echo "(WSL: phones reach it through Windows' own address; see README → Phone and other devices.)"
fi
echo

cd server
exec node --disable-warning=ExperimentalWarning --env-file=../.env src/index.js
