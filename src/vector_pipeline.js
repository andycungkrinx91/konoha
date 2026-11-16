'use strict';

/**
 * src/vector_pipeline.js — Semantic Embedding & Cross-Encoder Reranking Pipeline.
 *
 * Uses the official `@huggingface/transformers` package and its native Hugging Face
 * model loading and caching (`FileCache`), honoring standard HF environment variables:
 *   - Embedder: onnx-community/granite-embedding-97m-multilingual-r2-ONNX (384-dim CLS, L2-norm)
 *   - Reranker: Xenova/ms-marco-MiniLM-L-6-v2 (Cross-Encoder logits -> sigmoid score)
 *
 * Fails loudly with `EmbeddingRuntimeUnavailableError` when runtime or models are unavailable.
 */

const os = require('node:os');

const SEMANTIC_SEARCH_ENV = 'KONOHA_SEMANTIC_SEARCH';
const EMBED_MODEL_REPO = 'onnx-community/granite-embedding-97m-multilingual-r2-ONNX';
const RERANK_MODEL_REPO = 'Xenova/ms-marco-MiniLM-L-6-v2';
const EMBED_DIM = 384;
// One sequence per ONNX call is 1.58x faster than 16 on the bundled granite-97m
// q8 graph (44 295 live chunks: 201.5 vs 127.6 chunks/s, 220 s vs 347 s). Padding
// waste is already ~0 at these widths, so the win is the int8 kernel at M=1, not
// saved tokens. Callers can still raise it via `batchSize`.
const DEFAULT_EMBED_BATCH_SIZE = 1;
const DEFAULT_RERANK_BATCH_SIZE = 16;
const DEFAULT_EMBED_MAX_LENGTH = 512;
const DEFAULT_RERANK_MAX_LENGTH = 512;

const _MAX_EMBED_CACHE = 2048;
const _EMBED_CACHE = new Map();
const _RERANK_CACHE = new Map();
const _SESSION_QUEUES = new Map();

let _tfModulePromise = null;
let _defaultCacheDir;
let _defaultAllowRemote;
let _embedPipelinePromise = null;
let _rerankPipelinePromise = null;
let _embedLoaded = false;
let _rerankLoaded = false;
let _moduleLoadError = null;

/**
 * Error thrown when semantic embedding or reranking cannot execute.
 */
class EmbeddingRuntimeUnavailableError extends Error {
  constructor(message, cause = null) {
    super(message);
    this.name = 'EmbeddingRuntimeUnavailableError';
    this.code = 'EMBEDDING_RUNTIME_UNAVAILABLE';
    if (cause) this.cause = cause;
  }
}

/**
 * Returns whether semantic embedding and cross-encoder reranking are enabled.
 * @returns {boolean}
 */
const {
  isSemanticSearchEnabled,
  resolveHfCacheOverride: _resolveHfCacheOverride,
  isHfOffline: _isHfOffline,
  resolveStandardHfHubCacheDir: _resolveStandardHfHubCacheDir,
  resolveDefaultPackageCacheDir,
  resolveCacheSearchDirs,
  configureHfEnv,
  resolveCachedRepoLocation: _resolveCachedRepoLocation,
} = require('./hf_cache_resolver');

const {
  normalizeForEmbedding,
  hashNormalizedText,
  makeEmbedCacheKey,
  planEmbedBatches,
} = require('./embed_batching');

const _resolveDefaultPackageCacheDir = () => resolveDefaultPackageCacheDir(_defaultCacheDir);
const _resolveCacheSearchDirs = () => resolveCacheSearchDirs(_defaultCacheDir);
const _configureHfEnv = (hfEnv) => configureHfEnv(hfEnv, _defaultCacheDir, _defaultAllowRemote);

async function _loadTransformersModule() {
  if (!_tfModulePromise) {
    _tfModulePromise = import('@huggingface/transformers')
      .then((mod) => {
        if (_defaultCacheDir === undefined) {
          _defaultCacheDir = mod.env.cacheDir;
          _defaultAllowRemote = mod.env.allowRemoteModels;
        }
        return mod;
      })
      .catch((err) => {
        _tfModulePromise = null;
        const winHint = (process.platform === 'win32'
          && /ERR_DLOPEN_FAILED|specified module could not be found/i.test(`${err && err.code || ''} ${err && err.message || ''}`))
          ? ' (On Windows, install Microsoft Visual C++ 2015-2022 Redistributable x64: https://aka.ms/vs/17/release/vc_redist.x64.exe)'
          : '';
        const msg = `Failed to load @huggingface/transformers runtime: ${err.message}${winHint}`;
        _moduleLoadError = msg;
        throw new EmbeddingRuntimeUnavailableError(msg, err);
      });
  }
  const mod = await _tfModulePromise;
  const cfg = _configureHfEnv(mod.env);
  return { mod, ...cfg };
}

