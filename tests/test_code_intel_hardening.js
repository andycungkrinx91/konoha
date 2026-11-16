'use strict';

/**
 * Regression suite for PR #16 Code Intelligence Hardening (Phases 1-3).
 *
 * Covers:
 *  - P1: Semantic capability gating (offline without cache / runtime error) and graceful degradation
 *  - P2: Out-of-range code_context window behavior (empty text, outOfRange, truncated: false, accurate lines)
 *  - P2: _pruneVanished preservation on maxFiles truncation & unreadable directories
 *  - P2: store.ftsAvailable() honest probe + idempotent FTS5 repair on user_version = 7
 *  - P3: Concurrent MCP tools/list during slow code_index + serialized WORKFLOW_GRAPH_TOOLS
 *  - P3: Sync vs Async indexRepository code_edges parity
 *  - P3: Bounded _vectorSlabs LRU eviction + paged SQLite vector search
 *  - P3: Path containment and @genin code_index bounds retention
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { Readable } = require('node:stream');
const { spawn } = require('node:child_process');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-code-intel-hard-'));
process.env.HOME = tmpRoot;
process.env.USERPROFILE = tmpRoot;
process.env.KONOHA_HOME = path.join(tmpRoot, '.konoha');
process.env.KONOHA_DB_PATH = path.join(tmpRoot, 'hardening.db');

const db = require('../src/db');
const { getCurrentUserVersion } = require('../src/db_schema');
const store = require('../src/code_intel/store');
const query = require('../src/code_intel/query');
const related = require('../src/code_intel/related');
const tools = require('../src/code_intel/tools');
const { indexRepository, indexRepositoryAsync } = require('../src/code_intel/indexer');
const { parseFileAsync } = require('../src/code_intel/parser_wasm');
const vectorPipeline = require('../src/vector_pipeline');
const router = require('../src/file_tools_router');
const { createRequestScheduler } = require('../src/mcp/request_scheduler');
const { handleServicesRoutes } = require('../src/web/controllers/services_controller');

router.setWorkspaceRoot(tmpRoot);

function setupRepo(name, files) {
  const repoDir = path.join(tmpRoot, name);
  fs.mkdirSync(repoDir, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(repoDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, 'utf8');
  }
  return repoDir;
}

function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined || v === null) delete process.env[k];
    else process.env[k] = String(v);
  }
  const restore = () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  try {
    const out = fn();
    if (out && typeof out.then === 'function') return out.finally(restore);
    restore();
    return out;
  } catch (err) {
    restore();
    throw err;
  }
}

async function testSemanticCapabilityAndDegradation(conn) {
  const emptyHfHome = path.join(tmpRoot, 'empty_hf_home');
  fs.mkdirSync(emptyHfHome, { recursive: true });
  await vectorPipeline.resetPipelinesForTest();

  withEnv({ HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HOME: emptyHfHome, HF_HUB_CACHE: null, KONOHA_SEMANTIC_SEARCH: '1' }, () => {
    const st = vectorPipeline.getRuntimeStatus();
    assert.strictEqual(st.offline, true);
    assert.strictEqual(st.available, false, 'Offline with empty HF cache must report available: false');
    assert.ok(st.reason.includes('offline'), `Expected offline reason, got ${st.reason}`);
  });

  // Populated cache under HF_HOME/hub/<repo> makes offline status available: true
  const cachedRepoDir = path.join(emptyHfHome, 'hub', ...vectorPipeline.EMBED_MODEL_REPO.split('/'));
  fs.mkdirSync(cachedRepoDir, { recursive: true });
  fs.writeFileSync(path.join(cachedRepoDir, 'config.json'), '{}', 'utf8');
  withEnv({ HF_HUB_OFFLINE: '1', HF_HOME: emptyHfHome, HF_HUB_CACHE: null, KONOHA_SEMANTIC_SEARCH: '1' }, () => {
    const st = vectorPipeline.getRuntimeStatus();
    assert.strictEqual(st.available, true, 'Offline with cached model files must report available: true');
  });

  // Force unavailable index + search + related (disabled/offline no cache) -> fresh index, FTS hits, zero throws
  const repo = setupRepo('p1_repo', {
    'src/auth.js': 'function verifyJwtSignature(token) { return Boolean(token); }\nmodule.exports = { verifyJwtSignature };\n',
    'src/caller.js': "const { verifyJwtSignature } = require('./auth');\nfunction loginUser(t) { return verifyJwtSignature(t); }\n"
  });
  const uncachedHome = path.join(tmpRoot, 'uncached_hf');
  fs.mkdirSync(uncachedHome, { recursive: true });

  const callRoute = async (pathname, method, body) => {
    const req = body ? Readable.from([JSON.stringify(body)]) : Readable.from([]);
    return new Promise((resolve) => {
      const res = {
        statusCode: 0,
        writeHead(code) { res.statusCode = code; },
        setHeader() {},
        end(payload) { resolve({ status: res.statusCode, body: JSON.parse(payload) }); }
      };
      handleServicesRoutes(req, res, { broadcastEvent: () => {}, sseClients: new Set() }, new URL(`http://127.0.0.1${pathname}`), pathname, method);
    });
  };

  await withEnv({ HF_HUB_OFFLINE: '1', HF_HOME: uncachedHome, HF_HUB_CACHE: null, KONOHA_SEMANTIC_SEARCH: '1' }, async () => {
    const idx = await indexRepositoryAsync({ rootPath: repo, conn });
    assert.strictEqual(idx.status, 'fresh', 'Unavailable embeddings must leave index fresh');
    assert.ok(idx.semantic_skipped && idx.semanticSkipped, 'semantic_skipped reason must be reported');

    const sSync = query.search({ rootPath: repo, query: 'verifyJwtSignature', conn });
    assert.strictEqual(sSync.semantic_status, 'degraded');

    const sRes = await query.searchAsync({ rootPath: repo, query: 'verifyJwtSignature', conn });
    assert.strictEqual(sRes.degraded, true);
    assert.strictEqual(sRes.semantic_status, 'degraded');
    assert.strictEqual(sRes.semantic_applied, false);
    assert.strictEqual(sRes.reranked, false);
    assert.ok(sRes.reason, 'Degraded reason must be surfaced');
    assert.ok(sRes.hits.some((h) => h.relPath === 'src/auth.js'));

    const rSync = related.related({ rootPath: repo, file: 'src/caller.js', conn });
    assert.strictEqual(rSync.semantic_status, 'degraded');

    const rRes = await related.relatedAsync({ rootPath: repo, file: 'src/caller.js', conn });
    assert.strictEqual(rRes.degraded, true);
    assert.strictEqual(rRes.semantic_status, 'degraded');
    assert.strictEqual(rRes.semantic_applied, false);
    assert.strictEqual(rRes.reranked, false);
    assert.ok(rRes.related.some((item) => item.relPath === 'src/auth.js'));

    const statusHttp = await callRoute('/api/v1/code/status', 'GET');
    assert.strictEqual(statusHttp.status, 200);
    assert.strictEqual(statusHttp.body.semantic_enabled, false);
    assert.strictEqual(statusHttp.body.semantic_status, 'degraded');

    const sHttp = await callRoute('/api/v1/code/search', 'POST', { query: 'verifyJwtSignature', root: repo });
    assert.strictEqual(sHttp.status, 200);
    assert.strictEqual(sHttp.body.degraded, true);
    assert.strictEqual(sHttp.body.semantic_status, 'degraded');
    assert.ok(sHttp.body.hits.length >= 1);

    const rHttp = await callRoute('/api/v1/code/related', 'POST', { file: 'src/caller.js', root: repo });
    assert.strictEqual(rHttp.status, 200);
    assert.strictEqual(rHttp.body.degraded, true);
    assert.strictEqual(rHttp.body.semantic_status, 'degraded');
  });

  // Intentionally disabled semantic search (KONOHA_SEMANTIC_SEARCH=0) must report disabled, never degraded
  await withEnv({ HF_HUB_OFFLINE: '1', HF_HOME: uncachedHome, HF_HUB_CACHE: null, KONOHA_SEMANTIC_SEARCH: '0' }, async () => {
    const idxDisabled = await indexRepositoryAsync({ rootPath: repo, conn });
    assert.strictEqual(idxDisabled.status, 'fresh');

    const checks = [
      query.search({ rootPath: repo, query: 'verifyJwtSignature', conn }),
      await query.searchAsync({ rootPath: repo, query: 'verifyJwtSignature', conn }),
      tools.code_search({ root: repo, query: 'verifyJwtSignature' }),
      await tools.code_search_async({ root: repo, query: 'verifyJwtSignature' }),
      related.related({ rootPath: repo, file: 'src/caller.js', conn }),
      await related.relatedAsync({ rootPath: repo, file: 'src/caller.js', conn }),
      tools.code_related({ root: repo, file: 'src/caller.js' }),
      await tools.code_related_async({ root: repo, file: 'src/caller.js' })
    ];
    for (const out of checks) {
      assert.strictEqual(out.semantic_status, 'disabled');
      assert.strictEqual(out.degraded, false);
      assert.strictEqual(out.semantic_applied, false);
      assert.strictEqual(out.reranked, false);
      const list = out.hits || out.related || [];
      assert.ok(list.length >= 1, 'Lexical/structural results must remain available when disabled');
    }

    const toolStatus = tools.code_status({ root: repo });
    assert.strictEqual(toolStatus.semantic_status, 'disabled');
    const statusDisabled = await callRoute('/api/v1/code/status', 'GET');
    assert.strictEqual(statusDisabled.status, 200);
    assert.strictEqual(statusDisabled.body.semantic_status, 'disabled');
    const sDisabled = await callRoute('/api/v1/code/search', 'POST', { query: 'verifyJwtSignature', root: repo });
    assert.strictEqual(sDisabled.status, 200);
    assert.strictEqual(sDisabled.body.semantic_status, 'disabled');
    assert.strictEqual(sDisabled.body.degraded, false);
  });

  // Enabled semantic search whose runtime fails mid-flight (corrupt offline cache) must report degraded
  const corruptHfHome = path.join(tmpRoot, 'corrupt_hf');
  const corruptEmbedDir = path.join(corruptHfHome, 'hub', ...vectorPipeline.EMBED_MODEL_REPO.split('/'));
  fs.mkdirSync(corruptEmbedDir, { recursive: true });
  fs.writeFileSync(path.join(corruptEmbedDir, 'config.json'), '{corrupt-json', 'utf8');
  await withEnv({ HF_HUB_OFFLINE: '1', HF_HOME: corruptHfHome, HF_HUB_CACHE: null, KONOHA_SEMANTIC_SEARCH: '1' }, async () => {
    try {
      assert.strictEqual(vectorPipeline.getRuntimeStatus().semanticStatus, 'available');
      const sFail = await query.searchAsync({ rootPath: repo, query: 'verifyJwtSignature', conn });
      assert.strictEqual(sFail.semantic_status, 'degraded');
      assert.strictEqual(sFail.degraded, true);
      assert.strictEqual(sFail.semantic_applied, false);
      assert.ok(sFail.hits.some((h) => h.relPath === 'src/auth.js'));

      const rFail = await related.relatedAsync({ rootPath: repo, file: 'src/caller.js', conn });
      assert.strictEqual(rFail.semantic_status, 'degraded');
      assert.strictEqual(rFail.degraded, true);
      assert.ok(rFail.related.some((item) => item.relPath === 'src/auth.js'));
    } finally {
      await vectorPipeline.resetPipelinesForTest();
    }
  });

  // Also test genuine failure still marks root failed
  await assert.rejects(() => indexRepositoryAsync({ rootPath: path.join(tmpRoot, 'does_not_exist_dir'), conn }));
  console.log('✓ P1: Semantic capability gate, offline cache check, and HTTP/tool graceful degradation verified');
}

async function testContextAndPruningAndFtsRepair(conn) {
  const repo = setupRepo('p2_repo', {
    'src/ten_lines.js': Array.from({ length: 10 }, (_, i) => `const line${i + 1} = ${i + 1};`).join('\n') + '\n',
    'src/gap.js': 'function one() { return 1; }\n\n\n\n\n\n\nfunction two() { return 2; }\n',
    'sub/a.js': 'export const a = 1;\n',
    'sub/b.js': 'export const b = 2;\n',
    'keep/c.js': 'export const c = 3;\n',
    'keep/d.js': 'export const d = 4;\n'
  });

  const fullIdx = indexRepository({ rootPath: repo, conn });
  assert.strictEqual(fullIdx.status, 'fresh');
  assert.strictEqual(fullIdx.incomplete, false);

  // P2.1: Out-of-range window returns empty string, explicit outOfRange, truncated: false, lines: [0, 0]
  const oor = query.getContext({ rootPath: repo, relPath: 'src/ten_lines.js', startLine: 900, endLine: 920, conn });
  assert.strictEqual(oor.text, '');
  assert.strictEqual(oor.outOfRange, true);
  assert.strictEqual(oor.truncated, false);
  assert.strictEqual(oor.startLine, 0);
  assert.strictEqual(oor.endLine, 0);

  const toolOor = tools.code_context({ root: repo, file: 'src/ten_lines.js', start_line: 900, end_line: 920 });
  assert.strictEqual(toolOor.content, '');
  assert.strictEqual(toolOor.empty, true);
  assert.strictEqual(toolOor.out_of_range, true);
  assert.strictEqual(toolOor.truncated, false);
  assert.deepStrictEqual(toolOor.lines, [0, 0]);

  // Partial EOF window reports actual returned line span [8, 11] not [8, 200]
  const partialWin = tools.code_context({ root: repo, file: 'src/ten_lines.js', start_line: 8, end_line: 200 });
  assert.ok(partialWin.content.includes('line10'));
  assert.strictEqual(partialWin.out_of_range, false);
  assert.ok(partialWin.lines[0] === 8 && partialWin.lines[1] <= 11, `Expected bounded EOF end line, got ${JSON.stringify(partialWin.lines)}`);

  // P2.2: Truncated walk with maxFiles must NOT prune remaining indexed files
  const beforeFiles = conn.prepare('SELECT COUNT(*) AS n FROM code_files WHERE root_hash = ?').get(fullIdx.rootHash).n;
  assert.strictEqual(beforeFiles, 6);
  const capped = indexRepository({ rootPath: repo, conn, maxFiles: 2 });
  assert.strictEqual(capped.incomplete, true);
  assert.strictEqual(capped.capReached, true);
  assert.notStrictEqual(capped.status, 'fresh');
  assert.strictEqual(capped.removed, 0);
  const afterCapFiles = conn.prepare('SELECT COUNT(*) AS n FROM code_files WHERE root_hash = ?').get(fullIdx.rootHash).n;
  assert.strictEqual(afterCapFiles, 6, 'Capped walk must preserve all pre-existing code_files rows');

  // Re-index unreadable dir + unreadable file (EACCES) + transient ENOENT when not running as root
  if (process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() !== 0) {
    const blockedDir = path.join(repo, 'sub');
    const blockedFile = path.join(repo, 'keep', 'c.js');
    fs.unlinkSync(path.join(repo, 'keep', 'd.js'));
    fs.chmodSync(blockedDir, 0o000);
    fs.chmodSync(blockedFile, 0o000);
    try {
      const partialUnreadable = indexRepository({ rootPath: repo, conn, force: true });
      assert.strictEqual(partialUnreadable.incomplete, true);
      assert.ok(partialUnreadable.unreadableDirs.includes('sub'));
      assert.ok(partialUnreadable.unreadableFiles.includes('keep/c.js'), 'EACCES file must be tracked in unreadableFiles');
      assert.notStrictEqual(partialUnreadable.status, 'fresh', 'EACCES skip must mark root stale, never fresh');
      assert.strictEqual(partialUnreadable.removed, 1, 'Deleted keep/d.js is pruned while unreadable sub/* and keep/c.js survive');
      const subRows = conn.prepare("SELECT COUNT(*) AS n FROM code_files WHERE root_hash = ? AND rel_path LIKE 'sub/%'").get(fullIdx.rootHash).n;
      assert.strictEqual(subRows, 2, 'Rows under unreadable directory must survive');
      const protectedFile = conn.prepare("SELECT COUNT(*) AS n FROM code_files WHERE root_hash = ? AND rel_path = 'keep/c.js'").get(fullIdx.rootHash).n;
      assert.strictEqual(protectedFile, 1, 'EACCES unreadable file must keep its pre-existing indexed rows');
    } finally {
      fs.chmodSync(blockedDir, 0o755);
      fs.chmodSync(blockedFile, 0o644);
    }
  }

  // Transient ENOENT between walk and read (e.g. broken symlink or vanished file) must not leave stale phantom rows or mark root failed
  const origReadFileSync = fs.readFileSync;
  fs.writeFileSync(path.join(repo, 'keep', 'ephemeral.js'), 'export const tempEnoent = 1;\n', 'utf8');
  const beforeTransient = indexRepository({ rootPath: repo, conn });
  assert.strictEqual(beforeTransient.status, 'fresh');
  const ephTarget = path.join(repo, 'keep', 'ephemeral.js');
  fs.readFileSync = function patchedRead(target, ...rest) {
    if (path.resolve(String(target)) === ephTarget) {
      const err = new Error(`ENOENT: no such file '${target}'`);
      err.code = 'ENOENT';
      throw err;
    }
    return origReadFileSync.call(this, target, ...rest);
  };
  try {
    const transientRes = indexRepository({ rootPath: repo, conn, force: true });
    assert.strictEqual(transientRes.status, 'fresh', 'Transient ENOENT vanished file should be pruned cleanly without false stale');
    assert.strictEqual(transientRes.removed, 1, 'Transient ENOENT file must be pruned cleanly');
    assert.ok(transientRes.skipped.some((s) => s.relPath === 'keep/ephemeral.js' && s.reason.includes('ENOENT')));
  } finally {
    fs.readFileSync = origReadFileSync;
    if (fs.existsSync(ephTarget)) fs.unlinkSync(ephTarget);
  }
  const settledRes = indexRepository({ rootPath: repo, conn });
  assert.strictEqual(settledRes.status, 'fresh');

  // Atomic two-phase rollback on AbortSignal & mid-commit throw
  const rollbackRepo = setupRepo('p2_rollback_repo', {
    'a.js': 'export function stableOriginalToken() { return 1; }\n',
    'b.js': 'export function stableSecondToken() { return 2; }\n'
  });
  const initialRollbackIdx = await indexRepositoryAsync({ rootPath: rollbackRepo, conn, embed: false });
  assert.strictEqual(initialRollbackIdx.status, 'fresh');
  fs.writeFileSync(path.join(rollbackRepo, 'a.js'), 'export function abortedPartialToken() { return 99; }\n', 'utf8');
  fs.writeFileSync(path.join(rollbackRepo, 'c.js'), 'export function abortedNewFileToken() { return 100; }\n', 'utf8');

  const ac = new AbortController();
  let seenCommits = 0;
  await assert.rejects(
    () => indexRepositoryAsync({
      rootPath: rollbackRepo,
      conn,
      embed: false,
      signal: ac.signal,
      beforeCommitFile: () => {
        seenCommits += 1;
        if (seenCommits === 2) ac.abort();
      }
    }),
    (err) => err && err.code === 'ABORT_ERR'
  );
  const afterAbortStatus = query.status({ rootPath: rollbackRepo, conn }).roots[0];
  assert.strictEqual(afterAbortStatus.status, 'failed', 'Aborted run must mark root failed, never false fresh');
  const rolledBackFiles = conn.prepare('SELECT rel_path FROM code_files WHERE root_hash = ? ORDER BY rel_path').all(initialRollbackIdx.rootHash).map((r) => r.rel_path);
  assert.deepStrictEqual(rolledBackFiles, ['a.js', 'b.js'], 'Transaction rollback must preserve original file set');
  const origSearch = query.search({ rootPath: rollbackRepo, query: 'stableOriginalToken', conn });
  assert.ok(origSearch.hits.some((h) => h.relPath === 'a.js'), 'FTS/chunks for original symbol must remain intact after rollback');
  const abortedSearch = query.search({ rootPath: rollbackRepo, query: 'abortedPartialToken', conn });
  assert.strictEqual(abortedSearch.total, 0, 'Aborted edit must not leak partial FTS/chunks');

  // P2.3: store.ftsAvailable + repair on user_version = 7
  assert.strictEqual(store.ftsAvailable(conn), true);
  conn.exec('DROP TABLE IF EXISTS code_chunks_fts');
  assert.strictEqual(store.ftsAvailable(conn), false, 'ftsAvailable must return false when code_chunks_fts is missing');
  const likeSearch = query.search({ rootPath: repo, query: 'line5', conn });
  assert.strictEqual(likeSearch.degraded, true);
  assert.ok(likeSearch.total >= 1);

  assert.ok(getCurrentUserVersion(conn) >= 7);
  db.setupSchema(conn);
  assert.strictEqual(store.ftsAvailable(conn), true, 'setupSchema must recreate dropped code_chunks_fts at user_version >= 7');
  const repairedSearch = query.search({ rootPath: repo, query: 'line5', conn });
  assert.strictEqual(repairedSearch.degraded, false);
  assert.ok(repairedSearch.total >= 1, 'Rebuilt FTS5 index must immediately serve pre-existing chunks');

  console.log('✓ P2: Out-of-range context, incomplete-walk pruning preservation, and FTS5 auto-repair verified');
}

async function testMcpConcurrencyParityAndBoundedVectors(conn) {
  // P3.1: Concurrent tools/list during slow code_index, while sannin stays serialized
  const events = [];
  const outputs = [];
  const scheduler = createRequestScheduler({
    serializedTools: ['sannin'],
    writeLine: (obj) => outputs.push(obj),
    handleRequest: async (req) => {
      if (req.method === 'tools/call' && req.params.name === 'code_index') {
        events.push(`start:${req.id}`);
        await new Promise((r) => setTimeout(r, 80));
        events.push(`end:${req.id}`);
        return { jsonrpc: '2.0', id: req.id, result: { ok: true } };
      }
      if (req.method === 'tools/list') {
        events.push(`list:${req.id}`);
        return { jsonrpc: '2.0', id: req.id, result: { tools: [] } };
      }
      if (req.method === 'tools/call' && req.params.name === 'sannin') {
        events.push(`sannin_start:${req.id}`);
        await new Promise((r) => setTimeout(r, 40));
        events.push(`sannin_end:${req.id}`);
        return { jsonrpc: '2.0', id: req.id, result: { gate: 1 } };
      }
      return { jsonrpc: '2.0', id: req.id, result: {} };
    }
  });

  const t1 = scheduler.enqueueLine(JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'code_index', arguments: {} } }));
  const t2 = scheduler.enqueueLine(JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'tools/list', params: {} }));
  const t3 = scheduler.enqueueLine(JSON.stringify({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'sannin', arguments: {} } }));
  const t4 = scheduler.enqueueLine(JSON.stringify({ jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'sannin', arguments: {} } }));
  await Promise.all([t1, t2, t3, t4]);

  assert.ok(events.indexOf('list:11') < events.indexOf('end:10'), 'tools/list must finish before slow code_index ends');
  assert.ok(events.indexOf('sannin_end:12') < events.indexOf('sannin_start:13'), 'WORKFLOW_GRAPH_TOOLS must still serialize');

  // Real subprocess proof on src/file_tools_mcp.js: slow code_index must not block tools/list
  const bigRepo = setupRepo(
    'mcp_slow_repo',
    Object.fromEntries(Array.from({ length: 180 }, (_, idx) => [`mod_${idx}.js`, `export function m${idx}() { return ${idx}; }\n`]))
  );
  const responseOrder = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'file_tools_mcp.js')], {
      cwd: tmpRoot,
      env: { ...process.env, KONOHA_SEMANTIC_SEARCH: '0' },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const responses = [];
    let buf = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) { /* ignore */ }
      reject(new Error('MCP subprocess timed out'));
    }, 15000);
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) responses.push(JSON.parse(line));
        if (responses.length === 3) {
          clearTimeout(timer);
          child.stdin.end();
        }
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`MCP exited ${code}`));
      resolve(responses);
    });
    child.on('error', reject);
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', clientInfo: { name: 'test', version: '1' } }
    }) + '\n');
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'code_index', arguments: { root: bigRepo, embed: false } }
    }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }) + '\n');
  });
  const ids = responseOrder.map((r) => r.id);
  assert.strictEqual(ids.length, 3);
  assert.ok(ids.indexOf(3) < ids.indexOf(2), `Expected tools/list (3) to reply before code_index (2), got order ${JSON.stringify(ids)}`);

  // P3.2: Sync vs Async graph parity
  const parityFiles = {
    'base.js': 'class Animal { speak() { return "hi"; } }\nmodule.exports = { Animal };\n',
    'dog.js': "const { Animal } = require('./base');\nclass Dog extends Animal { bark() { return this.speak(); } }\nmodule.exports = { Dog };\n"
  };
  const syncRepo = setupRepo('p3_sync_repo', parityFiles);
  const asyncRepo = setupRepo('p3_async_repo', parityFiles);
  const sIdx = indexRepository({ rootPath: syncRepo, conn });
  const aIdx = await indexRepositoryAsync({ rootPath: asyncRepo, conn, embed: false });
  assert.strictEqual(sIdx.edges, aIdx.edges, 'Sync and async indexers must populate identical code_edges counts');
  assert.ok(sIdx.edges > 0 && sIdx.edgesResolved > 0, 'Sync indexRepository must resolve cross-file edges');
  const syncImpact = query.impact({ rootPath: syncRepo, name: 'Animal', conn });
  assert.ok(syncImpact.nodes.some((n) => n.relPath === 'dog.js' && n.kind === 'extends'));

  // P3.3: Bounded _vectorSlabs LRU eviction + paged SQLite vector search
  store.invalidateVectorSlab();
  const unitVec = (idx) => {
    const v = new Float32Array(384);
    v[idx % 384] = 1;
    return v;
  };
  const slabRoots = [];
  for (let i = 0; i < 6; i++) {
    const dir = setupRepo(`vec_root_${i}`, { [`f${i}.js`]: `export function fn${i}() { return ${i}; }\n` });
    const res = indexRepository({ rootPath: dir, conn });
    const cRow = conn.prepare('SELECT id FROM code_chunks WHERE root_hash = ? LIMIT 1').get(res.rootHash);
    store.writeChunkEmbeddingsById(conn, res.rootHash, 'test-model', [{ chunkId: cRow.id, vector: unitVec(i) }]);
    slabRoots.push(res.rootHash);
  }
  for (const rh of slabRoots) {
    store.getVectorSlab(conn, rh, 'test-model', { maxRoots: 4 });
  }
  assert.ok(store._vectorSlabs.size <= 4, `Expected LRU cap <= 4 roots, got ${store._vectorSlabs.size}`);
  assert.ok(!store._vectorSlabs.has(slabRoots[0]), 'Oldest LRU slab must be evicted');
  assert.ok(store._vectorSlabs.has(slabRoots[5]), 'Most recent slab must remain cached');

  // Force paged path via maxChunksPerRoot: 1 on multi-chunk root
  const pagedRepo = setupRepo('vec_paged', {
    'a.js': 'export function alphaVec() { return 1; }\n',
    'b.js': 'export function betaVec() { return 2; }\n',
    'c.js': 'export function gammaVec() { return 3; }\n'
  });
  const pIdx = indexRepository({ rootPath: pagedRepo, conn });
  const pChunks = conn.prepare('SELECT id, rel_path FROM code_chunks WHERE root_hash = ? ORDER BY id ASC').all(pIdx.rootHash);
  store.writeChunkEmbeddingsById(
    conn,
    pIdx.rootHash,
    'test-model',
    pChunks.map((c, idx) => ({ chunkId: c.id, vector: unitVec(idx) }))
  );
  assert.strictEqual(store.getVectorSlab(conn, pIdx.rootHash, 'test-model', { maxChunksPerRoot: 1 }), null);
  const pagedHits = store.searchVectorCandidates(conn, pIdx.rootHash, unitVec(1), {
    model: 'test-model',
    limit: 2,
    maxChunksPerRoot: 1,
    pageSize: 1
  });
  assert.strictEqual(pagedHits.length, 2);
  assert.strictEqual(pagedHits[0].relPath, pChunks[1].rel_path, 'Paged vector scan must return exact top similarity match');

  // P3.4: Re-verify containment & genin bounds
  assert.throws(() => tools.code_index({ root: '/etc' }), /outside workspace/i);
  const geninPrep = router.prepareToolCall('code_index', { root: syncRepo, agent: 'genin', max_files: 99999, timeout_ms: 999999 });
  assert.strictEqual(geninPrep.args.max_files, 5000);
  assert.strictEqual(geninPrep.args.timeout_ms, 30000);
  void http;

  console.log('✓ P3: Concurrent MCP queue, sync/async graph parity, bounded LRU/paged vectors, and security bounds verified');
}

