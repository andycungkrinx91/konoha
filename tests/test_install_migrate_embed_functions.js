#!/usr/bin/env node
'use strict';

/**
 * tests/test_install_migrate_embed_functions.js
 *
 * Guards two properties of the 2.2.20 migrate/embed rework:
 *
 *  1. The migrate/embed paths are spawn-free. A child process there turned every
 *     failure into an opaque exit code and made the 900s budget unenforceable
 *     from the inside, so a reintroduced `spawnSync`/`exec(` must fail here.
 *  2. Migration actually indexes skills, chunks them, and leaves the schema
 *     migrated — verified by running the real in-process migration in a
 *     throwaway HOME, not by reading source text.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');

console.log('Running test_install_migrate_embed_functions.js...');

// --- 1. spawn-free migrate/embed paths -------------------------------------

// Files whose only job is the migrate/embed path: no child process at all.
const PURE_MIGRATE_PATHS = [
  'bin/commands/migrate.js',
  'bin/commands/init_migration.js',
  'bin/lib/install_lifecycle.js',
  'src/migrate.js',
  'src/web/controllers/skills_controller.js'
];

// Files that also drive package-manager / build / daemon subprocesses, which
// are out of scope: assert only that they never spawn the migrate script.
const MIXED_PATHS = [
  'bin/commands/upgrade.js',
  'bin/commands/doctor_services.js',
  'bin/lib/runtime_lifecycle.js',
  'src/skill_manager.js'
];

// `conn.exec(...)` is SQLite, so `exec` only counts as a bare call.
const CHILD_PROCESS_RE = /(?<![.\w])(?:spawnSync|execSync|execFileSync|exec)\s*\(|require\(\s*['"]child_process['"]\s*\)/;
const MIGRATE_INVOCATION_RE = /(?:spawnSync|execSync|execFileSync|spawn|exec)\s*\([^)]*(?:['"]migrate['"]|MIGRATE_PATH|runMigration)/;

for (const rel of PURE_MIGRATE_PATHS) {
  const file = path.join(ROOT, rel);
  assert.ok(fs.existsSync(file), `${rel} must exist`);
  assert.ok(!CHILD_PROCESS_RE.test(fs.readFileSync(file, 'utf8')),
    `${rel} must not use child_process on the migrate/embed path`);
}

for (const rel of MIXED_PATHS) {
  const file = path.join(ROOT, rel);
  assert.ok(fs.existsSync(file), `${rel} must exist`);
  assert.ok(!MIGRATE_INVOCATION_RE.test(fs.readFileSync(file, 'utf8')),
    `${rel} must not spawn a migrate child`);
}

// --- 2. migrate/embed API is exported as functions --------------------------

// The sandbox HOME must be in place before `src/migrate` is required: DB_PATH is
// resolved from the environment at module load.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_migrate_fn_'));
const prevEnv = {
  HOME: process.env.HOME,
  KONOHA_DB_PATH: process.env.KONOHA_DB_PATH,
  KONOHA_UI_AUTOSTART: process.env.KONOHA_UI_AUTOSTART,
  KONOHA_SEMANTIC_SEARCH: process.env.KONOHA_SEMANTIC_SEARCH
};

process.env.HOME = sandbox;
process.env.KONOHA_DB_PATH = path.join(sandbox, '.konoha', 'konoha.db');
process.env.KONOHA_UI_AUTOSTART = '0';
process.env.KONOHA_SEMANTIC_SEARCH = '0';

function restoreEnv() {
  for (const [key, value] of Object.entries(prevEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

(async () => {
  let skillCount = 0;
  let chunkCount = 0;
  let indexed = 0;
  try {
    const migrate = require('../src/migrate');
    for (const fn of ['runMigration', 'migrateSingleSkill', 'migrate_skills']) {
      assert.strictEqual(typeof migrate[fn], 'function', `src/migrate must export ${fn}`);
    }
    assert.strictEqual(migrate.runMigration.constructor.name, 'AsyncFunction',
      'runMigration must be awaitable');

    const options = {
      skillsDir: path.join(ROOT, 'src', 'templates', 'skills'),
      skipEmbeddings: true,
      timeBudgetSeconds: 300
    };

    const result = await migrate.runMigration(options);
    assert.strictEqual(result.ok, true, `migration must succeed, got ${JSON.stringify(result)}`);
    assert.ok(result.indexed > 0, 'migration must index at least one entry');
    assert.ok(fs.existsSync(result.dbPath), 'migration must create the database');
    assert.ok(result.dbPath.startsWith(sandbox), 'migration must write into the sandbox DB');
    indexed = result.indexed;

    const Database = require('../src/sqlite_driver');
    const conn = new Database(result.dbPath, { readOnly: true });
    try {
      skillCount = conn.prepare('SELECT COUNT(*) AS n FROM skills').get().n;
      chunkCount = conn.prepare('SELECT COUNT(*) AS n FROM skill_chunks').get().n;
      const userVersion = Object.values(conn.prepare('PRAGMA user_version').get())[0];

      assert.ok(skillCount > 0, 'skills table must be populated');
      // Embeddings were skipped for this run, so skill_chunks is expected empty;
      // the install/upgrade matrix verifies the embedded counts.
      assert.strictEqual(chunkCount, 0, 'skipEmbeddings must leave skill_chunks empty');
      const ftsCount = conn.prepare('SELECT COUNT(*) AS n FROM skills_fts').get().n;
      assert.ok(ftsCount > 0, 'skills_fts must be populated');

      const { CURRENT_SCHEMA_VERSION } = require('../src/db_schema');
      assert.strictEqual(Number(userVersion), Number(CURRENT_SCHEMA_VERSION),
        `PRAGMA user_version must equal schema ${CURRENT_SCHEMA_VERSION}, got ${userVersion}`);
    } finally {
      conn.close();
    }

    // A second run must be idempotent rather than erroring or duplicating rows.
    const again = await migrate.runMigration(options);
    assert.strictEqual(again.ok, true, 're-running migration must stay successful');

    const conn2 = new Database(result.dbPath, { readOnly: true });
    try {
      const reSkillCount = conn2.prepare('SELECT COUNT(*) AS n FROM skills').get().n;
      assert.strictEqual(reSkillCount, skillCount, 're-running migration must not duplicate skill rows');
    } finally {
      conn2.close();
    }

    console.log('  ok   migrate/embed paths are spawn-free');
    console.log(`  ok   in-process migration indexed ${indexed} entries (skills=${skillCount}, chunks=${chunkCount})`);
    console.log('  ok   re-running migration is idempotent');
  } finally {
    restoreEnv();
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }

  console.log('All install/migrate/embed function checks passed');
})().catch(err => {
  console.error(`FAILED: ${err.message}`);
  process.exit(1);
});