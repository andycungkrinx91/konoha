'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const {
  HOME,
  SKILLS_DB_DIR,
  SRC_DIR
} = require('./paths');
const { fileExists, ensureDir, copyFile } = require('./prompt');
const { info, warn, getCliVersion } = require('./format');
const deployUtils = require('../../src/deploy_utils');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

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

function linkOrCopyModuleTree(nodeModulesPath) {
  const rootNodeModules = path.join(REPO_ROOT, 'node_modules');
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
  const deps = readDeclaredDependencies(path.join(REPO_ROOT, 'package.json'));
  const webNodeModules = path.join(REPO_ROOT, 'apps', 'web', 'node_modules');
  for (const depName of listMissingDependencies(nodeModulesPath, deps)) {
    if (copyDependencyFrom(rootNodeModules, nodeModulesPath, depName)) continue;
    copyDependencyFrom(webNodeModules, nodeModulesPath, depName);
  }
}

function _tryLinkRootModules(nodeModulesPath) {
  linkOrCopyModuleTree(nodeModulesPath);
}

function copyIfDifferent(src, dest) {
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

function copyRuntimeFiles(copyTree) {
  const cliDest = path.join(SKILLS_DB_DIR, 'bin', 'cli.js');
  ensureDir(path.join(SKILLS_DB_DIR, 'bin'));

  const sourceCliPath = path.resolve(__dirname, '..', 'cli.js');
  if (fileExists(sourceCliPath)) copyFile(sourceCliPath, cliDest);

  const pkgSrc = path.resolve(__dirname, '..', '..', 'package.json');
  if (fileExists(pkgSrc)) copyFile(pkgSrc, path.join(SKILLS_DB_DIR, 'package.json'));

  const patchesSrc = path.resolve(__dirname, '..', '..', 'patches');
  if (fileExists(patchesSrc)) {
    copyTree(patchesSrc, path.join(SKILLS_DB_DIR, 'patches'));
  }

  const migrationsSrc = path.resolve(__dirname, '..', '..', 'migrations');
  if (fileExists(migrationsSrc)) {
    copyTree(migrationsSrc, path.join(SKILLS_DB_DIR, 'migrations'));
  }

  const libSrc = path.resolve(__dirname);
  if (fileExists(libSrc)) {
    for (const entry of fs.readdirSync(libSrc, { withFileTypes: true })) {
      if (entry.isFile()) {
        ensureDir(path.join(SKILLS_DB_DIR, 'bin', 'lib'));
        copyFile(path.join(libSrc, entry.name), path.join(SKILLS_DB_DIR, 'bin', 'lib', entry.name));
      }
    }
  }

  const commandsSrc = path.resolve(__dirname, '..', 'commands');
  if (fileExists(commandsSrc)) {
    for (const entry of fs.readdirSync(commandsSrc, { withFileTypes: true })) {
      if (entry.isFile()) {
        ensureDir(path.join(SKILLS_DB_DIR, 'bin', 'commands'));
        copyFile(path.join(commandsSrc, entry.name), path.join(SKILLS_DB_DIR, 'bin', 'commands', entry.name));
      }
    }
  }

  if (fileExists(SRC_DIR)) {
    const destSrc = path.join(SKILLS_DB_DIR, 'src');
    if (path.resolve(SRC_DIR) !== path.resolve(destSrc)) copyTree(SRC_DIR, destSrc);
  }

  const templateSkills = path.resolve(__dirname, '..', '..', 'src', 'templates', 'skills');
  const skillsSrc = fileExists(templateSkills)
    ? templateSkills
    : path.resolve(__dirname, '..', '..', '.agents', 'skills');
  const skillsDest = path.join(SKILLS_DB_DIR, '.agents', 'skills');
  if (fileExists(skillsSrc) && path.resolve(skillsSrc) !== path.resolve(skillsDest)) {
    copyTree(skillsSrc, skillsDest);
  }

  const docsSrc = path.resolve(__dirname, '..', '..', 'docs');
  const docsDest = path.join(SKILLS_DB_DIR, 'docs');
  if (fileExists(docsSrc) && path.resolve(docsSrc) !== path.resolve(docsDest)) {
    copyTree(docsSrc, docsDest);
  }

  const assetsSrc = path.resolve(__dirname, '..', '..', 'assets');
  if (fileExists(assetsSrc)) {
    for (const entry of fs.readdirSync(assetsSrc, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.vsix')) {
        ensureDir(path.join(SKILLS_DB_DIR, 'assets'));
        copyFile(path.join(assetsSrc, entry.name), path.join(SKILLS_DB_DIR, 'assets', entry.name));
      } else if (entry.isDirectory() && entry.name === 'models') {
        const modelsSrc = path.join(assetsSrc, 'models');
        const modelsDest = path.join(SKILLS_DB_DIR, 'assets', 'models');
        if (path.resolve(modelsSrc) !== path.resolve(modelsDest)) copyTree(modelsSrc, modelsDest);
      }
    }
  }
  return cliDest;
}

function resolveWebBuildSource() {
  let webBuildSrc = path.resolve(__dirname, '..', '..', 'apps', 'web', 'build');
  if (fileExists(path.join(webBuildSrc, 'handler.js'))) return webBuildSrc;
  const candidates = [
    path.join(process.cwd(), 'apps', 'web', 'build'),
    path.join(process.cwd(), 'build')
  ];
  for (const cand of candidates) {
    if (fileExists(path.join(cand, 'handler.js'))) return cand;
  }
  return webBuildSrc;
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
  info(`Pre-built Web UI installed to ${webBuildDest} (v${currentVersion})`);
}

function buildWebUiOnDemand(webBuildDest, destWebPkg, currentVersion) {
  const sourceDir = deployUtils.resolveWebUiDir({ preferSources: true });
  if (!sourceDir || !fileExists(path.join(sourceDir, 'src', 'routes'))) return;
  try {
    const { execSync } = require('child_process');
    info(`Building Web UI v${currentVersion} during runtime initialization...`);
    try {
      execSync('pnpm run build', { cwd: sourceDir, stdio: 'ignore', timeout: 180000 });
    } catch (_) {
      execSync('npm run build', { cwd: sourceDir, stdio: 'ignore', timeout: 180000 });
    }
    const builtOutput = path.join(sourceDir, 'build');
    if (fileExists(path.join(builtOutput, 'handler.js')) && path.resolve(builtOutput) !== path.resolve(webBuildDest)) {
      _syncWebBuildOutput(builtOutput, webBuildDest, destWebPkg, currentVersion);
    }
  } catch (buildErr) {
    warn(`Could not build Web UI automatically: ${buildErr.message}`);
  }
}

function installWebUiRuntime(copyTree) {
  let webSrcDir = path.resolve(__dirname, '..', '..', 'apps', 'web');
  if (!fileExists(path.join(webSrcDir, 'package.json')) && fileExists(path.join(process.cwd(), 'apps', 'web', 'package.json'))) {
    webSrcDir = path.join(process.cwd(), 'apps', 'web');
  }
  const webDestDir = path.join(SKILLS_DB_DIR, 'apps', 'web');
  if (fileExists(path.join(webSrcDir, 'package.json')) && path.resolve(webSrcDir) !== path.resolve(webDestDir)) {
    copyTree(webSrcDir, webDestDir);
    info(`Web UI application installed to ${webDestDir}`);
  }

  const currentVersion = getCliVersion();
  const webBuildSrc = resolveWebBuildSource();
  const webBuildDest = path.join(SKILLS_DB_DIR, 'apps', 'web', 'build');
  const destWebPkg = path.join(webDestDir, 'package.json');
  let destVersion = null;
  try {
    if (fileExists(destWebPkg)) destVersion = JSON.parse(fs.readFileSync(destWebPkg, 'utf8')).version;
  } catch (_) { /* best-effort */ }
  const isUiOutdated = !destVersion || destVersion !== currentVersion;

  if (fileExists(path.join(webBuildSrc, 'handler.js'))) {
    if (path.resolve(webBuildSrc) !== path.resolve(webBuildDest) || isUiOutdated) {
      _syncWebBuildOutput(webBuildSrc, webBuildDest, destWebPkg, currentVersion);
    }
  } else if (!fileExists(path.join(webBuildDest, 'handler.js')) || isUiOutdated) {
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
            cwd: SKILLS_DB_DIR, encoding: 'utf-8', timeout: 300000, stdio: 'ignore', shell: true, windowsHide: true, env: childEnv
          })
        : spawnSync(pm.cmd, pm.args, {
            cwd: SKILLS_DB_DIR, encoding: 'utf-8', timeout: 300000, stdio: 'ignore', env: childEnv
          });
      if (res.status === 0 && listMissingDependencies(path.join(SKILLS_DB_DIR, 'node_modules'), deps).length === 0) return true;
    } catch { /* best-effort package manager fallback */ }
  }
  return false;
}

