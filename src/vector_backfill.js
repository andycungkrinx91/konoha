'use strict';

/**
 * Chunk embedding cache lookup and cross-skill batched embedding backfill
 * for Konoha skills/references (`skill_chunks` table).
 */

const { VECTOR_DIMENSION, initVectorTableIfSupported } = require('./vector_extension');
const { _EMBED_CACHE, isSemanticSearchEnabled, embedBatch } = require('./vector_pipeline');
const { chunkDocument } = require('./vector_chunker');

const CROSS_SKILL_BATCH_CHUNKS = 32;

function recordCachedChunkRow(r, localCache) {
  if (r.chunk_text && r.embedding && r.embedding.length === VECTOR_DIMENSION * 4) {
    localCache.set(r.chunk_text, r.embedding);
  }
}

function loadSkillChunkEmbedCache(conn, skillName) {
  const localCache = new Map();
  try {
    const existing = conn.prepare(
      'SELECT chunk_text, embedding FROM skill_chunks WHERE skill_name = ? AND embedding IS NOT NULL'
    ).all(skillName);
    for (const r of existing) recordCachedChunkRow(r, localCache);
  } catch (_) { /* intentional fallback */ }
  return localCache;
}

function lookupGlobalReusableChunkBlobs(conn, texts) {
  const reusable = new Map();
  if (!texts.length) return reusable;
  const BATCH = 64;
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    const placeholders = slice.map(() => '?').join(',');
    const rows = conn.prepare(`
      SELECT chunk_text, embedding
      FROM skill_chunks
      WHERE chunk_text IN (${placeholders}) AND embedding IS NOT NULL
    `).all(...slice);
    for (const r of rows) {
      if (r.chunk_text && r.embedding && r.embedding.length === VECTOR_DIMENSION * 4 && !reusable.has(r.chunk_text)) {
        reusable.set(r.chunk_text, r.embedding);
      }
    }
  }
  return reusable;
}

function _prepareSkillChunkPlan(conn, skillName, content, sessionReuse) {
  const chunks = chunkDocument(content);
  if (!chunks.length) {
    conn.prepare('DELETE FROM skill_chunks WHERE skill_name = ?').run(skillName);
    return { skillName, chunks: [], needInference: [], localCache: new Map(), globalReuse: new Map() };
  }
  const localCache = loadSkillChunkEmbedCache(conn, skillName);
  const missingUnique = [];
  const missingSeen = new Set();
  for (const [, chunkText] of chunks) {
    if (sessionReuse && sessionReuse.has(chunkText)) continue;
    const blob = localCache.get(chunkText);
    if (!blob || blob.length !== VECTOR_DIMENSION * 4) {
      if (!missingSeen.has(chunkText)) {
        missingSeen.add(chunkText);
        missingUnique.push(chunkText);
      }
    }
  }
  const uncachedInMem = sessionReuse ? missingUnique.filter((t) => !sessionReuse.has(t)) : missingUnique;
  const globalReuse = lookupGlobalReusableChunkBlobs(conn, uncachedInMem);
  if (sessionReuse) {
    for (const [k, v] of globalReuse.entries()) sessionReuse.set(k, v);
  }
  const needInference = uncachedInMem.filter((t) => !globalReuse.has(t));
  return { skillName, chunks, needInference, localCache, globalReuse };
}

function _commitSkillChunkPlan(conn, plan, computedBlobs, sessionReuse) {
  if (!plan.chunks.length) return 0;
  const resolved = plan.chunks.map(([idx, chunkText]) => {
    const cached = plan.localCache.get(chunkText);
    const validLocal = cached && cached.length === VECTOR_DIMENSION * 4 ? cached : null;
    const blob =
      validLocal ||
      (sessionReuse && sessionReuse.get(chunkText)) ||
      plan.globalReuse.get(chunkText) ||
      computedBlobs.get(chunkText) ||
      null;
    return [idx, chunkText, blob];
  });
  conn.transaction(() => {
    conn.prepare('DELETE FROM skill_chunks WHERE skill_name = ?').run(plan.skillName);
    const stmt = conn.prepare('INSERT INTO skill_chunks (skill_name, chunk_index, chunk_text, embedding) VALUES (?, ?, ?, ?)');
    for (const [idx, chunkText, blob] of resolved) {
      stmt.run(plan.skillName, idx, chunkText, blob);
    }
  })();
  return plan.chunks.length;
}

