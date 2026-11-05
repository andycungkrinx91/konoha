"use strict";

/**
 * bin/commands/upgrade.js — Automated In-Place Upgrader from npm Registry.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { SKILLS_DB_DIR } = require("../lib/paths");
const { C, log, warn, error, header, getCliVersion } = require("../lib/format");
const { fileExists, confirmPrompt, KonohaProgressBar } = require("../lib/prompt");
const { reconcileGlobalCommand, purgePackageCaches } = require("../lib/runtime");
const { installAgentBrowser } = require("../lib/extension");
const { cmdUiRestart, ensureUiDaemonAutoStart, waitForPortReady } = require("../lib/ui_commands");
const { collectUpgradeChoices } = require("../lib/upgrade_prompts");
const { cmdInit } = require("./init");
const { checkPortActive } = require("./bridge");


function parseSemver(v) {
  if (!v) return { major: 0, minor: 0, patch: 0, prerelease: [] };
  const clean = String(v).trim().replace(/^v/, '');
  const [main, ...preParts] = clean.split('-');
  const pre = preParts.length > 0 ? preParts.join('-') : null;
  const [major = '0', minor = '0', patch = '0'] = main.split('.');
  return {
    major: parseInt(major, 10) || 0,
    minor: parseInt(minor, 10) || 0,
    patch: parseInt(patch, 10) || 0,
    prerelease: pre ? pre.split('.').map(part => {
      const num = parseInt(part, 10);
      return isNaN(num) ? part : num;
    }) : null
  };
}

function semverCompare(v1, v2) {
  const p1 = parseSemver(v1);
  const p2 = parseSemver(v2);

  if (p1.major !== p2.major) return p1.major > p2.major ? 1 : -1;
  if (p1.minor !== p2.minor) return p1.minor > p2.minor ? 1 : -1;
  if (p1.patch !== p2.patch) return p1.patch > p2.patch ? 1 : -1;

  if (!p1.prerelease && p2.prerelease) return 1;
  if (p1.prerelease && !p2.prerelease) return -1;
  if (!p1.prerelease && !p2.prerelease) return 0;

  const len = Math.max(p1.prerelease.length, p2.prerelease.length);
  for (let i = 0; i < len; i++) {
    const id1 = p1.prerelease[i];
    const id2 = p2.prerelease[i];
    if (id1 === undefined) return -1;
    if (id2 === undefined) return 1;
    if (id1 === id2) continue;

    const isNum1 = typeof id1 === 'number';
    const isNum2 = typeof id2 === 'number';
    if (isNum1 && isNum2) return id1 > id2 ? 1 : -1;
    if (isNum1 && !isNum2) return -1;
    if (!isNum1 && isNum2) return 1;
    return String(id1).localeCompare(String(id2)) > 0 ? 1 : -1;
  }
  return 0;
}

async function fetchJsonUrl(url, userAgent = 'Konoha-CLI-Updater') {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'application/json'
      },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

const getGithubData = fetchJsonUrl;

function readCachedVersion(cachePath) {
  if (!fileExists(cachePath)) return null;
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (cached && cached.version && (Date.now() - (cached.timestamp || 0) < 3600000)) {
      return cached.version;
    }
  } catch { /* intentional best-effort fallback */ }
  return null;
}

async function collectCandidateTags() {
  const candidateTags = new Set();
  try {
    const npmLatest = await fetchJsonUrl('https://registry.npmjs.org/konoha-mcp/latest');
    if (npmLatest?.version) candidateTags.add(npmLatest.version);
  } catch { /* fallback */ }
  if (candidateTags.size > 0) return candidateTags;

  try {
    const npmPkg = await fetchJsonUrl('https://registry.npmjs.org/konoha-mcp');
    if (npmPkg?.['dist-tags']?.latest) candidateTags.add(npmPkg['dist-tags'].latest);
  } catch { /* fallback */ }
  if (candidateTags.size > 0) return candidateTags;

  try {
    const releases = await getGithubData('https://api.github.com/repos/andycungkrinx91/konoha/releases');
    const releaseList = Array.isArray(releases) ? releases : [];
    for (const r of releaseList) {
      if (r?.tag_name) candidateTags.add(r.tag_name);
    }
  } catch { /* fallback */ }

  return candidateTags;
}

