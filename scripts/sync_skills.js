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
const COMMANDCODE_DIR = path.join(ROOT, '.commandcode', 'skills');
const CLAUDE_DIR = path.join(ROOT, '.claude', 'skills');
const CODEX_DIR = path.join(ROOT, '.codex', 'skills');
const OPENCODE_DIR = path.join(ROOT, '.opencode', 'skills');

const ALLOWED_DEPLOYED_ONLY = new Set(['anbu-skill/devops-engineer.md']);
const ALLOWED_EXTS = new Set(['.md', '.yaml', '.yml', '.json', '.py', '.js']);

const CLIENT_MIRRORS = [
  { name: '.cursor/skills', parent: path.join(ROOT, '.cursor'), dir: CURSOR_DIR },
  { name: '.gemini/skills', parent: path.join(ROOT, '.gemini'), dir: GEMINI_DIR },
  { name: '.commandcode/skills', parent: path.join(ROOT, '.commandcode'), dir: COMMANDCODE_DIR },
  { name: '.claude/skills', parent: path.join(ROOT, '.claude'), dir: CLAUDE_DIR },
  { name: '.codex/skills', parent: path.join(ROOT, '.codex'), dir: CODEX_DIR },
  { name: '.opencode/skills', parent: path.join(ROOT, '.opencode'), dir: OPENCODE_DIR },
];

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

function pruneStaleFiles(targetDir, validTopLevels, validRelFiles, isTemplate = false) {
  if (!fs.existsSync(targetDir)) return 0;
  let removedCount = 0;
  let entries;
  try {
    entries = fs.readdirSync(targetDir, { withFileTypes: true });
  } catch (_) {
    return 0;
  }

  for (const e of entries) {
    if (e.name === '.ignore' || e.name.endsWith('.fingerprint') || e.name === '.fingerprint') continue;
    const full = path.join(targetDir, e.name);

    if (!validTopLevels.has(e.name)) {
      try {
        fs.rmSync(full, { recursive: true, force: true });
        removedCount++;
      } catch (_) { /* ignore */ }
      continue;
    }

    if (e.isDirectory()) {
      function walkPrune(curr) {
        let subEntries;
        try {
          subEntries = fs.readdirSync(curr, { withFileTypes: true });
        } catch (_) {
          return;
        }

        for (const se of subEntries) {
          const subFull = path.join(curr, se.name);
          if (se.isDirectory()) {
            walkPrune(subFull);
            try {
              if (fs.readdirSync(subFull).length === 0) {
                fs.rmdirSync(subFull);
              }
            } catch (_) { /* ignore */ }
          } else {
            const rel = path.relative(targetDir, subFull).replace(/\\/g, '/');
            if (isTemplate && ALLOWED_DEPLOYED_ONLY.has(rel)) continue;
            if (!validRelFiles.has(rel)) {
              try {
                fs.rmSync(subFull, { force: true });
                removedCount++;
              } catch (_) { /* ignore */ }
            }
          }
        }
      }
      walkPrune(full);
    }
  }
  return removedCount;
}

function syncSkills() {
  if (!fs.existsSync(AGENTS_DIR)) {
    console.error(`Error: ${AGENTS_DIR} does not exist`);
    process.exit(1);
  }

  const lockedRoots = lockedSkillRoots();
  let updatedCount = 0;
  let totalCount = 0;

  const validRelFiles = new Set();
  const validTopLevels = new Set();
  const topEntries = fs.readdirSync(AGENTS_DIR, { withFileTypes: true });
  for (const t of topEntries) {
    if (t.isDirectory()) validTopLevels.add(t.name);
  }

  // Active client mirrors: any mirror whose parent directory exists
  const activeMirrors = CLIENT_MIRRORS.filter(m => fs.existsSync(m.parent));
  for (const m of activeMirrors) {
    if (!fs.existsSync(m.dir)) {
      fs.mkdirSync(m.dir, { recursive: true });
    }
  }

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
        validRelFiles.add(rel);
        totalCount++;

        // Sync to src/templates/skills (unless locked or deployed-only)
        if (!ALLOWED_DEPLOYED_ONLY.has(rel) && !lockedRoots.has(skillRoot)) {
          const dest = path.join(TEMPLATES_DIR, rel);
          if (copyFileIfChanged(full, dest)) updatedCount++;
        }

        // Sync to all active client mirrors (.cursor, .gemini, .commandcode, .claude)
        for (const m of activeMirrors) {
          const dest = path.join(m.dir, rel);
          if (copyFileIfChanged(full, dest)) updatedCount++;
        }
      }
    }
  }

  walk(AGENTS_DIR);

  // Prune stray files and broken symlinks across all target trees
  let prunedCount = pruneStaleFiles(TEMPLATES_DIR, validTopLevels, validRelFiles, true);
  for (const m of activeMirrors) {
    prunedCount += pruneStaleFiles(m.dir, validTopLevels, validRelFiles, false);
  }

  console.log(`✓ Skill sync complete: ${totalCount} files checked, ${updatedCount} copies updated, ${prunedCount} stray items pruned across ${1 + activeMirrors.length} trees.`);
}

if (require.main === module) {
  syncSkills();
}

module.exports = { syncSkills };
