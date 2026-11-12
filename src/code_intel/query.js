'use strict';

/**
 * Query layer: search, symbol lookup, context, impact.
 *
 * All reads. Nothing here writes to the indexed repository, and nothing here
 * calls a model.
 */

const store = require('./store');
const {
  SEARCH_MAX_HITS,
  SEARCH_SNIPPET_MAX_CHARS,
  IMPACT_MAX_DEPTH,
  IMPACT_MAX_NODES
} = require('./config');

/**
 * Reduces arbitrary user text to FTS5-safe prefix terms.
 *
 * Only `[a-z0-9_]` survives, so no FTS5 operator, quote, or parenthesis can be
 * constructed from input. Terms are ANDed rather than ORed: FTS5's default OR
 * would rank a one-word match above a full-phrase match.
 */
function _terms(query) {
  return String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1)
    .slice(0, 12);
}

function toFtsQuery(query) {
  const terms = _terms(query);
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t}"*`).join(' AND ');
}

function _snippet(body) {
  const text = String(body || '');
  return text.length > SEARCH_SNIPPET_MAX_CHARS
    ? `${text.slice(0, SEARCH_SNIPPET_MAX_CHARS)}\n…`
    : text;
}

function _resolveRoot(conn, rootPath) {
  const root = store.getRoot(conn, rootPath);
  return root || null;
}

/**
 * Full-text search over indexed chunks.
 *
 * When FTS5 is unavailable the function degrades to a `LIKE` scan and sets
 * `degraded: true` rather than failing — a slow answer beats no answer, but
 * the caller is told which one it got.
 */
function search(options = {}) {
  const query = options.query;
  if (!query || !String(query).trim()) {
    return { query: '', hits: [], degraded: false, total: 0 };
  }
  const conn = options.conn || store.openConnection();
  const limit = Math.min(Number(options.limit) || SEARCH_MAX_HITS, SEARCH_MAX_HITS);
  const root = options.rootPath ? _resolveRoot(conn, options.rootPath) : null;
  if (options.rootPath && !root) {
    return { query, hits: [], degraded: false, total: 0, error: `root not indexed: ${options.rootPath}` };
  }
  const rootHash = root ? root.root_hash : null;

  const ftsQuery = toFtsQuery(query);
  const terms = _terms(query);
  if (ftsQuery && store.ftsAvailable(conn)) {
    try {
      // bm25 alone ranks by term frequency, so a file that mentions an
      // identifier forty times in comments beats the file that defines it.
      // A chunk anchored on a symbol with the same name is the definition;
      // that outranks any mention, and bm25 orders within each group.
      const defSql = terms.length > 0
        ? `EXISTS (SELECT 1 FROM code_symbols s WHERE s.file_id = c.file_id
             AND s.start_line = c.start_line AND lower(s.name) IN (${terms.map(() => '?').join(',')}))`
        : '0';
      const sql = `
        SELECT c.id, c.rel_path, c.language, c.start_line, c.end_line, c.body,
               f.id AS file_id,
               bm25(code_chunks_fts, 10.0, 4.0, 1.0) AS score,
               CASE WHEN ${defSql} THEN 0 ELSE 1 END AS def_rank
        FROM code_chunks_fts
        JOIN code_chunks c ON c.id = code_chunks_fts.rowid
        JOIN code_files f ON f.id = c.file_id
        WHERE code_chunks_fts MATCH ?
          ${rootHash ? 'AND c.root_hash = ?' : ''}
        ORDER BY def_rank ASC, score ASC, c.rel_path ASC, c.start_line ASC
        LIMIT ?`;
      const params = rootHash
        ? [...terms, ftsQuery, rootHash, limit]
        : [...terms, ftsQuery, limit];
      const rows = conn.prepare(sql).all(...params);
      return {
        query,
        degraded: false,
        total: rows.length,
        hits: rows.map((r) => ({
          relPath: r.rel_path,
          language: r.language,
          startLine: r.start_line,
          endLine: r.end_line,
          score: Number(r.score),
          snippet: _snippet(r.body)
        }))
      };
    } catch (_) {
      // Fall through to LIKE: a malformed MATCH must not break the tool.
    }
  }

  const like = `%${String(query).trim().toLowerCase()}%`;
  const sql = `
    SELECT rel_path, language, start_line, end_line, body
    FROM code_chunks
    WHERE lower(body) LIKE ?
      ${rootHash ? 'AND root_hash = ?' : ''}
    ORDER BY rel_path ASC, start_line ASC
    LIMIT ?`;
  const rows = rootHash
    ? conn.prepare(sql).all(like, rootHash, limit)
    : conn.prepare(sql).all(like, limit);
  return {
    query,
    degraded: true,
    total: rows.length,
    hits: rows.map((r) => ({
      relPath: r.rel_path,
      language: r.language,
      startLine: r.start_line,
      endLine: r.end_line,
      score: 0,
      snippet: _snippet(r.body)
    }))
  };
}

