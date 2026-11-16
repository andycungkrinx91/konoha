'use strict';

/**
 * Native equivalent of `find_related`: fuses structural graph signals
 * (`code_edges`, cross-file `code_refs`, co-imports, test/source twins),
 * Granite 97M cosine vector KNN, and MiniLM L-6 cross-encoder reranking.
 */

const path = require('path');
const store = require('./store');
const provenance = require('./provenance');
const { SEARCH_MAX_HITS, SEARCH_SNIPPET_MAX_CHARS } = require('./config');
const {
  EMBED_MODEL_REPO,
  isSemanticSearchEnabled,
  getRuntimeStatus,
  embedText,
  rerank
} = require('../vector_pipeline');

function _isSemanticUnavailableError(err) {
  return Boolean(err && (err.name === 'EmbeddingRuntimeUnavailableError' || err.code === 'EMBEDDING_RUNTIME_UNAVAILABLE'));
}
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
      contentHash: meta.content_hash || '',
      parserVersion: meta.parser_version || '',
      metricsJson: meta.metrics_json || '{}',
      structuralScore: 0,
      maxRelConfidence: 0,
      hasVerifiedRel: false,
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
    const conf = Number.isFinite(Number(r.confidence)) ? Number(r.confidence) : 0.5;
    const edgeProv = r.provenance || (conf >= 0.85 ? 'parser' : 'heuristic');
    const w = (weights[kind] || 2.0) * (conf || 0.5);
    entry.structuralScore += w;
    if (conf > entry.maxRelConfidence) entry.maxRelConfidence = conf;
    if (edgeProv === 'parser') entry.hasVerifiedRel = true;
    entry.reasons.add(`${direction}_${kind}`);
    entry.relationships.push({
      type: `${direction}_edge`,
      kind,
      specifier: r.specifier,
      symbol: r.target_sym_name || r.source_sym_name || '',
      confidence: Number(conf.toFixed(4)),
      provenance: edgeProv
    });
  }
}

