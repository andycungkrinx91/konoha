'use strict';

/**
 * Code Intelligence Indexer (Sync & Async WASM AST).
 *
 * Incremental correctness defaults to `verify: 'strict'` (SHA-256 over raw bytes
 * paired with `parser_version`), guaranteeing same-size edits with restored `mtime`
 * never silently skip re-indexing. `fast_stat: true` is strictly opt-in.
 *
 * Uses two-phase indexing (read/parse/embed in memory, then single atomic SQLite
 * transaction commit) so `AbortSignal`, deadline timeouts, or mid-commit failures
 * roll back completely without partial file/FTS corruption.
 */

const fs = require('fs');
const path = require('path');
const {
  CHUNK_MAX_LINES,
  CHUNK_MAX_CHARS,
  CHUNK_OVERLAP_LINES,
  MAX_FILE_BYTES,
  MAX_FILES_PER_ROOT
} = require('./config');
const { FALLBACK_PARSER_VERSION, parseFile, buildChunks } = require('./parser');
const { GRAMMAR_BY_EXT, GRAMMAR_BY_LANG, getParserVersion, parseFileAsync } = require('./parser_wasm');
const { CHUNK_SCHEMA_VERSION } = require('./chunker');
const { resolveEdgesForRoot } = require('./graph_resolver');
const { walk, walkAsync } = require('./walker');
const store = require('./store');
const {
  EMBED_MODEL_REPO,
  isSemanticSearchEnabled,
  getRuntimeStatus,
  embedBatch
} = require('../vector_pipeline');

const CHUNK_LIMITS = { CHUNK_MAX_LINES, CHUNK_MAX_CHARS, CHUNK_OVERLAP_LINES };
const EMBED_BATCH_SIZE = 16;

function _formatChunkForEmbed(chunk) {
  const header = [chunk.rel_path, chunk.symbol_name].filter(Boolean).join(' | ');
  return header ? `[${header}]\n${chunk.body || ''}` : String(chunk.body || '');
}

function _checkAbort(signal, deadlineMs) {
  if (signal && signal.aborted) {
    const err = new Error('INDEX_ABORTED: cancelled via AbortSignal');
    err.code = 'ABORT_ERR';
    throw err;
  }
  if (deadlineMs > 0 && Date.now() > deadlineMs) {
    const err = new Error('INDEX_TIMEOUT: elapsed deadline reached during code indexing');
    err.code = 'ETIMEDOUT';
    throw err;
  }
}

function _expectedParserVersion(language, relPath, useWasm) {
  if (!useWasm) return FALLBACK_PARSER_VERSION;
  if (language === 'markdown') return `structured-md-v1-${CHUNK_SCHEMA_VERSION}`;
  if (language === 'json' || language === 'yaml' || language === 'toml') {
    return `structured-cfg-v1-${CHUNK_SCHEMA_VERSION}`;
  }
  const ext = relPath ? path.extname(relPath).toLowerCase() : '';
  if ((ext && Object.hasOwn(GRAMMAR_BY_EXT, ext)) || Object.hasOwn(GRAMMAR_BY_LANG, language)) {
    return getParserVersion();
  }
  return FALLBACK_PARSER_VERSION;
}

function _hasStatDrift(existing, file) {
  if (!existing) return true;
  if (String(existing.inode_id || '') !== String(file.inodeId || '')) return true;
  if ((existing.content_kind || 'code') !== (file.contentKind || 'code')) return true;
  if (Math.abs((existing.mtime_ms || 0) - (file.mtimeMs || 0)) >= 0.001) return true;
  if (Math.abs((existing.ctime_ms || 0) - (file.ctimeMs || 0)) >= 0.001) return true;
  return false;
}

function _isParserVersionCompatible(existing, file, requireWasm) {
  if (!existing) return false;
  const wasmVer = _expectedParserVersion(file.language, file.relPath, true);
  if (requireWasm) return existing.parser_version === wasmVer;
  // Sync fallback runs during retrieval must never downgrade current WASM/structured rows.
  return existing.parser_version === FALLBACK_PARSER_VERSION || existing.parser_version === wasmVer;
}

