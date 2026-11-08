'use strict';

/**
 * src/db_recovery_salvage.js — Constrained Pure-SQLite Salvage Pipeline.
 *
 * Replaces external `sqlite3` CLI `.recover` shell invocations with an isolated,
 * in-process `node:sqlite` (`DatabaseSync`) salvage engine. Never spawns a shell
 * or external binary, never executes raw SQL strings from untrusted databases,
 * disables extensions and trusted_schema, and transfers salvaged records strictly
 * through parameterized prepared statements.
 */

const fs = require('fs');
const path = require('path');

const SQLITE_HEADER_MAGIC = 'SQLite format 3\0';
const VALID_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const ALLOWED_COL_TYPE_RE = /^(?:INTEGER|INT|TINYINT|SMALLINT|BIGINT|TEXT|CLOB|VARCHAR|NVARCHAR|CHAR|REAL|DOUBLE|FLOAT|BLOB|NUMERIC|DECIMAL|BOOLEAN|DATE|DATETIME|TIMESTAMP)(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?$/i;
const SAFE_DEFAULT_RE = /^(?:NULL|TRUE|FALSE|CURRENT_TIME|CURRENT_DATE|CURRENT_TIMESTAMP|-?\d+(?:\.\d+)?|'(?:[^'\x00-\x1f]|'')*')$/i;
const FORBIDDEN_DDL_RE = /\b(?:ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|ANALYZE|LOAD_EXTENSION|FTS3_TOKENIZER|RTREE|TRIGGER|VIEW|TEMP|TEMPORARY)\b|--|\/\*/i;
const FTS5_SHADOW_SUFFIXES = ['_data', '_idx', '_content', '_docsize', '_config'];

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

function quoteIdent(ident) {
  if (!VALID_IDENT_RE.test(ident)) {
    throw new Error(`Invalid SQLite identifier rejected: ${ident}`);
  }
  return `"${ident}"`;
}

function isFts5ShadowTable(tableName, ftsTableNames) {
  const lower = tableName.toLowerCase();
  for (const ftsName of ftsTableNames) {
    const prefix = ftsName.toLowerCase();
    for (const suffix of FTS5_SHADOW_SUFFIXES) {
      if (lower === `${prefix}${suffix}`) return true;
    }
  }
  return false;
}

function openHardenedSource(dbPath) {
  const DatabaseSync = loadDatabaseSync();
  const db = new DatabaseSync(dbPath, { readOnly: true, allowExtension: false });
  db.exec('PRAGMA trusted_schema = OFF;');
  db.exec('PRAGMA query_only = ON;');
  db.exec('PRAGMA foreign_keys = OFF;');
  return db;
}

function openHardenedTarget(dbPath) {
  const DatabaseSync = loadDatabaseSync();
  const db = new DatabaseSync(dbPath, { allowExtension: false });
  db.exec('PRAGMA trusted_schema = OFF;');
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('PRAGMA synchronous = FULL;');
  return db;
}

function buildSynthesizedHeader(fileSize) {
  const pageSize = (fileSize >= 1024 && fileSize % 1024 === 0 && fileSize % 4096 !== 0) ? 1024 : 4096;
  const pageCount = Math.max(1, Math.floor(fileSize / pageSize));
  const hdr = Buffer.alloc(100, 0);
  hdr.write(SQLITE_HEADER_MAGIC, 0, 'utf8');
  hdr.writeUInt16BE(pageSize === 65536 ? 1 : pageSize, 16);
  hdr[18] = 1;
  hdr[19] = 1;
  hdr[20] = 0;
  hdr[21] = 64;
  hdr[22] = 32;
  hdr[23] = 32;
  hdr.writeUInt32BE(1, 24);
  hdr.writeUInt32BE(pageCount, 28);
  hdr.writeUInt32BE(4, 44);
  hdr.writeUInt32BE(1, 56);
  hdr.writeUInt32BE(1, 92);
  hdr.writeUInt32BE(3046000, 96);
  return hdr;
}

function createHeaderRepairedProbe(sourceDb, stagingDir) {
  try {
    const raw = fs.readFileSync(sourceDb);
    if (raw.length < 100) return null;
    const repaired = Buffer.from(raw);
    const hdr = buildSynthesizedHeader(repaired.length);
    hdr.copy(repaired, 0, 0, 100);
    const probePath = path.join(stagingDir, 'header_repaired_probe.db');
    fs.writeFileSync(probePath, repaired, { mode: 0o600 });
    return probePath;
  } catch (_) {
    return null;
  }
}

