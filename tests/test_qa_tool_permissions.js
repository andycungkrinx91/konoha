#!/usr/bin/env node
'use strict';

/**
 * tests/test_qa_tool_permissions.js — Verifies that qa_codify and qa_e2e_run
 * are present in the manifest tool catalog under full parity, and that archetype
 * boundaries designate Anbu as the backend/QA specialist.
 */

const assert = require('assert');
const { buildSubagentMcpBlock } = require('../src/mcp/memory_subagent_runner');

console.log('Running test_qa_tool_permissions.js...');

// All agents receive full manifest tool parity including qa_codify and qa_e2e_run.
const anbuTools = buildSubagentMcpBlock('antigravity', 'anbu');
assert.ok(anbuTools.includes('mcp__konoha__qa_codify'), 'Anbu must receive mcp__konoha__qa_codify');
assert.ok(anbuTools.includes('mcp__konoha__qa_e2e_run'), 'Anbu must receive mcp__konoha__qa_e2e_run');
assert.ok(anbuTools.includes('anbu backend/QA'), 'Anbu boundary text must specify backend/QA specialty');

console.log('✓ test_qa_tool_permissions.js passed cleanly.');
