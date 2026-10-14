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
const { HOME, SKILLS_DB_DIR } = require('./paths');
const { fileExists, ensureDir } = require('./prompt');
const { log, info, warn, success } = require('./format');
const { SEMBLE_PACKAGE } = require('../../src/semble_manager');
const antigravityManager = require('../../src/antigravity_manager');

function installUv(silent = false) {
  try {
    execSync('uv --version', { stdio: 'ignore' });
    return true;
  } catch { /* intentional best-effort fallback */ }

  if (!silent) info('Attempting to auto-install "uv" for Semble MCP...');
  try {
    const stdioOpt = silent ? 'ignore' : 'inherit';
    if (process.platform === 'win32') {
      try {
        execSync('powershell -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"', { stdio: stdioOpt });
      } catch (psErr) {
        if (!silent) warn(`PowerShell uv installer failed: ${psErr.message}. Falling back to winget if available.`);
        try {
          execSync('winget install --id astral-sh.uv -e --source winget', { stdio: stdioOpt });
        } catch (_) {
          throw psErr;
        }
      }
    } else {
      execSync('curl -LsSf https://astral.sh/uv/install.sh | sh', { stdio: stdioOpt });
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

function getAgentBrowserCommand() {
  const isWin = process.platform === 'win32';
  const abCmd = isWin ? 'agent-browser.cmd' : 'agent-browser';
  try {
    const res = spawnSync(abCmd, ['--version'], { encoding: 'utf-8', shell: isWin, windowsHide: true });
    if (res.status === 0) {
      return abCmd;
    }
  } catch { /* intentional best-effort fallback */ }

  const home = os.homedir();
  const candidates = [];
  if (isWin) {
    if (process.env.APPDATA) {
      candidates.push(
        path.join(process.env.APPDATA, 'npm', 'agent-browser.cmd'),
        path.join(process.env.APPDATA, 'yarn', 'bin', 'agent-browser.cmd')
      );
    }
    if (process.env.LOCALAPPDATA) {
      candidates.push(
        path.join(process.env.LOCALAPPDATA, 'pnpm', 'agent-browser.cmd')
      );
    }
    candidates.push(
      path.join(home, 'AppData', 'Roaming', 'npm', 'agent-browser.cmd'),
      path.join(home, 'AppData', 'Local', 'pnpm', 'agent-browser.cmd')
    );
  } else {
    candidates.push(
      path.join(home, '.local', 'bin', 'agent-browser'),
      path.join(home, '.npm-global', 'bin', 'agent-browser'),
      path.join(home, '.pnpm-global', 'bin', 'agent-browser'),
      path.join(home, '.yarn', 'bin', 'agent-browser'),
      '/usr/local/bin/agent-browser',
      '/usr/bin/agent-browser',
      '/bin/agent-browser'
    );
  }

  for (const p of candidates) {
    if (p && fileExists(p)) {
      try {
        const res = spawnSync(p, ['--version'], { encoding: 'utf-8', shell: isWin, windowsHide: true });
        if (res.status === 0) {
          return p;
        }
      } catch { /* intentional best-effort fallback */ }
    }
  }

  return null;
}

function installAgentBrowser(silent = false) {
  const existing = getAgentBrowserCommand();
  if (existing) {
    return true;
  }

  if (!silent) info('Attempting to install "agent-browser" CLI for browser automation...');

  const isWin = process.platform === 'win32';
  const pkgManagers = [
    {
      name: 'npm',
      cmd: isWin ? 'npm.cmd' : 'npm',
      args: ['install', '-g', 'agent-browser']
    },
    {
      name: 'pnpm',
      cmd: isWin ? 'pnpm.cmd' : 'pnpm',
      args: ['add', '-g', 'agent-browser']
    },
    {
      name: 'yarn',
      cmd: isWin ? 'yarn.cmd' : 'yarn',
      args: ['global', 'add', 'agent-browser']
    }
  ];

  for (const pm of pkgManagers) {
    try {
      const check = spawnSync(pm.cmd, ['--version'], { encoding: 'utf-8', shell: isWin, windowsHide: true });
      if (check.status === 0) {
        const stdioOpt = silent ? 'ignore' : 'inherit';
        const installRes = spawnSync(pm.cmd, pm.args, { stdio: stdioOpt, shell: isWin, windowsHide: true });
        if (installRes.status === 0) {
          if (!silent) success(`agent-browser installed successfully via ${pm.name}!`);
          return true;
        }
      }
    } catch { /* intentional best-effort fallback */ }
  }

  if (!silent) {
    warn('Could not auto-install agent-browser. You can install it manually: npm install -g agent-browser');
  }
  return false;
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
      try {
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
          if (name === 'cursor' && !isWin) {
            try {
              const head = fs.readFileSync(fullPath, 'utf8').slice(0, 800);
              if (head.includes('No Cursor IDE installation found') || head.includes("Use 'cursor agent'")) {
                continue;
              }
            } catch { /* intentional best-effort fallback */ }
          }
          return fullPath;
        }
      } catch { /* intentional best-effort fallback */ }
    }
  }
  return null;
}

