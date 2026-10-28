/**
 * Hybrid semantic search, ONNX embeddings, and cross-encoder reranker for Konoha.
 * Pure Node.js replacement for vector_search.py using @huggingface/transformers and the node:sqlite driver.
 */

'use strict';

const crypto = require('crypto');

const {
  VECTOR_DIMENSION,
  getPlatformTag,
  getPlatformAssetInfo,
  getVendorDir,
  ensureVectorExtension,
  loadVectorExtension,
  initVectorTableIfSupported,
  enableLoadExtensionSafe
} = require('./vector_extension');

const {
  EMBED_MODEL_REPO,
  RERANK_MODEL_REPO,
  _EMBED_CACHE,
  isSemanticSearchEnabled,
  getBundledModelsDir,
  getRerankPipeline,
  predownloadAllModels,
  embedText,
  cosineSimilarity,
  rerank
} = require('./vector_pipeline');

const {
  chunkDocument,
  reciprocalRankFusion
} = require('./vector_chunker');

const FTS_STOP_WORDS = new Set([
  'dan', 'atau', 'yang', 'di', 'ke', 'dari', 'untuk', 'pada', 'dengan', 'adalah', 'ini', 'itu',
  'the', 'a', 'an', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were'
]);

const FTS_MULTILINGUAL_SYNONYMS = {
  'arsitektur': ['architecture', 'architect', 'kage-skill'],
  'keamanan': ['security', 'audit', 'kage-skill'],
  'keputusan': ['decision', 'kage-skill'],
  'antarmuka': ['frontend', 'ui', 'jonin-skill'],
  'styling': ['styling', 'tailwind', 'jonin-skill'],
  'perbaikan': ['bug', 'fix', 'anbu-skill'],
  'infrastruktur': ['infrastructure', 'anbu-skill'],
  'backend': ['backend', 'anbu-skill'],
  'pemetaan': ['mapping', 'genin-skill'],
  'struktur': ['structure', 'genin-skill'],
  'dependensi': ['dependency', 'dependencies', 'genin-skill'],
  'berkas': ['file'],
  'dokumentasi': ['documentation', 'tokubetsu-jonin-skill'],
  'panduan': ['guide', 'tokubetsu-jonin-skill']
};

function scanQuantizedChunks(conn, queryVec, candidateK) {
  try {
    conn.prepare("SELECT vector_quantize('skill_chunks', 'embedding');").get();
    const qBlob = Buffer.from(queryVec.buffer, queryVec.byteOffset, queryVec.byteLength);
    const sql = `
      SELECT c.skill_name, c.chunk_index, c.chunk_text, v.distance
      FROM vector_quantize_scan('skill_chunks', 'embedding', ?, ?) AS v
      JOIN skill_chunks AS c ON c.rowid = v.rowid
      ORDER BY v.distance ASC
    `;
    const rows = conn.prepare(sql).all(qBlob, candidateK);
    return rows.map(r => [r.skill_name, r.chunk_index, r.chunk_text, 1.0 - r.distance]);
  } catch (_) {
    return null;
  }
}

function scanInMemoryChunks(conn, queryVec, candidateK) {
  const rows = conn.prepare("SELECT skill_name, chunk_index, chunk_text, embedding FROM skill_chunks WHERE embedding IS NOT NULL").all();
  if (!rows || !rows.length) return [];
  const scored = [];
  for (const r of rows) {
    const buf = r.embedding;
    if (!buf || buf.length !== VECTOR_DIMENSION * 4) continue;
    const vec = new Float32Array(buf.buffer, buf.byteOffset, VECTOR_DIMENSION);
    const sim = cosineSimilarity(queryVec, vec);
    scored.push([r.skill_name, r.chunk_index, r.chunk_text, sim]);
  }
  scored.sort((a, b) => b[3] - a[3]);
  return scored.slice(0, candidateK);
}

function scanNearestChunks(conn, queryVec, candidateK = 25) {
  if (initVectorTableIfSupported(conn)) {
    const quantized = scanQuantizedChunks(conn, queryVec, candidateK);
    if (quantized) return quantized;
  }
  return scanInMemoryChunks(conn, queryVec, candidateK);
}

async function getVectorCandidates(conn, query, candidateK) {
  try {
    const queryVec = await embedText(query);
    if (!queryVec) return [];
    const nearest = scanNearestChunks(conn, queryVec, candidateK);
    return nearest.map(([skill_name, chunk_index, chunk_text, sim]) => ({
      skill_name, chunk_index, chunk_text, similarity: sim
    }));
  } catch (_) {
    return [];
  }
}

