#!/usr/bin/env node
'use strict';

require('./helpers/isolate_db');

/**
 * tests/test_token_budget_gate.js — Orchestration payload budget gate.
 *
 * Guards the two payloads Konoha pays for on every dispatch: the assembled
 * subagent prompt and the canonical tool schema surface. Also asserts that
 * repeat dispatches of the same task are byte-identical, because clients
 * cache prompt prefixes and any drift destroys that cache.
 */

const assert = require('assert');
const path = require('path');
const { encode } = require('gpt-tokenizer');

const ROOT = path.resolve(__dirname, '..');
const PROMPT_CEILING_BYTES = 8000;
const CANONICAL_TOOL_COUNT = 56;
const LIMIT_CANONICAL_SCHEMA_TOKENS = 7300;
const SPAWNABLE = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin', 'akatsuki', 'yamanaka'];

const { runMcpAgent } = require(path.join(ROOT, 'src', 'mcp', 'memory_subagent_runner'));
const listToolSchemas = require(path.join(ROOT, 'src', 'file_tools_router')).listToolSchemas;

console.log('Running test_token_budget_gate.js...');

// 1. Canonical tool surface must not grow.
const schemas = listToolSchemas();
assert.strictEqual(schemas.length, CANONICAL_TOOL_COUNT, `tools/list must stay at ${CANONICAL_TOOL_COUNT} tools`);
const schemaTokens = encode(JSON.stringify(schemas)).length;
assert(
  schemaTokens <= LIMIT_CANONICAL_SCHEMA_TOKENS,
  `tools/list schema surface ${schemaTokens} tokens exceeds ${LIMIT_CANONICAL_SCHEMA_TOKENS}`
);

// 2. Every spawnable agent's prompt stays under the ceiling.
const projectPath = process.cwd();
const built = new Map();
for (const agent of SPAWNABLE) {
  const raw = runMcpAgent(agent, { task: `Budget gate probe for ${agent}`, projectPath });
  const parsed = JSON.parse(raw);
  assert.strictEqual(parsed.status, 'ready', `${agent}: spawn prompt must build (got ${parsed.status})`);
  const bytes = Buffer.byteLength(parsed.instructions, 'utf8');
  assert(bytes <= PROMPT_CEILING_BYTES, `${agent}: prompt ${bytes} bytes exceeds ${PROMPT_CEILING_BYTES}`);
  assert(!Object.prototype.hasOwnProperty.call(parsed, 'tool_block'), `${agent}: dispatch payload must not carry a duplicate tool_block`);
  built.set(agent, parsed.instructions);
}

// 3. Prefix-cache stability: same (agent, task) must render byte-identical.
const repeat = JSON.parse(runMcpAgent('genin', { task: 'Budget gate probe for genin', projectPath })).instructions;
assert.strictEqual(repeat, built.get('genin'), 'repeat dispatch of the same task must be byte-identical for prefix caching');

// 4. Delegation envelope carries no stringified objects and no workflow bookkeeping.
const { buildDelegationEnvelope } = require(path.join(ROOT, 'src', 'mcp', 'sannin_router'));
const envelope = buildDelegationEnvelope({ agentName: 'genin', projectPath, prompt: 'map the routing module', routedSkills: [] });
assert(!envelope.text.includes('[object Object]'), 'soul tenets must render, not stringify');
assert(!envelope.recall.some((line) => line.includes('[flow_skill]')), 'workflow bookkeeping rows must not consume recall slots');
assert(encode(envelope.text).length <= 900, `delegation envelope ${encode(envelope.text).length} tokens exceeds 900`);

// 5. Sibling findings must never push a prompt past the ceiling. Agents run
//    close to 8000 bytes, so the block has to shrink (or vanish) instead of
//    letting clampToBytes eat the system prompt.
const sharedContext = require(path.join(ROOT, 'src', 'mcp', 'shared_context'));
const { getResolvedTaskDir } = require(path.join(ROOT, 'src', 'mcp', 'workflow_common'));
const probeTaskId = 'task-budget-shared-probe';
for (const agent of SPAWNABLE) {
  sharedContext.recordFinding({ agent, taskId: probeTaskId, summary: 'x'.repeat(400), verified: true, projectPath });
}
const probeTaskDir = getResolvedTaskDir(probeTaskId, projectPath);
const findingsReport = [];
for (const agent of SPAWNABLE) {
  const withFindings = JSON.parse(runMcpAgent(agent, { task: `Budget gate probe for ${agent}`, projectPath, taskDir: probeTaskDir }));
  const bytes = Buffer.byteLength(withFindings.instructions, 'utf8');
  assert(bytes <= PROMPT_CEILING_BYTES, `${agent}: prompt with findings ${bytes} bytes exceeds ${PROMPT_CEILING_BYTES}`);
  const hasBlock = withFindings.instructions.includes('Shared Task Context');
  // The block is dropped only when the agent genuinely has no room for it.
  assert(hasBlock || bytes > PROMPT_CEILING_BYTES - 200, `${agent}: ${PROMPT_CEILING_BYTES - bytes} bytes free, block was dropped`);
  findingsReport.push(`${agent}=${bytes}${hasBlock ? '+block' : ''}`);
}

console.log(`  prompt bytes: ${SPAWNABLE.map((a) => `${a}=${Buffer.byteLength(built.get(a), 'utf8')}`).join(' ')}`);
console.log(`  canonical schemas: ${schemas.length} tools, ${schemaTokens} tokens`);
console.log(`  with findings: ${findingsReport.join(' ')}`);
console.log('PASS test_token_budget_gate.js');
