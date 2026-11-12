'use strict';

/**
 * Indexer: walks a repository, parses it, and writes the index.
 *
 * Incremental by content hash — a file whose hash matches the stored row is
 * skipped, so re-indexing a large repo after one edit is proportional to the
 * edit, not the repo.
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
const { parseFile, buildChunks } = require('./parser');
const { walk } = require('./walker');
const store = require('./store');

const CHUNK_LIMITS = { CHUNK_MAX_LINES, CHUNK_MAX_CHARS, CHUNK_OVERLAP_LINES };

/**
 * Indexes `rootPath` into the main store.
 *
 * @param {object} options
 * @param {string} options.rootPath absolute path of the repository
 * @param {object} [options.conn] open connection; defaults to the main DB
 * @param {boolean} [options.force] re-parse files whose content hash is unchanged
 * @param {(msg: string) => void} [options.onProgress]
 */
function _readSource(file, stats) {
  try {
    return fs.readFileSync(file.absPath, 'utf8');
  } catch (err) {
    stats.errors += 1;
    stats.skipped.push({ relPath: file.relPath, reason: `read failed: ${err.code || err.message}` });
    return null;
  }
}

function _parseSource(source, file, stats) {
  try {
    return parseFile(source, file.language);
  } catch (err) {
    stats.errors += 1;
    stats.skipped.push({ relPath: file.relPath, reason: `parse failed: ${err.message}` });
    return null;
  }
}

/** Indexes one file. Returns true when the file was written to the index. */
function _indexFile(conn, rootHash, file, options, stats) {
  const source = _readSource(file, stats);
  if (source === null) return false;

  const hash = store.contentHash(source);
  const existing = store.getFileRecord(conn, rootHash, file.relPath);
  if (!options.force && existing && existing.content_hash === hash) {
    stats.skippedUnchanged += 1;
    return false;
  }

  const parsed = _parseSource(source, file, stats);
  if (!parsed) return false;

  const chunks = buildChunks(source, parsed.symbols, CHUNK_LIMITS);
  try {
    store.writeFile(conn, rootHash, {
      relPath: file.relPath,
      language: file.language,
      byteSize: file.byteSize,
      lineCount: source.split('\n').length,
      contentHash: hash
    }, parsed, chunks);
  } catch (err) {
    stats.errors += 1;
    stats.skipped.push({ relPath: file.relPath, reason: `write failed: ${err.message}` });
    return false;
  }

  stats.indexed += 1;
  stats.symbols += parsed.symbols.length;
  stats.chunks += chunks.length;
  if (typeof options.onProgress === 'function') options.onProgress(`indexed ${file.relPath}`);
  return true;
}

/** Deletes rows for files that no longer exist under the root. */
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

/**
 * Indexes `rootPath` into the main store.
 *
 * @param {object} options
 * @param {string} options.rootPath absolute path of the repository
 * @param {object} [options.conn] open connection; defaults to the main DB
 * @param {boolean} [options.force] re-parse files whose content hash is unchanged
 * @param {(msg: string) => void} [options.onProgress]
 */
function indexRepository(options = {}) {
  const rootPath = options.rootPath;
  if (!rootPath) throw new Error('code_intel: rootPath is required');
  const absRoot = path.resolve(rootPath);
  if (!fs.existsSync(absRoot) || !fs.statSync(absRoot).isDirectory()) {
    throw new Error(`code_intel: not a directory: ${absRoot}`);
  }

  const conn = options.conn || store.openConnection();
  const rootHash = store.ensureRoot(conn, absRoot);
  store.markRootStatus(conn, rootHash, 'indexing', '');

  const started = Date.now();
  const { files, skipped } = walk(absRoot, {
    maxFiles: options.maxFiles || MAX_FILES_PER_ROOT,
    maxFileBytes: options.maxFileBytes || MAX_FILE_BYTES
  });
  const stats = { indexed: 0, skippedUnchanged: 0, errors: 0, symbols: 0, chunks: 0, skipped };

  try {
    for (const file of files) _indexFile(conn, rootHash, file, options, stats);
    const removed = _pruneVanished(conn, rootHash, files);
    const counts = store.finalizeRoot(conn, rootHash);
    return {
      rootHash,
      rootPath: absRoot,
      status: 'fresh',
      files: counts.files,
      symbols: counts.symbols,
      chunks: counts.chunks,
      indexed: stats.indexed,
      removed,
      skippedUnchanged: stats.skippedUnchanged,
      errors: stats.errors,
      skipped: stats.skipped,
      durationMs: Date.now() - started
    };
  } catch (err) {
    store.markRootStatus(conn, rootHash, 'failed', err.message);
    throw err;
  }
}

module.exports = { indexRepository };
