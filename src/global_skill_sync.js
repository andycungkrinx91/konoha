'use strict';

/**
 * src/global_skill_sync.js — Ownership-Aware Rsync-Like Global Synchronization
 * and Targeted Diff-and-Patch Upgrade Engine across all 8 Supported AI Harnesses.
 *
 * Principles:
 * 1. Fresh Install (--ignore-existing for user files):
 *    - Copies missing Konoha-owned global skills, references, and SOUL.md into the
 *      official global locations of all 8 clients.
 *    - Never overwrites pre-existing user-created skills or files not recorded as
 *      Konoha-owned.
 * 2. Reinstall (Idempotent):
 *    - Verifies SHA-256 baseline hashes in ownership_manifest.json and skips
 *      unchanged files without duplicating entries.
 * 3. Upgrade / Update (Targeted Diff-and-Patch):
 *    - Compares installed Konoha-managed baseline hash against current file hash
 *      and incoming template hash.
 *    - Applies targeted line diff-and-patch updates when safe, creates a verified
 *      backup in ~/.konoha/backups/configs/, and preserves user modifications on conflict.
 */

const fs = require('fs');
const path = require('path');
const {
  getHomeDir,
  computeSha256,
  backupConfigFile,
  loadOwnershipManifest,
  saveOwnershipManifest
} = require('./config_backup_manager');
const { applyTargetedTextPatch } = require('./config_merger');
const { CANONICAL_SKILL_NAMES } = require('./canonical_skills');

const ALLOWED_SKILL_EXTS = new Set(['.md', '.yaml', '.yml', '.json', '.py', '.js']);

function getGlobalHarnessSkillTargets(homeDir) {
  const home = homeDir || getHomeDir();
  return [
    { client: 'global', skillsDir: path.join(home, '.agents', 'skills'), soulPath: path.join(home, '.agents', 'SOUL.md') },
    { client: 'antigravity', skillsDir: path.join(home, '.gemini', 'antigravity-cli', 'skills'), soulPath: path.join(home, '.gemini', 'SOUL.md') },
    { client: 'antigravity', skillsDir: path.join(home, '.gemini', 'skills'), soulPath: null },
    { client: 'cursor', skillsDir: path.join(home, '.cursor', 'skills'), soulPath: path.join(home, '.cursor', 'SOUL.md') },
    { client: 'claude', skillsDir: path.join(home, '.claude', 'skills'), soulPath: path.join(home, '.claude', 'SOUL.md') },
    { client: 'opencode', skillsDir: path.join(home, '.config', 'opencode', 'skills'), soulPath: path.join(home, '.config', 'opencode', 'SOUL.md') },
    { client: 'commandcode', skillsDir: path.join(home, '.commandcode', 'skills'), soulPath: path.join(home, '.commandcode', 'SOUL.md') },
    { client: 'codex', skillsDir: path.join(home, '.codex', 'skills'), soulPath: path.join(home, '.codex', 'SOUL.md') },
    { client: 'pi', skillsDir: path.join(home, '.pi', 'agent', 'skills'), soulPath: path.join(home, '.pi', 'SOUL.md') },
    { client: 'omp', skillsDir: path.join(home, '.omp', 'agent', 'skills'), soulPath: path.join(home, '.omp', 'SOUL.md') }
  ];
}

function resolveCanonicalTemplatesRoot(customRoot = null) {
  if (customRoot && fs.existsSync(customRoot)) return path.resolve(customRoot);
  const candidate = path.resolve(__dirname, 'templates', 'skills');
  if (fs.existsSync(candidate)) return candidate;
  const fallback = path.resolve(__dirname, '..', 'src', 'templates', 'skills');
  return fs.existsSync(fallback) ? fallback : candidate;
}

function collectCanonicalSkillFiles(templatesRoot) {
  const files = [];
  if (!fs.existsSync(templatesRoot)) return files;

  function walk(currDir) {
    let entries = [];
    try {
      entries = fs.readdirSync(currDir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(currDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!ALLOWED_SKILL_EXTS.has(ext)) continue;
        const relPath = path.relative(templatesRoot, fullPath).replace(/\\/g, '/');
        const topSkill = relPath.split('/')[0];
        if (!CANONICAL_SKILL_NAMES.has(topSkill)) continue;
        const content = fs.readFileSync(fullPath, 'utf8');
        files.push({
          relPath,
          topSkill,
          sourcePath: fullPath,
          content,
          sha256: computeSha256(content)
        });
      }
    }
  }

  walk(templatesRoot);
  return files;
}

function _isImplicitlyKonohaManagedSkillFile(destPath, sourceItem, existingRecord) {
  if (existingRecord && (existingRecord.created_by_konoha || existingRecord.konoha_baseline_sha256)) {
    return true;
  }
  if (!sourceItem || !CANONICAL_SKILL_NAMES.has(sourceItem.topSkill)) {
    return false;
  }
  try {
    const raw = fs.readFileSync(destPath, 'utf8');
    if (computeSha256(raw) === sourceItem.sha256) return true;
    return false;
  } catch (_) {
    return false;
  }
}

