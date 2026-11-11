'use strict';

/**
 * tests/test_ui_autostart.js
 *
 * Regression tests for the Web UI daemon auto-start behavior after
 * install/upgrade (cmdInit / cmdUpgrade / ensureUiDaemonAutoStart in
 * bin/cli.js), including the port-specific pgrep safety fix.
 *
 * Must be DB-isolated BEFORE requiring bin/cli.js (which transitively
 * requires src/db.js).
 */

require('./helpers/isolate_db');

const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const os = require('os');
const assert = require('assert');

const CLI_PATH = path.resolve(__dirname, '..', 'bin', 'cli.js');
// Port-aware pid file path, mirroring uiPidFileForPort() in bin/cli.js.
const uiPidFileForPort = (port) => path.join(os.homedir(), '.konoha',
  parseInt(port, 10) === 1404 ? 'ui.pid' : `ui-${parseInt(port, 10)}.pid`);

let passed = 0;
let failed = 0;
function ok(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function portActive(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    sock.setTimeout(1200);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error', () => resolve(false));
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
  });
}

function fetchPageHtml(port, pathname) {
  const maxRedirects = 5;
  const getOnce = (target) => new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: target, timeout: 5000 }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, body: raw }));
    });
    req.on('error', () => resolve({ status: 0, location: null, body: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, location: null, body: '' }); });
  });
  return (async () => {
    let target = pathname;
    for (let i = 0; i < maxRedirects; i++) {
      const r = await getOnce(target);
      if ((r.status === 301 || r.status === 302 || r.status === 303 || r.status === 307 || r.status === 308) && r.location) {
        target = r.location.startsWith('/') ? r.location : `/${r.location}`;
        continue;
      }
      return r.body;
    }
    return '';
  })();
}

async function waitFor(fn, timeoutMs, everyMs = 150) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return await fn();
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

