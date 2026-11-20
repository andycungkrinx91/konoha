'use strict';

/**
 * scripts/lib/version_claims.js — discovery of active release-version claims.
 *
 * `bump_version.js` owns the *managed* files: the exact places a bump rewrites.
 * This module answers a different question — which files anywhere in the tree
 * assert the current release, including ones nobody added to that manifest. A
 * stale claim is a documentation bug even when no bump touched it.
 *
 * Discovery is by shape, so a new doc that says "**Version of record: 2.2.25**"
 * is covered the day it lands, without editing a list here.
 *
 * Only release-identity shapes count. Incidental semver in prose or third-party
 * examples (plugin manifests, `"version": "1.0.0"` in a skill reference) is not
 * a claim about Konoha and is deliberately unmatched.
 *
 * Excluded by rule:
 *   - historical records: CHANGELOG.md, docs/archive/**, docs/security/**,
 *     docs/SecurityCompliance/**, dated artifacts (`*2026-11-09*`)
 *   - plans and scratch material: .omp/**, tests/**, dist/**, .agents/dev-skills/**
 *   - third-party examples: src/templates/skills/**\/references/**,
 *     .agents/plugins/**
 */

const fs = require('fs');
const path = require('path');

// Relative paths in this module are POSIX-style on every host: they are repo
// paths, not filesystem paths, and a claim list must be identical whether it is
// produced on Linux or Windows. `path.join` would emit backslashes on Windows
// and make the same tree yield two different path spellings; `path.join` is
// still used where a path is handed to fs, which accepts `/` on Windows.
const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '.omp', 'dist', 'coverage', 'tests',
  'docs/archive', 'docs/security', 'docs/SecurityCompliance',
  '.agents/dev-skills', '.agents/plugins',
  'apps/web/build'
]);

const EXCLUDED_FILE = /^(CHANGELOG\.md|package-lock\.json|pnpm-lock\.yaml)$/;
const DATED_ARTIFACT = /\d{4}-\d{2}-\d{2}/;
const SCANNED_EXT = new Set(['.md', '.json', '.js', '.svelte', '.yml', '.yaml']);

/** Vendored skill material for other personas, not Konoha's own release claims. */
function isThirdPartyReference(relPath) {
  const parts = relPath.split('/');
  const refs = parts.indexOf('references');
  if (refs === -1 || parts[refs - 1] === 'konoha') return false;
  return parts.includes('skills');
}

/** The web app's agent mirrors are generated locally and gitignored. */
function isGeneratedMirror(relPath) {
  return relPath.startsWith('apps/web/')
    && /^(AGENTS|CLAUDE|GEMINI)\.md$/.test(path.basename(relPath));
}

/**
 * Release-identity shapes. Each captures the version it claims. Every pattern is
 * Konoha-specific wording, so a match is a claim by construction.
 */