function getFtsChunkCandidates(conn, query, candidateK) {
  const cleanQ = query.replace(/[^a-zA-Z0-9_\-\s]/g, ' ').trim();
  if (!cleanQ) return [];
  try {
    return conn.prepare(`
      SELECT skill_name, chunk_index, chunk_text
      FROM skill_chunks
      WHERE chunk_text LIKE ?
      LIMIT ?
    `).all(`%${cleanQ.slice(0, 30)}%`, candidateK);
  } catch (_) {
    return [];
  }
}

async function searchChunksRAG(conn, query, options = {}) {
  const topK = options.topK || 5;
  const candidateK = options.candidateK || 25;
  const useRerank = options.rerank !== false;
  if (!query || !query.trim()) return [];

  const vecCandidates = await getVectorCandidates(conn, query, candidateK);
  const ftsCandidates = getFtsChunkCandidates(conn, query, candidateK);

  const candidateMap = new Map();
  for (const c of [...vecCandidates, ...ftsCandidates]) {
    const key = `${c.skill_name}:${c.chunk_index}`;
    if (!candidateMap.has(key)) candidateMap.set(key, c);
  }

  const allCandidates = Array.from(candidateMap.values());
  if (!allCandidates.length) return [];
  if (useRerank) return await rerank(query, allCandidates, { topK });
  return allCandidates.slice(0, topK);
}

function extractTokenSet(cleanQ) {
  const rawTokens = cleanQ.split(/\s+/).filter(Boolean).map(t => t.toLowerCase());
  const tokenSet = new Set();
  for (const t of rawTokens) {
    if (FTS_STOP_WORDS.has(t) || t.length <= 1) continue;
    tokenSet.add(t);
    const synonyms = FTS_MULTILINGUAL_SYNONYMS[t];
    if (synonyms) {
      for (const syn of synonyms) tokenSet.add(syn);
    }
  }
  return tokenSet;
}

function searchFtsSkills(conn, query, candidateK) {
  const cleanQ = query.replace(/[^a-zA-Z0-9_\-\s]/g, ' ').trim();
  if (!cleanQ) return [];
  const tokenSet = extractTokenSet(cleanQ);
  if (tokenSet.size === 0) return [];

  try {
    const dbMod = require('./db');
    if (dbMod.hasFts5Support && !dbMod.hasFts5Support(conn)) return [];
    const ftsQuery = Array.from(tokenSet).map(t => `"${t}"*`).join(' OR ');
    const ftsSql = `
      SELECT name, bm25(skills_fts, 10.0, 5.0, 8.0, 1.0) as rank
      FROM skills_fts
      WHERE skills_fts MATCH ?
      ORDER BY rank ASC
      LIMIT ?
    `;
    return conn.prepare(ftsSql).all(ftsQuery, candidateK).map(r => r.name);
  } catch (_) {
    return [];
  }
}

function scanCachedVectorSkills(conn, query, candidateK) {
  const chunkCountRow = conn.prepare("SELECT COUNT(*) as cnt FROM skill_chunks").get();
  if (!chunkCountRow || chunkCountRow.cnt <= 0) return [];

  const norm = query.trim().split(/\s+/).join(' ');
  const textHash = crypto.createHash('sha256').update(norm, 'utf8').digest('hex');
  if (!_EMBED_CACHE.has(textHash)) return [];

  const queryVec = _EMBED_CACHE.get(textHash);
  const vecChunks = scanNearestChunks(conn, queryVec, candidateK);
  const seen = new Set();
  const vecSkillNames = [];
  for (const [sName] of vecChunks) {
    if (!seen.has(sName)) {
      seen.add(sName);
      vecSkillNames.push(sName);
    }
  }
  return vecSkillNames;
}

function promoteExactSkillMatches(conn, candidateSkills, cleanQ) {
  let list = candidateSkills;
  try {
    const exactRow = conn.prepare(
      "SELECT name FROM skills WHERE LOWER(name) = ? OR LOWER(skill_name) = ? ORDER BY CASE WHEN type = 'skill' THEN 0 ELSE 1 END LIMIT 1"
    ).get(cleanQ, cleanQ);
    if (exactRow && exactRow.name) {
      list = [exactRow.name, ...list.filter(s => s !== exactRow.name)];
    }
  } catch (_) { /* intentional fallback */ }

  const exactIdx = list.findIndex(s => s.toLowerCase() === cleanQ);
  if (exactIdx > 0) {
    const exactName = list[exactIdx];
    list.splice(exactIdx, 1);
    list.unshift(exactName);
  }
  return list;
}

