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
const store = require('../src/code_intel/store');
const tools = require('../src/code_intel/tools');
require('../src/file_tools_router').setWorkspaceRoot(tmpRoot);
const { IMPACT_MAX_DEPTH, IMPACT_MAX_NODES } = require('../src/code_intel/config');

const _setupConn = db.getConnection();
try {
  db.setupSchema(_setupConn);
} finally {
  _setupConn.close();
}

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

async function runAsyncCrossFileEdges() {
  const { indexRepositoryAsync } = require('../src/code_intel/indexer');
  const query = require('../src/code_intel/query');
  const tsRepo = path.join(tmpRoot, 'ts_edges_repo');
  fs.mkdirSync(path.join(tsRepo, 'src', 'auth'), { recursive: true });
  fs.writeFileSync(
    path.join(tsRepo, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }),
    'utf8'
  );
  fs.writeFileSync(
    path.join(tsRepo, 'src', 'auth', 'jwt.ts'),
    'export interface Auditable { audit(): void; }\nexport function verifyToken(t: string) { return t.length > 0; }\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(tsRepo, 'src', 'base.ts'),
    'export class BaseService { init() { return true; } }\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(tsRepo, 'src', 'session.ts'),
    [
      "import { verifyToken, Auditable } from '@/auth/jwt';",
      "import { BaseService } from './base';",
      "export * from '@/auth/jwt';",
      'export class SessionService extends BaseService implements Auditable {',
      '  audit() { return verifyToken("abc"); }',
      '}',
      ''
    ].join('\n'),
    'utf8'
  );

  const conn = db.getConnection();
  try {
    const idx = await indexRepositoryAsync({ rootPath: tsRepo, conn });
    assert.strictEqual(idx.status, 'fresh');
    assert.ok(idx.edges >= 4, `Expected cross-file imports/reexports/extends/implements edges, got ${idx.edges}`);
    assert.ok(idx.edgesResolved >= 4, `Expected edgesResolved >= 4, got ${idx.edgesResolved}`);

    const edges = conn.prepare(`
    SELECT e.edge_kind, e.specifier, fsrc.rel_path AS src_path, ftgt.rel_path AS tgt_path, stgt.name AS tgt_sym
    FROM code_edges e
    JOIN code_files fsrc ON fsrc.id = e.source_file_id
    LEFT JOIN code_files ftgt ON ftgt.id = e.target_file_id
    LEFT JOIN code_symbols stgt ON stgt.id = e.target_symbol_id
    WHERE e.root_hash = ?
  `).all(idx.rootHash);

    assert.ok(
      edges.some((e) => e.edge_kind === 'imports' && e.src_path === 'src/session.ts' && e.tgt_path === 'src/auth/jwt.ts'),
      'tsconfig @/* alias import must resolve to src/auth/jwt.ts'
    );
    assert.ok(
      edges.some((e) => e.edge_kind === 'reexports' && e.src_path === 'src/session.ts' && e.tgt_path === 'src/auth/jwt.ts'),
      'reexport must resolve target_file_id cleanly'
    );
    assert.ok(
      edges.some((e) => e.edge_kind === 'extends' && e.src_path === 'src/session.ts' && e.tgt_sym === 'BaseService'),
      'extends clause must resolve target_symbol_id BaseService'
    );
    assert.ok(
      edges.some((e) => e.edge_kind === 'implements' && e.src_path === 'src/session.ts' && e.tgt_sym === 'Auditable'),
      'implements clause must resolve target_symbol_id Auditable'
    );

    const baseImpact = query.impact({ rootPath: tsRepo, name: 'BaseService', conn });
    assert.ok(
      baseImpact.nodes.some((n) => n.relPath === 'src/session.ts' && n.kind === 'extends'),
      'query.impact must traverse resolved extends code_edges'
    );
    console.log('✓ Cross-file AST code_edges (aliases, reexports, extends, implements) & impact traversal verified.');
  } finally {
    try { conn.close(); } catch (_) { /* ignore */ }
  }
}

(async () => {
  try {
    run();
    await runAsyncCrossFileEdges();
  } finally {
    store.closeConnection();
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})();
