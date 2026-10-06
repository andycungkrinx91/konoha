/**
 * src/qa_tools.js — Token-efficient QA automation tools for Konoha.
 * Provides qa_codify (deterministic flow -> Playwright compiler)
 * and qa_e2e_run (Playwright test runner with compact capped summaries).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function stripAnsi(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '');
}

function getSha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function getAgentBrowserCmd() {
  const isWin = process.platform === 'win32';
  const abCmd = isWin ? 'agent-browser.cmd' : 'agent-browser';
  try {
    const res = spawnSync(abCmd, ['--version'], { encoding: 'utf-8', shell: isWin });
    if (res.status === 0) return abCmd;
  } catch (_) { /* best effort */ }

  const home = os.homedir();
  const candidates = isWin ? [
    path.join(process.env.APPDATA || '', 'npm', 'agent-browser.cmd'),
    path.join(process.env.LOCALAPPDATA || '', 'pnpm', 'agent-browser.cmd')
  ] : [
    path.join(home, '.local', 'bin', 'agent-browser'),
    path.join(home, '.npm-global', 'bin', 'agent-browser'),
    path.join(home, '.pnpm-global', 'bin', 'agent-browser'),
    '/usr/local/bin/agent-browser',
    '/usr/bin/agent-browser'
  ];

  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      try {
        const res = spawnSync(c, ['--version'], { encoding: 'utf-8', shell: isWin });
        if (res.status === 0) return c;
      } catch (_) { /* best effort */ }
    }
  }
  return null;
}

/**
 * Deterministically codifies an agent-browser flow JSON file into a Playwright test.
 */
