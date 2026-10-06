#!/usr/bin/env node
'use strict';

/**
 * tests/test_qa_housekeeping.js — Comprehensive tests for QA output redirect,
 * managed .gitignore blocks, evidence copying, retention, and cap-budgeted summaries.
 * All tests use isolated temporary directories and pass without a browser installed.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  qaE2eRun,
  ensureQaGitignore,
  getProjectOutputDirs,
  copyFailureEvidence,
  runQaRetention
} = require('../src/qa_tools');

console.log('Running test_qa_housekeeping.js...');

const testRoot = path.join(os.tmpdir(), `konoha-qa-housekeeping-${Date.now()}`);
fs.mkdirSync(testRoot, { recursive: true });

try {
  // =========================================================================
  // 1. Managed .gitignore Block Tests
  // =========================================================================
  console.log('  Testing managed .gitignore block...');

  // 1.1 Non-git folder: should skip and create no file
  const nonGitDir = path.join(testRoot, 'non-git-dir');
  fs.mkdirSync(nonGitDir, { recursive: true });
  const nonGitRes = ensureQaGitignore(nonGitDir);
  assert.strictEqual(nonGitRes.status, 'skipped');
  assert.strictEqual(nonGitRes.reason, 'not a git project');
  assert.strictEqual(fs.existsSync(path.join(nonGitDir, '.gitignore')), false);

  // 1.2 Git project without .gitignore: creates file with managed block
  const gitProject = path.join(testRoot, 'git-project');
  fs.mkdirSync(path.join(gitProject, '.git'), { recursive: true });
  const gitRes1 = ensureQaGitignore(gitProject);
  assert.strictEqual(gitRes1.status, 'added');
  assert.strictEqual(gitRes1.entries_added, 4);

  const gitignorePath = path.join(gitProject, '.gitignore');
  assert.ok(fs.existsSync(gitignorePath));
  const createdContent = fs.readFileSync(gitignorePath, 'utf8');
  assert.ok(createdContent.includes('# KONOHA-QA-START'));
  assert.ok(createdContent.includes('test-results/'));
  assert.ok(createdContent.includes('playwright-report/'));
  assert.ok(createdContent.includes('blob-report/'));
  assert.ok(createdContent.includes('playwright/.cache/'));
  assert.ok(createdContent.includes('# KONOHA-QA-END'));
  // Invariant: Never ignore deliverables
  assert.ok(!createdContent.includes('e2e'));
  assert.ok(!createdContent.includes('flows'));

  // 1.3 Idempotency: Second run changes nothing
  const gitRes2 = ensureQaGitignore(gitProject);
  assert.strictEqual(gitRes2.status, 'unchanged');
  assert.strictEqual(gitRes2.entries_added, 0);

  // 1.4 Existing user lines outside block: byte-for-byte unchanged
  const gitProjectWithUserLines = path.join(testRoot, 'git-user-lines');
  fs.mkdirSync(path.join(gitProjectWithUserLines, '.git'), { recursive: true });
  const customUserHeader = '# My custom ignore rules\nnode_modules/\n.env\n*.log\n';
  fs.writeFileSync(path.join(gitProjectWithUserLines, '.gitignore'), customUserHeader, 'utf8');
  
  ensureQaGitignore(gitProjectWithUserLines);
  const updatedUserGitignore = fs.readFileSync(path.join(gitProjectWithUserLines, '.gitignore'), 'utf8');
  assert.ok(updatedUserGitignore.startsWith(customUserHeader.trimEnd()));
  assert.ok(updatedUserGitignore.includes('# KONOHA-QA-START'));

  // 1.5 De-duplication: entry already listed outside block is not duplicated
  const gitProjectDuplicate = path.join(testRoot, 'git-dup');
  fs.mkdirSync(path.join(gitProjectDuplicate, '.git'), { recursive: true });
  fs.writeFileSync(path.join(gitProjectDuplicate, '.gitignore'), 'test-results/\nnode_modules/\n', 'utf8');
  const dupRes = ensureQaGitignore(gitProjectDuplicate);
  assert.strictEqual(dupRes.status, 'added');
  assert.strictEqual(dupRes.entries_added, 3); // 4 - 1 (test-results/ already outside)
  const dupContent = fs.readFileSync(path.join(gitProjectDuplicate, '.gitignore'), 'utf8');
  const blockMatches = dupContent.match(/test-results\//g);
  assert.strictEqual(blockMatches.length, 1, 'test-results/ should only appear once (outside the block)');

  // 1.6 CRLF preservation and missing trailing newline
  const gitProjectCrlf = path.join(testRoot, 'git-crlf');
  fs.mkdirSync(path.join(gitProjectCrlf, '.git'), { recursive: true });
  fs.writeFileSync(path.join(gitProjectCrlf, '.gitignore'), 'dist/\r\nbuild/', 'utf8'); // No trailing newline, CRLF
  ensureQaGitignore(gitProjectCrlf);
  const crlfContent = fs.readFileSync(path.join(gitProjectCrlf, '.gitignore'), 'utf8');
  assert.ok(crlfContent.includes('\r\n'));
  assert.ok(!crlfContent.replace(/\r\n/g, '').includes('\n')); // Strictly CRLF
  assert.ok(crlfContent.endsWith('\r\n'));

  // 1.7 Monorepo subfolder: .git in parent folder, .gitignore written at project_path
  const monorepoRoot = path.join(testRoot, 'monorepo');
  const monorepoSub = path.join(monorepoRoot, 'packages', 'web');
  fs.mkdirSync(path.join(monorepoRoot, '.git'), { recursive: true });
  fs.mkdirSync(monorepoSub, { recursive: true });
  const monoRes = ensureQaGitignore(monorepoSub);
  assert.strictEqual(monoRes.status, 'added');
  assert.ok(fs.existsSync(path.join(monorepoSub, '.gitignore')));

  // 1.8 Opt-out: KONOHA_QA_GITIGNORE=0 writes nothing
  const gitProjectOptOut = path.join(testRoot, 'git-optout');
  fs.mkdirSync(path.join(gitProjectOptOut, '.git'), { recursive: true });
  process.env.KONOHA_QA_GITIGNORE = '0';
  const optOutRes = ensureQaGitignore(gitProjectOptOut);
  delete process.env.KONOHA_QA_GITIGNORE;
  assert.strictEqual(optOutRes.status, 'skipped');
  assert.strictEqual(optOutRes.reason, 'opt-out');
  assert.strictEqual(fs.existsSync(path.join(gitProjectOptOut, '.gitignore')), false);

  // =========================================================================
  // 2. Output Redirection & Evidence Copying Tests
  // =========================================================================
  console.log('  Testing output redirection & failure evidence copying...');

  // 2.1 getProjectOutputDirs creates directory under ~/.konoha/tmp/qa/projects/<hash>/artifacts
  const outDirs = getProjectOutputDirs(gitProject);
  assert.ok(fs.existsSync(outDirs.artifactsDir));
  assert.ok(outDirs.artifactsDir.includes('.konoha/tmp/qa/projects/'));
  assert.ok(outDirs.artifactsDir.endsWith('artifacts'));

  // 2.2 Failure evidence copying
  const runTmpDir = path.join(testRoot, 'qa-run-evidence');
  fs.mkdirSync(runTmpDir, { recursive: true });
  const sourceTrace = path.join(testRoot, 'source-trace.zip');
  const sourceShot = path.join(testRoot, 'source-shot.png');
  fs.writeFileSync(sourceTrace, 'fake-trace-content');
  fs.writeFileSync(sourceShot, 'fake-png-content');

  const failures = [
    { title: 'Test 1', trace: sourceTrace, screenshot: sourceShot }
  ];
  copyFailureEvidence(failures, runTmpDir);

  // Verify paths in failures are updated and files exist in runTmpDir
  assert.notStrictEqual(failures[0].trace, sourceTrace);
  assert.notStrictEqual(failures[0].screenshot, sourceShot);
  assert.ok(failures[0].trace.startsWith(runTmpDir));
  assert.ok(failures[0].screenshot.startsWith(runTmpDir));
  assert.ok(fs.existsSync(failures[0].trace));
  assert.ok(fs.existsSync(failures[0].screenshot));
  assert.strictEqual(fs.readFileSync(failures[0].trace, 'utf8'), 'fake-trace-content');

  // =========================================================================
  // 3. Retention Tests
  // =========================================================================
  console.log('  Testing retention policy...');

  const mockQaBase = path.join(testRoot, 'mock-qa-base');
  fs.mkdirSync(mockQaBase, { recursive: true });

  // Create state/ and projects/ (must never be touched)
  fs.mkdirSync(path.join(mockQaBase, 'state'), { recursive: true });
  fs.mkdirSync(path.join(mockQaBase, 'projects', 'hash1'), { recursive: true });
  fs.mkdirSync(path.join(mockQaBase, 'other-non-run-folder'), { recursive: true });

  // Create 10 mock run folders with staggered timestamps
  const runIds = [];
  const now = Date.now();
  for (let i = 1; i <= 10; i++) {
    const id = `qa-${now - (10 - i) * 10000}-abc00${i}`;
    runIds.push(id);
    const dir = path.join(mockQaBase, id);
    fs.mkdirSync(dir, { recursive: true });
    // Write a dummy report
    fs.writeFileSync(path.join(dir, 'report.json'), '{}', 'utf8');
    // Set mtime
    const mtime = new Date(now - (10 - i) * 10000);
    fs.utimesSync(dir, mtime, mtime);
  }

  // 3.1 Keep newest 5: should prune 5 oldest, keep newest 5
  const currentRunId = runIds[runIds.length - 1]; // newest run
  const retRes1 = runQaRetention(currentRunId, {
    baseDir: mockQaBase,
    maxCount: 5,
    protectedRunIds: []
  });

  assert.strictEqual(retRes1.pruned, 5);
  assert.strictEqual(retRes1.kept, 5);

  // Verify state/ and projects/ are untouched
  assert.ok(fs.existsSync(path.join(mockQaBase, 'state')));
  assert.ok(fs.existsSync(path.join(mockQaBase, 'projects', 'hash1')));
  assert.ok(fs.existsSync(path.join(mockQaBase, 'other-non-run-folder')));
  // Verify current run was kept
  assert.ok(fs.existsSync(path.join(mockQaBase, currentRunId)));

  // 3.2 Protected run on open task is NEVER pruned
  const oldestRemaining = runIds[5]; // currently the oldest of the 5 remaining
  assert.ok(fs.existsSync(path.join(mockQaBase, oldestRemaining)));

  // Add 3 new runs
  for (let i = 11; i <= 13; i++) {
    const id = `qa-${now + i * 10000}-abc0${i}`;
    const dir = path.join(mockQaBase, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'report.json'), '{}', 'utf8');
    const mtime = new Date(now + i * 10000);
    fs.utimesSync(dir, mtime, mtime);
  }

  // Now run retention with maxCount: 3, but protecting oldestRemaining
  const retRes2 = runQaRetention(`qa-${now + 130000}-abc013`, {
    baseDir: mockQaBase,
    maxCount: 3,
    protectedRunIds: [oldestRemaining]
  });

  // Oldest remaining run was protected, so it MUST still exist
  assert.ok(fs.existsSync(path.join(mockQaBase, oldestRemaining)), 'Protected run must survive retention prune');

  // 3.3 Evidence lookup unavailable fallback: delete nothing younger than 7 days
  const fallbackQaBase = path.join(testRoot, 'fallback-qa-base');
  fs.mkdirSync(fallbackQaBase, { recursive: true });
  
  // 3 runs younger than 7 days, 2 runs older than 7 days (e.g. 10 days old)
  const recentRun = `qa-${now - 1000}-ab0001`;
  const oldRun = `qa-${now - 10 * 24 * 60 * 60 * 1000}-de0001`;
  fs.mkdirSync(path.join(fallbackQaBase, recentRun), { recursive: true });
  fs.mkdirSync(path.join(fallbackQaBase, oldRun), { recursive: true });
  const oldDate = new Date(now - 10 * 24 * 60 * 60 * 1000);
  fs.utimesSync(path.join(fallbackQaBase, oldRun), oldDate, oldDate);

  const fallbackRes = runQaRetention(recentRun, {
    baseDir: fallbackQaBase,
    maxCount: 1,
    lookupAvailable: false,
    now
  });

  assert.strictEqual(fallbackRes.lookup_available, false);
  // Recent run (< 7 days) MUST NOT be deleted
  assert.ok(fs.existsSync(path.join(fallbackQaBase, recentRun)));
  // Old run (> 7 days and beyond maxCount=1) is pruned
  assert.ok(!fs.existsSync(path.join(fallbackQaBase, oldRun)));

  // =========================================================================
  // 4. End-to-End qaE2eRun Housekeeping Integration Test
  // =========================================================================
  console.log('  Testing end-to-end qaE2eRun housekeeping integration...');

  const e2eProject = path.join(testRoot, 'e2e-project');
  fs.mkdirSync(path.join(e2eProject, '.git'), { recursive: true });
  
  const fakeReport = {
    config: { testDir: 'tests/e2e' },
    suites: [
      {
        title: 'suite-e2e',
        file: 'tests/e2e/test.spec.js',
        specs: [
          {
            title: 'Sample passing test',
            file: 'tests/e2e/test.spec.js',
            line: 10,
            tests: [{ status: 'expected', results: [{ duration: 50, status: 'passed' }] }]
          }
        ]
      }
    ]
  };

  const e2eResult = qaE2eRun({
    project_path: e2eProject,
    mock_report: fakeReport
  });

  assert.strictEqual(e2eResult.status, 'passed');
  assert.ok(e2eResult.housekeeping, 'Must include housekeeping section');
  assert.strictEqual(e2eResult.housekeeping.gitignore.status, 'added');
  assert.ok(Array.isArray(e2eResult.summary_lines));
  assert.ok(e2eResult.summary_lines.some(l => l.startsWith('gitignore: added')));
  assert.ok(e2eResult.summary_lines.some(l => l.startsWith('retention:')));

  // Verify .gitignore was added to project
  assert.ok(fs.existsSync(path.join(e2eProject, '.gitignore')));
  // Verify no test-results/ or playwright-report/ created in project
  assert.ok(!fs.existsSync(path.join(e2eProject, 'test-results')));
  assert.ok(!fs.existsSync(path.join(e2eProject, 'playwright-report')));

  console.log('✓ test_qa_housekeeping.js passed cleanly.');
} finally {
  try {
    fs.rmSync(testRoot, { recursive: true, force: true });
  } catch (_) { /* cleanup */ }
}
