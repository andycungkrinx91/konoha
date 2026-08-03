#!/usr/bin/env node
/**
 * Test file tools router error handling and edge cases.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

console.log('Running test_file_tools_router_errors.js...');

const router = require('../src/file_tools_router');

// Test resolveInputPath with non-existent file (should throw due to path security)
assert.throws(
  () => router.resolveInputPath({ path: '/nonexistent/path/to/file.txt' }),
  /Path outside workspace/,
  'Should throw for paths outside workspace'
);

// Test resolveInputPath with relative path
const relativePath = router.resolveInputPath({ path: './package.json' });
assert.ok(path.isAbsolute(relativePath), 'Should resolve relative path to absolute');
assert.ok(relativePath.endsWith('package.json'), 'Should preserve filename');

// Test resolveInputPath with empty object (should throw)
assert.throws(
  () => router.resolveInputPath({}),
  /path is required/,
  'Should throw for empty input'
);

// Test resolveInputPath with missing path property (should throw)
assert.throws(
  () => router.resolveInputPath({ other: 'value' }),
  /path is required/,
  'Should throw for missing path'
);

// Test getWorkspaceRoot
const workspaceRoot = router.getWorkspaceRoot();
assert.ok(typeof workspaceRoot === 'string', 'Should return string');
assert.ok(workspaceRoot.length > 0, 'Should not be empty');

// Test setWorkspaceRoot and getWorkspaceRoot round-trip
const testDir = path.join(os.tmpdir(), 'konoha-test-workspace');
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true });
}
router.setWorkspaceRoot(testDir);
assert.strictEqual(router.getWorkspaceRoot(), testDir, 'Should round-trip workspace root');

// Cleanup
fs.rmSync(testDir, { recursive: true, force: true });

console.log('  ✓ file_tools_router error handling verified.');
console.log('All tests in test_file_tools_router_errors.js passed!\n');
