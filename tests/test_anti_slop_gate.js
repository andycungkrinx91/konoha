#!/usr/bin/env node
// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

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
const sdlcManager = require('../src/workflow/kage-reviewer/sdlc_manager');

async function run() {
  console.log('Running test_anti_slop_gate tests...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anti_slop_'));

  try {
    // --- D.1 Gate-blocking tests ---

    // Blocked when ai_slop_findings > 0
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
    { const rd = JSON.parse(server.runMcpWorkflow(tmpDir)); if (rd.dispatch_id) { const stx = JSON.parse(fs.readFileSync(require('path').join(tmpDir, 'status.json'), 'utf8')); stx.completed_dispatches = [rd.dispatch_id]; stx.dispatch_results = { [rd.dispatch_id]: 'Kage review submitted via report_from_agent' }; server.saveWorkflowStatus(tmpDir, stx); } }

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
    { const stx = JSON.parse(fs.readFileSync(path.join(tmpDir, 'status.json'), 'utf8')); const did = stx.current_dispatch && stx.current_dispatch.id; if (did) server.reportFromAgent('kage', 'Kage review submitted', 'completed', null, null, null, null, tmpDir, did, ['review executed, exit 0']); }

    const res1 = JSON.parse(server.runMcpWorkflow(tmpDir));
    // Default-on remediation loop (PLAN_NATIVE_SDLC Section 2.4): actual findings must
    // dispatch a slop-fix remediation task instead of returning blocked.
    assert.strictEqual(res1.status, 'remediation', 'Non-zero ai_slop_findings must dispatch the remediation loop (default-on).');
    assert.strictEqual(res1.phase, 'execute');
    assert.strictEqual(res1.slop_cycles, 1);
    assert.ok(res1.dispatch_id, 'Remediation dispatch must have a dispatch id');
    console.log('✓ Remediation dispatched (default-on) when ai_slop_findings > 0 passed');

    // Blocked when ai_slop fields missing
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
    { const rd = JSON.parse(server.runMcpWorkflow(tmpDir)); if (rd.dispatch_id) { const stx = JSON.parse(fs.readFileSync(require('path').join(tmpDir, 'status.json'), 'utf8')); stx.completed_dispatches = [rd.dispatch_id]; stx.dispatch_results = { [rd.dispatch_id]: 'Kage review submitted via report_from_agent' }; server.saveWorkflowStatus(tmpDir, stx); } }

    const reviewArtifact2 = {
      approved: true,
      confidence: 98,
      verified_task_ids: ['task-1'],
      security_reviewed: true,
      rollback_reviewed: true,
      validation: ['all tests passed successfully']
    };
    fs.writeFileSync(path.join(tmpDir, 'kage_review.json'), JSON.stringify(reviewArtifact2));
    { const stx = JSON.parse(fs.readFileSync(path.join(tmpDir, 'status.json'), 'utf8')); const did = stx.current_dispatch && stx.current_dispatch.id; if (did) server.reportFromAgent('kage', 'Kage review submitted', 'completed', null, null, null, null, tmpDir, did, ['review executed, exit 0']); }

    const res2 = JSON.parse(server.runMcpWorkflow(tmpDir));
    assert.strictEqual(res2.status, 'blocked', 'Missing ai_slop fields must block approval.');
    assert.strictEqual(res2.phase, 'review');
    console.log('✓ Blocked when ai_slop fields missing passed');

    // Approved when ai_slop clean
    sdlcManager.setProjectSdlcConfig(tmpDir, { hitl_mode: 'disabled' });
    let status3 = {
      phase: 'review',
      project_path: tmpDir,
      tasks: [
        { id: 'task-1', agent: 'anbu', task: 'Build backend', status: 'completed', result: 'Done', validation: ['pass'] }
      ],
      executed: {
        'task-1': { agent: 'anbu', task: 'Build backend', result: 'Done', validation: ['pass'] }
      }
    };
    server.saveWorkflowStatus(tmpDir, status3);
    { const rd = JSON.parse(server.runMcpWorkflow(tmpDir)); if (rd.dispatch_id) { const stx = JSON.parse(fs.readFileSync(require('path').join(tmpDir, 'status.json'), 'utf8')); stx.completed_dispatches = [rd.dispatch_id]; stx.dispatch_results = { [rd.dispatch_id]: 'Kage review submitted via report_from_agent' }; server.saveWorkflowStatus(tmpDir, stx); } }

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
    { const stx = JSON.parse(fs.readFileSync(path.join(tmpDir, 'status.json'), 'utf8')); const did = stx.current_dispatch && stx.current_dispatch.id; if (did) server.reportFromAgent('kage', 'Kage review submitted', 'completed', null, null, null, null, tmpDir, did, ['review executed, exit 0']); }

    const res3Gate = JSON.parse(server.runMcpWorkflow(tmpDir));
    assert.strictEqual(res3Gate.status, 'pending_human_signoff', 'Gate 2 delivery sign-off is authoritative');
    const res3 = JSON.parse(server.runMcpWorkflow(tmpDir, { choice: '1. Compact and approve' }));
    assert.strictEqual(res3.status, 'completed', 'Clean review must advance to completed phase.');
    assert.strictEqual(res3.phase, 'done');
    assert.ok(fs.existsSync(path.join(tmpDir, 'final_report.md')));
    console.log('✓ Approved when ai_slop clean passed');

    // Report includes AI Slop row
    const reportContent = fs.readFileSync(path.join(tmpDir, 'final_report.md'), 'utf-8');
    assert.ok(
      reportContent.includes('| **AI Slop Scan** | All changed files | ai_slop_findings = 0 | **100%** | ✅ Passed |'),
      'Report must contain AI Slop Scan row'
    );
    console.log('✓ AI Slop row in final report passed');

    // --- D.2 Tool-boundary tests (2.2.15 full main-agent parity) ---
    // All official subagents see the full manifest tool catalog. Read-only
    // enforcement for genin/kage lives in guidance text, not tool omission.

    // Genin and Kage see full catalog but carry read-only guidance
    for (const role of ['genin', 'kage']) {
      server.SESSION_TURNS && server.SESSION_TURNS.clear();
      const res = JSON.parse(server.runMcpAgent(role, 'Analyze and plan.', null, null, null, null, null, tmpDir));
      const instructions = res.instructions || '';
      const toolsStart = instructions.indexOf('## MCP Tools Available To You');
      const toolsEnd = instructions.indexOf('### Strict Tool Boundaries');
      const toolsSection = toolsStart >= 0 && toolsEnd > toolsStart
        ? instructions.slice(toolsStart, toolsEnd)
        : (toolsStart >= 0 ? instructions.slice(toolsStart) : instructions);
      // Catalog rows are literal `- `mcp__...`` lines (no descriptions, to
      // preserve the <8KB ceiling); guidance prose names forbidden tools
      // separately and must NOT be substring-matched for absence.
      const catalogNames = (toolsSection.match(/^-\s+`mcp__[^`]+`/gm) || []).join('\n');
      assert.ok(catalogNames.includes('mcp__konoha__report_from_agent'), `${role} catalog must include full manifest parity`);
      assert.ok(catalogNames.includes('mcp__konoha__qa_codify'), `${role} catalog must include QA tools under parity`);
      assert.ok(catalogNames.includes('aislop_scan'), `${role} must have aislop_scan`);
      assert.ok(catalogNames.includes('aislop_why'), `${role} must have aislop_why`);
      assert.ok(!catalogNames.includes('aislop_fix'), `${role} must NOT have aislop_fix in catalog`);
      assert.ok(!catalogNames.includes('aislop_baseline'), `${role} catalog must NOT list aislop_baseline`);
      assert.ok(
        /strictly forbidden.*aislop_fix/i.test(instructions),
        `${role} must carry explicit forbidden guidance for aislop_fix`
      );
    }
    console.log('✓ Genin and Kage tool boundaries passed');

    // Anbu and Jonin can reach aislop_fix
    for (const role of ['jonin', 'anbu']) {
      server.SESSION_TURNS && server.SESSION_TURNS.clear();
      const res = JSON.parse(server.runMcpAgent(role, 'Build and fix.', null, null, null, null, null, tmpDir));
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

    // Config wiring smoke test
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

    // Clean up any review artifacts from previous steps (no file-IPC artifacts exist anymore)
    if (fs.existsSync(path.join(tmpDir, 'kage_review.json'))) fs.unlinkSync(path.join(tmpDir, 'kage_review.json'));

    // Kage dispatch prompt mentions AI slop fields
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
    const res4 = JSON.parse(server.runMcpWorkflow(tmpDir));

    const promptText = res4.task || '';
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
