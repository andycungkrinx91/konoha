#!/usr/bin/env sh
# Konoha konoha-files MCP launcher — resolves node when nvm paths are unavailable in IDE sandboxes.
set -eu
DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
SCRIPT="$DIR/file_tools_mcp.js"

NODE="${KONOHA_NODE:-}"
if [ -z "$NODE" ] && [ -f "$DIR/.node_exec_path" ]; then
  NODE="$(tr -d '\r\n' < "$DIR/.node_exec_path")"
fi
if [ -z "$NODE" ]; then
  NODE="$(command -v node 2>/dev/null || true)"
fi
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
  echo "[konoha-files] node executable not found (set KONOHA_NODE or run konoha doctor --yes)" >&2
  exit 127
fi

if [ ! -f "$SCRIPT" ]; then
  echo "[konoha-files] missing $SCRIPT — run konoha init" >&2
  exit 1
fi

exec "$NODE" "$SCRIPT"
