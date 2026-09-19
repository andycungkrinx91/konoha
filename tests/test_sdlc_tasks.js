#!/usr/bin/env node
// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

/**
 * tests/test_sdlc_tasks.js — Tests SDLC Task Record & Evidence Persistence.
 * Covers Phase 1, Phase 6, Phase 9 of PLAN_NATIVE_SDLC.md:
 * - sdlc_tasks SQLite CRUD operations
 * - Validation evidence recording via reportFromAgent
 * - MCP tools: get_task_evidence, get_slop_findings
 * - CLI commands: konoha task list, show, slop
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const sdlc = require('../src/sdlc_manager');
const server = require('../src/server');
const { executeTool } = require('../src/mcp/tool_dispatch');

async function run() {
  console.log('Running test_sdlc_tasks tests...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc_tasks_test_'));
  // Use the isolated env DB (same one the CLI subprocess sees via KONOHA_DB_PATH)
  // so direct sdlc calls and spawned `konoha task` commands share one dataset.
  const testDbPath = process.env.KONOHA_DB_PATH;

  try {
    // 1. Task Creation & Retrieval
    const task1 = sdlc.createTask({
      id: 'task_sdlc_crud_1',
      description: 'Implement secure JWT authentication endpoints',
      status: 'draft',
      dor_result: { ready: true, missing: [], confidence: 'high' },
      review_mode: 'self',
      project_path: '/path/to/project'
    }, testDbPath);

    assert.strictEqual(task1.id, 'task_sdlc_crud_1');
    assert.strictEqual(task1.status, 'draft');
    assert.strictEqual(task1.dor_result.ready, true);
    assert.strictEqual(task1.review_mode, 'self');

    const fetched1 = sdlc.getTask('task_sdlc_crud_1', testDbPath);
    assert.strictEqual(fetched1.description, 'Implement secure JWT authentication endpoints');
    console.log('✓ Task creation and retrieval passed');

    // 2. Task Listing & Filtering
    sdlc.createTask({
      id: 'task_sdlc_crud_2',
      description: 'Create Kubernetes Helm chart deployment',
      status: 'completed',
      project_path: '/path/to/project'
    }, testDbPath);

    const allTasks = sdlc.listTasks({}, testDbPath);
    assert.ok(allTasks.length >= 2, 'Should list at least 2 tasks');

    const completedTasks = sdlc.listTasks({ status: 'completed' }, testDbPath);
    assert.strictEqual(completedTasks.length, 1);
    assert.strictEqual(completedTasks[0].id, 'task_sdlc_crud_2');
    console.log('✓ Task listing and filtering passed');

    // 3. Evidence Persistence
    const evidenceData = {
      verified: true,
      verification_reason: 'validation evidence contains a passing command/exit-code marker',
      validation: ['npm test exited 0', '0 errors and 0 warnings'],
      agent: 'anbu',
      recorded_at: new Date().toISOString()
    };
    sdlc.recordEvidence('task_sdlc_crud_1', evidenceData, testDbPath);

    const withEvidence = sdlc.getTask('task_sdlc_crud_1', testDbPath);
    assert.strictEqual(withEvidence.status, 'completed');
    assert.strictEqual(withEvidence.evidence.verified, true);
    assert.strictEqual(withEvidence.evidence.validation.length, 2);
    console.log('✓ Evidence persistence passed');

    // 4. Slop Result Recording
    const slopData = {
      pass: true,
      findings: [],
      scanned_at: new Date().toISOString()
    };
    sdlc.recordSlopResult('task_sdlc_crud_1', slopData, 2, testDbPath);

    const withSlop = sdlc.getTask('task_sdlc_crud_1', testDbPath);
    assert.strictEqual(withSlop.slop_result.pass, true);
    assert.strictEqual(withSlop.slop_cycles, 2);
    console.log('✓ Slop result recording passed');

    // 5. MCP Tool: get_task_evidence
    sdlc.createTask({
      id: 'task_sdlc_crud_1',
      description: 'Implement secure JWT authentication endpoints',
      status: 'completed',
      project_path: '/path/to/project'
    });
    sdlc.recordEvidence('task_sdlc_crud_1', evidenceData);
    sdlc.recordSlopResult('task_sdlc_crud_1', slopData, 2);

    const evidenceToolRes = JSON.parse(await executeTool('get_task_evidence', { task_id: 'task_sdlc_crud_1' }));
    assert.strictEqual(evidenceToolRes.task_id, 'task_sdlc_crud_1');
    assert.ok(evidenceToolRes.evidence);
    console.log('✓ get_task_evidence tool passed');

    // 6. MCP Tool: get_slop_findings
    const slopToolRes = JSON.parse(await executeTool('get_slop_findings', { task_id: 'task_sdlc_crud_1' }));
    assert.strictEqual(slopToolRes.task_id, 'task_sdlc_crud_1');
    assert.ok(slopToolRes.slop_result);
    assert.strictEqual(slopToolRes.slop_cycles, 2);
    console.log('✓ get_slop_findings tool passed');

    // 7. CLI: konoha task list
    const listOut = execSync('node bin/cli.js task list', { encoding: 'utf8' });
    const cleanListOut = listOut.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(cleanListOut.includes('SDLC Governance Tasks'));
    console.log('✓ CLI konoha task list passed');

    // 8. CLI: konoha task show
    const showOut = execSync('node bin/cli.js task show task_sdlc_crud_1', { encoding: 'utf8' });
    const cleanShowOut = showOut.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(cleanShowOut.includes('task_sdlc_crud_1'));
    assert.ok(cleanShowOut.includes('Validation Evidence') || cleanShowOut.includes('Status'));
    console.log('✓ CLI konoha task show passed');

    // 9. CLI: konoha task slop
    const slopOut = execSync('node bin/cli.js task slop task_sdlc_crud_1', { encoding: 'utf8' });
    const cleanSlopOut = slopOut.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(cleanSlopOut.includes('Anti-Slop Audit for Task: task_sdlc_crud_1'));
    console.log('✓ CLI konoha task slop passed');

    // 10. Unit: deleteTask
    const deleted1 = sdlc.deleteTask('task_sdlc_crud_1', testDbPath);
    assert.strictEqual(deleted1, true, 'deleteTask must return true when task existed');
    const fetchedDeleted = sdlc.getTask('task_sdlc_crud_1', testDbPath);
    assert.strictEqual(fetchedDeleted, null, 'Deleted task must not be retrievable');
    const deleteNonExistent = sdlc.deleteTask('non_existent_task_xyz', testDbPath);
    assert.strictEqual(deleteNonExistent, false, 'deleteTask must return false for non-existent task');
    console.log('✓ deleteTask unit test passed');

    // 11. Unit: deleteTasks with filters & clearTasks
    sdlc.createTask({ id: 'task_del_filter_1', description: 'Filter test 1', status: 'draft' }, testDbPath);
    sdlc.createTask({ id: 'task_del_filter_2', description: 'Filter test 2', status: 'draft' }, testDbPath);
    sdlc.createTask({ id: 'task_del_filter_3', description: 'Filter test 3', status: 'completed' }, testDbPath);

    const filterResult = sdlc.deleteTasks({ status: 'draft' }, testDbPath);
    assert.strictEqual(filterResult.deleted, 2, 'deleteTasks by status must delete 2 matching tasks');

    const clearResult = sdlc.clearTasks(testDbPath);
    assert.ok(clearResult.deleted >= 1, 'clearTasks must delete remaining tasks');
    const remainingTasks = sdlc.listTasks({}, testDbPath);
    assert.strictEqual(remainingTasks.length, 0, 'All tasks must be cleared');
    console.log('✓ deleteTasks and clearTasks unit tests passed');

    // 12. CLI: konoha task delete <id>
    sdlc.createTask({ id: 'task_cli_del_1', description: 'CLI delete test', status: 'draft' }, testDbPath);
    const cliDelOut = execSync('node bin/cli.js task delete task_cli_del_1', { encoding: 'utf8' });
    assert.ok(cliDelOut.includes("deleted successfully"), 'CLI task delete output must confirm deletion');
    assert.strictEqual(sdlc.getTask('task_cli_del_1', testDbPath), null, 'CLI deleted task must not exist');
    console.log('✓ CLI konoha task delete passed');

    // 13. CLI: konoha task clear
    sdlc.createTask({ id: 'task_cli_clear_1', description: 'CLI clear test 1' }, testDbPath);
    sdlc.createTask({ id: 'task_cli_clear_2', description: 'CLI clear test 2' }, testDbPath);
    const cliClearOut = execSync('node bin/cli.js task clear', { encoding: 'utf8' });
    assert.ok(cliClearOut.includes('Cleared'), 'CLI task clear output must report cleared tasks');
    assert.strictEqual(sdlc.listTasks({}, testDbPath).length, 0, 'CLI clear must leave task list empty');
    console.log('✓ CLI konoha task clear passed');

  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log('All test_sdlc_tasks tests passed cleanly!\n');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
