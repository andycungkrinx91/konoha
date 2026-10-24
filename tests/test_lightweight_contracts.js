'use strict';

/**
 * test_lightweight_contracts.js
 *
 * Verifies that on-disk client instruction files (AGENTS.md, CLAUDE.md, GEMINI.md,
 * .cursorrules, .cursor/rules/konoha.mdc, .omp/agent/AGENTS.md, .codex/AGENTS.md)
 * are lightweight (< 2KB), saving > 90% of file I/O tokens on cold start, while
 * preserving complete contract retrieval on-demand via konoha.get_skill.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const contract = require('../src/agent_contract');
const { getSkill } = require('../src/mcp/skills');

const ROOT = path.resolve(__dirname, '..');

console.log('Running test_lightweight_contracts.js...');

// 1. Verify on-disk file sizes (< 2KB)
const filesToCheck = [
  'AGENTS.md',
  'GEMINI.md',
  'CLAUDE.md',
  '.cursorrules',
  path.join('.cursor', 'rules', 'konoha.mdc'),
  path.join('.omp', 'agent', 'AGENTS.md'),
  path.join('.omp', 'AGENTS.md'),
  path.join('.codex', 'AGENTS.md'),
  path.join('src', 'templates', 'AGENTS.md'),
  path.join('src', 'templates', 'GEMINI.md')
];

for (const relPath of filesToCheck) {
  const fullPath = path.join(ROOT, relPath);
  assert.ok(fs.existsSync(fullPath), `${relPath} must exist on disk`);
  const content = fs.readFileSync(fullPath, 'utf8');
  const byteSize = Buffer.byteLength(content, 'utf8');
  assert.ok(
    byteSize < 1228,
    `${relPath} must be lightweight (< 1.2 KB / 1228 bytes), found ${byteSize} bytes`
  );
  const validation = contract.validateContractText(content);
  assert.ok(
    validation.ok,
    `${relPath} failed contract validation: ${validation.missing.join(', ')}`
  );
  console.log(`  ✓ ${relPath}: ${byteSize} bytes (< 1.2KB) and contract validated`);
}

// 2. Verify on-demand full contract retrieval via get_skill
const contractSkillJson = getSkill('konoha/contract');
assert.ok(contractSkillJson, 'get_skill("konoha/contract") must return result');
const contractSkill = JSON.parse(contractSkillJson);
assert.strictEqual(contractSkill.name, 'konoha/contract');
assert.strictEqual(contractSkill.type, 'reference');
assert.ok(contractSkill.content, 'Contract content must not be empty');
assert.ok(contractSkill.content.includes('Konoha runtime contract'), 'Must include runtime contract header');
assert.ok(contractSkill.content.includes('Ninja Team Roster'), 'Must include ninja team roster');
assert.ok(contractSkill.content.includes('Dual-Track Execution Engine'), 'Must include pipeline engine spec');
console.log(`  ✓ On-demand full contract retrieval verified (${contractSkill.content.length} chars)`);

console.log('\nAll lightweight contract tests passed cleanly!');
