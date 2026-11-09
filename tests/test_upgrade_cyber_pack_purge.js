#!/usr/bin/env node
'use strict';

/**
 * Upgrades must not leave cyber-pack residue behind.
 *
 * Before 2.2.20 the pack could be indexed and deployed into up to four client
 * skill directories, and only `doctor --clean-cyber-pack` knew how to remove it.
 * An upgraded install therefore kept failing `doctor --vps` forever with no
 * obvious remedy.
 *
 * `purgeLegacyResidue` now runs on the migrate/upgrade path. Two invariants:
 *   - an explicit opt-in is never destroyed by an upgrade;
 *   - when residue exists and the user never opted in, it is removed and
 *     reported, not silently ignored.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// The module derives its state from HOME and the lab DB dir, so it must be
// exercised in a child process with a throwaway HOME — never in-process, which
// would read (and could write) the developer's real ~/.konoha.
function runInSandbox(home, script) {
  const prelude = `
    const path = require('path');
    const fs = require('fs');
    const os = require('os');
  `;
  return execFileSync(process.execPath, ['-e', prelude + script], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, HOME: home, USERPROFILE: home, KONOHA_DB_PATH: path.join(home, '.konoha', 'konoha.db') }
  });
}

function check() {
  console.log('Running test_upgrade_cyber_pack_purge...');

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_cyber_'));

  try {
    // --- Case 1: clean install, nothing to purge.
    let out = runInSandbox(home, `
      const { purgeLegacyResidue } = require(${JSON.stringify(path.join(ROOT, 'src', 'cyber_pack.js'))});
      process.stdout.write(JSON.stringify({ result: purgeLegacyResidue(null, {}) }));
    `);
    assert.strictEqual(JSON.parse(out).result, null, 'a clean install must not purge or take a DB backup');
    console.log('  ok   no residue → null (no backup taken, no work done)');

    // --- Case 2: legacy residue on disk, user never opted in.
    const { getGlobalHarnessSkillTargets } = require('../src/global_skill_sync');
    const targets = getGlobalHarnessSkillTargets(home);
    assert.ok(targets.length > 0, 'sandbox must expose client skill targets');
    const residueDirs = targets.slice(0, 3).map((t) =>
      path.join(t.skillsDir, 'akatsuki-skill', 'references', 'anthropic-cybersecurity-skills-assets')
    );
    // Plus the default runtime copy, to prove the union sweep covers it.
    residueDirs.push(path.join(home, '.konoha', 'skills', 'akatsuki-skill', 'references', 'anthropic-cybersecurity-skills-assets'));
    for (const dir of residueDirs) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'payload.md'), 'legacy');
    }

    out = runInSandbox(home, `
      const { purgeLegacyResidue } = require(${JSON.stringify(path.join(ROOT, 'src', 'cyber_pack.js'))});
      const r = purgeLegacyResidue(null, {});
      process.stdout.write(JSON.stringify({ purged: r && r.purged, dirs: r ? r.removedDirs : [] }));
    `);
    const purged = JSON.parse(out);
    assert.strictEqual(purged.purged, true, 'residue on disk must trigger a purge');
    for (const dir of residueDirs) {
      assert.ok(!fs.existsSync(dir), `purge must delete ${dir}`);
    }
    console.log(`  ok   purged ${purged.dirs.length} residue dirs across client targets`);

    // --- Case 3: a purge must delete only cyber rows and chunks.
    out = runInSandbox(home, `
      const Database = require(${JSON.stringify(path.join(ROOT, 'src', 'sqlite_driver.js'))});
      const { setupSchema } = require(${JSON.stringify(path.join(ROOT, 'src', 'db_schema.js'))});
      const cp = require(${JSON.stringify(path.join(ROOT, 'src', 'cyber_pack.js'))});
      const dbPath = path.join(process.env.HOME, '.konoha', 'konoha.db');
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const db = new Database(dbPath);
      setupSchema(db);
      const insSkill = db.prepare('INSERT INTO skills (name, skill_name, type, file_path, content) VALUES (?, ?, ?, ?, ?)');
      insSkill.run('ordinary-skill', 'ordinary-skill', 'skill', '/workspace/skills/ordinary-skill/SKILL.md', 'keep me');
      insSkill.run('victim', 'victim', 'skill', '/workspace/skills/akatsuki-skill/references/anthropic-cybersecurity-skills-assets/x.md', 'drop me');
      const insChunk = db.prepare('INSERT INTO skill_chunks (skill_name, chunk_index, chunk_text) VALUES (?, ?, ?)');
      insChunk.run('ordinary-skill', 0, 'ordinary chunk that must survive');
      insChunk.run('victim', 0, 'cyber chunk that must be purged');
      const r = cp.purgeLegacyResidue(db, {});
      const skills = db.prepare('SELECT name FROM skills ORDER BY name').all().map((x) => x.name);
      const chunks = db.prepare('SELECT skill_name FROM skill_chunks ORDER BY skill_name').all().map((x) => x.skill_name);
      db.close();
      process.stdout.write(JSON.stringify({ removedRows: r && r.removedRows, removedChunks: r && r.removedChunks, skills, chunks }));
    `);
    const scoped = JSON.parse(out);
    assert.strictEqual(scoped.removedRows, 1, 'purge must remove exactly the cyber-designated row');
    assert.deepStrictEqual(scoped.skills, ['ordinary-skill'], 'purge must leave non-cyber rows untouched');
    assert.deepStrictEqual(scoped.chunks, ['ordinary-skill'], 'purge must leave non-cyber chunks untouched');
    console.log('  ok   purge removes only cyber rows/chunks; ordinary skill and chunk survive');

    // --- Case 4: an explicit opt-in is never destroyed by an upgrade.
    // All pack paths are derived INSIDE the child process: computing them here
    // would resolve against the developer's real HOME and create a consent file
    // in the live ~/.konoha (this exact bug was introduced and cleaned up once).
    out = runInSandbox(home, `
      const cp = require(${JSON.stringify(path.join(ROOT, 'src', 'cyber_pack.js'))});
      fs.mkdirSync(path.join(cp.getPackDir(), 'skills'), { recursive: true });
      fs.writeFileSync(cp.getConsentPath(), JSON.stringify({ accepted: true }));
      const r = cp.purgeLegacyResidue(null, {});
      process.stdout.write(JSON.stringify({
        result: r,
        state: cp.status(null).state,
        packDirExists: fs.existsSync(cp.getPackDir())
      }));
    `);
    const optedIn = JSON.parse(out);
    assert.strictEqual(optedIn.result, null, 'purge must be a no-op for an opted-in pack');
    assert.strictEqual(optedIn.state, 'opted-in', 'opt-in state must survive an upgrade');
    assert.strictEqual(optedIn.packDirExists, true, 'opted-in pack files must survive an upgrade');
    console.log('  ok   opted-in pack survives upgrade untouched');

    // --- Case 5: the real migrate path runs the purge, not just the helper.
    const upHome = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_cyber_up_'));
    try {
      const skillsDir = path.join(upHome, 'src-skills');
      fs.mkdirSync(path.join(skillsDir, 'plain-skill'), { recursive: true });
      fs.writeFileSync(path.join(skillsDir, 'plain-skill', 'SKILL.md'), '---\nname: plain-skill\ndescription: d\n---\n\nbody\n');
      const upResidue = path.join(upHome, '.konoha', 'skills', 'akatsuki-skill', 'references', 'anthropic-cybersecurity-skills-assets');
      fs.mkdirSync(upResidue, { recursive: true });
      fs.writeFileSync(path.join(upResidue, 'payload.md'), 'legacy');

      out = runInSandbox(upHome, `
        const skillsDir = ${JSON.stringify(skillsDir)};
        const { runMigration } = require(${JSON.stringify(path.join(ROOT, 'src', 'migrate.js'))});
        runMigration({ skillsDir, skipEmbeddings: true, timeBudgetSeconds: 20 })
          .then((r) => process.stdout.write(JSON.stringify({ ok: r && r.ok })))
          .catch((e) => process.stdout.write(JSON.stringify({ ok: false, err: e.message })));
      `);
      const migrated = JSON.parse(out);
      assert.strictEqual(migrated.ok, true, `upgrade migration must succeed, got ${migrated.err || ''}`);
      assert.ok(!fs.existsSync(upResidue), 'the migrate/upgrade path must purge cyber residue itself');
      console.log('  ok   runMigration purges residue on the upgrade path');
    } finally {
      fs.rmSync(upHome, { recursive: true, force: true });
    }

    console.log('All cyber-pack purge checks passed');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

try {
  check();
} catch (err) {
  console.error(`FAIL test_upgrade_cyber_pack_purge: ${err.message}`);
  process.exit(1);
}