'use strict';

/**
 * tests/test_embed_diagnostics.js — every rule matches its trigger, and unknown
 * errors still get a diagnosis with an actionable remedy.
 *
 * The classifier is the only thing standing between "embedding silently
 * skipped" and a user who knows what to do, so each rule is pinned by the
 * message shape the real code throws.
 */

const assert = require('assert');
const { classifyEmbedFailure, formatEmbedFailure, RULES } = require('../src/embed_diagnostics');

const cases = [
  ['semantic_disabled', 'Semantic embedding requested while KONOHA_SEMANTIC_SEARCH is disabled.'],
  ['model_download', "Failed to load embed model 'onnx-community/granite': fetch failed"],
  ['dimension_mismatch', 'Embedding dimension mismatch: expected 384, got 768'],
  ['onnx_output', 'Unexpected ONNX output tensor from the Granite embedder'],
  ['runtime_missing', "Cannot find module 'onnxruntime-node'"],
  ['unknown', 'kaboom'],
];

for (const [id, message] of cases) {
  const failure = classifyEmbedFailure(new Error(message));
  assert.strictEqual(failure.id, id, `"${message}" must classify as ${id}`);
  assert.ok(failure.summary, `${id} needs a summary`);
  assert.ok(failure.causes.length > 0, `${id} needs at least one cause`);
  assert.ok(failure.fixes.length > 0, `${id} needs at least one fix`);
  assert.ok(
    failure.fixes.some((f) => f.includes('konoha doctor --fix')),
    `${id} must offer konoha doctor --fix`
  );

  const lines = formatEmbedFailure(failure);
  assert.ok(lines.some((l) => l.startsWith('Reason:')), `${id} must print a Reason line`);
  assert.ok(lines.some((l) => l.startsWith('How to resolve:')), `${id} must print remedies`);
  // Every rendered line must carry the original message at least once.
  assert.ok(lines.some((l) => l.includes(message)), `${id} must echo the underlying message`);
}

// Non-Error inputs must not throw: the caller catches whatever came out of onnx.
for (const weird of [null, undefined, 'plain string', { message: 'obj' }, 42]) {
  const failure = classifyEmbedFailure(weird);
  assert.ok(failure.id, 'classifier must always return an id');
  assert.ok(failure.fixes.length > 0, 'classifier must always return remedies');
}

// Rule ids are unique, so a future rule cannot silently shadow another.
const ids = RULES.map((r) => r.id);
assert.strictEqual(new Set(ids).size, ids.length, 'rule ids must be unique');

console.log('✓ embed diagnostics assertions passed');
