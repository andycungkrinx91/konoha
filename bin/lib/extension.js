'use strict';

/**
 * bin/lib/extension.js — IDE Extensions & External Tooling Management.
 *
 * Manages:
 * - uv and uvx detection, fallback paths, and installation
 * - Semble package refresh
 * - agent-browser CLI installation and discovery
 * - Antigravity IDE detection and Konoha Bridge extension lifecycle
 *   (Strictly scoped to Antigravity IDE only; never installed into Cursor, VS Code, etc.)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');
const { HOME, INSTALL_BUILD_MIGRATE_TIMEOUT_MS } = require('./paths');
const { fileExists } = require('./prompt');
const { log, info, warn, success } = require('./format');
const { SEMBLE_PACKAGE } = require('../../src/semble_manager');

const PINNED_UV_VERSION = '0.9.5';

function installUvWindows(tmpDir, stdioOpt, silent) {
  const scriptPath = path.join(tmpDir, `uv-install-${Date.now()}.ps1`);
  try {
    execSync(`powershell -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://astral.sh/uv/${PINNED_UV_VERSION}/install.ps1' -OutFile '${scriptPath}'"`, { stdio: stdioOpt, timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS });
    if (fs.existsSync(scriptPath) && fs.statSync(scriptPath).size > 0) {
      execSync(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, { stdio: stdioOpt, timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS });
    }
  } catch (psErr) {
    if (!silent) warn(`PowerShell uv installer failed: ${psErr.message}. Falling back to winget if available.`);
    execSync(`winget install --id astral-sh.uv --version ${PINNED_UV_VERSION} -e --source winget`, { stdio: stdioOpt, timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS });
  } finally {
    try { fs.rmSync(scriptPath, { force: true }); } catch (_) { /* best effort cleanup */ }
  }
}

function installUvPosix(tmpDir, stdioOpt) {
  const scriptPath = path.join(tmpDir, `uv-install-${Date.now()}.sh`);
  try {
    execSync(`curl -LsSf "https://astral.sh/uv/${PINNED_UV_VERSION}/install.sh" -o "${scriptPath}"`, { stdio: stdioOpt, timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS });
    if (fs.existsSync(scriptPath) && fs.statSync(scriptPath).size > 0) {
      execSync(`sh "${scriptPath}"`, { stdio: stdioOpt, timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS });
    }
  } finally {
    try { fs.rmSync(scriptPath, { force: true }); } catch (_) { /* best effort cleanup */ }
  }
}

function installUv(silent = false) {
  try {
    execSync('uv --version', { stdio: 'ignore' });
    return true;
  } catch { /* intentional best-effort fallback */ }

  if (!silent) info(`Attempting to install pinned "uv" v${PINNED_UV_VERSION} for Semble MCP...`);
  try {
    const stdioOpt = silent ? 'ignore' : 'inherit';
    const tmpDir = os.tmpdir();
    if (process.platform === 'win32') {
      installUvWindows(tmpDir, stdioOpt, silent);
    } else {
      installUvPosix(tmpDir, stdioOpt);
    }
    if (!silent) success('uv installed successfully!');
    return true;
  } catch (err) {
    if (!silent) {
      warn(`Failed to auto-install uv: ${err.message}`);
      log('Please install uv manually: https://docs.astral.sh/uv/');
    }
    return false;
  }
}

