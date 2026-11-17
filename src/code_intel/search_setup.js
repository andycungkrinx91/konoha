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
const { ensureRootIndexed, ensureRootIndexedAsync, isUsableRoot, describeMissingRoot } = require('./auto_index');
const { SEARCH_MAX_HITS } = require('./config');

/** Resolve a root path to its index row, indexing an existing directory on first use. */
function resolveRoot(conn, rootPath) {
  if (!rootPath) return null;
  // `ensureRootIndexed` re-checks the row's status, so a `failed` or `indexing`
  // row is retried rather than answered from.
  return ensureRootIndexed(conn, rootPath);
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
  let rootResolved = store.getRoot(conn, options.rootPath);
  if (!isUsableRoot(rootResolved)) {
    rootResolved = await ensureRootIndexedAsync(conn, options.rootPath, options.indexTimeoutMs);
  }
  // Pin the resolution even when it is null: falling back to the sync setup
  // would re-run the whole index on the event loop, which is the stall this
  // function exists to avoid.
  return prepareSearchSetup({ ...options, conn, rootResolved }, semanticStatus);
}

module.exports = {
  resolveRoot,
  prepareSearchSetup,
  prepareSearchSetupAsync,
  describeMissingRoot
};
