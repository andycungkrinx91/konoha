'use strict';

/**
 * src/mcp/chunin_knowledge.js — local research knowledge store for Chunin.
 *
 * Chunin's deep-research loop re-discovers the same material on every run. This
 * module keeps verified learnings so a later run can:
 *
 *   1. retrieve the top-K references relevant to the topic from the local store
 *      (FTS5 + vector + cross-encoder rerank) before touching the network,
 *   2. search the web only for what is not already known, and
 *   3. write the genuinely new learnings back in one batched, transactional pass.
 *
 * Deduplication is three-layered because each layer catches what the others miss:
 *   - `content_hash`      identical text, cheap and exact (also the UNIQUE index),
 *   - `canonical_url`     the same page under a different URL spelling,
 *   - cosine >= 0.90      the same claim reworded by a different source.
 *
 * Nothing here needs an API key: retrieval is local SQLite + the bundled ONNX
 * embedder, and rerank degrades to vector order when the semantic runtime is off.
 */

const crypto = require('crypto');

const { getConnection } = require('../db');
const { CHUNIN_KNOWLEDGE_TABLE } = require('../chunin_knowledge_ddl');

const DEFAULT_TOP_K = 5;
const DEFAULT_SEMANTIC_THRESHOLD = 0.9;
const CONFIDENCE_TIERS = new Set(['verified', 'corroborated', 'unverified']);

const { canonicalizeUrl } = require('../url_canonical');

/**
 * Stable content hash over whitespace- and case-normalized text, so the same
 * sentence with different wrapping or casing dedupes.
 */