/**
 * Symbol lookup by exact name. Returns every definition, each marked
 * `ambiguous` when more than one file defines the same name, so the caller can
 * choose instead of receiving a silently wrong pick.
 */
function findSymbol(options = {}) {
  const name = String(options.name || '').trim();
  if (!name) return { name: '', symbols: [], ambiguous: false };
  const conn = options.conn || store.openConnection();
  const root = options.rootPath ? _resolveRoot(conn, options.rootPath) : null;
  if (options.rootPath && !root) {
    return { name, symbols: [], ambiguous: false, error: `root not indexed: ${options.rootPath}` };
  }
  const rows = root
    ? conn.prepare(`SELECT s.*, f.rel_path FROM code_symbols s
        JOIN code_files f ON f.id = s.file_id
        WHERE s.name = ? AND s.root_hash = ?
        ORDER BY f.rel_path ASC, s.start_line ASC`).all(name, root.root_hash)
    : conn.prepare(`SELECT s.*, f.rel_path FROM code_symbols s
        JOIN code_files f ON f.id = s.file_id
        WHERE s.name = ?
        ORDER BY f.rel_path ASC, s.start_line ASC`).all(name);

  const files = new Set(rows.map((r) => r.rel_path));
  return {
    name,
    ambiguous: files.size > 1,
    candidateCount: rows.length,
    symbols: rows.map((r) => ({
      name: r.name,
      kind: r.kind,
      parentName: r.parent_name,
      relPath: r.rel_path,
      language: r.language,
      startLine: r.start_line,
      endLine: r.end_line,
      signature: r.signature
    }))
  };
}

/** Returns the indexed source for one file, or for a line window inside it. */
function getContext(options = {}) {
  const relPath = options.relPath;
  if (!relPath) return { relPath: '', text: '', error: 'relPath is required' };
  const conn = options.conn || store.openConnection();
  const root = options.rootPath ? _resolveRoot(conn, options.rootPath) : null;
  if (options.rootPath && !root) {
    return { relPath, text: '', error: `root not indexed: ${options.rootPath}` };
  }
  const file = root
    ? conn.prepare('SELECT * FROM code_files WHERE root_hash = ? AND rel_path = ?').get(root.root_hash, relPath)
    : conn.prepare('SELECT * FROM code_files WHERE rel_path = ? ORDER BY indexed_at DESC LIMIT 1').get(relPath);
  if (!file) return { relPath, text: '', error: `not indexed: ${relPath}` };

  // No window requested means the whole file, not the first line: a caller that
  // names a file and no range is asking "show me this file".
  const hasWindow = options.startLine !== undefined || options.endLine !== undefined;
  const startLine = hasWindow ? Math.max(1, Number(options.startLine) || 1) : 1;
  const endLine = hasWindow ? Math.max(startLine, Number(options.endLine) || startLine) : file.line_count;
  const chunks = hasWindow
    ? conn.prepare(`SELECT start_line, end_line, body FROM code_chunks
        WHERE file_id = ? AND end_line >= ? AND start_line <= ?
        ORDER BY start_line ASC`).all(file.id, startLine, endLine)
    : conn.prepare(`SELECT start_line, end_line, body FROM code_chunks
        WHERE file_id = ? ORDER BY start_line ASC`).all(file.id);

  const text = chunks.map((c) => c.body).join('\n');
  return {
    relPath,
    language: file.language,
    startLine,
    endLine,
    truncated: chunks.length === 0,
    text: text || ''
  };
}

