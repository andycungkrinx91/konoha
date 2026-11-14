'use strict';

/**
 * Code Intelligence Indexer (Sync & Async WASM AST).
 *
 * Incremental correctness defaults to `verify: 'strict'` (SHA-256 over raw bytes
 * paired with `parser_version`), guaranteeing same-size edits with restored `mtime`
 * never silently skip re-indexing. `fast_stat: true` is strictly opt-in.
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
const { walk } = require('./walker');
const store = require('./store');
const {
  EMBED_MODEL_REPO,
  isSemanticSearchEnabled,
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

function _canSkipByFastStat(existing, file, expectedParserVer, options) {
  const fastOptIn = options.fast_stat === true || options.verify === 'fast_stat';
  if (!fastOptIn || options.force || !existing) return false;
  if (process.platform === 'win32') return false;
  if (existing.parser_version !== expectedParserVer) return false;
  if (existing.byte_size !== file.byteSize) return false;
  if (String(existing.inode_id) !== String(file.inodeId)) return false;
  if (Math.abs((existing.mtime_ms || 0) - (file.mtimeMs || 0)) >= 0.001) return false;
  if (Math.abs((existing.ctime_ms || 0) - (file.ctimeMs || 0)) >= 0.001) return false;
  return true;
}

function _readFileBytes(file, stats) {
  try {
    return fs.readFileSync(file.absPath);
  } catch (err) {
    stats.errors += 1;
    stats.skipped.push({ relPath: file.relPath, reason: `read failed: ${err.code || err.message}` });
    return null;
  }
}

function _persistParsedFile(params) {
  const { conn, rootHash, file, source, hash, parsed, parserVersion, stats, options } = params;
  const chunks = buildChunks(source, parsed.symbols, CHUNK_LIMITS);
  try {
    const fileId = store.writeFile(conn, rootHash, {
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
    }, parsed, chunks);
    stats.indexed += 1;
    stats.symbols += parsed.symbols.length;
    stats.chunks += chunks.length;
    stats.updatedFileIds.push(fileId);
    if (typeof options.onProgress === 'function') options.onProgress(`indexed ${file.relPath}`);
    return true;
  } catch (err) {
    stats.errors += 1;
    stats.skipped.push({ relPath: file.relPath, reason: `write failed: ${err.message}` });
    return false;
  }
}

function _indexFileSync(conn, rootHash, file, options, stats) {
  const existing = store.getFileRecord(conn, rootHash, file.relPath);
  if (_canSkipByFastStat(existing, file, FALLBACK_PARSER_VERSION, options)) {
    stats.skippedUnchanged += 1;
    return false;
  }

  const rawBuf = _readFileBytes(file, stats);
  if (rawBuf === null) return false;

  const hash = store.contentHash(rawBuf);
  if (!options.force && existing && existing.content_hash === hash && existing.parser_version === FALLBACK_PARSER_VERSION) {
    store.touchFileStats(conn, existing.id, file);
    stats.skippedUnchanged += 1;
    return false;
  }

  const source = rawBuf.toString('utf8');
  let parsed;
  try {
    parsed = parseFile(source, file.language);
  } catch (err) {
    stats.errors += 1;
    stats.skipped.push({ relPath: file.relPath, reason: `parse failed: ${err.message}` });
    return false;
  }

  return _persistParsedFile({
    conn,
    rootHash,
    file,
    source,
    hash,
    parsed,
    parserVersion: FALLBACK_PARSER_VERSION,
    stats,
    options
  });
}

async function _indexFileAsync(conn, rootHash, file, options, stats) {
  const expectedVer = _expectedParserVersion(file.language, file.relPath, true);
  const existing = store.getFileRecord(conn, rootHash, file.relPath);
  if (_canSkipByFastStat(existing, file, expectedVer, options)) {
    stats.skippedUnchanged += 1;
    return false;
  }

  const rawBuf = _readFileBytes(file, stats);
  if (rawBuf === null) return false;

  const hash = store.contentHash(rawBuf);
  if (!options.force && existing && existing.content_hash === hash && existing.parser_version === expectedVer) {
    store.touchFileStats(conn, existing.id, file);
    stats.skippedUnchanged += 1;
    return false;
  }

  const source = rawBuf.toString('utf8');
  let parsed;
  try {
    parsed = await parseFileAsync(source, file.language, file.relPath);
  } catch (err) {
    stats.errors += 1;
    stats.skipped.push({ relPath: file.relPath, reason: `parse failed: ${err.message}` });
    return false;
  }

  return _persistParsedFile({
    conn,
    rootHash,
    file,
    source,
    hash,
    parsed,
    parserVersion: parsed.parserVersion || expectedVer,
    stats,
    options
  });
}

function _pruneVanished(conn, rootHash, files) {
  const present = new Set(files.map((f) => f.relPath));
  const known = conn.prepare('SELECT id, rel_path FROM code_files WHERE root_hash = ?').all(rootHash);
  let removed = 0;
  for (const row of known) {
    if (present.has(row.rel_path)) continue;
    conn.prepare('DELETE FROM code_files WHERE id = ?').run(row.id);
    removed += 1;
  }
  return removed;
}

function _prepareIndexContext(options) {
  const rootPath = options.rootPath;
  if (!rootPath) throw new Error('code_intel: rootPath is required');
  const absRoot = path.resolve(rootPath);
  if (!fs.existsSync(absRoot) || !fs.statSync(absRoot).isDirectory()) {
    throw new Error(`code_intel: not a directory: ${absRoot}`);
  }
  const conn = options.conn || store.openConnection();
  const rootHash = store.ensureRoot(conn, absRoot);
  store.markRootStatus(conn, rootHash, 'indexing', '');
  const walkRes = walk(absRoot, {
    maxFiles: options.maxFiles || MAX_FILES_PER_ROOT,
    maxFileBytes: options.maxFileBytes || MAX_FILE_BYTES,
    respectGitignore: options.respectGitignore
  });
  const headSha = store.resolveGitHeadSha(absRoot);
  const verifyMode = (options.fast_stat === true || options.verify === 'fast_stat') ? 'fast_stat' : 'strict';
  const started = Date.now();
  const deadlineMs = options.timeoutMs > 0 ? started + options.timeoutMs : 0;
  const stats = { indexed: 0, skippedUnchanged: 0, errors: 0, symbols: 0, chunks: 0, skipped: walkRes.skipped, updatedFileIds: [] };
  return { absRoot, conn, rootHash, headSha, verifyMode, files: walkRes.files, started, deadlineMs, stats };
}

function _buildIndexResult(ctx, counts, removed, extra = {}) {
  return {
    rootHash: ctx.rootHash,
    rootPath: ctx.absRoot,
    headSha: counts.headSha,
    status: 'fresh',
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

function indexRepository(options = {}) {
  const ctx = _prepareIndexContext(options);
  try {
    for (const file of ctx.files) {
      _checkAbort(options.signal, ctx.deadlineMs);
      _indexFileSync(ctx.conn, ctx.rootHash, file, options, ctx.stats);
    }
    const removed = _pruneVanished(ctx.conn, ctx.rootHash, ctx.files);
    const counts = store.finalizeRoot(ctx.conn, ctx.rootHash, ctx.headSha);
    return _buildIndexResult(ctx, counts, removed);
  } catch (err) {
    store.markRootStatus(ctx.conn, ctx.rootHash, 'failed', err.message);
    throw err;
  }
}

async function _embedPendingChunks(ctx, options) {
  if (options.embed === false) {
    return { embeddedChunks: 0, embeddingModel: null, semanticSkipped: 'disabled_by_option' };
  }
  if (!isSemanticSearchEnabled()) {
    return { embeddedChunks: 0, embeddingModel: null, semanticSkipped: 'disabled_by_env' };
  }
  const modelRepo = options.embeddingModel || EMBED_MODEL_REPO;
  const pending = store.getUnembeddedChunks(ctx.conn, ctx.rootHash, modelRepo);
  if (pending.length === 0) {
    return { embeddedChunks: 0, embeddingModel: modelRepo };
  }
  const batchSize = Math.max(1, Number(options.embedBatchSize) || EMBED_BATCH_SIZE);
  let embeddedChunks = 0;
  for (let start = 0; start < pending.length; start += batchSize) {
    _checkAbort(options.signal, ctx.deadlineMs);
    const slice = pending.slice(start, start + batchSize);
    const texts = slice.map(_formatChunkForEmbed);
    const vectors = await embedBatch(texts, { modelRepo, batchSize });
    _checkAbort(options.signal, ctx.deadlineMs);
    const pairs = slice.map((chunk, idx) => ({ chunkId: chunk.id, vector: vectors[idx] }));
    embeddedChunks += store.writeChunkEmbeddingsById(ctx.conn, ctx.rootHash, modelRepo, pairs);
    if (typeof options.onProgress === 'function') {
      options.onProgress(`embedded ${embeddedChunks}/${pending.length} chunks`);
    }
  }
  return { embeddedChunks, embeddingModel: modelRepo };
}

async function indexRepositoryAsync(options = {}) {
  const ctx = _prepareIndexContext(options);
  try {
    for (const file of ctx.files) {
      _checkAbort(options.signal, ctx.deadlineMs);
      await _indexFileAsync(ctx.conn, ctx.rootHash, file, options, ctx.stats);
    }
    const removed = _pruneVanished(ctx.conn, ctx.rootHash, ctx.files);
    const edgesResolved = resolveEdgesForRoot(ctx.conn, ctx.rootHash, ctx.absRoot, ctx.stats.updatedFileIds);
    const embedStats = await _embedPendingChunks(ctx, options);
    const counts = store.finalizeRoot(ctx.conn, ctx.rootHash, ctx.headSha);
    return _buildIndexResult(ctx, counts, removed, { edgesResolved, ...embedStats });
  } catch (err) {
    store.markRootStatus(ctx.conn, ctx.rootHash, 'failed', err.message);
    throw err;
  }
}

module.exports = {
  indexRepository,
  indexRepositoryAsync
};
