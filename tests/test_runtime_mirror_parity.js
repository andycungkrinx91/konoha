#!/usr/bin/env node
'use strict';

/**
 * tests/test_runtime_mirror_parity.js
 *
 * 1. Byte-identity: every repo `src/mcp/**\/*.js` must exist in
 *    `$HOME/.konoha/src/mcp` with an identical SHA-256 hash.
 *    Skips cleanly (exit 0) when ~/.konoha is absent (CI / fresh checkout).
 * 2. Stale-sourceRoot guard: assessSourceRootFreshness() must flag an older
 *    package tree and pass the live repo, and copyRuntimeFiles() must refuse
 *    to mirror a stale tree into ~/.konoha/src.
 * 3. Destructive negative control (fixture-only, never touches ~/.konoha):
 *    truncate one file inside a /tmp mirror copy and assert compareMirror()
 *    reports exactly that path.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { compareMirror } = require('./helpers/runtime_mirror_parity');

const ROOT = path.resolve(__dirname, '..');
const REPO_MCP = path.join(ROOT, 'src', 'mcp');
const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();
const KONOHA_HOME = path.join(HOME, '.konoha');
const MIRROR_MCP = path.join(KONOHA_HOME, 'src', 'mcp');

function skip(reason) {
  console.log(`SKIP test_runtime_mirror_parity: ${reason}`);
  process.exit(0);
}

function testRepoVsMirror() {
  console.log('\n--- 1. Byte-identity of ~/.konoha/src/mcp ---');
  const result = compareMirror(REPO_MCP, MIRROR_MCP);
  if (result.missingRoots.length) {
    skip(`missing root(s): ${result.missingRoots.join(', ')}`);
  }
  assert.strictEqual(result.filesCompared > 0, true, 'expected at least one src/mcp/**/*.js file');
  if (!result.ok) {
    for (const m of result.mismatches) {
      console.error(`  ✗ ${m.path} (${m.reason}) repo=${m.repoHash || '-'} mirror=${m.mirrorHash || '-'}`);
    }
  }
  assert.deepStrictEqual(
    result.mismatches,
    [],
    `${result.mismatches.length} of ${result.filesCompared} mirrored src/mcp files diverge`
  );
  if (result.extraInMirror.length) {
    console.log(`  ! note: ${result.extraInMirror.length} file(s) only in mirror: ${result.extraInMirror.join(', ')}`);
  }
  console.log(`  ✓ ${result.filesCompared} files compared, all byte-identical (SHA-256)`);
  return result.filesCompared;
}

