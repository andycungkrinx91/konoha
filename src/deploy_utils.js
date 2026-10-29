/**
 * Shared install/deploy helpers for Konoha CLI and Cursor bootstrap.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { fileExists, ensureDir } = require('./platform_utils');
const { pruneObsoleteStandaloneSkills } = require('./canonical_skills');
const {
  HOME,
  SKILLS_DB_DIR,
  FILE_TOOLS_MCP_PATH,
  FILE_TOOLS_LAUNCHER_PATH,
  FILE_TOOLS_NODE_PATH_FILE,
  FILE_TOOLS_PYTHON_CMD_FILE,
  FILE_TOOLS_PY_DIR,
  SRC_DIR
} = require('../bin/lib/paths');

const FILE_TOOLS_LAUNCHER_JS = path.join(SKILLS_DB_DIR, 'file_tools_launcher.js');

const {
  parseNodeVersion,
  isNodeVersionCompatible,
  checkNodeCandidate,
  resolveCompatibleNode,
  resolveCompatibleNodeEnv,
  writeNodeExecPathRecord,
  writePythonCmdRecord
} = require('./runtime_resolver');

const {
  KONOHA_CANONICAL_TOOLS,
  buildKonohaFilesMcpEntry,
  installFileTools,
  cleanKonohaRuntimeDir
} = require('./deploy_installer');

let cachedNpmGlobalRoot = null;
let cachedResolvedWebUiDir = null;

function probeNpmGlobalRoot() {
  if (cachedNpmGlobalRoot !== null) return cachedNpmGlobalRoot;
  const isWin = process.platform === 'win32';
  try {
    const res = spawnSync(isWin ? 'npm.cmd' : 'npm', ['root', '-g'], {
      encoding: 'utf-8', timeout: 8000, shell: isWin, windowsHide: true
    });
    cachedNpmGlobalRoot = ((res.stdout || '') + '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
  } catch (_) {
    cachedNpmGlobalRoot = '';
  }
  return cachedNpmGlobalRoot;
}

function inspectPackageJsonSources(dir) {
  const pkg = path.join(dir, 'package.json');
  if (!fs.existsSync(pkg)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(pkg, 'utf8'));
    if (parsed.name !== 'konoha-web') return false;
    const hasRoutes = fs.existsSync(path.join(dir, 'src', 'routes')) || fs.existsSync(path.join(dir, 'public', 'index.html'));
    return hasRoutes && Boolean(parsed.scripts && parsed.scripts.build);
  } catch (_) {
    return false;
  }
}

function checkWebUiCandidate(dir) {
  if (!fs.existsSync(dir)) return null;
  const hasSources = inspectPackageJsonSources(dir);
  const hasBuild = fs.existsSync(path.join(dir, 'build', 'handler.js')) || fs.existsSync(path.join(dir, 'public', 'index.html'));
  if (hasSources || hasBuild) return { dir, hasSources, hasBuild };
  return null;
}

function collectWebUiCandidate(dir, qualifying) {
  try {
    const q = checkWebUiCandidate(dir);
    if (q) qualifying.push(q);
  } catch (_) { /* intentional fallback */ }
}

function hasLocalWebUiCandidate(candidates) {
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'package.json')) || fs.existsSync(path.join(dir, 'build', 'handler.js'))) {
      return true;
    }
  }
  return false;
}

function appendGlobalWebUiCandidates(candidates) {
  if (hasLocalWebUiCandidate(candidates)) return;
  const globalRoot = probeNpmGlobalRoot();
  if (!globalRoot) return;
  candidates.push(
    path.join(globalRoot, "konoha", "apps", "web"),
    path.join(globalRoot, 'Konoha', 'apps', 'web'),
    path.join(globalRoot, "konohagakure", "apps", "web")
  );
}

function filterQualifyingWebUi(candidates) {
  const qualifying = [];
  const seen = new Set();
  for (const rawDir of candidates) {
    const dir = path.resolve(rawDir);
    if (!seen.has(dir)) {
      seen.add(dir);
      collectWebUiCandidate(dir, qualifying);
    }
  }
  return qualifying;
}

