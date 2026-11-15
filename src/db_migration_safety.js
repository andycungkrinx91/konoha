'use strict';

/**
 * src/db_migration_safety.js — Fail-closed pre-migration backup, header/B-tree
 * verification, and rollback helpers for Konoha SQLite schema migrations.
 */

const fs = require('fs');
const path = require('path');
const { hasCanonicalCodeChunksLayout } = require('./code_intel/ddl');

const SQLITE_HEADER_MAGIC = 'SQLite format 3\0';

function _loadDatabaseSyncReadOnly() {
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = function suppressSqliteWarning(warning, ...rest) {
    const text = typeof warning === 'string' ? warning : String((warning && warning.message) || '');
    if (text.includes('SQLite is an experimental feature')) return undefined;
    return originalEmitWarning.call(process, warning, ...rest);
  };
  try {
    return require('node:sqlite').DatabaseSync;
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

/**
 * Verifies a pre-migration SQLite backup file exists, is a regular non-symlink
 * file of at least 100 bytes with valid SQLite magic header, and passes integrity_check.
 * Fails closed by throwing PRE_MIGRATION_BACKUP_FAILED on any mismatch.
 */
function verifySqliteBackupFile(backupPath) {
  if (!backupPath || typeof backupPath !== 'string') {
    throw new Error('PRE_MIGRATION_BACKUP_FAILED: backup path is missing');
  }
  let stat;
  try {
    stat = fs.lstatSync(backupPath);
  } catch (err) {
    throw new Error(`PRE_MIGRATION_BACKUP_FAILED: cannot stat backup '${backupPath}': ${err.message}`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`PRE_MIGRATION_BACKUP_FAILED: backup is not a regular file '${backupPath}'`);
  }
  if (stat.size < 100) {
    throw new Error(`PRE_MIGRATION_BACKUP_FAILED: backup file is empty/truncated (${stat.size} bytes)`);
  }

  let fd = null;
  const header = Buffer.alloc(16);
  try {
    fd = fs.openSync(backupPath, 'r');
    fs.readSync(fd, header, 0, 16, 0);
  } catch (err) {
    throw new Error(`PRE_MIGRATION_BACKUP_FAILED: cannot read SQLite header from '${backupPath}': ${err.message}`);
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) { /* ignore */ }
    }
  }
  if (header.toString('utf8', 0, 16) !== SQLITE_HEADER_MAGIC) {
    throw new Error(`PRE_MIGRATION_BACKUP_FAILED: invalid SQLite header magic in '${backupPath}'`);
  }

  let roDb = null;
  try {
    const DatabaseSync = _loadDatabaseSyncReadOnly();
    roDb = new DatabaseSync(backupPath, { readOnly: true, allowExtension: false });
    roDb.exec('PRAGMA trusted_schema = OFF; PRAGMA cell_size_check = ON;');
    const row = roDb.prepare('PRAGMA integrity_check;').get();
    const verdict = row ? Object.values(row)[0] : null;
    if (verdict !== 'ok') {
      throw new Error(`integrity_check returned '${verdict}'`);
    }
  } catch (err) {
    throw new Error(`PRE_MIGRATION_BACKUP_FAILED: backup integrity check failed (${err.message})`);
  } finally {
    if (roDb && roDb.isOpen) {
      try { roDb.close(); } catch (_) { /* ignore */ }
    }
  }
  return { ok: true, backupPath, sizeBytes: stat.size };
}

function needsSchemaMigrationOrRepair(conn, currentVersion, targetVersion) {
  const existingTables = new Set(
    conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => r.name)
  );
  if (existingTables.size === 0) return false;
  if (currentVersion < targetVersion) return true;

  if (existingTables.has('persona_memories')) {
    const fks = conn.prepare('PRAGMA foreign_key_list(persona_memories)').all();
    if (!fks.some((fk) => fk.table === 'projects')) return true;
  }
  if (existingTables.has('active_sessions')) {
    const cols = conn.prepare('PRAGMA table_info(active_sessions)').all();
    if (!cols.some((c) => c.name === 'project_hash') || !cols.some((c) => c.name === 'session_id' && c.pk > 0)) {
      return true;
    }
  }
  if (existingTables.has('code_chunks') && !hasCanonicalCodeChunksLayout(conn)) {
    return true;
  }
  return false;
}

/**
 * Creates and verifies an online backup before any schema-altering migration runs on disk.
 * Never swallows errors; throws PRE_MIGRATION_BACKUP_FAILED fail-closed.
 */
function createAndVerifyPreMigrationBackup(conn, backupDatabaseFn, options = {}) {
  const dbPath = conn && typeof conn.name === 'string' ? conn.name : null;
  if (!dbPath || dbPath === ':memory:' || !fs.existsSync(dbPath)) {
    return { created: false, backupPath: null, skipped: true };
  }
  const st = fs.statSync(dbPath, { throwIfNoEntry: false });
  if (!st || !st.isFile() || st.size < 100) {
    return { created: false, backupPath: null, skipped: true };
  }
  if (!needsSchemaMigrationOrRepair(conn, options.currentVersion || 0, options.targetVersion || 0)) {
    return { created: false, backupPath: null, skipped: true };
  }

  if (typeof backupDatabaseFn === 'function') {
    let res;
    try {
      res = backupDatabaseFn(null, dbPath);
    } catch (err) {
      throw new Error(`PRE_MIGRATION_BACKUP_FAILED: ${err.message}`);
    }
    if (res === false || (res && (res.ok === false || res.success === false))) {
      throw new Error('PRE_MIGRATION_BACKUP_FAILED: backup provider reported failure');
    }
    const candidate = typeof res === 'string' ? res : (res && (res.targetPath || res.backupPath));
    if (candidate) {
      verifySqliteBackupFile(candidate);
      return { created: true, backupPath: candidate, skipped: false };
    }
    return { created: false, backupPath: null, skipped: false };
  }

  const backupDir = path.join(path.dirname(dbPath), 'backups');
  const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  const dest = path.join(backupDir, `konoha_pre_mig_${stamp}.db`);
  try {
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    }
    conn.prepare('VACUUM INTO ?').run(dest);
    try { fs.chmodSync(dest, 0o600); } catch (_) { /* posix permission hardening */ }
    verifySqliteBackupFile(dest);
    return { created: true, backupPath: dest, skipped: false };
  } catch (err) {
    try {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
    } catch (_) { /* cleanup invalid partial backup */ }
    if (err.message && err.message.startsWith('PRE_MIGRATION_BACKUP_FAILED:')) {
      throw err;
    }
    throw new Error(`PRE_MIGRATION_BACKUP_FAILED: ${err.message}`);
  }
}

function restoreFromVerifiedBackupFile(targetDbPath, backupPath) {
  verifySqliteBackupFile(backupPath);
  const stage = `${targetDbPath}.restore-tmp-${process.pid}`;
  fs.copyFileSync(backupPath, stage);
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const sidecar = `${targetDbPath}${suffix}`;
    try {
      if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    } catch (_) { /* ignore missing sidecar */ }
  }
  fs.renameSync(stage, targetDbPath);
  return targetDbPath;
}

module.exports = {
  verifySqliteBackupFile,
  needsSchemaMigrationOrRepair,
  createAndVerifyPreMigrationBackup,
  restoreFromVerifiedBackupFile
};
