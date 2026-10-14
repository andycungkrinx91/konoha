'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const Database = require('../src/sqlite_driver');
const db = require('../src/db');
const personaMemory = require('../src/persona_memory');

test('Batch 2: SQLite driver enforces foreign_keys = ON by default', (t) => {
  const memDb = new Database(':memory:');
  const fk = memDb.prepare('PRAGMA foreign_keys').get();
  const fkVal = fk.foreign_keys !== undefined ? fk.foreign_keys : Object.values(fk)[0];
  assert.strictEqual(Number(fkVal), 1, 'foreign_keys PRAGMA must be ON (1) by default');
});

test('Batch 2: persona_memories table defines FOREIGN KEY with CASCADE DELETE to projects', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-fk-test-'));
  const testDbPath = path.join(tmpDir, 'test_fk.db');
  try {
    const conn = db.getConnection(testDbPath);
    db.setupSchema(conn);

    const fkList = conn.prepare("PRAGMA foreign_key_list(persona_memories)").all();
    const projectFk = fkList.find(fk => fk.table === 'projects');
    assert.ok(projectFk, 'persona_memories must have a foreign key referencing projects');
    assert.strictEqual(projectFk.to, 'project_hash');
    assert.strictEqual(projectFk.on_delete, 'CASCADE');

    conn.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Batch 2: direct SQL DELETE on projects cascades to persona_memories and persona_memories_fts', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-cascade-test-'));
  const testDbPath = path.join(tmpDir, 'test_cascade.db');
  try {
    const conn = db.getConnection(testDbPath);
    db.setupSchema(conn);

    const testProject = path.join(tmpDir, 'dummy-project');
    fs.mkdirSync(testProject, { recursive: true });

    // Save memory associated with project
    const memId = personaMemory.saveMemory({
      agent_name: 'kage',
      content: 'Important rule for dummy project',
      title: 'Rule 1',
      project_path: testProject,
      db_path: testDbPath
    });

    const projectRow = conn.prepare("SELECT * FROM projects WHERE project_path = ?").get(testProject);
    assert.ok(projectRow, 'Project must exist');
    const pHash = projectRow.project_hash;

    const memRowBefore = conn.prepare("SELECT * FROM persona_memories WHERE id = ?").get(memId);
    assert.ok(memRowBefore, 'Persona memory must exist before project deletion');
    assert.strictEqual(memRowBefore.project_hash, pHash);

    // Direct SQL deletion on projects table (not using personaMemory.deleteProject)
    conn.prepare("DELETE FROM projects WHERE project_hash = ?").run(pHash);

    // Verify cascade deleted the memory row
    const memRowAfter = conn.prepare("SELECT * FROM persona_memories WHERE id = ?").get(memId);
    assert.strictEqual(memRowAfter, undefined, 'Memory row must be cascade-deleted by foreign key');

    // Verify FTS table was updated by trigger
    if (db.hasFts5Support(conn)) {
      const ftsMatches = conn.prepare("SELECT * FROM persona_memories_fts WHERE persona_memories_fts MATCH ?").all('Important');
      assert.strictEqual(ftsMatches.length, 0, 'FTS5 index must have no records for cascade-deleted memory');
    }

    conn.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Batch 2: setupSchema safely migrates legacy persona_memories table without foreign key', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-mig-test-'));
  const testDbPath = path.join(tmpDir, 'test_mig.db');
  try {
    // 1. Manually create legacy unconstrained table
    const rawConn = new Database(testDbPath);
    rawConn.exec(`
      CREATE TABLE projects (
        project_hash TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        project_name TEXT NOT NULL,
        framework TEXT DEFAULT 'Unknown',
        styling TEXT DEFAULT 'Standard CSS',
        package_manager TEXT DEFAULT 'pnpm',
        context_summary TEXT DEFAULT '',
        tech_stack TEXT DEFAULT '{}',
        dor_mode TEXT DEFAULT 'advisory',
        review_mode TEXT DEFAULT 'self',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE persona_memories (
        id TEXT PRIMARY KEY,
        project_hash TEXT DEFAULT '',
        session_id TEXT DEFAULT '',
        agent_name TEXT NOT NULL,
        memory_type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT,
        importance INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO projects (project_hash, project_path, project_name, created_at, updated_at)
      VALUES ('p_existing', '/path/existing', 'Existing', '2026-01-01', '2026-01-01');
      INSERT INTO persona_memories (id, project_hash, session_id, agent_name, memory_type, title, content, created_at, updated_at)
      VALUES ('m_with_proj', 'p_existing', 's1', 'kage', 'rule', 'T1', 'C1', '2026-01-01', '2026-01-01');
      INSERT INTO persona_memories (id, project_hash, session_id, agent_name, memory_type, title, content, created_at, updated_at)
      VALUES ('m_global', '', 's2', 'anbu', 'rule', 'T2', 'C2', '2026-01-01', '2026-01-01');
      INSERT INTO persona_memories (id, project_hash, session_id, agent_name, memory_type, title, content, created_at, updated_at)
      VALUES ('m_orphan', 'p_nonexistent', 's3', 'jonin', 'rule', 'T3', 'C3', '2026-01-01', '2026-01-01');
    `);
    rawConn.close();

    // 2. Run setupSchema to trigger migration
    const conn = db.getConnection(testDbPath);
    db.setupSchema(conn);

    // Verify foreign key exists
    const fkList = conn.prepare("PRAGMA foreign_key_list(persona_memories)").all();
    const projectFk = fkList.find(fk => fk.table === 'projects');
    assert.ok(projectFk, 'Migrated persona_memories must have foreign key to projects');

    // Verify data integrity
    const m1 = conn.prepare("SELECT * FROM persona_memories WHERE id = 'm_with_proj'").get();
    assert.strictEqual(m1.project_hash, 'p_existing');
    const m2 = conn.prepare("SELECT * FROM persona_memories WHERE id = 'm_global'").get();
    assert.strictEqual(m2.project_hash, null, 'Empty project_hash should be migrated to null');
    const m3 = conn.prepare("SELECT * FROM persona_memories WHERE id = 'm_orphan'").get();
    assert.strictEqual(m3, undefined, 'Orphaned project_hash rows must be deleted during migration');

    // Verify backup created and FK check clean
    const backupDir = path.join(tmpDir, 'backups');
    assert.ok(fs.existsSync(backupDir), 'Backup directory must exist');
    const backups = fs.readdirSync(backupDir).filter(f => f.endsWith('.db'));
    assert.ok(backups.length >= 1, 'Backup snapshot must be created before table rebuild');

    const fkViolations = conn.prepare("PRAGMA foreign_key_check").all();
    assert.strictEqual(fkViolations.length, 0, 'Foreign key check must have 0 violations');

    conn.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Batch 2: rebuildAllFts rebuilds skills and persona memories FTS indexes', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-fts-test-'));
  const testDbPath = path.join(tmpDir, 'test_fts.db');
  try {
    const conn = db.getConnection(testDbPath);
    db.setupSchema(conn);

    if (db.hasFts5Support(conn)) {
      const result = db.rebuildAllFts(conn);
      assert.strictEqual(result.rebuilt, true);
      assert.ok(result.tables.includes('skills_fts'));
      assert.ok(result.tables.includes('persona_memories_fts'));
    }
    conn.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Batch 2: konoha data rebuild-fts CLI command executes successfully', (t) => {
  const cliPath = path.resolve(__dirname, '../bin/cli.js');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-cli-fts-'));
  const testDbPath = path.join(tmpDir, 'test_cli_fts.db');
  try {
    const output = execFileSync(process.execPath, [cliPath, 'data', 'rebuild-fts'], {
      env: { ...process.env, KONOHA_DB_PATH: testDbPath },
      encoding: 'utf8'
    });
    assert.ok(output.includes('Successfully rebuilt FTS5') || output.includes('FTS5 rebuild'), 'CLI output should indicate rebuild result');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
