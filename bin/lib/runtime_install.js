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
    // Link first (instant, no 459 MB copy). A failed link must never fall through
    // to a copy silently: on a network share or a locked-down box the copy can
    // take minutes and, if it also fails, the caller sees "deps missing" and runs
    // a full package-manager install instead. Each layer reports why it failed.
    const linkErrors = [];
    for (const type of ['junction', 'dir']) {
      try {
        fs.symlinkSync(rootNodeModules, nodeModulesPath, type);
        return;
      } catch (err) {
        linkErrors.push(`${type}: ${err.code || err.message}`);
      }
    }
    try {
      fs.cpSync(rootNodeModules, nodeModulesPath, { recursive: true, dereference: true });
      return;
    } catch (err) {
      linkErrors.push(`copy: ${err.code || err.message}`);
    }
    warn(`Could not materialize node_modules at ${nodeModulesPath} (${linkErrors.join('; ')})`);
    return;
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
    } else if (entry.isDirectory() && entry.name === 'grammars') {
      const grammarsSrc = path.join(assetsSrc, 'grammars');
      const grammarsDest = path.join(SKILLS_DB_DIR, 'assets', 'grammars');
      if (path.resolve(grammarsSrc) !== path.resolve(grammarsDest)) copyTree(grammarsSrc, grammarsDest);
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

// A build is only usable if its own metadata says what it is. `handler.js` proves the
// tree was built, not which source produced it, and the destination package.json is
// copied from the source manifest — neither is provenance.
function readBuildMeta(dir) {
  const metaPath = path.join(dir, 'build-meta.json');
  if (!fileExists(metaPath)) return { ok: false, reason: 'missing build-meta.json' };
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (err) {
    return { ok: false, reason: `unreadable build-meta.json (${err.message})` };
  }
  const version = raw && typeof raw.version === 'string' ? raw.version.trim() : '';
  if (!version) return { ok: false, reason: 'build-meta.json has no string version' };
  return { ok: true, version, builtAt: typeof raw.builtAt === 'string' ? raw.builtAt : null };
}

function readBuildVersion(dir) {
  const meta = readBuildMeta(dir);
  return meta.ok ? meta.version : null;
}

function defaultWebBuildCandidates(sourceRoot) {
  return [
    path.join(sourceRoot, 'apps', 'web', 'build'),
    path.resolve(__dirname, '..', '..', 'apps', 'web', 'build'),
    path.join(process.cwd(), 'apps', 'web', 'build'),
    path.join(process.cwd(), 'build')
  ];
}

function resolveWebBuildSource(sourceRoot = REPO_ROOT, currentVersion = null, candidates = defaultWebBuildCandidates(sourceRoot)) {
  const rejected = [];
  for (const cand of candidates) {
    if (!fileExists(path.join(cand, 'handler.js'))) {
      rejected.push(`${cand}: no handler.js`);
      continue;
    }
    const meta = readBuildMeta(cand);
    if (!meta.ok) {
      warn(`Skipping unverified Web UI build at ${cand}: ${meta.reason}`);
      rejected.push(`${cand}: ${meta.reason}`);
      continue;
    }
    if (currentVersion && meta.version !== currentVersion) {
      warn(`Skipping stale Web UI build ${meta.version} at ${cand} (installing ${currentVersion})`);
      rejected.push(`${cand}: stale ${meta.version}`);
      continue;
    }
    if (rejected.length > 0) {
      warn(`Web UI build accepted: ${cand} (v${meta.version}), ${rejected.length} candidate(s) rejected`);
    }
    return cand;
  }
  // Every candidate was unverified or stale. Returning a default path here would copy
  // the very artifact we just rejected, so signal "no usable source" and let the caller
  // fall back to an on-demand build.
  warn(`No verified Web UI build found among ${candidates.length} candidate(s): ${rejected.join('; ')}`);
  return null;
}

function _syncWebBuildOutput(builtOutput, webBuildDest, destWebPkg, currentVersion) {
  const srcMeta = readBuildMeta(builtOutput);
  if (!srcMeta.ok) {
    return { ok: false, reason: `source ${builtOutput} has no usable provenance: ${srcMeta.reason}` };
  }
  if (currentVersion && srcMeta.version !== currentVersion) {
    return { ok: false, reason: `source declares v${srcMeta.version}, expected v${currentVersion}` };
  }

  const sameDir = path.resolve(builtOutput) === path.resolve(webBuildDest);
  if (!sameDir) {
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
    fs.writeFileSync(
      destWebPkg,
      JSON.stringify({ name: 'konoha-web', version: srcMeta.version, type: 'module', private: true }, null, 2) + '\n'
    );
    fs.writeFileSync(path.join(webBuildDest, 'package.json'), '{\n  "type": "module"\n}\n');
  }

  // The copy is only trusted once the destination's own metadata agrees with the
  // source's. A failed verification removes the unverified tree: absence is a state
  // the server reports, a garbage build is one it serves.
  const destMeta = readBuildMeta(webBuildDest);
  if (!destMeta.ok || destMeta.version !== srcMeta.version) {
    const reason = destMeta.ok
      ? `destination declares v${destMeta.version}, source v${srcMeta.version}`
      : destMeta.reason;
    if (!sameDir) {
      try {
        fs.rmSync(webBuildDest, { recursive: true, force: true, maxRetries: 3 });
      } catch { /* best-effort removal of an unverified tree */ }
    }
    warn(`ERROR: Web UI provenance verification failed at ${webBuildDest}: ${reason}; the unverified build was removed`);
    return { ok: false, reason };
  }

  info(`Pre-built Web UI installed to ${webBuildDest} (v${destMeta.version} verified)`);
  return { ok: true, version: destMeta.version };
}

function shouldBuildWebUiOnDemand(webBuildDest, currentVersion) {
  if (!fileExists(path.join(webBuildDest, 'handler.js'))) return { needed: true, reason: 'no-handler' };
  const meta = readBuildMeta(webBuildDest);
  if (!meta.ok) {
    const slug = meta.reason.startsWith('missing ')
      ? 'missing'
      : meta.reason.startsWith('unreadable ') ? 'invalid' : 'no-version';
    return { needed: true, reason: `provenance-${slug}` };
  }
  if (currentVersion && meta.version !== currentVersion) return { needed: true, reason: 'stale' };
  return { needed: false, reason: 'verified' };
}

function buildWebUiOnDemand(webBuildDest, destWebPkg, currentVersion) {
  const sourceDir = deployUtils.resolveWebUiDir({ preferSources: true });
  if (!sourceDir || !fileExists(path.join(sourceDir, 'src', 'routes'))) {
    warn('No Web UI source found; cannot build on demand');
    return false;
  }
  try {
    const { execSync } = require('child_process');
    info(`Building Web UI v${currentVersion} during runtime initialization...`);
    try {
      execSync('pnpm run build', { cwd: sourceDir, stdio: 'ignore', timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS });
    } catch (_) {
      execSync('npm run build', { cwd: sourceDir, stdio: 'ignore', timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS });
    }
    const builtOutput = path.join(sourceDir, 'build');
    const builtMeta = readBuildMeta(builtOutput);
    if (!fileExists(path.join(builtOutput, 'handler.js')) || !builtMeta.ok || builtMeta.version !== currentVersion) {
      const why = builtMeta.ok ? `declares v${builtMeta.version}, expected v${currentVersion}` : builtMeta.reason;
      warn(`ERROR: on-demand Web UI build produced no verifiable metadata at ${builtOutput} (${why}); run \`pnpm run build:web\``);
      return false;
    }
    if (path.resolve(builtOutput) === path.resolve(webBuildDest)) return true;
    return _syncWebBuildOutput(builtOutput, webBuildDest, destWebPkg, currentVersion).ok;
  } catch (buildErr) {
    warn(`Could not build Web UI automatically: ${buildErr.message}`);
    return false;
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
  const webBuildDest = path.join(SKILLS_DB_DIR, 'apps', 'web', 'build');
  const destWebPkg = path.join(webDestDir, 'package.json');
  const destState = shouldBuildWebUiOnDemand(webBuildDest, currentVersion);
  const webBuildSrc = resolveWebBuildSource(sourceRoot, currentVersion);

  let synced = false;
  if (webBuildSrc) {
    if (path.resolve(webBuildSrc) !== path.resolve(webBuildDest) || !destState.needed) {
      const result = _syncWebBuildOutput(webBuildSrc, webBuildDest, destWebPkg, currentVersion);
      synced = result.ok;
      if (!result.ok) warn(`Web UI sync rejected: ${result.reason}`);
    }
  }
  if (!synced && (destState.needed || !webBuildSrc)) {
    if (!webBuildSrc && destState.needed) warn(`No Web UI build matches the installed version (${destState.reason}); building on demand.`);
    buildWebUiOnDemand(webBuildDest, destWebPkg, currentVersion);
  }

  // The only place a version may be claimed: the metadata of the tree that will be served.
  const finalMeta = readBuildMeta(webBuildDest);
  if (finalMeta.ok && finalMeta.version === currentVersion && fileExists(path.join(webBuildDest, 'handler.js'))) {
    info(`Web UI v${finalMeta.version} verified at ${webBuildDest}`);
  } else {
    warn(
      `ERROR: Web UI at ${webBuildDest} is unverified (${finalMeta.ok ? `v${finalMeta.version}` : finalMeta.reason}); ` +
      `reported version ${currentVersion} is not claimed. Run \`pnpm run build:web\` and re-run \`konoha init\`.`
    );
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
  copyRuntimeAssets,
  copyRuntimeFiles,
  resolveEffectiveSourceRoot,
  copyRecursive,
  copyRecursiveIfDifferent,
  installCliRuntime,
  reconcileGlobalCommand,
  resolveWebBuildSource,
  readBuildMeta,
  readBuildVersion,
  _syncWebBuildOutput,
  shouldBuildWebUiOnDemand,
  installWebUiRuntime
};
