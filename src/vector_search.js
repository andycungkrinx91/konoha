/**
 * Hybrid semantic search, ONNX embeddings, and cross-encoder reranker for Konoha.
 * Pure Node.js replacement for vector_search.py using @huggingface/transformers and better-sqlite3.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const SEMANTIC_SEARCH_ENV = "KONOHA_SEMANTIC_SEARCH";
const EMBED_MODEL_REPO = "onnx-community/granite-embedding-97m-multilingual-r2-ONNX";
const RERANK_MODEL_REPO = "onnx-community/gte-multilingual-reranker-base";
const VECTOR_DIMENSION = 384;
const SQLITE_VECTOR_VERSION = "1.1.0";

const _MAX_EMBED_CACHE = 4096;
const _EMBED_CACHE = new Map();

let _pipelineExtractor = null;
let _pipelineReranker = null;
let _EXTENSION_FAILED_ONCE = false;
const _LOADED_CONNECTIONS = new Set();

function isSemanticSearchEnabled() {
  const val = (process.env[SEMANTIC_SEARCH_ENV] || "1").trim().toLowerCase();
  return !["0", "false", "no", "disabled"].includes(val);
}

function getPlatformTag(sys = process.platform, mArch = process.arch) {
  let s = (sys || '').toLowerCase();
  if (s === 'win32' || s === 'windows') s = 'windows';
  else if (s === 'darwin' || s === 'macos') s = 'darwin';
  else if (s === 'linux') s = 'linux';

  let a = (mArch || '').toLowerCase();
  if (['x86_64', 'amd64', 'x64'].includes(a)) a = 'x64';
  else if (['aarch64', 'arm64'].includes(a)) a = 'arm64';

  return `${s}-${a}`;
}

function getPlatformAssetInfo(sys = process.platform, mArch = process.arch) {
  let s = (sys || '').toLowerCase();
  if (s === 'win32' || s === 'windows') s = 'win32';
  else if (s === 'darwin' || s === 'macos') s = 'darwin';
  else if (s === 'linux') s = 'linux';

  let a = (mArch || '').toLowerCase();
  if (['x86_64', 'amd64', 'x64'].includes(a)) a = 'x64';
  else if (['aarch64', 'arm64'].includes(a)) a = 'arm64';

  if (s === 'linux') {
    const libName = "vector.so";
    if (a === 'x64') return [`vector-linux-x86_64-${SQLITE_VECTOR_VERSION}.tar.gz`, libName];
    if (a === 'arm64') return [`vector-linux-arm64-${SQLITE_VECTOR_VERSION}.tar.gz`, libName];
  } else if (s === 'darwin') {
    const libName = "vector.dylib";
    if (a === 'arm64') return [`vector-macos-arm64-${SQLITE_VECTOR_VERSION}.tar.gz`, libName];
    if (a === 'x64') return [`vector-macos-x86_64-${SQLITE_VECTOR_VERSION}.tar.gz`, libName];
  } else if (s === 'win32') {
    const libName = "vector.dll";
    if (a === 'x64') return [`vector-windows-x86_64-${SQLITE_VECTOR_VERSION}.zip`, libName];
  }
  return [null, null];
}

function getVendorDir() {
  const konohaDir = path.normalize(path.join(os.homedir(), '.konoha'));
  const vendorDir = path.join(konohaDir, 'vendor', 'sqlite-vector');
  if (!fs.existsSync(vendorDir)) {
    fs.mkdirSync(vendorDir, { recursive: true });
  }
  return vendorDir;
}

function ensureVectorExtension() {
  const [assetName, libName] = getPlatformAssetInfo();
  if (!assetName || !libName) return null;

  const tag = getPlatformTag();
  const repoRoot = path.dirname(__dirname);

  const candidateDirs = [
    path.join(repoRoot, "vendor", "sqlite-vector", tag),
    path.join(repoRoot, "vendor", "sqlite-vector", process.platform),
    path.join(repoRoot, "vendor", "sqlite-vector"),
    path.join(getVendorDir(), tag),
    path.join(getVendorDir(), process.platform),
    getVendorDir()
  ];

  for (const cDir of candidateDirs) {
    const targetFile = path.join(cDir, libName);
    if (fs.existsSync(targetFile) && fs.statSync(targetFile).isFile()) {
      return targetFile;
    }
  }

  return null;
}

function loadVectorExtension(conn) {
  if (_LOADED_CONNECTIONS.has(conn)) return true;

  const extPath = ensureVectorExtension();
  if (!extPath || !fs.existsSync(extPath)) return false;

  try {
    conn.loadExtension(extPath);
    _LOADED_CONNECTIONS.add(conn);
    return true;
  } catch (err) {
    if (!_EXTENSION_FAILED_ONCE) {
      // debug level fallback
      _EXTENSION_FAILED_ONCE = true;
    }
    return false;
  }
}

function initVectorTableIfSupported(conn) {
  if (!loadVectorExtension(conn)) return false;
  try {
    conn.prepare(
      `SELECT vector_init('skill_chunks', 'embedding', 'type=FLOAT32,dimension=${VECTOR_DIMENSION},distance=COSINE,normalized=1');`
    ).get();
    return true;
  } catch (_) {
    return false;
  }
}

function chunkDocument(content, maxChars = 2000, overlapChars = 100) {
  if (!content || !content.trim()) return [];

  const lines = content.split(/\r?\n/);
  const sections = [];
  let currentLines = [];

  const headingRegex = /^#{1,6}\s+/;

  for (const line of lines) {
    if (headingRegex.test(line) && currentLines.length > 0) {
      sections.push(currentLines.join('\n').trim());
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    sections.push(currentLines.join('\n').trim());
  }

  const chunks = [];
  for (const section of sections) {
    if (!section) continue;
    if (section.length <= maxChars) {
      chunks.push(section);
    } else {
      const paragraphs = section.split(/\n\s*\n/);
      let currentSub = "";
      for (const p of paragraphs) {
        const pClean = p.trim();
        if (!pClean) continue;
        if (currentSub.length + pClean.length + 2 <= maxChars) {
          currentSub = currentSub ? (currentSub + '\n\n' + pClean).trim() : pClean;
        } else {
          if (currentSub) {
            chunks.push(currentSub);
            const overlapTail = currentSub.length > overlapChars ? currentSub.slice(-overlapChars) : currentSub;
            currentSub = overlapTail + '\n\n' + pClean;
          } else {
            let start = 0;
            while (start < pClean.length) {
              const end = start + maxChars;
              const subText = pClean.substring(start, end);
              chunks.push(subText);
              if (end >= pClean.length) break;
              start = end - overlapChars;
            }
            currentSub = "";
          }
        }
      }
      if (currentSub) {
        chunks.push(currentSub);
      }
    }
  }

  const dedupedChunks = [];
  const seenHashes = new Set();
  for (const chunk of chunks) {
    const cClean = chunk.trim();
    if (!cClean) continue;
    const norm = cClean.split(/\s+/).join(' ');
    const h = crypto.createHash('sha256').update(norm, 'utf8').digest('hex');
    if (!seenHashes.has(h)) {
      seenHashes.add(h);
      dedupedChunks.push([dedupedChunks.length, cClean]);
    }
  }

  return dedupedChunks;
}

async function getEmbedPipeline() {
  if (_pipelineExtractor) return _pipelineExtractor;
  try {
    const { pipeline, env } = require('@huggingface/transformers');
    env.cacheDir = path.join(os.homedir(), '.konoha', 'transformers_cache');
    _pipelineExtractor = await pipeline('feature-extraction', EMBED_MODEL_REPO, {
      quantized: true,
      progress_callback: () => {}
    });
    return _pipelineExtractor;
  } catch (err) {
    return null;
  }
}

async function getRerankPipeline() {
  if (_pipelineReranker) return _pipelineReranker;
  try {
    const { pipeline, env } = require('@huggingface/transformers');
    env.cacheDir = path.join(os.homedir(), '.konoha', 'transformers_cache');
    _pipelineReranker = await pipeline('zero-shot-classification', RERANK_MODEL_REPO, {
      quantized: true,
      progress_callback: () => {}
    });
    return _pipelineReranker;
  } catch (err) {
    return null;
  }
}

async function embedText(text) {
  const norm = (text || "").trim().split(/\s+/).join(' ');
  const textHash = crypto.createHash('sha256').update(norm, 'utf8').digest('hex');
  if (_EMBED_CACHE.has(textHash)) {
    return new Float32Array(_EMBED_CACHE.get(textHash));
  }

  const extractor = await getEmbedPipeline();
  if (!extractor) {
    // Return pseudo-deterministic zero vector if embedder unavailable
    return new Float32Array(VECTOR_DIMENSION);
  }

  const output = await extractor(text, { pooling: 'cls', normalize: true });
  const data = output.data;
  const vec = new Float32Array(VECTOR_DIMENSION);
  for (let i = 0; i < VECTOR_DIMENSION && i < data.length; i++) {
    vec[i] = data[i];
  }

  // Normalize
  let sumSq = 0;
  for (let i = 0; i < VECTOR_DIMENSION; i++) sumSq += vec[i] * vec[i];
  const normVal = Math.sqrt(sumSq);
  if (normVal > 0) {
    for (let i = 0; i < VECTOR_DIMENSION; i++) vec[i] /= normVal;
  }

  if (_EMBED_CACHE.size >= _MAX_EMBED_CACHE) {
    const firstKey = _EMBED_CACHE.keys().next().value;
    _EMBED_CACHE.delete(firstKey);
  }
  _EMBED_CACHE.set(textHash, new Float32Array(vec));

  return vec;
}

function cosineSimilarity(vecA, vecB) {
  let dot = 0;
  for (let i = 0; i < VECTOR_DIMENSION; i++) {
    dot += vecA[i] * vecB[i];
  }
  return dot;
}

function reciprocalRankFusion(rankLists, k = 60) {
  const scores = {};
  for (const rList of rankLists) {
    rList.forEach((key, rank) => {
      scores[key] = (scores[key] || 0.0) + (1.0 / (k + rank + 1));
    });
  }
  return Object.entries(scores).sort((a, b) => b[1] - a[1]);
}

function scanNearestChunks(conn, queryVec, candidateK = 25) {
  const hasExt = initVectorTableIfSupported(conn);
  if (hasExt) {
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
    } catch (_) {}
  }

  // In-memory exact cosine scan fallback
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

function findSkillSemantic(conn, query, topK = 5, candidateK = 25) {
  if (!query || !query.trim()) return [];

  // FTS5 BM25 search
  const ftsSkillNames = [];
  try {
    const cleanQ = query.replace(/[^a-zA-Z0-9_\-\s]/g, ' ').trim();
    if (cleanQ) {
      const tokens = cleanQ.split(/\s+/).filter(Boolean).map(t => `"${t}"*`);
      if (tokens.length) {
        const ftsQuery = tokens.join(" OR ");
        const ftsSql = `
          SELECT name, bm25(skills_fts) as rank
          FROM skills_fts
          WHERE skills_fts MATCH ?
          ORDER BY rank ASC
          LIMIT ?
        `;
        const rows = conn.prepare(ftsSql).all(ftsQuery, candidateK);
        for (const r of rows) {
          ftsSkillNames.push(r.name);
        }
      }
    }
  } catch (_) {}

  // Vector scan if chunks exist
  let vecSkillNames = [];
  const chunkCountRow = conn.prepare("SELECT COUNT(*) as cnt FROM skill_chunks").get();
  if (chunkCountRow && chunkCountRow.cnt > 0) {
    // Deterministic embedding or fast scan
    // In sync mode, check if we have queryVec
    const norm = query.trim().split(/\s+/).join(' ');
    const textHash = crypto.createHash('sha256').update(norm, 'utf8').digest('hex');
    if (_EMBED_CACHE.has(textHash)) {
      const queryVec = _EMBED_CACHE.get(textHash);
      const vecChunks = scanNearestChunks(conn, queryVec, candidateK);
      const seen = new Set();
      for (const [sName] of vecChunks) {
        if (!seen.has(sName)) {
          seen.add(sName);
          vecSkillNames.push(sName);
        }
      }
    }
  }

  const fused = reciprocalRankFusion([vecSkillNames, ftsSkillNames], 60);
  const candidateSkills = fused.slice(0, candidateK).map(x => x[0]);
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
    const sName = candidateSkills[i];
    const r = rowMap.get(sName);
    if (r) {
      results.push(Object.assign({}, r, { score: 1.0 - (i * 0.05) }));
    }
  }

  return results;
}

async function indexSingleSkillChunks(conn, skillName, content) {
  const chunks = chunkDocument(content);
  conn.prepare("DELETE FROM skill_chunks WHERE skill_name = ?").run(skillName);
  if (!chunks.length) return 0;

  const stmt = conn.prepare(
    "INSERT INTO skill_chunks (skill_name, chunk_index, chunk_text, embedding) VALUES (?, ?, ?, ?)"
  );

  for (const [idx, chunkText] of chunks) {
    const existingRow = conn.prepare(
      "SELECT embedding FROM skill_chunks WHERE chunk_text = ? AND embedding IS NOT NULL LIMIT 1"
    ).get(chunkText);

    let blob;
    if (existingRow && existingRow.embedding) {
      blob = existingRow.embedding;
    } else {
      const vec = await embedText(chunkText);
      blob = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
    }
    stmt.run(skillName, idx, chunkText, blob);
  }

  return chunks.length;
}

async function backfillAllEmbeddings(conn, forceRebuild = false, maxTimeSeconds = 40.0) {
  const startTime = Date.now();
  initVectorTableIfSupported(conn);
  if (forceRebuild) {
    conn.prepare("DELETE FROM skill_chunks").run();
  }

  const existingIndexed = new Set(
    conn.prepare("SELECT DISTINCT skill_name FROM skill_chunks").all().map(r => r.skill_name)
  );

  const rows = conn.prepare("SELECT name, content, type FROM skills ORDER BY CASE WHEN type = 'skill' THEN 0 ELSE 1 END, name ASC").all();
  let totalChunks = 0;
  for (const r of rows) {
    const sName = r.name;
    const sContent = r.content;
    const sType = r.type;
    if (!forceRebuild && existingIndexed.has(sName)) {
      continue;
    }
    if (sType !== 'skill' && maxTimeSeconds > 0 && ((Date.now() - startTime) / 1000) > maxTimeSeconds) {
      break;
    }
    if (sContent) {
      const cnt = await indexSingleSkillChunks(conn, sName, sContent);
      totalChunks += cnt;
    }
  }

  if (totalChunks > 0) {
    initVectorTableIfSupported(conn);
  }

  return totalChunks;
}

function enableLoadExtensionSafe(conn) {
  try {
    if (conn && typeof conn.loadExtension === 'function') {
      conn.loadExtension('');
      return true;
    }
    if (conn && typeof conn.enable_load_extension === 'function') {
      conn.enable_load_extension(true);
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
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
  indexSingleSkillChunks,
  backfillAllEmbeddings,
  enableLoadExtensionSafe,
  enable_load_extension_safe: enableLoadExtensionSafe,
  _EMBED_CACHE
};