function _canSkipByFastStat(existing, file, versionCompatible, options) {
  const fastOptIn = options.fast_stat === true || options.verify === 'fast_stat';
  if (!fastOptIn || options.force || !existing) return false;
  if (process.platform === 'win32') return false;
  if (!versionCompatible) return false;
  if (existing.byte_size !== file.byteSize) return false;
  return !_hasStatDrift(existing, file);
}

function _yieldEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

function _recordFileReadError(err, file, stats, scanTracker) {
  const code = err && err.code;
  if (code === 'ENOENT') {
    stats.skipped.push({ relPath: file.relPath, reason: 'transient vanished: ENOENT' });
    scanTracker.transientVanished.add(file.relPath);
    return null;
  }
  stats.errors += 1;
  if (code === 'EACCES' || code === 'EPERM') {
    stats.skipped.push({ relPath: file.relPath, reason: `unreadable file: ${code}` });
  } else {
    stats.skipped.push({ relPath: file.relPath, reason: `read failed: ${code || err.message}` });
  }
  scanTracker.unreadableFiles.add(file.relPath);
  return null;
}

function _readFileBytes(file, stats, scanTracker) {
  try {
    return fs.readFileSync(file.absPath);
  } catch (err) {
    return _recordFileReadError(err, file, stats, scanTracker);
  }
}

async function _readFileBytesAsync(file, stats, scanTracker) {
  try {
    return await fs.promises.readFile(file.absPath);
  } catch (err) {
    return _recordFileReadError(err, file, stats, scanTracker);
  }
}

function _buildPreparedWriteOp({ existing, file, source, hash, parsed, parserVersion, options }) {
  const chunks = buildChunks(source, parsed.symbols, CHUNK_LIMITS);
  return {
    kind: 'write',
    existingId: existing ? existing.id : null,
    file,
    meta: {
      relPath: file.relPath,
      language: file.language,
      byteSize: file.byteSize,
      lineCount: source.split('\n').length,
      contentHash: hash,
      mtimeMs: file.mtimeMs,
      ctimeMs: file.ctimeMs,
      inodeId: file.inodeId,
      parserVersion,
      contentKind: file.contentKind,
      preferredEmbeddingModel: options.embeddingModel || EMBED_MODEL_REPO
    },
    parsed,
    chunks
  };
}

function _prepareFileOpSync({ conn, rootHash, file, options, stats, scanTracker }) {
  const existing = store.getFileRecord(conn, rootHash, file.relPath);
  const versionOk = _isParserVersionCompatible(existing, file, false);
  if (_canSkipByFastStat(existing, file, versionOk, options)) {
    stats.skippedUnchanged += 1;
    return null;
  }

  const rawBuf = _readFileBytes(file, stats, scanTracker);
  if (rawBuf === null) return null;

  const hash = store.contentHash(rawBuf);
  if (!options.force && existing && existing.content_hash === hash && versionOk) {
    if (_hasStatDrift(existing, file)) {
      return { kind: 'touch', existingId: existing.id, file };
    }
    stats.skippedUnchanged += 1;
    return null;
  }

  const source = rawBuf.toString('utf8');
  let parsed;
  try {
    parsed = parseFile(source, file.language);
  } catch (err) {
    stats.errors += 1;
    stats.skipped.push({ relPath: file.relPath, reason: `parse failed: ${err.message}` });
    return null;
  }

  return _buildPreparedWriteOp({
    existing,
    file,
    source,
    hash,
    parsed,
    parserVersion: FALLBACK_PARSER_VERSION,
    options
  });
}

async function _prepareFileOpAsync({ conn, rootHash, file, options, stats, scanTracker }) {
  const expectedVer = _expectedParserVersion(file.language, file.relPath, true);
  const existing = store.getFileRecord(conn, rootHash, file.relPath);
  const versionOk = _isParserVersionCompatible(existing, file, true);
  if (_canSkipByFastStat(existing, file, versionOk, options)) {
    stats.skippedUnchanged += 1;
    return null;
  }

  const rawBuf = await _readFileBytesAsync(file, stats, scanTracker);
  if (rawBuf === null) return null;

  const hash = store.contentHash(rawBuf);
  if (!options.force && existing && existing.content_hash === hash && versionOk) {
    if (_hasStatDrift(existing, file)) {
      return { kind: 'touch', existingId: existing.id, file };
    }
    stats.skippedUnchanged += 1;
    return null;
  }

  const source = rawBuf.toString('utf8');
  let parsed;
  try {
    parsed = await parseFileAsync(source, file.language, file.relPath);
  } catch (err) {
    stats.errors += 1;
    stats.skipped.push({ relPath: file.relPath, reason: `parse failed: ${err.message}` });
    return null;
  }

  return _buildPreparedWriteOp({
    existing,
    file,
    source,
    hash,
    parsed,
    parserVersion: parsed.parserVersion || expectedVer,
    options
  });
}

