/**
 * Cross-platform helpers shared by CLI, MCP managers, and file tools.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const IS_WIN = process.platform === 'win32';

function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

const _statCache = new Map();
function fileExistsCached(p, maxAgeMs = 5000) {
  if (!p) return false;
  const now = Date.now();
  const cached = _statCache.get(p);
  if (cached && now - cached.ts < maxAgeMs) {
    return cached.exists;
  }
  const exists = fileExists(p);
  _statCache.set(p, { exists, ts: now });
  return exists;
}

function clearFileStatCache() {
  _statCache.clear();
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
  const candidates = IS_WIN
    ? [{ command: 'py', args: ['-3'] }, { command: 'py', args: [] }, { command: 'python3', args: [] }, { command: 'python', args: [] }]
    : [{ command: 'python3', args: [] }, { command: 'python', args: [] }];
  for (const candidate of candidates) {
    try {
      const res = spawnSync(candidate.command, [...candidate.args, '--version'], {
        encoding: 'utf-8',
        shell: false
      });
      const version = `${res.stdout || ''}${res.stderr || ''}`;
      if (res.status === 0 && version.includes('Python 3')) {
        return candidate.args.length > 0 ? `${candidate.command} ${candidate.args.join(' ')}` : candidate.command;
      }
    } catch {}
  }
  return null;
}

function detectPythonOrDefault() {
  return detectPython() || (IS_WIN ? 'python' : 'python3');
}

function normalizeCommand(command) {
  if (Array.isArray(command)) return { executable: command[0], prefixArgs: command.slice(1) };
  if (command && typeof command === 'object' && command.executable) {
    return {
      executable: command.executable,
      prefixArgs: Array.isArray(command.prefixArgs) ? command.prefixArgs : []
    };
  }
  if (typeof command !== 'string') return { executable: command, prefixArgs: [] };
  const trimmed = command.trim();
  if (!trimmed) return { executable: '', prefixArgs: [] };
  if (trimmed.startsWith('[')) {
    try {
      return normalizeCommand(JSON.parse(trimmed));
    } catch {}
  }
  if (fileExistsCached(trimmed)) {
    return { executable: trimmed, prefixArgs: [] };
  }
  if (trimmed.startsWith('"')) {
    const nextQuote = trimmed.indexOf('"', 1);
    if (nextQuote !== -1) {
      const exe = trimmed.slice(1, nextQuote);
      const rest = trimmed.slice(nextQuote + 1).trim();
      const prefixArgs = rest ? rest.split(/\s+/) : [];
      return { executable: exe, prefixArgs };
    }
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length > 1) {
    return { executable: parts[0], prefixArgs: parts.slice(1) };
  }
  return { executable: trimmed, prefixArgs: [] };
}

function spawnPythonSync(pythonCmd, args = [], options = {}) {
  const norm = normalizeCommand(pythonCmd || detectPythonOrDefault());
  const finalArgs = [...norm.prefixArgs, ...(Array.isArray(args) ? args : [])];
  return spawnSync(norm.executable, finalArgs, options);
}

function spawnPython(pythonCmd, args = [], options = {}) {
  const { spawn } = require('child_process');
  const norm = normalizeCommand(pythonCmd || detectPythonOrDefault());
  const finalArgs = [...norm.prefixArgs, ...(Array.isArray(args) ? args : [])];
  return spawn(norm.executable, finalArgs, options);
}


function getUvCommand() {
  try {
    const result = spawnSync('uv', ['--version'], { stdio: 'ignore' });
    if (result.status === 0) return 'uv';
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
        const result = spawnSync(p, ['--version'], { stdio: 'ignore' });
        if (result.status !== 0) throw new Error('uv probe failed');
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


function ensureUserBinInPath() {
  const home = os.homedir();
  const extraPaths = IS_WIN
    ? [
        path.join(home, '.local', 'bin'),
        path.join(home, '.cargo', 'bin'),
        path.join(process.env.LOCALAPPDATA || '', 'programs', 'rtk')
      ]
    : [
        path.join(home, '.local', 'bin'),
        path.join(home, '.cargo', 'bin'),
        '/usr/local/bin',
        '/opt/homebrew/bin'
      ];

  const currentParts = (process.env.PATH || '').split(path.delimiter);
  const toAdd = extraPaths.filter((p) => fileExists(p) && !currentParts.includes(p));
  if (toAdd.length > 0) {
    process.env.PATH = [...toAdd, process.env.PATH || ''].filter(Boolean).join(path.delimiter);
  }
}

// Automatically ensure user bin paths are in PATH upon importing platform_utils
ensureUserBinInPath();

function getRtkCommand() {
  ensureUserBinInPath();
  try {
    const result = spawnSync('rtk', ['--version'], { encoding: 'utf-8', timeout: 5000 });
    if (result.status === 0) return 'rtk';
  } catch {}

  const home = os.homedir();
  const localPaths = IS_WIN
    ? [
        path.join(home, '.local', 'bin', 'rtk.exe'),
        path.join(home, '.cargo', 'bin', 'rtk.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'programs', 'rtk', 'rtk.exe')
      ]
    : [
        path.join(home, '.local', 'bin', 'rtk'),
        path.join(home, '.cargo', 'bin', 'rtk'),
        '/usr/local/bin/rtk',
        '/usr/bin/rtk',
        '/opt/homebrew/bin/rtk'
      ];

  for (const p of localPaths) {
    if (p && fileExists(p)) {
      try {
        const result = spawnSync(p, ['--version'], { encoding: 'utf-8', timeout: 5000 });
        if (result.status === 0) return p;
      } catch {}
    }
  }
  return null;
}

function isRtkInstalled() {
  return getRtkCommand() !== null;
}

module.exports = {
  IS_WIN,
  fileExists,
  fileExistsCached,
  clearFileStatCache,
  ensureDir,
  normPath,
  expandUser,
  uriToPath,
  detectPython,
  getUvCommand,
  getUvxCommand,
  getRtkCommand,
  isRtkInstalled,
  ensureUserBinInPath,
  isCommandAvailable,
  detectPythonOrDefault,
  normalizeCommand,
  spawnPythonSync,
  spawnPython
};
