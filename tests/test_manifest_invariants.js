#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Running test_manifest_invariants: verifying package manifest invariants...');

const rootDir = path.resolve(__dirname, '..');
const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const webPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'apps', 'web', 'package.json'), 'utf8'));

// 1. Root package.json devDependencies invariant (empty for zero root dev-footprint)
const rootDevDeps = rootPkg.devDependencies || {};
assert.strictEqual(
  Object.keys(rootDevDeps).length,
  0,
  `Root devDependencies must be empty, found: ${Object.keys(rootDevDeps).join(', ')}`
);
console.log('✓ Root package.json devDependencies is empty ({})');

// 2. Root package.json dependencies invariant (only Bridge Gateway @bufbuild/protobuf allowed)
const rootDeps = rootPkg.dependencies || {};
const allowedRootDeps = ['@bufbuild/protobuf'];
const actualRootDeps = Object.keys(rootDeps);
for (const dep of actualRootDeps) {
  assert.ok(
    allowedRootDeps.includes(dep),
    `Unexpected root dependency: ${dep}. Only ${allowedRootDeps.join(', ')} permitted.`
  );
}
console.log('✓ Root package.json dependencies verified (only protected Bridge Gateway protobuf present)');

// 3. Apps/web package.json zero runtime dependency invariant
const webDeps = webPkg.dependencies || {};
assert.strictEqual(
  Object.keys(webDeps).length,
  0,
  `apps/web runtime dependencies must be empty ({}), found: ${Object.keys(webDeps).join(', ')}`
);
console.log('✓ apps/web/package.json has 0 runtime dependencies');

// 4. Verify no optionalDependencies or peerDependencies in manifests
assert.ok(!rootPkg.optionalDependencies || Object.keys(rootPkg.optionalDependencies).length === 0);
assert.ok(!rootPkg.peerDependencies || Object.keys(rootPkg.peerDependencies).length === 0);
assert.ok(!webPkg.optionalDependencies || Object.keys(webPkg.optionalDependencies).length === 0);
assert.ok(!webPkg.peerDependencies || Object.keys(webPkg.peerDependencies).length === 0);
console.log('✓ Zero optionalDependencies and zero peerDependencies verified');

// 5. Verify SvelteKit production build output exists
assert.ok(fs.existsSync(path.join(rootDir, 'apps', 'web', 'build', 'index.js')), 'apps/web/build/index.js must exist');
console.log('✓ SvelteKit Web UI production build artifacts verified');

console.log('\nAll test_manifest_invariants checks passed successfully!');
