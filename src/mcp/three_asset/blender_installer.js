'use strict';

/**
 * OS-Detecting Auto-Installer for Blender LTS & DCC-MCP-Blender.
 * Every version, path, archive URL and checksum is discovered at runtime:
 * installed Blender binaries are probed, release manifests are read from
 * download.blender.org, and dcc-mcp-blender versions are read from PyPI.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const BLENDER_RELEASE_INDEX = process.env.KONOHA_BLENDER_RELEASE_INDEX || 'https://download.blender.org/release/';
const DCC_MCP_PYPI_URL = 'https://pypi.org/pypi/dcc-mcp-blender/json';
const VERSION_CACHE_TTL_MS = 5 * 60 * 1000;
const DCC_STATUS_TTL_MS = 30 * 1000;

const cache = {
  blenderStatus: { at: 0, binPath: null, value: null },
  blenderVersion: { at: 0, value: null },
  dccStatus: { at: 0, value: null },
  dccLatest: { at: 0, value: null }
};

function getToolchainDir() {
  if (process.env.KONOHA_TOOLCHAIN_DIR) return path.resolve(process.env.KONOHA_TOOLCHAIN_DIR);
  const konohaHome = process.env.KONOHA_HOME || path.join(os.homedir(), '.konoha');
  return path.join(konohaHome, 'toolchains');
}

function detectSystemEnvironment() {
  const platform = os.platform();
  const arch = os.arch();
  return {
    platform,
    arch,
    key: `${platform}-${arch}`,
    osName: platform === 'darwin' ? 'macOS' : (platform === 'win32' ? 'Windows' : 'Linux'),
    toolchainDir: getToolchainDir()
  };
}

function isExecutableFile(p) {
  try {
    const stat = fs.statSync(p);
    if (!stat.isFile()) return false;
    if (process.platform !== 'win32') fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function listDirSafe(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function scanToolchainBinaries(platform) {
  const root = path.join(getToolchainDir(), 'blender');
  const found = [];
  for (const entry of listDirSafe(root)) {
    const candidate = path.join(root, entry.name, platform === 'win32' ? 'blender.exe' : 'blender');
    if (isExecutableFile(candidate)) found.push(candidate);
  }
  return found;
}

function scanWindowsZipInstalls() {
  const found = [];
  const roots = [
    process.env.ProgramFiles || 'C:\\Program Files',
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  ];
  for (const root of roots) {
    const foundation = path.join(root, 'Blender Foundation');
    for (const entry of listDirSafe(foundation)) {
      if (!/^Blender/i.test(entry.name)) continue;
      const candidate = path.join(foundation, entry.name, 'blender.exe');
      if (isExecutableFile(candidate)) found.push(candidate);
    }
  }
  return found;
}

function scanPathForBlender(platform) {
  const whichCmd = platform === 'win32' ? 'where' : 'which';
  const res = spawnSync(whichCmd, ['blender'], { encoding: 'utf8', timeout: 3000 });
  if (res.status !== 0 || !res.stdout) return [];
  return res.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && isExecutableFile(line));
}

function blenderDisabled() {
  // A test (or a host that must never shell out) sets this so a machine with Blender
  // installed still exercises the deterministic path. Instance setup never sets it.
  return process.env.KONOHA_BLENDER_DISABLED === '1';
}

function findInstalledBlenderBinaries() {
  if (blenderDisabled()) return [];
  const env = detectSystemEnvironment();
  const candidates = [];
  if (process.env.KONOHA_BLENDER_BIN) candidates.push(process.env.KONOHA_BLENDER_BIN);
  candidates.push(...scanToolchainBinaries(env.platform));
  if (env.platform === 'darwin') candidates.push('/Applications/Blender.app/Contents/MacOS/Blender');
  if (env.platform === 'win32') candidates.push(...scanWindowsZipInstalls());
  candidates.push(...scanPathForBlender(env.platform));

  const valid = [];
  for (const candidate of candidates) {
    if (isExecutableFile(candidate) && !valid.includes(candidate)) valid.push(candidate);
  }
  return valid;
}

function findInstalledBlenderBinary() {
  return findInstalledBlenderBinaries()[0] || null;
}

function parseBlenderVersionBanner(stdout) {
  const text = String(stdout || '');
  const full = text.match(/Blender\s+([0-9]+\.[0-9]+(?:\.[0-9]+)?)([^\n\r]*)/i);
  if (!full) return null;
  const semver = full[1];
  const suffix = (full[2] || '').match(/\b(LTS|Alpha|Beta|Release Candidate|RC\d*)\b/i);
  return {
    semver,
    version: suffix ? `${semver} ${suffix[1].toUpperCase() === 'RC' ? 'RC' : suffix[1]}` : semver
  };
}

function readBlenderVersion(binPath) {
  try {
    const res = spawnSync(binPath, ['--version'], { encoding: 'utf8', timeout: 15000 });
    if (res.status !== 0) return null;
    return parseBlenderVersionBanner(res.stdout || res.stderr || '');
  } catch {
    return null;
  }
}

function packageSearchRoots() {
  const roots = new Set();
  const home = os.homedir();
  const konohaHome = process.env.KONOHA_HOME || path.join(home, '.konoha');
  const anchors = [__dirname, process.cwd(), konohaHome, path.resolve(__dirname, '..', '..', '..')];
  for (const anchor of anchors) {
    let dir = path.resolve(anchor);
    for (let depth = 0; depth < 8; depth += 1) {
      roots.add(path.join(dir, 'node_modules'));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return [...roots];
}

function readNodePackageVersion(pkgName) {
  for (const modulesDir of packageSearchRoots()) {
    const manifest = path.join(modulesDir, pkgName, 'package.json');
    try {
      if (fs.existsSync(manifest)) {
        const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        if (parsed && parsed.version) return parsed.version;
      }
    } catch { /* intentional best-effort fallback: binary may be locked or already gone */ }
  }
  return null;
}

