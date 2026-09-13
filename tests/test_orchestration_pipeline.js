#!/usr/bin/env node
// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function run() {
  console.log('Running test_orchestration_pipeline tests...');
  const rootDir = path.resolve(__dirname, '..');

  // 1. Verify Sannin skill enforces 6-step sequential pipeline
  const sanninSkillPath = path.join(rootDir, '.agents', 'skills', 'sannin-skill', 'SKILL.md');
  assert.ok(fs.existsSync(sanninSkillPath), 'sannin-skill/SKILL.md must exist');
  const sanninContent = fs.readFileSync(sanninSkillPath, 'utf-8');

  assert.ok(sanninContent.includes('Step 1: Deep Research (Chunin)'));
  assert.ok(sanninContent.includes('Step 2: Code Exploration (Genin)'));
  assert.ok(sanninContent.includes('Step 3: Architecture & Planning (Kage)'));
  assert.ok(sanninContent.includes('Step 4: Execution'));
  assert.ok(sanninContent.includes('Step 5: Documentation & Refinement (Tokubetsu-Jonin)'));
  assert.ok(sanninContent.includes('Step 6: Final Report (Sannin)'));
  console.log('✓ Sannin 6-step sequential pipeline verification passed');

  // 2. Verify orchestrator code and templates
  const serverJsPath = path.join(rootDir, 'src', 'server.js');
  const konohaSkillPath = path.join(rootDir, 'src', 'templates', 'skills', 'konoha', 'SKILL.md');

  assert.ok(fs.existsSync(serverJsPath), 'server.js must exist');
  assert.ok(fs.existsSync(konohaSkillPath), 'konoha/SKILL.md must exist');

  const serverContent = fs.readFileSync(serverJsPath, 'utf-8');
  const skillContent = fs.readFileSync(konohaSkillPath, 'utf-8');

  assert.ok(serverContent.includes('Deep Research'));
  assert.ok(serverContent.toLowerCase().includes('chunin'));

  assert.ok(skillContent.includes('Deep Research (Chunin)'));
  assert.ok(skillContent.includes('Code Exploration (Genin)'));
  assert.ok(skillContent.includes('Architecture & Planning (Kage)'));
  console.log('✓ Global orchestrator rules & templates passed');

  console.log('\nAll test_orchestration_pipeline tests passed!');
}

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
