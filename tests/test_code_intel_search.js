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
require('../src/file_tools_router').setWorkspaceRoot(tmpRoot);
const tools = require('../src/code_intel/tools');
const store = require('../src/code_intel/store');
const { indexRepositoryAsync } = require('../src/code_intel/indexer');
const { search, searchAsync, getContext, related, relatedAsync } = require('../src/code_intel/query');
const { EMBED_MODEL_REPO } = require('../src/vector_pipeline');
const { SEARCH_MAX_HITS, SEARCH_SNIPPET_MAX_CHARS } = require('../src/code_intel/config');

const _setupConn = db.getConnection();
try {
  db.setupSchema(_setupConn);
} finally {
  _setupConn.close();
}

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

async function verifyHybridRelatedAndOverlap(conn) {
  const gamma = path.join(tmpRoot, 'gamma');
  const longLines = ['function longWindowTarget(items) {'];
  for (let i = 1; i <= 55; i++) {
    longLines.push(`  const step${i} = ${i}; // [unique-line-marker-${String(i).padStart(3, '0')}]`);
  }
  longLines.push('  return step55;', '}', '');

  const gammaFiles = {
    'src/jwt_guard.js': [
      "const { loadPublicKey } = require('./key_store');",
      '',
      '/** Validates asymmetric HMAC or RSA digital signatures on bearer credentials. */',
      'function verifyJwtSignature(token, secretKey) {',
      '  const key = loadPublicKey(secretKey);',
      '  return Boolean(token && key);',
      '}',
      '',
      'module.exports = { verifyJwtSignature };',
      ''
    ].join('\n'),
    'src/key_store.js': [
      'function loadPublicKey(keyId) {',
      '  return keyId ? `key:${keyId}` : null;',
      '}',
      'module.exports = { loadPublicKey };',
      ''
    ].join('\n'),
    'src/billing_invoice.js': [
      'function renderInvoiceTotal(lineItems) {',
      '  return lineItems.reduce((acc, item) => acc + item.cents, 0);',
      '}',
      'module.exports = { renderInvoiceTotal };',
      ''
    ].join('\n'),
    'tests/jwt_guard.test.js': [
      "const { verifyJwtSignature } = require('../src/jwt_guard');",
      'function runJwtCheck() {',
      '  return verifyJwtSignature("header.payload.sig", "kid-1");',
      '}',
      'module.exports = { runJwtCheck };',
      ''
    ].join('\n'),
    'src/long_window.js': longLines.join('\n')
  };

  write(gamma, gammaFiles);

  const firstIdx = await indexRepositoryAsync({ rootPath: gamma, conn });
  assert.strictEqual(firstIdx.embeddingModel, EMBED_MODEL_REPO);
  assert.ok(firstIdx.embeddedChunks >= 5, `Expected chunk embeddings to be generated, got ${firstIdx.embeddedChunks}`);

  const rootRow = store.getRoot(conn, gamma);
  const embeddedCount = conn.prepare(
    'SELECT COUNT(*) AS n FROM code_chunks WHERE root_hash = ? AND embedding IS NOT NULL AND embedding_model = ?'
  ).get(rootRow.root_hash, EMBED_MODEL_REPO).n;
  assert.ok(embeddedCount >= firstIdx.chunks, 'Every chunk should have a Granite 97M embedding persisted');

  const noopIdx = await indexRepositoryAsync({ rootPath: gamma, conn });
  assert.strictEqual(noopIdx.embeddedChunks, 0, 'Unchanged chunks must not be re-embedded');

  fs.appendFileSync(path.join(gamma, 'src/billing_invoice.js'), '// trailing note\n', 'utf8');
  const editIdx = await indexRepositoryAsync({ rootPath: gamma, conn });
  assert.ok(editIdx.embeddedChunks <= 1, `Expected at most modified chunk embedded, got ${editIdx.embeddedChunks}`);

  const fullCtx = getContext({ rootPath: gamma, relPath: 'src/long_window.js', conn });
  assert.strictEqual(fullCtx.truncated, false);
  for (let i = 1; i <= 55; i++) {
    const marker = `[unique-line-marker-${String(i).padStart(3, '0')}]`;
    const firstPos = fullCtx.text.indexOf(marker);
    assert.ok(firstPos !== -1, `Missing line marker ${marker}`);
    assert.strictEqual(fullCtx.text.indexOf(marker, firstPos + 1), -1, `Overlapping chunk duplicated ${marker}`);
  }

  const hybrid = await searchAsync({
    rootPath: gamma,
    query: 'digital signature validation for bearer credential',
    conn,
    limit: 5
  });
  assert.strictEqual(hybrid.semantic_applied, true, 'Granite 97M semantic vector search must run');
  assert.strictEqual(hybrid.reranked, true, 'MiniLM L-6 cross-encoder reranking must run');
  assert.strictEqual(hybrid.degraded, false);
  assert.ok(hybrid.hits.length > 0);
  assert.strictEqual(hybrid.hits[0].relPath, 'src/jwt_guard.js', `Expected jwt_guard.js rank #1, got ${hybrid.hits[0].relPath}`);
  assert.ok(hybrid.hits[0].rerankScore > 0, 'Expected positive rerank score');

  const relAsync = await relatedAsync({ rootPath: gamma, file: 'src/jwt_guard.js', conn, limit: 5 });
  assert.strictEqual(relAsync.anchor.relPath, 'src/jwt_guard.js');
  assert.strictEqual(relAsync.semantic_applied, true);
  assert.strictEqual(relAsync.reranked, true);
  const relPaths = relAsync.related.map((r) => r.relPath);
  assert.ok(relPaths.includes('src/key_store.js'), `Expected imported dependency in related: ${relPaths.join(', ')}`);
  assert.ok(relPaths.includes('tests/jwt_guard.test.js'), `Expected importer/test twin in related: ${relPaths.join(', ')}`);

  const relBySymbol = related({ rootPath: gamma, symbol: 'verifyJwtSignature', conn, limit: 5 });
  assert.strictEqual(relBySymbol.anchor.relPath, 'src/jwt_guard.js');
  assert.ok(relBySymbol.related.some((r) => r.relPath === 'src/key_store.js'));

  const prevEnv = process.env.KONOHA_SEMANTIC_SEARCH;
  process.env.KONOHA_SEMANTIC_SEARCH = '0';
  try {
    const lexOnly = await searchAsync({ rootPath: gamma, query: 'verifyJwtSignature', conn });
    assert.strictEqual(lexOnly.semantic_applied, false);
    assert.strictEqual(lexOnly.reranked, false);
    assert.ok(lexOnly.hits.some((h) => h.relPath === 'src/jwt_guard.js'));
  } finally {
    if (prevEnv === undefined) delete process.env.KONOHA_SEMANTIC_SEARCH;
    else process.env.KONOHA_SEMANTIC_SEARCH = prevEnv;
  }
}