function _recordBackup(record, backupRes) {
  if (!backupRes || !backupRes.backupPath) return;
  record.latest_backup = backupRes.backupPath;
  if (!Array.isArray(record.backups)) record.backups = [];
  if (!record.backups.includes(backupRes.backupPath)) record.backups.push(backupRes.backupPath);
}

// A 3-way baseline is only valid if it is the exact content Konoha recorded as
// the baseline; a drifted backup would make the merge delete the wrong lines.
function _resolveMergeBaseline(existingRecord, currentContent, currentSha256) {
  if (!existingRecord) return { text: null, untrusted: false };
  const backupPath = existingRecord.latest_backup;
  if (backupPath && fs.existsSync(backupPath)) {
    try {
      const backupText = fs.readFileSync(backupPath, 'utf8');
      if (!existingRecord.konoha_baseline_sha256 || computeSha256(backupText) === existingRecord.konoha_baseline_sha256) {
        return { text: backupText, untrusted: false };
      }
      return { text: null, untrusted: true };
    } catch (_) {
      /* unreadable backup: fall through to the current-content check */
    }
  }
  if (existingRecord.konoha_baseline_sha256 === currentSha256) return { text: currentContent, untrusted: false };
  return { text: null, untrusted: false };
}

function syncSingleManagedResource(params, manifest, options = {}) {
  const { destPath, templateContent, templateSha256, meta } = params;
  const absDest = path.resolve(destPath);
  const existingRecord = manifest.files[absDest] || null;

  if (!fs.existsSync(absDest)) {
    fs.mkdirSync(path.dirname(absDest), { recursive: true });
    fs.writeFileSync(absDest, templateContent, 'utf8');
    manifest.files[absDest] = {
      client: meta.client,
      scope: 'global',
      created_by_konoha: true,
      konoha_baseline_sha256: templateSha256,
      latest_sha256: templateSha256,
      owned_keys: [],
      owned_sections: ['WHOLE_SKILL_RESOURCE'],
      backups: [],
      updated_at: new Date().toISOString()
    };
    return { action: 'installed', path: absDest, client: meta.client };
  }

  const currentContent = fs.readFileSync(absDest, 'utf8');
  const currentSha256 = computeSha256(currentContent);

  const isKonohaOwned = _isImplicitlyKonohaManagedSkillFile(absDest, meta, existingRecord);
  if (!isKonohaOwned) {
    return {
      action: 'skipped_existing_user_file',
      path: absDest,
      client: meta.client,
      reason: 'Pre-existing user-owned file not managed by Konoha (--ignore-existing)'
    };
  }

  if (currentSha256 === templateSha256) {
    manifest.files[absDest] = {
      ...existingRecord,
      client: meta.client,
      scope: 'global',
      created_by_konoha: existingRecord ? Boolean(existingRecord.created_by_konoha) : true,
      konoha_baseline_sha256: templateSha256,
      latest_sha256: templateSha256,
      owned_keys: (existingRecord && existingRecord.owned_keys) || [],
      owned_sections: (existingRecord && existingRecord.owned_sections) || ['WHOLE_SKILL_RESOURCE'],
      backups: (existingRecord && existingRecord.backups) || [],
      updated_at: new Date().toISOString()
    };
    return { action: 'unchanged', path: absDest, client: meta.client };
  }

  // Ownership beats line-indexing. When the deployed file still hashes to what
  // Konoha last wrote, no user edit exists; when the manifest records the whole
  // resource as Konoha-owned with no user keys, the user owns nothing either way.
  // Both cases let the template win wholesale; the line-indexed merge below is
  // only for files the user genuinely co-owns.
  const konohaOwnsWholeResource = Boolean(existingRecord) &&
    existingRecord.created_by_konoha === true &&
    Array.isArray(existingRecord.owned_keys) && existingRecord.owned_keys.length === 0 &&
    Array.isArray(existingRecord.owned_sections) &&
    existingRecord.owned_sections.includes('WHOLE_SKILL_RESOURCE');
  if (existingRecord && (existingRecord.latest_sha256 === currentSha256 || konohaOwnsWholeResource)) {
    const backupRes = backupConfigFile(absDest, { ...options, client: meta.client, scope: 'global' });
    fs.writeFileSync(absDest, templateContent, 'utf8');
    const refreshedRecord = manifest.files[absDest] || existingRecord || { backups: [] };
    _recordBackup(refreshedRecord, backupRes);
    refreshedRecord.client = meta.client;
    refreshedRecord.scope = 'global';
    refreshedRecord.created_by_konoha = true;
    refreshedRecord.konoha_baseline_sha256 = templateSha256;
    refreshedRecord.latest_sha256 = templateSha256;
    refreshedRecord.updated_at = new Date().toISOString();
    manifest.files[absDest] = refreshedRecord;
    return { action: 'patched', path: absDest, client: meta.client, hunksApplied: 0, wholesale: true };
  }

  const { text: baselineText, untrusted: baselineUntrusted } = _resolveMergeBaseline(existingRecord, currentContent, currentSha256);

  // No trustworthy baseline means the merge cannot tell a user edit from an
  // upgrade, so preserve the user's file instead of overwriting it.
  if (!baselineText && baselineUntrusted) {
    return {
      action: 'conflict_preserved',
      path: absDest,
      client: meta.client,
      reason: 'Recorded baseline backup no longer matches konoha_baseline_sha256; preserving user file untouched.'
    };
  }

  const patchResult = applyTargetedTextPatch(currentContent, baselineText, templateContent);
  if (patchResult.conflict) {
    return {
      action: 'conflict_preserved',
      path: absDest,
      client: meta.client,
      reason: patchResult.reason
    };
  }

  const backupRes = backupConfigFile(absDest, {
    ...options,
    client: meta.client,
    scope: 'global'
  });

  fs.writeFileSync(absDest, patchResult.content, 'utf8');
  const updatedSha = computeSha256(patchResult.content);
  const refreshedRecord = manifest.files[absDest] || existingRecord || { backups: [] };
  _recordBackup(refreshedRecord, backupRes);
  refreshedRecord.client = meta.client;
  refreshedRecord.scope = 'global';
  refreshedRecord.created_by_konoha = refreshedRecord.created_by_konoha !== false;
  refreshedRecord.konoha_baseline_sha256 = templateSha256;
  refreshedRecord.latest_sha256 = updatedSha;
  refreshedRecord.updated_at = new Date().toISOString();
  manifest.files[absDest] = refreshedRecord;

  return {
    action: 'patched',
    path: absDest,
    client: meta.client,
    hunksApplied: patchResult.hunksApplied
  };
}

