#!/usr/bin/env node
'use strict';

/**
 * Release-matrix probe for the 2.2.20 install/upgrade fix.
 *
 * Runs each flow in a throwaway HOME so a developer's real ~/.konoha is never
 * touched, and records the numbers the release checklist asks for:
 * skill rows, skill_chunks, non-null embeddings, PRAGMA user_version.
 *
 * Usage: node scripts/verify_install_matrix.js
 * Not part of the unit suite (it installs from the packed tarball, ~60s).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', timeout: 900000, ...opts });
}

function dbStats(home) {
  const dbPath = path.join(home, '.konoha', 'konoha.db');
  if (!fs.existsSync(dbPath)) return { exists: false };
  // The repo ships its own node:sqlite driver; better-sqlite3 is not a dependency.
  const probe = `
    const Database = require(${JSON.stringify(path.join(ROOT, 'src', 'sqlite_driver'))});
    const db = new Database(${JSON.stringify(dbPath)}, { readonly: true });
    const one = (sql) => { try { return db.prepare(sql).get(); } catch (_) { return null; } };
    const out = {
      exists: true,
      user_version: one('PRAGMA user_version').user_version,
      skills: (one('SELECT COUNT(*) n FROM skills') || {}).n,
      skill_chunks: (one('SELECT COUNT(*) n FROM skill_chunks') || {}).n,
      chunks_with_embedding: (one('SELECT COUNT(*) n FROM skill_chunks WHERE embedding IS NOT NULL') || {}).n,
      skills_fts: (one('SELECT COUNT(*) n FROM skills_fts') || {}).n,
      agents: (one('SELECT COUNT(*) n FROM agents') || {}).n,
      cyber_rows: (one("SELECT COUNT(*) n FROM skills WHERE file_path LIKE '%anthropic-cybersecurity-skills-assets%' OR file_path LIKE '%cyber-pack%'") || {}).n
    };
    db.close();
    process.stdout.write(JSON.stringify(out));
  `;
  return JSON.parse(execFileSync(process.execPath, ['-e', probe], { encoding: 'utf8', timeout: 60000 }));
}

function sandboxEnv(home) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    KONOHA_DB_PATH: path.join(home, '.konoha', 'konoha.db'),
    CI: 'true'
  };
}

function packOnce() {
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_matrix_pack_'));
  sh('pnpm', ['pack', '--pack-destination', packDir], { cwd: ROOT });
  const tgz = fs.readdirSync(packDir).find((f) => f.endsWith('.tgz'));
  return { path: path.join(packDir, tgz), cleanup: () => fs.rmSync(packDir, { recursive: true, force: true }) };
}

function installGlobal(tgz, prefix) {
  sh('npm', ['install', '-g', '--prefix', prefix, tgz, '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd: prefix,
    env: { ...process.env, npm_config_allow_scripts: '' }
  });
  return path.join(prefix, 'bin', 'konoha');
}

function flow(name, fn) {
  console.log(`\n=== ${name} ===`);
  const started = Date.now();
  try {
    const result = fn();
    console.log(`  PASS in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return { name, ok: true, ...result };
  } catch (err) {
    console.log(`  FAIL: ${err.message}`);
    if (err.stdout) console.log(String(err.stdout).slice(-1500));
    if (err.stderr) console.log(String(err.stderr).slice(-1500));
    return { name, ok: false, error: err.message };
  }
}

/**
 * Flow 2 — seed a 2.2.19 install, then drive the real `konoha upgrade` at the
 * packed tarball. Asserts the reported installed version and, separately, what
 * a fresh shell resolves through PATH — the 2.2.19 false-success defect.
 */
