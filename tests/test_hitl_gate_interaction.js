#!/usr/bin/env node
/**
 * HITL gate interaction regression test.
 *
 * Three defects pinned here:
 *   1. Gate verdicts could not be submitted at all outside Antigravity: the
 *      `sannin` tool schema omitted `choice`/`refinement` while declaring
 *      `additionalProperties: false`, so every approval returned
 *      {"error":"Unknown argument: choice"}.
 *   2. Gates were rendered as bare numbered lists, forcing humans to translate
 *      their intent into a number instead of picking the option by name.
 *   3. There was no escape hatch: a custom instruction dead-ended (parseGateChoice
 *      returned null) with no `Input your own choice` option.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const router = require(path.join(REPO, 'src', 'file_tools_router.js'));
const gates = require(path.join(REPO, 'src', 'mcp', 'workflow_gates.js'));

const CUSTOM = 'Input your own choice';

function withTaskDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return fn(dir);
}

test('sannin schema accepts gate verdicts (choice + refinement)', () => {
  const schema = router.MCP_MANIFEST.tools.find((t) => t.name === 'sannin').inputSchema;
  assert.ok(schema.properties.choice, 'sannin.choice must exist — gate approvals were rejected as "Unknown argument: choice"');
  assert.ok(schema.properties.refinement, 'sannin.refinement must exist');
  assert.equal(schema.properties.choice.type, 'string', 'choice must be a Gemini-safe string type');

  assert.doesNotThrow(() => router.validateToolArguments('sannin', { task_dir: '/tmp/x', choice: 'Compact and approve' }));
  assert.doesNotThrow(() => router.validateToolArguments('sannin', { task_dir: '/tmp/x', choice: CUSTOM, refinement: 'use Postgres' }));

  // End-to-end through the live dispatch path must not be an argument error.
  const res = router.dispatchTool('sannin', { task_dir: '/tmp/hitl-probe', choice: '1', refinement: '' });
  assert.ok(!/Unknown argument/.test(res.text), `dispatch rejected the verdict: ${res.text}`);
});

test('both gates render "Input your own choice" as a selectable label', () => {
  const g1 = JSON.parse(gates.buildGate1Prompt({}, '/tmp/t', 'T1', 'plan'));
  const g2 = JSON.parse(gates.buildGate2Prompt({}, '/tmp/t', 'T1', 99, 'report'));

  for (const [name, payload] of [['Gate 1', g1], ['Gate 2', g2]]) {
    const choices = payload.interactive_prompt.choices;
    assert.ok(choices.includes(CUSTOM), `${name} must offer "${CUSTOM}"`);
    assert.equal(payload.interactive_prompt.input_mode, 'reply_with_option_label');

    // The message must be a pick-by-label list numbered 1..N, not a bare
    // "enter the number of the option" instruction.
    const lines = payload.message.split('\n');
    choices.forEach((label, i) => {
      assert.ok(lines.some((l) => l.trim() === `${i + 1}. ${label}`), `${name} message missing line "${i + 1}. ${label}"`);
    });
    assert.ok(/Reply with the option label/.test(payload.message), `${name} must ask for the label, not a number`);
    assert.ok(!/enter the number/i.test(payload.message), `${name} must not ask the human to input an option number`);
  }

  assert.ok(g1.interactive_prompt.options.some((o) => o.id === CUSTOM && o.accepts_text === true), 'Gate 1 custom option must accept text');
  assert.ok(g2.interactive_prompt.options.some((o) => o.id === CUSTOM && o.accepts_text === true), 'Gate 2 custom option must accept text');
});

test('parseGateChoice routes labels, numbers, custom choice and free text', () => {
  const cases = [
    ['1', 'approve'],
    [1, 'approve'],
    ['Compact and approve', 'approve'],
    ['2', 'regenerate'],
    ['Reject and Regenerate PLAN', 'regenerate'],
    ['Remediation', 'remediation'],
    [CUSTOM, 'custom'],
    [`${CUSTOM}: use Postgres`, 'custom'],
    ['please use postgres instead', 'custom']
  ];
  for (const [input, expected] of cases) {
    const parsed = gates.parseGateChoice(input);
    assert.ok(parsed, `"${input}" must not dead-end (was null before this fix)`);
    assert.equal(parsed.action, expected, `"${input}" -> ${parsed.action}, expected ${expected}`);
  }

  assert.equal(gates.parseGateChoice(`${CUSTOM}: use Postgres`).refinement, 'use Postgres');
  assert.equal(gates.parseGateChoice({ choice: CUSTOM, refinement: 'swap to Postgres' }).refinement, 'swap to Postgres');
  assert.equal(gates.parseGateChoice('please use postgres instead').refinement, 'please use postgres instead');
});

test('verdicts apply to workflow state and carry the custom instruction', () => {
  const stub = { updateTask: () => {} };

  withTaskDir('hitl-g1-', (dir) => {
    const approved = {};
    assert.equal(gates.applyGate1Choice(gates.parseGateChoice('Compact and approve'), approved, dir, stub).approved, true);
    assert.equal(approved.plan_approved, true);

    const custom = {};
    const res = gates.applyGate1Choice(gates.parseGateChoice(`${CUSTOM}: use Postgres instead of SQLite`), custom, dir, stub);
    assert.equal(res.ok, true);
    assert.equal(custom.plan_approved, false, 'a custom instruction must not silently approve the plan');
    assert.equal(custom.plan_refinement, 'use Postgres instead of SQLite', 'custom text must reach Kage as refinement guidance');
  });

  withTaskDir('hitl-g2-', (dir) => {
    const signed = {};
    assert.equal(gates.applyGate2Choice(gates.parseGateChoice('1'), signed, dir, stub).signed_off, true);

    const custom = {};
    const res = gates.applyGate2Choice(gates.parseGateChoice(`${CUSTOM}: add integration tests`), custom, dir, stub);
    assert.equal(res.ok, true);
    assert.equal(res.remediation, true);
    assert.equal(custom.remediation_feedback, 'add integration tests', 'custom text must become the remediation brief');
  });
});
