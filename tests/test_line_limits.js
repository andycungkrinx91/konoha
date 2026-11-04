#!/usr/bin/env node
// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

/**
 * Enforces the 700-line ceiling that scripts/lint.js applies. Keeping this as a
 * test means an oversized file fails the suite rather than only a lint run.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LIMIT = 700;
const SCAN_DIRS = ['src', 'bin', path.join('apps', 'web', 'src'), 'scripts', 'tests'];
const SKIP = new Set(['node_modules', '.svelte-kit', 'build', 'dist', '.git']);
const EXT = /\.(js|mjs|cjs|svelte|ts)$/;

function collect(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (EXT.test(entry.name)) out.push(full);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => collect(path.join(ROOT, d)));
const offenders = files
  .map((f) => ({ file: path.relative(ROOT, f), lines: fs.readFileSync(f, 'utf8').split('\n').length }))
  .filter((x) => x.lines > LIMIT)
  .sort((a, b) => b.lines - a.lines);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  PASS ${name}`); }
  catch (e) { failed += 1; console.log(`  FAIL ${name}: ${e.message}`); }
}

console.log('line limits');

test('the scan actually inspects the codebase', () => {
  assert.ok(files.length > 100, `only ${files.length} files scanned; scope is wrong`);
});

test(`no file exceeds ${LIMIT} lines`, () => {
  const detail = offenders.map((o) => `${o.file} (${o.lines})`).join('\n  ');
  assert.strictEqual(offenders.length, 0, `\n  ${detail}`);
});

console.log(`\n  scanned ${files.length} files`);
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