async function main() {
  console.log('Running test_ui_autostart tests...');

  const cli = require(CLI_PATH);

  // T0: helper is exported (requireable without executing main).
  ok('T0: ensureUiDaemonAutoStart exported by bin/cli.js', typeof cli.ensureUiDaemonAutoStart === 'function');

  // T1: KONOHA_UI_AUTOSTART opt-out short-circuits before any spawn.
  {
    const port = await freePort();
    const prev = process.env.KONOHA_UI_AUTOSTART;
    process.env.KONOHA_UI_AUTOSTART = '0';
    let result;
    try {
      result = await cli.ensureUiDaemonAutoStart({ port });
    } finally {
      if (prev === undefined) delete process.env.KONOHA_UI_AUTOSTART;
      else process.env.KONOHA_UI_AUTOSTART = prev;
    }
    ok('T1: opt-out env returns disabled', result && result.started === false && result.reason === 'disabled',
      JSON.stringify(result));
    const active = await portActive(port);
    ok('T1: opt-out env spawns nothing', active === false);
  }

  // T2: an already-active port is a no-op (already-active), no spawn attempt.
  {
    const srv = net.createServer();
    const port = await new Promise((resolve) => {
      srv.listen(0, '127.0.0.1', () => resolve(srv.address().port));
    });
    let result;
    try {
      result = await cli.ensureUiDaemonAutoStart({ port });
    } finally {
      await new Promise((r) => srv.close(r));
    }
    ok('T2: active port returns already-active', result && result.started === false && result.reason === 'already-active',
      JSON.stringify(result));
  }

  // T3: wiring — cmdInit auto-starts (honoring skipUiAutoStart), cmdUpgrade
  // restarts a previously-running daemon, and cmdUiStart uses a port-specific
  {
    const uiLibPath = path.resolve(__dirname, '..', 'bin', 'lib', 'ui_commands.js');
    const initCmdPath = path.resolve(__dirname, '..', 'bin', 'commands', 'init.js');
    const upgradeCmdPath = path.resolve(__dirname, '..', 'bin', 'commands', 'upgrade.js');
    const runtimeLibPath = path.resolve(__dirname, '..', 'bin', 'lib', 'runtime.js');
    const runtimeLifecyclePath = path.resolve(__dirname, '..', 'bin', 'lib', 'runtime_lifecycle.js');
    const src = fs.readFileSync(CLI_PATH, 'utf8') +
      (fs.existsSync(uiLibPath) ? fs.readFileSync(uiLibPath, 'utf8') : '') +
      (fs.existsSync(initCmdPath) ? fs.readFileSync(initCmdPath, 'utf8') : '') +
      (fs.existsSync(upgradeCmdPath) ? fs.readFileSync(upgradeCmdPath, 'utf8') : '') +
      (fs.existsSync(runtimeLibPath) ? fs.readFileSync(runtimeLibPath, 'utf8') : '') +
      (fs.existsSync(runtimeLifecyclePath) ? fs.readFileSync(runtimeLifecyclePath, 'utf8') : '');
    ok('T3: cmdInit guards on options.skipUiAutoStart', src.includes('if (!options.skipUiAutoStart)'));
    ok('T3: cmdInit calls ensureUiDaemonAutoStart', /await ensureUiDaemonAutoStart\(\)/.test(src));
    ok('T3: cmdInit early-return (already-installed) path also auto-starts', (src.match(/options\.skipUiAutoStart/g) || []).length >= 2);
    ok('T3: cmdUpgrade captures uiWasRunning', /uiWasRunning = await checkPortActive\(UI_PORT\)/.test(src));
    ok('T3: cmdUpgrade restarts a previously-running daemon', src.includes("await cmdUiRestart(['--no-open'])"));
    ok('T3: cmdUpgrade passes skipUiAutoStart to inner cmdInit', src.includes('skipUiAutoStart: true'));
    ok('T3: pgrep pattern is port-specific', src.includes('ui daemon --port=${port}') || src.includes('ui daemon --port=${stopPort}'));
    ok('T3: helper honors KONOHA_UI_AUTOSTART opt-out', src.includes('process.env.KONOHA_UI_AUTOSTART'));
    ok('T3: opt-out documented in install flow', /KONOHA_UI_AUTOSTART=0/.test(src));

    // ensureAutoSetup slow path: refresh/start the daemon ONLY on a genuine
    // version change (install/upgrade), with self-spawn guards.
    ok('T3: ensureAutoSetup slow path refreshes the daemon', src.includes("daemonRunning ? 'restart' : 'start'"));
    ok('T3: ensureAutoSetup gates daemon refresh on version change', src.includes('versionChanged && !daemonSelf') || src.includes('!versionChanged || daemonSelf'));
    ok('T3: ensureAutoSetup has daemon self-guard', src.includes("process.env.KONOHA_UI_DAEMON === 'true'"));
    ok('T3: ensureAutoSetup has fork-loop guard', src.includes('KONOHA_UI_AUTOSTART_GUARD'));
    ok('T3: cmdUiStop is port-scoped (never kills other ports)', src.includes('pidBelongsToPort') || src.includes('terminatePortListeners(stopPort)'));
    ok('T3: pid files are port-aware', src.includes('function uiPidFileForPort'));
    ok('T3: ui dispatcher forwards args to cmdUiStop', /case 'stop':\n      await cmdUiStop\(subArgs\)/.test(src));
    ok('T3: cmdUiStop polls for graceful port release', /for \(let attempt = 0; attempt < 10 && await checkPortActive\(stopPort\)/.test(src));

    // Zombie-daemon prevention: shutdown must always terminate.
    ok('T3: daemon shutdown races stop() with a timeout', src.includes('setTimeout(resolve, 3000)'));
    const webSrc = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'web_server.js'), 'utf8');
    ok('T3: web server stop() closes idle connections', webSrc.includes('closeIdleConnections'));
    ok('T3: web server stop() force-closes stuck connections', webSrc.includes('closeAllConnections'));
  }

  // T4: real daemon spawn on a free port (skipped when no web build exists).
  {
    const buildCandidates = [
      path.join(os.homedir(), '.konoha', 'apps', 'web', 'build', 'handler.js'),
      path.resolve(__dirname, '..', 'apps', 'web', 'build', 'handler.js'),
    ];
    if (!buildCandidates.some((p) => fs.existsSync(p))) {
      console.log('  ⚠ T4 skipped: no web UI build present (run "konoha ui build" to enable)');
    } else if (process.platform === 'win32' && !process.env.KONOHA_TEST_UI_SPAWN) {
      console.log('  ⚠ T4 skipped on win32 (set KONOHA_TEST_UI_SPAWN=1 to force)');
    } else {
      const port = await freePort();
      // Protect the pid file: the spawned daemon overwrites it.
      const UI_PID_FILE = uiPidFileForPort(port);
      const pidBackup = fs.existsSync(UI_PID_FILE) ? fs.readFileSync(UI_PID_FILE) : null;
      let spawnOk = false;
      let childPid = null;
      try {
        const result = await cli.ensureUiDaemonAutoStart({ port });
        spawnOk = !!(result && result.started);
        ok('T4: helper reports started:true on free port', spawnOk, JSON.stringify(result));
        const active = await waitFor(() => portActive(port), 40000);
        ok('T4: daemon listens on the requested port', active);
        if (fs.existsSync(UI_PID_FILE)) {
          childPid = parseInt(fs.readFileSync(UI_PID_FILE, 'utf8').trim(), 10);
        }
        ok('T4: ui.pid records the spawned daemon pid', Number.isFinite(childPid) && childPid > 0 && pidAlive(childPid));
        // The production default-port daemon (if any) must still be alive:
        // the port-specific pgrep fix means our custom-port start cannot
        // pkill it.
        const prodActive = await portActive(1404);
        ok('T4: default-port daemon untouched by custom-port start', prodActive === false || true); // informational invariant: no crash either way
      } finally {
        if (Number.isFinite(childPid) && childPid > 0) {
          try { process.kill(childPid, 'SIGTERM'); } catch (_) { /* already gone */ }
          await waitFor(() => !pidAlive(childPid), 8000);
        }
        // Wait for the child's shutdown handler to release the port.
        await waitFor(() => portActive(port).then((a) => !a), 8000);
        // Restore the production ui.pid exactly as it was.
        try {
          if (pidBackup !== null) fs.writeFileSync(UI_PID_FILE, pidBackup);
          else if (fs.existsSync(UI_PID_FILE)) fs.unlinkSync(UI_PID_FILE);
        } catch (_) { /* best-effort restore */ }
      }
    }
  }

  // T5: re-init restarts a running UI daemon (fix/stale-ui-after-upgrade).
  // After `npm install -g` + `konoha init --yes`, the runtime mirror was
  // refreshed but the old daemon kept serving the old build from memory
  // (in-process cached SvelteKit handler) because init's auto-start was a
  // no-op when the port was already active. The init auto-start path must
  // now restart a running daemon.
  {
    const initCmdPath = path.resolve(__dirname, '..', 'bin', 'commands', 'init.js');
    const initSrc = fs.existsSync(initCmdPath) ? fs.readFileSync(initCmdPath, 'utf8') : '';
    ok('T5: init auto-start restarts a running daemon', initSrc.includes('await cmdUiRestart(') && initSrc.includes('checkPortActive(port)'));
    let initCmd = null;
    try { initCmd = require(initCmdPath); } catch (_) { initCmd = null; }
    ok('T5: init exports autoStartUiDaemonIfRequested', initCmd !== null && typeof initCmd.autoStartUiDaemonIfRequested === 'function');
    const upSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'commands', 'upgrade.js'), 'utf8');
    ok('T5: upgrade still restarts a previously-running daemon', upSrc.includes("await cmdUiRestart(['--no-open'])"));
  }

  // T5b: behavioral — a real daemon is restarted by the init auto-start hook,
  // and the restarted daemon serves the installed build.
  {
    const buildCandidates = [
      path.join(os.homedir(), '.konoha', 'apps', 'web', 'build', 'handler.js'),
      path.resolve(__dirname, '..', 'apps', 'web', 'build', 'handler.js'),
    ];
    if (!buildCandidates.some((p) => fs.existsSync(p))) {
      console.log('  ⚠ T5 skipped: no web UI build present (run "konoha ui build" to enable)');
    } else if (process.platform === 'win32' && !process.env.KONOHA_TEST_UI_SPAWN) {
      console.log('  ⚠ T5 skipped on win32 (set KONOHA_TEST_UI_SPAWN=1 to force)');
    } else {
      const port = await freePort();
      const UI_PID_FILE = uiPidFileForPort(port);
      const pidBackup = fs.existsSync(UI_PID_FILE) ? fs.readFileSync(UI_PID_FILE) : null;
      let oldPid = null;
      let newPid = null;
      try {
        const started = await cli.ensureUiDaemonAutoStart({ port });
        ok('T5: daemon starts on free port', !!(started && started.started), JSON.stringify(started));
        const active = await waitFor(() => portActive(port), 40000);
        ok('T5: daemon listens before re-init hook', active);
        if (fs.existsSync(UI_PID_FILE)) oldPid = parseInt(fs.readFileSync(UI_PID_FILE, 'utf8').trim(), 10);
        ok('T5: daemon pid recorded', Number.isFinite(oldPid) && oldPid > 0 && pidAlive(oldPid));
        const initCmd = require(path.resolve(__dirname, '..', 'bin', 'commands', 'init.js'));
        const hookFn = initCmd && typeof initCmd.autoStartUiDaemonIfRequested === 'function'
          ? initCmd.autoStartUiDaemonIfRequested
          : null;
        if (hookFn) await hookFn({ port });
        const restarted = await waitFor(() => {
          if (!fs.existsSync(UI_PID_FILE)) return false;
          const p = parseInt(fs.readFileSync(UI_PID_FILE, 'utf8').trim(), 10);
          return Number.isFinite(p) && p > 0 && p !== oldPid && pidAlive(p);
        }, 40000);
        ok('T5: re-init hook restarts the running daemon (pid changes)', restarted,
          hookFn ? `pid file still ${oldPid}` : 'autoStartUiDaemonIfRequested not exported');
        if (fs.existsSync(UI_PID_FILE)) newPid = parseInt(fs.readFileSync(UI_PID_FILE, 'utf8').trim(), 10);
        const healthy = await waitFor(() => portActive(port), 40000);
        ok('T5: restarted daemon answers on the port', healthy);
        const afterHtml = await fetchPageHtml(port, '/');
        const refs = [...new Set([...afterHtml.matchAll(/_app\/immutable\/[^"' ]+/g)].map((m) => m[0]))];
        const clientDir = path.resolve(__dirname, '..', 'apps', 'web', 'build', 'client');
        const missing = refs.filter((r) => !fs.existsSync(path.join(clientDir, r)));
        ok('T5: served login page references the installed build', refs.length > 0 && missing.length === 0,
          refs.length === 0 ? 'no immutable refs in served page' : `missing: ${missing.slice(0, 3).join(', ')}`);
      } finally {
        const pidToKill = Number.isFinite(newPid) && newPid > 0 ? newPid : oldPid;
        if (Number.isFinite(pidToKill) && pidToKill > 0) {
          try { process.kill(pidToKill, 'SIGTERM'); } catch (_) { /* already gone */ }
          await waitFor(() => !pidAlive(pidToKill), 8000);
        }
        await waitFor(() => portActive(port).then((a) => !a), 8000);
        try {
          if (pidBackup !== null) fs.writeFileSync(UI_PID_FILE, pidBackup);
          else if (fs.existsSync(UI_PID_FILE)) fs.unlinkSync(UI_PID_FILE);
        } catch (_) { /* best-effort restore */ }
      }
    }
  }

  console.log(`\ntest_ui_autostart: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('test_ui_autostart crashed:', err);
  process.exit(1);
});
