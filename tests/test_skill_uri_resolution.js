#!/usr/bin/env node
'use strict';

/**
 * tests/test_skill_uri_resolution.js
 *
 * A client may ask for a skill document as <skill>/<file> or
 * <skill>/references/<file>. Only the references/ form exists on disk, so the
 * short form must resolve through the mirror resolver rather than through
 * duplicated alias files — duplicating them would break source/deployed parity
 * (see test_skill_tree_parity.js). Untrusted skill paths must never escape the
 * skills root.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const deployUtils = require('../src/deploy_utils');
const skillsCommon = require('../src/mcp/skills_common');

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  PASS ${label}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${label}: ${err.message}`);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_skill_'));
const srcRoot = path.join(tmp, 'src');
const destRoot = path.join(tmp, 'dest');
const savedHome = process.env.HOME;

try {
  fs.mkdirSync(path.join(srcRoot, 'demo-skill', 'references'), { recursive: true });
  fs.writeFileSync(path.join(srcRoot, 'demo-skill', 'SKILL.md'), '# demo\n');
  fs.writeFileSync(path.join(srcRoot, 'demo-skill', 'references', 'guide.md'), 'guide body\n');

  check('install does not duplicate reference files into the skill root', () => {
    deployUtils.copySkillsDirFast(srcRoot, destRoot);
    assert.ok(fs.existsSync(path.join(destRoot, 'demo-skill', 'references', 'guide.md')), 'references form missing');
    assert.strictEqual(
      fs.existsSync(path.join(destRoot, 'demo-skill', 'guide.md')),
      false,
      'alias file created; parity contract forbids it'
    );
  });

  check('short form resolves through the mirror resolver', () => {
    // getMirrorRoots only trusts known client paths, so install into ~/.agents/skills.
    const mirrorRoot = path.join(tmp, '.agents', 'skills');
    fs.mkdirSync(path.join(tmp, '.agents'), { recursive: true });
    deployUtils.copySkillsDirFast(srcRoot, mirrorRoot);
    process.env.HOME = tmp;
    const short = skillsCommon.findInMirror('demo-skill/guide');
    const long = skillsCommon.findInMirror('demo-skill/references/guide');
    assert.ok(short, 'short form did not resolve');
    assert.ok(long, 'references form did not resolve');
    assert.strictEqual(short.filePath, long.filePath);
    assert.strictEqual(fs.readFileSync(short.filePath, 'utf8'), 'guide body\n');
  });

  check('nested duplicate skill dir is removed only when identical', () => {
    const nested = path.join(destRoot, 'demo-skill', 'demo-skill');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'SKILL.md'), '# demo\n');
    deployUtils.removeNestedSkillDirForEachSkill(destRoot);
    assert.strictEqual(fs.existsSync(nested), false, 'identical nested copy should be removed');

    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'SKILL.md'), 'USER EDIT\n');
    deployUtils.removeNestedSkillDirForEachSkill(destRoot);
    assert.ok(fs.existsSync(nested), 'nested dir with user content must be preserved');
  });

  check('tokubetsu-jonin-skill/documentation-writer resolves from the repo tree', () => {
    const repoSkills = path.join(__dirname, '..', 'src', 'templates', 'skills');
    const realDest = path.join(tmp, 'real-dest');
    process.env.HOME = realDest;
    fs.mkdirSync(path.join(realDest, '.agents'), { recursive: true });
    fs.symlinkSync(repoSkills, path.join(realDest, '.agents', 'skills'), 'dir');
    const short = skillsCommon.findInMirror('tokubetsu-jonin-skill/documentation-writer');
    assert.ok(short, 'documentation-writer did not resolve');
    assert.ok(short.filePath.endsWith(path.join('references', 'documentation-writer.md')), `unexpected path ${short.filePath}`);
  });

  check('traversal payloads are rejected', () => {
    for (const payload of ['../x', '..%2Fx', 'C:\\x', '/etc/passwd', 'a\\b', '%00', '.']) {
      const result = skillsCommon.validateSkillPath(payload);
      assert.ok(result.error, `payload accepted: ${payload}`);
    }
    assert.strictEqual(skillsCommon.findInMirror('../etc/passwd'), null);
    assert.strictEqual(skillsCommon.findInMirror('C:\\Windows\\win.ini'), null);
  });

  check('resolved paths stay inside the skills root', () => {
    const root = path.join(tmp, 'skillsroot');
    fs.mkdirSync(root, { recursive: true });
    const ok = skillsCommon.resolveSkillPathWithinRoot('demo-skill/guide.md', root);
    assert.strictEqual(ok.error, null);
    assert.ok(ok.value.startsWith(root + path.sep));
    const bad = skillsCommon.resolveSkillPathWithinRoot('../../etc/passwd', root);
    assert.ok(bad.error, 'escape was not rejected');
  });
check('resolveAgentBrowserInvocation returns a spawnable shape', () => {
  // HOME was overridden above; agent-browser resolution reads it, so restore it.
  if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
  const qa = require('../src/workflow/qa-automation/qa_codify');
  const invocation = qa.resolveAgentBrowserInvocation();
  if (!invocation) {
    console.log('    (no agent-browser on this host — nothing to check)');
    return;
  }
  assert.ok(['path', 'npx'].includes(invocation.kind), `unexpected kind ${invocation.kind}`);
  assert.ok(typeof invocation.command === 'string' && invocation.command.length > 0);
  // A multi-word string is not spawnable: spawnSync treats it as one binary name
  // and fails ENOENT. The npx fallback must carry its args separately.
  assert.strictEqual(
    /\s/.test(invocation.command),
    false,
    `command must not contain spaces: ${invocation.command}`
  );
  if (invocation.kind === 'npx') {
    assert.ok(Array.isArray(invocation.args) && invocation.args.length > 0, 'npx form needs args');
  }
  const { spawnSync } = require('child_process');
  const probe = spawnSync(invocation.command, [...(invocation.args || []), '--version'], { encoding: 'utf8', timeout: 180000 });
  assert.notStrictEqual(probe.error && probe.error.code, 'ENOENT', 'resolved command is not spawnable');
});

check('legacy getAgentBrowserCmd never returns a multi-word command', () => {
  const qa = require('../src/workflow/qa-automation/qa_codify');
  const cmd = qa.getAgentBrowserCmd();
  if (cmd === null) return;
  assert.strictEqual(/\s/.test(cmd), false, `unsafe command string: ${cmd}`);
});

} finally {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nskill uri resolution: OK' : `\nskill uri resolution: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