function _runSerialized(lockKey, taskFn) {
  const prev = _SESSION_QUEUES.get(lockKey) || Promise.resolve();
  const next = prev.then(taskFn, taskFn);
  const cleanup = next.then(
    () => {
      if (_SESSION_QUEUES.get(lockKey) === cleanup) {
        _SESSION_QUEUES.delete(lockKey);
      }
    },
    () => {
      if (_SESSION_QUEUES.get(lockKey) === cleanup) {
        _SESSION_QUEUES.delete(lockKey);
      }
    }
  );
  _SESSION_QUEUES.set(lockKey, cleanup);
  return next;
}

function _clearPipelineSlot(kind) {
  if (kind === 'embed') {
    _embedPipelinePromise = null;
    _embedLoaded = false;
  } else {
    _rerankPipelinePromise = null;
    _rerankLoaded = false;
  }
}

async function _disposePipeline(resolved) {
  if (!resolved || !resolved.model || typeof resolved.model.dispose !== 'function') return;
  try {
    await resolved.model.dispose();
  } catch (_) {
    /* ignore disposal errors during teardown */
  }
}

// ONNX Runtime defaults to one intra-op thread per logical CPU, which pins every
// core and freezes the desktop during `konoha init`. The 97M q8 model does not
// scale past the physical core count, and oversubscribing it is worse: over 600
// real chunks on a 16-thread/8-core Ryzen 9 5900HX, 4 threads embedded at 204
// chunks/s, 8 at 243, 12 at 227 and 16 at 202. Restricting the process to 8 CPUs
// moved the optimum to 4, and to 4 CPUs moved it to 2, so half the logical count
// tracks physical cores; a non-SMT host loses 2% at 4 cores, which is the price
// of not reading topology from sysfs.
function _embedThreadCount() {
  const logical = os.availableParallelism ? os.availableParallelism() : (os.cpus() || []).length;
  return Math.max(1, Math.ceil(logical / 2));
}

async function _initModelPair(kind, repo, modelKey) {
  const { mod, offline, cacheDir } = await _loadTransformersModule();
  const AutoTokenizer = mod.AutoTokenizer;
  const ModelClass = mod[modelKey];
  if (!AutoTokenizer || !ModelClass) {
    throw new EmbeddingRuntimeUnavailableError(
      `@huggingface/transformers is missing AutoTokenizer or ${modelKey}.`
    );
  }
  const resolved = _resolveCachedRepoLocation(_resolveCacheSearchDirs(), repo);
  const modelTarget = resolved ? resolved.modelRef : repo;
  if (resolved && resolved.cacheDir && !_resolveHfCacheOverride()) {
    mod.env.cacheDir = resolved.cacheDir;
  }
  const loadOpts = { local_files_only: offline };
  const tokenizer = await AutoTokenizer.from_pretrained(modelTarget, loadOpts);
  const model = await ModelClass.from_pretrained(modelTarget, {
    dtype: 'q8',
    local_files_only: offline,
    session_options: {
      intraOpNumThreads: _embedThreadCount(),
      interOpNumThreads: 1,
    },
  });
  if (kind === 'embed') _embedLoaded = true;
  else _rerankLoaded = true;
  return {
    tokenizer,
    model,
    repo,
    cacheDir,
    resolvedCacheDir: resolved ? resolved.cacheDir : cacheDir,
    cacheLayout: resolved ? resolved.layout : 'remote',
    offline,
  };
}

