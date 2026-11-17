#!/usr/bin/env node
'use strict';
require('./helpers/isolate_db');

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../src/db');
const dbSchema = require('../src/db_schema');
const personaMemory = require('../src/persona_memory');

async function run() {
  console.log('Running test_memory_brain_migration_and_api...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-brain-mig-'));
  const v7DbPath = path.join(tmpDir, 'v7_legacy.db');
  const freshDbPath = path.join(tmpDir, 'fresh.db');

  try {
    // Seed a v7 database with pre-existing persona_memories rows and upgrade to v8
    const v7Conn = db.getConnection(v7DbPath, false);
    v7Conn.exec(`
      CREATE TABLE projects (
        project_hash TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        project_name TEXT NOT NULL,
        framework TEXT DEFAULT 'Unknown',
        styling TEXT DEFAULT 'Standard CSS',
        package_manager TEXT DEFAULT 'pnpm',
        context_summary TEXT DEFAULT '',
        tech_stack TEXT DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE persona_memories (
        id TEXT PRIMARY KEY,
        project_hash TEXT DEFAULT NULL,
        session_id TEXT DEFAULT '',
        agent_name TEXT NOT NULL,
        memory_type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT,
        importance INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_hash) REFERENCES projects(project_hash) ON DELETE CASCADE
      );
      INSERT INTO projects VALUES ('abc123def456', '/tmp/proj-v7', 'proj-v7', 'Next.js', 'Tailwind', 'pnpm', '', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
      INSERT INTO persona_memories VALUES ('m_legacy1', 'abc123def456', 'sess-1', 'anbu', 'rule', 'Legacy Rule', 'Always validate inputs.', 'security', 3, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');
      INSERT INTO persona_memories VALUES ('m_legacy2', NULL, '', 'kage', 'knowledge', 'Legacy Doc', 'Architecture invariant.', 'arch', 2, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');
      PRAGMA user_version = 7;
    `);
    dbSchema.setupSchema(v7Conn, db.backupDatabase);
    assert.strictEqual(dbSchema.getCurrentUserVersion(v7Conn), dbSchema.CURRENT_SCHEMA_VERSION, 'Upgraded DB must reach the current schema version');

    const row1 = v7Conn.prepare('SELECT * FROM persona_memories WHERE id = ?').get('m_legacy1');
    const row2 = v7Conn.prepare('SELECT * FROM persona_memories WHERE id = ?').get('m_legacy2');
    assert.strictEqual(row1.content, 'Always validate inputs.');
    assert.strictEqual(row1.domain, 'project');
    assert.strictEqual(row1.creator_agent, 'anbu');
    assert.strictEqual(row1.lifecycle_status, 'active');
    assert.strictEqual(row1.verification_status, 'confirmed');
    assert.strictEqual(row2.domain, 'knowledge');
    assert.strictEqual(dbSchema.validateCanonicalSchema(v7Conn).valid, true);
    v7Conn.close();
    console.log('  ✓ v7 -> v8 migration preserved existing rows and backfilled provenance');

    // Unified Memory API across persona, project, episodic, session, knowledge domains
    personaMemory.DB_PATH = freshDbPath;
    db.DB_PATH = freshDbPath;
    const projPath = path.join(tmpDir, 'proj_unified');
    fs.mkdirSync(projPath, { recursive: true });

    const rPersona = personaMemory.remember({
      agentName: 'jonin',
      content: 'Prefer semantic tokens in Tailwind v4.',
      domain: 'persona',
      sourceType: 'user',
      sourceRef: 'style-guide.md#L12',
      dbPath: freshDbPath
    });
    const rProject = personaMemory.remember({
      agentName: 'anbu',
      content: 'API rate limit is 120 req/min.',
      domain: 'project',
      memoryType: 'architecture',
      projectPath: projPath,
      sourceType: 'code',
      sourceRef: 'src/rate_limit.js:44',
      dbPath: freshDbPath
    });
    const rSession = personaMemory.remember({
      agentName: 'anbu',
      content: 'Session observed port 4173 conflict.',
      memoryType: 'episodic',
      domain: 'session',
      projectPath: projPath,
      sessionId: 'sess-alpha',
      sourceType: 'inferred',
      confidence: 0.55,
      dbPath: freshDbPath
    });
    const rKnowledge = personaMemory.remember({
      agentName: 'chunin',
      content: 'Playwright ariaSnapshot captures scoped accessibility trees.',
      memoryType: 'knowledge',
      domain: 'knowledge',
      projectPath: projPath,
      sourceType: 'web_citation',
      sourceRef: 'https://playwright.dev/docs/aria-snapshots',
      dbPath: freshDbPath
    });

    assert.strictEqual(rPersona.is_verified, true);
    assert.strictEqual(rProject.provenance.source_ref, 'src/rate_limit.js:44');
    assert.strictEqual(rSession.provenance.verification_status, 'inferred');
    assert.strictEqual(rSession.is_verified, false);
    assert.strictEqual(rKnowledge.provenance.domain, 'knowledge');

    // Boundary enforcement: secrets & transient checkpoints must be rejected
    assert.throws(() => personaMemory.remember({
      agentName: 'anbu',
      content: 'Token: sk-1234567890abcdefghijklmnop',
      dbPath: freshDbPath
    }), /MEMORY_BOUNDARY_VIOLATION/);
    assert.throws(() => personaMemory.remember({
      agentName: 'sannin',
      memoryType: 'lg_checkpoint',
      content: 'Transient graph state dump',
      dbPath: freshDbPath
    }), /MEMORY_BOUNDARY_VIOLATION/);
    console.log('  ✓ Unified API and secret/transient boundary checks passed');

    // Optional GBrain adapter isolation: native SQLite works cleanly with GBrain absent/unreachable
    const provider = personaMemory.getMemoryProvider({
      enableGbrain: true,
      gbrain: { endpoint: 'http://127.0.0.1:59999/unavailable', timeoutMs: 200 }
    });
    assert.strictEqual(provider.primary.authoritative, true);
    assert.strictEqual(provider.optionalExternal.authoritative, false);
    const syncOutcome = await provider.optionalExternal.syncSnapshotToExternal([rPersona]);
    assert.strictEqual(syncOutcome.ok, false);
    assert.strictEqual(syncOutcome.authoritative_store, 'konoha_native_sqlite');
    const nativeHits = provider.primary.query({ query: 'rate limit', projectPath: projPath, dbPath: freshDbPath });
    assert.strictEqual(nativeHits.length, 1);
    console.log('  ✓ Native SQLite canonical independence and optional GBrain adapter passed');

    // Export, rebuild FTS index, and restore/import into clean DB
    const jsonBundle = personaMemory.exportMemoryBrain({ format: 'json', projectPath: projPath, dbPath: freshDbPath });
    const mdBundle = personaMemory.exportMemoryBrain({ format: 'markdown', projectPath: projPath, dbPath: freshDbPath });
    assert.ok(jsonBundle.memories.length >= 2);
    assert.ok(mdBundle.includes('verification_status:'));
    assert.ok(personaMemory.rebuildMemoryIndex({ dbPath: freshDbPath }).ok);

    const restoredDbPath = path.join(tmpDir, 'restored.db');
    const imp = personaMemory.importMemoryBrain(jsonBundle, { mode: 'restore', dbPath: restoredDbPath });
    assert.strictEqual(imp.ok, true);
    assert.strictEqual(imp.imported_memories, jsonBundle.memories.length);
    const recalledRestored = personaMemory.recall({ query: 'ariaSnapshot', projectPath: projPath, dbPath: restoredDbPath });
    assert.strictEqual(recalledRestored.length, 1);
    console.log('  ✓ Export, index rebuild, and restore/import passed');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
