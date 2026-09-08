/**
 * Walk a directory tree and return matching file paths (blacklisted dirs skipped).
 * Pure Node.js in-process implementation.
 */

const fs = require('fs');
const path = require('path');
const common = require('./common');

function matchGlob(name, pattern) {
  if (pattern === '*' || pattern === '**') return true;
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

function findFilesClean(args = {}) {
  const pattern = args.pattern || args.Pattern || '*';
  const dirPath = args.dir || args.path || args.file_path || args.directory || args.dir_path || args.DirectoryPath || '.';
  const rootDir = common.resolvePath(dirPath, args.workspace, args.dev_root);

  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    throw new Error(`Directory not found: ${rootDir}`);
  }

  const results = [];
  for (const filePath of common.walkFiles(rootDir)) {
    const rel = path.relative(rootDir, filePath).replace(/\\/g, '/');
    const name = path.basename(filePath);
    if (matchGlob(name, pattern) || matchGlob(rel, pattern)) {
      results.push(rel);
    }
  }

  results.sort();
  return {
    dir: rootDir,
    pattern,
    count: results.length,
    files: results
  };
}

module.exports = {
  findFilesClean,
  run: findFilesClean
};