function getBlenderStatus(options = {}) {
  const binPath = findInstalledBlenderBinary();
  if (!binPath) {
    return {
      installed: false,
      ready_state: 'Not Ready',
      version: null,
      semver: null,
      path: null,
      error: 'No Blender binary found (checked KONOHA_BLENDER_BIN, toolchains, system install paths and PATH)'
    };
  }
  const fresh = options.forceRefresh === true;
  if (
    !fresh
    && cache.blenderStatus.value
    && cache.blenderStatus.binPath === binPath
    && Date.now() - cache.blenderStatus.at < DCC_STATUS_TTL_MS
  ) {
    return cache.blenderStatus.value;
  }
  const parsed = readBlenderVersion(binPath);
  if (!parsed) {
    return {
      installed: false,
      ready_state: 'Not Ready',
      version: null,
      semver: null,
      path: binPath,
      error: 'Blender binary did not report a usable version banner'
    };
  }
  const status = {
    installed: true,
    ready_state: 'Ready',
    version: parsed.version,
    semver: parsed.semver,
    path: binPath,
    error: null
  };
  cache.blenderStatus = { at: Date.now(), binPath, value: status };
  return status;
}

const DCC_PROBE_EXPR = [
  'import importlib.util, importlib.metadata, sys',
  "spec = importlib.util.find_spec('dcc_mcp_blender')",
  "ver = importlib.metadata.version('dcc_mcp_blender') if spec else 'MISSING'",
  "paths = [p for p in sys.path if p and ('addons' in p or 'site-packages' in p)]",
  "print('DCC_MCP_STATUS=' + ver)",
  "print('DCC_MCP_PATHS=' + '|'.join(paths))"
].join('; ');

