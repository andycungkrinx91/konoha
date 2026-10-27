'use strict';

/**
 * tests/test_version_consistency.js — Verifies complete version synchronization
 * across all manifests, contract headers, documentation, badges, and fixtures.
 * Auto-discovered and run by tests/run_all.js.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { getManagedFileList, ROOT_DIR } = require('../scripts/bump_version');

console.log('Running test_version_consistency.js...');

const pkgPath = path.join(ROOT_DIR, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const currentVersion = pkg.version;

assert.ok(currentVersion, 'package.json must declare version');
assert.match(currentVersion, /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/, 'Version must be semver');

// 1. Verify managed file manifest passes check
const manifest = getManagedFileList(currentVersion);
for (const item of manifest) {
  const full = path.join(ROOT_DIR, item.path);
  assert.ok(fs.existsSync(full), `Managed file must exist: ${item.path}`);
  const content = fs.readFileSync(full, 'utf8');
  assert.ok(
    item.check(content),
    `File ${item.path} failed consistency check for version v${currentVersion}`
  );
  console.log(`  ✓ ${item.path} verified at v${currentVersion}`);
}

// 2. Verify scripts/lib/data.json does not contain older versions in release badges
const dataJsonPath = path.join(ROOT_DIR, 'scripts', 'lib', 'data.json');
if (fs.existsSync(dataJsonPath)) {
  const dataContent = fs.readFileSync(dataJsonPath, 'utf8');
  assert.ok(
    !dataContent.includes('konoha-mcp@2.2.10'),
    'scripts/lib/data.json must not retain stale 2.2.10 package literals'
  );
  assert.ok(
    !dataContent.includes('RELEASE v2.2.10'),
    'scripts/lib/data.json must not retain stale RELEASE v2.2.10 badges'
  );
}

// 3. Verify CONTRACT_VERSION in src/agent_contract.js matches package.json
const agentContract = require('../src/agent_contract');
assert.strictEqual(
  agentContract.CONTRACT_VERSION,
  currentVersion,
  `CONTRACT_VERSION (${agentContract.CONTRACT_VERSION}) must match package.json (${currentVersion})`
);

console.log(`\n✅ Version consistency verified across all ${manifest.length} targets at v${currentVersion}!`);
