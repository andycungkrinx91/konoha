#!/usr/bin/env node
'use strict';

/**
 * tests/test_skill_tree_parity.js — Verifies parity between src/templates/skills and .agents/skills.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'src', 'templates', 'skills');
const { getSkillsScanDirs } = require(path.join(ROOT, 'src', 'skill_manager'));
const _homeSkills = path.join(require('os').homedir(), '.agents', 'skills');
const _projSkills = path.join(ROOT, '.agents', 'skills');
function _treeComplete(dir) {
  try {
    return fs.existsSync(path.join(dir, 'konoha', 'SKILL.md')) && fs.existsSync(path.join(dir, 'genin-skill', 'SKILL.md'));
  } catch (_) { return false; }
}
// ~/.agents/skills is ambient state: a developer whose install is a release behind would fail
// this gate for reasons outside the diff, and the tracked project mirror is only a partial
// published subset, so it cannot stand in for the deployed tree either. The suite exports
// KONOHA_TEST_SKILL_PARITY_HOME=1 because its HOME is a sandboxed seed snapshot rebuilt from
// these templates whenever src/ changes; a standalone run stays deterministic.
const DEPLOYED = process.env.KONOHA_TEST_SKILL_PARITY_HOME === '1' && _treeComplete(_homeSkills) ? _homeSkills : null;
const IGNORED_DEPLOYED = new Set(['test-e2e-skill', 'test-e2e-skill/SKILL.md']);
const ALLOWED_DEPLOYED_ONLY = new Set();
const ALLOWED_EXTS = new Set(['.md', '.yaml', '.yml', '.json', '.py', '.js']);

// Skills installed from external sources (konoha skill add) are tracked in
// skills-lock.json and intentionally exist only in the deployed tree.
function lockedSkillRoots() {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills-lock.json'), 'utf-8'));
    return new Set(Object.keys(lock.skills || {}));
  } catch (_) {
    return new Set();
  }
}

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

  assert.ok(fs.existsSync(SOURCE), 'Canonical templates skills dir must exist');

  // The project mirror is tracked in git, but nothing regenerates it — sync_skills.js writes
  // only the home mirror. So every subtree it carries must stay byte-identical to the
  // canonical templates, or the published copy answers with stale instructions. This runs
  // unconditionally, above the deployed-tree gate below.
  const projMirror = _projSkills;
  for (const slug of fs.existsSync(projMirror) ? fs.readdirSync(projMirror) : []) {
    const template = path.join(SOURCE, slug);
    assert.ok(fs.existsSync(template), `.agents/skills/${slug} has no counterpart in src/templates/skills`);
    const mirroredDir = path.join(projMirror, slug);
    for (const rel of getFiles(template)) {
      const mirrored = path.join(mirroredDir, rel);
      const label = path.join('.agents', 'skills', slug, rel);
      assert.ok(fs.existsSync(mirrored), `${label} must mirror src/templates/skills`);
      assert.ok(
        fs.readFileSync(path.join(template, rel)).equals(fs.readFileSync(mirrored)),
        `${label} drifted from src/templates/skills`
      );
    }
    // And nothing else: a file deleted from the templates would otherwise stay published forever.
    const templateFiles = getFiles(template);
    for (const rel of getFiles(mirroredDir)) {
      assert.ok(
        templateFiles.has(rel),
        `.agents/skills/${slug}/${rel} exists only in the mirror and must be deleted`
      );
    }
  }
  if (fs.existsSync(projMirror)) console.log('✓ Tracked project skill mirror matches src/templates/skills');

  // The project mirror is the published subset, not a deployment target: only the slugs git
  // tracks belong there. copySkillsDirFast(templates, .agents/skills) adds all seventeen and
  // this test would still pass, because every added slug has a template counterpart — so the
  // package grows by megabytes with nothing failing. Assert against the tracked set instead.
  if (fs.existsSync(path.join(ROOT, '.git'))) {
    const tracked = new Set(
      execFileSync('git', ['ls-files', '.agents/skills'], { cwd: ROOT, encoding: 'utf-8' })
        .split('\n')
        .filter(Boolean)
        .map(line => line.split('/')[2])
        .filter(Boolean)
    );
    const present = fs.existsSync(projMirror)
      ? fs.readdirSync(projMirror, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
      : [];
    const stray = present.filter(slug => !tracked.has(slug));
    assert.deepStrictEqual(stray, [], `.agents/skills holds untracked slug(s) ${stray.join(', ')} — it is the published subset, not a deployment target`);
    console.log(`✓ Project skill mirror carries only its ${present.length} published slug(s)`);
  }

  // Cursor runtime mirror is not required, but it must never be a symlink out of the repo.
  const cursorSkills = path.join(ROOT, '.cursor', 'skills');
  let isSymlink = false;
  try {
    const st = fs.lstatSync(cursorSkills);
    isSymlink = st.isSymbolicLink();
  } catch (_) {}
  assert.strictEqual(isSymlink, false, '.cursor/skills must not be a symlink');
  console.log('✓ Cursor runtime mirror check passed');

  if (!DEPLOYED) {
    console.log('✓ Deployed mirror comparison skipped (set KONOHA_TEST_SKILL_PARITY_HOME=1 to compare ~/.agents/skills)');
    return;
  }

  const sourceFiles = getFiles(SOURCE);
  const deployedFiles = getFiles(DEPLOYED);

  // Check difference sets
  const lockedRoots = lockedSkillRoots();
  const extraDeployed = new Set([...deployedFiles].filter(x => !sourceFiles.has(x) && !IGNORED_DEPLOYED.has(x) && !IGNORED_DEPLOYED.has(x.split('/')[0])));
  const unexpectedDeployed = [...extraDeployed].filter(
    x => !ALLOWED_DEPLOYED_ONLY.has(x) && !lockedRoots.has(x.split('/')[0])
  );
  assert.deepStrictEqual(unexpectedDeployed.sort(), []);

  const missingDeployed = new Set([...sourceFiles].filter(x => !deployedFiles.has(x)));
  assert.deepStrictEqual([...missingDeployed], []);

  // Check byte contents match exactly
  for (const rel of sourceFiles) {
    const srcBuf = fs.readFileSync(path.join(SOURCE, rel));
    const depBuf = fs.readFileSync(path.join(DEPLOYED, rel));
    assert.ok(srcBuf.equals(depBuf), `Content mismatch in ${rel}`);
  }
  console.log('✓ Template and agents deployment text files match');

  // Every client reads its own mirror, and ~/.agents/skills is only one of them. A mirror
  // left a release behind answers that client's sessions with stale instructions, and it
  // also poisons any measurement taken through get_skill, which ingests from whichever
  // mirror resolves. Foreign skills are ignored: only files that exist in the templates are
  // required, so a mirror carrying other vendors' skills stays legal, and a mirror that never
  // had konoha deployed has no stale copy to serve and is skipped.
  const otherMirrors = getSkillsScanDirs()
    .filter(dir => path.resolve(dir) !== path.resolve(DEPLOYED))
    .filter(dir => fs.existsSync(path.join(dir, 'konoha')));
  let comparedMirrors = 0;
  for (const mirror of otherMirrors) {
    for (const rel of sourceFiles) {
      const deployed = path.join(mirror, rel);
      const label = path.join(path.relative(require('os').homedir(), mirror), rel);
      assert.ok(fs.existsSync(deployed), `${label} must exist in every client mirror`);
      assert.ok(
        fs.readFileSync(path.join(SOURCE, rel)).equals(fs.readFileSync(deployed)),
        `${label} drifted from src/templates/skills`
      );
    }
    comparedMirrors++;
  }
  console.log(`✓ ${comparedMirrors} additional client mirror(s) match src/templates/skills`);

  // Compatibility files
  for (const rel of ALLOWED_DEPLOYED_ONLY) {
    assert.ok(fs.existsSync(path.join(DEPLOYED, rel)), `${rel} must exist in deployed`);
    assert.ok(!fs.existsSync(path.join(SOURCE, rel)), `${rel} must not exist in source`);
  }
  console.log('✓ Compatibility files check passed');

  console.log('\nAll test_skill_tree_parity tests passed!');
}

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
