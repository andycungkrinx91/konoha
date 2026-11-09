/**
 * Opt-in cyber pack: state, install, remove, and the migration gate.
 *
 * The pack is offensive/dual-use red-team reference material. It is never part
 * of a default install: it lives outside the repo, is fetched only on explicit
 * consent, and is extracted inside the akatsuki-lab root.
 *
 * State is derived, never stored twice:
 *   opted-in  consent.json + extracted skills/ both present
 *   removed   schema_migrations has a 'cyber_pack' row, pack dir gone
 *   absent    neither
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const authz = require('./skill_authorization');

const PACK_DIR_NAME = 'cyber-pack';
const PACK_ASSET_DIR = 'anthropic-cybersecurity-skills-assets';
const MIGRATION_ID = 'cyber_pack';
const RELEASE_BASE = 'https://github.com/andycungkrinx91/konoha/releases/download';

const CONSENT_TEXT = [
  'The cyber pack contains offensive and dual-use red-team reference material.',
  'Use it for authorised testing, research, and defence only.',
  'It may trigger provider or antivirus scanners.',
  'Opting in to the pack is not authorisation to run an engagement.'
].join(' ');

function getPackDir() {
  return path.join(authz.getLabDbDir(), PACK_DIR_NAME);
}

function getConsentPath() {
  return path.join(getPackDir(), 'consent.json');
}

function getManifestPath() {
  return path.join(getPackDir(), 'manifest.json');
}

function getSkillsDir() {
  return path.join(getPackDir(), 'skills');
}

function _readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function _hasMigrationRow(conn) {
  try {
    const row = conn
      .prepare('SELECT migration_id FROM schema_migrations WHERE migration_id = ?')
      .get(MIGRATION_ID);
    return Boolean(row);
  } catch (_) {
    return false;
  }
}

/**
 * @param {object} [conn] open main-DB connection; omit to skip the removed check
 * @returns {'absent'|'opted-in'|'removed'}
 */
function getState(conn = null) {
  const consent = _readJson(getConsentPath());
  const skillsDir = getSkillsDir();
  if (consent && fs.existsSync(skillsDir) && fs.statSync(skillsDir).isDirectory()) {
    return 'opted-in';
  }
  if (conn && _hasMigrationRow(conn)) return 'removed';
  return 'absent';
}

function _sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Minimal ustar. Node ships zstd but no tar; a 60-line reader/writer beats a
// dependency for a format this small.
// ponytail: no pax extended headers, GNU longname only.

function _octal(value, width) {
  return value.toString(8).padStart(width - 1, '0') + '\0';
}

function _header(name, size, typeflag) {
  const buf = Buffer.alloc(512, 0);
  buf.write(name.slice(0, 100), 0, 'utf8');
  buf.write(_octal(0o644, 8), 100, 'ascii');
  buf.write(_octal(0, 8), 108, 'ascii');
  buf.write(_octal(0, 8), 116, 'ascii');
  buf.write(_octal(size, 12), 124, 'ascii');
  buf.write(_octal(Math.floor(Date.now() / 1000), 12), 136, 'ascii');
  buf.write('        ', 148, 'ascii');
  buf.write(typeflag, 156, 'ascii');
  buf.write('ustar\0', 257, 'ascii');
  buf.write('00', 265, 'ascii');
  let sum = 0;
  for (const byte of buf) sum += byte;
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  return buf;
}

function _pad(buf) {
  const rem = buf.length % 512;
  return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(512 - rem, 0)]);
}

/**
 * @param {Array<{name: string, data: Buffer}>} files
 * @returns {Buffer} uncompressed tar
 */
function createTar(files) {
  const parts = [];
  for (const file of files) {
    if (Buffer.byteLength(file.name) > 100) {
      const longName = Buffer.from(file.name + '\0', 'utf8');
      parts.push(_header('././@LongLink', longName.length, 'L'), _pad(longName));
    }
    parts.push(_header(file.name, file.data.length, '0'), _pad(file.data));
  }
  parts.push(Buffer.alloc(1024, 0));
  return Buffer.concat(parts);
}

function _readString(buf, start, len) {
  const slice = buf.subarray(start, start + len);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8');
}

/**
 * @param {Buffer} tar
 * @returns {Array<{name: string, data: Buffer}>}
 */
function readTar(tar) {
  const entries = [];
  let offset = 0;
  let pendingName = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const size = parseInt(_readString(header, 124, 12).trim() || '0', 8);
    const typeflag = String.fromCharCode(header[156]);
    const dataStart = offset + 512;
    const data = tar.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / 512) * 512;

    if (typeflag === 'L') {
      pendingName = _readString(data, 0, data.length);
      continue;
    }
    if (typeflag === '5') continue;
    if (typeflag !== '0' && typeflag !== '\0') continue;

    const name = pendingName || _readString(header, 0, 100);
    pendingName = null;
    entries.push({ name, data });
  }
  return entries;
}


