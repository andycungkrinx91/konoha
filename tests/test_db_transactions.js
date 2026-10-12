'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('../src/sqlite_driver');
const personaMemory = require('../src/persona_memory');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_tx_test_'));
const dbPath = path.join(tmpDir, 'test_tx.db');

try {
  // Test 1: deleteProject atomicity
  {
    const pPath = '/path/to/proj1';
    const pHash = personaMemory.saveOrUpdateProject(pPath, 'summary1', null, dbPath);
    personaMemory.saveMemory({ agentName: 'kage', content: 'Rule 1', projectHash: pHash, projectPath: pPath, dbPath });

    // Attach trigger to simulate failure in second statement
    const conn = new Database(dbPath);
    conn.exec(`
      CREATE TRIGGER fail_mem_delete BEFORE DELETE ON persona_memories
      BEGIN
        SELECT RAISE(ABORT, 'injected_failure_delete_project');
      END;
    `);
    conn.close();

    // Invoking deleteProject should fail atomically and rollback projects deletion
    assert.throws(() => {
      personaMemory.deleteProject(pHash, true, dbPath);
    }, /injected_failure_delete_project/);

    const verifyConn = new Database(dbPath);
    const pRow = verifyConn.prepare("SELECT count(*) as c FROM projects WHERE project_hash = ?").get(pHash);
    assert.strictEqual(pRow.c, 1, 'Project must NOT be deleted if associated memories deletion fails (atomicity rollback)');

    // Clean up trigger
    verifyConn.exec("DROP TRIGGER fail_mem_delete");
    verifyConn.close();

    // Now regular deletion succeeds
    const delRes = personaMemory.deleteProject(pHash, true, dbPath);
    assert.strictEqual(delRes, true);
    const verifyConn2 = new Database(dbPath);
    assert.strictEqual(verifyConn2.prepare("SELECT count(*) as c FROM projects WHERE project_hash = ?").get(pHash).c, 0);
    assert.strictEqual(verifyConn2.prepare("SELECT count(*) as c FROM persona_memories WHERE project_hash = ?").get(pHash).c, 0);
    verifyConn2.close();
  }

  // Test 2: pruneAllProjects atomicity
  {
    const pPath = '/path/to/prune1';
    const pHash = personaMemory.saveOrUpdateProject(pPath, 'summary2', null, dbPath);
    personaMemory.saveMemory({ agentName: 'anbu', content: 'Rule 2', projectHash: pHash, projectPath: pPath, dbPath });

    const conn = new Database(dbPath);
    conn.exec(`
      CREATE TRIGGER fail_prune_all BEFORE DELETE ON persona_memories
      BEGIN
        SELECT RAISE(ABORT, 'injected_failure_prune_all');
      END;
    `);
    conn.close();

    assert.throws(() => {
      personaMemory.pruneAllProjects({}, dbPath);
    }, /injected_failure_prune_all/);

    const verifyConn = new Database(dbPath);
    assert.strictEqual(verifyConn.prepare("SELECT count(*) as c FROM projects WHERE project_hash = ?").get(pHash).c, 1, 'Projects must not be deleted if memories deletion fails');
    verifyConn.exec("DROP TRIGGER fail_prune_all");
    verifyConn.close();

    const pruneRes = personaMemory.pruneAllProjects({}, dbPath);
    assert.ok(pruneRes.deleted >= 1);
  }

  // Test 3: pruneProjectMemories atomicity
  {
    const pPath = '/path/to/pm1';
    const pHash = personaMemory.saveOrUpdateProject(pPath, 'summary info', null, dbPath);
    personaMemory.saveMemory({ agentName: 'jonin', content: 'Rule 3', projectHash: pHash, projectPath: pPath, dbPath });

    // Trigger on projects UPDATE to fail
    const conn = new Database(dbPath);
    conn.exec(`
      CREATE TRIGGER fail_invariants BEFORE UPDATE OF context_summary ON projects
      BEGIN
        SELECT RAISE(ABORT, 'injected_failure_invariants');
      END;
    `);
    conn.close();

    assert.throws(() => {
      personaMemory.pruneProjectMemories(pHash, { clearInvariants: true }, dbPath);
    }, /injected_failure_invariants/);

    const verifyConn = new Database(dbPath);
    assert.strictEqual(verifyConn.prepare("SELECT count(*) as c FROM persona_memories WHERE project_hash = ?").get(pHash).c, 1, 'Memories must not be deleted if clearInvariants fails');
    verifyConn.exec("DROP TRIGGER fail_invariants");
    verifyConn.close();

    const pmRes = personaMemory.pruneProjectMemories(pHash, { clearInvariants: true }, dbPath);
    assert.strictEqual(pmRes.deleted, 1);
    assert.strictEqual(pmRes.invariants_cleared, true);
  }

  console.log('test_db_transactions: PASS');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