function getDccMcpStatus(options = {}) {
  const fresh = options.forceRefresh === true;
  if (!fresh && Date.now() - cache.dccStatus.at < DCC_STATUS_TTL_MS) {
    return cache.dccStatus.value;
  }
  const blender = getBlenderStatus();
  if (!blender.installed || !blender.path) {
    const missing = {
      installed: false,
      ready_state: 'Not Ready',
      version: null,
      error: 'Blender must be installed before verifying dcc-mcp-blender'
    };
    cache.dccStatus = { at: Date.now(), value: missing };
    return missing;
  }

  let result;
  try {
    const res = spawnSync(blender.path, ['-b', '--factory-startup', '-noaudio', '--python-expr', DCC_PROBE_EXPR], {
      encoding: 'utf8',
      timeout: 60000
    });
    const out = `${res.stdout || ''}\n${res.stderr || ''}`;
    const match = out.match(/DCC_MCP_STATUS=(\S+)/);
    const pathsMatch = out.match(/DCC_MCP_PATHS=(.*)/);
    const version = match ? match[1].trim() : 'MISSING';
    result = version === 'MISSING'
      ? {
          installed: false,
          ready_state: 'Not Ready',
          version: null,
          blender_version: blender.version,
          module_paths: pathsMatch ? pathsMatch[1].trim().split('|').filter(Boolean) : [],
          error: 'dcc_mcp_blender is not importable inside Blender'
        }
      : {
          installed: true,
          ready_state: 'Ready',
          version,
          blender_version: blender.version,
          module_paths: pathsMatch ? pathsMatch[1].trim().split('|').filter(Boolean) : [],
          error: null
        };
  } catch (err) {
    result = {
      installed: false,
      ready_state: 'Not Ready',
      version: null,
      blender_version: blender.version,
      error: err.message
    };
  }
  cache.dccStatus = { at: Date.now(), value: result };
  return result;
}

async function probeManifoldWasm() {
  try {
    const { getManifoldWasm } = require('./scene_builder');
    const wasm = await getManifoldWasm();
    return Boolean(wasm && typeof wasm.Manifold === 'function');
  } catch {
    return false;
  }
}

function getInstalledFourVersion() {
  return readNodePackageVersion('three');
}

function getManifoldVersion() {
  return readNodePackageVersion('manifold-3d');
}

async function getToolchainStatusAsync() {
  const env = detectSystemEnvironment();
  const blender = getBlenderStatus();
  const dccMcp = getDccMcpStatus();
  const threeVersion = getInstalledFourVersion();
  const manifoldVersion = getManifoldVersion();
  const manifoldReady = await probeManifoldWasm();
  const threeReady = Boolean(threeVersion && manifoldReady);
  const allReady = threeReady && blender.installed && dccMcp.installed;
  return buildStatusPayload(env, { blender, dccMcp, threeVersion, manifoldVersion, threeReady, allReady });
}

function buildStatusPayload(env, ctx) {
  const { blender, dccMcp, threeVersion, manifoldVersion, threeReady, allReady } = ctx;
  return {
    os: env.osName,
    platform: env.platform,
    arch: env.arch,
    toolchainDir: env.toolchainDir,
    overall_ready: allReady,
    components: {
      three_manifold: {
        name: 'Three.js + Manifold CSG',
        version: [threeVersion, manifoldVersion].filter(Boolean).join(' / ') || 'not installed',
        ready_state: threeReady ? 'Ready' : 'Not Ready',
        installed: threeReady
      },
      blender: {
        name: `Blender ${blender.version || ''}`.trim(),
        version: blender.version,
        semver: blender.semver,
        ready_state: blender.ready_state,
        installed: blender.installed,
        path: blender.path,
        error: blender.error
      },
      dcc_mcp_blender: {
        name: `dcc-mcp-blender${dccMcp.version ? ' v' + dccMcp.version : ''}`,
        version: dccMcp.version,
        ready_state: dccMcp.ready_state,
        installed: dccMcp.installed,
        error: dccMcp.error
      }
    }
  };
}

function getToolchainStatus() {
  const env = detectSystemEnvironment();
  const blender = getBlenderStatus();
  const dccMcp = getDccMcpStatus();
  const threeVersion = getInstalledFourVersion();
  const manifoldVersion = getManifoldVersion();
  const threeReady = Boolean(threeVersion && manifoldVersion);
  const allReady = threeReady && blender.installed && dccMcp.installed;
  return buildStatusPayload(env, { blender, dccMcp, threeVersion, manifoldVersion, threeReady, allReady });
}

