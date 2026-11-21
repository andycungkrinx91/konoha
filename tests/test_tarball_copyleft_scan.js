#!/usr/bin/env node
'use strict';

/**
 * tests/test_tarball_copyleft_scan.js
 *
 * The published tarball is what Socket.dev and any other SPDX scanner reads, and
 * it is the only artefact that matters for the package's own licence. konoha-mcp
 * is Apache-2.0; when a copyleft identifier ships in its metadata, a scanner
 * attributes that licence to konoha-mcp itself rather than to the dependency it
 * describes. That is what moved the Socket license score 100 -> 90 -> 70.
 *
 * The scan cannot be a raw token match: jszip is legitimately dual-licensed
 * "(MIT OR GPL-3.0-or-later)" and Konoha redistributes it under MIT, so its
 * identifier appears in NOTICE, in its bundled manifest and in the patch that
 * pins it. An SPDX expression is permissive when at least one `OR` alternative is
 * entirely permissive, so this evaluates the expression instead of the token:
 *
 *   1. the packed root manifest must declare a permissive licence;
 *   2. every bundled dependency manifest must be permissive by that rule;
 *   3. a copyleft identifier may appear in NOTICE/README/LICENSE only on a line
 *      that offers it as a permissive alternative ("... OR ..." beside a
 *      permissive identifier), never as an imposed licence.
 *
 * Skips cleanly (exit 0) when the package manager cannot pack in this environment.
 */

const assert = require('assert');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const PERMISSIVE = new Set([
  'MIT', 'ISC', 'BSD-2-CLAUSE', 'BSD-3-CLAUSE', '0BSD', 'APACHE-2.0',
  'BLUEOAK-1.0.0', 'UNLICENSE', 'CC0-1.0', 'ZLIB', 'PYTHON-2.0', 'BSL-1.0'
]);

const COPYLEFT_TOKENS = [
  'AGPL-3.0', 'LGPL-3.0', 'LGPL-2.1', 'GPL-3.0', 'GPL-2.0',
  'MPL-2.0', 'SSPL-1.0', 'EUPL-1.2', 'OSL-3.0', 'CC-BY-SA'
];

function normalize(token) {
  return token.replace(/[()]/g, '').trim().toUpperCase();
}

// An SPDX expression is permissive when any `OR` alternative is entirely permissive.
function isPermissiveExpression(expr) {
  return String(expr)
    .toUpperCase()
    .split(/\s+OR\s+/)
    .some(alt => alt.split(/\s+AND\s+/).every(token => PERMISSIVE.has(normalize(token))));
}

function copyleftTokensIn(text) {
  const upper = String(text).toUpperCase();
  return COPYLEFT_TOKENS.filter(token => upper.includes(token));
}

function packTarball() {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-tarball-scan-'));
  try {
    execSync(`pnpm pack --pack-destination "${dest}"`, { cwd: ROOT, stdio: 'pipe', timeout: 300000 });
  } catch (err) {
    return { dest, tarball: null, error: err };
  }
  const tarball = fs.readdirSync(dest).find(name => name.endsWith('.tgz'));
  return { dest, tarball: tarball ? path.join(dest, tarball) : null };
}

const packed = packTarball();
if (!packed.tarball) {
  fs.rmSync(packed.dest, { recursive: true, force: true });
  console.log(`SKIP test_tarball_copyleft_scan: pnpm pack is unavailable here (${(packed.error && packed.error.message || '').split('\n')[0]})`);
  process.exit(0);
}

const extractDir = path.join(packed.dest, 'unpacked');
fs.mkdirSync(extractDir, { recursive: true });
execSync(`tar -xzf "${packed.tarball}" -C "${extractDir}"`, { stdio: 'pipe', timeout: 120000 });
const PKG = path.join(extractDir, 'package');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function testRootManifestIsPermissive() {
  const manifest = readJson(path.join(PKG, 'package.json'));
  assert.ok(manifest, 'the packed tarball has no readable package.json');
  assert.ok(manifest.license, 'the packed root manifest declares no license field');
  assert.ok(
    isPermissiveExpression(manifest.license),
    `the packed root manifest declares ${manifest.license}, which a scanner reads as konoha-mcp's own licence`
  );
  console.log(`  ok   packed root license: ${manifest.license}`);
}

function testBundledManifestsArePermissive() {
  const nodeModules = path.join(PKG, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    console.log('  ok   no bundled node_modules in the tarball');
    return;
  }
  const offenders = [];
  const walk = dir => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name !== 'package.json') continue;
      const manifest = readJson(full);
      if (!manifest || !manifest.license) continue;
      if (!isPermissiveExpression(manifest.license)) {
        offenders.push(`${path.relative(PKG, full)}: ${manifest.license}`);
      }
    }
  };
  walk(nodeModules);
  assert.deepStrictEqual(offenders, [], `bundled packages declare a copyleft-only licence: ${offenders.join(', ')}`);
  console.log('  ok   every bundled manifest is permissive by SPDX disjunction');
}

function testMetadataMentionsAreAlternativesOnly() {
  const metadataFiles = ['NOTICE', 'LICENSE', 'LICENSE.md', 'README.md', 'package.json']
    .map(name => path.join(PKG, name))
    .filter(file => fs.existsSync(file));

  const offenders = [];
  for (const file of metadataFiles) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const tokens = copyleftTokensIn(line);
      if (!tokens.length) return;
      // A copyleft identifier is harmless when the same line also states a
      // permissive licence and marks the two as alternatives — an SPDX `OR`, a
      // `dual-licensed` note, or a `MIT / GPL` pair. Anything else reads as an
      // imposed copyleft licence on konoha-mcp itself.
      const statesPermissive = line.split(/[\s(),;]+/)
        .some(word => PERMISSIVE.has(normalize(word)));
      const marksAlternative = /\bOR\b/i.test(line) || /\bdual\b/i.test(line) || /\s\/\s/.test(line);
      if (!(statesPermissive && marksAlternative)) {
        offenders.push(`${path.relative(PKG, file)}:${index + 1} (${tokens.join(', ')}) ${line.trim().slice(0, 100)}`);
      }
    });
  }
  assert.deepStrictEqual(
    offenders,
    [],
    `copyleft identifier shipped as an imposed licence:\n    ${offenders.join('\n    ')}`
  );
  console.log(`  ok   ${metadataFiles.length} metadata file(s) mention copyleft only as a permissive alternative`);
}

console.log('Running test_tarball_copyleft_scan: packed tarball licence posture...');
try {
  testRootManifestIsPermissive();
  testBundledManifestsArePermissive();
  testMetadataMentionsAreAlternativesOnly();
} finally {
  fs.rmSync(packed.dest, { recursive: true, force: true });
}
console.log('\nAll test_tarball_copyleft_scan checks passed successfully!');
