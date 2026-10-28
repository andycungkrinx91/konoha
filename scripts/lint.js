#!/usr/bin/env node
'use strict';

/**
 * Konoha backend static analysis and syntax validation harness.
 * Checks all JavaScript source files in bin/, src/, tests/, and scripts/
 * using Node's native syntax compiler and source hygiene invariants.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const TARGET_DIRS = ['bin', 'src', 'tests', 'scripts'];
const CONFLICT_MARKER_REGEX = /^(<{7}|={7}|>{7})(?:\s.*)?$/m;

function shouldSkipDir(name) {
  return name === 'node_modules' || name === '.git' || name.startsWith('.');
}

function walkJsFiles(current, results) {
  const entries = fs.readdirSync(current, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name)) walkJsFiles(entryPath, results);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
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

function lintFile(filePath) {
  const relativePath = path.relative(ROOT_DIR, filePath);
  const errors = [];

  // 1. Native Node.js syntax compiler check (--check)
  const res = spawnSync(process.execPath, ['--check', filePath], {
    encoding: 'utf8',
    timeout: 5000
  });

  if (res.status !== 0) {
    errors.push(`Syntax error: ${(res.stderr || res.stdout || '').trim()}`);
  }

  // 2. Source hygiene checks
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (CONFLICT_MARKER_REGEX.test(content)) {
      errors.push('Found unresolved git merge conflict marker (<<<<<<<, =======, or >>>>>>>)');
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
  console.log(`Discovered ${files.length} JavaScript files across ${TARGET_DIRS.join(', ')}.\n`);

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