function upgradeFlow(packed) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_upg_'));
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_upg_g_'));
  const packedVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  try {
    sh('npm', ['install', '-g', '--prefix', prefix, 'konoha-mcp@2.2.19', '--no-audit', '--no-fund', '--loglevel=error'], {
      cwd: prefix, env: { ...process.env, npm_config_allow_scripts: '' }
    });
  } catch (_) {
    console.log('  note: registry 2.2.19 install failed; seeding from local pack instead');
    installGlobal(packed.path, prefix);
  }
  const oldCli = path.join(prefix, 'bin', 'konoha');
  sh(oldCli, ['init', '--yes'], { cwd: home, env: sandboxEnv(home) });
  const before = dbStats(home);

  // The upgrade must be driven by the CURRENT CLI: KONOHA_UPGRADE_TARGET is
  // itself a 2.2.20 feature, so an old build would ignore it and reach for
  // the registry. The point of the flow is that the package on disk is
  // replaced and the database migrated by the real command.
  const cli = path.join(ROOT, 'bin', 'cli.js');
  const upgradeOut = sh(process.execPath, [cli, 'upgrade', '--yes'], {
    cwd: home,
    env: {
      ...sandboxEnv(home),
      KONOHA_UPGRADE_TARGET: packed.path,
      // The upgrade shells out to `npm install -g` without `--prefix`, so the
      // destination comes from npm's own configuration. Pin it to this flow's
      // prefix, otherwise the install lands in the developer's global tree and
      // PATH keeps resolving the seeded 2.2.19 — a mismatch the verification
      // gate correctly rejects, but one this flow never intended to create.
      npm_config_prefix: prefix,
      PNPM_HOME: path.join(prefix, 'bin'),
      // The stale-PATH case is exercised separately below; here PATH must
      // expose the freshly installed binary.
      PATH: `${path.join(prefix, 'bin')}${path.delimiter}${process.env.PATH}`
    }
  });
  const after = dbStats(home);
  console.log(`  before: ${JSON.stringify(before)}`);
  console.log(`  after:  ${JSON.stringify(after)}`);

  const installedLine = (upgradeOut.match(/Installed Version:\s*v?(\d+\.\d+\.\d+)/) || [])[1];
  if (installedLine !== packedVersion) {
    throw new Error(`upgrade reported Installed Version ${installedLine || '(none)'}, expected ${packedVersion}`);
  }

  // Fresh-shell read: the binary a new terminal would get via PATH, not the
  // one the upgrade process used. This is the 2.2.19 false-success check.
  const freshShellEnv = {
    ...sandboxEnv(home),
    PATH: `${path.join(prefix, 'bin')}${path.delimiter}${process.env.PATH}`
  };
  const resolved = sh('sh', ['-c', 'command -v konoha'], { env: freshShellEnv }).trim();
  if (resolved !== path.join(prefix, 'bin', 'konoha')) {
    throw new Error(`PATH resolves konoha to ${resolved || '(nothing)'}, expected the upgrade prefix`);
  }
  const versionOut = sh(resolved, ['version'], { cwd: home, env: freshShellEnv });
  const freshVersion = (versionOut.match(/Current Version:\s*v?(\d+\.\d+\.\d+)/) || [])[1];
  if (freshVersion !== packedVersion) {
    throw new Error(`fresh shell reports v${freshVersion || '?'}, expected ${packedVersion}`);
  }

  if (!(after.skills >= before.skills)) throw new Error('upgrade lost skills');
  if (!(after.user_version >= before.user_version)) throw new Error('upgrade downgraded schema');
  if (after.cyber_rows !== 0) throw new Error(`cyber rows survived upgrade: ${after.cyber_rows}`);
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(prefix, { recursive: true, force: true });
  return { before, after, freshVersion };
}

/**
 * Flow 2b — PATH resolves `konoha` to a copy the upgrade did not replace. The
 * command must exit non-zero, name the failure, and never print a success
 * banner.
 */
