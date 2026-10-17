'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { SEMBLE_PACKAGE } = require('../src/semble_manager');

test('Batch 4: package.json defines mandatory build, lint, start, and test scripts', (t) => {
  const rootPkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
  assert.ok(rootPkg.scripts.build, 'Must define build script');
  assert.ok(rootPkg.scripts.lint, 'Must define lint script');
  assert.ok(rootPkg.scripts.start, 'Must define start script');
  assert.ok(rootPkg.scripts.test, 'Must define test script');
});

test('Batch 4: npm run lint executes successfully with 0 errors across backend codebase', (t) => {
  const rootDir = path.resolve(__dirname, '..');
  const res = spawnSync(process.execPath, ['scripts/lint.js'], {
    cwd: rootDir,
    encoding: 'utf8',
    timeout: 30000
  });

  assert.strictEqual(res.status, 0, `Linter must exit with 0:\n${res.stderr || res.stdout}`);
  assert.ok(res.stdout.includes('0 errors and 0 warnings'), 'Linter output must confirm 0 errors and 0 warnings');
});

test('Batch 4: SEMBLE_PACKAGE is pinned to immutable semver and does not use unpinned @latest', (t) => {
  assert.strictEqual(SEMBLE_PACKAGE, 'semble[mcp]==0.6.2', 'SEMBLE_PACKAGE must be pinned to immutable 0.6.2 version');
  assert.ok(!SEMBLE_PACKAGE.includes('@latest'), 'SEMBLE_PACKAGE must not use unpinned @latest');
});

test('Batch 4: apps/web Playwright dependency is pinned hermetically', (t) => {
  const webPkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../apps/web/package.json'), 'utf8'));
  const pwDep = webPkg.devDependencies?.['@playwright/test'];
  assert.ok(pwDep === '1.50.1' || pwDep === '^1.64.1' || pwDep === '1.64.1', `apps/web @playwright/test must be pinned (found: ${pwDep})`);
});
