'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const Database = require('../src/sqlite_driver');

const { isPathVisible, setWorkspaceRoot } = require('../src/mcp/runtime_state');
const { isSafeExternalSkillFile, classifySkillSourceProvenance } = require('../src/migrate_helpers');
const { migrateSkill } = require('../src/migrate');

function createTestDb(dbPath) {
  const conn = new Database(dbPath);
  conn.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_hash TEXT UNIQUE NOT NULL,
      project_path TEXT NOT NULL,
      name TEXT,
      tech_stack TEXT,
      context_summary TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS persona_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_name TEXT NOT NULL,
      project_hash TEXT,
      session_id TEXT,
      memory_type TEXT DEFAULT 'episodic',
      title TEXT,
      content TEXT NOT NULL,
      importance INTEGER DEFAULT 1,
      embedding BLOB,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      skill_name TEXT NOT NULL,
      type TEXT NOT NULL,
      category TEXT,
      description TEXT,
      content TEXT NOT NULL,
      file_path TEXT,
      line_count INTEGER,
      size_bytes INTEGER,
      byte_size INTEGER,
      tags TEXT
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
      name, skill_name, category, description, content, tags,
      content='skills', content_rowid='id'
    );
    CREATE TRIGGER IF NOT EXISTS skills_ai AFTER INSERT ON skills BEGIN
      INSERT INTO skills_fts(rowid, name, skill_name, category, description, content, tags)
      VALUES (new.id, new.name, new.skill_name, new.category, new.description, new.content, new.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS skills_ad AFTER DELETE ON skills BEGIN
      INSERT INTO skills_fts(skills_fts, rowid, name, skill_name, category, description, content, tags)
      VALUES ('delete', old.id, old.name, old.skill_name, old.category, old.description, old.content, old.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS skills_au AFTER UPDATE ON skills BEGIN
      INSERT INTO skills_fts(skills_fts, rowid, name, skill_name, category, description, content, tags)
      VALUES ('delete', old.id, old.name, old.skill_name, old.category, old.description, old.content, old.tags);
      INSERT INTO skills_fts(rowid, name, skill_name, category, description, content, tags)
      VALUES (new.id, new.name, new.skill_name, new.category, new.description, new.content, new.tags);
    END;
  `);
  return conn;
}

function runTests() {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-test-rag-'));
  const prevHome = process.env.HOME;
  process.env.HOME = path.join(tmpBase, 'home');
  fs.mkdirSync(process.env.HOME, { recursive: true });

  try {
    const projectA = path.join(tmpBase, 'workspace', 'project-a');
    const projectB = path.join(tmpBase, 'workspace', 'project-b');
    const globalCursorSkills = path.join(process.env.HOME, '.cursor', 'skills');
    const globalClaudeSkills = path.join(process.env.HOME, '.claude', 'skills');

    fs.mkdirSync(path.join(projectA, '.cursor', 'skills', 'shared-auth-skill'), { recursive: true });
    fs.mkdirSync(path.join(projectB, '.cursor', 'skills', 'shared-auth-skill'), { recursive: true });
    fs.mkdirSync(path.join(projectB, '.claude', 'skills', 'project-b-only'), { recursive: true });
    fs.mkdirSync(path.join(globalCursorSkills, 'shared-auth-skill'), { recursive: true });
    fs.mkdirSync(path.join(globalClaudeSkills, 'shared-auth-skill'), { recursive: true });

    const skillAPath = path.join(projectA, '.cursor', 'skills', 'shared-auth-skill', 'SKILL.md');
    const skillBPath = path.join(projectB, '.cursor', 'skills', 'shared-auth-skill', 'SKILL.md');
    const skillBOnlyPath = path.join(projectB, '.claude', 'skills', 'project-b-only', 'SKILL.md');
    const skillGlobalCursorPath = path.join(globalCursorSkills, 'shared-auth-skill', 'SKILL.md');
    const skillGlobalClaudePath = path.join(globalClaudeSkills, 'shared-auth-skill', 'SKILL.md');

    fs.writeFileSync(skillAPath, '---\nname: shared-auth-skill\ndescription: Project A Auth Skill\n---\n# Project A OAuth2 Flow\n');
    fs.writeFileSync(skillBPath, '---\nname: shared-auth-skill\ndescription: Project B Auth Skill\n---\n# Project B SAML Flow\n');
    fs.writeFileSync(skillBOnlyPath, '---\nname: project-b-only\ndescription: Secret Project B Skill\n---\n# Project B Internal Pipeline\n');
    fs.writeFileSync(skillGlobalCursorPath, '---\nname: shared-auth-skill\ndescription: Global Cursor Auth\n---\n# Global Cursor Auth\n');
    fs.writeFileSync(skillGlobalClaudePath, '---\nname: shared-auth-skill\ndescription: Global Claude Auth\n---\n# Global Claude Auth\n');

    setWorkspaceRoot(projectA);
    assert.strictEqual(isPathVisible(skillAPath), true, 'Project A skill must be visible in Project A');
    assert.strictEqual(isPathVisible(skillBPath), false, 'Project B .cursor/skills must NEVER leak into Project A');
    assert.strictEqual(isPathVisible(skillBOnlyPath), false, 'Project B .claude/skills must NEVER leak into Project A');
    assert.strictEqual(isPathVisible(skillGlobalCursorPath), true, 'Global ~/.cursor/skills must be visible across projects');
    assert.strictEqual(isPathVisible(skillGlobalClaudePath), true, 'Global ~/.claude/skills must be visible across projects');

    setWorkspaceRoot(projectB);
    assert.strictEqual(isPathVisible(skillBPath), true, 'Project B skill must be visible in Project B');
    assert.strictEqual(isPathVisible(skillAPath), false, 'Project A skill must NEVER leak into Project B');

    const provA = classifySkillSourceProvenance(path.join(projectA, '.cursor', 'skills'));
    assert.strictEqual(provA.scope, 'project');
    assert.strictEqual(provA.harness, 'cursor');
    assert.ok(provA.projectHash, 'Project skill provenance must compute projectHash');

    const provGlobal = classifySkillSourceProvenance(globalCursorSkills);
    assert.strictEqual(provGlobal.scope, 'global');
    assert.strictEqual(provGlobal.harness, 'cursor');

    const envSecretFile = path.join(projectA, '.cursor', 'skills', 'shared-auth-skill', '.env.production');
    fs.writeFileSync(envSecretFile, 'SECRET_KEY=12345\n');
    assert.strictEqual(isSafeExternalSkillFile(envSecretFile, path.join(projectA, '.cursor', 'skills')), false, '.env secret files must be rejected');

    const outsideFile = path.join(tmpBase, 'outside-secret.md');
    fs.writeFileSync(outsideFile, '# Outside file\n');
    const symlinkPath = path.join(projectA, '.cursor', 'skills', 'shared-auth-skill', 'escaped.md');
    fs.symlinkSync(outsideFile, symlinkPath);
    assert.strictEqual(isSafeExternalSkillFile(symlinkPath, path.join(projectA, '.cursor', 'skills')), false, 'Symlink escaping skill root must be rejected');
    fs.unlinkSync(symlinkPath);
    fs.unlinkSync(envSecretFile);

    const dbPath = path.join(tmpBase, 'konoha.db');
    const conn = createTestDb(dbPath);
    conn.prepare('INSERT INTO projects (project_hash, project_path, name, context_summary) VALUES (?, ?, ?, ?)').run(
      provA.projectHash, projectA, 'project-a', 'Existing Project A RAG Summary'
    );
    conn.prepare('INSERT INTO persona_memories (agent_name, project_hash, title, content) VALUES (?, ?, ?, ?)').run(
      'kage', provA.projectHash, 'Architecture decision', 'Keep existing SQLite RAG intact'
    );

    const candidateDirs = [
      path.join(projectA, '.cursor', 'skills'),
      path.join(projectB, '.cursor', 'skills'),
      globalCursorSkills,
      globalClaudeSkills
    ];
    for (const sDir of candidateDirs) {
      migrateSkill(conn, 'shared-auth-skill', false, sDir);
    }
    migrateSkill(conn, 'project-b-only', false, path.join(projectB, '.claude', 'skills'));

    const rows = conn.prepare("SELECT name, skill_name, description, file_path, tags FROM skills WHERE skill_name = 'shared-auth-skill'").all();
    assert.strictEqual(rows.length, 4, 'All 4 distinct shared-auth-skill sources (Project A, Project B, Global Cursor, Global Claude) must coexist without overwriting each other');

    const projRow = conn.prepare('SELECT context_summary FROM projects WHERE project_hash = ?').get(provA.projectHash);
    assert.strictEqual(projRow.context_summary, 'Existing Project A RAG Summary', 'Existing Project Knowledge must remain untouched');
    const memRow = conn.prepare('SELECT content FROM persona_memories WHERE project_hash = ?').get(provA.projectHash);
    assert.strictEqual(memRow.content, 'Keep existing SQLite RAG intact', 'Existing persona memories must remain untouched');

    assert.strictEqual(fs.existsSync(skillAPath), true, 'External skill files on disk must never be moved or deleted');
    assert.strictEqual(fs.existsSync(skillBPath), true, 'External skill files on disk must never be moved or deleted');

    conn.close();
    console.log('PASS: test_project_rag_and_external_skills.js');
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
}

runTests();