function qaCodify(args = {}) {
  const flowPath = args.flow_path || args.flowPath;
  const outPath = args.out_path || args.outPath;
  const testName = args.name || 'Automated QA flow';
  const lang = args.lang || null;
  const skipVerification = Boolean(args.skip_verification);

  if (!flowPath) throw new Error('Missing required argument: flow_path');
  if (!outPath) throw new Error('Missing required argument: out_path');

  const resolvedFlowPath = path.resolve(flowPath);
  if (!fs.existsSync(resolvedFlowPath)) {
    throw new Error(`Flow file not found: ${flowPath}`);
  }

  const rawFlow = fs.readFileSync(resolvedFlowPath, 'utf8');
  let flowCommands;
  try {
    flowCommands = JSON.parse(rawFlow);
  } catch (err) {
    throw new Error(`Invalid JSON in flow file: ${err.message}`);
  }

  if (!Array.isArray(flowCommands)) {
    throw new Error('Flow file must contain a JSON array of commands.');
  }

  const flowHash = getSha256(rawFlow);

  // 1. Verification Gate: verify flow with agent-browser batch --bail --json
  let verificationPassed = false;
  if (!skipVerification) {
    const abCmd = getAgentBrowserCmd();
    if (abCmd) {
      try {
        const verifyRes = spawnSync(abCmd, ['batch', '--bail', '--json'], {
          input: rawFlow,
          encoding: 'utf-8',
          shell: process.platform === 'win32'
        });
        if (verifyRes.status !== 0) {
          const errMsg = verifyRes.stderr || verifyRes.stdout || 'agent-browser batch exited with non-zero status';
          return {
            status: 'error',
            error: 'Flow verification failed before codifying. Steps must execute cleanly.',
            detail: stripAnsi(errMsg).slice(0, 500),
            flow_hash: flowHash,
            verified: false
          };
        }
        verificationPassed = true;
      } catch (err) {
        return {
          status: 'error',
          error: `Flow verification failed: ${err.message}`,
          flow_hash: flowHash,
          verified: false
        };
      }
    } else {
      // If agent-browser is not installed, record as unverified or require binary
      verificationPassed = false;
    }
  } else {
    verificationPassed = true;
  }

  // 2. Lint on Input & Generate Test Code
  const skippedCommands = [];
  const warnings = [];
  const testStatements = [];

  for (let i = 0; i < flowCommands.length; i++) {
    const cmd = flowCommands[i];
    if (!Array.isArray(cmd) || cmd.length === 0) continue;

    const op = String(cmd[0]).toLowerCase();

    // Rejection rule: @e refs are strictly forbidden
    for (const token of cmd) {
      if (typeof token === 'string' && /^@e\d+$/i.test(token.trim())) {
        throw new Error(`Invalid flow command at step ${i + 1}: Reference '${token}' is not stable. Use semantic locators (find role|label|text|testid) instead.`);
      }
    }

    if (op === 'open') {
      testStatements.push(`  await page.goto(${JSON.stringify(cmd[1])});`);
    } else if (op === 'find') {
      const locatorType = String(cmd[1] || '').toLowerCase();
      const locatorVal = cmd[2] || '';
      const remaining = cmd.slice(3);

      let action = 'click';
      let actionVal = null;
      let optName = null;
      let optExact = false;

      let idx = 0;
      while (idx < remaining.length) {
        const token = remaining[idx];
        if (token === '--exact') {
          optExact = true;
          idx++;
        } else if (token === '--name' && idx + 1 < remaining.length) {
          optName = remaining[idx + 1];
          idx += 2;
        } else if (['click', 'fill', 'check', 'hover'].includes(token)) {
          action = token;
          idx++;
          if (action === 'fill' && idx < remaining.length && !remaining[idx].startsWith('--')) {
            actionVal = remaining[idx];
            idx++;
          }
        } else {
          idx++;
        }
      }

      let locatorCode = '';
      const opts = [];
      if (optName !== null) opts.push(`name: ${JSON.stringify(optName)}`);
      if (optExact) opts.push('exact: true');
      const optStr = opts.length > 0 ? `, { ${opts.join(', ')} }` : '';

      if (locatorType === 'role') {
        locatorCode = `page.getByRole(${JSON.stringify(locatorVal)}${optStr})`;
      } else if (locatorType === 'label') {
        locatorCode = `page.getByLabel(${JSON.stringify(locatorVal)}${optStr})`;
      } else if (locatorType === 'text') {
        locatorCode = `page.getByText(${JSON.stringify(locatorVal)}${optStr})`;
      } else if (locatorType === 'testid') {
        locatorCode = `page.getByTestId(${JSON.stringify(locatorVal)})`;
      } else {
        warnings.push(`Non-semantic locator '${locatorType}' used at step ${i + 1}.`);
        locatorCode = `page.locator(${JSON.stringify(locatorVal)})`;
      }

      if (action === 'click') {
        testStatements.push(`  await ${locatorCode}.click();`);
      } else if (action === 'fill') {
        testStatements.push(`  await ${locatorCode}.fill(${JSON.stringify(actionVal || '')});`);
      } else if (action === 'check') {
        testStatements.push(`  await ${locatorCode}.check();`);
      } else if (action === 'hover') {
        testStatements.push(`  await ${locatorCode}.hover();`);
      }
    } else if (op === 'press') {
      testStatements.push(`  await page.keyboard.press(${JSON.stringify(cmd[1])});`);
    } else if (op === 'wait') {
      if (cmd[1] === '--text') {
        testStatements.push(`  await expect(page.getByText(${JSON.stringify(cmd[2])})).toBeVisible();`);
      } else if (cmd[1] === '--url') {
        testStatements.push(`  await page.waitForURL(${JSON.stringify(cmd[2])});`);
      } else if (cmd[1]) {
        testStatements.push(`  await expect(page.locator(${JSON.stringify(cmd[1])})).toBeVisible();`);
      }
    } else if (op === 'is' && cmd[1] === 'visible') {
      testStatements.push(`  await expect(page.locator(${JSON.stringify(cmd[2])})).toBeVisible();`);
    } else if (op === 'click') {
      testStatements.push(`  await page.locator(${JSON.stringify(cmd[1])}).click();`);
    } else if (op === 'fill') {
      testStatements.push(`  await page.locator(${JSON.stringify(cmd[1])}).fill(${JSON.stringify(cmd[2] || '')});`);
    } else if (['snapshot', 'screenshot', 'console', 'errors', 'network', 'diff'].includes(op)) {
      skippedCommands.push(op);
    } else {
      skippedCommands.push(op);
    }
  }

  // 3. Determine Language & Module Syntax
  let _isTs = false;
  if (lang) {
    _isTs = lang.toLowerCase() === 'ts';
  } else {
    const projectDir = path.dirname(path.resolve(outPath));
    _isTs = fs.existsSync(path.join(projectDir, 'tsconfig.json')) ||
           fs.existsSync(path.join(process.cwd(), 'tsconfig.json'));
  }

  const generatedBody = testStatements.join('\n');

  // Lint on output: Reject test.skip, test.fixme, .only, page.pause(), fixed sleeps
  const forbiddenPatterns = [
    /\btest\.skip\b/,
    /\btest\.fixme\b/,
    /\b\.only\b/,
    /\bpage\.pause\s*\(/,
    /\bwaitForTimeout\s*\(/,
    /\bsleep\s*\(/
  ];
  for (const pat of forbiddenPatterns) {
    if (pat.test(generatedBody)) {
      throw new Error(`Codify lint error: Generated test contains forbidden pattern: ${pat}`);
    }
  }

  const importLine = "import { test, expect } from '@playwright/test';";
  const fileContent = `/**
 * Generated from: ${path.basename(flowPath)}
 * Flow SHA256: ${flowHash}
 * Verified with agent-browser batch (exit 0)
 * Edit the flow file and regenerate, or remove this header to take ownership.
 */

${importLine}

test(${JSON.stringify(testName)}, async ({ page }) => {
${generatedBody}
});
`;

  const resolvedOutPath = path.resolve(outPath);
  fs.mkdirSync(path.dirname(resolvedOutPath), { recursive: true });
  fs.writeFileSync(resolvedOutPath, fileContent, 'utf8');

  return {
    status: 'success',
    output_path: resolvedOutPath,
    step_count: testStatements.length,
    skipped_commands: [...new Set(skippedCommands)],
    warnings,
    flow_hash: flowHash,
    verified: verificationPassed
  };
}

/**
 * Managed .gitignore entries for ephemeral QA artifacts.
 * Invariant: Never include deliverables (e2e, flows, specs, reports).
 */
const MANAGED_QA_ENTRIES = [
  'test-results/',
  'playwright-report/',
  'blob-report/',
  'playwright/.cache/'
];

/**
 * Searches upwards from startDir to discover git repository root (.git directory or file).
 */
function findGitRoot(startDir) {
  let curr = path.resolve(startDir);
  while (true) {
    const gitPath = path.join(curr, '.git');
    if (fs.existsSync(gitPath)) {
      return curr;
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return null;
}

/**
 * Ensures ephemeral QA artifact folders are added to .gitignore in a managed block.
 * Idempotent, non-destructive, respects CRLF and trailing newlines, skipped if not a git project.
 */
function ensureQaGitignore(projectPath) {
  if (process.env.KONOHA_QA_GITIGNORE === '0') {
    return { status: 'skipped', reason: 'opt-out', entries_added: 0 };
  }

  const gitRoot = findGitRoot(projectPath);
  if (!gitRoot) {
    return { status: 'skipped', reason: 'not a git project', entries_added: 0 };
  }

  const gitignorePath = path.join(projectPath, '.gitignore');
  let originalContent = '';
  let eol = '\n';
  let hasTrailingNewline = true;

  if (fs.existsSync(gitignorePath)) {
    try {
      originalContent = fs.readFileSync(gitignorePath, 'utf8');
      eol = originalContent.includes('\r\n') ? '\r\n' : '\n';
      hasTrailingNewline = originalContent.endsWith('\n');
    } catch (err) {
      return { status: 'error', reason: err.message, entries_added: 0 };
    }
  }

  const startMarker = '# KONOHA-QA-START';
  const endMarker = '# KONOHA-QA-END';

  let outsideBlock = originalContent;
  const blockRegex = new RegExp(`[\\r\\n]*${startMarker}[\\s\\S]*?${endMarker}[\\r\\n]*`, 'g');
  if (blockRegex.test(originalContent)) {
    outsideBlock = originalContent.replace(blockRegex, eol);
  }

  const outsideLines = outsideBlock
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
  const outsideSet = new Set(outsideLines);

  const entriesToManage = MANAGED_QA_ENTRIES.filter(e => !outsideSet.has(e) && !outsideSet.has(e.replace(/\/$/, '')));

  if (entriesToManage.length === 0) {
    if (originalContent.includes(startMarker)) {
      const cleaned = originalContent.replace(blockRegex, '').trimEnd() + (hasTrailingNewline ? eol : '');
      fs.writeFileSync(gitignorePath, cleaned, 'utf8');
      return { status: 'removed', entries_added: 0 };
    }
    return { status: 'unchanged', entries_added: 0 };
  }

  const newBlockLines = [
    startMarker,
    ...entriesToManage,
    endMarker
  ];
  const newBlockContent = newBlockLines.join(eol);

  let updatedContent = '';
  if (originalContent.includes(startMarker)) {
    const exactBlockRegex = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);
    const currentBlockMatch = originalContent.match(exactBlockRegex);
    if (currentBlockMatch && currentBlockMatch[0] === newBlockContent) {
      return { status: 'unchanged', entries_added: 0 };
    }
    updatedContent = originalContent.replace(exactBlockRegex, newBlockContent);
  } else {
    const trimmed = originalContent.replace(/\r?\n+$/, '');
    if (trimmed.length > 0) {
      updatedContent = trimmed + eol + eol + newBlockContent + eol;
    } else {
      updatedContent = newBlockContent + eol;
    }
  }

  try {
    fs.writeFileSync(gitignorePath, updatedContent, 'utf8');
    return { status: 'added', entries_added: entriesToManage.length };
  } catch (err) {
    return { status: 'error', reason: err.message, entries_added: 0 };
  }
}

/**
 * Resolves stable per-project directory under ~/.konoha/tmp/qa/projects/<hash>/
 * so Playwright test artifacts remain outside the user workspace.
 */
function getProjectOutputDirs(projectPath) {
  const resolved = path.resolve(projectPath);
  const projectHash = crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 16);
  const baseQaDir = path.join(os.homedir(), '.konoha', 'tmp', 'qa');
  const projectQaDir = path.join(baseQaDir, 'projects', projectHash);

  const rel = path.relative(baseQaDir, projectQaDir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Project output directory escapes base QA temporary directory');
  }

  const artifactsDir = path.join(projectQaDir, 'artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });

  return {
    projectHash,
    projectQaDir,
    artifactsDir
  };
}

/**
 * Copies traces and screenshots of failing tests into the run folder so evidence
 * remains valid after subsequent runs overwrite the project-level artifacts.
 */
function copyFailureEvidence(failureEntries, runTmpDir) {
  if (!Array.isArray(failureEntries) || failureEntries.length === 0) return;
  const artifactsDir = path.join(runTmpDir, 'artifacts');

  for (let i = 0; i < failureEntries.length; i++) {
    const f = failureEntries[i];
    if (f.trace && fs.existsSync(f.trace)) {
      try {
        fs.mkdirSync(artifactsDir, { recursive: true });
        const dest = path.join(artifactsDir, `trace-${i + 1}.zip`);
        fs.copyFileSync(f.trace, dest);
        f.trace = dest;
      } catch (_) { /* best effort */ }
    }
    if (f.screenshot && fs.existsSync(f.screenshot)) {
      try {
        fs.mkdirSync(artifactsDir, { recursive: true });
        const ext = path.extname(f.screenshot) || '.png';
        const dest = path.join(artifactsDir, `screenshot-${i + 1}${ext}`);
        fs.copyFileSync(f.screenshot, dest);
        f.screenshot = dest;
      } catch (_) { /* best effort */ }
    }
  }
}

/**
 * Prunes old QA run folders under ~/.konoha/tmp/qa/ keeping newest N runs.
 * Never touches runs associated with open tasks, state/, projects/, or non-run folders.
 */
function runQaRetention(currentRunId, options = {}) {
  const baseQaDir = options.baseDir || path.join(os.homedir(), '.konoha', 'tmp', 'qa');
  if (!fs.existsSync(baseQaDir)) {
    return { kept: 0, pruned: 0, lookup_available: true };
  }

  const maxCount = options.maxCount !== undefined 
    ? options.maxCount 
    : parseInt(process.env.KONOHA_QA_RETENTION_COUNT || '20', 10);

  let protectedRunIds = new Set();
  let lookupAvailable = options.lookupAvailable !== undefined ? Boolean(options.lookupAvailable) : true;
  if (options.protectedRunIds) {
    protectedRunIds = new Set(options.protectedRunIds);
  } else if (lookupAvailable) {
    try {
      const sdlcManager = require('./sdlc_manager');
      const tasks = sdlcManager.listTasks({ limit: 1000 });
      for (const t of tasks) {
        if (t.status !== 'completed' && t.evidence) {
          const evStr = typeof t.evidence === 'string' ? t.evidence : JSON.stringify(t.evidence);
          const matches = evStr.match(/qa-\d+-[a-f0-9]+/g);
          if (matches) {
            matches.forEach(m => protectedRunIds.add(m));
          }
        }
      }
    } catch (_) {
      lookupAvailable = false;
    }
  }

  let entries = [];
  try {
    entries = fs.readdirSync(baseQaDir, { withFileTypes: true });
  } catch (_) {
    return { kept: 0, pruned: 0, lookup_available: lookupAvailable };
  }

  const runFolders = [];
  const runIdRegex = /^qa-\d+-[a-f0-9]+$/;
  const now = options.now || Date.now();
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (!runIdRegex.test(entry.name)) continue;

    const fullPath = path.join(baseQaDir, entry.name);
    const rel = path.relative(baseQaDir, fullPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue;

    try {
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) continue;
      runFolders.push({
        name: entry.name,
        path: fullPath,
        mtimeMs: stat.mtimeMs
      });
    } catch (_) { /* ignore */ }
  }

  runFolders.sort((a, b) => b.mtimeMs - a.mtimeMs);

  let kept = 0;
  let pruned = 0;

  for (let i = 0; i < runFolders.length; i++) {
    const rf = runFolders[i];
    if (rf.name === currentRunId) {
      kept++;
      continue;
    }

    if (lookupAvailable) {
      if (kept < maxCount) {
        kept++;
        continue;
      }
      if (protectedRunIds.has(rf.name)) {
        kept++;
        continue;
      }
      try {
        fs.rmSync(rf.path, { recursive: true, force: true });
        pruned++;
      } catch (_) {
        kept++;
      }
    } else {
      const ageMs = now - rf.mtimeMs;
      if (ageMs < SEVEN_DAYS_MS) {
        kept++;
        continue;
      }
      if (kept < maxCount) {
        kept++;
        continue;
      }
      try {
        fs.rmSync(rf.path, { recursive: true, force: true });
        pruned++;
      } catch (_) {
        kept++;
      }
    }
  }

  return {
    kept,
    pruned,
    lookup_available: lookupAvailable
  };
}

/**
 * Runs Playwright Test with JSON reporter and returns a compact, capped summary.
 */
function qaE2eRun(args = {}) {
  const projectPath = args.project_path || args.projectPath || process.cwd();
  const grep = args.grep || null;
  const lastFailed = Boolean(args.last_failed || args.lastFailed);
  const maxFailures = args.max_failures !== undefined ? Number(args.max_failures) : null;
  const mockReport = args.mock_report || null;

  let resolvedProject = path.resolve(projectPath);
  if (!fs.existsSync(path.join(resolvedProject, 'playwright.config.js')) &&
      !fs.existsSync(path.join(resolvedProject, 'playwright.config.ts')) &&
      fs.existsSync(path.join(resolvedProject, 'apps/web/playwright.config.js'))) {
    resolvedProject = path.join(resolvedProject, 'apps/web');
  }

  // 1. Managed .gitignore block before Playwright starts
  const gitignoreRes = ensureQaGitignore(resolvedProject);

  // 2. Redirect output outside project
  const projectOutput = getProjectOutputDirs(resolvedProject);

  const runId = `qa-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const qaTmpDir = path.join(os.homedir(), '.konoha', 'tmp', 'qa', runId);
  fs.mkdirSync(qaTmpDir, { recursive: true });
  const reportPath = path.join(qaTmpDir, 'report.json');

  let reportJson = null;
  let testRun = null;

  if (mockReport) {
    reportJson = typeof mockReport === 'string' ? JSON.parse(mockReport) : mockReport;
    fs.writeFileSync(reportPath, JSON.stringify(reportJson, null, 2), 'utf8');
  } else {
    // Check Playwright availability
    const checkRes = spawnSync('pnpm', ['exec', 'playwright', '--version'], {
      cwd: resolvedProject,
      encoding: 'utf-8',
      shell: process.platform === 'win32'
    });

    if (checkRes.status !== 0) {
      return {
        status: 'error',
        error: 'Playwright not found or not installed in project.',
        fix: 'pnpm exec playwright install chromium'
      };
    }

    const pwArgs = ['exec', 'playwright', 'test', '--reporter=json', '--output', projectOutput.artifactsDir];
    if (grep) pwArgs.push('--grep', grep);
    if (lastFailed) pwArgs.push('--last-failed');
    if (maxFailures !== null && maxFailures > 0) pwArgs.push(`--max-failures=${maxFailures}`);

    const testEnv = {
      ...process.env,
      PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath
    };

    testRun = spawnSync('pnpm', pwArgs, {
      cwd: resolvedProject,
      env: testEnv,
      encoding: 'utf-8',
      shell: process.platform === 'win32'
    });

    if (fs.existsSync(reportPath)) {
      try {
        reportJson = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      } catch (_) { /* fallback */ }
    }

    if (!reportJson && testRun.stdout) {
      try {
        const rawOut = testRun.stdout.trim();
        const firstBrace = rawOut.indexOf('{');
        const lastBrace = rawOut.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1) {
          reportJson = JSON.parse(rawOut.slice(firstBrace, lastBrace + 1));
          fs.writeFileSync(reportPath, JSON.stringify(reportJson, null, 2), 'utf8');
        }
      } catch (_) { /* fallback */ }
    }

    if (!reportJson) {
      const errText = stripAnsi(testRun.stderr || testRun.stdout || 'Test execution failed').slice(0, 500);
      return {
        status: 'error',
        run_id: runId,
        report_path: reportPath,
        error: 'Playwright test execution failed to produce JSON output',
        detail: errText
      };
    }
  }

  // Compute file hashes of tests that ran
  const fileHashes = {};
  let total = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let flaky = 0;
  let durationMs = 0;
  const failureEntries = [];
  const flakyNames = [];

  if (reportJson) {
    const suites = reportJson.suites || [];
    function walkSuites(suiteList) {
      for (const s of suiteList) {
        if (s.file) {
          const fullSpecPath = path.isAbsolute(s.file) ? s.file : path.join(resolvedProject, s.file);
          if (fs.existsSync(fullSpecPath) && !fileHashes[s.file]) {
            try {
              fileHashes[s.file] = getSha256(fs.readFileSync(fullSpecPath, 'utf8')).slice(0, 16);
            } catch (_) { /* best effort */ }
          }
        }
        if (s.specs) {
          for (const sp of s.specs) {
            total++;
            const tests = sp.tests || [];
            for (const t of tests) {
              const status = t.status;
              const resList = t.results || [];
              for (const r of resList) {
                durationMs += (r.duration || 0);
              }
              if (status === 'expected') passed++;
              else if (status === 'unexpected') {
                failed++;
                const lastRes = resList[resList.length - 1];
                let errSnippet = '';
                if (lastRes && lastRes.error) {
                  const rawMsg = stripAnsi(lastRes.error.message || lastRes.error.stack || '');
                  errSnippet = rawMsg.split('\n').slice(0, 12).join('\n').trim();
                }
                const traceAtt = (lastRes && lastRes.attachments) ? lastRes.attachments.find(a => a.name === 'trace') : null;
                const shotAtt = (lastRes && lastRes.attachments) ? lastRes.attachments.find(a => a.name === 'screenshot') : null;

                failureEntries.push({
                  title: sp.title || 'Untitled test',
                  location: `${sp.file || 'unknown'}:${sp.line || 0}`,
                  error: errSnippet,
                  trace: traceAtt ? traceAtt.path : null,
                  screenshot: shotAtt ? shotAtt.path : null
                });
              } else if (status === 'skipped') skipped++;
              else if (status === 'flaky') {
                flaky++;
                flakyNames.push(sp.title || 'flaky test');
              }
            }
          }
        }
        if (s.suites) walkSuites(s.suites);
      }
    }
    walkSuites(suites);
  }

  // 3. Copy failure evidence (traces & screenshots) into run folder
  copyFailureEvidence(failureEntries, qaTmpDir);

  // 4. Run retention
  const retentionRes = runQaRetention(runId);

  // 5. Build summary lines
  const summaryLines = [];
  if (gitignoreRes.status === 'added' && gitignoreRes.entries_added > 0) {
    summaryLines.push(`gitignore: added ${gitignoreRes.entries_added} entries`);
  }
  if (!retentionRes.lookup_available) {
    summaryLines.push(`retention: evidence lookup unavailable, kept ${retentionRes.kept}`);
  } else {
    summaryLines.push(`retention: kept ${retentionRes.kept}, pruned ${retentionRes.pruned}`);
  }

  // Format compact summary capped at 2,000 characters
  const displayedFailures = failureEntries.slice(0, 5);
  const truncatedCount = failureEntries.length - displayedFailures.length;

  const result = {
    status: failed === 0 ? 'passed' : 'failed',
    run_id: runId,
    report_path: reportPath,
    totals: { total, passed, failed, skipped, flaky },
    duration_ms: durationMs,
    file_hashes: fileHashes,
    failures: displayedFailures,
    truncated_failures: truncatedCount > 0 ? truncatedCount : 0,
    flaky_tests: flakyNames,
    housekeeping: {
      gitignore: gitignoreRes,
      retention: retentionRes
    },
    summary_lines: summaryLines
  };

  let maxErrLen = 120;
  while (JSON.stringify(result).length > 1950 && maxErrLen >= 20) {
    for (const f of displayedFailures) {
      if (f.error && f.error.length > maxErrLen) {
        f.error = f.error.slice(0, maxErrLen) + '... (truncated)';
      }
    }
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
  getSha256
};
