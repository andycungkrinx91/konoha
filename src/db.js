/**
 * Canonical database access layer for Konoha (skills.db) using the built-in node:sqlite driver.
 * Owns DB_PATH, connection pragmas, vector extension loading, and the unified schema.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('./sqlite_driver');

// Single canonical declaration of DB_PATH.
// KONOHA_DB_PATH env override (set by the test runner / test suites) isolates
// test runs from the production database — without it, SDLC/workflow tests
// wrote hundreds of junk task rows into ~/.konoha/konoha.db, flooding the
// web UI /tasks dashboard.
let currentDbPath = process.env.KONOHA_DB_PATH
  ? path.normalize(process.env.KONOHA_DB_PATH)
  : path.normalize(path.join(os.homedir(), '.konoha', 'konoha.db'));

function _migrateLegacySkillsDb(dir, targetPath) {
  if (fs.existsSync(targetPath)) return;
  const legacyPath = path.join(dir, 'skills.db');
  if (!fs.existsSync(legacyPath)) return;
  try {
    fs.copyFileSync(legacyPath, targetPath);
    if (fs.existsSync(legacyPath + '-wal')) {
      try { fs.copyFileSync(legacyPath + '-wal', targetPath + '-wal'); } catch (_) { /* intentional best-effort fallback */ }
    }
    if (fs.existsSync(legacyPath + '-shm')) {
      try { fs.copyFileSync(legacyPath + '-shm', targetPath + '-shm'); } catch (_) { /* intentional best-effort fallback */ }
    }
  } catch (_) { /* intentional best-effort fallback */ }
}

function _loadVectorSearchExtension(db) {
  try {
    const vectorSearch = require('./vector_search');
    const enabled = vectorSearch.isSemanticSearchEnabled && vectorSearch.isSemanticSearchEnabled();
    if (enabled && typeof vectorSearch.loadVectorExtension === 'function') {
      vectorSearch.loadVectorExtension(db);
    }
  } catch (_) { /* intentional best-effort fallback */ }
}

/**
 * Opens connection, sets PRAGMA journal_mode=WAL, foreign_keys=ON, busy_timeout=5000,
 * synchronous=NORMAL, and conditionally loads sqlite-vector extension if present and enabled.
 */
function getConnection(dbPath = null, loadVector = true) {
  const targetPath = path.normalize(dbPath !== null ? dbPath : currentDbPath);
  const dir = path.dirname(path.resolve(targetPath));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  _migrateLegacySkillsDb(dir, targetPath);

  const db = new Database(targetPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');

  if (loadVector) {
    _loadVectorSearchExtension(db);
  }

  return db;
}

const dbSchema = require('./db_schema');

function hasFts5Support(conn) {
  return dbSchema.hasFts5Support(conn);
}

function setupSchema(conn) {
  return dbSchema.setupSchema(conn, backupDatabase);
}

function validateCanonicalSchema(conn) {
  return dbSchema.validateCanonicalSchema(conn);
}

function _replaceNearMatch(match, nears) {
  const validPattern = /^NEAR\(\s*[a-zA-Z0-9_-]+(?:\s+[a-zA-Z0-9_-]+)+(?:\s*,\s*\d+)?\s*\)$/i;
  const innerMatch = match.match(/\(([^)]*)\)/);
  const innerText = innerMatch ? innerMatch[1] : '';
  if (validPattern.test(match)) {
    const innerCleaned = innerText.trim().split(/\s+/).join(' ');
    const placeholder = `__NEAR_PLACEHOLDER_${nears.length}__`;
    nears.push(`NEAR(${innerCleaned})`);
    return placeholder;
  }
  return `near ${innerText}`;
}

function _isDanglingOperator(words, i) {
  if (i === 0 || i === words.length - 1) return true;
  const prevW = words[i - 1].toUpperCase();
  const nextW = words[i + 1].toUpperCase();
  return ['AND', 'OR', 'NOT'].includes(prevW) || ['AND', 'OR', 'NOT'].includes(nextW);
}

function _sanitizeWord(words, i) {
  const w = words[i];
  const wUpper = w.toUpperCase();
  if (['AND', 'OR', 'NOT'].includes(wUpper)) {
    return _isDanglingOperator(words, i) ? w.toLowerCase() : wUpper;
  }
  if (wUpper === 'NEAR') {
    return w.toLowerCase();
  }
  return w;
}

