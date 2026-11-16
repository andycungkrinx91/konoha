'use strict';

/**
 * src/embed_batching.js — pure text normalization and ONNX batch planning.
 *
 * Kept out of `vector_pipeline.js` because it is pure computation: no model, no
 * session, no tensors. That makes the batching policy testable on its own.
 */

const crypto = require('node:crypto');

// Rough chars-per-token for source code, used only to size embed batches.
const EMBED_CHARS_PER_TOKEN = 4;

/**
 * Normalizes whitespace for deterministic embedding deduplication and cache keys.
 * @param {string} text
 * @returns {string}
 */
function normalizeForEmbedding(text) {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

/**
 * Computes a SHA-256 hex digest of normalized text.
 * @param {string} normText
 * @returns {string}
 */
function hashNormalizedText(normText) {
  return crypto.createHash('sha256').update(normText, 'utf8').digest('hex');
}

/**
 * Builds a model-scoped in-memory cache key for an embedding hash.
 * @param {string} textHash
 * @param {string} modelRepo
 * @returns {string}
 */
function makeEmbedCacheKey(textHash, modelRepo) {
  return `${modelRepo}:${textHash}`;
}

/**
 * Groups length-sorted misses into batches.
 *
 * `padding: true` computes every sequence at the width of the widest one in its
 * batch, so mixing a 60-token chunk with a 500-token chunk burns 8x the FLOPs on
 * the small one. Grouping into power-of-two width classes caps that waste at 2x
 * by construction; measured 2.08x end-to-end on live chunks. Widening the batch
 * itself was measured *slower* (0.93x at 64 items), so the item cap stays put.
 *
 * Input must be sorted ascending by `norm.length`.
 * @param {Array<{norm: string}>} ordered
 * @param {number} maxItems hard item cap per ONNX call
 * @param {number} maxLength token ceiling for one sequence
 * @returns {Array<Array<object>>}
 */
function planEmbedBatches(ordered, maxItems, maxLength) {
  const toTokens = (chars) =>
    Math.min(Math.max(Math.ceil(chars / EMBED_CHARS_PER_TOKEN), 1), maxLength);
  const widthClass = (tokens) => 2 ** Math.ceil(Math.log2(Math.max(tokens, 1)));

  const batches = [];
  let current = [];
  let currentClass = 1;

  for (const miss of ordered) {
    const cls = widthClass(toTokens(miss.norm.length));
    if (current.length > 0 && (cls > currentClass || current.length >= maxItems)) {
      batches.push(current);
      current = [];
    }
    if (current.length === 0) currentClass = cls;
    current.push(miss);
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

module.exports = {
  EMBED_CHARS_PER_TOKEN,
  normalizeForEmbedding,
  hashNormalizedText,
  makeEmbedCacheKey,
  planEmbedBatches,
};