function _getOrInitPipeline(kind, repo, modelKey, currentPromise, setPromise) {
  if (!isSemanticSearchEnabled()) return Promise.resolve(null);
  const desiredCache = _resolveHfCacheOverride();
  const desiredOffline = _isHfOffline();

  if (currentPromise) {
    const effectiveCache = desiredCache !== null ? desiredCache : _defaultCacheDir;
    return currentPromise.then((existing) => {
      const sameCache = effectiveCache === undefined || (existing && existing.cacheDir === effectiveCache);
      const sameConfig = existing && sameCache && existing.offline === desiredOffline;
      if (sameConfig) return existing;
      setPromise(null);
      return _disposePipeline(existing).then(() => getOrReset());
    });
  }

  function getOrReset() {
    const fresh = _runSerialized(`init:${kind}`, () => _initModelPair(kind, repo, modelKey)).catch((err) => {
      _clearPipelineSlot(kind);
      if (err instanceof EmbeddingRuntimeUnavailableError) throw err;
      throw new EmbeddingRuntimeUnavailableError(
        `Failed to load ${kind} model '${repo}': ${err.message}`,
        err
      );
    });
    setPromise(fresh);
    return fresh;
  }

  return getOrReset();
}

/**
 * Lazily loads the Granite 97M embedding tokenizer and ONNX model via Hugging Face cache.
 * @returns {Promise<{tokenizer: object, model: object, repo: string, cacheDir: string|null, offline: boolean}|null>}
 */
function getEmbedPipeline() {
  return _getOrInitPipeline('embed', EMBED_MODEL_REPO, 'AutoModel', _embedPipelinePromise, (p) => {
    _embedPipelinePromise = p;
  });
}

/**
 * Lazily loads the MS MARCO MiniLM cross-encoder tokenizer and sequence classification model.
 * @returns {Promise<{tokenizer: object, model: object, repo: string, cacheDir: string|null, offline: boolean}|null>}
 */
function getRerankPipeline() {
  return _getOrInitPipeline(
    'rerank',
    RERANK_MODEL_REPO,
    'AutoModelForSequenceClassification',
    _rerankPipelinePromise,
    (p) => {
      _rerankPipelinePromise = p;
    }
  );
}

/**
 * Reports current semantic pipeline runtime configuration and availability without probing disk caches.
 * @returns {object}
 */

function getRuntimeStatus() {
  const enabled = isSemanticSearchEnabled();
  const offline = _isHfOffline();
  const searchDirs = _resolveCacheSearchDirs();
  const embedLocation = _resolveCachedRepoLocation(searchDirs, EMBED_MODEL_REPO);
  const rerankLocation = _resolveCachedRepoLocation(searchDirs, RERANK_MODEL_REPO);
  const cacheDir = _resolveHfCacheOverride()
    || (embedLocation && embedLocation.cacheDir)
    || _resolveDefaultPackageCacheDir()
    || _resolveStandardHfHubCacheDir()
    || null;
  let packageAvailable = false;
  try { require.resolve('@huggingface/transformers'); packageAvailable = true; } catch (_) { /* missing */ }
  const embedCached = _embedLoaded || Boolean(embedLocation);
  const rerankCached = _rerankLoaded || Boolean(rerankLocation);
  const offlineWithoutCache = offline && !embedCached;
  let reason = 'ready';
  if (!enabled) reason = `${SEMANTIC_SEARCH_ENV}=0`;
  else if (!packageAvailable) reason = '@huggingface/transformers package unavailable';
  else if (_moduleLoadError) reason = _moduleLoadError;
  else if (offlineWithoutCache) reason = 'offline without cached models';
  else if (offline && !rerankCached) reason = 'offline without cached reranker';
  else if (offline) reason = 'offline (cached)';
  const available = enabled && packageAvailable && !_moduleLoadError && !offlineWithoutCache;
  const semanticStatus = !enabled ? 'disabled' : (available ? 'available' : 'degraded');
  return {
    enabled,
    available,
    semanticStatus,
    backend: '@huggingface/transformers',
    offline,
    cacheDir,
    embedModel: {
      repo: EMBED_MODEL_REPO,
      loaded: _embedLoaded,
      cached: embedCached,
      cacheLayout: embedLocation ? embedLocation.layout : null,
    },
    rerankModel: {
      repo: RERANK_MODEL_REPO,
      loaded: _rerankLoaded,
      cached: rerankCached,
      cacheLayout: rerankLocation ? rerankLocation.layout : null,
    },
    reason,
  };
}

function isSemanticCapable() {
  return Boolean(getRuntimeStatus().available);
}

function _lruGet(cache, cacheKey) {
  if (!cache.has(cacheKey)) return null;
  const val = cache.get(cacheKey);
  cache.delete(cacheKey);
  cache.set(cacheKey, val);
  return val;
}

