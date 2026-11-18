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
const { spawn } = require('child_process');
const { stripAnsi, getSha256, qaCodify } = require('./qa_codify');
const { resolveTargetProjectDir, localPlaywrightBin, playwrightExec, playwrightExecAsync } = require('./qa_runner');
const { defaultBrowserSessionManager } = require('./browser_session_manager');
const { translateTargetUrlForContainer } = require('./browser_workspace_security');
const {
  ensureQaGitignore,
  getProjectOutputDirs,
  copyFailureEvidence,
  runQaRetention
} = require('./qa_retention');

const _activeQaRuns = new Map();

const CONTAINER_WORKSPACE = '/workspace';
const CONTAINER_ARTIFACTS = '/artifacts';

/** Async `docker <args>`: the browser workspace and Playwright both run inside it. */
function runDockerAsync(dockerArgs, { timeoutMs = 300000, signal = null, onLog = null } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('docker', dockerArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ status: -1, stdout: '', stderr: String(err.message || err), timedOut: false, cancelled: false });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(payload);
    };
    const timer = timeoutMs > 0
      ? setTimeout(() => {
          try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
          finish({ status: null, stdout, stderr, timedOut: true, cancelled: false });
        }, timeoutMs)
      : null;
    const collect = (stream) => (chunk) => {
      const text = chunk.toString('utf8');
      if (stream === 'stdout') stdout += text;
      else stderr += text;
      if (onLog) onLog(stream, text);
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    if (signal) {
      signal.addEventListener('abort', () => {
        try { child.kill('SIGTERM'); } catch (_) { /* already gone */ }
        finish({ status: null, stdout, stderr, timedOut: false, cancelled: true });
      }, { once: true });
    }
    child.on('error', (err) => finish({ status: -1, stdout, stderr: `${stderr}${err.message || err}`, timedOut: false, cancelled: false }));
    child.on('close', (code) => finish({ status: code, stdout, stderr, timedOut: false, cancelled: false }));
  });
}

function readHostPlaywrightVersion(resolvedProject) {
  for (const pkg of ['@playwright/test', 'playwright']) {
    const manifest = path.join(resolvedProject, 'node_modules', pkg, 'package.json');
    if (!fs.existsSync(manifest)) continue;
    try {
      return { name: pkg, version: JSON.parse(fs.readFileSync(manifest, 'utf8')).version || null };
    } catch (_) { /* unreadable manifest */ }
  }
  return null;
}

function minorOf(version) {
  const m = /^(\d+)\.(\d+)/.exec(String(version || ''));
  return m ? `${m[1]}.${m[2]}` : null;
}

function resolveStartUrl(args) {
  return String(args.start_url || args.startUrl || process.env.KONOHA_QA_START_URL || 'http://127.0.0.1:4173');
}

/**
 * The app under test lives on the host, and the container reaches it through
 * host.docker.internal. Probing from the host would accept a dev server bound to
 * 127.0.0.1 that the container can never open, so the live path asks the
 * container instead of guessing.
 */
async function probeStartUrlFromContainer(containerName, rawUrl, timeoutMs = 8000) {
  const target = translateTargetUrlForContainer(rawUrl);
  const res = await runDockerAsync(
    ['exec', containerName, 'node', '-e',
      'fetch(process.argv[1]).then((r) => process.exit(r.status ? 0 : 1)).catch(() => process.exit(1))',
      target],
    { timeoutMs }
  );
  return res.status === 0;
}

/**
 * The container runs the project's own Playwright against /workspace, driving the very
 * Chromium the noVNC viewer shows. Its browser build must match the project's
 * Playwright, otherwise tests fail on a revision the image never downloaded.
 */
async function _containerPlaywrightVersion(containerName) {
  const res = await runDockerAsync(
    ['exec', containerName, 'node', '-p', "require('/opt/konoha-browser/node_modules/playwright/package.json').version"],
    { timeoutMs: 15000 }
  );
  if (res.status !== 0) return null;
  return (res.stdout || '').trim() || null;
}

/**
 * Playwright's browser lives in the workspace's hoisted node_modules, which for a
 * pnpm workspace is the repo root, not the app dir holding the config. Mount and run
 * from that ancestor so the symlinked @playwright/test resolves inside the container.
 */
function _resolveContainerWorkspace(resolvedProject) {
  const configName = ['playwright.config.js', 'playwright.config.ts', 'playwright.config.mjs', 'playwright.config.cjs']
    .find((name) => fs.existsSync(path.join(resolvedProject, name))) || null;
  let root = path.resolve(resolvedProject);
  let pkg = null;
  for (;;) {
    const candidate = path.join(root, 'node_modules', '@playwright', 'test', 'package.json');
    if (fs.existsSync(candidate)) {
      // A pnpm workspace symlinks into the store at the repo root; mounting the app dir
      // alone leaves that symlink dangling inside the container.
      const real = fs.realpathSync(candidate);
      if (real === path.join(fs.realpathSync(root), 'node_modules', '@playwright', 'test', 'package.json')
        || real.startsWith(fs.realpathSync(root) + path.sep)) {
        pkg = real;
        break;
      }
    }
    const parent = path.dirname(root);
    if (parent === root) break;
    root = parent;
  }
  if (!pkg) throw new Error(`No resolvable node_modules/@playwright/test found above ${resolvedProject}.`);
  const rel = path.relative(root, path.resolve(resolvedProject)).split(path.sep).join('/');
  const configRel = configName ? (rel ? `${rel}/${configName}` : configName) : null;
  return { root, configRel };
}

