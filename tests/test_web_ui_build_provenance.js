// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

// A Web UI build is only installable when its own build-meta.json declares the version
// being installed. `handler.js` proves a tree was built; the destination package.json is
// copied from the source manifest, so neither says which source produced the artifact.
// Every case below pins one way that distinction can be lost.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  resolveWebBuildSource,
  readBuildMeta,
  readBuildVersion,
  _syncWebBuildOutput,
  shouldBuildWebUiOnDemand
} = require('../bin/lib/runtime_install');

const VERSION = '2.2.23';
const tempDirs = [];

function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeBuild(dir, { handler = true, metaJson } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  if (handler) fs.writeFileSync(path.join(dir, 'handler.js'), 'export const handler = () => {};\n');
  if (metaJson !== undefined) {
    fs.writeFileSync(
      path.join(dir, 'build-meta.json'),
      typeof metaJson === 'string' ? metaJson : JSON.stringify(metaJson, null, 2)
    );
  }
  return dir;
}

// The installer reports through `process.stdout.write` (bin/lib/format.js), not
// console.log, so capture at the stream level.
function captureLog(fn) {
  const original = process.stdout.write;
  const lines = [];
  process.stdout.write = (chunk) => { lines.push(String(chunk)); return true; };
  try {
    const value = fn();
    return { value, output: lines.join('') };
  } finally {
    process.stdout.write = original;
  }
}

const cases = [];

function check(name, fn) {
  try {
    fn();
    cases.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    cases.push({ name, ok: false, err });
    console.log(`  ✖ ${name}: ${err.message}`);
  }
}

function verifyReadBuildMeta() {
  check('readBuildMeta rejects a missing build-meta.json', () => {
    const dir = makeBuild(path.join(tempDir('konoha_prov_'), 'build'));
    const meta = readBuildMeta(dir);
    assert.strictEqual(meta.ok, false);
    assert.match(meta.reason, /missing build-meta\.json/);
    assert.strictEqual(readBuildVersion(dir), null);
  });

  check('readBuildMeta rejects unparsable metadata', () => {
    const dir = makeBuild(path.join(tempDir('konoha_prov_'), 'build'), { metaJson: '{' });
    assert.strictEqual(readBuildMeta(dir).ok, false);
  });

  check('readBuildMeta rejects metadata without a string version', () => {
    const dir = makeBuild(path.join(tempDir('konoha_prov_'), 'build'), { metaJson: { builtAt: 'x' } });
    assert.strictEqual(readBuildMeta(dir).ok, false);
    assert.strictEqual(readBuildVersion(dir), null);
  });

  check('readBuildMeta accepts a declared version', () => {
    const dir = makeBuild(path.join(tempDir('konoha_prov_'), 'build'), { metaJson: { version: VERSION, builtAt: '2026-11-19T00:00:00Z' } });
    const meta = readBuildMeta(dir);
    assert.strictEqual(meta.ok, true);
    assert.strictEqual(meta.version, VERSION);
    assert.strictEqual(meta.builtAt, '2026-11-19T00:00:00Z');
  });
}

function verifyResolveWebBuildSource() {
  check('case 1: a build without metadata is not a source', () => {
    const dir = makeBuild(path.join(tempDir('konoha_prov_'), 'build'));
    assert.strictEqual(resolveWebBuildSource(tempDir('konoha_prov_root_'), VERSION, [dir]), null);
  });

  check('case 2: invalid JSON metadata is not a source', () => {
    const dir = makeBuild(path.join(tempDir('konoha_prov_'), 'build'), { metaJson: '{' });
    assert.strictEqual(resolveWebBuildSource(tempDir('konoha_prov_root_'), VERSION, [dir]), null);
  });

  check('case 3: metadata without a version is not a source', () => {
    const dir = makeBuild(path.join(tempDir('konoha_prov_'), 'build'), { metaJson: { builtAt: 'x' } });
    assert.strictEqual(resolveWebBuildSource(tempDir('konoha_prov_root_'), VERSION, [dir]), null);
  });

  check('case 4: a stale build is rejected and says why', () => {
    const dir = makeBuild(path.join(tempDir('konoha_prov_'), 'build'), { metaJson: { version: '2.2.22' } });
    const { value, output } = captureLog(() => resolveWebBuildSource(tempDir('konoha_prov_root_'), VERSION, [dir]));
    assert.strictEqual(value, null);
    assert.match(output, /Skipping stale Web UI build 2\.2\.22/);
  });

  check('case 5: a matching build is the source', () => {
    const dir = makeBuild(path.join(tempDir('konoha_prov_'), 'build'), { metaJson: { version: VERSION } });
    assert.strictEqual(resolveWebBuildSource(tempDir('konoha_prov_root_'), VERSION, [dir]), dir);
  });

  check('case 6: an unverified candidate does not shadow a verified one', () => {
    const root = tempDir('konoha_prov_root_');
    const unverified = makeBuild(path.join(tempDir('konoha_prov_'), 'build'));
    const verified = makeBuild(path.join(tempDir('konoha_prov_'), 'build'), { metaJson: { version: VERSION } });
    const { value } = captureLog(() => resolveWebBuildSource(root, VERSION, [unverified, verified]));
    assert.strictEqual(value, verified);
  });

  check('case 7: metadata without handler.js is not a source', () => {
    const dir = makeBuild(path.join(tempDir('konoha_prov_'), 'build'), { handler: false, metaJson: { version: VERSION } });
    assert.strictEqual(resolveWebBuildSource(tempDir('konoha_prov_root_'), VERSION, [dir]), null);
  });
}