async function run() {
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
  const fallbackConn = db.getConnection();
  try {
    const degraded = search({ query: 'tokenize', rootPath: ALPHA, conn: fallbackConn });
    assert.strictEqual(degraded.degraded, true, 'The LIKE path must announce itself');
    assert.ok(degraded.total >= 1, 'The fallback still finds the definition');
    // search() returns query-layer rows, which use relPath; the tool handler
    // is what renames it to path.
    assert.ok(degraded.hits.some((h) => h.relPath === 'src/tokenizer.js'));
    for (const hit of degraded.hits) {
      assert.strictEqual(hit.score, 0, 'A LIKE hit has no bm25 score and must not pretend to');
      assert.ok(hit.snippet.length > 0);
    }
    assert.strictEqual(search({ query: 'zzzNoSuchIdentifier', rootPath: ALPHA, conn: fallbackConn }).total, 0);
    // Hostile input cannot reach SQL as syntax here either: the LIKE pattern is
    // a bound parameter, so quotes and wildcards are literal.
    assert.doesNotThrow(() => search({ query: "'; DROP TABLE code_chunks; --", rootPath: ALPHA, conn: fallbackConn }));
  } finally {
    store.ftsAvailable = realFtsAvailable;
    try { fallbackConn.close(); } catch (_) { /* ignore */ }
  }
  const checkConn = db.getConnection();
  try {
    assert.strictEqual(store.ftsAvailable(checkConn), true, 'FTS availability is restored');
  } finally {
    try { checkConn.close(); } catch (_) { /* ignore */ }
  }
  assert.ok(tools.code_search({ root: ALPHA, query: 'tokenize' }).hits.length > 0, 'The table survived');

  // --- the index survives a process restart ----------------------------
  // Simulate a cold reader: a fresh connection must see the same hits.
  const coldConn = db.openRawConnection(process.env.KONOHA_DB_PATH);
  try {
    const coldHits = search({ query: 'tokenize', rootPath: ALPHA, conn: coldConn });
    assert.strictEqual(coldHits.total, hits.total, 'The index is durable, not process-local');
  } finally {
    try { coldConn.close(); } catch (_) { /* ignore */ }
  }

  const hybridConn = db.getConnection();
  try {
    await verifyHybridRelatedAndOverlap(hybridConn);
  } finally {
    try { hybridConn.close(); } catch (_) { /* ignore */ }
    store.closeConnection();
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }

  console.log('✓ Code-intelligence search, hybrid Granite/MiniLM retrieval, overlap-free context, and code_related verified.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
