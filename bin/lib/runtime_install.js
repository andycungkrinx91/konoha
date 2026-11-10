'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const {
  HOME,
  SKILLS_DB_DIR,
  SRC_DIR,
  INSTALL_BUILD_MIGRATE_TIMEOUT_MS
} = require('./paths');
const { fileExists, ensureDir, copyFile } = require('./prompt');
const { info, warn, getCliVersion } = require('./format');
const deployUtils = require('../../src/deploy_utils');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function resolveEffectiveSourceRoot(options = {}) {
  const candidate = (options && options.sourceRoot) || process.env.KONOHA_UPGRADE_SOURCE_ROOT || '';
  if (candidate && fileExists(path.join(candidate, 'package.json'))) {
    return path.resolve(candidate);
  }
  return REPO_ROOT;
}

function readPackageVersionSafe(pkgJsonPath) {
  try {
    if (!fileExists(pkgJsonPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    return parsed && parsed.version ? String(parsed.version).trim() : null;
  } catch {
    return null;
  }
}

function isSimpleSemverNewer(vA, vB) {
  if (!vA || !vB) return false;
  const parse = (v) => String(v).replace(/^v/, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  const [a0 = 0, a1 = 0, a2 = 0] = parse(vA);
  const [b0 = 0, b1 = 0, b2 = 0] = parse(vB);
  if (a0 !== b0) return a0 > b0;
  if (a1 !== b1) return a1 > b1;
  return a2 > b2;
}

/**
 * Stale-sourceRoot guard.
 *
 * `resolveEffectiveSourceRoot` may hand us a tree that is older than this repo
 * (e.g. KONOHA_UPGRADE_SOURCE_ROOT pointing at a previously installed global
 * package). Mirroring such a tree would silently *downgrade* ~/.konoha/src.
 * returns { stale, sourceVersion, repoVersion } where `stale` is true only when
 * the sourceRoot is a different tree whose version is strictly older.
 */
function assessSourceRootFreshness(sourceRoot, repoRoot = REPO_ROOT) {
  const resolvedSource = path.resolve(sourceRoot);
  const resolvedRepo = path.resolve(repoRoot);
  const repoVersion = readPackageVersionSafe(path.join(resolvedRepo, 'package.json'));
  if (resolvedSource === resolvedRepo) {
    return { stale: false, sourceVersion: repoVersion, repoVersion };
  }
  const sourceVersion = readPackageVersionSafe(path.join(resolvedSource, 'package.json'));
  const stale = Boolean(
    sourceVersion && repoVersion && isSimpleSemverNewer(repoVersion, sourceVersion)
  );
  return { stale, sourceVersion, repoVersion };
}

function readDeclaredDependencies(pkgJsonPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    return Object.keys(parsed.dependencies || {});
  } catch {
    return [];
  }
}

function resolvePackageDir(nodeModulesPath, depName) {
  return path.join(nodeModulesPath, ...depName.split('/'));
}

function listMissingDependencies(nodeModulesPath, deps) {
  return deps.filter((depName) => !fileExists(resolvePackageDir(nodeModulesPath, depName)));
}

function copyDependencyFrom(sourceNodeModules, nodeModulesPath, depName) {
  const srcPkg = resolvePackageDir(sourceNodeModules, depName);
  if (!fileExists(srcPkg)) return false;
  const destPkg = resolvePackageDir(nodeModulesPath, depName);
  try {
    const realPkg = fs.realpathSync(srcPkg);
    ensureDir(path.dirname(destPkg));
    if (fileExists(destPkg)) fs.rmSync(destPkg, { recursive: true, force: true });
    fs.cpSync(realPkg, destPkg, { recursive: true, dereference: true });
    return true;
  } catch {
    return false;
  }
}

function linkOrCopyModuleTree(nodeModulesPath, sourceRoot = REPO_ROOT) {
  const rootNodeModules = path.join(sourceRoot, 'node_modules');
  if (!fileExists(rootNodeModules)) return;
  if (!fileExists(nodeModulesPath)) {
    try {
      fs.symlinkSync(rootNodeModules, nodeModulesPath, process.platform === 'win32' ? 'junction' : 'dir');
      return;
    } catch {
      copyRecursiveIfDifferent(rootNodeModules, nodeModulesPath);
      return;
    }
  }
  const deps = readDeclaredDependencies(path.join(sourceRoot, 'package.json'));
  const webNodeModules = path.join(sourceRoot, 'apps', 'web', 'node_modules');
  for (const depName of listMissingDependencies(nodeModulesPath, deps)) {
    if (copyDependencyFrom(rootNodeModules, nodeModulesPath, depName)) continue;
    copyDependencyFrom(webNodeModules, nodeModulesPath, depName);
  }
}

function _tryLinkRootModules(nodeModulesPath, sourceRoot = REPO_ROOT) {
  linkOrCopyModuleTree(nodeModulesPath, sourceRoot);
}

function copyIfDifferent(src, dest) {
  if (path.resolve(src) === path.resolve(dest)) return false;
  if (!fileExists(dest)) {
    copyFile(src, dest);
    return true;
  }
  try {
    const srcContent = fs.readFileSync(src);
    const destContent = fs.readFileSync(dest);
    if (!srcContent.equals(destContent)) {
      copyFile(src, dest);
      return true;
    }
  } catch (_) {
    try { copyFile(src, dest); return true; } catch { /* intentional best-effort fallback */ }
  }
  return false;
}

function copyRecursive(src, dest) {
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    ensureDir(dest);
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    copyFile(src, dest);
  }
}

function copyRecursiveIfDifferent(src, dest) {
  let stats;
  try {
    stats = fs.statSync(src);
  } catch {
    return;
  }
  if (stats.isDirectory()) {
    ensureDir(dest);
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      copyRecursiveIfDifferent(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    copyIfDifferent(src, dest);
  }
}

function copyDirectoryFiles(srcDir, destDir) {
  if (!fileExists(srcDir) || path.resolve(srcDir) === path.resolve(destDir)) return;
  ensureDir(destDir);
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.isFile()) {
      copyIfDifferent(path.join(srcDir, entry.name), path.join(destDir, entry.name));
    }
  }
}