function _assertInsidePack(target) {
  const root = path.resolve(getPackDir());
  const resolved = path.resolve(target);
  const rel = path.relative(root, resolved);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Refusing to extract outside the pack directory: ${target}`);
  }
}

function _extract(entries) {
  const root = getPackDir();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    _assertInsidePack(target);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, entry.data, { mode: 0o600 });
  }
}

async function _download(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Konoha-CLI-CyberPack' } });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * @param {{confirm?: boolean, archivePath?: string, manifestPath?: string,
 *          version?: string, conn?: object, log?: Function}} [options]
 */
async function install(options = {}) {
  const log = options.log || (() => {});
  if (!options.confirm) {
    const err = new Error('Cyber pack install requires --confirm.');
    err.code = 'CYBER_PACK_CONFIRM_REQUIRED';
    throw err;
  }

  const version = options.version || require('../package.json').version;
  let manifest;
  if (options.manifestPath) {
    manifest = _readJson(options.manifestPath);
  } else if (fs.existsSync(getManifestPath())) {
    manifest = _readJson(getManifestPath());
  } else {
    // Clean checkout: fetch the manifest from the same release as the archive.
    const manifestUrl = `${RELEASE_BASE}/v${version}/manifest.json`;
    log(`Fetching pack manifest from ${manifestUrl}`);
    manifest = JSON.parse((await _download(manifestUrl)).toString('utf8'));
  }
  if (!manifest || !manifest.sha256) {
    throw new Error('Cyber pack manifest with sha256 is required (manifest.json).');
  }

  const archive = options.archivePath
    ? fs.readFileSync(options.archivePath)
    : await _download(manifest.url || `${RELEASE_BASE}/v${version}/akatsuki-cyber-pack-${version}.tar.zst`);

  const actual = _sha256(archive);
  if (actual !== manifest.sha256) {
    throw new Error(`Cyber pack checksum mismatch: expected ${manifest.sha256}, got ${actual}`);
  }

  const tar = zlib.zstdDecompressSync(archive);
  _extract(readTar(tar));

  fs.writeFileSync(
    getConsentPath(),
    JSON.stringify({
      opted_in_at: new Date().toISOString(),
      version,
      sha256: manifest.sha256,
      notice: CONSENT_TEXT
    }, null, 2),
    { mode: 0o600 }
  );
  fs.writeFileSync(getManifestPath(), JSON.stringify(manifest, null, 2), { mode: 0o600 });

  if (options.conn) _recordMigration(options.conn, manifest.sha256);
  log(`Cyber pack ${version} installed to ${getPackDir()}`);
  return { ok: true, state: 'opted-in', version, sha256: manifest.sha256, packDir: getPackDir() };
}

function _recordMigration(conn, checksum) {
  conn.prepare(
    `INSERT OR REPLACE INTO schema_migrations (migration_id, checksum_sha256, applied_at, execution_ms)
     VALUES (?, ?, ?, ?)`
  ).run(MIGRATION_ID, checksum, new Date().toISOString(), 0);
}

// Two layouts exist: the legacy in-repo asset dir and the opt-in pack dir.
const CYBER_ROW_PATTERNS = Object.freeze([
  `%${PACK_ASSET_DIR}%`,
  `%${PACK_DIR_NAME}%skills%`
]);
const CYBER_ROW_WHERE = 'file_path LIKE ? OR file_path LIKE ?';

/**
 * Delete indexed cyber rows and on-disk pack copies. Backs up the DB first.
 *
 * @param {{conn?: object, dbPath?: string, backup?: Function, log?: Function}} [options]
 */
function remove(options = {}) {
  const log = options.log || (() => {});
  const conn = options.conn;
  let backupPath = null;
  let removedRows = 0;
  let removedChunks = 0;

  if (conn) {
    const db = require('./db');
    backupPath = db.backupDatabase(null, options.dbPath || null).targetPath;
    const names = conn
      .prepare(`SELECT DISTINCT skill_name FROM skills WHERE ${CYBER_ROW_WHERE}`)
      .all(...CYBER_ROW_PATTERNS)
      .map((r) => r.skill_name);
    const delChunks = conn.prepare('DELETE FROM skill_chunks WHERE skill_name = ?');
    const delSkills = conn.prepare(`DELETE FROM skills WHERE ${CYBER_ROW_WHERE}`);
    conn.transaction(() => {
      for (const name of names) removedChunks += delChunks.run(name).changes;
      removedRows = delSkills.run(...CYBER_ROW_PATTERNS).changes;
    })();
    _recordMigration(conn, 'removed');
  }

  const dirs = [
    getPackDir(),
    path.join(os.homedir(), '.konoha', 'skills', 'akatsuki-skill', 'references', PACK_ASSET_DIR),
    path.join(os.homedir(), '.omp', 'skills', 'akatsuki-skill', 'references', PACK_ASSET_DIR),
    path.join(os.homedir(), '.agents', 'skills', 'akatsuki-skill', 'references', PACK_ASSET_DIR)
  ];
  const removedDirs = [];
  for (const dir of dirs) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      removedDirs.push(dir);
    }
  }

  log(`Removed ${removedRows} cyber skill rows and ${removedChunks} chunks.`);
  if (backupPath) log(`Backup: ${backupPath}`);
  return { ok: true, state: 'removed', removedRows, removedChunks, removedDirs, backupPath };
}

/**
 * Machine-readable status.
 */
function status(conn = null) {
  const state = getState(conn);
  let rows = 0;
  if (conn) {
    try {
      rows = conn.prepare(`SELECT COUNT(*) n FROM skills WHERE ${CYBER_ROW_WHERE}`).get(...CYBER_ROW_PATTERNS).n;
    } catch (_) {
      rows = 0;
    }
  }
  return { state, rows, packDir: getPackDir(), consent: getConsentPath() };
}

module.exports = {
  PACK_DIR_NAME,
  PACK_ASSET_DIR,
  MIGRATION_ID,
  CONSENT_TEXT,
  getPackDir,
  getConsentPath,
  getManifestPath,
  getSkillsDir,
  getState,
  install,
  remove,
  status,
  createTar,
  readTar
};
