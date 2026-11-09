#!/usr/bin/env node
'use strict';

/**
 * Issue #2 reproduction: an upgraded 2.2.19 box carries legacy cyber rows and
 * on-disk pack copies, and `doctor --vps` FAILs forever.
 *
 * This seeds that exact state in a throwaway HOME, runs the migration path the
 * upgrade uses, then runs the VPS preflight and asserts it now passes with zero
 * cyber rows and zero residue directories.
 *
 * Usage: node scripts/verify_cyber_purge_matrix.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', timeout: 600000, ...opts });
  if (res.error) throw res.error;
  return { stdout: res.stdout || '', stderr: res.stderr || '', status: res.status };
}

function requireOk(res, label) {
  if (res.status !== 0) {
    const err = new Error(`${label} exited ${res.status}`);
    err.stdout = res.stdout;
    err.stderr = res.stderr;
    throw err;
  }
  return res;
}

function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_cyber_matrix_'));
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    KONOHA_DB_PATH: path.join(home, '.konoha', 'konoha.db'),
    CI: 'true'
  };

  try {
    console.log('=== seeding a 2.2.19-like install ===');
    // Real migrate run so the DB exists with the real schema.
    requireOk(sh(process.execPath, [path.join(ROOT, 'src', 'migrate.js')], { cwd: ROOT, env }), 'seed migration');

    const seed = `
      const path = require('path');
      const fs = require('fs');
      const Database = require(${JSON.stringify(path.join(ROOT, 'src', 'sqlite_driver'))});
      const { getGlobalHarnessSkillTargets } = require(${JSON.stringify(path.join(ROOT, 'src', 'global_skill_sync'))});
      const { DEFAULT_SKILLS_DIRS } = require(${JSON.stringify(path.join(ROOT, 'bin', 'lib', 'paths'))});
      const db = new Database(process.env.KONOHA_DB_PATH);

      // Legacy cyber rows, as 2.2.19 indexed them.
      const ins = db.prepare('INSERT OR REPLACE INTO skills (name, skill_name, type, content, file_path, byte_size, line_count) VALUES (?, ?, ?, ?, ?, ?, ?)');
      const asset = path.join('.agents', 'skills', 'akatsuki-skill', 'references', 'anthropic-cybersecurity-skills-assets', 'x.md');
      for (let i = 0; i < 12; i++) ins.run('cyber-legacy-' + i, 'cyber-legacy-' + i, 'reference', 'body', asset, 4, 1);

      // On-disk copies in every client skill dir, as 2.2.19 deployed them.
      const dirs = new Set(DEFAULT_SKILLS_DIRS);
      for (const t of getGlobalHarnessSkillTargets(process.env.HOME)) dirs.add(t.skillsDir);
      dirs.add(path.join(process.env.HOME, '.konoha', 'skills'));
      const made = [];
      for (const dir of dirs) {
        const p = path.join(dir, 'akatsuki-skill', 'references', 'anthropic-cybersecurity-skills-assets');
        fs.mkdirSync(p, { recursive: true });
        fs.writeFileSync(path.join(p, 'payload.md'), 'legacy copy');
        made.push(p);
      }
      const rows = db.prepare("SELECT COUNT(*) n FROM skills WHERE file_path LIKE '%anthropic-cybersecurity-skills-assets%'").get().n;
      db.close();
      process.stdout.write(JSON.stringify({ rows, dirs: made.length }));
    `;
    const seeded = JSON.parse(requireOk(sh(process.execPath, ['-e', seed], { cwd: ROOT, env }), 'seed rows').stdout);
    console.log(`  seeded ${seeded.rows} cyber rows and ${seeded.dirs} on-disk copies`);
    if (seeded.rows === 0) throw new Error('seed failed: no cyber rows');
    if (seeded.dirs === 0) throw new Error('seed failed: no residue dirs');

    console.log('=== doctor --vps before purge (expect Cyber pack FAIL) ===');
    const before = sh(process.execPath, [path.join(ROOT, 'bin', 'cli.js'), 'doctor', '--vps'], { cwd: ROOT, env });
    const beforeLine = (before.stdout + before.stderr).split('\n').find((l) => l.includes('Cyber pack')) || '(no line)';
    console.log(`  ${beforeLine.trim()}`);
    if (!/FAIL/.test(beforeLine)) throw new Error('expected the cyber pack check to FAIL before the purge');

    console.log('=== migration path (what upgrade runs) ===');
    requireOk(sh(process.execPath, [path.join(ROOT, 'src', 'migrate.js')], { cwd: ROOT, env }), 'purge migration');

    console.log('=== after purge ===');
    const inspect = `
      const fs = require('fs');
      const path = require('path');
      const cp = require(${JSON.stringify(path.join(ROOT, 'src', 'cyber_pack'))});
      const Database = require(${JSON.stringify(path.join(ROOT, 'src', 'sqlite_driver'))});
      const { getGlobalHarnessSkillTargets } = require(${JSON.stringify(path.join(ROOT, 'src', 'global_skill_sync'))});
      const { DEFAULT_SKILLS_DIRS } = require(${JSON.stringify(path.join(ROOT, 'bin', 'lib', 'paths'))});
      const db = new Database(process.env.KONOHA_DB_PATH, { readonly: true });
      const rows = db.prepare("SELECT COUNT(*) n FROM skills WHERE file_path LIKE '%anthropic-cybersecurity-skills-assets%' OR file_path LIKE '%cyber-pack%skills%'").get().n;
      const total = db.prepare('SELECT COUNT(*) n FROM skills').get().n;
      db.close();
      const dirs = new Set(DEFAULT_SKILLS_DIRS);
      for (const t of getGlobalHarnessSkillTargets(process.env.HOME)) dirs.add(t.skillsDir);
      dirs.add(path.join(process.env.HOME, '.konoha', 'skills'));
      let residue = 0;
      for (const dir of dirs) {
        if (fs.existsSync(path.join(dir, 'akatsuki-skill', 'references', 'anthropic-cybersecurity-skills-assets'))) residue++;
      }
      process.stdout.write(JSON.stringify({ rows, total, residue, state: cp.status(null).state }));
    `;
    const after = JSON.parse(requireOk(sh(process.execPath, ['-e', inspect], { cwd: ROOT, env }), 'inspect').stdout);
    console.log(`  ${JSON.stringify(after)}`);
    if (after.rows !== 0) throw new Error(`legacy cyber rows survived: ${after.rows}`);
    if (after.residue !== 0) throw new Error(`residue dirs survived: ${after.residue}`);
    if (!(after.total > 0)) throw new Error('purge removed non-cyber skills too');

    console.log('=== doctor --vps after purge ===');
    const post = sh(process.execPath, [path.join(ROOT, 'bin', 'cli.js'), 'doctor', '--vps'], { cwd: ROOT, env });
    const cyberLine = (post.stdout + post.stderr).split('\n').find((l) => l.includes('Cyber pack')) || '(no line)';
    console.log(`  ${cyberLine.trim()}`);
    if (!/PASS/.test(cyberLine)) throw new Error(`cyber pack check still failing: ${cyberLine.trim()}`);

    console.log('\ncyber purge matrix: PASS');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  console.error(`\ncyber purge matrix: FAIL — ${err.message}`);
  if (err.stdout) console.error(String(err.stdout).slice(-3000));
  if (err.stderr) console.error(String(err.stderr).slice(-2000));
  process.exit(1);
}