#!/usr/bin/env node
'use strict';
/**
 * tests/test_mcp_orphan_guard.js — regression test for the orphaned MCP
 * server leak (a konoha user had 6 file_tools_mcp.js processes, 1.4 GB each,
 * with no client IDE/CLI open; PID 2792 on this VM was a live orphan, PPID 1,
 * 40+ min, spawned by an init/upgrade flow and never exited).
 *
 * The server's only built-in exit is the stdio readline "close" event. The
 * guard (src/mcp_orphan_guard.js) adds two more exits, proven here:
 * - T1 (behavioral): a stdio server whose stdin never closes exits on the
 *   idle timeout.
 * - T2 (behavioral): a stdio server whose parent dies (reparented to init,
 *   PPID 1) exits on the parent-death poll — even though stdin never closes.
 * - T3 (unit): a daemon whose bridge.pid is taken over by a newer live
 *   daemon exits as superseded.
 * - T4 (unit): a daemon that starts while a different live daemon already
 *   owns bridge.pid exits immediately (startup singleton).
 * - T5 (unit): the stdio idle timeout fires when no request line arrives.
 *
 * T1/T2 spawn the real server as a child process with small poll/idle
 * budgets via the KONOHA_MCP_* test seam env vars. No request is ever sent,
 * so the only exit path is the guard. The temp pid file is used for T3/T4
 * (never the real ~/.konoha/bridge.pid).
 */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVER_PATH = path.join(ROOT, 'src', 'file_tools_mcp.js');
const GUARD_PATH = path.join(ROOT, 'src', 'mcp_orphan_guard.js');

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `${name} — ${detail || ''}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function pidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

function waitFor(cond, timeoutMs, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      if (cond()) return resolve(true);
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  // T1: stdio server, stdin held open forever, exits on the idle timeout.
  {
    const child = spawn(process.execPath, [SERVER_PATH], {
      stdio: ['pipe', 'ignore', 'ignore'],
      env: Object.assign({}, process.env, {
        KONOHA_DAEMON: 'false',
        KONOHA_MCP_ORPHAN_POLL_MS: '200',
        KONOHA_MCP_STDIO_IDLE_MS: '2000'
      })
    });
    try {
      assert.ok(pidAlive(child.pid), 'T1 server started');
      // Never write to stdin and never close it: the readline "close" exit
      // cannot fire, so only the idle guard can end this process.
      const exited = await waitFor(() => !pidAlive(child.pid), 15000);
      ok('T1: stdio server with never-closing stdin exits on idle timeout', exited);
    } finally {
      try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
      try { child.stdin.destroy(); } catch (_) { /* ignore */ }
    }
  }

  // T2: stdio server orphaned by a dying parent (PPID 1) exits on the
  // parent-death poll, even though stdin never closes.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-orphan-'));
  try {
    const helperPath = path.join(tmp, 'spawn_and_exit.js');
    const pidFile = path.join(tmp, 'server.pid');
    fs.writeFileSync(helperPath, `'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const child = spawn(process.execPath, [process.argv[2]], {
  stdio: ['inherit', 'ignore', 'ignore'],
  env: process.env
});
fs.writeFileSync(process.argv[3], String(child.pid));
child.unref();
process.exit(0);
`);
    // The test holds the write end of this pipe, so the server's inherited
    // stdin never reaches EOF — the readline "close" exit cannot fire.
    const parent = spawn(process.execPath, [helperPath, SERVER_PATH, pidFile], {
      stdio: ['pipe', 'ignore', 'ignore'],
      env: Object.assign({}, process.env, {
        KONOHA_DAEMON: 'false',
        KONOHA_MCP_ORPHAN_POLL_MS: '200',
        KONOHA_MCP_STDIO_IDLE_MS: '600000'
      })
    });
    try {
      const gotPid = await waitFor(() => fs.existsSync(pidFile), 15000);
      assert.ok(gotPid, 'T2 helper recorded the server pid');
      const serverPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      assert.ok(pidAlive(serverPid), 'T2 orphaned server is running');
      const exited = await waitFor(() => !pidAlive(serverPid), 20000);
      ok('T2: orphaned stdio server (parent dead, PPID 1) exits', exited);
    } finally {
      try { parent.kill('SIGKILL'); } catch (_) { /* already gone */ }
      try { parent.stdin.destroy(); } catch (_) { /* ignore */ }
      if (fs.existsSync(pidFile)) {
        const p = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
        if (pidAlive(p)) { try { process.kill(p, 'SIGKILL'); } catch (_) { /* ignore */ } }
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // T3/T4/T5: unit-level guard checks (no server spawn, temp pid file).
  const guard = require(GUARD_PATH);
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-orphan-unit-'));
  try {
    // T3: daemon superseded — pid file taken over by a newer live daemon.
    {
      const pidFile = path.join(tmp2, 'bridge.pid');
      let exitedReason = null;
      const g = guard.startDaemonOrphanGuard({
        pidFile,
        pollMs: 100,
        onExit: (reason) => { exitedReason = reason; }
      });
      try {
        assert.strictEqual(
          parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10), process.pid,
          'T3 daemon claims the pid file'
        );
        fs.writeFileSync(pidFile, String(process.pid));
        // A different live pid takes over: this daemon is superseded.
        const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { stdio: 'ignore' });
        try {
          fs.writeFileSync(pidFile, String(other.pid));
          const fired = await waitFor(() => exitedReason !== null, 5000);
          ok('T3: daemon exits when a newer live daemon takes bridge.pid', fired, exitedReason);
        } finally {
          try { other.kill('SIGKILL'); } catch (_) { /* ignore */ }
        }
      } finally {
        g.stop();
      }
    }

    // T4: daemon startup singleton — a different live daemon already owns it.
    {
      const pidFile = path.join(tmp2, 'bridge2.pid');
      const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { stdio: 'ignore' });
      try {
        fs.writeFileSync(pidFile, String(other.pid));
        let exitedReason = null;
        const g = guard.startDaemonOrphanGuard({
          pidFile,
          pollMs: 100,
          onExit: (reason) => { exitedReason = reason; }
        });
        g.stop();
        ok('T4: daemon exits at startup when another live daemon owns bridge.pid', exitedReason !== null, exitedReason);
      } finally {
        try { other.kill('SIGKILL'); } catch (_) { /* ignore */ }
      }
    }

    // T5: stdio idle timeout fires with no activity.
    {
      let exitedReason = null;
      const g = guard.startStdioOrphanGuard({
        pollMs: 100,
        idleMs: 500,
        onExit: (reason) => { exitedReason = reason; }
      });
      try {
        const fired = await waitFor(() => exitedReason !== null, 5000);
        ok('T5: stdio guard exits after the idle budget with no activity', fired, exitedReason);
      } finally {
        g.stop();
      }
    }
  } finally {
    fs.rmSync(tmp2, { recursive: true, force: true });
  }

  console.log(`\ntest_mcp_orphan_guard: ${passed} passed, 0 failed\n`);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
