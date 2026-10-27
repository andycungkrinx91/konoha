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

if [ -f /opt/metasploit-framework/bin/msfconsole ] && [ ! -f /usr/local/bin/msfconsole ]; then
  ln -sf /opt/metasploit-framework/bin/msfconsole /usr/local/bin/msfconsole || true
fi
if [ -f /opt/metasploit-framework/bin/msfvenom ] && [ ! -f /usr/local/bin/msfvenom ]; then
  ln -sf /opt/metasploit-framework/bin/msfvenom /usr/local/bin/msfvenom || true
fi

echo "[akatsuki-provision:msf] Metasploit and msfvenom provisioning complete."