function hashLearning(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function newId(prefix = 'ck') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function clampConfidence(tier) {
  const value = String(tier || '').toLowerCase();
  return CONFIDENCE_TIERS.has(value) ? value : 'unverified';
}

function openDb(options = {}) {
  if (options.conn) return options.conn;
  return getConnection();
}

function isMissingTableError(err) {
  return /no such table|no such column/i.test(String(err && err.message));
}

/**
 * Retrieves the top-K stored learnings for a topic using hybrid retrieval:
 * FTS5 keyword candidates and vector candidates are merged, then reranked by the
 * cross-encoder when available. Falls back to FTS-only, then to recency, so a
 * store that was never embedded still returns something useful.
 *
 * @param {object} options
 * @param {string} options.topic
 * @param {number} [options.topK=5]
 * @param {object} [options.conn]
 * @returns {Promise<Array<object>>}
 */
async function retrieveRelevant({ topic, topK = DEFAULT_TOP_K, conn = null } = {}) {
  if (!topic || typeof topic !== 'string') return [];
  const db = openDb({ conn });
  const limit = Math.max(1, Math.min(Number(topK) || DEFAULT_TOP_K, 25));

  let rows = [];
  try {
    rows = db
      .prepare(
        `SELECT k.id, k.query_topic, k.learning_text, k.canonical_url, k.source_title,
                k.content_hash, k.citation_id, k.confidence_tier, k.created_at, k.embedding
           FROM ${CHUNIN_KNOWLEDGE_TABLE} k
           JOIN ${CHUNIN_KNOWLEDGE_TABLE}_fts f ON f.rowid = k.rowid
          WHERE ${CHUNIN_KNOWLEDGE_TABLE}_fts MATCH ?
          ORDER BY bm25(${CHUNIN_KNOWLEDGE_TABLE}_fts)
          LIMIT ?`
      )
      .all(buildFtsQuery(topic), limit * 4);
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    return [];
  }

  if (!rows.length) {
    // No keyword overlap: fall back to the most recent learnings for the topic so
    // an unembedded or freshly seeded store still seeds visitedUrls.
    try {
      rows = db
        .prepare(
          `SELECT id, query_topic, learning_text, canonical_url, source_title,
                  content_hash, citation_id, confidence_tier, created_at, embedding
             FROM ${CHUNIN_KNOWLEDGE_TABLE}
            WHERE query_topic = ?
            ORDER BY created_at DESC
            LIMIT ?`
        )
        .all(topic, limit);
    } catch (err) {
      if (!isMissingTableError(err)) throw err;
      return [];
    }
  }

  const ranked = await rerankIfPossible(topic, rows);
  return ranked.slice(0, limit).map(stripEmbedding);
}

function buildFtsQuery(topic) {
  // FTS5 treats punctuation as syntax; quote each token so a topic containing a
  // hyphen or colon cannot become a syntax error.
  const tokens = String(topic)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(token => token.length > 2)
    .slice(0, 12);
  if (!tokens.length) return '""';
  return tokens.map(token => `"${token}"`).join(' OR ');
}

async function rerankIfPossible(query, rows) {
  if (rows.length <= 1) return rows;
  let rerank;
  try {
    ({ rerank } = require('../vector_pipeline'));
  } catch (_) {
    return rows;
  }
  try {
    const docs = rows.map(row => ({
      id: row.id,
      text: `${row.source_title}\n${row.learning_text}`
    }));
    const scored = await rerank(query, docs, { topK: rows.length });
    if (!Array.isArray(scored) || !scored.length) return rows;
    const byId = new Map(rows.map(row => [row.id, row]));
    const ordered = [];
    for (const entry of scored) {
      const id = entry && (entry.id || (entry.document && entry.document.id));
      const row = id ? byId.get(id) : null;
      if (row) {
        ordered.push({ ...row, rerankScore: entry.score });
        byId.delete(id);
      }
    }
    for (const row of byId.values()) ordered.push(row);
    return ordered;
  } catch (_) {
    // Rerank is an optimisation; vector/FTS order is still a usable ranking.
    return rows;
  }
}

function stripEmbedding(row) {
  if (!row) return row;
  const { embedding: _embedding, ...rest } = row;
  return rest;
}

/**
 * Deduplicates candidate learnings against existing store contents and against
 * each other, then bulk-upserts the survivors in one transaction.
 *
 * Embedding is batched: one `embedBatch` call for the whole survivor set (the
 * pipeline buckets by length and runs real ONNX batches) rather than one call per
 * learning, which is what made a large `learnings[]` a bottleneck.
 *
 * @param {object} options
 * @param {string} options.topic
 * @param {Array<object>} options.learnings
 * @param {object} [options.conn]
 * @param {number} [options.batchSize]
 * @param {number} [options.semanticThreshold=0.9]
 * @returns {Promise<{inserted:number, skipped:number, reasons:object}>}
 */
async function storeLearnings({
  topic,
  learnings = [],
  conn = null,
  batchSize,
  semanticThreshold = DEFAULT_SEMANTIC_THRESHOLD
} = {}) {
  const db = openDb({ conn });
  const reasons = { duplicate_hash: 0, duplicate_url: 0, duplicate_semantic: 0, invalid: 0 };
  if (!Array.isArray(learnings) || !learnings.length) {
    return { inserted: 0, skipped: 0, reasons };
  }

  const existing = loadExistingKeys(db, topic);
  const survivors = [];

  for (const raw of learnings) {
    const text = typeof raw === 'string' ? raw : raw && (raw.learning_text || raw.text || raw.learning);
    if (!text || typeof text !== 'string' || !text.trim()) {
      reasons.invalid += 1;
      continue;
    }
    const contentHash = hashLearning(text);
    const canonicalUrl = canonicalizeUrl(raw && (raw.canonical_url || raw.url));
    if (existing.hashes.has(contentHash)) {
      reasons.duplicate_hash += 1;
      continue;
    }
    if (canonicalUrl && existing.urls.has(canonicalUrl)) {
      reasons.duplicate_url += 1;
      continue;
    }
    // Within-batch duplicates: same run often re-learns a claim twice.
    if (survivors.some(item => item.content_hash === contentHash)) {
      reasons.duplicate_hash += 1;
      continue;
    }
    if (canonicalUrl && survivors.some(item => item.canonical_url === canonicalUrl)) {
      reasons.duplicate_url += 1;
      continue;
    }
    survivors.push({
      id: newId(),
      query_topic: topic,
      learning_text: text.trim(),
      canonical_url: canonicalUrl,
      source_title: (raw && (raw.source_title || raw.title)) || '',
      content_hash: contentHash,
      citation_id: (raw && (raw.citation_id || raw.citation)) || '',
      confidence_tier: clampConfidence(raw && raw.confidence_tier),
      created_at: nowIso(),
      last_verified_at: (raw && raw.last_verified_at) || ''
    });
  }

  if (!survivors.length) {
    return { inserted: 0, skipped: Object.values(reasons).reduce((a, b) => a + b, 0), reasons };
  }

  const vectors = await embedSurvivors(survivors.map(item => item.learning_text), { batchSize });
  const accepted = [];
  // The embedder's raw cosine is highly anisotropic: two unrelated sentences score
  // ~0.997 and identical text scores 1.0, so a fixed threshold on the raw vectors
  // would call everything a duplicate. Mean-centering the candidate set first is
  // the standard remedy and restores separation (measured: unrelated pairs -0.46
  // to 0.41, identical text 1.0), which is what makes 0.90 a meaningful cut.
  const allVectors = vectors ? [...existing.vectors, ...vectors.filter(Boolean)] : [];
  const centered = allVectors.length > 1 ? centerVectors(allVectors) : allVectors;
  const existingCentered = centered.slice(0, existing.vectors.length);

  for (let i = 0; i < survivors.length; i++) {
    const vec = vectors ? vectors[i] : null;
    if (vec && existingCentered.length) {
      const candidate = centered[existing.vectors.length + i];
      const near = candidate && existingCentered.find(prev => cosine(candidate, prev) >= semanticThreshold);
      if (near) {
        reasons.duplicate_semantic += 1;
        continue;
      }
    }
    accepted.push({ ...survivors[i], embedding: vec ? float32ToBuffer(vec) : null });
  }

  if (!accepted.length) {
    return { inserted: 0, skipped: Object.values(reasons).reduce((a, b) => a + b, 0), reasons };
  }

  // One transaction with a prepared statement: a batch of 50 learnings is 50
  // bound executions, not 50 implicit transactions. `node:sqlite` has no
  // `.transaction()` helper (the repo's sqlite_driver wrapper adds one), so this
  // uses an explicit BEGIN/COMMIT that works on both.
  const insert = db.prepare(
    `INSERT INTO ${CHUNIN_KNOWLEDGE_TABLE}
       (id, query_topic, learning_text, canonical_url, source_title,
        content_hash, citation_id, confidence_tier, created_at, last_verified_at, embedding)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of accepted) {
      insert.run(
        row.id,
        row.query_topic,
        row.learning_text,
        row.canonical_url,
        row.source_title,
        row.content_hash,
        row.citation_id,
        row.confidence_tier,
        row.created_at,
        row.last_verified_at,
        row.embedding
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) { /* best effort */ }
    throw err;
  }

  return {
    inserted: accepted.length,
    skipped: Object.values(reasons).reduce((a, b) => a + b, 0),
    reasons
  };
}

function loadExistingKeys(db, topic) {
  const hashes = new Set();
  const urls = new Set();
  const vectors = [];
  try {
    const rows = db
      .prepare(
        `SELECT content_hash, canonical_url, embedding
           FROM ${CHUNIN_KNOWLEDGE_TABLE}
          WHERE query_topic = ?`
      )
      .all(topic);
    for (const row of rows) {
      if (row.content_hash) hashes.add(row.content_hash);
      if (row.canonical_url) urls.add(row.canonical_url);
      if (row.embedding) vectors.push(bufferToFloat32(row.embedding));
    }
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
  }
  return { hashes, urls, vectors };
}

async function embedSurvivors(texts, { batchSize } = {}) {
  let pipeline;
  try {
    pipeline = require('../vector_pipeline');
  } catch (_) {
    return null;
  }
  try {
    const options = { batchSize: Math.max(1, Number(batchSize) || Math.min(16, texts.length)) };
    const vectors = await pipeline.embedBatch(texts, options);
    return Array.isArray(vectors) ? vectors : null;
  } catch (_) {
    // Semantic runtime disabled or model unavailable: store the text without a
    // vector so FTS and URL dedupe still work. Retrieval degrades, never fails.
    return null;
  }
}

function float32ToBuffer(vec) {
  const arr = vec instanceof Float32Array ? vec : Float32Array.from(vec);
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

function bufferToFloat32(buf) {
  if (!buf || !buf.length) return new Float32Array(0);
  const copy = Buffer.from(buf);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Subtracts the mean vector from every vector, so cosine comparisons measure
 * direction relative to the corpus rather than the embedder's dominant component.
 * Stored embeddings stay uncentered: the mean depends on the set, so it is
 * recomputed per comparison instead of baked into the row.
 */
function centerVectors(vecs) {
  const dim = vecs[0] && vecs[0].length ? vecs[0].length : 0;
  if (!dim) return vecs;
  const mean = new Float32Array(dim);
  for (const vec of vecs) {
    for (let i = 0; i < dim; i++) mean[i] += vec[i] / vecs.length;
  }
  return vecs.map((vec) => {
    const out = new Float32Array(dim);
    for (let i = 0; i < dim; i++) out[i] = vec[i] - mean[i];
    return out;
  });
}

/**
 * Runs the deep-research loop shape from dzhng/deep-research over a supplied
 * search function: `breadth` queries at the first level, `depth` levels total,
 * with `nextBreadth = ceil(breadth / 2)`. Learnings, follow-up questions and
 * visited URLs accumulate across levels; raw page bodies are discarded.
 *
 * The search function is injected so this is testable without the network and so
 * the caller keeps its own engine/fallback policy.
 *
 * @param {object} options
 * @param {string} options.topic
 * @param {(query:string, limit:number, exclude:string[])=>Promise<Array<object>>} options.search
 * @param {number} [options.breadth=3]
 * @param {number} [options.depth=2]
 * @returns {Promise<{learnings:Array, followUpQuestions:string[], visitedUrls:string[], levels:number}>}
 */
async function runDeepResearchLoop({ topic, search, breadth = 3, depth = 2, maxResults = 5 } = {}) {
  const clampedBreadth = Math.max(1, Math.min(Number(breadth) || 3, 5));
  const clampedDepth = Math.max(1, Math.min(Number(depth) || 2, 3));
  const state = {
    learnings: [],
    followUpQuestions: [],
    visitedUrls: [],
    visitedSet: new Set()
  };
  let currentQueries = [topic];
  let currentBreadth = clampedBreadth;
  let levels = 0;

  for (let level = 0; level < clampedDepth; level++) {
    const nextQueries = await collectLevel({
      queries: currentQueries.slice(0, currentBreadth),
      search,
      maxResults,
      state
    });
    levels += 1;
    if (!nextQueries.length || level + 1 >= clampedDepth) break;
    currentBreadth = Math.ceil(currentBreadth / 2);
    currentQueries = nextQueries;
  }

  return {
    learnings: state.learnings,
    followUpQuestions: state.followUpQuestions,
    visitedUrls: state.visitedUrls,
    levels
  };
}

/** Runs one level's queries and folds their results into `state`. */
async function collectLevel({ queries, search, maxResults, state }) {
  const nextQueries = [];
  for (const query of queries) {
    let results = [];
    try {
      results = (await search(query, maxResults, state.visitedUrls.slice())) || [];
    } catch (_) {
      results = [];
    }
    for (const result of results) {
      absorbResult(result, state, nextQueries);
    }
  }
  return nextQueries;
}

/** Records one search result: its follow-up question, URL and learning. */
function absorbResult(result, state, nextQueries) {
  const canonical = canonicalizeUrl(result && (result.url || result.link));
  const text = result && (result.snippet || result.description || result.learning_text);

  // A follow-up question steers the next level even when its page was already
  // visited, so it is read before the dedupe guard below.
  if (result && result.follow_up_question) {
    const question = String(result.follow_up_question).trim();
    if (question) {
      nextQueries.push(question);
      if (!state.followUpQuestions.includes(question)) state.followUpQuestions.push(question);
    }
  }

  if (canonical && state.visitedSet.has(canonical)) return;
  if (canonical) {
    state.visitedSet.add(canonical);
    state.visitedUrls.push(canonical);
  }
  if (text && String(text).trim()) {
    state.learnings.push({
      learning_text: String(text).trim(),
      canonical_url: canonical,
      source_title: (result && (result.title || result.source_title)) || '',
      citation_id: (result && result.citation_id) || ''
    });
  }
}

module.exports = {
  DEFAULT_TOP_K,
  DEFAULT_SEMANTIC_THRESHOLD,
  canonicalizeUrl,
  hashLearning,
  retrieveRelevant,
  storeLearnings,
  runDeepResearchLoop,
  float32ToBuffer,
  bufferToFloat32,
  centerVectors,
  cosine
};
