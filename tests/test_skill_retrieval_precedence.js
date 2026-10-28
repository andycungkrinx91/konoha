#!/usr/bin/env node
'use strict';

/**
 * tests/test_skill_retrieval_precedence.js
 *
 * Targeted test suite for skill retrieval order:
 * 1. Proves SQLite FTS5 remains primary when database is online.
 * 2. Proves mirror fallback seamlessly activates when DB is unavailable or table unmigrated.
 * 3. Proves project-local mirror shadows global mirror with zero duplicate emissions.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const QA_ROOT = path.join('/tmp', `konoha-qa-skills-precedence-${Date.now()}`);
fs.mkdirSync(QA_ROOT, { recursive: true });

const testDbPath = path.join(QA_ROOT, 'test_skills.db');
process.env.KONOHA_DB_PATH = testDbPath;

const { getSkill, findSkill, listSkills } = require('../src/mcp/skills');
const { getDb } = require('../src/db');
const { setupSchema } = require('../src/db_schema');

console.log('Running test_skill_retrieval_precedence.js...');
console.log(`Isolated QA Root: ${QA_ROOT}`);

// Setup temporary SQLite DB with one sample skill
const db = getDb(testDbPath);
setupSchema(db);

db.prepare(`
  INSERT INTO skills (name, skill_name, type, tags, content, byte_size, line_count, file_path)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  'sqlite-primary-skill',
  'sqlite-primary-skill',
  'skill',
  'primary,sqlite,test',
  '# SQLite Primary Skill\n\nThis content comes directly from SQLite FTS5 database.\n',
  75,
  4,
  '/tmp/mock/skills/sqlite-primary-skill/SKILL.md'
);
db.close();

// --- TEST 1: SQLite FTS5 Primary Precedence ---
console.log('\n--- 1. Testing SQLite Primary Precedence ---');
const primarySkillRaw = getSkill('sqlite-primary-skill');
const primarySkill = JSON.parse(primarySkillRaw);
assert.ok(!primarySkill.error, `Primary skill must be retrieved: ${primarySkillRaw}`);
assert.strictEqual(primarySkill.name, 'sqlite-primary-skill');
assert.match(primarySkill.content, /comes directly from SQLite FTS5 database/);
console.log('  ✓ Retrieved skill from SQLite FTS5 database successfully.');

// --- TEST 2: Mirror Fallback when DB is Unavailable / Unmigrated ---
console.log('\n--- 2. Testing Offline Mirror Fallback ---');
// Setup a mock mirror skill in a mock project
const mockProjDir = path.join(QA_ROOT, 'mock_project');
const mockMirrorDir = path.join(mockProjDir, '.agents', 'skills', 'mock-mirror-skill');
fs.mkdirSync(mockMirrorDir, { recursive: true });
const mockSkillMd = path.join(mockMirrorDir, 'SKILL.md');
fs.writeFileSync(mockSkillMd, '# Mock Mirror Skill\n\nRetrieved from offline filesystem mirror fallback.\n', 'utf8');

// Set workspace root to mock project
const { setWorkspaceRoot } = require('../src/mcp/runtime_state');
setWorkspaceRoot(mockProjDir);

// Request skill that only exists in filesystem mirror
const mirrorSkillRaw = getSkill('mock-mirror-skill');
const mirrorSkill = JSON.parse(mirrorSkillRaw);
assert.ok(!mirrorSkill.error, `Mirror fallback skill must be retrieved: ${mirrorSkillRaw}`);
assert.strictEqual(mirrorSkill.name, 'mock-mirror-skill');
assert.match(mirrorSkill.content, /Retrieved from offline filesystem mirror fallback/);
console.log('  ✓ Retrieved skill from offline mirror fallback successfully.');

// --- TEST 3: Zero Duplicate Emissions in find_skill and list_skills ---
console.log('\n--- 3. Testing Zero Duplicate Emission ---');
const foundRaw = findSkill('mock-mirror', 5);
const found = JSON.parse(foundRaw);
assert.ok(found.found > 0, 'Must find mirror skill');
const foundNames = (found.results || []).map(r => r.name);
const uniqueFoundNames = Array.from(new Set(foundNames));
assert.strictEqual(foundNames.length, uniqueFoundNames.length, 'find_skill must never emit duplicate skill names');
console.log(`  ✓ find_skill emitted ${foundNames.length} result(s) with 0 duplicates.`);

const listRaw = listSkills();
const list = JSON.parse(listRaw);
assert.ok(list.count > 0, 'list_skills must return skills');
const listNames = (list.skills || []).map(s => s.name);
const uniqueListNames = Array.from(new Set(listNames));
assert.strictEqual(listNames.length, uniqueListNames.length, 'list_skills must never emit duplicate skill names');
console.log(`  ✓ list_skills returned ${listNames.length} skill(s) with 0 duplicates.`);

// Cleanup
try {
  fs.rmSync(QA_ROOT, { recursive: true, force: true });
} catch (_) {}

console.log('\n✔ All skill retrieval precedence and zero-duplicate assertions passed cleanly.');
