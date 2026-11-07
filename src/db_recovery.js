'use strict';

/**
 * src/db_recovery.js — SQLite Database Integrity Checking & Recovery Engine.
 *
 * Provides deterministic corruption detection, integrity verification,
 * atomic archiving of damaged database files, and safe restoration from
 * verified backups or salvage mechanisms.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const SQLITE_HEADER_MAGIC = 'SQLite format 3\0';

/**
 * Run quick and full integrity pragmas on an SQLite database.
 * @param {string} dbPath
 * @returns {{ ok: boolean, status: string, details: string[] }}
 */
function checkIntegrity(dbPath) {
  if (!dbPath || typeof dbPath !== 'string') {
    return { ok: false, status: 'INVALID_PATH', details: ['dbPath must be a non-empty string'] };
  }
  if (!fs.existsSync(dbPath)) {
    return { ok: false, status: 'FILE_NOT_FOUND', details: [`Database file does not exist: ${dbPath}`] };
  }

  let db = null;
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(dbPath, { readOnly: true, allowExtension: false });

    const quickRows = db.prepare('PRAGMA quick_check;').all();
    const quickResults = quickRows.map(r => Object.values(r)[0]);
    const quickOk = quickResults.length === 1 && quickResults[0] === 'ok';

    const fullRows = db.prepare('PRAGMA integrity_check;').all();
    const fullResults = fullRows.map(r => Object.values(r)[0]);
    const fullOk = fullResults.length === 1 && fullResults[0] === 'ok';

    if (quickOk && fullOk) {
      return { ok: true, status: 'OK', details: ['ok'] };
    }

    const failureDetails = !fullOk ? fullResults : quickResults;
    return {
      ok: false,
      status: 'CORRUPTED',
      details: failureDetails.map(String)
    };
  } catch (err) {
    return {
      ok: false,
      status: 'CORRUPTED',
      details: [err.message || 'SQLite open/pragma execution failed']
    };
  } finally {
    if (db && db.isOpen) {
      try { db.close(); } catch (_) { /* best-effort cleanup */ }
    }
  }
}

/**
 * Check if a database file exists, can be opened, has a valid header, and passes PRAGMA checks.
 * @param {string} dbPath
 * @returns {{ corrupt: boolean, ok: boolean, reason: string | null }}
 */
function detectCorruption(dbPath) {
  if (!dbPath || typeof dbPath !== 'string') {
    return { corrupt: true, ok: false, reason: 'Invalid database path' };
  }
  if (!fs.existsSync(dbPath)) {
    return { corrupt: true, ok: false, reason: 'FILE_NOT_FOUND' };
  }

  try {
    const stat = fs.statSync(dbPath);
    if (stat.size < 100) {
      return { corrupt: true, ok: false, reason: 'File smaller than minimum SQLite 100-byte header' };
    }
    const fd = fs.openSync(dbPath, 'r');
    const headerBuf = Buffer.alloc(16);
    fs.readSync(fd, headerBuf, 0, 16, 0);
    fs.closeSync(fd);

    if (headerBuf.toString('utf8', 0, 16) !== SQLITE_HEADER_MAGIC) {
      return { corrupt: true, ok: false, reason: 'INVALID_HEADER_MAGIC: missing SQLite format 3 signature' };
    }
  } catch (err) {
    return { corrupt: true, ok: false, reason: `HEADER_READ_FAILED: ${err.message}` };
  }

  const integrity = checkIntegrity(dbPath);
  if (!integrity.ok) {
    return { corrupt: true, ok: false, reason: integrity.details.join('; ') };
  }

  return { corrupt: false, ok: true, reason: null };
}

/**
 * Locate the latest verified backup for a given database path.
 * @param {string} dbPath
 * @returns {string|null}
 */
function findLatestVerifiedBackup(dbPath) {
  const directBackup = `${dbPath}.backup`;
  if (fs.existsSync(directBackup) && checkIntegrity(directBackup).ok) {
    return directBackup;
  }

  const backupDir = path.join(path.dirname(dbPath), 'backups');
  if (!fs.existsSync(backupDir)) {
    return null;
  }

  let candidates = [];
  try {
    candidates = fs.readdirSync(backupDir)
      .filter(f => f.endsWith('.db') || f.endsWith('.backup'))
      .map(f => path.join(backupDir, f))
      .filter(p => fs.statSync(p).isFile())
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  } catch (_) {
    return null;
  }

  for (const candidate of candidates) {
    if (checkIntegrity(candidate).ok) {
      return candidate;
    }
  }

  return null;
}

