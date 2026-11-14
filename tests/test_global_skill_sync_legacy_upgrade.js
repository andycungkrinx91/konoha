'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { syncAllGlobalClientSkills } = require('../src/global_skill_sync');

function main() {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-skill-legacy-'));
  try {
    // Pre-manifest v2.2.17 konoha/SKILL.md in Cursor & Gemini
    const legacyV2217 = [
      '---',
      'name: konoha',
      'description: Legacy v2.2.17 Konoha skill.',
      '---',
      '',
      '# 🍃 Konoha Maintenance & Engineering Skill (v2.2.17)',
      '',
      'Konoha serves ALL 48 canonical tools through standard MCP protocols.'
    ].join('\n');

    // Pre-frontmatter unversioned konoha/SKILL.md monolith in Pi
    const legacyMonolith = [
      '# 🍃 Konoha Maintenance & Engineering Skill',
      '',
      '2. **`semble`**: AI-powered semantic code search and dependency mapping.',
      'Konoha MCP Tools Orchestrator legacy monolith.'
    ].join('\n');

    // Pre-manifest legacy v2.2.18 jonin-skill in OMP
    const legacyJonin = [
      '---',
      'name: jonin-skill',
      'description: Standard Operating Procedures and router for premium UI development.',
      '---',
      '',
      '# Jonin: Elite UI & Frontend Builder',
      'Legacy v2.2.18 content.'
    ].join('\n');

    // Genuine user override in Claude (must NOT be overwritten)
    const userOverride = '# User Pre-Existing Genin Override\nMust stay completely untouched.\n';

    const cursorKonoha = path.join(tmpHome, '.cursor', 'skills', 'konoha', 'SKILL.md');
    const piKonoha = path.join(tmpHome, '.pi', 'agent', 'skills', 'konoha', 'SKILL.md');
    const ompJonin = path.join(tmpHome, '.omp', 'agent', 'skills', 'jonin-skill', 'SKILL.md');
    const claudeGenin = path.join(tmpHome, '.claude', 'skills', 'genin-skill', 'SKILL.md');

    for (const [filePath, body] of [
      [cursorKonoha, legacyV2217],
      [piKonoha, legacyMonolith],
      [ompJonin, legacyJonin],
      [claudeGenin, userOverride]
    ]) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, body, 'utf8');
    }

    const report = syncAllGlobalClientSkills({ homeDir: tmpHome });
    assert.strictEqual(report.ok, true, 'Legacy upgrade sync must succeed');
    assert.ok(report.skippedUserFiles >= 1, 'Custom user override must still be skipped');

    const upgradedCursor = fs.readFileSync(cursorKonoha, 'utf8');
    const upgradedPi = fs.readFileSync(piKonoha, 'utf8');
    const upgradedOmp = fs.readFileSync(ompJonin, 'utf8');
    const preservedUser = fs.readFileSync(claudeGenin, 'utf8');

    assert.ok(
      upgradedCursor.includes('56 canonical tools'),
      'Legacy v2.2.17 Cursor konoha/SKILL.md must upgrade to 56 canonical tools'
    );
    assert.ok(
      upgradedPi.includes('56 canonical tools'),
      'Legacy Pi monolith konoha/SKILL.md must upgrade to 56 canonical tools'
    );
    assert.ok(
      !upgradedOmp.includes('Legacy v2.2.18 content.'),
      'Legacy v2.2.18 OMP jonin-skill/SKILL.md must upgrade cleanly'
    );
    assert.strictEqual(
      preservedUser,
      userOverride,
      'Custom user override lacking Konoha signature must be preserved untouched'
    );

    console.log('✓ test_global_skill_sync_legacy_upgrade: All assertions passed.');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
}

main();
