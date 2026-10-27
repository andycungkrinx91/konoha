#!/usr/bin/env bash
set -u

echo "[akatsuki-provision:core] Installing core security assessment packages..."
export DEBIAN_FRONTEND=noninteractive

apt-get update -y || true
apt-get install -y --no-install-recommends \
  build-essential \
  libpcap-dev \
  postgresql \
  nmap \
  sqlite3 \
  golang \
  python3 \
  python3-pip \
  pipx \
  ruby \
  ruby-dev \
  php-cli \
  curl \
  dnsutils \
  netcat-openbsd \
  tcpdump \
  git \
  ca-certificates \
  procps \
  net-tools || true

echo "[akatsuki-provision:core] Core packages installed."
