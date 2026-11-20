'use strict';

/**
 * Focused persistence test: bridge stream-usage overrides must round-trip
 * through setStreamUsage/listBridges as true, false, or cleared (null/auto).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_test_bridge_stream_usage_'));
const testDbPath = path.join(sandboxDir, 'skills.db');

process.env.KONOHA_DB_PATH = testDbPath;
const db = require('../src/db');
db.DB_PATH = testDbPath;

const dbBridges = require('../src/db_bridges');

test('bridge stream usage persists true/false/null round-trips', async (t) => {
  t.after(() => {
    try { fs.rmSync(sandboxDir, { recursive: true, force: true }); } catch (_) {}
  });

  dbBridges.getDbConnection(testDbPath).close();
  dbBridges.upsertBridge({
    name: 'stream-usage-bridge',
    port: 11490,
    provider: 'openai',
    enabled: true
  }, testDbPath);

  const find = () => dbBridges.listBridges(testDbPath).find(b => b.name === 'stream-usage-bridge');

  await t.test('auto by default (no explicit override stored)', () => {
    const bridge = find();
    assert.ok(bridge, 'bridge must exist');
    assert.strictEqual(bridge.supportsStreamUsage, undefined);
  });

  await t.test('true round-trips', () => {
    const stored = dbBridges.setStreamUsage('stream-usage-bridge', true, testDbPath);
    assert.strictEqual(stored, 1);
    assert.strictEqual(find().supportsStreamUsage, true);
  });

  await t.test('false round-trips', () => {
    const stored = dbBridges.setStreamUsage('stream-usage-bridge', false, testDbPath);
    assert.strictEqual(stored, 0);
    assert.strictEqual(find().supportsStreamUsage, false);
  });

  await t.test('null clears override back to auto', () => {
    const stored = dbBridges.setStreamUsage('stream-usage-bridge', null, testDbPath);
    assert.strictEqual(stored, null);
    assert.strictEqual(find().supportsStreamUsage, undefined);
  });

  await t.test('auto string also clears override', () => {
    dbBridges.setStreamUsage('stream-usage-bridge', true, testDbPath);
    const stored = dbBridges.setStreamUsage('stream-usage-bridge', 'auto', testDbPath);
    assert.strictEqual(stored, null);
    assert.strictEqual(find().supportsStreamUsage, undefined);
  });

  await t.test('unknown bridge throws', () => {
    assert.throws(
      () => dbBridges.setStreamUsage('no-such-bridge', true, testDbPath),
      /not found/i
    );
  });
});

test('reopening a pre-override database adds supports_stream_usage', (t) => {
  const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_test_legacy_bridges_'));
  const legacyDbPath = path.join(legacyDir, 'skills.db');
  t.after(() => {
    try { fs.rmSync(legacyDir, { recursive: true, force: true }); } catch (_) {}
  });

  const conn = db.getConnection(legacyDbPath, false);
  db.setupSchema(conn);
  // Simulate a database written before the override column existed.
  conn.exec(`
    ALTER TABLE bridges RENAME TO bridges_legacy;
    CREATE TABLE bridges (
      name TEXT PRIMARY KEY, port INTEGER NOT NULL, provider TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, target_url TEXT, api_key TEXT
    );
    INSERT INTO bridges SELECT name, port, provider, enabled, target_url, api_key FROM bridges_legacy;
    DROP TABLE bridges_legacy;
  `);
  conn.close();

  // ensureSchema fast-paths on user_version, so a stale column must force it.
  const reopened = db.getConnection(legacyDbPath, false);
  db.ensureSchema(reopened);
  const columns = reopened.prepare('PRAGMA table_info(bridges)').all().map((c) => c.name);
  reopened.close();

  assert.ok(columns.includes('supports_stream_usage'), 'legacy bridge rows must gain the override column');
});
