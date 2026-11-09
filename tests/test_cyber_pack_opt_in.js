/**
 * Test Suite: cyber pack opt-in lifecycle.
 *
 * absent -> install --confirm -> 817 rows under akatsuki-skill only ->
 * remove (with backup) -> removed -> idempotent second remove.
 *
 * Also proves the consent gate: install without `confirm` refuses, and a
 * tampered archive is rejected by the sha256 check.
 */

'use strict';

const assert = require('assert');
const Database = require('node:sqlite').DatabaseSync;
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-cyberpack-test-'));
process.env.HOME = tmpRoot;
process.env.USERPROFILE = tmpRoot;
process.env.KONOHA_HOME = path.join(tmpRoot, '.konoha');
process.env.KONOHA_DB_PATH = path.join(tmpRoot, '.konoha', 'konoha.db');
fs.mkdirSync(path.join(tmpRoot, '.konoha'), { recursive: true });

const REPO_ROOT = path.resolve(__dirname, '..');
const PACK_ASSET_DIR = 'anthropic-cybersecurity-skills-assets';
const PACK_ROW_WHERE = 'file_path LIKE ? OR file_path LIKE ?';
const PACK_ROW_ARGS = [`%${PACK_ASSET_DIR}%`, '%cyber-pack%skills%'];

const db = require('../src/db');
const cyberPack = require('../src/cyber_pack');
const migrate = require('../src/migrate');
const skillsModule = require('../src/mcp/skills');

const conn = db.getConnection();
db.setupSchema(conn);

const version = require('../package.json').version;
const archivePath = path.join(REPO_ROOT, 'dist', `akatsuki-cyber-pack-${version}.tar.zst`);
const manifestPath = path.join(REPO_ROOT, 'dist', 'manifest.json');

function cyberRowCount(skillName = null) {
  const filter = skillName ? 'AND skill_name = ?' : '';
  const args = skillName ? [...PACK_ROW_ARGS, skillName] : PACK_ROW_ARGS;
  return conn
    .prepare(`SELECT COUNT(*) n FROM skills WHERE (${PACK_ROW_WHERE}) ${filter}`)
    .get(...args).n;
}

async function assertConsentRequired() {
  await assert.rejects(
    () => cyberPack.install({ archivePath, manifestPath, conn }),
    (err) => err.code === 'CYBER_PACK_CONFIRM_REQUIRED',
    'Install without --confirm must be refused'
  );
  assert.strictEqual(cyberPack.getState(conn), 'absent', 'Refused install must not change state');
}

async function assertChecksumRejected() {
  const badManifest = path.join(tmpRoot, 'bad-manifest.json');
  const real = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  fs.writeFileSync(badManifest, JSON.stringify({ ...real, sha256: '0'.repeat(64) }));
  await assert.rejects(
    () => cyberPack.install({ confirm: true, archivePath, manifestPath: badManifest, conn }),
    /checksum mismatch/i,
    'Tampered manifest must be rejected'
  );
  assert.strictEqual(cyberPack.getState(conn), 'absent', 'Rejected install must not change state');
}

