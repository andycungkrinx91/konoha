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

function installCliRuntime() {
  const cliDest = path.join(SKILLS_DB_DIR, 'bin', 'cli.js');
  const skipNames = new Set(['.ruff_cache', '__pycache__', '.pytest_cache', '.DS_Store', 'node_modules', '.svelte-kit', 'build', 'dist']);
  const copyTree = (src, dest) => {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (skipNames.has(entry.name)) continue;
      const s = path.join(src, entry.name);
      const d = path.join(dest, entry.name);
      if (entry.isDirectory()) copyTree(s, d);
      else if (entry.isSymbolicLink()) {
        try {
          const target = fs.readlinkSync(s);
          if (fs.existsSync(d)) fs.unlinkSync(d);
          fs.symlinkSync(target, d);
        } catch (_) {
          copyFile(s, d);
        }
      } else if (entry.isFile()) copyFile(s, d);
    }
  };
  try {
    ensureDir(path.join(SKILLS_DB_DIR, 'bin'));

    const sourceCliPath = path.resolve(__dirname, '..', 'cli.js');
    if (fileExists(sourceCliPath)) {
      copyFile(sourceCliPath, cliDest);
    }

    const pkgSrc = path.resolve(__dirname, '..', '..', 'package.json');
    if (fileExists(pkgSrc)) {
      copyFile(pkgSrc, path.join(SKILLS_DB_DIR, 'package.json'));
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
      if (path.resolve(SRC_DIR) !== path.resolve(destSrc)) {
        copyTree(SRC_DIR, destSrc);
      }
    }

    const skillsSrc = path.resolve(__dirname, '..', '..', '.agents', 'skills');
    const skillsDest = path.join(SKILLS_DB_DIR, '.agents', 'skills');
    if (fileExists(skillsSrc) && path.resolve(skillsSrc) !== path.resolve(skillsDest)) {
      copyTree(skillsSrc, skillsDest);
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
          if (path.resolve(modelsSrc) !== path.resolve(modelsDest)) {
            copyTree(modelsSrc, modelsDest);
          }
        }
      }
    }

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
    let webBuildSrc = path.resolve(__dirname, '..', '..', 'apps', 'web', 'build');
    if (!fileExists(path.join(webBuildSrc, 'handler.js'))) {
      const candidates = [
        path.join(process.cwd(), 'apps', 'web', 'build'),
        path.join(process.cwd(), 'build'),
      ];
      for (const cand of candidates) {
        if (fileExists(path.join(cand, 'handler.js'))) {
          webBuildSrc = cand;
          break;
        }
      }
    }
    const webBuildDest = path.join(SKILLS_DB_DIR, 'apps', 'web', 'build');
    const destWebDir = path.join(SKILLS_DB_DIR, 'apps', 'web');
    const destWebPkg = path.join(destWebDir, 'package.json');
    let destVersion = null;
    try {
      if (fileExists(destWebPkg)) {
        destVersion = JSON.parse(fs.readFileSync(destWebPkg, 'utf8')).version;
      }
    } catch (_) { /* intentional best-effort fallback */ }
    const isUiOutdated = !destVersion || destVersion !== currentVersion;

    if (fileExists(path.join(webBuildSrc, 'handler.js'))) {
      if (path.resolve(webBuildSrc) !== path.resolve(webBuildDest) || isUiOutdated) {
        fs.rmSync(webBuildDest, { recursive: true, force: true });
        ensureDir(webBuildDest);
        fs.cpSync(webBuildSrc, webBuildDest, { recursive: true });
        fs.writeFileSync(destWebPkg, JSON.stringify({ name: 'konoha-web', version: currentVersion, type: 'module', private: true }, null, 2) + '\n');
        fs.writeFileSync(path.join(webBuildDest, 'package.json'), '{\n  "type": "module"\n}\n');
        info(`Pre-built Web UI installed to ${webBuildDest} (v${currentVersion})`);
      }
    } else if (!fileExists(path.join(webBuildDest, 'handler.js')) || isUiOutdated) {
      const sourceDir = deployUtils.resolveWebUiDir({ preferSources: true });
      if (sourceDir && fileExists(path.join(sourceDir, 'src', 'routes'))) {
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
            fs.rmSync(webBuildDest, { recursive: true, force: true });
            ensureDir(webBuildDest);
            fs.cpSync(builtOutput, webBuildDest, { recursive: true });
            fs.writeFileSync(destWebPkg, JSON.stringify({ name: 'konoha-web', version: currentVersion, type: 'module', private: true }, null, 2) + '\n');
            fs.writeFileSync(path.join(webBuildDest, 'package.json'), '{\n  "type": "module"\n}\n');
            info(`Pre-built Web UI installed to ${webBuildDest} (v${currentVersion})`);
          }
        } catch (buildErr) {
          warn(`Could not build Web UI automatically: ${buildErr.message}`);
        }
      }
    }

    const depMarker = path.join(SKILLS_DB_DIR, 'node_modules', '@bufbuild', 'protobuf');
    if (!fileExists(depMarker)) {
      const isWin = process.platform === 'win32';
      const { env: childEnv } = deployUtils.resolveCompatibleNodeEnv(process.env);
      const pmCandidates = [
        { cmd: isWin ? 'pnpm.cmd' : 'pnpm', args: ['install', '--prod'] },
        { cmd: isWin ? 'npm.cmd' : 'npm', args: ['install', '--omit=dev', '--no-audit', '--no-fund'] }
      ];
      for (const pm of pmCandidates) {
        try {
          const res = spawnSync(pm.cmd, pm.args, {
            cwd: SKILLS_DB_DIR,
            encoding: 'utf-8',
            timeout: 300000,
            stdio: 'ignore',
            shell: isWin,
            env: childEnv
          });
          if (res.status === 0 && fileExists(depMarker)) break;
        } catch (_) { /* intentional best-effort fallback */ }
      }
    }
  } catch (_) {
    // Non-fatal
  }
  return cliDest;
}

