'use strict';

/**
 * Native equivalent of `find_related`: fuses structural graph signals
 * (`code_edges`, cross-file `code_refs`, co-imports, test/source twins),
 * Granite 97M cosine vector KNN, and MiniLM L-6 cross-encoder reranking.
 */

const path = require('path');
const store = require('./store');
const { SEARCH_MAX_HITS, SEARCH_SNIPPET_MAX_CHARS } = require('./config');
const {
  EMBED_MODEL_REPO,
  isSemanticSearchEnabled,
  embedText,
  rerank
} = require('../vector_pipeline');
const { reciprocalRankFusion } = require('../vector_chunker');

const EDGE_WEIGHTS = {
  outgoing: { extends: 3.5, implements: 3.5, reexports: 2.8, imports: 2.5 },
  incoming: { extends: 3.2, implements: 3.2, reexports: 2.4, imports: 2.2 }
};

function _normalizeRelPath(raw) {
  return String(raw || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function _snippet(body) {
  const text = String(body || '');
  return text.length > SEARCH_SNIPPET_MAX_CHARS
    ? `${text.slice(0, SEARCH_SNIPPET_MAX_CHARS)}\n…`
    : text;
}

function _stemWithoutTest(relPath) {
  const base = path.posix.basename(String(relPath || '')).toLowerCase();
  const dot = base.indexOf('.');
  const noExt = dot > 0 ? base.slice(0, dot) : base;
  return noExt
    .replace(/^test_/, '')
    .replace(/(\.test|\.spec|_test|_spec)$/i, '');
}

function _lookupAnchorFile(conn, root, relPath) {
  if (!relPath) return null;
  if (root) {
    return conn.prepare('SELECT * FROM code_files WHERE root_hash = ? AND rel_path = ?').get(root.root_hash, relPath);
  }
  return conn.prepare('SELECT * FROM code_files WHERE rel_path = ? ORDER BY indexed_at DESC LIMIT 1').get(relPath);
}

function _lookupAnchorSymbol(conn, root, fileRow, symbolName) {
  if (!symbolName) return null;
  if (fileRow) {
    return conn.prepare('SELECT * FROM code_symbols WHERE file_id = ? AND name = ? ORDER BY start_line ASC LIMIT 1')
      .get(fileRow.id, symbolName);
  }
  return root
    ? conn.prepare(`SELECT s.*, f.rel_path FROM code_symbols s
        JOIN code_files f ON f.id = s.file_id
        WHERE s.root_hash = ? AND s.name = ? ORDER BY f.rel_path ASC, s.start_line ASC LIMIT 1`).get(root.root_hash, symbolName)
    : conn.prepare(`SELECT s.*, f.rel_path FROM code_symbols s
        JOIN code_files f ON f.id = s.file_id
        WHERE s.name = ? ORDER BY f.rel_path ASC, s.start_line ASC LIMIT 1`).get(symbolName);
}

function _resolveAnchor(conn, options) {
  const relPath = _normalizeRelPath(options.relPath || options.file || '');
  const symbolName = String(options.symbol || options.name || '').trim();
  if (!relPath && !symbolName) return { error: 'file or symbol is required' };

  const root = options.rootPath ? store.getRoot(conn, options.rootPath) : null;
  if (options.rootPath && !root) {
    return { error: `root not indexed: ${options.rootPath}` };
  }

  let fileRow = _lookupAnchorFile(conn, root, relPath);
  const symbolRow = _lookupAnchorSymbol(conn, root, fileRow, symbolName);
  if (!fileRow && symbolRow) {
    fileRow = conn.prepare('SELECT * FROM code_files WHERE id = ?').get(symbolRow.file_id);
  }
  if (!fileRow) {
    return { error: `not indexed: ${relPath || symbolName}` };
  }
  return { file: fileRow, symbol: symbolRow, relPath: fileRow.rel_path, root };
}

function _ensureEntry(byFileId, meta) {
  let entry = byFileId.get(meta.file_id);
  if (!entry) {
    entry = {
      fileId: meta.file_id,
      relPath: meta.rel_path,
      language: meta.language,
      contentKind: meta.content_kind || 'code',
      structuralScore: 0,
      reasons: new Set(),
      relationships: []
    };
    byFileId.set(meta.file_id, entry);
  }
  return entry;
}

function _recordEdgeRows(byFileId, rows, direction) {
  const weights = EDGE_WEIGHTS[direction];
  for (const r of rows) {
    const entry = _ensureEntry(byFileId, r);
    const kind = r.edge_kind || 'imports';
    const w = (weights[kind] || 2.0) * (Number(r.confidence) || 0.5);
    entry.structuralScore += w;
    entry.reasons.add(`${direction}_${kind}`);
    entry.relationships.push({
      type: `${direction}_edge`,
      kind,
      specifier: r.specifier,
      symbol: r.target_sym_name || r.source_sym_name || ''
    });
  }
}

function _recordRefRows(byFileId, rows, direction) {
  for (const r of rows) {
    const entry = _ensureEntry(byFileId, r);
    const w = Math.min(2.6, 0.9 + 0.4 * Number(r.ref_count || 1));
    entry.structuralScore += w;
    entry.reasons.add('shared_symbol_ref');
    entry.relationships.push({
      type: 'shared_symbol_ref',
      direction,
      symbols: String(r.symbols || '').split(',').filter(Boolean).slice(0, 8)
    });
  }
}

function _recordSharedImports(byFileId, rows) {
  for (const r of rows) {
    const entry = _ensureEntry(byFileId, r);
    const w = Math.min(1.8, 0.55 * Number(r.shared_count || 1));
    entry.structuralScore += w;
    entry.reasons.add('co_import');
    entry.relationships.push({
      type: 'co_import',
      specifiers: String(r.specifiers || '').split(',').filter(Boolean).slice(0, 6)
    });
  }
}

function _recordPathTwins(conn, anchorFile, byFileId) {
  const anchorStem = _stemWithoutTest(anchorFile.rel_path);
  if (!anchorStem || anchorStem.length < 3) return;
  const summaries = store.getFileSummariesByRoot(conn, anchorFile.root_hash);
  for (const f of summaries) {
    if (f.id === anchorFile.id) continue;
    if (_stemWithoutTest(f.rel_path) !== anchorStem) continue;
    const entry = _ensureEntry(byFileId, {
      file_id: f.id,
      rel_path: f.rel_path,
      language: f.language,
      content_kind: f.content_kind
    });
    entry.structuralScore += 1.1;
    entry.reasons.add('test_source_twin');
    entry.relationships.push({ type: 'test_source_twin', stem: anchorStem });
  }
}

function _collectStructural(conn, anchorFile) {
  const graph = store.getFileGraphNeighbors(conn, anchorFile.id);
  const byFileId = new Map();
  _recordEdgeRows(byFileId, graph.outgoing, 'outgoing');
  _recordEdgeRows(byFileId, graph.incoming, 'incoming');
  _recordRefRows(byFileId, graph.inboundRefs, 'inbound');
  _recordRefRows(byFileId, graph.outboundRefs, 'outbound');
  _recordSharedImports(byFileId, graph.sharedImports);
  _recordPathTwins(conn, anchorFile, byFileId);

  const ranked = Array.from(byFileId.values()).sort((a, b) => b.structuralScore - a.structuralScore);
  return { byFileId, structuralRankIds: ranked.map((e) => String(e.fileId)) };
}

function _loadAnchorChunks(conn, anchorFile, symbolRow, modelRepo) {
  const rows = conn.prepare(`
    SELECT c.id, c.start_line, c.end_line, c.body, c.embedding, c.embedding_model, s.name AS symbol_name
    FROM code_chunks c
    LEFT JOIN code_symbols s ON s.id = c.symbol_id
    WHERE c.file_id = ?
    ORDER BY c.chunk_index ASC
  `).all(anchorFile.id);
  if (symbolRow) {
    const focused = rows.filter((r) => r.end_line >= symbolRow.start_line && r.start_line <= symbolRow.end_line);
    if (focused.length > 0) return { rows, focused, modelRepo };
  }
  return { rows, focused: rows.slice(0, 3), modelRepo };
}

function _meanPoolAnchorVector(rows, modelRepo) {
  let sum = null;
  let count = 0;
  for (const r of rows) {
    if (r.embedding_model !== modelRepo || !r.embedding) continue;
    const byteLen = r.embedding.byteLength || r.embedding.length || 0;
    if (byteLen < 16 || byteLen % 4 !== 0) continue;
    const dim = byteLen / 4;
    const vec = new Float32Array(r.embedding.buffer, r.embedding.byteOffset, dim);
    if (!sum) sum = new Float32Array(dim);
    if (vec.length !== sum.length) continue;
    for (let i = 0; i < dim; i++) sum[i] += vec[i];
    count += 1;
  }
  if (!sum || count === 0) return null;
  let normSq = 0;
  for (let i = 0; i < sum.length; i++) normSq += sum[i] * sum[i];
  if (normSq <= 0) return null;
  const inv = 1 / Math.sqrt(normSq);
  for (let i = 0; i < sum.length; i++) sum[i] *= inv;
  return sum;
}

function _fillRepresentativeChunks(conn, fileIds) {
  const reps = new Map();
  const stmt = conn.prepare(`
    SELECT c.id AS chunk_id, c.file_id, c.rel_path, c.language, c.start_line, c.end_line,
           c.body, f.content_kind, s.name AS symbol_name
    FROM code_chunks c
    JOIN code_files f ON f.id = c.file_id
    LEFT JOIN code_symbols s ON s.id = c.symbol_id
    WHERE c.file_id = ?
    ORDER BY c.chunk_index ASC LIMIT 1
  `);
  for (const fid of fileIds) {
    const row = stmt.get(fid);
    if (row) reps.set(fid, row);
  }
  return reps;
}

function _buildCandidatePool(conn, orderedEntries, vecBestByFile) {
  const missingIds = orderedEntries
    .filter((e) => !vecBestByFile.has(e.entry.fileId))
    .map((e) => e.entry.fileId);
  const fallbackReps = missingIds.length > 0 ? _fillRepresentativeChunks(conn, missingIds) : new Map();

  return orderedEntries.map(({ entry, rrfNorm }) => {
    const vecHit = vecBestByFile.get(entry.fileId);
    const rep = vecHit || fallbackReps.get(entry.fileId);
    const body = rep ? rep.body : '';
    const startLine = rep ? rep.startLine || rep.start_line : 1;
    const endLine = rep ? rep.endLine || rep.end_line : 1;
    const symbolName = rep ? rep.symbolName || rep.symbol_name || '' : '';
    return {
      fileId: entry.fileId,
      relPath: entry.relPath,
      relative_path: entry.relPath,
      language: entry.language,
      contentKind: entry.contentKind,
      symbolName,
      symbol_name: symbolName,
      startLine,
      start_line: startLine,
      endLine,
      end_line: endLine,
      chunk_text: body,
      body,
      structuralScore: Number(entry.structuralScore.toFixed(4)),
      vectorScore: vecHit ? Number(vecHit.score.toFixed(4)) : 0,
      rrfNorm,
      reasons: Array.from(entry.reasons),
      relationships: entry.relationships
    };
  });
}

function _formatRelatedItem(c, scoreOverride = null) {
  return {
    relPath: c.relPath,
    language: c.language,
    contentKind: c.contentKind,
    score: scoreOverride !== null ? scoreOverride : Number(c.structuralScore.toFixed(4)),
    structuralScore: c.structuralScore,
    vectorScore: c.vectorScore || 0,
    rerankScore: c.rerank_score !== undefined ? Number(c.rerank_score) : 0,
    reasons: c.reasons,
    relationships: c.relationships.slice(0, 6),
    bestSpan: { startLine: c.startLine, endLine: c.endLine, symbolName: c.symbolName },
    snippet: _snippet(c.body)
  };
}

/** Structural-graph relatedness lookup across indexed repository files. */
function related(options = {}) {
  const conn = options.conn || store.openConnection();
  const anchor = _resolveAnchor(conn, options);
  if (anchor.error) {
    return { anchor: null, related: [], total: 0, semantic_applied: false, reranked: false, degraded: false, error: anchor.error };
  }
  const rawLimit = Number(options.limit);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(Math.floor(rawLimit), SEARCH_MAX_HITS))
    : 10;
  const contentKind = store.normalizeContentFilter(options.filter);
  const { byFileId, structuralRankIds } = _collectStructural(conn, anchor.file);
  const filteredIds = structuralRankIds.filter((id) => {
    const entry = byFileId.get(Number(id));
    return entry && (!contentKind || entry.contentKind === contentKind);
  });
  const topEntries = filteredIds.slice(0, limit).map((id, idx) => ({
    entry: byFileId.get(Number(id)),
    rrfNorm: 1 / (idx + 1)
  }));
  const pool = _buildCandidatePool(conn, topEntries, new Map());
  return {
    anchor: {
      relPath: anchor.relPath,
      rootHash: anchor.file.root_hash,
      language: anchor.file.language,
      symbol: anchor.symbol ? anchor.symbol.name : ''
    },
    related: pool.map((c) => _formatRelatedItem(c, c.structuralScore)),
    total: pool.length,
    semantic_applied: false,
    reranked: false,
    degraded: false
  };
}

async function _collectSemanticRelated(conn, anchor, params) {
  const { anchorChunks, focused, anchorBody, modelRepo, candidateK, byFileId } = params;
  const vecBestByFile = new Map();
  const semanticRankIds = [];
  let anchorVec = _meanPoolAnchorVector(focused.length > 0 ? focused : anchorChunks, modelRepo);
  if (!anchorVec && anchorBody.trim()) {
    const header = [anchor.relPath, anchor.symbol ? anchor.symbol.name : ''].filter(Boolean).join(' | ');
    anchorVec = await embedText(`[${header}]\n${anchorBody.slice(0, 1600)}`, { modelRepo });
  }
  if (!anchorVec) return { vecBestByFile, semanticRankIds };

  const hits = store.searchVectorCandidates(conn, anchor.file.root_hash, anchorVec, {
    model: modelRepo,
    limit: candidateK * 2,
    excludeFileIds: new Set([anchor.file.id])
  });
  for (const h of hits) {
    if (vecBestByFile.has(h.fileId)) continue;
    vecBestByFile.set(h.fileId, h);
    semanticRankIds.push(String(h.fileId));
    const entry = byFileId.get(h.fileId) || _ensureEntry(byFileId, {
      file_id: h.fileId,
      rel_path: h.relPath,
      language: h.language,
      content_kind: 'code'
    });
    entry.reasons.add('semantic_similarity');
  }
  return { vecBestByFile, semanticRankIds };
}

/** Hybrid graph, semantic cosine, and cross-encoder reranked relatedness lookup. */
async function relatedAsync(options = {}) {
  const conn = options.conn || store.openConnection();
  const anchor = _resolveAnchor(conn, options);
  if (anchor.error) {
    return { anchor: null, related: [], total: 0, semantic_applied: false, reranked: false, degraded: false, error: anchor.error };
  }

  const rawLimit = Number(options.limit);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(Math.floor(rawLimit), SEARCH_MAX_HITS))
    : 10;
  const contentKind = store.normalizeContentFilter(options.filter);
  const candidateK = Math.max(limit * 3, 30);
  const modelRepo = options.embeddingModel || EMBED_MODEL_REPO;
  const { byFileId, structuralRankIds } = _collectStructural(conn, anchor.file);
  const { rows: anchorChunks, focused } = _loadAnchorChunks(conn, anchor.file, anchor.symbol, modelRepo);
  const anchorBody = focused.map((c) => c.body).join('\n');

  const semanticEnabled = options.semantic !== false && isSemanticSearchEnabled();
  const { vecBestByFile, semanticRankIds } = semanticEnabled
    ? await _collectSemanticRelated(conn, anchor, { anchorChunks, focused, anchorBody, modelRepo, candidateK, byFileId })
    : { vecBestByFile: new Map(), semanticRankIds: [] };

  const rankLists = [];
  if (structuralRankIds.length > 0) rankLists.push(structuralRankIds);
  if (semanticRankIds.length > 0) rankLists.push(semanticRankIds);
  if (rankLists.length === 0) {
    return {
      anchor: { relPath: anchor.relPath, rootHash: anchor.file.root_hash, language: anchor.file.language, symbol: anchor.symbol ? anchor.symbol.name : '' },
      related: [],
      total: 0,
      semantic_applied: semanticRankIds.length > 0,
      reranked: false,
      degraded: false
    };
  }

  const fused = reciprocalRankFusion(rankLists, 60);
  const maxRrf = fused[0][1] || 1;
  const ordered = fused
    .map(([id, score]) => ({
      entry: byFileId.get(Number(id)),
      rrfNorm: score / maxRrf
    }))
    .filter((x) => Boolean(x.entry) && (!contentKind || x.entry.contentKind === contentKind))
    .slice(0, candidateK);

  const pool = _buildCandidatePool(conn, ordered, vecBestByFile);
  const useRerank = options.rerank !== false && isSemanticSearchEnabled() && pool.length > 0;
  let finalItems;
  if (useRerank) {
    const queryHeader = [anchor.relPath, anchor.symbol ? anchor.symbol.name : ''].filter(Boolean).join(' | ');
    const anchorQuery = `${queryHeader}\n${anchorBody.slice(0, 800)}`.trim();
    const reranked = await rerank(anchorQuery, pool, { topK: limit });
    finalItems = reranked.map((c) => {
      const combined = Number((0.55 * (c.rrfNorm || 0) + 0.45 * (c.rerank_score || 0)).toFixed(6));
      return _formatRelatedItem(c, combined);
    });
  } else {
    finalItems = pool.slice(0, limit).map((c) => _formatRelatedItem(c, Number(c.rrfNorm.toFixed(6))));
  }

  return {
    anchor: {
      relPath: anchor.relPath,
      rootHash: anchor.file.root_hash,
      language: anchor.file.language,
      symbol: anchor.symbol ? anchor.symbol.name : ''
    },
    related: finalItems,
    total: finalItems.length,
    semantic_applied: semanticRankIds.length > 0,
    reranked: useRerank,
    degraded: false
  };
}

module.exports = {
  related,
  relatedAsync
};
