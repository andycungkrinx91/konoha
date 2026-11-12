#!/usr/bin/env node
'use strict';

/**
 * tests/test_upgrade_version_verification.js — `konoha upgrade` reports success
 * only when the `konoha` a fresh shell would run is the one it installed.
 *
 * 2.2.19 printed "successfully upgraded to v2.2.19" while `konoha version` still
 * reported 2.2.17, because a ~/.local/bin shim ahead of the npm prefix kept
 * winning PATH resolution. These cases drive the real helpers against planted
 * shims; no package install is needed.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { assertSandbox } = require('./helpers/sandbox_guard');
assertSandbox();

const {
  resolvePathKonoha,
  readPathKonohaVersion,
  assertPathVersionMatches
} = require('../bin/lib/upgrade_verify');

function plantShim(dir, version, isWin = process.platform === 'win32') {
  const name = isWin ? 'konoha.cmd' : 'konoha';
  const file = path.join(dir, name);
  fs.writeFileSync(
    file,
    isWin
      ? `@echo off\r\n"${process.execPath}" -e "console.log('Current Version: ${version}')"\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" -e "console.log('Current Version: ${version}')"\n`
  );
  if (!isWin) fs.chmodSync(file, 0o755);
  return file;
}

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function main() {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_vv_a_'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_vv_b_'));
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_vv_e_'));
  try {
    const first = plantShim(a, '2.2.17');
    plantShim(b, '2.2.20');

    // First match on PATH wins — that is what a shell would run.
    withEnv({ PATH: [a, b].join(path.delimiter) }, () => {
      assert.strictEqual(resolvePathKonoha(), first);
      const probe = readPathKonohaVersion();
      assert.strictEqual(probe.version, '2.2.17');
      assert.strictEqual(probe.path, first);
    });
    console.log('  resolves first match on PATH');

    // Ordering the other way round resolves the other shim.
    withEnv({ PATH: [b, a].join(path.delimiter) }, () => {
      assert.strictEqual(readPathKonohaVersion().version, '2.2.20');
    });
    console.log('  honours PATH ordering');

    // A version mismatch kills the upgrade instead of reporting success.
    withEnv({ PATH: [a, b].join(path.delimiter) }, () => {
      let exitCode = 0;
      let stderr = '';
      const realExit = process.exit;
      const realWrite = process.stdout.write;
      process.exit = (code) => { exitCode = code; throw new Error('__exit__'); };
      // `format.error()` writes through `log()` → process.stdout.write, so the
      // only reliable capture point is the stream itself.
      process.stdout.write = (chunk) => { stderr += String(chunk); return true; };
      try {
        assertPathVersionMatches('2.2.20', '2.2.20');
        assert.fail('verification accepted a stale PATH');
      } catch (err) {
        assert.strictEqual(err.message, '__exit__', `unexpected error: ${err.message}`);
      } finally {
        process.exit = realExit;
        process.stdout.write = realWrite;
      }
      assert.strictEqual(exitCode, 1, 'stale PATH must exit non-zero');
      const plain = stderr.replace(/\x1b\[[0-9;]*m/g, '');
      assert.ok(plain.includes("Upgrade verification failed: PATH 'konoha' reports v2.2.17"), `must name the failure: ${plain}`);
      assert.ok(plain.includes('reports v2.2.17'), 'must report the version PATH showed');
      assert.ok(plain.includes('npm install -g konoha-mcp@2.2.20'), 'must give the recovery command');
    });
    console.log('  stale PATH exits 1 with recovery instructions');

    // A matching PATH passes and returns the probe.
    withEnv({ PATH: [b, a].join(path.delimiter) }, () => {
      const probe = assertPathVersionMatches('2.2.20', '2.2.20');
      assert.strictEqual(probe.version, '2.2.20');
    });
    console.log('  matching PATH passes');

    // Nothing named konoha on PATH after an install is a failure, not a pass.
    withEnv({ PATH: empty }, () => {
      const probe = readPathKonohaVersion();
      assert.strictEqual(probe.path, null);
      assert.match(probe.error, /no konoha executable on PATH/);
    });
    console.log('  empty PATH yields a null probe with an error');

    // A binary that prints no version line is not silently accepted. The shim has
    // to be executable on the host, so Windows gets the .cmd form.
    const muteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_vv_m_'));
    const isWin = process.platform === 'win32';
    const muteShim = path.join(muteDir, isWin ? 'konoha.cmd' : 'konoha');
    fs.writeFileSync(
      muteShim,
      isWin
        ? `@echo off\r\n"${process.execPath}" -e "console.log('Update available! Latest: 9.9.9')"\r\n`
        : `#!/bin/sh\nexec "${process.execPath}" -e "console.log('Update available! Latest: 9.9.9')"\n`
    );
    if (!isWin) fs.chmodSync(muteShim, 0o755);
    withEnv({ PATH: muteDir }, () => {
      const probe = readPathKonohaVersion();
      assert.strictEqual(probe.version, null, 'must not read the registry version as the local one');
      assert.match(probe.error, /Current Version/);
    });
    fs.rmSync(muteDir, { recursive: true, force: true });
    console.log('  unlabelled output is rejected, not guessed');

    console.log('PASS test_upgrade_version_verification');
  } finally {
    for (const dir of [a, b, empty]) fs.rmSync(dir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  console.error(`FAIL test_upgrade_version_verification: ${err.message}`);
  process.exit(1);
}