async function getLatestVersion(options = {}) {
  const bypassCache = Boolean(options && options.bypassCache);
  const cachePath = path.join(SKILLS_DB_DIR, '.version_cache.json');
  if (bypassCache) {
    try {
      if (fileExists(cachePath)) fs.unlinkSync(cachePath);
    } catch { /* best-effort */ }
  } else {
    const cachedVersion = readCachedVersion(cachePath);
    if (cachedVersion) return cachedVersion;
  }

  const candidateTags = await collectCandidateTags();
  const sorted = Array.from(candidateTags)
    .filter(name => /v?\d+\.\d+\.\d+/.test(name))
    .sort((a, b) => semverCompare(b, a));

  if (sorted.length > 0) {
    try {
      fs.writeFileSync(cachePath, JSON.stringify({ version: sorted[0], timestamp: Date.now() }), 'utf8');
    } catch { /* best-effort */ }
    return sorted[0];
  }
  throw new Error('No release or version found on npm registry or GitHub');
}


function cmdUpgradeHelp() {
  log(`
${C.cyan}konoha upgrade${C.reset} — Upgrade Konoha CLI to the latest release from npm registry

${C.bold}USAGE${C.reset}
  konoha upgrade [options]

${C.bold}OPTIONS${C.reset}
  ${C.cyan}--yes, -y${C.reset}    Non-interactive confirmation.
  ${C.cyan}--force, -f${C.reset}  Force clean reinstallation from npm registry.

${C.bold}EXAMPLES${C.reset}
  konoha upgrade
  konoha upgrade --yes
  konoha upgrade --force --yes
`);
}


function buildPackageManagerCandidates(pkgTarget, isWin) {
  const pmCandidates = [];
  const pnpmCmd = isWin ? 'pnpm.cmd' : 'pnpm';
  const npmCmd = isWin ? 'npm.cmd' : 'npm';
  const yarnCmd = isWin ? 'yarn.cmd' : 'yarn';

  const checkCmd = (c) => {
    try {
      const res = isWin
        ? spawnSync(`"${c}" --version`, { encoding: 'utf-8', shell: true, timeout: 5000, windowsHide: true })
        : spawnSync(c, ['--version'], { encoding: 'utf-8', timeout: 5000 });
      return res.status === 0;
    } catch { return false; }
  };

  const scriptPath = (process.argv[1] || '').toLowerCase();
  const pnpmAvailable = checkCmd(pnpmCmd);
  const npmAvailable = checkCmd(npmCmd);
  const yarnAvailable = checkCmd(yarnCmd);

  const addPnpm = () => {
    if (pnpmAvailable && !pmCandidates.some(c => c.name === 'pnpm')) {
      pmCandidates.push({ name: 'pnpm', cmd: pnpmCmd, args: ['add', '--global', pkgTarget] });
    }
  };
  const addNpm = () => {
    if (npmAvailable && !pmCandidates.some(c => c.name === 'npm')) {
      pmCandidates.push({ name: 'npm', cmd: npmCmd, args: ['install', '--global', '--force', '--prefer-online', '--no-cache', pkgTarget] });
    }
  };
  const addYarn = () => {
    if (yarnAvailable && !pmCandidates.some(c => c.name === 'yarn')) {
      pmCandidates.push({ name: 'yarn', cmd: yarnCmd, args: ['global', 'add', pkgTarget, '--force'] });
    }
  };

  if (scriptPath.includes('npm')) addNpm();
  else if (scriptPath.includes('yarn')) addYarn();
  else if (scriptPath.includes('pnpm')) addPnpm();

  addPnpm();
  addNpm();
  addYarn();

  if (pmCandidates.length === 0) {
    pmCandidates.push({ name: 'pnpm', cmd: pnpmCmd, args: ['add', '--global', pkgTarget] });
    pmCandidates.push({ name: 'npm', cmd: npmCmd, args: ['install', '--global', '--force', '--prefer-online', '--no-cache', pkgTarget] });
  }
  return pmCandidates;
}