function sortSkillSearchResults(results, cleanQ) {
  results.sort((a, b) => {
    const aExact = a.name.toLowerCase() === cleanQ || (a.skill_name && a.skill_name.toLowerCase() === cleanQ);
    const bExact = b.name.toLowerCase() === cleanQ || (b.skill_name && b.skill_name.toLowerCase() === cleanQ);
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;
    if (a.type === 'skill' && b.type === 'reference') return -1;
    if (a.type === 'reference' && b.type === 'skill') return 1;
    return (b.score || 0) - (a.score || 0);
  });
}

function findSkillSemantic(conn, query, topK = 5, candidateK = 25) {
  if (!query || !query.trim()) return [];

  const ftsSkillNames = searchFtsSkills(conn, query, candidateK);
  const vecSkillNames = scanCachedVectorSkills(conn, query, candidateK);
  const fused = reciprocalRankFusion([vecSkillNames, ftsSkillNames], 60);

  const cleanQ = query.trim().toLowerCase();
  const candidateSkills = promoteExactSkillMatches(conn, fused.slice(0, candidateK).map(x => x[0]), cleanQ);
  if (!candidateSkills.length) return [];

  const placeholders = candidateSkills.map(() => '?').join(',');
  const skillRows = conn.prepare(`
    SELECT name, skill_name, type, tags, content, file_path, byte_size, line_count
    FROM skills
    WHERE name IN (${placeholders})
  `).all(...candidateSkills);

  const rowMap = new Map();
  for (const r of skillRows) rowMap.set(r.name, r);

  const results = [];
  for (let i = 0; i < candidateSkills.length && results.length < topK; i++) {
    const r = rowMap.get(candidateSkills[i]);
    if (r) results.push(Object.assign({}, r, { score: 1.0 - (i * 0.05) }));
  }

  sortSkillSearchResults(results, cleanQ);
  return results;
}

function recordVectorChunkHit(hit, vecSkillMap, vecSkillNames) {
  const [sName, _cIndex, cText, sim] = hit;
  if (vecSkillMap.has(sName)) return;
  vecSkillMap.set(sName, {
    similarity: Number(sim.toFixed(4)),
    rank: vecSkillNames.length + 1,
    chunkText: (cText || '').slice(0, 200)
  });
  vecSkillNames.push(sName);
}

function processNearestVectorChunks(nearestChunks, vecSkillMap, vecSkillNames) {
  for (const hit of nearestChunks) {
    recordVectorChunkHit(hit, vecSkillMap, vecSkillNames);
  }
}

async function collectHybridVectorMap(conn, cleanQuery, candidateK) {
  const vecSkillMap = new Map();
  const vecSkillNames = [];
  try {
    const chunkCountRow = conn.prepare("SELECT COUNT(*) as cnt FROM skill_chunks WHERE embedding IS NOT NULL").get();
    if (!chunkCountRow || chunkCountRow.cnt <= 0 || !isSemanticSearchEnabled()) {
      return { vecSkillMap, vecSkillNames };
    }
    const queryVec = await embedText(cleanQuery);
    if (!queryVec) return { vecSkillMap, vecSkillNames };
    const nearestChunks = scanNearestChunks(conn, queryVec, candidateK);
    processNearestVectorChunks(nearestChunks, vecSkillMap, vecSkillNames);
  } catch (_) { /* intentional fallback */ }
  return { vecSkillMap, vecSkillNames };
}

function collectLikeFallbackRows(conn, cleanQuery, candidateK) {
  try {
    return conn.prepare(`
      SELECT name FROM skills
      WHERE name LIKE ? OR skill_name LIKE ? OR tags LIKE ?
      ORDER BY byte_size ASC
      LIMIT ?
    `).all(`%${cleanQuery}%`, `%${cleanQuery}%`, `%${cleanQuery}%`, candidateK);
  } catch (_) {
    return [];
  }
}

function recordLikeFallbackHit(r, idx, ftsSkillMap, ftsSkillNames) {
  if (ftsSkillMap.has(r.name)) return;
  ftsSkillMap.set(r.name, { rank: idx + 1, bm25: 0 });
  ftsSkillNames.push(r.name);
}

function collectHybridFtsMap(conn, cleanQuery, candidateK) {
  const ftsSkillMap = new Map();
  const ftsSkillNames = [];
  const ftsNames = searchFtsSkills(conn, cleanQuery, candidateK);
  for (let i = 0; i < ftsNames.length; i++) {
    ftsSkillMap.set(ftsNames[i], { rank: i + 1, bm25: 0 });
    ftsSkillNames.push(ftsNames[i]);
  }
  if (ftsSkillNames.length === 0) {
    const likeRows = collectLikeFallbackRows(conn, cleanQuery, candidateK);
    for (let i = 0; i < likeRows.length; i++) {
      recordLikeFallbackHit(likeRows[i], i, ftsSkillMap, ftsSkillNames);
    }
  }
  return { ftsSkillMap, ftsSkillNames };
}

