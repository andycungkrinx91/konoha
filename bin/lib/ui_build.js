'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const deployUtils = require('../../src/deploy_utils');
const { fileExists } = require('../../src/platform_utils');
const { SKILLS_DB_DIR, INSTALL_BUILD_MIGRATE_TIMEOUT_MS } = require('./paths');
const { getCliVersion } = require('./format');
const { header, log, info, success, warn, error } = require('./format');

function checkWebUiPackageCandidate(cand) {
  const pkg = path.join(cand, 'package.json');
  if (!fileExists(pkg)) return null;
  const hasEntry = fileExists(path.join(cand, 'src', 'routes')) || fileExists(path.join(cand, 'public'));
  if (!hasEntry) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(pkg, 'utf8'));
    return (parsed.scripts && parsed.scripts.build) ? cand : null;
  } catch (_) {
    return null;
  }
}

function findWebUiSourceDir() {
  let webDir = deployUtils.resolveWebUiDir({ preferSources: true });
  if (webDir) return webDir;

  const candidates = [
    path.resolve(process.cwd(), 'apps', 'web'),
    path.resolve(process.cwd()),
    path.resolve(__dirname, '..', '..', 'apps', 'web'),
    path.join(SKILLS_DB_DIR, 'apps', 'web')
  ];
  for (const cand of candidates) {
    const found = checkWebUiPackageCandidate(cand);
    if (found) return found;
  }
  return null;
}

function installWebUiDeps(webDir, hasPnpm, isWin, buildEnv) {
  info(`Installing apps/web dependencies in ${webDir}...`);
  const pmCmd = hasPnpm ? 'pnpm install' : 'npm install';
  try {
    execSync(pmCmd, { cwd: webDir, stdio: 'inherit', shell: isWin, env: buildEnv, timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS });
  } catch (_) {
    try {
      execSync('npm install', { cwd: webDir, stdio: 'inherit', shell: isWin, env: buildEnv, timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS });
    } catch (e) {
      warn(`Could not install apps/web dependencies: ${e.message}`);
    }
  }
}

function refreshInstalledRuntimeCopy(webDir) {
  const installedBuild = path.join(SKILLS_DB_DIR, 'apps', 'web', 'build');
  if (path.resolve(webDir) === path.resolve(path.dirname(installedBuild))) return;

  try {
    if (!fs.existsSync(installedBuild)) fs.mkdirSync(installedBuild, { recursive: true });
    fs.cpSync(path.join(webDir, 'build'), installedBuild, { recursive: true, force: true });
    const destWebDir = path.join(SKILLS_DB_DIR, 'apps', 'web');
    const destWebPkg = path.join(destWebDir, 'package.json');
    const currentVersion = getCliVersion();
    fs.writeFileSync(destWebPkg, JSON.stringify({ name: 'konoha-web', version: currentVersion, type: 'module', private: true }, null, 2) + '\n');
    fs.writeFileSync(path.join(installedBuild, 'package.json'), '{\n  "type": "module"\n}\n');
    info(`Installed runtime UI refreshed: ${installedBuild}`);
  } catch (_) { /* intentional fallback */ }
}

function checkPnpmAvailable(isWin) {
  try {
    execSync(isWin ? 'where pnpm' : 'which pnpm', { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

async function cmdUiBuild() {
  header('Building Konoha Web UI (SvelteKit + Node Adapter)');
  const webDir = findWebUiSourceDir();
  const hasSources = webDir && fileExists(path.join(webDir, 'package.json')) &&
    (fileExists(path.join(webDir, 'src', 'routes')) || fileExists(path.join(webDir, 'public')));

  if (!hasSources) {
    const installedHandler = path.join(SKILLS_DB_DIR, 'apps', 'web', 'build', 'handler.js');
    if (fileExists(installedHandler)) {
      info('Web UI sources not found in current directory, but pre-built UI is ready:');
      log(`    ↳ Build:   ${installedHandler}`);
      success('Pre-built Konoha Web UI is healthy and ready to serve.');
      return;
    }
    error(`Web UI sources not found (looked in: ${webDir || 'workspace'}).`);
    process.exit(1);
  }

  try {
    const isWin = process.platform === 'win32';
    const { env: buildEnv } = deployUtils.resolveCompatibleNodeEnv(process.env);
    delete buildEnv.NO_COLOR;
    delete process.env.NO_COLOR;
    const hasPnpm = checkPnpmAvailable(isWin);

    const isZeroDep = fileExists(path.join(webDir, 'scripts', 'build.js'));
    const viteBin = path.join(webDir, 'node_modules', '.bin', isWin ? 'vite.cmd' : 'vite');
    if (!isZeroDep && !fileExists(viteBin)) {
      installWebUiDeps(webDir, hasPnpm, isWin, buildEnv);
    }

    info('Running build in apps/web...');
    const buildCmd = hasPnpm ? 'pnpm run build' : 'npm run build';
    try {
      execSync(buildCmd, { cwd: webDir, stdio: 'inherit', shell: isWin, env: buildEnv, timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS });
    } catch (_) {
      execSync('npm run build', { cwd: webDir, stdio: 'inherit', shell: isWin, env: buildEnv, timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS });
    }

    refreshInstalledRuntimeCopy(webDir);
    success('Production build completed in apps/web/build/');
  } catch (err) {
    error(`Build failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  cmdUiBuild
};
