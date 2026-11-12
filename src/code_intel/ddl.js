'use strict';

/**
 * Schema v6 DDL for the native code-intelligence index.
 *
 * Lives beside the subsystem it describes so `src/db_schema.js` stays the
 * migration orchestrator rather than a DDL dump. Six declared tables (5
 * ordinary + 1 FTS5 virtual) plus 4 extension-created shadow tables.
 */

// Schema v6: native code intelligence index. Six declared tables (5 ordinary +
// 1 FTS5 virtual) plus 4 extension-created shadow tables.
const CODE_INTELLIGENCE_DDL = `
  CREATE TABLE IF NOT EXISTS code_index_roots (
    root_hash TEXT PRIMARY KEY,
    root_path TEXT NOT NULL UNIQUE,
    head_sha TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'stale' CHECK (status IN ('fresh','stale','indexing','failed')),
    file_count INTEGER NOT NULL DEFAULT 0,
    symbol_count INTEGER NOT NULL DEFAULT 0,
    chunk_count INTEGER NOT NULL DEFAULT 0,
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

module.exports = { CODE_INTELLIGENCE_DDL, CODE_INTELLIGENCE_FTS_DDL };