function copyRuntimeAssets(assetsSrc, copyTree) {
  if (!fileExists(assetsSrc)) return;
  for (const entry of fs.readdirSync(assetsSrc, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.vsix')) {
      const destFile = path.join(SKILLS_DB_DIR, 'assets', entry.name);
      if (path.resolve(path.join(assetsSrc, entry.name)) !== path.resolve(destFile)) {
        ensureDir(path.join(SKILLS_DB_DIR, 'assets'));
        copyFile(path.join(assetsSrc, entry.name), destFile);
      }
    } else if (entry.isDirectory() && entry.name === 'models') {
      const modelsSrc = path.join(assetsSrc, 'models');
      const modelsDest = path.join(SKILLS_DB_DIR, 'assets', 'models');
      if (path.resolve(modelsSrc) !== path.resolve(modelsDest)) copyTree(modelsSrc, modelsDest);
    }
  }
}

function copyRuntimeFiles(copyTree, sourceRoot = REPO_ROOT) {
  const cliDest = path.join(SKILLS_DB_DIR, 'bin', 'cli.js');
  ensureDir(path.join(SKILLS_DB_DIR, 'bin'));

  const destPkgPath = path.join(SKILLS_DB_DIR, 'package.json');
  const pkgSrc = path.join(sourceRoot, 'package.json');
  const destVer = readPackageVersionSafe(destPkgPath);
  const srcVer = readPackageVersionSafe(pkgSrc);
  // The mirror only ever moves forward. A sourceRoot older than what is
  // already installed must neither downgrade nor silently re-populate ~/.konoha.
  if (destVer && srcVer && isSimpleSemverNewer(destVer, srcVer)) {
    warn(
      `Skipping runtime mirror from ${path.resolve(sourceRoot)}: source version ${srcVer} is older than ` +
      `installed version ${destVer}. The mirror at ${SKILLS_DB_DIR} was left untouched.`
    );
    return cliDest;
  }

  // --- src/ mirror -------------------------------------------------------
  // Copies src/mcp/**/*.js and friends. Guarded so a stale sourceRoot can
  // never populate the mirror silently.
  const destSrc = path.join(SKILLS_DB_DIR, 'src');
  const effectiveSrcDir = fileExists(path.join(sourceRoot, 'src')) ? path.join(sourceRoot, 'src') : SRC_DIR;
  const freshness = assessSourceRootFreshness(sourceRoot);
  let srcFresh = false;
  if (freshness.stale) {
    warn(
      `Refusing to mirror stale sourceRoot into ${destSrc}: ` +
      `source version ${freshness.sourceVersion} is older than repo version ${freshness.repoVersion}. ` +
      `Re-run from the current repo or upgrade the installed package.`
    );
  } else if (fileExists(effectiveSrcDir)) {
    srcFresh = true;
    if (path.resolve(effectiveSrcDir) !== path.resolve(destSrc)) copyTree(effectiveSrcDir, destSrc);
  }

  // Everything below is gated on src/: a tree whose src/ was refused is not a
  // trustworthy source for docs/, skills, CLI or manifest either.
  if (!srcFresh) return cliDest;

  copyRuntimeAssets(path.join(sourceRoot, 'assets'), copyTree);

  const sourceCliPath = path.join(sourceRoot, 'bin', 'cli.js');
  if (fileExists(sourceCliPath) && path.resolve(sourceCliPath) !== path.resolve(cliDest)) {
    copyFile(sourceCliPath, cliDest);
  }

  if (fileExists(pkgSrc) && path.resolve(pkgSrc) !== path.resolve(destPkgPath)) {
    copyFile(pkgSrc, destPkgPath);
  }

  const patchesSrc = path.join(sourceRoot, 'patches');
  const patchesDest = path.join(SKILLS_DB_DIR, 'patches');
  if (fileExists(patchesSrc) && path.resolve(patchesSrc) !== path.resolve(patchesDest)) {
    copyTree(patchesSrc, patchesDest);
  }

  const migrationsSrc = path.join(sourceRoot, 'migrations');
  const migrationsDest = path.join(SKILLS_DB_DIR, 'migrations');
  if (fileExists(migrationsSrc) && path.resolve(migrationsSrc) !== path.resolve(migrationsDest)) {
    copyTree(migrationsSrc, migrationsDest);
  }

  copyDirectoryFiles(path.join(sourceRoot, 'bin', 'lib'), path.join(SKILLS_DB_DIR, 'bin', 'lib'));
  copyDirectoryFiles(path.join(sourceRoot, 'bin', 'commands'), path.join(SKILLS_DB_DIR, 'bin', 'commands'));
  return cliDest;
}

