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

const { buildGate1Prompt, buildGate2Prompt } = require('../src/mcp/workflow_gates');

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

  console.log('HITL gate artifacts: 8 cases passed, 0 failed.');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
