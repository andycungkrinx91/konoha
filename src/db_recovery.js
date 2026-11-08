'use strict';

/**
 * src/db_recovery.js — SQLite Database Integrity Checking & Recovery Engine.
 *
 * Provides deterministic corruption detection, integrity verification,
 * strict path/symlink/boundary validation, isolated staging, concurrency locking,
 * atomic archiving of damaged database files, and safe restoration from
 * verified backups or the constrained in-process SQLite salvage pipeline.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { salvageDatabase, buildSafeTableDdl } = require('./db_recovery_salvage');

const SQLITE_HEADER_MAGIC = 'SQLite format 3\0';
const DB_IDENTITY_EXT_RE = /\.(?:db|sqlite|sqlite3|backup)(?:[._-][A-Za-z0-9._-]+)?$/i;
const LOCK_STALE_MS = 120000;
const ACTIVE_IN_PROCESS_LOCKS = new Set();

function loadDatabaseSync() {
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

function normalizeForCompare(p) {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isSubpathOf(childPath, parentDir) {
  const normChild = normalizeForCompare(childPath);
  const normParent = normalizeForCompare(parentDir);
  if (normChild === normParent) return false;
  const rel = path.relative(normParent, normChild);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function isSameOrSubpathOf(targetPath, rootDir) {
  const normTarget = normalizeForCompare(targetPath);
  const normRoot = normalizeForCompare(rootDir);
  if (normTarget === normRoot) return true;
  return isSubpathOf(normTarget, normRoot);
}

function getForbiddenRoots() {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const roots = [
    '/etc', '/bin', '/sbin', '/usr/bin', '/usr/sbin', '/usr/lib', '/lib', '/lib64',
    '/proc', '/sys', '/dev', '/boot', '/root', '/var/log', '/var/run', '/var/spool',
    path.join(home, '.ssh'),
    path.join(home, '.gnupg'),
    path.join(home, '.aws'),
    path.join(home, '.kube')
  ];
  if (process.platform === 'win32') {
    const sysRoot = process.env.SystemRoot || 'C:\\Windows';
    roots.push(sysRoot, 'C:\\Program Files', 'C:\\Program Files (x86)');
  }
  return roots;
}

function getAllowedRoots() {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const realHome = os.homedir();
  const roots = [
    path.join(home, '.konoha'),
    path.join(realHome, '.konoha'),
    path.join(home, '.agents'),
    path.join(realHome, '.agents'),
    process.cwd(),
    path.resolve(__dirname, '..'),
    os.tmpdir()
  ];
  if (process.platform !== 'win32') {
    roots.push('/tmp', '/private/tmp');
  }
  if (process.env.KONOHA_DB_PATH && !/[\x00-\x1f\x7f]/.test(process.env.KONOHA_DB_PATH)) {
    roots.push(path.dirname(path.resolve(process.env.KONOHA_DB_PATH)));
  }
  if (process.env.KONOHA_WORKSPACE) {
    roots.push(path.resolve(process.env.KONOHA_WORKSPACE));
  }
  if (process.env.KONOHA_ALLOWED_DB_ROOTS) {
    for (const part of process.env.KONOHA_ALLOWED_DB_ROOTS.split(path.delimiter)) {
      if (part && part.trim()) roots.push(path.resolve(part.trim()));
    }
  }
  return Array.from(new Set(roots.map(r => path.resolve(r))));
}

function checkAncestorSymlinks(resolvedPath, matchedRoot) {
  let current = path.dirname(resolvedPath);
  const stopRoot = path.resolve(matchedRoot);
  while (isSameOrSubpathOf(current, stopRoot)) {
    try {
      const st = fs.lstatSync(current);
      if (st.isSymbolicLink()) {
        return { ok: false, code: 'SYMLINK_REJECTED', reason: `Ancestor directory is a symbolic link: ${current}` };
      }
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        return { ok: false, code: 'INVALID_PATH', reason: `Cannot inspect directory ${current}: ${err.message}` };
      }
    }
    const parent = path.dirname(current);
    if (parent === current || normalizeForCompare(current) === normalizeForCompare(stopRoot)) break;
    current = parent;
  }

  let deepestExisting = path.dirname(resolvedPath);
  while (!fs.existsSync(deepestExisting)) {
    const next = path.dirname(deepestExisting);
    if (next === deepestExisting) break;
    deepestExisting = next;
  }
  try {
    const realAncestor = fs.realpathSync(deepestExisting);
    const realRoot = fs.existsSync(stopRoot) ? fs.realpathSync(stopRoot) : stopRoot;
    if (!isSameOrSubpathOf(realAncestor, realRoot)) {
      return { ok: false, code: 'SYMLINK_REJECTED', reason: `Real path escapes allowed boundary: ${resolvedPath}` };
    }
    for (const forbidden of getForbiddenRoots()) {
      if (isSameOrSubpathOf(realAncestor, forbidden)) {
        return { ok: false, code: 'FORBIDDEN_PATH_REJECTED', reason: `Real path resolves inside restricted directory: ${realAncestor}` };
      }
    }
  } catch (err) {
    return { ok: false, code: 'INVALID_PATH', reason: `Realpath verification failed: ${err.message}` };
  }
  return { ok: true };
}

function inspectExistingTargetFile(resolved, rawPath, options) {
  let lstat = null;
  try {
    lstat = fs.lstatSync(resolved);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return options.mustExist
        ? { ok: false, code: 'FILE_NOT_FOUND', reason: `Database file does not exist: ${rawPath}` }
        : { ok: true, resolved };
    }
    return { ok: false, code: 'INVALID_PATH', reason: `Cannot stat path ${rawPath}: ${err.message}` };
  }

  if (lstat.isSymbolicLink()) {
    return { ok: false, code: 'SYMLINK_REJECTED', reason: `Symbolic link database file is not permitted: ${resolved}` };
  }
  if (!lstat.isFile()) {
    return { ok: false, code: 'NOT_REGULAR_FILE', reason: `Database path is not a regular file: ${resolved}` };
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
  if (uid !== 0 && lstat.uid !== uid) {
    return { ok: false, code: 'OWNERSHIP_MISMATCH', reason: `Database file is not owned by current user: ${resolved}` };
  }
  return { ok: true, resolved };
}

function validateDatabasePath(rawPath, options = {}) {
  if (!rawPath || typeof rawPath !== 'string' || rawPath.trim() === '' || rawPath.trim() === ':memory:') {
    return { ok: false, code: 'INVALID_PATH', reason: 'dbPath must be a non-empty file path string' };
  }
  if (/[\x00-\x1f\x7f]/.test(rawPath)) {
    return { ok: false, code: 'CONTROL_CHAR_REJECTED', reason: 'Database path contains forbidden control characters' };
  }
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(rawPath)) {
    return { ok: false, code: 'PATH_TRAVERSAL_REJECTED', reason: `Path traversal sequences (..) are not permitted: ${rawPath}` };
  }

  const resolved = path.resolve(rawPath);
  if (getForbiddenRoots().some((forbidden) => isSameOrSubpathOf(resolved, forbidden))) {
    return { ok: false, code: 'FORBIDDEN_PATH_REJECTED', reason: `Database path is inside restricted system directory: ${resolved}` };
  }

  const allowedRoots = Array.isArray(options.allowedRoots) && options.allowedRoots.length > 0
    ? options.allowedRoots.map((r) => path.resolve(r))
    : getAllowedRoots();
  const matchedRoot = allowedRoots.find(root => isSubpathOf(resolved, root));
  if (!matchedRoot) {
    return { ok: false, code: 'OUTSIDE_ALLOWED_BOUNDARY', reason: `Database path is outside allowed Konoha boundaries: ${resolved}` };
  }

  const baseName = path.basename(resolved);
  if (options.requireDbExtension !== false && !DB_IDENTITY_EXT_RE.test(baseName)) {
    return {
      ok: false,
      code: 'INVALID_DB_IDENTITY',
      reason: `File does not match expected SQLite database extension (.db, .sqlite, .sqlite3, .backup): ${baseName}`
    };
  }

  const ancestorCheck = checkAncestorSymlinks(resolved, matchedRoot);
  if (!ancestorCheck.ok) return ancestorCheck;

  return inspectExistingTargetFile(resolved, rawPath, options);
}

function readHeaderStatus(resolvedPath) {
  try {
    const stat = fs.statSync(resolvedPath);
    if (stat.size < 100) {
      return { ok: false, reason: 'File smaller than minimum SQLite 100-byte header' };
    }
    const fd = fs.openSync(resolvedPath, 'r');
    const headerBuf = Buffer.alloc(16);
    try {
      fs.readSync(fd, headerBuf, 0, 16, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (headerBuf.toString('utf8', 0, 16) !== SQLITE_HEADER_MAGIC) {
      return { ok: false, reason: 'INVALID_HEADER_MAGIC: missing SQLite format 3 signature' };
    }
    return { ok: true, reason: null };
  } catch (err) {
    return { ok: false, reason: `HEADER_READ_FAILED: ${err.message}` };
  }
}

function checkIntegrity(dbPath) {
  if (!dbPath || typeof dbPath !== 'string') {
    return { ok: false, status: 'INVALID_PATH', details: ['dbPath must be a non-empty string'] };
  }
  const pathCheck = validateDatabasePath(dbPath, { mustExist: false, requireDbExtension: true });
  if (!pathCheck.ok) {
    return { ok: false, status: pathCheck.code || 'INVALID_PATH', details: [pathCheck.reason] };
  }
  if (!fs.existsSync(pathCheck.resolved)) {
    return { ok: false, status: 'FILE_NOT_FOUND', details: [`Database file does not exist: ${dbPath}`] };
  }

  const hdr = readHeaderStatus(pathCheck.resolved);
  if (!hdr.ok) {
    return { ok: false, status: 'CORRUPTED', details: [hdr.reason] };
  }

  let db = null;
  try {
    const DatabaseSync = loadDatabaseSync();
    db = new DatabaseSync(pathCheck.resolved, { readOnly: true, allowExtension: false });
    db.exec('PRAGMA trusted_schema = OFF;');
    db.exec('PRAGMA cell_size_check = ON;');

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
    return { ok: false, status: 'CORRUPTED', details: failureDetails.map(String) };
  } catch (err) {
    return { ok: false, status: 'CORRUPTED', details: [err.message || 'SQLite open/pragma execution failed'] };
  } finally {
    if (db && db.isOpen) {
      try { db.close(); } catch (_) { /* best-effort cleanup */ }
    }
  }
}