function getUvCommand() {
  try {
    execSync('uv --version', { stdio: 'ignore' });
    return 'uv';
  } catch { /* intentional best-effort fallback */ }

  const home = os.homedir();
  const localPaths = [];
  if (process.platform === 'win32') {
    localPaths.push(
      path.join(home, '.local', 'bin', 'uv.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'programs', 'uv', 'uv.exe')
    );
  } else {
    localPaths.push(
      path.join(home, '.local', 'bin', 'uv'),
      path.join(home, '.cargo', 'bin', 'uv'),
      '/usr/local/bin/uv',
      '/usr/bin/uv'
    );
  }

  for (const p of localPaths) {
    if (p && fileExists(p)) {
      try {
        execSync(`"${p}" --version`, { stdio: 'ignore' });
        return p;
      } catch { /* intentional best-effort fallback */ }
    }
  }

  return null;
}

function refreshSemblePackage(silent = true) {
  const uvxCmd = getUvxCommand();
  try {
    const result = spawnSync(uvxCmd, ['--from', SEMBLE_PACKAGE, 'semble', '--version'], {
      encoding: 'utf8', timeout: 120000, stdio: silent ? 'ignore' : 'inherit', windowsHide: true
    });
    return result.status === 0
      ? { ok: true, command: uvxCmd }
      : { ok: false, reason: `semble-refresh-failed-${result.status}` };
  } catch (error) {
    return { ok: false, reason: 'semble-refresh-failed', error: error.message };
  }
}

function getUvxCommand() {
  const uvCmd = getUvCommand();
  if (!uvCmd) return 'uvx';
  if (uvCmd !== 'uv') {
    const companionUvx = path.join(path.dirname(uvCmd), process.platform === 'win32' ? 'uvx.exe' : 'uvx');
    if (fileExists(companionUvx)) {
      return companionUvx;
    }
  }
  return 'uvx';
}

function getCandidateAgentBrowserPaths(isWin, home) {
  if (isWin) {
    const candidates = [];
    if (process.env.APPDATA) {
      candidates.push(path.join(process.env.APPDATA, 'npm', 'agent-browser.cmd'));
    }
    if (process.env.LOCALAPPDATA) {
      candidates.push(path.join(process.env.LOCALAPPDATA, 'pnpm', 'agent-browser.cmd'));
    }
    candidates.push(
      path.join(home, 'AppData', 'Roaming', 'npm', 'agent-browser.cmd'),
      path.join(home, 'AppData', 'Local', 'pnpm', 'agent-browser.cmd')
    );
    return candidates;
  }
  return [
    path.join(home, '.local', 'bin', 'agent-browser'),
    path.join(home, '.npm-global', 'bin', 'agent-browser'),
    path.join(home, '.pnpm-global', 'bin', 'agent-browser'),
    path.join(home, '.local', 'share', 'pnpm', 'agent-browser'),
    // Homebrew (Apple Silicon), MacPorts, distro packages, snap.
    '/opt/homebrew/bin/agent-browser',
    '/usr/local/bin/agent-browser',
    '/opt/local/bin/agent-browser',
    '/snap/bin/agent-browser',
    '/usr/bin/agent-browser',
    '/bin/agent-browser'
  ];
}

function probeAgentBrowser(cmd, isWin) {
  try {
    const res = isWin
      ? spawnSync(`"${cmd}" --version`, { encoding: 'utf-8', shell: true, windowsHide: true })
      : spawnSync(cmd, ['--version'], { encoding: 'utf-8' });
    if (res.status === 0) {
      const out = `${res.stdout || res.stderr || ''}`;
      const match = out.match(/agent-browser\s+(\d+\.\d+\.\d+)/);
      return { ok: true, version: match ? match[1] : null };
    }
    return { ok: false, stderr: `${(res.stderr || res.stdout || '').trim()}`.slice(0, 300) };
  } catch (err) {
    return { ok: false, stderr: err.message };
  }
}

function getAgentBrowserCommand() {
  const isWin = process.platform === 'win32';
  const abCmd = isWin ? 'agent-browser.cmd' : 'agent-browser';
  const probed = probeAgentBrowser(abCmd, isWin);
  if (probed.ok) return abCmd;

  const candidates = getCandidateAgentBrowserPaths(isWin, os.homedir());
  for (const p of candidates) {
    if (!p || !fileExists(p)) continue;
    if (probeAgentBrowser(p, isWin).ok) return p;
  }
  return null;
}

/**
 * Directories that commonly hold npm/pnpm but are absent from PATH: distro
 * packages (/usr/bin, /usr/local/bin), Homebrew on Apple Silicon
 * (/opt/homebrew/bin), the standalone pnpm installer (~/.local/share/pnpm,
 * ~/Library/pnpm, %LOCALAPPDATA%\pnpm), Windows .exe/MSI installs
 * (%APPDATA%\npm, %ProgramFiles%\nodejs), nvm version dirs, and the node
 * binary's own directory. A GUI-launched app on macOS gets a minimal PATH that
 * omits most of these, so the lookup cannot rely on PATH alone.
 */
function packageManagerSearchDirs(isWin) {
  const home = HOME || os.homedir();
  const dirs = [path.dirname(process.execPath)];
  if (isWin) {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    dirs.push(
      path.join(appData, 'npm'),
      path.join(localAppData, 'pnpm'),
      path.join(programFiles, 'nodejs'),
      path.join(programFiles, 'nodejs', 'bin')
    );
  } else {
    dirs.push(
      '/usr/local/bin', '/opt/homebrew/bin', '/opt/local/bin', '/usr/bin', '/bin', '/snap/bin',
      path.join(home, '.local', 'bin'),
      path.join(home, '.local', 'share', 'pnpm'),
      path.join(home, 'Library', 'pnpm'),
      path.join(home, '.pnpm')
    );
  }
  return dirs;
}

/** nvm keeps a bin dir per node version; any of them satisfies the check. */
function nvmBinDirs(isWin) {
  if (isWin) return [];
  const root = path.join(HOME || os.homedir(), '.nvm', 'versions', 'node');
  try {
    return fs.readdirSync(root).map((v) => path.join(root, v, 'bin'));
  } catch {
    return [];
  }
}

/**
 * Resolve a package manager to an absolute path. Returns null when it is not
 * installed at all, which is the only case the caller should report as
 * "unavailable" rather than "install failed".
 */
function resolvePackageManagerBin(name, isWin) {
  const exts = isWin ? ['.cmd', '.exe', ''] : [''];
  const pathDirs = `${process.env.PATH || ''}`.split(path.delimiter).filter(Boolean);
  const dirs = [...pathDirs, ...packageManagerSearchDirs(isWin), ...nvmBinDirs(isWin)];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch { /* not here */ }
    }
  }
  return null;
}

