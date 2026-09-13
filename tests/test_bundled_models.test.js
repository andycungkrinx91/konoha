#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function testBundledModelsPresenceAndSize() {
  const repoRoot = path.resolve(__dirname, '..');
  const modelDir = path.join(repoRoot, 'assets', 'models', 'onnx-community', 'granite-embedding-97m-multilingual-r2-ONNX');

  assert.ok(fs.existsSync(modelDir), 'assets/models/onnx-community/granite-embedding-97m-multilingual-r2-ONNX must exist');

  const requiredFiles = [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/model_quantized.onnx'
  ];

  for (const rel of requiredFiles) {
    const fullPath = path.join(modelDir, rel);
    assert.ok(fs.existsSync(fullPath), `Required bundled model file missing: ${rel}`);
    const stat = fs.statSync(fullPath);
    assert.ok(stat.size > 0, `File ${rel} must not be empty`);
    // Assert strictly under GitHub 100MB file limit
    const sizeMb = stat.size / (1024 * 1024);
    assert.ok(sizeMb < 100, `File ${rel} (${sizeMb.toFixed(2)} MB) must be strictly under 100 MB for GitHub push safety`);
  }

  console.log('✓ Bundled embedding model presence and <100MB size constraints passed');
}

async function testBundledRerankerPresenceAndSize() {
  const repoRoot = path.resolve(__dirname, '..');
  const rerankerDir = path.join(repoRoot, 'assets', 'models', 'Xenova', 'ms-marco-MiniLM-L-6-v2');

  assert.ok(fs.existsSync(rerankerDir), 'assets/models/Xenova/ms-marco-MiniLM-L-6-v2 must exist');

  const requiredFiles = [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/model_quantized.onnx'
  ];

  for (const rel of requiredFiles) {
    const fullPath = path.join(rerankerDir, rel);
    assert.ok(fs.existsSync(fullPath), `Required bundled reranker file missing: ${rel}`);
    const stat = fs.statSync(fullPath);
    assert.ok(stat.size > 0, `File ${rel} must not be empty`);
    const sizeMb = stat.size / (1024 * 1024);
    assert.ok(sizeMb < 100, `File ${rel} (${sizeMb.toFixed(2)} MB) must be strictly under 100 MB for GitHub push safety`);
  }

  console.log('✓ Bundled neural reranker presence and <100MB size constraints passed');
}

async function testOfflineEmbeddingInference() {
  const vs = require('../src/vector_search');
  const vec = await vs.embedText('Testing offline embedding inference from bundled models');

  assert.ok(vec instanceof Float32Array, 'embedText should return Float32Array');
  assert.strictEqual(vec.length, 384, 'IBM Granite embedding vector dimension must be 384');

  // Verify L2 normalized: sum of squares ≈ 1.0
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) sumSq += vec[i] * vec[i];
  assert.ok(Math.abs(sumSq - 1.0) < 1e-4, 'Embedding vector must be L2 normalized');

  console.log('✓ Offline embedding inference from bundled models passed (384-dim, normalized)');
}

async function testOfflineRerankerInference() {
  const vs = require('../src/vector_search');
  const query = "Deploying Helm charts on Kubernetes";
  const passages = [
    "Helm is the official package manager for Kubernetes applications.",
    "The recipe for sourdough bread requires fermentation.",
    "Kubernetes kubectl CLI interacts with cluster control plane."
  ];

  const reranked = await vs.rerank(query, passages);
  assert.ok(Array.isArray(reranked), 'rerank should return an array');
  assert.strictEqual(reranked.length, 3, 'rerank should return all evaluated passages');
  assert.strictEqual(reranked[0].rank, 1, 'Top item has rank 1');
  assert.ok(typeof reranked[0].rerank_score === 'number', 'rerank_score must be a number');
  // First item must be the Helm passage
  assert.ok(reranked[0].text.includes('Helm is the official package manager'), 'Reranker must rank most relevant passage highest');
  assert.ok(reranked[0].rerank_score > reranked[1].rerank_score, 'Top passage must score higher than lower passages');

  console.log('✓ Offline neural cross-encoder reranking passed (MS MARCO MiniLM)');
}

async function testRrfRerankingArchitecture() {
  const vs = require('../src/vector_search');
  const ranks1 = ['skill-a', 'skill-b', 'skill-c'];
  const ranks2 = ['skill-b', 'skill-a', 'skill-d'];

  const fused = vs.reciprocalRankFusion([ranks1, ranks2], 60);
  assert.ok(Array.isArray(fused), 'reciprocalRankFusion should return array of [name, score]');
  assert.strictEqual(fused[0][0], 'skill-a', 'Deterministic RRF top result');

  console.log('✓ RRF rank fusion layer verified (k=60)');
}

async function testRagChunkRetrieval() {
  const Database = require('better-sqlite3');
  const { DB_PATH } = require('../src/db');
  const vs = require('../src/vector_search');

  if (fs.existsSync(DB_PATH)) {
    const conn = new Database(DB_PATH, { readonly: true });
    try {
      const ragResults = await vs.searchChunksRAG(conn, "Docker multi-stage container build", { topK: 2, candidateK: 10 });
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
}

(async () => {
  try {
    console.log('Running test_bundled_models.test.js...');
    await testBundledModelsPresenceAndSize();
    await testBundledRerankerPresenceAndSize();
    await testOfflineEmbeddingInference();
    await testOfflineRerankerInference();
    await testRrfRerankingArchitecture();
    await testRagChunkRetrieval();
    console.log('test_bundled_models.test.js passed cleanly.');
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
})();
