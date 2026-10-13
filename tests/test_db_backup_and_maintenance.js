'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const db = require('../src/db');
const toolsLogger = require('../src/tools_savings_logger');
const agentStats = require('../src/agent_stats');

test('Batch 3: backupDatabase creates a valid, online SQLite snapshot using VACUUM INTO', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-backup-test-'));
  const srcDbPath = path.join(tmpDir, 'source.db');
  const backupDbPath = path.join(tmpDir, 'backup.db');
  try {
    const conn = db.getConnection(srcDbPath);
    db.setupSchema(conn);
    conn.prepare("INSERT INTO agents (name, title, enable_mcp_tools) VALUES ('test_agent', 'Test Agent', 1)").run();
    conn.close();

    assert.ok(typeof db.backupDatabase === 'function', 'db.backupDatabase must be exported');
    const result = db.backupDatabase(backupDbPath, srcDbPath);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.targetPath, path.resolve(backupDbPath));
    assert.ok(fs.existsSync(backupDbPath), 'Backup file must exist on disk');
    assert.ok(result.sizeBytes > 0, 'Backup file size must be > 0');
    assert.strictEqual(fs.statSync(backupDbPath).mode & 0o777, 0o600, 'Explicit backup file mode must be 0600');

    // Verify default backup directory mode (0700) and default backup file mode (0600)
    const defaultResult = db.backupDatabase(null, srcDbPath);
    const defaultDirStat = fs.statSync(path.dirname(defaultResult.targetPath));
    const defaultFileStat = fs.statSync(defaultResult.targetPath);
    assert.strictEqual(defaultDirStat.mode & 0o777, 0o700, 'Default backup directory mode must be 0700');
    assert.strictEqual(defaultFileStat.mode & 0o777, 0o600, 'Default backup file mode must be 0600');

    // Verify backup database is readable and contains identical data
    const backupConn = db.getConnection(backupDbPath);
    const agentRow = backupConn.prepare("SELECT * FROM agents WHERE name = 'test_agent'").get();
    assert.ok(agentRow, 'Backup must contain test_agent row');
    assert.strictEqual(agentRow.title, 'Test Agent');
    backupConn.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Batch 3: pruneToolCalls prunes records older than retentionDays while keeping recent records', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-prune-test-'));
  const testDbPath = path.join(tmpDir, 'tool_calls_test.db');
  try {
    const conn = db.getConnection(testDbPath);
    db.setupSchema(conn);

    // Insert 1 recent call (today) and 1 old call (120 days ago)
    conn.prepare(`
      INSERT INTO tool_calls (tool, query, returned_bytes, total_library_bytes, bytes_saved, tokens_saved, timestamp)
      VALUES ('tool_recent', 'q1', 100, 200, 100, 25, datetime('now'))
    `).run();
    conn.prepare(`
      INSERT INTO tool_calls (tool, query, returned_bytes, total_library_bytes, bytes_saved, tokens_saved, timestamp)
      VALUES ('tool_old', 'q2', 100, 200, 100, 25, datetime('now', '-120 days'))
    `).run();

    const countBefore = conn.prepare("SELECT COUNT(*) as c FROM tool_calls").get().c;
    assert.strictEqual(countBefore, 2);
    conn.close();

    assert.ok(typeof toolsLogger.pruneToolCalls === 'function', 'toolsLogger.pruneToolCalls must be exported');
    const pruneResult = toolsLogger.pruneToolCalls(90, testDbPath);
    assert.strictEqual(pruneResult.deleted, 1, 'Should delete exactly 1 row older than 90 days');

    const checkConn = db.getConnection(testDbPath);
    const remaining = checkConn.prepare("SELECT tool FROM tool_calls").all();
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].tool, 'tool_recent');
    checkConn.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Batch 3: normalizeAgentName and getAgentStats aggregate historical aliases into canonical agent', (t) => {
  assert.ok(typeof agentStats.normalizeAgentName === 'function', 'agentStats.normalizeAgentName must be exported');
  assert.strictEqual(agentStats.normalizeAgentName('delegate-to-kage'), 'kage');
  assert.strictEqual(agentStats.normalizeAgentName('delegate_to_jonin'), 'jonin');
  assert.strictEqual(agentStats.normalizeAgentName('mcp_anbu'), 'anbu');
  assert.strictEqual(agentStats.normalizeAgentName('tokubetsu_jonin'), 'tokubetsu-jonin');
  assert.strictEqual(agentStats.normalizeAgentName(''), '(direct)');
  assert.strictEqual(agentStats.normalizeAgentName(null), '(direct)');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-stats-test-'));
  const testDbPath = path.join(tmpDir, 'stats_test.db');
  try {
    const conn = db.getConnection(testDbPath);
    db.setupSchema(conn);

    // Insert tool calls with legacy alias and canonical name for kage
    conn.prepare(`
      INSERT INTO tool_calls (tool, query, returned_bytes, total_library_bytes, bytes_saved, tokens_saved, agent, timestamp)
      VALUES ('tool1', 'q1', 10, 20, 10, 2, 'delegate-to-kage', datetime('now'))
    `).run();
    conn.prepare(`
      INSERT INTO tool_calls (tool, query, returned_bytes, total_library_bytes, bytes_saved, tokens_saved, agent, timestamp)
      VALUES ('tool2', 'q2', 10, 20, 10, 2, 'kage', datetime('now'))
    `).run();
    conn.close();

    const stats = agentStats.getAgentStats(testDbPath);
    assert.ok(stats.kage, 'Canonical agent kage must exist in aggregated stats');
    assert.strictEqual(stats.kage.alltime, 2, 'Both kage and delegate-to-kage calls must roll up into kage (alltime: 2)');
    assert.strictEqual(stats['delegate-to-kage'], undefined, 'Legacy alias should not be an independent key in stats');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Batch 3: CLI konoha data backup command executes successfully', (t) => {
  const cliPath = path.resolve(__dirname, '../bin/cli.js');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-cli-backup-'));
  const testDbPath = path.join(tmpDir, 'test_cli.db');
  const backupTarget = path.join(tmpDir, 'cli_backup.db');
  try {
    const conn = db.getConnection(testDbPath);
    db.setupSchema(conn);
    conn.close();

    const output = execFileSync(process.execPath, [cliPath, 'data', 'backup', backupTarget], {
      env: { ...process.env, KONOHA_DB_PATH: testDbPath },
      encoding: 'utf8'
    });
    assert.ok(output.includes('Successfully created database backup') || output.includes('backup'), 'CLI output should indicate backup success');
    assert.ok(fs.existsSync(backupTarget), 'Backup target file must exist after CLI command');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
