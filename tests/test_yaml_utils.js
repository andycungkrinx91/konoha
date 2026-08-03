#!/usr/bin/env node
/**
 * tests/test_yaml_utils.js — pin the YAML reader/writer behavior.
 *
 * IMPORTANT: this parser is the *exact* body previously living inside
 * src/agent_manager.js. Its quirkiness (block-scalar key placement,
 * top-level arrays of scalars appearing as mappings, etc.) is intentional
 * — every existing agents.yaml has been written with these quirks in mind.
 *
 * Do not "fix" failures here without also regenerating test/snapshots/pre and
 * rerunning the whole agent manager end-to-end. The tests below pin the
 * parser to behavior that existing agents.yaml files rely on.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { parseYaml, stringifyYaml } = require('../bin/lib/yaml_utils');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) {
    console.log(`  ✗ ${name}\n    ${e.message}`);
    failed++;
  }
}
function section(label) { console.log(`\n${label}`); }

// ────────────────────────────────────────────────────────────────────
section('parseYaml — basic scalar mappings');
// ────────────────────────────────────────────────────────────────────

test('null / empty input', () => {
  assert.strictEqual(parseYaml(''), null);
  assert.strictEqual(parseYaml(null), null);
});
test('flat key/value', () => {
  assert.deepStrictEqual(parseYaml('name: kage\nrank: S'), { name: 'kage', rank: 'S' });
});
test('comments and blank lines are ignored', () => {
  assert.deepStrictEqual(
    parseYaml('# leading\n\nname: kage\n# inline\nrank: S\n'),
    { name: 'kage', rank: 'S' }
  );
});
test('numbers, booleans, null are coerced', () => {
  assert.deepStrictEqual(
    parseYaml('n: 42\nb: true\nz: null\ns: hi'),
    { n: 42, b: true, z: null, s: 'hi' }
  );
});
test('inline [] / {} emit empty containers', () => {
  assert.deepStrictEqual(parseYaml('empty_arr: []\nempty_obj: {}'),
    { empty_arr: [], empty_obj: {} });
});

// ────────────────────────────────────────────────────────────────────
section('parseYaml — nested mappings');
// ────────────────────────────────────────────────────────────────────

test('two-level nesting with array of scalars (the agents.yaml use case)', () => {
  // agents.yaml pattern: a list item with a nested array of scalars
  const y = '- name: kage\n  skills:\n    - lead\n    - follow\n';
  assert.deepStrictEqual(parseYaml(y), [{ name: 'kage', skills: ['lead', 'follow'] }]);
});
test('two-level nesting with array of scalars at root', () => {
  // ⚠ original quirk: this returns { skills: {} } not an array.
  // Pinned here so anyone changing the parser sees it.
  const y = 'skills:\n  - read\n  - write\nmcp:\n  port: 8765\n';
  const parsed = parseYaml(y);
  assert.strictEqual(parsed.skills.constructor, Array,
    'expected skills to be an array (this is how agent_manager uses it)');
  assert.deepStrictEqual(parsed.skills, ['read', 'write']);
});
test('three-level scalar nesting', () => {
  assert.deepStrictEqual(
    parseYaml('a:\n  b:\n    c: deep'),
    { a: { b: { c: 'deep' } } }
  );
});

// ────────────────────────────────────────────────────────────────────
section('parseYaml — arrays');
// ────────────────────────────────────────────────────────────────────

test('root array of scalars', () => {
  assert.deepStrictEqual(
    parseYaml('- a\n- b\n- c'),
    ['a', 'b', 'c']
  );
});
test('root array of mappings (the agents.yaml root shape)', () => {
  assert.deepStrictEqual(
    parseYaml('- name: a\n  n: 1\n- name: b\n  n: 2\n'),
    [{ name: 'a', n: 1 }, { name: 'b', n: 2 }]
  );
});
test('root array of mappings containing nested arrays of scalars', () => {
  // This is THE shape agents.yaml has
  const y = [
    '- name: mcp_genin',
    '  skills:',
    '    - genin-skill',
    '- name: mcp_kage',
    '  skills:',
    '    - kage-skill',
    '    - delegate-skill',
    ''
  ].join('\n');
  assert.deepStrictEqual(parseYaml(y), [
    { name: 'mcp_genin', skills: ['genin-skill'] },
    { name: 'mcp_kage', skills: ['kage-skill', 'delegate-skill'] }
  ]);
});

// ────────────────────────────────────────────────────────────────────
section('parseYaml — multi-line block scalars (|)');
// ────────────────────────────────────────────────────────────────────

test('block scalar at root key', () => {
  const yaml = 'body: |\n  line one\n  line two\n  line three\n';
  // Pinned quirky behavior: the parser attaches block-scalar to current
  // (the parent mapping), NOT to current[key]. So `current.body` is set
  // and `current.body` may be reused.
  const parsed = parseYaml(yaml);
  assert.ok(parsed.body, 'expected body key to be set');
  assert.ok(parsed.body.includes('line one'));
});
test('block scalar inside list item', () => {
  const yaml = '- name: kage\n  instructions: |\n    Task A\n    Task B\n';
  const parsed = parseYaml(yaml);
  assert.strictEqual(parsed[0].name, 'kage');
  assert.ok(parsed[0].instructions, 'expected instructions to be set');
  assert.ok(parsed[0].instructions.includes('Task A'));
});

// ────────────────────────────────────────────────────────────────────
section('stringifyYaml — basic types');
// ────────────────────────────────────────────────────────────────────

test('null / undefined → "null"', () => {
  assert.strictEqual(stringifyYaml(null), 'null');
  assert.strictEqual(stringifyYaml(undefined), 'null');
});
test('plain string', () => {
  assert.strictEqual(stringifyYaml('hello'), 'hello');
});
test('number / boolean', () => {
  assert.strictEqual(stringifyYaml(42), '42');
  assert.strictEqual(stringifyYaml(true), 'true');
  assert.strictEqual(stringifyYaml(false), 'false');
});
test('reserved-character string is quoted', () => {
  assert.strictEqual(stringifyYaml('true'), '"true"');
  assert.strictEqual(stringifyYaml('42'), '"42"');
  assert.strictEqual(stringifyYaml('#comment'), '"#comment"');
});

// ────────────────────────────────────────────────────────────────────
section('stringifyYaml — collections');
// ────────────────────────────────────────────────────────────────────

test('empty array / object', () => {
  assert.strictEqual(stringifyYaml([]), '[]');
  assert.strictEqual(stringifyYaml({}), '{}');
});
test('flat object', () => {
  assert.strictEqual(stringifyYaml({ a: 1, b: 2 }), 'a: 1\nb: 2');
});
test('nested object', () => {
  const out = stringifyYaml({ outer: { inner: 1 } });
  assert.ok(out.includes('outer:'));
  assert.ok(out.includes('inner: 1'));
});
test('multiline string uses block scalar', () => {
  const out = stringifyYaml({ body: 'line1\nline2' });
  assert.ok(out.startsWith('body: |'));
  assert.ok(out.includes('  line1'));
});

// ────────────────────────────────────────────────────────────────────
section('REGRESSION — real agents.yaml parses correctly');
// ────────────────────────────────────────────────────────────────────

test('templates/agents.yaml yields 7 agents with non-empty skills arrays', () => {
  const yaml = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'templates', 'agents.yaml'), 'utf-8');
  const agents = parseYaml(yaml);
  assert.ok(Array.isArray(agents), 'root should be array of mappings');
  assert.strictEqual(agents.length, 7, 'expected 7 default agents');
  agents.forEach(a => {
    assert.ok(a.name, `agent missing name: ${JSON.stringify(a)}`);
    assert.ok(Array.isArray(a.skills),
      `agent ${a.name} should have skills array, got ${typeof a.skills}`);
    assert.ok(a.skills.length > 0,
      `agent ${a.name} should have at least one skill`);
  });
});

// ────────────────────────────────────────────────────────────────────
section('round-trip — parse(stringify(x)) ≈ x');
// ────────────────────────────────────────────────────────────────────

test('flat scalar object', () => {
  const x = { name: 'kage', rank: 'S', count: 7, active: true };
  assert.deepStrictEqual(parseYaml(stringifyYaml(x)), x);
});
test('nested object (no arrays)', () => {
  const x = { outer: { inner: 'v', count: 1 } };
  assert.deepStrictEqual(parseYaml(stringifyYaml(x)), x);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);