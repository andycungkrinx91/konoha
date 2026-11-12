'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { verifyPlaywrightSpec } = require('./qa_runner');

function stripAnsi(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '');
}

function getSha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Walk up from `startDir` looking for a Playwright config, then for an installed
 * Playwright, then for any package.json. The config wins because it defines
 * testDir; the installed Playwright matters because running from a bare
 * package.json directory lets a global copy win. Returns null when nothing
 * above `startDir` carries a package.json.
 */
function findProjectRoot(startDir) {
  const start = path.resolve(startDir);
  const tiers = [
    (dir) => fs.existsSync(path.join(dir, 'playwright.config.js')) || fs.existsSync(path.join(dir, 'playwright.config.ts')),
    (dir) => fs.existsSync(path.join(dir, 'node_modules', '.bin', 'playwright')) || fs.existsSync(path.join(dir, 'node_modules', '@playwright', 'test')),
    (dir) => fs.existsSync(path.join(dir, 'package.json'))
  ];
  for (const matches of tiers) {
    let dir = start;
    for (;;) {
      if (matches(dir)) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

function handleActionToken(token, remaining, idx) {
  const action = token;
  let nextIdx = idx + 1;
  let actionVal = null;
  const nextToken = remaining[nextIdx];
  if (action === 'fill' && nextIdx < remaining.length && !nextToken.startsWith('--')) {
    actionVal = nextToken;
    nextIdx++;
  }
  return { action, actionVal, nextIdx };
}

function parseLocatorOptions(remaining) {
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
      continue;
    }
    if (token === '--name' && idx + 1 < remaining.length) {
      optName = remaining[idx + 1];
      idx += 2;
      continue;
    }
    if (['click', 'fill', 'check', 'hover'].includes(token)) {
      const res = handleActionToken(token, remaining, idx);
      action = res.action;
      actionVal = res.actionVal;
      idx = res.nextIdx;
      continue;
    }
    idx++;
  }
  return { action, actionVal, optName, optExact };
}

function buildLocatorCode(locatorType, locatorVal, optStr, meta = {}) {
  if (locatorType === 'role') return `page.getByRole(${JSON.stringify(locatorVal)}${optStr})`;
  if (locatorType === 'label') return `page.getByLabel(${JSON.stringify(locatorVal)}${optStr})`;
  if (locatorType === 'text') return `page.getByText(${JSON.stringify(locatorVal)}${optStr})`;
  if (locatorType === 'testid') return `page.getByTestId(${JSON.stringify(locatorVal)})`;
  if (meta.warnings) {
    meta.warnings.push(`Non-semantic locator '${locatorType}' used at step ${meta.stepIndex || 0}.`);
  }
  return `page.locator(${JSON.stringify(locatorVal)})`;
}

function parseFindLocator(cmd, stepIndex, warnings) {
  const locatorType = String(cmd[1] || '').toLowerCase();
  const locatorVal = cmd[2] || '';
  const remaining = cmd.slice(3);
  const { action, actionVal, optName, optExact } = parseLocatorOptions(remaining);

  const opts = [];
  if (optName !== null) opts.push(`name: ${JSON.stringify(optName)}`);
  if (optExact) opts.push('exact: true');
  const optStr = opts.length > 0 ? `, { ${opts.join(', ')} }` : '';
  const locatorCode = buildLocatorCode(locatorType, locatorVal, optStr, { warnings, stepIndex });

  if (action === 'click') return `  await ${locatorCode}.click();`;
  if (action === 'fill') return `  await ${locatorCode}.fill(${JSON.stringify(actionVal || '')});`;
  if (action === 'check') return `  await ${locatorCode}.check();`;
  if (action === 'hover') return `  await ${locatorCode}.hover();`;
  return `  await ${locatorCode}.click();`;
}

function parseWaitCommand(cmd) {
  if (cmd[1] === '--text') {
    return `  await expect(page.getByText(${JSON.stringify(cmd[2])})).toBeVisible();`;
  }
  if (cmd[1] === '--url') {
    return `  await page.waitForURL(${JSON.stringify(cmd[2])});`;
  }
  if (cmd[1]) {
    return `  await expect(page.locator(${JSON.stringify(cmd[1])})).toBeVisible();`;
  }
  return '';
}

function compileCommandStatement(cmd, stepIndex, state) {
  const op = String(cmd[0]).toLowerCase();
  for (const token of cmd) {
    if (typeof token === 'string' && /^@e\d+$/i.test(token.trim())) {
      throw new Error(`Invalid flow command at step ${stepIndex}: Reference '${token}' is not stable. Use semantic locators (find role|label|text|testid) instead.`);
    }
  }

  if (op === 'open') return `  await page.goto(${JSON.stringify(cmd[1])});`;
  if (op === 'find') return parseFindLocator(cmd, stepIndex, state.warnings);
  if (op === 'press') return `  await page.keyboard.press(${JSON.stringify(cmd[1])});`;
  if (op === 'wait') return parseWaitCommand(cmd);
  if (op === 'is' && cmd[1] === 'visible') return `  await expect(page.locator(${JSON.stringify(cmd[2])})).toBeVisible();`;
  if (op === 'click') return `  await page.locator(${JSON.stringify(cmd[1])}).click();`;
  if (op === 'fill') return `  await page.locator(${JSON.stringify(cmd[1])}).fill(${JSON.stringify(cmd[2] || '')});`;

  state.skippedCommands.push(op);
  return null;
}

function validateGeneratedTestBody(body) {
  const forbiddenPatterns = [
    /\btest\.skip\b/,
    /\btest\.fixme\b/,
    /\b\.only\b/,
    /\bpage\.pause\s*\(/,
    /\bwaitForTimeout\s*\(/,
    /\bsleep\s*\(/
  ];
  for (const pat of forbiddenPatterns) {
    if (pat.test(body)) {
      throw new Error(`Codify lint error: Generated test contains forbidden pattern: ${pat}`);
    }
  }
}

/**
 * Compile a flow into a full @playwright/test spec.
 * The lint guard runs here, so a verified artifact and a codified artifact are
 * held to the same standard.
 */
function buildSpecFile(rawFlow, flowHash, testName) {
  const flowCommands = JSON.parse(rawFlow);
  if (!Array.isArray(flowCommands)) {
    throw new Error('Flow file must contain a JSON array of commands.');
  }

  const state = { skippedCommands: [], warnings: [] };
  const testStatements = [];
  for (let i = 0; i < flowCommands.length; i++) {
    const cmd = flowCommands[i];
    if (!Array.isArray(cmd) || cmd.length === 0) continue;
    const stmt = compileCommandStatement(cmd, i + 1, state);
    if (stmt) testStatements.push(stmt);
  }

  const generatedBody = testStatements.join('\n');
  validateGeneratedTestBody(generatedBody);

  const importLine = "import { test, expect } from '@playwright/test';";
  const content = `/**\n * Flow SHA256: ${flowHash}\n * Verified with Playwright (exit 0)\n * Edit the flow file and regenerate, or remove this header to take ownership.\n */\n\n${importLine}\n\ntest(${JSON.stringify(testName)}, async ({ page }) => {\n${generatedBody}\n});\n`;

  return { content, stepCount: testStatements.length, state };
}

/**
 * Verify a flow by compiling it and running the compiled spec.
 * The spec is written next to `outPath` — which is inside the project's testDir
 * by construction — and always removed, so a failed run leaves nothing behind.
 */
function verifyFlowExecution(rawFlow, flowHash, outPath) {
  const outDir = path.dirname(path.resolve(outPath));
  const projectRoot = findProjectRoot(outDir);
  if (!projectRoot) {
    return {
      ok: false,
      result: {
        ok: false,
        error: 'qa_blocked',
        reason: 'playwright-not-installed',
        detail: 'No playwright.config.js or package.json found above out_path.',
        status: 'error',
        flow_hash: flowHash,
        verified: false,
        fix: 'pnpm exec playwright install chromium'
      }
    };
  }

  let specPath = null;
  try {
    const { content } = buildSpecFile(rawFlow, flowHash, 'Konoha flow verification');
    specPath = path.join(outDir, `.konoha-verify-${flowHash.slice(0, 12)}.spec.js`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(specPath, content, 'utf8');

    const run = verifyPlaywrightSpec(projectRoot, specPath);
    if (run.ok) return { ok: true, verified: true };

    if (run.reason === 'playwright-not-installed') {
      return {
        ok: false,
        result: {
          ok: false,
          error: 'qa_blocked',
          reason: 'playwright-not-installed',
          status: 'error',
          flow_hash: flowHash,
          verified: false,
          fix: 'pnpm exec playwright install chromium'
        }
      };
    }

    return {
      ok: false,
      result: {
        status: 'error',
        error: 'Flow verification failed before codifying. Steps must execute cleanly.',
        detail: run.detail,
        flow_hash: flowHash,
        verified: false
      }
    };
  } catch (err) {
    return {
      ok: false,
      result: {
        status: 'error',
        error: `Flow verification failed: ${err.message}`,
        flow_hash: flowHash,
        verified: false
      }
    };
  } finally {
    if (specPath) {
      try { fs.unlinkSync(specPath); } catch (_) { /* already gone */ }
    }
  }
}

function qaCodify(args = {}) {
  const flowPath = args.flow_path || args.flowPath;
  const outPath = args.out_path || args.outPath;
  const testName = args.name || 'Automated QA flow';
  const skipVerification = Boolean(args.skip_verification);

  if (!flowPath) throw new Error('Missing required argument: flow_path');
  if (!outPath) throw new Error('Missing required argument: out_path');

  const resolvedFlowPath = path.resolve(flowPath);
  if (!fs.existsSync(resolvedFlowPath)) {
    throw new Error(`Flow file not found: ${flowPath}`);
  }

  const rawFlow = fs.readFileSync(resolvedFlowPath, 'utf8');
  try {
    JSON.parse(rawFlow);
  } catch (err) {
    throw new Error(`Invalid JSON in flow file: ${err.message}`);
  }

  const flowHash = getSha256(rawFlow);
  let verificationPassed = false;
  if (!skipVerification) {
    const vRes = verifyFlowExecution(rawFlow, flowHash, outPath);
    if (!vRes.ok) return vRes.result;
    verificationPassed = vRes.verified;
  } else {
    verificationPassed = true;
  }

  const { content, stepCount, state } = buildSpecFile(rawFlow, flowHash, testName);
  const resolvedOutPath = path.resolve(outPath);
  fs.mkdirSync(path.dirname(resolvedOutPath), { recursive: true });
  fs.writeFileSync(resolvedOutPath, content, 'utf8');

  return {
    status: 'success',
    output_path: resolvedOutPath,
    step_count: stepCount,
    skipped_commands: [...new Set(state.skippedCommands)],
    warnings: state.warnings,
    flow_hash: flowHash,
    verified: verificationPassed
  };
}

module.exports = {
  stripAnsi,
  getSha256,
  findProjectRoot,
  buildSpecFile,
  verifyFlowExecution,
  qaCodify
};
