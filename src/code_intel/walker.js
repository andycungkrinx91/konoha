'use strict';

/**
 * Filesystem walker for the code index.
 *
 * Read-only by construction: supports nested `.gitignore` and `.konohaignore`
 * pathspec matching with `!` negations, single-`lstat` metadata collection,
 * symlink protection, and secret file exclusion.
 */

const fs = require('fs');
const path = require('path');
const {
  MAX_FILE_BYTES,
  MAX_FILES_PER_ROOT,
  isExcludedDir,
  isExcludedFile
} = require('./config');
const { detectLanguage, detectContentKind } = require('./parser');

function _globToRegExp(pattern, anchored) {
  let re = anchored ? '^' : '(?:^|/)';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 3;
      } else {
        re += '.*';
        i += 2;
      }
      continue;
    }
    if (ch === '*') { re += '[^/]*'; i++; continue; }
    if (ch === '?') { re += '[^/]'; i++; continue; }
    if ('\\^$.|+()[]{}'.includes(ch)) re += `\\${ch}`;
    else re += ch;
    i++;
  }
  re += '(?:/.*)?$';
  return new RegExp(re);
}

function _parseIgnoreFile(filePath, baseRelDir) {
  let content = '';
  try {
    if (!fs.existsSync(filePath)) return [];
    content = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return [];
  }
  const rules = [];
  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/\r$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const negated = line.startsWith('!');
    const rawPat = negated ? line.slice(1).trim() : line;
    if (!rawPat) continue;
    const dirOnly = rawPat.endsWith('/');
    const stripped = rawPat.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!stripped) continue;
    const hasSlash = rawPat.startsWith('/') || stripped.includes('/');
    const scoped = baseRelDir ? `${baseRelDir}/${stripped}` : stripped;
    rules.push({
      negated,
      dirOnly,
      baseRelDir,
      exactName: !hasSlash && !/[*?]/.test(stripped) ? stripped : null,
      regex: _globToRegExp(scoped, Boolean(baseRelDir) || hasSlash)
    });
  }
  return rules;
}

function _ruleMatches(rule, relPath, isDir) {
  if (rule.dirOnly && !isDir) return false;
  if (rule.baseRelDir && !relPath.startsWith(`${rule.baseRelDir}/`)) return false;
  if (rule.exactName) {
    const sub = rule.baseRelDir ? relPath.slice(rule.baseRelDir.length + 1) : relPath;
    return sub.split('/').includes(rule.exactName);
  }
  return rule.regex.test(relPath);
}

function _isIgnored(relPath, isDir, rules) {
  let ignored = false;
  for (const rule of rules) {
    if (_ruleMatches(rule, relPath, isDir)) {
      ignored = !rule.negated;
    }
  }
  return ignored;
}

function _collectDirRules(absDir, relDir, parentRules, respectGitignore) {
  if (!respectGitignore) return parentRules;
  const local = [
    ..._parseIgnoreFile(path.join(absDir, '.gitignore'), relDir),
    ..._parseIgnoreFile(path.join(absDir, '.konohaignore'), relDir)
  ];
  return local.length > 0 ? [...parentRules, ...local] : parentRules;
}

function _buildFileEntry(relPath, absPath, language, stat) {
  return {
    file: {
      relPath,
      absPath,
      language,
      contentKind: detectContentKind(relPath, language),
      byteSize: stat.size,
      mtimeMs: Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0,
      ctimeMs: Number.isFinite(stat.ctimeMs) ? stat.ctimeMs : 0,
      inodeId: `${stat.dev || 0}:${stat.ino || 0}`
    }
  };
}

function _mapLstatResult(entry, relPath, absPath, rules, ctx, stat, err) {
  if (err) {
    const code = err && err.code;
    if (code === 'ENOENT') return { skip: `transient enoent: ${code}` };
    if (code === 'EACCES' || code === 'EPERM') return { skip: `unreadable file: ${code}` };
    return { skip: `stat failed: ${code || err.message}` };
  }
  if (stat.isSymbolicLink()) return { skip: 'symlink' };
  if (stat.size > ctx.maxFileBytes) return { skip: `too large: ${stat.size} bytes` };
  return _buildFileEntry(relPath, absPath, detectLanguage(entry.name), stat);
}

function _precheckEntry(entry, relPath, rules) {
  if (entry.isSymbolicLink()) return { done: { skip: 'symlink' } };
  if (entry.isDirectory()) {
    if (isExcludedDir(entry.name) || _isIgnored(relPath, true, rules)) return { done: {} };
    return { done: { dir: true } };
  }
  if (!entry.isFile()) return { done: {} };
  if (isExcludedFile(entry.name) || _isIgnored(relPath, false, rules)) return { done: {} };
  if (!detectLanguage(entry.name)) return { done: {} };
  return { done: null };
}

function _considerEntry(entry, relPath, rules, ctx) {
  const pre = _precheckEntry(entry, relPath, rules);
  if (pre.done !== null) return pre.done;
  const absPath = path.join(ctx.root, relPath);
  try {
    return _mapLstatResult(entry, relPath, absPath, rules, ctx, fs.lstatSync(absPath), null);
  } catch (err) {
    return _mapLstatResult(entry, relPath, absPath, rules, ctx, null, err);
  }
}

