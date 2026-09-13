#!/usr/bin/env node
// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

/**
 * tests/test_sdlc_cross_provider.js — Tests Cross-Provider Review Independence.
 * Covers Phase 4, Phase 5, Phase 9 of PLAN_NATIVE_SDLC.md:
 * - detectReviewIndependence logic (different models -> cross-provider, same model -> self)
 * - Prefix and naming normalization (mcp_anbu, delegate_to_anbu)
 * - Project config review_mode persistence
 * - CLI konoha project set review-mode
 * - Doctor checks for cross-provider bridge setup and anti-slop skill
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');
const sdlc = require('../src/sdlc_manager');
const { getDiagnostics } = require('../src/doctor');

async function run() {
  console.log('Running test_sdlc_cross_provider tests...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc_cross_provider_test_'));
  const testDbPath = path.join(tmpDir, 'test_cross.db');

  try {
    const conn = new Database(testDbPath);
    conn.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        model TEXT,
        skills TEXT
      );
      CREATE TABLE IF NOT EXISTS bridges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        enabled INTEGER DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS projects (
        project_hash TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        project_name TEXT NOT NULL,
        framework TEXT DEFAULT 'Unknown',
        styling TEXT DEFAULT 'Standard CSS',
        package_manager TEXT DEFAULT 'pnpm',
        context_summary TEXT DEFAULT '',
        tech_stack TEXT DEFAULT '{}',
        dor_mode TEXT DEFAULT 'advisory',
        review_mode TEXT DEFAULT 'self',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // 1. Cross-Provider Independence Detection with different models
    conn.prepare(`
      INSERT INTO agents (name, model, skills) VALUES
        ('kage', 'anthropic/claude-3-7-sonnet', 'kage-skill, anti-slop'),
        ('anbu', 'openai/gpt-4o', 'anbu-skill'),
        ('jonin', 'openai/gpt-4o', 'jonin-skill'),
        ('genin', 'anthropic/claude-3-7-sonnet', 'genin-skill')
    `).run();

    // implementing=anbu (gpt-4o), reviewer=kage (claude) => cross-provider
    const crossRes1 = sdlc.detectReviewIndependence('anbu', 'kage', testDbPath);
    assert.strictEqual(crossRes1.isCrossProvider, true);
    assert.strictEqual(crossRes1.reviewMode, 'cross-provider');
    assert.strictEqual(crossRes1.reviewerModel, 'anthropic/claude-3-7-sonnet');
    assert.strictEqual(crossRes1.implementingModel, 'openai/gpt-4o');
    console.log('✓ Cross-provider detection with different models passed');

    // 2. Same Provider / Model fallback to 'self'
    // implementing=genin (claude), reviewer=kage (claude) => self
    const sameRes = sdlc.detectReviewIndependence('genin', 'kage', testDbPath);
    assert.strictEqual(sameRes.isCrossProvider, false);
    assert.strictEqual(sameRes.reviewMode, 'self');
    console.log('✓ Same-provider fallback to self passed');

    // 3. Prefix handling (mcp_anbu, delegate_to_jonin)
    const prefixRes1 = sdlc.detectReviewIndependence('mcp_anbu', 'kage', testDbPath);
    assert.strictEqual(prefixRes1.isCrossProvider, true);
    const prefixRes2 = sdlc.detectReviewIndependence('delegate_to_jonin', 'kage', testDbPath);
    assert.strictEqual(prefixRes2.isCrossProvider, true);
    console.log('✓ Agent prefix normalization passed');

    // 4. Missing agent / default model fallback
    const missingRes = sdlc.detectReviewIndependence('unknown_ninja', 'kage', testDbPath);
    assert.strictEqual(missingRes.isCrossProvider, false);
    assert.strictEqual(missingRes.reviewMode, 'self');
    console.log('✓ Missing agent fallback passed');

    // 5. Project Config review_mode persistence
    const projPath = '/path/to/my/project';
    const initialConfig = sdlc.getProjectSdlcConfig(projPath, testDbPath);
    assert.strictEqual(initialConfig.review_mode, 'self');

    sdlc.setProjectSdlcConfig(projPath, { review_mode: 'cross-provider' }, testDbPath);
    const updatedConfig = sdlc.getProjectSdlcConfig(projPath, testDbPath);
    assert.strictEqual(updatedConfig.review_mode, 'cross-provider');
    console.log('✓ Project SDLC review_mode persistence passed');

    // 6. CLI: konoha project set review-mode
    const cliRes = execSync('node bin/cli.js project set review-mode cross-provider', { encoding: 'utf8' });
    const cleanCliRes = cliRes.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(cleanCliRes.includes('Set review-mode') || cleanCliRes.includes('cross-provider'));

    const cliReset = execSync('node bin/cli.js project set review-mode self', { encoding: 'utf8' });
    const cleanCliReset = cliReset.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(cleanCliReset.includes('Set review-mode') || cleanCliReset.includes('self'));
    console.log('✓ CLI konoha project set review-mode passed');

    // 7. Doctor SDLC Checks
    conn.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // Test doctor output in active env
  const docRes = getDiagnostics();
  assert.ok(docRes && Array.isArray(docRes.results));
  const crossCheck = docRes.results.find(r => r.component === 'Cross-Provider Review Setup');
  assert.ok(crossCheck, 'Should include Cross-Provider Review Setup check');
  assert.ok(crossCheck.status === 'INFO' || crossCheck.status === 'HEALTHY');

  const antislopCheck = docRes.results.find(r => r.component === 'Anti-Slop Gate (Kage)');
  assert.ok(antislopCheck, 'Should include Anti-Slop Gate (Kage) check');
  console.log('✓ Doctor SDLC advisory checks passed');

  console.log('All test_sdlc_cross_provider tests passed cleanly!\n');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
