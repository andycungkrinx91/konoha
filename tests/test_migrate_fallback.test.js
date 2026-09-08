const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO_ROOT = path.join(__dirname, '..');
const MIGRATE_JS = path.join(REPO_ROOT, 'src', 'migrate.js');
const { spawnSync } = require('child_process');

function runMigrate(args, env = {}) {
  const fullEnv = { ...process.env, ...env };
  return spawnSync(process.execPath, [MIGRATE_JS, ...args], {
    encoding: 'utf-8',
    cwd: REPO_ROOT,
    timeout: 120000,
    env: fullEnv
  });
}

describe('Migrate Progressive Fallback & Deferred Indexing', () => {
  let tmpSkillsDir;
  let tmpDbPath;

  before(() => {
    tmpSkillsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-migrate-fallback-skills-'));
    tmpDbPath = path.join(os.tmpdir(), `konoha-migrate-fallback-${process.pid}.db`);

    const mkSkill = (name, refCount) => {
      const dir = path.join(tmpSkillsDir, name);
      fs.mkdirSync(path.join(dir, 'references'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: Test skill ${name} for fallback regression.\n---\n\n# ${name}\nBody for ${name}.\n`, 'utf8');
      for (let i = 1; i <= refCount; i++) {
        fs.writeFileSync(path.join(dir, 'references', `ref-${i}.md`), `# Reference ${i}\nContent for ${name} reference ${i}.\n`, 'utf8');
      }
    };
    mkSkill('alpha-skill', 3);
    mkSkill('beta-skill', 2);
    mkSkill('genin-skill', 1);
  });

  after(() => {
    if (tmpSkillsDir && fs.existsSync(tmpSkillsDir)) fs.rmSync(tmpSkillsDir, { recursive: true, force: true });
    if (tmpDbPath && fs.existsSync(tmpDbPath)) fs.rmSync(tmpDbPath, { force: true });
  });

  test('1. --skills-only migrates SKILL.md entries and defers references', () => {
    const run = runMigrate([
      '--clean', '--db-path', tmpDbPath, '--skills-dir', tmpSkillsDir,
      '--require-skill', 'genin-skill', '--skip-embeddings', '--skills-only'
    ]);
    assert.strictEqual(run.status, 0, `migrate --skills-only failed: ${run.stderr || run.stdout}`);
    const out = `${run.stdout}`;
    assert.match(out, /References deferred \(--skills-only\): \d+ files skipped/, 'expected deferred-reference output');
    assert.doesNotMatch(out, /✓ references\//, 'references must not be migrated under --skills-only');

    const Database = require('better-sqlite3');
    const db = new Database(tmpDbPath);
    const rows = db.prepare("SELECT DISTINCT name FROM skills").all().map(r => r.name);
    db.close();
    const refs = rows.filter(r => r.includes('/'));
    assert.strictEqual(refs.length, 0, `no reference rows expected under --skills-only, got: ${refs.join(',')}`);
  });

  test('2. time budget defers non-required skills and exits 0', () => {
    const budgetDb = tmpDbPath + '.budget';
    try {
      const run = runMigrate([
        '--clean', '--db-path', budgetDb, '--skills-dir', tmpSkillsDir,
        '--require-skill', 'genin-skill', '--skip-embeddings'
      ], { KONOHA_MIGRATE_TIME_BUDGET: '0.001' });
      assert.strictEqual(run.status, 0, `migrate with budget failed: ${run.stderr || run.stdout}`);
      const out = `${run.stdout}`;
      assert.match(out, /Time budget reached; \d+ skills deferred/, 'expected budget deferral output');
      assert.match(out, /Migrating: genin-skill/, 'required skill must be migrated despite budget');
    } finally {
      if (fs.existsSync(budgetDb)) fs.rmSync(budgetDb, { force: true });
    }
  });

  test('3. full migration (no budget pressure) still indexes references', () => {
    const fullDb = tmpDbPath + '.full';
    try {
      const run = runMigrate([
        '--clean', '--db-path', fullDb, '--skills-dir', tmpSkillsDir,
        '--require-skill', 'genin-skill', '--skip-embeddings'
      ]);
      assert.strictEqual(run.status, 0, `full migrate failed: ${run.stderr || run.stdout}`);
      const out = `${run.stdout}`;
      assert.match(out, /✓ references\//, 'references must be migrated in full mode');
    } finally {
      if (fs.existsSync(fullDb)) fs.rmSync(fullDb, { force: true });
    }
  });

  test('4. cli.js Stage 5 escalation chain argument construction is present', () => {
    const cli = fs.readFileSync(path.join(REPO_ROOT, 'bin', 'cli.js'), 'utf-8');
    assert.match(cli, /--skills-only/, 'cli.js must pass --skills-only in final fallback');
    assert.match(cli, /Reference indexing deferred/, 'cli.js must warn about deferred references');
    assert.match(cli, /Run "konoha migrate" again to finish remaining references\./, 'cmdMigrate must warn instead of hard-exit on timeout');
    // The unconditional skip-embeddings retry must not be gated on the flag already being present
    const retryGate = /if \(run\.status !== 0 && !migrationArgs\.includes\('--skip-embeddings'\)\)/;
    assert.doesNotMatch(cli, retryGate, 'skip-embeddings retry must be unconditional');
  });
});
