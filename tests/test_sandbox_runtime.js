#!/usr/bin/env node
'use strict';

// The sandbox can run on Docker or on Apple's `container`. The argv is the same
// on both, but the engine, its liveness probe, and its volume lifecycle differ,
// and a green run has to name the engine that produced it.

const assert = require('assert');
const path = require('path');
const { sandboxPlan, RUNTIMES, VOLUMES } = require('../scripts/sandbox');

const root = path.join('/tmp', 'konoha-sandbox-root');

const docker = sandboxPlan('docker', { repoRoot: root });
const apple = sandboxPlan('container', { repoRoot: root });

assert.strictEqual(docker.bin, 'docker');
assert.deepStrictEqual(docker.probe, ['info']);
assert.ok(/Docker/.test(docker.startHint), 'docker hint must name Docker');

assert.strictEqual(apple.bin, 'container');
assert.deepStrictEqual(apple.probe, ['system', 'status'], 'container is alive when its services answer');
assert.ok(/container system start/.test(apple.startHint), 'container hint must name the start command');
assert.ok(/apple\/container\/releases/.test(apple.installHint), 'a missing CLI must point at the installer');

assert.deepStrictEqual(apple.steps, docker.steps, 'one image, one entrypoint, one argument list');
assert.deepStrictEqual(Object.keys(RUNTIMES).sort(), ['container', 'docker']);

const [buildArgs, runArgs] = docker.steps;
assert.deepStrictEqual(buildArgs, ['build', '-f', 'docker/sandbox.Dockerfile', '-t', 'konoha-sandbox:local', '.']);

assert.deepStrictEqual(runArgs.slice(0, 2), ['run', '--rm']);
assert.ok(runArgs.includes(`${root}:/src:ro`), 'the repo must be read-only inside the container');
assert.ok(runArgs.includes(`${VOLUMES[0]}:/pnpm-store`));
assert.ok(runArgs.includes(`${VOLUMES[1]}:/ms-playwright`));
assert.ok(runArgs.includes('KONOHA_TEST_SANDBOX=1'), 'the guard marker must be set inside the container');
assert.strictEqual(runArgs[runArgs.length - 1], 'full', 'the default mode is the full gate');

const lintOnly = sandboxPlan('container', { repoRoot: root, mode: 'lint', build: false });
assert.strictEqual(lintOnly.steps.length, 1, '--no-build skips the image build');
assert.strictEqual(lintOnly.steps[0].at(-1), 'lint');

assert.throws(() => sandboxPlan('podman'), /unknown sandbox runtime/, 'an unlisted engine must not be guessed');

console.log('test_sandbox_runtime: PASS');
