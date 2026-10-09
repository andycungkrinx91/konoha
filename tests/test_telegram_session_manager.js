/**
 * Unit Test for Telegram Multi-Session & Workspace Switcher.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Isolate test database
const testDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-session-test-'));
const testDbPath = path.join(testDbDir, 'konoha.db');
process.env.KONOHA_DB_PATH = testDbPath;

const dbModule = require('../src/db');
const conn = dbModule.getConnection(testDbPath);
dbModule.setupSchema(conn);

// Create temporary real workspace directories for testing (outside /tmp to satisfy isRealWorkspace)
const testWorkspacesRoot = path.join(__dirname, '.test_workspaces_' + Date.now());
const projA = path.normalize(process.cwd());
const projB = path.join(testWorkspacesRoot, 'projectB');
const projC = path.join(testWorkspacesRoot, 'projectC');
fs.mkdirSync(projB, { recursive: true });
fs.mkdirSync(projC, { recursive: true });

// Seed active_sessions with simulated multi-client setup
const nowMs = Date.now();
const t1 = new Date(nowMs - 5000).toISOString();
const t2 = new Date(nowMs - 10000).toISOString();
const t3 = new Date(nowMs - 15000).toISOString();

conn.prepare(`
  INSERT INTO active_sessions (client, workspace_root, session_id, transcript_path, last_active_at)
  VALUES (?, ?, ?, ?, ?)
`).run('antigravity', projA, 'sess_agy_projA_111', null, t1);

conn.prepare(`
  INSERT INTO active_sessions (client, workspace_root, session_id, transcript_path, last_active_at)
  VALUES (?, ?, ?, ?, ?)
`).run('antigravity', projB, 'sess_agy_projB_222', null, t2);

conn.prepare(`
  INSERT INTO active_sessions (client, workspace_root, session_id, transcript_path, last_active_at)
  VALUES (?, ?, ?, ?, ?)
`).run('claudecode', projC, 'sess_claude_projC_333', null, t3);

const sessionManager = require('../src/telegram/session_manager');
const workerModule = require('../src/queue/worker');
const inboxModule = require('../src/queue/inbox');

async function run() {
  console.log('Running test_telegram_session_manager.js...');

  try {
    // 1. Test getActiveSessions
    const sessions = sessionManager.getActiveSessions();
    assert.strictEqual(sessions.length, 3, 'Must discover 3 seeded active sessions');
    assert.strictEqual(sessions[0].client, 'antigravity', 'Most recent session is antigravity');
    assert.strictEqual(sessions[0].workspace_root, projA, 'First session workspace is projA');
    assert.strictEqual(sessions[1].workspace_root, projB, 'Second session workspace is projB');
    assert.strictEqual(sessions[2].client, 'claudecode', 'Third session client is claudecode');

    // 2. Test getTargetSession defaults to most recent
    const defaultTarget = sessionManager.getTargetSession('123456');
    assert.strictEqual(defaultTarget.workspace_root, projA, 'Default target is projA');

    // 3. Test setTargetSession by 1-based index
    const res2 = sessionManager.setTargetSession('123456', '2');
    assert.strictEqual(res2.success, true, 'Switching to session 2 succeeds');
    assert.strictEqual(res2.session.workspace_root, projB, 'Selected projB');

    const updatedTarget = sessionManager.getTargetSession('123456');
    assert.strictEqual(updatedTarget.workspace_root, projB, 'Persisted target is projB');

    // 4. Test strict number-only validation (reject text/client names)
    const resClaude = sessionManager.setTargetSession('123456', 'claude');
    assert.strictEqual(resClaude.success, false, 'Non-number selector "claude" must fail');
    assert.ok(resClaude.error.includes('Choose a number between 1 and 3'), 'Error directs user to valid number range');

    // 5. Test strict number-only validation (reject directory names)
    const resDir = sessionManager.setTargetSession('123456', 'projecta');
    assert.strictEqual(resDir.success, false, 'Path selector "projecta" must fail');

    // 6. Test out of bounds index selection
    const resOutOfRange = sessionManager.setTargetSession('123456', '99');
    assert.strictEqual(resOutOfRange.success, false, 'Out-of-range session number 99 fails');

    const resZero = sessionManager.setTargetSession('123456', '0');
    assert.strictEqual(resZero.success, false, 'Index 0 fails');

    // Switch to session 3
    const res3 = sessionManager.setTargetSession('123456', '3');
    assert.strictEqual(res3.success, true, 'Switching to session 3 succeeds');
    assert.strictEqual(res3.session.workspace_root, projC, 'Selected projC');

    // 7. Test formatSessionList
    const listHtml = sessionManager.formatSessionList('123456');
    assert.ok(listHtml.includes('ACTIVE SESSIONS & WORKSPACES'), 'Must render header');
    assert.ok(listHtml.includes(projA), 'Must list projA');
    assert.ok(listHtml.includes(projB), 'Must list projB');
    assert.ok(listHtml.includes(projC), 'Must list projC');
    assert.ok(listHtml.includes('(CURRENT TARGET)'), 'Must flag active target');
    assert.strictEqual((listHtml.match(/\(CURRENT TARGET\)/g) || []).length, 1, 'Exactly one session has CURRENT TARGET');
    assert.ok(listHtml.includes('Session ID:'), 'Must display Session ID');
    assert.ok(listHtml.includes('<code>/session &lt;number&gt;</code>'), 'Must specify number-only usage');
    assert.ok(!listHtml.includes('client|workspace'), 'Must not contain legacy multi-selector instructions');

    // Test shared workspace exclusivity: add another client to projC
    conn.prepare(`
      INSERT INTO active_sessions (client, workspace_root, session_id, transcript_path, last_active_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('antigravity', projC, 'sess_agy_same_ws_444', null, new Date(Date.now() - 2000).toISOString());

    const sessionsAfterInsert = sessionManager.getActiveSessions();
    const agyProjCIndex = sessionsAfterInsert.findIndex(s => s.session_id === 'sess_agy_same_ws_444') + 1;
    assert.ok(agyProjCIndex > 0, 'Found antigravity in projC');

    sessionManager.setTargetSession('123456', String(agyProjCIndex));
    const sharedWsListHtml = sessionManager.formatSessionList('123456');
    const sharedBadgeCount = (sharedWsListHtml.match(/\(CURRENT TARGET\)/g) || []).length;
    assert.strictEqual(sharedBadgeCount, 1, 'Exclusively ONE session has CURRENT TARGET when two clients share same workspace');

    // Test isSessionAlive freshness filtering
    const liveSess = { client: 'antigravity', workspace_root: projA, session_id: 'test_live', last_active_at: new Date(Date.now() - 5000).toISOString() };
    const staleSess = { client: 'antigravity', workspace_root: projA, session_id: 'test_stale', last_active_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString() };
    assert.strictEqual(sessionManager.isSessionAlive(liveSess), true, 'Recent session is alive');
    assert.strictEqual(sessionManager.isSessionAlive(staleSess), false, '3-hour old session is not alive');

    // 8. Test Dynamic Agent Detection (fixes hardcoded Kage & Jonin bug)
    assert.strictEqual(
      workerModule.detectExecutingAgent('/anbu fix docker networking', ''),
      'Black Ops Anbu',
      'Detects Anbu from /anbu'
    );
    assert.strictEqual(
      workerModule.detectExecutingAgent('/jonin refactor navigation header', ''),
      'Elite Builder Jonin',
      'Detects Jonin from /jonin'
    );
    assert.strictEqual(
      workerModule.detectExecutingAgent('/kage audit authentication architecture', ''),
      'Village Leader Kage',
      'Detects Kage from /kage'
    );
    assert.strictEqual(
      workerModule.detectExecutingAgent('/genin trace database migration calls', ''),
      'Scout Genin',
      'Detects Genin from /genin'
    );
    assert.strictEqual(
      workerModule.detectExecutingAgent('/tokubetsu_jonin generate API specification', ''),
      'Scribe Tokubetsu Jonin',
      'Detects Tokubetsu Jonin from /tokubetsu_jonin'
    );
    assert.strictEqual(
      workerModule.detectExecutingAgent('/sannin orchestrate deployment', ''),
      'Master Orchestrator Sannin',
      'Detects Sannin from /sannin'
    );

    // Test output turn marker extraction
    const mockOutput = 'Initializing turn...\n[♠ Anbu] active. Calling konoha.read_file_head...\nDone.';
    assert.strictEqual(
      workerModule.detectExecutingAgent('general coding task', mockOutput),
      'Black Ops Anbu',
      'Extracts Anbu from output marker'
    );

    // 9. Test inboxModule.enqueuePrompt with workspace_root and client
    const queuedTask = inboxModule.enqueuePrompt({
      prompt: 'Check server status',
      source: 'telegram',
      session_id: 'sess_claude_projC_333',
      workspace_root: '/home/user/projectC',
      client: 'claudecode'
    });
    assert.strictEqual(queuedTask.workspace_root, '/home/user/projectC', 'Queued task stores workspace_root');
    assert.strictEqual(queuedTask.client, 'claudecode', 'Queued task stores client');

    const row = conn.prepare('SELECT * FROM prompt_queue WHERE id = ?').get(queuedTask.id);
    assert.strictEqual(row.workspace_root, '/home/user/projectC', 'DB row persists workspace_root');
    assert.strictEqual(row.client, 'claudecode', 'DB row persists client');

    // 10. Test sessionManager.createSession
    const projCreate1 = path.join(testWorkspacesRoot, 'projectNewAgy');
    const projCreate2 = path.join(testWorkspacesRoot, 'projectNewClaude');
    const projCreate3 = path.join(testWorkspacesRoot, 'projectNewCodex');
    const projCreate4 = path.join(testWorkspacesRoot, 'projectNewPi');
    const projCreate5 = path.join(testWorkspacesRoot, 'projectNewOpenCode');
    const projCreate6 = path.join(testWorkspacesRoot, 'projectNewCmdCode');
    fs.mkdirSync(projCreate1, { recursive: true });
    fs.mkdirSync(projCreate2, { recursive: true });
    fs.mkdirSync(projCreate3, { recursive: true });
    fs.mkdirSync(projCreate4, { recursive: true });
    fs.mkdirSync(projCreate5, { recursive: true });
    fs.mkdirSync(projCreate6, { recursive: true });

    // 10a. Create with 'agy' alias -> maps to 'antigravity'
    const c1 = sessionManager.createSession('chat_999', 'agy', projCreate1);
    assert.strictEqual(c1.success, true, 'createSession with agy succeeds');
    assert.strictEqual(c1.session.client, 'antigravity', 'Canonicalized to antigravity');
    assert.strictEqual(c1.session.workspace_root, projCreate1, 'Workspace matches projCreate1');

    // Verify it became the immediate target for chat_999
    const target999 = sessionManager.getTargetSession('chat_999');
    assert.strictEqual(target999.workspace_root, projCreate1, 'Created session is target for chat');
    assert.strictEqual(target999.client, 'antigravity', 'Target client matches');

    // 10b. Create with 'claude' alias -> maps to 'claudecode'
    const c2 = sessionManager.createSession('chat_999', 'claude', projCreate2);
    assert.strictEqual(c2.success, true, 'createSession with claude succeeds');
    assert.strictEqual(c2.session.client, 'claudecode', 'Canonicalized to claudecode');

    // 10c. Create with 'codex'
    const c3 = sessionManager.createSession('chat_999', 'codex', projCreate3);
    assert.strictEqual(c3.success, true, 'createSession with codex succeeds');
    assert.strictEqual(c3.session.client, 'codex', 'Canonicalized to codex');

    // 10d. Create with 'pi'
    const c4 = sessionManager.createSession('chat_999', 'pi', projCreate4);
    assert.strictEqual(c4.success, true, 'createSession with pi succeeds');
    assert.strictEqual(c4.session.client, 'pi', 'Canonicalized to pi');

    // 10e. Create with 'opencode'
    const c5 = sessionManager.createSession('chat_999', 'opencode', projCreate5);
    assert.strictEqual(c5.success, true, 'createSession with opencode succeeds');
    assert.strictEqual(c5.session.client, 'opencode', 'Canonicalized to opencode');

    // 10f. Create with 'commandcode'
    const c6 = sessionManager.createSession('chat_999', 'commandcode', projCreate6);
    assert.strictEqual(c6.success, true, 'createSession with commandcode succeeds');
    assert.strictEqual(c6.session.client, 'commandcode', 'Canonicalized to commandcode');

    // 10g. Error cases
    const errClient = sessionManager.createSession('chat_999', 'unsupported_client', projCreate1);
    assert.strictEqual(errClient.success, false, 'Rejects unsupported client');
    assert.ok(errClient.error.includes('Unsupported client'), 'Returns helpful client error');

    const errMissingDir = sessionManager.createSession('chat_999', 'agy', '/non_existent_folder_abc_123');
    assert.strictEqual(errMissingDir.success, false, 'Rejects nonexistent directory');
    assert.ok(errMissingDir.error.includes('Directory does not exist'), 'Returns nonexistent error');

    const errTmp = sessionManager.createSession('chat_999', 'agy', '/tmp');
    assert.strictEqual(errTmp.success, false, 'Rejects /tmp workspace');

    const errHome = sessionManager.createSession('chat_999', 'agy', os.homedir());
    assert.strictEqual(errHome.success, false, 'Rejects $HOME workspace');

    // Verify formatSessionList now reflects creation command
    const updatedList = sessionManager.formatSessionList('chat_999');
    assert.ok(updatedList.includes('/session create &lt;client&gt; &lt;path&gt;'), 'List displays /session create');

    console.log('✓ All multi-session selection, creation, and dynamic agent tests passed cleanly.');
  } finally {
    try {
      fs.rmSync(testDbDir, { recursive: true, force: true });
    } catch (_) {}
    try {
      if (fs.existsSync(testWorkspacesRoot)) {
        fs.rmSync(testWorkspacesRoot, { recursive: true, force: true });
      }
    } catch (_) {}
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
