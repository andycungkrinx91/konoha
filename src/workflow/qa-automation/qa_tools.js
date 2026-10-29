/**
 * src/workflow/qa-automation/qa_tools.js — Token-efficient QA automation tools for Konoha.
 * Provides qa_codify (deterministic flow -> Playwright compiler)
 * and qa_e2e_run (Playwright test runner with compact capped summaries).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { stripAnsi, getSha256, getAgentBrowserCmd, qaCodify } = require('./qa_codify');
const {
  ensureQaGitignore,
  getProjectOutputDirs,
  copyFailureEvidence,
  runQaRetention
} = require('./qa_retention');

function recordSuiteFileHash(file, resolvedProject, fileHashes) {
  if (fileHashes[file]) return;
  const fullSpecPath = path.isAbsolute(file) ? file : path.join(resolvedProject, file);
  if (!fs.existsSync(fullSpecPath)) return;
  try {
    fileHashes[file] = getSha256(fs.readFileSync(fullSpecPath, 'utf8')).slice(0, 16);
  } catch (_) { /* best effort */ }
}

function extractTestFailure(sp, resList) {
  const lastRes = resList[resList.length - 1];
  let errSnippet = '';
  if (lastRes && lastRes.error) {
    const rawMsg = stripAnsi(lastRes.error.message || lastRes.error.stack || '');
    errSnippet = rawMsg.split('\n').slice(0, 12).join('\n').trim();
  }
  const traceAtt = (lastRes && lastRes.attachments) ? lastRes.attachments.find(a => a.name === 'trace') : null;
  const shotAtt = (lastRes && lastRes.attachments) ? lastRes.attachments.find(a => a.name === 'screenshot') : null;
  return {
    title: sp.title || 'Untitled test',
    location: `${sp.file || 'unknown'}:${sp.line || 0}`,
    error: errSnippet,
    trace: traceAtt ? traceAtt.path : null,
    screenshot: shotAtt ? shotAtt.path : null
  };
}

function processSpecTests(sp, totals, failureEntries, flakyNames) {
  totals.total++;
  for (const t of (sp.tests || [])) {
    for (const r of (t.results || [])) {
      totals.durationMs += (r.duration || 0);
    }
    if (t.status === 'expected') totals.passed++;
    else if (t.status === 'unexpected') {
      totals.failed++;
      failureEntries.push(extractTestFailure(sp, t.results || []));
    } else if (t.status === 'skipped') totals.skipped++;
    else if (t.status === 'flaky') {
      totals.flaky++;
      flakyNames.push(sp.title || 'flaky test');
    }
  }
}

function walkSuiteItem(s, resolvedProject, state) {
  if (s.file) {
    recordSuiteFileHash(s.file, resolvedProject, state.fileHashes);
  }
  for (const sp of (s.specs || [])) {
    processSpecTests(sp, state.totals, state.failureEntries, state.flakyNames);
  }
  for (const child of (s.suites || [])) {
    walkSuiteItem(child, resolvedProject, state);
  }
}

function truncateErrorsOnce(failures, maxErrLen) {
  for (const f of failures) {
    if (f.error && f.error.length > maxErrLen) {
      f.error = f.error.slice(0, maxErrLen) + '... (truncated)';
    }
  }
}

function capSummaryPayload(result, displayedFailures) {
  let maxErrLen = 120;
  while (JSON.stringify(result).length > 1950 && maxErrLen >= 20) {
    truncateErrorsOnce(displayedFailures, maxErrLen);
    maxErrLen -= 20;
  }
  if (JSON.stringify(result).length > 1950) {
    delete result.summary_lines;
    delete result.housekeeping;
  }
  if (JSON.stringify(result).length > 1950) {
    for (const f of displayedFailures) {
      if (f.title && f.title.length > 40) f.title = f.title.slice(0, 40) + '...';
    }
  }
}

function executePlaywright(resolvedProject, options) {
  const { pwArgs, reportPath } = options;
  const testEnv = { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath };
  return spawnSync('pnpm', pwArgs, {
    cwd: resolvedProject,
    env: testEnv,
    encoding: 'utf-8',
    shell: process.platform === 'win32'
  });
}

function extractJsonFromStdout(stdout, reportPath) {
  if (!stdout) return null;
  const rawOut = stdout.trim();
  const firstBrace = rawOut.indexOf('{');
  const lastBrace = rawOut.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) return null;
  try {
    const parsed = JSON.parse(rawOut.slice(firstBrace, lastBrace + 1));
    fs.writeFileSync(reportPath, JSON.stringify(parsed, null, 2), 'utf8');
    return parsed;
  } catch (_) {
    return null;
  }
}

function parseTestReport(reportPath, testRun) {
  if (fs.existsSync(reportPath)) {
    try {
      return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    } catch (_) { /* fallback */ }
  }
  return extractJsonFromStdout(testRun ? testRun.stdout : null, reportPath);
}

function resolveTargetProjectDir(projectPath) {
  let resolved = path.resolve(projectPath);
  const hasRootConfig = fs.existsSync(path.join(resolved, 'playwright.config.js')) || fs.existsSync(path.join(resolved, 'playwright.config.ts'));
  if (!hasRootConfig && fs.existsSync(path.join(resolved, 'apps/web/playwright.config.js'))) {
    resolved = path.join(resolved, 'apps/web');
  }
  return resolved;
}

