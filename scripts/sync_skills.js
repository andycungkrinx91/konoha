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

const ROOT = path.resolve(__dirname, '..');
const AGENTS_DIR = path.join(ROOT, '.agents', 'skills');
const TEMPLATES_DIR = path.join(ROOT, 'src', 'templates', 'skills');
const CURSOR_DIR = path.join(ROOT, '.cursor', 'skills');
const GEMINI_DIR = path.join(ROOT, '.gemini', 'skills');

const ALLOWED_DEPLOYED_ONLY = new Set(['anbu-skill/devops-engineer.md']);
const ALLOWED_EXTS = new Set(['.md', '.yaml', '.yml', '.json', '.py', '.js']);

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

function syncSkills() {
  if (!fs.existsSync(AGENTS_DIR)) {
    console.error(`Error: ${AGENTS_DIR} does not exist`);
    process.exit(1);
  }

  const lockedRoots = lockedSkillRoots();
  let updatedCount = 0;
  let totalCount = 0;

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(currentDir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (!ALLOWED_EXTS.has(ext)) continue;

        const rel = path.relative(AGENTS_DIR, full).replace(/\\/g, '/');
        const skillRoot = rel.split('/')[0];
        totalCount++;

        // Sync to src/templates/skills (unless locked or deployed-only)
        if (!ALLOWED_DEPLOYED_ONLY.has(rel) && !lockedRoots.has(skillRoot)) {
          const dest = path.join(TEMPLATES_DIR, rel);
          if (copyFileIfChanged(full, dest)) updatedCount++;
        }

        // Sync to .cursor/skills if directory exists
        if (fs.existsSync(CURSOR_DIR)) {
          const dest = path.join(CURSOR_DIR, rel);
          if (copyFileIfChanged(full, dest)) updatedCount++;
        }

        // Sync to .gemini/skills if directory exists
        if (fs.existsSync(GEMINI_DIR)) {
          const dest = path.join(GEMINI_DIR, rel);
          if (copyFileIfChanged(full, dest)) updatedCount++;
        }
      }
    }
  }

  walk(AGENTS_DIR);
  console.log(`✓ Skill sync complete: ${totalCount} files checked, ${updatedCount} file copies updated across trees.`);
}

if (require.main === module) {
  syncSkills();
}

module.exports = { syncSkills };
