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
LAB_SUBNET="${LAB_SUBNET:-10.77.77.0/24}"
LAB_GATEWAY="${LAB_GATEWAY:-10.77.77.1}"
LAB_ACL="${LAB_ACL:-lab-egress}"
ATTACKER_IMAGE="${ATTACKER_IMAGE:-images:debian/12}"

echo "[akatsuki-lab:lxc] Setting up isolated lab bridge ${LAB_BRIDGE}..."

if ! command -v lxc >/dev/null 2>&1; then
  echo "Error: lxc binary not found on host." >&2
  exit 1
fi

if lxc network show "${LAB_BRIDGE}" >/dev/null 2>&1; then
  echo "[akatsuki-lab:lxc] Bridge ${LAB_BRIDGE} already exists."
else
  lxc network create "${LAB_BRIDGE}" \
    ipv4.address="${LAB_GATEWAY}/24" \
    ipv4.nat=false \
    ipv4.dhcp=true \
    ipv4.firewall=true \
    ipv6.address=none \
    ipv6.nat=false
  echo "[akatsuki-lab:lxc] Bridge ${LAB_BRIDGE} created with ipv4.nat=false."
fi

if lxc network acl show "${LAB_ACL}" >/dev/null 2>&1; then
  echo "[akatsuki-lab:lxc] ACL ${LAB_ACL} already exists."
else
  lxc network acl create "${LAB_ACL}" || true
  lxc network acl rule add "${LAB_ACL}" egress action=allow destination="${LAB_SUBNET}" || true
  lxc network acl rule add "${LAB_ACL}" egress action=reject || true
  lxc network acl rule add "${LAB_ACL}" ingress action=allow || true
  echo "[akatsuki-lab:lxc] ACL ${LAB_ACL} configured for strict containment."
fi

lxc network set "${LAB_BRIDGE}" security.acls="${LAB_ACL}" || true
lxc network set "${LAB_BRIDGE}" security.acls.default.egress.action=reject || true
lxc network set "${LAB_BRIDGE}" security.acls.default.ingress.action=allow || true

echo "[akatsuki-lab:lxc] Provisioning sandbox container ${LAB_NAME}..."

if lxc info "${LAB_NAME}" >/dev/null 2>&1; then
  echo "[akatsuki-lab:lxc] Container ${LAB_NAME} already exists."
else
  lxc init "${ATTACKER_IMAGE}" "${LAB_NAME}" --network="${LAB_BRIDGE}"
  lxc config set "${LAB_NAME}" security.privileged=false || true
  lxc config set "${LAB_NAME}" security.idmap.isolated=true || true
  lxc config set "${LAB_NAME}" limits.memory="${ATTACKER_MEMORY:-2GiB}" || true
  lxc config set "${LAB_NAME}" limits.cpu="${ATTACKER_CPUS:-2}" || true
  echo "[akatsuki-lab:lxc] Container ${LAB_NAME} initialized."
fi

CURRENT_STATUS="$(lxc info "${LAB_NAME}" 2>/dev/null | grep -E '^Status:' | awk '{print $2}' || echo 'STOPPED')"
if [ "${CURRENT_STATUS}" != "RUNNING" ]; then
  lxc start "${LAB_NAME}"
  echo "[akatsuki-lab:lxc] Container ${LAB_NAME} started."
fi

if [ "${PROVISION_TOOLS:-false}" = "true" ]; then
  echo "[akatsuki-lab:lxc] Staging and executing toolchain provisioning scripts..."
  for s in provision-core.sh provision-msf.sh provision-exploitdb.sh provision-gotools.sh; do
    if [ -f "${SCRIPT_DIR}/${s}" ]; then
      lxc file push "${SCRIPT_DIR}/${s}" "${LAB_NAME}/tmp/${s}" || true
      lxc exec "${LAB_NAME}" -- bash "/tmp/${s}" || true
    fi
  done
fi

echo "[akatsuki-lab:lxc] Verified: ${LAB_NAME} running on isolated bridge ${LAB_BRIDGE}."