function detectCorruption(dbPath) {
  if (!dbPath || typeof dbPath !== 'string') {
    return { corrupt: true, ok: false, reason: 'Invalid database path' };
  }
  const pathCheck = validateDatabasePath(dbPath, { mustExist: false, requireDbExtension: true });
  if (!pathCheck.ok) {
    return { corrupt: true, ok: false, reason: pathCheck.reason };
  }
  if (!fs.existsSync(pathCheck.resolved)) {
    return { corrupt: true, ok: false, reason: 'FILE_NOT_FOUND' };
  }

  const hdr = readHeaderStatus(pathCheck.resolved);
  if (!hdr.ok) {
    return { corrupt: true, ok: false, reason: hdr.reason };
  }

  const integrity = checkIntegrity(pathCheck.resolved);
  if (!integrity.ok) {
    return { corrupt: true, ok: false, reason: integrity.details.join('; ') };
  }
  return { corrupt: false, ok: true, reason: null };
}

function findLatestVerifiedBackup(dbPath) {
  const pathCheck = validateDatabasePath(dbPath, { mustExist: false, requireDbExtension: true });
  if (!pathCheck.ok) return null;

  const resolvedDb = pathCheck.resolved;
  const directBackup = `${resolvedDb}.backup`;
  if (validateDatabasePath(directBackup, { mustExist: true }).ok && checkIntegrity(directBackup).ok) {
    return directBackup;
  }

  const backupDir = path.join(path.dirname(resolvedDb), 'backups');
  if (!fs.existsSync(backupDir)) return null;
  try {
    if (fs.lstatSync(backupDir).isSymbolicLink()) return null;
  } catch (_) {
    return null;
  }

  let candidates = [];
  try {
    candidates = fs.readdirSync(backupDir)
      .filter(f => (f.endsWith('.db') || f.endsWith('.backup')) && !f.startsWith('-'))
      .map(f => path.join(backupDir, f))
      .filter((p) => {
        const v = validateDatabasePath(p, { mustExist: true });
        return v.ok;
      })
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

function resolveAndValidateBackup(resolvedDbPath, explicitBackup) {
  if (!explicitBackup) {
    return findLatestVerifiedBackup(resolvedDbPath);
  }
  const vBackup = validateDatabasePath(explicitBackup, { mustExist: false, requireDbExtension: true });
  if (!vBackup.ok) {
    throw new Error(`Invalid backup path (${vBackup.code}): ${vBackup.reason}`);
  }
  if (!fs.existsSync(vBackup.resolved)) {
    throw new Error(`Specified backup does not exist: ${explicitBackup}`);
  }
  const check = checkIntegrity(vBackup.resolved);
  if (!check.ok) {
    throw new Error(`Specified backup is corrupted: ${check.details.join('; ')}`);
  }
  return vBackup.resolved;
}

function verifySidecarsNotSymlinks(dbFilePath) {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const sidecar = `${dbFilePath}${suffix}`;
    try {
      const st = fs.lstatSync(sidecar);
      if (st.isSymbolicLink() || !st.isFile()) {
        throw new Error(`Unsafe sidecar file rejected: ${sidecar}`);
      }
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      throw err;
    }
  }
}

function acquireRecoveryLock(targetPath) {
  const normKey = normalizeForCompare(targetPath);
  if (ACTIVE_IN_PROCESS_LOCKS.has(normKey)) {
    throw new Error(`CONCURRENT_RECOVERY_LOCKED: Recovery already active in process for ${targetPath}`);
  }
  const lockPath = `${targetPath}.recovery.lock`;
  try {
    if (fs.existsSync(lockPath)) {
      const st = fs.lstatSync(lockPath);
      if (!st.isSymbolicLink() && Date.now() - st.mtimeMs > LOCK_STALE_MS) {
        fs.unlinkSync(lockPath);
      }
    }
  } catch (_) { /* ignore stale probe error */ }

  let fd = null;
  try {
    fd = fs.openSync(lockPath, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now(), target: targetPath }), 'utf8');
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      throw new Error(`CONCURRENT_RECOVERY_LOCKED: Another recovery operation holds lock ${lockPath}`);
    }
    throw new Error(`RECOVERY_LOCK_FAILED: Cannot acquire lock in ${path.dirname(targetPath)}: ${err.message}`);
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) { /* ignore */ }
    }
  }

  ACTIVE_IN_PROCESS_LOCKS.add(normKey);
  return function releaseLock() {
    ACTIVE_IN_PROCESS_LOCKS.delete(normKey);
    try {
      if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
    } catch (_) { /* best-effort lock cleanup */ }
  };
}