function readBuildVersion(dir) {
  const meta = path.join(dir, 'build-meta.json');
  if (!fileExists(meta)) return null;
  try {
    return JSON.parse(fs.readFileSync(meta, 'utf8')).version || null;
  } catch {
    return null;
  }
}

function resolveWebBuildSource(sourceRoot = REPO_ROOT, currentVersion = null) {
  const candidates = [
    path.join(sourceRoot, 'apps', 'web', 'build'),
    path.resolve(__dirname, '..', '..', 'apps', 'web', 'build'),
    path.join(process.cwd(), 'apps', 'web', 'build'),
    path.join(process.cwd(), 'build')
  ];
  const found = [];
  for (const cand of candidates) {
    if (!fileExists(path.join(cand, 'handler.js'))) continue;
    const declared = readBuildVersion(cand);
    if (declared && currentVersion && declared !== currentVersion) {
      warn(`Skipping stale Web UI build ${declared} at ${cand} (installing ${currentVersion})`);
      continue;
    }
    found.push(cand);
  }
  // Every candidate was stale. Returning the default path here would copy the
  // very artifact we just rejected, so signal "no usable source" and let the
  // caller fall back to an on-demand build.
  return found[0] || null;
}

function _syncWebBuildOutput(builtOutput, webBuildDest, destWebPkg, currentVersion) {
  try {
    fs.rmSync(webBuildDest, { recursive: true, force: true, maxRetries: 3 });
  } catch (rmErr) {
    if (process.platform === 'win32') {
      warn(`Web UI destination cleanup note (${rmErr.message}); proceeding with in-place synchronization.`);
    }
  }
  ensureDir(webBuildDest);
  try {
    fs.cpSync(builtOutput, webBuildDest, { recursive: true, force: true });
  } catch (cpErr) {
    warn(`Web UI assets sync note: ${cpErr.message}`);
  }
  fs.writeFileSync(destWebPkg, JSON.stringify({ name: 'konoha-web', version: currentVersion, type: 'module', private: true }, null, 2) + '\n');
  fs.writeFileSync(path.join(webBuildDest, 'package.json'), '{\n  "type": "module"\n}\n');

  // Report the version the artifact tree actually declares, not the one we hoped
  // for: a source build without build-meta.json has unknown provenance, and a
  // mismatched stamp must never be printed as the installed version.
  const installedVersion = readBuildVersion(webBuildDest);
  if (!installedVersion) {
    warn(`ERROR: Web UI provenance unknown at ${webBuildDest} (no build-meta.json); reported version ${currentVersion} is unverified.`);
  } else if (installedVersion !== currentVersion) {
    warn(`ERROR: Web UI version mismatch at ${webBuildDest}: expected ${currentVersion}, found ${installedVersion}.`);
  }
  info(`Pre-built Web UI installed to ${webBuildDest} (v${installedVersion || currentVersion})`);
}

