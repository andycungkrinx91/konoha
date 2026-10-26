/**
 * Hybrid semantic search, ONNX embeddings, and cross-encoder reranker for Konoha.
 * Pure Node.js replacement for vector_search.py using @huggingface/transformers and the node:sqlite driver.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const SEMANTIC_SEARCH_ENV = "KONOHA_SEMANTIC_SEARCH";
const EMBED_MODEL_REPO = "onnx-community/granite-embedding-97m-multilingual-r2-ONNX";
const RERANK_MODEL_REPO = "Xenova/ms-marco-MiniLM-L-6-v2";
const VECTOR_DIMENSION = 384;
const SQLITE_VECTOR_VERSION = "1.1.0";

const _MAX_EMBED_CACHE = 512;
const _EMBED_CACHE = new Map();

function noopProgress() {
  return null;
}
let _pipelineExtractor = null;
let _pipelineReranker = null;
let _EXTENSION_FAILED_ONCE = false;
// WeakSet so closed/dropped connections can be garbage-collected instead of
// being pinned forever by this registry (memory leak in long-running processes)
const _LOADED_CONNECTIONS = new WeakSet();

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
  const custom = process.env.KONOHA_SQLITE_VEC_DIR;
  if (custom && fs.existsSync(custom)) {
    return path.resolve(custom);
  }
  const home = os.homedir();
  return path.join(home, ".konoha", "vendor");
}

function ensureVectorExtension() {
  if (_EXTENSION_FAILED_ONCE) return null;
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
  } catch (_) {
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

  function splitLongBlock(block, maxLen, overlap) {
    const pieces = [];
    let start = 0;
    while (start < block.length) {
      const end = start + maxLen;
      pieces.push(block.substring(start, end));
      if (end >= block.length) break;
      start = end - overlap;
    }
    return pieces;
  }

  const rawChunks = [];
  for (const section of sections) {
    if (!section) continue;
    if (section.length <= maxChars) {
      rawChunks.push(section);
    } else {
      const paragraphs = section.split(/\n\s*\n/);
      let currentSub = "";
      for (const p of paragraphs) {
        const pClean = p.trim();
        if (!pClean) continue;
        if (pClean.length > maxChars) {
          if (currentSub) {
            rawChunks.push(currentSub);
            currentSub = "";
          }
          rawChunks.push(...splitLongBlock(pClean, maxChars, overlapChars));
        } else if (currentSub.length + pClean.length + 2 <= maxChars) {
          currentSub = currentSub ? (currentSub + '\n\n' + pClean).trim() : pClean;
        } else {
          if (currentSub) {
            rawChunks.push(currentSub);
          }
          currentSub = pClean;
        }
      }
      if (currentSub) {
        rawChunks.push(currentSub);
      }
    }
  }

  const dedupedChunks = [];
  const seenHashes = new Set();
  for (const chunk of rawChunks) {
    const cClean = chunk.trim();
    if (!cClean) continue;
    const finalChunks = cClean.length > maxChars
      ? splitLongBlock(cClean, maxChars, overlapChars)
      : [cClean];

    for (const fc of finalChunks) {
      const norm = fc.split(/\s+/).join(' ');
      const h = crypto.createHash('sha256').update(norm, 'utf8').digest('hex');
      if (!seenHashes.has(h)) {
        seenHashes.add(h);
        dedupedChunks.push([dedupedChunks.length, fc]);
      }
    }
  }

  return dedupedChunks;
}

function getBundledModelsDir() {
  const repoRoot = path.resolve(__dirname, '..');
  const candidateDirs = [
    path.join(repoRoot, 'assets', 'models'),
    path.join(os.homedir(), '.konoha', 'assets', 'models'),
    path.join(os.homedir(), '.konoha', 'models'),
    path.join(os.homedir(), '.konoha', 'transformers_cache')
  ];
  for (const cDir of candidateDirs) {
    const modelSub = path.join(cDir, EMBED_MODEL_REPO);
    const rerankSub = path.join(cDir, RERANK_MODEL_REPO);
    if ((fs.existsSync(modelSub) && fs.statSync(modelSub).isDirectory()) ||
        (fs.existsSync(rerankSub) && fs.statSync(rerankSub).isDirectory())) {
      return cDir;
    }
  }
  return path.join(os.homedir(), '.konoha', 'transformers_cache');
}

async function getEmbedPipeline() {
  if (_pipelineExtractor) return _pipelineExtractor;
  try {
    const tfModule = '@huggingface/transformers';
    const { pipeline, env } = require(tfModule);
    const cacheDir = getBundledModelsDir();
    env.cacheDir = cacheDir;
    env.localModelPath = cacheDir;
    const modelSub = path.join(cacheDir, EMBED_MODEL_REPO);
    const hasLocalModel = fs.existsSync(modelSub);
    const onnxThreads = parseInt(process.env.KONOHA_ONNX_THREADS || '1', 10);
    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.numThreads = onnxThreads;
    }
    const pipelineOptions = {
      quantized: true,
      local_files_only: hasLocalModel,
      session_options: {
        intraOpNumThreads: onnxThreads,
        interOpNumThreads: 1,
        executionMode: 'sequential'
      },
      progress_callback: noopProgress
    };
    try {
      _pipelineExtractor = await pipeline('feature-extraction', EMBED_MODEL_REPO, pipelineOptions);
    } catch (err) {
      if (hasLocalModel) {
        delete pipelineOptions.local_files_only;
        _pipelineExtractor = await pipeline('feature-extraction', EMBED_MODEL_REPO, pipelineOptions);
      } else {
        throw err;
      }
    }
    // Allow initial model graph setup and JIT compiler to settle cleanly
    await new Promise(resolve => setTimeout(resolve, 100));
    return _pipelineExtractor;
  } catch (_) {
    return null;
  }
}

async function getRerankPipeline() {
  if (_pipelineReranker) return _pipelineReranker;
  try {
    const tfModule = '@huggingface/transformers';
    const { AutoTokenizer, AutoModelForSequenceClassification, env } = require(tfModule);
    const cacheDir = getBundledModelsDir();
    env.cacheDir = cacheDir;
    env.localModelPath = cacheDir;
    const modelSub = path.join(cacheDir, RERANK_MODEL_REPO);
    const hasLocalModel = fs.existsSync(modelSub);
    const onnxThreads = parseInt(process.env.KONOHA_ONNX_THREADS || '1', 10);
    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.numThreads = onnxThreads;
    }
    const modelOptions = {
      quantized: true,
      local_files_only: hasLocalModel,
      session_options: {
        intraOpNumThreads: onnxThreads,
        interOpNumThreads: 1,
        executionMode: 'sequential'
      },
      progress_callback: noopProgress
    };

    let tokenizer, model;
    try {
      tokenizer = await AutoTokenizer.from_pretrained(hasLocalModel ? modelSub : RERANK_MODEL_REPO, {
        local_files_only: hasLocalModel
      });
      model = await AutoModelForSequenceClassification.from_pretrained(hasLocalModel ? modelSub : RERANK_MODEL_REPO, modelOptions);
    } catch (err) {
      if (hasLocalModel) {
        delete modelOptions.local_files_only;
        tokenizer = await AutoTokenizer.from_pretrained(RERANK_MODEL_REPO);
        model = await AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL_REPO, modelOptions);
      } else {
        throw err;
      }
    }
    _pipelineReranker = { tokenizer, model };
    return _pipelineReranker;
  } catch (_) {
    return null;
  }
}

async function rerank(query, documents, options = {}) {
  if (!query || !documents || !documents.length) return [];
  const topK = options.topK || documents.length;
  const docItems = documents.map((doc, idx) => {
    if (typeof doc === 'string') {
      return { id: idx, text: doc, original: { text: doc } };
    }
    return {
      id: doc.id !== undefined ? doc.id : idx,
      text: doc.text || doc.chunk_text || doc.content || '',
      original: doc
    };
  });

  const reranker = await getRerankPipeline();
  if (!reranker) {
    return docItems.slice(0, topK).map((item, r) => Object.assign({}, item.original, {
      rerank_score: 1.0 / (60 + r + 1),
      rank: r + 1
    }));
  }

  const { tokenizer, model } = reranker;
  const scored = [];

  for (let i = 0; i < docItems.length; i++) {
    const item = docItems[i];
    try {
      const textPair = (item.text || '').slice(0, 1000);
      const inputs = await tokenizer(query, {
        text_pair: textPair,
        padding: true,
        truncation: true,
        max_length: 512
      });
      const output = await model(inputs);
      const score = output.logits ? output.logits.data[0] : 0.0;
      scored.push(Object.assign({}, item.original, {
        rerank_score: Number(score.toFixed(4)),
        text: item.text
      }));
    } catch (_) {
      scored.push(Object.assign({}, item.original, {
        rerank_score: -999.0,
        text: item.text
      }));
    }
  }

  scored.sort((a, b) => b.rerank_score - a.rerank_score);
  return scored.slice(0, topK).map((item, r) => Object.assign({}, item, {
    rank: r + 1
  }));
}

async function searchChunksRAG(conn, query, options = {}) {
  const topK = options.topK || 5;
  const candidateK = options.candidateK || 25;
  const useRerank = options.rerank !== false;
  if (!query || !query.trim()) return [];

  let vecCandidates = [];
  try {
    const queryVec = await embedText(query);
    if (queryVec) {
      const nearest = scanNearestChunks(conn, queryVec, candidateK);
      vecCandidates = nearest.map(([skill_name, chunk_index, chunk_text, sim]) => ({
        skill_name,
        chunk_index,
        chunk_text,
        similarity: sim
      }));
    }
  } catch (_) { /* intentional best-effort fallback */ }

  const ftsCandidates = [];
  try {
    const cleanQ = query.replace(/[^a-zA-Z0-9_\-\s]/g, ' ').trim();
    if (cleanQ) {
      const rows = conn.prepare(`
        SELECT skill_name, chunk_index, chunk_text
        FROM skill_chunks
        WHERE chunk_text LIKE ?
        LIMIT ?
      `).all(`%${cleanQ.slice(0, 30)}%`, candidateK);
      for (const r of rows) {
        ftsCandidates.push(r);
      }
    }
  } catch (_) { /* intentional best-effort fallback */ }

  const candidateMap = new Map();
  for (const c of [...vecCandidates, ...ftsCandidates]) {
    const key = `${c.skill_name}:${c.chunk_index}`;
    if (!candidateMap.has(key)) {
      candidateMap.set(key, c);
    }
  }

  const allCandidates = Array.from(candidateMap.values());
  if (!allCandidates.length) return [];

  if (useRerank) {
    return await rerank(query, allCandidates, { topK });
  }

  return allCandidates.slice(0, topK);
}