function archiveDatabaseWithSidecars(dbPath) {
  if (!fs.existsSync(dbPath)) return null;
  verifySidecarsNotSymlinks(dbPath);
  const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}-${Math.random().toString(36).slice(2, 6)}`;
  const archivePath = `${dbPath}.pre-restore-${stamp}`;
  fs.renameSync(dbPath, archivePath);
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const sidecar = `${dbPath}${suffix}`;
    if (fs.existsSync(sidecar)) {
      try { fs.renameSync(sidecar, `${archivePath}${suffix}`); } catch (_) { /* ignore */ }
    }
  }
  return archivePath;
}

function rollbackFromArchive(archivePath, dbPath) {
  if (!archivePath || !fs.existsSync(archivePath)) return;
  try {
    fs.copyFileSync(archivePath, dbPath);
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const archivedSidecar = `${archivePath}${suffix}`;
      if (fs.existsSync(archivedSidecar)) {
        fs.copyFileSync(archivedSidecar, `${dbPath}${suffix}`);
      }
    }
  } catch (_) { /* best-effort rollback */ }
}

function removeResidualSidecars(resolvedTarget) {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const targetSidecar = `${resolvedTarget}${suffix}`;
    try {
      if (fs.existsSync(targetSidecar)) fs.unlinkSync(targetSidecar);
    } catch (_) { /* ignore */ }
  }
}

function commitStagedDatabase(stagedFile, resolvedDb, resolvedTarget, options = {}) {
  const archivePath = archiveDatabaseWithSidecars(resolvedDb);
  const targetArchive = (resolvedTarget !== resolvedDb && fs.existsSync(resolvedTarget))
    ? archiveDatabaseWithSidecars(resolvedTarget)
    : null;
  removeResidualSidecars(resolvedTarget);

  try {
    if (options._simulateAtomicFailure === true) {
      throw new Error('Simulated atomic replacement failure');
    }
    fs.renameSync(stagedFile, resolvedTarget);
    try { fs.chmodSync(resolvedTarget, 0o600); } catch (_) { /* ignore */ }
    if (!checkIntegrity(resolvedTarget).ok) {
      throw new Error('Post-replacement integrity check failed');
    }
    return archivePath || targetArchive;
  } catch (err) {
    rollbackFromArchive(archivePath, resolvedDb);
    if (targetArchive) rollbackFromArchive(targetArchive, resolvedTarget);
    throw new Error(`Restore replacement failed; original database preserved (${err.message})`);
  }
}

function executeStagedRestore(stagingDir, resolvedDb, resolvedTarget, chosenBackup, options) {
  const stagedFile = path.join(stagingDir, 'staged_recovery.db');
  if (chosenBackup) {
    fs.copyFileSync(chosenBackup, stagedFile);
    if (!checkIntegrity(stagedFile).ok) {
      throw new Error(`Staged backup verification failed for: ${chosenBackup}`);
    }
    const archivePath = commitStagedDatabase(stagedFile, resolvedDb, resolvedTarget, options);
    return {
      restored: true,
      method: 'backup',
      source: chosenBackup,
      target: resolvedTarget,
      archived: archivePath,
      details: `Restored successfully from verified backup: ${chosenBackup}`
    };
  }

  const salvageRes = salvageDatabase(resolvedDb, stagedFile, { stagingDir });
  if (salvageRes.ok && checkIntegrity(stagedFile).ok) {
    const archivePath = commitStagedDatabase(stagedFile, resolvedDb, resolvedTarget, options);
    return {
      restored: true,
      method: 'salvage',
      source: archivePath || resolvedDb,
      target: resolvedTarget,
      archived: archivePath,
      salvagedTables: salvageRes.tables,
      salvagedRows: salvageRes.rows,
      rejectedObjects: salvageRes.rejectedObjects || [],
      details: `Salvaged ${salvageRes.tables} table(s) and ${salvageRes.rows} row(s) via constrained SQLite recovery pipeline`
    };
  }

  const archiveCopy = `${resolvedDb}.pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  try { fs.copyFileSync(resolvedDb, archiveCopy); } catch (_) { /* best-effort */ }
  return {
    restored: false,
    method: 'none',
    source: resolvedDb,
    target: resolvedTarget,
    archived: fs.existsSync(archiveCopy) ? archiveCopy : null,
    rejectedObjects: salvageRes.rejectedObjects || [],
    details: 'No valid backup found and salvage recovery could not extract records. Original preserved.'
  };
}