function buildWebUiOnDemand(webBuildDest, destWebPkg, currentVersion) {
  const sourceDir = deployUtils.resolveWebUiDir({ preferSources: true });
  if (!sourceDir || !fileExists(path.join(sourceDir, 'src', 'routes'))) return;
  try {
    const { execSync } = require('child_process');
    info(`Building Web UI v${currentVersion} during runtime initialization...`);
    try {
      execSync('pnpm run build', { cwd: sourceDir, stdio: 'ignore', timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS });
    } catch (_) {
      execSync('npm run build', { cwd: sourceDir, stdio: 'ignore', timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS });
    }
    const builtOutput = path.join(sourceDir, 'build');
    if (fileExists(path.join(builtOutput, 'handler.js')) && path.resolve(builtOutput) !== path.resolve(webBuildDest)) {
      _syncWebBuildOutput(builtOutput, webBuildDest, destWebPkg, currentVersion);
    }
  } catch (buildErr) {
    warn(`Could not build Web UI automatically: ${buildErr.message}`);
  }
}

function installWebUiRuntime(copyTree, sourceRoot = REPO_ROOT) {
  let webSrcDir = path.join(sourceRoot, 'apps', 'web');
  if (!fileExists(path.join(webSrcDir, 'package.json')) && fileExists(path.join(process.cwd(), 'apps', 'web', 'package.json'))) {
    webSrcDir = path.join(process.cwd(), 'apps', 'web');
  }
  const webDestDir = path.join(SKILLS_DB_DIR, 'apps', 'web');
  if (fileExists(path.join(webSrcDir, 'package.json')) && path.resolve(webSrcDir) !== path.resolve(webDestDir)) {
    copyTree(webSrcDir, webDestDir);
    info(`Web UI application installed to ${webDestDir}`);
  }

  const currentVersion = readPackageVersionSafe(path.join(sourceRoot, 'package.json')) || getCliVersion();
  const webBuildSrc = resolveWebBuildSource(sourceRoot, currentVersion);
  const webBuildDest = path.join(SKILLS_DB_DIR, 'apps', 'web', 'build');
  const destWebPkg = path.join(webDestDir, 'package.json');
  let destVersion = null;
  try {
    if (fileExists(destWebPkg)) destVersion = JSON.parse(fs.readFileSync(destWebPkg, 'utf8')).version;
  } catch (_) { /* best-effort */ }
  const isUiOutdated = !destVersion || destVersion !== currentVersion;

  if (webBuildSrc && fileExists(path.join(webBuildSrc, 'handler.js'))) {
    if (path.resolve(webBuildSrc) !== path.resolve(webBuildDest) || isUiOutdated) {
      _syncWebBuildOutput(webBuildSrc, webBuildDest, destWebPkg, currentVersion);
    }
  } else if (!fileExists(path.join(webBuildDest, 'handler.js')) || isUiOutdated) {
    if (!webBuildSrc) warn('No Web UI build matches the installed version; building on demand.');
    buildWebUiOnDemand(webBuildDest, destWebPkg, currentVersion);
  }
}

function installMissingDependencies(deps) {
  const isWin = process.platform === 'win32';
  const { env: childEnv } = deployUtils.resolveCompatibleNodeEnv(process.env);
  const pmCandidates = [
    { cmd: isWin ? 'pnpm.cmd' : 'pnpm', args: ['install', '--prod', '--no-frozen-lockfile'] },
    { cmd: isWin ? 'npm.cmd' : 'npm', args: ['install', '--omit=dev', '--no-audit', '--no-fund'] }
  ];
  for (const pm of pmCandidates) {
    try {
      const res = isWin
        ? spawnSync(`"${pm.cmd}" ${pm.args.join(' ')}`, {
            cwd: SKILLS_DB_DIR, encoding: 'utf-8', timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS, stdio: 'ignore', shell: true, windowsHide: true, env: childEnv
          })
        : spawnSync(pm.cmd, pm.args, {
            cwd: SKILLS_DB_DIR, encoding: 'utf-8', timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS, stdio: 'ignore', env: childEnv
          });
      if (res.status === 0 && listMissingDependencies(path.join(SKILLS_DB_DIR, 'node_modules'), deps).length === 0) return true;
    } catch { /* best-effort package manager fallback */ }
  }
  return false;
}