function sanitizeColumnSpec(col) {
  const name = String(col.name || '').trim();
  if (!VALID_IDENT_RE.test(name)) return null;

  const rawType = String(col.type || '').trim();
  const cleanType = ALLOWED_COL_TYPE_RE.test(rawType) ? rawType.toUpperCase() : ' BLOB'.trim();
  const finalType = rawType === '' ? '' : cleanType;

  const parts = [quoteIdent(name)];
  if (finalType) parts.push(finalType);
  if (Number(col.notnull) === 1 && Number(col.pk) === 0) {
    parts.push('NOT NULL');
  }
  if (col.dflt_value !== null && col.dflt_value !== undefined) {
    const dflt = String(col.dflt_value).trim();
    if (SAFE_DEFAULT_RE.test(dflt)) {
      parts.push(`DEFAULT ${dflt}`);
    }
  }
  return {
    name,
    pkOrder: Number(col.pk) || 0,
    isIntegerPk: finalType === 'INTEGER' && Number(col.pk) === 1,
    ddl: parts.join(' ')
  };
}

function buildSafeTableDdl(sourceConn, tableName, rawSql) {
  if (!VALID_IDENT_RE.test(tableName) || tableName.toLowerCase().startsWith('sqlite_')) {
    return { ok: false, reason: `Invalid or reserved table name: ${tableName}` };
  }
  const trimmedSql = String(rawSql || '').trim().replace(/;+\s*$/, '');
  if (!trimmedSql || trimmedSql.includes(';') || FORBIDDEN_DDL_RE.test(trimmedSql)) {
    return { ok: false, reason: `Rejected unsafe DDL in table ${tableName}` };
  }
  if (!/^CREATE\s+TABLE\b/i.test(trimmedSql)) {
    return { ok: false, reason: `Unsupported table construct for ${tableName}` };
  }

  let columns = [];
  try {
    columns = sourceConn.prepare(`PRAGMA table_info(${quoteIdent(tableName)})`).all();
  } catch (err) {
    return { ok: false, reason: `table_info failed for ${tableName}: ${err.message}` };
  }
  if (!Array.isArray(columns) || columns.length === 0) {
    return { ok: false, reason: `Table ${tableName} has no readable columns` };
  }

  const sanitizedCols = [];
  for (const col of columns) {
    const spec = sanitizeColumnSpec(col);
    if (!spec) {
      return { ok: false, reason: `Invalid column definition in table ${tableName}` };
    }
    sanitizedCols.push(spec);
  }

  const pkCols = sanitizedCols.filter(c => c.pkOrder > 0).sort((a, b) => a.pkOrder - b.pkOrder);
  const colDefs = sanitizedCols.map((c) => {
    if (pkCols.length === 1 && c.pkOrder === 1) {
      return `${c.ddl} PRIMARY KEY`;
    }
    return c.ddl;
  });
  if (pkCols.length > 1) {
    colDefs.push(`PRIMARY KEY (${pkCols.map(c => quoteIdent(c.name)).join(', ')})`);
  }

  return {
    ok: true,
    tableName,
    columnNames: sanitizedCols.map(c => c.name),
    createSql: `CREATE TABLE ${quoteIdent(tableName)} (${colDefs.join(', ')})`
  };
}

function toSafeCellValue(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number' || typeof val === 'bigint' || typeof val === 'string') return val;
  if (val instanceof Uint8Array || Buffer.isBuffer(val)) return val;
  return String(val);
}

function salvageTableRows(sourceConn, targetConn, tableSpec) {
  const qTable = quoteIdent(tableSpec.tableName);
  const qCols = tableSpec.columnNames.map(quoteIdent).join(', ');
  const placeholders = tableSpec.columnNames.map(() => '?').join(', ');
  const insertStmt = targetConn.prepare(
    `INSERT OR IGNORE INTO ${qTable} (${qCols}) VALUES (${placeholders})`
  );

  let insertedCount = 0;
  const seenRowids = new Set();

  const insertRowObject = (row) => {
    if (!row || typeof row !== 'object') return;
    if (row._salvage_rowid !== undefined && row._salvage_rowid !== null) {
      const rid = String(row._salvage_rowid);
      if (seenRowids.has(rid)) return;
      seenRowids.add(rid);
    }
    const vals = tableSpec.columnNames.map(col => toSafeCellValue(row[col]));
    const res = insertStmt.run(...vals);
    if (res && Number(res.changes) > 0) insertedCount += Number(res.changes);
  };

  let forwardFailed = false;
  try {
    const stmt = sourceConn.prepare(`SELECT rowid AS _salvage_rowid, ${qCols} FROM ${qTable}`);
    for (const row of stmt.iterate()) {
      insertRowObject(row);
    }
  } catch (_) {
    forwardFailed = true;
  }

  if (!forwardFailed) return insertedCount;

  try {
    const revStmt = sourceConn.prepare(`SELECT rowid AS _salvage_rowid, ${qCols} FROM ${qTable} ORDER BY rowid DESC`);
    for (const row of revStmt.iterate()) {
      insertRowObject(row);
    }
  } catch (_) {
    // Continue to point-probe salvage
  }

  try {
    const probeStmt = sourceConn.prepare(`SELECT rowid AS _salvage_rowid, ${qCols} FROM ${qTable} WHERE rowid = ?`);
    for (let id = 1; id <= 500; id++) {
      if (seenRowids.has(String(id))) continue;
      try {
        const row = probeStmt.get(id);
        if (row) insertRowObject(row);
      } catch (_) {
        // Skip damaged page containing this rowid
      }
    }
  } catch (_) {
    // WITHOUT ROWID or unreadable B-tree root
  }

  return insertedCount;
}

