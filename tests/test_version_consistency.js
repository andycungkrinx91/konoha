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

// Active version claims are DISCOVERED, not listed: a doc, badge, mirror or
// architecture intro that asserts a release version is found by shape, so a new
// one is covered the day it lands. Historical records (CHANGELOG, docs/archive,
// dated reports, plans, tests) and third-party examples are excluded by the
// module's rules; see scripts/lib/version_claims.js.
const { discoverVersionClaims, claimDrift } = require('../scripts/lib/version_claims');

const claims = discoverVersionClaims({ rootDir: ROOT_DIR });
assert.ok(claims.length >= 20, `Discovery must find the repository's claims (found ${claims.length})`);

const claimFiles = new Set(claims.map((c) => c.path));
// A claim path is a repo path, not a filesystem path: the same tree must yield
// the same spelling on every host. Building them with `path.join` produced
// `docs\SECURITY.md` on Windows and made every forward-slash comparison miss.
for (const claim of claims) {
  assert.ok(!claim.path.includes('\\'), `claim path must use POSIX separators: ${claim.path}`);
  assert.strictEqual(claim.path, path.posix.normalize(claim.path), `claim path must be normalized: ${claim.path}`);
}
for (const required of ['README.md', 'docs/SECURITY.md', 'docs/MANUAL.md', 'docs/README.md', 'src/agent_contract.js']) {
  assert.ok(claimFiles.has(required), `Discovery must cover ${required}`);
}

const drift = claimDrift(currentVersion, { rootDir: ROOT_DIR });
assert.deepStrictEqual(
  drift.map((c) => `${c.path}:${c.line} [${c.label}] claims ${c.version}`),
  [],
  `Every active version claim must match v${currentVersion}`
);
console.log(`  ✓ ${claims.length} discovered claims across ${claimFiles.size} files match v${currentVersion}`);

// Excluded material must not be scanned: a stale claim there is a record, not drift.
for (const claim of claims) {
  assert.ok(!claim.path.startsWith('docs/archive'), `docs/archive must be excluded: ${claim.path}`);
  assert.ok(!claim.path.startsWith('.omp'), `.omp plans must be excluded: ${claim.path}`);
  assert.ok(!claim.path.startsWith('tests'), `tests must be excluded: ${claim.path}`);
  assert.notStrictEqual(claim.path, 'CHANGELOG.md', 'CHANGELOG must be excluded');
}

// Prose that records when something landed is not a claim about the current release.
const securityProse = claims.filter((c) => c.path === 'docs/SECURITY.md');
assert.ok(
  securityProse.every((c) => !/removed in|permanently removed|additions/i.test(c.text)),
  'historical "removed in vX" prose must not be treated as an active claim'
);

// The check must actually fail on drift: prove it against a throwaway tree
// rather than trusting a green run on a clean repository.
const os = require('os');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_claims_'));
try {
  fs.mkdirSync(path.join(tmpRoot, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'docs', 'archive'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'README.md'), '<img alt="Release v1.2.3">\n', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'docs', 'SECURITY.md'), '# Konoha MCP Security Architecture & Ingress Controls (v1.2.3)\n', 'utf8');
  fs.mkdirSync(path.join(tmpRoot, 'docs', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'docs', 'nested', 'DEEP.md'), '# Deep Nested Controls (v1.2.3)\n', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'docs', 'archive', 'OLD.md'), '# Konoha MCP Security Architecture & Ingress Controls (v0.0.1)\n', 'utf8');

  const found = claimDrift('9.9.9', { rootDir: tmpRoot });
  // Forward-slash literals, not `path.join`: a nested file must be reported as
  // `docs/nested/DEEP.md` on Windows too, which is the assertion that broke.
  assert.deepStrictEqual(
    found.map((c) => c.path).sort(),
    ['README.md', 'docs/SECURITY.md', 'docs/nested/DEEP.md'],
    'discovery must report live claims with POSIX paths and ignore archived ones'
  );
  console.log('  ✓ discovery reports drift outside the managed manifest and skips archives');
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log(`\n✅ Version consistency verified across all ${manifest.length} targets at v${currentVersion}!`);