function verifySyncWebBuildOutput() {
  const snapshot = (dest) => ({
    meta: fs.readFileSync(path.join(dest, 'build-meta.json'), 'utf8'),
    handler: fs.readFileSync(path.join(dest, 'handler.js'), 'utf8')
  });

  check('case 8: an unverified source never overwrites a valid destination', () => {
    const dest = makeBuild(path.join(tempDir('konoha_prov_dest_'), 'build'), { metaJson: { version: VERSION } });
    const destPkg = path.join(path.dirname(dest), 'package.json');
    fs.writeFileSync(destPkg, JSON.stringify({ name: 'konoha-web', version: VERSION }, null, 2));
    const before = snapshot(dest);
    const src = makeBuild(path.join(tempDir('konoha_prov_src_'), 'build'));
    const result = captureLog(() => _syncWebBuildOutput(src, dest, destPkg, VERSION)).value;
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(snapshot(dest), before, 'the destination must be byte-identical after a rejected sync');
  });

  check('case 9: a stale source never overwrites a valid destination', () => {
    const dest = makeBuild(path.join(tempDir('konoha_prov_dest_'), 'build'), { metaJson: { version: VERSION } });
    const destPkg = path.join(path.dirname(dest), 'package.json');
    fs.writeFileSync(destPkg, JSON.stringify({ name: 'konoha-web', version: VERSION }, null, 2));
    const before = snapshot(dest);
    const src = makeBuild(path.join(tempDir('konoha_prov_src_'), 'build'), { metaJson: { version: '2.2.22' } });
    const result = captureLog(() => _syncWebBuildOutput(src, dest, destPkg, VERSION)).value;
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(snapshot(dest), before, 'the destination must be byte-identical after a stale rejection');
  });

  check('case 10: a verified source installs and stamps its declared version', () => {
    const destRoot = tempDir('konoha_prov_dest_');
    const dest = path.join(destRoot, 'build');
    const destPkg = path.join(destRoot, 'package.json');
    const src = makeBuild(path.join(tempDir('konoha_prov_src_'), 'build'), { metaJson: { version: VERSION } });
    const result = captureLog(() => _syncWebBuildOutput(src, dest, destPkg, VERSION)).value;
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(readBuildMeta(dest), { ok: true, version: VERSION, builtAt: null });
    assert.strictEqual(JSON.parse(fs.readFileSync(destPkg, 'utf8')).version, VERSION);
    assert.ok(fs.existsSync(path.join(dest, 'handler.js')), 'handler.js must be copied');
  });

  check('case 11: source equal to destination is verified in place, not deleted', () => {
    const destRoot = tempDir('konoha_prov_same_');
    const dest = makeBuild(path.join(destRoot, 'build'), { metaJson: { version: VERSION, builtAt: 'fixed' } });
    const destPkg = path.join(destRoot, 'package.json');
    const before = snapshot(dest);
    const result = captureLog(() => _syncWebBuildOutput(dest, dest, destPkg, VERSION)).value;
    assert.strictEqual(result.ok, true);
    assert.ok(fs.existsSync(path.join(dest, 'handler.js')));
    assert.deepStrictEqual(snapshot(dest), before);
  });
}

function verifyShouldBuildWebUiOnDemand() {
  check('case 12: copied package.json is not provenance (the reported bug)', () => {
    const dest = makeBuild(path.join(tempDir('konoha_prov_dest_'), 'build'));
    fs.writeFileSync(
      path.join(path.dirname(dest), 'package.json'),
      JSON.stringify({ name: 'konoha-web', version: VERSION, type: 'module', private: true }, null, 2)
    );
    assert.deepStrictEqual(shouldBuildWebUiOnDemand(dest, VERSION), { needed: true, reason: 'provenance-missing' });
  });

  check('case 13: matching metadata keeps the build', () => {
    const dest = makeBuild(path.join(tempDir('konoha_prov_dest_'), 'build'), { metaJson: { version: VERSION } });
    assert.deepStrictEqual(shouldBuildWebUiOnDemand(dest, VERSION), { needed: false, reason: 'verified' });
  });

  check('case 14: stale metadata triggers a build', () => {
    const dest = makeBuild(path.join(tempDir('konoha_prov_dest_'), 'build'), { metaJson: { version: '2.2.22' } });
    assert.deepStrictEqual(shouldBuildWebUiOnDemand(dest, VERSION), { needed: true, reason: 'stale' });
  });

  check('case 15: no handler.js triggers a build', () => {
    const dest = path.join(tempDir('konoha_prov_dest_'), 'build');
    fs.mkdirSync(dest, { recursive: true });
    assert.deepStrictEqual(shouldBuildWebUiOnDemand(dest, VERSION), { needed: true, reason: 'no-handler' });
  });
}

function main() {
  console.log('====================================================');
  console.log('      WEB UI BUILD PROVENANCE VERIFICATION          ');
  console.log('====================================================');
  try {
    verifyReadBuildMeta();
    verifyResolveWebBuildSource();
    verifySyncWebBuildOutput();
    verifyShouldBuildWebUiOnDemand();
  } finally {
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  }

  const failed = cases.filter((c) => !c.ok);
  console.log(`\nWeb UI provenance: ${cases.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length > 0) {
    for (const c of failed) console.error(`✖ ${c.name}: ${c.err && (c.err.stack || c.err.message)}`);
    process.exit(1);
  }
  console.log('✔ Web UI build provenance verified: only a matching build-meta.json is installed');
}

main();
