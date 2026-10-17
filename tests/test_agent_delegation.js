#!/usr/bin/env node
// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');
// Sannin keyword-routing reads agents.delegation_keywords — seed the defaults.
require('./helpers/seed_agents');

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../src/db');
const server = require('../src/server');

const DB_PATH = process.env.KONOHA_DB_PATH || path.join(os.homedir(), '.konoha', 'konoha.db');

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
    const taskCycle = setupTask(taskRoot, 'cycle');
    const promptText = 'fix the api endpoint bug, deploy via ci/cd docker';
    const resCycle1 = JSON.parse(server.runSannin(promptText, taskCycle));
    assert.strictEqual(resCycle1.status, 'routed');
    assert.strictEqual(resCycle1.selected_agent, 'anbu');
    assert.strictEqual(resCycle1.phase, 'delegation');
    assert.ok(resCycle1.instructions.includes('Call `anbu`'));
    assert.ok(resCycle1.instructions.includes('konoha.report_from_agent'));

    const taskInstruction = 'Fix the failing API endpoint and redeploy to production.';
    const resCycle2 = JSON.parse(server.runMcpAgent('anbu', taskInstruction, null, null, null, null, null, taskCycle));
    assert.strictEqual(resCycle2.status, 'ready');
    assert.strictEqual(resCycle2.phase, 'execution');
    assert.strictEqual(resCycle2.agent, 'anbu');
    assert.strictEqual(resCycle2.task_dir, taskCycle);

    const resultContent = 'Fixed the API endpoint bug; redeployed successfully.';
    const resCycle3 = JSON.parse(server.reportFromAgent('anbu', resultContent, 'completed', [], [], [], taskRoot, taskCycle));
    assert.strictEqual(resCycle3.status, 'recorded');
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
    assert.ok(instrAnbu.includes('report_from_agent'));

    const taskJoninSkill = setupTask(taskRoot, 'jonin_skill', null, 'Build a SvelteKit dashboard component.\n');
    const resJoninSkill = JSON.parse(server.runMcpAgent('jonin', null, null, null, null, null, null, taskJoninSkill));
    assert.strictEqual(resJoninSkill.status, 'ready');
    assert.ok(resJoninSkill.instructions.includes('jonin-skill'));

    const taskSanninInstr = setupTask(taskRoot, 'sannin_instr');
    const resSanninInstr = JSON.parse(server.runSannin('build a sveltekit landing page component', taskSanninInstr));
    assert.strictEqual(resSanninInstr.status, 'routed');
    assert.ok(resSanninInstr.instructions.includes('**Selected Agent**: `jonin`'));
    assert.ok(resSanninInstr.instructions.includes('**Reason**:'));
    assert.ok(resSanninInstr.instructions.includes('Call `jonin`'));
    assert.ok(resSanninInstr.instructions.includes('konoha.report_from_agent'));
    assert.ok(resSanninInstr.instructions.includes('build a sveltekit landing page component'));
    console.log('✓ Phase 3 skill loading passed');

    // Phase 4: Attribution
    console.log('Testing Phase 4: Client attribution...');
    process.env.CLAUDE_CODE_CHILD_SESSION = '1';
    delete process.env.ANTIGRAVITY_CONVERSATION_ID;
    delete process.env.AGY_SESSION;

    const taskAttr = setupTask(taskRoot, 'attribution');
    server.runSannin('do the thing', taskAttr);

    const conn = db.getConnection(DB_PATH);
    const row = conn.prepare("SELECT client FROM tool_calls ORDER BY id DESC LIMIT 1").get();
    conn.close();
    assert.ok(row, 'tool_calls row should exist');
    assert.strictEqual(String(row.client).toLowerCase(), 'claudecode');
    console.log('✓ Phase 4 client attribution passed');

    // Phase 5: Compact Mode Persona Budget & Constraints Invariant
    console.log('Testing Phase 5: Compact mode Constraints preservation across all official agents...');
    const officialAgents = ['kage', 'jonin', 'anbu', 'chunin', 'genin', 'tokubetsu_jonin', 'sannin'];
    const { runMcpAgent } = require('../src/mcp/memory_reporting');

    // Seed realistic instructions and constraints to test compact budget under load
    const connSeed = db.getConnection(DB_PATH);
    for (const ag of officialAgents) {
      const dbName = ag.replace('_', '-');
      connSeed.prepare("UPDATE agents SET instructions = ?, constraints_text = ? WHERE name = ?")
        .run("Word ".repeat(400), "Rule ".repeat(50), dbName);
    }
    connSeed.close();

    for (const ag of officialAgents) {
      const taskComp = setupTask(taskRoot, `compact_${ag}`, null, 'Task payload for compaction check.\n');
      const statusFile = path.join(taskComp, 'status.json');
      fs.writeFileSync(statusFile, JSON.stringify({ turn: 2, tasks: [] }), 'utf8');

      const resComp = JSON.parse(runMcpAgent(ag, null, null, null, null, null, null, taskComp));
      assert.strictEqual(resComp.status, 'ready');
      const instr = resComp.instructions;

      assert.ok(
        instr.includes('Constraints:'),
        `Constraints: must be present in compact mode for agent @${ag}`
      );

      const personaMatch = instr.match(/(\[Konoha Auto-Compact:[\s\S]*?Constraints:[\s\S]*?\n\n)/);
      if (personaMatch) {
        const personaBlock = personaMatch[1];
        const constraintsMatch = personaBlock.match(/Constraints: ([\s\S]*?)\n\n$/);
        const constraintsLen = constraintsMatch ? constraintsMatch[1].length : 0;
        if (constraintsLen <= 600) {
          assert.ok(
            personaBlock.length <= 1400,
            `Persona block for @${ag} exceeds cap: ${personaBlock.length} > 1400`
          );
        }
      }
    }
    console.log('✓ Phase 5 compact mode Constraints preservation passed');

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