function scoreHybridCandidate(sName, cleanQuery, vecSkillMap, ftsSkillMap) {
  const inVec = vecSkillMap.has(sName);
  const inFts = ftsSkillMap.has(sName);
  const vecInfo = vecSkillMap.get(sName);
  const ftsInfo = ftsSkillMap.get(sName);

  if (inVec && !inFts && (vecInfo.similarity || 0) < 0.40) return null;

  const rrfVec = inVec ? (1.0 / (60 + vecInfo.rank)) : 0;
  const rrfFts = inFts ? (1.0 / (60 + ftsInfo.rank)) : 0;
  let combinedScore = rrfVec + rrfFts;

  const lowerSName = sName.toLowerCase();
  const cleanLower = cleanQuery.toLowerCase();
  if (lowerSName === cleanLower) combinedScore += 10.0;
  else if (lowerSName.startsWith(cleanLower + '/') || lowerSName.includes(cleanLower)) combinedScore += 1.0;

  const engine = (inVec && inFts) ? 'both' : (inVec ? 'vector' : 'fts5');
  return {
    name: sName,
    engine,
    score: combinedScore,
    similarity: inVec ? vecInfo.similarity : null,
    matched_chunk: inVec ? vecInfo.chunkText : null
  };
}

function loadAllSkillsBrief(conn, topK) {
  const allRows = conn.prepare(`
    SELECT name, skill_name, type, tags, byte_size, line_count, file_path
    FROM skills
    ORDER BY name ASC
    LIMIT ?
  `).all(topK);
  return allRows.map(r => ({ ...r, engine: 'all', score: 1.0, similarity: null }));
}

function populateHybridSkillResults(conn, topCandidates) {
  const placeholders = topCandidates.map(() => '?').join(',');
  const names = topCandidates.map(t => t.name);
  const skillDetails = conn.prepare(`
    SELECT name, skill_name, type, tags, byte_size, line_count, file_path
    FROM skills
    WHERE name IN (${placeholders})
  `).all(...names);

  const detailsMap = new Map();
  for (const sd of skillDetails) detailsMap.set(sd.name, sd);

  const results = [];
  for (const item of topCandidates) {
    const details = detailsMap.get(item.name);
    if (!details) continue;
    results.push({
      ...details,
      engine: item.engine,
      score: item.normalized_score,
      similarity: item.similarity,
      matched_chunk: item.matched_chunk
    });
  }
  return results;
}

async function findSkillHybrid(conn, query, options = {}) {
  const topK = options.topK || options.limit || 10;
  const candidateK = options.candidateK || 30;
  if (!query || !query.trim()) return loadAllSkillsBrief(conn, topK);

  const cleanQuery = query.trim();
  const { vecSkillMap, vecSkillNames } = await collectHybridVectorMap(conn, cleanQuery, candidateK);
  const { ftsSkillMap, ftsSkillNames } = collectHybridFtsMap(conn, cleanQuery, candidateK);

  const allCandidateNames = new Set([...vecSkillNames, ...ftsSkillNames]);
  if (allCandidateNames.size === 0) return [];

  const scoredItems = [];
  for (const sName of allCandidateNames) {
    const scored = scoreHybridCandidate(sName, cleanQuery, vecSkillMap, ftsSkillMap);
    if (scored) scoredItems.push(scored);
  }

  scoredItems.sort((a, b) => b.score - a.score);
  const topCandidates = scoredItems.slice(0, topK);
  const maxScore = topCandidates[0]?.score || 1;
  for (const item of topCandidates) {
    item.normalized_score = Number((item.score / maxScore).toFixed(3));
  }

  const results = populateHybridSkillResults(conn, topCandidates);
  sortSkillSearchResults(results, cleanQuery.toLowerCase());
  return results;
}

function recordCachedChunkRow(r, localCache) {
  if (r.chunk_text && r.embedding && r.embedding.length === VECTOR_DIMENSION * 4) {
    localCache.set(r.chunk_text, r.embedding);
  }
}

function loadSkillChunkEmbedCache(conn, skillName) {
  const localCache = new Map();
  try {
    const existing = conn.prepare(
      "SELECT chunk_text, embedding FROM skill_chunks WHERE skill_name = ? AND embedding IS NOT NULL"
    ).all(skillName);
    for (const r of existing) recordCachedChunkRow(r, localCache);
  } catch (_) { /* intentional fallback */ }
  return localCache;
}

