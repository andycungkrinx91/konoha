'use strict';

/**
 * Test Suite: Complementary Stdio JSON-RPC 2.0 LSP Client & Workspace Manager.
 *
 * Uses a real child-process mock LSP server speaking byte-framed Content-Length
 * headers over stdio pipes (including multi-byte UTF-8 payloads, $/cancelRequest,
 * callHierarchy, LRU eviction, unavailable-binary fallback, and SIGTERM/SIGKILL teardown).
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-code-intel-lsp-'));
process.env.HOME = tmpRoot;
process.env.USERPROFILE = tmpRoot;
process.env.KONOHA_HOME = path.join(tmpRoot, '.konoha');
process.env.KONOHA_DB_PATH = path.join(tmpRoot, 'lsp.db');
process.env.KONOHA_SEMANTIC_SEARCH = '0';

const db = require('../src/db');
const store = require('../src/code_intel/store');
const { indexRepository } = require('../src/code_intel/indexer');
const { LspClient } = require('../src/code_intel/lsp_client');
const { LspManager, defaultManager } = require('../src/code_intel/lsp_manager');
const tools = require('../src/code_intel/tools');
const router = require('../src/file_tools_router');

router.setWorkspaceRoot(tmpRoot);

function writeMockLspServer(scriptPath, opts = {}) {
  const ignoreShutdown = Boolean(opts.ignoreShutdown);
  const logPath = path.join(tmpRoot, `lsp_events_${Math.random().toString(16).slice(2)}.jsonl`);
  const script = `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const logFile = ${JSON.stringify(logPath)};
const ignoreShutdown = ${JSON.stringify(ignoreShutdown)};
const rootDir = process.cwd();
let buf = Buffer.alloc(0);

function logEvent(evt) {
  fs.appendFileSync(logFile, JSON.stringify({ ...evt, pid: process.pid }) + '\\n', 'utf8');
}

function send(msg) {
  const json = JSON.stringify(msg);
  const len = Buffer.byteLength(json, 'utf8');
  process.stdout.write('Content-Length: ' + len + '\\r\\n\\r\\n' + json);
}

function handle(msg) {
  logEvent({ method: msg.method || 'reply', id: msg.id ?? null });
  if (msg.method === 'initialize') {
    return send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        capabilities: {
          definitionProvider: true,
          referencesProvider: true,
          hoverProvider: true,
          callHierarchyProvider: true
        }
      }
    });
  }
  if (msg.method === 'textDocument/hover') {
    return send({
      jsonrpc: '2.0',
      id: msg.id,
      result: { contents: { kind: 'markdown', value: 'function verifyToken(t: string): boolean — mock UTF-8 ✓ check' } }
    });
  }
  if (msg.method === 'textDocument/definition') {
    const uri = pathToFileURL(path.join(rootDir, 'src', 'auth.ts')).href;
    return send({
      jsonrpc: '2.0',
      id: msg.id,
      result: [{ uri, range: { start: { line: 0, character: 16 }, end: { line: 0, character: 27 } } }]
    });
  }
  if (msg.method === 'textDocument/references') {
    const authUri = pathToFileURL(path.join(rootDir, 'src', 'auth.ts')).href;
    const apiUri = pathToFileURL(path.join(rootDir, 'src', 'api.ts')).href;
    const extraUri = pathToFileURL(path.join(rootDir, 'src', 'extra.ts')).href;
    return send({
      jsonrpc: '2.0',
      id: msg.id,
      result: [
        { uri: authUri, range: { start: { line: 0, character: 16 }, end: { line: 0, character: 27 } } },
        { uri: apiUri, range: { start: { line: 2, character: 9 }, end: { line: 2, character: 20 } } },
        { uri: extraUri, range: { start: { line: 1, character: 2 }, end: { line: 1, character: 13 } } }
      ]
    });
  }
  if (msg.method === 'textDocument/prepareCallHierarchy') {
    const uri = msg.params.textDocument.uri;
    return send({
      jsonrpc: '2.0',
      id: msg.id,
      result: [{ name: 'verifyToken', kind: 12, uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } }, selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } } }]
    });
  }
  if (msg.method === 'callHierarchy/incomingCalls') {
    const apiUri = pathToFileURL(path.join(rootDir, 'src', 'api.ts')).href;
    return send({
      jsonrpc: '2.0',
      id: msg.id,
      result: [{
        from: {
          name: 'handleRequest',
          kind: 12,
          uri: apiUri,
          range: { start: { line: 1, character: 0 }, end: { line: 3, character: 1 } },
          selectionRange: { start: { line: 1, character: 16 }, end: { line: 1, character: 29 } }
        },
        fromRanges: []
      }]
    });
  }
  if (msg.method === '$/slowNeverReply') {
    // Deliberately hold until cancelled or closed
    return;
  }
  if (msg.method === 'shutdown') {
    if (ignoreShutdown) return;
    return send({ jsonrpc: '2.0', id: msg.id, result: null });
  }
  if (msg.method === 'exit') {
    process.exit(0);
  }
}

process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length > 0) {
    const idx = buf.indexOf(Buffer.from('\\r\\n\\r\\n', 'ascii'));
    if (idx === -1) break;
    const hdr = buf.subarray(0, idx).toString('ascii');
    const m = hdr.match(/content-length:\\s*(\\d+)/i);
    if (!m) { buf = buf.subarray(idx + 4); continue; }
    const len = Number(m[1]);
    const end = idx + 4 + len;
    if (buf.length < end) break;
    const raw = buf.subarray(idx + 4, end).toString('utf8');
    buf = buf.subarray(end);
    handle(JSON.parse(raw));
  }
});
`;
  fs.writeFileSync(scriptPath, script, 'utf8');
  return logPath;
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

function readLog(logPath) {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function callRouterTool(name, args) {
  const res = await router.dispatchToolAsync(name, args);
  assert.ok(!res.isError, `${name} router dispatch failed: ${res.text}`);
  return JSON.parse(res.text);
}

async function testRouterAndToolsLspEnrichment(conn, repo, mockScript, logPath) {
  process.env.KONOHA_LSP_COMMAND_OVERRIDE = `${process.execPath} ${mockScript}`;

  const symOut = await callRouterTool('code_symbol', { root: repo, name: 'verifyToken' });
  assert.ok(symOut.lsp && symOut.lsp.lsp_available === true, 'code_symbol async route must include LSP enrichment');
  assert.ok(symOut.lsp.hover.includes('mock UTF-8 ✓ check'), 'UTF-8 Content-Length framing must preserve multibyte hover');
  assert.ok(symOut.lsp.definitions.some((d) => d.relPath === 'src/auth.ts'));
  assert.ok(symOut.lsp.references.some((r) => r.relPath === 'src/api.ts'));
  assert.ok(symOut.lsp.incoming_calls.some((c) => c.name === 'handleRequest'));

  const impOut = await callRouterTool('code_impact', { root: repo, name: 'verifyToken' });
  assert.ok(impOut.lsp && impOut.lsp.lsp_available === true);
  assert.strictEqual(impOut.dependents.filter((d) => d.path === 'src/api.ts' && d.line === 3).length, 1, 'Existing static ref at api.ts:3 must be deduplicated');
  assert.ok(impOut.dependents.some((d) => d.path === 'src/extra.ts' && d.kind === 'lsp_reference'), 'code_impact must merge additional LSP reference edges');

  const ctxOut = await callRouterTool('code_context', { root: repo, file: 'src/auth.ts', start_line: 1, end_line: 2 });
  assert.ok(ctxOut.lsp && ctxOut.lsp.lsp_available === true && ctxOut.lsp.hover.includes('verifyToken'));

  const relOut = await callRouterTool('code_related', { root: repo, file: 'src/api.ts', symbol: 'verifyToken' });
  assert.ok(relOut.lsp && relOut.lsp.lsp_available === true);
  assert.ok(relOut.lsp.related.some((item) => item.relPath === 'src/auth.ts'));

  const statusOut = tools.code_status({ root: repo });
  assert.ok(statusOut.lsp && statusOut.lsp.enabled === true);
  assert.ok(statusOut.lsp.active_count >= 1, 'code_status must report active LSP server count');

  // Verify unavailable binary degrades gracefully without throwing
  process.env.KONOHA_LSP_COMMAND_OVERRIDE = '/nonexistent/konoha_missing_lsp_bin';
  const isolatedMgr = new LspManager();
  const fallbackRes = await isolatedMgr.enrichSymbol({
    rootPath: repo,
    name: 'verifyToken',
    symbols: [{ name: 'verifyToken', relPath: 'src/auth.ts', language: 'typescript', startLine: 1 }]
  });
  assert.strictEqual(fallbackRes.lsp_available, false);
  assert.ok(fallbackRes.reason.includes('missing'));

  const events = readLog(logPath);
  assert.ok(events.some((e) => e.method === 'initialize'), 'Mock LSP server must actually initialize');
  console.log('✓ Complementary LSP enrichment across code_symbol/impact/context/related/status & graceful fallback verified');
}

async function testCancelLruAndProcessCleanup(mockScript, logPath) {
  const r1 = path.join(tmpRoot, 'repo1');
  const r2 = path.join(tmpRoot, 'repo2');
  const r3 = path.join(tmpRoot, 'repo3');
  for (const r of [r1, r2, r3]) {
    fs.mkdirSync(path.join(r, 'src'), { recursive: true });
    fs.writeFileSync(path.join(r, 'src', 'auth.ts'), 'export function verifyToken() { return true; }\n', 'utf8');
  }

  delete process.env.KONOHA_LSP_COMMAND_OVERRIDE;
  const mgr = new LspManager({ maxClients: 2, idleTtlMs: 30000, timeoutMs: 2000 });
  const c1 = await mgr.acquireClient(r1, 'typescript', 'src/auth.ts', { commandOverride: `${process.execPath} ${mockScript}` });
  const c2 = await mgr.acquireClient(r2, 'typescript', 'src/auth.ts', { commandOverride: `${process.execPath} ${mockScript}` });
  assert.strictEqual(c1.available && c2.available, true);
  const pid1 = c1.client.pid;

  // Test $/cancelRequest propagation on timeout + AbortController
  await assert.rejects(
    () => c2.client.request('$/slowNeverReply', {}, { timeoutMs: 60 }),
    (err) => err && err.code === 'ETIMEDOUT'
  );
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 30);
  await assert.rejects(
    () => c2.client.request('$/slowNeverReply', {}, { timeoutMs: 2000, signal: ac.signal }),
    (err) => err && err.code === 'ABORT_ERR'
  );
  await new Promise((r) => setTimeout(r, 80));
  const events = readLog(logPath);
  const cancels = events.filter((e) => e.method === '$/cancelRequest');
  assert.ok(cancels.length >= 2, 'Timeout and AbortSignal must send $/cancelRequest to child LSP');

  // Adding r3 with maxClients=2 must evict LRU r1 and exit its child process
  const c3 = await mgr.acquireClient(r3, 'typescript', 'src/auth.ts', { commandOverride: `${process.execPath} ${mockScript}` });
  assert.strictEqual(c3.available, true);
  assert.strictEqual(mgr.pool.size, 2, 'LSP pool must stay bounded to maxClients');
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(isPidAlive(pid1), false, 'Evicted LRU LSP server child must terminate cleanly');

  const pid2 = c2.client.pid;
  const pid3 = c3.client.pid;
  await mgr.shutdownAll();
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(isPidAlive(pid2), false);
  assert.strictEqual(isPidAlive(pid3), false);

  // Test SIGTERM -> SIGKILL escalation when a hung server ignores shutdown
  const hungScript = path.join(tmpRoot, 'hung_lsp.js');
  writeMockLspServer(hungScript, { ignoreShutdown: true });
  const hungClient = new LspClient({ command: process.execPath, args: [hungScript], rootPath: r1, shutdownTimeoutMs: 120 });
  await hungClient.start();
  const hungPid = hungClient.pid;
  assert.strictEqual(isPidAlive(hungPid), true);
  await hungClient.close();
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(isPidAlive(hungPid), false, 'close() must kill unresponsive LSP server via SIGTERM/SIGKILL escalation');

  console.log('✓ LSP $/cancelRequest, LRU eviction, pool cap, idle/shutdown & SIGTERM/SIGKILL cleanup verified');
}

(async () => {
  const conn = db.getConnection();
  try {
    console.log('Running test_code_intel_lsp tests...');
    db.setupSchema(conn);
    const repo = path.join(tmpRoot, 'lsp_repo');
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'auth.ts'), 'export function verifyToken(t: string): boolean { return Boolean(t); }\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'src', 'api.ts'), "import { verifyToken } from './auth';\nexport function handleRequest(t: string) {\n  return verifyToken(t);\n}\n", 'utf8');
    indexRepository({ rootPath: repo, conn });

    const mockScript = path.join(tmpRoot, 'mock_lsp.js');
    const logPath = writeMockLspServer(mockScript);
    await testRouterAndToolsLspEnrichment(conn, repo, mockScript, logPath);
    await defaultManager.shutdownAll();
    await testCancelLruAndProcessCleanup(mockScript, logPath);
    console.log('test_code_intel_lsp passed cleanly.');
  } catch (err) {
    console.error('test_code_intel_lsp failed:', err);
    process.exitCode = 1;
  } finally {
    delete process.env.KONOHA_LSP_COMMAND_OVERRIDE;
    await defaultManager.shutdownAll();
    store.closeConnection();
    try { conn.close(); } catch (_) { /* ignore */ }
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})();