function testStaleSourceRootGuard() {
  console.log('\n--- 2. Stale-sourceRoot guard ---');
  // Requiring the install module must not mutate the live runtime.
  const install = require('../bin/lib/runtime_install.js');
  assert.strictEqual(typeof install.assessSourceRootFreshness, 'function', 'assessSourceRootFreshness must be exported');
  assert.strictEqual(typeof install.copyRuntimeFiles, 'function', 'copyRuntimeFiles must be exported');

  const live = install.assessSourceRootFreshness(ROOT);
  assert.strictEqual(live.stale, false, 'the repo itself must never be flagged stale');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-stale-src-'));
  try {
    const fakePkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const [major, minor, patch] = String(fakePkg.version).replace(/^v/, '-').split('.');
    fakePkg.version = `${major}.${minor}.${Math.max(0, parseInt(patch, 10) - 1)}-stale-fixture`;
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify(fakePkg, null, 2));
    const stale = install.assessSourceRootFreshness(tmp);
    assert.strictEqual(stale.stale, true, `older sourceRoot ${fakePkg.version} must be flagged stale`);
    assert.strictEqual(stale.repoVersion, JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version);

    // Guard must block the src/ mirror and name both versions in the warning.
    const probeRoot = path.join(tmp, 'stale-tree');
    fs.mkdirSync(path.join(probeRoot, 'src', 'mcp'), { recursive: true });
    fs.writeFileSync(path.join(probeRoot, 'package.json'), JSON.stringify(fakePkg, null, 2));
    fs.writeFileSync(path.join(probeRoot, 'src', 'mcp', 'guard_probe.js'), '// should never be mirrored\n');
    const captured = [];
    const prevStdout = process.stdout.write;
    process.stdout.write = function (chunk) {
      captured.push(String(chunk));
      return true;
    };
    try {
      install.copyRuntimeFiles(() => {}, probeRoot);
    } finally {
      process.stdout.write = prevStdout;
    }
    const joined = captured.join('');
    assert.ok(/stale sourceRoot|Skipping runtime mirror/.test(joined), `guard must log a loud warning, got: ${joined}`);
    assert.ok(joined.includes(fakePkg.version), 'warning must name the stale source version');
    assert.ok(!fs.existsSync(path.join(KONOHA_HOME, 'src', 'mcp', 'guard_probe.js')),
      'stale sourceRoot must not populate ~/.konoha/src/mcp');

    // A stale source must not overwrite an existing mirror file either.
    const sentinelRel = 'mcp/workflow.js';
    const sentinel = path.join(KONOHA_HOME, 'src', sentinelRel);
    if (fs.existsSync(sentinel)) {
      fs.mkdirSync(path.join(probeRoot, 'src', 'mcp'), { recursive: true });
      fs.writeFileSync(path.join(probeRoot, 'src', sentinelRel), '// stale overwrite attempt\n');
      const before = fs.readFileSync(sentinel);
      install.copyRuntimeFiles(() => {}, probeRoot);
      assert.ok(before.equals(fs.readFileSync(sentinel)), 'stale sourceRoot must not overwrite existing mirror files');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log('  ✓ outdated sourceRoot is refused + warned; live repo passes');
}

function testNegativeControl() {
  console.log('\n--- 3. Destructive negative control (fixture only) ---');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-parity-negctl-'));
  try {
    const mirror = path.join(tmp, 'mirror');
    fs.cpSync(REPO_MCP, mirror, { recursive: true });
    const baseline = compareMirror(REPO_MCP, mirror);
    assert.strictEqual(baseline.ok, true, 'pristine fixture copy must be in parity');

    const victimRel = 'workflow.js';
    const victim = path.join(mirror, victimRel);
    assert.ok(fs.existsSync(victim), `fixture must contain ${victimRel}`);
    fs.truncateSync(victim, 5);

    const tampered = compareMirror(REPO_MCP, mirror);
    assert.strictEqual(tampered.ok, false, 'truncated mirror must fail parity');
    assert.deepStrictEqual(
      tampered.mismatches.map((m) => m.path),
      [victimRel],
      `expected exactly ${victimRel} to be reported, got ${JSON.stringify(tampered.mismatches)}`
    );
    assert.strictEqual(tampered.mismatches[0].reason, 'content-mismatch');
    assert.strictEqual(tampered.filesCompared, baseline.filesCompared);
    console.log(`  ✓ truncating ${victimRel} surfaced exactly 1 mismatch out of ${tampered.filesCompared} compared`);

    // A deleted file must be reported as missing rather than silently ignored.
    fs.rmSync(victim);
    const deleted = compareMirror(REPO_MCP, mirror);
    assert.deepStrictEqual(deleted.mismatches.map((m) => `${m.path}:${m.reason}`), [`${victimRel}:missing-in-mirror`]);
    console.log(`  ✓ deleting ${victimRel} surfaced as missing-in-mirror`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function main() {
  console.log('=========================================================');
  console.log('  RUNTIME MIRROR PARITY & STALE SOURCE GUARD');
  console.log('=========================================================');
  if (!fs.existsSync(KONOHA_HOME)) skip(`runtime mirror absent at ${KONOHA_HOME}`);
  if (!fs.existsSync(MIRROR_MCP)) skip(`runtime mirror absent at ${MIRROR_MCP}`);

  testStaleSourceRootGuard();
  testNegativeControl();
  const filesCompared = testRepoVsMirror();
  console.log(`\n✓ runtime mirror parity passed (${filesCompared} files compared)\n`);
}

main();
