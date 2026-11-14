#!/usr/bin/env node
'use strict';

/**
 * tests/test_subagent_mcp_block.js — Tests for the subagent MCP block injection and tool boundaries.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
require('./helpers/isolate_db');
const server = require('../src/server');

const SUBAGENTS = ['genin', 'chunin', 'kage', 'jonin', 'anbu', 'tokubetsu-jonin'];

async function run() {
  console.log('Running test_subagent_mcp_block tests...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent_mcp_block_'));

  function invoke(agentName) {
    if (server.SESSION_TURNS) server.SESSION_TURNS.clear();
    // Structured task text only — never a delegate.md fixture.
    const res = JSON.parse(server.runMcpAgent(agentName, 'Analyze this codebase and improve it.', null, null, null, null, null, tmpDir));
    return res.instructions || '';
  }

  try {
    // Block appears before task instructions
    const textKage = invoke('kage');
    const blockIdx = textKage.indexOf('MCP Tools Available To You');
    const taskIdx = textKage.indexOf('## TASK INSTRUCTIONS');
    assert.ok(blockIdx > -1, 'block missing');
    assert.ok(taskIdx > -1, 'task section missing');
    assert.ok(blockIdx < taskIdx, 'MCP block must appear before TASK INSTRUCTIONS');
    console.log('✓ Block appears before task instructions passed');

    // Core MCP tools shared across subagents
    for (const a of SUBAGENTS) {
      const text = invoke(a);
      assert.ok(text.includes('mcp__konoha__sannin'), `${a} missing mcp__konoha__sannin`);
      assert.ok(text.includes('mcp__konoha__find_skill'), `${a} missing mcp__konoha__find_skill`);
      assert.ok(text.includes('mcp__konoha__get_skill'), `${a} missing mcp__konoha__get_skill`);
      assert.ok(text.includes('mcp__konoha__code_search'), `${a} missing mcp__konoha__code_search`);
      assert.ok(!text.includes('mcp__semble__'), `${a} must not reference the retired semble server`);
    }
    console.log('✓ Core MCP tools shared across subagents passed');

    // Routing rules present
    const textRouting = invoke('kage');
    assert.ok(textRouting.includes('mcp__konoha__sannin'));
    assert.ok(textRouting.includes('mcp__konoha__find_skill'));
    console.log('✓ Routing rules present passed');

    // Genin and Kage cannot reach aislop_fix
    for (const role of ['genin', 'kage']) {
      const text = invoke(role);
      const toolsSection = text.slice(
        text.indexOf('## MCP Tools Available To You'),
        text.indexOf('### Strict Tool Boundaries')
      );
      assert.ok(toolsSection.includes('aislop_scan'), `${role} should have aislop_scan`);
      assert.ok(toolsSection.includes('aislop_why'), `${role} should have aislop_why`);
      assert.ok(!toolsSection.includes('aislop_fix'), `${role} must not have aislop_fix`);
      assert.ok(!toolsSection.includes('aislop_baseline'), `${role} must not have aislop_baseline`);
    }
    console.log('✓ Genin and Kage tool boundaries passed');

    // Anbu and Jonin can reach aislop_fix
    for (const role of ['jonin', 'anbu']) {
      const text = invoke(role);
      const toolsSection = text.slice(
        text.indexOf('## MCP Tools Available To You'),
        text.indexOf('### Strict Tool Boundaries')
      );
      assert.ok(toolsSection.includes('aislop_scan'), `${role} should have aislop_scan`);
      assert.ok(toolsSection.includes('aislop_why'), `${role} should have aislop_why`);
      assert.ok(toolsSection.includes('aislop_fix'), `${role} should have aislop_fix`);
      assert.ok(!toolsSection.includes('aislop_baseline'), `${role} must not have aislop_baseline`);
    }
    console.log('✓ Jonin and Anbu tool boundaries passed');

    console.log('\nAll test_subagent_mcp_block tests passed!');
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
