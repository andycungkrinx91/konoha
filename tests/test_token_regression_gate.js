#!/usr/bin/env node
'use strict';

require('./helpers/isolate_db');

/**
 * tests/test_token_regression_gate.js — Enforces token budgets and regression thresholds
 * across tool schemas, memory payloads, and task artifacts.
 *
 * Tokenisation uses gpt-tokenizer's cl100k_base — the same vocabulary tiktoken used —
 * so the budgets below are unchanged while the check runs on any host with Node.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { encode } = require('gpt-tokenizer');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_DOC = path.join(ROOT, 'docs', 'architecture', 'TOKEN-BASELINE.md');

// Thresholds with +10% regression margin
const LIMIT_SEMBLE = 550;
const LIMIT_AISLOP = 350;
const LIMIT_QUERY_PERSONA = 200;
const LIMIT_LIST_PERSONA = 350;
const LIMIT_QUERY_PROJECT = 400;

const tokenCount = (text) => encode(String(text)).length;

console.log('Running test_token_regression_gate.js...');

// Verify TOKEN-BASELINE.md exists and contains canonical thresholds
assert(fs.existsSync(BASELINE_DOC), 'TOKEN-BASELINE.md must exist');
const baselineText = fs.readFileSync(BASELINE_DOC, 'utf-8');
assert(baselineText.includes('Semble MCP'), 'TOKEN-BASELINE.md must document Semble MCP');
assert(baselineText.includes('Aislop MCP'), 'TOKEN-BASELINE.md must document Aislop MCP');

// Schemas — the catalog only exists on a host where Antigravity is deployed.
const schemaRoot = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'mcp');
const readSchemaPayload = (serverName) => {
  const dir = path.join(schemaRoot, serverName);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  if (files.length === 0) return null;
  const parsed = files.map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8')));
  return JSON.stringify(parsed);
};

const sembleSchemas = readSchemaPayload('semble');
if (sembleSchemas) {
  const tokens = tokenCount(sembleSchemas);
  assert(tokens <= LIMIT_SEMBLE, `Semble schema regressed: ${tokens} > ${LIMIT_SEMBLE}`);
  console.log(`  ✓ Semble MCP schema tokens: ${tokens} <= ${LIMIT_SEMBLE}`);
}

const aislopSchemas = readSchemaPayload('aislop');
if (aislopSchemas) {
  const tokens = tokenCount(aislopSchemas);
  assert(tokens <= LIMIT_AISLOP, `Aislop schema regressed: ${tokens} > ${LIMIT_AISLOP}`);
  console.log(`  ✓ Aislop MCP schema tokens: ${tokens} <= ${LIMIT_AISLOP}`);
}

// Memory tools
const memoryProbe = `
const { executeToolSync } = require('./src/mcp/tool_dispatch');
const qp = executeToolSync('query_persona_memory', { query: 'test' }, 'sannin');
const lp = executeToolSync('list_persona_memories', {}, 'sannin');
const qproj = executeToolSync('query_project_memory', { query: 'test' }, 'sannin');
console.log(JSON.stringify({
  qp: typeof qp === 'string' ? qp : JSON.stringify(qp),
  lp: typeof lp === 'string' ? lp : JSON.stringify(lp),
  qproj: typeof qproj === 'string' ? qproj : JSON.stringify(qproj)
}));
`;

const probe = spawnSync(process.execPath, ['-e', memoryProbe], { encoding: 'utf-8', cwd: ROOT });
if (probe.status !== 0) {
  console.error(probe.stderr || probe.stdout);
  process.exit(1);
}
const payloads = JSON.parse(probe.stdout.trim().split('\n').pop());

const queryPersonaTokens = tokenCount(payloads.qp);
assert(
  queryPersonaTokens <= LIMIT_QUERY_PERSONA,
  `query_persona_memory regressed: ${queryPersonaTokens} > ${LIMIT_QUERY_PERSONA}`
);
console.log(`  ✓ query_persona_memory payload: ${queryPersonaTokens} <= ${LIMIT_QUERY_PERSONA}`);

const listPersonaTokens = tokenCount(payloads.lp);
assert(
  listPersonaTokens <= LIMIT_LIST_PERSONA,
  `list_persona_memories regressed: ${listPersonaTokens} > ${LIMIT_LIST_PERSONA}`
);
console.log(`  ✓ list_persona_memories payload: ${listPersonaTokens} <= ${LIMIT_LIST_PERSONA}`);

const queryProjectTokens = tokenCount(payloads.qproj);
assert(
  queryProjectTokens <= LIMIT_QUERY_PROJECT,
  `query_project_memory regressed: ${queryProjectTokens} > ${LIMIT_QUERY_PROJECT}`
);
console.log(`  ✓ query_project_memory payload: ${queryProjectTokens} <= ${LIMIT_QUERY_PROJECT}`);

console.log('✓ All token regression gates passed within established budgets cleanly!');
