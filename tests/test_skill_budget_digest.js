/**
 * test_skill_budget_digest.js
 *
 * get_skill(name, { tokenBudget }) must return a budgeted digest of the whole
 * skill. It used to return only the document preamble: the section slicer ran
 * on a null section request, which resolves to rawSections[0]. A caller that
 * asked for 1,500 tokens got 250 and silently lost every invariant.
 */

'use strict';

const assert = require('assert');
const path = require('path');

const { truncateSkillContent } = require(path.join(__dirname, '..', 'src', 'mcp', 'skills_retrieval'));

const SECTION_BYTES = 3000;
const body = [
  '# Demo Skill\n\nIntro text that is not a section.\n',
  '## Alpha\n' + 'a'.repeat(SECTION_BYTES),
  '## Beta\n' + 'b'.repeat(SECTION_BYTES),
  '## Gamma\n' + 'g'.repeat(SECTION_BYTES)
].join('\n');

console.log('Testing budgeted skill digests:');

// A budgeted request keeps head, middle, and tail of the document.
const budgeted = truncateSkillContent(body, 'demo', 1500, null);
const budgetBytes = Math.min(1500 * 4, 8000);
assert.ok(budgeted.truncated, 'A 9 KB skill under a 1,500-token budget must report truncation');
assert.ok(
  Buffer.byteLength(budgeted.finalContent, 'utf8') <= budgetBytes,
  `Digest must respect the byte budget (got ${Buffer.byteLength(budgeted.finalContent, 'utf8')} > ${budgetBytes})`
);
assert.ok(budgeted.finalContent.includes('## Alpha'), 'Digest must keep the first section');
assert.ok(budgeted.finalContent.includes('## Gamma'), 'Digest must keep the last section');
assert.ok(
  budgeted.finalContent.includes('## Beta') || /sections omitted/.test(budgeted.finalContent),
  'Digest must keep the middle section or name it as omitted'
);
assert.ok(budgeted.remainingSections.length > 0, 'Digest must list the sections a caller can still load');
console.log(`  ✓ Budgeted digest keeps head/middle/tail within ${budgetBytes} bytes.`);

// A preamble-only answer is the regression this test exists for.
const preambleOnly = truncateSkillContent(body, 'demo', 1500, null).finalContent
  .split('\n').filter((l) => l.startsWith('## ')).length;
assert.ok(preambleOnly > 0, 'Digest must contain at least one section heading');
console.log('  ✓ Digest is not a preamble-only stub.');

// An explicit section request returns that section and nothing else.
const section = truncateSkillContent(body, 'demo', 0, 'Gamma');
assert.ok(section.finalContent.startsWith('## Gamma'), 'Section request must return the requested section');
assert.ok(!section.finalContent.includes('## Alpha'), 'Section request must not include other sections');
assert.ok(!section.finalContent.includes('## Beta'), 'Section request must not include other sections');
console.log('  ✓ Section request returns exactly the requested section.');

// A section larger than the budget is still capped.
const huge = '## Huge\n' + 'x'.repeat(20000);
const capped = truncateSkillContent(huge, 'demo', 500, 'Huge');
assert.ok(
  Buffer.byteLength(capped.finalContent, 'utf8') <= 2000,
  'A section request with a token budget must not exceed the budget'
);
assert.ok(capped.truncated, 'A capped section must report truncation');
console.log('  ✓ Oversized sections are capped to the budget.');

console.log('\nAll test_skill_budget_digest tests passed!');