function sanitizeFts5Query(query) {
  if (!query || typeof query !== 'string') return '';
  let q = query.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  const nears = [];
  q = q.replace(/\bNEAR\s*\(([^)]*)\)/gi, (match) => _replaceNearMatch(match, nears));

  q = q.replace(/[^\p{L}\p{N}_\s*()"]/gu, ' ');
  if ((q.match(/"/g) || []).length % 2 !== 0) {
    q = q.replace(/"/g, ' ');
  }
  if ((q.match(/\(/g) || []).length !== (q.match(/\)/g) || []).length) {
    q = q.replace(/[()]/g, ' ');
  }
  q = q.replace(/(?<![a-zA-Z0-9])\*/g, ' ');
  q = q.replace(/\*(?=[a-zA-Z0-9])/g, ' ');

  for (let i = 0; i < nears.length; i++) {
    q = q.replace(`__NEAR_PLACEHOLDER_${i}__`, nears[i]);
  }

  const words = q.trim().split(/\s+/).filter(Boolean);
  const sanitizedWords = words.map((_, i) => _sanitizeWord(words, i));
  return sanitizedWords.join(' ');
}

/**
 * Rebuilds all FTS5 full-text search indexes (skills_fts and persona_memories_fts).
 * Safe against missing tables or environments lacking FTS5 support.
 */
function rebuildAllFts(conn = null) {
  let shouldClose = false;
  if (!conn) {
    conn = getConnection();
    shouldClose = true;
  }
  try {
    if (!hasFts5Support(conn)) {
      return { rebuilt: false, reason: 'fts5_not_supported', tables: [] };
    }
    const rebuiltTables = [];
    try {
      conn.exec("INSERT INTO skills_fts(skills_fts) VALUES('rebuild')");
      rebuiltTables.push('skills_fts');
    } catch (_) { /* skills_fts may not exist yet */ }
    try {
      conn.exec("INSERT INTO persona_memories_fts(persona_memories_fts) VALUES('rebuild')");
      rebuiltTables.push('persona_memories_fts');
    } catch (_) { /* persona_memories_fts may not exist yet */ }
    return { rebuilt: rebuiltTables.length > 0, tables: rebuiltTables };
  } finally {
    if (shouldClose && conn) {
      try { conn.close(); } catch (_) { /* ignore close error */ }
    }
  }
}

/**
 * Creates an online SQLite database backup using VACUUM INTO.
 * Safe to execute concurrently while the daemon or transactions are active.
 * @param {string} targetPath - File path where the backup database will be saved.
 * @param {string|null} sourceDbPath - Optional path to the source database.
 * @param {boolean} overwrite - Whether to overwrite an existing backup file.
 * @returns {{ success: boolean, targetPath: string, sizeBytes: number }}
 */
function backupDatabase(targetPath = null, sourceDbPath = null, overwrite = true) {
  const src = path.normalize(sourceDbPath || currentDbPath);
  if (!fs.existsSync(src)) {
    throw new Error(`Source database does not exist: ${src}`);
  }

  let dest = targetPath;
  if (!dest) {
    const backupDir = path.join(path.dirname(src), 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    } else {
      try { fs.chmodSync(backupDir, 0o700); } catch (_) { /* ignore chmod error */ }
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    dest = path.join(backupDir, `konoha_backup_${timestamp}.db`);
  }

  dest = path.resolve(dest);
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
  } else {
    try { fs.chmodSync(destDir, 0o700); } catch (_) { /* ignore chmod error */ }
  }

  if (fs.existsSync(dest)) {
    if (overwrite) {
      fs.unlinkSync(dest);
    } else {
      throw new Error(`Backup target file already exists: ${dest}`);
    }
  }

  const conn = getConnection(src, false);
  try {
    conn.prepare("VACUUM INTO ?").run(dest);
    try { fs.chmodSync(dest, 0o600); } catch (_) { /* ignore chmod error */ }
    const stat = fs.statSync(dest);
    return {
      success: true,
      targetPath: dest,
      sizeBytes: stat.size
    };
  } finally {
    try { conn.close(); } catch (_) { /* ignore close error */ }
  }
}

module.exports = {
  get DB_PATH() { return currentDbPath; },
  set DB_PATH(val) {
    currentDbPath = val;
    if (val) process.env.KONOHA_DB_PATH = val;
    else delete process.env.KONOHA_DB_PATH;
  },
  backupDatabase,
  getConnection,
  get_connection: getConnection,
  getDb: getConnection,
  hasFts5Support,
  has_fts5_support: hasFts5Support,
  rebuildAllFts,
  sanitizeFts5Query,
  sanitize_fts5_query: sanitizeFts5Query,
  setupSchema,
  setup_schema: setupSchema,
  validateCanonicalSchema
};