function _analyzeWalkCompleteness(walkSkipped = [], tracker = null) {
  let capReached = false;
  const unreadableDirs = [];
  const unreadableFiles = [];
  const seenFiles = new Set();

  for (const s of walkSkipped) {
    if (!s || typeof s.reason !== 'string') continue;
    if (s.reason.startsWith('file cap reached')) {
      capReached = true;
    } else if (s.reason.startsWith('unreadable directory:')) {
      unreadableDirs.push(String(s.relPath || '.').replace(/\\/g, '/'));
    } else if (s.reason.startsWith('unreadable file:') || s.reason.startsWith('read failed:')) {
      const rp = String(s.relPath || '').replace(/\\/g, '/');
      if (rp && !seenFiles.has(rp)) {
        seenFiles.add(rp);
        unreadableFiles.push(rp);
      }
    }
  }

  if (tracker && tracker.unreadableFiles) {
    for (const rp of tracker.unreadableFiles) {
      const norm = String(rp || '').replace(/\\/g, '/');
      if (norm && !seenFiles.has(norm)) {
        seenFiles.add(norm);
        unreadableFiles.push(norm);
      }
    }
  }

  const incomplete = capReached || unreadableDirs.length > 0 || unreadableFiles.length > 0;
  const parts = [];
  if (capReached) parts.push('file cap reached during walk');
  if (unreadableDirs.length > 0) parts.push(`unreadable directories skipped: ${unreadableDirs.slice(0, 5).join(', ')}`);
  if (unreadableFiles.length > 0) parts.push(`unreadable files skipped: ${unreadableFiles.slice(0, 5).join(', ')}`);

  return {
    capReached,
    unreadableDirs,
    unreadableFiles,
    transientVanished: tracker ? tracker.transientVanished : new Set(),
    incomplete,
    reason: parts.join('; ')
  };
}

function _isUnderSkippedDir(relPath, prefixes) {
  for (const dir of prefixes) {
    if (relPath === dir || relPath.startsWith(`${dir}/`)) return true;
  }
  return false;
}

function _pruneVanished(conn, rootHash, files, scanInfo = {}) {
  const unreadable = Array.isArray(scanInfo.unreadableDirs) ? scanInfo.unreadableDirs : [];
  if (scanInfo.capReached || unreadable.includes('.')) {
    return 0;
  }
  const transientVanished = scanInfo.transientVanished || new Set();
  const present = new Set(
    files.filter((f) => !transientVanished.has(f.relPath)).map((f) => f.relPath)
  );
  const unreadableFiles = new Set(Array.isArray(scanInfo.unreadableFiles) ? scanInfo.unreadableFiles : []);
  const skipPrefixes = unreadable.filter((d) => d && d !== '.').map((d) => d.replace(/\/+$/, ''));
  const known = conn.prepare('SELECT id, rel_path FROM code_files WHERE root_hash = ?').all(rootHash);
  let removed = 0;
  for (const row of known) {
    if (present.has(row.rel_path) || unreadableFiles.has(row.rel_path)) continue;
    if (skipPrefixes.length > 0 && _isUnderSkippedDir(row.rel_path, skipPrefixes)) continue;
    conn.prepare('DELETE FROM code_files WHERE id = ?').run(row.id);
    removed += 1;
  }
  return removed;
}

function _initContextBase(options) {
  const rootPath = options.rootPath;
  if (!rootPath) throw new Error('code_intel: rootPath is required');
  const absRoot = path.resolve(rootPath);
  if (!fs.existsSync(absRoot) || !fs.statSync(absRoot).isDirectory()) {
    throw new Error(`code_intel: not a directory: ${absRoot}`);
  }
  const conn = options.conn || store.openConnection();
  const rootHash = store.ensureRoot(conn, absRoot);
  store.markRootStatus(conn, rootHash, 'indexing', '');
  return { absRoot, conn, rootHash };
}

