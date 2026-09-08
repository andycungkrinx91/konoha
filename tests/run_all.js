#!/usr/bin/env node
/**
 * Konoha comprehensive test suite runner (pure Node.js runtime).
 * Discovers and runs all JS test suites in the tests/ directory.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const testsDir = __dirname;
const files = fs.readdirSync(testsDir);
const includePython = process.argv.includes('--include-python');

const jsTests = files.filter(f =>
  (f.endsWith('.test.js') || f.startsWith('test_') || f.startsWith('verify_')) &&
  f.endsWith('.js') &&
  f !== 'run_all.js'
).sort();

const pyTests = includePython ? files.filter(f =>
  f.startsWith('test_') && f.endsWith('.py')
).sort() : [];

console.log('====================================================');
console.log('       KONOHA JAVASCRIPT TEST SUITE RUNNER          ');
console.log('====================================================');
console.log(`Discovered ${jsTests.length} JS test suites${includePython ? ` and ${pyTests.length} Python suites` : ''}.\n`);

let passed = 0;
let failed = 0;
const failList = [];

function runSuite(cmd, args, name) {
  process.stdout.write(`[SUITE] Running: ${name} ... `);
  const res = spawnSync(cmd, args, {
    encoding: 'utf-8',
    env: process.env,
    shell: process.platform === 'win32'
  });
  if (res.status === 0) {
    console.log('PASS');
    passed++;
  } else {
    console.log(`FAIL (exit code ${res.status})`);
    if (res.stdout) console.log(res.stdout);
    if (res.stderr) console.error(res.stderr);
    failed++;
    failList.push(name);
  }
}

for (const f of jsTests) {
  runSuite(process.execPath, [path.join(testsDir, f)], f);
}

if (includePython) {
  for (const f of pyTests) {
    const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
    runSuite(pyCmd, [path.join(testsDir, f)], f);
  }
}

console.log('\n====================================================');
console.log(`Test Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.error(`Failed suites: ${failList.join(', ')}`);
  process.exit(1);
} else {
  console.log('All test suites completed successfully!');
  process.exit(0);
}