function _lruSet(cache, cacheKey, value, limit = _MAX_EMBED_CACHE) {
  if (cache.has(cacheKey)) {
    cache.delete(cacheKey);
  } else if (cache.size >= limit) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(cacheKey, value);
}

function _disposeTensor(tensor) {
  if (tensor && typeof tensor.dispose === 'function') {
    try {
      tensor.dispose();
    } catch (_) {
      /* ignore already-disposed tensors */
    }
  }
}

function _disposeTensorMap(mapObj) {
  if (!mapObj || typeof mapObj !== 'object') return;
  for (const val of Object.values(mapObj)) {
    _disposeTensor(val);
  }
}

function _l2Normalize(slice) {
  let normSq = 0;
  for (let i = 0; i < slice.length; i++) {
    const v = slice[i];
    normSq += v * v;
  }
  const out = new Float32Array(slice.length);
  if (normSq > 0) {
    const inv = 1 / Math.sqrt(normSq);
    for (let i = 0; i < slice.length; i++) {
      out[i] = slice[i] * inv;
    }
  }
  return out;
}

function _collectEmbedMisses(texts, modelRepo, results) {
  const misses = [];
  const missByKey = new Map();
  for (let i = 0; i < texts.length; i++) {
    const norm = normalizeForEmbedding(texts[i]);
    const cacheKey = makeEmbedCacheKey(hashNormalizedText(norm), modelRepo);
    const cached = _lruGet(_EMBED_CACHE, cacheKey);
    if (cached) {
      results[i] = new Float32Array(cached);
    } else if (missByKey.has(cacheKey)) {
      missByKey.get(cacheKey).indices.push(i);
    } else {
      const entry = { cacheKey, norm, indices: [i] };
      missByKey.set(cacheKey, entry);
      misses.push(entry);
    }
  }
  return misses;
}

function _storeEmbedChunkResults(chunk, raw, dim, results) {
  for (let b = 0; b < chunk.length; b++) {
    const offset = b * dim;
    const vec = _l2Normalize(raw.subarray(offset, offset + dim));
    _lruSet(_EMBED_CACHE, chunk[b].cacheKey, new Float32Array(vec));
    for (const targetIdx of chunk[b].indices) {
      results[targetIdx] = new Float32Array(vec);
    }
  }
}

async function _runEmbedBatchChunk(pipeline, batchInputs, maxLength, chunk, results) {
  return _runSerialized('embed', async () => {
    const inputs = pipeline.tokenizer(batchInputs, {
      padding: true,
      truncation: true,
      max_length: maxLength,
    });
    let out = null;
    let cls = null;
    let clsNorm = null;
    try {
      out = await pipeline.model(inputs);
      const hidden = out && out.last_hidden_state;
      if (!hidden) {
        throw new EmbeddingRuntimeUnavailableError('Unexpected ONNX output tensor from Granite embedder.');
      }
      cls = hidden.slice(null, 0);
      clsNorm = cls.normalize(2, -1);
      const { data, dims } = clsNorm;
      if (!data || !Array.isArray(dims) || dims.length < 1) {
        throw new EmbeddingRuntimeUnavailableError('Unexpected pooled tensor dims from Granite embedder.');
      }
      const dim = dims[dims.length - 1];
      _storeEmbedChunkResults(chunk, data, dim, results);
    } finally {
      _disposeTensor(clsNorm);
      _disposeTensor(cls);
      _disposeTensorMap(out);
      _disposeTensorMap(inputs);
    }
  });
}

function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Embeds a batch of strings with Granite 97M (384-dim CLS, L2-normalized) and LRU caching.
 * @param {string[]} texts
 * @param {object} [options]
 * @returns {Promise<Float32Array[]>}
 */