/** Records one reference site; returns the enclosing symbol name if new. */
function _recordRef(row, depth, target, ctx) {
  const owner = ctx.enclosingStmt.get(row.file_id, row.line, row.line);
  ctx.nodes.push({
    relPath: row.rel_path,
    line: row.line,
    kind: row.kind,
    depth,
    target,
    enclosing: owner ? `${owner.kind} ${owner.name}` : null
  });
  return owner ? owner.name : null;
}

/**
 * Records every reference site of `target` at this depth and queues the
 * symbols that enclose those sites as the next frontier.
 */
function _expandTarget(target, depth, ctx, next) {
  const rows = ctx.rootHash ? ctx.refsStmt.all(target, ctx.rootHash) : ctx.refsStmt.all(target);
  for (const row of rows) {
    if (ctx.nodes.length >= ctx.maxNodes) return;
    const owner = _recordRef(row, depth, target, ctx);
    if (!owner || ctx.visited.has(owner)) continue;
    ctx.visited.add(owner);
    next.push(owner);
  }
}

/**
 * Reverse reachability over `code_refs`.
 *
 * Nodes are symbols. Starting from `name`, each referencing site is mapped to
 * the symbol that encloses it — that enclosing symbol is the importer, and it
 * becomes the next frontier. Depth and node caps plus a visited set make cycles
 * terminate.
 */
/** Expands one BFS layer. Returns the next frontier (possibly empty). */
function _expandFrontier(frontier, depth, ctx) {
  const next = [];
  for (const target of frontier) {
    _expandTarget(target, depth, ctx, next);
    if (ctx.nodes.length >= ctx.maxNodes) break;
  }
  return next;
}

function impact(options = {}) {
  const name = String(options.name || '').trim();
  if (!name) return { name: '', nodes: [], truncated: false };
  const conn = options.conn || store.openConnection();
  const root = options.rootPath ? _resolveRoot(conn, options.rootPath) : null;
  if (options.rootPath && !root) {
    return { name, nodes: [], truncated: false, error: `root not indexed: ${options.rootPath}` };
  }
  const maxDepth = Math.min(Number(options.maxDepth) || IMPACT_MAX_DEPTH, IMPACT_MAX_DEPTH);
  const maxNodes = Math.min(Number(options.maxNodes) || IMPACT_MAX_NODES, IMPACT_MAX_NODES);
  const rootHash = root ? root.root_hash : null;

  const refsSql = `SELECT r.kind, r.line, f.rel_path, f.id AS file_id
      FROM code_refs r JOIN code_files f ON f.id = r.file_id
      WHERE r.target_name = ? ${rootHash ? 'AND r.root_hash = ?' : ''}
      ORDER BY f.rel_path ASC, r.line ASC`;
  const enclosingSql = `SELECT name, kind, start_line, end_line FROM code_symbols
      WHERE file_id = ? AND start_line <= ? AND end_line >= ?
      ORDER BY (end_line - start_line) ASC LIMIT 1`;

  const refsStmt = conn.prepare(refsSql);
  const enclosingStmt = conn.prepare(enclosingSql);

  const ctx = { refsStmt, enclosingStmt, rootHash, nodes: [], visited: new Set([name]), maxNodes };
  let frontier = [name];
  let truncated = false;

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const next = _expandFrontier(frontier, depth, ctx);
    if (ctx.nodes.length >= maxNodes) truncated = true;
    if (depth === maxDepth && next.length > 0) truncated = true;
    frontier = next;
  }

  const nodes = ctx.nodes;

  nodes.sort((a, b) => a.depth - b.depth || (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0) || a.line - b.line);
  return { name, nodes, truncated, maxDepth, maxNodes };
}

function status(options = {}) {
  const conn = options.conn || store.openConnection();
  if (options.rootPath) {
    const root = _resolveRoot(conn, options.rootPath);
    return root ? { roots: [root] } : { roots: [] };
  }
  return { roots: store.listRoots(conn) };
}

module.exports = {
  toFtsQuery,
  search,
  findSymbol,
  getContext,
  impact,
  status
};