function selectWebUiCandidate(qualifying, preferSources) {
  if (qualifying.length === 0) return null;
  if (preferSources) {
    const withSources = qualifying.find(c => c.hasSources);
    return withSources ? withSources.dir : null;
  }
  const withBuild = qualifying.find(c => c.hasBuild);
  return withBuild ? withBuild.dir : qualifying[0].dir;
}

function resolveWebUiDir(opts = {}) {
  if (!opts.preferSources && cachedResolvedWebUiDir && fs.existsSync(cachedResolvedWebUiDir)) {
    return cachedResolvedWebUiDir;
  }

  const candidates = [
    path.resolve(process.cwd(), 'apps', 'web'),
    path.resolve(process.cwd()),
    path.resolve(__dirname, '..', 'apps', 'web'),
    path.join(HOME, '.konoha', 'apps', 'web')
  ];

  appendGlobalWebUiCandidates(candidates);
  const qualifying = filterQualifyingWebUi(candidates);
  const selected = selectWebUiCandidate(qualifying, opts.preferSources);
  if (selected) cachedResolvedWebUiDir = selected;
  return selected;
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyIfDifferent(src, dest) {
  if (!fileExists(src)) return false;
  if (!fileExists(dest)) {
    copyFile(src, dest);
    return true;
  }
  try {
    const a = fs.readFileSync(src);
    const b = fs.readFileSync(dest);
    if (!a.equals(b)) {
      copyFile(src, dest);
      return true;
    }
  } catch {
    try {
      copyFile(src, dest);
      return true;
    } catch { /* intentional fallback */ }
  }
  return false;
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
    for (const entry of fs.readdirSync(src)) {
      copyRecursiveIfDifferent(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    copyIfDifferent(src, dest);
  }
}

function checkSkillEntry(skillsDir, entry) {
  if (entry.isDirectory() && fileExists(path.join(skillsDir, entry.name, 'SKILL.md'))) {
    return entry.name;
  }
  if (entry.isFile() && entry.name.endsWith('-skill.md')) {
    return entry.name;
  }
  return null;
}

function listSkillEntries(skillsDir) {
  if (!fileExists(skillsDir)) return [];
  const entries = [];
  try {
    const items = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const item of items) {
      const match = checkSkillEntry(skillsDir, item);
      if (match) entries.push(match);
    }
  } catch { /* intentional fallback */ }
  return entries;
}

function isIgnoredFingerprintName(dir, root, name) {
  if (dir !== root) return false;
  return name === '.claude' || name === '.cursor' || name === 'CLAUDE.md' || name === '.git' || name === '.DS_Store';
}

function processFingerprintEntry(dir, entry, context) {
  if (isIgnoredFingerprintName(dir, context.root, entry.name)) return;
  const p = path.join(dir, entry.name);
  try {
    const st = fs.statSync(p);
    if (entry.isDirectory()) {
      context.stack.push(p);
      return;
    }
    context.count++;
    context.totalSize += st.size;
    if (st.mtimeMs > context.maxMtime) context.maxMtime = st.mtimeMs;
  } catch (_) { /* intentional fallback */ }
}

function treeFingerprint(root) {
  if (!fs.existsSync(root)) return '0:0:0';
  const context = { root, stack: [root], maxMtime: 0, count: 0, totalSize: 0 };
  while (context.stack.length) {
    const dir = context.stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      processFingerprintEntry(dir, entry, context);
    }
  }
  return `${context.maxMtime.toFixed(0)}:${context.count}:${context.totalSize}`;
}

function copyFastEntry(dir, entry, options) {
  const { srcRoot, destRoot, walk } = options;
  if (dir === srcRoot && (entry.name === '.claude' || entry.name === '.cursor' || entry.name === 'CLAUDE.md' || entry.name === '.git' || entry.name === '.DS_Store')) {
    return;
  }
  const s = path.join(dir, entry.name);
  const d = path.join(destRoot, path.relative(srcRoot, s));
  if (entry.isDirectory()) {
    ensureDir(d);
    walk(s);
  } else {
    copyIfDifferent(s, d);
  }
}

