#!/usr/bin/env bash
set -euo pipefail

if [ -z "${KONOHA_VNC_PASSWORD:-}" ]; then
  echo "[konoha-browser] FATAL: KONOHA_VNC_PASSWORD is required (refusing unauthenticated VNC)." >&2
  exit 1
fi

WIDTH="${SCREEN_WIDTH:-1440}"
HEIGHT="${SCREEN_HEIGHT:-900}"
VNC_PASS_FILE="/tmp/konoha_vnc_passwd"
SESSION_TAG="${KONOHA_BROWSER_SESSION_ID:-default}"
PROFILE_DIR="/tmp/pw-profile-${SESSION_TAG}"
mkdir -p "$PROFILE_DIR" /tmp/konoha-artifacts

x11vnc -storepasswd "$KONOHA_VNC_PASSWORD" "$VNC_PASS_FILE" >/dev/null 2>&1
chmod 600 "$VNC_PASS_FILE"
unset KONOHA_VNC_PASSWORD

Xvfb :99 -screen 0 "${WIDTH}x${HEIGHT}x24" -ac -nolisten tcp >/tmp/xvfb.log 2>&1 &
XVFB_PID=$!

for _ in $(seq 1 30); do
  if [ -S /tmp/.X11-unix/X99 ]; then
    break
  fi
  sleep 0.2
done

fluxbox >/tmp/fluxbox.log 2>&1 &
FLUXBOX_PID=$!

x11vnc -display :99 -rfbport 5900 -rfbauth "$VNC_PASS_FILE" -localhost -shared -forever -noxdamage >/tmp/x11vnc.log 2>&1 &
VNC_PID=$!

websockify --web=/usr/share/novnc 0.0.0.0:6080 127.0.0.1:5900 >/tmp/novnc.log 2>&1 &
NOVNC_PID=$!

cleanup() {
  rm -f "$VNC_PASS_FILE" /tmp/konoha-browser-agent.sock
  kill -TERM "${AGENT_PID:-}" "$NOVNC_PID" "$VNC_PID" "$FLUXBOX_PID" "$XVFB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

node /opt/konoha-browser/browser_container_agent.js --serve --profile-dir "$PROFILE_DIR" &
AGENT_PID=$!
wait "$AGENT_PID"
