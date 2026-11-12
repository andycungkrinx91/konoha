'use strict';

/**
 * test_lightweight_contracts.js
 *
 * Verifies that client instruction files (AGENTS.md, CLAUDE.md, GEMINI.md,
 * .cursorrules, .cursor/rules/konoha.mdc, .omp/agent/AGENTS.md, .codex/AGENTS.md)
 * are lightweight (< 1800 bytes), saving > 90% of file I/O tokens on cold start, while
 * preserving complete contract retrieval on-demand via konoha.get_skill.
 *
 * Tracked files are checked in the checkout. Client artifacts are git-ignored output of
 * `konoha init`, so they are generated into a temp HOME through the real deployers and
 * measured there — a clean checkout has no .cursor/, .omp/ or .codex/ tree.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const contract = require('../src/agent_contract');
const deploy = require('../src/agent_deployer');
const cursorManager = require('../src/cursor_manager');
const codexManager = require('../src/codex_manager');
const ompManager = require('../src/omp_manager');
const { getSkill } = require('../src/mcp/skills');
const { getCanonicalAgentNames } = require('../src/canonical_agents');

const ROOT = path.resolve(__dirname, '..');

console.log('Running test_lightweight_contracts.js...');

function assertLightweight(label, content) {
  const byteSize = Buffer.byteLength(content, 'utf8');
  assert.ok(
    byteSize < 1800,
    `${label} must be lightweight (< 1.8 KB / 1800 bytes), found ${byteSize} bytes`
  );
  const validation = contract.validateContractText(content);
  assert.ok(
    validation.ok,
    `${label} failed contract validation: ${validation.missing.join(', ')}`
  );
  console.log(`  ✓ ${label}: ${byteSize} bytes (< 1800 bytes) and contract validated`);
}

// Tracked instruction files, committed to the repo.
const trackedFiles = [
  'AGENTS.md',
  'GEMINI.md',
  'CLAUDE.md',
  '.cursorrules',
  path.join('src', 'templates', 'AGENTS.md'),
  path.join('src', 'templates', 'GEMINI.md')
];

for (const relPath of trackedFiles) {
  const fullPath = path.join(ROOT, relPath);
  assert.ok(fs.existsSync(fullPath), `${relPath} must exist on disk`);
  assertLightweight(relPath, fs.readFileSync(fullPath, 'utf8'));
}

// GEMINI.md is deploy-managed: it must equal what the generator would write, or the
// next project deploy silently overwrites the hand-edited bytes.
// Roster comes from the canonical source the deploy path renders when no user
// agents.yaml overrides exist, so an agent added there cannot drift past this test.
const roster = getCanonicalAgentNames().map((name) => ({ name }));
const generatedGemini = `<!-- KONOHA-START -->\n${deploy.generateGeminiMd(roster).trim()}\n<!-- KONOHA-END -->\n`;
assert.strictEqual(
  fs.readFileSync(path.join(ROOT, 'GEMINI.md'), 'utf8'),
  generatedGemini,
  'GEMINI.md must match generateGeminiMd output so deploy stays idempotent'
);

// Generated client artifacts live in git-ignored trees, so build them in a temp HOME
// through the same deployers `konoha init` runs and measure the result there.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-lightweight-'));
try {
  const generatedArtifacts = [
    {
      label: path.join('.cursor', 'rules', 'konoha.mdc'),
      write: () => assert.ok(cursorManager.deployCursorGlobalRule(roster, { home: tmpHome }), 'cursor rule deploy must succeed')
    },
    {
      label: path.join('.codex', 'AGENTS.md'),
      write: () => codexManager.writeCodexInstructions(deploy.generateAgentsMd(roster, 'codex'), { home: tmpHome })
    }
  ];

  for (const artifact of generatedArtifacts) {
    artifact.write();
    const fullPath = path.join(tmpHome, artifact.label);
    assert.ok(fs.existsSync(fullPath), `${artifact.label} must be written by the deployer`);
    assertLightweight(artifact.label, fs.readFileSync(fullPath, 'utf8'));
  }

  // OMP's file also carries the pinned `## Konoha Workflow Mandate (OMP)` section
  // (test_omp_manager.js asserts it), so its size is not a lightweight-contract
  // property. What must hold is that the deploy is idempotent and the contract
  // block it wraps is itself lightweight.
  const ompDeploy = ompManager.deployOmpContract({ home: tmpHome });
  assert.ok(ompDeploy.ok, 'OMP contract deploy must succeed');
  assert.strictEqual(ompDeploy.changed, true, 'OMP contract must be written on a fresh HOME');
  const ompPath = path.join(tmpHome, '.omp', 'agent', 'AGENTS.md');
  const ompContent = fs.readFileSync(ompPath, 'utf8');
  assert.ok(contract.validateContractText(ompContent).ok, 'OMP contract must validate');
  assert.match(ompContent, /## Konoha Workflow Mandate \(OMP\) — MANDATORY/, 'OMP file must carry the workflow mandate');
  assert.strictEqual(
    ompManager.deployOmpContract({ home: tmpHome }).changed,
    false,
    'OMP contract deploy must be idempotent'
  );
  console.log(`  ✓ ${path.join('.omp', 'agent', 'AGENTS.md')}: deployed, validated, idempotent`);
} finally {
  fs.rmSync(tmpHome, { recursive: true, force: true });
}

// The lightweight contract is what replaces on-disk rules on cold start, so its own
// size is the invariant every client must satisfy.
for (const client of ['cursor', 'codex', 'omp', 'claude', 'antigravity']) {
  const block = contract.buildLightweightContract({ client });
  const byteSize = Buffer.byteLength(block, 'utf8');
  assert.ok(byteSize < 1800, `lightweight contract for ${client} must be < 1800 bytes, found ${byteSize}`);
  assert.ok(contract.validateContractText(block).ok, `lightweight contract for ${client} must validate`);
}
console.log('  ✓ lightweight contract block is < 1800 bytes for every client');

// Verify on-demand full contract retrieval via get_skill
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

// Verify the standard message envelope ships with the canonical skill references
const formatPath = path.join(ROOT, 'src', 'templates', 'skills', 'konoha', 'references', 'task-format.md');
assert.ok(fs.existsSync(formatPath), 'konoha/task-format reference must exist');
const formatText = fs.readFileSync(formatPath, 'utf8');
for (const heading of ['**Feedback', '**Task', '**Rules', '**Result', '**Evidence', '**Blockers', '**Next']) {
  const line = new RegExp(`^${heading.replace(/\*/g, '\\*')}$`, 'm');
  assert.ok(line.test(formatText), `task-format must define ${heading} as a bare canonical line`);
  assert.ok(!formatText.includes(`${heading}**`), `task-format must not close ${heading} with asterisks`);
}
assert.ok(/konoha\/contract/.test(formatText), 'task-format must delegate canonical rules to konoha/contract');
for (const client of ['cursor', 'claude', 'antigravity', 'codex']) {
  assert.ok(
    contract.getClientContract(client).includes('Message format: **Feedback'),
    `full contract must advertise the message format for ${client}`
  );
}
console.log('  ✓ Standard message envelope present and advertised');

console.log('\nAll lightweight contract tests passed cleanly!');
