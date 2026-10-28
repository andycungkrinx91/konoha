'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const SEMANTIC_SEARCH_ENV = "KONOHA_SEMANTIC_SEARCH";
const EMBED_MODEL_REPO = "onnx-community/granite-embedding-97m-multilingual-r2-ONNX";
const RERANK_MODEL_REPO = "Xenova/ms-marco-MiniLM-L-6-v2";
const VECTOR_DIMENSION = 384;
const _MAX_EMBED_CACHE = 512;
const _EMBED_CACHE = new Map();

// Dynamic module name to prevent static manifest warning for optional runtime dependency
const HF_TRANSFORMERS_PKG = ['@huggingface', 'transformers'].join('/');

let _pipelineExtractor = null;
let _pipelineReranker = null;

function noopProgress() {
  return null;
}

function isSemanticSearchEnabled() {
  const val = (process.env[SEMANTIC_SEARCH_ENV] || "1").trim().toLowerCase();
  return !["0", "false", "no", "disabled"].includes(val);
}

function checkModelCandidateDir(cDir) {
  const modelSub = path.join(cDir, EMBED_MODEL_REPO);
  const rerankSub = path.join(cDir, RERANK_MODEL_REPO);
  const hasModel = fs.existsSync(modelSub) && fs.statSync(modelSub).isDirectory();
  const hasRerank = fs.existsSync(rerankSub) && fs.statSync(rerankSub).isDirectory();
  return hasModel || hasRerank;
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
    if (checkModelCandidateDir(cDir)) return cDir;
  }
  return path.join(os.homedir(), '.konoha', 'transformers_cache');
}

async function instantiateEmbedPipeline(pipeline, modelRepo, options, hasLocal) {
  try {
    return await pipeline('feature-extraction', modelRepo, options);
  } catch (err) {
    if (hasLocal) {
      const fallbackOptions = Object.assign({}, options);
      delete fallbackOptions.local_files_only;
      return await pipeline('feature-extraction', modelRepo, fallbackOptions);
    }
    throw err;
  }
}

async function getEmbedPipeline() {
  if (_pipelineExtractor) return _pipelineExtractor;
  try {
    const { pipeline, env } = require(HF_TRANSFORMERS_PKG);
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
    _pipelineExtractor = await instantiateEmbedPipeline(pipeline, EMBED_MODEL_REPO, pipelineOptions, hasLocalModel);
    await new Promise(resolve => setTimeout(resolve, 100));
    return _pipelineExtractor;
  } catch (_) {
    return null;
  }
}

async function instantiateRerankModels(context) {
  const { AutoTokenizer, AutoModel, modelRepo, modelSub, options, hasLocal } = context;
  const target = hasLocal ? modelSub : modelRepo;
  try {
    const tokenizer = await AutoTokenizer.from_pretrained(target, { local_files_only: hasLocal });
    const model = await AutoModel.from_pretrained(target, options);
    return { tokenizer, model };
  } catch (err) {
    if (hasLocal) {
      const fallbackOpts = Object.assign({}, options);
      delete fallbackOpts.local_files_only;
      const tokenizer = await AutoTokenizer.from_pretrained(modelRepo);
      const model = await AutoModel.from_pretrained(modelRepo, fallbackOpts);
      return { tokenizer, model };
    }
    throw err;
  }
}

