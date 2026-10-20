# Konoha MCP Orchestrator — Production Docker Container (v2.2.4)
FROM node:22-slim AS base

ENV NODE_ENV=production \
    PORT=1404 \
    HOST=0.0.0.0 \
    KONOHA_DOCKER=1

WORKDIR /app

# Enable corepack and activate pnpm@10
RUN corepack enable && corepack prepare pnpm@10.8.0 --activate

# Copy dependency manifests and install scripts
COPY package.json pnpm-lock.yaml ./
COPY bin ./bin

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile
COPY src ./src
COPY apps/web/build ./apps/web/build
COPY apps/web/package.json ./apps/web/package.json
COPY assets ./assets
COPY .agents ./.agents
COPY README.md LICENSE ./

# Pre-seed runtime layout in /home/node/.konoha
RUN mkdir -p /home/node/.konoha/apps/web && \
    cp -r /app/bin /home/node/.konoha/bin && \
    cp -r /app/src /home/node/.konoha/src && \
    cp -r /app/assets /home/node/.konoha/assets && \
    cp -r /app/.agents /home/node/.konoha/.agents && \
    cp -r /app/apps/web/build /home/node/.konoha/apps/web/build && \
    cp /app/apps/web/package.json /home/node/.konoha/apps/web/package.json && \
    ln -s /app/node_modules /home/node/.konoha/node_modules && \
    chown -R node:node /home/node

USER node
ENV HOME=/home/node

# Seed SQLite database with canonical skills (fast migration)
RUN node bin/cli.js migrate --skip-embeddings

EXPOSE 1404 19999

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:1404/api/v1/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

ENTRYPOINT ["node", "bin/cli.js"]
CMD ["web"]
