'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');

function testNativeHuggingFaceContract() {
  const vs = require('../src/vector_search');
  const vp = require('../src/vector_pipeline');
  const rootDir = path.resolve(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const deps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
    ...(pkg.optionalDependencies || {}),
  };

  assert.ok(
    typeof (pkg.dependencies && pkg.dependencies['@huggingface/transformers']) === 'string',
    '@huggingface/transformers must be declared in package.json dependencies'
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(deps, 'onnxruntime-web'),
    false,
    'Obsolete direct dependency onnxruntime-web must be removed'
  );
  assert.strictEqual(
    fs.existsSync(path.join(rootDir, 'src', 'onnx_tokenizer.js')),
    false,
    'Obsolete src/onnx_tokenizer.js must not exist'
  );
  for (const mod of [vs, vp]) {
    assert.strictEqual(typeof mod.getBundledModelsDir, 'undefined', 'getBundledModelsDir must be removed');
    assert.strictEqual(typeof mod.predownloadAllModels, 'undefined', 'predownloadAllModels must be removed');
  }

  const status = vp.getRuntimeStatus();
  assert.strictEqual(status.backend, '@huggingface/transformers');
  console.log('✓ Native @huggingface/transformers contract and obsolete custom cache removal verified');
}

async function testEmbeddingInferenceAndOrdering() {
  const vs = require('../src/vector_search');
  const vec = await vs.embedText('SQLite database schema migration and ALTER TABLE');

  assert.ok(vec instanceof Float32Array, 'embedText should return Float32Array');
  assert.strictEqual(vec.length, 384, 'IBM Granite embedding vector dimension must be 384');

  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) sumSq += vec[i] * vec[i];
  assert.ok(Math.abs(sumSq - 1.0) < 1e-4, 'Embedding vector must be L2 normalized');

  const vecs = await vs.embedBatch([
    'SQLite database schema migration and ALTER TABLE',
    'SQLite database migration script adding columns',
    'Chocolate chip cookie baking recipe with butter',
  ]);
  assert.strictEqual(vecs.length, 3);
  const relatedSim = vs.cosineSimilarity(vecs[0], vecs[1]);
  const unrelatedSim = vs.cosineSimilarity(vecs[0], vecs[2]);
  assert.ok(
    relatedSim > unrelatedSim,
    `Expected related similarity (${relatedSim.toFixed(5)}) > unrelated (${unrelatedSim.toFixed(5)})`
  );

  console.log('✓ Native Granite 97M embedding inference passed (384-dim, normalized, monotonic cosine)');
}

async function testRerankerInference() {
  const vs = require('../src/vector_search');
  const query = 'Deploying Helm charts on Kubernetes';
  const passages = [
    'Helm is the official package manager for Kubernetes applications.',
    'The recipe for sourdough bread requires fermentation.',
    'Kubernetes kubectl CLI interacts with cluster control plane.',
  ];

  const reranked = await vs.rerank(query, passages);
  assert.ok(Array.isArray(reranked), 'rerank should return an array');
  assert.strictEqual(reranked.length, 3, 'rerank should return all evaluated passages');
  assert.strictEqual(reranked[0].rank, 1, 'Top item has rank 1');
  assert.ok(typeof reranked[0].rerank_score === 'number', 'rerank_score must be a number');
  assert.ok(
    reranked[0].text.includes('Helm is the official package manager'),
    'Reranker must rank most relevant passage highest'
  );
  assert.ok(
    reranked[0].rerank_score > reranked[1].rerank_score,
    'Top passage must score higher than lower passages'
  );

  console.log('✓ Native cross-encoder reranking passed (MS MARCO MiniLM)');
}

function testRrfRerankingArchitecture() {
  const vs = require('../src/vector_search');
  const ranks1 = ['skill-a', 'skill-b', 'skill-c'];
  const ranks2 = ['skill-b', 'skill-a', 'skill-d'];

  const fused = vs.reciprocalRankFusion([ranks1, ranks2], 60);
  assert.ok(Array.isArray(fused), 'reciprocalRankFusion should return array of [name, score]');
  assert.strictEqual(fused[0][0], 'skill-a', 'Deterministic RRF top result');

  console.log('✓ RRF rank fusion layer verified (k=60)');
}

async function testRagChunkRetrieval() {
  const Database = require('../src/sqlite_driver');
  const { DB_PATH } = require('../src/db');
  const vs = require('../src/vector_search');

  if (!fs.existsSync(DB_PATH)) return;
  const conn = new Database(DB_PATH, { readonly: true });
  try {
    const ragResults = await vs.searchChunksRAG(conn, 'Docker multi-stage container build', {
      topK: 2,
      candidateK: 10,
    });
    assert.ok(Array.isArray(ragResults), 'searchChunksRAG should return array');
    if (ragResults.length > 0) {
      assert.ok(ragResults[0].skill_name, 'RAG result must have skill_name');
      assert.ok(ragResults[0].chunk_text, 'RAG result must have chunk_text');
      assert.ok(typeof ragResults[0].rerank_score === 'number', 'RAG result must have numeric rerank_score');
    }
    console.log('✓ RAG chunk retrieval & neural reranking against database passed');
  } finally {
    conn.close();
  }
}

function _snapshotEnv(keys) {
  const saved = {};
  for (const k of keys) saved[k] = process.env[k];
  return saved;
}

