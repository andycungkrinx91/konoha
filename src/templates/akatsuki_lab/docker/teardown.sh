#!/usr/bin/env bash
set -euo pipefail

LAB_NAME="${LAB_NAME:-akatsuki-lab}"

echo "[akatsuki-lab:docker] Tearing down Akatsuki Red-Team Lab..."

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker binary not found on host." >&2
  exit 1
fi

if docker inspect "${LAB_NAME}" >/dev/null 2>&1; then
  echo "[akatsuki-lab:docker] Stopping container ${LAB_NAME}..."
  docker stop "${LAB_NAME}" || true
  echo "[akatsuki-lab:docker] Container ${LAB_NAME} stopped."
fi

echo "[akatsuki-lab:docker] Teardown complete. Container stopped and host network untouched."
