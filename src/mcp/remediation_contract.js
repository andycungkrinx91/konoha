'use strict';

/**
 * Immutable remediation protocol for static-analysis verdicts.
 *
 * `aislop` reports errors, warnings, and failures that are only closed by a
 * sequence, never by a single edit: the cause is fixed, the covering test is
 * retested, and the same scope is rescanned until the finding is absent.
 * Encoding the sequence as one ordered constant keeps every client surface —
 * discipline contract, delegation envelope, direct-mode guidance — from
 * inventing its own order or skipping a stage.
 */

const REMEDIATION_STAGES = Object.freeze([
  Object.freeze({
    id: 'fixing-remediation',
    label: 'Fixing remediation',
    rule: 'fix the cause at the reported file:line; never suppress or baseline'
  }),
  Object.freeze({
    id: 'retest',
    label: 'Retest',
    rule: 're-run the covering test/build; keep the exit code'
  }),
  Object.freeze({
    id: 'rescan',
    label: 'Rescan',
    rule: 're-run npx aislop on the same scope; the finding must be gone'
  })
]);

const REMEDIATION_ORDER = Object.freeze(REMEDIATION_STAGES.map((stage) => stage.id));

const REMEDIATION_VERDICTS = Object.freeze(['error', 'warning', 'failure']);

const REMEDIATION_INVARIANT = 'aislop findings ⇒ fixing remediation → retest → rescan; no success claim before a clean rescan.';

const REMEDIATION_HEADING = '## Immutable Remediation Loop (aislop error/warning/failure)';

function formatRemediationProtocol() {
  const steps = REMEDIATION_STAGES.map((stage, index) => `${index + 1}. ${stage.label} — ${stage.rule}.`);
  return `${REMEDIATION_HEADING}\n${steps.join('\n')}`;
}

/**
 * Guard the sequence against drift. Callers that assemble their own wording
 * run their stage ids through this so a reorder fails loudly instead of
 * silently shipping a weaker protocol.
 *
 * @param {string[]} sequence
 * @returns {true}
 */
function assertRemediationOrder(sequence) {
  const given = Array.isArray(sequence) ? sequence.map(String) : [];
  if (given.length !== REMEDIATION_ORDER.length) {
    throw new Error(`Remediation loop must carry ${REMEDIATION_ORDER.length} stages, received ${given.length}.`);
  }
  for (let index = 0; index < REMEDIATION_ORDER.length; index += 1) {
    const expected = REMEDIATION_ORDER[index];
    if (given[index] !== expected) {
      throw new Error(`Remediation order drift at position ${index}: expected "${expected}", received "${given[index]}". The loop is immutable: fixing remediation → retest → rescan.`);
    }
  }
  return true;
}

module.exports = {
  REMEDIATION_STAGES,
  REMEDIATION_ORDER,
  REMEDIATION_VERDICTS,
  REMEDIATION_INVARIANT,
  formatRemediationProtocol,
  assertRemediationOrder
};
