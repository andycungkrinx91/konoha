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

// Verify managed file manifest passes check
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

// Verify scripts/lib/data.json does not contain older versions in release badges
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

// Verify CONTRACT_VERSION in src/agent_contract.js matches package.json
const agentContract = require('../src/agent_contract');
assert.strictEqual(
  agentContract.CONTRACT_VERSION,
  currentVersion,
  `CONTRACT_VERSION (${agentContract.CONTRACT_VERSION}) must match package.json (${currentVersion})`
);

// Verify that specific active-version claims match package.json v2.2.24.
// These are the exact rows the advisory requires updated before the doc audit can close:
const CLAIMS = [
  { path: 'docs/README.md', regex: /Capability to file to tool mapping for v(\d+\.\d+\.\d+)/, label: 'capability row' },
  { path: 'docs/README.md', regex: /\| v(\d+\.\d+\.\d+) ingress, auth/, label: 'security row' },
  { path: 'docs/SECURITY.md', regex: /# Konoha MCP Security Architecture & Ingress Controls \(v(\d+\.\d+\.\d+)\)/, label: 'SECURITY title' },
];
const claimDrift = [];
for (const c of CLAIMS) {
  const full = path.join(ROOT_DIR, c.path);
  const content = fs.readFileSync(full, 'utf8');
  const match = content.match(c.regex);
  assert.ok(match, `Required claim "${c.label}" missing in ${c.path}`);
  if (match[1] !== currentVersion) {
    claimDrift.push(`${c.path} (${c.label}) claims ${match[1]}`);
  }
}
assert.deepStrictEqual(claimDrift, [], `All active-version claims must match v${currentVersion}`);
console.log(`  ✓ ${CLAIMS.length} required-version claims match v${currentVersion}`);

console.log(`\n✅ Version consistency verified across all ${manifest.length} targets at v${currentVersion}!`);
