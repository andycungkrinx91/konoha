'use strict';

/**
 * Bounded LRU vector slab cache and keyset-paged cosine scanner for `code_chunks`.
 *
 * Prevents unbounded process RSS growth on large repositories by capping cached
 * roots/chunks/bytes and streaming SQLite pages when a root exceeds cache caps.
 */

const VECTOR_SLAB_MAX_ROOTS = 4;
const VECTOR_SLAB_MAX_CHUNKS_PER_ROOT = 16384;
const VECTOR_SLAB_MAX_BYTES = 64 * 1024 * 1024;
const VECTOR_SCAN_PAGE_SIZE = 2048;

const _vectorSlabs = new Map();

function invalidateVectorSlab(rootHash = null) {
  if (rootHash) _vectorSlabs.delete(rootHash);
  else _vectorSlabs.clear();
}

function _toUnitFloat32(raw) {
  const vec = raw instanceof Float32Array ? raw : new Float32Array(raw);
  let normSq = 0;
  for (let i = 0; i < vec.length; i++) normSq += vec[i] * vec[i];
  if (Math.abs(normSq - 1) <= 1e-3 || normSq <= 0) return vec;
  const inv = 1 / Math.sqrt(normSq);
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] * inv;
  return out;
}

function _totalCachedBytes() {
  let sum = 0;
  for (const s of _vectorSlabs.values()) sum += s.estimatedBytes || 0;
  return sum;
}

function _evictIfNeeded(incomingBytes, maxRoots, maxBytes) {
  while (_vectorSlabs.size > 0 && (_vectorSlabs.size >= maxRoots || _totalCachedBytes() + incomingBytes > maxBytes)) {
    const oldestKey = _vectorSlabs.keys().next().value;
    _vectorSlabs.delete(oldestKey);
  }
}

function _buildSlabFromRows(rows, model) {
  const valid = [];
  let dim = 0;
  for (const r of rows) {
    const buf = r.embedding;
    const byteLen = buf ? (buf.byteLength || buf.length || 0) : 0;
    if (byteLen < 16 || byteLen % 4 !== 0) continue;
    const rowDim = byteLen / 4;
    if (dim === 0) dim = rowDim;
    if (rowDim !== dim) continue;
    valid.push(r);
  }
  const vectors = new Float32Array(valid.length * dim);
  let metaBytes = 0;
  const meta = valid.map((r, i) => {
    const buf = r.embedding;
    const rawVec = new Float32Array(buf.buffer, buf.byteOffset, dim);
    vectors.set(_toUnitFloat32(rawVec), i * dim);
    metaBytes += 256 + (r.body ? r.body.length * 2 : 0);
    return {
      chunkId: r.chunk_id,
      fileId: r.file_id,
      relPath: r.rel_path,
      language: r.language,
      startLine: r.start_line,
      endLine: r.end_line,
      chunkKind: r.chunk_kind,
      contentKind: r.content_kind || 'code',
      symbolName: r.symbol_name || '',
      body: r.body
    };
  });
  return {
    model,
    dim,
    count: meta.length,
    vectors,
    meta,
    estimatedBytes: vectors.byteLength + metaBytes
  };
}

function getVectorSlab(conn, rootHash, model, options = {}) {
  if (!rootHash || !model) return null;
  const maxRoots = Math.max(1, Number(options.maxRoots) || VECTOR_SLAB_MAX_ROOTS);
  const maxChunks = Math.max(1, Number(options.maxChunksPerRoot) || VECTOR_SLAB_MAX_CHUNKS_PER_ROOT);
  const maxBytes = Math.max(1024, Number(options.maxCacheBytes) || VECTOR_SLAB_MAX_BYTES);

  const cached = _vectorSlabs.get(rootHash);
  if (cached && cached.model === model) {
    _vectorSlabs.delete(rootHash);
    _vectorSlabs.set(rootHash, cached);
    return cached;
  }

  const countRow = conn.prepare(`
    SELECT COUNT(*) AS n
    FROM code_chunks
    WHERE root_hash = ? AND embedding IS NOT NULL AND embedding_model = ?
  `).get(rootHash, model);
  const rowCount = countRow ? Number(countRow.n) : 0;
  if (rowCount > maxChunks) return null;

  const rows = conn.prepare(`
    SELECT c.id AS chunk_id, c.file_id, c.rel_path, c.language, c.start_line, c.end_line,
           c.chunk_kind, c.body, c.embedding, s.name AS symbol_name,
           COALESCE(f.content_kind, 'code') AS content_kind
    FROM code_chunks c
    LEFT JOIN code_files f ON f.id = c.file_id
    LEFT JOIN code_symbols s ON s.id = c.symbol_id
    WHERE c.root_hash = ? AND c.embedding IS NOT NULL AND c.embedding_model = ?
    ORDER BY c.id ASC
  `).all(rootHash, model);

  const slab = _buildSlabFromRows(rows, model);
  if (slab.estimatedBytes <= maxBytes) {
    if (_vectorSlabs.has(rootHash)) _vectorSlabs.delete(rootHash);
    _evictIfNeeded(slab.estimatedBytes, maxRoots, maxBytes);
    _vectorSlabs.set(rootHash, slab);
  }
  return slab;
}

