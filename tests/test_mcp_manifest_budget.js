#!/usr/bin/env node
// DB isolation: measurement must not touch the real DB.
require('./helpers/isolate_db');

'use strict';

/**
 * tests/test_mcp_manifest_budget.js — pins the per-session tool-schema payload.
 *
 * The manifest is sent on every `tools/list`, so it is a fixed cost paid by
 * every client on every session. It is not the cause of large per-request
 * token counts (those grow with conversation), but it must not drift upward
 * silently: adding a tool or a verbose alias should be a deliberate change
 * that shows up as a failing budget here.
 *
 * Budgets are measured from the served surface (`listToolSchemas()`), not the
 * file, because two deprecated names are filtered out before the client sees
 * them.
 */

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { listToolSchemas } = require('../src/file_tools_router');

const REPO_ROOT = path.resolve(__dirname, '..');

let passed = 0;

function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

const tools = listToolSchemas();
const bytesOf = (value) => Buffer.byteLength(JSON.stringify(value));

// Measured baseline 2026-11-19: 56 tools, 28,685 B. Headroom covers one more
// tool of average size; anything larger has to be argued for in review.
const TOTAL_BUDGET_BYTES = 30000;
const TOOL_BUDGET_BYTES = 1300;
const SERVED_TOOL_COUNT = 56;

// Every delegation tool repeats this preamble so the model can call any
// specialist without learning a new shape.
const DELEGATION_PREAMBLE = ['task', 'context', 'task_id', 'session_id'];

const DELEGATION_TOOLS = [
  'sannin', 'kage', 'genin', 'chunin', 'jonin', 'anbu',
  'tokubetsu_jonin', 'akatsuki', 'yamanaka'
];

console.log('\n[MCP manifest budget]');

check(`serves exactly ${SERVED_TOOL_COUNT} tools`, () => {
  assert.strictEqual(tools.length, SERVED_TOOL_COUNT);
});

check(`total payload stays under ${TOTAL_BUDGET_BYTES} bytes`, () => {
  const total = bytesOf(tools);
  assert.ok(total <= TOTAL_BUDGET_BYTES, `manifest is ${total} B, budget ${TOTAL_BUDGET_BYTES} B`);
});

check(`no single tool exceeds ${TOOL_BUDGET_BYTES} bytes`, () => {
  const over = tools
    .map((t) => [t.name, bytesOf(t)])
    .filter(([, size]) => size > TOOL_BUDGET_BYTES);
  assert.deepStrictEqual(over, [], `over budget: ${JSON.stringify(over)}`);
});

check('tool names are unique', () => {
  const names = tools.map((t) => t.name);
  assert.strictEqual(new Set(names).size, names.length);
});

check('every tool declares an object schema and refuses extra properties', () => {
  for (const tool of tools) {
    assert.ok(tool.description && tool.description.trim().length > 0, `${tool.name} needs a description`);
    const schema = tool.inputSchema;
    assert.ok(schema, `${tool.name} needs an inputSchema`);
    assert.strictEqual(schema.type, 'object', `${tool.name} schema must be an object`);
    assert.strictEqual(schema.additionalProperties, false, `${tool.name} must reject unknown properties`);
  }
});

check('alias alternatives keep their required arrays', () => {
  // File tools accept path/file_path/filepath; that compatibility is load
  // bearing, so the anyOf branches must survive any future trim.
  const withAliases = tools.filter((t) => Array.isArray(t.inputSchema.anyOf));
  assert.ok(withAliases.length > 0, 'expected file tools to declare alias alternatives');
  for (const tool of withAliases) {
    for (const branch of tool.inputSchema.anyOf) {
      assert.ok(Array.isArray(branch.required) && branch.required.length > 0,
        `${tool.name} anyOf branch lost its required array`);
    }
  }
});

check('delegation tools keep the shared call preamble', () => {
  for (const name of DELEGATION_TOOLS) {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, `${name} must be served`);
    for (const key of DELEGATION_PREAMBLE) {
      assert.ok(tool.inputSchema.properties[key], `${name} lost the ${key} parameter`);
    }
  }
});

check('no two tools share an identical description', () => {
  const seen = new Map();
  for (const tool of tools) {
    const key = tool.description.trim();
    assert.ok(!seen.has(key), `${tool.name} duplicates the description of ${seen.get(key)}`);
    seen.set(key, tool.name);
  }
});

// The three per-session budgets live in one script. It is run here so the
// contract-head ceiling cannot drift without failing a suite.
check('the context budget check passes', () => {
  const run = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'measure_context_budget.js'), '--check'], {
    encoding: 'utf8',
    cwd: REPO_ROOT
  });
  assert.strictEqual(run.status, 0, `measure_context_budget --check failed:\n${run.stdout}${run.stderr}`);
});

console.log(`\n${passed} checks passed (${bytesOf(tools)} B for ${tools.length} tools)\n`);
