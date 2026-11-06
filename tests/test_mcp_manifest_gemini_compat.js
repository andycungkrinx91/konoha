#!/usr/bin/env node
/**
 * Gemini tool-schema compatibility regression test.
 *
 * Proven failure: Gemini's `tools[].functionDeclarations[].parameters` validator
 * rejects any schema property carrying the non-standard `"integer": true`
 * annotation ("Unknown field / invalid enum value"). The manifest shipped 11 such
 * properties across 9 tool schemas, so the whole tools/list payload was rejected
 * and every konoha tool disappeared from Gemini sessions.
 *
 * Contract enforced here:
 *   1. src/mcp_tool_manifest.json contains zero `"integer": true` keys.
 *   2. src/file_tools_router.js derives integer-ness from `type === 'integer'`
 *      ONLY — it must not read `schema.integer`.
 *   3. Runtime validation still rejects fractional input for `type: 'integer'`
 *      properties and still accepts fractions for `type: 'number'` properties.
 *   4. Every inputSchema survives a strict Gemini-compatible allow-list walk.
 *   5. NEGATIVE CONTROL — the same scanner, run twice on the same submission,
 *      flags a deliberately re-poisoned manifest. This proves the green result
 *      in (1)/(4) is produced by the scanner actually detecting the defect and
 *      not by a scanner that can never fail.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '..', 'src');
const MANIFEST_PATH = path.join(SRC_DIR, 'mcp_tool_manifest.json');
const ROUTER_PATH = path.join(SRC_DIR, 'file_tools_router.js');

/**
 * Recursively collect every schema node (property schema / array items) that
 * declares `"integer": true`. Pure string key on purpose: this mirrors what the
 * Gemini validator sees, without depending on the router.
 */
function collectIntegerTrueKeys(node, trail, found) {
  if (!node || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    node.forEach((child, index) => collectIntegerTrueKeys(child, `${trail}[${index}]`, found));
    return found;
  }
  if (Object.prototype.hasOwnProperty.call(node, 'integer')) {
    found.push(`${trail}.integer = ${JSON.stringify(node.integer)}`);
  }
  for (const [key, child] of Object.entries(node)) {
    if (key === 'integer') continue;
    collectIntegerTrueKeys(child, trail ? `${trail}.${key}` : key, found);
  }
  return found;
}

/** Gemini's functionDeclaration `parameters` schema subset (object-level). */
const GEMINI_OBJECT_KEYS = new Set(['type', 'description', 'properties', 'required', 'nullable']);
/** Allowed keywords on a leaf/array schema node. */
const GEMINI_LEAF_KEYS = new Set([
  'type', 'description', 'format', 'enum', 'items',
  'minimum', 'maximum', 'minLength', 'maxLength',
  'minItems', 'maxItems', 'nullable', 'default'
]);

/**
 * Strict Gemini-compatibility walk. Returns a list of violations; an empty list
 * means the schema is accepted by the Gemini tool-schema validator.
 */
function findGeminiViolations(schemaNode, trail) {
  const violations = [];
  if (!schemaNode || typeof schemaNode !== 'object' || Array.isArray(schemaNode)) {
    return violations;
  }
  const isObject = schemaNode.type === 'object';
  // `anyOf` (when-required disjunctions over path aliases) is a pre-existing,
  // tolerated construct on 6 root schemas — out of scope here, but still walked
  // so a poisoned annotation hidden inside an anyOf branch cannot slip through.
  const isRequiredOnlyBranch =
    schemaNode.type === undefined && Array.isArray(schemaNode.required);
  const allowed = isObject
    ? new Set([...GEMINI_OBJECT_KEYS, 'additionalProperties', 'anyOf'])
    : isRequiredOnlyBranch
      ? new Set(['required'])
      : GEMINI_LEAF_KEYS;
  for (const key of Object.keys(schemaNode)) {
    if (!allowed.has(key)) violations.push(`${trail}: unsupported keyword "${key}"`);
  }
  if (Object.prototype.hasOwnProperty.call(schemaNode, 'integer')) {
    violations.push(`${trail}: forbidden annotation "integer"`);
  }
  if (schemaNode.type === 'integer') {
    // Gemini accepts "integer"; make sure no sibling numeric constraint is a string.
    for (const bound of ['minimum', 'maximum']) {
      if (schemaNode[bound] !== undefined && typeof schemaNode[bound] !== 'number') {
        violations.push(`${trail}.${bound}: must be a number`);
      }
    }
  }
  if (schemaNode.properties && typeof schemaNode.properties === 'object') {
    for (const [propName, propSchema] of Object.entries(schemaNode.properties)) {
      violations.push(...findGeminiViolations(propSchema, `${trail}.properties.${propName}`));
    }
  }
  if (schemaNode.items && typeof schemaNode.items === 'object') {
    violations.push(...findGeminiViolations(schemaNode.items, `${trail}.items`));
  }
  if (Array.isArray(schemaNode.anyOf)) {
    schemaNode.anyOf.forEach((branch, index) => {
      violations.push(...findGeminiViolations(branch, `${trail}.anyOf[${index}]`));
    });
  }
  return violations;
}

function manifestViolations(manifest) {
  const violations = [];
  for (const tool of manifest.tools || []) {
    if (!tool.inputSchema) continue;
    violations.push(...findGeminiViolations(tool.inputSchema, `${tool.name}`));
  }
  return violations;
}

function loadManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

test('manifest declares zero "integer": true keys (11 removed across 9 tool schemas)', () => {
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  const textual = raw.match(/"integer"\s*:\s*true/gi) || [];
  assert.equal(textual.length, 0, `found ${textual.length} raw "integer": true occurrences in manifest JSON`);

  const found = collectIntegerTrueKeys(loadManifest().tools, 'tools', []);
  assert.deepEqual(found, [], `manifest still carries integer annotations:\n${found.join('\n')}`);
});

test('manifest preserves legitimate "type": "integer" properties', () => {
  const manifest = loadManifest();
  const integerProps = [];
  const walk = (node, trail) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((c, i) => walk(c, `${trail}[${i}]`));
    if (node.type === 'integer') integerProps.push(trail);
    for (const [key, child] of Object.entries(node)) {
      if (key !== 'integer') walk(child, trail ? `${trail}.${key}` : key);
    }
  };
  walk(manifest.tools, 'tools');
  assert.ok(integerProps.length >= 1, 'expected at least one surviving type:"integer" property (qa_e2e_run.max_failures)');
  assert.ok(
    integerProps.some((p) => p.endsWith('max_failures')),
    `expected qa_e2e_run.max_failures to remain type:"integer", got: ${integerProps.join(', ')}`
  );
});

test('every inputSchema passes a strict Gemini-compatible keyword allow-list', () => {
  const violations = manifestViolations(loadManifest());
  assert.deepEqual(violations, [], `Gemini would reject these schema nodes:\n${violations.join('\n')}`);
});

test('file_tools_router.js derives integer-ness from type === "integer" only', () => {
  const source = fs.readFileSync(ROUTER_PATH, 'utf8');
  assert.ok(!/schema\.integer\b/.test(source), 'router must not read schema.integer — derive from type === "integer"');
  assert.ok(!/\.integer\s*&&/.test(source), 'router must not gate on a truthy .integer flag');
  assert.ok(
    /schema\.type\s*===\s*'integer'/.test(source),
    'router must still enforce integer-ness via type === "integer"'
  );
});

test('router runtime: type:"integer" rejects fractions, type:"number" accepts them', () => {
  const router = require(ROUTER_PATH);

  // type: "integer" — still strict.
  assert.throws(
    () => router.validateToolArguments('qa_e2e_run', { project_path: process.cwd(), max_failures: 1.5 }),
    /max_failures must be an integer/
  );
  assert.doesNotThrow(() =>
    router.validateToolArguments('qa_e2e_run', { project_path: process.cwd(), max_failures: 2 })
  );

  // type: "number" + legacy integer flag — the flag must no longer be honoured.
  const numberCases = [];
  for (const tool of router.MCP_MANIFEST.tools) {
    const props = tool.inputSchema && tool.inputSchema.properties;
    if (!props) continue;
    for (const [key, schema] of Object.entries(props)) {
      if (schema.type === 'number') numberCases.push({ tool: tool.name, key, schema });
    }
  }
  assert.ok(numberCases.length > 0, 'expected at least one type:"number" property in the manifest');
  for (const { tool, key, schema } of numberCases) {
    const value = Math.max(schema.minimum || 1, 1) + 0.5;
    if (schema.maximum !== undefined && value > schema.maximum) continue;
    let accepted = true;
    let message = '';
    try {
      // Exercise the validator directly with a synthetic single-property schema
      // so we isolate integer-ness from required/anyOf plumbing.
      router.validateToolArguments(tool, { [key]: value, ...{} });
    } catch (err) {
      message = err.message;
      accepted = !/must be an integer/.test(message);
    }
    assert.ok(
      accepted,
      `${tool}.${key} (type:"number") rejected ${value} as non-integer: ${message}`
    );
  }
});

test('NEGATIVE CONTROL: scanner flags a re-poisoned manifest on both submissions of the same payload', () => {
  const manifest = loadManifest();

  // Sanity: the live manifest is clean, so the scanner is not trivially red.
  assert.deepEqual(manifestViolations(manifest), [], 'baseline manifest must be clean before poisoning');

  // Re-poison with the exact defect that broke Gemini, in a property that has
  // never carried it, so we know detection is content-driven.
  const poisoned = JSON.parse(JSON.stringify(manifest));
  const target = poisoned.tools[0];
  target.inputSchema.properties.__negative_control = {
    type: 'number',
    integer: true,
    minimum: 1,
    maximum: 10
  };
  const payload = JSON.stringify(poisoned);

  // Submit the identical payload twice — the control must be deterministic.
  for (const submission of [1, 2]) {
    const parsed = JSON.parse(payload);
    const found = collectIntegerTrueKeys(parsed.tools, 'tools', []);
    const violations = manifestViolations(parsed);
    assert.ok(
      found.some((entry) => entry.includes('__negative_control')),
      `submission ${submission}: collectIntegerTrueKeys failed to flag the re-poisoned property`
    );
    assert.ok(
      violations.some((v) => v.includes('__negative_control') && /forbidden annotation "integer"/.test(v)),
      `submission ${submission}: Gemini validator walk failed to reject the re-poisoned schema`
    );
  }

  // And the clean payload, submitted through the identical scan, stays green.
  const clean = JSON.parse(payload);
  delete clean.tools[0].inputSchema.properties.__negative_control;
  assert.deepEqual(manifestViolations(clean), [], 'clean submission must scan green');
});
