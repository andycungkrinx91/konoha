#!/usr/bin/env node
'use strict';

const assert = require('assert');
const net = require('net');
const path = require('path');
const { EventEmitter } = require('events');
const { BrowserSessionManager } = require('../src/workflow/qa-automation/browser_session_manager');
const { allocateLoopbackPort } = require('../src/workflow/qa-automation/browser_workspace_security');
const { getHeadedLaunchArgs, parseCliArgs, executeCommand } = require('../src/workflow/qa-automation/browser_container_agent');

function createMockDockerRunner() {
  const calls = [];
  const containers = new Map();

  const execSync = (cmd, args = []) => {
    calls.push({ cmd, args: [...args] });
    if (cmd !== 'docker') return { status: 1, stderr: 'unexpected cmd' };
    const sub = args[0];
    if (sub === 'info') return { status: 0, stdout: '29.5.2\n' };
    if (sub === 'image' && args[1] === 'inspect') return { status: 0, stdout: '[]' };
    if (sub === 'run') {
      const nameIdx = args.indexOf('--name');
      const cname = nameIdx !== -1 ? args[nameIdx + 1] : `mock-${containers.size}`;
      containers.set(cname, { running: true });
      return { status: 0, stdout: `cid_${cname}\n` };
    }
    if (sub === 'exec') {
      const cname = args[1];
      if (!containers.has(cname)) return { status: 1, stderr: 'No such container' };
      const cmdIdx = args.indexOf('--cmd');
      const parsed = cmdIdx !== -1 ? JSON.parse(args[cmdIdx + 1]) : {};
      return {
        status: 0,
        stdout: JSON.stringify({ ok: true, action: parsed.action || 'status', url: parsed.url || 'http://host.docker.internal:3000/' })
      };
    }
    if (sub === 'rm') {
      const target = args[args.length - 1];
      containers.delete(target);
      return { status: 0, stdout: `${target}\n` };
    }
    if (sub === 'ps') {
      return { status: 0, stdout: Array.from(containers.keys()).join('\n') };
    }
    return { status: 0, stdout: '' };
  };

  return { execSync, calls, containers };
}

