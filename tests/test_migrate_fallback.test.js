const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO_ROOT = path.join(__dirname, '..');
const MIGRATE_PY = path.join(REPO_ROOT, 'src', 'migrate.py');
const PLATFORM = require('../src/platform_utils');

function runMigrate(args, env = {}) {
  const python = PLATFORM.detectPythonOrDefault();
  const fullEnv = { ...process.env, ...env };
  return PLATFORM.spawnPythonSync(python, [MIGRATE_PY, ...args], {
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

    const sqliteCheck = 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); rows={r[0] for r in c.execute("SELECT DISTINCT name FROM skills")}; refs=[r for r in rows if "/" in r]; print(",".join(sorted(refs)))';
    const check = PLATFORM.spawnPythonSync(PLATFORM.detectPythonOrDefault(), ['-c', sqliteCheck, tmpDbPath], { encoding: 'utf-8', timeout: 10000 });
    assert.strictEqual(check.status, 0, `sqlite check failed: ${check.stderr}`);
    assert.strictEqual((check.stdout || '').trim(), '', `no reference rows expected under --skills-only, got: ${check.stdout}`);
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