async function getRerankPipeline() {
  if (_pipelineReranker) return _pipelineReranker;
  try {
    const { AutoTokenizer, AutoModelForSequenceClassification, env } = require(HF_TRANSFORMERS_PKG);
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
    _pipelineReranker = await instantiateRerankModels({
      AutoTokenizer,
      AutoModel: AutoModelForSequenceClassification,
      modelRepo: RERANK_MODEL_REPO,
      modelSub,
      options: modelOptions,
      hasLocal: hasLocalModel
    });
    return _pipelineReranker;
  } catch (_) {
    return null;
  }
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

function generateDeterministicVector(textHash) {
  const vec = new Float32Array(VECTOR_DIMENSION);
  let sumSq = 0;
  for (let i = 0; i < VECTOR_DIMENSION; i++) {
    const byteVal = parseInt(textHash.slice((i * 2) % 62, ((i * 2) % 62) + 2) || '1', 16);
    vec[i] = (byteVal - 128) / 128.0;
    sumSq += vec[i] * vec[i];
  }
  const normVal = Math.sqrt(sumSq) || 1.0;
  for (let i = 0; i < VECTOR_DIMENSION; i++) vec[i] /= normVal;
  return vec;
}

function normalizeVectorInPlace(vec) {
  let sumSq = 0;
  for (let i = 0; i < VECTOR_DIMENSION; i++) sumSq += vec[i] * vec[i];
  const normVal = Math.sqrt(sumSq);
  if (normVal > 0) {
    for (let i = 0; i < VECTOR_DIMENSION; i++) vec[i] /= normVal;
  }
}

function updateEmbedCache(textHash, vec) {
  if (_EMBED_CACHE.size >= _MAX_EMBED_CACHE) {
    const firstKey = _EMBED_CACHE.keys().next().value;
    _EMBED_CACHE.delete(firstKey);
  }
  _EMBED_CACHE.set(textHash, new Float32Array(vec));
}

function safeDisposeTensor(tensor) {
  if (!tensor || typeof tensor.dispose !== 'function') return;
  try {
    tensor.dispose();
  } catch (_) { /* ignore */ }
}

async function embedText(text) {
  const norm = (text || "").trim().split(/\s+/).join(' ');
  const textHash = crypto.createHash('sha256').update(norm, 'utf8').digest('hex');
  if (_EMBED_CACHE.has(textHash)) {
    return new Float32Array(_EMBED_CACHE.get(textHash));
  }

  const extractor = await getEmbedPipeline();
  if (!extractor) {
    const vec = generateDeterministicVector(textHash);
    updateEmbedCache(textHash, vec);
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
    safeDisposeTensor(output);
  }

  normalizeVectorInPlace(vec);
  updateEmbedCache(textHash, vec);
  return vec;
}

function cosineSimilarity(vecA, vecB) {
  let dot = 0;
  for (let i = 0; i < VECTOR_DIMENSION; i++) {
    dot += vecA[i] * vecB[i];
  }
  return dot;
}

function normalizeDocItem(doc, idx) {
  if (typeof doc === 'string') {
    return { id: idx, text: doc, original: { text: doc } };
  }
  return {
    id: doc.id !== undefined ? doc.id : idx,
    text: doc.text || doc.chunk_text || doc.content || '',
    original: doc
  };
}

async function scoreSingleDoc(item, query, tokenizer, model) {
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
    return Object.assign({}, item.original, {
      rerank_score: Number(score.toFixed(4)),
      text: item.text
    });
  } catch (_) {
    return Object.assign({}, item.original, {
      rerank_score: -999.0,
      text: item.text
    });
  }
}

async function rerank(query, documents, options = {}) {
  if (!query || !documents || !documents.length) return [];
  const topK = options.topK || documents.length;
  const docItems = documents.map((doc, idx) => normalizeDocItem(doc, idx));

  const reranker = await getRerankPipeline();
  if (!reranker) {
    return docItems.slice(0, topK).map((item, r) => Object.assign({}, item.original, {
      rerank_score: 1.0 / (60 + r + 1),
      rank: r + 1
    }));
  }

  const { tokenizer, model } = reranker;
  const scored = [];
  for (const item of docItems) {
    const result = await scoreSingleDoc(item, query, tokenizer, model);
    scored.push(result);
  }

  scored.sort((a, b) => b.rerank_score - a.rerank_score);
  return scored.slice(0, topK).map((item, r) => Object.assign({}, item, {
    rank: r + 1
  }));
}

module.exports = {
  SEMANTIC_SEARCH_ENV,
  EMBED_MODEL_REPO,
  RERANK_MODEL_REPO,
  VECTOR_DIMENSION,
  _MAX_EMBED_CACHE,
  _EMBED_CACHE,
  isSemanticSearchEnabled,
  getBundledModelsDir,
  getEmbedPipeline,
  getRerankPipeline,
  predownloadAllModels,
  embedText,
  cosineSimilarity,
  rerank
};
