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

// One connection per database path: openConnection runs on every code_* call and
// nothing closes what it returns, so opening per call leaked a handle each time.
let _conn = null;
let _connPath = null;

/**
 * Returns the main connection with the code-intelligence schema present.
 *
 * `getConnection` only opens the file; migrations run through `setupSchema`.
 * The check is a single `sqlite_master` lookup, so a warm process pays almost
 * nothing and a fresh install migrates once.
 */
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

/** Canonical root key: realpath when the directory exists, sha256 prefix. */
function computeRootHash(rootPath) {
  if (!rootPath || !String(rootPath).trim()) return null;
  const trimmed = String(rootPath).trim();
  let canonical = path.resolve(trimmed);
  try {
    if (fs.existsSync(canonical)) canonical = fs.realpathSync(canonical);
  } catch (_) { /* intentional best-effort fallback */ }
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 12);
}

function contentHash(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Resolves the root row for `rootPath`.
 *
 * The code index lives in the main store only, and that guarantee is structural:
 * `openConnection()` goes through `src/db.js#getConnection()`, which refuses any
 * path `isLabDbPath()` accepts, and the lab schema has no `code_*` tables. There
 * is deliberately no separate check here — a second one would be a second thing
 * to keep true.
 */
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
      (root_hash, root_path, head_sha, status, file_count, symbol_count, chunk_count, indexed_at, updated_at, error)
      VALUES (?, ?, '', 'stale', 0, 0, 0, NULL, ?, '')`)
    .run(rootHash, canonical, nowIso());
  return rootHash;
}

function markRootStatus(conn, rootHash, status, error) {
  conn.prepare('UPDATE code_index_roots SET status = ?, error = ?, updated_at = ? WHERE root_hash = ?')
    .run(status, error || '', nowIso(), rootHash);
}

/** Drops every indexed row for one root, leaving the root row itself. */
function clearRoot(conn, rootHash) {
  conn.prepare('DELETE FROM code_files WHERE root_hash = ?').run(rootHash);
  conn.prepare(`UPDATE code_index_roots
      SET file_count = 0, symbol_count = 0, chunk_count = 0, indexed_at = NULL, updated_at = ?
      WHERE root_hash = ?`).run(nowIso(), rootHash);
}

function getFileRecord(conn, rootHash, relPath) {
  return conn.prepare('SELECT * FROM code_files WHERE root_hash = ? AND rel_path = ?').get(rootHash, relPath);
}

/**
 * Replaces one file's symbols, refs, and chunks in a single transaction.
 * Chunk FTS rows are maintained by triggers, so only `code_chunks` is written.
 */
function writeFile(conn, rootHash, file, parsed, chunks) {
  const tx = conn.transaction(() => {
    let row = getFileRecord(conn, rootHash, file.relPath);
    if (row) {
      conn.prepare(`UPDATE code_files SET language = ?, byte_size = ?, line_count = ?, content_hash = ?, indexed_at = ?
          WHERE id = ?`)
        .run(file.language, file.byteSize, file.lineCount, file.contentHash, nowIso(), row.id);
      conn.prepare('DELETE FROM code_symbols WHERE file_id = ?').run(row.id);
      conn.prepare('DELETE FROM code_refs WHERE file_id = ?').run(row.id);
      conn.prepare('DELETE FROM code_chunks WHERE file_id = ?').run(row.id);
    } else {
      const res = conn.prepare(`INSERT INTO code_files
          (root_hash, rel_path, language, byte_size, line_count, content_hash, indexed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(rootHash, file.relPath, file.language, file.byteSize, file.lineCount, file.contentHash, nowIso());
      row = { id: Number(res.lastInsertRowid) };
    }

    const insertSymbol = conn.prepare(`INSERT INTO code_symbols
        (root_hash, file_id, name, kind, parent_name, start_line, end_line, signature, language)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const symbolIds = new Map();
    for (const sym of parsed.symbols) {
      const res = insertSymbol.run(rootHash, row.id, sym.name, sym.kind, sym.parentName || '',
        sym.startLine, sym.endLine, sym.signature || '', sym.language);
      const key = `${sym.name}:${sym.kind}:${sym.startLine}`;
      if (!symbolIds.has(key)) symbolIds.set(key, Number(res.lastInsertRowid));
    }

    // Resolve a ref to a symbol in this same file when unambiguous; cross-file
    // resolution is deliberately left NULL so `code_impact` never guesses.
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
        (root_hash, file_id, rel_path, language, chunk_index, start_line, end_line, body)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    chunks.forEach((chunk, idx) => {
      insertChunk.run(rootHash, row.id, file.relPath, file.language, idx, chunk.startLine, chunk.endLine, chunk.body);
    });

    return row.id;
  });
  return tx();
}

function finalizeRoot(conn, rootHash) {
  const counts = conn.prepare(`SELECT
      (SELECT COUNT(*) FROM code_files WHERE root_hash = ?) AS files,
      (SELECT COUNT(*) FROM code_symbols WHERE root_hash = ?) AS symbols,
      (SELECT COUNT(*) FROM code_chunks WHERE root_hash = ?) AS chunks`).get(rootHash, rootHash, rootHash);
  conn.prepare(`UPDATE code_index_roots
      SET status = 'fresh', file_count = ?, symbol_count = ?, chunk_count = ?,
          indexed_at = ?, updated_at = ?, error = ''
      WHERE root_hash = ?`)
    .run(counts.files, counts.symbols, counts.chunks, nowIso(), nowIso(), rootHash);
  return counts;
}

function getRoot(conn, rootPath) {
  const rootHash = computeRootHash(rootPath);
  if (!rootHash) return null;
  return conn.prepare('SELECT * FROM code_index_roots WHERE root_hash = ?').get(rootHash);
}

function listRoots(conn) {
  return conn.prepare('SELECT * FROM code_index_roots ORDER BY updated_at DESC').all();
}

/** Deletes a root and every row beneath it. Returns false when absent. */
function removeRoot(conn, rootPath) {
  const rootHash = computeRootHash(rootPath);
  if (!rootHash) return false;
  const existing = conn.prepare('SELECT root_hash FROM code_index_roots WHERE root_hash = ?').get(rootHash);
  if (!existing) return false;
  conn.prepare('DELETE FROM code_index_roots WHERE root_hash = ?').run(rootHash);
  return true;
}

/** Stores semantic embeddings. Refuses to write without a model label. */
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
}

function ftsAvailable(conn) {
  try {
    conn.prepare('SELECT 1 FROM code_chunks_fts LIMIT 1').get();
    return true;
  } catch (_) {
    return hasFts5Support(conn) && true;
  }
}

module.exports = {
  computeRootHash,
  contentHash,
  ensureRoot,
  markRootStatus,
  clearRoot,
  getFileRecord,
  writeFile,
  finalizeRoot,
  getRoot,
  listRoots,
  removeRoot,
  attachEmbeddings,
  ftsAvailable,
  openConnection
};
