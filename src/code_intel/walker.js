'use strict';

/**
 * Filesystem walker for the code index.
 *
 * Read-only by construction: it opens files for reading and never writes,
 * creates, or renames anything inside an analyzed repository.
 */

const fs = require('fs');
const path = require('path');
const {
  MAX_FILE_BYTES,
  MAX_FILES_PER_ROOT,
  isExcludedDir,
  isExcludedFile
} = require('./config');
const { detectLanguage } = require('./parser');

function _gitignorePatterns(root) {
  const file = path.join(root, '.gitignore');
  try {
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'))
      .map((l) => l.replace(/^\/+/, '').replace(/\/+$/, ''));
  } catch (_) {
    return [];
  }
}

function _ignored(relPath, patterns) {
  for (const p of patterns) {
    if (!p) continue;
    if (relPath === p || relPath.startsWith(`${p}/`)) return true;
    if (!p.includes('/') && relPath.split('/').includes(p)) return true;
  }
  return false;
}

/**
 * Classifies one directory entry: descend, skip, or index.
 *
 * @returns {{dir?: boolean, skip?: string, file?: object}}
 */
function _consider(entry, relPath, ctx) {
  if (entry.isSymbolicLink()) return { skip: 'symlink' };
  if (entry.isDirectory()) {
    if (isExcludedDir(entry.name) || _ignored(relPath, ctx.patterns)) return {};
    return { dir: true };
  }
  if (!entry.isFile()) return {};
  if (isExcludedFile(entry.name) || _ignored(relPath, ctx.patterns)) return {};

  const language = detectLanguage(entry.name);
  if (!language) return {};

  const absPath = path.join(ctx.root, relPath);
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch (err) {
    return { skip: `stat failed: ${err.code || err.message}` };
  }
  if (stat.size > ctx.maxFileBytes) return { skip: `too large: ${stat.size} bytes` };

  return { file: { relPath, absPath, language, byteSize: stat.size } };
}

/** Reads one directory, recording an unreadable one instead of throwing. */
function _readDir(root, relDir, acc) {
  const absDir = relDir ? path.join(root, relDir) : root;
  try {
    return fs.readdirSync(absDir, { withFileTypes: true });
  } catch (err) {
    acc.skipped.push({ relPath: relDir || '.', reason: `unreadable directory: ${err.code || err.message}` });
    return null;
  }
}

/** Classifies each entry in one directory and fills the walk accumulators. */
function _scanEntries(entries, relDir, ctx, acc) {
  for (const entry of entries) {
    if (acc.files.length >= ctx.maxFiles) return;
    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
    const outcome = _consider(entry, relPath, ctx);
    if (outcome.dir) acc.stack.push(relPath);
    if (outcome.skip) acc.skipped.push({ relPath, reason: outcome.skip });
    if (outcome.file) acc.files.push(outcome.file);
  }
}

/**
 * Collects indexable files under `root`.
 *
 * `skipped` records why a path was left out, so callers can report
 * under-indexing instead of silently returning a short list.
 */
function walk(root, options = {}) {
  const ctx = {
    root,
    patterns: options.respectGitignore === false ? [] : _gitignorePatterns(root),
    maxFileBytes: options.maxFileBytes || MAX_FILE_BYTES,
    maxFiles: options.maxFiles || MAX_FILES_PER_ROOT
  };
  const acc = { files: [], skipped: [], stack: [''] };

  while (acc.stack.length > 0 && acc.files.length < ctx.maxFiles) {
    const relDir = acc.stack.pop();
    const entries = _readDir(root, relDir, acc);
    if (entries) _scanEntries(entries, relDir, ctx, acc);
  }

  if (acc.files.length >= ctx.maxFiles) {
    acc.skipped.push({ relPath: '.', reason: `file cap reached (${ctx.maxFiles})` });
  }

  acc.files.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  return { files: acc.files, skipped: acc.skipped };
}

module.exports = { walk };
