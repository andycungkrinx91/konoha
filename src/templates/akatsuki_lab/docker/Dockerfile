# ==============================================================================
# src/templates/akatsuki_lab/docker/Dockerfile
#
# Akatsuki Red-Team Lab Container Image (Docker Mode)
# Kali Linux base with curated professional security toolchain.
# ==============================================================================

FROM kalilinux/kali-rolling:latest

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    iproute2 \
    dnsutils \
    nmap \
    tshark \
    procps \
    net-tools \
    sqlmap \
    nikto \
    hydra \
    whatweb \
    exploitdb \
    seclists \
    metasploit-framework \
    burpsuite \
    feroxbuster \
    wpscan \
    testssl.sh \
    zaproxy \
    trivy \
    python3 \
    python3-pip \
    pipx \
    postgresql \
    golang \
    git \
    && rm -rf /var/lib/apt/lists/*

ENV GOPATH=/root/go
ENV PATH=$PATH:/root/go/bin:/usr/local/go/bin:/root/.local/bin
RUN go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest && \
    go install -v github.com/projectdiscovery/httpx/cmd/httpx@latest && \
    go install -v github.com/projectdiscovery/katana/cmd/katana@latest && \
    go install -v github.com/ffuf/ffuf/v2@latest && \
    pipx install droopescan 2>/dev/null || true

# Symlink aliases so all default tools resolve predictably
RUN for b in nuclei httpx katana ffuf feroxbuster; do \
      [ -f "/root/go/bin/$b" ] && ln -sf "/root/go/bin/$b" "/usr/local/bin/$b" || true; \
    done && \
    ( [ -f "/usr/bin/testssl.sh" ] && ln -sf "/usr/bin/testssl.sh" "/usr/local/bin/testssl" || true ) && \
    ( [ -f "/usr/bin/zaproxy" ] && ln -sf "/usr/bin/zaproxy" "/usr/local/bin/zap" || true )

RUN useradd -m -s /bin/bash -u 1000 akatsuki

WORKDIR /root
ENTRYPOINT ["tail", "-f", "/dev/null"]
