'use strict';

/**
 * src/workflow/qa-automation/browser_session_manager.js — Host-side lifecycle manager
 * for isolated live headed Docker browser workspaces (create, reuse, interact,
 * streamed logs, timeout cleanup, cancellation, and host-accessible viewer URLs).
 */

const crypto = require('crypto');
const http = require('http');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const {
  validateBindHost,
  validateWorkspaceMountPath,
  allocateLoopbackPort,
  translateTargetUrlForContainer,
  buildDockerRunArgs
} = require('./browser_workspace_security');

const DEFAULT_BROWSER_IMAGE = process.env.KONOHA_BROWSER_IMAGE || 'konoha-browser-workspace:local';
const DEFAULT_IDLE_TIMEOUT_MS = Number(process.env.KONOHA_BROWSER_IDLE_TIMEOUT_MS) || 30 * 60 * 1000;
const DEFAULT_MAX_DURATION_MS = Number(process.env.KONOHA_BROWSER_MAX_DURATION_MS) || 2 * 60 * 60 * 1000;
const MAX_LOG_LINES = 250;

function _probeHttpReady(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 800 }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

class BrowserSessionManager {
  constructor(options = {}) {
    this._sessions = new Map();
    this._activeChildren = new Map();
    this._repoRoot = options.repoRoot || path.resolve(__dirname, '..', '..', '..');
    this._execSync = options.execSync || ((cmd, args, opts) => spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, ...opts }));
    this._spawn = options.spawn || spawn;
    this._probeReady = options.probeReady || _probeHttpReady;
    this._allocatePort = options.allocatePort || allocateLoopbackPort;
    this._platform = options.platform || process.platform;
  }

  isDockerAvailable() {
    try {
      const res = this._execSync('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 4000 });
      return { available: res.status === 0, version: (res.stdout || '').trim() || null };
    } catch (err) {
      return { available: false, version: null, reason: err.message };
    }
  }

  ensureImageBuilt(image = DEFAULT_BROWSER_IMAGE, { autoBuild = false } = {}) {
    const inspect = this._execSync('docker', ['image', 'inspect', image], { timeout: 5000 });
    if (inspect.status === 0) return { ok: true, image, built: false };
    if (!autoBuild) {
      return {
        ok: false,
        reason: 'browser-image-missing',
        image,
        fix: `docker build -f docker/browser-workspace.Dockerfile -t ${image} .`
      };
    }
    const build = this._execSync(
      'docker',
      ['build', '-f', 'docker/browser-workspace.Dockerfile', '-t', image, '.'],
      { cwd: this._repoRoot, timeout: 600000 }
    );
    if (build.status !== 0) {
      return { ok: false, reason: 'browser-image-build-failed', detail: (build.stderr || build.stdout || '').slice(0, 500) };
    }
    return { ok: true, image, built: true };
  }

  _appendLog(session, stream, line) {
    const text = String(line || '').trim();
    if (!text) return;
    session.logs.push({ ts: new Date().toISOString(), stream, text: text.slice(0, 1000) });
    if (session.logs.length > MAX_LOG_LINES) {
      session.logs.splice(0, session.logs.length - MAX_LOG_LINES);
    }
    session.last_activity_at = new Date().toISOString();
    session.lastActivityMs = Date.now();
  }

  _scheduleWatchdog(session) {
    if (session._timer) clearTimeout(session._timer);
    const interval = Math.min(30000, Math.max(50, Math.floor(session.idleTimeoutMs / 2)));
    session._timer = setTimeout(() => {
      const now = Date.now();
      const idleElapsed = now - session.lastActivityMs;
      const totalElapsed = now - session.startedMs;
      if (idleElapsed >= session.idleTimeoutMs || totalElapsed >= session.maxDurationMs) {
        this._appendLog(session, 'system', `Session timed out (idle=${idleElapsed}ms, total=${totalElapsed}ms); cleaning up.`);
        this.stopSession(session.session_id, { reason: 'timeout' }).catch(() => {});
        return;
      }
      if (session.status === 'running' || session.status === 'starting') {
        this._scheduleWatchdog(session);
      }
    }, interval);
    if (typeof session._timer.unref === 'function') session._timer.unref();
  }

  _findReusableSession(projectPath, purpose) {
    const resolvedProj = projectPath ? path.resolve(projectPath) : '';
    for (const session of this._sessions.values()) {
      if (session.status !== 'running') continue;
      if (resolvedProj && session.project_path !== resolvedProj) continue;
      if (purpose && session.purpose !== purpose) continue;
      return session;
    }
    return null;
  }

  async _waitForViewerReady(session, waitTimeoutMs = 15000) {
    const deadline = Date.now() + waitTimeoutMs;
    const probeUrl = `http://${session.bind_host}:${session.novnc_port}/vnc.html`;
    while (Date.now() < deadline) {
      if (await this._probeReady(probeUrl)) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  }

  _publicView(session) {
    return {
      session_id: session.session_id,
      container_name: session.container_name,
      status: session.status,
      mode: 'docker-headed',
      headed: true,
      purpose: session.purpose,
      project_path: session.project_path,
      target_url: session.target_url,
      build_id: session.build_id,
      bind_host: session.bind_host,
      novnc_port: session.novnc_port,
      playwright_ui_port: session.playwright_ui_port,
      viewer_url: session.viewer_url,
      playwright_ui_url: session.playwright_ui_url,
      vnc_password: session.vnc_password,
      started_at: session.started_at,
      last_activity_at: session.last_activity_at,
      expires_at: session.expires_at,
      log_count: session.logs.length
    };
  }

  async createSession(options = {}) {
    const reuse = options.reuse !== false;
    const purpose = options.purpose || 'frontend-dev';
    const projectPath = options.projectPath || options.project_path || null;
    if (reuse && !options.forceNew) {
      const existing = options.sessionId ? this._sessions.get(options.sessionId) : this._findReusableSession(projectPath, purpose);
      if (existing && existing.status === 'running') {
        if (options.buildId) existing.build_id = String(options.buildId);
        if (options.targetUrl && options.targetUrl !== existing.target_url) {
          existing.target_url = String(options.targetUrl);
          await this.interact(existing.session_id, {
            action: 'navigate',
            url: translateTargetUrlForContainer(existing.target_url, this._platform),
            build_id: existing.build_id
          }).catch(() => {});
        }
        this._appendLog(existing, 'system', `Reused live browser session (build=${existing.build_id})`);
        return { ...this._publicView(existing), reused: true };
      }
    }

    const bindHost = validateBindHost(options.bindHost || '127.0.0.1', {
      allowPublicBind: Boolean(options.allowPublicBind),
      authToken: options.authToken
    });
    if (options.workspaceMount) {
      validateWorkspaceMountPath(options.workspaceMount);
    }

    const dockerCheck = this.isDockerAvailable();
    if (!dockerCheck.available) {
      throw new Error(`BROWSER_WORKSPACE_UNAVAILABLE: Docker daemon is not reachable (${dockerCheck.reason || 'not running'}).`);
    }

    const image = options.image || DEFAULT_BROWSER_IMAGE;
    const imgRes = this.ensureImageBuilt(image, { autoBuild: Boolean(options.autoBuild) });
    if (!imgRes.ok) {
      throw new Error(`BROWSER_IMAGE_MISSING: ${imgRes.reason} (${imgRes.fix || imgRes.detail || ''})`);
    }

    const sessionId = options.sessionId || `bs-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const containerName = `konoha-browser-${sessionId}`;
    const novncPort = await this._allocatePort(Number(options.preferredPort) || 0);
    const pwUiPort = options.playwrightUi ? await this._allocatePort(Number(options.preferredPwUiPort) || 0) : null;
    const vncPassword = options.vncPassword || crypto.randomBytes(12).toString('hex');
    const buildId = String(options.buildId || `build-${Date.now().toString(36)}`);
    const targetUrl = String(options.targetUrl || '');
    const idleTimeoutMs = Number(options.idleTimeoutMs) || DEFAULT_IDLE_TIMEOUT_MS;
    const maxDurationMs = Number(options.maxDurationMs) || DEFAULT_MAX_DURATION_MS;
    const nowMs = Date.now();

    const runArgs = buildDockerRunArgs({
      image,
      sessionId,
      containerName,
      bindHost,
      novncPort,
      playwrightUiPort: pwUiPort,
      vncPassword,
      targetUrl,
      buildId,
      workspacePath: options.workspaceMount || null,
      width: options.width || 1440,
      height: options.height || 900,
      platform: this._platform
    });

    const spawnRes = this._execSync('docker', runArgs, { timeout: 20000 });
    if (spawnRes.status !== 0) {
      throw new Error(`Failed to launch browser container: ${(spawnRes.stderr || spawnRes.stdout || '').trim()}`);
    }

    const session = {
      session_id: sessionId,
      container_name: containerName,
      container_id: (spawnRes.stdout || '').trim(),
      status: 'running',
      purpose,
      project_path: projectPath ? path.resolve(projectPath) : '',
      target_url: targetUrl,
      build_id: buildId,
      bind_host: bindHost,
      novnc_port: novncPort,
      playwright_ui_port: pwUiPort,
      vnc_password: vncPassword,
      viewer_url: `http://${bindHost}:${novncPort}/vnc.html?autoconnect=1&resize=scale`,
      playwright_ui_url: pwUiPort ? `http://${bindHost}:${pwUiPort}` : null,
      startedMs: nowMs,
      lastActivityMs: nowMs,
      idleTimeoutMs,
      maxDurationMs,
      started_at: new Date(nowMs).toISOString(),
      last_activity_at: new Date(nowMs).toISOString(),
      expires_at: new Date(nowMs + maxDurationMs).toISOString(),
      logs: [],
      _timer: null
    };

    this._sessions.set(sessionId, session);
    this._appendLog(session, 'system', `Started container ${containerName} on ${session.viewer_url}`);

    if (options.waitForViewer !== false) {
      const ready = await this._waitForViewerReady(session, Number(options.readyTimeoutMs) || 12000);
      if (!ready) {
        this._appendLog(session, 'stderr', 'noVNC viewer endpoint did not become ready within timeout; cleaning up.');
        await this.stopSession(sessionId, { reason: 'viewer_ready_timeout' });
        throw new Error(`BROWSER_VIEWER_TIMEOUT: noVNC viewer did not respond on ${bindHost}:${novncPort}`);
      }
    }

    this._scheduleWatchdog(session);
    return { ...this._publicView(session), reused: false };
  }

  getSession(sessionId) {
    const s = this._sessions.get(String(sessionId || ''));
    return s ? this._publicView(s) : null;
  }

  listSessions({ includeStopped = false } = {}) {
    const out = [];
    for (const s of this._sessions.values()) {
      if (!includeStopped && s.status !== 'running') continue;
      out.push(this._publicView(s));
    }
    return out;
  }

  getSessionLogs(sessionId, { tail = 100 } = {}) {
    const s = this._sessions.get(String(sessionId || ''));
    if (!s) return null;
    const count = Math.min(Math.max(Number(tail) || 50, 1), MAX_LOG_LINES);
    return {
      session_id: s.session_id,
      status: s.status,
      build_id: s.build_id,
      logs: s.logs.slice(-count)
    };
  }

  async interact(sessionId, command = {}) {
    const s = this._sessions.get(String(sessionId || ''));
    if (!s || s.status !== 'running') {
      throw new Error(`Browser session '${sessionId}' is not running.`);
    }
    const payload = { ...command };
    if (payload.url) {
      payload.url = translateTargetUrlForContainer(payload.url, this._platform);
    }
    if (payload.build_id) s.build_id = String(payload.build_id);
    const deadline = Date.now() + (Number(command.waitAgentMs) || 12000);
    let res;
    let rawOut = '';
    while (true) {
      res = this._execSync(
        'docker',
        ['exec', s.container_name, 'node', '/opt/konoha-browser/browser_container_agent.js', '--cmd', JSON.stringify(payload)],
        { timeout: Number(command.timeoutMs) || 25000 }
      );
      rawOut = (res.stdout || res.stderr || '').trim();
      const socketNotReady = res.status !== 0 && /konoha-browser-agent\.sock/.test(rawOut) && /ENOENT|ECONNREFUSED/.test(rawOut);
      if (!socketNotReady || Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    this._appendLog(s, res.status === 0 ? 'stdout' : 'stderr', `${payload.action || 'cmd'}: ${rawOut.slice(0, 300)}`);
    if (res.status !== 0) {
      throw new Error(`Browser interaction failed: ${rawOut || 'unknown error'}`);
    }
    try {
      return JSON.parse(rawOut);
    } catch (parseErr) {
      throw new Error(`Browser container agent returned malformed JSON (${parseErr.message}): ${rawOut.slice(0, 200)}`);
    }
  }

  registerChildProcess(sessionId, child) {
    this._activeChildren.set(String(sessionId), child);
  }

  async cancelSession(sessionId, reason = 'cancelled') {
    const child = this._activeChildren.get(String(sessionId));
    if (child && !child.killed) {
      try { child.kill('SIGTERM'); } catch (_) { /* ignore */ }
    }
    this._activeChildren.delete(String(sessionId));
    return this.stopSession(sessionId, { reason, status: 'cancelled' });
  }

  async stopSession(sessionId, { reason = 'stopped', status = 'stopped' } = {}) {
    const s = this._sessions.get(String(sessionId || ''));
    if (!s) return { ok: false, found: false, session_id: sessionId };
    if (s._timer) {
      clearTimeout(s._timer);
      s._timer = null;
    }
    const child = this._activeChildren.get(s.session_id);
    if (child && !child.killed) {
      try { child.kill('SIGTERM'); } catch (_) { /* ignore */ }
      this._activeChildren.delete(s.session_id);
    }
    this._execSync('docker', ['rm', '-f', s.container_name], { timeout: 8000 });
    s.status = status;
    this._appendLog(s, 'system', `Session ${status} (${reason}); removed container ${s.container_name}.`);
    return { ok: true, found: true, session_id: s.session_id, status: s.status, reason };
  }

  cleanupStaleSessions({ maxIdleMs = DEFAULT_IDLE_TIMEOUT_MS } = {}) {
    const cleaned = [];
    const now = Date.now();
    for (const s of this._sessions.values()) {
      if (s.status === 'running' && (now - s.lastActivityMs > maxIdleMs || now - s.startedMs > s.maxDurationMs)) {
        this._execSync('docker', ['rm', '-f', s.container_name], { timeout: 8000 });
        if (s._timer) { clearTimeout(s._timer); s._timer = null; }
        s.status = 'expired';
        cleaned.push(s.session_id);
      }
    }
    const ps = this._execSync(
      'docker',
      ['ps', '-a', '--filter', 'label=konoha.browser.managed=true', '--format', '{{.Names}}'],
      { timeout: 5000 }
    );
    if (ps.status === 0 && ps.stdout) {
      for (const name of ps.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
        const sid = name.replace(/^konoha-browser-/, '');
        const tracked = this._sessions.get(sid);
        if (!tracked || tracked.status !== 'running') {
          this._execSync('docker', ['rm', '-f', name], { timeout: 8000 });
          if (!cleaned.includes(sid)) cleaned.push(sid);
        }
      }
    }
    return { cleaned_count: cleaned.length, cleaned_session_ids: cleaned };
  }
}

const defaultBrowserSessionManager = new BrowserSessionManager();

module.exports = {
  DEFAULT_BROWSER_IMAGE,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_MAX_DURATION_MS,
  BrowserSessionManager,
  defaultBrowserSessionManager
};
