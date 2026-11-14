/**
 * Test Suite: deployment safety.
 *
 * Konoha writes into client homes it does not own. Three writes used to be
 * destructive: SOUL.md replaced wholesale, Claude agent files replaced without
 * checking who wrote them, and `mcp_*.md` files deleted by filename alone.
 * Each case below fails if that behaviour comes back.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-deploy-safety-'));
process.env.HOME = tmpRoot;
process.env.USERPROFILE = tmpRoot;
process.env.KONOHA_HOME = path.join(tmpRoot, '.konoha');
process.env.KONOHA_DB_PATH = path.join(tmpRoot, 'deploy.db');

const deployUtils = require('../src/deploy_utils');
const {
  generateClaudeCodeSubagent,
  isKonohaOwnedAgentFile,
  AGENT_OWNERSHIP_MARKER,
  _cleanMcpAgentFiles
} = require('../src/mcp_clients/claude_code');
const { KONOHA_START_TAG, KONOHA_END_TAG } = require('../src/config_merger');

const HOME_DIR = path.join(tmpRoot, 'home');

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function run() {
  console.log('Running test_deploy_safety tests...');

  // --- copyIfDifferent: default stays overwrite, opt-in backs up ---------
  const src = write(path.join(tmpRoot, 'src', 'a.txt'), 'new');
  const plainDest = write(path.join(tmpRoot, 'plain', 'a.txt'), 'user content');
  deployUtils.copyIfDifferent(src, plainDest);
  assert.strictEqual(read(plainDest), 'new', 'Default strategy must keep overwriting');
  assert.ok(!fs.existsSync(`${plainDest}.konoha-backup`),
    'Default strategy must not leave backups behind');

  const safeDest = write(path.join(tmpRoot, 'safe', 'a.txt'), 'user content');
  deployUtils.copyIfDifferent(src, safeDest, { strategy: 'backup' });
  assert.strictEqual(read(safeDest), 'new');
  assert.strictEqual(read(`${safeDest}.konoha-backup`), 'user content',
    'backup strategy must preserve the file Konoha replaced');

  // A second overwrite must not clobber the original backup.
  fs.writeFileSync(src, 'newer', 'utf8');
  deployUtils.copyIfDifferent(src, safeDest, { strategy: 'backup' });
  assert.strictEqual(read(`${safeDest}.konoha-backup`), 'user content',
    'The first backup must survive later overwrites');

  // Identical content is a no-op either way.
  const sameDest = write(path.join(tmpRoot, 'same', 'a.txt'), 'newer');
  assert.strictEqual(deployUtils.copyIfDifferent(src, sameDest, { strategy: 'backup' }), false);
  assert.ok(!fs.existsSync(`${sameDest}.konoha-backup`), 'No backup for an unchanged file');

  // --- SOUL.md: managed block, user content preserved -------------------
  // syncSoulAcrossClients always sources from the repo template, so assert
  // against that rather than a fixture the deployer never reads.
  const soulSrc = path.join(__dirname, '..', 'src', 'templates', 'SOUL.md');
  const soulBody = fs.readFileSync(soulSrc, 'utf8').trim().split('\n')[0];
  const soulTarget = path.join(HOME_DIR, '.agents', 'SOUL.md');
  write(soulTarget, 'My own preamble.\n\nMy own epilogue.\n');

  const first = deployUtils.syncSoulAcrossClients({ home: HOME_DIR, silent: true });
  assert.ok(first.appended >= 1, 'Missing SOUL files must be created');
  assert.ok(first.conflicts.includes(soulTarget), 'A pre-existing unmarked SOUL.md must be reported');
  assert.strictEqual(read(`${soulTarget}.konoha-backup`), 'My own preamble.\n\nMy own epilogue.\n',
    'The pre-block SOUL.md must be backed up, not lost');
  assert.ok(read(soulTarget).includes(KONOHA_START_TAG) && read(soulTarget).includes(KONOHA_END_TAG),
    'Konoha content must be wrapped in the managed block markers');

  // User edits outside the block survive the next sync.
  write(soulTarget, `My own preamble.\n\n${KONOHA_START_TAG}\nstale konoha body\n${KONOHA_END_TAG}\n\nMy own epilogue.\n`);
  const second = deployUtils.syncSoulAcrossClients({ home: HOME_DIR, silent: true });
  assert.ok(second.updated >= 1, 'An outdated block must be updated');
  const afterSync = read(soulTarget);
  assert.ok(afterSync.includes('My own preamble.'), 'Content before the block must survive');
  assert.ok(afterSync.includes('My own epilogue.'), 'Content after the block must survive');
  assert.ok(afterSync.includes(soulBody), 'The block must carry the current template');
  assert.ok(!afterSync.includes('stale konoha body'), 'The stale block body must be replaced');
  assert.strictEqual(afterSync.split(KONOHA_START_TAG).length - 1, 1, 'Exactly one managed block');

  // A third sync with nothing to change reports no writes.
  const third = deployUtils.syncSoulAcrossClients({ home: HOME_DIR, silent: true });
  assert.strictEqual(third.updated, 0, 'An up-to-date block must not be rewritten');
  assert.ok(third.skipped >= 1);

  // --- Claude agent ownership marker ------------------------------------
  const owned = generateClaudeCodeSubagent({
    name: 'genin',
    description: 'Scout',
    instructions: 'Explore.',
    skills: []
  });
  assert.ok(owned.startsWith('---'), 'Agent files start with YAML frontmatter');
  assert.ok(owned.split('\n').slice(0, 12).some((l) => l.trim() === AGENT_OWNERSHIP_MARKER),
    'Generated agents must carry the ownership marker inside the frontmatter');

  const ownedPath = write(path.join(tmpRoot, 'agents', 'genin.md'), owned);
  assert.strictEqual(isKonohaOwnedAgentFile(ownedPath), true);

  const foreignPath = write(path.join(tmpRoot, 'agents', 'handwritten.md'),
    '---\nname: handwritten\ndescription: mine\n---\n\nMy own agent.\n');
  assert.strictEqual(isKonohaOwnedAgentFile(foreignPath), false,
    'A file without the marker must be treated as user-owned');

  const bodyOnly = write(path.join(tmpRoot, 'agents', 'body.md'),
    'generated_by: konoha appears in prose but not in frontmatter\n');
  assert.strictEqual(isKonohaOwnedAgentFile(bodyOnly), false,
    'The marker counts only inside frontmatter');

  // --- Cleanup only removes Konoha-owned mcp_* files --------------------
  const agentsDir = path.join(tmpRoot, 'agents-clean');
  const konohaMcp = write(path.join(agentsDir, 'mcp_alpha.md'),
    `---\nname: mcp_alpha\n${AGENT_OWNERSHIP_MARKER}\n---\n\nGenerated.\n`);
  const userMcp = write(path.join(agentsDir, 'mcp_beta.md'),
    '---\nname: mcp_beta\ndescription: user agent\n---\n\nMine.\n');
  const konohaNonMcp = write(path.join(agentsDir, 'kage.md'), owned);

  _cleanMcpAgentFiles(agentsDir);
  assert.ok(!fs.existsSync(konohaMcp), 'Konoha-generated mcp_* files must be cleaned up');
  assert.ok(fs.existsSync(userMcp), 'A user-authored mcp_*.md must survive');
  assert.ok(fs.existsSync(konohaNonMcp), 'Non-mcp_* files are not touched by this cleanup');

  console.log('✓ Deploy safety: backup strategy, SOUL managed block, agent ownership verified.');
}

run();
