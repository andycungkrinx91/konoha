/**
 * Test Suite: code-intelligence search.
 *
 * Covers the ranking contract (a symbol definition outranks a passing mention),
 * root scoping (two indexed projects never see each other's hits), snippet
 * bounds, the FTS5-absent degradation path, and multi-language indexing.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-code-intel-search-'));
process.env.HOME = tmpRoot;
process.env.USERPROFILE = tmpRoot;
process.env.KONOHA_HOME = path.join(tmpRoot, '.konoha');
process.env.KONOHA_DB_PATH = path.join(tmpRoot, 'search.db');

const db = require('../src/db');
const tools = require('../src/code_intel/tools');
const { search } = require('../src/code_intel/query');
const { SEARCH_MAX_HITS, SEARCH_SNIPPET_MAX_CHARS } = require('../src/code_intel/config');

db.setupSchema(db.getConnection());

const ALPHA = path.join(tmpRoot, 'alpha');
const BETA = path.join(tmpRoot, 'beta');

const ALPHA_FILES = {
  'src/tokenizer.js': [
    '/** Splits text into tokens. */',
    'function tokenize(text) {',
    '  return String(text).split(/\\s+/);',
    '}',
    '',
    'module.exports = { tokenize };',
    ''
  ].join('\n'),
  // A long file whose body mentions the word many times without defining it.
  'src/unrelated.js': [
    '// This module talks about tokenize a lot without calling it.',
    ...Array.from({ length: 40 }, (_, i) => `// tokenize mention ${i}: the tokenize helper is not used here.`),
    'function noop() {',
    '  return 0;',
    '}',
    ''
  ].join('\n'),
  'src/deep/paths/nested.js': [
    'function deepCaller() {',
    '  return tokenize("a b");',
    '}',
    ''
  ].join('\n'),
  'python/parser.py': [
    'def parse(source):',
    '    """Parse the source into tokens."""',
    '    return source.split()',
    ''
  ].join('\n'),
  'go/main.go': [
    'package main',
    '',
    'func Tokenize(s string) []string {',
    '\treturn []string{s}',
    '}',
    ''
  ].join('\n')
};

const BETA_FILES = {
  'lib/beta_only.js': [
    'function betaExclusive() {',
    '  return 1;',
    '}',
    ''
  ].join('\n')
};

function write(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, 'utf8');
  }
}