function reconcileGlobalCommand() {
  const report = { updated: [], created: [], ok: [], failed: [], sourceCli: null };
  const isWin = process.platform === 'win32';
  const sourceCli = path.join(SKILLS_DB_DIR, 'bin', 'cli.js');
  const packageCli = path.resolve(__dirname, '..', 'cli.js');
  report.sourceCli = sourceCli;
  if (!fileExists(sourceCli)) {
    try { installCliRuntime(); } catch (_) { /* intentional best-effort fallback */ }
  }
  if (!fileExists(sourceCli) && !fileExists(packageCli)) return report;

  const nodeCmd = process.execPath;
  const homeDir = HOME;

  const tmpRoot = path.resolve(os.tmpdir());
  if (
    process.env.KONOHA_TEST_SANDBOX === '1' ||
    path.resolve(SKILLS_DB_DIR).startsWith(tmpRoot) ||
    path.resolve(homeDir).startsWith(tmpRoot)
  ) {
    return report;
  }

  const candidateDirs = new Set();
  try {
    const npmCmd = isWin ? 'npm.cmd' : 'npm';
    const res = spawnSync(npmCmd, ['config', 'get', 'prefix'], { encoding: 'utf-8', timeout: 8000, shell: isWin, windowsHide: true });
    const prefix = ((res.stdout || '') + '').trim().split(/\r?\n/).filter(Boolean).pop();
    if (prefix && fs.existsSync(prefix)) {
      candidateDirs.add(isWin ? prefix : path.join(prefix, 'bin'));
    }
  } catch (_) { /* intentional best-effort fallback */ }
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
      const hasShim = fs.existsSync(path.join(dir, isWin ? 'konoha.cmd' : 'konoha'));
      if (hasShim) candidateDirs.add(dir);
    } catch (_) { /* intentional best-effort fallback */ }
  }

  for (const dir of candidateDirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      const dirMode = fs.statSync(dir).isDirectory() ? null : 'skip';
      if (dirMode === 'skip') continue;
    } catch (_) { continue; }

    const mainName = isWin ? 'konoha.cmd' : 'konoha';
    const shimNames = [mainName];
    if (isWin) {
      if (fs.existsSync(path.join(dir, 'konoha.ps1'))) shimNames.push('konoha.ps1');
      if (fs.existsSync(path.join(dir, 'konoha'))) shimNames.push('konoha');
    }

    for (const name of shimNames) {
      const shimPath = path.join(dir, name);
      const contents = {
        'konoha': `#!/bin/sh\nif [ -f "${sourceCli}" ]; then\n  exec "${nodeCmd}" "${sourceCli}" "$@"\nelif [ -f "${packageCli}" ]; then\n  exec "${nodeCmd}" "${packageCli}" "$@"\nelse\n  exec "${nodeCmd}" "${sourceCli}" "$@"\nfi\n`,
        'konoha.cmd': `@echo off\r\nif exist "${sourceCli}" (\r\n  "${nodeCmd}" "${sourceCli}" %*\r\n) else if exist "${packageCli}" (\r\n  "${nodeCmd}" "${packageCli}" %*\r\n) else (\r\n  "${nodeCmd}" "${sourceCli}" %*\r\n)\r\n`,
        'konoha.ps1': `if (Test-Path "${sourceCli}") {\r\n  & "${nodeCmd}" "${sourceCli}" @args\r\n} elseif (Test-Path "${packageCli}") {\r\n  & "${nodeCmd}" "${packageCli}" @args\r\n} else {\r\n  & "${nodeCmd}" "${sourceCli}" @args\r\n}\r\n`
      };
      const mode = isWin ? undefined : 0o755;

      try {
        let st = null;
        try { st = fs.lstatSync(shimPath); } catch (_) { /* intentional best-effort fallback */ }
        if (!st) {
          fs.writeFileSync(shimPath, contents[name], { mode: mode || 0o666 });
          if (!isWin) { try { fs.chmodSync(shimPath, 0o755); } catch (_) { /* intentional best-effort fallback */ } }
          report.created.push(shimPath);
          continue;
        }
        if (st.isSymbolicLink()) {
          let resolved = null;
          try {
            const target = fs.readlinkSync(shimPath);
            resolved = path.resolve(path.dirname(shimPath), target);
          } catch (_) {
            resolved = null;
          }
          if (resolved === sourceCli) {
            report.ok.push(shimPath);
            continue;
          }
          fs.unlinkSync(shimPath);
          fs.writeFileSync(shimPath, contents[name]);
          if (!isWin) { try { fs.chmodSync(shimPath, 0o755); } catch (_) { /* intentional best-effort fallback */ } }
          report.updated.push(shimPath);
          continue;
        }
        const current = fs.readFileSync(shimPath, 'utf8');
        if (current === contents[name]) {
          report.ok.push(shimPath);
          continue;
        }
        fs.writeFileSync(shimPath, contents[name]);
        if (!isWin) { try { fs.chmodSync(shimPath, 0o755); } catch (_) { /* intentional best-effort fallback */ } }
        report.updated.push(shimPath);
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
