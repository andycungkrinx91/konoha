#!/usr/bin/env node
'use strict';

/**
 * Keeps every test/lint entry point on the RTK path and proves the wrapper picks
 * the compressing subcommand (`rtk test` for suites, `rtk err` for lint) while
 * staying transparent: same exit codes, real output, loud fallback without RTK.
 */

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WRAPPER = path.join(ROOT, 'scripts', 'rtk_exec.js');
const NOISY = path.join(ROOT, 'tests', 'fixtures', 'rtk_exec_noisy.js');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const { resolveRtkCommand, resolveRtkMode, buildInvocation } = require(WRAPPER);

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function runWrapper(args, env) {
  return spawnSync(process.execPath, [WRAPPER, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    env: { ...process.env, ...env },
    maxBuffer: 32 * 1024 * 1024
  });
}

test('every test and lint npm script routes through the RTK wrapper', () => {
  const routeable = Object.entries(pkg.scripts).filter(
    ([name]) => name === 'lint' || name.startsWith('test')
  );
  assert.ok(routeable.length >= 8, `expected the test/lint scripts, found ${routeable.length}`);
  for (const [name, cmd] of routeable) {
    for (const segment of cmd.split('&&').map((s) => s.trim())) {
      assert.ok(
        segment.startsWith('node scripts/rtk_exec.js '),
        `script "${name}" segment "${segment}" bypasses the RTK wrapper`
      );
    }
  }
});

test('test suites route through rtk test, not the raw proxy', () => {
  assert.strictEqual(resolveRtkMode({ command: 'node', args: ['tests/run_all.js'], env: {} }), 'test');
  assert.strictEqual(resolveRtkMode({ command: 'node', args: ['tests/test_a.js', '--parallel'], env: {} }), 'test');
  assert.strictEqual(resolveRtkMode({ command: 'pnpm', args: ['test:docs'], env: {} }), 'test');
  assert.strictEqual(resolveRtkMode({ command: 'npx', args: ['playwright', 'test'], env: {} }), 'test');
  assert.strictEqual(resolveRtkMode({ command: 'vitest', args: ['run'], env: {} }), 'test');
});

test('lint routes through rtk err so only failures survive', () => {
  assert.strictEqual(resolveRtkMode({ command: 'node', args: ['scripts/lint.js'], env: {} }), 'err');
});

test('non-test commands keep the plain proxy and stay overridable', () => {
  assert.strictEqual(resolveRtkMode({ command: 'git', args: ['status'], env: {} }), 'plain');
  assert.strictEqual(resolveRtkMode({ command: 'node', args: ['-e', 'x'], env: {} }), 'plain');
  assert.strictEqual(
    resolveRtkMode({ command: 'node', args: ['tests/x.js'], env: { KONOHA_RTK_MODE: 'plain' } }),
    'plain'
  );
});

test('wrapper prefixes the command with the resolved RTK binary and mode', () => {
  const invocation = buildInvocation({ command: 'node', args: ['tests/run_all.js'], rtk: '/usr/bin/rtk', mode: 'test' });
  assert.strictEqual(invocation.command, '/usr/bin/rtk');
  assert.deepStrictEqual(invocation.args, ['test', 'node', 'tests/run_all.js']);
  assert.strictEqual(invocation.wrapped, true);
});

test('wrapper degrades to a direct command when RTK is absent', () => {
  const invocation = buildInvocation({ command: 'node', args: ['-v'], rtk: null, mode: 'test' });
  assert.strictEqual(invocation.command, 'node');
  assert.deepStrictEqual(invocation.args, ['-v']);
  assert.strictEqual(invocation.wrapped, false);
});

test('KONOHA_RTK_DISABLE opts out of wrapping', () => {
  assert.strictEqual(resolveRtkCommand({ KONOHA_RTK_DISABLE: '1', KONOHA_RTK_CMD: '/usr/bin/rtk' }), null);
});

test('KONOHA_RTK_CMD overrides discovery for shims and pinned installs', () => {
  assert.strictEqual(resolveRtkCommand({ KONOHA_RTK_CMD: '/opt/rtk/rtk' }), '/opt/rtk/rtk');
});

test('wrapper propagates a child non-zero exit code unchanged', () => {
  const res = runWrapper(['node', NOISY, '--fail=7'], { KONOHA_RTK_DISABLE: '1' });
  assert.strictEqual(res.status, 7, `expected exit 7, got ${res.status}${res.stderr ? `: ${res.stderr}` : ''}`);
});

test('wrapper forwards child output and stays explicit when unwrapped', () => {
  const res = runWrapper(['node', NOISY], { KONOHA_RTK_DISABLE: '1' });
  assert.strictEqual(res.status, 0);
  assert.ok(res.stdout.includes('noisy-fixture-line-0'), 'child stdout must reach the caller');
  assert.ok(
    res.stderr.includes('RTK unavailable'),
    'unwrapped runs must announce themselves instead of silently losing compression'
  );
});

test('wrapper rejects an empty command with a usage error', () => {
  const res = spawnSync(process.execPath, [WRAPPER], { cwd: ROOT, encoding: 'utf-8' });
  assert.strictEqual(res.status, 2);
  assert.ok(res.stderr.includes('usage: node scripts/rtk_exec.js'));
});

test('real RTK compresses noisy suite output and keeps the exit code', () => {
  const rtk = resolveRtkCommand();
  const plain = runWrapper(['node', NOISY], { KONOHA_RTK_DISABLE: '1' });
  const wrapped = runWrapper(['node', NOISY]);
  assert.strictEqual(wrapped.status, 0, `wrapped run failed: ${wrapped.stderr}`);

  if (!rtk) {
    assert.ok(wrapped.stderr.includes('RTK unavailable'), 'without RTK the wrapper must fall back loudly');
    console.log('  (RTK not installed on this host: compression not measurable, fallback verified)');
    return;
  }

  const plainBytes = Buffer.byteLength(plain.stdout, 'utf8');
  const wrappedBytes = Buffer.byteLength(wrapped.stdout, 'utf8');
  assert.ok(
    wrappedBytes < plainBytes,
    `rtk test must shrink noisy output: plain ${plainBytes} B, wrapped ${wrappedBytes} B`
  );
  assert.ok(
    !wrapped.stderr.includes('RTK unavailable'),
    'with RTK present the wrapper must not print the fallback notice'
  );

  const failure = runWrapper(['node', NOISY, '--fail=5']);
  assert.strictEqual(failure.status, 5, `rtk test must surface exit 5, got ${failure.status}`);
  console.log(`  (measured: ${plainBytes} B plain -> ${wrappedBytes} B through rtk test)`);
});

test('wrapper file stays inside the line budget and stays executable', () => {
  const lines = fs.readFileSync(WRAPPER, 'utf8').split('\n').length;
  assert.ok(lines <= 700, `scripts/rtk_exec.js is ${lines} lines`);
  // NTFS carries no POSIX mode bits, so the exec bit is only meaningful on POSIX.
  if (process.platform !== 'win32') {
    assert.ok(fs.statSync(WRAPPER).mode & 0o100, 'scripts/rtk_exec.js must stay executable');
  }
});

let passed = 0;
const failures = [];
for (const { name, fn } of tests) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`FAIL ${name}`);
    console.log(`  ${err.message}`);
  }
}

console.log(`\n${passed}/${tests.length} RTK exec policy tests passed`);
if (failures.length > 0) process.exit(1);