function ensureRuntimeDependencies() {
  const nodeModulesPath = path.join(SKILLS_DB_DIR, 'node_modules');
  const deps = readDeclaredDependencies(path.join(REPO_ROOT, 'package.json'));
  if (deps.length === 0 || listMissingDependencies(nodeModulesPath, deps).length === 0) return;

  _tryLinkRootModules(nodeModulesPath);
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

function installCliRuntime() {
  const skipNames = new Set(['.ruff_cache', '__pycache__', '.pytest_cache', '.DS_Store', 'node_modules', '.svelte-kit', 'build', 'dist']);
  const copyTree = (src, dest) => {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (skipNames.has(entry.name)) continue;
      copyTreeEntry(entry, src, dest, copyTree);
    }
  };
  try {
    const cliDest = copyRuntimeFiles(copyTree);
    installWebUiRuntime(copyTree);
    ensureRuntimeDependencies();
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
      ? spawnSync('npm.cmd config get prefix', { encoding: 'utf-8', timeout: 8000, shell: true, windowsHide: true })
      : spawnSync(npmCmd, ['config', 'get', 'prefix'], { encoding: 'utf-8', timeout: 8000 });
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
    'konoha': `#!/bin/sh\nif [ -f "${shSourceCli}" ]; then\n  exec "${shNodeCmd}" "${shSourceCli}" "$@"\nelif [ -f "${shPackageCli}" ]; then\n  exec "${shNodeCmd}" "${shPackageCli}" "$@"\nelse\n  exec "${shNodeCmd}" "${shSourceCli}" "$@"\nfi\n`,
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
  const contents = buildShimContents(sourceCli, packageCli, process.execPath);
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
  copyIfDifferent,
  copyRecursive,
  copyRecursiveIfDifferent,
  installCliRuntime,
  reconcileGlobalCommand
};
