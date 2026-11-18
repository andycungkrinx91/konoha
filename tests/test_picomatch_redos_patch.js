#!/usr/bin/env node
'use strict';

// GHSA-fc5q-39xc-vjpf: picomatch <= 4.0.7 compiles a repeated extglob whose body
// holds a bare wildcard (`+(*a)`, `*(*a)`, `+(*)`) into nested unbounded
// quantifiers and backtracks exponentially on a short crafted string.
// patches/picomatch@4.0.7.patch makes analyzeRepeatedExtglob treat those bodies
// as risky, so they emit literal text instead. Upstream has no release past
// 4.0.7, so the dependency stays pinned and pnpm audit keeps reporting it;
// test_socket_security_audit.js pins the audit's advisory set to exactly this
// one entry rather than ignoring it.

const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'apps', 'web');

console.log('Running test_picomatch_redos_patch: patched picomatch repeated-extglob ReDoS...');

// --- 1. Consumers resolve the patched build, not a pristine 4.0.7 -----------
let picomatchPath;
try {
  const viteManifest = require.resolve('vite/package.json', { paths: [WEB] });
  picomatchPath = require.resolve('picomatch', { paths: [path.dirname(viteManifest)] });
} catch (err) {
  console.error(`picomatch must be installed for apps/web (run pnpm install): ${err.message}`);
  process.exit(1);
}
assert.ok(
  /picomatch@4\.0\.7_patch_hash=/.test(picomatchPath),
  `vite must resolve the patched picomatch build, got ${picomatchPath}`
);
const pm = require(picomatchPath);
console.log('  ok   vite resolves the patched picomatch build');

// --- 2. Pathological extglobs terminate (child process: a miss must not hang) -
// Stock 4.0.7 needs minutes at this input length, so the probe runs isolated
// with a hard timeout instead of stalling the suite.
const PROBE = `
const pm = require(${JSON.stringify(picomatchPath)});
const cases = [['+(*a)', 'a'.repeat(40) + '!'], ['*(*a)', 'a'.repeat(40) + '!'], ['+(*)', 'a'.repeat(40) + '/']];
process.stdout.write(JSON.stringify(cases.map(([glob, input]) => {
  const started = Date.now();
  const matched = pm(glob)(input);
  return { glob, matched, ms: Date.now() - started };
})));
`;
const probe = spawnSync(process.execPath, ['-e', PROBE], { encoding: 'utf8', timeout: 10000 });
assert.strictEqual(
  probe.error,
  undefined,
  `patched picomatch must not hang on pathological extglobs: ${probe.error && probe.error.message}`
);
assert.strictEqual(probe.status, 0, `probe failed: ${probe.stderr || probe.signal}`);
const timings = JSON.parse(probe.stdout);
for (const { glob, matched, ms } of timings) {
  assert.strictEqual(matched, false, `${glob} must not match a crafted non-matching input`);
  assert.ok(ms < 500, `${glob} took ${ms} ms, which means the ReDoS guard is gone`);
}
console.log(`  ok   pathological extglobs terminate in ${timings.map((t) => `${t.ms}ms`).join(', ')}`);

// --- 3. Realistic globs keep their semantics ---------------------------------
const globs = [
  ['**/*.js', 'src/a/b.js', true],
  ['src/**/*.js', 'src/a/b.js', true],
  ['src/**/*.js', 'lib/a/b.js', false],
  ['**/node_modules/**', 'x/node_modules/y/index.js', true],
  ['*.{ts,tsx}', 'main.tsx', true],
  ['*.{ts,tsx}', 'main.js', false],
  ['+(a|b)', 'a', true],
  ['+(a|b)', 'ab', true],
  ['+(a|b)', 'c', false],
  ['@(x|y)', 'y', true],
  ['@(x|y)', 'z', false],
  ['!(foo)', 'bar', true],
  ['?(a)b', 'b', true],
  ['?(a)b', 'ab', true],
  ['*(a)', 'aaa', true],
  ['**/*.svelte', 'src/App.svelte', true],
  ['.svelte-kit/**', '.svelte-kit/output/x', true],
  ['!(node_modules)/**', 'src/x.js', true],
  ['+(src|lib)/**', 'src/x.js', true],
  ['@(src|lib)/**/*.js', 'lib/x/y.js', true]
];
for (const [glob, input, expected] of globs) {
  assert.strictEqual(pm(glob)(input), expected, `${glob} must ${expected ? '' : 'not '}match ${input}`);
}
console.log(`  ok   ${globs.length} realistic globs unchanged`);

console.log('\nAll test_picomatch_redos_patch checks passed successfully!');
