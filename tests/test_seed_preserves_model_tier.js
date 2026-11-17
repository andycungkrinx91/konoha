'use strict';

/**
 * Reseeding agents.yaml must not erase columns the YAML does not carry.
 *
 * INSERT OR REPLACE deletes the row and reinserts it, so every column the
 * statement omits comes back NULL. model_tier and cursor_fallback_model are set
 * outside the YAML and getMainModel() reads model_tier, so a migration used to
 * silently reset the configured model to the hardcoded default.
 */

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-seed-'));
const dbPath = path.join(tmpDir, 'konoha.db');

const db = require('../src/db');
const { seedAgents } = require('../src/migrate_helpers');

function main() {
  const conn = db.getConnection(dbPath, false);
  db.setupSchema(conn);

  // First seed, then a user-configured model tier, the way `konoha agent` sets it.
  seedAgents(conn, () => {});
  conn.prepare("UPDATE agents SET model_tier = 'Pro', cursor_fallback_model = 'opus' WHERE name = 'sannin'").run();
  const before = conn.prepare('SELECT model_tier, cursor_fallback_model FROM agents WHERE name = ?').get('sannin');
  assert.ok(before, 'sannin must exist before reseeding');
  assert.strictEqual(before.model_tier, 'Pro', 'test fixture must set model_tier');

  seedAgents(conn, () => {});

  const after = conn.prepare('SELECT model_tier, cursor_fallback_model FROM agents WHERE name = ?').get('sannin');
  assert.ok(after, 'sannin must survive reseeding');
  assert.strictEqual(after.model_tier, 'Pro', 'reseeding must preserve a user-set model_tier');
  assert.strictEqual(after.cursor_fallback_model, 'opus', 'reseeding must preserve cursor_fallback_model');

  // The YAML-owned columns must still be refreshed from the template.
  const refreshed = conn.prepare('SELECT title, skills FROM agents WHERE name = ?').get('sannin');
  assert.ok(refreshed.title, 'reseeding must still populate title from the template');
  assert.ok(JSON.parse(refreshed.skills || '[]').length > 0, 'reseeding must still populate skills from the template');

  conn.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });

  verifyOtherWritePaths();
  console.log('✓ reseeding agents preserves model_tier and refreshes template columns');
}

/**
 * seedAgents is one of four write paths that touch the agents table. The other
 * three lived in db_agents.js with the same INSERT OR REPLACE shape.
 */
function verifyOtherWritePaths() {
  const dbAgents = require('../src/db_agents');
  const yamlDir = path.join(process.env.HOME, '.agents');
  fs.mkdirSync(yamlDir, { recursive: true });
  fs.writeFileSync(
    path.join(yamlDir, 'agents.yaml'),
    '- name: sannin\n  title: Router\n  skills: [routing]\n  enable_mcp_tools: true\n'
  );

  const pathDb = path.join(tmpDir, 'paths.db');
  const c = db.getConnection(pathDb, false);
  db.setupSchema(c);
  c.prepare("INSERT INTO agents (name, title, model_tier) VALUES ('sannin', 'Router', 'Pro')").run();

  dbAgents.bulkImportAgents([{ name: 'sannin', title: 'Router v2', skills: ['routing'] }], pathDb);
  let row = c.prepare('SELECT title, model_tier FROM agents WHERE name = ?').get('sannin');
  assert.strictEqual(row.model_tier, 'Pro', 'bulkImportAgents must preserve model_tier');
  assert.strictEqual(row.title, 'Router v2', 'bulkImportAgents must still refresh title');

  dbAgents.importYamlToDb(pathDb);
  row = c.prepare('SELECT title, model_tier FROM agents WHERE name = ?').get('sannin');
  assert.strictEqual(row.model_tier, 'Pro', 'importYamlToDb must preserve model_tier');
  assert.strictEqual(row.title, 'Router', 'importYamlToDb must still refresh title from YAML');

  // importYamlToDb replaces the set, so an agent the YAML dropped must be gone.
  c.prepare("INSERT INTO agents (name, title) VALUES ('ghost', 'dropped')").run();
  dbAgents.importYamlToDb(pathDb);
  assert.strictEqual(c.prepare('SELECT 1 FROM agents WHERE name = ?').get('ghost'), undefined,
    'importYamlToDb must still drop agents absent from the YAML');

  c.close();
  fs.rmSync(pathDb, { force: true });
  fs.rmSync(yamlDir, { recursive: true, force: true });
}

/**
 * Upgrading an older DB whose `agents` table lacks `icon` (or PK on `name`)
 * must backfill all canonical columns before `seedAgents` / `db_agents` run
 * INSERT ... ON CONFLICT(name) DO UPDATE.
 */
function verifyLegacyAgentsColumnBackfill() {
  const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-legacy-agents-'));
  try {
    // Case A: pre-icon `agents` table with PK on `name`, already stamped user_version = 7
    const dbPathA = path.join(legacyDir, 'pre_icon_v7.db');
    const connA = db.getConnection(dbPathA, false);
    connA.exec(`
      CREATE TABLE agents (name TEXT PRIMARY KEY, title TEXT, model TEXT);
      INSERT INTO agents (name, title, model) VALUES ('sannin', 'Old Router', 'custom-model');
    `);
    db.ensureSchema(connA);
    seedAgents(connA, (msg) => {
      assert.ok(!/Failed to seed agents/i.test(msg), `seedAgents must not fail after schema backfill: ${msg}`);
    });
    const sannin = connA.prepare('SELECT icon, model, enable_mcp_tools FROM agents WHERE name = ?').get('sannin');
    assert.ok(sannin && sannin.icon, 'sannin.icon must be seeded after column backfill');
    assert.strictEqual(sannin.model, 'custom-model', 'existing agents.model must be preserved across seedAgents');
    assert.strictEqual(sannin.enable_mcp_tools, 1, 'enable_mcp_tools must backfill cleanly');
    connA.close();

    // Case B: pre-icon `agents` table at user_version = 7 even after CORE_SCHEMA_DDL exists for other tables
    const dbPathB = path.join(legacyDir, 'v7_partial_agents.db');
    const connB = db.getConnection(dbPathB, false);
    db.setupSchema(connB);
    connB.exec(`
      DROP TABLE agents;
      CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT, title TEXT);
      INSERT INTO agents (id, name, title) VALUES ('legacy-1', 'anbu', 'Old Anbu');
    `);
    connB.close();

    const connB2 = db.getConnection(dbPathB, false);
    db.ensureSchema(connB2);
    seedAgents(connB2, (msg) => {
      assert.ok(!/Failed to seed agents/i.test(msg), `ensureSchema must backfill v7 partial agents table: ${msg}`);
    });
    const anbu = connB2.prepare('SELECT icon, title FROM agents WHERE name = ?').get('anbu');
    assert.ok(anbu && anbu.icon, 'anbu.icon must be seeded on repaired v7 DB');
    connB2.close();
    console.log('✓ legacy agents tables without icon or PK(name) backfill and seed cleanly');
  } finally {
    fs.rmSync(legacyDir, { recursive: true, force: true });
  }
}

main();
verifyLegacyAgentsColumnBackfill();
