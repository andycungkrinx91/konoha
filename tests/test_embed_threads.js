'use strict';

/**
 * The thread rule is pure arithmetic over a topology reading, so it is tested
 * without an ONNX session. What matters: a 4-vCPU cloud instance without SMT
 * must get 4 threads, not 2, and no host may be oversubscribed past its
 * logical CPU count.
 */

const assert = require('node:assert');
const { threadCountFor, THREAD_CEILING } = require('../src/embed_threads');

// --- 1. SMT parts get one thread per physical core ---
assert.strictEqual(threadCountFor(16, { siblings: 16, cores: 8 }), 8, '16 logical / 8 cores -> 8');
assert.strictEqual(threadCountFor(8, { siblings: 8, cores: 4 }), 4, '8 logical / 4 cores -> 4');
assert.strictEqual(threadCountFor(32, { siblings: 32, cores: 16 }), 16, '32 logical / 16 cores -> 16');
console.log('  ✓ SMT hosts get one thread per physical core');

// --- 2. No-SMT hosts get every logical CPU (the cloud CI case) ---
assert.strictEqual(threadCountFor(4, { siblings: 4, cores: 4 }), 4, 'a 4-vCPU non-SMT VM must get 4');
assert.strictEqual(threadCountFor(2, { siblings: 2, cores: 2 }), 2, 'a 2-vCPU non-SMT VM must get 2');
console.log('  ✓ non-SMT hosts are not halved');

// --- 3. Unknown topology falls back to the measured ceiling ---
assert.strictEqual(threadCountFor(16, null), THREAD_CEILING, 'unknown topology caps at the ceiling');
assert.strictEqual(threadCountFor(4, null), 4, 'a small host under the ceiling keeps all its CPUs');
assert.strictEqual(threadCountFor(64, null), THREAD_CEILING, 'a huge host is capped');
console.log(`  ✓ unknown topology caps at ${THREAD_CEILING}`);

// --- 4. Degenerate input never yields 0 threads ---
assert.strictEqual(threadCountFor(0, null), 1);
assert.strictEqual(threadCountFor(1, { siblings: 1, cores: 1 }), 1);
assert.strictEqual(threadCountFor(NaN, null), 1);
console.log('  ✓ degenerate input clamps to 1');

// --- 5. Never oversubscribed ---
for (const logical of [1, 2, 4, 8, 16, 32, 64, 128]) {
  for (const topology of [null, { siblings: logical, cores: logical }, { siblings: logical, cores: logical / 2 }]) {
    const n = threadCountFor(logical, topology);
    assert.ok(n >= 1 && n <= logical, `threads ${n} must fit in ${logical} logical CPUs`);
  }
}
console.log('  ✓ thread count never exceeds the logical CPU count');

console.log('\n✓ embed thread rule assertions passed');