/**
 * Environment for package-manager spawns. The node that runs Konoha is prepended
 * to PATH so a distro or system npm picks up the right runtime instead of
 * whatever `env node` resolves to: without this, a GUI-minimal PATH runs npm
 * under e.g. system node v16 and the install emits EBADENGINE warnings for a
 * package that requires node >=24.
 */
function packageManagerEnv() {
  const nodeDir = path.dirname(process.execPath);
  const parts = `${process.env.PATH || ''}`.split(path.delimiter).filter(Boolean);
  const envPath = parts.includes(nodeDir) ? parts.join(path.delimiter) : [nodeDir, ...parts].join(path.delimiter);
  return { ...process.env, PATH: envPath };
}

function tryInstallWithPm(pm, isWin, stdioOpt) {
  try {
    const env = packageManagerEnv();
    const check = isWin
      ? spawnSync(`"${pm.cmd}" --version`, { encoding: 'utf-8', shell: true, windowsHide: true, env })
      : spawnSync(pm.cmd, ['--version'], { encoding: 'utf-8', env });
    if (check.status !== 0) return false;
    const installRes = isWin
      ? spawnSync(`"${pm.cmd}" ${pm.args.join(' ')}`, { stdio: stdioOpt, shell: true, windowsHide: true, timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS, env })
      : spawnSync(pm.cmd, pm.args, { stdio: stdioOpt, timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS, env });
    return installRes.status === 0;
  } catch {
    return false;
  }
}

/**
 * 0.3.1 has no linux-x64 native binary (every `--version` probe dies with
 * "No binary found for linux-x64"), runs a postinstall script, and pulls a
 * vulnerable zod. 0.41.2 ships prebuilt binaries for every platform and has
 * no runtime dependencies.
 */
const PINNED_AB_PACKAGE = 'agent-browser@0.41.2';

const PINNED_AB_VERSION = PINNED_AB_PACKAGE.slice(PINNED_AB_PACKAGE.indexOf('@') + 1);

function resolveInstalledAgentBrowser() {
  const isWin = process.platform === 'win32';
  const bin = isWin ? 'agent-browser.cmd' : 'agent-browser';
  const managed = path.join(HOME, '.konoha', 'tools', 'node_modules', '.bin', bin);
  // An existing 0.3.x install is broken on linux-x64, so accept the managed copy
  // only when it reports the pinned version; anything else falls through and
  // triggers a reinstall.
  if (!fileExists(managed)) return null;
  const probed = probeAgentBrowser(managed, isWin);
  if (!probed.ok) return null;
  return probed.version === PINNED_AB_VERSION ? managed : null;
}