function readSchemaCatalog(sourceConn) {
  const masterRows = sourceConn.prepare(
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"
  ).all();

  const rejectedObjects = [];
  const ftsTables = [];
  const candidateTables = [];

  for (const row of masterRows) {
    const objType = String(row.type || '').toLowerCase();
    const objName = String(row.name || '');
    const objSql = String(row.sql || '');

    if (objType === 'trigger' || objType === 'view') {
      rejectedObjects.push({ name: objName, type: objType, reason: `Executable schema object (${objType}) omitted` });
      continue;
    }
    if (objType !== 'table') continue;

    if (/^CREATE\s+VIRTUAL\s+TABLE\b/i.test(objSql)) {
      if (/USING\s+fts5\s*\(/i.test(objSql) && VALID_IDENT_RE.test(objName)) {
        ftsTables.push(objName);
      } else {
        rejectedObjects.push({ name: objName, type: 'virtual_table', reason: 'Untrusted virtual table module rejected' });
      }
      continue;
    }
    candidateTables.push({ name: objName, sql: objSql });
  }

  const userTables = candidateTables.filter(t => !isFts5ShadowTable(t.name, ftsTables));
  return { userTables, ftsTables, rejectedObjects };
}

function executeSalvagePass(sourcePath, targetPath) {
  let sourceConn = null;
  let targetConn = null;
  try {
    sourceConn = openHardenedSource(sourcePath);
    const catalog = readSchemaCatalog(sourceConn);
    const validSpecs = [];
    for (const tbl of catalog.userTables) {
      const spec = buildSafeTableDdl(sourceConn, tbl.name, tbl.sql);
      if (spec.ok) {
        validSpecs.push(spec);
      } else {
        catalog.rejectedObjects.push({ name: tbl.name, type: 'table', reason: spec.reason });
      }
    }

    if (validSpecs.length === 0) {
      return { ok: false, tables: 0, rows: 0, rejectedObjects: catalog.rejectedObjects };
    }

    if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
    targetConn = openHardenedTarget(targetPath);

    let totalRows = 0;
    targetConn.exec('BEGIN IMMEDIATE;');
    for (const spec of validSpecs) {
      targetConn.exec(spec.createSql);
      totalRows += salvageTableRows(sourceConn, targetConn, spec);
    }
    targetConn.exec('COMMIT;');

    return {
      ok: true,
      tables: validSpecs.length,
      rows: totalRows,
      rejectedObjects: catalog.rejectedObjects
    };
  } catch (_) {
    return { ok: false, tables: 0, rows: 0, rejectedObjects: [] };
  } finally {
    if (sourceConn && sourceConn.isOpen) { try { sourceConn.close(); } catch (_) { /* ignore */ } }
    if (targetConn && targetConn.isOpen) { try { targetConn.close(); } catch (_) { /* ignore */ } }
  }
}

function salvageDatabase(sourceDb, targetDb, options = {}) {
  const directRes = executeSalvagePass(sourceDb, targetDb);
  if (directRes.ok) {
    return directRes;
  }

  const stagingDir = options.stagingDir || path.dirname(targetDb);
  const probePath = createHeaderRepairedProbe(sourceDb, stagingDir);
  if (!probePath) {
    return directRes;
  }

  try {
    return executeSalvagePass(probePath, targetDb);
  } finally {
    try {
      if (fs.existsSync(probePath)) fs.unlinkSync(probePath);
    } catch (_) { /* best-effort cleanup */ }
  }
}

module.exports = {
  salvageDatabase,
  buildSafeTableDdl,
  quoteIdent
};
