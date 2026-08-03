#!/usr/bin/env node
/**
 * Test file tools router argument normalization and path resolution (C10).
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('Running test_file_tools_router.js...');

const router = require('../src/file_tools_router');
assert.strictEqual(typeof router.resolveInputPath, 'function', 'resolveInputPath should be exported');
assert.strictEqual(typeof router.getWorkspaceRoot, 'function', 'getWorkspaceRoot should be exported');
assert.strictEqual(typeof router.setWorkspaceRoot, 'function', 'setWorkspaceRoot should be exported');

// Test resolveInputPath with flexible parameters
const sampleFile = path.join(__dirname, 'test_file_tools_router.js');

const p1 = router.resolveInputPath({ path: sampleFile });
assert.strictEqual(p1, sampleFile, 'Should resolve { path }');

const p2 = router.resolveInputPath({ file_path: sampleFile });
assert.strictEqual(p2, sampleFile, 'Should resolve { file_path }');

const p3 = router.resolveInputPath({ filepath: sampleFile });
assert.strictEqual(p3, sampleFile, 'Should resolve { filepath }');

console.log('  ✓ file_tools_router parameter resolution verified.');

console.log('All tests in test_file_tools_router.js passed!\n');
