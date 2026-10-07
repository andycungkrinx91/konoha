'use strict';

/**
 * Synchronous SQLite driver for Konoha built on Node's bundled `node:sqlite`
 * (Node >= 22.16 ships SQLite with FTS5 enabled). Exposes the small
 * better-sqlite3-style surface the codebase relies on — prepare, exec,
 * pragma, transaction, loadExtension, close — so the runtime has zero native
 * dependencies and nothing to compile at install time.
 */

const fs = require('fs');

const SQLITE_EXPERIMENTAL_WARNING = 'SQLite is an experimental feature';
const NAMED_PARAMETER = /[:@$]([A-Za-z_][A-Za-z0-9_]*)/g;
const DEFAULT_BUSY_TIMEOUT_MS = 5000;

// node:sqlite prints an ExperimentalWarning to stderr when first loaded on
// Node 22/24. Filter only that warning, only while the module loads, so MCP
// stdio sessions and CLI output stay clean.
function loadNodeSqlite() {
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = function emitWarningWithoutSqliteNotice(warning, ...rest) {
    const text = typeof warning === 'string' ? warning : String((warning && warning.message) || '');
    if (text.includes(SQLITE_EXPERIMENTAL_WARNING)) return undefined;
    return originalEmitWarning.call(process, warning, ...rest);
  };
  try {
    return require('node:sqlite');
  } catch (err) {
    throw new Error(`Konoha requires Node.js >= 22.16 with the built-in node:sqlite module (${err.message})`);
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

const { DatabaseSync } = loadNodeSqlite();

function isNamedParameterObject(value) {
  return value !== null
    && typeof value === 'object'
    && !ArrayBuffer.isView(value)
    && !(value instanceof ArrayBuffer);
}

// better-sqlite3 binds `undefined` and booleans leniently; node:sqlite rejects them.
function toBindable(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

// node:sqlite returns null-prototype rows and Uint8Array blobs; callers expect
// plain objects and Buffers (as better-sqlite3 returned).
function normalizeRow(row) {
  if (row === undefined || row === null) return row;
  const plain = {};
  for (const key of Object.keys(row)) {
    const value = row[key];
    plain[key] = value instanceof Uint8Array && !Buffer.isBuffer(value)
      ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
      : value;
  }
  return plain;
}

class Statement {
  constructor(statement) {
    this._statement = statement;
    this._parameterNames = null;
    this.source = statement.sourceSQL;
  }

  _namesInSql() {
    if (!this._parameterNames) {
      this._parameterNames = new Set();
      for (const match of this.source.matchAll(NAMED_PARAMETER)) {
        this._parameterNames.add(match[1]);
      }
    }
    return this._parameterNames;
  }

  // node:sqlite throws on object keys that are not parameters of the
  // statement; better-sqlite3 ignored them. Keep only keys the SQL references.
  _pickNamed(params) {
    const names = this._namesInSql();
    const picked = {};
    for (const key of Object.keys(params)) {
      if (names.has(key)) picked[key] = toBindable(params[key]);
    }
    return picked;
  }

  _bind(args) {
    const positional = [];
    let named = null;
    for (const arg of args.flat()) {
      if (isNamedParameterObject(arg)) {
        named = this._pickNamed(arg);
      } else {
        positional.push(toBindable(arg));
      }
    }
    return named ? [named, ...positional] : positional;
  }

  run(...args) {
    return this._statement.run(...this._bind(args));
  }

  get(...args) {
    return normalizeRow(this._statement.get(...this._bind(args)));
  }

  all(...args) {
    return this._statement.all(...this._bind(args)).map(normalizeRow);
  }

  *iterate(...args) {
    for (const row of this._statement.iterate(...this._bind(args))) {
      yield normalizeRow(row);
    }
  }
}

class Database {
  constructor(filename = ':memory:', options = {}) {
    const readOnly = Boolean(options.readonly || options.readOnly);
    if (options.fileMustExist && filename !== ':memory:' && !fs.existsSync(filename)) {
      throw new Error(`unable to open database file: ${filename}`);
    }
    this._db = new DatabaseSync(filename, { readOnly, allowExtension: true });
    this._savepointDepth = 0;
    this.name = filename;
    this.readonly = readOnly;
    this.memory = filename === ':memory:';
    const timeout = Number.isInteger(options.timeout) ? options.timeout : DEFAULT_BUSY_TIMEOUT_MS;
    this._db.exec(`PRAGMA busy_timeout = ${timeout}`);
  }

  get open() {
    return this._db.isOpen;
  }

  get inTransaction() {
    return this._db.isTransaction;
  }

  prepare(sql) {
    return new Statement(this._db.prepare(sql));
  }

  exec(sql) {
    this._db.exec(sql);
    return this;
  }

  pragma(source, options = {}) {
    const rows = this.prepare(`PRAGMA ${source}`).all();
    if (!options.simple) return rows;
    return rows.length > 0 ? Object.values(rows[0])[0] : undefined;
  }

  transaction(fn) {
    const database = this;
    return function runTransaction(...args) {
      return database._runInTransaction(fn, this, args);
    };
  }

  _runInTransaction(fn, thisArg, args) {
    const nested = this._db.isTransaction;
    const savepoint = `konoha_sp_${this._savepointDepth}`;
    this._db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN');
    this._savepointDepth += 1;
    try {
      const result = fn.apply(thisArg, args);
      this._db.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
      return result;
    } catch (err) {
      if (this._db.isTransaction) {
        this._db.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK');
      }
      throw err;
    } finally {
      this._savepointDepth -= 1;
    }
  }

  loadExtension(file) {
    if (typeof file !== 'string' || file.length === 0) {
      throw new TypeError('Extension path must be a non-empty string');
    }
    this._db.enableLoadExtension(true);
    try {
      this._db.loadExtension(file);
    } finally {
      this._db.enableLoadExtension(false);
    }
    return this;
  }

  close() {
    if (this._db.isOpen) this._db.close();
    return this;
  }
}

module.exports = Database;
module.exports.Database = Database;
module.exports.normalizeRow = normalizeRow;