/** True when an existing SOUL.md already carries the managed block markers. */
function _isBlockManagedSoul(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').includes('<!-- KONOHA-START -->');
  } catch (_) {
    return false;
  }
}

function _tallyAction(stats, res) {
  if (res.action === 'installed') stats.installed++;
  else if (res.action === 'patched') stats.patched++;
  else if (res.action === 'unchanged') stats.unchanged++;
  else if (res.action === 'skipped_existing_user_file') stats.skippedUserFiles++;
  else if (res.action === 'conflict_preserved') stats.conflicts.push(res);
}

function _syncSkillFiles(target, canonicalFiles, manifest, ctx) {
  for (const item of canonicalFiles) {
    const res = syncSingleManagedResource(
      {
        destPath: path.join(target.skillsDir, item.relPath),
        templateContent: item.content,
        templateSha256: item.sha256,
        meta: { client: target.client, topSkill: item.topSkill, sha256: item.sha256 }
      },
      manifest,
      ctx.options
    );
    _tallyAction(ctx.stats, res);
  }
}

/**
 * SOUL.md is block-managed by deploy_utils.syncSoulAcrossClients, which
 * preserves everything the user wrote outside the KONOHA-START/END markers.
 * Writing the plain template here would strip those markers and make the two
 * writers overwrite each other on every install.
 */
function _syncSoul(target, soul, manifest, ctx) {
  if (!target.soulPath || !soul.content) return;
  if (_isBlockManagedSoul(target.soulPath)) {
    ctx.stats.unchanged++;
    return;
  }
  const res = syncSingleManagedResource(
    {
      destPath: target.soulPath,
      templateContent: soul.content,
      templateSha256: soul.sha256,
      meta: { client: target.client, topSkill: 'konoha', sha256: soul.sha256 }
    },
    manifest,
    ctx.options
  );
  _tallyAction(ctx.stats, res);
}

function syncAllGlobalClientSkills(options = {}) {
  const home = getHomeDir(options);
  const templatesRoot = resolveCanonicalTemplatesRoot(options.templatesRoot);
  const canonicalFiles = collectCanonicalSkillFiles(templatesRoot);
  const targets = getGlobalHarnessSkillTargets(home);
  const manifest = loadOwnershipManifest({ ...options, home });

  const stats = {
    ok: true,
    home,
    templatesRoot,
    installed: 0,
    patched: 0,
    unchanged: 0,
    skippedUserFiles: 0,
    conflicts: [],
    clientsSynced: []
  };

  const requestedClients = Array.isArray(options.clients) && options.clients.length > 0 && !options.clients.includes('all')
    ? new Set(['global', ...options.clients])
    : null;

  const soulSrcPath = path.resolve(templatesRoot, '..', 'SOUL.md');
  const soulContent = fs.existsSync(soulSrcPath) ? fs.readFileSync(soulSrcPath, 'utf8') : null;
  const soul = { content: soulContent, sha256: soulContent ? computeSha256(soulContent) : null };
  const ctx = { stats, options: { ...options, home } };

  for (const target of targets) {
    if (requestedClients && !requestedClients.has(target.client)) continue;
    if (!stats.clientsSynced.includes(target.client)) stats.clientsSynced.push(target.client);
    _syncSkillFiles(target, canonicalFiles, manifest, ctx);
    _syncSoul(target, soul, manifest, ctx);
  }

  saveOwnershipManifest(manifest, { ...options, home });
  return stats;
}

module.exports = {
  getGlobalHarnessSkillTargets,
  resolveCanonicalTemplatesRoot,
  collectCanonicalSkillFiles,
  syncSingleManagedResource,
  syncAllGlobalClientSkills
};
