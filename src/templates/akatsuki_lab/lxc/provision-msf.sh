#!/usr/bin/env bash
set -u

echo "[akatsuki-provision:msf] Setting up Metasploit Framework and PostgreSQL..."

if ! command -v msfconsole >/dev/null 2>&1 && [ ! -f /opt/metasploit-framework/bin/msfconsole ]; then
  echo "[akatsuki-provision:msf] Installing Metasploit omnibus..."
  curl -sSL https://raw.githubusercontent.com/rapid7/metasploit-omnibus/master/config/templates/metasploit-framework-wrappers/msfupdate.erb > /tmp/msfinstall
  chmod 755 /tmp/msfinstall
  /tmp/msfinstall || true
  rm -f /tmp/msfinstall
fi

systemctl start postgresql 2>/dev/null || service postgresql start 2>/dev/null || true
if command -v msfdb >/dev/null 2>&1; then
  msfdb init --non-interactive 2>/dev/null || true
fi

echo "[akatsuki-provision:msf] Metasploit provisioning complete."
