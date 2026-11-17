'use strict';

/**
 * Shared setup for the query layer: root resolution and search preparation.
 *
 * Split out of `query.js` because both concerns are about *deciding what to
 * read* — which root, which limit, which filter — and every handler repeats
 * them. Keeping them here also keeps the auto-index contract in one place:
 * a first-use index is blocking on the sync path and awaited on the async one.
 */

const store = require('./store');
const { ensureRootIndexed, ensureRootIndexedAsync, describeMissingRoot } = require('./auto_index');
const { SEARCH_MAX_HITS } = require('./config');

/** Resolve a root path to its index row, indexing an existing directory on first use. */
function resolveRoot(conn, rootPath) {
  if (!rootPath) return null;
  return store.getRoot(conn, rootPath) || ensureRootIndexed(conn, rootPath);
}

function prepareSearchSetup(options, semanticStatus) {
  const query = options.query;
  const baseEmpty = { hits: [], degraded: false, semantic_status: semanticStatus, semantic_applied: false, reranked: false, total: 0 };
  if (!query || !String(query).trim()) {
    return { earlyReturn: { query: '', ...baseEmpty } };
  }
  const conn = options.conn || store.openConnection();
  const rawLimit = Number(options.limit);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(Math.floor(rawLimit), SEARCH_MAX_HITS))
    : SEARCH_MAX_HITS;
  const contentKind = store.normalizeContentFilter(options.filter);
  const root = options.rootResolved !== undefined
    ? options.rootResolved
    : (options.rootPath ? resolveRoot(conn, options.rootPath) : null);
  if (options.rootPath && !root) {
    return { earlyReturn: { query, ...baseEmpty, error: describeMissingRoot(conn, options.rootPath) } };
  }
  return { query, conn, limit, contentKind, root, rootHash: root ? root.root_hash : null };
}

/**
 * Indexing a root on first use is I/O-heavy, so the async path must not do it
 * inside the sync setup — that would block the event loop and stall `tools/list`.
 */
async function prepareSearchSetupAsync(options, semanticStatus) {
  if (!options.rootPath || options.rootResolved !== undefined) {
    return prepareSearchSetup(options, semanticStatus);
  }
  const conn = options.conn || store.openConnection();
  if (!store.getRoot(conn, options.rootPath)) {
    await ensureRootIndexedAsync(conn, options.rootPath, options.indexTimeoutMs);
  }
  return prepareSearchSetup({ ...options, conn }, semanticStatus);
}

module.exports = {
  resolveRoot,
  prepareSearchSetup,
  prepareSearchSetupAsync,
  describeMissingRoot
};
