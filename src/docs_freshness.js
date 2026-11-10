'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Documentation drift report.
 *
 * The report compares what can be measured: the last write time of each shipped
 * markdown document against the moment the current release was cut (the
 * package.json write). A document written before that moment has not been
 * reviewed for this release and is reported as such. Nothing is inferred from
 * version strings inside prose, because those also match dependency and runtime
 * versions.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const HISTORICAL_PREFIXES = ['docs/archive/', 'docs/SecurityCompliance/', 'docs/architecture/TOKEN-BASELINE.md'];
const MAX_FILES = 400;

function _readPackage(root) {
  try {
    const file = path.join(root || REPO_ROOT, 'package.json');
    const stat = fs.statSync(file);
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      version: typeof pkg.version === 'string' ? pkg.version : null,
      cutAt: stat.mtime instanceof Date ? stat.mtime : null
    };
  } catch (_) {
    return { version: null, cutAt: null };
  }
}

function _isHistorical(relPath) {
  return HISTORICAL_PREFIXES.some((prefix) => relPath === prefix || relPath.startsWith(prefix));
}

function _collectMarkdown(dir, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const entry of entries) {
    if (acc.length >= MAX_FILES) return;
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      _collectMarkdown(full, acc);
    } else if (entry.name.endsWith('.md')) {
      acc.push(full);
    }
  }
}

function _classify(relPath, stat, cutAt) {
  if (_isHistorical(relPath)) {
    return { status: 'historical', reason: 'Archived record, exempt from release review.' };
  }
  if (!cutAt || !stat || !(stat.mtime instanceof Date)) {
    return { status: 'unknown', reason: 'Release cut time unavailable, so drift cannot be measured.' };
  }
  if (stat.mtime.getTime() < cutAt.getTime()) {
    return {
      status: 'review_pending',
      reason: 'Last modified before the current release was cut; not yet reviewed for this release.'
    };
  }
  return { status: 'current', reason: 'Modified during the current release cycle.' };
}

/**
 * Build the drift report for every shipped markdown document.
 *
 * @param {{ rootDir?: string }} [options]
 * @returns {{ version: string|null, cutAt: string|null, checkedAt: string, total: number, counts: object, docs: Array }}
 */
function collectDocsDrift(options = {}) {
  const root = options.rootDir || REPO_ROOT;
  const pkg = _readPackage(root);
  const files = [];
  const readme = path.join(root, 'README.md');
  if (fs.existsSync(readme)) files.push(readme);
  _collectMarkdown(path.join(root, 'docs'), files);

  const docs = files.slice(0, MAX_FILES).map((file) => {
    let stat = null;
    try {
      stat = fs.statSync(file);
    } catch (_) {
      stat = null;
    }
    const relPath = path.relative(root, file).split(path.sep).join('/');
    const verdict = _classify(relPath, stat, pkg.cutAt);
    return {
      file: relPath,
      bytes: stat ? stat.size : null,
      modifiedAt: stat ? stat.mtime.toISOString() : null,
      status: verdict.status,
      reason: verdict.reason
    };
  });

  const counts = { current: 0, review_pending: 0, historical: 0, unknown: 0 };
  for (const doc of docs) counts[doc.status] += 1;

  return {
    version: pkg.version,
    cutAt: pkg.cutAt ? pkg.cutAt.toISOString() : null,
    checkedAt: new Date().toISOString(),
    total: docs.length,
    counts,
    docs
  };
}

module.exports = { REPO_ROOT, MAX_FILES, collectDocsDrift };