function copySkillsDirFast(srcRoot, destRoot, precomputedSrcFp = null) {
  if (!fs.existsSync(srcRoot)) return;
  ensureDir(destRoot);
  const srcFp = precomputedSrcFp || treeFingerprint(srcRoot);
  const fpMarker = destRoot + '.fingerprint';
  let destFp = null;
  try { destFp = fs.readFileSync(fpMarker, 'utf-8').trim(); } catch { /* intentional fallback */ }
  if (srcFp === destFp) return;

  const walk = dir => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      copyFastEntry(dir, entry, { srcRoot, destRoot, walk });
    }
  };
  walk(srcRoot);
  try { fs.writeFileSync(fpMarker, srcFp, 'utf-8'); } catch { /* intentional fallback */ }
}

function mirrorSkillsDirectory() {
  return 0;
}

function syncCursorSkillsFromAgents() {
  return 0;
}

function resolveSoulSource() {
  const candidates = [
    path.join(__dirname, 'templates', 'SOUL.md'),
    path.join(__dirname, '..', 'src', 'templates', 'SOUL.md'),
    path.join(__dirname, '..', '.agents', 'SOUL.md'),
    path.join(__dirname, '..', 'SOUL.md')
  ];
  for (const c of candidates) {
    if (fileExists(c)) return c;
  }
  return null;
}

function _copySingleSoulTarget(src, target) {
  try {
    return copyIfDifferent(src, target) ? 1 : 0;
  } catch (_) {
    return 0;
  }
}

function syncSoulAcrossClients(options = {}) {
  const src = resolveSoulSource();
  if (!src) return 0;

  const effectiveHome = options.home || process.env.HOME || process.env.USERPROFILE || HOME || require('os').homedir();
  const targets = [
    path.join(effectiveHome, '.agents', 'SOUL.md'),
    path.join(effectiveHome, '.gemini', 'SOUL.md'),
    path.join(effectiveHome, '.cursor', 'SOUL.md'),
    path.join(effectiveHome, '.claude', 'SOUL.md'),
    path.join(effectiveHome, '.commandcode', 'SOUL.md'),
    path.join(effectiveHome, '.codex', 'SOUL.md'),
    path.join(effectiveHome, '.config', 'opencode', 'SOUL.md'),
    path.join(effectiveHome, '.opencode', 'SOUL.md'),
    path.join(effectiveHome, '.pi', 'SOUL.md'),
    path.join(effectiveHome, '.omp', 'SOUL.md')
  ];

  let updated = 0;
  for (const t of targets) {
    updated += _copySingleSoulTarget(src, t);
  }
  return updated;
}

const OFFICIAL_SKILL_NAMES = new Set([
  'akatsuki-skill', 'anbu-skill', 'chunin-skill', 'genin-skill',
  'jonin-skill', 'kage-skill', 'konoha', 'sannin-skill',
  'tokubetsu-jonin-skill', 'antislop', 'antislop-code',
  'antislop-copywriting', 'antislop-human', 'antislop-layoutmobile',
  'antislop-ui', 'i-have-adhd'
]);

const CLIENT_WORKSPACE_FOLDERS = new Set([
  '.cursor', '.gemini', '.commandcode', '.claude',
  '.opencode', '.codex', '.pi', '.omp'
]);

const SKIP_RECURSION_DIRS = new Set([
  'node_modules', '.git', '.venv', 'venv', 'dist', 'build',
  '.cache', '.output', '.turbo', 'vendor'
]);