async function _considerEntryAsync(entry, relPath, rules, ctx) {
  const pre = _precheckEntry(entry, relPath, rules);
  if (pre.done !== null) return pre.done;
  const absPath = path.join(ctx.root, relPath);
  try {
    const stat = await fs.promises.lstat(absPath);
    return _mapLstatResult(entry, relPath, absPath, rules, ctx, stat, null);
  } catch (err) {
    return _mapLstatResult(entry, relPath, absPath, rules, ctx, null, err);
  }
}

function _recordOutcome(outcome, relPath, rules, acc) {
  if (outcome.dir) acc.stack.push({ relDir: relPath, rules });
  if (outcome.skip) acc.skipped.push({ relPath, reason: outcome.skip });
  if (outcome.file) acc.files.push(outcome.file);
}

function _readDir(root, relDir, acc) {
  const absDir = relDir ? path.join(root, relDir) : root;
  try {
    return fs.readdirSync(absDir, { withFileTypes: true });
  } catch (err) {
    acc.skipped.push({ relPath: relDir || '.', reason: `unreadable directory: ${err.code || err.message}` });
    return null;
  }
}

async function _readDirAsync(root, relDir, acc) {
  const absDir = relDir ? path.join(root, relDir) : root;
  try {
    return await fs.promises.readdir(absDir, { withFileTypes: true });
  } catch (err) {
    acc.skipped.push({ relPath: relDir || '.', reason: `unreadable directory: ${err.code || err.message}` });
    return null;
  }
}

function _finalizeWalk(acc, maxFiles) {
  if (acc.files.length >= maxFiles) {
    acc.skipped.push({ relPath: '.', reason: `file cap reached (${maxFiles})` });
  }
  acc.files.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  return { files: acc.files, skipped: acc.skipped };
}

function _createWalkState(root, options) {
  return {
    respectGitignore: options.respectGitignore !== false,
    ctx: {
      root,
      maxFileBytes: options.maxFileBytes || MAX_FILE_BYTES,
      maxFiles: options.maxFiles || MAX_FILES_PER_ROOT
    },
    acc: {
      files: [],
      skipped: [],
      stack: [{ relDir: '', rules: [] }]
    }
  };
}

/**
 * Collects indexable files under `root`.
 *
 * `skipped` records excluded symlinks, unreadable dirs, oversized files, and
 * cap truncations so callers can report under-indexing accurately.
 */
function walk(root, options = {}) {
  const { respectGitignore, ctx, acc } = _createWalkState(root, options);

  while (acc.stack.length > 0 && acc.files.length < ctx.maxFiles) {
    const frame = acc.stack.pop();
    const absDir = frame.relDir ? path.join(root, frame.relDir) : root;
    const rules = _collectDirRules(absDir, frame.relDir, frame.rules, respectGitignore);
    const entries = _readDir(root, frame.relDir, acc);
    if (!entries) continue;

    for (const entry of entries) {
      if (acc.files.length >= ctx.maxFiles) break;
      const relPath = frame.relDir ? `${frame.relDir}/${entry.name}` : entry.name;
      _recordOutcome(_considerEntry(entry, relPath, rules, ctx), relPath, rules, acc);
    }
  }

  return _finalizeWalk(acc, ctx.maxFiles);
}

/**
 * Asynchronous counterpart to `walk` that uses non-blocking directory/stat calls
 * and yields periodically to the event loop across large trees.
 */
async function walkAsync(root, options = {}) {
  const { respectGitignore, ctx, acc } = _createWalkState(root, options);
  let lastYieldMs = Date.now();
  let dirsVisited = 0;

  while (acc.stack.length > 0 && acc.files.length < ctx.maxFiles) {
    const frame = acc.stack.pop();
    const absDir = frame.relDir ? path.join(root, frame.relDir) : root;
    const rules = _collectDirRules(absDir, frame.relDir, frame.rules, respectGitignore);
    const entries = await _readDirAsync(root, frame.relDir, acc);
    if (!entries) continue;

    for (let idx = 0; idx < entries.length; idx++) {
      if (acc.files.length >= ctx.maxFiles) break;
      const entry = entries[idx];
      const relPath = frame.relDir ? `${frame.relDir}/${entry.name}` : entry.name;
      const outcome = await _considerEntryAsync(entry, relPath, rules, ctx);
      _recordOutcome(outcome, relPath, rules, acc);
      if ((idx + 1) % 32 === 0 || Date.now() - lastYieldMs >= 8) {
        await new Promise((resolve) => setImmediate(resolve));
        lastYieldMs = Date.now();
      }
    }

    dirsVisited += 1;
    if (dirsVisited % 16 === 0 || Date.now() - lastYieldMs >= 8) {
      await new Promise((resolve) => setImmediate(resolve));
      lastYieldMs = Date.now();
    }
  }

  return _finalizeWalk(acc, ctx.maxFiles);
}

module.exports = { walk, walkAsync };
