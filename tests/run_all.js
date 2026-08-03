#!/usr/bin/env node
/**
 * Konoha comprehensive test suite runner (C10).
 * Discovers and runs all JS and Python tests in the tests/ directory.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const testsDir = __dirname;
const files = fs.readdirSync(testsDir);

const jsTests = files.filter(f =>
  (f.endsWith('.test.js') || f.startsWith('test_') || f.startsWith('verify_')) &&
  f.endsWith('.js') &&
  f !== 'run_all.js'
);

const pyTests = files.filter(f =>
  f.startsWith('test_') && f.endsWith('.py')
);

console.log('====================================================');
console.log('               KONOHA TEST SUITE RUNNER             ');
console.log('====================================================');
console.log(`Discovered ${jsTests.length} JS suites and ${pyTests.length} Python suites.\n`);

let passed = 0;
let failed = 0;
const failList = [];

function runSuite(cmd, args, name) {
  console.log(`[SUITE] Running: ${name}`);
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    encoding: 'utf-8',
    shell: process.platform === 'win32'
  });
  if (res.status === 0) {
    console.log(`[PASS] ${name}\n`);
    passed++;
  } else {
    console.error(`[FAIL] ${name} (exit code ${res.status})\n`);
    failed++;
    failList.push(name);
  }
}

for (const f of jsTests) {
  runSuite(process.execPath, [path.join(testsDir, f)], f);
}

for (const f of pyTests) {
  const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
  runSuite(pyCmd, [path.join(testsDir, f)], f);
}

console.log('====================================================');
console.log(`Test Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.error(`Failed suites: ${failList.join(', ')}`);
  process.exit(1);
} else {
  console.log('All test suites completed successfully!');
  process.exit(0);
}
