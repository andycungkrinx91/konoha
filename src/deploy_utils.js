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
    const res = isWin
      ? spawnSync('npm.cmd root -g', { encoding: 'utf-8', timeout: 8000, shell: true, windowsHide: true })
      : spawnSync('npm', ['root', '-g'], { encoding: 'utf-8', timeout: 8000 });
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
  removeNestedSkillDirForEachSkill(destRoot);
  try { fs.writeFileSync(fpMarker, srcFp, 'utf-8'); } catch { /* intentional fallback */ }
}

// A previous installer could re-copy a skill into itself, producing
// <skill>/<skill>/ with a duplicate tree that clients then resolve to. Remove the
// nested copy only when it is a byte-identical duplicate of the outer tree, so a
// nested directory holding user edits is never destroyed.
function removeNestedSkillDirForEachSkill(destRoot) {
  let skills;
  try { skills = fs.readdirSync(destRoot, { withFileTypes: true }); } catch { return; }
  for (const skill of skills) {
    if (!skill.isDirectory()) continue;
    removeNestedSkillDir(path.join(destRoot, skill.name));
  }
}

function removeNestedSkillDir(skillDir) {
  const nested = path.join(skillDir, path.basename(skillDir));
  if (path.resolve(nested) === path.resolve(skillDir)) return false;
  if (!fileExists(nested)) return false;
  if (!isMirrorDuplicate(skillDir, nested)) return false;
  try {
    fs.rmSync(nested, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

function isMirrorDuplicate(root, dupRoot) {
  const walk = (base, rel) => {
    const dir = path.join(base, rel);
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
    for (const entry of entries) {
      const childRel = path.join(rel, entry.name);
      if (entry.isDirectory()) {
        if (!walk(base, childRel)) return false;
        continue;
      }
      const a = path.join(root, childRel);
      const b = path.join(dupRoot, childRel);
      if (!fileExists(b)) return false;
      try {
        if (!fs.readFileSync(a).equals(fs.readFileSync(b))) return false;
      } catch {
        return false;
      }
    }
    return true;
  };
  return walk(dupRoot, '');
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

const GLOBAL_GIT_EXCLUDE_PATTERNS = [
  '.codex/',
  '.cursor/',
  '.claude/',
  '.gemini/',
  '.opencode/',
  '.commandcode/',
  '.pi/',
  '.agents/',
  'CLAUDE.md'
];

const OBSOLETE_KONOHA_GLOBAL_EXCLUDES = new Set([
  '.omp/',
  '.omp/.',
  '.omp/plans/',
  '.omp/plans',
  '/.omp/plans/',
  '/PLAN.md',
  'PLAN.md'
]);

function isKonohaRepository(projectRoot) {
  if (!projectRoot || typeof projectRoot !== 'string') return false;
  try {
    const pkgPath = path.join(path.resolve(projectRoot), 'package.json');
    if (!fs.existsSync(pkgPath)) return false;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const name = String(pkg && pkg.name || '').trim().toLowerCase();
    return (name === 'konoha' || name === 'konoha-mcp') &&
      fs.existsSync(path.join(path.resolve(projectRoot), 'src', 'agent_contract.js'));
  } catch (_) {
    return false;
  }
}

function sanitizePollutedProjectGitignore(projectRoot) {
  if (!projectRoot || typeof projectRoot !== 'string') return { ok: true, modified: false };
  const resolvedRoot = path.resolve(projectRoot);
  if (isKonohaRepository(resolvedRoot)) {
    return { ok: true, modified: false, skipped: 'konoha_repository' };
  }
  const gitignorePath = path.join(resolvedRoot, '.gitignore');
  if (!fileExists(gitignorePath)) return { ok: true, modified: false };

  try {
    const original = fs.readFileSync(gitignorePath, 'utf-8');
    let updated = original;

    const pollutedBlockRegex = /\r?\n?(?:# Consolidated Plan Ignore Block \(Mandatory Konoha Invariant\)\r?\n)?\/PLAN\.md\r?\nPLAN\.md\r?\n\/\.omp\/plans\/\r?\n\.omp\/plans\/\r?\n\.omp\/plans\r?\n\.omp\/(?:\.|)\r?\n?/g;
    updated = updated.replace(pollutedBlockRegex, '\n');

    const pollutedLines = new Set([
      '# Consolidated Plan Ignore Block (Mandatory Konoha Invariant)',
      '/PLAN.md',
      'PLAN.md',
      '/.omp/plans/',
      '.omp/plans/',
      '.omp/plans',
      '.omp/',
      '.omp/.'
    ]);
    updated = updated
      .split(/\r?\n/)
      .filter((line) => !pollutedLines.has(line.trim()))
      .join('\n');

    if (updated !== original) {
      const normalized = updated.replace(/\n{3,}/g, '\n\n').trimEnd();
      fs.writeFileSync(gitignorePath, normalized ? `${normalized}\n` : '', 'utf-8');
      return { ok: true, modified: true, path: gitignorePath };
    }
    return { ok: true, modified: false, path: gitignorePath };
  } catch (err) {
    return { ok: false, modified: false, error: err.message };
  }
}

function resolveGlobalGitExcludesPath(homeDir) {
  const effectiveHome = homeDir || process.env.HOME || process.env.USERPROFILE || HOME || os.homedir();
  if (!homeDir) {
    try {
      const res = spawnSync('git', ['config', '--global', '--get', 'core.excludesFile'], {
        encoding: 'utf-8',
        timeout: 4000,
        windowsHide: true
      });
      const configured = ((res.stdout || '') + '').trim();
      if (configured) {
        return configured.startsWith('~/')
          ? path.join(effectiveHome, configured.slice(2))
          : path.resolve(effectiveHome, configured);
      }
    } catch (_) { /* intentional fallback */ }
  }
  return path.join(effectiveHome, '.config', 'git', 'ignore');
}

function ensureGlobalGitExcludes(homeDir) {
  try {
    const excludesPath = resolveGlobalGitExcludesPath(homeDir);
    ensureDir(path.dirname(excludesPath));
    const existing = fileExists(excludesPath) ? fs.readFileSync(excludesPath, 'utf-8') : '';
    const rawLines = existing ? existing.split(/\r?\n/) : [];
    const cleanedLines = [];
    let removedObsolete = 0;
    for (const line of rawLines) {
      const trimmed = line.trim();
      if (OBSOLETE_KONOHA_GLOBAL_EXCLUDES.has(trimmed)) {
        removedObsolete++;
        continue;
      }
      cleanedLines.push(line);
    }
    const existingSet = new Set(cleanedLines.map(l => l.trim()).filter(Boolean));
    const missing = GLOBAL_GIT_EXCLUDE_PATTERNS.filter(pattern => !existingSet.has(pattern));
    if (missing.length === 0 && removedObsolete === 0) {
      return { ok: true, path: excludesPath, added: 0, removed: 0 };
    }
    const nextLines = [...cleanedLines.filter((l, idx, arr) => !(idx === arr.length - 1 && l === '')), ...missing];
    fs.writeFileSync(excludesPath, nextLines.length > 0 ? `${nextLines.join('\n').trimEnd()}\n` : '', 'utf-8');
    return { ok: true, path: excludesPath, added: missing.length, removed: removedObsolete };
  } catch (err) {
    return { ok: false, error: err.message, added: 0, removed: 0 };
  }
}

const OFFICIAL_SKILL_NAMES = new Set([
  'akatsuki-skill', 'anbu-skill', 'chunin-skill', 'genin-skill',
  'jonin-skill', 'kage-skill', 'konoha', 'sannin-skill',
  'tokubetsu-jonin-skill', 'yamanaka-skill', 'antislop', 'antislop-code',
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

function pruneWorkspacePollution(_workspaceRoot, _options = {}) {
  // Ownership boundary invariant: Konoha NEVER deletes `.cursor`, `.gemini`,
  // `.claude`, `.commandcode`, `.opencode`, `.codex`, `.pi`, `.omp`, `skills/`,
  // `agents/`, `conversations/`, or `.agents/` inside user workspaces.
  return { removed: [], skipped: true, reason: 'protected_user_workspace' };
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
  removeNestedSkillDirForEachSkill,
  syncCursorSkillsFromAgents,
  resolveSoulSource,
  syncSoulAcrossClients,
  ensureGlobalGitExcludes,
  isKonohaRepository,
  sanitizePollutedProjectGitignore,
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
