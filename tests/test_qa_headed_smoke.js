#!/usr/bin/env node
'use strict';

/**
 * tests/test_qa_headed_smoke.js — a real headed Chromium launch through
 * qa_e2e_run, not a mock. Headed Chromium needs a display, so on Linux this
 * starts Xvfb itself; elsewhere it reports SKIP and exits 0.
 *
 * KONOHA_HEADED_DISPLAY=1 reuses the ambient DISPLAY instead of starting Xvfb.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const qaTools = require('../src/workflow/qa-automation/qa_tools');
const { createLocalQaFixture } = require('./helpers/local_qa_fixture');

const CONFIG = `module.exports = {
  testDir: './e2e',
  reporter: 'json',
  use: { launchOptions: { args: ['--window-position=-2400,-2400'] } }
};
`;

const SPEC = (headed) => `const { test, expect } = require('@playwright/test');
test('headed smoke', async ({ page }) => {
  await page.setContent('<button id="inc">+</button><p id="count">0</p><script>document.getElementById("inc").onclick = () => { document.getElementById("count").textContent = String(Number(document.getElementById("count").textContent) + 1); }</script>');
  const cdp = await page.context().newCDPSession(page);
  const { product } = await cdp.send('Browser.getVersion');
  console.log('KONOHA_PW_HEADED=' + process.env.KONOHA_PW_HEADED + ' product=' + product);
  ${headed
    ? "expect(process.env.KONOHA_PW_HEADED).toBe('1');\n  expect(product.startsWith('Chrome/')).toBe(true);"
    : "expect(process.env.KONOHA_PW_HEADED).toBeUndefined();\n  expect(product.startsWith('HeadlessChrome/')).toBe(true);"}
  await page.click('#inc');
  await expect(page.locator('#count')).toHaveText('1');
});
`;

function hasXvfb() {
  return !spawnSync('Xvfb', ['-version'], { stdio: 'ignore' }).error;
}

function freeDisplay() {
  for (let n = 99; n < 130; n++) {
    if (!fs.existsSync(`/tmp/.X11-unix/X${n}`)) return n;
  }
  throw new Error('no free X display between :99 and :129');
}

async function startXvfb() {
  const display = freeDisplay();
  const child = spawn('Xvfb', [`:${display}`, '-screen', '0', '1280x800x24', '-nolisten', 'tcp'], { stdio: 'ignore' });
  const socketPath = `/tmp/.X11-unix/X${display}`;
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(socketPath)) {
    if (child.exitCode !== null) {
      throw new Error(`Xvfb exited (${child.exitCode}) before creating ${socketPath}`);
    }
    if (Date.now() > deadline) throw new Error(`Xvfb did not create ${socketPath} within 10s`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return { child, display: `:${display}` };
}

async function runLeg({ tmpDir, label, headed }) {
  const fixture = createLocalQaFixture({
    tmpDir,
    name: label,
    configSource: CONFIG,
    specSource: SPEC(headed)
  });
  const prevPath = process.env.PATH;
  process.env.PATH = fixture.shimDir + path.delimiter + prevPath;
  try {
    const res = await qaTools.qaE2eRunAsync({ project_path: fixture.proj, headed: true });
    assert.strictEqual(res.status, 'passed', `${label}: QA failed: ${JSON.stringify(res).slice(0, 800)}`);
    assert.strictEqual(res.totals.passed, 1, `${label}: expected one passing test`);
    assert.strictEqual(res.headed, headed, `${label}: report must echo what actually ran`);
    assert.strictEqual(fixture.dockerCalls(), '', `${label}: QA must never spawn docker`);
  } finally {
    process.env.PATH = prevPath;
  }
}

async function run() {
  console.log('Running test_qa_headed_smoke...');
  if (process.platform !== 'linux') {
    console.log(`  SKIP: headed Chromium needs a display; Linux-only (platform=${process.platform})`);
    return;
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-headed-smoke-'));
  const prevCi = process.env.CI;
  const prevDisplay = process.env.DISPLAY;
  let xvfb = null;
  try {
    if (process.env.KONOHA_HEADED_DISPLAY === '1' && prevDisplay) {
      console.log(`  using the ambient DISPLAY=${prevDisplay}`);
    } else if (!hasXvfb()) {
      if (prevCi) throw new Error('Xvfb is required for the headed smoke test in CI but is not on PATH');
      console.log('  SKIP: Xvfb not installed; set KONOHA_HEADED_DISPLAY=1 to reuse an existing DISPLAY');
      return;
    } else {
      xvfb = await startXvfb();
      process.env.DISPLAY = xvfb.display;
      console.log(`  Xvfb on DISPLAY=${xvfb.display}`);
    }

    delete process.env.CI;
    await runLeg({ tmpDir, label: 'headed', headed: true });
    console.log('  ✓ headed Chromium launched with headless:false and ran a real click');

    process.env.CI = '1';
    await runLeg({ tmpDir, label: 'headless', headed: false });
    console.log('  ✓ CI keeps the same suite headless');
  } finally {
    if (xvfb) xvfb.child.kill('SIGTERM');
    if (prevCi === undefined) delete process.env.CI; else process.env.CI = prevCi;
    if (prevDisplay === undefined) delete process.env.DISPLAY; else process.env.DISPLAY = prevDisplay;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
