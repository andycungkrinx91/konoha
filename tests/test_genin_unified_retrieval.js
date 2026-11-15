'use strict';

/**
 * Integration Test Suite (12 tests): Phase 4 — Unified @genin Retrieval &
 * Persistent SQLite Codebase Memory across Incremental Edits, LSP & Restarts.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-genin-unified-'));
const dbFile = path.join(tmpRoot, 'genin.db');
process.env.HOME = tmpRoot;
process.env.USERPROFILE = tmpRoot;
process.env.KONOHA_HOME = path.join(tmpRoot, '.konoha');
process.env.KONOHA_DB_PATH = dbFile;
process.env.KONOHA_SEMANTIC_SEARCH = '0';

const db = require('../src/db');
const store = require('../src/code_intel/store');
const geninRetrieval = require('../src/code_intel/genin_retrieval');
const { defaultManager: lspManager } = require('../src/code_intel/lsp_manager');
const { buildDelegationEnvelope } = require('../src/mcp/sannin_router');
const { runMcpAgent } = require('../src/mcp/memory_subagent_runner');
const { setWorkspaceRoot } = require('../src/mcp/runtime_state');

setWorkspaceRoot(tmpRoot);

function setupSampleRepo(name = 'sample_app') {
  const repo = path.join(tmpRoot, name);
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'auth.js'), [
    'function verifySessionToken(rawToken) {',
    '  return Boolean(rawToken && rawToken.length > 4);',
    '}',
    'module.exports = { verifySessionToken };',
    ''
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(repo, 'src', 'router.js'), [
    "const { verifySessionToken } = require('./auth');",
    'function handleLogin(req) {',
    '  return verifySessionToken(req.token);',
    '}',
    'module.exports = { handleLogin };',
    ''
  ].join('\n'), 'utf8');
  return repo;
}

function writeMockLspForGenin(scriptPath) {
  const src = `'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
let buf = Buffer.alloc(0);
function send(m) {
  const j = JSON.stringify(m);
  process.stdout.write('Content-Length: ' + Buffer.byteLength(j, 'utf8') + '\\r\\n\\r\\n' + j);
}
process.stdin.on('data', (c) => {
  buf = Buffer.concat([buf, c]);
  while (true) {
    const i = buf.indexOf(Buffer.from('\\r\\n\\r\\n', 'ascii'));
    if (i < 0) break;
    const len = Number((buf.subarray(0, i).toString('ascii').match(/content-length:\\s*(\\d+)/i) || [])[1] || 0);
    if (buf.length < i + 4 + len) break;
    const msg = JSON.parse(buf.subarray(i + 4, i + 4 + len).toString('utf8'));
    buf = buf.subarray(i + 4 + len);
    if (msg.method === 'initialize') send({ jsonrpc: '2.0', id: msg.id, result: { capabilities: { hoverProvider: true, referencesProvider: true, definitionProvider: true } } });
    else if (msg.method === 'textDocument/hover') send({ jsonrpc: '2.0', id: msg.id, result: { contents: 'lsp:verifySessionToken(rawToken)' } });
    else if (msg.method === 'textDocument/references') send({ jsonrpc: '2.0', id: msg.id, result: [{ uri: pathToFileURL(path.join(process.cwd(), 'src', 'router.js')).href, range: { start: { line: 2, character: 9 }, end: { line: 2, character: 27 } } }] });
    else if (msg.method === 'textDocument/definition') send({ jsonrpc: '2.0', id: msg.id, result: [{ uri: pathToFileURL(path.join(process.cwd(), 'src', 'auth.js')).href, range: { start: { line: 0, character: 9 }, end: { line: 0, character: 27 } } }] });
    else if (msg.method === 'shutdown') send({ jsonrpc: '2.0', id: msg.id, result: null });
    else if (msg.method === 'exit') process.exit(0);
  }
});
`;
  fs.writeFileSync(scriptPath, src, 'utf8');
}

async function runTests() {
  const conn = db.getConnection();
  db.setupSchema(conn);
  const repo = setupSampleRepo();

  // Fresh repo auto-indexes on first unified retrieval call without prior manual code_index
  const r1 = geninRetrieval.retrieveUnifiedContextSync({
    projectPath: repo,
    query: 'Trace verifySessionToken authentication flow',
    conn
  });
  assert.strictEqual(r1.available, true, '1. Must auto-index unindexed repo cleanly');
  assert.strictEqual(r1.status, 'fresh');
  assert.strictEqual(r1.topology.files, 2);

  // FTS5 search hits grounded in returned context
  assert.ok(r1.hits.some((h) => h.relPath === 'src/auth.js'), '2. Must retrieve auth.js via FTS');
  assert.ok(r1.text.includes('src/auth.js'), '2. Formatted context must cite matched file');

  // Symbol + impact graph callers resolved automatically
  assert.ok(r1.symbols.some((s) => s.name === 'verifySessionToken'), '3. Must resolve verifySessionToken symbol');
  assert.ok(r1.impact && r1.impact.nodes.some((n) => n.relPath === 'src/router.js'), '3. Must include downstream impact caller');

  // Incremental edit triggers automatic re-index without manual call
  fs.writeFileSync(path.join(repo, 'src', 'audit.js'), 'function logSecurityAuditEvent(id) { return id; }\nmodule.exports = { logSecurityAuditEvent };\n', 'utf8');
  const r2 = geninRetrieval.retrieveUnifiedContextSync({
    projectPath: repo,
    query: 'Inspect logSecurityAuditEvent handler',
    conn
  });
  assert.strictEqual(r2.topology.files, 3, '4. Incremental file addition must auto-sync index');
  assert.ok(r2.symbols.some((s) => s.name === 'logSecurityAuditEvent'), '4. New symbol must immediately appear');

  // Structural codebase memory persisted & deduplicated in SQLite
  const memRows1 = conn.prepare('SELECT id, title, content, memory_type FROM persona_memories WHERE agent_name = ?').all('genin');
  assert.strictEqual(memRows1.length, 1, '5. Structural codebase memory must update/dedupe without spam rows');
  assert.strictEqual(memRows1[0].memory_type, 'architecture');
  assert.ok(memRows1[0].content.includes('3 files'));

  // Repeated unchanged call reuses existing memory cleanly (still 1 row)
  geninRetrieval.retrieveUnifiedContextSync({ projectPath: repo, query: 'verifySessionToken', conn });
  const memRows2 = conn.prepare('SELECT id FROM persona_memories WHERE agent_name = ?').all('genin');
  assert.strictEqual(memRows2.length, 1, '6. Repeated identical state must not duplicate architecture memory');

  // Strict character budget enforcement
  const tight = geninRetrieval.retrieveUnifiedContextSync({
    projectPath: repo,
    query: 'verifySessionToken',
    maxChars: 240,
    conn
  });
  assert.ok(tight.text.length <= 240, `7. Output exceeded 240 char cap: ${tight.text.length}`);

  // Excluded extensions (.java/.cs/.lua) never leak into codebase topology or hits
  fs.writeFileSync(path.join(repo, 'src', 'Legacy.java'), 'class LegacyJavaIgnored {}\n', 'utf8');
  const rJava = geninRetrieval.retrieveUnifiedContextSync({ projectPath: repo, query: 'LegacyJavaIgnored', conn });
  assert.strictEqual(rJava.topology.files, 3, '8. Excluded .java must not inflate topology file count');
  assert.strictEqual(rJava.symbols.length, 0, '8. Excluded .java symbols must not leak');

  // Async retrieval with complementary LSP enrichment + graceful fallback
  const mockLsp = path.join(tmpRoot, 'mock_genin_lsp.js');
  writeMockLspForGenin(mockLsp);
  const rAsync = await geninRetrieval.retrieveUnifiedContextAsync({
    projectPath: repo,
    query: 'verifySessionToken',
    conn,
    embed: false,
    lspCommandOverride: `${process.execPath} ${mockLsp}`
  });
  assert.ok(rAsync.lsp && rAsync.lsp.lsp_available === true, '9. Async retrieval must attach LSP enrichment');
  assert.ok(rAsync.text.includes('LSP ('), '9. Formatted context must include LSP precision summary');
  await lspManager.shutdownAll();

  // MCP runner _formatProjectContext embeds unified retrieval within prompt ceiling
  const rawGenin = runMcpAgent('genin', { task: 'Trace `verifySessionToken` flow', project_path: repo, client: 'claude' });
  const geninPayload = JSON.parse(rawGenin);
  assert.ok(geninPayload.instructions.includes('Unified Codebase Retrieval'), '10. @genin instructions must auto-inject unified retrieval');
  assert.ok(Buffer.byteLength(geninPayload.instructions, 'utf8') <= 8000, '10. @genin prompt must stay within 8KB ceiling');

  // Sannin buildDelegationEnvelope attaches code_intel retrieval for @genin
  const envOut = buildDelegationEnvelope({ agentName: 'genin', projectPath: repo, prompt: 'Trace verifySessionToken', routedSkills: ['genin-skill'] });
  assert.ok(envOut.code_intel && envOut.code_intel.available === true, '11. Delegation envelope must carry code_intel block for genin');
  assert.ok(envOut.text.includes('Unified Codebase Retrieval'), '11. Envelope text must embed retrieval summary');

  // Real persistence across a brand-new Node subprocess restart reading the same SQLite DB
  store.closeConnection();
  try { conn.close(); } catch (_) { /* ignore */ }

  const modPath = path.resolve(__dirname, '..', 'src', 'code_intel', 'genin_retrieval');
  const childProbe = [
    `const { retrieveUnifiedContextSync } = require(${JSON.stringify(modPath)});`,
    `const out = retrieveUnifiedContextSync({ projectPath: ${JSON.stringify(repo)}, query: 'architecture verifySessionToken', sync: false });`,
    'if (!out.available || out.topology.files !== 3 || !out.memories.some(m => m.content.includes("3 files"))) {',
    '  console.error("Restart persistence check failed:", JSON.stringify(out)); process.exit(1);',
    '}',
    'console.log("RESTART_OK:" + out.memories.length);'
  ].join('\n');
  const scriptFile = path.join(tmpRoot, 'restart_probe.js');
  fs.writeFileSync(scriptFile, childProbe, 'utf8');
  const sub = spawnSync(process.execPath, [scriptFile], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, KONOHA_DB_PATH: dbFile, KONOHA_SEMANTIC_SEARCH: '0' },
    encoding: 'utf8'
  });
  assert.strictEqual(sub.status, 0, `12. Fresh subprocess failed: ${sub.stderr}\n${sub.stdout}`);
  assert.ok(sub.stdout.includes('RESTART_OK:'), '12. Subprocess must recover codebase memory from SQLite across restarts');

  console.log('✓ All 12 Phase 4 Genin unified retrieval & persistent codebase memory integration tests passed!');
}

runTests().catch((err) => {
  console.error('test_genin_unified_retrieval failed:', err);
  process.exitCode = 1;
}).finally(async () => {
  await lspManager.shutdownAll();
  store.closeConnection();
  fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