function installExtensionViaCli(cliName, vsixPath, silent = false) {
  if (cliName !== 'antigravity') {
    if (!silent) warn(`  ⚡ ${cliName} CLI: Refusing to install konoha-bridge (Antigravity IDE only).`);
    return { installed: false, skipped: true, reason: 'antigravity-only' };
  }
  const exe = findIdeExecutable(cliName);
  if (!exe) {
    if (!silent) log(`  ⚡ ${cliName} CLI: not detected on PATH, skipped.`);
    return { installed: false, skipped: true, reason: `${cliName}-not-found` };
  }

  try {
    const isWin = process.platform === 'win32';
    const spawnExe = (isWin && exe.includes(' ') && !exe.startsWith('"')) ? `"${exe}"` : exe;
    const vsixArg = (isWin && vsixPath.includes(' ') && !vsixPath.startsWith('"')) ? `"${vsixPath}"` : vsixPath;
    const res = spawnSync(spawnExe, ['--install-extension', vsixArg, '--force'], {
      encoding: 'utf8',
      timeout: 35000,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWin,
    });
    const stdout = (res.stdout || '').trim();
    const stderr = (res.stderr || '').trim();
    const output = `${stdout}\n${stderr}`.trim();
    if (res.status === 0 || output.includes('successfully installed') || output.includes('already installed')) {
      if (!silent) success(`  ⚡ ${cliName} CLI: Extension '${path.basename(vsixPath)}' installed successfully.`);
      return { installed: true, skipped: false, cli: cliName, output };
    } else if (output.includes('No Cursor IDE installation found') || output.includes("Use 'cursor agent'")) {
      if (!silent) log(`  ⚡ ${cliName} CLI: Standalone agent/CLI mode active (skipped GUI extension).`);
      return { installed: false, skipped: true, cli: cliName, reason: 'cursor-agent-mode' };
    } else {
      if (!silent) warn(`  ⚡ ${cliName} CLI: ${output || `exited with code ${res.status}`}`);
      return { installed: false, skipped: false, cli: cliName, error: output };
    }
  } catch (err) {
    if (!silent) warn(`  ⚡ ${cliName} CLI install error: ${err.message}`);
    return { installed: false, skipped: false, cli: cliName, error: err.message };
  }
}