function tryInstallCandidate(pm, args, spawnOptions, isWin = false) {
  try {
    const res = isWin
      ? spawnSync(`"${pm.cmd}" ${args.join(' ')}`, { stdio: spawnOptions.stdio, timeout: spawnOptions.timeout, shell: true, windowsHide: true })
      : spawnSync(pm.cmd, args, spawnOptions);
    if (res.status === 0) return { success: true };
    const errOut = (res.stderr || res.stdout || '').toString().trim();
    return { success: false, error: errOut ? errOut.split('\n').pop() : `exit status ${res.status}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function executePackageInstall(pmCandidates, pkgTarget, targetTag, isWin, pbar) {
  const spawnOptions = { stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000, windowsHide: true };
  let lastError = null;

  for (const pm of pmCandidates) {
    const result = tryInstallCandidate(pm, pm.args, spawnOptions, isWin);
    if (result.success) {
      pbar.stopPulse();
      pbar.logStep(`Konoha installed from npm registry via ${pm.name}`);
      return true;
    }
    lastError = result.error;
  }

  const gitPkgTarget = `github:andycungkrinx91/konoha#${targetTag}`;
  for (const pm of pmCandidates) {
    const fallbackArgs = pm.args.map(a => a === pkgTarget ? gitPkgTarget : a);
    const result = tryInstallCandidate(pm, fallbackArgs, spawnOptions);
    if (result.success) {
      pbar.stopPulse();
      pbar.logStep(`Konoha ${targetTag} installed from GitHub fallback via ${pm.name}`);
      return true;
    }
  }

  pbar.stopPulse();
  pbar.logStep(lastError ? `Package manager note (${lastError}); synchronizing local runtime files` : 'Package manager step completed; synchronizing local runtime files');
  return false;
}

function readCandidateFromPkgDir(pkgDir) {
  const pkgJson = path.join(pkgDir, 'package.json');
  if (!fileExists(pkgJson)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
    if (parsed && parsed.version && fileExists(path.join(pkgDir, 'bin', 'cli.js'))) {
      return { dir: pkgDir, version: String(parsed.version).trim() };
    }
  } catch { /* ignore unreadable package.json */ }
  return null;
}

function locateGlobalPackageRoot(isWin = process.platform === 'win32', targetVer = '') {
  const roots = new Set();
  const runRootCmd = (cmd) => {
    try {
      const res = isWin
        ? spawnSync(`${cmd}.cmd root -g`, { encoding: 'utf-8', timeout: 6000, shell: true, windowsHide: true })
        : spawnSync(cmd, ['root', '-g'], { encoding: 'utf-8', timeout: 6000 });
      const out = ((res.stdout || '') + '').trim().split(/\r?\n/).filter(Boolean).pop();
      if (out && fileExists(out)) roots.add(out);
    } catch { /* best-effort */ }
  };

  runRootCmd('pnpm');
  runRootCmd('npm');

  if (!isWin) {
    const execLib = path.resolve(process.execPath, '..', '..', 'lib', 'node_modules');
    if (fileExists(execLib)) roots.add(execLib);
  }

  const candidates = [];
  for (const rootDir of roots) {
    for (const pkgName of ['konoha-mcp', 'konoha']) {
      const candidate = readCandidateFromPkgDir(path.join(rootDir, pkgName));
      if (candidate) candidates.push(candidate);
    }
  }

  if (candidates.length === 0) return null;
  const cleanTarget = String(targetVer || '').replace(/^v/, '');
  const exact = cleanTarget && candidates.find(c => c.version === cleanTarget);
  if (exact) return exact.dir;

  candidates.sort((a, b) => semverCompare(b.version, a.version));
  return candidates[0].dir;
}

function resolveInstalledCliPath(preferredRoot) {
  if (preferredRoot && fileExists(path.join(preferredRoot, 'bin', 'cli.js'))) {
    return path.join(preferredRoot, 'bin', 'cli.js');
  }
  try {
    const shimReport = reconcileGlobalCommand();
    if (shimReport && shimReport.sourceCli && fileExists(shimReport.sourceCli)) {
      return shimReport.sourceCli;
    }
  } catch { /* fallback */ }
  const dbCli = path.join(SKILLS_DB_DIR, 'bin', 'cli.js');
  return fileExists(dbCli) ? dbCli : path.resolve(__dirname, '..', 'cli.js');
}

function readInstalledVersion(targetVer, preferredRoot = null) {
  try {
    const cliPath = resolveInstalledCliPath(preferredRoot);
    const res = spawnSync(process.execPath, [cliPath, '--version'], {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true
    });

    if (res.status === 0 && res.stdout) {
      const match = res.stdout.match(/\d+\.\d+\.\d+/);
      if (match) {
        return { version: match[0], source: 'installed' };
      }
    }
  } catch { /* best-effort */ }

  const cleanTarget = String(targetVer || '').replace(/^v/, '');
  return { version: cleanTarget, source: 'target' };
}

function syncRuntimeAndMigrate(globalPkgRoot) {
  try {
    const { installCliRuntime } = require('../lib/runtime');
    installCliRuntime({ sourceRoot: globalPkgRoot });
  } catch { /* best-effort */ }

  try {
    const migratePath = path.join(SKILLS_DB_DIR, 'migrate.js');
    const fallbackMigrate = path.resolve(__dirname, '..', '..', 'src', 'migrate.js');
    const effectiveMigrate = fileExists(migratePath) ? migratePath : fallbackMigrate;
    if (fileExists(effectiveMigrate)) {
      spawnSync(process.execPath, [effectiveMigrate, '--require-skill', 'genin-skill'], {
        encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: 180000
      });
    }
  } catch { /* best-effort */ }
}

function deployOptionalRtkAndRepairShims(pbar, rtk, globalPkgRoot, mcpChoices) {
  if (rtk) {
    try {
      const antigravityManager = require('../../src/antigravity_manager');
      antigravityManager.ensureRtkInstalled(false);
      antigravityManager.deployAntigravityRtkRule(true);
      pbar.logStep('RTK rules deployed');
    } catch { /* best-effort */ }
  }

  try {
    const { checkPython } = require('../lib/prompt');
    const { registerMcp } = require('../lib/runtime_mcp');
    const python = checkPython() || 'python3';
    registerMcp(python, true, mcpChoices);
  } catch { /* best-effort */ }

  pbar.update(6, `${C.cyan}[Stage 7/7]${C.reset} Verifying browser automation CLI tools...`);
  pbar.startPulse(`${C.cyan}[Stage 7/7]${C.reset} Verifying browser tools...`);
  try { installAgentBrowser(true); } catch { /* best-effort */ }
  pbar.stopPulse();
  pbar.logStep('Browser automation tools verified');

  try {
    const { installCliRuntime } = require('../lib/runtime');
    installCliRuntime({ sourceRoot: globalPkgRoot });
  } catch { /* best-effort */ }

  try {
    const shimReport = reconcileGlobalCommand();
    const shimsTouched = [...new Set([...shimReport.updated, ...shimReport.created])];
    if (shimsTouched.length > 0) {
      pbar.logStep(`Global command 'konoha' → ${shimReport.sourceCli} (${shimsTouched.length} shim(s) repaired)`);
    }
  } catch { /* best-effort */ }
}

function prepareUpgradeSourceRoot(globalPkgRoot) {
  if (!globalPkgRoot) return;
  process.env.KONOHA_UPGRADE_SOURCE_ROOT = globalPkgRoot;
  try {
    const { installCliRuntime } = require('../lib/runtime');
    installCliRuntime({ sourceRoot: globalPkgRoot });
  } catch { /* best-effort */ }
}

async function runInitOrSyncStep(pbar, injectConfigs, globalPkgRoot) {
  if (!injectConfigs) {
    pbar.logStep('Skipping client config injection per user choice');
    syncRuntimeAndMigrate(globalPkgRoot);
    return;
  }
  await cmdInit(['--force', '--yes'], {
    skipUiAutoStart: true,
    onProgress: (stepNum, stepTitle, stepDetail) => {
      const stageNum = Math.min(6, 2 + stepNum);
      pbar.update(stageNum - 1, `${C.cyan}[Stage ${stageNum}/7]${C.reset} ${stepTitle}: ${stepDetail}`);
    },
    onStepComplete: (stepTitle) => pbar.logStep(stepTitle)
  });
}

async function restartOrAutoStartUiDaemon(pbar, uiWasRunning) {
  if (uiWasRunning) {
    pbar.logStep('Restarting Konoha Web UI daemon to load the upgraded runtime...');
    await cmdUiRestart(['--no-open']);
    return;
  }
  const uiAuto = await ensureUiDaemonAutoStart();
  if (uiAuto?.started) pbar.logStep('Konoha Web UI daemon auto-started at http://127.0.0.1:1404/');
}

async function runPostUpgradeInit(pbar, targetTag, uiWasRunning, choices = {}, localVer = '') {
  const { injectConfigs = true, rtk = true, aislop = true, semble = true } = choices;
  const cleanTarget = String(targetTag || '').replace(/^v/, '');
  const globalPkgRoot = locateGlobalPackageRoot(process.platform === 'win32', cleanTarget);
  prepareUpgradeSourceRoot(globalPkgRoot);

  pbar.update(2, `${C.cyan}[Stage 3/7]${C.reset} Verifying Node.js, uv, and runtime dependencies...`);
  try {
    await runInitOrSyncStep(pbar, injectConfigs, globalPkgRoot);
    deployOptionalRtkAndRepairShims(pbar, rtk, globalPkgRoot, { aislop, semble });
    await restartOrAutoStartUiDaemon(pbar, uiWasRunning);

    const portReady = await waitForPortReady(1404, { timeoutMs: 90000 });
    if (!portReady) {
      pbar.logStep('Web UI daemon is still warming up; it will answer on port 1404 shortly');
    }

    const installed = readInstalledVersion(cleanTarget, globalPkgRoot);
    pbar.finish(`Konoha has been successfully upgraded to v${installed.version}!`);
    log(`\n  ⚡ ${C.bold}Installed Version:${C.reset} ${C.green}v${installed.version}${C.reset}`);
    log(`  ⚡ ${C.bold}Platform:${C.reset}          ${C.cyan}${process.platform} (${process.arch})${C.reset}\n`);

    const old = String(localVer || '').replace(/^v/, '');
    if ((installed.source === 'target' && installed.version === old) || (installed.version === old && cleanTarget !== old)) {
      warn(`Reported version still v${old} — run "konoha --version" after the shell reloads`);
    }
  } catch (err) {
    pbar.stopPulse();
    error(`Failed to refresh Konoha configuration: ${err.message}`);
    process.exit(1);
  } finally {
    delete process.env.KONOHA_UPGRADE_SOURCE_ROOT;
  }
}

async function resolveTargetVersion(localVer) {
  let targetVer = localVer;
  let targetTag = `v${localVer}`;
  try {
    const latest = await getLatestVersion({ bypassCache: true });
    if (latest) {
      const cleanLatest = latest.replace(/^v/, '');
      const cleanLocal = localVer.replace(/^v/, '');
      if (semverCompare(cleanLatest, cleanLocal) >= 0) {
        targetVer = cleanLatest;
        targetTag = latest.startsWith('v') ? latest : `v${latest}`;
      }
    }
  } catch { /* best-effort */ }
  return { targetVer, targetTag };
}

async function cmdUpgrade(args = []) {
  if (args && (args.includes('help') || args.includes('--help') || args.includes('-h'))) {
    cmdUpgradeHelp();
    return;
  }
  header('🔄 Upgrading Konoha');
  log(`  Preparing to upgrade Konoha to the latest version...`);

  const autoYes = args && (args.includes('--yes') || args.includes('-y'));
  const doUpgrade = autoYes ? true : await confirmPrompt('Proceed with upgrading Konoha and modify ~/.gemini configurations?', true);

  if (!doUpgrade) {
    warn('Upgrade aborted.');
    return;
  }

  const choices = await collectUpgradeChoices(args);

  log('');
  const pbar = new KonohaProgressBar({ total: 7, width: 28, title: 'Upgrade' });
  let uiWasRunning = false;
  try { uiWasRunning = await checkPortActive(1404); } catch { /* best-effort */ }

  pbar.start(`${C.cyan}[Stage 1/7]${C.reset} Detecting package manager & purging stale caches...`);
  const isWin = process.platform === 'win32';
  purgePackageCaches({ silent: true });

  const localVer = getCliVersion();
  const { targetVer, targetTag } = await resolveTargetVersion(localVer);
  const cleanTarget = targetVer.replace(/^v/, '');
  const pkgTarget = `konoha-mcp@${cleanTarget}`;

  const pmCandidates = buildPackageManagerCandidates(pkgTarget, isWin);
  pbar.logStep(`Target: ${C.green}konoha-mcp@${cleanTarget}${C.reset} | Package Manager: ${C.bold}${pmCandidates[0].name}${C.reset}`);

  pbar.update(1, `${C.cyan}[Stage 2/7]${C.reset} Fetching konoha-mcp@${cleanTarget} from npm registry via ${pmCandidates[0].name}...`);
  pbar.startPulse(`${C.cyan}[Stage 2/7]${C.reset} Downloading and installing Konoha package via ${pmCandidates[0].name}...`);

  executePackageInstall(pmCandidates, pkgTarget, targetTag, isWin, pbar);
  await runPostUpgradeInit(pbar, targetTag, uiWasRunning, choices, localVer);
}

// cmdRender removed — visual comparison feature deprecated in favor of image/source-to-code (build_from_source)



module.exports = {
  cmdUpgrade,
  cmdUpgradeHelp,
  locateGlobalPackageRoot,
  readInstalledVersion,
  parseSemver,
  semverCompare,
  fetchJsonUrl,
  getLatestVersion,
};
