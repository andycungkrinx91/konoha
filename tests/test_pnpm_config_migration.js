#!/usr/bin/env node
'use strict';

/**
 * tests/test_pnpm_config_migration.js
 *
 * pnpm 12 reads overrides from pnpm-workspace.yaml and rejects the legacy
 * `pnpm` key. This suite pins the migrated configuration so a future edit cannot
 * reintroduce the "pnpm field no longer read" warning or the unsupported
 * ignoreCves key.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;

function check(label, fn) {
  try {
    fn();
    console.log(`  PASS ${label}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${label}: ${err.message}`);
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const workspace = fs.readFileSync(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
const npmrcPath = path.join(ROOT, '.npmrc');

check('package.json has no legacy pnpm key', () => {
  assert.strictEqual('pnpm' in pkg, false);
});

check('package.json overrides only duplicates the yaml image-size security pin', () => {
  const keys = Object.keys(pkg.overrides || {});
  assert.deepStrictEqual(
    keys,
    ['image-size'],
    'package.json#overrides must stay empty except the documented image-size CVE pin; pnpm-workspace.yaml is authoritative'
  );
});

check('packageManager is pinned', () => {
  assert.strictEqual(pkg.packageManager, 'pnpm@12.16.1');
});

check('workspace yaml uses audit.ignore and drops ignoreCves', () => {
  assert.match(workspace, /^audit:\s*$/m);
  assert.match(workspace, /^\s+ignore:\s*$/m);
  assert.ok(workspace.includes('GHSA-gcqx-w48m-w2h4'), 'GHSA suppression missing');
  assert.strictEqual(/ignoreCves/.test(workspace), false, 'ignoreCves still present');
  assert.strictEqual(/ignoreGhsas/.test(workspace), false, 'ignoreGhsas still present');
  assert.strictEqual(/^auditConfig:/m.test(workspace), false, 'auditConfig block still present');
});

check('.npmrc carries retry and timeout settings', () => {
  assert.ok(fs.existsSync(npmrcPath), '.npmrc missing');
  const npmrc = fs.readFileSync(npmrcPath, 'utf8');
  for (const key of ['fetch-retries', 'fetch-retry-mintimeout', 'fetch-retry-maxtimeout', 'fetch-timeout']) {
    assert.match(npmrc, new RegExp(`^${key}=\\d+$`, 'm'), `${key} missing`);
  }
});

check('.npmrc has no key npm rejects', () => {
  // network-concurrency is pnpm-only; npm warns "Unknown project config" and
  // will fail in a future major, so it must not ship in a shared .npmrc.
  const npmrc = fs.readFileSync(npmrcPath, 'utf8');
  assert.strictEqual(/^network-concurrency=/m.test(npmrc), false, 'network-concurrency present');
});

check('no speed threshold is disabled in .npmrc', () => {
  const npmrc = fs.readFileSync(npmrcPath, 'utf8');
  assert.strictEqual(/strict-peer-dependencies/.test(npmrc), false);
  assert.strictEqual(/speed/i.test(npmrc), false);
});

check('files whitelist cannot exclude source modules by case-insensitive glob', () => {
  // `!**/PLAN*` silently dropped src/mcp/langgraph/nodes/plan.js from the tarball
  // on case-insensitive filesystems, producing "Cannot find module './nodes/plan'"
  // for every global install. Exclusions must be scoped to document extensions.
  const exclusions = pkg.files.filter(f => f.startsWith('!'));
  const unscoped = exclusions.filter(f => /PLAN\*/i.test(f) && !/\.md$/.test(f));
  assert.deepStrictEqual(unscoped, [], `unscoped PLAN globs: ${unscoped.join(', ')}`);
});

check('every langgraph node module is present in the repo', () => {
  const nodesDir = path.join(ROOT, 'src', 'mcp', 'langgraph', 'nodes');
  const required = ['classify', 'plan', 'brief', 'todo', 'dispatch', 'execute', 'review', 'remediate', 'complete', 'budget_exceeded', 'error'];
  for (const name of required) {
    assert.ok(fs.existsSync(path.join(nodesDir, `${name}.js`)), `missing node module: ${name}.js`);
  }
});

check('resolveWebBuildSource signals null when every candidate is stale', () => {
  const { resolveWebBuildSource } = require(path.join(ROOT, 'bin', 'lib', 'runtime_install.js'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_webbuild_'));
  try {
    const buildDir = path.join(tmp, 'apps', 'web', 'build');
    fs.mkdirSync(buildDir, { recursive: true });
    fs.writeFileSync(path.join(buildDir, 'handler.js'), 'x');
    // A version no other candidate can satisfy, so every tree is stale.
    fs.writeFileSync(path.join(buildDir, 'build-meta.json'), JSON.stringify({ version: '0.0.1' }));
    const resolved = resolveWebBuildSource(tmp, '9.9.9');
    assert.strictEqual(resolved, null, `stale tree returned instead of null: ${resolved}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

console.log(failures === 0 ? '\npnpm config migration: OK' : `\npnpm config migration: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
