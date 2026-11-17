#!/usr/bin/env node
'use strict';

/**
 * Reproducible staged benchmark for Konoha Native Code Intelligence (Issue #13).
 *
 * Measures:
 *   1. File walk + strict SHA-256 hashing over a synthetic ~3,000-file repo
 *   2. web-tree-sitter WASM AST parse + chunking latency (p50/p95)
 *   3. Cold index vs unchanged incremental vs single-file incremental re-index
 *   4. Hybrid (FTS5 + Granite 97M + RRF + MiniLM L-6) vs lexical MRR@5 / NDCG@5 + code_related
 *
 * Allocates all fixtures and SQLite databases strictly inside os.tmpdir() and
 * tears them down in finally + SIGINT/SIGTERM handlers.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const benchTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-bench-code-intel-'));
process.env.HOME = benchTmp;
process.env.USERPROFILE = benchTmp;
process.env.KONOHA_HOME = path.join(benchTmp, '.konoha');
process.env.KONOHA_DB_PATH = path.join(benchTmp, 'bench.db');
process.env.KONOHA_TEST_SANDBOX = '1';

const db = require('../src/db');
const walker = require('../src/code_intel/walker');
const parser = require('../src/code_intel/parser');
const parserWasm = require('../src/code_intel/parser_wasm');
const { indexRepositoryAsync } = require('../src/code_intel/indexer');
const query = require('../src/code_intel/query');
const vectorPipeline = require('../src/vector_pipeline');

let activeConn = null;
let cleaned = false;

function cleanupBench() {
  if (cleaned) return;
  cleaned = true;
  try {
    if (activeConn) activeConn.close();
  } catch (_) {
    /* ignore close error */
  }
  try {
    fs.rmSync(benchTmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch (err) {
    console.warn(`[BENCH CLEANUP WARN] ${benchTmp}: ${err.message}`);
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    cleanupBench();
    process.exit(sig === 'SIGINT' ? 130 : 143);
  });
}

function percentile(sortedNums, p) {
  if (!sortedNums.length) return 0;
  const idx = Math.min(sortedNums.length - 1, Math.max(0, Math.ceil((p / 100) * sortedNums.length) - 1));
  return Number(sortedNums[idx].toFixed(3));
}

