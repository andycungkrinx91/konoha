#!/usr/bin/env node
'use strict';

/**
 * Konoha backend static analysis and syntax validation harness.
 * Checks source files in bin/, src/, tests/, scripts/, and apps/web/src/
 * using Node's native syntax compiler and source hygiene invariants.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const TARGET_DIRS = ['bin', 'src', 'tests', 'scripts', 'apps/web/src'];
const SUPPORTED_EXTS = new Set(['.js', '.py', '.svelte']);
const VENDORED_SKILLS_PREFIX = path.join(ROOT_DIR, 'src', 'templates', 'skills') + path.sep;
const CONFLICT_MARKER_REGEX = /^(<{7}|={7}|>{7})(?:\s.*)?$/m;

function shouldSkipDir(name, fullPath) {
  if (name === 'node_modules' || name === '.git' || name === '__pycache__' || name.startsWith('.')) {
    return true;
  }
  if (fullPath && fullPath.startsWith(VENDORED_SKILLS_PREFIX)) {
    return true;
  }
  return false;
}

function walkJsFiles(current, results) {
  const entries = fs.readdirSync(current, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name, entryPath)) walkJsFiles(entryPath, results);
    } else if (entry.isFile() && SUPPORTED_EXTS.has(path.extname(entry.name))) {
      results.push(entryPath);
    }
  }
}

function collectJsFiles(dir) {
  const fullPath = path.join(ROOT_DIR, dir);
  if (!fs.existsSync(fullPath)) return [];
  const results = [];
  walkJsFiles(fullPath, results);
  return results;
}

function checkJsNumberedComments(lines, errors) {
  lines.forEach((line, idx) => {
    if (/^\s*\/\/\s*\d+\.\s+/.test(line)) {
      errors.push(`Numbered comment found on line ${idx + 1}: ${line.trim()}`);
    }
  });
}

function lintFile(filePath) {
  const relativePath = path.relative(ROOT_DIR, filePath);
  const errors = [];
  const ext = path.extname(filePath);

  if (ext === '.js') {
    const res = spawnSync(process.execPath, ['--check', filePath], {
      encoding: 'utf8',
      timeout: 5000
    });

    if (res.status !== 0) {
      errors.push(`Syntax error: ${(res.stderr || res.stdout || '').trim()}`);
    }
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (CONFLICT_MARKER_REGEX.test(content)) {
      errors.push('Found unresolved git merge conflict marker (<<<<<<<, =======, or >>>>>>>)');
    }
    const lines = content.split('\n');
    if (lines.length > 700) {
      errors.push(`File exceeds 700 lines (${lines.length} lines)`);
    }
    if (ext === '.js') {
      checkJsNumberedComments(lines, errors);
    }
  } catch (err) {
    errors.push(`Read error: ${err.message}`);
  }

  return { file: relativePath, errors };
}

function runLint() {
  console.log('====================================================');
  console.log('       KONOHA BACKEND STATIC ANALYSIS LINTER        ');
  console.log('====================================================');

  const files = TARGET_DIRS.flatMap(collectJsFiles).sort();
  console.log(`Discovered ${files.length} source files across ${TARGET_DIRS.join(', ')}.\n`);

  let errorCount = 0;
  const failedFiles = [];

  for (const file of files) {
    const result = lintFile(file);
    if (result.errors.length > 0) {
      errorCount += result.errors.length;
      failedFiles.push(result);
      console.error(`✖ ${result.file}`);
      result.errors.forEach(e => console.error(`  - ${e}`));
    }
  }

  console.log('====================================================');
  if (errorCount === 0) {
    console.log(`✔ Linting completed: ${files.length} files verified with 0 errors and 0 warnings.`);
    process.exit(0);
  } else {
    console.error(`✖ Linting failed: ${errorCount} error(s) across ${failedFiles.length} file(s).`);
    process.exit(1);
  }
}

if (require.main === module) {
  runLint();
}

module.exports = {
  runLint,
  collectJsFiles,
  lintFile
};