function runPlaywrightSuite(resolvedProject, projectOutput, reportPath, args) {
  const checkRes = spawnSync('pnpm', ['exec', 'playwright', '--version'], {
    cwd: resolvedProject, encoding: 'utf-8', shell: process.platform === 'win32'
  });
  if (checkRes.status !== 0) {
    return { ok: false, error: 'Playwright not found or not installed in project.', fix: 'pnpm exec playwright install chromium' };
  }
  const pwArgs = ['exec', 'playwright', 'test', '--reporter=json', '--output', projectOutput.artifactsDir];
  if (args.grep) pwArgs.push('--grep', args.grep);
  if (args.lastFailed) pwArgs.push('--last-failed');
  if (args.maxFailures !== null && args.maxFailures > 0) pwArgs.push(`--max-failures=${args.maxFailures}`);

  const testRun = executePlaywright(resolvedProject, { pwArgs, reportPath });
  const reportJson = parseTestReport(reportPath, testRun);
  if (!reportJson) {
    const errText = stripAnsi(testRun.stderr || testRun.stdout || 'Test execution failed').slice(0, 500);
    return { ok: false, error: 'Playwright test execution failed to produce JSON output', detail: errText };
  }
  return { ok: true, reportJson };
}

function obtainReportJson(mockReport, reportContext, reportPath, pwOptions) {
  if (mockReport) {
    const reportJson = typeof mockReport === 'string' ? JSON.parse(mockReport) : mockReport;
    fs.writeFileSync(reportPath, JSON.stringify(reportJson, null, 2), 'utf8');
    return { ok: true, reportJson };
  }
  const { resolvedProject, projectOutput } = reportContext;
  return runPlaywrightSuite(resolvedProject, projectOutput, reportPath, pwOptions);
}

function processReportSuites(reportJson, resolvedProject, state) {
  if (!reportJson || !Array.isArray(reportJson.suites)) return;
  for (const s of reportJson.suites) {
    walkSuiteItem(s, resolvedProject, state);
  }
}

function buildSummaryLines(gitignoreRes, retentionRes) {
  const lines = [];
  if (gitignoreRes.status === 'added' && gitignoreRes.entries_added > 0) {
    lines.push(`gitignore: added ${gitignoreRes.entries_added} entries`);
  }
  lines.push(retentionRes.lookup_available
    ? `retention: kept ${retentionRes.kept}, pruned ${retentionRes.pruned}`
    : `retention: evidence lookup unavailable, kept ${retentionRes.kept}`);
  return lines;
}

function qaE2eRun(args = {}) {
  const projectPath = args.project_path || args.projectPath || process.cwd();
  const grep = args.grep || null;
  const lastFailed = Boolean(args.last_failed || args.lastFailed);
  const maxFailures = args.max_failures !== undefined ? Number(args.max_failures) : null;
  const mockReport = args.mock_report || null;

  const resolvedProject = resolveTargetProjectDir(projectPath);
  const gitignoreRes = ensureQaGitignore(resolvedProject);
  const projectOutput = getProjectOutputDirs(resolvedProject);

  const runId = `qa-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const qaTmpDir = path.join(os.homedir(), '.konoha', 'tmp', 'qa', runId);
  fs.mkdirSync(qaTmpDir, { recursive: true });
  const reportPath = path.join(qaTmpDir, 'report.json');

  const pwRes = obtainReportJson(mockReport, { resolvedProject, projectOutput }, reportPath, { grep, lastFailed, maxFailures });
  if (!pwRes.ok) {
    return { status: 'error', run_id: runId, report_path: reportPath, error: pwRes.error, detail: pwRes.detail, fix: pwRes.fix };
  }
  const reportJson = pwRes.reportJson;

  const state = { fileHashes: {}, totals: { total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0, durationMs: 0 }, failureEntries: [], flakyNames: [] };
  processReportSuites(reportJson, resolvedProject, state);
  copyFailureEvidence(state.failureEntries, qaTmpDir);
  const retentionRes = runQaRetention(runId);
  const summaryLines = buildSummaryLines(gitignoreRes, retentionRes);

  const displayedFailures = state.failureEntries.slice(0, 5);
  const truncatedCount = state.failureEntries.length - displayedFailures.length;
  const result = {
    status: state.totals.failed === 0 ? 'passed' : 'failed',
    run_id: runId,
    report_path: reportPath,
    totals: state.totals,
    duration_ms: state.totals.durationMs,
    file_hashes: state.fileHashes,
    failures: displayedFailures,
    truncated_failures: truncatedCount > 0 ? truncatedCount : 0,
    flaky_tests: state.flakyNames,
    housekeeping: { gitignore: gitignoreRes, retention: retentionRes },
    summary_lines: summaryLines
  };

  capSummaryPayload(result, displayedFailures);
  return result;
}

module.exports = {
  qaCodify,
  qaE2eRun,
  ensureQaGitignore,
  getProjectOutputDirs,
  copyFailureEvidence,
  runQaRetention,
  stripAnsi,
  getSha256,
  getAgentBrowserCmd
};
