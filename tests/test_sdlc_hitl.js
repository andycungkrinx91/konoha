#!/usr/bin/env node
'use strict';

/**
 * tests/test_sdlc_hitl.js
 * Unit and integration tests for Configurable Two-Stage HITL Mode (Workstream B).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_sdlc_hitl_'));
const dbPath = path.join(tmpDir, 'test.db');
process.env.KONOHA_DB_PATH = dbPath;

const db = require('../src/db');
db.DB_PATH = dbPath;
const initConn = db.getConnection(dbPath);
db.setupSchema(initConn);
initConn.close();

const sdlc = require('../src/sdlc_manager');

console.log('Running test_sdlc_hitl tests...');

try {
  // 1. Default hitl_mode is enabled
  const config1 = sdlc.getProjectSdlcConfig(tmpDir, dbPath);
  assert.strictEqual(config1.hitl_mode, 'enabled', 'Default hitl_mode must be "enabled"');
  console.log('  ✓ Default hitl_mode verified as "enabled".');

  // 2. Set hitl_mode to disabled (autonomous)
  const updated1 = sdlc.setProjectSdlcConfig(tmpDir, { hitl_mode: 'disabled' }, dbPath);
  assert.strictEqual(updated1.hitl_mode, 'disabled', 'hitl_mode should be updated to "disabled"');
  const readBack1 = sdlc.getProjectSdlcConfig(tmpDir, dbPath);
  assert.strictEqual(readBack1.hitl_mode, 'disabled');
  console.log('  ✓ setProjectSdlcConfig successfully set hitl_mode to "disabled".');

  // 3. Set hitl_mode back to enabled
  const updated2 = sdlc.setProjectSdlcConfig(tmpDir, { hitl_mode: 'enabled' }, dbPath);
  assert.strictEqual(updated2.hitl_mode, 'enabled');
  console.log('  ✓ setProjectSdlcConfig successfully restored hitl_mode to "enabled".');

  // 4. CLI command: konoha project set hitl-mode disabled
  const cliRes = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'bin', 'cli.js'),
    'project', 'set', 'hitl-mode', 'disabled', tmpDir
  ], {
    env: { ...process.env, KONOHA_DB_PATH: dbPath },
    encoding: 'utf8'
  });
  assert.strictEqual(cliRes.status, 0, `CLI project set failed: ${cliRes.stderr}`);
  const cliReadBack = sdlc.getProjectSdlcConfig(tmpDir, dbPath);
  assert.strictEqual(cliReadBack.hitl_mode, 'disabled');
  console.log('  ✓ CLI command "konoha project set hitl-mode disabled" updated database.');

} finally {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
}

console.log('\nAll test_sdlc_hitl tests passed cleanly!');
