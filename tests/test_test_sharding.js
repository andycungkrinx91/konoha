'use strict';

// The shard selector decides what CI runs, so its two failure modes are worth a
// test: a partition that drops or repeats a suite, and a selector that a typo can
// turn into a green run of nothing. Both are checked against the real harness as
// well, because the helper being right does not prove run_all.js consults it.

const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');
const { selectShard, parseShard } = require('./helpers/shard');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✔ ${name}`);
}

const suites = Array.from({ length: 287 }, (_, i) => `suite_${i}.js`);

check('shards partition the suite list exactly once', () => {
  for (const count of [1, 2, 3, 4, 6, 8, 13]) {
    const seen = [];
    for (let index = 1; index <= count; index++) seen.push(...selectShard(suites, index, count));
    assert.deepStrictEqual(seen.slice().sort(), suites.slice().sort(), `${count} shards`);
    assert.strictEqual(new Set(seen).size, suites.length, `${count} shards repeat a suite`);
  }
});

check('shard sizes differ by at most one', () => {
  for (const count of [4, 6, 8]) {
    const sizes = Array.from({ length: count }, (_, i) => selectShard(suites, i + 1, count).length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `${count}: ${sizes.join(',')}`);
  }
});

check('selection is deterministic across runs', () => {
  assert.deepStrictEqual(selectShard(suites, 3, 8), selectShard(suites, 3, 8));
});

check('malformed selectors are rejected rather than ignored', () => {
  for (const bad of ['', 'abc', '2', '2/', '/2', '2/0', '0/2', '9/8', '1.5/2']) {
    assert.throws(() => parseShard(bad), /shard/, `accepted ${JSON.stringify(bad)}`);
  }
});

check('a valid selector is parsed', () => {
  assert.deepStrictEqual(parseShard('3/8'), { index: 3, count: 8 });
  assert.deepStrictEqual(parseShard(' 3/8 '), { index: 3, count: 8 });
});

const harness = path.join(__dirname, 'run_all.js');
// A filter that matches exactly one suite, so the empty-shard case below cannot
// drift into a non-empty one when another suite with a similar name is added.
function runHarness(env) {
  return spawnSync(process.execPath, [harness, 'test_docs_freshness_api'], {
    encoding: 'utf8',
    timeout: 300000,
    env: { ...process.env, ...env }
  });
}

check('the harness refuses an empty shard instead of reporting it green', () => {
  const result = runHarness({ KONOHA_TEST_SHARD: '6/6' });
  assert.strictEqual(result.status, 2, `exit ${result.status}\n${result.stdout}${result.stderr}`);
  assert.match(result.stderr, /selected 0 of \d+ suites/);
});

check('the harness refuses a malformed shard instead of running everything', () => {
  const result = runHarness({ KONOHA_TEST_SHARD: 'nonsense' });
  assert.strictEqual(result.status, 2, `exit ${result.status}`);
  assert.match(result.stderr, /shard selector expects I\/N/);
  assert.doesNotMatch(result.stdout, /\[SUITE\]/, 'ran suites despite an invalid selector');
});

console.log(`\n${passed} passed`);
