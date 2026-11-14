'use strict';

/**
 * Persistence for the code-intelligence index.
 *
 * Every write path here is scoped to one `root_hash`, so re-indexing a project
 * can never delete another project's rows. Deletes cascade from
 * `code_index_roots` (foreign keys are ON at the connection level).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dbModule = require('../db');
const { getConnection, setupSchema } = dbModule;
const { hasFts5Support } = require('../db_schema');

let _conn = null;
let _connPath = null;
const _vectorSlabs = new Map();

function openConnection() {
  if (_conn && _connPath === dbModule.DB_PATH) return _conn;
  const conn = getConnection();
  _conn = conn;
  _connPath = dbModule.DB_PATH;
  const present = conn.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'code_index_roots'"
  ).get();
  if (!present) setupSchema(conn);
  return conn;
}

function closeConnection() {
  if (_conn) {
    try { _conn.close(); } catch (_) { /* ignore close error during shutdown */ }
    _conn = null;
    _connPath = null;
  }
  invalidateVectorSlab();
}

function invalidateVectorSlab(rootHash = null) {
  if (rootHash) _vectorSlabs.delete(rootHash);
  else _vectorSlabs.clear();
}

function computeRootHash(rootPath) {
  if (!rootPath || !String(rootPath).trim()) return null;
  const trimmed = String(rootPath).trim();
  let canonical = path.resolve(trimmed);
  try {
    if (fs.existsSync(canonical)) canonical = fs.realpathSync(canonical);
  } catch (_) { /* intentional best-effort fallback */ }
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 12);
}

function contentHash(input) {
  return Buffer.isBuffer(input)
    ? crypto.createHash('sha256').update(input).digest('hex')
    : crypto.createHash('sha256').update(String(input || ''), 'utf8').digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function _readGitPackedRef(gitDir, refPath) {
  const packedFile = path.join(gitDir, 'packed-refs');
  if (!fs.existsSync(packedFile)) return '';
  const lines = fs.readFileSync(packedFile, 'utf8').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('^')) continue;
    const space = line.indexOf(' ');
    if (space > 0 && line.slice(space + 1).trim() === refPath) {
      return line.slice(0, space).trim();
    }
  }
  return '';
}

function _resolveGitDir(rootPath) {
  const dotGit = path.join(rootPath, '.git');
  if (!fs.existsSync(dotGit)) return null;
  const stat = fs.lstatSync(dotGit);
  if (stat.isDirectory()) return { gitDir: dotGit, commonDir: dotGit };
  if (!stat.isFile()) return null;
  const pointer = fs.readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+)$/im);
  if (!pointer) return null;
  const gitDir = path.resolve(rootPath, pointer[1].trim());
  let commonDir = gitDir;
  const commonFile = path.join(gitDir, 'commondir');
  if (fs.existsSync(commonFile)) {
    const rel = fs.readFileSync(commonFile, 'utf8').trim();
    if (rel) commonDir = path.resolve(gitDir, rel);
  }
  return { gitDir, commonDir };
}

/**
 * Resolves the active Git commit SHA for `rootPath` without spawning git.
 * Handles regular `.git` directories, `.git` worktree `gitdir:` indirections,
 * `commondir`, and `packed-refs`.
 */
function resolveGitHeadSha(rootPath) {
  try {
    const dirs = _resolveGitDir(rootPath);
    if (!dirs) return '';
    const headFile = path.join(dirs.gitDir, 'HEAD');
    if (!fs.existsSync(headFile)) return '';
    const head = fs.readFileSync(headFile, 'utf8').trim();
    if (/^[0-9a-f]{40,64}$/i.test(head)) return head;
    if (!head.startsWith('ref:')) return '';
    const refPath = head.slice(4).trim();
    for (const dir of [dirs.gitDir, dirs.commonDir]) {
      const refFile = path.join(dir, refPath);
      if (fs.existsSync(refFile)) return fs.readFileSync(refFile, 'utf8').trim();
      const packed = _readGitPackedRef(dir, refPath);
      if (packed) return packed;
    }
    return '';
  } catch (_) {
    return '';
  }
}