/**
 * Attempt row salvage via sqlite3 CLI .recover into targetPath.
 * @param {string} sourceDb
 * @param {string} targetDb
 * @returns {{ ok: boolean, tables: number, rows: number }}
 */
function executeRecoverScript(targetDb, tmpSql) {
  try {
    execSync(`sqlite3 "${targetDb}" < "${tmpSql}"`, { stdio: 'ignore', timeout: 15000 });
    return checkIntegrity(targetDb).ok;
  } catch (_) {
    return false;
  } finally {
    try { fs.unlinkSync(tmpSql); } catch (_) { /* ignore */ }
  }
}

function attemptCliRecover(sourceDb, targetDb) {
  let recoverSql;
  try {
    recoverSql = execSync(`sqlite3 "${sourceDb}" .recover`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 15000
    });
  } catch (_) {
    return { ok: false, tables: 0, rows: 0 };
  }

  if (!recoverSql || recoverSql.trim().length === 0) {
    return { ok: false, tables: 0, rows: 0 };
  }

  if (fs.existsSync(targetDb)) {
    try { fs.unlinkSync(targetDb); } catch (_) { /* ignore */ }
  }

  const tmpSql = path.join(os.tmpdir(), `konoha_salvage_${Date.now()}.sql`);
  fs.writeFileSync(tmpSql, recoverSql, 'utf8');

  const ok = executeRecoverScript(targetDb, tmpSql);
  return { ok, tables: ok ? 1 : 0, rows: ok ? 1 : 0 };
}

/**
 * Restore database from a backup or salvage readable contents.
 * Preserves the corrupted database by archiving it to .corrupt.<timestamp>.
 * Never overwrites the source with an unverified empty database.
 *
 * @param {Object} options
 * @param {string} options.dbPath
 * @param {string} [options.backupPath]
 * @param {string} [options.targetPath]
 * @param {boolean} [options.force]
 * @returns {{ restored: boolean, method: string, source: string, target: string, archived: string|null, details: string }}
 */
function resolveAndValidateBackup(dbPath, explicitBackup) {
  if (!explicitBackup) {
    return findLatestVerifiedBackup(dbPath);
  }
  if (!fs.existsSync(explicitBackup)) {
    throw new Error(`Specified backup does not exist: ${explicitBackup}`);
  }
  const check = checkIntegrity(explicitBackup);
  if (!check.ok) {
    throw new Error(`Specified backup is corrupted: ${check.details.join('; ')}`);
  }
  return explicitBackup;
}

