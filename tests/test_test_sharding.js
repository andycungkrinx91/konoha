'use strict';

// The shard selector decides what CI runs, so its two failure modes are worth a
// test: a partition that drops or repeats a suite, and a selector that a typo can
// turn into a green run of nothing. Both are checked against the real harness as
// well, because the helper being right does not prove run_all.js consults it.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const path = require('path');
const { selectShard, parseShard } = require('./helpers/shard');
const { parsePositiveTimeoutMs } = require('./helpers/shard_timeout');
const { isPidAlive } = require('./helpers/seed_lifecycle');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✔ ${name}`);
}

const suites = Array.from({ length: 287 }, (_, i) => `suite_${i}.js`);

check('shards partition the suite list exactly once', () => {
  for (const count of [1, 2, 3, 4, 6, 8, 13]) {
    const seen = [];
    for (let index = 1; index <= count; index++) seen.push(...selectShard(suites, index, count));
    assert.deepStrictEqual(seen.slice().sort(), suites.slice().sort(), `${count} shards`);
    assert.strictEqual(new Set(seen).size, suites.length, `${count} shards repeat a suite`);
  }
});

check('shard sizes differ by at most one', () => {
  for (const count of [4, 6, 8]) {
    const sizes = Array.from({ length: count }, (_, i) => selectShard(suites, i + 1, count).length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `${count}: ${sizes.join(',')}`);
  }
});

check('selection is deterministic across runs', () => {
  assert.deepStrictEqual(selectShard(suites, 3, 8), selectShard(suites, 3, 8));
});

check('malformed selectors are rejected rather than ignored', () => {
  for (const bad of ['', 'abc', '2', '2/', '/2', '2/0', '0/2', '9/8', '1.5/2']) {
    assert.throws(() => parseShard(bad), /shard/, `accepted ${JSON.stringify(bad)}`);
  }
});

check('a valid selector is parsed', () => {
  assert.deepStrictEqual(parseShard('3/8'), { index: 3, count: 8 });
  assert.deepStrictEqual(parseShard(' 3/8 '), { index: 3, count: 8 });
});

const harness = path.join(__dirname, 'run_all.js');
// A filter that matches exactly one suite, so the empty-shard case below cannot
// drift into a non-empty one when another suite with a similar name is added.
function runHarness(env) {
  return spawnSync(process.execPath, [harness, 'test_docs_freshness_api'], {
    encoding: 'utf8',
    timeout: 300000,
    env: { ...process.env, ...env }
  });
}

check('the harness refuses an empty shard instead of reporting it green', () => {
  const result = runHarness({ KONOHA_TEST_SHARD: '6/6' });
  assert.strictEqual(result.status, 2, `exit ${result.status}\n${result.stdout}${result.stderr}`);
  assert.match(result.stderr, /selected 0 of \d+ suites/);
});

check('the harness refuses a malformed shard instead of running everything', () => {
  const result = runHarness({ KONOHA_TEST_SHARD: 'nonsense' });
  assert.strictEqual(result.status, 2, `exit ${result.status}`);
  assert.match(result.stderr, /shard selector expects I\/N/);
  assert.doesNotMatch(result.stdout, /\[SUITE\]/, 'ran suites despite an invalid selector');
});

// Project policy: the CI timeout is fixed at 3600000 ms (3600 s). A shard runs a
// full cross-platform suite and must not be killed mid-suite. If this check fails,
// the timeout was changed - revert it. Never edit these assertions to match a new
// number: that converts the guard into a rubber stamp. A slow suite is fixed by
// making it faster or by sharding it, not by moving the timeout.
const TIMEOUT_RULE = 'the CI timeout is fixed at 3600000 ms (3600 s) by project policy - revert the timeout, do not edit this assertion';
const mustMatch = (src, re, where) => assert.match(src, re, `${where} no longer carries the 3600 s timeout: ${TIMEOUT_RULE}`);

check('the harness enforces a 3600s timeout for shard tests across workflow and runner', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'cross-platform.yml'), 'utf8');
  mustMatch(wf, /KONOHA_TEST_TIMEOUT:\s*'3600000'/, 'workflow env KONOHA_TEST_TIMEOUT');
  mustMatch(wf, /KONOHA_SHARD_TIMEOUT:\s*'3600000'/, 'workflow env KONOHA_SHARD_TIMEOUT');
  mustMatch(wf, /timeout-minutes:\s*60\r?\n\s*run:\s*pnpm test/, 'workflow shard step ceiling');
  const runnerSrc = fs.readFileSync(harness, 'utf8');
  mustMatch(runnerSrc, /KONOHA_SHARD_TIMEOUT[^\n]*3600000/, 'run_all.js KONOHA_SHARD_TIMEOUT');
  mustMatch(runnerSrc, /KONOHA_TEST_TIMEOUT[^\n]*3600000/, 'run_all.js KONOHA_TEST_TIMEOUT');
  const winPs1 = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'windows-ci.ps1'), 'utf8');
  mustMatch(winPs1, /KONOHA_TEST_TIMEOUT\s*=\s*'3600000'/, 'windows-ci.ps1 KONOHA_TEST_TIMEOUT');
  mustMatch(winPs1, /KONOHA_SHARD_TIMEOUT\s*=\s*'3600000'/, 'windows-ci.ps1 KONOHA_SHARD_TIMEOUT');
  const sandboxSrc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'sandbox.js'), 'utf8');
  mustMatch(sandboxSrc, /KONOHA_TEST_TIMEOUT=.*3600000/, 'sandbox.js KONOHA_TEST_TIMEOUT');
  mustMatch(sandboxSrc, /KONOHA_SHARD_TIMEOUT=.*3600000/, 'sandbox.js KONOHA_SHARD_TIMEOUT');
});

check('parsePositiveTimeoutMs rejects invalid, zero, and negative env values cleanly', () => {
  assert.strictEqual(parsePositiveTimeoutMs(['-1', '1800000']), 1800000);
  assert.strictEqual(parsePositiveTimeoutMs(['0', 'abc', '5000']), 5000);
  assert.strictEqual(parsePositiveTimeoutMs(['abc', '  ', undefined, null]), 3600000, `fallback must stay 3600 s: ${TIMEOUT_RULE}`);
  assert.strictEqual(parsePositiveTimeoutMs(['-50', '0']), 3600000, `fallback must stay 3600 s: ${TIMEOUT_RULE}`);
  assert.strictEqual(parsePositiveTimeoutMs(['250']), 250);
});

check('shard watchdog terminates detached child trees and cleans suite directories on timeout', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-watchdog-test-'));
  try {
    const suiteHome = path.join(tmpRoot, 'suite_home');
    fs.mkdirSync(suiteHome, { recursive: true });
    const pidFile = path.join(tmpRoot, 'pids.json');
    const runnerScript = path.join(tmpRoot, 'runner_probe.js');
    const childScript = path.join(tmpRoot, 'hanging_suite.js');
    const helperPath = path.join(__dirname, 'helpers', 'shard_timeout.js');
    const lifecyclePath = path.join(__dirname, 'helpers', 'seed_lifecycle.js');

    fs.writeFileSync(childScript, [
      "const fs = require('fs');",
      "const { spawn } = require('child_process');",
      `const pidFile = ${JSON.stringify(pidFile)};`,
      "const grand = spawn(process.execPath, ['-e', 'setInterval(() => {}, 10000)'], { stdio: 'ignore' });",
      "fs.writeFileSync(pidFile, JSON.stringify({ childPid: process.pid, grandPid: grand.pid }));",
      "setInterval(() => {}, 10000);"
    ].join('\n'), 'utf8');

    fs.writeFileSync(runnerScript, [
      "const { spawn } = require('child_process');",
      `const { armShardWatchdog, parsePositiveTimeoutMs } = require(${JSON.stringify(helperPath)});`,
      `const { cleanupSuiteDir } = require(${JSON.stringify(lifecyclePath)});`,
      `const suiteHome = ${JSON.stringify(suiteHome)};`,
      `const childScript = ${JSON.stringify(childScript)};`,
      "const activeSuites = new Map();",
      "const child = spawn(process.execPath, [childScript], { detached: process.platform !== 'win32', stdio: 'ignore' });",
      "activeSuites.set('hang', { name: 'hanging_suite.js', suiteHome, child });",
      "const timeoutMs = parsePositiveTimeoutMs([process.env.KONOHA_SHARD_TIMEOUT, process.env.KONOHA_TEST_TIMEOUT], 1800000);",
      "armShardWatchdog({ shard: '1/8', timeoutMs, activeSuites, cleanupSuiteDir, graceMs: 150, killWaitMs: 150 });",
      "setInterval(() => {}, 10000);"
    ].join('\n'), 'utf8');

    const res = spawnSync(process.execPath, [runnerScript], {
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, KONOHA_SHARD_TIMEOUT: '300', KONOHA_TEST_TIMEOUT: '1800000' }
    });
    assert.strictEqual(res.status, 1, `Expected exit 1 on shard timeout, got ${res.status}\n${res.stderr}`);
    assert.match(res.stderr, /\[TIMEOUT\] Shard 1\/8 test run exceeded 0\.3s/);
    assert.ok(!fs.existsSync(suiteHome), 'suiteHome must be cleaned up after child tree exit');
    assert.ok(fs.existsSync(pidFile), 'child probe should have recorded PIDs before timeout');
    const { childPid, grandPid } = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
    assert.strictEqual(isPidAlive(childPid), false, `child PID ${childPid} leaked after timeout`);
    assert.strictEqual(isPidAlive(grandPid), false, `grandchild PID ${grandPid} leaked after timeout`);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

console.log(`\n${passed} passed`);
