#!/usr/bin/env node
require('./helpers/isolate_db');
'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const { check3DToolchain, record3DChecks } = require('../src/doctor_3d');

console.log('Running test_doctor_3d_isolation...');

// Verify 5 rows emitted
const rows = [];
check3DToolchain((component, status, details) => {
  rows.push({ component, status, details });
}, false);

assert.strictEqual(rows.length, 5, 'Must emit exactly 5 3D toolchain rows');
const names = rows.map(r => r.component);
assert.ok(names.includes('3D Deterministic Generator'));
assert.ok(names.includes('3D Blender Refinement'));
assert.ok(names.includes('3D DCC-MCP Bridge'));
assert.ok(names.includes('3D Output Directory'));
assert.ok(names.includes('3D GPU Acceleration'));

// Ensure no row is marked FAILED when an optional external tool is absent
for (const r of rows) {
  assert.notStrictEqual(r.status, 'FAILED', `Row ${r.component} must not be marked FAILED for optional tools`);
}
console.log('✓ Exactly 5 rows emitted and no optional tool marked FAILED');

// Test writable output auto-repair in an isolated temporary directory
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_doc3d_'));
const fakeOutputDir = path.join(tmpHome, 'nonexistent_3d_dir');

// Mock storage_manager to return non-existent dir
const storageManager = require('../src/mcp/three_asset/storage_manager');
const origGetOutputRoot = storageManager.getOutputRoot;
storageManager.getOutputRoot = () => fakeOutputDir;

try {
  // First check without repair: must report WARNING
  const warnRows = [];
  check3DToolchain((component, status, details) => {
    if (component === '3D Output Directory') warnRows.push({ component, status, details });
  }, false);

  assert.strictEqual(warnRows.length, 1);
  assert.strictEqual(warnRows[0].status, 'WARNING', 'Missing output dir must report WARNING without repair');
  assert.strictEqual(fs.existsSync(fakeOutputDir), false);

  // Now check with autoRepair: must create dir and report REPAIRED
  const repairRows = [];
  check3DToolchain((component, status, details) => {
    if (component === '3D Output Directory') repairRows.push({ component, status, details });
  }, true);

  assert.strictEqual(repairRows.length, 1);
  assert.strictEqual(repairRows[0].status, 'REPAIRED', 'Missing output dir must report REPAIRED with repair');
  assert.strictEqual(fs.existsSync(fakeOutputDir), true, 'Dir must be created by auto-repair');

  // Next check after repair: must report HEALTHY
  const healthyRows = [];
  check3DToolchain((component, status, details) => {
    if (component === '3D Output Directory') healthyRows.push({ component, status, details });
  }, false);

  assert.strictEqual(healthyRows.length, 1);
  assert.strictEqual(healthyRows[0].status, 'HEALTHY', 'Existing writable dir must report HEALTHY');
  console.log('✓ Auto-repair of missing output directory passed');
} finally {
  storageManager.getOutputRoot = origGetOutputRoot;
  fs.rmSync(tmpHome, { recursive: true, force: true });
}

// Test backwards-compatible record3DChecks
const compatRows = [];
record3DChecks((component, status, details) => {
  compatRows.push({ component, status, details });
});
assert.strictEqual(compatRows.length, 5, 'record3DChecks must emit 5 rows');
console.log('✓ Backward compatibility of record3DChecks verified');

console.log('All test_doctor_3d_isolation assertions passed cleanly!');
