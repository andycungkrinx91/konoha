/**
 * Regex grep with a hard cap of 20 compressed matches.
 * Pure Node.js in-process implementation.
 */

const fs = require('fs');
const path = require('path');
const common = require('./common');

const DEFAULT_MAX_MATCHES = 20;
const HARD_MAX_MATCHES = 50;
const MATCH_TRIM = 120;

const GLOB_SPECIAL = new Set(['\\', '.', '+', '^', '$', '(', ')', '{', '}', '|', '[', ']']);

// `**/` means zero or more directories, so `dir/**/*.js` must match `dir/a.js`
// as well as `dir/sub/a.js`. Compiling it to `.*/` would require at least one
// separator and silently match nothing one level deep.
function globToken(pattern, i) {
  const c = pattern[i];
  if (c === '*' && pattern[i + 1] === '*') {
    return pattern[i + 2] === '/' ? ['(?:.*/)?', i + 3] : ['.*', i + 2];
  }
  if (c === '*') return ['[^/\\\\]*', i + 1];
  if (c === '?') return ['[^/\\\\]', i + 1];
  if (GLOB_SPECIAL.has(c)) return ['\\' + c, i + 1];
  return [c, i + 1];
}

function globSource(pattern) {
  let out = '^';
  let i = 0;
  while (i < pattern.length) {
    const [fragment, next] = globToken(pattern, i);
    out += fragment;
    i = next;
  }
  return out + '$';
}

function matchGlob(name, pattern) {
  if (!pattern || pattern === '*' || pattern === '**') return true;
  const re = new RegExp(globSource(pattern), 'i');
  return re.test(name) || re.test(name.replace(/\\/g, '/'));
}

function _grepFileLines(filePath, rootDir, regex, matches, maxMatches) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 1024 * 1024) return false;
    const content = fs.readFileSync(filePath, 'utf8');
    if (!regex.test(content)) return false;

    const rel = path.relative(rootDir, filePath).replace(/\\/g, '/');
    const lines = content.split(/\r?\n/);
    for (let lineNo = 1; lineNo <= lines.length; lineNo++) {
      const line = lines[lineNo - 1];
      if (!regex.test(line)) continue;
      let snippet = line.trim();
      if (snippet.length > MATCH_TRIM) {
        snippet = snippet.substring(0, MATCH_TRIM) + '…';
      }
      matches.push(`[${rel}:${lineNo}] ${snippet}`);
      if (matches.length >= maxMatches) return true;
    }
  } catch (_) { /* intentional best-effort fallback */ }
  return false;
}

function _matchesGlobFilter(filePath, name, rootDir, globPattern, hasPathGlob) {
  if (!globPattern) return true;
  if (!hasPathGlob) return matchGlob(name, globPattern);
  // Callers on Windows write `dir\\**\\*.js`; the relative path is built with
  // forward slashes, so the pattern has to be normalized the same way or it can
  // never match on the platform that produced it.
  const normalizedGlob = globPattern.replace(/\\/g, '/');
  const rel = path.relative(rootDir, filePath).replace(/\\/g, '/');
  return matchGlob(name, normalizedGlob) || matchGlob(rel, normalizedGlob);
}

function tokenEfficientGrep(args = {}) {
  const pattern = args.pattern || args.Pattern || args.query || args.Query;
  if (!pattern) {
    throw new Error('pattern is required');
  }

  const dirPath = args.dir || args.path || args.file_path || args.directory || args.dir_path || args.DirectoryPath || '.';
  const rootDir = common.resolvePath(dirPath, args.workspace, args.dev_root);

  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    throw new Error(`Directory not found: ${rootDir}`);
  }

  let maxMatches = parseInt(args.max_matches || args.maxMatches || DEFAULT_MAX_MATCHES, 10);
  if (isNaN(maxMatches) || maxMatches < 1) {
    throw new Error('max_matches must be >= 1');
  }
  if (maxMatches > HARD_MAX_MATCHES) {
    throw new Error(`max_matches cap is ${HARD_MAX_MATCHES}`);
  }

  const globPattern = args.glob || args.file_glob || args.Glob;
  const ignoreCase = Boolean(args.ignore_case || args.ignoreCase);

  // A pattern that matches every character of every file turns a bounded grep
  // into a dump of the whole tree. Reject it for directory-wide searches only:
  // a narrowing glob already bounds the result set.
  if (!globPattern && isMatchEverythingPattern(pattern)) {
    throw new Error(
      'Pattern matches the whole document ("(?s).", "^", "[\\s\\S]*"). ' +
      'Use a specific term, or pass a glob to narrow the search.'
    );
  }

  const flags = ignoreCase ? 'im' : 'm';
  let regex;
  try {
    regex = new RegExp(pattern, flags);
  } catch (exc) {
    throw new Error(`Invalid regex pattern: ${exc.message}`);
  }

  const matches = [];
  let truncated = false;
  const hasPathGlob = Boolean(globPattern && (globPattern.includes('/') || globPattern.includes('\\')));
  let totalMatches = 0;

  for (const filePath of common.walkFiles(rootDir)) {
    if (!common.isProbablyText(filePath)) continue;

    const name = path.basename(filePath);
    if (!_matchesGlobFilter(filePath, name, rootDir, globPattern, hasPathGlob)) {
      continue;
    }

    const hit = _grepFileLines(filePath, rootDir, regex, matches, maxMatches);
    if (hit) truncated = true;
  }

  totalMatches = truncated ? _countAllMatches(rootDir, regex, globPattern, hasPathGlob) : matches.length;

  const lines = matches.slice(0, maxMatches);
  if (truncated) {
    const shown = lines.length;
    const known = totalMatches > shown ? String(totalMatches) : `${shown}+`;
    lines.push(`Showing ${shown} of ${known} matches. Refine: add a term or path filter.`);
  }

  return {
    dir: rootDir,
    pattern,
    count: lines.length,
    matches: lines,
    text: lines.join('\n')
  };
}

const MAX_COUNTED_MATCHES = 100000;

// Second pass used only when output was truncated: report how many matches
// actually exist. Bounded by MAX_COUNTED_MATCHES so a runaway pattern cannot
// stall the request.
function _countAllMatches(rootDir, regex, globPattern, hasPathGlob) {
  let total = 0;
  // The scan regex is not global, so match() would count at most one hit per
  // file. Clone it with the g flag to count every occurrence.
  const globalRegex = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  for (const filePath of common.walkFiles(rootDir)) {
    if (total >= MAX_COUNTED_MATCHES) return total;
    if (!common.isProbablyText(filePath)) continue;
    if (!_matchesGlobFilter(filePath, path.basename(filePath), rootDir, globPattern, hasPathGlob)) continue;
    let content;
    try { content = fs.readFileSync(filePath, 'utf8'); } catch { continue; }
    const found = content.match(globalRegex);
    if (!found) continue;
    total += found.length;
  }
  return total;
}

function isMatchEverythingPattern(pattern) {
  if (typeof pattern !== 'string') return false;
  const normalized = pattern.replace(/\s+/g, '');
  // Only patterns that actually compile as JS regexes. `(?s).` and `(?s).*` are
  // PCRE syntax and already throw "Invalid group" before reaching this check.
  return normalized === '^' ||
    normalized === '$^' ||
    normalized === '(?s:.)' ||
    normalized === '[\\s\\S]*' ||
    normalized === '.' ||
    normalized === '.*';
}

module.exports = {
  tokenEfficientGrep,
  run: tokenEfficientGrep
};
