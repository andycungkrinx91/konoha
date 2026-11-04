#!/usr/bin/env node
// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

/**
 * Verifies the doctor reports every supported coding client plus the 3D
 * pipeline, and that no client silently drops out of the audit.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const doctor = require('../src/doctor');
const { SUPPORTED_CLIENTS } = require('../src/agent_manager');
const doctor3d = require('../src/doctor_3d');

const report = doctor.getDiagnostics();
const rows = Array.isArray(report) ? report : (report.checks || report.results || []);
const components = rows.map((r) => r.component || r.name || '');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  PASS ${name}`); }
  catch (e) { failed += 1; console.log(`  FAIL ${name}: ${e.message}`); }
}

// Each client's doctor row is keyed by a distinctive product name.
const CLIENT_ROW_HINTS = {
  antigravity: 'Antigravity',
  cursor: 'Cursor',
  claude: 'Claude Code',
  opencode: 'OpenCode',
  commandcode: 'Command Code',
  codex: 'Codex',
  pi: 'Pi ',
  omp: 'OMP'
};

const TUI_DOCTOR = path.join(__dirname, '..', 'bin', 'commands', 'doctor_clients.js');
const tuiSrc = fs.readFileSync(TUI_DOCTOR, 'utf8');
const WEB_DOCTOR = path.join(__dirname, '..', 'src', 'doctor.js');
const webSrc = fs.readFileSync(WEB_DOCTOR, 'utf8');

function surfaceNamesRow(src, hint) {
  return src.includes(`${hint}`);
}

console.log('doctor coverage');

test('all eight supported clients have a doctor row', () => {
  const missing = Object.keys(CLIENT_ROW_HINTS).filter(
    (client) => !components.some((c) => c.includes(CLIENT_ROW_HINTS[client]))
  );
  assert.deepStrictEqual(missing, [], `clients missing from doctor: ${missing.join(', ')}`);
});

test('client hint table matches SUPPORTED_CLIENTS exactly', () => {
  assert.deepStrictEqual(Object.keys(CLIENT_ROW_HINTS).sort(), [...SUPPORTED_CLIENTS].sort());
});

test('3D pipeline is audited', () => {
  for (const needle of ['3D Deterministic Generator', '3D Blender Refinement', '3D Output Directory']) {
    assert.ok(components.includes(needle), `missing doctor row: ${needle}`);
  }
});

test('3D status is probed, not hardcoded', () => {
  const status = doctor3d.get3DStatus();
  assert.strictEqual(typeof status.blender.installed, 'boolean');
  assert.strictEqual(typeof status.dcc_mcp.installed, 'boolean');
  assert.ok('version' in status.blender);
});

test('3D rows never claim HEALTHY for a missing Blender', () => {
  const row = rows.find((r) => (r.component || '') === '3D Blender Refinement');
  assert.ok(row, 'row missing');
  const status = doctor3d.get3DStatus();
  if (!status.blender.installed || !status.dcc_mcp.installed) {
    assert.strictEqual(row.status, 'NOT INSTALLED');
  } else {
    assert.strictEqual(row.status, 'HEALTHY');
  }
});

test('no live UI copy still claims seven coding clients', () => {
  const file = path.join(__dirname, '..', 'apps', 'web', 'src', 'components', 'Doctor.svelte');
  const src = fs.readFileSync(file, 'utf8');
  assert.ok(!/7 coding IDEs/.test(src), 'Doctor.svelte still contains a stale client count');
});

test('TUI doctor audits every supported client', () => {
  const missing = Object.keys(CLIENT_ROW_HINTS).filter((client) => !surfaceNamesRow(tuiSrc, CLIENT_ROW_HINTS[client]));
  assert.deepStrictEqual(missing, [], `clients missing from TUI doctor: ${missing.join(', ')}`);
});

test('TUI doctor audits the 3D pipeline', () => {
  assert.ok(tuiSrc.includes('record3DChecks'), 'TUI doctor must call the shared 3D check');
  assert.ok(tuiSrc.includes('check3DReadiness'));
});

test('both doctor surfaces share one 3D implementation', () => {
  assert.ok(webSrc.includes('doctor_3d'), 'web doctor must use src/doctor_3d.js');
  assert.ok(tuiSrc.includes('doctor_3d'), 'TUI doctor must use src/doctor_3d.js');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