function _pruneOfficialSkillsFromAgents(agentsDir, removed) {
  const skillsDir = path.join(agentsDir, 'skills');
  if (!fileExists(skillsDir)) return;
  try {
    const skillEntries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const se of skillEntries) {
      if (se.isDirectory() && OFFICIAL_SKILL_NAMES.has(se.name)) {
        const p = path.join(skillsDir, se.name);
        fs.rmSync(p, { recursive: true, force: true });
        removed.push(p);
      }
    }
    const remaining = fs.readdirSync(skillsDir);
    if (remaining.every(r => r === '.ignore')) {
      fs.rmSync(skillsDir, { recursive: true, force: true });
      removed.push(skillsDir);
    }
  } catch (_) { /* best-effort */ }
}

function _cleanEmptyDir(dirPath, removed) {
  try {
    if (fs.readdirSync(dirPath).length === 0) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      removed.push(dirPath);
    }
  } catch (_) { /* best-effort */ }
}

function _handleClientFolder(fullPath, depth, removed) {
  if (depth > 0) {
    try {
      fs.rmSync(fullPath, { recursive: true, force: true });
      removed.push(fullPath);
    } catch (_) { /* ignore */ }
    return;
  }
  const clientSkills = path.join(fullPath, 'skills');
  if (fileExists(clientSkills)) {
    try {
      fs.rmSync(clientSkills, { recursive: true, force: true });
      removed.push(clientSkills);
    } catch (_) { /* ignore */ }
  }
}

function _pruneDirectoryEntry(entry, currentDir, depth, maxDepth, removed) {
  if (!entry.isDirectory()) return;
  const name = entry.name;
  const fullPath = path.join(currentDir, name);

  if (CLIENT_WORKSPACE_FOLDERS.has(name)) {
    _handleClientFolder(fullPath, depth, removed);
    return;
  }
  if (name === '.agents') {
    _pruneOfficialSkillsFromAgents(fullPath, removed);
    _cleanEmptyDir(fullPath, removed);
    return;
  }
  if (!SKIP_RECURSION_DIRS.has(name) && !name.startsWith('.') && depth < maxDepth) {
    _walkWorkspaceDir(fullPath, depth + 1, maxDepth, removed);
  }
}

function _walkWorkspaceDir(currentDir, depth, maxDepth, removed) {
  let entries;
  try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    _pruneDirectoryEntry(entry, currentDir, depth, maxDepth, removed);
  }
}

function pruneWorkspacePollution(workspaceRoot, options = {}) {
  if (!workspaceRoot || !fileExists(workspaceRoot)) return { removed: [] };
  const resolvedRoot = path.resolve(workspaceRoot);
  const userHome = path.resolve(options.home || process.env.HOME || process.env.USERPROFILE || HOME || os.homedir());
  if (resolvedRoot === userHome) return { removed: [] };

  const removed = [];
  const maxDepth = options.maxDepth || 4;
  _walkWorkspaceDir(resolvedRoot, 0, maxDepth, removed);
  return { removed };
}

module.exports = {
  HOME,
  SRC_DIR,
  SKILLS_DB_DIR,
  FILE_TOOLS_MCP_PATH,
  FILE_TOOLS_LAUNCHER_JS,
  FILE_TOOLS_LAUNCHER_PATH,
  FILE_TOOLS_NODE_PATH_FILE,
  resolveWebUiDir,
  FILE_TOOLS_PYTHON_CMD_FILE,
  FILE_TOOLS_PY_DIR,
  fileExists,
  ensureDir,
  copyFile,
  copyIfDifferent,
  copyRecursiveIfDifferent,
  listSkillEntries,
  mirrorSkillsDirectory,
  syncCursorSkillsFromAgents,
  resolveSoulSource,
  syncSoulAcrossClients,
  pruneWorkspacePollution,
  writeNodeExecPathRecord,
  writePythonCmdRecord,
  buildKonohaFilesMcpEntry,
  KONOHA_CANONICAL_TOOLS,
  treeFingerprint,
  copySkillsDirFast,
  pruneObsoleteStandaloneSkills,
  installFileTools,
  cleanKonohaRuntimeDir,
  parseNodeVersion,
  isNodeVersionCompatible,
  checkNodeCandidate,
  resolveCompatibleNode,
  resolveCompatibleNodeEnv
};
