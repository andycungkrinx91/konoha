#!/usr/bin/env node
'use strict';

/**
 * tests/test_qa_local_browser.js — QA runs the project's own Playwright on the host.
 * Proves the headed/live QA path never reaches for Docker: a `docker` shim sits
 * first on PATH, records any invocation, and the run must still pass.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { startWebServer } = require('../src/web_server');
const qaTools = require('../src/workflow/qa-automation/qa_tools');
const { createLocalQaFixture } = require('./helpers/local_qa_fixture');
const {
  runLiveBrowserMonitor,
  verifyInteractiveExperienceWithPlaywright
} = require('../src/workflow/jonin-builder/live_browser_monitor');

const REPO_ROOT = path.resolve(__dirname, '..');

function httpCall(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  console.log('Running test_qa_local_browser...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-local-browser-'));
  let srv = null;
  let testPageSrv = null;

  try {
    // The container machinery is gone, not merely unused.
    for (const rel of [
      'src/workflow/qa-automation/browser_session_manager.js',
      'src/workflow/qa-automation/browser_container_agent.js',
      'src/workflow/qa-automation/browser_workspace_security.js',
      'docker/browser-workspace.Dockerfile',
      'docker/browser-workspace-entrypoint.sh'
    ]) {
      assert.ok(!fs.existsSync(path.join(REPO_ROOT, rel)), `${rel} must not exist`);
    }
    assert.strictEqual(qaTools._buildContainerQaExec, undefined);
    assert.throws(
      () => execFileSync(process.execPath, [path.join(REPO_ROOT, 'bin', 'cli.js'), 'browser', 'status'], { encoding: 'utf8', stdio: 'pipe' }),
      'the removed `konoha browser` command must not resolve'
    );
    console.log('  ✓ container modules, image, and CLI command removed');

    // A real suite: the project's own Playwright, headed requested, no Docker anywhere.
    const fixture = createLocalQaFixture({
      tmpDir,
      specSource: `const { test, expect } = require('@playwright/test');\ntest('runs on the host', async () => { expect(1 + 1).toBe(2); });\n`
    });
    const { proj, shimDir } = fixture;
    const prevPath = process.env.PATH;
    const prevCi = process.env.CI;
    process.env.PATH = shimDir + path.delimiter + prevPath;
    process.env.CI = '1';
    let qaRes;
    try {
      qaRes = await qaTools.qaE2eRunAsync({ project_path: proj, headed: true });
    } finally {
      process.env.PATH = prevPath;
      if (prevCi === undefined) delete process.env.CI;
      else process.env.CI = prevCi;
    }
    assert.strictEqual(qaRes.status, 'passed', `local QA run failed: ${JSON.stringify(qaRes).slice(0, 600)}`);
    assert.strictEqual(qaRes.totals.passed, 1);
    assert.strictEqual(fixture.dockerCalls(), '', 'QA must never spawn docker');
    assert.strictEqual(qaRes.headed, false, 'CI keeps the run headless even when headed is requested');
    assert.ok(!('live' in qaRes), 'no container-run flag belongs in the report');
    assert.ok(!('session_id' in qaRes) && !('viewer_url' in qaRes), 'no container session belongs in the report');
    console.log('  ✓ QA ran the local Playwright suite with no docker process');

    // Nothing answers on 127.0.0.1:4173 here, and no container is invented for it.
    assert.strictEqual(fixture.dockerCalls(), '');
    console.log('  ✓ no container was created for QA execution');

    // Activity API keeps its auth contract and no longer ships container sessions.
    srv = await startWebServer({ port: 14219, host: '127.0.0.1' });
    const unauthActivity = await httpCall({
      hostname: '127.0.0.1', port: 14219,
      path: '/api/v1/activity/live',
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    assert.strictEqual(unauthActivity.status, 401, '/api/v1/activity/live must fail closed for unauthenticated browser requests');
    const authActivity = await httpCall({
      hostname: '127.0.0.1', port: 14219,
      path: '/api/v1/activity/live',
      method: 'GET',
      headers: { 'X-Konoha-Web-Token': srv.token }
    });
    assert.strictEqual(authActivity.status, 200);
    const activityJson = JSON.parse(authActivity.body);
    assert.ok(!('browser_sessions' in activityJson), 'container browser sessions are gone from the live payload');
    assert.ok(Array.isArray(activityJson.graph.nodes), 'the activity graph still ships');
    const unauthPost = await httpCall({
      hostname: '127.0.0.1', port: 14219,
      path: '/api/v1/activity/ping',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {});
    assert.strictEqual(unauthPost.status, 403, 'POST without CSRF token must return 403');
    console.log('  ✓ activity API auth/CSRF intact, browser_sessions removed');

    // Missing Playwright still fails closed; mock reports keep the capped shape.
    const noPwProj = path.join(tmpDir, 'no_pw_proj');
    fs.mkdirSync(noPwProj, { recursive: true });
    const blockedRes = await qaTools.qaE2eRunAsync({ project_path: noPwProj });
    assert.strictEqual(blockedRes.error, 'qa_blocked');
    assert.strictEqual(blockedRes.reason, 'playwright-not-installed');
    const prevCiMock = process.env.CI;
    process.env.CI = '1';
    try {
      const ciReport = await qaTools.qaE2eRunAsync({
        project_path: noPwProj,
        headed: true,
        mock_report: { config: { testDir: 'e2e' }, suites: [{ title: 's', specs: [{ title: 'ok', tests: [{ status: 'expected', results: [{ duration: 12 }] }] }] }] }
      });
      assert.strictEqual(ciReport.status, 'passed');
      assert.ok(ciReport.run_id.startsWith('qa-'));
    } finally {
      if (prevCiMock === undefined) delete process.env.CI;
      else process.env.CI = prevCiMock;
    }
    console.log('  ✓ blocked state and report preservation unchanged');

    // Jonin's monitor opens the system browser only; no workspace launch path remains.
    const htmlFixture = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="generator" content="Build by konoha" />
  <title>Live Rendering Test</title>
  <style>
    body { margin: 0; font-family: sans-serif; }
    main { min-height: 100dvh; display: grid; grid-template-columns: 1fr; padding: 16px; }
    @media (prefers-reduced-motion: reduce) { * { transition: none; } }
  </style>
</head>
<body>
  <main data-page-transition="ready" data-choreography="staggerChildren:50ms">
    <button id="open-dlg" data-gesture-surface="true" data-spring-physics="stiffness:200,damping:20" data-layout-state="closed">Open Menu</button>
    <div id="dlg" role="dialog" hidden>Dialog Open</div>
    <canvas data-3d-stage="true" data-scroll-story="true" width="320" height="180"></canvas>
  </main>
  <footer>Build by konoha</footer>
  <script>
    const btn = document.getElementById('open-dlg');
    const dlg = document.getElementById('dlg');
    btn.addEventListener('click', () => { dlg.hidden = false; btn.setAttribute('data-layout-state', 'open'); });
    const c = document.querySelector('canvas');
    c.addEventListener('mousemove', () => c.setAttribute('data-pointer-active', 'true'));
    const gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
    if (gl) { gl.clearColor(0.1, 0.2, 0.3, 1.0); gl.clear(gl.COLOR_BUFFER_BIT); }
  </script>
</body>
</html>`;
    testPageSrv = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlFixture);
    });
    await new Promise((r) => testPageSrv.listen(0, '127.0.0.1', r));
    const appUrl = `http://127.0.0.1:${testPageSrv.address().port}/`;

    const monitorRes = await runLiveBrowserMonitor({ url: appUrl, headless: false, buildId: 'live-build-42' });
    assert.strictEqual(monitorRes.status, 'passed');
    assert.strictEqual(monitorRes.build_id, 'live-build-42');
    assert.strictEqual(monitorRes.fresh, true);
    assert.ok(monitorRes.browser_launch && 'opened' in monitorRes.browser_launch, 'the monitor reports a host browser launch');
    assert.ok(!('workspace_session' in monitorRes) && !('workspace_evidence' in monitorRes), 'no workspace session in the monitor result');
    assert.strictEqual(fixture.dockerCalls(), '', 'the monitor must never spawn docker');

    const pwRes = await verifyInteractiveExperienceWithPlaywright(appUrl, { requireMotionAnd3d: false });
    assert.strictEqual(pwRes.passed, true, `Playwright verification failed: ${JSON.stringify(pwRes)}`);
    assert.strictEqual(pwRes.responsive_viewports.length, 3);
    assert.strictEqual(pwRes.reduced_motion_verified, true);
    console.log(`  ✓ host browser monitor + real Playwright rendering passed (webgl=${pwRes.canvas_3d.webglSupported})`);
  } finally {
    if (testPageSrv) await new Promise((r) => testPageSrv.close(r));
    if (srv && srv.server) await new Promise((r) => srv.server.close(r));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
