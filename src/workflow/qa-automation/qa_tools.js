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
const { stripAnsi, getSha256, qaCodify } = require('./qa_codify');
const { resolveTargetProjectDir, localPlaywrightBin, playwrightExec, playwrightExecAsync } = require('./qa_runner');
const {
  ensureQaGitignore,
  getProjectOutputDirs,
  copyFailureEvidence,
  runQaRetention
} = require('./qa_retention');

const _activeQaRuns = new Map();

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

function probePlaywrightInstalled(resolvedProject, rawProjectPath) {
  const hasLocalPw = localPlaywrightBin(resolvedProject)
    || (rawProjectPath ? localPlaywrightBin(path.resolve(rawProjectPath)) : null);
  if (!hasLocalPw) return false;
  return playwrightExec(resolvedProject, ['exec', 'playwright', '--version']).status === 0;
}

function runPlaywrightSuite(resolvedProject, projectOutput, reportPath, args) {
  if (!probePlaywrightInstalled(resolvedProject, args.projectPath)) {
    return { ok: false, error: 'Playwright not found or not installed in project.', fix: 'pnpm exec playwright install chromium' };
  }
  const pwArgs = ['exec', 'playwright', 'test', '--reporter=json', '--output', projectOutput.artifactsDir];
  if (args.grep) pwArgs.push('--grep', args.grep);
  if (args.lastFailed) pwArgs.push('--last-failed');
  if (args.maxFailures !== null && args.maxFailures > 0) pwArgs.push(`--max-failures=${args.maxFailures}`);

  const testRun = playwrightExec(resolvedProject, pwArgs, { PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath });
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

function buildFinalQaReport({ reportJson, resolvedProject, qaTmpDir, gitignoreRes, runId, reportPath, extra = {} }) {
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
    ...extra,
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

  const pwRes = obtainReportJson(mockReport, { resolvedProject, projectOutput }, reportPath, { grep, lastFailed, maxFailures, projectPath });
  if (!pwRes.ok) {
    return { status: 'error', run_id: runId, report_path: reportPath, error: pwRes.error, detail: pwRes.detail, fix: pwRes.fix };
  }
  const reportJson = pwRes.reportJson;

  // A report carrying top-level errors means Playwright aborted before running a
  // single test. Reporting that as passed would be a fake green.
  const globalErrors = Array.isArray(reportJson.errors) ? reportJson.errors : [];
  if (globalErrors.length > 0) {
    const detail = stripAnsi(globalErrors.map((e) => (e && e.message) || String(e)).join('\n')).slice(0, 500);
    return { status: 'error', run_id: runId, report_path: reportPath, error: 'Playwright aborted before running any test', detail };
  }

  return buildFinalQaReport({ reportJson, resolvedProject, qaTmpDir, gitignoreRes, runId, reportPath });
}

function _buildAsyncQaArgs(projectOutput, args) {
  const pwArgs = ['exec', 'playwright', 'test', '--reporter=json', '--output', projectOutput.artifactsDir];
  if (args.grep) pwArgs.push('--grep', args.grep);
  if (args.last_failed || args.lastFailed) pwArgs.push('--last-failed');
  const maxF = args.max_failures !== undefined ? Number(args.max_failures) : null;
  if (maxF !== null && maxF > 0) pwArgs.push(`--max-failures=${maxF}`);
  const wantHeaded = Boolean(args.headed) && !process.env.CI;
  if (wantHeaded) pwArgs.push('--headed');
  return { pwArgs, wantHeaded };
}

async function qaE2eRunAsync(args = {}) {
  if (args.mock_report) {
    return qaE2eRun(args);
  }
  const projectPath = args.project_path || args.projectPath || process.cwd();
  const resolvedProject = resolveTargetProjectDir(projectPath);
  const gitignoreRes = ensureQaGitignore(resolvedProject);
  const projectOutput = getProjectOutputDirs(resolvedProject);
  const runId = `qa-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const qaTmpDir = path.join(os.homedir(), '.konoha', 'tmp', 'qa', runId);
  fs.mkdirSync(qaTmpDir, { recursive: true });
  const reportPath = path.join(qaTmpDir, 'report.json');

  if (!probePlaywrightInstalled(resolvedProject, projectPath)) {
    return {
      status: 'error',
      ok: false,
      error: 'qa_blocked',
      reason: 'playwright-not-installed',
      run_id: runId,
      report_path: reportPath,
      fix: 'pnpm exec playwright install chromium'
    };
  }

  const { pwArgs, wantHeaded } = _buildAsyncQaArgs(projectOutput, args);

  const abortController = new AbortController();
  const runState = {
    run_id: runId,
    status: 'running',
    headed: wantHeaded,
    started_at: new Date().toISOString(),
    logs: [],
    abortController
  };
  _activeQaRuns.set(runId, runState);

  const logChunk = (stream, chunk) => {
    runState.logs.push({ ts: new Date().toISOString(), stream, text: chunk.slice(0, 400) });
    if (runState.logs.length > 100) runState.logs.shift();
    if (typeof args.onLog === 'function') args.onLog(stream, chunk);
  };

  const extraEnv = {
    PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
    ...(wantHeaded ? { KONOHA_PW_HEADED: '1' } : {})
  };
  const testRun = await playwrightExecAsync(resolvedProject, pwArgs, extraEnv, {
    timeoutMs: Number(args.timeout_ms || args.timeoutMs) || 300000,
    signal: abortController.signal,
    onLog: logChunk
  });

  if (testRun.cancelled) {
    runState.status = 'cancelled';
    return { status: 'cancelled', run_id: runId, report_path: reportPath };
  }
  if (testRun.timedOut) {
    runState.status = 'timed_out';
    return { status: 'error', reason: 'timeout', run_id: runId, report_path: reportPath, error: 'Playwright test execution timed out.' };
  }

  const reportJson = parseTestReport(reportPath, testRun);
  if (!reportJson) {
    runState.status = 'error';
    const errText = stripAnsi(testRun.stderr || testRun.stdout || 'Test execution failed').slice(0, 500);
    return { status: 'error', run_id: runId, report_path: reportPath, error: 'Playwright test execution failed to produce JSON output', detail: errText };
  }

  const globalErrors = Array.isArray(reportJson.errors) ? reportJson.errors : [];
  if (globalErrors.length > 0) {
    runState.status = 'error';
    const detail = stripAnsi(globalErrors.map((e) => (e && e.message) || String(e)).join('\n')).slice(0, 500);
    return { status: 'error', run_id: runId, report_path: reportPath, error: 'Playwright aborted before running any test', detail };
  }

  const result = buildFinalQaReport({
    reportJson,
    resolvedProject,
    qaTmpDir,
    gitignoreRes,
    runId,
    reportPath,
    extra: {
      headed: wantHeaded
    }
  });
  runState.status = result.status;
  return result;
}

function getQaRunStatus(runId) {
  const s = _activeQaRuns.get(String(runId || ''));
  if (!s) return null;
  return {
    run_id: s.run_id,
    status: s.status,
    headed: s.headed,
    started_at: s.started_at,
    logs: s.logs.slice(-50)
  };
}

function cancelQaRun(runId) {
  const s = _activeQaRuns.get(String(runId || ''));
  if (!s) return { ok: false, found: false, run_id: runId };
  s.abortController.abort();
  s.status = 'cancelled';
  return { ok: true, found: true, run_id: s.run_id, status: 'cancelled' };
}

module.exports = {
  qaCodify,
  qaE2eRun,
  qaE2eRunAsync,
  getQaRunStatus,
  cancelQaRun,
  ensureQaGitignore,
  getProjectOutputDirs,
  copyFailureEvidence,
  runQaRetention,
  stripAnsi,
  getSha256
};
