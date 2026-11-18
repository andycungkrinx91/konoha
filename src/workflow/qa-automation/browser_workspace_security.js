'use strict';

/**
 * src/workflow/qa-automation/browser_workspace_security.js — Security, isolation,
 * loopback binding, mount validation, and host->container URL translation helpers
 * for Konoha's live headed Docker browser workspace.
 */

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const FORBIDDEN_SUBPATHS = [
  '.konoha', '.ssh', '.gnupg', '.aws', '.kube', '.mozilla',
  path.join('.config', 'google-chrome'),
  path.join('.config', 'chromium'),
  path.join('.config', 'BraveSoftware'),
  path.join('.config', 'microsoft-edge'),
  'User Data'
];

function _normCompare(p) {
  const res = path.resolve(String(p || ''));
  return process.platform === 'win32' ? res.toLowerCase() : res;
}

function validateBindHost(bindHost = '127.0.0.1', options = {}) {
  const host = String(bindHost || '127.0.0.1').trim().toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return host === 'localhost' ? '127.0.0.1' : host;
  if (options.allowPublicBind === true && options.authToken && String(options.authToken).trim().length >= 16) {
    return host;
  }
  throw new Error(
    `BROWSER_SECURITY_VIOLATION: Refusing non-loopback bind host '${bindHost}'. ` +
    'VNC/noVNC/Playwright UI endpoints must bind to 127.0.0.1 unless allowPublicBind=true with >=16 char authToken.'
  );
}

function validateWorkspaceMountPath(hostPath) {
  if (!hostPath || typeof hostPath !== 'string') return null;
  if (/[\x00-\x1f\x7f]/.test(hostPath)) {
    throw new Error('BROWSER_ISOLATION_VIOLATION: Workspace mount path contains control characters.');
  }
  const resolved = path.resolve(hostPath);
  const norm = _normCompare(resolved);
  const home = _normCompare(process.env.HOME || process.env.USERPROFILE || os.homedir());
  if (norm === home || norm === path.parse(resolved).root.toLowerCase()) {
    throw new Error(`BROWSER_ISOLATION_VIOLATION: Refusing to mount home or root directory '${resolved}' into browser container.`);
  }
  const lower = resolved.toLowerCase();
  for (const seg of FORBIDDEN_SUBPATHS) {
    if (lower.includes(seg.toLowerCase())) {
      throw new Error(`BROWSER_ISOLATION_VIOLATION: Refusing to mount restricted/profile path '${resolved}'.`);
    }
  }
  if (/(?:^|[\\/])(?:\.env(?:\.|$)|vault(?:\.db|\.json)?$|konoha\.db$)/i.test(resolved)) {
    throw new Error(`BROWSER_ISOLATION_VIOLATION: Refusing to mount secrets or Konoha DB '${resolved}'.`);
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`Workspace mount path does not exist: ${resolved}`);
  }
  return resolved;
}

/**
 * Artifacts are outputs Konoha writes (Playwright reports, screenshots, traces), so
 * the read-write mount is restricted to scratch space only: os.tmpdir(), Konoha's own
 * ~/.konoha/tmp tree, or a path inside the project. Everything else is refused.
 *
 * ponytail: two allowed roots, no config knob. Add a root here if a host needs another.
 */
function validateArtifactsMountPath(hostPath, { projectRoot = null } = {}) {
  if (!hostPath || typeof hostPath !== 'string') return null;
  if (/[\x00-\x1f\x7f]/.test(hostPath)) {
    throw new Error('BROWSER_ISOLATION_VIOLATION: Artifacts mount path contains control characters.');
  }
  const resolved = path.resolve(hostPath);
  const norm = _normCompare(resolved);
  if (norm === _normCompare(path.parse(resolved).root)) {
    throw new Error(`BROWSER_ISOLATION_VIOLATION: Refusing to mount filesystem root '${resolved}' as browser artifacts.`);
  }
  const homeDir = _normCompare(process.env.HOME || process.env.USERPROFILE || os.homedir());
  if (norm === homeDir) {
    throw new Error(`BROWSER_ISOLATION_VIOLATION: Refusing to mount the home directory '${resolved}' as browser artifacts.`);
  }
  const allowedRoots = [
    _normCompare(os.tmpdir()),
    _normCompare(path.join(process.env.HOME || process.env.USERPROFILE || os.homedir(), '.konoha', 'tmp'))
  ];
  if (projectRoot) allowedRoots.push(_normCompare(path.resolve(projectRoot)));

  const underAllowed = allowedRoots.some((root) => norm === root || norm.startsWith(root + path.sep));
  if (!underAllowed) {
    throw new Error(
      `BROWSER_ISOLATION_VIOLATION: Artifacts mount '${resolved}' must live under the OS temp dir, ` +
      '~/.konoha/tmp, or the project root.'
    );
  }
  const konohaTmpRoot = allowedRoots[1];
  const lower = resolved.toLowerCase();
  for (const seg of FORBIDDEN_SUBPATHS) {
    // Konoha's own scratch tree is the one allowed .konoha path: it holds generated
    // reports, never credentials or a browser profile.
    if (seg === '.konoha' && (norm === konohaTmpRoot || norm.startsWith(konohaTmpRoot + path.sep))) continue;
    if (lower.includes(seg.toLowerCase())) {
      throw new Error(`BROWSER_ISOLATION_VIOLATION: Refusing to mount restricted/profile path '${resolved}' as browser artifacts.`);
    }
  }
  if (/(?:^|[\\/])(?:\.env(?:\.|$)|vault(?:\.db|\.json)?$|konoha\.db$)/i.test(resolved)) {
    throw new Error(`BROWSER_ISOLATION_VIOLATION: Refusing to mount secrets or Konoha DB '${resolved}' as browser artifacts.`);
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`Artifacts mount path does not exist: ${resolved}`);
  }
  return resolved;
}

