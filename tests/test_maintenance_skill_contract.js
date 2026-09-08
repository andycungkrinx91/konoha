#!/usr/bin/env node
'use strict';

/**
 * tests/test_maintenance_skill_contract.js — Validate the developer-only maintenance skill contract across copies.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILES = [
  path.join(ROOT, 'src', 'templates', 'skills', 'konoha', 'SKILL.md'),
  path.join(ROOT, '.agents', 'skills', 'konoha', 'SKILL.md'),
  path.join(ROOT, '.cursor', 'skills', 'konoha', 'SKILL.md')
];

const required = [
  'Konoha MCP',
  'Semble MCP',
  'RTK',
  'master',
  'andycungkrinx91.konoha-bridge-master-universal',
  'Konoha does not maintain filesystem mirrors',
  'all discovered tests pass'
];

async function run() {
  console.log('Running test_maintenance_skill_contract tests...');

  for (const filePath of FILES) {
    const rel = path.relative(ROOT, filePath);
    assert.ok(fs.existsSync(filePath), `${rel} must exist`);
    const content = fs.readFileSync(filePath, 'utf-8');

    const missing = required.filter(item => !content.includes(item));
    assert.strictEqual(missing.length, 0, `${rel} missing: ${missing.join(', ')}`);

    assert.ok(!content.includes('Cursor skills mirror'), `${rel} still advertises a Cursor mirror gate`);
    assert.ok(!content.includes('pinned to `v1.2.0`'), `${rel} still advertises the obsolete bridge pin`);
  }

  console.log('✓ Maintenance skill contract and deployment copies passed.');
}

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
