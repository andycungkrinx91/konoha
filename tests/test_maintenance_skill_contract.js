#!/usr/bin/env node
'use strict';

/**
 * tests/test_maintenance_skill_contract.js — Validate the developer-only maintenance
 * skill contract.
 *
 * The maintenance skill is repo-only: it lives in `.agents/dev-skills/konoha-maintenance`
 * and must never appear under `src/templates/skills` (the deployment source) or
 * `.agents/skills` (a deployment target). The shipped `konoha` skill is validated
 * separately by `tests/test_skill_tree_parity.js` and `tests/test_skill_pointer_budget.js`.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MAINT_DIR = path.join(ROOT, '.agents', 'dev-skills', 'konoha-maintenance');
const MAINT_MD = path.join(MAINT_DIR, 'SKILL.md');

const required = [
  'Konoha MCP',
  'src/templates/skills',
  'excluded from client/global skill sync'
];

async function run() {
  console.log('Running test_maintenance_skill_contract tests...');

  assert.ok(fs.existsSync(MAINT_MD), '.agents/dev-skills/konoha-maintenance/SKILL.md must exist');
  const content = fs.readFileSync(MAINT_MD, 'utf-8');
  const rel = path.relative(ROOT, MAINT_MD);

  const missing = required.filter((item) => !content.toLowerCase().includes(item.toLowerCase()));
  assert.strictEqual(missing.length, 0, `${rel} missing: ${missing.join(', ')}`);

  // Repo-only means repo-only: neither deployment source nor a deployment target.
  assert.ok(
    !fs.existsSync(path.join(ROOT, 'src', 'templates', 'skills', 'konoha-maintenance')),
    'konoha-maintenance must not exist in src/templates/skills (deployment source)'
  );
  assert.ok(
    !fs.existsSync(path.join(ROOT, '.agents', 'skills', 'konoha-maintenance')),
    'konoha-maintenance must not exist in .agents/skills (deployment target)'
  );

  console.log('✓ Maintenance skill contract and repo-only placement passed.');
}

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
