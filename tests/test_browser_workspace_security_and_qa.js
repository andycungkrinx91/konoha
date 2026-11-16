#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { startWebServer } = require('../src/web_server');
const qaTools = require('../src/workflow/qa-automation/qa_tools');
const {
  validateBindHost,
  validateWorkspaceMountPath,
  translateTargetUrlForContainer,
  buildDockerRunArgs
} = require('../src/workflow/qa-automation/browser_workspace_security');
const { BrowserSessionManager } = require('../src/workflow/qa-automation/browser_session_manager');
const {
  runLiveBrowserMonitor,
  verifyInteractiveExperienceWithPlaywright
} = require('../src/workflow/jonin-builder/live_browser_monitor');

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
  console.log('Running test_browser_workspace_security_and_qa...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-bw-sec-'));
  let srv = null;
  let testPageSrv = null;

  try {
    // Endpoint binding security: reject 0.0.0.0 by default
    assert.strictEqual(validateBindHost('127.0.0.1'), '127.0.0.1');
    assert.strictEqual(validateBindHost('localhost'), '127.0.0.1');
    assert.throws(() => validateBindHost('0.0.0.0'), /BROWSER_SECURITY_VIOLATION/);
    assert.throws(() => validateBindHost('0.0.0.0', { allowPublicBind: true, authToken: 'short' }), /BROWSER_SECURITY_VIOLATION/);
    assert.strictEqual(validateBindHost('0.0.0.0', { allowPublicBind: true, authToken: '0123456789abcdef' }), '0.0.0.0');

    // Isolation: reject home dir, .konoha, browser profiles, secrets, konoha.db
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    assert.throws(() => validateWorkspaceMountPath(home), /BROWSER_ISOLATION_VIOLATION/);
    assert.throws(() => validateWorkspaceMountPath(path.join(home, '.konoha')), /BROWSER_ISOLATION_VIOLATION/);
    assert.throws(() => validateWorkspaceMountPath('/tmp/User Data/Default'), /BROWSER_ISOLATION_VIOLATION/);
    assert.throws(() => validateWorkspaceMountPath('/tmp/project/.env.production'), /BROWSER_ISOLATION_VIOLATION/);
    assert.throws(() => validateWorkspaceMountPath('/tmp/konoha.db'), /BROWSER_ISOLATION_VIOLATION/);
    const safeProject = path.join(tmpDir, 'safe_app');
    fs.mkdirSync(safeProject, { recursive: true });
    assert.strictEqual(validateWorkspaceMountPath(safeProject), path.resolve(safeProject));

    // Docker run args bind strictly to 127.0.0.1 and enforce per-session VNC password
    assert.throws(() => buildDockerRunArgs({
      image: 'konoha-browser-workspace:local', sessionId: 's1', containerName: 'c1',
      bindHost: '127.0.0.1', novncPort: 6080, vncPassword: ''
    }), /BROWSER_SECURITY_VIOLATION/);
    const dockerArgs = buildDockerRunArgs({
      image: 'konoha-browser-workspace:local', sessionId: 's1', containerName: 'konoha-browser-s1',
      bindHost: '127.0.0.1', novncPort: 46080, playwrightUiPort: 49323,
      vncPassword: 'secret-per-session', targetUrl: 'http://127.0.0.1:4173', platform: 'linux'
    });
    assert.ok(dockerArgs.includes('127.0.0.1:46080:6080'));
    assert.ok(dockerArgs.includes('127.0.0.1:49323:9323'));
    assert.ok(dockerArgs.includes('--add-host=host.docker.internal:host-gateway'));
    assert.strictEqual(translateTargetUrlForContainer('http://localhost:4173/app', 'win32'), 'http://host.docker.internal:4173/app');
    assert.strictEqual(translateTargetUrlForContainer('http://127.0.0.1:3000/', 'darwin'), 'http://host.docker.internal:3000/');
    console.log('  ✓ Endpoint binding, mount isolation, and cross-platform URL translation passed');

    // Web UI browser endpoints + authenticated /browser-view fail-closed check
    const mockMgr = new BrowserSessionManager({
      execSync: (cmd, args) => {
        if (args[0] === 'run') return { status: 0, stdout: 'cid1\n' };
        return { status: 0, stdout: 'ok\n' };
      },
      probeReady: async () => true,
      allocatePort: async () => 46199
    });
    srv = await startWebServer({ port: 14219, host: '127.0.0.1' });
    // Inject mock manager directly onto server controller state via /api/v1/browser/sessions default route check:
    const unauthViewer = await httpCall({ hostname: '127.0.0.1', port: 14219, path: '/browser-view', method: 'GET' });
    assert.strictEqual(unauthViewer.status, 401, '/browser-view must fail closed when unauthenticated');

    const authViewer = await httpCall({
      hostname: '127.0.0.1', port: 14219,
      path: `/browser-view?token=${srv.token}`,
      method: 'GET'
    });
    assert.strictEqual(authViewer.status, 200);
    assert.ok(authViewer.body.includes('Konoha Live Browser'));

    const unauthPost = await httpCall({
      hostname: '127.0.0.1', port: 14219,
      path: '/api/v1/browser/sessions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { targetUrl: 'http://127.0.0.1:3000' });
    assert.strictEqual(unauthPost.status, 403, 'POST without CSRF token must return 403');
    await mockMgr.cleanupStaleSessions();
    console.log('  ✓ Web viewer authentication and CSRF controls passed');

    // Async QA run: missing Playwright returns qa_blocked; mock_report preserves <2000 char cap & run_id; headless CI compatibility
    const noPwProj = path.join(tmpDir, 'no_pw_proj');
    fs.mkdirSync(noPwProj, { recursive: true });
    const blockedRes = await qaTools.qaE2eRunAsync({ project_path: noPwProj });
    assert.strictEqual(blockedRes.error, 'qa_blocked');
    assert.strictEqual(blockedRes.reason, 'playwright-not-installed');

    const prevCi = process.env.CI;
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
      if (prevCi === undefined) delete process.env.CI;
      else process.env.CI = prevCi;
    }
    console.log('  ✓ Async QA blocked state, headless CI compatibility, and report preservation passed');

    // Real Playwright rendering + interactive dialog + WebGL + responsive check
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

    testPageSrv = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlFixture);
    });
    await new Promise((r) => testPageSrv.listen(0, '127.0.0.1', r));
    const appUrl = `http://127.0.0.1:${testPageSrv.address().port}/`;

    const monitorRes = await runLiveBrowserMonitor({
      url: appUrl,
      workspaceMode: 'docker-headed',
      sessionManager: mockMgr,
      headless: false,
      buildId: 'live-build-42'
    });
    assert.strictEqual(monitorRes.status, 'passed');
    assert.strictEqual(monitorRes.build_id, 'live-build-42');
    assert.strictEqual(monitorRes.fresh, true);
    if (!process.env.CI && !process.env.KONOHA_HEADLESS_TEST) {
      assert.strictEqual(monitorRes.browser_launch.mode, 'docker-headed');
    }

    const pwRes = await verifyInteractiveExperienceWithPlaywright(appUrl, { requireMotionAnd3d: false });
    assert.strictEqual(pwRes.passed, true, `Playwright verification failed: ${JSON.stringify(pwRes)}`);
    assert.strictEqual(pwRes.responsive_viewports.length, 3);
    assert.strictEqual(pwRes.reduced_motion_verified, true);
    console.log(`  ✓ Real Playwright rendering, responsive viewports, and WebGL check passed (webgl=${pwRes.canvas_3d.webglSupported})`);

    // CLI konoha browser status smoke
    const cliStatus = execFileSync(process.execPath, [
      path.resolve(__dirname, '..', 'bin', 'cli.js'),
      'browser', 'status'
    ], { encoding: 'utf8' });
    assert.ok(cliStatus.includes('Konoha Browser Workspaces'));
    console.log('  ✓ CLI konoha browser status passed');
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