function buildSyntheticRepo(rootDir, count = 3000) {
  const _jsModule = (header, bodyLines) => `${header}\n${bodyLines.join('\n')}\n`;
  const scenarios = [
    ['src/security/hmac_signature_verifier.js', _jsModule("'use strict';", [
      'const crypto = require("node:crypto");',
      'function validateWebhookDigest(secretKey, rawPayload, incomingTag) {',
      '  const mac = crypto.createHmac("sha256", secretKey).update(rawPayload).digest("hex");',
      '  return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(incomingTag));',
      '}',
      'module.exports = { validateWebhookDigest };'
    ])],
    ['src/security/webhook_caller.js', _jsModule("'use strict';", [
      'const { validateWebhookDigest } = require("./hmac_signature_verifier");',
      'function acceptSignedHook(req) {',
      '  return validateWebhookDigest(req.secret, req.body, req.signature);',
      '}',
      'module.exports = { acceptSignedHook };'
    ])],
    ['src/storage/wal_checkpoint_flusher.js', _jsModule("'use strict';", [
      'function flushSqliteJournalFrames(conn) {',
      '  return conn.exec("PRAGMA wal_checkpoint(TRUNCATE);");',
      '}',
      'module.exports = { flushSqliteJournalFrames };'
    ])],
    ['src/auth/jwt_key_rotator.py', [
      'def cycle_asymmetric_signing_keys(keyring, active_kid):',
      '    """Publish next public JWKS key and retire expired certificates."""',
      '    return [k for k in keyring if k.id != active_kid]'
    ].join('\n')]
  ];

  for (const [file, code] of scenarios) {
    const dest = path.join(rootDir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, code, 'utf8');
  }

  for (let i = scenarios.length; i < count; i++) {
    const bucket = `pkg_${String(i % 30).padStart(2, '0')}`;
    const isPy = i % 5 === 0;
    const ext = isPy ? 'py' : 'js';
    const rel = path.join('src', bucket, `module_${i}.${ext}`);
    const full = path.join(rootDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const body = isPy
      ? `def handle_record_${i}(item_id: int) -> dict:\n    return {"id": item_id, "bucket": "${bucket}"}\n`
      : `function processTask${i}(payload) {\n  return { ok: true, id: payload && payload.id, idx: ${i} };\n}\nmodule.exports = { processTask${i} };\n`;
    fs.writeFileSync(full, body, 'utf8');
  }
}

function computeMrrAndNdcg(hits, targetRelPath, k = 5) {
  const top = hits.slice(0, k);
  const rankIdx = top.findIndex((h) => h.relPath === targetRelPath);
  if (rankIdx === -1) return { rr: 0, ndcg: 0 };
  const rank = rankIdx + 1;
  return {
    rr: 1 / rank,
    ndcg: 1 / Math.log2(rank + 1)
  };
}

async function main() {
  const repoDir = path.join(benchTmp, 'synthetic_repo');
  const FILE_COUNT = Number(process.env.KONOHA_BENCH_FILES) || 3000;
  buildSyntheticRepo(repoDir, FILE_COUNT);

  const conn = db.getConnection();
  activeConn = conn;
  db.setupSchema(conn);

  // Stage A: File walk + strict SHA-256 hashing
  const walkStart = performance.now();
  const walked = walker.walk(repoDir, { maxFiles: FILE_COUNT + 500 });
  const hashTimes = [];
  let totalBytes = 0;
  for (const entry of walked.files) {
    const t0 = performance.now();
    const buf = fs.readFileSync(entry.absPath);
    crypto.createHash('sha256').update(buf).digest('hex');
    totalBytes += buf.length;
    hashTimes.push(performance.now() - t0);
  }
  const walkTotalMs = performance.now() - walkStart;
  hashTimes.sort((a, b) => a - b);

  // Stage B: WASM AST parse + chunking sample (200 files across JS/Py)
  const sampleFiles = walked.files.slice(0, 200);
  const parseTimes = [];
  let totalSymbols = 0;
  let totalChunks = 0;
  for (const entry of sampleFiles) {
    const src = fs.readFileSync(entry.absPath, 'utf8');
    const t0 = performance.now();
    const parsed = await parserWasm.parseFileAsync(src, entry.language, entry.relPath);
    const chunks = parser.buildChunks(src, parsed.symbols || []);
    parseTimes.push(performance.now() - t0);
    totalSymbols += (parsed.symbols || []).length;
    totalChunks += chunks.length;
  }
  parseTimes.sort((a, b) => a - b);

  // Stage C: Index + Incremental + Selective Re-index
  const embedAvailable = vectorPipeline.getRuntimeStatus().available;
  let semanticMode = embedAvailable;
  let coldIdx;
  try {
    coldIdx = await indexRepositoryAsync({ rootPath: repoDir, conn, verify: 'strict', embed: semanticMode });
  } catch (err) {
    if (err instanceof vectorPipeline.EmbeddingRuntimeUnavailableError) {
      semanticMode = false;
      coldIdx = await indexRepositoryAsync({ rootPath: repoDir, conn, verify: 'strict', embed: false });
    } else {
      throw err;
    }
  }

  const noopIdx = await indexRepositoryAsync({ rootPath: repoDir, conn, verify: 'strict', embed: semanticMode });

  const editedFile = path.join(repoDir, 'src/security/hmac_signature_verifier.js');
  fs.appendFileSync(editedFile, '\n// incremental benchmark update\n', 'utf8');
  const incrIdx = await indexRepositoryAsync({ rootPath: repoDir, conn, verify: 'strict', embed: semanticMode });

  // Stage D: Query comparison (lexical-only vs hybrid+rerank) + code_related
  const evalQueries = [
    { q: 'cryptographic message authentication digest verification', target: 'src/security/hmac_signature_verifier.js' },
    { q: 'persist sqlite write ahead journal pages cleanly', target: 'src/storage/wal_checkpoint_flusher.js' },
    { q: 'rotate public jwks asymmetric credentials', target: 'src/auth/jwt_key_rotator.py' }
  ];

  const lexLat = [];
  const hybLat = [];
  const relLat = [];
  let lexRrSum = 0;
  let lexNdcgSum = 0;
  let hybRrSum = 0;
  let hybNdcgSum = 0;

  for (const item of evalQueries) {
    const tLex = performance.now();
    const lexRes = query.search({ query: item.q, conn, rootPath: repoDir, limit: 5, semantic: false, rerank: false });
    lexLat.push(performance.now() - tLex);
    const lm = computeMrrAndNdcg(lexRes.hits, item.target, 5);
    lexRrSum += lm.rr;
    lexNdcgSum += lm.ndcg;

    const tHyb = performance.now();
    const hybRes = await query.searchAsync({
      query: item.q,
      conn,
      rootPath: repoDir,
      limit: 5,
      semantic: semanticMode,
      rerank: semanticMode
    });
    hybLat.push(performance.now() - tHyb);
    const hm = computeMrrAndNdcg(hybRes.hits, item.target, 5);
    hybRrSum += hm.rr;
    hybNdcgSum += hm.ndcg;

    const tRel = performance.now();
    await query.relatedAsync({
      conn,
      rootPath: repoDir,
      relPath: 'src/security/webhook_caller.js',
      limit: 5,
      semantic: semanticMode,
      rerank: semanticMode
    });
    relLat.push(performance.now() - tRel);
  }

  lexLat.sort((a, b) => a - b);
  hybLat.sort((a, b) => a - b);
  relLat.sort((a, b) => a - b);

  const report = {
    hardware: {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      cpus: os.cpus().length
    },
    synthetic_files: walked.files.length,
    total_mb: Number((totalBytes / (1024 * 1024)).toFixed(2)),
    stage_a_walk_sha256: {
      total_ms: Number(walkTotalMs.toFixed(1)),
      per_file_p50_ms: percentile(hashTimes, 50),
      per_file_p95_ms: percentile(hashTimes, 95)
    },
    stage_b_wasm_parse_sample200: {
      symbols: totalSymbols,
      chunks: totalChunks,
      per_file_p50_ms: percentile(parseTimes, 50),
      per_file_p95_ms: percentile(parseTimes, 95)
    },
    stage_c_indexing: {
      semantic_active: semanticMode,
      cold_ms: coldIdx.durationMs,
      cold_files: coldIdx.indexed,
      cold_embedded_chunks: coldIdx.embeddedChunks,
      noop_ms: noopIdx.durationMs,
      noop_skipped_unchanged: noopIdx.skippedUnchanged,
      incremental_ms: incrIdx.durationMs,
      incremental_reindexed: incrIdx.indexed
    },
    stage_d_retrieval: {
      lexical_mrr_at_5: Number((lexRrSum / evalQueries.length).toFixed(3)),
      lexical_ndcg_at_5: Number((lexNdcgSum / evalQueries.length).toFixed(3)),
      lexical_p50_ms: percentile(lexLat, 50),
      lexical_p95_ms: percentile(lexLat, 95),
      hybrid_mrr_at_5: Number((hybRrSum / evalQueries.length).toFixed(3)),
      hybrid_ndcg_at_5: Number((hybNdcgSum / evalQueries.length).toFixed(3)),
      hybrid_p50_ms: percentile(hybLat, 50),
      hybrid_p95_ms: percentile(hybLat, 95),
      related_p50_ms: percentile(relLat, 50),
      related_p95_ms: percentile(relLat, 95)
    }
  };

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error(`[BENCH ERROR] ${err.message}`);
    process.exitCode = 1;
  })
  .finally(cleanupBench);
