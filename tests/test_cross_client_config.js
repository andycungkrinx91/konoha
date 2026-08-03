#!/usr/bin/env node
/**
 * Test cross-client MCP configuration compatibility and Cursor model aliases (C10).
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('Running test_cross_client_config.js...');

// 1. Test mcp_clients_manager.js exports and functions
const mcpClients = require('../src/mcp_clients_manager');
assert.strictEqual(typeof mcpClients.isClaudeCodeInstalled, 'function', 'isClaudeCodeInstalled should be exported as a function');
assert.strictEqual(typeof mcpClients.ensureClaudeCodeSetup, 'function', 'ensureClaudeCodeSetup should be exported');
console.log('  ✓ mcp_clients_manager exports verified.');

// 2. Test cursor_manager.js CURSOR_MODEL_ALIASES
const cursorMgr = require('../src/cursor_manager');
assert.strictEqual(typeof cursorMgr.resolveCursorModel, 'function', 'resolveCursorModel should be exported');

const sampleAgent = {
  name: 'test-agent',
  model_tier: 'Gemini 3.5 Flash (High)'
};
const resolved = cursorMgr.resolveCursorModel(sampleAgent);
assert.strictEqual(resolved, 'inherit', 'Gemini 3.5 Flash (High) should map to inherit in Cursor aliases');

const sampleAgent2 = {
  name: 'test-agent-2',
  model_tier: 'Claude Sonnet 4.6 (Thinking)'
};
const resolved2 = cursorMgr.resolveCursorModel(sampleAgent2);
assert.strictEqual(resolved2, 'inherit', 'Claude Sonnet 4.6 (Thinking) should map to inherit in Cursor aliases');

console.log('  ✓ cursor_manager model aliases verified.');

console.log('All tests in test_cross_client_config.js passed!\n');