function ensureRuntimeDependencies(sourceRoot = REPO_ROOT) {
  const nodeModulesPath = path.join(SKILLS_DB_DIR, 'node_modules');
  const deps = readDeclaredDependencies(path.join(sourceRoot, 'package.json'));
  if (deps.length === 0 || listMissingDependencies(nodeModulesPath, deps).length === 0) return;

  _tryLinkRootModules(nodeModulesPath, sourceRoot);
  const stillMissing = listMissingDependencies(nodeModulesPath, deps);
  if (stillMissing.length === 0) return;

  installMissingDependencies(deps);
}

function copyTreeEntry(entry, src, dest, copyTree) {
  const s = path.join(src, entry.name);
  const d = path.join(dest, entry.name);
  if (entry.isDirectory()) return copyTree(s, d);
  if (entry.isSymbolicLink()) {
    try {
      const target = fs.readlinkSync(s);
      if (fs.existsSync(d)) fs.unlinkSync(d);
      return fs.symlinkSync(target, d);
    } catch (_) {
      return copyFile(s, d);
    }
  }
  if (entry.isFile()) copyFile(s, d);
}

function installCliRuntime(options = {}) {
  const sourceRoot = resolveEffectiveSourceRoot(options);
  const skipNames = new Set(['.ruff_cache', '__pycache__', '.pytest_cache', '.DS_Store', 'node_modules', '.svelte-kit', 'build', 'dist']);
  const copyTree = (src, dest) => {
    if (path.resolve(src) === path.resolve(dest)) return;
    ensureDir(dest);
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (skipNames.has(entry.name)) continue;
      copyTreeEntry(entry, src, dest, copyTree);
    }
  };
  try {
    const cliDest = copyRuntimeFiles(copyTree, sourceRoot);
    installWebUiRuntime(copyTree, sourceRoot);
    ensureRuntimeDependencies(sourceRoot);
    return cliDest;
  } catch (_) {
    return path.join(SKILLS_DB_DIR, 'bin', 'cli.js');
  }
}

function getCandidateShimDirs(isWin, homeDir) {
  const candidateDirs = new Set();
  try {
    const npmCmd = isWin ? 'npm.cmd' : 'npm';
    const res = isWin
      ? spawnSync('npm.cmd config get prefix', { encoding: 'utf-8', timeout: 30000, shell: true, windowsHide: true })
      : spawnSync(npmCmd, ['config', 'get', 'prefix'], { encoding: 'utf-8', timeout: 30000 });
    const prefix = ((res.stdout || '') + '').trim().split(/\r?\n/).filter(Boolean).pop();
    if (prefix && fs.existsSync(prefix)) {
      candidateDirs.add(isWin ? prefix : path.join(prefix, 'bin'));
    }
  } catch (_) { /* best-effort */ }

  if (isWin) {
    const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
    candidateDirs.add(path.join(localAppData, 'pnpm'));
  } else {
    candidateDirs.add(path.join(homeDir, '.local', 'share', 'pnpm'));
    candidateDirs.add(path.join(homeDir, 'Library', 'pnpm'));
    candidateDirs.add(path.join(homeDir, '.local', 'bin'));
  }

  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    try {
      if (fs.existsSync(path.join(dir, isWin ? 'konoha.cmd' : 'konoha'))) candidateDirs.add(dir);
    } catch (_) { /* best-effort */ }
  }
  return candidateDirs;
}

