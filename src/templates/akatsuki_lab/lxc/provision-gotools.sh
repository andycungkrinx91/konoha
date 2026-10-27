#!/usr/bin/env bash
set -u

echo "[akatsuki-provision:gotools] Installing ProjectDiscovery and Go security tools..."

export GOPATH=/root/go
export PATH=$PATH:/root/go/bin:/usr/local/go/bin

if command -v go >/dev/null 2>&1; then
  go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest || true
  go install -v github.com/projectdiscovery/httpx/cmd/httpx@latest || true
  go install -v github.com/projectdiscovery/katana/cmd/katana@latest || true
  go install -v github.com/ffuf/ffuf/v2@latest || true
fi

# Symlink into /usr/local/bin
for b in nuclei httpx katana ffuf feroxbuster; do
  if [ -f "/root/go/bin/${b}" ] && [ ! -f "/usr/local/bin/${b}" ]; then
    ln -sf "/root/go/bin/${b}" "/usr/local/bin/${b}" || true
  fi
done

# Python tools via pipx
if command -v pipx >/dev/null 2>&1; then
  pipx install droopescan 2>/dev/null || true
  pipx install sqlmap 2>/dev/null || true
fi

# Ruby tools
if command -v gem >/dev/null 2>&1; then
  gem install wpscan --no-document 2>/dev/null || true
fi

# Additional tool symlinks and packages
if ! command -v feroxbuster >/dev/null 2>&1; then
  apt-get install -y feroxbuster 2>/dev/null || true
fi
if [ -f "/usr/bin/testssl.sh" ] && [ ! -f "/usr/local/bin/testssl" ]; then
  ln -sf /usr/bin/testssl.sh /usr/local/bin/testssl || true
fi
if [ -f "/usr/bin/zaproxy" ] && [ ! -f "/usr/local/bin/zap" ]; then
  ln -sf /usr/bin/zaproxy /usr/local/bin/zap || true
fi

echo "[akatsuki-provision:gotools] Go and web tools provisioning complete."
