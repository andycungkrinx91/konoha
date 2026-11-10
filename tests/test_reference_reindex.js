'use strict';

/**
 * test_reference_reindex.js
 *
 * A reference file can be added, edited, or deleted without touching SKILL.md.
 * The indexer must notice all three, otherwise new references never reach SQLite
 * (get_skill falls back to a mirror read with a "not found in SQLite" warning)
 * and deleted references leave orphan rows that make every run re-index.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-refs-'));
process.env.KONOHA_DB_PATH = path.join(tmp, 'konoha.db');

const { migrateSingleSkill, optimizeContent, setupDb } = require('../src/migrate');

console.log('Running test_reference_reindex.js...');

const skillsRoot = path.join(tmp, 'skills');
const skillDir = path.join(skillsRoot, 'demo');
const refsDir = path.join(skillDir, 'references');
fs.mkdirSync(refsDir, { recursive: true });
fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Demo skill\n\nBody for the reference reindex test.\n');
fs.writeFileSync(path.join(refsDir, 'alpha.md'), 'alpha reference body\n');

const conn = setupDb();
const row = (name) => conn.prepare('SELECT name, file_path, byte_size, content FROM skills WHERE name = ?').get(name);
const migrate = () => migrateSingleSkill('demo', skillsRoot, conn);

migrate();
assert.ok(row('demo/alpha'), 'a first migration must index references/alpha.md');
assert.strictEqual(
  row('demo/alpha').byte_size,
  Buffer.byteLength(optimizeContent('alpha reference body\n'), 'utf8'),
  'indexed size must match the optimized file'
);


// An edit that keeps the byte length must still re-index; size alone is not identity.
fs.writeFileSync(path.join(refsDir, 'alpha.md'), 'alpha reference BODY\n');
migrate();
assert.strictEqual(
  row('demo/alpha').content,
  optimizeContent('alpha reference BODY\n'),
  'a same-length edit must still be re-indexed'
);
fs.writeFileSync(path.join(refsDir, 'alpha.md'), 'alpha reference body\n');
migrate();

fs.writeFileSync(path.join(refsDir, 'beta.md'), 'beta reference body\n');
migrate();
assert.ok(row('demo/beta'), 'an added reference must be indexed on an unchanged SKILL.md');

fs.writeFileSync(path.join(refsDir, 'beta.md'), 'beta reference body with a longer tail\n');
migrate();
assert.strictEqual(
  row('demo/beta').byte_size,
  Buffer.byteLength(optimizeContent('beta reference body with a longer tail\n'), 'utf8'),
  'an edited reference must be re-indexed with its new size'
);

fs.writeFileSync(path.join(skillDir, 'note.md'), 'root reference body\n');
migrate();
assert.ok(row('demo/note'), 'a root reference must be indexed on an unchanged SKILL.md');

fs.mkdirSync(path.join(refsDir, 'pack'), { recursive: true });
const packFile = path.join(refsDir, 'pack', 'SKILL.md');
fs.writeFileSync(packFile, '# Packed skill\n');
conn.prepare(
  "INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
).run('demo/packed', 'demo', 'reference', 'pack', 'packed', packFile, 6, 1);

fs.rmSync(path.join(refsDir, 'beta.md'));
migrate();
assert.strictEqual(row('demo/beta'), undefined, 'a deleted reference must be pruned from SQLite');
assert.ok(row('demo/packed'), 'a nested reference outside references/*.md must not be pruned');

const before = conn.prepare("SELECT COUNT(*) AS n FROM skills WHERE skill_name = 'demo'").get().n;
migrate();
assert.strictEqual(
  conn.prepare("SELECT COUNT(*) AS n FROM skills WHERE skill_name = 'demo'").get().n,
  before,
  'a pruned skill must stop re-indexing on the next run'
);

assert.doesNotThrow(() => migrateSingleSkill('demo', path.join(tmp, 'absent-root'), conn), 'a skill directory without references must not throw');

// Rows owned by another mirror under the same prefix are that mirror's business:
// pruning here must leave them alone even when their file is gone.
const foreignGhost = path.join(tmp, 'other-root', 'demo', 'references', 'ghost.md');
conn.prepare(
  "INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
).run('demo/ghost', 'demo', 'reference', 'ghost', 'ghost', foreignGhost, 5, 1);
migrate();
assert.ok(row('demo/ghost'), 'pruning must not delete rows owned by another root');

conn.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('All reference reindex tests passed cleanly!');