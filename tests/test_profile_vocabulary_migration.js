#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Database = require('../src/sqlite_driver');
const {
  applyProfileVocabularyMigration,
  PROFILE_VOCABULARY_MIGRATION_ID
} = require('../src/mcp/three_asset/profile_vocabulary_migration');

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`  \u2713 ${label}`);
}

console.log('Running test_profile_vocabulary_migration.js...');

const NARROW_CHECK = "CHECK (profile IN ('enterprise_pbr', 'realistic'))";

function withTempDb(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-vocab-'));
  const conn = new Database(path.join(dir, 'probe.db'));
  try {
    return fn(conn);
  } finally {
    if (conn && typeof conn.close === 'function') conn.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\n--- 1. Rebuild preserves rows and accepts both profile names ---');
check('legacy enterprise_pbr row survives and both names insert', () => {
  withTempDb((conn) => {
    conn.exec(`CREATE TABLE generation_jobs (id TEXT PRIMARY KEY, profile TEXT NOT NULL ${NARROW_CHECK});`);
    conn.exec(`CREATE TABLE assets (id TEXT PRIMARY KEY, profile TEXT NOT NULL ${NARROW_CHECK});`);
    conn.prepare('INSERT INTO generation_jobs (id, profile) VALUES (?, ?)').run('legacy_job', 'enterprise_pbr');
    conn.prepare('INSERT INTO assets (id, profile) VALUES (?, ?)').run('legacy_asset', 'realistic');

    const result = applyProfileVocabularyMigration(conn);
    assert.deepStrictEqual(result.tables.sort(), ['assets', 'generation_jobs']);

    const legacy = conn.prepare('SELECT profile FROM generation_jobs WHERE id = ?').get('legacy_job');
    assert.strictEqual(legacy.profile, 'enterprise_pbr', 'pre-existing row must be preserved');

    conn.prepare('INSERT INTO generation_jobs (id, profile) VALUES (?, ?)').run('new_job', 'production_pbr');
    conn.prepare('INSERT INTO assets (id, profile) VALUES (?, ?)').run('new_asset', 'production_pbr');
    assert.strictEqual(
      conn.prepare('SELECT COUNT(*) AS n FROM generation_jobs').get().n,
      2,
      'both profile names must be accepted'
    );
  });
});

console.log('\n--- 2. Unknown profile still rejected by the widened CHECK ---');
check('bogus profile fails the CHECK', () => {
  withTempDb((conn) => {
    conn.exec(`CREATE TABLE generation_jobs (id TEXT PRIMARY KEY, profile TEXT NOT NULL ${NARROW_CHECK});`);
    conn.exec(`CREATE TABLE assets (id TEXT PRIMARY KEY, profile TEXT NOT NULL ${NARROW_CHECK});`);
    applyProfileVocabularyMigration(conn);
    assert.throws(
      () => conn.prepare('INSERT INTO generation_jobs (id, profile) VALUES (?, ?)').run('bad', 'made_up'),
      /CHECK constraint failed/
    );
  });
});

console.log('\n--- 3. Indexes and triggers are restored ---');
check('dependent index survives the rebuild', () => {
  withTempDb((conn) => {
    conn.exec(`CREATE TABLE generation_jobs (id TEXT PRIMARY KEY, profile TEXT NOT NULL ${NARROW_CHECK});`);
    conn.exec(`CREATE TABLE assets (id TEXT PRIMARY KEY, profile TEXT NOT NULL ${NARROW_CHECK});`);
    conn.exec('CREATE INDEX idx_generation_jobs_profile ON generation_jobs(profile);');
    conn.exec("CREATE TRIGGER trg_assets_profile AFTER INSERT ON assets BEGIN SELECT 1; END;");
    applyProfileVocabularyMigration(conn);
    const index = conn
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_generation_jobs_profile'")
      .get();
    const trigger = conn
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_assets_profile'")
      .get();
    assert.ok(index, 'index must be restored');
    assert.ok(trigger, 'trigger must be restored');
  });
});

console.log('\n--- 4. Idempotence and staging cleanup ---');
check('second run is a no-op and leaves no staging tables', () => {
  withTempDb((conn) => {
    conn.exec(`CREATE TABLE generation_jobs (id TEXT PRIMARY KEY, profile TEXT NOT NULL ${NARROW_CHECK});`);
    conn.exec(`CREATE TABLE assets (id TEXT PRIMARY KEY, profile TEXT NOT NULL ${NARROW_CHECK});`);
    applyProfileVocabularyMigration(conn);
    const second = applyProfileVocabularyMigration(conn);
    assert.strictEqual(second.applied, false, 'second run must not rebuild');
    const staged = conn
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%__profile_stage'")
      .all();
    assert.deepStrictEqual(staged, [], 'no staging tables may remain');
  });
});

console.log('\n--- 5. Migration is recorded once ---');
check('schema_migrations carries the profile vocabulary id', () => {
  withTempDb((conn) => {
    conn.exec('CREATE TABLE schema_migrations (migration_id TEXT PRIMARY KEY, checksum_sha256 TEXT, applied_at TEXT, execution_ms INTEGER);');
    conn.exec(`CREATE TABLE generation_jobs (id TEXT PRIMARY KEY, profile TEXT NOT NULL ${NARROW_CHECK});`);
    conn.exec(`CREATE TABLE assets (id TEXT PRIMARY KEY, profile TEXT NOT NULL ${NARROW_CHECK});`);
    applyProfileVocabularyMigration(conn);
    applyProfileVocabularyMigration(conn);
    const rows = conn
      .prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE migration_id = ?')
      .get(PROFILE_VOCABULARY_MIGRATION_ID);
    assert.strictEqual(rows.n, 1);
  });
});

console.log('\n--- 6. Non-canonical profile shape fails loud ---');
check('missing CHECK raises SCHEMA DRIFT', () => {
  withTempDb((conn) => {
    conn.exec("CREATE TABLE generation_jobs (id TEXT PRIMARY KEY, profile TEXT NOT NULL DEFAULT 'production_pbr');");
    assert.throws(() => applyProfileVocabularyMigration(conn), /SCHEMA DRIFT/);
  });
});

console.log(`\n${passed} test cases passed.`);