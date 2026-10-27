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
const AGENTS_DIR = path.join(ROOT, '.agents', 'skills');
const TEMPLATES_DIR = path.join(ROOT, 'src', 'templates', 'skills');
const CLIENT_CONFIG_PARENTS = [
  path.join(ROOT, '.cursor'),
  path.join(ROOT, '.gemini'),
  path.join(ROOT, '.commandcode'),
  path.join(ROOT, '.claude'),
  path.join(ROOT, '.opencode'),
  path.join(ROOT, '.omp'),
];

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

const ALLOWED_DEPLOYED_ONLY = new Set(['anbu-skill/devops-engineer.md']);
const ALLOWED_EXTS = new Set(['.md', '.yaml', '.yml', '.json', '.py', '.js']);

function pruneLegacyClientMirrors() {
  let pruned = 0;
  for (const dir of LEGACY_CLIENT_SKILL_DIRS) {
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        pruned++;
      } catch (_) { /* ignore */ }
    }
  }
  for (const file of LEGACY_FINGERPRINT_FILES) {
    if (fs.existsSync(file)) {
      try {
        fs.rmSync(file, { force: true });
        pruned++;
      } catch (_) { /* ignore */ }
    }
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

function walkAndPruneDir(curr, opts) {
  let subEntries;
  try {
    subEntries = fs.readdirSync(curr, { withFileTypes: true });
  } catch (_) {
    return 0;
  }
  let count = 0;
  for (const se of subEntries) {
    const subFull = path.join(curr, se.name);
    if (se.isDirectory()) {
      count += walkAndPruneDir(subFull, opts);
      try {
        if (fs.readdirSync(subFull).length === 0) {
          fs.rmdirSync(subFull);
        }
      } catch (_) { /* ignore */ }
      continue;
    }
    const rel = path.relative(opts.targetDir, subFull).replace(/\\/g, '/');
    if (opts.context.isTemplate && ALLOWED_DEPLOYED_ONLY.has(rel)) continue;
    if (!opts.context.validRelFiles.has(rel)) {
      try {
        fs.rmSync(subFull, { force: true });
        count++;
      } catch (_) { /* ignore */ }
    }
  }
  return count;
}

function pruneStaleFiles(targetDir, context = {}) {
  if (!fs.existsSync(targetDir)) return 0;
  let removedCount = 0;
  let entries;
  try {
    entries = fs.readdirSync(targetDir, { withFileTypes: true });
  } catch (_) {
    return 0;
  }

  const opts = { targetDir, context };
  for (const e of entries) {
    if (e.name === '.ignore' || e.name.endsWith('.fingerprint') || e.name === '.fingerprint') continue;
    const full = path.join(targetDir, e.name);

    if (context.validTopLevels && !context.validTopLevels.has(e.name)) {
      try {
        fs.rmSync(full, { recursive: true, force: true });
        removedCount++;
      } catch (_) { /* ignore */ }
      continue;
    }

    if (e.isDirectory()) {
      removedCount += walkAndPruneDir(full, opts);
    }
  }
  return removedCount;
}

function syncSkills() {
  if (!fs.existsSync(TEMPLATES_DIR) && !fs.existsSync(AGENTS_DIR)) {
    console.error(`Error: Neither ${TEMPLATES_DIR} nor ${AGENTS_DIR} exists`);
    process.exit(1);
  }

  const legacyPruned = pruneLegacyClientMirrors();
  const lockedRoots = lockedSkillRoots();
  let updatedCount = 0;
  let totalCount = 0;

  const sourceDir = AGENTS_DIR;
  const destDir = TEMPLATES_DIR;

  const validRelFiles = new Set();
  const validTopLevels = new Set();
  const topEntries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const t of topEntries) {
    if (t.isDirectory()) validTopLevels.add(t.name);
  }

  function walk(currentDir, baseDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(currentDir, e.name);
      if (e.isDirectory()) {
        walk(full, baseDir);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (!ALLOWED_EXTS.has(ext)) continue;

        const rel = path.relative(baseDir, full).replace(/\\/g, '/');
        const skillRoot = rel.split('/')[0];
        validRelFiles.add(rel);
        totalCount++;

        if (!ALLOWED_DEPLOYED_ONLY.has(rel) && !lockedRoots.has(skillRoot)) {
          const dest = path.join(destDir, rel);
          if (copyFileIfChanged(full, dest)) updatedCount++;
        }
      }
    }
  }

  walk(sourceDir, sourceDir);

  let prunedCount = pruneStaleFiles(destDir, { validTopLevels, validRelFiles, isTemplate: destDir === TEMPLATES_DIR });
  const soulUpdated = syncSoul();

  console.log(`✓ Skill sync complete: ${totalCount} files checked, ${updatedCount} copies updated, ${prunedCount} stray items pruned, ${legacyPruned} legacy client mirrors cleaned (SOUL.md synced: ${soulUpdated} updated).`);
}

function syncSoul() {
  const soulSrc = fs.existsSync(path.join(ROOT, 'src', 'templates', 'SOUL.md'))
    ? path.join(ROOT, 'src', 'templates', 'SOUL.md')
    : path.join(ROOT, '.agents', 'SOUL.md');

  if (!fs.existsSync(soulSrc)) return 0;

  let soulUpdated = 0;
  const targets = [
    path.join(ROOT, '.agents', 'SOUL.md'),
    path.join(ROOT, 'src', 'templates', 'SOUL.md')
  ];

  for (const parent of CLIENT_CONFIG_PARENTS) {
    if (fs.existsSync(parent)) {
      targets.push(path.join(parent, 'SOUL.md'));
    }
  }

  const homeAgents = path.join(os.homedir(), '.agents');
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
