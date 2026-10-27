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
    postgresql \
    golang \
    git \
    && rm -rf /var/lib/apt/lists/*

ENV GOPATH=/root/go
ENV PATH=$PATH:/root/go/bin:/usr/local/go/bin
RUN go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest && \
    go install -v github.com/projectdiscovery/httpx/cmd/httpx@latest && \
    go install -v github.com/projectdiscovery/katana/cmd/katana@latest && \
    go install -v github.com/ffuf/ffuf/v2@latest

RUN useradd -m -s /bin/bash -u 1000 akatsuki

WORKDIR /root
ENTRYPOINT ["tail", "-f", "/dev/null"]
