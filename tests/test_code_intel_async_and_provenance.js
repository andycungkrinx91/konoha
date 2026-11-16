/**
 * Integration & provenance verification for Issue #13 async code intelligence.
 *
 * Proves:
 *   1. Real MCP `dispatchToolAsync('genin', ...)`, `dispatchToolAsync('sannin', ...)`,
 *      `buildDelegationEnvelopeAsync()`, and `runMcpAgentAsync()` execute async Tree-sitter
 *      WASM indexing & retrieval (`metrics_json.engine === 'tree-sitter-wasm'`) instead of sync
 *      lexer fallback, while preserving Genin read-only & Akatsuki lab isolation guards.
 *   2. Provenance & confidence metadata distinguish AST/parser-derived (`provenance: 'parser'`),
 *      lexical/heuristic (`provenance: 'heuristic'`), LSP (`provenance: 'lsp'`), and unresolved
 *      references (`provenance: 'unresolved'`, `resolved: false`), expose `content_hash`, and
 *      track root snapshot freshness (`snapshot_consistent`, `stale_head`).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-ci-async-prov-'));
process.env.HOME = tmpRoot;
process.env.USERPROFILE = tmpRoot;
process.env.KONOHA_HOME = path.join(tmpRoot, '.konoha');
process.env.KONOHA_DB_PATH = path.join(tmpRoot, 'konoha.db');
process.env.KONOHA_SEMANTIC_SEARCH = '0';

const db = require('../src/db');
const router = require('../src/file_tools_router');
const store = require('../src/code_intel/store');
const queryEngine = require('../src/code_intel/query');
const tools = require('../src/code_intel/tools');
const { retrieveUnifiedContextAsync } = require('../src/code_intel/genin_retrieval');
const { runMcpAgentAsync } = require('../src/mcp/memory_subagent_runner');
const { buildDelegationEnvelopeAsync } = require('../src/mcp/sannin_router');
const { defaultManager: lspManager } = require('../src/code_intel/lsp_manager');
const { getLabDbPath } = require('../src/workflow/akatsuki/lab_db');

function writeRepo(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, 'utf8');
  }
}

function initGitRepo(root) {
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial commit'], { cwd: root, stdio: 'ignore' });
}

async function runTests() {
  const conn = db.getConnection();
  db.setupSchema(conn);

  const repo = path.join(tmpRoot, 'repo_async');
  writeRepo(repo, {
    'src/auth_token.js': [
      'function verifyAuthToken(rawToken) {',
      '  return Boolean(rawToken && rawToken.startsWith("kn_"));',
      '}',
      'module.exports = { verifyAuthToken };',
      ''
    ].join('\n'),
    'src/session_service.js': [
      "const { verifyAuthToken } = require('./auth_token');",
      'function validateSession(tok) {',
      '  if (!verifyAuthToken(tok)) return missingExternalGuard(tok);',
      '  return true;',
      '}',
      'module.exports = { validateSession };',
      ''
    ].join('\n'),
    'src/legacy_worker.rb': [
      'class LegacyWorker',
      '  def run_legacy_audit(item)',
      '    item.to_s',
      '  end',
      'end',
      ''
    ].join('\n')
  });
  initGitRepo(repo);

  router.setWorkspaceRoot(repo);

  // Real MCP dispatchToolAsync('genin', ...) triggers async WASM indexing + unified retrieval
  const geninDispatch = await router.dispatchToolAsync('genin', {
    task: 'Inspect verifyAuthToken token verification and session validation flow',
    project_path: repo
  });
  assert.strictEqual(Boolean(geninDispatch.isError), false, `genin async dispatch failed: ${geninDispatch.text}`);
  const geninOut = JSON.parse(geninDispatch.text);
  assert.strictEqual(geninOut.agent, 'genin');
  assert.ok(
    geninOut.instructions && (geninOut.instructions.includes('Unified Codebase Retrieval') || geninOut.instructions.includes('src/auth_token.js')),
    `MCP dispatchToolAsync(genin) must inject code-intel retrieval context, got: ${String(geninOut.instructions || '').slice(0, 500)}`
  );

  const fileRec = store.getFileRecord(conn, store.computeRootHash(repo), 'src/auth_token.js');
  assert.ok(fileRec, 'dispatchToolAsync(genin) must persist indexed file record');
  const metrics = JSON.parse(fileRec.metrics_json || '{}');
  assert.strictEqual(metrics.engine, 'tree-sitter-wasm', 'Async Genin MCP path must index JS via Tree-sitter WASM AST, not sync lexer');

  // Fallback candidate-term retrieval inside retrieveUnifiedContextAsync on natural language query
  const fallbackAsync = await retrieveUnifiedContextAsync({
    projectPath: repo,
    query: 'Please investigate how verifyAuthToken validates tokens across modules',
    sync: false,
    maxChars: 1200,
    maxHits: 4
  });
  assert.strictEqual(fallbackAsync.mode, 'async');
  assert.ok(fallbackAsync.hits.length >= 1, 'retrieveUnifiedContextAsync must resolve multi-word NL query via candidate-term fallback');

  // Direct runMcpAgentAsync & buildDelegationEnvelopeAsync & dispatchToolAsync('sannin', ...)
  const directAsyncAgent = JSON.parse(await runMcpAgentAsync('genin', {
    task: 'Check validateSession caller flow',
    projectPath: repo,
    client: 'claude'
  }));
  assert.ok(directAsyncAgent.instructions.includes('Unified Codebase Retrieval'));

  const envAsync = await buildDelegationEnvelopeAsync({
    agentName: 'genin',
    projectPath: repo,
    prompt: 'Trace verifyAuthToken',
    routedSkills: ['genin-skill']
  });
  assert.ok(envAsync.code_intel && envAsync.code_intel.mode === 'async', 'buildDelegationEnvelopeAsync must return async code_intel block');

  const sanninAsync = await router.dispatchToolAsync('sannin', {
    prompt: 'Explore verifyAuthToken dependencies cleanly',
    project_path: repo
  });
  assert.strictEqual(Boolean(sanninAsync.isError), false, `sannin async dispatch failed: ${sanninAsync.text}`);

  // Preserve Genin read-only guard and Akatsuki Lab isolation
  const blockedGenin = await router.dispatchToolAsync('genin', {
    task: 'Inspect files',
    project_path: repo
  });
  // Genin cannot invoke code_remove or write tools
  const blockedRemove = await router.dispatchToolAsync('code_remove', { root: repo, agent: 'genin' });
  assert.strictEqual(blockedRemove.isError, true, 'Genin must still be blocked from code_remove');
  assert.throws(() => db.getConnection(getLabDbPath()), /Use lab_db\.openLabDb|LAB_DB_ISOLATION_VIOLATION/);
  assert.ok(blockedGenin && !blockedGenin.isError);

  // Provenance metadata: parser (AST) vs heuristic (lexer) + content_hash + snapshot consistency
  const astSearch = await tools.code_search_async({ root: repo, query: 'verifyAuthToken', semantic: false, rerank: false });
  assert.ok(astSearch.hits.length >= 1);
  assert.strictEqual(astSearch.hits[0].provenance, 'parser');
  assert.strictEqual(astSearch.hits[0].parse_engine, 'tree-sitter-wasm');
  assert.strictEqual(astSearch.hits[0].confidence, 1);
  assert.ok(astSearch.hits[0].content_hash && astSearch.hits[0].content_hash.length === 64);
  assert.ok(astSearch.snapshot && astSearch.snapshot.snapshot_consistent === true && astSearch.snapshot.stale_head === false);

  const lexSearch = tools.code_search({ root: repo, query: 'run_legacy_audit' });
  assert.ok(lexSearch.hits.length >= 1);
  assert.strictEqual(lexSearch.hits[0].provenance, 'heuristic', 'Lexical-fallback language (.rb) must be tagged heuristic');
  assert.strictEqual(lexSearch.hits[0].parse_engine, 'lexer');
  assert.strictEqual(lexSearch.hits[0].confidence, 0.6);

  const symRes = tools.code_symbol({ root: repo, name: 'verifyAuthToken' });
  assert.strictEqual(symRes.symbols[0].provenance, 'parser');
  assert.ok(symRes.snapshot && symRes.snapshot.head_sha);

  const ctxRes = tools.code_context({ root: repo, file: 'src/auth_token.js' });
  assert.strictEqual(ctxRes.provenance, 'parser');
  assert.ok(ctxRes.content_hash && ctxRes.snapshot && ctxRes.snapshot.snapshot_consistent);

  // Resolved vs Unresolved refs/edges in DB & code_impact
  const rootHash = store.computeRootHash(repo);
  const unresolvedRows = conn.prepare(
    "SELECT * FROM code_refs WHERE root_hash = ? AND target_name = 'missingExternalGuard'"
  ).all(rootHash);
  assert.ok(unresolvedRows.length >= 1, 'Expected unresolved ref row for missingExternalGuard');
  assert.strictEqual(unresolvedRows[0].target_symbol_id, null);
  assert.strictEqual(unresolvedRows[0].provenance, 'unresolved');
  assert.ok(unresolvedRows[0].confidence < 0.5);

  const resolvedImp = tools.code_impact({ root: repo, name: 'verifyAuthToken' });
  assert.ok(resolvedImp.dependents.length >= 1);
  const resolvedDep = resolvedImp.dependents.find((d) => d.path === 'src/session_service.js');
  assert.ok(resolvedDep && resolvedDep.resolved === true && resolvedDep.provenance === 'parser');

  const unresolvedImp = tools.code_impact({ root: repo, name: 'missingExternalGuard' });
  assert.ok(unresolvedImp.dependents.length >= 1);
  assert.strictEqual(unresolvedImp.dependents[0].resolved, false);
  assert.strictEqual(unresolvedImp.dependents[0].provenance, 'unresolved');

  // Snapshot staleness & related provenance
  const impactWithLsp = await queryEngine.impact({ rootPath: repo, name: 'verifyAuthToken', conn });
  assert.ok(impactWithLsp.snapshot && impactWithLsp.nodes.length >= 1);
  const relRes = tools.code_related({ root: repo, file: 'src/session_service.js' });
  assert.ok(relRes.related.length >= 1 && relRes.related[0].provenance && relRes.related[0].confidence > 0);
  assert.ok(relRes.snapshot && relRes.snapshot.snapshot_consistent === true);

  // Snapshot staleness detection when git HEAD advances past indexed head_sha
  fs.appendFileSync(path.join(repo, 'src/auth_token.js'), '// trailing commit\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'advance head'], { cwd: repo, stdio: 'ignore' });
  const statusAfterCommit = tools.code_status({ root: repo });
  assert.strictEqual(statusAfterCommit.roots.length, 1);
  assert.strictEqual(statusAfterCommit.roots[0].stale_head, true, 'code_status must detect stale_head after git commit');
  assert.strictEqual(statusAfterCommit.roots[0].snapshot_consistent, false);

  console.log('✓ Async code-intel integration, provenance, unresolved refs, and snapshot freshness tests passed!');
}

runTests()
  .catch((err) => {
    console.error('test_code_intel_async_and_provenance failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await lspManager.shutdownAll();
    store.closeConnection();
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
