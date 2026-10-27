'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('../src/db');
const chuninKnowledge = require('../src/workflow/chunin-intel/chunin_knowledge');

async function testChuninKnowledge() {
  console.log('Running test_chunin_knowledge...');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunin_test_'));
  const testDbPath = path.join(tmpDir, 'konoha.db');
  process.env.KONOHA_DB_PATH = testDbPath;
  db.DB_PATH = testDbPath;

  try {
    const conn = db.getConnection(testDbPath, false);
    db.setupSchema(conn);
    conn.close();

    const memId = chuninKnowledge.saveChuninKnowledge({
      title: 'FastAPI vs Express Performance Benchmark',
      content: 'FastAPI demonstrates high async concurrency with Starlette, while Express is lightweight.',
      libraryName: 'fastapi',
      query: 'web framework benchmark',
      sourceUrls: ['https://fastapi.tiangolo.com/benchmarks'],
      projectPath: tmpDir,
      sessionId: 'sess_test_123',
      dbPath: testDbPath
    });

    assert(memId, 'saveChuninKnowledge should return a valid memory ID');
    console.log(`✓ Chunin research saved with ID: ${memId}`);

    const dupId = chuninKnowledge.saveChuninKnowledge({
      title: 'FastAPI vs Express Performance Benchmark Duplicate',
      content: 'FastAPI demonstrates high async concurrency with Starlette, while Express is lightweight.',
      libraryName: 'fastapi',
      query: 'web framework benchmark',
      sourceUrls: ['https://fastapi.tiangolo.com/benchmarks'],
      projectPath: tmpDir,
      sessionId: 'sess_test_123',
      dbPath: testDbPath
    });
    assert.strictEqual(dupId, null, 'Duplicate content should be deduplicated (return null)');
    console.log('✓ Duplicate knowledge deduplication verified');

    const matches = chuninKnowledge.findSimilarChuninKnowledge({
      query: 'FastAPI concurrency',
      projectPath: tmpDir,
      sessionId: 'sess_test_123',
      dbPath: testDbPath
    });

    assert(Array.isArray(matches), 'findSimilarChuninKnowledge should return an array');
    assert(matches.length > 0, 'Should find at least 1 similar knowledge item');
    assert.strictEqual(matches[0].agent_name, 'chunin', 'Saved agent_name must be chunin');
    assert.strictEqual(matches[0].memory_type, 'knowledge', 'Saved memory_type must be knowledge');
    assert(matches[0].content.includes('FastAPI'), 'Content must match');
    console.log(`✓ Similarity search found ${matches.length} matching knowledge records`);

    const reporting = require('../src/mcp/memory_reporting');
    const reportRes = reporting.reportFromAgent({
      agent: 'chunin',
      summary: 'Playwright test runner documentation and best practices',
      learnings: ['Use page.waitForLoadState before taking snapshots', 'Locator API handles auto-waiting'],
      validation: ['https://playwright.dev/docs/locators', 'npm test exited 0'],
      status: 'completed',
      project_path: tmpDir
    });

    const parsed = typeof reportRes === 'string' ? JSON.parse(reportRes) : reportRes;
    assert.strictEqual(parsed.status, 'recorded', 'report_from_agent must return recorded');
    console.log('✓ report_from_agent automatically persisted chunin research to canonical knowledge');

    const playwrightMatches = chuninKnowledge.findSimilarChuninKnowledge({
      libraryName: 'Playwright',
      projectPath: tmpDir,
      dbPath: testDbPath
    });
    assert(playwrightMatches.length > 0, 'Should find Playwright research in canonical knowledge');
    console.log('✓ Verified similarity retrieval on automated chunin report');

    console.log('All test_chunin_knowledge tests passed successfully!');
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

if (require.main === module) {
  testChuninKnowledge().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { testChuninKnowledge };