function _buildContextState(base, walkRes, options) {
  const headSha = store.resolveGitHeadSha(base.absRoot);
  const verifyMode = (options.fast_stat === true || options.verify === 'fast_stat') ? 'fast_stat' : 'strict';
  const started = Date.now();
  const deadlineMs = options.timeoutMs > 0 ? started + options.timeoutMs : 0;
  const walkSkipped = Array.isArray(walkRes.skipped) ? walkRes.skipped : [];
  const scanTracker = {
    unreadableFiles: new Set(),
    transientVanished: new Set()
  };
  const stats = { indexed: 0, skippedUnchanged: 0, errors: 0, symbols: 0, chunks: 0, skipped: [...walkSkipped], updatedFileIds: [] };
  return { ...base, headSha, verifyMode, files: walkRes.files, walkSkipped, started, deadlineMs, stats, scanTracker };
}

function _prepareIndexContext(options) {
  const base = _initContextBase(options);
  const walkRes = walk(base.absRoot, {
    maxFiles: options.maxFiles || MAX_FILES_PER_ROOT,
    maxFileBytes: options.maxFileBytes || MAX_FILE_BYTES,
    respectGitignore: options.respectGitignore
  });
  return _buildContextState(base, walkRes, options);
}

async function _prepareIndexContextAsync(options) {
  const base = _initContextBase(options);
  await _yieldEventLoop();
  const walkRes = await walkAsync(base.absRoot, {
    maxFiles: options.maxFiles || MAX_FILES_PER_ROOT,
    maxFileBytes: options.maxFileBytes || MAX_FILE_BYTES,
    respectGitignore: options.respectGitignore
  });
  return _buildContextState(base, walkRes, options);
}

function _buildIndexResult(ctx, counts, removed, extra = {}) {
  const scanInfo = ctx.scanInfo || { incomplete: false, capReached: false, unreadableDirs: [], unreadableFiles: [] };
  return {
    rootHash: ctx.rootHash,
    rootPath: ctx.absRoot,
    headSha: counts.headSha,
    status: counts.status || (scanInfo.incomplete ? 'stale' : 'fresh'),
    incomplete: Boolean(scanInfo.incomplete),
    capReached: Boolean(scanInfo.capReached),
    unreadableDirs: scanInfo.unreadableDirs || [],
    unreadableFiles: scanInfo.unreadableFiles || [],
    verifyMode: ctx.verifyMode,
    files: counts.files,
    symbols: counts.symbols,
    chunks: counts.chunks,
    edges: counts.edges,
    ...extra,
    indexed: ctx.stats.indexed,
    removed,
    skippedUnchanged: ctx.stats.skippedUnchanged,
    errors: ctx.stats.errors,
    skipped: ctx.stats.skipped,
    durationMs: Date.now() - ctx.started
  };
}

