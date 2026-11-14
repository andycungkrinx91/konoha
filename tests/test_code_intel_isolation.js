/**
 * Test Suite: code-intelligence isolation and query hardening.
 *
 * Two properties that no end-to-end tool test covers:
 *
 *   1. The index lives in the main store only. The Akatsuki lab database has no
 *      `code_*` tables and the main connector refuses lab paths, so lab content
 *      can never be indexed and the index can never be read as lab data.
 *   2. User query text never reaches SQLite as syntax. FTS5 MATCH is a query
 *      language; passing raw input through it is both a crash and a correctness
 *      bug, so `toFtsQuery` reduces any input to quoted prefix terms.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-code-intel-isolation-'));
process.env.HOME = tmpRoot;
process.env.USERPROFILE = tmpRoot;
process.env.KONOHA_HOME = path.join(tmpRoot, '.konoha');
process.env.KONOHA_DB_PATH = path.join(tmpRoot, 'isolation.db');
process.env.KONOHA_LAB_DB_ROOT = path.join(tmpRoot, 'lab-root');

const db = require('../src/db');
require('../src/file_tools_router').setWorkspaceRoot(tmpRoot);
const authz = require('../src/skill_authorization');
const labDb = require('../src/workflow/akatsuki/lab_db');
const store = require('../src/code_intel/store');
const { toFtsQuery, search } = require('../src/code_intel/query');

db.setupSchema(db.getConnection());

function tablesIn(conn) {
  return conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
}

function run() {
  console.log('Running test_code_intel_isolation tests...');

  // --- the index tables exist in the main store --------------------------
  const mainConn = db.getConnection();
  const mainTables = tablesIn(mainConn);
  for (const name of ['code_index_roots', 'code_files', 'code_symbols', 'code_refs', 'code_chunks']) {
    assert.ok(mainTables.includes(name), `${name} must exist in the main DB`);
  }

  // --- and nowhere else ---------------------------------------------------
  const labPath = labDb.getLabDbPath();
  const labConn = labDb.openLabDb();
  try {
    const labTables = tablesIn(labConn);
    const leaked = labTables.filter((n) => n.startsWith('code_'));
    assert.deepStrictEqual(leaked, [], `The lab DB must never carry code-intelligence tables, found: ${leaked.join(', ')}`);
    assert.ok(labTables.includes('lab_runs'), 'Sanity: the lab schema did build');
  } finally {
    if (typeof labConn.close === 'function') labConn.close();
  }

  // --- the main connector refuses a lab path -----------------------------
  assert.ok(authz.isLabDbPath(labPath), 'The lab DB path must be recognised as a lab path');
  assert.throws(
    () => db.getConnection(labPath),
    (err) => err.code === authz.LAB_DB_ISOLATION_VIOLATION,
    'Opening the lab DB through the main connector must throw LAB_DB_ISOLATION_VIOLATION'
  );
  assert.strictEqual(authz.isLabDbPath(process.env.KONOHA_DB_PATH), false, 'The main DB path is not a lab path');

  // --- indexing goes to the main DB, not to the lab DB -------------------
  const repo = path.join(tmpRoot, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, 'a.js'), 'function alpha() { return 1; }\n', 'utf8');
  const tools = require('../src/code_intel/tools');
  const indexed = tools.code_index({ root: repo });
  assert.strictEqual(indexed.status, 'fresh');

  const labRecheck = labDb.openLabDb();
  try {
    assert.deepStrictEqual(
      tablesIn(labRecheck).filter((n) => n.startsWith('code_')),
      [],
      'Indexing must not create code tables in the lab DB'
    );
  } finally {
    if (typeof labRecheck.close === 'function') labRecheck.close();
  }

  // --- no module opens a database or spawns a process on its own ---------
  const codeIntelDir = path.join(__dirname, '..', 'src', 'code_intel');
  for (const file of fs.readdirSync(codeIntelDir).filter((f) => f.endsWith('.js'))) {
    const body = fs.readFileSync(path.join(codeIntelDir, file), 'utf8');
    assert.ok(!/new\s+DatabaseSync\s*\(/.test(body), `${file} must not open its own SQLite handle; go through src/db.js`);
    assert.ok(!/child_process/.test(body), `${file} must not spawn a process; nothing in the analyzed repo may run`);
    assert.ok(!/generateDeterministicVector/.test(body), `${file} must not reach for hash-derived vectors`);
  }

  // --- credentials never enter the index --------------------------------
  fs.writeFileSync(path.join(repo, '.env'), 'SECRET_TOKEN=abc123\n', 'utf8');
  fs.writeFileSync(path.join(repo, '.env.local'), 'OTHER=def\n', 'utf8');
  fs.writeFileSync(path.join(repo, 'id_rsa'), 'PRIVATE\n', 'utf8');
  fs.writeFileSync(path.join(repo, 'server.pem'), 'CERT\n', 'utf8');
  const { isExcludedFile } = require('../src/code_intel/config');
  for (const name of ['.env', '.env.local', '.npmrc', '.netrc', 'id_rsa', 'id_ed25519', 'server.pem', 'a.key', 'store.p12']) {
    assert.strictEqual(isExcludedFile(name), true, `${name} must never be indexed`);
  }
  assert.strictEqual(isExcludedFile('index.js'), false, 'Ordinary source must not be excluded');
  const { walk } = require('../src/code_intel/walker');
  const walked = walk(repo);
  assert.deepStrictEqual(
    walked.files.map((f) => f.relPath),
    ['a.js'],
    'The walk must yield only real source, never a credential file'
  );

  // --- query hardening ---------------------------------------------------
  assert.strictEqual(toFtsQuery(''), null);
  assert.strictEqual(toFtsQuery('   '), null);
  assert.strictEqual(toFtsQuery('!!! ???'), null, 'Pure punctuation must yield no query, not a MATCH syntax error');
  assert.strictEqual(toFtsQuery('a'), null, 'Single characters are dropped: they match everything and rank nothing');

  assert.strictEqual(toFtsQuery('findUser'), '"finduser"*');
  assert.strictEqual(toFtsQuery('find user'), '"find"* AND "user"*', 'Terms are ANDed, never ORed');

  // Hostile input must come out inert: no operators, no unbalanced quotes,
  // no bare `*`, no column filters, no parentheses.
  const hostile = [
    'foo" OR "bar',
    'a* NEAR(b c)',
    'body:secret',
    'name : value',
    ')((',
    'x^2 AND y',
    '-alpha -beta',
    "'; DROP TABLE code_chunks; --"
  ];
  for (const input of hostile) {
    const out = toFtsQuery(input);
    if (out === null) continue;
    assert.ok(!/[()^:]|NEAR|OR|AND AND/.test(out.replace(/"\w+"\*/g, '')), `Unsafe FTS query from ${JSON.stringify(input)}: ${out}`);
    assert.strictEqual((out.match(/"/g) || []).length % 2, 0, `Unbalanced quotes from ${JSON.stringify(input)}: ${out}`);
  }

  // The search path must survive every one of those without throwing.
  for (const input of hostile) {
    const result = search({ query: input, conn: mainConn, rootPath: repo });
    assert.ok(Array.isArray(result.hits), `search must return hits for ${JSON.stringify(input)}`);
  }
  assert.ok(tablesIn(mainConn).includes('code_chunks'), 'Injection attempts must not drop tables');

  // --- embeddings are never faked ---------------------------------------
  const rootHash = store.computeRootHash(repo);
  assert.throws(
    () => store.attachEmbeddings(mainConn, rootHash, 1, '', [[0.1, 0.2]]),
    /hash-derived vectors are not semantic embeddings/,
    'Embeddings must be refused without a real model label'
  );
  assert.throws(() => store.attachEmbeddings(mainConn, rootHash, 1, null, [[0.1]]), /embedding_model is required/);
  const embedded = mainConn.prepare('SELECT COUNT(*) AS n FROM code_chunks WHERE embedding IS NOT NULL').get();
  assert.strictEqual(embedded.n, 0, 'Nothing may be written to the embedding column');

  // --- limits ------------------------------------------------------------
  const capped = toFtsQuery(Array.from({ length: 30 }, (_, i) => `term${i}`).join(' '));
  assert.strictEqual(capped.split(' AND ').length, 12, 'Term count is capped');

  console.log('✓ Code-intelligence isolation and query hardening verified.');
}

run();
