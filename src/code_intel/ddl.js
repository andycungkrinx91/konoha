'use strict';

/**
 * Schema v7 DDL and v6 -> v7 additive upgrades for the native code-intelligence index.
 *
 * Lives beside the subsystem it describes so `src/db_schema.js` stays the
 * migration orchestrator rather than a DDL dump. Seven declared tables (6
 * ordinary + 1 FTS5 virtual) plus 4 FTS5 extension shadow tables.
 */

const CODE_INTELLIGENCE_DDL = `
  CREATE TABLE IF NOT EXISTS code_index_roots (
    root_hash TEXT PRIMARY KEY,
    root_path TEXT NOT NULL UNIQUE,
    head_sha TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'stale' CHECK (status IN ('fresh','stale','indexing','failed')),
    file_count INTEGER NOT NULL DEFAULT 0,
    symbol_count INTEGER NOT NULL DEFAULT 0,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    indexed_epoch_ms INTEGER NOT NULL DEFAULT 0,
    indexed_at TEXT,
    updated_at TEXT NOT NULL,
    error TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS code_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root_hash TEXT NOT NULL REFERENCES code_index_roots(root_hash) ON DELETE CASCADE,
    rel_path TEXT NOT NULL,
    language TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    line_count INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    mtime_ms REAL NOT NULL DEFAULT 0,
    ctime_ms REAL NOT NULL DEFAULT 0,
    inode_id TEXT NOT NULL DEFAULT '',
    parser_version TEXT NOT NULL DEFAULT '',
    content_kind TEXT NOT NULL DEFAULT 'code',
    metrics_json TEXT NOT NULL DEFAULT '{}',
    indexed_at TEXT NOT NULL,
    UNIQUE (root_hash, rel_path)
  );

  CREATE TABLE IF NOT EXISTS code_symbols (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root_hash TEXT NOT NULL REFERENCES code_index_roots(root_hash) ON DELETE CASCADE,
    file_id INTEGER NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    parent_name TEXT NOT NULL DEFAULT '',
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    signature TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL,
    UNIQUE (file_id, name, kind, start_line)
  );

  CREATE TABLE IF NOT EXISTS code_refs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root_hash TEXT NOT NULL REFERENCES code_index_roots(root_hash) ON DELETE CASCADE,
    file_id INTEGER NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
    target_name TEXT NOT NULL,
    target_symbol_id INTEGER REFERENCES code_symbols(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    line INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS code_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root_hash TEXT NOT NULL,
    file_id INTEGER NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
    rel_path TEXT NOT NULL,
    language TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    body TEXT NOT NULL,
    chunk_kind TEXT NOT NULL DEFAULT 'block',
    symbol_id INTEGER REFERENCES code_symbols(id) ON DELETE SET NULL,
    content_hash TEXT NOT NULL DEFAULT '',
    embedding BLOB,
    embedding_model TEXT,
    UNIQUE (file_id, chunk_index)
  );

  CREATE INDEX IF NOT EXISTS idx_code_files_root ON code_files(root_hash);
  CREATE INDEX IF NOT EXISTS idx_code_files_lang ON code_files(root_hash, language);
  CREATE INDEX IF NOT EXISTS idx_code_symbols_name ON code_symbols(root_hash, name);
  CREATE INDEX IF NOT EXISTS idx_code_symbols_file ON code_symbols(file_id);
  CREATE INDEX IF NOT EXISTS idx_code_refs_target ON code_refs(root_hash, target_name);
  CREATE INDEX IF NOT EXISTS idx_code_refs_file ON code_refs(file_id);
  CREATE INDEX IF NOT EXISTS idx_code_chunks_root ON code_chunks(root_hash);
`;

const CODE_INTELLIGENCE_V7_DDL = `
  CREATE TABLE IF NOT EXISTS code_edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root_hash TEXT NOT NULL REFERENCES code_index_roots(root_hash) ON DELETE CASCADE,
    source_file_id INTEGER NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
    source_symbol_id INTEGER REFERENCES code_symbols(id) ON DELETE SET NULL,
    target_file_id INTEGER REFERENCES code_files(id) ON DELETE SET NULL,
    target_symbol_id INTEGER REFERENCES code_symbols(id) ON DELETE SET NULL,
    edge_kind TEXT NOT NULL,
    specifier TEXT NOT NULL DEFAULT '',
    confidence REAL NOT NULL DEFAULT 1.0
  );

  CREATE INDEX IF NOT EXISTS idx_code_chunks_reuse ON code_chunks(root_hash, content_hash, embedding_model);
  CREATE INDEX IF NOT EXISTS idx_code_edges_src ON code_edges(root_hash, source_file_id);
  CREATE INDEX IF NOT EXISTS idx_code_edges_dst ON code_edges(root_hash, target_file_id, edge_kind);
`;

