#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../src/db');
const server = require('../src/server');
const personaMemory = require('../src/persona_memory');

async function testStructuredDelegation() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-struct-del-'));
  const dbPath = path.join(tmpDir, 'test_skills.db');
  const prevDbPath = db.DB_PATH;
  const prevServerDb = server.DB_PATH;
  const prevPersonaDb = personaMemory.DB_PATH;

  try {
    db.DB_PATH = dbPath;
    server.DB_PATH = dbPath;
    personaMemory.DB_PATH = dbPath;

    const conn = db.getConnection(dbPath);
    conn.prepare(`
      CREATE TABLE IF NOT EXISTS agents (
        name TEXT PRIMARY KEY,
        title TEXT,
        purpose TEXT,
        skills TEXT,
        constraints_text TEXT,
        instructions TEXT,
        model_tier TEXT
      )
    `).run();

    conn.prepare(`
      INSERT OR REPLACE INTO agents (name, title, purpose, skills, constraints_text, instructions, model_tier)
      VALUES ('jonin', 'Jonin UI Master', 'Frontend implementation', '[]', 'Light mode only', 'Build clean UI', 'Pro')
    `).run();

    conn.prepare(`
      INSERT OR REPLACE INTO agents (name, title, purpose, skills, constraints_text, instructions, model_tier)
      VALUES ('anbu', 'Anbu Black Ops', 'Backend & Security', '[]', 'Zero CVEs', 'Write secure APIs', 'Pro')
    `).run();

    conn.close();

    // 1. Direct structured delegation jonin
    const projectDir1 = path.join(tmpDir, 'test_project_1');
    fs.mkdirSync(projectDir1, { recursive: true });
    fs.writeFileSync(path.join(projectDir1, 'package.json'), JSON.stringify({
      name: 'konoha-showroom',
      dependencies: { next: '16.0.0', tailwindcss: '^4.0.0' }
    }, null, 2));

    const resJoninStr = server.runMcpAgent('jonin', 'Build a responsive showroom header with Geist typography', 'File path: src/components/Header.tsx', 'Must use Tailwind v4 and light mode', null, { design_variance: 9, motion_intensity: 8, visual_density: 6 }, projectDir1);
    const resJonin = JSON.parse(resJoninStr);
    assert.strictEqual(resJonin.status, 'ready');
    assert.strictEqual(resJonin.agent, 'jonin');
    assert.ok(resJonin.instructions.includes('Build a responsive showroom header'));
    assert.ok(resJonin.instructions.includes('Geist typography'));
    assert.ok(resJonin.instructions.includes('Persistent Project Context'));
    assert.ok(resJonin.instructions.includes('Taste-Skill Design Engine Directives'));
    assert.ok(resJonin.instructions.includes('DESIGN_VARIANCE=9/10'));

    // 2. Direct structured delegation anbu
    const projectDir2 = path.join(tmpDir, 'test_project_2');
    fs.mkdirSync(projectDir2, { recursive: true });
    fs.writeFileSync(path.join(projectDir2, 'package.json'), JSON.stringify({
      name: 'konoha-showroom-2',
      dependencies: { express: '4.18.0' }
    }, null, 2));

    const resAnbuStr = server.runMcpAgent('anbu', 'Implement SQLite connection pool and safe migration', null, null, null, null, projectDir2);
    const resAnbu = JSON.parse(resAnbuStr);
    assert.strictEqual(resAnbu.status, 'ready');
    assert.strictEqual(resAnbu.agent, 'anbu');
    assert.ok(resAnbu.instructions.includes('SQLite connection pool'));
    assert.ok(resAnbu.instructions.includes('Persistent Project Context'));

    // 3. Report from agent & auto-checkpointing
    const projectDir = path.join(tmpDir, 'test_project_3');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
      name: 'konoha-showroom-3',
      dependencies: { next: '16.0.0' }
    }, null, 2));
    const repJson = server.reportFromAgent('jonin', 'Completed showroom filter bar with 3D perspective cards', 'completed', ['src/components/FilterBar.tsx'], ['src/app/page.tsx'], [
      'Showroom uses CSS Grid 12-column layout with max-w-[1400px]',
      'Primary brand color is Emerald 600 with slate backdrop'
    ], projectDir, null, null, ['pnpm run build exited 0', 'vitest: 12 passed']);
    const rep = JSON.parse(repJson);
    assert.strictEqual(rep.status, 'recorded');
    assert.strictEqual(rep.task_status, 'completed');
    assert.ok(rep.verified !== false);
    assert.strictEqual(rep.learnings_saved_count, 2);

    const mems = personaMemory.listMemories({ project_path: projectDir, db_path: dbPath });
    assert.strictEqual(mems.length, 2);
    const contents = mems.map(m => m.content);
    assert.ok(contents.includes('Showroom uses CSS Grid 12-column layout with max-w-[1400px]'));

    // Reporting same learnings again must not duplicate
    const repDupJson = server.reportFromAgent('jonin', 'Re-report with identical learnings', 'completed', null, null, [
      'Showroom uses CSS Grid 12-column layout with max-w-[1400px]',
      'Primary brand color is Emerald 600 with slate backdrop'
    ], projectDir, null, null, ['pnpm run build exited 0']);
    const repDup = JSON.parse(repDupJson);
    assert.strictEqual(repDup.learnings_saved_count, 0);
    const memsAfter = personaMemory.listMemories({ project_path: projectDir, db_path: dbPath });
    assert.strictEqual(memsAfter.length, 2);

    // 4. Unverified report defers learnings
    const repUnvJson = server.reportFromAgent('jonin', 'Claimed completion without evidence', 'completed', null, null, ['DB9 is caused by the collections Map mismatch'], projectDir);
    const repUnv = JSON.parse(repUnvJson);
    assert.strictEqual(repUnv.status, 'recorded');
    assert.strictEqual(repUnv.task_status, 'unverified');
    assert.strictEqual(repUnv.verified, false);
    assert.ok(repUnv.remediation);
    assert.strictEqual(repUnv.learnings_saved_count, 0);

    // 5. Legacy task_dir backward compatibility
    const taskDir = path.join(tmpDir, 'legacy_task');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'delegate.md'), 'Task: Legacy task fallback test\nSkills: jonin-skill\nConstraints: None');
    const legacyResStr = server.runMcpAgent('jonin', null, null, null, null, null, projectDir, taskDir);
    const legacyRes = JSON.parse(legacyResStr);
    assert.strictEqual(legacyRes.status, 'ready');
    assert.ok(legacyRes.instructions.includes('Legacy task fallback test'));

    console.log('✓ testStructuredDelegation passed');
  } finally {
    db.DB_PATH = prevDbPath;
    server.DB_PATH = prevServerDb;
    personaMemory.DB_PATH = prevPersonaDb;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

testStructuredDelegation().catch(err => {
  console.error(err);
  process.exit(1);
});
