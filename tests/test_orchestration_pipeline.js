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

  // 1. Verify Sannin skill enforces canonical 8-phase pipeline
  const sanninSkillPath = path.join(rootDir, '.agents', 'skills', 'sannin-skill', 'SKILL.md');
  assert.ok(fs.existsSync(sanninSkillPath), 'sannin-skill/SKILL.md must exist');
  const sanninContent = fs.readFileSync(sanninSkillPath, 'utf-8');

  assert.ok(sanninContent.includes('Phase 1: Route & Discovery'));
  assert.ok(sanninContent.includes('Phase 2: Foundation & Planning'));
  assert.ok(sanninContent.includes('Phase 3: Intel & Research'));
  assert.ok(sanninContent.includes('Phase 4: Backend & Database Execution'));
  assert.ok(sanninContent.includes('Phase 5: Frontend & UI Execution'));
  assert.ok(sanninContent.includes('Phase 6: QA Automation & Documentation'));
  assert.ok(sanninContent.includes('Phase 7: Pre-Delivery Review & Security Gate'));
  assert.ok(sanninContent.includes('Phase 8: Synthesis & Delivery Sign-Off'));
  console.log('✓ Sannin canonical 8-phase pipeline verification passed');

  // 2. Verify orchestrator code and templates
  const serverJsPath = path.join(rootDir, 'src', 'server.js');
  const konohaSkillPath = path.join(rootDir, 'src', 'templates', 'skills', 'konoha', 'SKILL.md');

  assert.ok(fs.existsSync(serverJsPath), 'server.js must exist');
  assert.ok(fs.existsSync(konohaSkillPath), 'konoha/SKILL.md must exist');

  const serverContent = fs.readFileSync(serverJsPath, 'utf-8');
  const skillContent = fs.readFileSync(konohaSkillPath, 'utf-8');

  assert.ok(serverContent.includes('Deep Research'));
  assert.ok(serverContent.toLowerCase().includes('chunin'));

  assert.ok(skillContent.includes('Deep Research (@chunin)'));
  assert.ok(skillContent.includes('Code Exploration (@genin)'));
  assert.ok(skillContent.includes('Architecture & Quality Gates (@kage)'));
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