const CLAIM_PATTERNS = [
  { label: 'release badge', re: /\bRelease-v(\d+\.\d+\.\d+)\b/g },
  { label: 'release badge alt', re: /\balt="Release v(\d+\.\d+\.\d+)"/g },
  { label: 'security badge', re: /\bSecurity-v(\d+\.\d+\.\d+)(?:%20|\s)?Controls\b/g },
  { label: 'release banner', re: /\bRELEASE v(\d+\.\d+\.\d+)\b/g },
  { label: 'version of record', re: /\*\*Version of record: (\d+\.\d+\.\d+)\*\*/g },
  { label: 'contract header', re: /## Konoha runtime contract \((\d+\.\d+\.\d+)\)/g },
  { label: 'contract constant', re: /CONTRACT_VERSION = '(\d+\.\d+\.\d+)'/g },
  { label: 'client intro', re: /Konoha \*\*v(\d+\.\d+\.\d+)\*\*/g },
  { label: 'integration intro', re: /\*\*Konoha MCP Version:\*\* v(\d+\.\d+\.\d+)/g },
  { label: 'konoha doc intro', re: /\(Konoha v(\d+\.\d+\.\d+)\)/g },
  { label: 'doc intro', re: /\(version (\d+\.\d+\.\d+)\)/g, only: /^docs[\\/]BENCHMARK\.md$/ },
  { label: 'verification matrix', re: /Authoritative verification matrix for Konoha MCP Tools Orchestrator \(v(\d+\.\d+\.\d+)\)/g },
  { label: 'version row', re: /\| Displays `(\d+\.\d+\.\d+)`, queries npm registry/g },
  { label: 'index row mapping', re: /Capability to file to tool mapping for v(\d+\.\d+\.\d+)/g },
  { label: 'index row security', re: /\| v(\d+\.\d+\.\d+) ingress, auth/g },
  { label: 'svelte layout version', re: /\bversion: '(\d+\.\d+\.\d+)'/g, only: /^apps[\\/]web[\\/]src[\\/]routes[\\/]\+layout\.svelte$/ },
  { label: 'build meta version', re: /"version":\s*"(\d+\.\d+\.\d+)"/g, only: /^apps[\\/]web[\\/]build[\\/]build-meta\.json$/ },
  { label: 'document title', re: /^#\s.*\(v(\d+\.\d+\.\d+)\)[ \t]*$/gm, only: /^(docs|src[\\/]templates|\.agents[\\/]skills)[\\/]/ }
];

/** The heading a claim sits under, used to drop historical sections. */
function enclosingHeading(lines, lineIndex) {
  for (let i = lineIndex - 1; i >= 0; i--) {
    if (/^#{1,3}\s/.test(lines[i])) return lines[i];
  }
  return '';
}

function isHistoricalHeading(heading) {
  return /historical|archive|changelog/i.test(heading);
}

function isScanned(name) {
  return SCANNED_EXT.has(path.extname(name));
}

function isExcluded(relPath) {
  const base = path.basename(relPath);
  if (EXCLUDED_FILE.test(base) || DATED_ARTIFACT.test(base)) return true;
  if (isThirdPartyReference(relPath) || isGeneratedMirror(relPath)) return true;
  for (const dir of EXCLUDED_DIRS) {
    if (relPath === dir || relPath.startsWith(`${dir}/`)) return true;
  }
  return false;
}

function patternsFor(relPath) {
  return CLAIM_PATTERNS.filter((p) => !p.only || p.only.test(relPath));
}

function claimsInFile(rootDir, relPath) {
  const content = fs.readFileSync(path.join(rootDir, relPath), 'utf8');
  if (!/\d+\.\d+\.\d+/.test(content)) return [];
  const lines = content.split('\n');
  const claims = [];
  for (const pattern of patternsFor(relPath)) {
    for (const match of content.matchAll(pattern.re)) {
      const lineStart = content.lastIndexOf('\n', match.index) + 1;
      const line = content.slice(0, match.index).split('\n').length;
      const heading = enclosingHeading(lines, line - 1);
      if (isHistoricalHeading(heading)) continue;
      claims.push({
        version: match[1],
        line,
        column: match.index - lineStart,
        match: match[0],
        label: pattern.label,
        text: lines[line - 1].trim().slice(0, 160)
      });
    }
  }
  return claims;
}

function walk(rootDir, dir, out) {
  for (const entry of fs.readdirSync(path.join(rootDir, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (isExcluded(rel)) continue;
      walk(rootDir, rel, out);
    } else if (entry.isFile() && isScanned(entry.name) && !isExcluded(rel)) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * Every active version claim under `rootDir`, with the version it asserts.
 * @returns {Array<{path: string, version: string, line: number, label: string, text: string}>}
 */
function discoverVersionClaims(options = {}) {
  const rootDir = options.rootDir || path.resolve(__dirname, '..', '..');
  const claims = [];
  for (const rel of walk(rootDir, '', []).sort()) {
    for (const claim of claimsInFile(rootDir, rel)) claims.push({ path: rel, ...claim });
  }
  return claims;
}

/** Claims that disagree with `currentVersion`. */
function claimDrift(currentVersion, options = {}) {
  return discoverVersionClaims(options).filter((c) => c.version !== currentVersion);
}

/**
 * Rewrite every claim that asserts `fromVersion` so it asserts `toVersion`.
 * Works from the discovered match offset, so only the version inside a claim is
 * touched: historical mentions and unrelated semver stay byte-identical.
 *
 * @returns {string[]} files written
 */
function rewriteStaleClaims(fromVersion, toVersion, options = {}) {
  const rootDir = options.rootDir || path.resolve(__dirname, '..', '..');
  const stale = discoverVersionClaims({ rootDir }).filter((c) => c.version === fromVersion);
  const byFile = new Map();
  for (const claim of stale) {
    if (!byFile.has(claim.path)) byFile.set(claim.path, []);
    byFile.get(claim.path).push(claim);
  }
  const written = [];
  for (const [rel, claims] of byFile) {
    const full = path.join(rootDir, rel);
    const content = fs.readFileSync(full, 'utf8');
    const lines = content.split('\n');
    // Right-to-left within a line so earlier offsets stay valid.
    for (const claim of claims.sort((a, b) => b.line - a.line || b.column - a.column)) {
      const index = claim.line - 1;
      const line = lines[index];
      // A pattern may span the trailing newline; compare against the line only.
      const matched = claim.match.replace(/\n$/, '');
      if (line.slice(claim.column, claim.column + matched.length) !== matched) continue;
      const rewritten = matched.replace(fromVersion, toVersion);
      lines[index] = line.slice(0, claim.column) + rewritten + line.slice(claim.column + matched.length);
    }
    fs.writeFileSync(full, lines.join('\n'), 'utf8');
    written.push(rel);
  }
  return written;
}

module.exports = { discoverVersionClaims, claimDrift, rewriteStaleClaims, CLAIM_PATTERNS, EXCLUDED_DIRS };
