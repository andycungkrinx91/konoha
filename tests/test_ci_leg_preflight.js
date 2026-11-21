#!/usr/bin/env node
'use strict';

/**
 * tests/test_ci_leg_preflight.js
 *
 * `scripts/sandbox_preflight.js` reports which of the three local CI legs this
 * host can actually run. The report is only useful if it covers all three legs,
 * never throws on a host missing prerequisites, and never reports a leg as
 * available without the ingredients that leg needs.
 *
 * Also pins the documentation contract for the macOS leg: a host that cannot
 * provide a macOS kernel has an allowed `proxy-verified` state, and docs/CI.md
 * must document the `dockur/macos` guest and its 4 GB floor so the next reader
 * does not rediscover it.
 */

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'sandbox_preflight.js');
const CI_DOC = path.join(ROOT, 'docs', 'CI.md');

function runJson() {
  const out = execFileSync(process.execPath, [SCRIPT, '--json'], { encoding: 'utf8', timeout: 60000 });
  return JSON.parse(out);
}

console.log('Running test_ci_leg_preflight: local CI leg availability...');

assert.ok(fs.existsSync(SCRIPT), 'scripts/sandbox_preflight.js must exist');

const report = runJson();
const legs = report.legs.map(entry => entry.leg).sort();
assert.deepStrictEqual(legs, ['linux', 'macos', 'windows'], `preflight must report all three legs, got ${legs.join(', ')}`);
console.log('  ok   preflight reports linux, windows and macos');

const allowed = new Set(['AVAILABLE', 'BLOCKED', 'UNAVAILABLE']);
for (const entry of report.legs) {
  assert.ok(allowed.has(entry.state), `${entry.leg} has an unknown state ${entry.state}`);
  assert.ok(typeof entry.detail === 'string' && entry.detail.length > 0, `${entry.leg} must explain its state`);
}
console.log('  ok   every leg carries a state and a reason');

// A BLOCKED macOS leg must name a concrete blocker a reader can act on. RAM is
// only one of them: a runner can be blocked on /dev/kvm, AVX2 or /dev/net/tun
// first, and this host's own 2 GB shortfall is not universal.
const macos = report.legs.find(entry => entry.leg === 'macos');
if (process.platform !== 'darwin' && macos.state === 'BLOCKED') {
  assert.ok(
    /\/dev\/kvm|AVX2|\/dev\/net\/tun|docker|allocatable/.test(macos.detail),
    `a blocked macOS leg must name a concrete blocker, got: ${macos.detail}`
  );
  if (/allocatable/.test(macos.detail)) {
    assert.ok(/GB/.test(macos.detail), 'a RAM shortfall must be quoted in GB');
  }
  assert.ok(/dockur\/macos/.test(macos.detail), 'a blocked macOS leg must name dockur/macos');
  console.log(`  ok   macos blocked with a named blocker: ${macos.detail.split(';').pop().trim()}`);
} else {
  console.log(`  note macos is ${macos.state} on this host; shortfall wording not asserted`);
}

// The proxy is an allowed state, so the script must not fail the build for it.
assert.ok(!/Error/.test(JSON.stringify(report)), 'preflight reported an internal error');
console.log('  ok   a missing local leg does not error the report');

const doc = fs.readFileSync(CI_DOC, 'utf8');
assert.ok(/dockur\/macos/.test(doc), 'docs/CI.md must document the dockur/macos leg');
assert.ok(/RAM_MINIMUM/.test(doc), 'docs/CI.md must record the RAM_MINIMUM override and why it is not recommended');
assert.ok(/proxy-verified/.test(doc), 'docs/CI.md must state that proxy-verified is an allowed macOS state on a non-Apple host');
assert.ok(/127\.0\.0\.1:8007:8006/.test(doc), 'the documented compose must not collide with the Windows VM on 8006');
console.log('  ok   docs/CI.md carries the macOS VM section, the RAM floor and the proxy state');

console.log('\nAll test_ci_leg_preflight checks passed successfully!');
