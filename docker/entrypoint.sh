#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-full}"

# Copy the read-only bind mount into the container FS: host node_modules are
# host-glibc artifacts and must never be reused inside the image.
mkdir -p /work
tar -C /src \
    --exclude=./.git \
    --exclude=./node_modules \
    --exclude=./apps/web/node_modules \
    --exclude=./apps/web/build \
    -cf - . | tar -C /work -xf -
cd /work

pnpm install --frozen-lockfile --store-dir /pnpm-store

# Browsers land in the named volume; the OS packages they link against are
# container-local, so `--with-deps` runs every time. Re-downloading is skipped
# by Playwright when the volume already holds the browser.
pnpm exec playwright install --with-deps chromium

# Fresh checkouts have no apps/web/build; test_manifest_invariants.js requires it.
pnpm --filter konoha-web build

if [ "$MODE" = "lint" ]; then
  exec pnpm lint
fi

pnpm lint
pnpm test

# Fresh-install smoke, mirroring the workflow's final step.
export HOME=/tmp/konoha-smoke-home
mkdir -p "$HOME"
node bin/cli.js init --yes --no-project
node bin/cli.js migrate --skip-embeddings
node bin/cli.js version