function ensureRoot(conn, rootPath) {
  const rootHash = computeRootHash(rootPath);
  if (!rootHash) throw new Error('code_intel: root path is required');
  const canonical = fs.existsSync(rootPath) ? fs.realpathSync(rootPath) : path.resolve(rootPath);

  const existing = conn.prepare('SELECT * FROM code_index_roots WHERE root_hash = ?').get(rootHash);
  if (existing) {
    if (existing.root_path !== canonical) {
      conn.prepare('UPDATE code_index_roots SET root_path = ?, updated_at = ? WHERE root_hash = ?')
        .run(canonical, nowIso(), rootHash);
    }
    return rootHash;
  }
  conn.prepare(`INSERT INTO code_index_roots
      (root_hash, root_path, head_sha, status, file_count, symbol_count, chunk_count, indexed_epoch_ms, indexed_at, updated_at, error)
      VALUES (?, ?, '', 'stale', 0, 0, 0, 0, NULL, ?, '')`)
    .run(rootHash, canonical, nowIso());
  return rootHash;
}

function markRootStatus(conn, rootHash, status, error) {
  conn.prepare('UPDATE code_index_roots SET status = ?, error = ?, updated_at = ? WHERE root_hash = ?')
    .run(status, error || '', nowIso(), rootHash);
}

function clearRoot(conn, rootHash) {
  conn.prepare('DELETE FROM code_files WHERE root_hash = ?').run(rootHash);
  conn.prepare(`UPDATE code_index_roots
      SET file_count = 0, symbol_count = 0, chunk_count = 0, indexed_epoch_ms = indexed_epoch_ms + 1, indexed_at = NULL, updated_at = ?
      WHERE root_hash = ?`).run(nowIso(), rootHash);
  invalidateVectorSlab(rootHash);
}

function getFileRecord(conn, rootHash, relPath) {
  return conn.prepare('SELECT * FROM code_files WHERE root_hash = ? AND rel_path = ?').get(rootHash, relPath);
}

function touchFileStats(conn, fileId, file) {
  conn.prepare('UPDATE code_files SET mtime_ms = ?, ctime_ms = ?, inode_id = ?, content_kind = ? WHERE id = ?')
    .run(file.mtimeMs || 0, file.ctimeMs || 0, file.inodeId || '', file.contentKind || 'code', fileId);
}

function _collectPrevChunkEmbeddings(conn, fileId, preferredModel) {
  const prevChunks = conn.prepare(
    "SELECT content_hash, embedding, embedding_model FROM code_chunks WHERE file_id = ? AND embedding IS NOT NULL AND embedding_model IS NOT NULL AND content_hash != ''"
  ).all(fileId);
  const byHash = new Map();
  for (const c of prevChunks) {
    if (preferredModel && c.embedding_model !== preferredModel) continue;
    if (!byHash.has(c.content_hash)) byHash.set(c.content_hash, []);
    byHash.get(c.content_hash).push({ embedding: c.embedding, model: c.embedding_model });
  }
  return byHash;
}

function _insertEdgesForFile(conn, rootHash, fileId, imports, symbolByName) {
  conn.prepare('DELETE FROM code_edges WHERE source_file_id = ?').run(fileId);
  if (!Array.isArray(imports) || imports.length === 0) return;
  const insertEdge = conn.prepare(`INSERT INTO code_edges
      (root_hash, source_file_id, source_symbol_id, target_file_id, target_symbol_id, edge_kind, specifier, confidence)
      VALUES (?, ?, ?, NULL, NULL, ?, ?, ?)`);
  for (const imp of imports) {
    const srcSymId = imp.sourceSymbolName ? (symbolByName.get(imp.sourceSymbolName) || null) : null;
    if (Array.isArray(imp.names) && imp.names.length > 0 && (imp.edgeKind === 'extends' || imp.edgeKind === 'implements')) {
      for (const targetName of imp.names) {
        insertEdge.run(rootHash, fileId, srcSymId, imp.edgeKind, targetName, 0.5);
      }
    } else if (imp.specifier) {
      insertEdge.run(rootHash, fileId, srcSymId, imp.edgeKind || 'imports', imp.specifier, 0.5);
    }
  }
}

