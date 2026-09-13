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

function matchGlob(name, pattern) {
  if (!pattern || pattern === '*' || pattern === '**') return true;
  let reStr = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        reStr += '.*';
        i++;
      } else {
        reStr += '[^/\\\\]*';
      }
    } else if (c === '?') {
      reStr += '[^/\\\\]';
    } else if (['\\', '.', '+', '^', '$', '(', ')', '{', '}', '|', '[', ']'].includes(c)) {
      reStr += '\\' + c;
    } else {
      reStr += c;
    }
  }
  reStr += '$';
  const re = new RegExp(reStr, 'i');
  return re.test(name) || re.test(name.replace(/\\/g, '/'));
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

  for (const filePath of common.walkFiles(rootDir)) {
    if (!common.isProbablyText(filePath)) continue;

    const name = path.basename(filePath);
    if (globPattern && !hasPathGlob && !matchGlob(name, globPattern)) {
      continue;
    }

    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 1024 * 1024) continue;
      const content = fs.readFileSync(filePath, 'utf8');

      if (!regex.test(content)) continue;

      const rel = path.relative(rootDir, filePath).replace(/\\/g, '/');
      if (hasPathGlob && !matchGlob(name, globPattern) && !matchGlob(rel, globPattern)) {
        continue;
      }

      const lines = content.split(/\r?\n/);
      for (let lineNo = 1; lineNo <= lines.length; lineNo++) {
        const line = lines[lineNo - 1];
        if (regex.test(line)) {
          let snippet = line.trim();
          if (snippet.length > MATCH_TRIM) {
            snippet = snippet.substring(0, MATCH_TRIM) + '…';
          }
          matches.push(`[${rel}:${lineNo}] ${snippet}`);
          if (matches.length >= maxMatches) {
            truncated = true;
            break;
          }
        }
      }
      if (truncated) break;
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the runtime */ }
  }

  const lines = matches.slice(0, maxMatches);
  if (truncated) {
    lines.push(`Showing first ${maxMatches} matches. Refine pattern or add glob filter.`);
  }

  return {
    dir: rootDir,
    pattern,
    count: lines.length,
    matches: lines,
    text: lines.join('\n')
  };
}

module.exports = {
  tokenEfficientGrep,
  run: tokenEfficientGrep
};