function autoInstallKonohaBridgeExtension(silent = false, forceRefresh = false) {
  const KONOHA_BRIDGE_REPO = 'https://github.com/andycungkrinx91/konoha-bridge';
  const KONOHA_BRIDGE_REF = 'master';
  const KONOHA_BRIDGE_VSIX_URL = 'https://raw.githubusercontent.com/andycungkrinx91/konoha-bridge/master/konoha-bridge-1.7.0.vsix';
  const targetDirName = 'andycungkrinx91.konoha-bridge-master-universal';
  const bundledVsixPath = path.resolve(__dirname, '..', '..', 'assets', 'konoha-bridge-1.7.0.vsix');
  const cachedVsixPath = path.join(SKILLS_DB_DIR, 'konoha-bridge-1.7.0.vsix');
  const globalCachedVsix = path.join(os.homedir(), '.konoha', 'konoha-bridge-1.7.0.vsix');
  const manifestPath = path.join(SKILLS_DB_DIR, 'konoha-bridge.json');
  const extensionDir = path.join(HOME, '.antigravity-ide', 'extensions');
  const targetPath = path.join(extensionDir, targetDirName);
  const installedPackage = path.join(targetPath, 'package.json');

  const readPackage = (packagePath) => {
    try { return JSON.parse(fs.readFileSync(packagePath, 'utf8')); } catch { return null; }
  };
  const validatePackage = (packagePath) => {
    const pkg = readPackage(packagePath);
    const bridgePort = pkg?.contributes?.configuration?.properties?.['agLocalBridge.port']?.default;
    return !!pkg && pkg.publisher === 'andycungkrinx91' &&
      pkg.name === 'konoha-bridge' && bridgePort === 1313 &&
      typeof pkg.main === 'string' && pkg.main.endsWith('src/extension.js');
  };

  let vsixPath = fileExists(cachedVsixPath) ? cachedVsixPath : (fileExists(bundledVsixPath) ? bundledVsixPath : (fileExists(globalCachedVsix) ? globalCachedVsix : null));

  if (!vsixPath || !fileExists(vsixPath)) {
    try {
      ensureDir(SKILLS_DB_DIR);
      const isWin = process.platform === 'win32';
      const dlRes = spawnSync(isWin ? 'curl.exe' : 'curl', ['-fSL', KONOHA_BRIDGE_VSIX_URL, '-o', cachedVsixPath], {
        timeout: 30000,
        stdio: 'ignore',
        shell: isWin
      });
      if (dlRes.status === 0 && fileExists(cachedVsixPath)) {
        vsixPath = cachedVsixPath;
      }
    } catch { /* fallback to git clone */ }
  }

  if (vsixPath && fileExists(vsixPath)) {
    if (!fileExists(cachedVsixPath) && vsixPath !== cachedVsixPath) {
      try { ensureDir(SKILLS_DB_DIR); fs.copyFileSync(vsixPath, cachedVsixPath); vsixPath = cachedVsixPath; } catch { /* intentional best-effort fallback */ }
    }
    const currentPkg = readPackage(installedPackage);
    const isUpToDate = currentPkg?.version === '1.7.0';
    if (!forceRefresh && fileExists(targetPath) && validatePackage(installedPackage) && isUpToDate) {
      if (!silent) log(`  ⚡ Konoha Bridge v1.7.0 extension already installed.`);
      return { installed: true, skipped: true, path: targetPath, ref: KONOHA_BRIDGE_REF, vsixPath };
    }
  }

  if (!silent) info(`Installing Konoha Bridge from ${vsixPath || KONOHA_BRIDGE_REPO}...`);
  const token = `${process.pid}-${Date.now()}`;
  const tmpClone = path.join(SKILLS_DB_DIR, 'tmp', `bridge-clone-${token}`);
  const stagingPath = path.join(extensionDir, `.konoha-bridge-${token}.staging`);
  const backupPath = `${targetPath}.backup-${token}`;
  let backupCreated = false;
  let commit = 'master';

  try {
    if (!vsixPath || !fileExists(vsixPath)) {
      ensureDir(path.dirname(tmpClone));
      const cloneIsWin = process.platform === 'win32';
      const cloneTarget = (cloneIsWin && tmpClone.includes(' ') && !tmpClone.startsWith('"')) ? `"${tmpClone}"` : tmpClone;
      const cloneRes = spawnSync('git', ['clone', '--branch', KONOHA_BRIDGE_REF, '--depth', '1', KONOHA_BRIDGE_REPO, cloneTarget], {
        encoding: 'utf8',
        timeout: 30000,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: cloneIsWin,
      });
      if (cloneRes.status === 0 && fileExists(tmpClone)) {
        const cloneTarget2 = (cloneIsWin && tmpClone.includes(' ') && !tmpClone.startsWith('"')) ? `"${tmpClone}"` : tmpClone;
        const commitRes = spawnSync('git', ['-C', cloneTarget2, 'rev-parse', 'HEAD'], {
          encoding: 'utf8',
          shell: cloneIsWin,
        });
        commit = (commitRes.stdout || '').trim() || commit;

        const isWin = process.platform === 'win32';
        try {
          spawnSync(isWin ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
            cwd: tmpClone,
            encoding: 'utf8',
            timeout: 30000,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: isWin,
          });
        } catch { /* intentional best-effort fallback */ }

        try {
          spawnSync(isWin ? 'npx.cmd' : 'npx', ['--yes', '@vscode/vsce', 'package', '--allow-star-activation', '--skip-license'], {
            cwd: tmpClone,
            encoding: 'utf8',
            timeout: 30000,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: process.env,
            shell: isWin,
          });
          const vsixFiles = fs.readdirSync(tmpClone).filter(f => f.endsWith('.vsix'));
          if (vsixFiles.length > 0) {
            const generatedVsix = path.join(tmpClone, vsixFiles[0]);
            ensureDir(SKILLS_DB_DIR);
            fs.copyFileSync(generatedVsix, cachedVsixPath);
            vsixPath = cachedVsixPath;
          }
        } catch { /* intentional best-effort fallback */ }
      }
    }

    const detection = antigravityManager.detectAntigravityIde();
    if (!detection.present) {
      if (!silent) info(`Skipping Antigravity IDE directory copy: ${detection.reason || 'antigravity-ide-not-detected'}.`);
    } else if (validatePackage(path.join(tmpClone, 'package.json'))) {
      ensureDir(extensionDir);
      fs.rmSync(stagingPath, { recursive: true, force: true });
      fs.cpSync(tmpClone, stagingPath, { recursive: true });

      if (fileExists(targetPath)) {
        fs.renameSync(targetPath, backupPath);
        backupCreated = true;
      }
      fs.renameSync(stagingPath, targetPath);

      if (backupCreated) {
        fs.rmSync(backupPath, { recursive: true, force: true });
        backupCreated = false;
      }

      for (const entry of fs.readdirSync(extensionDir)) {
        if (entry.startsWith('andycungkrinx91.konoha-bridge-') && entry !== targetDirName) {
          fs.rmSync(path.join(extensionDir, entry), { recursive: true, force: true });
        }
      }
      antigravityManager.syncAntigravityExtensionRegistry(extensionDir, targetDirName, readPackage(installedPackage));
      if (!silent) success(`  ⚡ Antigravity IDE: Extension synced to ${targetPath}.`);
    }
  } catch (err) {
    try { fs.rmSync(stagingPath, { recursive: true, force: true }); } catch { /* intentional fallback */ }
    if (backupCreated && fileExists(targetPath)) {
      try { fs.rmSync(targetPath, { recursive: true, force: true }); } catch { /* intentional fallback */ }
    }
    if (backupCreated && !fileExists(targetPath) && fileExists(backupPath)) {
      try { fs.renameSync(backupPath, targetPath); } catch { /* intentional fallback */ }
    }
    if (!silent) warn(`Failed during konoha-bridge git clone or build: ${err.message}`);
  } finally {
    try { fs.rmSync(tmpClone, { recursive: true, force: true }); } catch { /* intentional fallback */ }
  }

  if (vsixPath && fileExists(vsixPath)) {
    installExtensionViaCli('antigravity', vsixPath, silent);
  }

  const nonAgDirs = [
    path.join(HOME, '.cursor', 'extensions'),
    path.join(HOME, '.vscode', 'extensions'),
    path.join(HOME, '.vscode-server', 'extensions'),
    path.join(HOME, '.windsurf', 'extensions'),
    path.join(HOME, '.codeium', 'windsurf', 'extensions')
  ];
  for (const dir of nonAgDirs) {
    if (fileExists(dir)) {
      try {
        for (const entry of fs.readdirSync(dir)) {
          if (entry.toLowerCase().startsWith('andycungkrinx91.konoha-bridge')) {
            fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
            if (!silent) log(`  ⚡ Removed konoha-bridge extension from non-Antigravity IDE directory: ${dir}`);
          }
        }
      } catch { /* intentional fallback */ }
    }
  }

  ensureDir(SKILLS_DB_DIR);
  try {
    fs.writeFileSync(manifestPath, JSON.stringify({
      repository: KONOHA_BRIDGE_REPO,
      ref: KONOHA_BRIDGE_REF,
      commit,
      vsixPath,
      updatedAt: new Date().toISOString()
    }, null, 2) + '\n');
  } catch { /* intentional fallback */ }

  if (!silent) success(`Konoha Bridge extension setup completed.`);
  return { installed: true, skipped: false, path: targetPath, ref: KONOHA_BRIDGE_REF, commit, vsixPath };
}

module.exports = {
  installUv,
  getUvCommand,
  refreshSemblePackage,
  getUvxCommand,
  getAgentBrowserCommand,
  installAgentBrowser,
  findIdeExecutable,
  installExtensionViaCli,
  autoInstallKonohaBridgeExtension,
};
