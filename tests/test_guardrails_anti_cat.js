#!/usr/bin/env node
'use strict';

/**
 * tests/test_guardrails_anti_cat.js
 * Verification of RTK boundary guardrail & anti-cat/anti-grep shell interceptor.
 */

const assert = require('assert');
const { checkCommandGuardrails } = require('../src/guardrails');

console.log('Running test_guardrails_anti_cat tests...');

// 1. Plain cat/grep blocked
const rawCat = checkCommandGuardrails('cat package.json');
assert.ok(rawCat);
assert.strictEqual(rawCat.category, 'read-bypass');
assert.ok(rawCat.reason.includes('Shell file reading is strictly forbidden'));

const rawGrep = checkCommandGuardrails('grep "pattern" src/file.js');
assert.ok(rawGrep);
assert.strictEqual(rawGrep.category, 'read-bypass');

// 2. rtk-prefixed cat/grep also blocked (Anti-cat/anti-grep invariant)
const rtkCat = checkCommandGuardrails('rtk cat src/index.js');
assert.ok(rtkCat, 'rtk cat must be blocked by guardrails');
assert.strictEqual(rtkCat.category, 'read-bypass');

const rtkGrep = checkCommandGuardrails('rtk grep "foo" src/server.js');
assert.ok(rtkGrep, 'rtk grep must be blocked by guardrails');
assert.strictEqual(rtkGrep.category, 'read-bypass');

const rtkRg = checkCommandGuardrails('rtk rg "function" src/');
assert.ok(rtkRg, 'rtk rg must be blocked by guardrails');
assert.strictEqual(rtkRg.category, 'read-bypass');

// 3. Legitimate build, test, and lint commands allowed
assert.strictEqual(checkCommandGuardrails('rtk pnpm test'), null);
assert.strictEqual(checkCommandGuardrails('rtk pnpm run build'), null);
assert.strictEqual(checkCommandGuardrails('rtk pnpm run lint'), null);
assert.strictEqual(checkCommandGuardrails('rtk uv run pytest'), null);
assert.strictEqual(checkCommandGuardrails('rtk cargo test'), null);

console.log('  ✓ RTK boundary anti-cat/anti-grep guardrail verified cleanly.');
console.log('\nAll test_guardrails_anti_cat tests passed!');
