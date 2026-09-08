#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../src/db');
const server = require('../src/server');

const DB_PATH = path.join(os.homedir(), '.konoha', 'konoha.db');

function setupTask(taskRoot, name, promptText = null, delegateText = null) {
  const d = path.join(taskRoot, name);
  fs.mkdirSync(d, { recursive: true });
  if (promptText !== null) {
    fs.writeFileSync(path.join(d, 'prompt.md'), promptText, 'utf8');
  }
  if (delegateText !== null) {
    fs.writeFileSync(path.join(d, 'delegate.md'), delegateText, 'utf8');
  }
  return d;
}

async function run() {
  const taskRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_deleg_'));
  try {
    // Phase 1: Sannin keyword-routing heuristics
    console.log('Testing Phase 1: Sannin routing...');
    const taskUi = setupTask(taskRoot, 'ui');
    const resUi = JSON.parse(server.runSannin('build a sveltekit responsive landing page component', taskUi));
    assert.strictEqual(resUi.status, 'routed');
    assert.strictEqual(resUi.selected_agent, 'jonin');
    assert.strictEqual(resUi.phase, 'delegation');

    const taskBackend = setupTask(taskRoot, 'backend');
    const resBackend = JSON.parse(server.runSannin('fix the api endpoint bug, deploy via ci/cd docker kubernetes', taskBackend));
    assert.strictEqual(resBackend.status, 'routed');
    assert.strictEqual(resBackend.selected_agent, 'anbu');

    const taskArch = setupTask(taskRoot, 'arch');
    const resArch = JSON.parse(server.runSannin('design system architecture for scalability and security audit risk', taskArch));
    assert.strictEqual(resArch.status, 'routed');
    assert.strictEqual(resArch.selected_agent, 'kage');

    const taskResearch = setupTask(taskRoot, 'research');
    const resResearch = JSON.parse(server.runSannin('research web search documentation compliance evidence citation', taskResearch));
    assert.strictEqual(resResearch.status, 'routed');
    assert.strictEqual(resResearch.selected_agent, 'chunin');

    const taskDocs = setupTask(taskRoot, 'docs');
    const resDocs = JSON.parse(server.runSannin('write readme runbook api spec technical guide prd', taskDocs));
    assert.strictEqual(resDocs.status, 'routed');
    assert.strictEqual(resDocs.selected_agent, 'tokubetsu_jonin');

    const taskExplore = setupTask(taskRoot, 'explore');
    const resExplore = JSON.parse(server.runSannin('explore and trace the codepath dependency call graph usage', taskExplore));
    assert.strictEqual(resExplore.status, 'routed');
    assert.strictEqual(resExplore.selected_agent, 'genin');

    const taskDefault = setupTask(taskRoot, 'default');
    const resDefault = JSON.parse(server.runSannin('do the thing', taskDefault));
    assert.strictEqual(resDefault.status, 'routed');
    assert.strictEqual(resDefault.selected_agent, 'kage');
    console.log('✓ Phase 1 routing heuristics passed');

    // Phase 2: Full delegation cycle for anbu
    console.log('Testing Phase 2: Full delegation cycle...');
    const taskCycle = setupTask(taskRoot, 'cycle', 'fix the api endpoint bug, deploy via ci/cd docker');
    const resCycle1 = JSON.parse(server.runSannin(null, taskCycle));
    assert.strictEqual(resCycle1.status, 'routed');
    assert.strictEqual(resCycle1.selected_agent, 'anbu');
    assert.strictEqual(resCycle1.phase, 'delegation');
    assert.ok(resCycle1.instructions.includes('Write `delegate.md`'));

    const delegateContent = '---\nagent: anbu\npriority: high\n---\n\n## Task\n\nFix the failing API endpoint and redeploy to production.\n';
    fs.writeFileSync(path.join(taskCycle, 'delegate.md'), delegateContent, 'utf8');

    const resCycle2 = JSON.parse(server.runMcpAgent('anbu', null, null, null, null, null, null, taskCycle));
    assert.strictEqual(resCycle2.status, 'ready');
    assert.strictEqual(resCycle2.phase, 'execution');
    assert.strictEqual(resCycle2.agent, 'anbu');
    assert.strictEqual(resCycle2.task_dir, taskCycle);
    assert.strictEqual(fs.existsSync(path.join(taskCycle, 'result.md')), false);

    const resultContent = '## Result\n\nFixed the API endpoint bug; redeployed successfully.\n';
    fs.writeFileSync(path.join(taskCycle, 'result.md'), resultContent, 'utf8');

    const resCycle3 = JSON.parse(server.runSannin(null, taskCycle));
    assert.strictEqual(resCycle3.status, 'completed');
    assert.strictEqual(resCycle3.phase, 'result');
    assert.strictEqual(resCycle3.result, resultContent.trim());
    console.log('✓ Phase 2 delegation cycle passed');

    // Phase 3: Skill loading verification
    console.log('Testing Phase 3: Skill loading...');
    const taskAnbuSkill = setupTask(taskRoot, 'anbu_skill', null, '---\nyaml: foo\n---\n\nFix this API bug end-to-end.\n');
    const resAnbuSkill = JSON.parse(server.runMcpAgent('anbu', null, null, null, null, null, null, taskAnbuSkill));
    assert.strictEqual(resAnbuSkill.status, 'ready');
    const instrAnbu = resAnbuSkill.instructions;
    assert.ok(instrAnbu.includes('### Skill: anbu-skill'));
    assert.ok(instrAnbu.includes('Purpose:'));
    assert.ok(instrAnbu.includes('Instructions:'));
    assert.ok(instrAnbu.includes('Constraints:'));
    assert.ok(instrAnbu.includes('## TASK INSTRUCTIONS'));
    assert.ok(instrAnbu.includes('Fix this API bug end-to-end.'));
    assert.ok(instrAnbu.includes('## Execution Protocol'));
    assert.ok(instrAnbu.includes('result.md'));

    const taskJoninSkill = setupTask(taskRoot, 'jonin_skill', null, 'Build a SvelteKit dashboard component.\n');
    const resJoninSkill = JSON.parse(server.runMcpAgent('jonin', null, null, null, null, null, null, taskJoninSkill));
    assert.strictEqual(resJoninSkill.status, 'ready');
    assert.ok(resJoninSkill.instructions.includes('jonin-skill'));

    const taskSanninInstr = setupTask(taskRoot, 'sannin_instr', 'build a sveltekit landing page component');
    const resSanninInstr = JSON.parse(server.runSannin(null, taskSanninInstr));
    assert.strictEqual(resSanninInstr.status, 'routed');
    assert.ok(resSanninInstr.instructions.includes('**Selected Agent**: `jonin`'));
    assert.ok(resSanninInstr.instructions.includes('**Reason**:'));
    assert.ok(resSanninInstr.instructions.includes('Write `delegate.md`'));
    assert.ok(resSanninInstr.instructions.includes('Call `jonin`'));
    assert.ok(resSanninInstr.instructions.includes('Write `result.md`'));
    assert.ok(resSanninInstr.instructions.includes('build a sveltekit landing page component'));
    console.log('✓ Phase 3 skill loading passed');

    // Phase 4: Attribution
    console.log('Testing Phase 4: Client attribution...');
    process.env.CLAUDE_CODE_CHILD_SESSION = '1';
    delete process.env.ANTIGRAVITY_CONVERSATION_ID;
    delete process.env.AGY_SESSION;

    const taskAttr = setupTask(taskRoot, 'attribution', 'do the thing');
    server.runSannin(null, taskAttr);

    const conn = db.getConnection(DB_PATH);
    const row = conn.prepare("SELECT client FROM tool_calls ORDER BY id DESC LIMIT 1").get();
    conn.close();
    assert.ok(row, 'tool_calls row should exist');
    assert.strictEqual(String(row.client).toLowerCase(), 'claudecode');
    console.log('✓ Phase 4 client attribution passed');

    console.log('\nAll test_agent_delegation checks passed cleanly!');
  } finally {
    fs.rmSync(taskRoot, { recursive: true, force: true });
    delete process.env.CLAUDE_CODE_CHILD_SESSION;
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
