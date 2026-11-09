#!/usr/bin/env node
'use strict';

/**
 * tests/test_postinstall_contract.js
 *
 * A global install must tell the user what to do next, and must not do it for
 * them: the postinstall hook is wired, prints the three distinct invocation
 * modes, performs no network access, and writes nothing under HOME.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

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

check('postinstall hook is wired', () => {
  assert.strictEqual(pkg.scripts.postinstall, 'node bin/postinstall.js');
});

check('postinstall is included in the published files', () => {
  assert.ok(pkg.files.includes('bin/'), 'bin/ not in files whitelist');
});

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_postinstall_'));
try {
  const before = fs.readdirSync(home).sort();
  const result = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'postinstall.js')], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
    timeout: 60000
  });
  const after = fs.readdirSync(home).sort();

  check('postinstall exits 0', () => {
    assert.strictEqual(result.status, 0, result.stderr);
  });

  check('postinstall documents all three invocation modes', () => {
    assert.match(result.stdout, /konoha init --yes/);
    assert.match(result.stdout, /konoha upgrade/);
    assert.match(result.stdout, /npm exec --yes --package=konoha-mcp@latest -- konoha --version/);
  });

  check('postinstall writes nothing under HOME', () => {
    assert.deepStrictEqual(after, before, `created: ${after.filter(f => !before.includes(f)).join(', ')}`);
  });

  check('postinstall makes no network calls', () => {
    const src = fs.readFileSync(path.join(ROOT, 'bin', 'postinstall.js'), 'utf8');
    assert.strictEqual(/https?:\/\//.test(src), false, 'URL literal present');
    assert.strictEqual(/\bfetch\s*\(/.test(src), false, 'fetch call present');
    assert.strictEqual(/require\(['"](node:)?(http|https|net)['"]\)/.test(src), false, 'network module required');
  });

  check('postinstall does not install packages', () => {
    const src = fs.readFileSync(path.join(ROOT, 'bin', 'postinstall.js'), 'utf8');
    assert.strictEqual(/install\s+-g|npx\s+i\s+-g/.test(src), false, 'global install invoked from postinstall');
  });
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(failures === 0 ? '\npostinstall contract: OK' : `\npostinstall contract: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
