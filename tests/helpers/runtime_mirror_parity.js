#!/usr/bin/env node
'use strict';

/**
 * tests/helpers/runtime_mirror_parity.js
 *
 * Pure byte-parity checker for the ~/.konoha/src mirror.
 *
 * `compareMirror(repoSrcDir, mirrorSrcDir)` performs no writes and touches no
 * global state, so it can be pointed at throwaway fixtures (negative control)
 * as well as at the live runtime mirror.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** Recursively collect *.js files below `dir`, returned as sorted repo-relative paths. */
function listJsFiles(dir) {
  const out = [];
  const walk = (current, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full, relPath);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        out.push(relPath);
      }
    }
  };
  walk(dir, '');
  return out.sort();
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Compare every repo `*.js` file under repoSrcDir with its mirror counterpart.
 *
 * @returns {{
 *   ok: boolean,
 *   filesCompared: number,
 *   mismatches: Array<{path: string, reason: string, repoHash?: string, mirrorHash?: string}>,
 *   extraInMirror: string[],
 *   missingRoots: string[]
 * }}
 */
function compareMirror(repoSrcDir, mirrorSrcDir) {
  const missingRoots = [];
  if (!fs.existsSync(repoSrcDir)) missingRoots.push(repoSrcDir);
  if (!fs.existsSync(mirrorSrcDir)) missingRoots.push(mirrorSrcDir);
  if (missingRoots.length) {
    return { ok: false, filesCompared: 0, mismatches: [], extraInMirror: [], missingRoots };
  }

  const repoFiles = listJsFiles(repoSrcDir);
  const mirrorSet = new Set(listJsFiles(mirrorSrcDir));
  const mismatches = [];

  for (const rel of repoFiles) {
    const repoFile = path.join(repoSrcDir, ...rel.split('/'));
    const mirrorFile = path.join(mirrorSrcDir, ...rel.split('/'));
    if (!fs.existsSync(mirrorFile)) {
      mismatches.push({ path: rel, reason: 'missing-in-mirror', repoHash: sha256(repoFile) });
      continue;
    }
    const repoHash = sha256(repoFile);
    const mirrorHash = sha256(mirrorFile);
    if (repoHash !== mirrorHash) {
      mismatches.push({ path: rel, reason: 'content-mismatch', repoHash, mirrorHash });
    }
  }

  const repoSet = new Set(repoFiles);
  const extraInMirror = [...mirrorSet].filter((rel) => !repoSet.has(rel)).sort();

  return {
    ok: mismatches.length === 0,
    filesCompared: repoFiles.length,
    mismatches,
    extraInMirror,
    missingRoots
  };
}

module.exports = { compareMirror, listJsFiles };
