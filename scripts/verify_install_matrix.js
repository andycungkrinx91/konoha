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
    CI: 'true',
    KONOHA_UI_AUTOSTART: '0'
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

    // Flow 2 — install 2.2.19, then upgrade over it.
    results.push(flow('2.2.19 -> local upgrade', () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_upg_'));
      const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_upg_g_'));
      // Seed with the published 2.2.19 (or the local pack if the registry denies).
      try {
        sh('npm', ['install', '-g', '--prefix', prefix, 'konoha-mcp@2.2.19', '--no-audit', '--no-fund', '--loglevel=error'], {
          cwd: prefix, env: { ...process.env, npm_config_allow_scripts: '' }
        });
      } catch (_) {
        console.log('  note: registry 2.2.19 install failed; seeding from local pack instead');
        installGlobal(packed.path, prefix);
      }
      const cli = path.join(prefix, 'bin', 'konoha');
      sh(cli, ['init', '--yes'], { cwd: home, env: sandboxEnv(home) });
      const before = dbStats(home);
      installGlobal(packed.path, prefix);
      const after = dbStats(home);
      console.log(`  before: ${JSON.stringify(before)}`);
      console.log(`  after:  ${JSON.stringify(after)}`);
      if (!(after.skills >= before.skills)) throw new Error('upgrade lost skills');
      if (!(after.user_version >= before.user_version)) throw new Error('upgrade downgraded schema');
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(prefix, { recursive: true, force: true });
      return { before, after };
    }));

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