#!/usr/bin/env node
'use strict';

/**
 * tests/test_akatsuki_skill_references.js — Verifies Akatsuki skill reference parity,
 * 1:1 curated tool registry coverage, blue-team references, domain routing,
 * and byte-identical synchronization across all mirror trees.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { CURATED_TOOL_REGISTRY } = require('../src/workflow/akatsuki/tool_profiles');

console.log('Running test_akatsuki_skill_references.js...');

const ROOT = path.resolve(__dirname, '..');
const CANONICAL_DIR = path.join(ROOT, 'src', 'templates', 'skills', 'akatsuki-skill');
const CANONICAL_SKILL_MD = path.join(CANONICAL_DIR, 'SKILL.md');
const TOOLS_DIR = path.join(CANONICAL_DIR, 'references', 'tools');
const BLUE_DIR = path.join(CANONICAL_DIR, 'references', 'blue-team');

assert.ok(fs.existsSync(CANONICAL_SKILL_MD), 'Canonical akatsuki-skill/SKILL.md must exist');
assert.ok(fs.existsSync(TOOLS_DIR), 'akatsuki-skill/references/tools must exist');
assert.ok(fs.existsSync(BLUE_DIR), 'akatsuki-skill/references/blue-team must exist');

// 1. Verify 1:1 tool registry mapping
const registryToolIds = new Set(Object.keys(CURATED_TOOL_REGISTRY));
const toolFiles = fs.readdirSync(TOOLS_DIR).filter(f => f.endsWith('.md'));
const toolReferenceIds = new Set(toolFiles.map(f => f.replace(/\.md$/, '')));

for (const toolId of registryToolIds) {
  assert.ok(
    toolReferenceIds.has(toolId),
    `Tool "${toolId}" in CURATED_TOOL_REGISTRY is missing corresponding reference at references/tools/${toolId}.md`
  );
}

for (const refId of toolReferenceIds) {
  assert.ok(
    registryToolIds.has(refId),
    `Tool reference "${refId}.md" does not exist in CURATED_TOOL_REGISTRY`
  );
}
console.log(`  ✓ 1:1 Tool registry parity verified (${registryToolIds.size} tools in registry and references)`);

// 2. Verify all 6 blue-team capability references
const EXPECTED_BLUE_TEAM = [
  'sast-static-analysis.md',
  'secret-leakage-audit.md',
  'dependency-cve-audit.md',
  'skill-guardian-perimeter.md',
  'config-hardening.md',
  'security-final-gate.md'
];

for (const blueFile of EXPECTED_BLUE_TEAM) {
  const full = path.join(BLUE_DIR, blueFile);
  assert.ok(fs.existsSync(full), `Blue-team capability reference missing: ${blueFile}`);
}
console.log(`  ✓ All ${EXPECTED_BLUE_TEAM.length} blue-team capability references present`);

// 3. Verify Domain Routing table in canonical SKILL.md
const skillMdContent = fs.readFileSync(CANONICAL_SKILL_MD, 'utf8');

for (const toolId of registryToolIds) {
  const route = `akatsuki-skill/tools/${toolId}`;
  assert.ok(
    skillMdContent.includes(route),
    `SKILL.md domain routing table missing route for tool: ${route}`
  );
}

for (const blueFile of EXPECTED_BLUE_TEAM) {
  const slug = blueFile.replace(/\.md$/, '');
  const route = `akatsuki-skill/blue-team/${slug}`;
  assert.ok(
    skillMdContent.includes(route),
    `SKILL.md domain routing table missing route for blue-team: ${route}`
  );
}
console.log('  ✓ Domain routing table contains all tools and blue-team capability routes');

// 4. Verify byte-identical synchronization across all client mirror trees
const MIRROR_TREES = [
  path.join(ROOT, '.agents', 'skills', 'akatsuki-skill'),
  path.join(ROOT, '.cursor', 'skills', 'akatsuki-skill'),
  path.join(ROOT, '.gemini', 'skills', 'akatsuki-skill'),
  path.join(ROOT, '.commandcode', 'skills', 'akatsuki-skill'),
  path.join(ROOT, '.claude', 'skills', 'akatsuki-skill'),
  path.join(ROOT, '.omp', 'skills', 'akatsuki-skill')
];

function getAllFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllFiles(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

const canonicalFiles = getAllFiles(CANONICAL_DIR);

for (const mirrorDir of MIRROR_TREES) {
  if (!fs.existsSync(mirrorDir)) continue;
  const relMirror = path.relative(ROOT, mirrorDir);

  for (const canFile of canonicalFiles) {
    const relFile = path.relative(CANONICAL_DIR, canFile);
    const mirrorFile = path.join(mirrorDir, relFile);
    assert.ok(
      fs.existsSync(mirrorFile),
      `Mirror ${relMirror} missing file: ${relFile}`
    );
    const canBuf = fs.readFileSync(canFile);
    const mirBuf = fs.readFileSync(mirrorFile);
    assert.ok(
      canBuf.equals(mirBuf),
      `Mirror file ${path.join(relMirror, relFile)} is not byte-identical to canonical`
    );
  }
  console.log(`  ✓ Mirror ${relMirror} byte-identical with canonical`);
}

console.log('\n✅ All Akatsuki skill reference and mirror parity checks passed!\n');