function allocateLoopbackPort(preferredPort = 0) {
  const tryListen = (port) => new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', (err) => reject(err));
    srv.listen(port, '127.0.0.1', () => {
      const addr = srv.address();
      const allocated = addr && typeof addr === 'object' ? addr.port : 0;
      srv.close(() => resolve(allocated));
    });
  });

  if (preferredPort > 0) {
    return tryListen(preferredPort).catch((err) => {
      if (err && err.code === 'EADDRINUSE') return tryListen(0);
      throw err;
    });
  }
  return tryListen(0);
}

function translateTargetUrlForContainer(targetUrl, _platform = process.platform) {
  if (!targetUrl) return '';
  try {
    const u = new URL(String(targetUrl));
    if (['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname.toLowerCase())) {
      u.hostname = 'host.docker.internal';
    }
    return u.toString();
  } catch (_) {
    return String(targetUrl);
  }
}

function buildDockerRunArgs({
  image,
  sessionId,
  containerName,
  bindHost,
  novncPort,
  vncPassword,
  targetUrl = '',
  buildId = '',
  purpose = 'frontend-dev',
  projectPath = '',
  startedAt = null,
  expiresAt = null,
  workspacePath = null,
  artifactsPath = null,
  width = 1440,
  height = 900,
  platform = process.platform
}) {
  const safeBindHost = validateBindHost(bindHost);
  if (!vncPassword || String(vncPassword).length < 8) {
    throw new Error('BROWSER_SECURITY_VIOLATION: Per-session VNC password (>= 8 chars) is required.');
  }
  const containerTargetUrl = translateTargetUrlForContainer(targetUrl, platform);
  const safeArtifacts = validateArtifactsMountPath(artifactsPath, { projectRoot: projectPath || null });

  const args = [
    'run', '-d',
    '--name', containerName,
    '--label', 'konoha.browser.managed=true',
    '--label', `konoha.browser.session=${sessionId}`,
    '--label', `konoha.browser.purpose=${purpose}`,
    '--label', `konoha.browser.build_id=${buildId}`,
    '--label', `konoha.browser.started_at=${startedAt || new Date().toISOString()}`,
    '--label', `konoha.browser.expires_at=${expiresAt || ''}`,
    '--label', `konoha.browser.target_url=${containerTargetUrl}`,
    '--label', `konoha.browser.project=${projectPath}`,
    '--label', `konoha.browser.artifacts_host=${safeArtifacts || ''}`,
    '--label', `konoha.browser.bind_host=${safeBindHost}`,
    '--label', `konoha.browser.novnc_port=${Number(novncPort) || 0}`,
    '--init',
    '--shm-size=1g',
    '-p', `${safeBindHost}:${novncPort}:6080`
  ];
  if (platform === 'linux') {
    args.push('--add-host=host.docker.internal:host-gateway');
  }
  if (workspacePath) {
    const safeMount = validateWorkspaceMountPath(workspacePath);
    if (safeMount) {
      args.push('-v', `${safeMount}:/workspace:ro`);
    }
  }
  if (safeArtifacts) {
    args.push('-v', `${safeArtifacts}:/artifacts:rw`);
    // The bind mount keeps host ownership, so a container-user write would be refused.
    // Matching the host uid is what makes /artifacts and the mounted workspace readable.
    if (typeof process.getuid === 'function') {
      args.push('--user', `${process.getuid()}:${process.getgid()}`);
    }
  }
  args.push(
    '-e', 'DISPLAY=:99',
    '-e', `SCREEN_WIDTH=${Number(width) || 1440}`,
    '-e', `SCREEN_HEIGHT=${Number(height) || 900}`,
    '-e', `KONOHA_VNC_PASSWORD=${vncPassword}`,
    '-e', `KONOHA_BROWSER_SESSION_ID=${sessionId}`,
    '-e', `KONOHA_BROWSER_BUILD_ID=${buildId}`,
    '-e', `KONOHA_BROWSER_TARGET_URL=${containerTargetUrl}`,
    '-e', `KONOHA_BROWSER_ARTIFACTS=${safeArtifacts ? '/artifacts' : '/tmp/konoha-artifacts'}`,
    image
  );
  return args;
}

module.exports = {
  LOOPBACK_HOSTS,
  validateBindHost,
  validateWorkspaceMountPath,
  validateArtifactsMountPath,
  allocateLoopbackPort,
  translateTargetUrlForContainer,
  buildDockerRunArgs
};