async function assertLifecycle() {
  assert.strictEqual(cyberPack.getState(conn), 'absent', 'Must start absent');

  const installed = await cyberPack.install({ confirm: true, archivePath, manifestPath, conn });
  assert.strictEqual(installed.state, 'opted-in', 'Install must report opted-in');
  assert.strictEqual(cyberPack.getState(conn), 'opted-in', 'State must be opted-in');
  assert.ok(fs.existsSync(cyberPack.getConsentPath()), 'Consent file must be written');
  const consent = JSON.parse(fs.readFileSync(cyberPack.getConsentPath(), 'utf8'));
  assert.strictEqual(consent.sha256, installed.sha256, 'Consent must record the archive sha256');
  assert.ok(consent.notice.includes('authorised testing'), 'Consent must carry the authorisation notice');

  const migrationRow = conn
    .prepare('SELECT checksum_sha256 FROM schema_migrations WHERE migration_id = ?')
    .get(cyberPack.MIGRATION_ID);
  assert.ok(migrationRow, 'Opt-in must be recorded in schema_migrations');
  assert.strictEqual(migrationRow.checksum_sha256, installed.sha256, 'Migration row must carry the pack sha256');

  migrate.migrateSingleSkill('akatsuki-skill', 'src/templates/skills');
  assert.strictEqual(cyberRowCount('akatsuki-skill'), 817, 'Opt-in must index exactly 817 under akatsuki-skill');
  assert.strictEqual(cyberRowCount('anbu-skill'), 0, 'ANBU must never receive cyber rows');

  const status = cyberPack.status(conn);
  assert.strictEqual(status.state, 'opted-in', 'Status must report opted-in');
  assert.strictEqual(status.rows, 817, 'Status must report 817 rows');

  const backupDir = path.join(tmpRoot, '.konoha', 'backups');
  const before = fs.existsSync(backupDir) ? fs.readdirSync(backupDir).length : 0;
  const removed = cyberPack.remove({ conn });
  assert.ok(removed.backupPath && fs.existsSync(removed.backupPath), 'Remove must leave a backup on disk');
  const after = fs.existsSync(backupDir) ? fs.readdirSync(backupDir).length : 0;
  assert.ok(after > before, 'Remove must add a backup file');
  assert.ok(removed.removedRows >= 817, `Remove must delete the rows (got ${removed.removedRows})`);
  assert.strictEqual(cyberRowCount(), 0, 'Remove must leave zero cyber rows');
  assert.strictEqual(cyberPack.getState(conn), 'removed', 'Remove must record the removed state');
  assert.ok(!fs.existsSync(cyberPack.getPackDir()), 'Remove must delete the extracted pack');

  const second = cyberPack.remove({ conn });
  assert.strictEqual(second.removedRows, 0, 'Second remove must be a no-op');
  assert.strictEqual(cyberPack.getState(conn), 'removed', 'Second remove must keep the removed state');
}

/**
 * Pre-2.2.19 installs indexed the pack under every skill that walked it. An
 * upgrade install must drop those rows, or acceptance §9 ("0 under anbu-skill")
 * never holds for an existing install.
 */
async function assertLegacyRowsPurged() {
  const insert = conn.prepare(
    'INSERT OR REPLACE INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const legacyPath = `${cyberPack.getPackDir()}/skills/legacy-probe/SKILL.md`;
  insert.run('legacy-probe-anbu', 'legacy-probe-anbu', 'reference', null, '# Legacy', legacyPath, 8, 1);
  conn
    .prepare('UPDATE skills SET skill_name = ?, file_path = ? WHERE name = ?')
    .run('anbu-skill', legacyPath, 'legacy-probe-anbu');
  assert.strictEqual(cyberRowCount('anbu-skill'), 1, 'Probe row must land under anbu-skill');

  const reinstalled = await cyberPack.install({
    confirm: true,
    archivePath,
    manifestPath,
    version,
    conn,
    log: () => {}
  });
  assert.strictEqual(reinstalled.purgedRows, 1, 'Reinstall must purge the foreign row');
  assert.strictEqual(cyberRowCount('anbu-skill'), 0, 'ANBU must hold no cyber rows after install');

  assert.ok(reinstalled.purgeBackupPath, 'Purge must record a backup path');
  assert.ok(fs.existsSync(reinstalled.purgeBackupPath), 'Purge backup must exist on disk');
  const backup = new Database(reinstalled.purgeBackupPath, { readOnly: true });
  const preserved = backup
    .prepare('SELECT COUNT(*) n FROM skills WHERE name = ?')
    .get('legacy-probe-anbu').n;
  backup.close();
  assert.strictEqual(preserved, 1, 'Backup must contain the row before the purge');
}

async function runTests() {
  console.log('Running test_cyber_pack_opt_in.js...');

  if (!fs.existsSync(archivePath) || !fs.existsSync(manifestPath)) {
    console.log(`  ⏭ skipped: no local archive at ${archivePath}`);
    console.log('    Build one with: node scripts/build_cyber_pack.js');
    conn.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    process.exit(0);
  }

  await assertConsentRequired();
  await assertChecksumRejected();
  await assertLifecycle();
  await assertLegacyRowsPurged();

  conn.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log('✓ Cyber pack opt-in lifecycle verified: absent -> 817 -> removed, backup recorded, legacy foreign rows purged.');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});