async function run() {
  console.log('Running test_browser_workspace_lifecycle...');
  const mock = createMockDockerRunner();
  let nextPort = 46100;
  const mgr = new BrowserSessionManager({
    execSync: mock.execSync,
    probeReady: async () => true,
    allocatePort: async () => nextPort++,
    platform: 'linux'
  });

  // Session creation returns host-accessible loopback viewer URL & VNC password
  const s1 = await mgr.createSession({
    purpose: 'frontend-dev',
    projectPath: path.join(__dirname, '..', 'apps', 'web'),
    targetUrl: 'http://127.0.0.1:3000',
    buildId: 'build-1'
  });
  assert.strictEqual(s1.status, 'running');
  assert.strictEqual(s1.headed, true);
  assert.strictEqual(s1.bind_host, '127.0.0.1');
  assert.ok(s1.viewer_url.startsWith('http://127.0.0.1:'));
  assert.ok(s1.vnc_password && s1.vnc_password.length >= 16);
  assert.strictEqual(s1.reused, false);
  assert.ok(mock.containers.has(s1.container_name));
  console.log('  ✓ Headed Docker session creation and viewer URL passed');

  // Session reuse keeps existing browser alive without spawning duplicate container
  const s1Reused = await mgr.createSession({
    purpose: 'frontend-dev',
    projectPath: path.join(__dirname, '..', 'apps', 'web'),
    targetUrl: 'http://127.0.0.1:3000/dashboard',
    buildId: 'build-2',
    reuse: true
  });
  assert.strictEqual(s1Reused.session_id, s1.session_id);
  assert.strictEqual(s1Reused.reused, true);
  assert.strictEqual(s1Reused.build_id, 'build-2');
  assert.strictEqual(mock.containers.size, 1, 'Reused session must keep a single container');

  const interactRes = await mgr.interact(s1.session_id, { action: 'snapshot', scope: 'main' });
  assert.strictEqual(interactRes.ok, true);
  const logRes = mgr.getSessionLogs(s1.session_id);
  assert.ok(logRes.logs.length >= 2);
  console.log('  ✓ Persistent session reuse, interaction, and log streaming passed');

  // Concurrent sessions get distinct containers and distinct loopback ports
  const s2 = await mgr.createSession({
    purpose: 'qa-automation',
    projectPath: path.join(__dirname, '..', 'apps', 'web'),
    targetUrl: 'http://127.0.0.1:4173',
    forceNew: true,
    playwrightUi: true
  });
  assert.notStrictEqual(s2.session_id, s1.session_id);
  assert.notStrictEqual(s2.novnc_port, s1.novnc_port);
  assert.ok(s2.playwright_ui_url && s2.playwright_ui_url.startsWith('http://127.0.0.1:'));
  assert.strictEqual(mgr.listSessions().length, 2);
  console.log('  ✓ Concurrent sessions and Playwright UI endpoint passed');

  // Port conflict handling via allocateLoopbackPort
  const busySrv = net.createServer();
  await new Promise((r) => busySrv.listen(0, '127.0.0.1', r));
  const busyPort = busySrv.address().port;
  const fallbackPort = await allocateLoopbackPort(busyPort);
  assert.notStrictEqual(fallbackPort, busyPort, 'Occupied port must automatically allocate a free loopback port');
  assert.ok(fallbackPort > 0);
  await new Promise((r) => busySrv.close(r));
  console.log('  ✓ Loopback port conflict fallback passed');

  // Cancellation kills child process and removes ONLY cancelled container
  const fakeChild = new EventEmitter();
  fakeChild.killed = false;
  fakeChild.kill = () => { fakeChild.killed = true; };
  mgr.registerChildProcess(s2.session_id, fakeChild);
  const cancelRes = await mgr.cancelSession(s2.session_id, 'user_abort');
  assert.strictEqual(cancelRes.status, 'cancelled');
  assert.strictEqual(fakeChild.killed, true);
  assert.ok(!mock.containers.has(s2.container_name), 'Cancelled container must be removed');
  assert.ok(mock.containers.has(s1.container_name), 'Concurrent sibling container must remain untouched');

  // Stale & orphan container cleanup (no broad prune)
  mock.containers.set('konoha-browser-orphan-999', { running: true });
  const internalS1 = mgr._sessions.get(s1.session_id);
  internalS1.lastActivityMs = Date.now() - (60 * 60 * 1000);
  const cleanup = mgr.cleanupStaleSessions({ maxIdleMs: 1000 });
  assert.ok(cleanup.cleaned_session_ids.includes(s1.session_id));
  assert.ok(cleanup.cleaned_session_ids.includes('orphan-999'));
  assert.strictEqual(mock.containers.size, 0, 'All expired/orphaned konoha-browser containers must be cleaned up');
  console.log('  ✓ Cancellation, failure cleanup, and stale/orphan cleanup passed');

  // Viewer ready timeout must clean up the started container
  const failMgr = new BrowserSessionManager({
    execSync: mock.execSync,
    probeReady: async () => false,
    allocatePort: async () => nextPort++
  });
  await assert.rejects(
    () => failMgr.createSession({ waitForViewer: true, readyTimeoutMs: 100 }),
    /BROWSER_VIEWER_TIMEOUT/
  );
  assert.strictEqual(mock.containers.size, 0, 'Container must be removed on viewer startup failure');
  console.log('  ✓ Failure cleanup on viewer readiness timeout passed');

  // Container agent launch args & command handler contract
  const args = getHeadedLaunchArgs();
  assert.ok(args.includes('--enable-webgl') && args.includes('--use-angle=swiftshader'));
  assert.deepStrictEqual(parseCliArgs(['--serve', '--profile-dir', '/tmp/p']), { serve: true, cmd: null, profileDir: '/tmp/p' });
  const fakePage = {
    url: () => 'http://host.docker.internal:3000/',
    title: async () => 'App',
    setViewportSize: async () => {},
    evaluate: async () => ({ overflowX: false, width: 375, height: 812, title: 'App', supported: true, renderer: 'SwiftShader' })
  };
  const inspectCmd = await executeCommand(fakePage, { buildId: 'b1', consoleErrors: [], pageErrors: [] }, { action: 'inspect' });
  assert.strictEqual(inspectCmd.ok, true);
  assert.strictEqual(inspectCmd.responsive.length, 3);
  assert.strictEqual(inspectCmd.webgl.supported, true);
  console.log('  ✓ Container browser agent WebGL/responsive contract passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
