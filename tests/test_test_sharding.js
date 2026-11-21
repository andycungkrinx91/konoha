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

// The sharded step itself lives in the shared composite action, so every OS
// shard inherits the same timeout. Asserting it only in the workflow would pass
// while the action that actually runs the suite carried something else.
const shardAction = path.join(__dirname, '..', '.github', 'actions', 'konoha-test-shard', 'action.yml');
const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'cross-platform.yml');

check('the harness enforces a 3600s timeout for shard tests across workflow and runner', () => {
  const action = fs.readFileSync(shardAction, 'utf8');
  mustMatch(action, /KONOHA_TEST_TIMEOUT:\s*'3600000'/, 'shard action env KONOHA_TEST_TIMEOUT');
  mustMatch(action, /KONOHA_SHARD_TIMEOUT:\s*'3600000'/, 'shard action env KONOHA_SHARD_TIMEOUT');
  // A composite action rejects `timeout-minutes` on a step. When it carried one,
  // GitHub failed to load the action with "Unexpected value 'timeout-minutes'" and
  // all 35 shard jobs died before their first step (run 44932068005). The ceiling
  // is enforced by KONOHA_SHARD_TIMEOUT and the harness watchdog instead.
  assert.doesNotMatch(action, /^\s*timeout-minutes:/m, 'a composite action step cannot set timeout-minutes; GitHub refuses to load the action');
  const wfSrc = fs.readFileSync(workflowPath, 'utf8');
  assert.match(wfSrc, /timeout-minutes:\s*90/, 'the per-OS shard jobs must bound the whole job with timeout-minutes');
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

// The suite is split into one job per OS so each OS owns its shard count and
// its `needs`. The invariant that matters: the matrix length must equal the
// shard_total the job passes down. A shorter matrix silently drops shards (the
// dropped suites never run) and a longer one asks the harness for a shard index
// above its count, which run_all.js rejects at runtime instead of here.
check('cross-platform.yml runs one job per OS with matching shard counts', () => {
  const wf = fs.readFileSync(workflowPath, 'utf8');
  const action = fs.readFileSync(shardAction, 'utf8');
  assert.match(action, /KONOHA_TEST_SHARD:\s*\$\{\{ inputs\.shard \}\}\/\$\{\{ inputs\.shard_total \}\}/, 'shard action must forward its inputs to KONOHA_TEST_SHARD');

  const expected = { 'test-ubuntu': 10, 'test-macos': 5, 'test-windows': 20 };
  // Split the workflow into job blocks by their 2-space `job-id:` header, so an
  // assertion cannot read past the end of the job it names.
  const blocks = {};
  let current = null;
  for (const line of wf.split('\n')) {
    const header = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line);
    if (header) {
      current = header[1];
      blocks[current] = [];
    }
    if (current) blocks[current].push(line);
  }
  for (const [job, total] of Object.entries(expected)) {
    assert.ok(blocks[job], `${job} job is missing from the workflow`);
    const block = blocks[job].join('\n');
    const matrix = /shard:\s*\[([^\]]+)\]/.exec(block);
    assert.ok(matrix, `${job} has no shard matrix`);
    const shards = matrix[1].split(',').filter((s) => s.trim());
    assert.strictEqual(shards.length, total, `${job} matrix must list ${total} shards, found ${shards.length}`);
    // The shard count must not be a second literal beside the matrix: derive it
    // from the matrix length, so the two cannot drift apart.
    assert.match(block, /shard_total: \$\{\{ strategy\.job-total \}\}/, `${job} must derive shard_total from strategy.job-total`);
    assert.doesNotMatch(block, /shard_total: '[0-9]+'/, `${job} must not hardcode shard_total`);
    assert.match(block, /uses: \.\/\.github\/actions\/konoha-test-shard/, `${job} must use the shared shard action`);
    // Distinct shard indices 1..N, so the partition is complete and nothing repeats.
    assert.deepStrictEqual(shards.map((s) => Number(s)), Array.from({ length: total }, (_, i) => i + 1), `${job} shard indices must be 1..${total}`);
  }

  // GitHub Free allows 5 concurrent macOS jobs; `checks` is the sixth macOS job,
  // so the macOS shards must wait for it rather than compete with it.
  assert.match(blocks['test-macos'].join('\n'), /needs:\s*\[seed, checks\]/, 'macOS shards must need [seed, checks] to stay inside the 5-runner cap');
  assert.ok(expected['test-macos'] <= 5, 'macOS shard count must not exceed the 5 concurrent macOS runners');
});

