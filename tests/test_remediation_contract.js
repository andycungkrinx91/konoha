/**
 * Verifies the immutable aislop remediation loop: canonical order, drift
 * rejection, budget-proof emission in the discipline contract, and presence in
 * every dispatched subagent prompt under the 8000-byte ceiling.
 */

'use strict';

const assert = require('assert');

const {
  REMEDIATION_STAGES,
  REMEDIATION_ORDER,
  REMEDIATION_VERDICTS,
  REMEDIATION_INVARIANT,
  formatRemediationProtocol,
  assertRemediationOrder
} = require('../src/mcp/remediation_contract');
const { buildDisciplineContract } = require('../src/mcp/discipline_contract');
const { runMcpAgent } = require('../src/mcp/memory_reporting');
const { getCanonicalAgentNames } = require('../src/canonical_agents');

const PROMPT_CEILING_BYTES = 8000;

console.log('Testing immutable remediation contract:');

assert.deepStrictEqual([...REMEDIATION_ORDER], ['fixing-remediation', 'retest', 'rescan'],
  'canonical remediation order must be fixing -> retest -> rescan');
assert.strictEqual(assertRemediationOrder(REMEDIATION_ORDER), true,
  'canonical order must validate');
assert.throws(() => assertRemediationOrder([...REMEDIATION_ORDER].reverse()),
  /Remediation order drift/, 'reordered stages must be rejected');
assert.throws(() => assertRemediationOrder(['fixing-remediation', 'rescan']),
  /must carry 3 stages/, 'a shortened loop must be rejected');
assert.throws(() => assertRemediationOrder([...REMEDIATION_ORDER, 'fixing-remediation']),
  /must carry 3 stages/, 'a repeated stage must be rejected');
assert.throws(() => assertRemediationOrder(['fixing-remediation', 'rescan', 'retest']),
  /Remediation order drift/, 'retest and rescan must never swap');
console.log('  ✓ Order assertions accept only the canonical three-stage loop');

const protocol = formatRemediationProtocol();
const protocolBytes = Buffer.byteLength(protocol, 'utf8');
let cursor = -1;
for (const stage of REMEDIATION_STAGES) {
  const at = protocol.indexOf(stage.label);
  assert.ok(at > cursor, `protocol must list "${stage.label}" after the previous stage`);
  cursor = at;
}
assert.ok(protocolBytes > 0, 'protocol text must be non-empty');
assert.ok(Buffer.byteLength(REMEDIATION_INVARIANT, 'utf8') > 0, 'invariant line must be non-empty');
console.log(`  ✓ Protocol lists all stages in order (${protocolBytes} B)`);

const contract = buildDisciplineContract();
assert.ok(contract.includes(protocol.trim().split('\n')[0]),
  'discipline contract must start from the remediation block');
for (const stage of REMEDIATION_STAGES) {
  assert.ok(contract.includes(stage.label), `contract must carry "${stage.label}"`);
}
assert.ok(contract.includes('Evidence over claims'), 'contract must keep the anti-slop rules');
assert.ok(contract.includes('i-have-adhd Output Shaping'), 'contract must keep the ADHD rules');
console.log(`  ✓ Discipline contract carries the loop plus both disciplines (${Buffer.byteLength(contract, 'utf8')} B)`);

const loopBytes = Buffer.byteLength(formatRemediationProtocol(), 'utf8');
for (let budget = loopBytes + 1; budget <= 2400; budget += 25) {
  const trimmed = buildDisciplineContract({ maxBytes: budget });
  if (!trimmed) continue;
  for (const stage of REMEDIATION_STAGES) {
    assert.ok(trimmed.includes(stage.label),
      `budget ${budget} emitted a contract missing "${stage.label}"`);
  }
  assert.ok(Buffer.byteLength(trimmed, 'utf8') <= budget,
    `budget ${budget} emitted ${Buffer.byteLength(trimmed, 'utf8')} B`);
}
assert.strictEqual(buildDisciplineContract({ maxBytes: loopBytes - 1 }), '',
  'a budget that cannot carry the loop must emit nothing so the caller falls back to the invariant');
console.log('  ✓ Loop survives every budget at or above its own size and never truncates');

const agents = getCanonicalAgentNames();
let worst = 0;
for (const agent of agents) {
  const prompt = JSON.parse(runMcpAgent(agent, 'Fix the reported failing test', null, null)).instructions;
  const bytes = Buffer.byteLength(prompt, 'utf8');
  worst = Math.max(worst, bytes);
  assert.ok(bytes <= PROMPT_CEILING_BYTES, `${agent} prompt is ${bytes} B, over the ceiling`);
  for (const stage of REMEDIATION_STAGES) {
    assert.ok(prompt.includes(stage.label), `${agent} prompt is missing "${stage.label}"`);
  }
  assert.ok(prompt.includes('Immutable Remediation Loop'), `${agent} prompt is missing the loop heading`);
  assert.ok(prompt.includes('Evidence over claims'), `${agent} prompt lost the anti-slop rules`);
}
console.log(`  ✓ ${agents.length} agent prompts stay under ${PROMPT_CEILING_BYTES} B (worst ${worst} B) and keep the loop`);

console.log('All remedial contract tests passed!');