function _commitIndexTransaction(ctx, ops, existingChunkEmbeddings, embedStats, options) {
  const scanInfo = _analyzeWalkCompleteness(ctx.walkSkipped, ctx.scanTracker);
  ctx.scanInfo = scanInfo;
  const tx = ctx.conn.transaction(() => {
    for (const op of ops) {
      _checkAbort(options.signal, ctx.deadlineMs);
      if (typeof options.beforeCommitFile === 'function') {
        options.beforeCommitFile(op);
      }
      if (op.kind === 'touch') {
        store.touchFileStats(ctx.conn, op.existingId, op.file);
        ctx.stats.skippedUnchanged += 1;
        continue;
      }
      const fileId = store.writeFile(ctx.conn, ctx.rootHash, op.meta, op.parsed, op.chunks);
      ctx.stats.indexed += 1;
      ctx.stats.symbols += op.parsed.symbols.length;
      ctx.stats.chunks += op.chunks.length;
      ctx.stats.updatedFileIds.push(fileId);
      if (typeof options.onProgress === 'function') options.onProgress(`indexed ${op.file.relPath}`);
    }

    _checkAbort(options.signal, ctx.deadlineMs);
    const removed = _pruneVanished(ctx.conn, ctx.rootHash, ctx.files, scanInfo);
    const hasGraphDelta = ctx.stats.updatedFileIds.length > 0 || removed > 0;
    const edgesResolved = hasGraphDelta
      ? resolveEdgesForRoot(ctx.conn, ctx.rootHash, ctx.absRoot, ctx.stats.updatedFileIds)
      : 0;
    const hasEmbeddingDelta = Boolean(existingChunkEmbeddings && existingChunkEmbeddings.length > 0 && embedStats && embedStats.embeddingModel);
    if (hasEmbeddingDelta) {
      store.writeChunkEmbeddingsById(ctx.conn, ctx.rootHash, embedStats.embeddingModel, existingChunkEmbeddings);
    }
    const finalizeOpts = scanInfo.incomplete ? { status: 'stale', error: scanInfo.reason } : { status: 'fresh' };
    const counts = store.finalizeRoot(ctx.conn, ctx.rootHash, ctx.headSha, finalizeOpts);
    return { counts, removed, edgesResolved, slabDirty: hasGraphDelta || hasEmbeddingDelta };
  });

  const committed = tx();
  if (committed.slabDirty) store.invalidateVectorSlab(ctx.rootHash);
  return committed;
}

function _reusableHashSet(conn, fileId, modelRepo) {
  if (!fileId) return new Set();
  const rows = conn.prepare(
    "SELECT content_hash FROM code_chunks WHERE file_id = ? AND embedding IS NOT NULL AND embedding_model = ? AND content_hash != ''"
  ).all(fileId, modelRepo);
  return new Set(rows.map((r) => r.content_hash));
}

async function _preparePendingEmbeddings(ctx, ops, options) {
  if (options.embed === false) {
    return { embedStats: { embeddedChunks: 0, embeddingModel: null, semanticSkipped: 'disabled_by_option', semantic_skipped: 'disabled_by_option' }, existingChunkEmbeddings: [] };
  }
  if (!isSemanticSearchEnabled()) {
    return { embedStats: { embeddedChunks: 0, embeddingModel: null, semanticSkipped: 'disabled_by_env', semantic_skipped: 'disabled_by_env' }, existingChunkEmbeddings: [] };
  }
  const runtime = getRuntimeStatus();
  if (!runtime.available) {
    const reason = runtime.reason || 'embedding runtime unavailable';
    return { embedStats: { embeddedChunks: 0, embeddingModel: null, semanticSkipped: reason, semantic_skipped: reason }, existingChunkEmbeddings: [] };
  }

  const modelRepo = options.embeddingModel || EMBED_MODEL_REPO;
  const overwrittenFileIds = new Set(ops.filter((op) => op.kind === 'write' && op.existingId).map((op) => op.existingId));
  const pendingExisting = store.getUnembeddedChunks(ctx.conn, ctx.rootHash, modelRepo)
    .filter((c) => !overwrittenFileIds.has(c.file_id));

  const workItems = [];
  for (const op of ops) {
    if (op.kind !== 'write') continue;
    const reusable = _reusableHashSet(ctx.conn, op.existingId, modelRepo);
    for (const chunk of op.chunks) {
      if (chunk.contentHash && reusable.has(chunk.contentHash)) continue;
      workItems.push({
        type: 'new',
        chunk,
        payload: { rel_path: op.file.relPath, symbol_name: chunk.symbolName || null, body: chunk.body }
      });
    }
  }
  for (const row of pendingExisting) {
    workItems.push({ type: 'existing', row, payload: row });
  }

  if (workItems.length === 0) {
    return { embedStats: { embeddedChunks: 0, embeddingModel: modelRepo }, existingChunkEmbeddings: [] };
  }

  const batchSize = Math.max(1, Number(options.embedBatchSize) || EMBED_BATCH_SIZE);
  const existingChunkEmbeddings = [];
  let embeddedChunks = 0;

  for (let start = 0; start < workItems.length; start += batchSize) {
    if (start > 0) await _yieldEventLoop();
    _checkAbort(options.signal, ctx.deadlineMs);
    const slice = workItems.slice(start, start + batchSize);
    const texts = slice.map((item) => _formatChunkForEmbed(item.payload));
    let vectors;
    try {
      vectors = await embedBatch(texts, { modelRepo, batchSize });
    } catch (err) {
      if (err && (err.code === 'ABORT_ERR' || err.code === 'ETIMEDOUT')) throw err;
      const reason = (err && err.message) || 'embedding runtime unavailable';
      return {
        embedStats: { embeddedChunks, embeddingModel: modelRepo, semanticSkipped: reason, semantic_skipped: reason },
        existingChunkEmbeddings
      };
    }
    _checkAbort(options.signal, ctx.deadlineMs);
    for (let idx = 0; idx < slice.length; idx++) {
      const item = slice[idx];
      if (item.type === 'new') {
        item.chunk.embedding = vectors[idx];
        item.chunk.embeddingModel = modelRepo;
      } else {
        existingChunkEmbeddings.push({ chunkId: item.row.id, vector: vectors[idx] });
      }
      embeddedChunks += 1;
    }
    if (typeof options.onProgress === 'function') {
      options.onProgress(`embedded ${embeddedChunks}/${workItems.length} chunks`);
    }
  }

  return { embedStats: { embeddedChunks, embeddingModel: modelRepo }, existingChunkEmbeddings };
}

