#!/usr/bin/env node
'use strict';

/**
 * tests/test_qa_tool_permissions.js — Verifies that qa_codify and qa_e2e_run
 * are present across all agents under full manifest tool parity, and that archetype
 * boundaries designate Anbu as the backend/QA specialist.
 */

const assert = require('assert');
const { buildSubagentMcpBlock } = require('../src/mcp/memory_subagent_runner');

console.log('Running test_qa_tool_permissions.js...');

// All official agents receive full manifest tool parity including qa_codify and qa_e2e_run.
const allAgents = ['genin', 'jonin', 'kage', 'chunin', 'anbu', 'tokubetsu_jonin', 'sannin', 'akatsuki'];
for (const agent of allAgents) {
  const tools = buildSubagentMcpBlock('antigravity', agent);
  assert.ok(tools.includes('mcp__konoha__qa_codify'), `${agent} must receive mcp__konoha__qa_codify under tool parity`);
  assert.ok(tools.includes('mcp__konoha__qa_e2e_run'), `${agent} must receive mcp__konoha__qa_e2e_run under tool parity`);
}

// Anbu boundaries designate backend and QA specialization
const anbuTools = buildSubagentMcpBlock('antigravity', 'anbu');
assert.ok(anbuTools.includes('anbu backend/QA'), 'Anbu boundary text must specify backend/QA specialty');

console.log('✓ test_qa_tool_permissions.js passed cleanly: full manifest tool parity verified across all 8 agents.');
