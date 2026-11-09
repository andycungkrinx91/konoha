#!/usr/bin/env node
'use strict';

/**
 * tests/test_mcp_argument_parsing.js
 *
 * The MCP boundary must accept every argument shape a client adapter can send,
 * and must fail legibly (invalid_arguments, isError) instead of throwing or
 * silently dropping a call.
 */

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tempDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_args_')), 'test.db');
process.env.KONOHA_DB_PATH = tempDb;

const { parseToolArguments, handleToolCall } = require('../src/file_tools_mcp.js');

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  PASS ${label}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${label}: ${err.message}`);
  }
}

check('object arguments pass through unchanged', () => {
  const input = { task: 'do work', nested: { a: 1 } };
  const result = parseToolArguments('kage', input);
  assert.strictEqual(result.error, null);
  assert.deepStrictEqual(result.args, input);
});

check('JSON string arguments are parsed', () => {
  const result = parseToolArguments('kage', '{"task":"do work"}');
  assert.strictEqual(result.error, null);
  assert.strictEqual(result.args.task, 'do work');
});

check('unicode payload survives string parsing', () => {
  const result = parseToolArguments('kage', JSON.stringify({ task: '設計 → テスト ✓' }));
  assert.strictEqual(result.args.task, '設計 → テスト ✓');
});

check('null and undefined become empty args', () => {
  assert.deepStrictEqual(parseToolArguments('list_skills', null), { args: {}, error: null });
  assert.deepStrictEqual(parseToolArguments('list_skills', undefined), { args: {}, error: null });
});

check('empty string becomes empty args', () => {
  assert.deepStrictEqual(parseToolArguments('list_skills', '   '), { args: {}, error: null });
});

check('delegation tools wrap prose as task', () => {
  for (const tool of ['genin', 'kage', 'jonin', 'anbu', 'chunin', 'tokubetsu_jonin', 'sannin', 'akatsuki']) {
    const result = parseToolArguments(tool, 'plain prose task');
    assert.strictEqual(result.error, null, tool);
    assert.strictEqual(result.args.task, 'plain prose task', tool);
  }
});

check('malformed JSON on a non-delegation tool is an error', () => {
  const result = parseToolArguments('list_skills', '{bad json');
  assert.strictEqual(result.args.doesNotExist, undefined);
  assert.ok(result.error, 'expected an error');
  assert.match(result.error, /JSON Parse error/);
});

check('array arguments are rejected with a type error', () => {
  const result = parseToolArguments('list_skills', '[1,2,3]');
  assert.match(result.error, /must be a JSON object, got array/);
});

check('numeric arguments are rejected', () => {
  const result = parseToolArguments('list_skills', 42);
  assert.match(result.error, /must be a JSON object, got number/);
});

check('handleToolCall returns invalid_arguments with isError', () => {
  const response = handleToolCall(99, { name: 'list_skills', arguments: '{bad json' });
  assert.strictEqual(response.result.isError, true);
  const payload = JSON.parse(response.result.content[0].text);
  assert.strictEqual(payload.error, 'invalid_arguments');
  assert.strictEqual(payload.tool, 'list_skills');
});

check('handleToolCall parses a JSON string before dispatch', () => {
  const response = handleToolCall(100, { name: 'token_efficient_grep', arguments: JSON.stringify({ pattern: 'require', dir: 'tests/helpers', max_matches: 1 }) });
  assert.strictEqual(response.result.isError, false);
  assert.ok(response.result.content[0].text.length > 0);
});

// Glob regression: `dir/**/*.js` is the idiomatic recursive filter, so it has to
// match files one level down, not only two or more. Windows callers write the
// separator as a backslash and must get the same result.
const { tokenEfficientGrep } = require('../src/file_tools/token_efficient_grep.js');
const grepCount = (glob) => tokenEfficientGrep({
  pattern: 'function ', dir: 'src/file_tools', glob, max_matches: 50
}).count;

check('recursive doublestar glob matches files one level down', () => {
  const oneLevel = grepCount('*.js');
  assert.ok(oneLevel > 0, 'baseline glob must match');
  assert.strictEqual(grepCount('**/*.js'), oneLevel, '**/*.js must include the level-1 files');
});

check('windows-style backslash glob matches the same files as posix', () => {
  assert.strictEqual(grepCount('**\\*.js'), grepCount('**/*.js'));
});

check('glob with no matches still reports zero rather than throwing', () => {
  assert.strictEqual(grepCount('**/*.tsx'), 0);
});

fs.rmSync(path.dirname(tempDb), { recursive: true, force: true });

console.log(failures === 0 ? '\nmcp argument parsing: OK' : `\nmcp argument parsing: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