async function _embedPendingTexts(texts, sessionReuse) {
  const computedBlobs = new Map();
  if (!texts.length || !isSemanticSearchEnabled()) return computedBlobs;
  const vecs = await embedBatch(texts);
  for (let i = 0; i < texts.length; i++) {
    const vec = vecs[i];
    if (!vec || vec.length !== VECTOR_DIMENSION) {
      throw new Error(`Embedding dimension mismatch: expected ${VECTOR_DIMENSION}, got ${vec ? vec.length : 0}`);
    }
    const buf = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
    computedBlobs.set(texts[i], buf);
    if (sessionReuse) sessionReuse.set(texts[i], buf);
  }
  return computedBlobs;
}

async function indexSingleSkillChunks(conn, skillName, content) {
  const plan = _prepareSkillChunkPlan(conn, skillName, content, null);
  if (!plan.chunks.length) return 0;
  const computedBlobs = await _embedPendingTexts(plan.needInference, null);
  return _commitSkillChunkPlan(conn, plan, computedBlobs, null);
}

async function _flushBackfillGroup(conn, plans, pendingTexts, sessionReuse) {
  const computedBlobs = await _embedPendingTexts(pendingTexts, sessionReuse);
  let total = 0;
  for (const plan of plans) {
    total += _commitSkillChunkPlan(conn, plan, computedBlobs, sessionReuse);
  }
  return total;
}

async function backfillAllEmbeddings(conn, forceRebuild = false, maxTimeSeconds = 180.0, onProgress = null) {
  if (!isSemanticSearchEnabled() && !forceRebuild) return 0;
  const startTime = Date.now();
  const report = (done, total, stage) => {
    if (typeof onProgress !== 'function') return;
    try {
      onProgress({ done, total, stage });
    } catch (_) { /* a broken reporter must never abort embedding */ }
  };
  initVectorTableIfSupported(conn);
  if (forceRebuild) {
    conn.prepare('DELETE FROM skill_chunks').run();
    _EMBED_CACHE.clear();
  }

  const existingIndexed = new Set(
    conn.prepare('SELECT DISTINCT skill_name FROM skill_chunks WHERE embedding IS NOT NULL').all().map((r) => r.skill_name)
  );
  const skillHeaders = conn.prepare(
    "SELECT name, type FROM skills ORDER BY CASE WHEN type = 'skill' THEN 0 ELSE 1 END, name ASC"
  ).all();
  const getContentStmt = conn.prepare('SELECT content FROM skills WHERE name = ?');

  const sessionReuse = new Map();
  let groupPlans = [];
  let pendingTexts = [];
  const pendingSet = new Set();
  let totalChunks = 0;

  // Header count is known up front, so the bar can show a real percentage from
  // the first skill instead of pulsing. Some headers turn out empty or already
  // indexed and are skipped; the total is then simply not reached, which is why
  // `finish()` is driven by the loop completing rather than by `done === total`.
  const totalSkills = skillHeaders.length;
  let processedSkills = 0;
  report(0, totalSkills, 'preparing');

  for (const h of skillHeaders) {
    const sName = h.name;
    if (!forceRebuild && existingIndexed.has(sName)) {
      processedSkills += 1;
      report(processedSkills, totalSkills, sName);
      continue;
    }
    if (h.type !== 'skill' && maxTimeSeconds > 0 && ((Date.now() - startTime) / 1000) > maxTimeSeconds) break;

    const row = getContentStmt.get(sName);
    if (!row || !row.content) {
      processedSkills += 1;
      report(processedSkills, totalSkills, sName);
      continue;
    }
    const plan = _prepareSkillChunkPlan(conn, sName, row.content, sessionReuse);
    groupPlans.push(plan);
    for (const t of plan.needInference) {
      if (!pendingSet.has(t)) {
        pendingSet.add(t);
        pendingTexts.push(t);
      }
    }
    if (pendingTexts.length >= CROSS_SKILL_BATCH_CHUNKS) {
      totalChunks += await _flushBackfillGroup(conn, groupPlans, pendingTexts, sessionReuse);
      groupPlans = [];
      pendingTexts = [];
      pendingSet.clear();
    }
    processedSkills += 1;
    report(processedSkills, totalSkills, sName);
  }
  if (groupPlans.length > 0) {
    totalChunks += await _flushBackfillGroup(conn, groupPlans, pendingTexts, sessionReuse);
  }
  // The loop `break`s on the time budget, leaving the alphabetical tail
  // unembedded. Reporting `totalSkills/totalSkills` here would claim a completion
  // the run did not reach, so report what actually happened and let the bar say
  // where it stopped.
  const truncated = processedSkills < totalSkills;
  report(processedSkills, totalSkills, truncated ? 'time budget reached' : 'finalizing');

  if (totalChunks > 0) initVectorTableIfSupported(conn);
  return totalChunks;
}

module.exports = {
  indexSingleSkillChunks,
  backfillAllEmbeddings
};