async function fetchText(url, timeoutMs = 20000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ${url}`);
  return res.text();
}

async function fetchTextOrNull(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ${url}`);
  return res.text();
}

async function resolveExpectedDigest(archive) {
  // Blender publishes one sidecar per version listing `digest  filename` for every
  // archive; older series publish a per-file sidecar instead. Try both, and treat a
  // missing sidecar as unsigned rather than failing an otherwise valid download.
  const versionWide = await fetchTextOrNull(archive.versionSha256Url);
  if (versionWide) {
    const line = versionWide.split('\n')
      .map((l) => l.trim().split(/\s+/))
      .find((parts) => parts[1] === archive.filename);
    if (line) return line[0].toLowerCase();
  }
  const perFile = await fetchTextOrNull(archive.sha256Url);
  if (!perFile) return null;
  return perFile.trim().split(/\s+/)[0].toLowerCase() || null;
}

async function resolveLatestBlenderRelease() {
  if (cache.blenderVersion.value && Date.now() - cache.blenderVersion.at < VERSION_CACHE_TTL_MS) {
    return cache.blenderVersion.value;
  }
  const html = await fetchText(BLENDER_RELEASE_INDEX);
  const dirs = [...html.matchAll(/href="(Blender(\d+)\.(\d+)\/?)"/g)]
    .map((m) => ({ dir: m[1].replace(/\/?$/, '/'), major: Number(m[2]), minor: Number(m[3]) }))
    .sort((a, b) => (b.major - a.major) || (b.minor - a.minor));
  if (dirs.length === 0) throw new Error('No Blender release directories found on download.blender.org');
  const latest = dirs[0];
  const listing = await fetchText(new URL(latest.dir, BLENDER_RELEASE_INDEX).toString());
  const archives = [...listing.matchAll(/href="(blender-([0-9]+\.[0-9]+\.[0-9]+)-([a-z0-9._-]+)\.(tar\.xz|zip|dmg))"/g)]
    .map((m) => ({ filename: m[1], version: m[2], build: m[3], ext: m[4] }));
  const handles = [...new Set(archives.map((a) => a.version))].sort((a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    return (pb[0] - pa[0]) || (pb[1] - pa[1]) || (pb[2] - pa[2]);
  });
  const value = { series: latest.dir, version: handles[0] || null, archives };
  cache.blenderVersion = { at: Date.now(), value };
  return value;
}

function pickArchiveForPlatform(release, env) {
  if (!release || !Array.isArray(release.archives)) return null;
  const wanted = {
    'linux-x64': /linux-x64\.tar\.xz$/,
    'linux-arm64': /linux-arm64\.tar\.xz$/,
    'darwin-arm64': /macos-arm64\.dmg$/,
    'darwin-x64': /macos-x64\.dmg$/,
    'win32-x64': /windows-x64\.zip$/
  }[env.key];
  if (!wanted) return null;
  const match = release.archives.find((a) => a.version === release.version && wanted.test(a.filename));
  if (!match) return null;
  return {
    ...match,
    url: new URL(match.filename, new URL(release.series, BLENDER_RELEASE_INDEX)).toString(),
    sha256Url: new URL(`${match.filename}.sha256`, new URL(release.series, BLENDER_RELEASE_INDEX)).toString(),
    versionSha256Url: new URL(`blender-${match.version}.sha256`, new URL(release.series, BLENDER_RELEASE_INDEX)).toString()
  };
}

