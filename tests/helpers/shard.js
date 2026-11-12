'use strict';

// Splits a CI run across machines. Kept separate from run_all.js so the
// partition can be checked without executing the suite.
//
// Round-robin rather than contiguous: the discovery order is alphabetical and
// the slow suites are not spread evenly through it, so contiguous chunks hand
// one shard most of the long ones. Striding needs no duration data and is
// deterministic, so two runs of the same commit always produce the same shards.
function selectShard(items, index, count) {
  return items.filter((_, i) => i % count === index - 1);
}

// Accepts only "I/N" with integers, 1 <= I <= N. A typo must fail the run: the
// previous version silently ran every suite when the value did not parse, which
// looks like a full green run and hides that sharding is not happening.
function parseShard(value) {
  const match = /^(\d+)\/(\d+)$/.exec(String(value == null ? '' : value).trim());
  if (!match) {
    throw new Error(`shard selector expects I/N (for example 2/6), got "${value}"`);
  }
  const index = Number(match[1]);
  const count = Number(match[2]);
  if (count < 1) throw new Error(`shard count must be at least 1, got ${count}`);
  if (index < 1 || index > count) {
    throw new Error(`shard index must be between 1 and ${count}, got ${index}`);
  }
  return { index, count };
}

module.exports = { selectShard, parseShard };
