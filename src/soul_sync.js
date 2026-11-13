/**
 * SOUL.md sync, split out of deploy_utils.js to respect the 700-line cap.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { fileExists, ensureDir } = require('./platform_utils');
const { KONOHA_START_TAG, KONOHA_END_TAG } = require('./config_merger');
const { HOME } = require('../bin/lib/paths');

/**
 * Preserves the user's original file before Konoha overwrites it.
 *
 * The first backup wins: a later overwrite must not replace the copy of what
 * the user actually had before Konoha ever touched the file.
 */
function backupOnce(dest) {
  const backupPath = `${dest}.konoha-backup`;
  if (fileExists(backupPath)) return backupPath;
  try {
    fs.copyFileSync(dest, backupPath);
    return backupPath;
  } catch (_) {
    return null;
  }
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

/**
 * Writes Konoha's SOUL content as a managed block.
 *
 * A file with markers is updated in place, leaving everything the user wrote
 * outside the block untouched. A file without markers predates the block
 * format — Konoha owns it, but the user may have edited it — so the current
 * contents are preserved at `<dest>.konoha-backup` before replacement.
 *
 * @returns {'appended'|'updated'|'skipped'|'conflicted'}
 */
function _syncSingleSoulTarget(srcContent, target) {
  const wrapped = `${KONOHA_START_TAG}\n${srcContent.trim()}\n${KONOHA_END_TAG}`;
  ensureDir(path.dirname(target));

  if (!fileExists(target)) {
    fs.writeFileSync(target, `${wrapped}\n`, 'utf8');
    return 'appended';
  }

  let existing = '';
  try {
    existing = fs.readFileSync(target, 'utf8');
  } catch (_) {
    return 'skipped';
  }

  const startIdx = existing.indexOf(KONOHA_START_TAG);
  const endTagIdx = existing.indexOf(KONOHA_END_TAG);
  if (startIdx >= 0 && endTagIdx > startIdx) {
    const updated = existing.slice(0, startIdx) + wrapped + existing.slice(endTagIdx + KONOHA_END_TAG.length);
    if (updated === existing) return 'skipped';
    fs.writeFileSync(target, updated, 'utf8');
    return 'updated';
  }

  if (existing.trim() === srcContent.trim()) return 'skipped';

  backupOnce(target);
  fs.writeFileSync(target, `${wrapped}\n`, 'utf8');
  return 'conflicted';
}

/**
 * Synchronizes SOUL.md into every client home.
 *
 * @returns {{updated: number, appended: number, skipped: number, conflicts: string[]}}
 */
function syncSoulAcrossClients(options = {}) {
  const result = { updated: 0, appended: 0, skipped: 0, conflicts: [] };
  const src = resolveSoulSource();
  if (!src) return result;

  let srcContent;
  try {
    srcContent = fs.readFileSync(src, 'utf8');
  } catch (_) {
    return result;
  }

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

  for (const target of targets) {
    let outcome;
    try {
      outcome = _syncSingleSoulTarget(srcContent, target);
    } catch (_) {
      outcome = 'skipped';
    }
    if (outcome === 'conflicted') result.conflicts.push(target);
    result[outcome] += 1;
  }

  if (result.conflicts.length > 0 && options.silent !== true) {
    process.stderr.write(
      `! SOUL.md replaced in ${result.conflicts.length} client(s); originals kept as *.konoha-backup\n`
    );
  }
  return result;
}

module.exports = {
  backupOnce,
  resolveSoulSource,
  syncSoulAcrossClients
};