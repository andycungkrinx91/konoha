/**
 * Test Suite: code-intelligence tools.
 *
 * Exercises the seven MCP handlers end to end against a real temporary
 * repository and a real schema-v6 database: index, search, symbol lookup,
 * context, reverse impact, status, removal. Also pins the two behaviours that
 * are easy to regress: incremental re-index must not rewrite unchanged files,
 * and an indexed repository must come out byte-identical.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-code-intel-tools-'));
process.env.HOME = tmpRoot;
process.env.USERPROFILE = tmpRoot;
process.env.KONOHA_HOME = path.join(tmpRoot, '.konoha');
process.env.KONOHA_DB_PATH = path.join(tmpRoot, 'tools.db');

const db = require('../src/db');
const store = require('../src/code_intel/store');
const tools = require('../src/code_intel/tools');
const router = require('../src/file_tools_router');
const { dispatchTool, dispatchToolAsync, prepareToolCall } = router;

router.setWorkspaceRoot(tmpRoot);
const _setupConn = db.getConnection();
try {
  db.setupSchema(_setupConn);
} finally {
  _setupConn.close();
}

const REPO = path.join(tmpRoot, 'repo');

const FILES = {
  'lib/math.js': [
    "const { log } = require('./log');",
    '',
    'function add(a, b) {',
    '  log(`add ${a} ${b}`);',
    '  return a + b;',
    '}',
    '',
    'function multiply(a, b) {',
    '  return add(a, a) * b;',
    '}',
    '',
    'module.exports = { add, multiply };',
    ''
  ].join('\n'),
  'lib/log.js': [
    'function log(message) {',
    '  return String(message);',
    '}',
    '',
    'module.exports = { log };',
    ''
  ].join('\n'),
  'app.js': [
    "const { multiply } = require('./lib/math');",
    '',
    'function main() {',
    '  return multiply(2, 3);',
    '}',
    '',
    'main();',
    ''
  ].join('\n'),
  'docs/readme.md': '# not indexed\n',
  'node_modules/junk/index.js': 'function junk() { return 1; }\n'
};

function buildRepo() {
  for (const [rel, body] of Object.entries(FILES)) {
    const full = path.join(REPO, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, 'utf8');
  }
}

function snapshot() {
  const out = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[path.relative(REPO, full)] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(REPO);
  return out;
}

async function run() {
  console.log('Running test_code_intel_tools tests...');
  buildRepo();
  const before = snapshot();

  // --- index -------------------------------------------------------------
  const indexed = tools.code_index({ root: REPO });
  assert.ok(!indexed.error, `code_index failed: ${indexed.error}`);
  assert.strictEqual(indexed.status, 'fresh');
  assert.strictEqual(indexed.files, 4, 'Source plus markdown are indexed; node_modules is not');
  assert.ok(indexed.symbols >= 4, `Expected add, multiply, log, main; got ${indexed.symbols}`);
  assert.ok(indexed.chunks >= 3);
  assert.strictEqual(indexed.errors, 0);

  // --- the analyzed repository is never modified -------------------------
  assert.deepStrictEqual(snapshot(), before, 'Indexing must not write to the analyzed repository');

  // --- incremental re-index ---------------------------------------------
  const again = tools.code_index({ root: REPO });
  assert.strictEqual(again.indexed_now, 0, 'An unchanged tree must index nothing');
  assert.strictEqual(again.unchanged, 4);
  assert.strictEqual(again.status, 'fresh');

  fs.writeFileSync(path.join(REPO, 'lib', 'log.js'), FILES['lib/log.js'].replace('String(message)', 'String(message) + "!"'), 'utf8');
  const changed = tools.code_index({ root: REPO });
  assert.strictEqual(changed.indexed_now, 1, 'Exactly the modified file must be re-indexed');
  assert.strictEqual(changed.removed, 0);

  // Deleted files leave the index; excluded directories never enter it.
  fs.unlinkSync(path.join(REPO, 'docs', 'readme.md'));
  fs.rmSync(path.join(REPO, 'node_modules'), { recursive: true, force: true });
  const pruned = tools.code_index({ root: REPO });
  assert.strictEqual(pruned.files, 3, 'A deleted file must be removed from the index');
  assert.strictEqual(pruned.removed, 1);
  const afterPrune = snapshot();
  assert.ok(tools.code_search({ root: REPO, query: 'not indexed' }).total === 0, 'Deleted content must leave the FTS index');

  // --- search ------------------------------------------------------------
  const hit = tools.code_search({ root: REPO, query: 'multiply' });
  assert.ok(!hit.error, `code_search failed: ${hit.error}`);
  assert.ok(hit.total >= 1);
  assert.strictEqual(hit.degraded, false, 'FTS5 is available, so search must not degrade');
  assert.ok(hit.hits.some((h) => h.path === 'lib/math.js'), 'The definition must be found');
  for (const h of hit.hits) {
    assert.ok(Array.isArray(h.lines) && h.lines[0] <= h.lines[1]);
    assert.ok(h.snippet.length <= 2000, 'Snippets must respect the character cap');
  }

  assert.deepStrictEqual(tools.code_search({ root: REPO, query: 'no-such-identifier-anywhere' }).total, 0);
  assert.strictEqual(tools.code_search({ root: REPO }).error, 'query is required');

  // Prefix and multi-term queries must both work.
  assert.ok(tools.code_search({ root: REPO, query: 'multip' }).total >= 1, 'Prefix search must match');
  assert.ok(tools.code_search({ root: REPO, query: 'return a + b' }).total >= 1, 'Multi-term search must match');

  // --- symbol ------------------------------------------------------------
  const symbol = tools.code_symbol({ root: REPO, name: 'multiply' });
  assert.strictEqual(symbol.ambiguous, false);
  assert.strictEqual(symbol.symbols.length, 1);
  assert.strictEqual(symbol.symbols[0].kind, 'function');
  assert.strictEqual(symbol.symbols[0].path, 'lib/math.js');
  assert.strictEqual(symbol.symbols[0].lines[0], 8);

  const missing = tools.code_symbol({ root: REPO, name: 'notHere' });
  assert.strictEqual(missing.symbols.length, 0);
  assert.strictEqual(tools.code_symbol({ root: REPO }).error, 'name is required');

  // --- context -----------------------------------------------------------
  const ctx = tools.code_context({ root: REPO, file: 'lib/math.js' });
  assert.ok(!ctx.error, `code_context failed: ${ctx.error}`);
  assert.strictEqual(ctx.language, 'javascript');
  assert.ok(ctx.content.includes('function multiply'), 'Context must come from the indexed body');
  assert.ok(ctx.content.length > 0);

  const window = tools.code_context({ root: REPO, file: 'lib/math.js', start_line: 8, end_line: 10 });
  assert.deepStrictEqual(window.lines, [8, 10]);
  assert.ok(window.content.includes('multiply'));
  assert.ok(!window.content.includes('function log('), 'A line window must not bleed into other files');

  assert.ok(tools.code_context({ root: REPO, file: 'nope.js' }).error);
  assert.strictEqual(tools.code_context({ root: REPO }).error, 'file is required');

  // --- impact ------------------------------------------------------------
  const depth1 = tools.code_impact({ root: REPO, name: 'add' });
  assert.ok(!depth1.error, `code_impact failed: ${depth1.error}`);
  const direct = depth1.dependents.filter((d) => d.depth === 1);
  assert.ok(direct.some((d) => d.path === 'lib/math.js' && d.enclosing === 'function multiply'),
    'multiply calls add, so it must appear as a direct dependent');

  const depth2 = tools.code_impact({ root: REPO, name: 'add', max_depth: 2 });
  assert.ok(depth2.dependents.some((d) => d.depth === 2),
    'Transitive dependents must appear once depth allows it');

  const capped = tools.code_impact({ root: REPO, name: 'add', max_depth: 1 });
  assert.ok(capped.dependents.every((d) => d.depth <= 1), 'max_depth must bound traversal');

  const unknownImpact = tools.code_impact({ root: REPO, name: 'ghostSymbol' });
  assert.deepStrictEqual(unknownImpact.dependents, []);
  assert.strictEqual(tools.code_impact({ root: REPO }).error, 'name is required');

  // --- status ------------------------------------------------------------
  const status = tools.code_status({ root: REPO });
  const entry = status.roots.find((r) => r.root === fs.realpathSync(REPO));
  assert.ok(entry, 'Status must report the indexed root');
  assert.strictEqual(entry.status, 'fresh');
  assert.strictEqual(entry.files, 3);
  assert.strictEqual(entry.error, null);

  // --- dispatch layer ----------------------------------------------------
  // Every tool must be reachable through the real router with manifest-valid args.
  const dispatchCases = [
    ['code_index', { root: REPO }],
    ['code_status', { root: REPO }],
    ['code_search', { root: REPO, query: 'multiply' }],
    ['code_symbol', { root: REPO, name: 'add' }],
    ['code_context', { root: REPO, file: 'app.js' }],
    ['code_impact', { root: REPO, name: 'multiply' }],
    ['code_related', { root: REPO, file: 'app.js' }]
  ];
  for (const [name, args] of dispatchCases) {
    const raw = dispatchTool(name, args);
    const parsed = JSON.parse(raw.text !== undefined ? raw.text : raw);
    assert.ok(!parsed.error, `${name} must dispatch cleanly, got: ${JSON.stringify(parsed).slice(0, 200)}`);
    assert.ok(!raw.isError, `${name} must not report an error result`);
  }

  // --- related & containment -------------------------------------------
  const relSync = tools.code_related({ root: REPO, file: 'app.js' });
  assert.ok(!relSync.error, `code_related failed: ${relSync.error}`);
  assert.ok(relSync.related.some((r) => r.path === 'lib/math.js'), 'app.js must relate to lib/math.js');

  assert.throws(() => tools.code_index({ root: '/etc' }), /outside workspace/i);
  assert.strictEqual(dispatchTool('code_index', { root: '/etc' }).isError, true);
  assert.strictEqual((await dispatchToolAsync('code_search', { root: '/etc', query: 'passwd' })).isError, true);
  assert.throws(() => tools.code_context({ root: REPO, file: '../../etc/passwd' }), /outside repository root/i);
  assert.throws(() => tools.code_related({ root: REPO, file: '../../etc/passwd' }), /outside repository root/i);

  const symlinkDir = path.join(tmpRoot, 'symlink_repo');
  fs.mkdirSync(symlinkDir, { recursive: true });
  const linkPath = path.join(symlinkDir, 'escape.js');
  const danglingLink = path.join(symlinkDir, 'escape_dangling.js');
  try {
    fs.symlinkSync('/etc/passwd', linkPath);
    fs.symlinkSync(path.join(tmpRoot, 'nonexistent_outside.js'), danglingLink);
    assert.throws(() => tools.code_context({ root: symlinkDir, file: 'escape.js' }), /outside repository root/i);
    assert.throws(() => tools.code_related({ root: symlinkDir, file: 'escape.js' }), /outside repository root/i);
    assert.throws(() => tools.code_context({ root: symlinkDir, file: 'escape_dangling.js' }), /outside repository root/i);
    assert.throws(() => tools.code_related({ root: symlinkDir, file: 'escape_dangling.js' }), /outside repository root/i);
  } catch (err) {
    if (err && err.code !== 'EPERM' && err.code !== 'UNKNOWN') throw err;
  }

  // --- @genin read-only & D-04 bounds -----------------------------------
  const geninBlockedRouter = dispatchTool('code_remove', { root: REPO, agent: 'genin' });
  assert.strictEqual(geninBlockedRouter.isError, true);
  assert.ok(/Permission denied: @genin/i.test(geninBlockedRouter.text));

  const toolDispatch = require('../src/mcp/tool_dispatch');
  const geninBlockedSync = JSON.parse(toolDispatch.executeToolSync('code_remove', { root: REPO, agent: '@genin' }));
  assert.ok(/Permission denied: @genin/i.test(geninBlockedSync.error));
  const geninBlockedAsync = JSON.parse(await toolDispatch.executeTool('code_remove', { root: REPO, agent: 'genin' }));
  assert.ok(/Permission denied: @genin/i.test(geninBlockedAsync.error));

  const bounded = prepareToolCall('code_index', { root: REPO, agent: 'genin', max_files: 99999, timeout_ms: 999999 });
  assert.strictEqual(bounded.error, null);
  assert.strictEqual(bounded.args.max_files, 5000);
  assert.strictEqual(bounded.args.timeout_ms, 30000);

  const boundedDefault = prepareToolCall('code_index', { root: REPO, agent: 'genin' });
  assert.strictEqual(boundedDefault.args.max_files, 5000);
  assert.strictEqual(boundedDefault.args.timeout_ms, 30000);

  const geninGuard = require('../src/mcp/genin_guard');
  assert.strictEqual(geninGuard.resolveAgentIdentity({ agent: 'anbu' }, () => 'genin'), 'genin');
  assert.strictEqual(geninGuard.checkGeninToolAccess('code_remove', { agent: 'anbu' }, () => 'genin').allowed, false);
  assert.strictEqual(geninGuard.checkGeninToolAccess('save_project_context', {}, () => 'genin').allowed, false);
  assert.strictEqual(tools.code_search({ root: REPO, query: 'multiply', limit: -1 }).hits.length, 1);
  assert.strictEqual(tools.code_related({ root: REPO, file: 'app.js', limit: -1 }).related.length, 1);
  assert.throws(() => tools.code_context({ file: '/etc/passwd' }), /Path outside workspace/i);

  // --- removal -----------------------------------------------------------
  // Dispatched last: removal is the one case with an order dependency.
  const rawRemove = dispatchTool('code_remove', { root: REPO });
  assert.strictEqual(JSON.parse(rawRemove.text).removed, true);
  assert.strictEqual(rawRemove.isError, false);
  const removed = tools.code_remove({ root: REPO });
  assert.strictEqual(removed.removed, false, 'Removing twice is a no-op, not an error');
  assert.deepStrictEqual(tools.code_status({ root: REPO }).roots, [], 'Removal must clear the root and its children');
  assert.deepStrictEqual(snapshot(), afterPrune, 'Removal must not touch the analyzed repository');

  console.log('✓ Code-intelligence tools: index, incremental, search, symbol, context, impact, related, containment, genin, status, remove.');
}

run()
  .finally(() => {
    store.closeConnection();
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (_) { /* best-effort cleanup */ }
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
