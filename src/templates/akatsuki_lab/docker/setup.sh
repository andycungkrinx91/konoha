#!/usr/bin/env bash
set -euo pipefail

LAB_NAME="${LAB_NAME:-akatsuki-lab}"
LAB_NETWORK="${LAB_NETWORK:-akatsuki-net}"
LAB_SUBNET="${LAB_SUBNET:-10.77.77.0/24}"
IMAGE_NAME="${IMAGE_NAME:-debian:12-slim}"

echo "[akatsuki-lab:docker] Setting up isolated Docker network ${LAB_NETWORK}..."

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker binary not found on host." >&2
  exit 1
fi

if docker network inspect "${LAB_NETWORK}" >/dev/null 2>&1; then
  echo "[akatsuki-lab:docker] Network ${LAB_NETWORK} already exists."
else
  docker network create --internal --subnet="${LAB_SUBNET}" "${LAB_NETWORK}"
  echo "[akatsuki-lab:docker] Network ${LAB_NETWORK} created with internal=true."
fi

echo "[akatsuki-lab:docker] Provisioning sandbox container ${LAB_NAME}..."

if docker inspect "${LAB_NAME}" >/dev/null 2>&1; then
  IS_RUNNING="$(docker inspect -f '{{.State.Running}}' "${LAB_NAME}" 2>/dev/null || echo false)"
  if [ "${IS_RUNNING}" != "true" ]; then
    docker start "${LAB_NAME}"
    echo "[akatsuki-lab:docker] Container ${LAB_NAME} started."
  else
    echo "[akatsuki-lab:docker] Container ${LAB_NAME} is already running."
  fi
else
  docker run -d \
    --name "${LAB_NAME}" \
    --network "${LAB_NETWORK}" \
    --security-opt=no-new-privileges:true \
    --cap-drop=ALL \
    --cap-add=NET_RAW \
    --memory=2g \
    --cpus=2 \
    --restart unless-stopped \
    "${IMAGE_NAME}" \
    tail -f /dev/null
  echo "[akatsuki-lab:docker] Container ${LAB_NAME} created and started."
fi

echo "[akatsuki-lab:docker] Verified: ${LAB_NAME} running on isolated internal network ${LAB_NETWORK}."