function run() {
  console.log('Running test_code_intel_search tests...');
  write(ALPHA, ALPHA_FILES);
  write(BETA, BETA_FILES);

  const alphaIndex = tools.code_index({ root: ALPHA });
  assert.strictEqual(alphaIndex.status, 'fresh', `alpha index failed: ${JSON.stringify(alphaIndex).slice(0, 200)}`);
  const betaIndex = tools.code_index({ root: BETA });
  assert.strictEqual(betaIndex.status, 'fresh');

  // --- every supported language is indexed ------------------------------
  assert.strictEqual(alphaIndex.files, 5);
  const langs = new Set(alphaIndex.skipped.map((s) => s.reason));
  assert.strictEqual(langs.size, 0, `Nothing should be skipped: ${[...langs].join('; ')}`);

  // --- ranking ----------------------------------------------------------
  const hits = tools.code_search({ root: ALPHA, query: 'tokenize' });
  assert.strictEqual(hits.degraded, false);
  assert.ok(hits.total >= 3, `Expected the definition and the call sites; got ${hits.total}`);
  assert.ok(hits.total <= SEARCH_MAX_HITS, 'Result count is capped');
  assert.strictEqual(hits.hits[0].path, 'src/tokenizer.js',
    'The file that defines tokenize must outrank a file that only mentions it in comments');

  // Definition groups come first, then bm25 orders within a group, so scores
  // are ascending only inside a group. What must hold across the whole set is
  // that every score is a real bm25 number, not a placeholder.
  for (const hit of hits.hits) {
    assert.ok(Number.isFinite(hit.score), `score must be numeric, got ${hit.score}`);
  }
  const mentionOnly = hits.hits.filter((h) => h.path === 'src/unrelated.js');
  assert.ok(mentionOnly.length > 0, 'The comment-only file still appears, just later');

  // --- snippets ---------------------------------------------------------
  for (const hit of hits.hits) {
    assert.ok(hit.snippet.length <= SEARCH_SNIPPET_MAX_CHARS + 2, `Snippet over cap: ${hit.snippet.length}`);
    assert.ok(hit.lines[0] >= 1 && hit.lines[1] >= hit.lines[0], 'Line span is well formed');
    assert.ok(typeof hit.language === 'string' && hit.language.length > 0);
  }

  // --- cross-language ---------------------------------------------------
  const pythonHits = tools.code_search({ root: ALPHA, query: 'parse' });
  assert.ok(pythonHits.hits.some((h) => h.path === 'python/parser.py' && h.language === 'python'),
    'Python files are searchable');
  const goHits = tools.code_search({ root: ALPHA, query: 'Tokenize' });
  assert.ok(goHits.hits.some((h) => h.language === 'go'), 'Go files are searchable');
  assert.strictEqual(goHits.total, hits.total, 'Search is case-insensitive');

  // --- root scoping -----------------------------------------------------
  assert.deepStrictEqual(tools.code_search({ root: BETA, query: 'tokenize' }).hits, [],
    'A hit in another indexed root must not leak into this one');
  const betaHits = tools.code_search({ root: BETA, query: 'betaExclusive' });
  assert.strictEqual(betaHits.total, 1);
  assert.strictEqual(betaHits.hits[0].path, 'lib/beta_only.js');

  const unscoped = tools.code_search({ query: 'tokenize' });
  assert.ok(unscoped.total >= hits.total, 'An unscoped search spans every indexed root');

  // --- limits -----------------------------------------------------------
  const one = tools.code_search({ root: ALPHA, query: 'tokenize', limit: 1 });
  assert.strictEqual(one.hits.length, 1);
  assert.strictEqual(one.total, 1, 'total reflects the returned set');
  const overLimit = tools.code_search({ root: ALPHA, query: 'tokenize', limit: 5000 });
  assert.ok(overLimit.hits.length <= SEARCH_MAX_HITS, 'The configured ceiling cannot be raised by the caller');

  // --- empty and hostile input -----------------------------------------
  assert.strictEqual(tools.code_search({ root: ALPHA, query: 'zzzNoSuchIdentifier' }).total, 0);
  assert.strictEqual(tools.code_search({ root: ALPHA, query: '   ' }).total, 0);
  assert.strictEqual(tools.code_search({ root: ALPHA }).error, 'query is required');

  // --- unindexed root ---------------------------------------------------
  const unknown = tools.code_search({ root: path.join(tmpRoot, 'never-indexed'), query: 'tokenize' });
  assert.ok(unknown.error, 'An unindexed root is an error, not an empty result');

  // --- degraded fallback ------------------------------------------------
  // FTS5 is present on this platform, so the fallback is reached by making
  // ftsAvailable() lie for one call. The contract under test: same hit shape,
  // degraded: true, and a LIKE match that does not throw on hostile input.
  const store = require('../src/code_intel/store');
  const realFtsAvailable = store.ftsAvailable;
  store.ftsAvailable = () => false;
  try {
    const degraded = search({ query: 'tokenize', rootPath: ALPHA, conn: db.getConnection() });
    assert.strictEqual(degraded.degraded, true, 'The LIKE path must announce itself');
    assert.ok(degraded.total >= 1, 'The fallback still finds the definition');
    // search() returns query-layer rows, which use relPath; the tool handler
    // is what renames it to path.
    assert.ok(degraded.hits.some((h) => h.relPath === 'src/tokenizer.js'));
    for (const hit of degraded.hits) {
      assert.strictEqual(hit.score, 0, 'A LIKE hit has no bm25 score and must not pretend to');
      assert.ok(hit.snippet.length > 0);
    }
    assert.strictEqual(search({ query: 'zzzNoSuchIdentifier', rootPath: ALPHA, conn: db.getConnection() }).total, 0);
    // Hostile input cannot reach SQL as syntax here either: the LIKE pattern is
    // a bound parameter, so quotes and wildcards are literal.
    assert.doesNotThrow(() => search({ query: "'; DROP TABLE code_chunks; --", rootPath: ALPHA, conn: db.getConnection() }));
  } finally {
    store.ftsAvailable = realFtsAvailable;
  }
  assert.strictEqual(store.ftsAvailable(db.getConnection()), true, 'FTS availability is restored');
  assert.ok(tools.code_search({ root: ALPHA, query: 'tokenize' }).hits.length > 0, 'The table survived');

  // --- the index survives a process restart ----------------------------
  // Simulate a cold reader: a fresh connection must see the same hits.
  const coldHits = search({ query: 'tokenize', rootPath: ALPHA, conn: db.openRawConnection(process.env.KONOHA_DB_PATH) });
  assert.strictEqual(coldHits.total, hits.total, 'The index is durable, not process-local');

  console.log('✓ Code-intelligence search: ranking, scoping, snippets, limits, degradation verified.');
}

run();
