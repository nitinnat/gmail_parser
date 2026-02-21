#!/bin/bash
cd "$(dirname "$0")"

if [ -f /tmp/emailcollie-backend.pid ]; then
  kill "$(cat /tmp/emailcollie-backend.pid)" 2>/dev/null && echo "[emailcollie] backend stopped"
  rm /tmp/emailcollie-backend.pid
fi

if [ -f /tmp/emailcollie-tunnel.pid ]; then
  kill "$(cat /tmp/emailcollie-tunnel.pid)" 2>/dev/null && echo "[emailcollie] tunnel stopped"
  rm /tmp/emailcollie-tunnel.pid
fi
