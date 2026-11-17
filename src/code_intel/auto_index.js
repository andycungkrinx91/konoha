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
const path = require('node:path');
const store = require('./store');

// ponytail: cap the first-use pass so a query cannot stall on a 20k-file tree.
// Raise it, or raise `timeoutMs`, once a caller needs a large root inline.
const AUTO_INDEX_MAX_FILES = 5000;
const AUTO_INDEX_TIMEOUT_MS = 15000;

// Concurrent first-use queries on the same root share one pass; the indexer has
// no lock of its own, and both would otherwise walk and write the whole tree.
const inFlightIndexes = new Map();

// `store.getRoot` returns a row whatever its status. `ensureRoot` creates one as
// `stale` with `indexed_at NULL` before the first pass finishes, so status alone
// cannot tell "partially indexed" from "never finished": a timed-out pass would
// otherwise answer every later query from an empty index.
function isUsableRoot(row) {
  if (!row) return false;
  const status = String(row.status || '');
  if (status === 'fresh') return true;
  return status === 'stale' && Boolean(row.indexed_at);
}

function _readOnlySession() {
  // @genin and @advisor run under strict read-only enforcement. Auto-indexing on
  // a read would be exactly the index write that guard exists to prevent, so a
  // read-only caller gets the actionable error instead of a silent write.
  if (process.env.KONOHA_READONLY === '1') return true;
  try {
    const { detectActiveAgent } = require('../mcp/client_detection');
    const active = String(detectActiveAgent() || '').trim().toLowerCase().replace(/^@/, '');
    return active === 'genin' || active === 'advisor';
  } catch (_) {
    return false;
  }
}

function _shouldIndex(rootPath) {
  if (!rootPath) return false;
  if (_readOnlySession()) return false;
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
  if (isUsableRoot(existing)) return existing;
  if (!_shouldIndex(rootPath)) return null;
  const indexer = _indexer();
  if (!indexer) return null;
  try {
    indexer.indexRepository(_indexOptions(rootPath, conn, timeoutMs));
  } catch (_) {
    return null;
  }
  const row = store.getRoot(conn, rootPath);
  return isUsableRoot(row) ? row : null;
}

/** Async twin of `ensureRootIndexed`: yields so other tools stay responsive. */
async function ensureRootIndexedAsync(conn, rootPath, timeoutMs) {
  if (!rootPath) return null;
  const existing = store.getRoot(conn, rootPath);
  if (isUsableRoot(existing)) return existing;
  if (!_shouldIndex(rootPath)) return null;
  const key = path.resolve(rootPath);
  const pending = inFlightIndexes.get(key);
  if (pending) return pending;
  const run = (async () => {
    try {
      const indexer = _indexer();
      if (!indexer) return null;
      await indexer.indexRepositoryAsync(_indexOptions(rootPath, conn, timeoutMs));
    } catch (_) {
      return null;
    } finally {
      inFlightIndexes.delete(key);
    }
    const row = store.getRoot(conn, rootPath);
    return isUsableRoot(row) ? row : null;
  })();
  inFlightIndexes.set(key, run);
  return run;
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
  isUsableRoot,
  ensureRootIndexed,
  ensureRootIndexedAsync,
  describeMissingRoot
};
