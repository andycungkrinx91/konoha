/**
 * Test Suite: reverse-impact graph traversal.
 *
 * `code_impact` answers "what breaks if I change this?" by walking
 * `code_refs` backwards. The traversal is the only place in the engine with
 * unbounded shape (real code has cycles), so the caps and the termination
 * rules get their own test: depth, node count, cycles, and the choice of
 * enclosing symbol when references nest.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-code-intel-graph-'));
process.env.HOME = tmpRoot;
process.env.USERPROFILE = tmpRoot;
process.env.KONOHA_HOME = path.join(tmpRoot, '.konoha');
process.env.KONOHA_DB_PATH = path.join(tmpRoot, 'graph.db');

const db = require('../src/db');
const tools = require('../src/code_intel/tools');
const { IMPACT_MAX_DEPTH, IMPACT_MAX_NODES } = require('../src/code_intel/config');

db.setupSchema(db.getConnection());

const REPO = path.join(tmpRoot, 'repo');

const FILES = {
  // Two functions that call each other: the traversal must terminate.
  'cycle.js': [
    'function ping(n) {',
    '  return pong(n);',
    '}',
    '',
    'function pong(n) {',
    '  return ping(n);',
    '}',
    ''
  ].join('\n'),
  // A chain a -> b -> c -> d built from distinct files.
  'chain.js': [
    'function alpha() {',
    '  return beta();',
    '}',
    '',
    'function beta() {',
    '  return gamma();',
    '}',
    ''
  ].join('\n'),
  'deep.js': [
    'function gamma() {',
    '  return delta();',
    '}',
    ''
  ].join('\n'),
  'leaf.js': [
    'function delta() {',
    '  return 1;',
    '}',
    ''
  ].join('\n'),
  // Nested symbols: the reference sits inside `inner`, so `inner` is the
  // enclosing symbol, not the outer function.
  'nested.js': [
    'function outer() {',
    '  function inner() {',
    '    return delta();',
    '  }',
    '  return inner();',
    '}',
    ''
  ].join('\n'),
  // Many callers, to exercise the node cap.
  'fan.js': Array.from({ length: 30 }, (_, i) => `function caller${i}() {\n  return delta();\n}\n`).join('\n')
};

function buildRepo() {
  fs.mkdirSync(REPO, { recursive: true });
  for (const [rel, body] of Object.entries(FILES)) {
    fs.writeFileSync(path.join(REPO, rel), body, 'utf8');
  }
}

function run() {
  console.log('Running test_code_intel_graph tests...');
  buildRepo();
  const indexed = tools.code_index({ root: REPO });
  assert.strictEqual(indexed.status, 'fresh', `index failed: ${JSON.stringify(indexed).slice(0, 200)}`);

  // --- cycle termination -------------------------------------------------
  const ping = tools.code_impact({ root: REPO, name: 'ping', max_depth: IMPACT_MAX_DEPTH });
  assert.ok(!ping.error, `code_impact failed: ${ping.error}`);
  assert.ok(ping.dependents.length > 0, 'ping is called by pong, so the cycle must be walked at least once');
  assert.ok(ping.dependents.length < 50, `Cycle must not explode: ${ping.dependents.length} nodes`);
  const pingNames = ping.dependents.map((d) => d.enclosing);
  assert.ok(pingNames.includes('function pong'), 'pong calls ping');
  // A node is never revisited: at most one entry per (path, line).
  const keys = ping.dependents.map((d) => `${d.path}:${d.line}`);
  assert.strictEqual(new Set(keys).size, keys.length, 'Traversal must not emit duplicate reference sites');

  // --- transitive depth --------------------------------------------------
  const depth1 = tools.code_impact({ root: REPO, name: 'delta', max_depth: 1 });
  assert.ok(depth1.dependents.every((d) => d.depth === 1), 'max_depth=1 must yield direct callers only');

  const depth2 = tools.code_impact({ root: REPO, name: 'delta', max_depth: 2 });
  assert.ok(depth2.dependents.some((d) => d.depth === 2), 'gamma and the callers of the nested inner must appear at depth 2');

  const full = tools.code_impact({ root: REPO, name: 'delta' });
  assert.ok(full.max_depth <= IMPACT_MAX_DEPTH, 'Traversal depth is capped by config');
  assert.ok(full.dependents.some((d) => d.depth === 3), 'The chain delta <- gamma <- beta <- alpha reaches depth 3');
  assert.ok(!full.dependents.some((d) => d.depth > IMPACT_MAX_DEPTH));

  // --- enclosing symbol selection ---------------------------------------
  const nested = full.dependents.filter((d) => d.path === 'nested.js' && d.depth === 1);
  assert.strictEqual(nested.length, 1);
  assert.strictEqual(nested[0].enclosing, 'function inner', 'The innermost enclosing symbol owns the reference');
  assert.strictEqual(nested[0].line, 3);
  // One level up, the same file contributes again: inner is now the callee.
  assert.ok(full.dependents.some((d) => d.path === 'nested.js' && d.depth === 2 && d.enclosing === 'function outer'),
    'outer calls inner, so it becomes a depth-2 dependent');

  // --- node cap ----------------------------------------------------------
  const capped = tools.code_impact({ root: REPO, name: 'delta', max_nodes: 5 });
  assert.strictEqual(capped.dependents.length, 5, 'max_nodes must bound the result');
  assert.strictEqual(capped.truncated, true, 'A capped result must say it was capped');

  const wide = tools.code_impact({ root: REPO, name: 'delta', max_nodes: 1000 });
  assert.ok(wide.dependents.length <= IMPACT_MAX_NODES, 'The configured ceiling still applies');

  // --- ordering ----------------------------------------------------------
  const ordered = tools.code_impact({ root: REPO, name: 'delta', max_depth: 3 });
  for (let i = 1; i < ordered.dependents.length; i++) {
    assert.ok(ordered.dependents[i - 1].depth <= ordered.dependents[i].depth, 'Results are ordered by depth');
  }

  // --- unknown symbol ----------------------------------------------------
  const ghost = tools.code_impact({ root: REPO, name: 'neverDeclaredAnywhere' });
  assert.deepStrictEqual(ghost.dependents, []);
  assert.strictEqual(ghost.truncated, false);

  // --- unscoped root still works ----------------------------------------
  const unscoped = tools.code_impact({ name: 'delta', max_depth: 1 });
  assert.ok(unscoped.dependents.length >= 1, 'Omitting root searches every indexed root');

  // --- an unindexed root is an error, not an empty answer ---------------
  const unknownRoot = tools.code_impact({ root: path.join(tmpRoot, 'never-indexed'), name: 'delta' });
  assert.ok(unknownRoot.error, 'A root that was never indexed must be reported as such');

  console.log('✓ Code-intelligence impact graph: cycles, depth, caps, enclosing symbols verified.');
}

run();
