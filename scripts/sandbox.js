#!/usr/bin/env node
'use strict';

// Rule-12 sandbox: run the repo test suite inside a container so the host HOME,
// /tmp, node_modules, and working tree are never touched.
//
//   node scripts/sandbox.js                     # install + lint + full suite + smoke
//   node scripts/sandbox.js --lint              # fast path: install + lint only
//   node scripts/sandbox.js --no-build          # reuse the last built image
//   node scripts/sandbox.js --runtime container # apple/container instead of Docker
//
// KONOHA_SANDBOX_RUNTIME=docker|container selects the runtime; docker is the
// default. The two are never substituted for one another silently, because a
// green run has to name the engine that produced it.

const { spawnSync } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const IMAGE = 'konoha-sandbox:local';
const VOLUMES = ['konoha-sandbox-pnpm-store', 'konoha-sandbox-ms-playwright'];

// apple/container runs the same OCI image on Apple silicon macOS without Docker
// Desktop. It is still a Linux guest, so it reproduces this gate but not macOS
// host behaviour — that is what the macos-latest CI leg runs natively.
const RUNTIMES = {
  docker: {
    bin: 'docker',
    probe: ['info'],
    startHint: 'Start Docker Desktop or the docker service.',
    installHint: 'Install Docker Desktop or the docker package.',
    runArgs: () => []
  },
  container: {
    bin: 'container',
    probe: ['system', 'status'],
    startHint: 'Start the container services with: container system start',
    installHint: 'Install it from https://github.com/apple/container/releases (Apple silicon, macOS 26).',
    // Every container is a VM capped at 1 GiB by default; the suite runs four
    // workers plus Chromium, so it needs more. Docker inherits the daemon VM.
    runArgs: (env) => ['--memory', env.KONOHA_SANDBOX_MEMORY || '4g']
  }
};

function sandboxPlan(runtime, options = {}) {
  const spec = RUNTIMES[runtime];
  if (!spec) throw new Error(`unknown sandbox runtime: ${runtime}`);

  const root = options.repoRoot || repoRoot;
  const mode = options.mode || 'full';
  const steps = [];

  if (options.build !== false) {
    steps.push(['build', '-f', 'docker/sandbox.Dockerfile', '-t', IMAGE, '.']);
  }

  steps.push([
    'run', '--rm', ...spec.runArgs(options.env || process.env),
    '-v', `${root}:/src:ro`,
    '-v', `${VOLUMES[0]}:/pnpm-store`,
    '-v', `${VOLUMES[1]}:/ms-playwright`,
    '-e', 'HOME=/tmp/konoha-home',
    '-e', 'KONOHA_TEST_SANDBOX=1',
    '-e', 'KONOHA_SANDBOX_CONTAINER=1',
    '-e', 'KONOHA_TEST_PARALLEL=1',
    '-e', 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
    IMAGE, mode
  ]);

  return { runtime, ...spec, volumes: VOLUMES, steps };
}

function usage() {
  process.stderr.write('usage: node scripts/sandbox.js [--lint] [--no-build] [--runtime docker|container]\n');
  process.exit(2);
}

function parseArgs(argv) {
  let mode = 'full';
  let build = true;
  let runtime = process.env.KONOHA_SANDBOX_RUNTIME || 'docker';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue; // pnpm forwards the separator literally
    else if (arg === '--lint') mode = 'lint';
    else if (arg === '--no-build') build = false;
    else if (arg === '--runtime') runtime = argv[++i];
    else if (arg.startsWith('--runtime=')) runtime = arg.slice('--runtime='.length);
    else usage();
  }

  return { mode, build, runtime };
}

function main() {
  const { mode, build, runtime } = parseArgs(process.argv.slice(2));

  let plan;
  try {
    plan = sandboxPlan(runtime, { mode, build });
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    usage();
  }

  const call = (args, opts = {}) => spawnSync(plan.bin, args, { stdio: 'inherit', ...opts });

  const probe = call(plan.probe, { stdio: 'ignore' });
  if (probe.error && probe.error.code === 'ENOENT') {
    process.stderr.write(`The ${plan.runtime} CLI is not installed. ${plan.installHint}\n`);
    process.exit(1);
  }
  if (probe.status !== 0) {
    process.stderr.write(`The ${plan.runtime} runtime is not reachable. ${plan.startHint}\n`);
    process.exit(1);
  }

  if (plan.runtime === 'container') {
    // Creating an existing volume is an error and is ignored; a volume that is
    // genuinely missing makes the run below fail loudly.
    for (const volume of plan.volumes) {
      spawnSync(plan.bin, ['volume', 'create', volume], { stdio: 'ignore' });
    }
  }

  for (const [index, args] of plan.steps.entries()) {
    const result = call(args);
    if (result.status === 0) continue;

    if (index === plan.steps.length - 1) {
      process.stderr.write('Sandbox failed. Host working tree untouched; volumes kept for the next run.\n');
    }
    process.exit(result.status === null ? 1 : result.status);
  }
}

module.exports = { sandboxPlan, RUNTIMES, VOLUMES, IMAGE };

if (require.main === module) main();
