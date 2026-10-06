#!/usr/bin/env node
'use strict';

/**
 * tests/test_qa_tool_permissions.js — Verifies that qa_codify and qa_e2e_run
 * are granted to Anbu only, and forbidden/hidden from Genin, Jonin, Kage, Chunin, etc.
 */

const assert = require('assert');
const { buildSubagentMcpBlock } = require('../src/mcp/memory_reporting');

console.log('Running test_qa_tool_permissions.js...');

// 1. Anbu must be granted qa_codify and qa_e2e_run
const anbuTools = buildSubagentMcpBlock('antigravity', 'anbu');
assert.ok(anbuTools.includes('mcp__konoha__qa_codify'), 'Anbu must receive mcp__konoha__qa_codify');
assert.ok(anbuTools.includes('mcp__konoha__qa_e2e_run'), 'Anbu must receive mcp__konoha__qa_e2e_run');
assert.ok(anbuTools.includes('Anbu is granted `qa_codify` and `qa_e2e_run`'), 'Anbu boundary text must specify QA tool grant');

// 2. Other agents must NOT be granted QA tools
const otherAgents = ['genin', 'jonin', 'kage', 'chunin', 'tokubetsu_jonin', 'sannin'];
for (const agent of otherAgents) {
  const agentTools = buildSubagentMcpBlock('antigravity', agent);
  assert.ok(!agentTools.includes('mcp__konoha__qa_codify'), `${agent} must NOT receive qa_codify`);
  assert.ok(!agentTools.includes('mcp__konoha__qa_e2e_run'), `${agent} must NOT receive qa_e2e_run`);
}

console.log('✓ test_qa_tool_permissions.js passed cleanly.');