async function embedBatch(texts, options = {}) {
  if (!Array.isArray(texts)) throw new TypeError('embedBatch requires an array of strings');
  if (texts.length === 0) return [];
  if (!isSemanticSearchEnabled()) {
    throw new EmbeddingRuntimeUnavailableError(
      `Semantic embedding requested while ${SEMANTIC_SEARCH_ENV} is disabled.`
    );
  }

  const modelRepo = options.modelRepo || EMBED_MODEL_REPO;
  const maxLength = Math.max(16, Number(options.maxLength) || DEFAULT_EMBED_MAX_LENGTH);
  const batchSize = Math.max(1, Number(options.batchSize) || DEFAULT_EMBED_BATCH_SIZE);
  const paceMs = Math.max(0, Number(options.paceMs ?? process.env.KONOHA_EMBED_PACE_MS) || 0);
  const results = Array.from({ length: texts.length });
  const misses = _collectEmbedMisses(texts, modelRepo, results);
  if (misses.length === 0) return results;

  const pipeline = await getEmbedPipeline();
  if (!pipeline) {
    throw new EmbeddingRuntimeUnavailableError(
      `Semantic embedding requested while ${SEMANTIC_SEARCH_ENV} is disabled.`
    );
  }

  const preCharCap = maxLength * 16;
  // `padding: true` computes every sequence at the width of the longest one in
  // its batch, and real chunk bodies run p50 756 / p99 1988 chars, so a randomly
  // ordered batch spends a large share of its FLOPs on padding. Sorting the
  // misses by length makes each batch near-homogeneous; measured 2.1x on 160
  // live chunks. Reordering is invisible to callers: `_storeEmbedChunkResults`
  // writes back through `chunk[b].indices`.
  const ordered = misses
    .slice()
    .sort((a, b) => Math.min(a.norm.length, preCharCap) - Math.min(b.norm.length, preCharCap));

  const batches = planEmbedBatches(ordered, batchSize, maxLength);
  for (let i = 0; i < batches.length; i++) {
    const chunk = batches[i];
    const batchInputs = chunk.map((m) =>
      m.norm.length > preCharCap ? m.norm.slice(0, preCharCap) : m.norm
    );
    await _runEmbedBatchChunk(pipeline, batchInputs, maxLength, chunk, results);
    if (paceMs > 0 && i + 1 < batches.length) {
      await _sleep(paceMs);
    }
  }

  return results;
}

/**
 * Embeds a single text string into a 384-dim normalized Float32Array.
 * @param {string} text
 * @param {object} [options]
 * @returns {Promise<Float32Array>}
 */
async function embedText(text, options = {}) {
  const vecs = await embedBatch([text], options);
  return vecs[0];
}

/**
 * Computes cosine similarity between two equal-length embedding vectors.
 * @param {Float32Array|number[]} vecA
 * @param {Float32Array|number[]} vecB
 * @returns {number}
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length === 0 || vecA.length !== vecB.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i];
    const b = vecB[i];
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Formats a code chunk or document object with path/symbol/line-span metadata for cross-encoder reranking.
 * @param {string|object} doc
 * @returns {string}
 */
function formatCodeForRerank(doc) {
  if (typeof doc === 'string') return doc;
  if (!doc || typeof doc !== 'object') return String(doc || '');
  const body = doc.chunk_text || doc.content || doc.matched_chunk || doc.text || doc.snippet || '';
  const relPath = doc.relative_path || doc.file_path || '';
  const symbolName = doc.symbol_name || doc.qualified_name || '';
  const lineSpan =
    doc.start_line != null
      ? `L${doc.start_line}${doc.end_line != null && doc.end_line !== doc.start_line ? `-${doc.end_line}` : ''}`
      : '';

  const headerParts = [];
  if (relPath) headerParts.push(relPath);
  if (symbolName) headerParts.push(symbolName);
  if (lineSpan) headerParts.push(lineSpan);

  if (headerParts.length === 0) return String(body);
  return `[${headerParts.join(' | ')}]\n${body}`;
}

function _sigmoid(logit) {
  if (logit >= 0) {
    const z = Math.exp(-logit);
    return 1 / (1 + z);
  }
  const z = Math.exp(logit);
  return z / (1 + z);
}

function _collectRerankMisses(cleanQuery, formatted, logits) {
  const queryHash = hashNormalizedText(cleanQuery);
  const misses = [];
  for (let i = 0; i < formatted.length; i++) {
    const cacheKey = `${RERANK_MODEL_REPO}:${queryHash}:${hashNormalizedText(formatted[i])}`;
    const cached = _lruGet(_RERANK_CACHE, cacheKey);
    if (cached !== null) {
      logits[i] = cached;
    } else {
      misses.push({ idx: i, passage: formatted[i], cacheKey });
    }
  }
  return misses;
}

