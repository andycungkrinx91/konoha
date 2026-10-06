#!/usr/bin/env node
'use strict';

/**
 * tests/test_qa_e2e_run.js — Verifies qa_e2e_run parsing, hard cap enforcement (<2000 chars),
 * failure extraction, ANSI stripping, and run_id presence.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { qaE2eRun } = require('../src/qa_tools');

console.log('Running test_qa_e2e_run.js...');

const tmpDir = path.join(os.tmpdir(), `konoha-qa-e2e-run-test-${Date.now()}`);
fs.mkdirSync(tmpDir, { recursive: true });

try {
  // Create a simulated project with a very large JSON report
  const fakeReport = {
    config: { testDir: 'tests/e2e' },
    suites: [
      {
        title: 'suite-1',
        file: 'tests/e2e/massive_test.spec.js',
        specs: []
      }
    ]
  };

  // Add 10 failing specs with long error messages to test capping
  for (let i = 1; i <= 10; i++) {
    fakeReport.suites[0].specs.push({
      title: `Critical defect scenario ${i} with long description`,
      file: 'tests/e2e/massive_test.spec.js',
      line: 40 + i,
      tests: [
        {
          status: 'unexpected',
          results: [
            {
              duration: 150,
              status: 'failed',
              error: {
                message: `\u001b[31mAssertionError: Expected true to be false on element #${i}\u001b[39m\n` +
                         `    at Object.test (/project/tests/massive.spec.js:${40 + i}:12)\n` +
                         `    very long stack trace line 1 ${'x'.repeat(200)}\n` +
                         `    very long stack trace line 2 ${'y'.repeat(200)}\n` +
                         `    very long stack trace line 3 ${'z'.repeat(200)}\n`
              },
              attachments: [
                { name: 'trace', path: `/tmp/trace-${i}.zip` },
                { name: 'screenshot', path: `/tmp/screenshot-${i}.png` }
              ]
            }
          ]
        }
      ]
    });
  }

  // Create mock playwright binary in project
  const binDir = path.join(tmpDir, 'node_modules', '.bin');
  fs.mkdirSync(binDir, { recursive: true });
  const mockPwScript = `#!/usr/bin/env node
const fs = require('fs');
const outName = process.env.PLAYWRIGHT_JSON_OUTPUT_NAME;
const report = ${JSON.stringify(fakeReport)};
if (outName) fs.writeFileSync(outName, JSON.stringify(report), 'utf8');
console.log(JSON.stringify(report));
process.exit(1);
`;
  const mockPwPath = path.join(binDir, 'playwright');
  fs.writeFileSync(mockPwPath, mockPwScript, { mode: 0o755 });

  // Run qaE2eRun on mock project
  const result = qaE2eRun({ project_path: tmpDir, mock_report: fakeReport });

  assert.strictEqual(result.status, 'failed');
  assert.ok(result.run_id && result.run_id.startsWith('qa-'), 'Must include valid run_id starting with qa-');
  assert.strictEqual(result.totals.failed, 10, 'Must record 10 failed tests');
  assert.strictEqual(result.failures.length, 5, 'Must cap displayed failures at 5');
  assert.strictEqual(result.truncated_failures, 5, 'Must record remaining truncated failures count');

  // Verify ANSI stripping
  for (const f of result.failures) {
    assert.ok(!f.error.includes('\u001b['), 'ANSI escape codes must be stripped from errors');
  }

  // Verify hard string cap under 2,000 characters
  const jsonOutput = JSON.stringify(result);
  assert.ok(jsonOutput.length <= 2000, `Output must stay under 2,000 characters (actual: ${jsonOutput.length})`);

  console.log('✓ test_qa_e2e_run.js passed cleanly.');
} finally {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) { /* cleanup */ }
}
