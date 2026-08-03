/**
 * Cross-platform helpers shared by CLI, MCP managers, and file tools.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const IS_WIN = process.platform === 'win32';

function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function normPath(p) {
  return IS_WIN ? path.normalize(p).toLowerCase() : path.normalize(p);
}

function expandUser(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') {
    return rawPath;
  }
  if (!rawPath.startsWith('~')) {
    return rawPath;
  }
  if (rawPath === '~') {
    return os.homedir();
  }
  if (rawPath.startsWith('~/') || rawPath.startsWith('~\\')) {
    return path.join(os.homedir(), rawPath.slice(2));
  }
  return rawPath;
}

function uriToPath(uri) {
  if (!uri || typeof uri !== 'string') {
    return null;
  }
  let p = uri;
  if (uri.startsWith('file://')) {
    try {
      p = decodeURIComponent(new URL(uri).pathname);
    } catch {
      p = uri.replace(/^file:\/\//, '');
    }
  } else if (uri.startsWith('file:/')) {
    p = decodeURIComponent(uri.slice(5));
  }
  if (IS_WIN && /^\/[A-Za-z]:/.test(p)) {
    p = p.slice(1);
  }
  return path.normalize(p);
}

function detectPython() {
  // POSIX: prefer the safer spawnSync arg-array form; Windows keeps the existing
  // execSync-with-shell behavior because `py -3` is a cmd.exe compound command.
  if (!IS_WIN) {
    for (const cmd of ['python3', 'python']) {
      try {
        const res = spawnSync(cmd, ['--version'], { encoding: 'utf-8', shell: false });
        if (res.status === 0 && res.stdout && res.stdout.includes('Python 3')) {
          return cmd;
        }
      } catch {}
    }
    return null;
  }
  const cmds = ['py -3', 'py', 'python3', 'python'];
  for (const cmd of cmds) {
    try {
      const version = execSync(`${cmd} --version 2>&1`, {
        encoding: 'utf-8',
        shell: IS_WIN
      }).trim();
      if (version.includes('Python 3')) {
        return cmd;
      }
    } catch {}
  }
  return null;
}

function detectPythonOrDefault() {
  return detectPython() || (IS_WIN ? 'python' : 'python3');
}

function getUvCommand() {
  try {
    execSync('uv --version', { stdio: 'ignore' });
    return 'uv';
  } catch {}

  const home = os.homedir();
  const localPaths = IS_WIN
    ? [
        path.join(home, '.local', 'bin', 'uv.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'programs', 'uv', 'uv.exe')
      ]
    : [
        path.join(home, '.local', 'bin', 'uv'),
        path.join(home, '.cargo', 'bin', 'uv'),
        '/usr/local/bin/uv',
        '/usr/bin/uv'
      ];

  for (const p of localPaths) {
    if (p && fileExists(p)) {
      try {
        execSync(`"${p}" --version`, { stdio: 'ignore' });
        return p;
      } catch {}
    }
  }
  return 'uv';
}

function getUvxCommand(uvCmd) {
  const uv = uvCmd || getUvCommand();
  if (uv !== 'uv') {
    const companion = path.join(
      path.dirname(uv),
      IS_WIN ? 'uvx.exe' : 'uvx'
    );
    if (fileExists(companion)) {
      return companion;
    }
  }
  return 'uvx';
}

function isCommandAvailable(cmd) {
  const probe = IS_WIN ? 'where' : 'which';
  try {
    const run = spawnSync(probe, [cmd], {
      encoding: 'utf-8',
      shell: IS_WIN
    });
    return run.status === 0 && Boolean((run.stdout || '').trim());
  } catch {
    return false;
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

module.exports = {
  IS_WIN,
  fileExists,
  ensureDir,
  normPath,
  expandUser,
  uriToPath,
  detectPython,
  getUvCommand,
  getUvxCommand,
  isCommandAvailable,
  detectPythonOrDefault
};
