#!/usr/bin/env node
'use strict';

// Rule-12 sandbox: run the repo test suite inside a container so the host HOME,
// /tmp, node_modules, and working tree are never touched.
//
//   node scripts/sandbox.js            # install + lint + full suite + smoke
//   node scripts/sandbox.js --lint     # fast path: install + lint only
//   node scripts/sandbox.js --no-build # reuse the last built image

const { spawnSync } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const IMAGE = 'konoha-sandbox:local';

function usage() {
  process.stderr.write('usage: node scripts/sandbox.js [--lint] [--no-build]\n');
  process.exit(2);
}

const argv = process.argv.slice(2);
let mode = 'full';
let build = true;
for (const arg of argv) {
  if (arg === '--') continue; // pnpm forwards the separator literally
  else if (arg === '--lint') mode = 'lint';
  else if (arg === '--no-build') build = false;
  else usage();
}

const docker = (args, opts = {}) => spawnSync('docker', args, { stdio: 'inherit', ...opts });

if (docker(['info'], { stdio: 'ignore' }).status !== 0) {
  process.stderr.write('Docker daemon is not reachable. Start Docker Desktop or the docker service.\n');
  process.exit(1);
}

if (build) {
  const built = docker(['build', '-f', 'docker/sandbox.Dockerfile', '-t', IMAGE, '.']);
  if (built.status !== 0) process.exit(built.status === null ? 1 : built.status);
}

const run = docker([
  'run', '--rm',
  '-v', `${repoRoot}:/src:ro`,
  '-v', 'konoha-sandbox-pnpm-store:/pnpm-store',
  '-v', 'konoha-sandbox-ms-playwright:/ms-playwright',
  '-e', 'HOME=/tmp/konoha-home',
  '-e', 'KONOHA_TEST_SANDBOX=1',
  '-e', 'KONOHA_TEST_PARALLEL=1',
  '-e', 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
  IMAGE, mode,
]);

if (run.status !== 0) {
  process.stderr.write('Sandbox failed. Host working tree untouched; volumes kept for the next run.\n');
  process.exit(run.status === null ? 1 : run.status);
}