function stalePathFlow(packed) {
  if (process.env.KONOHA_SKIP_STALE_PATH === '1') {
    console.log('  SKIPPED (KONOHA_SKIP_STALE_PATH=1)');
    return { skipped: true };
  }
  const isWin = process.platform === 'win32';
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_stale_'));
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_stale_g_'));
  const staleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_stale_path_'));
  try {
    installGlobal(packed.path, prefix);
    const cli = path.join(prefix, 'bin', 'konoha');
    sh(cli, ['init', '--yes'], { cwd: home, env: sandboxEnv(home) });

    // A shim that always reports the pre-upgrade version, first on PATH.
    const staleShim = path.join(staleDir, isWin ? 'konoha.cmd' : 'konoha');
    fs.writeFileSync(
      staleShim,
      isWin
        ? `@echo off\r\n"${process.execPath}" -e "console.log('Current Version: 2.2.19')"\r\n`
        : `#!/bin/sh\nexec "${process.execPath}" -e "console.log('Current Version: 2.2.19')"\n`
    );
    if (!isWin) fs.chmodSync(staleShim, 0o755);

    let exitCode = 0;
    let output = '';
    try {
      output = sh(cli, ['upgrade', '--yes'], {
        cwd: home,
        env: {
          ...sandboxEnv(home),
          KONOHA_UPGRADE_TARGET: packed.path,
          // Keep the install inside this flow's prefix: without it the upgrade
          // writes to the developer's global tree, and the case would still
          // fail while testing the wrong thing.
          npm_config_prefix: prefix,
          PNPM_HOME: path.join(prefix, 'bin'),
          PATH: `${staleDir}${path.delimiter}${process.env.PATH}`
        }
      });
    } catch (err) {
      exitCode = err.status || 1;
      output = `${err.stdout || ''}${err.stderr || ''}`;
    }

    if (exitCode === 0) throw new Error('upgrade reported success while PATH still showed the old version');
    if (!/Upgrade verification failed/.test(output)) {
      throw new Error(`upgrade failed without the verification message: ${output.slice(-400)}`);
    }
    if (/successfully upgraded/.test(output)) {
      throw new Error('upgrade printed a success banner despite failing verification');
    }
    return { exitCode };
  } finally {
    for (const dir of [home, prefix, staleDir]) fs.rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  const results = [];
  const packed = packOnce();
  console.log(`Packed: ${path.basename(packed.path)} (${(fs.statSync(packed.path).size / 1048576).toFixed(1)}M)`);

  try {
    // Flow 1 — fresh install + init.
    results.push(flow('fresh install', () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_fresh_'));
      const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_fresh_g_'));
      const cli = installGlobal(packed.path, prefix);
      sh(cli, ['init', '--yes'], { cwd: home, env: sandboxEnv(home) });
      const stats = dbStats(home);
      console.log(`  ${JSON.stringify(stats)}`);
      if (!stats.exists) throw new Error('init produced no database');
      if (!(stats.skills > 0)) throw new Error(`no skills indexed (skills=${stats.skills})`);
      if (!(stats.user_version >= 5)) throw new Error(`unexpected schema version ${stats.user_version}`);
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(prefix, { recursive: true, force: true });
      return { stats };
    }));

    // Flow 2 — install 2.2.19, then run the real `konoha upgrade` over it.
    results.push(flow('2.2.19 -> real upgrade', () => upgradeFlow(packed)));

    // Flow 2b — the upgrade must refuse to report success when PATH resolves to
    // a copy the install did not replace.
    results.push(flow('stale PATH fails loudly', () => stalePathFlow(packed)));

    // Flow 3 — reinstall is idempotent.
    results.push(flow('idempotent reinstall', () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_re_'));
      const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_re_g_'));
      const cli = installGlobal(packed.path, prefix);
      sh(cli, ['init', '--yes'], { cwd: home, env: sandboxEnv(home) });
      const first = dbStats(home);
      installGlobal(packed.path, prefix);
      sh(cli, ['init', '--yes'], { cwd: home, env: sandboxEnv(home) });
      const second = dbStats(home);
      console.log(`  first:  ${JSON.stringify(first)}`);
      console.log(`  second: ${JSON.stringify(second)}`);
      for (const key of ['skills', 'user_version', 'agents', 'skills_fts']) {
        if (first[key] !== second[key]) throw new Error(`${key} drifted on reinstall: ${first[key]} -> ${second[key]}`);
      }
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(prefix, { recursive: true, force: true });
      return { first, second };
    }));
  } finally {
    packed.cleanup();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== matrix: ${results.length - failed.length}/${results.length} flows passed ===`);
  if (failed.length) {
    for (const f of failed) console.log(`  FAILED: ${f.name} — ${f.error}`);
    process.exit(1);
  }
  process.exit(0);
}

main();