function _recordRefRows(byFileId, rows, direction) {
  for (const r of rows) {
    const entry = _ensureEntry(byFileId, r);
    const conf = Number.isFinite(Number(r.confidence)) ? Number(r.confidence) : 0.65;
    const w = Math.min(2.6, 0.9 + 0.4 * Number(r.ref_count || 1));
    entry.structuralScore += w;
    if (conf > entry.maxRelConfidence) entry.maxRelConfidence = conf;
    entry.reasons.add('shared_symbol_ref');
    entry.relationships.push({
      type: 'shared_symbol_ref',
      direction,
      symbols: String(r.symbols || '').split(',').filter(Boolean).slice(0, 8),
      confidence: Number(conf.toFixed(4)),
      provenance: conf >= 0.8 ? 'parser' : 'heuristic'
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
           c.body, f.content_kind, f.content_hash, f.parser_version, f.metrics_json,
           s.name AS symbol_name
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
    const contentHash = entry.contentHash || (rep && (rep.contentHash || rep.content_hash)) || '';
    const parserVersion = entry.parserVersion || (rep && (rep.parserVersion || rep.parser_version)) || '';
    const metricsJson = (entry.metricsJson && entry.metricsJson !== '{}')
      ? entry.metricsJson
      : ((rep && (rep.metricsJson || rep.metrics_json)) || '{}');
    const fileProv = provenance.buildHitProvenance({
      content_hash: contentHash,
      parser_version: parserVersion,
      metrics_json: metricsJson
    });
    const relConfidence = entry.maxRelConfidence > 0
      ? entry.maxRelConfidence
      : (vecHit ? Math.max(0.4, Number(vecHit.score || 0)) : fileProv.confidence);
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
      relationships: entry.relationships,
      contentHash: fileProv.contentHash,
      parseEngine: fileProv.parseEngine,
      parserVersion: fileProv.parserVersion,
      provenance: entry.hasVerifiedRel ? 'parser' : (entry.relationships.length > 0 ? 'heuristic' : fileProv.provenance),
      confidence: Number(relConfidence.toFixed(4))
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
    provenance: c.provenance || 'heuristic',
    confidence: c.confidence !== undefined ? c.confidence : 0.6,
    parseEngine: c.parseEngine || '',
    contentHash: c.contentHash || '',
    snippet: _snippet(c.body)
  };
}

function _buildRelatedEnvelopeMeta(conn, anchor) {
  const rootRow = anchor.root || conn.prepare('SELECT * FROM code_index_roots WHERE root_hash = ?').get(anchor.file.root_hash);
  const anchorProv = provenance.buildHitProvenance(anchor.file);
  return {
    anchor: {
      relPath: anchor.relPath,
      rootHash: anchor.file.root_hash,
      language: anchor.file.language,
      symbol: anchor.symbol ? anchor.symbol.name : '',
      contentHash: anchorProv.contentHash,
      parseEngine: anchorProv.parseEngine,
      provenance: anchorProv.provenance
    },
    snapshot: provenance.buildSnapshotMetadata(rootRow)
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
    ..._buildRelatedEnvelopeMeta(conn, anchor),
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
async function _fetchSemanticRelated(conn, anchor, params) {
  try {
    const semRes = await _collectSemanticRelated(conn, anchor, params);
    return {
      vecBestByFile: semRes.vecBestByFile,
      semanticRankIds: semRes.semanticRankIds,
      semanticReason: null
    };
  } catch (err) {
    if (!_isSemanticUnavailableError(err)) throw err;
    return {
      vecBestByFile: new Map(),
      semanticRankIds: [],
      semanticReason: err.message
    };
  }
}

async function _applyRelatedRerank(anchor, anchorBody, pool, limit) {
  try {
    const queryHeader = [anchor.relPath, anchor.symbol ? anchor.symbol.name : ''].filter(Boolean).join(' | ');
    const anchorQuery = `${queryHeader}\n${anchorBody.slice(0, 800)}`.trim();
    const reranked = await rerank(anchorQuery, pool, { topK: limit });
    return {
      didRerank: true,
      semanticReason: null,
      finalItems: reranked.map((c) => {
        const combined = Number((0.55 * (c.rrfNorm || 0) + 0.45 * (c.rerank_score || 0)).toFixed(6));
        return _formatRelatedItem(c, combined);
      })
    };
  } catch (err) {
    if (!_isSemanticUnavailableError(err)) throw err;
    return { didRerank: false, finalItems: null, semanticReason: err.message };
  }
}

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

  const wantSemantic = options.semantic !== false;
  const wantRerank = options.rerank !== false;
  const runtime = (wantSemantic || wantRerank) ? getRuntimeStatus() : null;
  let semanticReason = wantSemantic && runtime && !runtime.available
    ? (runtime.reason || 'semantic runtime unavailable')
    : null;

  let vecBestByFile = new Map();
  let semanticRankIds = [];
  if (wantSemantic && runtime && runtime.available && isSemanticSearchEnabled()) {
    const semOut = await _fetchSemanticRelated(conn, anchor, { anchorChunks, focused, anchorBody, modelRepo, candidateK, byFileId });
    vecBestByFile = semOut.vecBestByFile;
    semanticRankIds = semOut.semanticRankIds;
    if (semOut.semanticReason) semanticReason = semOut.semanticReason;
  }

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
      degraded: Boolean(semanticReason),
      ...(semanticReason ? { reason: semanticReason } : {})
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
  const rerankCapable = wantRerank
    && runtime
    && runtime.available
    && isSemanticSearchEnabled()
    && (!runtime.offline || (runtime.rerankModel && runtime.rerankModel.cached));
  if (wantRerank && !semanticReason && !rerankCapable) {
    semanticReason = (runtime && runtime.reason) || 'rerank runtime unavailable';
  }
  let didRerank = false;
  let finalItems = null;
  if (rerankCapable && pool.length > 0 && !semanticReason) {
    const rerankOut = await _applyRelatedRerank(anchor, anchorBody, pool, limit);
    didRerank = rerankOut.didRerank;
    finalItems = rerankOut.finalItems;
    if (rerankOut.semanticReason) semanticReason = rerankOut.semanticReason;
  }
  if (!finalItems) {
    finalItems = pool.slice(0, limit).map((c) => _formatRelatedItem(c, Number(c.rrfNorm.toFixed(6))));
  }

  return {
    ..._buildRelatedEnvelopeMeta(conn, anchor),
    related: finalItems,
    total: finalItems.length,
    semantic_applied: semanticRankIds.length > 0,
    reranked: didRerank,
    degraded: Boolean(semanticReason),
    ...(semanticReason ? { reason: semanticReason } : {})
  };
}

module.exports = {
  related,
  relatedAsync
};