function buildShimContents(sourceCli, packageCli, nodeCmd) {
  const shSourceCli = sourceCli.replace(/\\/g, '/');
  const shPackageCli = packageCli.replace(/\\/g, '/');
  const shNodeCmd = nodeCmd.replace(/\\/g, '/');
  return {
    'konoha': `#!/bin/sh\nif [ -f "${shSourceCli}" ]; then\n  exec "${shNodeCmd}" "${shSourceCli}" "$@"\nelif [ -f "${shPackageCli}" ]; then\n  exec "${shNodeCmd}" "${packageCli}" "$@"\nelse\n  exec "${shNodeCmd}" "${shSourceCli}" "$@"\nfi\n`,
    'konoha.cmd': `@echo off\r\nif exist "${sourceCli}" (\r\n  "${nodeCmd}" "${sourceCli}" %*\r\n) else if exist "${packageCli}" (\r\n  "${nodeCmd}" "${packageCli}" %*\r\n) else (\r\n  "${nodeCmd}" "${sourceCli}" %*\r\n)\r\n`,
    'konoha.ps1': `if (Test-Path "${sourceCli}") {\r\n  & "${nodeCmd}" "${sourceCli}" @args\r\n} elseif (Test-Path "${packageCli}") {\r\n  & "${nodeCmd}" "${packageCli}" @args\r\n} else {\r\n  & "${nodeCmd}" "${sourceCli}" @args\r\n}\r\n`
  };
}

function updateExistingShim(shimPath, content, ctx, report) {
  const { mode, isWin, sourceCli } = ctx;
  let st = null;
  try { st = fs.lstatSync(shimPath); } catch (_) { /* best-effort */ }
  if (!st) {
    fs.writeFileSync(shimPath, content, { mode: mode || 0o666 });
    if (!isWin) { try { fs.chmodSync(shimPath, 0o755); } catch (_) { /* best-effort */ } }
    report.created.push(shimPath);
    return;
  }

  if (st.isSymbolicLink()) {
    let resolved = null;
    try {
      const target = fs.readlinkSync(shimPath);
      resolved = path.resolve(path.dirname(shimPath), target);
    } catch (_) { /* best-effort */ }
    if (resolved === sourceCli) {
      report.ok.push(shimPath);
      return;
    }
    fs.unlinkSync(shimPath);
  } else if (fs.readFileSync(shimPath, 'utf8') === content) {
    report.ok.push(shimPath);
    return;
  }

  fs.writeFileSync(shimPath, content);
  if (!isWin) { try { fs.chmodSync(shimPath, 0o755); } catch (_) { /* best-effort */ } }
  report.updated.push(shimPath);
}

function reconcileGlobalCommand() {
  const report = { updated: [], created: [], ok: [], failed: [], sourceCli: null };
  const isWin = process.platform === 'win32';
  const sourceCli = path.join(SKILLS_DB_DIR, 'bin', 'cli.js');
  const packageCli = path.resolve(__dirname, '..', 'cli.js');
  report.sourceCli = sourceCli;
  if (!fileExists(sourceCli)) {
    try { installCliRuntime(); } catch (_) { /* best-effort */ }
  }
  if (!fileExists(sourceCli) && !fileExists(packageCli)) return report;

  const homeDir = HOME;
  const tmpRoot = path.resolve(os.tmpdir());
  if (
    process.env.KONOHA_TEST_SANDBOX === '1' ||
    path.resolve(SKILLS_DB_DIR).startsWith(tmpRoot) ||
    path.resolve(homeDir).startsWith(tmpRoot)
  ) {
    return report;
  }

  const candidateDirs = getCandidateShimDirs(isWin, homeDir);
  const resolvedNode = deployUtils.resolveCompatibleNode() || process.execPath;
  const contents = buildShimContents(sourceCli, packageCli, resolvedNode);
  const shimCtx = { mode: isWin ? undefined : 0o755, isWin, sourceCli };

  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    const shimNames = [isWin ? 'konoha.cmd' : 'konoha'];
    if (isWin) {
      if (fs.existsSync(path.join(dir, 'konoha.ps1'))) shimNames.push('konoha.ps1');
      if (fs.existsSync(path.join(dir, 'konoha'))) shimNames.push('konoha');
    }
    for (const name of shimNames) {
      const shimPath = path.join(dir, name);
      try {
        updateExistingShim(shimPath, contents[name], shimCtx, report);
      } catch (err) {
        report.failed.push({ path: shimPath, error: err.message });
      }
    }
  }

  return report;
}

module.exports = {
  assessSourceRootFreshness,
  copyIfDifferent,
  copyRuntimeFiles,
  resolveEffectiveSourceRoot,
  copyRecursive,
  copyRecursiveIfDifferent,
  installCliRuntime,
  reconcileGlobalCommand,
  resolveWebBuildSource,
  readBuildVersion,
  installWebUiRuntime
};