async function _scoreRerankBatch(cleanQuery, slice, pipeline, logits, maxLength) {
  return _runSerialized('rerank', async () => {
    const queries = slice.map(() => cleanQuery);
    const passages = slice.map((m) => m.passage);
    const inputs = pipeline.tokenizer(queries, {
      text_pair: passages,
      padding: true,
      truncation: true,
      max_length: maxLength,
    });
    let out = null;
    try {
      out = await pipeline.model(inputs);
      const logitTensor = out && out.logits;
      if (!logitTensor || !logitTensor.data) {
        throw new EmbeddingRuntimeUnavailableError('Unexpected ONNX output tensor from MiniLM reranker.');
      }
      const stride = Array.isArray(logitTensor.dims) && logitTensor.dims.length === 2 ? logitTensor.dims[1] : 1;
      for (let i = 0; i < slice.length; i++) {
        const logit = Number(logitTensor.data[i * stride]);
        logits[slice[i].idx] = logit;
        _lruSet(_RERANK_CACHE, slice[i].cacheKey, logit);
      }
    } finally {
      _disposeTensorMap(out);
      _disposeTensorMap(inputs);
    }
  });
}

/**
 * Cross-encoder reranks documents against a query using MS MARCO MiniLM L-6.
 * @param {string} query
 * @param {Array<string|object>} documents
 * @param {object} [options]
 * @returns {Promise<Array<object>>}
 */
async function rerank(query, documents, options = {}) {
  if (!Array.isArray(documents) || documents.length === 0) return [];
  if (!isSemanticSearchEnabled()) {
    throw new EmbeddingRuntimeUnavailableError(
      `Cross-encoder reranking requested while ${SEMANTIC_SEARCH_ENV} is disabled.`
    );
  }

  const topK = options.topK || documents.length;
  const batchSize = Math.max(1, Number(options.batchSize) || DEFAULT_RERANK_BATCH_SIZE);
  const maxLength = Math.max(32, Number(options.maxLength) || DEFAULT_RERANK_MAX_LENGTH);

  const cleanQuery = String(query || '');
  const preCharCap = maxLength * 16;
  const formatted = documents.map((d) => {
    const text = formatCodeForRerank(d);
    return text.length > preCharCap ? text.slice(0, preCharCap) : text;
  });

  const logits = new Float64Array(documents.length);
  const misses = _collectRerankMisses(cleanQuery, formatted, logits);

  if (misses.length > 0) {
    const pipeline = await getRerankPipeline();
    if (!pipeline) {
      throw new EmbeddingRuntimeUnavailableError(
        `Cross-encoder reranking requested while ${SEMANTIC_SEARCH_ENV} is disabled.`
      );
    }
    for (let start = 0; start < misses.length; start += batchSize) {
      const slice = misses.slice(start, start + batchSize);
      await _scoreRerankBatch(cleanQuery, slice, pipeline, logits, maxLength);
    }
  }

  const scored = documents.map((doc, idx) => {
    const base = typeof doc === 'string' ? { text: doc } : { ...doc };
    return { ...base, rerank_score: Number(_sigmoid(logits[idx]).toFixed(6)) };
  });

  scored.sort((a, b) => b.rerank_score - a.rerank_score);
  return scored.slice(0, topK).map((doc, r) => ({
    ...doc,
    rank: r + 1,
  }));
}

/**
 * Releases cached model sessions and clears rerank caches for clean test isolation.
 * @returns {Promise<void>}
 */
async function resetPipelinesForTest() {
  const prevEmbed = _embedPipelinePromise;
  const prevRerank = _rerankPipelinePromise;
  _embedPipelinePromise = null;
  _rerankPipelinePromise = null;
  _embedLoaded = false;
  _rerankLoaded = false;
  _moduleLoadError = null;
  _RERANK_CACHE.clear();
  for (const p of [prevEmbed, prevRerank]) {
    if (!p) continue;
    try {
      const resolved = await p;
      await _disposePipeline(resolved);
    } catch (_) {
      /* ignore cleanup error on reset */
    }
  }
}

module.exports = {
  SEMANTIC_SEARCH_ENV,
  EMBED_MODEL_REPO,
  RERANK_MODEL_REPO,
  EMBED_DIM,
  _MAX_EMBED_CACHE,
  _EMBED_CACHE,
  EmbeddingRuntimeUnavailableError,
  isSemanticSearchEnabled,
  isSemanticCapable,
  getRuntimeStatus,
  normalizeForEmbedding,
  hashNormalizedText,
  makeEmbedCacheKey,
  getEmbedPipeline,
  getRerankPipeline,
  embedBatch,
  embedText,
  cosineSimilarity,
  formatCodeForRerank,
  rerank,
  resetPipelinesForTest,
  _embedThreadCount,
};
