'use strict';

/**
 * src/mcp_orphan_guard.js — self-exit watchdog for the konoha MCP server.
 *
 * The server's only built-in exit is the stdio readline "close" event, which
 * fires when the client's stdin closes. Two paths leave a server with no
 * client behind:
 * - stdio mode: the client dies but stdin never closes (inherited stdio, or
 *   the pipe write-end is held open by another process). The server then
 *   lingers forever (~1.4 GB per instance). Detect the dead parent directly:
 *   on Linux/macOS a dead parent reparents the child to init (PPID 1). On
 *   Windows the PPID does not reparent, so a bounded idle timeout is the
 *   safety net: no request line for the whole idle budget means no client
 *   is using this server.
 * - daemon mode (KONOHA_DAEMON=true): the gateway daemon is spawned detached
 *   with stdio ignored, so there is no stdin to close and no parent to watch
 *   (the spawner exits immediately by design). A daemon is superseded when a
 *   newer daemon writes its PID to bridge.pid; the older one must exit, or
 *   daemons accumulate (one per init / gateway restart).
 *
 * Tunables live in bin/lib/config_defaults.js (read via ./config_access so
 * the flat ~/.konoha mirror works). The KONOHA_MCP_* env vars are a test
 * seam only; they are not user-facing configuration.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { getConfigValue } = require('./config_access');

function envInt(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
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

function readPidFile(pidFile) {
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch (_) {
    return null;
  }
}

function writePidFile(pidFile, pid) {
  try {
    fs.writeFileSync(pidFile, String(pid));
    return true;
  } catch (_) {
    return false;
  }
}

function defaultPidFile() {
  return path.join(os.homedir(), '.konoha', 'bridge.pid');
}

function defaultOnExit(reason) {
  process.stderr.write(`[mcp konoha] orphan guard: exiting (${reason})\n`);
  process.exit(0);
}

/**
 * Start the stdio-mode watchdog. Exits when the parent is gone (PPID 1 on
 * Linux/macOS) or when no request line arrived for the whole idle budget.
 * Returns { noteActivity, stop }.
 */
function startStdioOrphanGuard(options = {}) {
  const pollMs = options.pollMs || envInt('KONOHA_MCP_ORPHAN_POLL_MS')
    || getConfigValue('mcp_orphan_parent_poll_ms', 30000);
  const idleMs = options.idleMs || envInt('KONOHA_MCP_STDIO_IDLE_MS')
    || getConfigValue('mcp_stdio_idle_timeout_ms', 14400000);
  const onExit = options.onExit || defaultOnExit;
  let lastActivity = Date.now();
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    if (process.ppid === 1) {
      stop();
      onExit('parent process is gone (reparented to init)');
      return;
    }
    if (Date.now() - lastActivity > idleMs) {
      stop();
      onExit(`no client activity for ${idleMs} ms`);
    }
  }, pollMs);
  if (typeof timer.unref === 'function') timer.unref();
  function stop() {
    stopped = true;
    clearInterval(timer);
  }
  return {
    noteActivity() { lastActivity = Date.now(); },
    stop
  };
}

/**
 * Start the daemon-mode watchdog. At startup, claim bridge.pid (exit if a
 * different live daemon already owns it); then poll it — if a newer daemon
 * wrote its PID, this one is superseded and exits. Returns { stop }.
 */
function startDaemonOrphanGuard(options = {}) {
  const pollMs = options.pollMs || envInt('KONOHA_MCP_DAEMON_POLL_MS')
    || getConfigValue('mcp_daemon_superseded_poll_ms', 30000);
  const pidFile = options.pidFile || process.env.KONOHA_MCP_BRIDGE_PID_FILE || defaultPidFile();
  const onExit = options.onExit || defaultOnExit;
  const myPid = process.pid;
  const owner = readPidFile(pidFile);
  if (owner !== null && owner !== myPid && pidAlive(owner)) {
    onExit(`another gateway daemon (pid ${owner}) already owns ${pidFile}`);
    return { stop() {} };
  }
  writePidFile(pidFile, myPid);
  let stopped = false;
  function checkSuperseded() {
    if (stopped) return;
    const current = readPidFile(pidFile);
    if (current === null || current === myPid) return;
    if (!pidAlive(current)) {
      // The pid file names a dead daemon; reclaim it so a later daemon
      // does not mistake this live one for the stale entry.
      writePidFile(pidFile, myPid);
      return;
    }
    stop();
    onExit(`superseded by gateway daemon pid ${current}`);
  }
  const timer = setInterval(checkSuperseded, pollMs);
  if (typeof timer.unref === 'function') timer.unref();
  function stop() {
    stopped = true;
    clearInterval(timer);
  }
  return { stop };
}

module.exports = { startStdioOrphanGuard, startDaemonOrphanGuard, pidAlive, readPidFile };