function _restoreEnv(saved) {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

async function testHfCacheReuseAndLoudFailure() {
  const vs = require('../src/vector_search');
  const vp = require('../src/vector_pipeline');
  const envKeys = [
    'HF_HOME',
    'HF_HUB_CACHE',
    'HUGGINGFACE_HUB_CACHE',
    'HF_HUB_OFFLINE',
    'TRANSFORMERS_OFFLINE',
    'KONOHA_SEMANTIC_SEARCH',
  ];
  const savedEnv = _snapshotEnv(envKeys);
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_hf_test_'));
  const populatedHfHome = path.join(tmpRoot, 'populated_hf');
  const emptyHfHome = path.join(tmpRoot, 'empty_hf');
  fs.mkdirSync(emptyHfHome, { recursive: true });

  try {
    const baseEmbedPipe = await vp.getEmbedPipeline();
    const baseRerankPipe = await vp.getRerankPipeline();
    assert.ok(baseEmbedPipe && baseEmbedPipe.cacheDir, 'Base embed pipeline should resolve native HF cacheDir');
    assert.ok(baseRerankPipe && baseRerankPipe.cacheDir, 'Base rerank pipeline should resolve native HF cacheDir');

    const hubDir = path.join(populatedHfHome, 'hub');
    for (const repo of [vs.EMBED_MODEL_REPO, vs.RERANK_MODEL_REPO]) {
      const srcRepoDir = path.join(baseEmbedPipe.cacheDir, ...repo.split('/'));
      const dstRepoDir = path.join(hubDir, ...repo.split('/'));
      assert.ok(fs.existsSync(srcRepoDir), `Native HF cache directory must exist for ${repo}`);
      fs.mkdirSync(path.dirname(dstRepoDir), { recursive: true });
      fs.cpSync(srcRepoDir, dstRepoDir, { recursive: true });
    }

    delete process.env.HF_HUB_CACHE;
    delete process.env.HUGGINGFACE_HUB_CACHE;
    process.env.HF_HOME = populatedHfHome;
    process.env.HF_HUB_OFFLINE = '1';
    await vs.resetPipelinesForTest();
    vs._EMBED_CACHE.clear();

    const hfEmbedPipe = await vp.getEmbedPipeline();
    assert.strictEqual(hfEmbedPipe.cacheDir, hubDir, 'HF_HOME must configure native Transformers.js hub cache');
    assert.strictEqual(hfEmbedPipe.offline, true, 'HF_HUB_OFFLINE=1 must enable offline local_files_only mode');

    const batchVecs = await vs.embedBatch(['dedup cache input', 'dedup cache input'], { batchSize: 1 });
    assert.strictEqual(batchVecs.length, 2);
    assert.strictEqual(batchVecs[0].length, 384);

    const offlineReranked = await vs.rerank('Kubernetes Helm', [
      'Helm manages Kubernetes charts and releases.',
      'Banana smoothie recipe with yogurt.',
    ]);
    assert.ok(offlineReranked[0].text.includes('Helm manages Kubernetes'));

    process.env.HF_HOME = emptyHfHome;
    process.env.HF_HUB_OFFLINE = '1';
    await vs.resetPipelinesForTest();
    vs._EMBED_CACHE.clear();

    await assert.rejects(
      () => vs.embedText('uncached missing model probe'),
      (err) => err && err.code === 'EMBEDDING_RUNTIME_UNAVAILABLE',
      'Missing offline HF cache must throw EmbeddingRuntimeUnavailableError'
    );
    await assert.rejects(
      () => vs.rerank('query', ['candidate passage']),
      (err) => err && err.code === 'EMBEDDING_RUNTIME_UNAVAILABLE',
      'Missing offline HF reranker cache must throw EmbeddingRuntimeUnavailableError'
    );

    _restoreEnv(savedEnv);
    process.env.KONOHA_SEMANTIC_SEARCH = '0';
    await vs.resetPipelinesForTest();
    const disabledStatus = vp.getRuntimeStatus();
    assert.strictEqual(disabledStatus.enabled, false);
    assert.strictEqual(disabledStatus.available, false);

    await assert.rejects(
      () => vs.embedBatch(['disabled mode check']),
      (err) => err && err.code === 'EMBEDDING_RUNTIME_UNAVAILABLE',
      'embedBatch with KONOHA_SEMANTIC_SEARCH=0 must throw EmbeddingRuntimeUnavailableError'
    );
    await assert.rejects(
      () => vs.rerank('query', ['candidate passage']),
      (err) => err && err.code === 'EMBEDDING_RUNTIME_UNAVAILABLE',
      'rerank with KONOHA_SEMANTIC_SEARCH=0 must throw EmbeddingRuntimeUnavailableError'
    );

    console.log('✓ HF_HOME cache reuse, offline mode, and loud EmbeddingRuntimeUnavailableError verified');
  } finally {
    _restoreEnv(savedEnv);
    await vs.resetPipelinesForTest();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

(async () => {
  try {
    console.log('Running test_bundled_models.test.js...');
    testNativeHuggingFaceContract();
    await testEmbeddingInferenceAndOrdering();
    await testRerankerInference();
    testRrfRerankingArchitecture();
    await testRagChunkRetrieval();
    await testHfCacheReuseAndLoudFailure();
    console.log('test_bundled_models.test.js passed cleanly.');
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
})();