async function predownloadAllModels(verbose = false) {
  try {
    if (verbose) process.stderr.write("⚡ Pre-caching embedding model (IBM Granite)...\n");
    await getEmbedPipeline();
    if (verbose) process.stderr.write("⚡ Pre-caching neural cross-encoder reranker model (MS MARCO)...\n");
    await getRerankPipeline();
    return true;
  } catch (_) {
    return false;
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
    // Return pseudo-deterministic L2-normalized vector if neural embedder unavailable
    const vec = new Float32Array(VECTOR_DIMENSION);
    let sumSq = 0;
    for (let i = 0; i < VECTOR_DIMENSION; i++) {
      const byteVal = parseInt(textHash.slice((i * 2) % 62, ((i * 2) % 62) + 2) || '1', 16);
      vec[i] = (byteVal - 128) / 128.0;
      sumSq += vec[i] * vec[i];
    }
    const normVal = Math.sqrt(sumSq) || 1.0;
    for (let i = 0; i < VECTOR_DIMENSION; i++) vec[i] /= normVal;
    if (_EMBED_CACHE.size >= _MAX_EMBED_CACHE) {
      const firstKey = _EMBED_CACHE.keys().next().value;
      _EMBED_CACHE.delete(firstKey);
    }
    _EMBED_CACHE.set(textHash, new Float32Array(vec));
    return vec;
  }

  let output;
  const vec = new Float32Array(VECTOR_DIMENSION);
  try {
    output = await extractor(text, { pooling: 'cls', normalize: true });
    const data = output.data;
    for (let i = 0; i < VECTOR_DIMENSION && i < data.length; i++) {
      vec[i] = data[i];
    }
  } finally {
    if (output && typeof output.dispose === 'function') {
      try { output.dispose(); } catch (_) { /* ignore */ }
    }
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
// (intentional no-op callback: interface parity with the vector extension API)
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
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
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

function findSkillSemantic(conn, query, topK = 5, candidateK = 25) {
  if (!query || !query.trim()) return [];

  // FTS5 BM25 search
  const ftsSkillNames = [];
  try {
    const cleanQ = query.replace(/[^a-zA-Z0-9_\-\s]/g, ' ').trim();
    if (cleanQ) {
      const rawTokens = cleanQ.split(/\s+/).filter(Boolean).map(t => t.toLowerCase());
      const tokenSet = new Set();
      for (const t of rawTokens) {
        if (FTS_STOP_WORDS.has(t) || t.length <= 1) continue;
        tokenSet.add(t);
        if (FTS_MULTILINGUAL_SYNONYMS[t]) {
          for (const syn of FTS_MULTILINGUAL_SYNONYMS[t]) tokenSet.add(syn);
        }
      }

      if (tokenSet.size > 0) {
        let ftsSupported = true;
        try {
          const dbMod = require('./db');
          if (dbMod.hasFts5Support && !dbMod.hasFts5Support(conn)) {
            ftsSupported = false;
          }
        } catch (_) { /* intentional best-effort fallback */ }

        if (ftsSupported) {
          const ftsQuery = Array.from(tokenSet).map(t => `"${t}"*`).join(" OR ");
          const ftsSql = `
            SELECT name, bm25(skills_fts, 10.0, 5.0, 8.0, 1.0) as rank
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
    }
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

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
  let candidateSkills = fused.slice(0, candidateK).map(x => x[0]);
  const cleanQ = query.trim().toLowerCase();
  try {
    const exactRow = conn.prepare("SELECT name FROM skills WHERE LOWER(name) = ? OR LOWER(skill_name) = ? ORDER BY CASE WHEN type = 'skill' THEN 0 ELSE 1 END LIMIT 1").get(cleanQ, cleanQ);
    if (exactRow && exactRow.name) {
      candidateSkills = [exactRow.name, ...candidateSkills.filter(s => s !== exactRow.name)];
    }
  } catch (_) { /* intentional best-effort fallback */ }
  const exactIdx = candidateSkills.findIndex(s => s.toLowerCase() === cleanQ);
  if (exactIdx > 0) {
    const exactName = candidateSkills[exactIdx];
    candidateSkills.splice(exactIdx, 1);
    candidateSkills.unshift(exactName);
  }
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

  results.sort((a, b) => {
    const aExact = a.name.toLowerCase() === cleanQ || (a.skill_name && a.skill_name.toLowerCase() === cleanQ);
    const bExact = b.name.toLowerCase() === cleanQ || (b.skill_name && b.skill_name.toLowerCase() === cleanQ);
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;
    if (a.type === 'skill' && b.type === 'reference') return -1;
    if (a.type === 'reference' && b.type === 'skill') return 1;
    return (b.score || 0) - (a.score || 0);
  });

  return results;
}

async function findSkillHybrid(conn, query, options = {}) {
  const topK = options.topK || options.limit || 10;
  const candidateK = options.candidateK || 30;
  if (!query || !query.trim()) {
    const allRows = conn.prepare(`
      SELECT name, skill_name, type, tags, byte_size, line_count, file_path
      FROM skills
      ORDER BY name ASC
      LIMIT ?
    `).all(topK);
    return allRows.map(r => ({
      ...r,
      engine: 'all',
      score: 1.0,
      similarity: null
    }));
  }

  const cleanQuery = query.trim();

  // 1. Vector scan using real IBM Granite ONNX embeddings
  const vecSkillMap = new Map();
  const vecSkillNames = [];

  try {
    const chunkCountRow = conn.prepare("SELECT COUNT(*) as cnt FROM skill_chunks WHERE embedding IS NOT NULL").get();
    const chunkCount = chunkCountRow ? chunkCountRow.cnt : 0;
    if (chunkCount > 0 && isSemanticSearchEnabled()) {
      const queryVec = await embedText(cleanQuery);
      if (queryVec) {
        const nearestChunks = scanNearestChunks(conn, queryVec, candidateK);
        for (let i = 0; i < nearestChunks.length; i++) {
          const [sName, _cIndex, cText, sim] = nearestChunks[i];
          if (!vecSkillMap.has(sName)) {
            vecSkillMap.set(sName, {
              similarity: Number(sim.toFixed(4)),
              rank: vecSkillNames.length + 1,
              chunkText: (cText || '').slice(0, 200)
            });
            vecSkillNames.push(sName);
          }
        }
      }
    }
  } catch (_) {
    // Vector scan fallback
  }

  // 2. FTS5 Keyword BM25 scan
  const ftsSkillMap = new Map();
  const ftsSkillNames = [];
  try {
    const cleanQ = cleanQuery.replace(/[^a-zA-Z0-9_\-\s]/g, ' ').trim();
    if (cleanQ) {
      const rawTokens = cleanQ.split(/\s+/).filter(Boolean).map(t => t.toLowerCase());
      const tokenSet = new Set();
      for (const t of rawTokens) {
        if (!FTS_STOP_WORDS.has(t) && t.length > 1) {
          tokenSet.add(t);
          if (FTS_MULTILINGUAL_SYNONYMS[t]) {
            for (const syn of FTS_MULTILINGUAL_SYNONYMS[t]) tokenSet.add(syn);
          }
        }
      }

      let ftsSupported = true;
      try {
        const dbMod = require('./db');
        if (dbMod.hasFts5Support && !dbMod.hasFts5Support(conn)) {
          ftsSupported = false;
        }
      } catch (_) { /* best effort */ }

      if (ftsSupported && tokenSet.size > 0) {
        const ftsQuery = Array.from(tokenSet).map(t => `"${t}"*`).join(" OR ");
        const ftsSql = `
          SELECT name, bm25(skills_fts, 10.0, 5.0, 8.0, 1.0) as rank
          FROM skills_fts
          WHERE skills_fts MATCH ?
          ORDER BY rank ASC
          LIMIT ?
        `;
        const rows = conn.prepare(ftsSql).all(ftsQuery, candidateK);
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          ftsSkillMap.set(r.name, { rank: i + 1, bm25: r.rank });
          ftsSkillNames.push(r.name);
        }
      }
    }
  } catch (_) { /* best effort */ }

  // Fallback to LIKE query if FTS5 returned 0
  if (ftsSkillNames.length === 0) {
    try {
      const likeRows = conn.prepare(`
        SELECT name FROM skills
        WHERE name LIKE ? OR skill_name LIKE ? OR tags LIKE ?
        ORDER BY byte_size ASC
        LIMIT ?
      `).all(`%${cleanQuery}%`, `%${cleanQuery}%`, `%${cleanQuery}%`, candidateK);
      for (let i = 0; i < likeRows.length; i++) {
        const r = likeRows[i];
        if (!ftsSkillMap.has(r.name)) {
          ftsSkillMap.set(r.name, { rank: i + 1, bm25: 0 });
          ftsSkillNames.push(r.name);
        }
      }
    } catch (_) { /* best effort */ }
  }

  // 3. Merging and Ranking via Reciprocal Rank Fusion
  const allCandidateNames = new Set([...vecSkillNames, ...ftsSkillNames]);
  if (allCandidateNames.size === 0) {
    return [];
  }

  const kConstant = 60;
  const scoredItems = [];

  for (const sName of allCandidateNames) {
    const inVec = vecSkillMap.has(sName);
    const inFts = ftsSkillMap.has(sName);

    const vecInfo = vecSkillMap.get(sName);
    const ftsInfo = ftsSkillMap.get(sName);

    // Suppress low-similarity vector noise (<0.40) when keyword tokens don't match in FTS
    if (inVec && !inFts && (vecInfo.similarity || 0) < 0.40) {
      continue;
    }

    const rrfVec = inVec ? (1.0 / (kConstant + vecInfo.rank)) : 0;
    const rrfFts = inFts ? (1.0 / (kConstant + ftsInfo.rank)) : 0;
    let combinedScore = rrfVec + rrfFts;

    // Strong boost for exact name match and prefix matches
    const lowerSName = sName.toLowerCase();
    const cleanLower = cleanQuery.toLowerCase();
    if (lowerSName === cleanLower) {
      combinedScore += 10.0;
    } else if (lowerSName.startsWith(cleanLower + '/') || lowerSName.includes(cleanLower)) {
      combinedScore += 1.0;
    }

    let engine = 'fts5';
    if (inVec && inFts) {
      engine = 'both';
    } else if (inVec) {
      engine = 'vector';
    } else {
      engine = 'fts5';
    }

    scoredItems.push({
      name: sName,
      engine,
      score: combinedScore,
      similarity: inVec ? vecInfo.similarity : null,
      matched_chunk: inVec ? vecInfo.chunkText : null
    });
  }

  scoredItems.sort((a, b) => b.score - a.score);
  const topCandidates = scoredItems.slice(0, topK);

  const maxScore = topCandidates[0]?.score || 1;
  for (const item of topCandidates) {
    item.normalized_score = Number((item.score / maxScore).toFixed(3));
  }

  const placeholders = topCandidates.map(() => '?').join(',');
  const skillDetails = conn.prepare(`
    SELECT name, skill_name, type, tags, byte_size, line_count, file_path
    FROM skills
    WHERE name IN (${placeholders})
  `).all(...topCandidates.map(t => t.name));

  const detailsMap = new Map();
  for (const sd of skillDetails) {
    detailsMap.set(sd.name, sd);
  }

  const results = [];
  for (const item of topCandidates) {
    const details = detailsMap.get(item.name);
    if (details) {
      results.push({
        ...details,
        engine: item.engine,
        score: item.normalized_score,
        similarity: item.similarity,
        matched_chunk: item.matched_chunk
      });
    }
  }

  results.sort((a, b) => {
    const aExact = a.name.toLowerCase() === cleanQuery.toLowerCase() || (a.skill_name && a.skill_name.toLowerCase() === cleanQuery.toLowerCase());
    const bExact = b.name.toLowerCase() === cleanQuery.toLowerCase() || (b.skill_name && b.skill_name.toLowerCase() === cleanQuery.toLowerCase());
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;
    if (a.type === 'skill' && b.type === 'reference') return -1;
    if (a.type === 'reference' && b.type === 'skill') return 1;
    return (b.score || 0) - (a.score || 0);
  });

  return results;
}

async function indexSingleSkillChunks(conn, skillName, content) {
  const chunks = chunkDocument(content);
  if (!chunks.length) {
    conn.prepare("DELETE FROM skill_chunks WHERE skill_name = ?").run(skillName);
    return 0;
  }

  // Pre-fetch existing cached embeddings for this skill before deletion so we NEVER recompute them!
  const localCache = new Map();
  try {
    const existing = conn.prepare(
      "SELECT chunk_text, embedding FROM skill_chunks WHERE skill_name = ? AND embedding IS NOT NULL"
    ).all(skillName);
    for (const r of existing) {
      if (r.chunk_text && r.embedding) {
        localCache.set(r.chunk_text, r.embedding);
      }
    }
  } catch (_) { /* intentional best-effort fallback: table may not exist yet */ }

  conn.prepare("DELETE FROM skill_chunks WHERE skill_name = ?").run(skillName);

  const stmt = conn.prepare(
    "INSERT INTO skill_chunks (skill_name, chunk_index, chunk_text, embedding) VALUES (?, ?, ?, ?)"
  );

  for (const [idx, chunkText] of chunks) {
    let blob = localCache.get(chunkText);
    if (!blob) {
      const existingRow = conn.prepare(
        "SELECT embedding FROM skill_chunks WHERE chunk_text = ? AND embedding IS NOT NULL LIMIT 1"
      ).get(chunkText);
      if (existingRow && existingRow.embedding) {
        blob = existingRow.embedding;
      }
    }

    if (!blob) {
      const tInferStart = Date.now();
      const vec = await embedText(chunkText);
      blob = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
      const inferMs = Date.now() - tInferStart;

      // Adaptive CPU duty-cycle throttling:
      // Sleep at least equal to (inferMs * 1.25) + 15ms (or KONOHA_EMBED_PACE_MS) to strictly cap CPU duty cycle to ~40-45%.
      // This eliminates continuous 100% CPU spikes and keeps CPU temperature cool and system responsive.
      const envPace = parseInt(process.env.KONOHA_EMBED_PACE_MS || '0', 10);
      const sleepMs = envPace > 0 ? envPace : Math.max(Math.round(inferMs * 1.25) + 15, 35);
      await new Promise(resolve => setTimeout(resolve, sleepMs));
    }
    stmt.run(skillName, idx, chunkText, blob);
  }

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

  // Sequential streaming: fetch only metadata headers first, not massive markdown contents all at once
  const skillHeaders = conn.prepare(
    "SELECT name, type FROM skills ORDER BY CASE WHEN type = 'skill' THEN 0 ELSE 1 END, name ASC"
  ).all();

  const getContentStmt = conn.prepare("SELECT content FROM skills WHERE name = ?");

  let totalChunks = 0;
  for (const h of skillHeaders) {
    const sName = h.name;
    const sType = h.type;
    if (!forceRebuild && existingIndexed.has(sName)) {
      continue;
    }
    if (sType !== 'skill' && maxTimeSeconds > 0 && ((Date.now() - startTime) / 1000) > maxTimeSeconds) {
      break;
    }
    const row = getContentStmt.get(sName);
    const sContent = row ? row.content : null;
    if (sContent) {
      const cnt = await indexSingleSkillChunks(conn, sName, sContent);
      totalChunks += cnt;
    }

    // Flush in-memory embedding cache between skills to prevent heap accumulation
    if (_EMBED_CACHE.size > 256) {
      _EMBED_CACHE.clear();
    }
    // Yield CPU between skills with 50ms cooling delay
    await new Promise(resolve => setTimeout(resolve, 50));
    if (typeof global.gc === 'function' && totalChunks % 100 === 0) {
      try { global.gc(); } catch (_) { /* ignore */ }
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