function writeFile(conn, rootHash, file, parsed, chunks) {
  const metricsJson = JSON.stringify({
    symbols: parsed.symbols.length,
    refs: parsed.refs.length,
    chunks: chunks.length,
    engine: parsed.parseEngine || 'lexer'
  });

  const tx = conn.transaction(() => {
    let row = getFileRecord(conn, rootHash, file.relPath);
    let prevEmbeddings = new Map();
    const fileMetaArgs = [
      file.language,
      file.byteSize,
      file.lineCount,
      file.contentHash,
      file.mtimeMs || 0,
      file.ctimeMs || 0,
      file.inodeId || '',
      file.parserVersion || '',
      file.contentKind || 'code',
      metricsJson,
      nowIso()
    ];

    if (row) {
      prevEmbeddings = _collectPrevChunkEmbeddings(conn, row.id, file.preferredEmbeddingModel || null);
      conn.prepare(`UPDATE code_files
          SET language = ?, byte_size = ?, line_count = ?, content_hash = ?,
              mtime_ms = ?, ctime_ms = ?, inode_id = ?, parser_version = ?,
              content_kind = ?, metrics_json = ?, indexed_at = ?
          WHERE id = ?`)
        .run(...fileMetaArgs, row.id);
      conn.prepare('DELETE FROM code_symbols WHERE file_id = ?').run(row.id);
      conn.prepare('DELETE FROM code_refs WHERE file_id = ?').run(row.id);
      conn.prepare('DELETE FROM code_chunks WHERE file_id = ?').run(row.id);
    } else {
      const res = conn.prepare(`INSERT INTO code_files
          (root_hash, rel_path, language, byte_size, line_count, content_hash,
           mtime_ms, ctime_ms, inode_id, parser_version, content_kind, metrics_json, indexed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(rootHash, file.relPath, ...fileMetaArgs);
      row = { id: Number(res.lastInsertRowid) };
    }

    const insertSymbol = conn.prepare(`INSERT INTO code_symbols
        (root_hash, file_id, name, kind, parent_name, start_line, end_line, signature, language)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const symbolIds = new Map();
    const symbolByName = new Map();
    for (const sym of parsed.symbols) {
      const res = insertSymbol.run(
        rootHash, row.id, sym.name, sym.kind, sym.parentName || '',
        sym.startLine, sym.endLine, sym.signature || '', sym.language
      );
      const id = Number(res.lastInsertRowid);
      const key = `${sym.name}:${sym.kind}:${sym.startLine}`;
      if (!symbolIds.has(key)) symbolIds.set(key, id);
      if (!symbolByName.has(sym.name)) symbolByName.set(sym.name, id);
    }

    const localByName = new Map();
    for (const sym of parsed.symbols) {
      if (!localByName.has(sym.name)) localByName.set(sym.name, []);
      localByName.get(sym.name).push(sym);
    }

    const insertRef = conn.prepare(`INSERT INTO code_refs
        (root_hash, file_id, target_name, target_symbol_id, kind, line)
        VALUES (?, ?, ?, ?, ?, ?)`);
    for (const ref of parsed.refs) {
      const candidates = localByName.get(ref.targetName);
      let targetId = null;
      if (candidates && candidates.length === 1) {
        const c = candidates[0];
        targetId = symbolIds.get(`${c.name}:${c.kind}:${c.startLine}`) || null;
      }
      insertRef.run(rootHash, row.id, ref.targetName, targetId, ref.kind, ref.line);
    }

    const insertChunk = conn.prepare(`INSERT INTO code_chunks
        (root_hash, file_id, rel_path, language, chunk_index, start_line, end_line,
         body, chunk_kind, symbol_id, content_hash, embedding, embedding_model)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    chunks.forEach((chunk, idx) => {
      const cHash = chunk.contentHash || contentHash(chunk.body || '');
      const symId = chunk.symbolName ? (symbolByName.get(chunk.symbolName) || null) : null;
      const queue = prevEmbeddings.get(cHash);
      const reused = queue && queue.length > 0 ? queue.shift() : null;
      insertChunk.run(
        rootHash,
        row.id,
        file.relPath,
        file.language,
        idx,
        chunk.startLine,
        chunk.endLine,
        chunk.body,
        chunk.chunkKind || 'block',
        symId,
        cHash,
        reused ? reused.embedding : null,
        reused ? reused.model : null
      );
    });

    _insertEdgesForFile(conn, rootHash, row.id, parsed.imports || [], symbolByName);
    return row.id;
  });
  const fileId = tx();
  invalidateVectorSlab(rootHash);
  return fileId;
}

function finalizeRoot(conn, rootHash, headSha = '') {
  const counts = conn.prepare(`SELECT
      (SELECT COUNT(*) FROM code_files WHERE root_hash = ?) AS files,
      (SELECT COUNT(*) FROM code_symbols WHERE root_hash = ?) AS symbols,
      (SELECT COUNT(*) FROM code_chunks WHERE root_hash = ?) AS chunks,
      (SELECT COUNT(*) FROM code_edges WHERE root_hash = ?) AS edges`).get(rootHash, rootHash, rootHash, rootHash);
  const existing = conn.prepare('SELECT indexed_epoch_ms, root_path FROM code_index_roots WHERE root_hash = ?').get(rootHash);
  const nextEpoch = Math.max(Date.now(), ((existing && existing.indexed_epoch_ms) || 0) + 1);
  const resolvedSha = headSha || (existing && existing.root_path ? resolveGitHeadSha(existing.root_path) : '');

  conn.prepare(`UPDATE code_index_roots
      SET status = 'fresh', file_count = ?, symbol_count = ?, chunk_count = ?,
          head_sha = ?, indexed_epoch_ms = ?, indexed_at = ?, updated_at = ?, error = ''
      WHERE root_hash = ?`)
    .run(counts.files, counts.symbols, counts.chunks, resolvedSha, nextEpoch, nowIso(), nowIso(), rootHash);
  invalidateVectorSlab(rootHash);
  return { ...counts, headSha: resolvedSha, indexedEpochMs: nextEpoch };
}

function getRoot(conn, rootPath) {
  const rootHash = computeRootHash(rootPath);
  if (!rootHash) return null;
  return conn.prepare('SELECT * FROM code_index_roots WHERE root_hash = ?').get(rootHash);
}

function listRoots(conn) {
  return conn.prepare('SELECT * FROM code_index_roots ORDER BY updated_at DESC').all();
}

function removeRoot(conn, rootPath) {
  const rootHash = computeRootHash(rootPath);
  if (!rootHash) return false;
  const existing = conn.prepare('SELECT root_hash FROM code_index_roots WHERE root_hash = ?').get(rootHash);
  if (!existing) return false;
  conn.prepare('DELETE FROM code_index_roots WHERE root_hash = ?').run(rootHash);
  invalidateVectorSlab(rootHash);
  return true;
}

function attachEmbeddings(conn, rootHash, fileId, model, vectors) {
  if (!model || typeof model !== 'string' || !model.trim()) {
    throw new Error('code_intel: embedding_model is required; hash-derived vectors are not semantic embeddings');
  }
  const rows = conn.prepare('SELECT id FROM code_chunks WHERE root_hash = ? AND file_id = ? ORDER BY chunk_index').all(rootHash, fileId);
  const update = conn.prepare('UPDATE code_chunks SET embedding = ?, embedding_model = ? WHERE id = ?');
  const tx = conn.transaction(() => {
    const limit = Math.min(rows.length, vectors.length);
    for (let i = 0; i < limit; i++) {
      const buf = Buffer.from(new Float32Array(vectors[i]).buffer);
      update.run(buf, model, rows[i].id);
    }
  });
  tx();
  invalidateVectorSlab(rootHash);
}

function getUnembeddedChunks(conn, rootHash, model) {
  return conn.prepare(`
    SELECT c.id, c.file_id, c.rel_path, c.language, c.start_line, c.end_line,
           c.body, c.chunk_kind, c.content_hash, s.name AS symbol_name
    FROM code_chunks c
    LEFT JOIN code_symbols s ON s.id = c.symbol_id
    WHERE c.root_hash = ? AND (c.embedding IS NULL OR c.embedding_model IS NULL OR c.embedding_model != ?)
    ORDER BY c.file_id ASC, c.chunk_index ASC
  `).all(rootHash, model);
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

function getVectorSlab(conn, rootHash, model) {
  if (!rootHash || !model) return null;
  const cached = _vectorSlabs.get(rootHash);
  if (cached && cached.model === model) return cached;

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
  const meta = valid.map((r, i) => {
    const buf = r.embedding;
    const rawVec = new Float32Array(buf.buffer, buf.byteOffset, dim);
    vectors.set(_toUnitFloat32(rawVec), i * dim);
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

  const slab = { model, dim, count: meta.length, vectors, meta };
  _vectorSlabs.set(rootHash, slab);
  return slab;
}

function _scoreSlabHits(slab, unitQuery, options, out) {
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
    out.push({ ...m, score: dot });
  }
}

function searchVectorCandidates(conn, rootHash, queryVec, options = {}) {
  if (!queryVec || !queryVec.length || !options.model) return [];
  const unitQuery = _toUnitFloat32(queryVec);
  const limit = Math.max(1, Number(options.limit) || 40);
  const roots = rootHash
    ? [rootHash]
    : listRoots(conn).map((r) => r.root_hash);
  const scored = [];
  for (const rh of roots) {
    _scoreSlabHits(getVectorSlab(conn, rh, options.model), unitQuery, options, scored);
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function getFileGraphNeighbors(conn, fileId) {
  const outgoing = conn.prepare(`
    SELECT e.target_file_id AS file_id, f.rel_path, f.language, f.content_kind,
           e.edge_kind, e.specifier, e.confidence,
           tgt.name AS target_sym_name, src.name AS source_sym_name
    FROM code_edges e
    JOIN code_files f ON f.id = e.target_file_id
    LEFT JOIN code_symbols tgt ON tgt.id = e.target_symbol_id
    LEFT JOIN code_symbols src ON src.id = e.source_symbol_id
    WHERE e.source_file_id = ? AND e.target_file_id IS NOT NULL AND e.target_file_id != ?
  `).all(fileId, fileId);

  const incoming = conn.prepare(`
    SELECT e.source_file_id AS file_id, f.rel_path, f.language, f.content_kind,
           e.edge_kind, e.specifier, e.confidence,
           tgt.name AS target_sym_name, src.name AS source_sym_name
    FROM code_edges e
    JOIN code_files f ON f.id = e.source_file_id
    LEFT JOIN code_symbols tgt ON tgt.id = e.target_symbol_id
    LEFT JOIN code_symbols src ON src.id = e.source_symbol_id
    WHERE e.target_file_id = ? AND e.source_file_id != ?
  `).all(fileId, fileId);

  const sharedImports = conn.prepare(`
    SELECT e2.source_file_id AS file_id, f.rel_path, f.language, f.content_kind,
           COUNT(DISTINCT e2.specifier) AS shared_count,
           GROUP_CONCAT(DISTINCT e2.specifier) AS specifiers
    FROM code_edges e1
    JOIN code_edges e2 ON e2.root_hash = e1.root_hash
      AND ((e1.target_file_id IS NOT NULL AND e2.target_file_id = e1.target_file_id)
        OR (e1.target_file_id IS NULL AND e2.specifier = e1.specifier))
    JOIN code_files f ON f.id = e2.source_file_id
    WHERE e1.source_file_id = ? AND e2.source_file_id != ?
    GROUP BY e2.source_file_id
    ORDER BY shared_count DESC
    LIMIT 40
  `).all(fileId, fileId);

  const inboundRefs = conn.prepare(`
    SELECT r.file_id, f.rel_path, f.language, f.content_kind,
           COUNT(*) AS ref_count, GROUP_CONCAT(DISTINCT r.target_name) AS symbols
    FROM code_symbols s
    JOIN code_refs r ON r.root_hash = s.root_hash AND r.target_name = s.name
    JOIN code_files f ON f.id = r.file_id
    WHERE s.file_id = ? AND r.file_id != ?
    GROUP BY r.file_id
    ORDER BY ref_count DESC
    LIMIT 40
  `).all(fileId, fileId);

  const outboundRefs = conn.prepare(`
    SELECT s.file_id, f.rel_path, f.language, f.content_kind,
           COUNT(*) AS ref_count, GROUP_CONCAT(DISTINCT r.target_name) AS symbols
    FROM code_refs r
    JOIN code_symbols s ON s.root_hash = r.root_hash AND s.name = r.target_name
    JOIN code_files f ON f.id = s.file_id
    WHERE r.file_id = ? AND s.file_id != ?
    GROUP BY s.file_id
    ORDER BY ref_count DESC
    LIMIT 40
  `).all(fileId, fileId);

  return { outgoing, incoming, sharedImports, inboundRefs, outboundRefs };
}

function getFileSummariesByRoot(conn, rootHash) {
  return rootHash
    ? conn.prepare('SELECT id, root_hash, rel_path, language, content_kind FROM code_files WHERE root_hash = ?').all(rootHash)
    : conn.prepare('SELECT id, root_hash, rel_path, language, content_kind FROM code_files').all();
}

function writeChunkEmbeddingsById(conn, rootHash, model, pairs) {
  if (!model || typeof model !== 'string' || !model.trim()) {
    throw new Error('code_intel: embedding_model is required; hash-derived vectors are not semantic embeddings');
  }
  if (!Array.isArray(pairs) || pairs.length === 0) return 0;
  const update = conn.prepare('UPDATE code_chunks SET embedding = ?, embedding_model = ? WHERE id = ? AND root_hash = ?');
  const tx = conn.transaction(() => {
    for (const p of pairs) {
      const vec = p.vector instanceof Float32Array ? p.vector : new Float32Array(p.vector);
      const buf = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
      update.run(buf, model, p.chunkId, rootHash);
    }
  });
  tx();
  invalidateVectorSlab(rootHash);
  return pairs.length;
}

function ftsAvailable(conn) {
  try {
    conn.prepare('SELECT 1 FROM code_chunks_fts LIMIT 1').get();
    return true;
  } catch (_) {
    return hasFts5Support(conn) && true;
  }
}

function normalizeContentFilter(raw) {
  const key = String(raw || '').trim().toLowerCase();
  if (!key || key === 'all') return null;
  if (key === 'doc' || key === 'docs' || key === 'markdown') return 'docs';
  if (key === 'test' || key === 'tests' || key === 'spec') return 'test';
  if (key === 'code' || key === 'src' || key === 'source') return 'code';
  if (key === 'config') return 'config';
  return key;
}

module.exports = {
  normalizeContentFilter,
  _vectorSlabs,
  invalidateVectorSlab,
  computeRootHash,
  contentHash,
  resolveGitHeadSha,
  ensureRoot,
  markRootStatus,
  clearRoot,
  getFileRecord,
  touchFileStats,
  writeFile,
  finalizeRoot,
  getRoot,
  listRoots,
  removeRoot,
  attachEmbeddings,
  getUnembeddedChunks,
  getVectorSlab,
  searchVectorCandidates,
  getFileGraphNeighbors,
  getFileSummariesByRoot,
  writeChunkEmbeddingsById,
  ftsAvailable,
  openConnection,
  closeConnection
};