async function installBlender(options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => null;
  const env = detectSystemEnvironment();
  onProgress({ percent: 10, stage: 'Detecting Environment', detail: `Detected ${env.osName} (${env.arch})` });

  const existing = getBlenderStatus();
  if (existing.installed) {
    onProgress({ percent: 100, stage: 'Ready', detail: `Existing ${existing.version} detected at ${existing.path}` });
    return { success: true, version: existing.version, path: existing.path, reused: true };
  }

  onProgress({ percent: 25, stage: 'Resolving Release', detail: `Reading ${BLENDER_RELEASE_INDEX}` });
  const release = await resolveLatestBlenderRelease();
  const archive = pickArchiveForPlatform(release, env);
  if (!archive) {
    throw new Error(`No Blender ${release.version} archive published for ${env.key}`);
  }
  onProgress({ percent: 40, stage: 'Downloading Blender LTS', detail: `Fetching ${archive.filename}` });

  fs.mkdirSync(getToolchainDir(), { recursive: true });
  const destDir = path.join(getToolchainDir(), 'downloads');
  fs.mkdirSync(destDir, { recursive: true });
  // Blender publishes a `.sha256` sidecar for some archives but not all, so resolve
  // the digest before pulling hundreds of megabytes and treat a 404 as "unsigned".
  const expected = await resolveExpectedDigest(archive);
  if (!expected) {
    onProgress({ percent: 45, stage: 'Verifying Integrity', detail: 'No published SHA256 digest for this archive' });
  }
  const archivePath = path.join(destDir, archive.filename);
  const res = await fetch(archive.url, { signal: AbortSignal.timeout(600000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${archive.url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(archivePath, buffer);

  onProgress({ percent: 70, stage: 'Verifying Integrity', detail: 'Checking published SHA256 digest' });
  const actual = require('crypto').createHash('sha256').update(buffer).digest('hex');
  if (expected && expected !== actual) {
    fs.rmSync(archivePath, { force: true });
    throw new Error(`SHA256 mismatch for ${archive.filename} (expected ${expected}, got ${actual})`);
  }

  onProgress({ percent: 85, stage: 'Extracting Package', detail: `Extracting into ${getToolchainDir()}/blender` });
  const extractDir = path.join(getToolchainDir(), 'blender');
  fs.mkdirSync(extractDir, { recursive: true });
  const flag = archive.ext === 'zip' ? '-xf' : (archive.ext === 'dmg' ? null : '-xJf');
  if (!flag) throw new Error('macOS .dmg installs must be mounted manually or installed via brew');
  const tar = spawnSync('tar', [flag, archivePath, '-C', extractDir], { encoding: 'utf8', timeout: 600000 });
  if (tar.status !== 0) throw new Error(`Extraction failed: ${(tar.stderr || '').slice(0, 300)}`);

  const installed = getBlenderStatus({ forceRefresh: true });
  onProgress({ percent: 100, stage: 'Ready', detail: `Blender ${installed.version || installVersion(release)} installed` });
  return { success: installed.installed, version: installed.version, path: installed.path, reused: false };
}

function installVersion(release) {
  return release ? release.version : null;
}

// Cache-only read for synchronous callers (doctor): never starts a network fetch,
// so a slow PyPI cannot leave a floating promise whose rejection kills the process.
function getCachedDccMcpVersion() {
  if (process.env.KONOHA_DCC_MCP_VERSION) return process.env.KONOHA_DCC_MCP_VERSION;
  if (cache.dccLatest.value && Date.now() - cache.dccLatest.at < VERSION_CACHE_TTL_MS) return cache.dccLatest.value;
  return null;
}

async function resolveLatestDccMcpVersion() {
  if (process.env.KONOHA_DCC_MCP_VERSION) return process.env.KONOHA_DCC_MCP_VERSION;
  if (cache.dccLatest.value && Date.now() - cache.dccLatest.at < VERSION_CACHE_TTL_MS) return cache.dccLatest.value;
  const data = JSON.parse(await fetchText(DCC_MCP_PYPI_URL));
  const version = data && data.info && data.info.version;
  if (version) cache.dccLatest = { at: Date.now(), value: version };
  return version || null;
}

const USERMODULE_INSTALL_EXPR = [
  'import sys, subprocess, os',
  'import bpy',
  "mods = bpy.utils.user_resource('SCRIPTS', path='addons', create=True) + '/modules'",
  'os.makedirs(mods, exist_ok=True)',
  "print('KONOHA_MODULES_DIR=' + mods)",
  "cmd = [sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check', '--target', mods, '--upgrade', TARGET_PACKAGE_REQ]",
  'proc = subprocess.run(cmd, capture_output=True, text=True)',
  "print('KONOHA_PIP_RC=' + str(proc.returncode))",
  "print('KONOHA_PIP_OUT=' + (proc.stdout or '')[-1200:])",
  "print('KONOHA_PIP_ERR=' + (proc.stderr or '')[-1200:])"
].join('\n');

async function installDccMcpBlender(options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => null;
  const blender = getBlenderStatus();
  if (!blender.installed || !blender.path) {
    return { success: false, error: 'Blender must be installed first', version: null };
  }

  const existing = getDccMcpStatus();
  if (existing.installed && !options.forceReinstall) {
    onProgress({ percent: 50, stage: 'Verifying Import', detail: `Existing dcc-mcp-blender ${existing.version} detected` });
    onProgress({ percent: 100, stage: 'Ready', detail: `dcc-mcp-blender ${existing.version} verified` });
    return { success: true, version: existing.version, reused: true, error: null };
  }

  onProgress({ percent: 15, stage: 'Resolving Version', detail: 'Reading latest release from PyPI' });
  const targetVersion = await resolveLatestDccMcpVersion();
  if (!targetVersion) return { success: false, error: 'Unable to resolve dcc-mcp-blender version', version: null };

  onProgress({ percent: 40, stage: 'Installing Package', detail: `Installing dcc-mcp-blender==${targetVersion} into Blender user modules` });
  const spec = `dcc-mcp-blender==${targetVersion}`;
  const expr = USERMODULE_INSTALL_EXPR.replace('TARGET_PACKAGE_REQ', JSON.stringify(spec));
  const res = spawnSync(blender.path, ['-b', '--factory-startup', '-noaudio', '--python-expr', expr], {
    encoding: 'utf8',
    timeout: 600000
  });
  const out = `${res.stdout || ''}\n${res.stderr || ''}`;
  const modulesDirMatch = out.match(/KONOHA_MODULES_DIR=(.*)/);
  const rcMatch = out.match(/KONOHA_PIP_RC=(\d+)/);
  const rc = rcMatch ? Number(rcMatch[1]) : (res.status || 1);

  onProgress({ percent: 85, stage: 'Verifying Import', detail: 'Probing dcc_mcp_blender inside Blender' });
  const status = getDccMcpStatus({ forceRefresh: true });
  onProgress({ percent: 100, stage: status.installed ? 'Ready' : 'Failed', detail: status.installed ? `dcc-mcp-blender ${status.version} verified` : (status.error || 'verification failed') });

  return {
    success: Boolean(status.installed && rc === 0),
    version: status.version,
    requested_version: targetVersion,
    modules_dir: modulesDirMatch ? modulesDirMatch[1].trim() : null,
    pip_return_code: rc,
    log_excerpt: out.slice(-1500),
    error: status.error
  };
}

async function installAllTools(options = {}) {
  // A disabled host must never shell out, so it must never download either. Report
  // the current toolchain instead of failing on an install it was told not to run.
  if (blenderDisabled()) {
    if (typeof options.onProgress === 'function') {
      options.onProgress('Blender disabled on this host; skipping toolchain install.');
    }
    return getToolchainStatus();
  }
  await installBlender(options);
  await installDccMcpBlender(options);
  return getToolchainStatus();
}

module.exports = {
  getToolchainDir,
  detectSystemEnvironment,
  findInstalledBlenderBinary,
  findInstalledBlenderBinaries,
  blenderDisabled,
  parseBlenderVersionBanner,
  readBlenderVersion,
  getBlenderStatus,
  getDccMcpStatus,
  getToolchainStatus,
  getToolchainStatusAsync,
  probeManifoldWasm,
  resolveLatestBlenderRelease,
  resolveLatestDccMcpVersion,
  getCachedDccMcpVersion,
  installBlender,
  installDccMcpBlender,
  installAllTools
};
