#!/usr/bin/env node
'use strict';

/**
 * tests/test_docs_index.js - Validates that docs/README.md is the complete live
 * index and that docs/archive/ stays out of the live tree.
 *
 * Five assertion groups:
 *   1. Every live file under docs/ (except docs/README.md and docs/archive/**)
 *      is linked from docs/README.md.
 *   2. Every file under docs/archive/** (except docs/archive/README.md) is named
 *      in docs/archive/README.md.
 *   3. docs/README.md never links into docs/archive/, and every link it declares
 *      resolves to an existing file.
 *   4. Topic keys and row targets in docs/README.md are unique.
 *   5. No live document (docs/** except archive and docs/README.md, plus the root
 *      README.md) links into docs/archive/.
 *
 * Run: node tests/test_docs_index.js
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DOC_DIR = path.join(ROOT_DIR, 'docs');
const ARCHIVE_DIR = path.join(DOC_DIR, 'archive');
const INDEX_FILE = path.join(DOC_DIR, 'README.md');
const ARCHIVE_INDEX_FILE = path.join(ARCHIVE_DIR, 'README.md');

const LINK_PATTERN = /!?\[[^\]]*\]\(([^)]+)\)/g;

function _rel(file) {
  return path.relative(ROOT_DIR, file).split(path.sep).join('/');
}

function _walk(dir, acc) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) _walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function _links(file) {
  const content = fs.readFileSync(file, 'utf-8');
  const out = [];
  let m;
  LINK_PATTERN.lastIndex = 0;
  while ((m = LINK_PATTERN.exec(content)) !== null) out.push(m[1].trim());
  return out;
}

function _resolve(fromDir, raw) {
  if (!raw || /^(?:https?:|mailto:|tel:|data:|#)/i.test(raw)) return null;
  const target = raw.split('#')[0].split('?')[0];
  if (!target) return null;
  return path.resolve(fromDir, target);
}

function _isInsideArchive(target) {
  const rel = path.relative(ARCHIVE_DIR, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function groupLiveCoverage(failures) {
  const indexTargets = new Set(
    _links(INDEX_FILE)
      .map((raw) => _resolve(DOC_DIR, raw))
      .filter(Boolean)
  );
  const live = _walk(DOC_DIR, []).filter(
    (f) => f !== INDEX_FILE && !_isInsideArchive(f)
  );
  const missing = live.filter((f) => !indexTargets.has(f)).map(_rel);
  failures.push(...missing.map((f) => `group 1: live file not linked from docs/README.md: ${f}`));
  return live.length;
}

function groupArchiveCoverage(failures) {
  if (!fs.existsSync(ARCHIVE_INDEX_FILE)) {
    failures.push('group 2: docs/archive/README.md is missing');
    return 0;
  }
  const text = fs.readFileSync(ARCHIVE_INDEX_FILE, 'utf-8');
  const archived = _walk(ARCHIVE_DIR, []).filter((f) => f !== ARCHIVE_INDEX_FILE);
  const unnamed = archived.filter((f) => !text.includes(path.basename(f))).map(_rel);
  failures.push(...unnamed.map((f) => `group 2: archived file not named in docs/archive/README.md: ${f}`));
  return archived.length;
}

function groupIndexLinks(failures) {
  const targets = _links(INDEX_FILE)
    .map((raw) => _resolve(DOC_DIR, raw))
    .filter(Boolean);
  for (const target of targets) {
    if (!fs.existsSync(target)) {
      failures.push(`group 3: docs/README.md links to a missing path: ${_rel(target)}`);
    } else if (_isInsideArchive(target) && target !== ARCHIVE_INDEX_FILE) {
      failures.push(`group 3: docs/README.md links to an archived file instead of the live document: ${_rel(target)}`);
    }
  }
  return targets.length;
}

function groupTopicKeys(failures) {
  const rows = fs
    .readFileSync(INDEX_FILE, 'utf-8')
    .split('\n')
    .filter((line) => /^\|\s*`[^`]+`\s*\|/.test(line));
  const keys = new Map();
  const targets = new Map();
  for (const row of rows) {
    const cells = row.split('|').map((c) => c.trim());
    const key = (row.match(/^\|\s*`([^`]+)`/) || [])[1];
    if (key) {
      if (keys.has(key)) failures.push(`group 4: duplicate topic key \`${key}\``);
      keys.set(key, true);
    }
    const raw = (cells.find((c) => /\]\(/.test(c)) || '').match(/\]\(([^)]+)\)/);
    const target = raw ? _resolve(DOC_DIR, raw[1]) : null;
    if (target) {
      const rel = _rel(target);
      if (targets.has(rel)) failures.push(`group 4: duplicate row target ${rel}`);
      targets.set(rel, true);
    }
  }
  if (rows.length === 0) failures.push('group 4: docs/README.md declares no topic rows');
  return rows.length;
}

function groupNoLiveArchiveLinks(failures) {
  const live = _walk(DOC_DIR, []).filter(
    (f) => f.endsWith('.md') && f !== INDEX_FILE && !_isInsideArchive(f)
  );
  live.push(path.join(ROOT_DIR, 'README.md'));
  for (const file of live) {
    if (!fs.existsSync(file)) continue;
    for (const raw of _links(file)) {
      const target = _resolve(path.dirname(file), raw);
      if (target && _isInsideArchive(target)) {
        failures.push(`group 5: live document links into the archive: ${_rel(file)} -> ${raw}`);
      }
    }
  }
  return live.length;
}

function run() {
  if (!fs.existsSync(INDEX_FILE)) {
    console.error('✗ docs/README.md is missing');
    process.exit(1);
  }

  const failures = [];
  const liveCount = groupLiveCoverage(failures);
  const archiveCount = groupArchiveCoverage(failures);
  const linkCount = groupIndexLinks(failures);
  const rowCount = groupTopicKeys(failures);
  const scannedCount = groupNoLiveArchiveLinks(failures);

  const groups = [
    ['1 live coverage', liveCount],
    ['2 archive coverage', archiveCount],
    ['3 index links', linkCount],
    ['4 topic keys', rowCount],
    ['5 no live archive links', scannedCount]
  ];
  for (const [label, count] of groups) {
    console.log(`${failures.some((f) => f.startsWith(`group ${label[0]}:`)) ? '✗' : '✓'} group ${label}: ${count} item(s) checked`);
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`✗ ${failure}`);
    process.exit(1);
  }

  console.log('✓ docs/README.md indexes every live document and docs/archive/ stays isolated.');
}

if (require.main === module) {
  run();
}

module.exports = { run };