/**
 * Install candidates for the managed copy, in preference order.
 * npm and pnpm only, always with --ignore-scripts: the package ships its own
 * platform binaries, so the postinstall has nothing to do, and pnpm aborts the
 * whole install (ERR_PNPM_IGNORED_BUILDS) over an unapproved build script.
 */
function managedInstallCandidates(prefix, isWin) {
  // The Windows path build joins args into one shell string, so a HOME containing
  // spaces (common: C:\Users\First Last) would split the flag and install to the
  // wrong directory. Quote it for the shell form only.
  const prefixArg = isWin ? `"${prefix}"` : prefix;
  return [
    { name: 'npm', cmd: resolvePackageManagerBin('npm', isWin), args: ['install', '--prefix', prefixArg, '--ignore-scripts', '--no-fund', '--no-audit', PINNED_AB_PACKAGE] },
    // pnpm has no --prefix flag (it is --dir/-C); the old --prefix form silently
    // installed nothing.
    { name: 'pnpm', cmd: resolvePackageManagerBin('pnpm', isWin), args: ['add', '--dir', prefixArg, '--ignore-scripts', PINNED_AB_PACKAGE] }
  ].filter((candidate) => candidate.cmd);
}

/** Install candidates for a global install, in preference order. npm and pnpm only. */
function globalInstallCandidates(isWin) {
  return [
    { name: 'npm', cmd: resolvePackageManagerBin('npm', isWin), args: ['install', '-g', '--ignore-scripts', '--no-fund', '--no-audit', PINNED_AB_PACKAGE] },
    { name: 'pnpm', cmd: resolvePackageManagerBin('pnpm', isWin), args: ['add', '-g', '--ignore-scripts', PINNED_AB_PACKAGE] }
  ].filter((candidate) => candidate.cmd);
}

/**
 * Probe a resolved command and keep it only when it reports the pinned version.
 * A working 0.3.x install still carries the vulnerable zod dependency, so
 * "it runs" is not enough — it must be the pinned release.
 */
function pinnedVersionOf(cmd, isWin) {
  if (!cmd) return null;
  const probed = probeAgentBrowser(cmd, isWin);
  if (!probed.ok) return null;
  return probed.version === PINNED_AB_VERSION ? cmd : null;
}

function tryManagedLocalInstall(isWin, stdioOpt) {
  const candidates = managedInstallCandidates(path.join(HOME, '.konoha', 'tools'), isWin);
  for (const pm of candidates) {
    if (!tryInstallWithPm(pm, isWin, stdioOpt)) continue;
    const resolved = resolveInstalledAgentBrowser();
    if (resolved) return resolved;
  }
  return null;
}

function tryNpxFallback() {
  const isWin = process.platform === 'win32';
  try {
    const res = isWin
      ? spawnSync(`"npx" --yes ${PINNED_AB_PACKAGE} --version`, { encoding: 'utf-8', shell: true, windowsHide: true, timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS })
      : spawnSync('npx', ['--yes', PINNED_AB_PACKAGE, '--version'], { encoding: 'utf-8', timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS });
    if (res.status === 0) return `npx --yes ${PINNED_AB_PACKAGE}`;
  } catch { /* best-effort */ }
  return null;
}

/**
 * Resolve or provision the agent-browser CLI.
 * Returns { ok, command, via, reason } where `ok` is true only when a command was
 * verified to run (`--version` exits 0). Never reports success for an installed
 * package whose native binary is missing.
 */
