'use strict';

/**
 * Query layer: search, symbol lookup, context, impact, and related-code discovery.
 *
 * Sync methods perform lexical/graph SQLite reads; async methods (`searchAsync`,
 * `relatedAsync`) add Granite 97M semantic vectors + MiniLM L-6 cross-encoder reranking.
 */

const store = require('./store');
const {
  SEARCH_MAX_HITS,
  SEARCH_SNIPPET_MAX_CHARS,
  IMPACT_MAX_DEPTH,
  IMPACT_MAX_NODES
} = require('./config');
const {
  EMBED_MODEL_REPO,
  isSemanticSearchEnabled,
  embedText,
  rerank
} = require('../vector_pipeline');
const { reciprocalRankFusion } = require('../vector_chunker');
const { related, relatedAsync } = require('./related');

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

function toFtsOrQuery(query) {
  const terms = _terms(query);
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t}"*`).join(' OR ');
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

function _queryFtsChunks(conn, params) {
  const { ftsExpr, terms, rootHash, contentKind, limit } = params;
  // bm25 alone ranks by term frequency, so a file that mentions an
  // identifier forty times in comments beats the file that defines it.
  // A chunk anchored on a symbol with the same name is the definition;
  // that outranks any mention, and bm25 orders within each group.
  const defSql = terms.length > 0
    ? `EXISTS (SELECT 1 FROM code_symbols s WHERE s.file_id = c.file_id
         AND (c.symbol_id = s.id OR (s.start_line >= c.start_line AND s.start_line <= c.end_line))
         AND lower(s.name) IN (${terms.map(() => '?').join(',')}))`
    : '0';
  const whereExtra = [
    rootHash ? 'AND c.root_hash = ?' : '',
    contentKind ? 'AND f.content_kind = ?' : ''
  ].filter(Boolean).join('\n      ');
  const sql = `
    SELECT c.id, c.rel_path, c.language, c.start_line, c.end_line, c.body,
           f.id AS file_id, s.name AS symbol_name,
           bm25(code_chunks_fts, 10.0, 4.0, 1.0) AS score,
           CASE WHEN ${defSql} THEN 0 ELSE 1 END AS def_rank
    FROM code_chunks_fts
    JOIN code_chunks c ON c.id = code_chunks_fts.rowid
    JOIN code_files f ON f.id = c.file_id
    LEFT JOIN code_symbols s ON s.id = c.symbol_id
    WHERE code_chunks_fts MATCH ?
      ${whereExtra}
    ORDER BY def_rank ASC, score ASC, c.rel_path ASC, c.start_line ASC
    LIMIT ?`;
  const sqlParams = [...terms, ftsExpr];
  if (rootHash) sqlParams.push(rootHash);
  if (contentKind) sqlParams.push(contentKind);
  sqlParams.push(limit);
  return conn.prepare(sql).all(...sqlParams);
}

