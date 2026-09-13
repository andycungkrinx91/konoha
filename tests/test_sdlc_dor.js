#!/usr/bin/env node
// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

/**
 * tests/test_sdlc_dor.js — Tests Definition-of-Readiness (DoR) Engine & Gate.
 * Covers Phase 2 & 3 of PLAN_NATIVE_SDLC.md:
 * - Substance / token count heuristic (< 5 words rejected)
 * - Placeholder / template marker rejection (TODO, FIXME, ???, etc.)
 * - File / path existence verification
 * - Skill domain keyword matching
 * - Advisory mode (dispatches with missing[] hints)
 * - Enforced mode (blocks dispatch with structured missing prompt)
 * - check_readiness MCP tool contract
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sdlc = require('../src/sdlc_manager');
const server = require('../src/server');

async function run() {
  console.log('Running test_sdlc_dor tests...');

  // 1. Brief prompt rejection (< 5 words)
  const r1 = sdlc.checkReadiness('fix it');
  assert.strictEqual(r1.ready, false, 'Brief prompt must not be ready');
  assert.strictEqual(r1.confidence, 'low');
  assert.ok(r1.missing.some(m => m.includes('< 5 words')));
  console.log('✓ Brief prompt rejection passed');

  // 2. Placeholder rejection
  const r2 = sdlc.checkReadiness('Implement user authentication API with TODO in controller');
  assert.strictEqual(r2.ready, false, 'Task with TODO must not be ready');
  assert.ok(r2.missing.some(m => m.includes('TODO')));

  const r3 = sdlc.checkReadiness('Build dashboard component with [insert metrics here]');
  assert.strictEqual(r3.ready, false);
  assert.ok(r3.missing.some(m => m.includes('[insert')));
  console.log('✓ Placeholder rejection passed');

  // 3. Stale / non-existent file path reference
  const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'dor_proj_'));
  try {
    fs.writeFileSync(path.join(tmpProject, 'existing.js'), '// code');

    const rPathBad = sdlc.checkReadiness('Refactor the database queries in non_existent_file.js for better performance', tmpProject);
    assert.strictEqual(rPathBad.ready, false);
    assert.ok(rPathBad.missing.some(m => m.includes('non_existent_file.js') && m.includes('does not exist')));

    const rPathGood = sdlc.checkReadiness('Refactor the database queries in existing.js for backend performance', tmpProject);
    assert.strictEqual(rPathGood.ready, true);
    assert.strictEqual(rPathGood.missing.length, 0);
    assert.strictEqual(rPathGood.confidence, 'high');
    console.log('✓ File path existence check passed');

    // 4. Intention to create new file should not be penalized
    const rCreate = sdlc.checkReadiness('Create new backend auth module in src/auth_service.js with JWT verification', tmpProject);
    assert.strictEqual(rCreate.ready, true);
    assert.strictEqual(rCreate.missing.length, 0);
    console.log('✓ New file creation intention not penalized passed');

    // 5. Skill domain keyword matching
    const rNoDomain = sdlc.checkReadiness('The quick brown fox jumps over the lazy dog in the field', tmpProject);
    assert.strictEqual(rNoDomain.ready, false);
    assert.ok(rNoDomain.missing.some(m => m.includes('No matching skill domain')));
    console.log('✓ Skill domain keyword check passed');

    // 6. Workflow integration: Advisory Mode (default)
    const taskDirAdv = fs.mkdtempSync(path.join(os.tmpdir(), 'dor_adv_'));
    sdlc.setProjectSdlcConfig(tmpProject, { dor_mode: 'advisory' });
    const resAdv = JSON.parse(server.runSannin('fix bug', taskDirAdv));
    assert.strictEqual(resAdv.status, 'routed', 'Advisory mode must still route task');
    assert.ok(resAdv.dor_result, 'dor_result must be present');
    assert.strictEqual(resAdv.dor_result.ready, false);
    assert.ok(resAdv.instructions.includes('Definition-of-Readiness (DoR) Advisory Hints'));
    console.log('✓ Advisory mode dispatch passed');

    // 7. Workflow integration: Enforced Mode
    const taskDirEnf = fs.mkdtempSync(path.join(os.tmpdir(), 'dor_enf_'));
    sdlc.setProjectSdlcConfig(tmpProject, { dor_mode: 'enforced' });
    server.setWorkspaceRoot(tmpProject);
    const resEnf = JSON.parse(server.runSannin('fix it', taskDirEnf));
    assert.strictEqual(resEnf.status, 'blocked', 'Enforced mode must block vague task');
    assert.strictEqual(resEnf.phase, 'dor');
    assert.ok(resEnf.missing.length > 0);
    console.log('✓ Enforced mode blocking passed');

    // 8. Enforced Mode with ready prompt
    const resEnfReady = JSON.parse(server.runSannin('Refactor the database queries in existing.js for backend performance', taskDirEnf));
    assert.strictEqual(resEnfReady.status, 'routed', 'Enforced mode must route ready task');
    console.log('✓ Enforced mode routing ready task passed');

    // 9. MCP check_readiness tool
    const { executeTool } = require('../src/mcp/tool_dispatch');
    const mcpRes = JSON.parse(await executeTool('check_readiness', { task: 'build ui component with tailwind', project_path: tmpProject }));
    assert.strictEqual(mcpRes.ready, true);
    assert.strictEqual(mcpRes.confidence, 'high');
    console.log('✓ check_readiness MCP tool passed');

  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }

  console.log('All test_sdlc_dor tests passed cleanly!\n');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
