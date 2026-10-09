#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const { getDb, setupSchema, hasFts5Support } = db;

function runTests() {
  console.log('Running test_fts5_fallback.js...');

  // Test 1: hasFts5Support function existence and behavior
  assert.strictEqual(typeof hasFts5Support, 'function', 'hasFts5Support must be exported as a function');
  assert.strictEqual(hasFts5Support(null), false, 'hasFts5Support(null) must return false');
  assert.strictEqual(hasFts5Support({}), false, 'hasFts5Support({}) must return false');

  const liveConn = getDb(':memory:');
  const liveSupported = hasFts5Support(liveConn);
  console.log(`  ✓ Host SQLite FTS5 support: ${liveSupported}`);

  // Test 2: Standard schema initialization on live connection
  setupSchema(liveConn);
  const tables = liveConn.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual')").all().map(r => r.name);
  assert.ok(tables.includes('skills'), 'skills table must exist');
  assert.ok(tables.includes('skill_chunks'), 'skill_chunks table must exist');
  assert.ok(tables.includes('tool_calls'), 'tool_calls table must exist');
  assert.ok(tables.includes('persona_memories'), 'persona_memories table must exist');

  if (liveSupported) {
    assert.ok(tables.includes('skills_fts'), 'skills_fts virtual table must exist when FTS5 supported');
    assert.ok(tables.includes('persona_memories_fts'), 'persona_memories_fts virtual table must exist when FTS5 supported');
  }
  liveConn.close();

  // Test 3: Schema initialization when FTS5 is unavailable (mocked)
  const noFtsConn = getDb(':memory:');
  noFtsConn._mockFts5Disabled = true;
  assert.strictEqual(hasFts5Support(noFtsConn), false, 'hasFts5Support must return false when disabled');

  // setupSchema must execute without throwing ERR_SQLITE_ERROR
  assert.doesNotThrow(() => {
    setupSchema(noFtsConn);
  }, 'setupSchema must not throw even when FTS5 is not available');

  const noFtsTables = noFtsConn.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual')").all().map(r => r.name);
  assert.ok(noFtsTables.includes('skills'), 'skills table must exist');
  assert.ok(noFtsTables.includes('skill_chunks'), 'skill_chunks table must exist');
  assert.ok(noFtsTables.includes('tool_calls'), 'tool_calls table must exist');
  assert.ok(noFtsTables.includes('agents'), 'agents table must exist');
  assert.ok(noFtsTables.includes('projects'), 'projects table must exist');
  assert.ok(noFtsTables.includes('persona_memories'), 'persona_memories table must exist');
  assert.ok(noFtsTables.includes('prompt_queue'), 'prompt_queue table must exist');

  assert.strictEqual(noFtsTables.includes('skills_fts'), false, 'skills_fts must NOT exist when FTS5 is missing');
  assert.strictEqual(noFtsTables.includes('persona_memories_fts'), false, 'persona_memories_fts must NOT exist when FTS5 is missing');

  // Verify triggers are not present
  const noFtsTriggers = noFtsConn.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map(r => r.name);
  assert.strictEqual(noFtsTriggers.includes('skills_ai'), false, 'skills_ai trigger must not exist without FTS5');
  assert.strictEqual(noFtsTriggers.includes('skills_ad'), false, 'skills_ad trigger must not exist without FTS5');
  assert.strictEqual(noFtsTriggers.includes('skills_au'), false, 'skills_au trigger must not exist without FTS5');

  // Test 4: Inserting and updating skills on a non-FTS5 connection
  assert.doesNotThrow(() => {
    noFtsConn.prepare(`
      INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('test-skill', 'test-skill', 'skill', 'testing,fts5', '# Test Skill Content', '/path/test', 100, 10);
  }, 'Inserting into skills without FTS5 must succeed without trigger errors');

  const inserted = noFtsConn.prepare("SELECT * FROM skills WHERE name = ?").get('test-skill');
  assert.ok(inserted, 'Skill must be successfully stored in database');
  assert.strictEqual(inserted.skill_name, 'test-skill');

  // Test 5: Fallback transition from FTS5 to non-FTS5 host
  // Simulate a database migrated on an FTS5 machine where triggers existed, then opened on a non-FTS host
  const migratedConn = getDb(':memory:');
  migratedConn.exec(`
    CREATE TABLE skills (name TEXT PRIMARY KEY, skill_name TEXT, type TEXT, tags TEXT, content TEXT, file_path TEXT, byte_size INT, line_count INT);
    CREATE TRIGGER skills_ai AFTER INSERT ON skills BEGIN
      INSERT INTO missing_fts VALUES (new.name);
    END;
  `);

  migratedConn._mockFts5Disabled = true;
  setupSchema(migratedConn);

  // After setupSchema cleans up orphaned triggers, inserting into skills must not fail
  assert.doesNotThrow(() => {
    migratedConn.prepare(`
      INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('migrated-skill', 'migrated-skill', 'skill', 'tag', 'content', '/p', 10, 1);
  }, 'Inserting into skills after trigger cleanup must succeed');

  migratedConn.close();
  noFtsConn.close();

  console.log('  ✓ All FTS5 fallback and non-FTS SQLite compatibility assertions passed.');
}

runTests();
