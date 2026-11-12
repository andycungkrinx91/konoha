# Konoha test sandbox — the rule-12 clean room. Never used for production.
FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git tar xz-utils ffmpeg \
 && rm -rf /var/lib/apt/lists/*

# Debian bookworm ffmpeg must expose the animated-WebP encoder: the workflow
# enforces the same invariant, and the document-animation suites depend on it.
RUN ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libwebp_anim \
 || (echo "ffmpeg lacks libwebp_anim; see docs/CI.md#container-sandbox-rule-12" >&2; exit 1)

RUN corepack enable && corepack prepare pnpm@12.16.1 --activate

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /work
ENTRYPOINT ["/entrypoint.sh"]
CMD ["full"]
