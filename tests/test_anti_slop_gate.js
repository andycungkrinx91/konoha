#!/usr/bin/env node
'use strict';

/**
 * tests/test_anti_slop_gate.js — Verifies the Zero-AI-Slop Gate (aislop MCP Integration).
 *
 * Covers Part D requirements from PLAN_FEATURE.md:
 * D.1 Gate-blocking tests (zero-slop verification, missing fields block, clean pass, report row)
 * D.2 Tool-boundary tests (Genin & Kage read-only, Anbu & Jonin execution auto-fix)
 * D.3 Config wiring smoke test (Antigravity, Cursor, Claude Code, Command Code, OpenCode, Codex)
 * D.4 Dispatch-instruction consistency test (kage delegate.md requires ai_slop_findings & ai_slop_clean)
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const server = require('../src/server');

async function run() {
  console.log('Running test_anti_slop_gate tests...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anti_slop_'));

  try {
    // --- D.1 Gate-blocking tests ---

    // 1. Blocked when ai_slop_findings > 0
    let status1 = {
      phase: 'review',
      tasks: [
        { id: 'task-1', agent: 'anbu', task: 'Build backend', status: 'completed', result: 'Done', validation: ['pass'] }
      ],
      executed: {
        'task-1': { agent: 'anbu', task: 'Build backend', result: 'Done', validation: ['pass'] }
      }
    };
    server.saveWorkflowStatus(tmpDir, status1);
    server.runMcpWorkflow(tmpDir);

    const reviewArtifact1 = {
      approved: true,
      confidence: 100,
      verified_task_ids: ['task-1'],
      security_reviewed: true,
      rollback_reviewed: true,
      validation: ['all tests passed'],
      ai_slop_findings: 3,
      ai_slop_clean: false,
      findings: []
    };
    fs.writeFileSync(path.join(tmpDir, 'kage_review.json'), JSON.stringify(reviewArtifact1));
    fs.writeFileSync(path.join(tmpDir, 'result.md'), 'Review flagged AI-slop violations.');

    const res1 = JSON.parse(server.runMcpWorkflow(tmpDir));
    assert.strictEqual(res1.status, 'blocked', 'Non-zero ai_slop_findings must block workflow approval.');
    assert.strictEqual(res1.phase, 'review');
    console.log('✓ Blocked when ai_slop_findings > 0 passed');

    // 2. Blocked when ai_slop fields missing
    let status2 = {
      phase: 'review',
      tasks: [
        { id: 'task-1', agent: 'anbu', task: 'Build backend', status: 'completed', result: 'Done', validation: ['pass'] }
      ],
      executed: {
        'task-1': { agent: 'anbu', task: 'Build backend', result: 'Done', validation: ['pass'] }
      }
    };
    server.saveWorkflowStatus(tmpDir, status2);
    server.runMcpWorkflow(tmpDir);

    const reviewArtifact2 = {
      approved: true,
      confidence: 98,
      verified_task_ids: ['task-1'],
      security_reviewed: true,
      rollback_reviewed: true,
      validation: ['all tests passed successfully']
    };
    fs.writeFileSync(path.join(tmpDir, 'kage_review.json'), JSON.stringify(reviewArtifact2));
    fs.writeFileSync(path.join(tmpDir, 'result.md'), 'Legacy review completed.');

    const res2 = JSON.parse(server.runMcpWorkflow(tmpDir));
    assert.strictEqual(res2.status, 'blocked', 'Missing ai_slop fields must block approval.');
    assert.strictEqual(res2.phase, 'review');
    console.log('✓ Blocked when ai_slop fields missing passed');

    // 3. Approved when ai_slop clean
    let status3 = {
      phase: 'review',
      tasks: [
        { id: 'task-1', agent: 'anbu', task: 'Build backend', status: 'completed', result: 'Done', validation: ['pass'] }
      ],
      executed: {
        'task-1': { agent: 'anbu', task: 'Build backend', result: 'Done', validation: ['pass'] }
      }
    };
    server.saveWorkflowStatus(tmpDir, status3);
    server.runMcpWorkflow(tmpDir);

    const reviewArtifact3 = {
      approved: true,
      confidence: 98,
      verified_task_ids: ['task-1'],
      security_reviewed: true,
      rollback_reviewed: true,
      ai_slop_findings: 0,
      ai_slop_clean: true,
      validation: ['all tests passed cleanly'],
      findings: []
    };
    fs.writeFileSync(path.join(tmpDir, 'kage_review.json'), JSON.stringify(reviewArtifact3));
    fs.writeFileSync(path.join(tmpDir, 'result.md'), 'Kage verified 0 AI-slop issues.');

    const res3 = JSON.parse(server.runMcpWorkflow(tmpDir));
    assert.strictEqual(res3.status, 'completed', 'Clean review must advance to completed phase.');
    assert.strictEqual(res3.phase, 'done');
    assert.ok(fs.existsSync(path.join(tmpDir, 'final_report.md')));
    console.log('✓ Approved when ai_slop clean passed');

    // 4. Report includes AI Slop row
    const reportContent = fs.readFileSync(path.join(tmpDir, 'final_report.md'), 'utf-8');
    assert.ok(
      reportContent.includes('| **AI Slop Scan** | All changed files | ai_slop_findings = 0 | **100%** | ✅ Passed |'),
      'Report must contain AI Slop Scan row'
    );
    console.log('✓ AI Slop row in final report passed');

    // --- D.2 Tool-boundary tests ---

    // 5. Genin and Kage cannot reach aislop_fix
    fs.writeFileSync(path.join(tmpDir, 'delegate.md'), 'Analyze and plan.');
    for (const role of ['genin', 'kage']) {
      server.SESSION_TURNS && server.SESSION_TURNS.clear();
      const res = JSON.parse(server.runMcpAgent(role, tmpDir));
      const instructions = res.instructions || '';
      const toolsSection = instructions.slice(
        instructions.indexOf('## MCP Tools Available To You'),
        instructions.indexOf('### Strict Tool Boundaries')
      );
      assert.ok(toolsSection.includes('aislop_scan'), `${role} must have aislop_scan`);
      assert.ok(toolsSection.includes('aislop_why'), `${role} must have aislop_why`);
      assert.ok(!toolsSection.includes('aislop_fix'), `${role} must NOT have aislop_fix`);
      assert.ok(!toolsSection.includes('aislop_baseline'), `${role} must NOT have aislop_baseline`);
    }
    console.log('✓ Genin and Kage tool boundaries passed');

    // 6. Anbu and Jonin can reach aislop_fix
    fs.writeFileSync(path.join(tmpDir, 'delegate.md'), 'Build and fix.');
    for (const role of ['jonin', 'anbu']) {
      server.SESSION_TURNS && server.SESSION_TURNS.clear();
      const res = JSON.parse(server.runMcpAgent(role, tmpDir));
      const instructions = res.instructions || '';
      const toolsSection = instructions.slice(
        instructions.indexOf('## MCP Tools Available To You'),
        instructions.indexOf('### Strict Tool Boundaries')
      );
      assert.ok(toolsSection.includes('aislop_scan'), `${role} must have aislop_scan`);
      assert.ok(toolsSection.includes('aislop_why'), `${role} must have aislop_why`);
      assert.ok(toolsSection.includes('aislop_fix'), `${role} must have aislop_fix`);
      assert.ok(!toolsSection.includes('aislop_baseline'), `${role} must NOT have aislop_baseline`);
    }
    console.log('✓ Jonin and Anbu tool boundaries passed');

    // --- D.3 Config wiring smoke test ---

    // 7. Config wiring smoke test
    const rootDir = path.resolve(__dirname, '..');
    const { updateCodexTomlMcp } = require('../src/codex_manager');
    const outCodex = updateCodexTomlMcp('', 'node', '/path/to/server.js', 'uvx');
    assert.ok(outCodex.includes('[mcp_servers.aislop]'));
    assert.ok(outCodex.includes('aislop_scan'));
    assert.ok(outCodex.includes('aislop_fix'));

    const { buildStdioMcpServers, KONOHA_MCP_NAMES } = require('../src/mcp_clients_manager');
    const servers = buildStdioMcpServers({});
    assert.ok(KONOHA_MCP_NAMES.includes('aislop'));
    assert.ok(servers.aislop);

    assert.ok(fs.existsSync(path.join(rootDir, '.aislop', 'config.yml')));
    console.log('✓ Config wiring smoke test passed');

    // --- D.4 Dispatch-instruction consistency test ---

    // Clean up any review artifacts from previous steps
    if (fs.existsSync(path.join(tmpDir, 'kage_review.json'))) fs.unlinkSync(path.join(tmpDir, 'kage_review.json'));
    if (fs.existsSync(path.join(tmpDir, 'delegate.md'))) fs.unlinkSync(path.join(tmpDir, 'delegate.md'));
    if (fs.existsSync(path.join(tmpDir, 'result.md'))) fs.unlinkSync(path.join(tmpDir, 'result.md'));

    // 8. Kage dispatch prompt mentions AI slop fields
    let status4 = {
      phase: 'review',
      tasks: [
        { id: 'task-1', agent: 'anbu', task: 'Build backend', status: 'completed', result: 'Done', validation: ['pass'] }
      ],
      executed: {
        'task-1': { agent: 'anbu', task: 'Build backend', result: 'Done', validation: ['pass'] }
      }
    };
    server.saveWorkflowStatus(tmpDir, status4);
    server.runMcpWorkflow(tmpDir);

    const delegatePath = path.join(tmpDir, 'delegate.md');
    assert.ok(fs.existsSync(delegatePath));
    const promptText = fs.readFileSync(delegatePath, 'utf-8');
    assert.ok(promptText.includes('aislop_scan'));
    assert.ok(promptText.includes('ai_slop_findings'));
    assert.ok(promptText.includes('ai_slop_clean'));
    console.log('✓ Kage dispatch prompt mentions AI slop fields passed');

    console.log('\nAll anti_slop_gate tests passed!');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
