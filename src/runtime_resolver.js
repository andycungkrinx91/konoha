'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  HOME,
  FILE_TOOLS_NODE_PATH_FILE,
  FILE_TOOLS_PYTHON_CMD_FILE
} = require('../bin/lib/paths');

function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function parseNodeVersion(verStr) {
  if (!verStr || typeof verStr !== 'string') return null;
  const m = verStr.trim().match(/^v?(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: m[3] ? parseInt(m[3], 10) : 0
  };
}

function isNodeVersionCompatible(ver, minMajor = 18, minMinor = 12) {
  const parsed = typeof ver === 'object' && ver !== null ? ver : parseNodeVersion(ver);
  if (!parsed) return false;
  if (parsed.major > minMajor) return true;
  return parsed.major === minMajor && parsed.minor >= minMinor;
}

function queryNodeVersion(normalized) {
  try {
    const res = spawnSync(normalized, ['-v'], {
      encoding: 'utf8',
      timeout: 2500,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return res.status === 0 && res.stdout ? res.stdout.trim() : null;
  } catch (_) {
    return null;
  }
}

function checkNodeCandidate(candidatePath, minMajor = 18, minMinor = 12) {
  if (!candidatePath || typeof candidatePath !== 'string') return null;
  const normalized = path.resolve(candidatePath.trim());
  if (!fileExists(normalized)) return null;

  if (normalized === process.execPath) {
    return isNodeVersionCompatible(process.versions.node, minMajor, minMinor)
      ? { path: normalized, version: `v${process.versions.node}` }
      : null;
  }

  const verStr = queryNodeVersion(normalized);
  if (verStr && isNodeVersionCompatible(verStr, minMajor, minMinor)) {
    return { path: normalized, version: verStr };
  }
  return null;
}

function scanVersionManagerNodes(nvmVersionsDir, nodeExeName, minMajor, minMinor) {
  if (!fileExists(nvmVersionsDir)) return null;
  try {
    const isWin = process.platform === 'win32';
    const entries = fs.readdirSync(nvmVersionsDir)
      .map(name => ({ name, ver: parseNodeVersion(name) }))
      .filter(item => item.ver && isNodeVersionCompatible(item.ver, minMajor, minMinor))
      .sort((a, b) => b.ver.major - a.ver.major || b.ver.minor - a.ver.minor || b.ver.patch - a.ver.patch);

    for (const entry of entries) {
      const binPath = path.join(nvmVersionsDir, entry.name, isWin ? '' : 'bin', nodeExeName);
      const checked = checkNodeCandidate(binPath, minMajor, minMinor);
      if (checked) return checked.path;
    }
  } catch (_) { /* intentional fallback */ }
  return null;
}

function scanStaticManagerPaths(nodeExeName, minMajor, minMinor) {
  const managerDirs = [
    path.join(HOME, '.local', 'share', 'fnm', 'current', 'bin', nodeExeName),
    path.join(HOME, '.fnm', 'current', 'bin', nodeExeName),
    path.join(HOME, '.volta', 'bin', nodeExeName)
  ];
  for (const mPath of managerDirs) {
    const checked = checkNodeCandidate(mPath, minMajor, minMinor);
    if (checked) return checked.path;
  }
  return null;
}

function scanPathDirectories(nodeExeName, minMajor, minMinor) {
  const currentPath = process.env.PATH || process.env.Path || '';
  if (!currentPath) return null;
  const dirs = currentPath.split(path.delimiter);
  for (const d of dirs) {
    if (!d) continue;
    const candidate = path.join(d, nodeExeName);
    const checked = checkNodeCandidate(candidate, minMajor, minMinor);
    if (checked) return checked.path;
  }
  return null;
}

function scanUnixStandardPaths(minMajor, minMinor) {
  if (process.platform === 'win32') return null;
  for (const stdPath of ['/usr/local/bin/node', '/usr/bin/node']) {
    const checked = checkNodeCandidate(stdPath, minMajor, minMinor);
    if (checked) return checked.path;
  }
  return null;
}

function readRecordedNodePath(minMajor, minMinor) {
  if (!fileExists(FILE_TOOLS_NODE_PATH_FILE)) return null;
  try {
    const recorded = fs.readFileSync(FILE_TOOLS_NODE_PATH_FILE, 'utf8').trim();
    const checked = recorded ? checkNodeCandidate(recorded, minMajor, minMinor) : null;
    return checked ? checked.path : null;
  } catch (_) {
    return null;
  }
}

function resolveCompatibleNode(options = {}) {
  const minMajor = options.minMajor != null ? options.minMajor : 18;
  const minMinor = options.minMinor != null ? options.minMinor : 12;

  if (process.env.KONOHA_NODE) {
    const checked = checkNodeCandidate(process.env.KONOHA_NODE, minMajor, minMinor);
    if (checked) return checked.path;
  }

  if (process.execPath && isNodeVersionCompatible(process.versions.node, minMajor, minMinor)) {
    return process.execPath;
  }

  const recordedNode = readRecordedNodePath(minMajor, minMinor);
  if (recordedNode) return recordedNode;

  const isWin = process.platform === 'win32';
  const nodeExeName = isWin ? 'node.exe' : 'node';

  const nvmDir = process.env.NVM_DIR || path.join(HOME, '.nvm');
  const nvmNode = scanVersionManagerNodes(path.join(nvmDir, 'versions', 'node'), nodeExeName, minMajor, minMinor);
  if (nvmNode) return nvmNode;

  const staticMgrNode = scanStaticManagerPaths(nodeExeName, minMajor, minMinor);
  if (staticMgrNode) return staticMgrNode;

  const asdfNode = scanVersionManagerNodes(path.join(HOME, '.asdf', 'installs', 'nodejs'), nodeExeName, minMajor, minMinor);
  if (asdfNode) return asdfNode;

  const pathNode = scanPathDirectories(nodeExeName, minMajor, minMinor);
  if (pathNode) return pathNode;

  const unixNode = scanUnixStandardPaths(minMajor, minMinor);
  if (unixNode) return unixNode;

  return process.execPath || 'node';
}

function prependPath(nodeBinDir, existingPath) {
  const parts = (existingPath || '').split(path.delimiter).filter(p => Boolean(p && p !== nodeBinDir));
  return [nodeBinDir, ...parts].join(path.delimiter);
}

function applyNodeBinToEnv(childEnv, nodeBinDir) {
  if (!nodeBinDir) return;
  childEnv.PATH = prependPath(nodeBinDir, childEnv.PATH || childEnv.Path);
  if (process.platform === 'win32') {
    childEnv.Path = childEnv.PATH;
  }
}

function resolveCompatibleNodeEnv(baseEnv = process.env, options = {}) {
  const childEnv = Object.assign({}, baseEnv);
  const nodePath = resolveCompatibleNode(options);
  const nodeBinDir = path.dirname(nodePath);
  applyNodeBinToEnv(childEnv, nodeBinDir);
  childEnv.KONOHA_NODE = nodePath;
  return { env: childEnv, nodePath, nodeBinDir };
}

function writeNodeExecPathRecord() {
  try {
    const nodePath = resolveCompatibleNode();
    fs.writeFileSync(FILE_TOOLS_NODE_PATH_FILE, `${nodePath}\n`);
  } catch { /* intentional fallback */ }
}

function detectPythonOrDefault() {
  return 'python3';
}

function writePythonCmdRecord(pythonCmd) {
  const cmd = pythonCmd || detectPythonOrDefault();
  try {
    fs.writeFileSync(
      FILE_TOOLS_PYTHON_CMD_FILE,
      `${Array.isArray(cmd) ? JSON.stringify(cmd) : cmd}\n`
    );
  } catch { /* intentional fallback */ }
}

module.exports = {
  parseNodeVersion,
  isNodeVersionCompatible,
  checkNodeCandidate,
  resolveCompatibleNode,
  resolveCompatibleNodeEnv,
  writeNodeExecPathRecord,
  writePythonCmdRecord
};
