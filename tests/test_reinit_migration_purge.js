#!/usr/bin/env node
'use strict';

/**
 * Re-running `konoha init --yes` on an existing install must migrate the
 * database, not just refresh integrations.
 *
 * Before this fix, `handleExistingInstallation` returned after
 * `refreshExistingInstallation` (runtime files + client configs) and never
 * called `runMigration`, so the 817 legacy cyber-pack rows and 11 on-disk
 * copies from issue #2 survived every re-init — the v2.2.20 fix was real
 * but unreachable from the most common upgrade gesture (Defect A in the
 * v2.2.20 release review).
 *
 * Two invariants (same as test_upgrade_cyber_pack_purge.js):
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
    timeout: 180000,
    env: { ...process.env, HOME: home, USERPROFILE: home, KONOHA_DB_PATH: path.join(home, '.konoha', 'konoha.db') }
  });
}

// runMigration and migrateExistingInstallation log progress to stdout, so
// the child's result JSON is emitted after a marker and parsed from there.
function parseResult(out) {
  const marker = '__RESULT__';
  const idx = out.lastIndexOf(marker);
  assert.ok(idx >= 0, `child did not emit ${marker}; stdout was: ${out.slice(0, 400)}`);
  return JSON.parse(out.slice(idx + marker.length));
}

function check() {
  console.log('Running test_reinit_migration_purge...');

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_reinit_'));

  try {
    // --- Case 1: the re-init migration purges legacy cyber residue and
    // leaves ordinary skills intact.
    const skillsDir = path.join(home, 'src-skills');
    fs.mkdirSync(path.join(skillsDir, 'plain-skill'), { recursive: true });
    const plainSkillMd = path.join(skillsDir, 'plain-skill', 'SKILL.md');
    fs.writeFileSync(plainSkillMd, '---\nname: plain-skill\ndescription: d\n---\n\nbody\n');
    const residueDir = path.join(home, '.konoha', 'skills', 'akatsuki-skill', 'references', 'anthropic-cybersecurity-skills-assets');
    fs.mkdirSync(residueDir, { recursive: true });
    fs.writeFileSync(path.join(residueDir, 'payload.md'), 'legacy');

    const out = runInSandbox(home, `
      const Database = require(${JSON.stringify(path.join(ROOT, 'src', 'sqlite_driver.js'))});
      const { setupSchema } = require(${JSON.stringify(path.join(ROOT, 'src', 'db_schema.js'))});
      const { migrateExistingInstallation } = require(${JSON.stringify(path.join(ROOT, 'bin', 'commands', 'init.js'))});
      const dbPath = path.join(process.env.HOME, '.konoha', 'konoha.db');
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const db = new Database(dbPath);
      setupSchema(db);
      const insSkill = db.prepare('INSERT INTO skills (name, skill_name, type, file_path, content) VALUES (?, ?, ?, ?, ?)');
      insSkill.run('plain-skill', 'plain-skill', 'skill', ${JSON.stringify(plainSkillMd)}, 'keep me');
      insSkill.run('victim', 'victim', 'skill', '/workspace/skills/akatsuki-skill/references/anthropic-cybersecurity-skills-assets/x.md', 'drop me');
      const insChunk = db.prepare('INSERT INTO skill_chunks (skill_name, chunk_index, chunk_text) VALUES (?, ?, ?)');
      insChunk.run('plain-skill', 0, 'ordinary chunk that must survive');
      insChunk.run('victim', 0, 'cyber chunk that must be purged');
      db.close();
      migrateExistingInstallation({ skillsDir: ${JSON.stringify(skillsDir)}, skipEmbeddings: true, timeBudgetSeconds: 30 })
        .then(() => {
          const db2 = new Database(dbPath);
          const skills = db2.prepare('SELECT name FROM skills ORDER BY name').all().map((x) => x.name);
          const cyberRows = db2.prepare("SELECT COUNT(*) n FROM skills WHERE file_path LIKE '%anthropic-cybersecurity-skills-assets%'").get().n;
          db2.close();
          process.stdout.write('__RESULT__' + JSON.stringify({ skills, cyberRows }));
        })
        .catch((e) => process.stdout.write('__RESULT__' + JSON.stringify({ ok: false, err: e.message })));
    `);
    const res = parseResult(out);
    assert.strictEqual(res.ok !== false, true, `re-init migration must succeed, got ${res.err || ''}`);
    assert.strictEqual(res.cyberRows, 0, 're-init migration must purge cyber rows');
    assert.ok(res.skills.includes('plain-skill'), 're-init migration must leave ordinary skills intact');
    assert.ok(!res.skills.includes('victim'), 're-init migration must remove the cyber row');
    // NOTE: skill_chunks are NOT asserted here. With skipEmbeddings the
    // embedding backfill is skipped, so re-indexed skills have no chunks
    // until a full migration with embeddings runs — that is the existing
    // `konoha migrate --skip-embeddings` behaviour, not this fix. Chunk
    // scoping of the purge itself is covered by
    // test_upgrade_cyber_pack_purge.js Case 3 (purgeLegacyResidue direct).
    assert.ok(!fs.existsSync(residueDir), 're-init migration must purge on-disk cyber residue');
    console.log('  ok   re-init migration purges cyber rows/dirs; ordinary skill survives');

    // --- Case 2: an explicit opt-in is never destroyed by the re-init
    // migration. All pack paths are derived INSIDE the child process:
    // computing them here would resolve against the developer's real HOME
    // and create a consent file in the live ~/.konoha.
    const out2 = runInSandbox(home, `
      const cp = require(${JSON.stringify(path.join(ROOT, 'src', 'cyber_pack.js'))});
      const { migrateExistingInstallation } = require(${JSON.stringify(path.join(ROOT, 'bin', 'commands', 'init.js'))});
      fs.mkdirSync(path.join(cp.getPackDir(), 'skills'), { recursive: true });
      fs.writeFileSync(cp.getConsentPath(), JSON.stringify({ accepted: true }));
      migrateExistingInstallation({ skillsDir: ${JSON.stringify(skillsDir)}, skipEmbeddings: true, timeBudgetSeconds: 30 })
        .then(() => process.stdout.write('__RESULT__' + JSON.stringify({
          state: cp.status(null).state,
          packDirExists: fs.existsSync(cp.getPackDir())
        })))
        .catch((e) => process.stdout.write('__RESULT__' + JSON.stringify({ ok: false, err: e.message })));
    `);
    const optedIn = parseResult(out2);
    assert.strictEqual(optedIn.ok !== false, true, `re-init migration must succeed on opt-in, got ${optedIn.err || ''}`);
    assert.strictEqual(optedIn.state, 'opted-in', 'opt-in state must survive the re-init migration');
    assert.strictEqual(optedIn.packDirExists, true, 'opted-in pack files must survive the re-init migration');
    console.log('  ok   opted-in pack survives the re-init migration untouched');

    console.log('All re-init migration purge checks passed');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

try {
  check();
} catch (err) {
  console.error(`FAIL test_reinit_migration_purge: ${err.message}`);
  process.exit(1);
}
