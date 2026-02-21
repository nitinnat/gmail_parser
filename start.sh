#!/bin/bash
set -e
cd "$(dirname "$0")"

# Load env vars if .env exists
if [ -f .env ]; then set -a; source .env; set +a; fi

echo "[emailcollie] starting backend..."
poetry run uvicorn api.main:app --port 8000 --host 127.0.0.1 --proxy-headers --forwarded-allow-ips=127.0.0.1 > /tmp/emailcollie-backend.log 2>&1 &
echo $! > /tmp/emailcollie-backend.pid

echo "[emailcollie] starting tunnel..."
cloudflared tunnel run emailcollie > /tmp/emailcollie-tunnel.log 2>&1 &
echo $! > /tmp/emailcollie-tunnel.pid

echo "[emailcollie] live at https://emailcollie.nitinnataraj.com"
