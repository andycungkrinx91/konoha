# ==============================================================================
# src/templates/akatsuki_lab/docker/Dockerfile
#
# Akatsuki Red-Team Lab Container Image (Docker Mode)
# Pinned Debian 12 base with approved security auditing tools.
# ==============================================================================

FROM debian:12-slim

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
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash -u 1000 akatsuki

USER akatsuki
WORKDIR /home/akatsuki

ENTRYPOINT ["tail", "-f", "/dev/null"]
