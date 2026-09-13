#!/usr/bin/env node
// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

/**
 * tests/test_pi_contract_dedup.js — Verifies the Pi AGENTS.md managed-contract fix.
 *
 * Legacy bug: deployPiContract concatenated the Pi workflow addendum AFTER the
 * managed markers (buildMainAgentContract + buildPiWorkflowAddendum), so every
 * redeploy appended a fresh mandate copy while stale copies survived outside
 * the markers. Production showed 166 copies (~410KB) burning ~100K tokens per
 * Pi session.
 *
 * The fix keeps the addendum INSIDE the managed block and strips every stale
 * '## Konoha Workflow Mandate (Pi)' section from the file body before writing.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Override HOME before requiring src modules so the test never touches the
// real ~/.pi/agent/AGENTS.md.
const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-pi-contract-'));
process.env.HOME = TEST_HOME;
if (process.env.USERPROFILE) process.env.USERPROFILE = TEST_HOME;

const piManager = require('../src/pi_manager');

let passed = 0;
let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function mandateCount(content) {
  return (content.match(/^## Konoha Workflow Mandate \(Pi\)/gm) || []).length;
}

(async () => {
  console.log('Pi contract dedup tests\n========================\n');

  const agentsMd = path.join(TEST_HOME, '.pi', 'agent', 'AGENTS.md');

  // T1: legacy duplication is repaired on deploy.
  const legacyDir = path.join(TEST_HOME, '.pi', 'agent');
  fs.mkdirSync(legacyDir, { recursive: true });
  const staleMandate = [
    '',
    '## Konoha Workflow Mandate (Pi) — MANDATORY',
    '',
    '- Stale copy A: route through the village.',
    '- Stale copy A: never free-run.',
    '',
  ].join('\n');
  const legacyBody = [
    '<!-- KONOHA-CONTRACT-START -->',
    '## Konoha runtime contract (2.0.0-cross-client-1)',
    'managed body',
    '<!-- KONOHA-CONTRACT-END -->',
    staleMandate,
    staleMandate,
    staleMandate,
    'User content after the block.',
  ].join('\n');
  fs.writeFileSync(agentsMd, legacyBody, 'utf-8');

  const r1 = piManager.deployPiContract(false);
  const c1 = fs.readFileSync(agentsMd, 'utf-8');
  check('T1 deploy succeeds', r1.ok === true, JSON.stringify(r1));
  check('T1 stale mandates stripped (3 legacy copies removed)', mandateCount(c1) === 1, `count=${mandateCount(c1)}`);
  check('T1 exactly one managed block', (c1.match(/KONOHA-CONTRACT-START/g) || []).length === 1);
  check('T1 mandate lives inside markers', c1.indexOf('## Konoha Workflow Mandate (Pi)') < c1.indexOf('<!-- KONOHA-CONTRACT-END -->'));
  check('T1 user content preserved', c1.includes('User content after the block.'));
  check('T1 contract body present', c1.includes('Konoha runtime contract'));

  // T2: redeploy is idempotent — file size and mandate count stay stable.
  const size1 = fs.statSync(agentsMd).size;
  const r2 = piManager.deployPiContract(false);
  const c2 = fs.readFileSync(agentsMd, 'utf-8');
  check('T2 redeploy reports no change', r2.ok === true && r2.changed === false, JSON.stringify(r2));
  check('T2 file size stable', fs.statSync(agentsMd).size === size1);
  check('T2 still exactly one mandate', mandateCount(c2) === 1, `count=${mandateCount(c2)}`);

  // T3: 50 simulated legacy redeploys still collapse to one mandate.
  let bloated = fs.readFileSync(agentsMd, 'utf-8');
  for (let i = 0; i < 50; i++) bloated += staleMandate;
  fs.writeFileSync(agentsMd, bloated, 'utf-8');
  piManager.deployPiContract(false);
  const c3 = fs.readFileSync(agentsMd, 'utf-8');
  check('T3 50 stale copies collapse to one', mandateCount(c3) === 1, `count=${mandateCount(c3)}`);
  check('T3 size back to canonical', Math.abs(fs.statSync(agentsMd).size - size1) <= 2);

  // T4: fresh install (no file) gets a single managed block.
  fs.rmSync(agentsMd);
  piManager.deployPiContract(false);
  const c4 = fs.readFileSync(agentsMd, 'utf-8');
  check('T4 fresh deploy single mandate', mandateCount(c4) === 1, `count=${mandateCount(c4)}`);
  check('T4 fresh deploy has markers', c4.includes('<!-- KONOHA-CONTRACT-START -->') && c4.includes('<!-- KONOHA-CONTRACT-END -->'));

  // Cleanup
  fs.rmSync(TEST_HOME, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