const TABLE_INFO_QUERIES = {
  code_index_roots: 'PRAGMA table_info(code_index_roots)',
  code_files: 'PRAGMA table_info(code_files)',
  code_chunks: 'PRAGMA table_info(code_chunks)',
};

const V7_ADDITIVE_COLUMNS = [
  {
    table: 'code_index_roots',
    column: 'indexed_epoch_ms',
    alterSql: 'ALTER TABLE code_index_roots ADD COLUMN indexed_epoch_ms INTEGER NOT NULL DEFAULT 0',
  },
  {
    table: 'code_files',
    column: 'mtime_ms',
    alterSql: 'ALTER TABLE code_files ADD COLUMN mtime_ms REAL NOT NULL DEFAULT 0',
  },
  {
    table: 'code_files',
    column: 'ctime_ms',
    alterSql: 'ALTER TABLE code_files ADD COLUMN ctime_ms REAL NOT NULL DEFAULT 0',
  },
  {
    table: 'code_files',
    column: 'inode_id',
    alterSql: "ALTER TABLE code_files ADD COLUMN inode_id TEXT NOT NULL DEFAULT ''",
  },
  {
    table: 'code_files',
    column: 'parser_version',
    alterSql: "ALTER TABLE code_files ADD COLUMN parser_version TEXT NOT NULL DEFAULT ''",
  },
  {
    table: 'code_files',
    column: 'content_kind',
    alterSql: "ALTER TABLE code_files ADD COLUMN content_kind TEXT NOT NULL DEFAULT 'code'",
  },
  {
    table: 'code_files',
    column: 'metrics_json',
    alterSql: "ALTER TABLE code_files ADD COLUMN metrics_json TEXT NOT NULL DEFAULT '{}'",
  },
  {
    table: 'code_chunks',
    column: 'chunk_kind',
    alterSql: "ALTER TABLE code_chunks ADD COLUMN chunk_kind TEXT NOT NULL DEFAULT 'block'",
  },
  {
    table: 'code_chunks',
    column: 'symbol_id',
    alterSql: 'ALTER TABLE code_chunks ADD COLUMN symbol_id INTEGER REFERENCES code_symbols(id) ON DELETE SET NULL',
  },
  {
    table: 'code_chunks',
    column: 'content_hash',
    alterSql: "ALTER TABLE code_chunks ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''",
  },
];

function applyV7AdditiveColumns(conn) {
  const colsByTable = new Map();
  for (const spec of V7_ADDITIVE_COLUMNS) {
    let cols = colsByTable.get(spec.table);
    if (!cols) {
      cols = new Set(conn.prepare(TABLE_INFO_QUERIES[spec.table]).all().map((c) => c.name));
      colsByTable.set(spec.table, cols);
    }
    if (!cols.has(spec.column)) {
      conn.prepare(spec.alterSql).run();
      cols.add(spec.column);
    }
  }
}

const CODE_INTELLIGENCE_FTS_DDL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS code_chunks_fts USING fts5(
    body, rel_path, language,
    content='code_chunks', content_rowid='id',
    tokenize="unicode61 remove_diacritics 2"
  );
  CREATE TRIGGER IF NOT EXISTS code_chunks_ai AFTER INSERT ON code_chunks BEGIN
    INSERT INTO code_chunks_fts(rowid, body, rel_path, language) VALUES (new.id, new.body, new.rel_path, new.language);
  END;
  CREATE TRIGGER IF NOT EXISTS code_chunks_ad AFTER DELETE ON code_chunks BEGIN
    INSERT INTO code_chunks_fts(code_chunks_fts, rowid, body, rel_path, language) VALUES('delete', old.id, old.body, old.rel_path, old.language);
  END;
  CREATE TRIGGER IF NOT EXISTS code_chunks_au AFTER UPDATE ON code_chunks BEGIN
    INSERT INTO code_chunks_fts(code_chunks_fts, rowid, body, rel_path, language) VALUES('delete', old.id, old.body, old.rel_path, old.language);
    INSERT INTO code_chunks_fts(rowid, body, rel_path, language) VALUES (new.id, new.body, new.rel_path, new.language);
  END;
`;

module.exports = {
  CODE_INTELLIGENCE_DDL,
  CODE_INTELLIGENCE_V7_DDL,
  CODE_INTELLIGENCE_FTS_DDL,
  V7_ADDITIVE_COLUMNS,
  applyV7AdditiveColumns
};