function indexRepository(options = {}) {
  const ctx = _prepareIndexContext(options);
  try {
    const ops = [];
    for (const file of ctx.files) {
      _checkAbort(options.signal, ctx.deadlineMs);
      const op = _prepareFileOpSync({
        conn: ctx.conn,
        rootHash: ctx.rootHash,
        file,
        options,
        stats: ctx.stats,
        scanTracker: ctx.scanTracker
      });
      if (op) ops.push(op);
    }
    const { counts, removed, edgesResolved } = _commitIndexTransaction(ctx, ops, [], null, options);
    return _buildIndexResult(ctx, counts, removed, { edgesResolved });
  } catch (err) {
    store.invalidateVectorSlab(ctx.rootHash);
    store.markRootStatus(ctx.conn, ctx.rootHash, 'failed', err.message);
    throw err;
  }
}

async function indexRepositoryAsync(options = {}) {
  const ctx = await _prepareIndexContextAsync(options);
  try {
    const ops = [];
    let lastYieldAt = Date.now();
    for (let idx = 0; idx < ctx.files.length; idx++) {
      _checkAbort(options.signal, ctx.deadlineMs);
      const file = ctx.files[idx];
      const op = await _prepareFileOpAsync({
        conn: ctx.conn,
        rootHash: ctx.rootHash,
        file,
        options,
        stats: ctx.stats,
        scanTracker: ctx.scanTracker
      });
      if (op) ops.push(op);
      if (typeof options.onProgress === 'function' && (idx === 0 || (idx + 1) % 25 === 0 || idx + 1 === ctx.files.length)) {
        options.onProgress(`parsed ${idx + 1}/${ctx.files.length}`);
      }
      if ((idx + 1) % 4 === 0 || Date.now() - lastYieldAt >= 8) {
        await _yieldEventLoop();
        lastYieldAt = Date.now();
      }
    }
    let embedStats = { embeddedChunks: 0, embeddingModel: null };
    let existingChunkEmbeddings = [];
    try {
      const prep = await _preparePendingEmbeddings(ctx, ops, options);
      embedStats = prep.embedStats;
      existingChunkEmbeddings = prep.existingChunkEmbeddings;
    } catch (err) {
      if (err && (err.code === 'ABORT_ERR' || err.code === 'ETIMEDOUT')) throw err;
      const reason = (err && err.message) || 'embedding runtime unavailable';
      embedStats = { embeddedChunks: 0, embeddingModel: null, semanticSkipped: reason, semantic_skipped: reason };
    }
    await _yieldEventLoop();
    const { counts, removed, edgesResolved } = _commitIndexTransaction(
      ctx,
      ops,
      existingChunkEmbeddings,
      embedStats,
      options
    );
    return _buildIndexResult(ctx, counts, removed, { edgesResolved, ...embedStats });
  } catch (err) {
    store.invalidateVectorSlab(ctx.rootHash);
    store.markRootStatus(ctx.conn, ctx.rootHash, 'failed', err.message);
    throw err;
  }
}

module.exports = {
  indexRepository,
  indexRepositoryAsync
};
