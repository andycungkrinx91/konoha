#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="${SCRIPT_DIR}/lab.conf"
if [ -f "${CONF}" ]; then
  # shellcheck source=lab.conf
  . "${CONF}"
fi

LAB_NAME="${LAB_NAME:-akatsuki-lab}"
LAB_BRIDGE="${LAB_BRIDGE:-labbr0}"
LAB_ACL="${LAB_ACL:-lab-egress}"

echo "[akatsuki-lab:lxc] Tearing down Akatsuki Red-Team Lab..."

if ! command -v lxc >/dev/null 2>&1; then
  echo "Error: lxc binary not found on host." >&2
  exit 1
fi

if lxc list --format=csv -c n | grep -qx "${LAB_NAME}"; then
  if [ "$(lxc list "^${LAB_NAME}$" --format=csv -c s)" = "RUNNING" ]; then
    echo "[akatsuki-lab:lxc] Stopping container ${LAB_NAME}..."
    lxc stop "${LAB_NAME}" --force || true
  fi
  echo "[akatsuki-lab:lxc] Container ${LAB_NAME} stopped."
fi

echo "[akatsuki-lab:lxc] Teardown complete. Residual processes stopped."
