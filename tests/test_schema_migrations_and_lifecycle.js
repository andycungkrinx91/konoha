#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('../src/sqlite_driver');
const {
  CURRENT_SCHEMA_VERSION,
  getCurrentUserVersion,
  setUserVersion,
  verifyIntegrity,
  setupSchema
} = require('../src/db_schema');
const sdlcManager = require('../src/sdlc_manager');

async function run() {
  console.log('Running test_schema_migrations_and_lifecycle...');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_schema_test_'));
  const freshDbPath = path.join(tmpDir, 'fresh.db');
  const legacyDbPath = path.join(tmpDir, 'legacy.db');

  try {
    // 1. Fresh Database Schema & Version
    const freshDb = new Database(freshDbPath);
    setupSchema(freshDb);

    const version = getCurrentUserVersion(freshDb);
    assert.strictEqual(version, CURRENT_SCHEMA_VERSION, `Fresh DB user_version must equal ${CURRENT_SCHEMA_VERSION}`);
    assert.strictEqual(verifyIntegrity(freshDb), true, 'PRAGMA integrity_check must pass on fresh DB');

    // Verify composite indexes exist
    const indexes = freshDb.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r => r.name);
    assert.ok(indexes.includes('idx_sdlc_tasks_status_updated'), 'Composite index idx_sdlc_tasks_status_updated must exist');
    assert.ok(indexes.includes('idx_persona_memories_agent_proj'), 'Composite index idx_persona_memories_agent_proj must exist');
    freshDb.close();

    // 2. Legacy Database Migration from v0 to v5
    const legacyDb = new Database(legacyDbPath);
    // Create pre-2.2.7 schema without user_version
    legacyDb.exec(`
      CREATE TABLE sdlc_tasks (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        dor_result TEXT DEFAULT '{}',
        review_mode TEXT DEFAULT 'self',
        evidence TEXT DEFAULT '{}',
        slop_result TEXT DEFAULT '{}',
        slop_cycles INTEGER DEFAULT 0,
        project_path TEXT DEFAULT '',
        session_id TEXT DEFAULT '',
        client TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    assert.strictEqual(getCurrentUserVersion(legacyDb), 0, 'Pre-migration DB user_version must be 0');

    // Run schema setup / migration
    setupSchema(legacyDb);
    assert.strictEqual(getCurrentUserVersion(legacyDb), CURRENT_SCHEMA_VERSION, 'Migrated DB must be updated to CURRENT_SCHEMA_VERSION');
    assert.strictEqual(verifyIntegrity(legacyDb), true, 'Migrated DB must pass PRAGMA integrity_check');
    legacyDb.close();

    // 3. Task Lifecycle & Stale in_progress Reconciliation
    const taskDbPath = path.join(tmpDir, 'tasks.db');
    const db = new Database(taskDbPath);
    setupSchema(db);
    db.close();

    const staleTime = new Date(Date.now() - 40 * 60 * 1000).toISOString(); // 40 mins ago
    const activeTime = new Date().toISOString(); // now

    // Task A: Stale in_progress (40 mins old)
    sdlcManager.createTask({
      id: 'task-stale-1',
      description: 'Stale task stuck in progress',
      status: 'in_progress',
      projectPath: '/test/workspace'
    }, taskDbPath);
    // Manually backdate updated_at to simulate stuck task
    const conn = new Database(taskDbPath);
    conn.prepare("UPDATE sdlc_tasks SET updated_at = ? WHERE id = 'task-stale-1'").run(staleTime);

    // Task B: Active in_progress (fresh heartbeat)
    sdlcManager.createTask({
      id: 'task-active-1',
      description: 'Active task in progress',
      status: 'in_progress',
      projectPath: '/test/workspace'
    }, taskDbPath);
    conn.prepare("UPDATE sdlc_tasks SET updated_at = ? WHERE id = 'task-active-1'").run(activeTime);

    // Task C: Completed task
    sdlcManager.createTask({
      id: 'task-completed-1',
      description: 'Completed task',
      status: 'completed',
      projectPath: '/test/workspace'
    }, taskDbPath);
    conn.close();

    // Run reconciliation (30m lease threshold)
    const recon = sdlcManager.reconcileStaleTasks({ maxAgeMs: 30 * 60 * 1000 }, taskDbPath);
    assert.strictEqual(recon.reconciled_count, 1, 'Exactly 1 stale task must be reconciled');
    assert.deepStrictEqual(recon.reconciled_ids, ['task-stale-1']);

    // Verify task-stale-1 transitioned to timed_out with reconciliation metadata
    const staleTask = sdlcManager.getTask('task-stale-1', taskDbPath);
    assert.strictEqual(staleTask.status, 'timed_out', 'Stale task status must become timed_out');
    assert.ok(staleTask.evidence.reconciliation, 'Reconciliation metadata must be recorded');
    assert.strictEqual(staleTask.evidence.reconciliation.previous_status, 'in_progress');
    assert.ok(staleTask.evidence.reconciliation.reason.includes('lease expired'));

    // Verify active task remained in_progress
    const activeTask = sdlcManager.getTask('task-active-1', taskDbPath);
    assert.strictEqual(activeTask.status, 'in_progress', 'Active task must NOT be reset');

    // Verify completed task remained completed
    const completedTask = sdlcManager.getTask('task-completed-1', taskDbPath);
    assert.strictEqual(completedTask.status, 'completed', 'Completed task must NOT be altered');

    // 4. Test restartTask
    const restarted = sdlcManager.restartTask('task-stale-1', { status: 'in_progress' }, taskDbPath);
    assert.strictEqual(restarted.status, 'in_progress', 'Restarted task status must be in_progress');
    assert.strictEqual(restarted.evidence.restarts, 1, 'Restart counter must increment');
    assert.ok(restarted.evidence.last_restart_at, 'last_restart_at must be recorded');

    console.log('✓ All schema migrations, indexes, integrity checks, and task lifecycle tests passed!');
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

module.exports = { run };
