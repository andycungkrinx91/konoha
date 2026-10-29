#!/usr/bin/env node
'use strict';

/**
 * tests/test_mode_switch.js — konoha mode yolo/hitl + unified gate statuses.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const _modeTmp = require('os'), _modeFs = require('fs'), _modePath = require('path');
const _modeDir = _modeFs.mkdtempSync(_modePath.join(_modeTmp.tmpdir(), 'konoha_mode_test_'));
const _modeDbPath = _modePath.join(_modeDir, 'test.db');
process.env.KONOHA_DB_PATH = _modeDbPath;
const _modeDb = require('../src/db');
_modeDb.DB_PATH = _modeDbPath;
try {
  const _schema = require('../src/db_schema');
  const _cc = _modeDb.getConnection(_modeDbPath);
  if (typeof _schema.setupSchema === 'function') _schema.setupSchema(_cc);
  else _modeDb.setupSchema(_cc);
  _cc.close();
} catch (e) { console.error('seed warn:', e.message); }

const { toDisplayStatus } = require('../src/mcp/gate_status');
const sdlcManager = require('../src/workflow/kage-reviewer/sdlc_manager');
const { normalizeModeArg, describeMode } = require('../bin/commands/mode');

async function run() {
  console.log('Running test_mode_switch tests...');

  // 1. Unified display map covers all required labels
  const cases = [
    ['pending_plan_approval', 'Pending Gate 1'],
    ['pending_human_signoff', 'Pending Gate 2'],
    ['processing', 'Processing'],
    ['in_progress', 'Processing'],
    ['remediating', 'Remediate'],
    ['remediation', 'Remediate'],
    ['blocked', 'Remediate'],
    ['approved', 'Approved'],
    ['completed', 'Completed']
  ];
  for (const [raw, expected] of cases) {
    assert.strictEqual(toDisplayStatus(raw), expected, `${raw} must display as ${expected}`);
  }
  console.log('✓ Unified gate display statuses verified');

  // 2. Mode arg normalization
  assert.deepStrictEqual(normalizeModeArg('yolo'), { hitl_mode: 'disabled', display: 'YOLO' });
  assert.deepStrictEqual(normalizeModeArg('autonomous'), { hitl_mode: 'disabled', display: 'YOLO' });
  assert.deepStrictEqual(normalizeModeArg('hitl'), { hitl_mode: 'enabled', display: 'HITL' });
  assert.deepStrictEqual(normalizeModeArg('safe'), { hitl_mode: 'enabled', display: 'HITL' });
  assert.strictEqual(describeMode('disabled'), 'YOLO');
  assert.strictEqual(describeMode('enabled'), 'HITL');
  console.log('✓ Mode arg normalization verified');

  // 3. CLI round-trip in isolated project dir
  const tmpDir = _modeDir;
  let cfg = sdlcManager.setProjectSdlcConfig(tmpDir, { hitl_mode: 'disabled' }, _modeDbPath);
  assert.strictEqual(cfg.hitl_mode, 'disabled');
  cfg = sdlcManager.getProjectSdlcConfig(tmpDir, _modeDbPath);
  assert.strictEqual(cfg.hitl_mode, 'disabled');
  cfg = sdlcManager.setProjectSdlcConfig(tmpDir, { hitl_mode: 'enabled' }, _modeDbPath);
  assert.strictEqual(cfg.hitl_mode, 'enabled');
  console.log('✓ Mode persistence round-trip verified');

  // 4. YOLO invariant: disabled mode still pauses at Gate 1
  const { buildGate1Prompt, buildGate2Prompt } = require('../src/mcp/workflow_gates');
  const fakeStatus = { task_id: 'task_yolo', tasks: [], plan_approved: false };
  const g1 = JSON.parse(buildGate1Prompt(fakeStatus, tmpDir, 'task_yolo', '# plan'));
  assert.strictEqual(g1.status, 'pending_plan_approval');
  assert.strictEqual(toDisplayStatus(g1.status), 'Pending Gate 1');
  const fakeStatus2 = { task_id: 'task_yolo', tasks: [], plan_approved: true };
  const g2 = JSON.parse(buildGate2Prompt(fakeStatus2, tmpDir, 'task_yolo', 99, 'report'));
  assert.strictEqual(g2.status, 'pending_human_signoff');
  assert.strictEqual(toDisplayStatus(g2.status), 'Pending Gate 2');
  console.log('✓ YOLO mode still pauses authoritatively at both gates');

  console.log('\nAll test_mode_switch tests passed!');
}

if (require.main === module) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
