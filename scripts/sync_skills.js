#!/usr/bin/env node
'use strict';

/**
 * scripts/sync_skills.js — Synchronize skills between .agents/skills and mirror trees.
 * 
 * Prevents rapid token burn during Konoha maintenance by allowing agents/developers
 * to edit a skill once in .agents/skills/ and automatically propagate byte-identical
 * copies to src/templates/skills, .cursor/skills, and .gemini/skills without manual
 * multi-file context dumping.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(ROOT, 'src', 'templates', 'skills');

const LEGACY_CLIENT_SKILL_DIRS = [
  path.join(ROOT, '.cursor', 'skills'),
  path.join(ROOT, '.gemini', 'skills'),
  path.join(ROOT, '.commandcode', 'skills'),
  path.join(ROOT, '.claude', 'skills'),
  path.join(ROOT, '.opencode', 'skills'),
  path.join(ROOT, '.omp', 'skills'),
];

const LEGACY_FINGERPRINT_FILES = [
  path.join(ROOT, '.cursor', 'skills.fingerprint'),
  path.join(ROOT, '.gemini', 'skills.fingerprint'),
  path.join(ROOT, '.commandcode', 'skills.fingerprint'),
  path.join(ROOT, '.claude', 'skills.fingerprint'),
  path.join(ROOT, '.opencode', 'skills.fingerprint'),
  path.join(ROOT, '.omp', 'skills.fingerprint'),
];

const ALLOWED_DEPLOYED_ONLY = new Set();
const ALLOWED_EXTS = new Set(['.md', '.yaml', '.yml', '.json', '.py', '.js']);

function safeRemove(targetPath, isDir = false) {
  if (!fs.existsSync(targetPath)) return 0;
  try {
    if (isDir) fs.rmSync(targetPath, { recursive: true, force: true });
    else fs.rmSync(targetPath, { force: true });
    return 1;
  } catch (_) {
    return 0;
  }
}

function pruneLegacyClientMirrors() {
  let pruned = 0;
  for (const dir of LEGACY_CLIENT_SKILL_DIRS) {
    pruned += safeRemove(dir, true);
  }
  for (const file of LEGACY_FINGERPRINT_FILES) {
    pruned += safeRemove(file, false);
  }
  return pruned;
}

function lockedSkillRoots() {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills-lock.json'), 'utf-8'));
    return new Set(Object.keys(lock.skills || {}));
  } catch (_) {
    return new Set();
  }
}

function copyFileIfChanged(src, dest) {
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  const srcBuf = fs.readFileSync(src);
  if (fs.existsSync(dest)) {
    const destBuf = fs.readFileSync(dest);
    if (srcBuf.equals(destBuf)) {
      return false; // unchanged
    }
  }
  fs.writeFileSync(dest, srcBuf);
  return true;
}

function pruneEmptyDir(dirPath) {
  try {
    if (fs.readdirSync(dirPath).length === 0) fs.rmdirSync(dirPath);
  } catch (_) { /* ignore */ }
}

function pruneStaleEntry(se, curr, opts) {
  const subFull = path.join(curr, se.name);
  if (se.isDirectory()) {
    const count = walkAndPruneDir(subFull, opts);
    pruneEmptyDir(subFull);
    return count;
  }
  const rel = path.relative(opts.targetDir, subFull).replace(/\\/g, '/');
  if (opts.context.isTemplate && ALLOWED_DEPLOYED_ONLY.has(rel)) return 0;
  if (!opts.context.validRelFiles.has(rel)) {
    return safeRemove(subFull, false);
  }
  return 0;
}

function walkAndPruneDir(curr, opts) {
  let subEntries;
  try {
    subEntries = fs.readdirSync(curr, { withFileTypes: true });
  } catch (_) {
    return 0;
  }
  let count = 0;
  for (const se of subEntries) {
    count += pruneStaleEntry(se, curr, opts);
  }
  return count;
}

function pruneTopLevelEntry(e, targetDir, opts) {
  if (e.name === '.ignore' || e.name.endsWith('.fingerprint') || e.name === '.fingerprint') return 0;
  const full = path.join(targetDir, e.name);
  if (opts.context.validTopLevels && !opts.context.validTopLevels.has(e.name)) {
    return safeRemove(full, true);
  }
  if (e.isDirectory()) {
    return walkAndPruneDir(full, opts);
  }
  return 0;
}

function pruneStaleFiles(targetDir, context = {}) {
  if (!fs.existsSync(targetDir)) return 0;
  let entries;
  try {
    entries = fs.readdirSync(targetDir, { withFileTypes: true });
  } catch (_) {
    return 0;
  }

  let removedCount = 0;
  const opts = { targetDir, context };
  for (const e of entries) {
    removedCount += pruneTopLevelEntry(e, targetDir, opts);
  }
  return removedCount;
}

function syncSkillFile(full, baseDir, state) {
  const ext = path.extname(full).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) return;

  const rel = path.relative(baseDir, full).replace(/\\/g, '/');
  const skillRoot = rel.split('/')[0];
  state.validRelFiles.add(rel);
  state.totalCount++;

  if (!ALLOWED_DEPLOYED_ONLY.has(rel) && !state.lockedRoots.has(skillRoot)) {
    const dest = path.join(state.destDir, rel);
    if (copyFileIfChanged(full, dest)) state.updatedCount++;
  }
}

function walkSyncFiles(currentDir, baseDir, state) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(currentDir, e.name);
    if (e.isDirectory()) {
      walkSyncFiles(full, baseDir, state);
    } else if (e.isFile()) {
      syncSkillFile(full, baseDir, state);
    }
  }
}

function syncSkills() {
  const sourceDir = TEMPLATES_DIR;
  if (!fs.existsSync(sourceDir)) {
    console.error(`Error: Canonical templates directory ${sourceDir} does not exist`);
    process.exit(1);
  }

  const legacyPruned = pruneLegacyClientMirrors();
  const lockedRoots = lockedSkillRoots();
  const globalMirror = path.join(os.homedir(), '.agents', 'skills');
  const destDir = globalMirror;
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const validRelFiles = new Set();
  const validTopLevels = new Set();
  const topEntries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const t of topEntries) {
    if (t.isDirectory()) validTopLevels.add(t.name);
  }

  const state = { validRelFiles, lockedRoots, destDir, updatedCount: 0, totalCount: 0 };
  walkSyncFiles(sourceDir, sourceDir, state);

  const prunedCount = pruneStaleFiles(destDir, { validTopLevels, validRelFiles, isTemplate: false });
  const soulUpdated = syncSoul();

  console.log(`✓ Skill sync complete: ${state.totalCount} files checked, ${state.updatedCount} copies updated, ${prunedCount} stray items pruned, ${legacyPruned} legacy client mirrors cleaned (SOUL.md synced: ${soulUpdated} updated).`);
}

function syncSoul() {
  const soulSrc = fs.existsSync(path.join(ROOT, 'src', 'templates', 'SOUL.md'))
    ? path.join(ROOT, 'src', 'templates', 'SOUL.md')
    : path.join(os.homedir(), '.agents', 'SOUL.md');

  if (!fs.existsSync(soulSrc)) return 0;

  let soulUpdated = 0;
  const homeAgents = path.join(os.homedir(), '.agents');
  const targets = [];
  if (fs.existsSync(homeAgents)) {
    targets.push(path.join(homeAgents, 'SOUL.md'));
  }

  for (const target of targets) {
    if (copyFileIfChanged(soulSrc, target)) {
      soulUpdated++;
    }
  }
  return soulUpdated;
}

if (require.main === module) {
  syncSkills();
}

module.exports = { syncSkills, syncSoul };
