#!/usr/bin/env node
// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

/**
 * Verifies task records carry client attribution so the Tasks UI can show
 * which coding client produced each task.
 */

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const dbmod = require('../src/db');
const sdlc = require('../src/workflow/kage-reviewer/sdlc_manager');

const tmpDb = path.join(os.tmpdir(), `konoha-client-attr-${Date.now()}.db`);
const conn = dbmod.getConnection(tmpDb, false);
dbmod.setupSchema(conn);
conn.close();

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  PASS ${name}`); }
  catch (e) { failed += 1; console.log(`  FAIL ${name}: ${e.message}`); }
}

console.log('task client attribution');

test('explicit client is preserved verbatim', () => {
  const t = sdlc.createTask({ description: 'cursor work', client: 'cursor' }, tmpDb);
  assert.strictEqual(t.client, 'cursor');
});

test('client is auto-detected when not supplied', () => {
  const t = sdlc.createTask({ description: 'auto detected' }, tmpDb);
  assert.ok(t.client && t.client.length > 0, 'client must not be empty; detection regressed');
});

test('source never reaches for a non-existent helper module', () => {
  const src = fs.readFileSync(require.resolve('../src/workflow/kage-reviewer/sdlc_manager'), 'utf8');
  assert.ok(
    !/client_detection'\);\s*\n\s*return cd\.getActiveClient\(\)/.test(src),
    'getActiveClient must not be called on client_detection'
  );
});

test('runtime_state is the source of the active client', () => {
  const src = fs.readFileSync(require.resolve('../src/workflow/kage-reviewer/sdlc_manager'), 'utf8');
  assert.ok(src.includes('runtime_state'), 'client resolution must consult runtime_state');
});

console.log(`\n${passed} passed, ${failed} failed`);
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(tmpDb + suffix, { force: true });
if (failed > 0) process.exit(1);