function installAgentBrowserDetailed(silent = false) {
  const isWin = process.platform === 'win32';
  const existing = getAgentBrowserCommand();
  const existingPinned = pinnedVersionOf(existing, isWin);
  if (existingPinned) return { ok: true, command: existingPinned, via: 'global', reason: null };

  if (!silent) {
    if (existing) {
      info(`agent-browser ${PINNED_AB_VERSION} required; refreshing the existing install...`);
    } else {
      info('Attempting to install "agent-browser" CLI for browser automation...');
    }
  }

  const stdioOpt = silent ? 'ignore' : 'inherit';
  const attempts = [];

  // Managed copy first: it needs no global bin directory, so it avoids
  // ERR_PNPM_GLOBAL_BIN_DIR_NOT_IN_PATH and never touches the user's global prefix.
  const managedCandidates = managedInstallCandidates(path.join(HOME, '.konoha', 'tools'), isWin);
  if (managedCandidates.length === 0) {
    attempts.push('no npm or pnpm found on PATH or in the standard install locations');
  } else {
    const managed = tryManagedLocalInstall(isWin, stdioOpt);
    if (managed) {
      if (!silent) success('agent-browser installed successfully (managed copy in ~/.konoha/tools)!');
      return { ok: true, command: managed, via: 'local', reason: null };
    }
    attempts.push('managed install in ~/.konoha/tools failed');
  }

  for (const pm of globalInstallCandidates(isWin)) {
    if (!tryInstallWithPm(pm, isWin, stdioOpt)) {
      attempts.push(`${pm.name}: install command failed`);
      continue;
    }
    const resolved = pinnedVersionOf(getAgentBrowserCommand(), isWin);
    if (resolved) {
      if (!silent) success(`agent-browser installed successfully via ${pm.name}!`);
      return { ok: true, command: resolved, via: 'global', reason: null };
    }
    attempts.push(`${pm.name}: installed but "agent-browser --version" did not report ${PINNED_AB_VERSION}`);
  }

  const viaNpx = tryNpxFallback();
  if (viaNpx) return { ok: true, command: viaNpx, via: 'npx', reason: null };

  // An older binary that still runs beats no binary at all, but say so: it keeps
  // the vulnerable zod dependency.
  if (existing) {
    const reason = `running agent-browser is not version ${PINNED_AB_VERSION}; reinstall failed (${attempts.join('; ')})`;
    if (!silent) warn(`QA uses an outdated agent-browser. ${reason}`);
    return { ok: true, command: existing, via: 'global', reason };
  }

  const reason = attempts.length ? attempts.join('; ') : 'no package manager or npx fallback succeeded';
  if (!silent) {
    warn(`Could not auto-install agent-browser (${reason}). Install manually: npm i -g ${PINNED_AB_PACKAGE}`);
  }
  return { ok: false, command: null, via: null, reason };
}

/**
 * Download the browser binaries agent-browser drives. Separate from installation:
 * the npm package can be present while its native binary or Chromium is missing.
 */
function provisionAgentBrowser(silent = false) {
  const cmd = getAgentBrowserCommand();
  if (!cmd) return { ok: false, reason: 'agent-browser CLI not resolved' };
  const isWin = process.platform === 'win32';
  const args = ['install'];
  if (process.platform === 'linux') args.push('--with-deps');
  try {
    const res = isWin
      ? spawnSync(`"${cmd}" ${args.join(' ')}`, { encoding: 'utf-8', shell: true, windowsHide: true, timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS })
      : spawnSync(cmd, args, { encoding: 'utf-8', timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS });
    if (res.status === 0) return { ok: true, reason: null };
    const detail = `${(res.stderr || res.stdout || '').trim()}`.slice(0, 400);
    if (!silent) warn(`agent-browser provisioning failed: ${detail}`);
    return { ok: false, reason: detail || `agent-browser install exited ${res.status}` };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

function installAgentBrowser(silent = false) {
  return installAgentBrowserDetailed(silent).ok;
}

function findIdeExecutable(name) {
  const isWin = process.platform === 'win32';
  const exts = isWin ? ['.exe', '.cmd', '.bat', ''] : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter);

  if (!isWin) {
    dirs.push(path.join(HOME, '.local', 'bin'), '/usr/local/bin', '/usr/bin', '/bin');
  }

  for (const d of dirs) {
    for (const ext of exts) {
      const fullPath = path.join(d, name + ext);
      if (fileExists(fullPath)) return fullPath;
    }
  }
  return null;
}

module.exports = {
  installUv,
  getUvCommand,
  refreshSemblePackage,
  getUvxCommand,
  getAgentBrowserCommand,
  installAgentBrowser,
  installAgentBrowserDetailed,
  provisionAgentBrowser,
  findIdeExecutable,
  PINNED_AB_PACKAGE,
  PINNED_AB_VERSION,
  managedInstallCandidates,
  globalInstallCandidates,
  resolveInstalledAgentBrowser,
  resolvePackageManagerBin,
  packageManagerEnv,
  pinnedVersionOf
};