function restoreDatabase(options = {}) {
  const rawDbPath = options.dbPath;
  if (!rawDbPath || typeof rawDbPath !== 'string') {
    throw new Error('dbPath is required for restoreDatabase');
  }

  const vDb = validateDatabasePath(rawDbPath, { mustExist: true, requireDbExtension: true });
  if (!vDb.ok) {
    throw new Error(`Invalid dbPath (${vDb.code}): ${vDb.reason}`);
  }

  const rawTarget = options.targetPath || rawDbPath;
  const vTarget = validateDatabasePath(rawTarget, { mustExist: false, requireDbExtension: true });
  if (!vTarget.ok) {
    throw new Error(`Invalid targetPath (${vTarget.code}): ${vTarget.reason}`);
  }

  const resolvedDb = vDb.resolved;
  const resolvedTarget = vTarget.resolved;
  if (fs.existsSync(resolvedTarget) && resolvedTarget !== resolvedDb && !options.force) {
    throw new Error(`Target path already exists: ${resolvedTarget}. Use force: true to overwrite.`);
  }

  verifySidecarsNotSymlinks(resolvedDb);
  verifySidecarsNotSymlinks(resolvedTarget);

  const chosenBackup = resolveAndValidateBackup(resolvedDb, options.backupPath);
  const releaseLock = acquireRecoveryLock(resolvedTarget);
  let stagingDir = null;

  try {
    stagingDir = fs.mkdtempSync(path.join(path.dirname(resolvedTarget), '.konoha-recovery-stage-'));
    return executeStagedRestore(stagingDir, resolvedDb, resolvedTarget, chosenBackup, options);
  } finally {
    try {
      if (stagingDir && fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
    releaseLock();
  }
}

function autoRecoverIfNeeded(dbPath, explicitBackup = null) {
  if (!dbPath || dbPath === ':memory:') return false;
  const status = detectCorruption(dbPath);
  if (!status.corrupt) return false;

  console.error(`[Konoha DB Recovery] Corrupted database detected at ${dbPath}: ${status.reason}`);
  const backup = explicitBackup || findLatestVerifiedBackup(dbPath);
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

  const vDb = validateDatabasePath(dbPath, { mustExist: true, requireDbExtension: true });
  if (!vDb.ok) {
    report.ok = false;
    report.integrity = vDb.code;
    return report;
  }

  let db = null;
  try {
    const DatabaseSync = loadDatabaseSync();
    db = new DatabaseSync(vDb.resolved, { readOnly: true, allowExtension: false });
    db.exec('PRAGMA trusted_schema = OFF;');
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
  validateDatabasePath,
  checkIntegrity,
  checkDatabase,
  detectCorruption,
  findLatestVerifiedBackup,
  restoreDatabase,
  autoRecoverIfNeeded,
  salvageDatabase,
  buildSafeTableDdl
};
