'use strict';

/**
 * src/chunin_knowledge_ddl.js — Schema v11 DDL for the Chunin research knowledge store.
 *
 * Chunin re-runs the same research topics across sessions. This store keeps the
 * verified learnings from earlier runs so a later run can retrieve the top-5
 * relevant references before touching the network, then only search for what is
 * genuinely new.
 *
 * The vector column follows the repository's existing convention: a BLOB
 * `embedding` column registered with the bundled sqlite-vector extension via
 * `vector_init()`, not a sqlite-vec `vec0` virtual table. Reusing the extension
 * already vendored in `vendor/sqlite-vector` avoids a second vector engine and
 * keeps one distance implementation (COSINE, normalized FLOAT32, 384 dims).
 */

const CHUNIN_KNOWLEDGE_TABLE = 'chunin_knowledge';
const CHUNIN_KNOWLEDGE_FTS = 'chunin_knowledge_fts';

const CHUNIN_KNOWLEDGE_V11_DDL = `
  CREATE TABLE IF NOT EXISTS chunin_knowledge (
    id TEXT PRIMARY KEY,
    query_topic TEXT NOT NULL,
    learning_text TEXT NOT NULL,
    canonical_url TEXT NOT NULL DEFAULT '',
    source_title TEXT NOT NULL DEFAULT '',
    content_hash TEXT NOT NULL,
    citation_id TEXT NOT NULL DEFAULT '',
    confidence_tier TEXT NOT NULL DEFAULT 'unverified',
    created_at TEXT NOT NULL,
    last_verified_at TEXT NOT NULL DEFAULT '',
    embedding BLOB DEFAULT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_chunin_knowledge_hash
    ON chunin_knowledge(content_hash);

  CREATE INDEX IF NOT EXISTS idx_chunin_knowledge_topic
    ON chunin_knowledge(query_topic);

  CREATE INDEX IF NOT EXISTS idx_chunin_knowledge_url
    ON chunin_knowledge(canonical_url);

  CREATE VIRTUAL TABLE IF NOT EXISTS chunin_knowledge_fts USING fts5(
    learning_text,
    source_title,
    query_topic,
    content='chunin_knowledge',
    content_rowid='rowid'
  );

  CREATE TRIGGER IF NOT EXISTS chunin_knowledge_fts_ai AFTER INSERT ON chunin_knowledge BEGIN
    INSERT INTO chunin_knowledge_fts(rowid, learning_text, source_title, query_topic)
    VALUES (new.rowid, new.learning_text, new.source_title, new.query_topic);
  END;

  CREATE TRIGGER IF NOT EXISTS chunin_knowledge_fts_ad AFTER DELETE ON chunin_knowledge BEGIN
    INSERT INTO chunin_knowledge_fts(chunin_knowledge_fts, rowid, learning_text, source_title, query_topic)
    VALUES ('delete', old.rowid, old.learning_text, old.source_title, old.query_topic);
  END;

  CREATE TRIGGER IF NOT EXISTS chunin_knowledge_fts_au AFTER UPDATE ON chunin_knowledge BEGIN
    INSERT INTO chunin_knowledge_fts(chunin_knowledge_fts, rowid, learning_text, source_title, query_topic)
    VALUES ('delete', old.rowid, old.learning_text, old.source_title, old.query_topic);
    INSERT INTO chunin_knowledge_fts(rowid, learning_text, source_title, query_topic)
    VALUES (new.rowid, new.learning_text, new.source_title, new.query_topic);
  END;
`;

const CHUNIN_KNOWLEDGE_COLUMNS = [
  'id',
  'query_topic',
  'learning_text',
  'canonical_url',
  'source_title',
  'content_hash',
  'citation_id',
  'confidence_tier',
  'created_at',
  'last_verified_at'
];

function applyChuninKnowledgeSchema(conn) {
  conn.exec(CHUNIN_KNOWLEDGE_V11_DDL);
  return true;
}

module.exports = {
  CHUNIN_KNOWLEDGE_TABLE,
  CHUNIN_KNOWLEDGE_FTS,
  CHUNIN_KNOWLEDGE_COLUMNS,
  CHUNIN_KNOWLEDGE_V11_DDL,
  applyChuninKnowledgeSchema
};
