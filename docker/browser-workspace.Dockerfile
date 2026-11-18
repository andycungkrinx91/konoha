# Konoha Live Headed Browser Workspace — Isolated Xvfb + x11vnc + noVNC + Playwright Chromium.
# Never mounts host home directories, personal browser profiles, konoha.db, or secrets.
FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    SCREEN_WIDTH=1440 \
    SCREEN_HEIGHT=900 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      xvfb \
      x11vnc \
      fluxbox \
      novnc \
      websockify \
      procps \
      fonts-liberation \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/konoha-browser
RUN npm install --no-save --no-audit --no-fund playwright@1.64.1 \
 && npx playwright install --with-deps chromium \
 && npm cache clean --force

COPY src/workflow/qa-automation/browser_container_agent.js /opt/konoha-browser/browser_container_agent.js
COPY docker/browser-workspace-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
 && mkdir -p /workspace /artifacts /tmp/konoha-artifacts \
 && useradd --create-home --shell /bin/bash konohabrowser \
 && chown -R konohabrowser:konohabrowser /opt/konoha-browser /artifacts /tmp/konoha-artifacts /ms-playwright

USER konohabrowser
EXPOSE 6080

ENTRYPOINT ["/entrypoint.sh"]
