#!/usr/bin/env node
'use strict';

/**
 * tests/test_skill_tree_parity.js — Verifies parity between src/templates/skills and .agents/skills.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'src', 'templates', 'skills');
const DEPLOYED = path.join(ROOT, '.agents', 'skills');
const ALLOWED_DEPLOYED_ONLY = new Set(['anbu-skill/devops-engineer.md']);
const ALLOWED_EXTS = new Set(['.md', '.yaml', '.yml', '.json', '.py', '.js']);

function getFiles(baseDir) {
  const results = [];
  function walk(currentDir) {
    if (!fs.existsSync(currentDir)) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(currentDir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (ALLOWED_EXTS.has(ext)) {
          const rel = path.relative(baseDir, full).replace(/\\/g, '/');
          results.push(rel);
        }
      }
    }
  }
  walk(baseDir);
  return new Set(results);
}

async function run() {
  console.log('Running test_skill_tree_parity tests...');

  const sourceFiles = getFiles(SOURCE);
  const deployedFiles = getFiles(DEPLOYED);

  // 1. Check difference sets
  const extraDeployed = new Set([...deployedFiles].filter(x => !sourceFiles.has(x)));
  assert.deepStrictEqual([...extraDeployed].sort(), [...ALLOWED_DEPLOYED_ONLY].sort());

  const missingDeployed = new Set([...sourceFiles].filter(x => !deployedFiles.has(x)));
  assert.deepStrictEqual([...missingDeployed], []);

  // 2. Check byte contents match exactly
  for (const rel of sourceFiles) {
    const srcBuf = fs.readFileSync(path.join(SOURCE, rel));
    const depBuf = fs.readFileSync(path.join(DEPLOYED, rel));
    assert.ok(srcBuf.equals(depBuf), `Content mismatch in ${rel}`);
  }
  console.log('✓ Template and agents deployment text files match');

  // 3. Compatibility files
  for (const rel of ALLOWED_DEPLOYED_ONLY) {
    assert.ok(fs.existsSync(path.join(DEPLOYED, rel)), `${rel} must exist in deployed`);
    assert.ok(!fs.existsSync(path.join(SOURCE, rel)), `${rel} must not exist in source`);
  }
  console.log('✓ Compatibility files check passed');

  // 4. Cursor runtime mirror is not required
  const cursorSkills = path.join(ROOT, '.cursor', 'skills');
  let isSymlink = false;
  try {
    const st = fs.lstatSync(cursorSkills);
    isSymlink = st.isSymbolicLink();
  } catch (_) {}
  assert.strictEqual(isSymlink, false, '.cursor/skills must not be a symlink');
  console.log('✓ Cursor runtime mirror check passed');

  console.log('\nAll test_skill_tree_parity tests passed!');
}

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