// The owner's no-hardcoded-values rule: the Node version lives in one file and
// every setup-node step points at it, so a runtime bump cannot land on three of
// four workflows.
check('the Node version is declared once and every workflow reads it from there', () => {
  const nvmrc = path.join(__dirname, '..', '.nvmrc');
  assert.ok(fs.existsSync(nvmrc), '.nvmrc must exist as the single runtime version source');
  assert.match(fs.readFileSync(nvmrc, 'utf8').trim(), /^\d+(\.\d+)*$/, '.nvmrc must hold a version, not a range like 24.x');
  const files = [
    path.join(__dirname, '..', '.github', 'workflows', 'cross-platform.yml'),
    path.join(__dirname, '..', '.github', 'workflows', 'publish.yml'),
    path.join(__dirname, '..', '.github', 'workflows', 'release-assets.yml'),
    shardAction,
  ];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /node-version:\s*'?\d/, `${path.basename(file)} hardcodes node-version; use node-version-file: .nvmrc`);
  }
  assert.match(fs.readFileSync(shardAction, 'utf8'), /node-version-file: \$\{\{ inputs\.node_version_file \}\}/, 'the shard action must take the version file as an input');
});

// The split renamed the shard job, so any act invocation still naming `test`
// would fail with "job not found" instead of running the suite.
check('package.json act scripts name jobs that exist in the workflow', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const wf = fs.readFileSync(workflowPath, 'utf8');
  const jobNames = [...wf.matchAll(/^ {2}([a-z][a-z0-9-]*):\s*$/gm)].map((m) => m[1]);
  for (const [name, cmd] of Object.entries(pkg.scripts)) {
    const target = /-j\s+([a-z][a-z0-9-]*)/.exec(cmd);
    if (!target) continue;
    assert.ok(jobNames.includes(target[1]), `script "${name}" targets job "${target[1]}", which cross-platform.yml does not define (has: ${jobNames.join(', ')})`);
  }
});

// A hyphenated job id cannot be read with dot syntax: `needs.test-ubuntu` parses
// as `needs.test` minus `ubuntu` and the summary job silently loses its inputs.
check('hyphenated job ids are read with bracket notation, not dot syntax', () => {
  const wf = fs.readFileSync(workflowPath, 'utf8');
  const hyphenated = [...wf.matchAll(/^ {2}([a-z][a-z0-9]*-[a-z0-9-]*):\s*$/gm)].map((m) => m[1]);
  assert.ok(hyphenated.length > 0, 'expected at least one hyphenated job id (test-ubuntu, test-macos, test-windows)');
  for (const job of hyphenated) {
    const dotted = new RegExp(`needs\\.${job}\\b`);
    assert.doesNotMatch(wf, dotted, `needs.${job} parses as subtraction; use needs['${job}'].result`);
  }
  for (const job of hyphenated) {
    assert.match(wf, new RegExp(`needs\\['${job}'\\]`), `the summary job must read needs['${job}']`);
  }
});

// Every composite `run:` step needs an explicit shell, and the shell must be the
// platform's own: naming `bash` everywhere silently changed Windows semantics for
// all 358 suites at once and broke test_tarball_copyleft_scan, which extracted a
// tarball with GNU tar and read `C:\...` as a remote host (issue #36).
check('every composite run step names a platform-appropriate shell', () => {
  const action = fs.readFileSync(shardAction, 'utf8');
  const steps = action.split(/^ {4}- name:/m).slice(1);
  assert.ok(steps.length > 5, 'expected the shard action to define its steps');
  let runSteps = 0;
  for (const step of steps) {
    if (!/^\s+run:/m.test(step)) continue;
    runSteps += 1;
    const shell = /^\s+shell:\s*(.+)$/m.exec(step);
    assert.ok(shell, `run step "${step.split('\n')[0]}" has no shell; a composite action requires one`);
    const value = shell[1].trim();
    const isPlatformDefault = value === 'pwsh' || /runner\.os == 'Windows' && 'pwsh' \|\| 'bash'/.test(value);
    assert.ok(isPlatformDefault, `run step "${step.split('\n')[0]}" must use pwsh on Windows and bash elsewhere, found: ${value}`);
  }
  assert.ok(runSteps >= 8, `expected the shard action to keep its run steps, found ${runSteps}`);
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