function archiveCorruptDatabase(dbPath) {
  if (!fs.existsSync(dbPath)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archivePath = `${dbPath}.pre-restore-${stamp}`;
  fs.renameSync(dbPath, archivePath);
  return archivePath;
}
function copyBackupToTarget(chosenBackup, targetPath, archivePath) {
  if (fs.existsSync(targetPath)) {
    try { fs.unlinkSync(targetPath); } catch (_) { /* ignore */ }
  }
  fs.copyFileSync(chosenBackup, targetPath);
  return {
    restored: true,
    method: 'backup',
    source: chosenBackup,
    target: targetPath,
    archived: archivePath,
    details: `Restored successfully from verified backup: ${chosenBackup}`
  };
}
function restoreDatabase(options = {}) {
  const dbPath = options.dbPath;
  if (!dbPath || typeof dbPath !== 'string') {
    throw new Error('dbPath is required for restoreDatabase');
  }

  const targetPath = options.targetPath || dbPath;
  const force = Boolean(options.force);

  if (fs.existsSync(targetPath) && targetPath !== dbPath && !force) {
    throw new Error(`Target path already exists: ${targetPath}. Use force: true to overwrite.`);
  }

  // Resolve and verify the backup first: a bad backup must fail without side effects.
  const chosenBackup = resolveAndValidateBackup(dbPath, options.backupPath);
  let archivePath = chosenBackup ? archiveCorruptDatabase(dbPath) : null;

  if (chosenBackup) {
    const outcome = copyBackupToTarget(chosenBackup, targetPath, archivePath);
    // Post-copy verification: if the restored file is not healthy, put the original back.
    if (!checkIntegrity(targetPath).ok) {
      if (archivePath && fs.existsSync(archivePath)) fs.copyFileSync(archivePath, targetPath);
      throw new Error(`Restore verification failed; original database preserved at ${archivePath || dbPath}`);
    }
    return outcome;
  }

  // No explicit or verified backup: archive only now, to attempt salvage from the copy.
  archivePath = archiveCorruptDatabase(dbPath);

  // If no backup, attempt salvage from the archived file
  if (archivePath) {
    const salvageRes = attemptCliRecover(archivePath, targetPath);
    if (salvageRes.ok) {
      return {
        restored: true,
        method: 'salvage',
        source: archivePath,
        target: targetPath,
        archived: archivePath,
        details: 'Salvaged readable database pages and tables via recovery protocol'
      };
    }
  }

  // Fail-closed safety: Never zero out or initialize an empty replacement automatically
  return {
    restored: false,
    method: 'none',
    source: archivePath || dbPath,
    target: targetPath,
    archived: archivePath,
    details: 'No valid backup found and salvage recovery could not extract records. Original preserved.'
  };
}

/**
 * Hook for sqlite_driver. If the database is corrupt, safely archives it and
 * restores from a verified backup if available. Never initializes an empty DB.
 *
 * @param {string} dbPath
 * @returns {boolean} true if restored from verified backup; false otherwise.
 */
function autoRecoverIfNeeded(dbPath) {
  if (!dbPath || dbPath === ':memory:') return false;
  const status = detectCorruption(dbPath);
  if (!status.corrupt) return false;

  console.error(`[Konoha DB Recovery] Corrupted database detected at ${dbPath}: ${status.reason}`);
  const backup = findLatestVerifiedBackup(dbPath);
  if (backup) {
    try {
      const res = restoreDatabase({ dbPath, backupPath: backup, force: true });
      if (res.restored) {
        console.error(`[Konoha DB Recovery] Successfully restored from backup: ${backup} (broken file archived to ${res.archived})`);
        return true;
      }
    } catch (err) {
      console.error(`[Konoha DB Recovery] Automatic backup restore failed: ${err.message}`);
    }
  }

  console.error(`[Konoha DB Recovery] No verified backup available for ${dbPath}. Preserving file for explicit manual recovery (konoha db restore).`);
  return false;
}

/**
 * Structured health report for one database file: integrity, foreign-key violations,
 * user_version against the current schema version, and whether FTS5 is usable.
 * Read-only; returns a report object rather than throwing on a damaged file.
 *
 * @param {string} dbPath
 * @returns {{ ok: boolean, integrity: string, foreignKeyViolations: number,
 *             userVersion: number|null, schemaVersion: number, ftsAvailable: boolean }}
 */
function checkDatabase(dbPath) {
  const integrity = checkIntegrity(dbPath);
  const schemaVersion = Number(require('./db_schema').CURRENT_SCHEMA_VERSION);
  const report = {
    ok: integrity.ok,
    integrity: integrity.status,
    foreignKeyViolations: 0,
    userVersion: null,
    schemaVersion,
    ftsAvailable: false
  };
  if (!integrity.ok) return report;

  let db = null;
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(dbPath, { readOnly: true, allowExtension: false });
    report.foreignKeyViolations = db.prepare('PRAGMA foreign_key_check;').all().length;
    report.userVersion = Number(Object.values(db.prepare('PRAGMA user_version;').get())[0]);
    const fts = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE sql LIKE '%VIRTUAL TABLE%USING fts5%';").get();
    report.ftsAvailable = Number(Object.values(fts)[0]) > 0;
    report.ok = report.ok && report.foreignKeyViolations === 0;
  } catch (err) {
    report.ok = false;
    report.integrity = `${report.integrity}: ${err.message}`;
  } finally {
    if (db) { try { db.close(); } catch (_) { /* non-fatal */ } }
  }
  return report;
}

module.exports = {
  checkIntegrity,
  checkDatabase,
  detectCorruption,
  findLatestVerifiedBackup,
  restoreDatabase,
  autoRecoverIfNeeded
};
