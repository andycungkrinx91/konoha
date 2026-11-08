'use strict';

/**
 * Regression Test Suite: Zero Global `.gitignore` Pollution & Dynamic Project Scoping
 * Verifies:
 * 1. `detectAllClientFlags` defaults to global-only (`deployProject === false`, `appendProject === false`) unless `--project` is passed.
 * 2. `GLOBAL_GIT_EXCLUDE_PATTERNS` never contains `.omp/` or `.omp/.`.
 * 3. `sanitizePollutedProjectGitignore` removes previously injected Konoha plan blocks from unrelated projects while preserving user entries, and never alters the Konoha repository itself.
 * 4. `stripLegacyKonohaPreamble` strips legacy `# Custom Agent Rules for Konoha` / `Rule 3 — PLAN.md` blocks from global `AGENTS.md`/`GEMINI.md`.
 * 5. `resolveProjectAcceptanceCriteria` scopes Nuxt 3/Vue 3 and Konoha maintenance rules strictly to their matching project/task.
 * 6. `appendSessionFilter` enforces `project_hash` boundaries so project-specific rules never leak across unrelated repositories.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { detectAllClientFlags } = require('../bin/commands/init');
const deployUtils = require('../src/deploy_utils');
const { stripLegacyKonohaPreamble } = require('../src/agent_deployer');
const { resolveProjectAcceptanceCriteria, isKonohaRepository } = require('../src/workflow/kage-reviewer/sdlc_readiness');
const { appendSessionFilter } = require('../src/persona_memory_items');

function runTests() {
  // CLI init flags default to global-only
  const defaultFlags = detectAllClientFlags(['--client=antigravity']);
  assert.strictEqual(defaultFlags.deployProject, false, 'init --client=antigravity must NOT deploy project files by default');
  assert.strictEqual(defaultFlags.appendProject, false, 'init --client=antigravity must NOT append project files by default');

  const explicitProjectFlags = detectAllClientFlags(['--client=antigravity', '--project']);
  assert.strictEqual(explicitProjectFlags.deployProject, true, 'init --project must enable deployProject when explicitly requested');

  // Global git excludes must not pollute `.omp/` or `PLAN.md`
  const patterns = deployUtils.GLOBAL_GIT_EXCLUDE_PATTERNS || [];
  assert.ok(!patterns.includes('.omp/'), 'GLOBAL_GIT_EXCLUDE_PATTERNS must not include .omp/');
  assert.ok(!patterns.includes('.omp/.'), 'GLOBAL_GIT_EXCLUDE_PATTERNS must not include .omp/.');
  assert.ok(!patterns.includes('PLAN.md'), 'GLOBAL_GIT_EXCLUDE_PATTERNS must not include PLAN.md');

  // sanitizePollutedProjectGitignore cleans unrelated projects while preserving user lines
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-gitignore-test-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'user-nextjs-app', version: '1.0.0' }, null, 2));
    const pollutedGitignore = [
      'node_modules/',
      '.next/',
      '.env.local',
      '',
      '# Consolidated Plan Ignore Block (Mandatory Konoha Invariant)',
      '/PLAN.md',
      'PLAN.md',
      '/.omp/plans/',
      '.omp/plans/',
      '.omp/plans',
      '.omp/.',
      '',
      'dist/'
    ].join('\n');
    const gitignorePath = path.join(tmpDir, '.gitignore');
    fs.writeFileSync(gitignorePath, pollutedGitignore, 'utf8');

    const res = deployUtils.sanitizePollutedProjectGitignore(tmpDir);
    assert.strictEqual(res.modified, true, 'Should detect and clean polluted .gitignore in non-Konoha project');
    const cleanedText = fs.readFileSync(gitignorePath, 'utf8');
    assert.ok(!cleanedText.includes('Consolidated Plan Ignore Block'), 'Polluted header must be removed');
    assert.ok(!cleanedText.includes('.omp/.'), '.omp/. must be removed');
    assert.ok(!cleanedText.includes('/PLAN.md'), '/PLAN.md must be removed from unrelated project');
    assert.ok(cleanedText.includes('node_modules/'), 'User node_modules/ entry must be preserved');
    assert.ok(cleanedText.includes('dist/'), 'User dist/ entry must be preserved');

    // Idempotency check
    const secondRun = deployUtils.sanitizePollutedProjectGitignore(tmpDir);
    assert.strictEqual(secondRun.modified, false, 'Second run on clean .gitignore must be a no-op');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // Verify Konoha repository itself is recognized and never stripped of its local maintenance ignore rules
  const konohaRoot = path.resolve(__dirname, '..');
  assert.strictEqual(isKonohaRepository(konohaRoot), true, 'Konoha repo must be identified as Konoha repository');
  const konohaSanitize = deployUtils.sanitizePollutedProjectGitignore(konohaRoot);
  assert.strictEqual(konohaSanitize.modified, false, 'Konoha repository .gitignore must not be stripped');

  // stripLegacyKonohaPreamble removes leaked Rule 3 & legacy unclosed GEMINI blocks
  const pollutedGlobalDoc = [
    '# Custom Agent Rules for Konoha',
    '### Rule 3 — PLAN.md First, Never Commit Plans',
    '/PLAN.md',
    '.omp/.',
    '<!-- KONOHA-START -->',
    '# Global Agent Instructions',
    '<!-- KONOHA-END -->',
    'User custom notes below'
  ].join('\n');
  const stripped = stripLegacyKonohaPreamble(pollutedGlobalDoc);
  assert.ok(!stripped.includes('Rule 3 — PLAN.md First'), 'Legacy Rule 3 preamble must be stripped from global instructions');
  assert.ok(stripped.includes('User custom notes below'), 'User content after KONOHA-END must be preserved');

  // Dynamic project acceptance criteria scoping
  const unrelatedCriteria = resolveProjectAcceptanceCriteria({ task: 'Build a SvelteKit landing page' }, '/tmp/some-user-app');
  assert.strictEqual(unrelatedCriteria.isKonohaRepo, false);
  assert.strictEqual(unrelatedCriteria.applyNuxtVueCriteria, false);
  assert.strictEqual(unrelatedCriteria.requiresKonohaMaintenancePlan, false);
  assert.strictEqual(unrelatedCriteria.requiresPlanGitignoreBlock, false);

  const nuxtCriteria = resolveProjectAcceptanceCriteria({ task: 'Build a Nuxt 3 e-commerce storefront', framework: 'nuxt' }, '/tmp/nuxt-shop');
  assert.strictEqual(nuxtCriteria.applyNuxtVueCriteria, true);
  assert.strictEqual(nuxtCriteria.requiresKonohaMaintenancePlan, false);

  // Session & project_hash isolation in persona_memory_items
  const filterAll = appendSessionFilter({ allSessions: true, pHash: 'proj_abc123' });
  assert.ok(filterAll.clause.includes('project_hash = ?'), 'allSessions must still scope by project_hash when provided');
  assert.deepStrictEqual(filterAll.params, ['proj_abc123']);

  console.log('✓ test_gitignore_no_pollution: All assertions passed.');
}

runTests();
