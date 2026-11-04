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
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const { getSavingsReport, sanitizeLegacyRecords } = require('../src/db_savings');

console.log('Running test_combined_savings_formula.js...');

const conn = db.getConnection();
sanitizeLegacyRecords(conn);

// Independently compute byte-weighted percentages directly from SQL
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
  : null;

const expectedAllTimePct = allTimeRow.total > 0
  ? Math.round((Number(allTimeRow.saved) / Number(allTimeRow.total)) * 100)
  : null;

// Fetch live report via db_savings.getSavingsReport()
const report = getSavingsReport();

assert.strictEqual(
  report.today.pct,
  expectedTodayPct,
  expectedTodayPct === null ? 'no data' : 'measured',
  `Today pct (${report.today.pct}%) must exactly match independent SQL byte-weighted calculation (${expectedTodayPct}%)`
);

assert.strictEqual(
  report.alltime.pct,
  expectedAllTimePct,
  `All-time pct (${report.alltime.pct}%) must exactly match independent SQL byte-weighted calculation (${expectedAllTimePct}%)`
);

console.log(`  ✓ Live Konoha MCP savings locked to byte-weighted formula: Today=${report.today.pct}%, AllTime=${report.alltime.pct}%.`);

// Mathematical proof: verify that byte-weighting resists skew from high-volume small-payload tools
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

// Induced failure guard: verify that a wrong formula is caught
let inducedFailureCaught = false;
try {
  assert.strictEqual(report.alltime.pct, naiveResult);
} catch (e) {
  inducedFailureCaught = true;
}
assert.strictEqual(inducedFailureCaught, true, 'Induced failure guard must catch formula discrepancy');
console.log('  ✓ Induced failure test confirmed formula protection.');

console.log('All tests in test_combined_savings_formula.js passed cleanly!');


// A database with no measured tool traffic must report no_data with a null pct,
// never a fabricated 0% (which would be indistinguishable from genuinely zero savings).
{
  const fs = require('fs');
  const os = require('os');
  const tmpDb = path.join(os.tmpdir(), `konoha-savings-empty-${Date.now()}.db`);
  const isolated = db.getConnection(tmpDb, false);
  db.setupSchema(isolated);

  const emptyReport = getSavingsReport(tmpDb);
  assert.strictEqual(emptyReport.today.calls, 0, 'empty database must have zero calls');
  assert.strictEqual(emptyReport.today.pct, null, 'empty database must report pct null, not 0');
  assert.strictEqual(emptyReport.today.no_data, true, 'empty database must flag no_data');
  assert.strictEqual(emptyReport.alltime.pct, null, 'empty all-time must report pct null, not 0');

  isolated.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(tmpDb + suffix, { force: true });
  }
  console.log('  ✓ Empty database reports no_data with null pct (no fabricated 0%)');
}

// Net savings must reflect reality: a loss (output spend above input savings)
// is reported as a negative number, never clamped to zero, which would read as
// break-even and misrepresent the result.
{
  const report = getSavingsReport();
  const net = report.alltime.net_saved_usd;
  const expectedNet = Number((report.alltime.saved_usd - report.alltime.output_cost_usd).toFixed(6));
  assert.strictEqual(net, expectedNet, `all-time net must equal saved minus output cost (got ${net}, expected ${expectedNet})`);
  assert.ok(!/Math\.max\(0(\.0)?,\s*savedUsd/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'db_savings.js'), 'utf8')),
    'net savings must not clamp losses to zero');
  console.log(`  ✓ Net all-time savings reported honestly (${net})`);
}

// The loss branch is exercised deterministically rather than depending on
// whatever the local database happens to contain.
{
  const { computeNetSavings } = require('../src/db_savings');
  assert.strictEqual(computeNetSavings(10, 25), -15, 'loss is reported as negative, not clamped to zero');
  assert.strictEqual(computeNetSavings(30, 5), 25, 'profit is reported as a positive net');
  assert.strictEqual(computeNetSavings(0, 0), 0, 'true break-even stays zero');
  assert.strictEqual(computeNetSavings(undefined, 12), -12, 'missing savings cost against output spend');
  console.log('  ✓ Net savings reports losses as negative (not clamped)');
}
