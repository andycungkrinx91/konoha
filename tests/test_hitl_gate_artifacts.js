#!/usr/bin/env node
'use strict';

/**
 * Gate 1 must leave a readable plan artifact, and Gate 2 must say what shipped.
 * Both are human-facing: an approver signing off without either is approving a
 * payload they cannot inspect.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('./helpers/isolate_db');

const {
  buildGate1Prompt,
  buildGate2Prompt,
  _isReplaceableArtifact,
  _replacePlanArtifact
} = require('../src/mcp/workflow_gates');

console.log('Running test_hitl_gate_artifacts tests...');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_gate_artifacts_'));

try {
  const planText = '- [anbu]: Build checkout API\n- [jonin]: Build checkout form\n';

  const gate1 = JSON.parse(buildGate1Prompt({ tasks: [], plan: planText }, dir, 'root-1', planText));
  const planPath = path.join(fs.realpathSync(dir), 'plan.md');
  assert.ok(fs.existsSync(planPath), 'Gate 1 must write plan.md into the task dir');
  assert.strictEqual(fs.readFileSync(planPath, 'utf8'), planText, 'plan.md must hold the full plan, not a summary');
  assert.strictEqual(gate1.plan_path, planPath, 'Gate 1 payload must expose the artifact path');
  assert.ok(gate1.message.includes(planPath), 'Gate 1 message must name the artifact path');
  assert.ok(gate1.message.includes('- [anbu]: Build checkout API'), 'Gate 1 message must show the plan body');
  console.log('  ✓ Gate 1 writes plan.md and shows it to the approver');

  // A second Gate 1 (regenerate) must overwrite, not append or resurrect stale text.
  const refined = '- [anbu]: Build checkout API with rate limiting\n';
  buildGate1Prompt({ tasks: [], plan: refined }, dir, 'root-1', refined);
  assert.strictEqual(fs.readFileSync(planPath, 'utf8'), refined, 'regeneration must replace plan.md');
  console.log('  ✓ Gate 1 regeneration replaces the artifact');

  // A symlinked plan.md must never be followed (task dirs are shared with clients).
  const escapeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_gate_escape_'));
  const victim = path.join(escapeDir, 'victim.md');
  fs.writeFileSync(victim, 'ORIGINAL', 'utf8');
  fs.rmSync(path.join(dir, 'plan.md'), { force: true });
  fs.symlinkSync(victim, path.join(dir, 'plan.md'));
  const gate1Sym = JSON.parse(buildGate1Prompt({ tasks: [], plan: refined }, dir, 'root-1', refined));
  assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'ORIGINAL', 'a symlinked plan.md must not be written through');
  assert.strictEqual(gate1Sym.plan_path, null, 'symlinked artifact must be skipped, not reported as written');
  assert.ok(gate1Sym.message.includes(refined.trim()), 'the plan body must still reach the approver');
  fs.rmSync(escapeDir, { recursive: true, force: true });
  fs.unlinkSync(path.join(dir, 'plan.md'));
  console.log('  ✓ symlinked plan.md is refused without losing the plan from the message');

  // A task dir that does not exist yet is legitimate (fresh task): create it and
  // write inside it, never next to the process cwd.
  const missingDir = path.join(dir, 'fresh-task');
  const gate1Missing = JSON.parse(buildGate1Prompt({ tasks: [], plan: refined }, missingDir, 'root-1', refined));
  assert.strictEqual(gate1Missing.plan_path, path.join(fs.realpathSync(missingDir), 'plan.md'), 'a fresh task dir must receive plan.md');
  assert.strictEqual(fs.readFileSync(gate1Missing.plan_path, 'utf8'), refined);
  console.log('  ✓ missing task dir is created and receives plan.md');

  // A dangling directory symlink must not be traversed: mkdir -p would either
  // create the escape target or throw, so the artifact is skipped instead.
  const danglingTarget = path.join(dir, 'dangling-target');
  const danglingDir = path.join(dir, 'dangling-task');
  fs.symlinkSync(danglingTarget, danglingDir);
  const gate1Dangling = JSON.parse(buildGate1Prompt({ tasks: [], plan: refined }, danglingDir, 'root-1', refined));
  assert.strictEqual(gate1Dangling.plan_path, null, 'a dangling task dir must skip the artifact, not report a path');
  assert.strictEqual(fs.existsSync(danglingTarget), false, 'a dangling task dir must not create its escape target');
  assert.ok(gate1Dangling.message.includes(refined.trim()), 'the plan body must still reach the approver');
  console.log('  ✓ dangling task dir is not traversed to write plan.md');

  // A dangling plan.md symlink has no lstat-visible target, so a path-based
  // existsSync() check would see "absent" and write through it. O_NOFOLLOW
  // refuses at open instead.
  const orphanTarget = path.join(dir, 'absent-target.md');
  fs.rmSync(path.join(dir, 'plan.md'), { force: true });
  fs.symlinkSync(orphanTarget, path.join(dir, 'plan.md'));
  const gate1Orphan = JSON.parse(buildGate1Prompt({ tasks: [], plan: refined }, dir, 'root-1', refined));
  assert.strictEqual(gate1Orphan.plan_path, null, 'a dangling plan.md symlink must be refused');
  assert.strictEqual(fs.existsSync(orphanTarget), false, 'a dangling plan.md symlink must not materialize its target');
  assert.ok(gate1Orphan.message.includes(refined.trim()), 'the plan body must still reach the approver');
  fs.unlinkSync(path.join(dir, 'plan.md'));
  console.log('  ✓ dangling plan.md symlink is refused');

  // Race: plan.md is a regular file at lstat time and becomes a symlink to an
  // outside file before the open. Opening by path is unavoidable there, so the
  // only defence is that the descriptor's inode must match the inspected one.
  const raceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_gate_race_'));
  const raceVictim = path.join(raceDir, 'victim.md');
  fs.writeFileSync(raceVictim, 'ORIGINAL', 'utf8');
  fs.writeFileSync(path.join(dir, 'plan.md'), '- [anbu]: stale plan\n', 'utf8');
  const realOpenSync = fs.openSync;
  let swapped = false;
  fs.openSync = function patchedOpenSync(target, flags, mode) {
    if (!swapped && typeof flags === 'number' && (flags & fs.constants.O_CREAT) === 0) {
      swapped = true;
      fs.rmSync(target, { force: true });
      fs.symlinkSync(raceVictim, target);
    }
    return realOpenSync.call(fs, target, flags, mode);
  };
  let gate1Race;
  try {
    gate1Race = JSON.parse(buildGate1Prompt({ tasks: [], plan: refined }, dir, 'root-1', refined));
  } finally {
    fs.openSync = realOpenSync;
  }
  assert.strictEqual(swapped, true, 'the race harness must actually swap the artifact mid-open');
  assert.strictEqual(fs.readFileSync(raceVictim, 'utf8'), 'ORIGINAL', 'a raced symlink must never be written through');
  assert.strictEqual(gate1Race.plan_path, null, 'a raced artifact must be reported as unwritten');
  assert.ok(gate1Race.message.includes(refined.trim()), 'the plan body must still reach the approver');

  // Same race with O_NOFOLLOW stripped from the open, which is what a Windows
  // kernel does: the open follows the link, so the inode comparison is the only
  // defence left and must still refuse.
  fs.unlinkSync(path.join(dir, 'plan.md'));
  fs.writeFileSync(path.join(dir, 'plan.md'), '- [anbu]: stale plan\n', 'utf8');
  let swappedPortable = false;
  fs.openSync = function patchedPortableOpenSync(target, flags, mode) {
    if (typeof flags === 'number' && (flags & fs.constants.O_CREAT) === 0) {
      if (!swappedPortable) {
        swappedPortable = true;
        fs.rmSync(target, { force: true });
        fs.symlinkSync(raceVictim, target);
      }
      flags &= ~(fs.constants.O_NOFOLLOW || 0);
    }
    return realOpenSync.call(fs, target, flags, mode);
  };
  let gate1PortableRace;
  try {
    gate1PortableRace = JSON.parse(buildGate1Prompt({ tasks: [], plan: refined }, dir, 'root-1', refined));
  } finally {
    fs.openSync = realOpenSync;
  }
  assert.strictEqual(swappedPortable, true, 'the portable race harness must swap the artifact mid-open');
  assert.strictEqual(fs.readFileSync(raceVictim, 'utf8'), 'ORIGINAL', 'a raced symlink must never be written through without O_NOFOLLOW');
  assert.strictEqual(gate1PortableRace.plan_path, null, 'inode mismatch must refuse the write where O_NOFOLLOW is unsupported');
  fs.rmSync(raceDir, { recursive: true, force: true });
  fs.rmSync(path.join(dir, 'plan.md'), { force: true });
  console.log('  ✓ symlink swapped mid-open is refused, with and without O_NOFOLLOW');

  // Windows has no O_NOFOLLOW, so this branch decides whether Gate 1 can ever
  // regenerate its artifact there. An existing regular file must stay
  // overwritable, and a symlink must still be refused.
  const portablePath = path.join(dir, 'portable.md');
  fs.writeFileSync(portablePath, 'old', 'utf8');
  assert.strictEqual(_isReplaceableArtifact(portablePath, 0), true, 'an existing regular artifact must be replaceable where O_NOFOLLOW is unsupported');
  _replacePlanArtifact(portablePath, 'new');
  assert.strictEqual(fs.readFileSync(portablePath, 'utf8'), 'new', 'regeneration must replace content without O_NOFOLLOW');

  const portableVictim = path.join(dir, 'portable-victim.md');
  fs.writeFileSync(portableVictim, 'ORIGINAL', 'utf8');
  fs.rmSync(portablePath, { force: true });
  fs.symlinkSync(portableVictim, portablePath);
  assert.strictEqual(_isReplaceableArtifact(portablePath, 0), false, 'a symlink must still be refused without O_NOFOLLOW');
  assert.strictEqual(fs.readFileSync(portableVictim, 'utf8'), 'ORIGINAL', 'the refused symlink target must stay untouched');
  fs.rmSync(portablePath, { force: true });
  fs.rmSync(portableVictim, { force: true });
  console.log('  ✓ existing artifact overwrite works without O_NOFOLLOW, symlink still refused');

  // A hard link shares the inode, so the regular-file and inode-identity checks
  // all pass while the bytes would land in a file outside the task dir. The
  // artifact is always created singly linked, so a second name on that inode is
  // someone else's file and must be refused before truncation.
  const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_gate_hardlink_'));
  const linkVictim = path.join(linkDir, 'victim.md');
  const victimBytes = 'ORIGINAL';
  fs.writeFileSync(linkVictim, victimBytes, 'utf8');
  fs.rmSync(planPath, { force: true });
  // A hard link cannot cross filesystems, so a same-device fixture is a
  // precondition of this test rather than something to assume.
  assert.strictEqual(fs.statSync(linkDir).dev, fs.statSync(dir).dev, 'the hard-link fixture must live on the task dir filesystem');
  fs.linkSync(linkVictim, planPath);
  assert.strictEqual(fs.statSync(linkVictim).nlink, 2, 'the fixture must really be a hard link');
  assert.strictEqual(fs.statSync(planPath).ino, fs.statSync(linkVictim).ino, 'both names must share one inode');
  const gate1Link = JSON.parse(buildGate1Prompt({ tasks: [], plan: refined }, dir, 'root-1', refined));
  assert.strictEqual(gate1Link.plan_path, null, 'a hard-linked plan.md must be refused');
  assert.ok(fs.readFileSync(linkVictim).equals(Buffer.from(victimBytes)), 'a hard-linked plan.md must not be written through');
  assert.strictEqual(fs.statSync(linkVictim).size, victimBytes.length, 'the external file must keep its original size');
  assert.ok(gate1Link.message.includes(refined.trim()), 'the plan body must still reach the approver');

  // The same refusal must hold where O_NOFOLLOW is unavailable (Windows), since
  // there the inode check alone would accept the link.
  assert.strictEqual(_isReplaceableArtifact(planPath, 0), false, 'a hard link must be refused without O_NOFOLLOW too');
  assert.ok(fs.readFileSync(linkVictim).equals(Buffer.from(victimBytes)), 'the no-O_NOFOLLOW path must not write through the link');

  // Structural guarantee, independent of any link count a filesystem reports:
  // the new text goes to a fresh inode and is renamed over the name, so even a
  // write that skipped inspection cannot reach the other name.
  _replacePlanArtifact(planPath, refined);
  assert.strictEqual(fs.readFileSync(planPath, 'utf8'), refined, 'the replace path must still update plan.md');
  assert.ok(fs.readFileSync(linkVictim).equals(Buffer.from(victimBytes)), 'replacing a hard-linked artifact must not touch the other name');
  assert.strictEqual(fs.statSync(linkVictim).nlink, 1, 'replacing the artifact must detach it from the external file');
  fs.rmSync(planPath, { force: true });

  // Dropping the extra name restores normal regeneration, and the other file
  // still holds its original bytes.
  fs.rmSync(planPath, { force: true });
  assert.strictEqual(fs.statSync(linkVictim).nlink, 1, 'the victim must be back to a single name before regeneration');
  const gate1Unlinked = JSON.parse(buildGate1Prompt({ tasks: [], plan: refined }, dir, 'root-1', refined));
  assert.strictEqual(gate1Unlinked.plan_path, planPath, 'a singly linked artifact must stay writable');
  assert.strictEqual(fs.readFileSync(planPath, 'utf8'), refined, 'regeneration must still replace the artifact');
  assert.ok(fs.readFileSync(linkVictim).equals(Buffer.from(victimBytes)), 'the external file must survive both the refusal and the later write');
  fs.rmSync(linkDir, { recursive: true, force: true });
  console.log('  ✓ hard-linked plan.md is refused and never writes through to the other name');

  // Artifact persistence is advisory: if the task dir cannot be created, Gate 1
  // must still produce an approvable prompt carrying the plan inline.
  const blocker = path.join(dir, 'not-a-dir');
  fs.writeFileSync(blocker, 'file', 'utf8');
  const gate1Blocked = JSON.parse(buildGate1Prompt({ tasks: [], plan: refined }, path.join(blocker, 'task'), 'root-1', refined));
  assert.strictEqual(gate1Blocked.plan_path, null, 'an unwritable task dir must not report an artifact path');
  assert.ok(gate1Blocked.message.includes(refined.trim()), 'Gate 1 must still show the plan when the artifact cannot be written');
  assert.ok(gate1Blocked.interactive_prompt.choices.length > 0, 'Gate 1 must still offer its choices');
  console.log('  ✓ artifact write failure still yields a usable Gate 1');

  const tasks = [
    { id: 't1', agent: 'anbu', task: 'Build checkout API', status: 'completed', result: 'Added POST /checkout', files_modified: ['src/api/checkout.js'] },
    { id: 't2', agent: 'jonin', task: 'Build checkout form', status: 'completed', result: 'Added CheckoutForm', files_modified: ['src/ui/CheckoutForm.svelte'] },
    { id: 't3', agent: 'anbu', task: 'Skipped migration', status: 'pending', result: '' }
  ];
  const gate2 = JSON.parse(buildGate2Prompt({ tasks }, dir, 'root-1', { confidence: 98, report: path.join(dir, 'final_report.md') }));

  assert.ok(gate2.interactive_prompt.implemented.includes('Build checkout API'), 'Gate 2 payload must list completed work');
  assert.ok(!gate2.interactive_prompt.implemented.includes('Skipped migration'), 'Gate 2 must not advertise unfinished tasks as delivered');
  assert.deepStrictEqual(gate2.interactive_prompt.modified_files, ['src/api/checkout.js', 'src/ui/CheckoutForm.svelte'], 'Gate 2 must list the files that changed');
  assert.ok(gate2.message.includes('Implemented:'), 'Gate 2 message must have an implemented section');
  assert.ok(gate2.message.includes('Build checkout API'), 'Gate 2 message must name the delivered work');
  assert.ok(gate2.message.includes('src/api/checkout.js'), 'Gate 2 message must name the modified files');
  console.log('  ✓ Gate 2 reports implemented work and modified files');

  // No completed tasks must not advertise pending work as delivered.
  const gate2Empty = JSON.parse(buildGate2Prompt({ tasks: [{ id: 't1', agent: 'anbu', task: 'X', status: 'pending' }] }, dir, 'root-1', { confidence: 98 }));
  assert.strictEqual(gate2Empty.interactive_prompt.implemented, 'No completed tasks recorded.');
  assert.ok(!gate2Empty.interactive_prompt.implemented.includes('X'), 'pending tasks must not be reported as implemented');
  assert.deepStrictEqual(gate2Empty.interactive_prompt.modified_files, []);
  assert.ok(gate2Empty.message.includes('No completed tasks recorded.'), 'Gate 2 message must state no completed tasks');
  console.log('  ✓ Gate 2 degrades cleanly with no completed tasks');

  console.log('HITL gate artifacts: 11 cases passed, 0 failed.');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
