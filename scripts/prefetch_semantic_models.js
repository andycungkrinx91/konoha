#!/usr/bin/env node
'use strict';

/**
 * Warms the Granite embedding and MiniLM rerank artifacts the semantic tier needs.
 *
 * test_code_intel_search.js asserts that tier is `available`, which is only true
 * when the models are already local. Downloading them from inside a shard turned
 * a Hugging Face hiccup into an unrelated red suite, so CI warms the cache in
 * this named step first: a network failure here names itself.
 */

const vp = require('../src/vector_pipeline');

// Every shard runs this step, so a concurrent 429 from the Hub must not redden
// the whole matrix: a warm cache makes retries free, a miss gets three tries.
async function withRetry(fn, label) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= 3) throw new Error(`${label} (attempt ${attempt}): ${err.message}`);
      console.log(`  ${label} attempt ${attempt} failed (${err.message}); retrying`);
      await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }
}

(async () => {
  const before = vp.getRuntimeStatus();
  console.log(`semantic runtime: ${before.semanticStatus} (${before.reason}), cache=${before.cacheDir}`);
  await withRetry(() => vp.getEmbedPipeline(), 'embed model');
  await withRetry(() => vp.getRerankPipeline(), 'rerank model');
  const after = vp.getRuntimeStatus();
  console.log(`semantic models ready: embed=${after.embedModel.repo} rerank=${after.rerankModel.repo}`);
})().catch((err) => {
  console.error(`semantic model prefetch failed: ${err.message}`);
  process.exit(1);
});
