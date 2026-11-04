#!/usr/bin/env node
'use strict';

// Fixture for tests/test_rtk_exec_policy.js: enough repetitive output that RTK
// has something to compress, plus an opt-in failure code to prove exit fidelity.

const failArg = process.argv.find((arg) => arg.startsWith('--fail='));
const code = failArg ? Number(failArg.split('=')[1]) : 0;

for (let i = 0; i < 400; i += 1) {
  console.log(`noisy-fixture-line-${i} \u2713 assertion satisfied (repetitive suite chatter)`);
}

if (code) {
  console.error(`noisy fixture failing with exit ${code}`);
  process.exit(code);
}

console.log('noisy fixture complete');