function _pushTopCandidate(scored, item, cap) {
  if (scored.length < cap) {
    scored.push(item);
    if (scored.length === cap) scored.sort((a, b) => b.score - a.score);
    return;
  }
  if (item.score <= scored[cap - 1].score) return;
  scored[cap - 1] = item;
  scored.sort((a, b) => b.score - a.score);
}

function _scoreSlabHits(slab, unitQuery, options, out, cap) {
  if (!slab || slab.count === 0 || slab.dim !== unitQuery.length) return;
  const { dim, vectors, meta, count } = slab;
  const excludeFileIds = options.excludeFileIds || null;
  const contentKind = options.contentKind || null;
  for (let i = 0; i < count; i++) {
    const m = meta[i];
    if (excludeFileIds && excludeFileIds.has(m.fileId)) continue;
    if (contentKind && m.contentKind !== contentKind) continue;
    const base = i * dim;
    let dot = 0;
    for (let d = 0; d < dim; d++) dot += unitQuery[d] * vectors[base + d];
    _pushTopCandidate(out, { ...m, score: dot }, cap);
  }
}

function _searchPagedRoot({ conn, rootHash, model, unitQuery, options, out, cap }) {
  const pageSize = Math.max(1, Number(options.pageSize) || VECTOR_SCAN_PAGE_SIZE);
  const excludeFileIds = options.excludeFileIds || null;
  const contentKind = options.contentKind || null;
  const stmt = conn.prepare(`
    SELECT c.id AS chunk_id, c.file_id, c.rel_path, c.language, c.start_line, c.end_line,
           c.chunk_kind, c.body, c.embedding, s.name AS symbol_name,
           COALESCE(f.content_kind, 'code') AS content_kind
    FROM code_chunks c
    LEFT JOIN code_files f ON f.id = c.file_id
    LEFT JOIN code_symbols s ON s.id = c.symbol_id
    WHERE c.root_hash = ? AND c.embedding IS NOT NULL AND c.embedding_model = ? AND c.id > ?
    ORDER BY c.id ASC
    LIMIT ?
  `);

  let cursor = 0;
  const dimExpected = unitQuery.length;
  for (;;) {
    const rows = stmt.all(rootHash, model, cursor, pageSize);
    if (rows.length === 0) break;
    cursor = Number(rows[rows.length - 1].chunk_id);
    for (const r of rows) {
      const fid = r.file_id;
      const ck = r.content_kind || 'code';
      if (excludeFileIds && excludeFileIds.has(fid)) continue;
      if (contentKind && ck !== contentKind) continue;
      const buf = r.embedding;
      const byteLen = buf ? (buf.byteLength || buf.length || 0) : 0;
      if (byteLen !== dimExpected * 4) continue;
      const unitVec = _toUnitFloat32(new Float32Array(buf.buffer, buf.byteOffset, dimExpected));
      let dot = 0;
      for (let d = 0; d < dimExpected; d++) dot += unitQuery[d] * unitVec[d];
      _pushTopCandidate(out, {
        chunkId: r.chunk_id,
        fileId: fid,
        relPath: r.rel_path,
        language: r.language,
        startLine: r.start_line,
        endLine: r.end_line,
        chunkKind: r.chunk_kind,
        contentKind: ck,
        symbolName: r.symbol_name || '',
        body: r.body,
        score: dot
      }, cap);
    }
    if (rows.length < pageSize) break;
  }
}

function searchVectorCandidates(conn, rootHash, queryVec, options = {}, listRootsFn = null) {
  if (!queryVec || !queryVec.length || !options.model) return [];
  const unitQuery = _toUnitFloat32(queryVec);
  const limit = Math.max(1, Number(options.limit) || 40);
  let roots;
  if (rootHash) {
    roots = [rootHash];
  } else if (typeof listRootsFn === 'function') {
    roots = listRootsFn(conn).map((r) => r.root_hash);
  } else {
    roots = conn.prepare('SELECT root_hash FROM code_index_roots ORDER BY updated_at DESC').all().map((r) => r.root_hash);
  }

  const scored = [];
  for (const rh of roots) {
    const slab = getVectorSlab(conn, rh, options.model, options);
    if (slab) {
      _scoreSlabHits(slab, unitQuery, options, scored, limit);
    } else {
      _searchPagedRoot({ conn, rootHash: rh, model: options.model, unitQuery, options, out: scored, cap: limit });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

module.exports = {
  VECTOR_SLAB_MAX_ROOTS,
  VECTOR_SLAB_MAX_CHUNKS_PER_ROOT,
  VECTOR_SLAB_MAX_BYTES,
  VECTOR_SCAN_PAGE_SIZE,
  _vectorSlabs,
  invalidateVectorSlab,
  getVectorSlab,
  searchVectorCandidates
};
