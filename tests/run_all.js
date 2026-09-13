#!/usr/bin/env node
/**
 * Konoha comprehensive test suite runner (pure Node.js runtime).
 * Discovers and runs all JS test suites in the tests/ directory.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const testsDir = __dirname;
const files = fs.readdirSync(testsDir);
const includePython = process.argv.includes('--include-python');
const isParallel = process.argv.includes('--parallel') || process.env.KONOHA_TEST_PARALLEL === '1';
const concurrencyArg = process.argv.find(a => a.startsWith('--concurrency='));
const concurrency = concurrencyArg ? parseInt(concurrencyArg.split('=')[1], 10) : 4;
const filterArg = process.argv.slice(2).find(a => !a.startsWith('--'));

const jsTests = files.filter(f =>
  (f.endsWith('.test.js') || f.startsWith('test_') || f.startsWith('verify_')) &&
  f.endsWith('.js') &&
  f !== 'run_all.js' &&
  (!filterArg || f.toLowerCase().includes(filterArg.toLowerCase()))
).sort();

const pyTests = includePython ? files.filter(f =>
  f.startsWith('test_') && f.endsWith('.py') &&
  (!filterArg || f.toLowerCase().includes(filterArg.toLowerCase()))
).sort() : [];

console.log('====================================================');
console.log('       KONOHA JAVASCRIPT TEST SUITE RUNNER          ');
console.log('====================================================');
console.log(`Discovered ${jsTests.length} JS test suites${includePython ? ` and ${pyTests.length} Python suites` : ''} (${isParallel ? `parallel mode, concurrency ${concurrency}` : 'sequential mode'}).\n`);

let passed = 0;
let failed = 0;
const failList = [];
const startTime = Date.now();

function runSuiteSync(cmd, args, name) {
  process.stdout.write(`[SUITE] Running: ${name} ... `);
  const start = Date.now();
  const res = spawnSync(cmd, args, {
    encoding: 'utf-8',
    env: process.env,
    shell: process.platform === 'win32'
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  if (res.status === 0) {
    console.log(`PASS (${elapsed}s)`);
    passed++;
  } else {
    console.log(`FAIL (exit code ${res.status})`);
    if (res.stdout) console.log(res.stdout);
    if (res.stderr) console.error(res.stderr);
    failed++;
    failList.push(name);
  }
}

function runSuiteAsync(cmd, args, name) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(cmd, args, {
      env: process.env,
      shell: process.platform === 'win32'
    });
    let out = '';
    let err = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        err += `\n[TIMEOUT] Suite ${name} timed out after 45s and was terminated.`;
        try { child.kill('SIGKILL'); } catch (_) {}
      }
    }, 45000);

    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('close', (status) => {
      settled = true;
      clearTimeout(timer);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      if (status === 0) {
        console.log(`[SUITE] Running: ${name} ... PASS (${elapsed}s)`);
        passed++;
      } else {
        console.log(`[SUITE] Running: ${name} ... FAIL (exit code ${status})`);
        if (out) console.log(out);
        if (err) console.error(err);
        failed++;
        failList.push(name);
      }
      resolve();
    });
  });
}

async function runAllParallel() {
  // Attribution tests access shared client user-directory logs; isolate them to sequential execution
  const isAttribution = f => f.includes('_attribution.');
  const parallelPool = jsTests.filter(f => !isAttribution(f));
  const sequentialPool = jsTests.filter(f => isAttribution(f));

  let index = 0;
  async function worker() {
    while (index < parallelPool.length) {
      const f = parallelPool[index++];
      await runSuiteAsync(process.execPath, [path.join(testsDir, f)], f);
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  if (sequentialPool.length > 0) {
    for (const f of sequentialPool) {
      runSuiteSync(process.execPath, [path.join(testsDir, f)], f);
    }
  }

  if (includePython) {
    for (const f of pyTests) {
      const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
      runSuiteSync(pyCmd, [path.join(testsDir, f)], f);
    }
  }

  finish();
}

function finish() {
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n====================================================');
  console.log(`Test Summary: ${passed} passed, ${failed} failed in ${totalDuration}s.`);
  if (failed > 0) {
    console.error(`Failed suites: ${failList.join(', ')}`);
    process.exit(1);
  } else {
    console.log('All test suites completed successfully!');
    process.exit(0);
  }
}

if (isParallel) {
  runAllParallel();
} else {
  for (const f of jsTests) {
    runSuiteSync(process.execPath, [path.join(testsDir, f)], f);
  }
  if (includePython) {
    for (const f of pyTests) {
      const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
      runSuiteSync(pyCmd, [path.join(testsDir, f)], f);
    }
  }
  finish();
}
