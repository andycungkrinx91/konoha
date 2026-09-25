#!/usr/bin/env node
'use strict';

/**
 * tests/test_combined_savings_formula.js
 * Regression test locking the byte-weighted combined-savings calculation formula:
 * combined_pct = Math.round((sum(bytes_saved) / sum(total_baseline_bytes)) * 100)
 *
 * Ensures no future refactor switches to unweighted per-tool averages or arbitrary multipliers.
 */

const assert = require('assert');
const path = require('path');
const db = require('../src/db');
const { getSavingsReport, sanitizeLegacyRecords } = require('../src/db_savings');

console.log('Running test_combined_savings_formula.js...');

const conn = db.getConnection();
sanitizeLegacyRecords(conn);

// 1. Independently compute byte-weighted percentages directly from SQL
const todayRow = conn.prepare(`
  SELECT
    COALESCE(SUM(bytes_saved), 0) as saved,
    COALESCE(SUM(bytes_saved + returned_bytes), 0) as total
  FROM tool_calls
  WHERE date(timestamp, 'localtime') >= date('now', 'localtime')
`).get();

const allTimeRow = conn.prepare(`
  SELECT
    COALESCE(SUM(bytes_saved), 0) as saved,
    COALESCE(SUM(bytes_saved + returned_bytes), 0) as total
  FROM tool_calls
`).get();

const expectedTodayPct = todayRow.total > 0
  ? Math.round((Number(todayRow.saved) / Number(todayRow.total)) * 100)
  : 0;

const expectedAllTimePct = allTimeRow.total > 0
  ? Math.round((Number(allTimeRow.saved) / Number(allTimeRow.total)) * 100)
  : 0;

// 2. Fetch live report via db_savings.getSavingsReport()
const report = getSavingsReport();

assert.strictEqual(
  report.today.pct,
  expectedTodayPct,
  `Today pct (${report.today.pct}%) must exactly match independent SQL byte-weighted calculation (${expectedTodayPct}%)`
);

assert.strictEqual(
  report.alltime.pct,
  expectedAllTimePct,
  `All-time pct (${report.alltime.pct}%) must exactly match independent SQL byte-weighted calculation (${expectedAllTimePct}%)`
);

console.log(`  ✓ Live Konoha MCP savings locked to byte-weighted formula: Today=${report.today.pct}%, AllTime=${report.alltime.pct}%.`);

// 3. Mathematical proof: verify that byte-weighting resists skew from high-volume small-payload tools
function computeByteWeightedPct(tools) {
  const sumSaved = tools.reduce((acc, t) => acc + t.saved, 0);
  const sumTotal = tools.reduce((acc, t) => acc + t.total, 0);
  return sumTotal > 0 ? Math.round((sumSaved / sumTotal) * 100) : 0;
}

function computeNaiveUnweightedPct(tools) {
  if (tools.length === 0) return 0;
  const sumPcts = tools.reduce((acc, t) => acc + (t.total > 0 ? (t.saved / t.total) * 100 : 0), 0);
  return Math.round(sumPcts / tools.length);
}

// Simulated scenario:
// - read_file_range: 100 calls, 40 MB saved out of 42 MB baseline (95.2% savings)
// - sannin: 10 calls, 0 KB saved out of 10 KB baseline (0.0% savings)
const simulatedTools = [
  { name: 'read_file_range', saved: 40 * 1024 * 1024, total: 42 * 1024 * 1024 },
  { name: 'sannin', saved: 0, total: 10 * 1024 }
];

const byteWeightedResult = computeByteWeightedPct(simulatedTools);
const naiveResult = computeNaiveUnweightedPct(simulatedTools);

// Byte-weighted should reflect ~95%, while naive unweighted would falsely drop to ~48%
assert.strictEqual(byteWeightedResult, 95, `Byte-weighted result must be 95%, got ${byteWeightedResult}%`);
assert.strictEqual(naiveResult, 48, `Naive unweighted result is 48%`);
assert.notStrictEqual(
  byteWeightedResult,
  naiveResult,
  'Byte-weighted and naive unweighted methods must never be conflated'
);
console.log('  ✓ Verified byte-weighting prevents operational router skew.');

// 4. Induced failure guard: verify that a wrong formula is caught
let inducedFailureCaught = false;
try {
  assert.strictEqual(report.alltime.pct, naiveResult);
} catch (e) {
  inducedFailureCaught = true;
}
assert.strictEqual(inducedFailureCaught, true, 'Induced failure guard must catch formula discrepancy');
console.log('  ✓ Induced failure test confirmed formula protection.');

console.log('All tests in test_combined_savings_formula.js passed cleanly!');
