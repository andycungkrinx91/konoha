'use strict';

/**
 * Batch planning is pure, so it gets a fast deterministic test: no model, no
 * ONNX session. What it pins is the policy that made embedding ~2x faster --
 * length-sorted input must produce class-homogeneous batches, and padding waste
 * must stay bounded at 2x.
 */

const assert = require('node:assert');
const { planEmbedBatches, EMBED_CHARS_PER_TOKEN } = require('../src/embed_batching');

const maxLength = 512;
const miss = (chars) => ({ norm: 'x'.repeat(chars) });
const tokens = (m) => Math.min(Math.max(Math.ceil(m.norm.length / EMBED_CHARS_PER_TOKEN), 1), maxLength);

// --- 1. Short chunks batch deep ---
const short = Array.from({ length: 512 }, () => miss(400)); // ~100 tokens
const shortBatches = planEmbedBatches(short, 64, maxLength);
assert.ok(shortBatches.length <= 512 / 16,
  `short chunks must batch at least 16 deep: got ${shortBatches.length} batches for 512`);
assert.ok(shortBatches.every((b) => b.length <= 64), 'item cap must hold');
console.log(`  ✓ 512 short chunks -> ${shortBatches.length} batches (${(512 / shortBatches.length).toFixed(1)}/batch)`);

// --- 2. Ceiling-width chunks never exceed the item cap and stay one class ---
const long = Array.from({ length: 64 }, () => miss(maxLength * EMBED_CHARS_PER_TOKEN));
const longBatches = planEmbedBatches(long, 64, maxLength);
assert.ok(longBatches.every((b) => b.length <= 64), 'item cap must hold at the token ceiling');
assert.strictEqual(longBatches.flat().length, 64, 'every ceiling-width chunk must be placed');
console.log(`  ✓ 64 ceiling-width chunks -> ${longBatches.length} batches of ${longBatches[0].length}`);

// --- 3. Sorted input keeps padding waste bounded ---
// Each item is computed at its batch's padded width, so the invariant is
// `paddedWidth / itemTokens <= 2`.
const mixed = [200, 800, 2000, 500, 1400, 300, 1800, 900].map(miss).sort((a, b) => a.norm.length - b.norm.length);
const mixedBatches = planEmbedBatches(mixed, 64, maxLength);
assert.strictEqual(mixedBatches.flat().length, mixed.length, 'every input must appear exactly once');
let worstWaste = 1;
for (const b of mixedBatches) {
  const padded = Math.max(...b.map(tokens));
  for (const m of b) worstWaste = Math.max(worstWaste, padded / tokens(m));
}
assert.ok(worstWaste <= 2, `padding waste ${worstWaste.toFixed(2)}x must stay within the 2x class bound`);
console.log(`  ✓ ${mixedBatches.length} batches, worst padding waste ${worstWaste.toFixed(2)}x, every input placed once`);

// --- 4. Degenerate inputs ---
assert.deepStrictEqual(planEmbedBatches([], 64, maxLength), [], 'no misses -> no batches');
const oversize = planEmbedBatches([miss(maxLength * EMBED_CHARS_PER_TOKEN * 4)], 64, maxLength);
assert.strictEqual(oversize.length, 1, 'an over-length chunk must still be batched (truncation happens later)');
assert.strictEqual(planEmbedBatches([miss(0)], 64, maxLength)[0].length, 1, 'empty text still batches');
console.log('  ✓ degenerate inputs handled');

// --- 5. The shipped depth is pinned, not just the planner ---
// One sequence per ONNX call is 1.65x faster end to end than 16, and nothing
// else in the suite would notice if a tidy-up reverted the constant.
{
  const src = require('node:fs').readFileSync(require.resolve('../src/vector_pipeline'), 'utf8');
  const m = src.match(/DEFAULT_EMBED_BATCH_SIZE\s*=\s*(\d+)/);
  assert.ok(m, 'DEFAULT_EMBED_BATCH_SIZE must stay a literal constant');
  assert.strictEqual(Number(m[1]), 1, `embed batch depth must stay 1, found ${m[1]}`);
  const r = src.match(/DEFAULT_RERANK_BATCH_SIZE\s*=\s*(\d+)/);
  assert.ok(r && Number(r[1]) > 1, 'rerank keeps its own deeper batch');
  console.log(`  ✓ shipped embed depth pinned at ${m[1]}, rerank at ${r[1]}`);
}

console.log('\n✓ embed batching plan assertions passed');