function _queryLikeChunks(conn, query, rootHash, limit, contentKind = null) {
  const like = `%${String(query).trim().toLowerCase()}%`;
  const whereExtra = [
    rootHash ? 'AND c.root_hash = ?' : '',
    contentKind ? 'AND f.content_kind = ?' : ''
  ].filter(Boolean).join('\n      ');
  const sql = `
    SELECT c.id, c.file_id, c.rel_path, c.language, c.start_line, c.end_line, c.body,
           s.name AS symbol_name
    FROM code_chunks c
    JOIN code_files f ON f.id = c.file_id
    LEFT JOIN code_symbols s ON s.id = c.symbol_id
    WHERE lower(c.body) LIKE ?
      ${whereExtra}
    ORDER BY c.rel_path ASC, c.start_line ASC
    LIMIT ?`;
  const sqlParams = [like];
  if (rootHash) sqlParams.push(rootHash);
  if (contentKind) sqlParams.push(contentKind);
  sqlParams.push(limit);
  return conn.prepare(sql).all(...sqlParams);
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
  const rawLimit = Number(options.limit);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(Math.floor(rawLimit), SEARCH_MAX_HITS))
    : SEARCH_MAX_HITS;
  const contentKind = store.normalizeContentFilter(options.filter);
  const root = options.rootPath ? _resolveRoot(conn, options.rootPath) : null;
  if (options.rootPath && !root) {
    return { query, hits: [], degraded: false, total: 0, error: `root not indexed: ${options.rootPath}` };
  }
  const rootHash = root ? root.root_hash : null;

  const ftsQuery = toFtsQuery(query);
  const terms = _terms(query);
  if (ftsQuery && store.ftsAvailable(conn)) {
    try {
      const rows = _queryFtsChunks(conn, { ftsExpr: ftsQuery, terms, rootHash, contentKind, limit });
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

  const rows = _queryLikeChunks(conn, query, rootHash, limit, contentKind);
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

function _recordSearchCandidate(candMap, key, row) {
  const existing = candMap.get(key);
  if (existing) {
    if (row.vectorScore !== undefined) existing.vectorScore = row.vectorScore;
    if (row.defRank === 0) existing.defRank = 0;
    return existing;
  }
  const entry = {
    chunkId: row.chunkId,
    fileId: row.fileId,
    relPath: row.relPath,
    relative_path: row.relPath,
    language: row.language,
    startLine: row.startLine,
    start_line: row.startLine,
    endLine: row.endLine,
    end_line: row.endLine,
    symbolName: row.symbolName || '',
    symbol_name: row.symbolName || '',
    body: row.body,
    chunk_text: row.body,
    defRank: row.defRank ?? 1,
    vectorScore: row.vectorScore || 0
  };
  candMap.set(key, entry);
  return entry;
}

function _collectGraphConnectedFileIds(conn, seedFileIds) {
  const neighbors = new Set();
  if (!seedFileIds.length) return neighbors;
  const edgeStmt = conn.prepare(`
    SELECT source_file_id, target_file_id FROM code_edges
    WHERE (source_file_id = ? OR target_file_id = ?) AND target_file_id IS NOT NULL
  `);
  for (const fid of seedFileIds.slice(0, 3)) {
    for (const row of edgeStmt.all(fid, fid)) {
      if (row.source_file_id !== fid) neighbors.add(row.source_file_id);
      if (row.target_file_id !== fid) neighbors.add(row.target_file_id);
    }
  }
  return neighbors;
}

function _collectLexicalLists(conn, query, rootHash, candidateK, contentKind = null) {
  const ftsStrict = toFtsQuery(query);
  const ftsRelaxed = toFtsOrQuery(query);
  const terms = _terms(query);
  let strictRows = [];
  let relaxedRows = [];
  let degradedLexical = false;

  if (ftsStrict && store.ftsAvailable(conn)) {
    try {
      strictRows = _queryFtsChunks(conn, { ftsExpr: ftsStrict, terms, rootHash, contentKind, limit: candidateK });
      if (ftsRelaxed && (terms.length > 1 || strictRows.length < candidateK)) {
        relaxedRows = _queryFtsChunks(conn, { ftsExpr: ftsRelaxed, terms, rootHash, contentKind, limit: candidateK });
      }
      return { strictRows, relaxedRows, likeRows: [], degradedLexical };
    } catch (_) {
      degradedLexical = true;
    }
  } else {
    degradedLexical = !store.ftsAvailable(conn);
  }
  const likeRows = _queryLikeChunks(conn, query, rootHash, candidateK, contentKind);
  return { strictRows, relaxedRows, likeRows, degradedLexical };
}

function _addRowListToRank(candMap, rows, mapper) {
  const keys = [];
  const seen = new Set();
  for (const r of rows) {
    const norm = mapper(r);
    const key = String(norm.chunkId);
    _recordSearchCandidate(candMap, key, norm);
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/**
 * Hybrid AST/FTS5 + Granite 97M semantic + graph RRF + MiniLM L-6 reranked search.
 */
async function searchAsync(options = {}) {
  const query = options.query;
  if (!query || !String(query).trim()) {
    return { query: '', hits: [], degraded: false, semantic_applied: false, reranked: false, total: 0 };
  }
  const conn = options.conn || store.openConnection();
  const rawLimit = Number(options.limit);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(Math.floor(rawLimit), SEARCH_MAX_HITS))
    : SEARCH_MAX_HITS;
  const root = options.rootPath ? _resolveRoot(conn, options.rootPath) : null;
  if (options.rootPath && !root) {
    return { query, hits: [], degraded: false, semantic_applied: false, reranked: false, total: 0, error: `root not indexed: ${options.rootPath}` };
  }
  const rootHash = root ? root.root_hash : null;
  const contentKind = store.normalizeContentFilter(options.filter);
  const candidateK = Math.max(limit * 3, 40);

  const lex = _collectLexicalLists(conn, query, rootHash, candidateK, contentKind);
  const candMap = new Map();
  const mapSqlRow = (r) => ({
    chunkId: r.id,
    fileId: r.file_id,
    relPath: r.rel_path,
    language: r.language,
    startLine: r.start_line,
    endLine: r.end_line,
    symbolName: r.symbol_name || '',
    body: r.body,
    defRank: r.def_rank ?? 1
  });

  const rankLists = [];
  const strictKeys = _addRowListToRank(candMap, lex.strictRows, mapSqlRow);
  if (strictKeys.length > 0) rankLists.push(strictKeys);
  const relaxedKeys = _addRowListToRank(candMap, lex.relaxedRows.length > 0 ? lex.relaxedRows : lex.likeRows, mapSqlRow);
  if (relaxedKeys.length > 0) rankLists.push(relaxedKeys);

  let vecCount = 0;
  if (options.semantic !== false && isSemanticSearchEnabled()) {
    const modelRepo = options.embeddingModel || EMBED_MODEL_REPO;
    const queryVec = await embedText(String(query), { modelRepo });
    const vecRows = store.searchVectorCandidates(conn, rootHash, queryVec, {
      model: modelRepo,
      limit: candidateK,
      contentKind
    });
    vecCount = vecRows.length;
    const vecKeys = _addRowListToRank(candMap, vecRows, (v) => ({
      chunkId: v.chunkId,
      fileId: v.fileId,
      relPath: v.relPath,
      language: v.language,
      startLine: v.startLine,
      endLine: v.endLine,
      symbolName: v.symbolName || '',
      body: v.body,
      vectorScore: Number(v.score)
    }));
    if (vecKeys.length > 0) rankLists.push(vecKeys);
  }

  const seedFileIds = Array.from(new Set(lex.strictRows.map((r) => r.file_id)));
  const graphNeighborIds = _collectGraphConnectedFileIds(conn, seedFileIds);
  const structKeys = Array.from(candMap.entries())
    .filter(([, c]) => c.defRank === 0 || graphNeighborIds.has(c.fileId))
    .map(([k]) => k);
  if (structKeys.length > 0) rankLists.push(structKeys);

  if (rankLists.length === 0) {
    return {
      query,
      degraded: lex.degradedLexical && vecCount === 0,
      semantic_applied: vecCount > 0,
      reranked: false,
      total: 0,
      hits: []
    };
  }

  const fused = reciprocalRankFusion(rankLists, 60).slice(0, Math.max(limit * 3, 25));
  const maxRrf = fused[0][1] || 1;
  const pool = fused.map(([key, rrfScore]) => ({
    ...candMap.get(key),
    rrfNorm: rrfScore / maxRrf,
    rrfScore: Number(rrfScore.toFixed(6))
  }));

  const useRerank = options.rerank !== false && isSemanticSearchEnabled() && pool.length > 0;
  let hits;
  if (useRerank) {
    const reranked = await rerank(String(query), pool, { topK: limit });
    hits = reranked.map((r) => ({
      relPath: r.relPath,
      language: r.language,
      startLine: r.startLine,
      endLine: r.endLine,
      symbolName: r.symbolName,
      score: Number((0.55 * (r.rrfNorm || 0) + 0.45 * (r.rerank_score || 0)).toFixed(6)),
      rrfScore: r.rrfScore,
      rerankScore: r.rerank_score,
      vectorScore: r.vectorScore || 0,
      snippet: _snippet(r.body)
    }));
  } else {
    hits = pool.slice(0, limit).map((r) => ({
      relPath: r.relPath,
      language: r.language,
      startLine: r.startLine,
      endLine: r.endLine,
      symbolName: r.symbolName,
      score: lex.degradedLexical && vecCount === 0 ? 0 : r.rrfScore,
      rrfScore: r.rrfScore,
      rerankScore: 0,
      vectorScore: r.vectorScore || 0,
      snippet: _snippet(r.body)
    }));
  }

  return {
    query,
    degraded: lex.degradedLexical && vecCount === 0,
    semantic_applied: vecCount > 0,
    reranked: useRerank,
    total: hits.length,
    hits
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

function _assembleContextText(chunks, hasWindow, startLine, endLine) {
  if (!chunks || chunks.length === 0) return '';
  const lineMap = new Map();
  for (const chunk of chunks) {
    const lines = String(chunk.body || '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const lineNo = (Number(chunk.start_line) || 1) + i;
      if (!lineMap.has(lineNo)) lineMap.set(lineNo, lines[i]);
    }
  }
  const sortedNos = Array.from(lineMap.keys()).sort((a, b) => a - b);
  const clipped = hasWindow
    ? sortedNos.filter((n) => n >= startLine && n <= endLine)
    : sortedNos;
  const chosen = clipped.length > 0 ? clipped : sortedNos;
  return chosen.map((n) => lineMap.get(n)).join('\n');
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

  const text = _assembleContextText(chunks, hasWindow, startLine, endLine);
  return {
    relPath,
    language: file.language,
    startLine,
    endLine,
    truncated: chunks.length === 0,
    text: text || ''
  };
}

function _pushImpactNode(node, ctx) {
  if (ctx.nodes.length >= ctx.maxNodes) return false;
  const siteKey = `${node.relPath}:${node.line}`;
  if (ctx.seenSites.has(siteKey)) return false;
  ctx.seenSites.add(siteKey);
  ctx.nodes.push(node);
  return true;
}

function _recordRef(row, depth, target, ctx) {
  const owner = ctx.enclosingStmt.get(row.file_id, row.line, row.line);
  _pushImpactNode({
    relPath: row.rel_path,
    line: row.line,
    kind: row.kind,
    depth,
    target,
    enclosing: owner ? `${owner.kind} ${owner.name}` : null
  }, ctx);
  return owner ? owner.name : null;
}

function _expandEdgesForTarget(target, depth, ctx, next) {
  if (!ctx.edgeStmt) return;
  const edgeRows = ctx.rootHash ? ctx.edgeStmt.all(target, ctx.rootHash) : ctx.edgeStmt.all(target);
  for (const erow of edgeRows) {
    if (ctx.nodes.length >= ctx.maxNodes) return;
    const ownerName = erow.source_sym_name || '';
    const line = erow.source_sym_line || 1;
    _pushImpactNode({
      relPath: erow.rel_path,
      line,
      kind: erow.edge_kind,
      depth,
      target,
      enclosing: ownerName ? `${erow.source_sym_kind} ${ownerName}` : null
    }, ctx);
    if (ownerName && !ctx.visited.has(ownerName)) {
      ctx.visited.add(ownerName);
      next.push(ownerName);
    }
  }
}

function _expandTarget(target, depth, ctx, next) {
  _expandEdgesForTarget(target, depth, ctx, next);
  const rows = ctx.rootHash ? ctx.refsStmt.all(target, ctx.rootHash) : ctx.refsStmt.all(target);
  for (const row of rows) {
    if (ctx.nodes.length >= ctx.maxNodes) return;
    const owner = _recordRef(row, depth, target, ctx);
    if (!owner || ctx.visited.has(owner)) continue;
    ctx.visited.add(owner);
    next.push(owner);
  }
}

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
  const edgeSql = `SELECT e.edge_kind, f.rel_path,
      src.name AS source_sym_name, src.kind AS source_sym_kind, src.start_line AS source_sym_line
      FROM code_edges e
      JOIN code_files f ON f.id = e.source_file_id
      JOIN code_symbols tgt ON tgt.id = e.target_symbol_id
      LEFT JOIN code_symbols src ON src.id = e.source_symbol_id
      WHERE tgt.name = ? ${rootHash ? 'AND e.root_hash = ?' : ''}
      ORDER BY f.rel_path ASC, source_sym_line ASC`;
  const enclosingSql = `SELECT name, kind, start_line, end_line FROM code_symbols
      WHERE file_id = ? AND start_line <= ? AND end_line >= ?
      ORDER BY (end_line - start_line) ASC LIMIT 1`;

  const refsStmt = conn.prepare(refsSql);
  const edgeStmt = conn.prepare(edgeSql);
  const enclosingStmt = conn.prepare(enclosingSql);

  const ctx = {
    refsStmt,
    edgeStmt,
    enclosingStmt,
    rootHash,
    nodes: [],
    seenSites: new Set(),
    visited: new Set([name]),
    maxNodes
  };
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
  toFtsOrQuery,
  search,
  searchAsync,
  findSymbol,
  getContext,
  impact,
  related,
  relatedAsync,
  status
};
