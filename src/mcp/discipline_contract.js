'use strict';

/**
 * Bounded discipline contract injected into every subagent dispatch.
 *
 * The full antislop and i-have-adhd skills total ~70 KB, far beyond the
 * subagent prompt ceiling, so they are distilled here into their operative
 * rules. The text is constant, which keeps it cache-friendly, and it accepts a
 * byte budget so the caller can fit it inside the whole-prompt token guardrail
 * rather than silently overshooting it.
 *
 * Wording is terse on purpose: every byte here competes with task instructions
 * under an 8 KB ceiling, and the rules stay operative when compressed.
 */

const { formatRemediationProtocol } = require('./remediation_contract');

const MAX_CONTRACT_BYTES = 2400;

const ADHD_RULES = [
  'Lead with the next action, not context.',
  'Number multi-step work explicitly.',
  'End with exactly one next action.',
  'Mention only what the task needs.',
  'Restate current state each turn.',
  'Estimate time or effort concretely.',
  'Make completed work visible.',
  'State cause and fix for errors; no apology.',
  'Cap lists at five items.',
  'No preamble, recap, or pleasantries.'
];

const ANTISLOP_RULES = [
  'Evidence over claims: verify before reporting success.',
  'No placeholder handlers, empty catches, or TODO stubs.',
  'No default-framework look, uniform card grids, or gradients.',
  'Layout driven by real data, never filler.',
  'Handle failure paths; never swallow errors silently.',
  'No filler phrasing, "seamlessly leverage" copy, or emoji decoration.',
  'Real labels, focus states, semantic elements.',
  'Specific to purpose, never a copied template.'
];

/**
 * Build the invariant discipline block appended to every subagent prompt.
 *
 * Anti-slop rules are emitted first because they gate correctness and are
 * worth more under truncation than the output-shaping rules. When the budget
 * is too small to carry the antislop section, an empty string is returned so
 * the caller can fall back to a compact reminder instead of shipping a stub.
 *
 * @param {{ includeAdhd?: boolean, includeAntislop?: boolean, maxBytes?: number }} options
 * @returns {string} Contract text, or an empty string when it cannot fit.
 */
function buildDisciplineContract({ includeAdhd = true, includeAntislop = true, maxBytes = MAX_CONTRACT_BYTES } = {}) {
  const budget = Number.isFinite(maxBytes) ? Math.floor(maxBytes) : MAX_CONTRACT_BYTES;
  if (budget <= 0) return '';

  // The remediation loop is immutable, so it is emitted first and never
  // truncated: a budget that cannot carry it in full returns nothing and lets
  // the caller fall back to the standalone invariant line.
  const remediation = formatRemediationProtocol();
  if (budget <= Buffer.byteLength(remediation, 'utf8')) return '';

  const parts = [remediation];

  if (includeAntislop) {
    parts.push('## Anti-Slop Mandate (every response and artifact)');
    parts.push(ANTISLOP_RULES.map((r) => `- ${r}`).join('\n'));
  }

  if (includeAdhd) {
    parts.push('## i-have-adhd Output Shaping');
    parts.push(ADHD_RULES.map((r) => `- ${r}`).join('\n'));
  }

  const text = parts.join('\n');
  if (Buffer.byteLength(text, 'utf8') <= budget) return text;
  return capText(text, budget);
}

/**
 * Compact one-line fallback used when the full contract will not fit.
 * Kept small so it survives the tightest budget.
 */
const COMPACT_REMINDER = 'Discipline: verify before claiming success; no stubs or empty catches; no filler. '
  + 'Lead with the next action, cap lists at five, end with one next step.';

function capText(text, maxBytes) {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  const lines = text.split('\n');
  const kept = [];
  let size = 0;
  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line + '\n', 'utf8');
    if (size + lineBytes > maxBytes) break;
    kept.push(line);
    size += lineBytes;
  }
  return kept.join('\n');
}

module.exports = {
  MAX_CONTRACT_BYTES,
  COMPACT_REMINDER,
  ADHD_RULES,
  ANTISLOP_RULES,
  buildDisciplineContract
};