async function resolveChunkEmbedding(conn, chunkText, localCache) {
  let blob = localCache.get(chunkText);
  if (blob && blob.length === VECTOR_DIMENSION * 4) return blob;

  const existingRow = conn.prepare(
    "SELECT embedding FROM skill_chunks WHERE chunk_text = ? AND embedding IS NOT NULL LIMIT 1"
  ).get(chunkText);
  if (existingRow && existingRow.embedding && existingRow.embedding.length === VECTOR_DIMENSION * 4) {
    return existingRow.embedding;
  }

  const tInferStart = Date.now();
  const vec = await embedText(chunkText);
  if (!vec || vec.length !== VECTOR_DIMENSION) {
    throw new Error(`Embedding dimension mismatch: expected ${VECTOR_DIMENSION}, got ${vec ? vec.length : 0}`);
  }
  blob = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
  const inferMs = Date.now() - tInferStart;

  const envPace = parseInt(process.env.KONOHA_EMBED_PACE_MS || '0', 10);
  const sleepMs = envPace > 0 ? envPace : Math.max(Math.round(inferMs * 1.25) + 15, 35);
  await new Promise(resolve => setTimeout(resolve, sleepMs));
  return blob;
}

async function indexSingleSkillChunks(conn, skillName, content) {
  const chunks = chunkDocument(content);
  if (!chunks.length) {
    conn.prepare("DELETE FROM skill_chunks WHERE skill_name = ?").run(skillName);
    return 0;
  }

  const localCache = loadSkillChunkEmbedCache(conn, skillName);
  const resolved = [];
  for (const [idx, chunkText] of chunks) {
    try {
      const blob = await resolveChunkEmbedding(conn, chunkText, localCache);
      resolved.push([idx, chunkText, blob]);
    } catch (_) {
      resolved.push([idx, chunkText, null]);
    }
  }

  conn.transaction(() => {
    conn.prepare("DELETE FROM skill_chunks WHERE skill_name = ?").run(skillName);
    const stmt = conn.prepare("INSERT INTO skill_chunks (skill_name, chunk_index, chunk_text, embedding) VALUES (?, ?, ?, ?)");
    for (const [idx, chunkText, blob] of resolved) {
      stmt.run(skillName, idx, chunkText, blob);
    }
  })();

  return chunks.length;
}

async function backfillAllEmbeddings(conn, forceRebuild = false, maxTimeSeconds = 180.0) {
  const startTime = Date.now();
  initVectorTableIfSupported(conn);
  if (forceRebuild) {
    conn.prepare("DELETE FROM skill_chunks").run();
    _EMBED_CACHE.clear();
  }

  const existingIndexed = new Set(
    conn.prepare("SELECT DISTINCT skill_name FROM skill_chunks").all().map(r => r.skill_name)
  );

  const skillHeaders = conn.prepare(
    "SELECT name, type FROM skills ORDER BY CASE WHEN type = 'skill' THEN 0 ELSE 1 END, name ASC"
  ).all();
  const getContentStmt = conn.prepare("SELECT content FROM skills WHERE name = ?");

  let totalChunks = 0;
  for (const h of skillHeaders) {
    const sName = h.name;
    if (!forceRebuild && existingIndexed.has(sName)) continue;
    if (h.type !== 'skill' && maxTimeSeconds > 0 && ((Date.now() - startTime) / 1000) > maxTimeSeconds) break;

    const row = getContentStmt.get(sName);
    if (row && row.content) {
      totalChunks += await indexSingleSkillChunks(conn, sName, row.content);
    }
    if (_EMBED_CACHE.size > 256) _EMBED_CACHE.clear();
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  if (totalChunks > 0) initVectorTableIfSupported(conn);
  return totalChunks;
}

module.exports = {
  isSemanticSearchEnabled,
  getPlatformTag,
  getPlatformAssetInfo,
  getVendorDir,
  ensureVectorExtension,
  loadVectorExtension,
  initVectorTableIfSupported,
  chunkDocument,
  embedText,
  cosineSimilarity,
  reciprocalRankFusion,
  scanNearestChunks,
  findSkillSemantic,
  findSkillHybrid,
  indexSingleSkillChunks,
  backfillAllEmbeddings,
  enableLoadExtensionSafe,
  enable_load_extension_safe: enableLoadExtensionSafe,
  getRerankPipeline,
  rerank,
  searchChunksRAG,
  predownloadAllModels,
  getBundledModelsDir,
  RERANK_MODEL_REPO,
  EMBED_MODEL_REPO,
  _EMBED_CACHE
};
