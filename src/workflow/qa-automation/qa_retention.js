'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function ensureQaGitignore(_projectPath) {
  return { status: 'skipped', reason: 'disabled', entries_added: 0 };
}

function getProjectOutputDirs(projectPath) {
  const resolved = path.resolve(projectPath);
  const projectHash = crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 16);
  const baseQaDir = path.join(os.homedir(), '.konoha', 'tmp', 'qa');
  const projectQaDir = path.join(baseQaDir, 'projects', projectHash);

  const rel = path.relative(baseQaDir, projectQaDir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Project output directory escapes base QA temporary directory');
  }

  const artifactsDir = path.join(projectQaDir, 'artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });

  return { projectHash, projectQaDir, artifactsDir };
}

function copySingleFailure(f, i, artifactsDir) {
  if (f.trace && fs.existsSync(f.trace)) {
    try {
      fs.mkdirSync(artifactsDir, { recursive: true });
      const dest = path.join(artifactsDir, `trace-${i + 1}.zip`);
      fs.copyFileSync(f.trace, dest);
      f.trace = dest;
    } catch (_) { /* best effort */ }
  }
  if (f.screenshot && fs.existsSync(f.screenshot)) {
    try {
      fs.mkdirSync(artifactsDir, { recursive: true });
      const ext = path.extname(f.screenshot) || '.png';
      const dest = path.join(artifactsDir, `screenshot-${i + 1}${ext}`);
      fs.copyFileSync(f.screenshot, dest);
      f.screenshot = dest;
    } catch (_) { /* best effort */ }
  }
}

function copyFailureEvidence(failureEntries, runTmpDir) {
  if (!Array.isArray(failureEntries) || failureEntries.length === 0) return;
  const artifactsDir = path.join(runTmpDir, 'artifacts');
  for (let i = 0; i < failureEntries.length; i++) {
    copySingleFailure(failureEntries[i], i, artifactsDir);
  }
}

function shouldKeepRunFolder(rf, currentRunId, kept, options) {
  if (rf.name === currentRunId) return true;
  const { lookupAvailable, protectedRunIds, maxCount, now, SEVEN_DAYS_MS } = options;
  if (lookupAvailable) {
    if (kept < maxCount) return true;
    if (protectedRunIds.has(rf.name)) return true;
    return false;
  }
  const ageMs = now - rf.mtimeMs;
  if (ageMs < SEVEN_DAYS_MS) return true;
  if (kept < maxCount) return true;
  return false;
}

function resolveProtectedRunIds() {
  const protectedRunIds = new Set();
  try {
    const sdlcManager = require('../kage-reviewer/sdlc_manager');
    const tasks = sdlcManager.listTasks({ limit: 1000 });
    for (const t of tasks) {
      if (t.status === 'completed' || !t.evidence) continue;
      const evStr = typeof t.evidence === 'string' ? t.evidence : JSON.stringify(t.evidence);
      const matches = evStr.match(/qa-\d+-[a-f0-9]+/g);
      if (matches) matches.forEach(m => protectedRunIds.add(m));
    }
    return { available: true, protectedRunIds };
  } catch (_) {
    return { available: false, protectedRunIds };
  }
}

function inspectRunFolder(baseQaDir, entry, runIdRegex) {
  if (!entry.isDirectory() && !entry.isSymbolicLink()) return null;
  if (!runIdRegex.test(entry.name)) return null;
  const fullPath = path.join(baseQaDir, entry.name);
  const rel = path.relative(baseQaDir, fullPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  try {
    const stat = fs.lstatSync(fullPath);
    if (stat.isSymbolicLink()) return null;
    return { name: entry.name, path: fullPath, mtimeMs: stat.mtimeMs };
  } catch (_) {
    return null;
  }
}

function discoverRunFolders(baseQaDir) {
  let entries = [];
  try {
    entries = fs.readdirSync(baseQaDir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  const runFolders = [];
  const runIdRegex = /^qa-\d+-[a-f0-9]+$/;
  for (const entry of entries) {
    const rf = inspectRunFolder(baseQaDir, entry, runIdRegex);
    if (rf) runFolders.push(rf);
  }
  runFolders.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return runFolders;
}

function pruneSingleRunFolder(rf) {
  try {
    fs.rmSync(rf.path, { recursive: true, force: true });
    return true;
  } catch (_) {
    return false;
  }
}

function getProtectedRunContext(options) {
  if (options.protectedRunIds) {
    return { available: Boolean(options.lookupAvailable ?? true), protectedRunIds: new Set(options.protectedRunIds) };
  }
  const lookupAvailable = options.lookupAvailable !== undefined ? Boolean(options.lookupAvailable) : true;
  if (!lookupAvailable) {
    return { available: false, protectedRunIds: new Set() };
  }
  return resolveProtectedRunIds();
}

function retainRunFolders(runFolders, currentRunId, options) {
  let kept = 0;
  let pruned = 0;
  for (const rf of runFolders) {
    const keep = shouldKeepRunFolder(rf, currentRunId, kept, options);
    const removed = !keep && pruneSingleRunFolder(rf);
    if (removed) {
      pruned++;
      continue;
    }
    kept++;
  }
  return { kept, pruned };
}

function runQaRetention(currentRunId, options = {}) {
  const baseQaDir = options.baseDir || path.join(os.homedir(), '.konoha', 'tmp', 'qa');
  if (!fs.existsSync(baseQaDir)) {
    return { kept: 0, pruned: 0, lookup_available: true };
  }

  const maxCount = options.maxCount !== undefined 
    ? options.maxCount 
    : parseInt(process.env.KONOHA_QA_RETENTION_COUNT || '20', 10);

  const { available: lookupAvailable, protectedRunIds } = getProtectedRunContext(options);
  const runFolders = discoverRunFolders(baseQaDir);
  const now = options.now || Date.now();
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  const { kept, pruned } = retainRunFolders(runFolders, currentRunId, {
    maxCount, lookupAvailable, protectedRunIds, now, SEVEN_DAYS_MS
  });

  return { kept, pruned, lookup_available: lookupAvailable };
}

module.exports = {
  ensureQaGitignore,
  getProjectOutputDirs,
  copyFailureEvidence,
  runQaRetention
};