async function testWarmedParserMcpResponsiveness(conn) {
  const warmSeed = setupRepo('p2_warm_seed', {
    'seed.js': 'function warmSeed(v) { return v + 1; }\nmodule.exports = { warmSeed };\n'
  });
  const bigFiles = Object.fromEntries(
    Array.from({ length: 260 }, (_, idx) => [
      `src/svc_${idx}.js`,
      [
        `function fn_${idx}_a(x) { return x + ${idx}; }`,
        `function fn_${idx}_b(y) { return fn_${idx}_a(y) * 2; }`,
        `class Service_${idx} { run(v) { return fn_${idx}_b(v); } }`,
        `module.exports = { Service_${idx}, fn_${idx}_a };\n`
      ].join('\n')
    ])
  );
  const bigRepo = setupRepo('p2_warmed_big_repo', bigFiles);

  // Subprocess MCP test: warm Tree-sitter grammar first (id=2), then verify tools/list (id=4) beats sustained indexing (id=3)
  const mcpResult = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'file_tools_mcp.js')], {
      cwd: tmpRoot,
      // Pace indexing so 260 files cannot finish before the assertion on a fast
      // runner: the invariant under test is that tools/list is answered while
      // code_index is in flight, not that this machine happens to be slow.
      env: { ...process.env, KONOHA_SEMANTIC_SEARCH: '0', KONOHA_INDEX_FILE_DELAY_MS: '5' },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const responses = new Map();
    const order = [];
    const waiters = new Map();
    let buf = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) { /* ignore */ }
      reject(new Error(`Warmed MCP subprocess timed out; seen ids=${JSON.stringify(order)}`));
    }, 20000);
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        responses.set(msg.id, msg);
        order.push(msg.id);
        if (waiters.has(msg.id)) {
          waiters.get(msg.id)(msg);
          waiters.delete(msg.id);
        }
      }
    });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    const waitForId = (id) => (responses.has(id)
      ? Promise.resolve(responses.get(id))
      : new Promise((res) => waiters.set(id, res)));
    const send = (payload) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...payload }) + '\n');

    (async () => {
      send({ id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', clientInfo: { name: 'warm-test', version: '1' } } });
      await waitForId(1);
      send({ id: 2, method: 'tools/call', params: { name: 'code_index', arguments: { root: warmSeed, embed: false } } });
      await waitForId(2); // Tree-sitter WASM + JS grammar now warm and cached

      send({ id: 3, method: 'tools/call', params: { name: 'code_index', arguments: { root: bigRepo, embed: false } } });
      // No DB poll before this: the parent's connection is not a reliable
      // observer of the child's `indexing` status (macOS shard 2/5 of run
      // 43868450771 read the response before it ever saw the row, then failed
      // the "still running" guard). The ordering assertion below is the real
      // invariant — tools/list answered while code_index was in flight — and
      // the 5 ms/file pacing makes 260 files take over a second, so sending
      // tools/list immediately cannot race it.
      send({ id: 4, method: 'tools/list', params: {} });
      await Promise.all([waitForId(4), waitForId(3)]);
      child.stdin.end();
      await new Promise((res, rej) => child.once('exit', (code) => (code === 0 ? res() : rej(new Error(`MCP exited ${code}`)))));
      clearTimeout(timer);
      resolve({ order, idxResp: responses.get(3), listResp: responses.get(4) });
    })().catch((err) => {
      clearTimeout(timer);
      try { child.kill('SIGKILL'); } catch (_) { /* ignore */ }
      reject(err);
    });
  });

  assert.ok(mcpResult.order.indexOf(4) < mcpResult.order.indexOf(3),
    `Expected tools/list (4) before warmed code_index (3), got order ${JSON.stringify(mcpResult.order)}`);
  assert.ok(Array.isArray(mcpResult.listResp.result.tools) && mcpResult.listResp.result.tools.length > 0);
  const idxPayload = JSON.parse(mcpResult.idxResp.result.content[0].text);
  assert.strictEqual(idxPayload.status, 'fresh');
  assert.strictEqual(idxPayload.files, 260);

  // In-process verification with pre-warmed parseFileAsync during sustained parsed-file loop
  await parseFileAsync('function warmLocal(a) { return a + 1; }\n', 'javascript', 'warm_local.js');
  const inProcRepo = setupRepo('p2_warmed_inproc', bigFiles);
  let indexingDone = false;
  let listStarted = false;
  const events = [];
  const scheduler = createRequestScheduler({
    serializedTools: ['sannin'],
    writeLine: () => {},
    handleRequest: async (req) => {
      if (req.method === 'tools/list') {
        events.push('tools_list_done');
        return { jsonrpc: '2.0', id: req.id, result: { tools: [] } };
      }
      return { jsonrpc: '2.0', id: req.id, result: {} };
    }
  });
  let listPromise = null;
  const idxOut = await indexRepositoryAsync({
    rootPath: inProcRepo,
    conn,
    embed: false,
    onProgress: (info) => {
      const msg = typeof info === 'string' ? info : (info && info.phase);
      if (!listStarted && !indexingDone && typeof msg === 'string' && msg.startsWith('parsed ')) {
        listStarted = true;
        listPromise = scheduler.enqueueLine(JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list', params: {} }));
      }
    }
  });
  indexingDone = true;
  events.push('indexing_done');
  assert.ok(listPromise, 'onProgress parsed phase must have triggered during warmed async indexing');
  await listPromise;
  assert.strictEqual(events[0], 'tools_list_done', `Expected tools/list to complete before indexing finished, events=${events.join(',')}`);
  assert.strictEqual(idxOut.status, 'fresh');
  assert.strictEqual(idxOut.files, 260);
  console.log('✓ P2-fix: Warmed Tree-sitter async indexing yields cooperatively and serves concurrent tools/list before completion');
}

(async () => {
  const conn = db.getConnection();
  try {
    console.log('Running test_code_intel_hardening tests...');
    db.setupSchema(conn);
    await testSemanticCapabilityAndDegradation(conn);
    await testContextAndPruningAndFtsRepair(conn);
    await testMcpConcurrencyParityAndBoundedVectors(conn);
    await testWarmedParserMcpResponsiveness(conn);
    console.log('test_code_intel_hardening passed cleanly.');
  } catch (err) {
    console.error('test_code_intel_hardening failed:', err);
    process.exitCode = 1;
  } finally {
    store.invalidateVectorSlab();
    store.closeConnection();
    try { conn.close(); } catch (_) { /* ignore */ }
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})();
