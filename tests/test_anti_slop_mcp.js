'use strict';

const assert = require('assert');
const { BANNED_PATTERNS } = require('../src/mcp/anti_slop');

const placeholderRule = BANNED_PATTERNS.find(p => p.rule === 'placeholder-code');
assert.ok(placeholderRule, 'placeholder-code rule must be present');
const placeholderRegex = placeholderRule.regex;

// The 7 reproduction test cases that MUST match (positive cases):
const positiveCases = [
  "// placeholder",
  "// placeholder.",
  "// placeholder!",
  "// placeholder - stub",
  "/* placeholder */",
  "...rest of code...",
  "//   placeholder",
  "TODO: implement",
  "foo // placeholder",
  "foo// placeholder"
];

// Negative cases that must NOT match:
const negativeCases = [
  "const placeholder = 'test';",
  "const placeholderValue = 123;",
  "// This is a placeholder description in docs",
  "// Placeholder regex markers to reject in DoR check",
  "function placeholder() {}"
];

for (const tc of positiveCases) {
  assert.strictEqual(
    placeholderRegex.test(tc),
    true,
    `Positive case must match: ${JSON.stringify(tc)}`
  );
}

for (const tc of negativeCases) {
  assert.strictEqual(
    placeholderRegex.test(tc),
    false,
    `Negative case must NOT match: ${JSON.stringify(tc)}`
  );
}

console.log('test_anti_slop_mcp: PASS');