function _buildContainerQaExec(containerName, { workdir, configRel, startUrl, grep, maxFailures, headed }) {
  // The app under test runs on the host; inside the container 127.0.0.1 is the
  // container's own loopback, so relative `goto` needs the host gateway name.
  const baseUrl = translateTargetUrlForContainer(startUrl);
  const args = [
    'exec',
    '-e', 'DISPLAY=:99',
    '-e', 'KONOHA_PW_IN_CONTAINER=1',
    '-e', `KONOHA_PW_BASE_URL=${baseUrl}`,
    '-e', 'KONOHA_PW_CHANNEL=bundled',
    '-e', `PLAYWRIGHT_JSON_OUTPUT_NAME=${CONTAINER_ARTIFACTS}/report.json`,
    '-w', workdir,
    containerName,
    'node', 'node_modules/@playwright/test/cli.js', 'test',
    '--reporter=json',
    '--output', `${CONTAINER_ARTIFACTS}/output`
  ];
  if (configRel) args.push('--config', configRel);
  if (headed) args.push('--headed');
  if (grep) args.push('--grep', grep);
  if (maxFailures !== null && maxFailures > 0) args.push(`--max-failures=${maxFailures}`);
  return args;
}


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

function buildFinalQaReport({ reportJson, resolvedProject, qaTmpDir, gitignoreRes, runId, reportPath, extra = {}, containerArtifactsHost = null }) {
  const state = { fileHashes: {}, totals: { total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0, durationMs: 0 }, failureEntries: [], flakyNames: [] };
  processReportSuites(reportJson, resolvedProject, state);
  // A container run reports paths inside /artifacts, which is this run's temp dir on the host.
  if (containerArtifactsHost) {
    for (const entry of state.failureEntries) {
      for (const key of ['trace', 'screenshot']) {
        if (entry[key] && entry[key].startsWith(`${CONTAINER_ARTIFACTS}/`)) {
          entry[key] = path.join(containerArtifactsHost, entry[key].slice(CONTAINER_ARTIFACTS.length + 1));
        }
      }
    }
  }
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
  const wantHeaded = Boolean(args.headed || args.live) && !process.env.CI;
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

  const sessionMgr = args.sessionManager || defaultBrowserSessionManager;
  const { pwArgs, wantHeaded } = _buildAsyncQaArgs(projectOutput, args);
  const wantLive = wantHeaded && Boolean(args.live || args.docker_workspace || args.session_id);
  const keepSession = Boolean(args.keep_session);
  const callerOwnsSession = Boolean(args.session_id);
  const startUrl = resolveStartUrl(args);
  let liveSession = null;
  let containerExecArgs = null;
  let releaseSessionRef = null;

  if (wantLive) {
    let containerWorkspace;
    try {
      containerWorkspace = _resolveContainerWorkspace(resolvedProject);
    } catch (err) {
      return {
        status: 'error',
        ok: false,
        error: 'qa_blocked',
        reason: 'playwright-not-installed',
        run_id: runId,
        report_path: reportPath,
        detail: err.message,
        fix: 'install @playwright/test in the project, then run `pnpm exec playwright install chromium`'
      };
    }
    if (args.last_failed || args.lastFailed) {
      return {
        status: 'error',
        ok: false,
        error: 'qa_blocked',
        reason: 'last-failed-unavailable-live',
        run_id: runId,
        report_path: reportPath,
        detail: 'Playwright records .last-run.json in its output dir, and the live path keeps that dir per run under /artifacts so a failed run cannot leak state into the next one.',
        fix: "select the tests with grep, or run without live so last_failed reads the project's persistent output dir"
      };
    }
    liveSession = await sessionMgr.createSession({
      sessionId: args.session_id || undefined,
      purpose: 'qa-automation',
      projectPath: resolvedProject,
      workspaceMount: containerWorkspace.root,
      artifactsMount: qaTmpDir,
      targetUrl: startUrl,
      reuse: args.reuse !== false
    });
    const releaseSession = async (reason) => {
      if (!liveSession || keepSession || callerOwnsSession) return;
      await sessionMgr.stopSession(liveSession.session_id, { reason }).catch(() => {});
    };
    const sessionMeta = { session_id: liveSession.session_id, viewer_url: liveSession.viewer_url };

    // Playwright inside the container drives the visible Chromium, so its browser
    // build must match the project's Playwright minor version.
    const hostPw = readHostPlaywrightVersion(resolvedProject);
    const containerPw = await _containerPlaywrightVersion(liveSession.container_name);
    const hostMinor = minorOf(hostPw && hostPw.version);
    const containerMinor = minorOf(containerPw);
    if (hostMinor && containerMinor && hostMinor !== containerMinor) {
      await releaseSession('version-mismatch');
      return {
        status: 'error',
        ok: false,
        error: 'browser-version-mismatch',
        reason: 'browser-version-mismatch',
        run_id: runId,
        report_path: reportPath,
        ...sessionMeta,
        detail: `workspace has ${hostPw.name}@${hostPw.version}; browser image ships playwright@${containerPw}.`,
        fix: `pin @playwright/test to ${containerMinor}.x, point KONOHA_BROWSER_IMAGE at a matching image, or run without --live`
      };
    }

    if (!(await probeStartUrlFromContainer(liveSession.container_name, startUrl))) {
      await releaseSession('start-url-unreachable');
      return {
        status: 'error',
        ok: false,
        error: 'browser-start-url-unreachable',
        reason: 'browser-start-url-unreachable',
        run_id: runId,
        report_path: reportPath,
        ...sessionMeta,
        detail: `Nothing answered at ${translateTargetUrlForContainer(startUrl)} from inside the workspace container.`,
        fix: `serve the app on an address the container can reach, e.g. next dev --host 0.0.0.0, or pass start_url (current: ${startUrl})`
      };
    }

    containerExecArgs = _buildContainerQaExec(liveSession.container_name, {
      workdir: CONTAINER_WORKSPACE,
      configRel: containerWorkspace.configRel,
      startUrl,
      grep: args.grep,
      maxFailures: args.max_failures !== undefined ? Number(args.max_failures) : null,
      headed: true
    });
    releaseSessionRef = releaseSession;
  }

  const abortController = new AbortController();
  const runState = {
    run_id: runId,
    status: 'running',
    headed: wantHeaded,
    session_id: liveSession ? liveSession.session_id : (args.session_id || null),
    viewer_url: liveSession ? liveSession.viewer_url : null,
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

  let testRun;
  try {
    if (containerExecArgs) {
      testRun = await runDockerAsync(containerExecArgs, {
        timeoutMs: Number(args.timeout_ms || args.timeoutMs) || 300000,
        signal: abortController.signal,
        onLog: logChunk
      });
    } else {
      const extraEnv = {
        PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
        ...(wantHeaded ? { KONOHA_PW_HEADED: '1' } : {})
      };
      testRun = await playwrightExecAsync(resolvedProject, pwArgs, extraEnv, {
        timeoutMs: Number(args.timeout_ms || args.timeoutMs) || 300000,
        signal: abortController.signal,
        onSpawn: (child) => {
          if (liveSession) sessionMgr.registerChildProcess(liveSession.session_id, child);
        },
        onLog: logChunk
      });
    }
  } finally {
    if (releaseSessionRef) await releaseSessionRef(runState.status);
  }

  if (testRun.cancelled) {
    runState.status = 'cancelled';
    return { status: 'cancelled', run_id: runId, session_id: runState.session_id, report_path: reportPath };
  }
  if (testRun.timedOut) {
    runState.status = 'timed_out';
    return { status: 'error', reason: 'timeout', run_id: runId, session_id: runState.session_id, report_path: reportPath, error: 'Playwright test execution timed out.' };
  }

  const reportJson = parseTestReport(reportPath, testRun);
  if (!reportJson) {
    runState.status = 'error';
    const errText = stripAnsi(testRun.stderr || testRun.stdout || 'Test execution failed').slice(0, 500);
    return { status: 'error', run_id: runId, session_id: runState.session_id, report_path: reportPath, error: 'Playwright test execution failed to produce JSON output', detail: errText };
  }

  const globalErrors = Array.isArray(reportJson.errors) ? reportJson.errors : [];
  if (globalErrors.length > 0) {
    runState.status = 'error';
    const detail = stripAnsi(globalErrors.map((e) => (e && e.message) || String(e)).join('\n')).slice(0, 500);
    return { status: 'error', run_id: runId, session_id: runState.session_id, report_path: reportPath, error: 'Playwright aborted before running any test', detail };
  }

  const result = buildFinalQaReport({
    reportJson,
    resolvedProject,
    qaTmpDir,
    gitignoreRes,
    runId,
    reportPath,
    containerArtifactsHost: containerExecArgs ? qaTmpDir : null,
    extra: {
      headed: wantHeaded,
      live: Boolean(containerExecArgs),
      ...(liveSession ? { session_id: liveSession.session_id, viewer_url: liveSession.viewer_url } : {})
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
    session_id: s.session_id,
    viewer_url: s.viewer_url,
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
  _buildContainerQaExec,
  getQaRunStatus,
  cancelQaRun,
  ensureQaGitignore,
  getProjectOutputDirs,
  copyFailureEvidence,
  runQaRetention,
  stripAnsi,
  getSha256
};
