'use strict';

/**
 * First-use indexing for code-intel queries.
 *
 * `code_search` against a real directory that was never indexed used to dead-end
 * with `root not indexed`, forcing the caller to guess that `code_index` runs
 * first. A query that names an existing directory is a request to answer from
 * it, so index it once and answer.
 *
 * Two entry points, because they carry different obligations: the sync one
 * blocks the caller (CLI, sync tool dispatch) and the async one yields the
 * event loop so `tools/list` still answers during a first-use index.
 */

const fs = require('node:fs');
const store = require('./store');

// ponytail: cap the first-use pass so a query cannot stall on a 20k-file tree.
// Raise it, or raise `timeoutMs`, once a caller needs a large root inline.
const AUTO_INDEX_MAX_FILES = 5000;
const AUTO_INDEX_TIMEOUT_MS = 15000;

function _shouldIndex(rootPath) {
  if (!rootPath) return false;
  let stat = null;
  try {
    stat = fs.statSync(rootPath);
  } catch (_) {
    return false;
  }
  return stat.isDirectory();
}

function _indexOptions(rootPath, conn, timeoutMs) {
  return {
    rootPath,
    conn,
    force: false,
    verify: 'fast_stat',
    fast_stat: true,
    // A query must not pay a model load. The lexical index is complete; an
    // explicit `code_index` call adds vectors later.
    embed: false,
    maxFiles: AUTO_INDEX_MAX_FILES,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : AUTO_INDEX_TIMEOUT_MS
  };
}

function _indexer() {
  try {
    return require('./indexer');
  } catch (_) {
    return null;
  }
}

/**
 * Return the root row for `rootPath`, indexing it first when the directory
 * exists but has no row. Returns null when the path is missing, not a
 * directory, or cannot be indexed — callers then emit their own error.
 */
function ensureRootIndexed(conn, rootPath, timeoutMs) {
  if (!rootPath) return null;
  const existing = store.getRoot(conn, rootPath);
  if (existing) return existing;
  if (!_shouldIndex(rootPath)) return null;
  const indexer = _indexer();
  if (!indexer) return null;
  try {
    indexer.indexRepository(_indexOptions(rootPath, conn, timeoutMs));
  } catch (_) {
    return null;
  }
  return store.getRoot(conn, rootPath);
}

/** Async twin of `ensureRootIndexed`: yields so other tools stay responsive. */
async function ensureRootIndexedAsync(conn, rootPath, timeoutMs) {
  if (!rootPath) return null;
  const existing = store.getRoot(conn, rootPath);
  if (existing) return existing;
  if (!_shouldIndex(rootPath)) return null;
  const indexer = _indexer();
  if (!indexer) return null;
  try {
    await indexer.indexRepositoryAsync(_indexOptions(rootPath, conn, timeoutMs));
  } catch (_) {
    return null;
  }
  return store.getRoot(conn, rootPath);
}

/** Actionable replacement for a bare `root not indexed: <path>`. */
function describeMissingRoot(conn, rootPath) {
  const base = `root not indexed: ${rootPath}`;
  let roots = [];
  try {
    roots = store.listRoots(conn).map((r) => r.root_path).filter(Boolean);
  } catch (_) {
    return base;
  }
  if (roots.length === 0) return base;
  const shown = roots.slice(0, 3).join(', ');
  const more = roots.length > 3 ? `, +${roots.length - 3} more` : '';
  return `${base} (indexed roots: ${shown}${more})`;
}

module.exports = {
  AUTO_INDEX_MAX_FILES,
  AUTO_INDEX_TIMEOUT_MS,
  ensureRootIndexed,
  ensureRootIndexedAsync,
  describeMissingRoot
};
