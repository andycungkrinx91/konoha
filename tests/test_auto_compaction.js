#!/usr/bin/env node
'use strict';

/**
 * tests/test_auto_compaction.js — E2E tests for Automatic Context Compaction after 2 prompts.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../src/db');
const server = require('../src/server');
const personaMemory = require('../src/persona_memory');

async function run() {
  console.log('Running test_auto_compaction tests...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto_compact_'));
  const prevDbPath = db.DB_PATH;
  const prevServerDb = server.DB_PATH;
  const prevPersonaDb = personaMemory.DB_PATH;
  const prevActiveClient = server.ACTIVE_CLIENT;

  const testDbPath = path.join(tmpDir, 'test_skills.db');
  const projectDir = path.join(tmpDir, 'ecommerce_app');
  fs.mkdirSync(projectDir, { recursive: true });

  db.DB_PATH = testDbPath;
  server.DB_PATH = testDbPath;
  personaMemory.DB_PATH = testDbPath;

  // Setup minimal agent in DB
  const conn = db.getDb(testDbPath);
  conn.prepare(`
    CREATE TABLE IF NOT EXISTS agents (
      name TEXT PRIMARY KEY,
      title TEXT,
      purpose TEXT,
      skills TEXT,
      constraints_text TEXT,
      instructions TEXT,
      model_tier TEXT
    )
  `).run();
  conn.prepare(`
    INSERT OR REPLACE INTO agents (name, title, purpose, skills, constraints_text, instructions, model_tier)
    VALUES ('jonin', 'Jonin UI Master', 'Frontend implementation', '[]', 'Light mode only', 'Build clean UI', 'Pro')
  `).run();
  conn.close();

  // Mock package.json
  fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
    name: 'ecommerce-app',
    dependencies: { next: '16.0.0', tailwindcss: '^4.0.0' }
  }));

  try {
    // Turn 1 vs Turn 2 unified token-bounded prompt and prefix determinism
    server.SESSION_TURNS.clear();
    process.env.ANTIGRAVITY_CONVERSATION_ID = 'conv-test-123';
    server.ACTIVE_CLIENT = 'agy';

    const res1Json = server.runMcpAgent('jonin', {
      task: 'Scaffold hero section',
      project_path: projectDir
    });
    const res1 = JSON.parse(res1Json);
    const instr1 = res1.instructions || '';
    const len1 = instr1.length;

    const res2Json = server.runMcpAgent('jonin', {
      task: 'Scaffold hero section',
      project_path: projectDir
    });
    const res2 = JSON.parse(res2Json);
    const instr2 = res2.instructions || '';
    const len2 = instr2.length;

    assert.ok(len1 < 8000, `Turn 1 length (${len1}) must be token-bounded (< 8KB)`);
    assert.ok(len2 < 8000, `Turn 2 length (${len2}) must be token-bounded (< 8KB)`);
    assert.strictEqual(instr1, instr2, 'Same task across Turn 1 and Turn 2 must be 100% deterministic');
    assert.strictEqual(res1.quota_compaction.quota_tokens, 100000, 'Default per-agent input token quota must be 100,000');
    assert.strictEqual(res1.quota_compaction.triggered, false, 'Turn 1 below 100k quota must not trigger compaction');
    assert.strictEqual(res2.quota_compaction.triggered, false, 'Turn 2 below 100k quota must not trigger per-2-turn compaction');
    assert.ok(instr1.includes('[Konoha Token Preservation: Active'));
    assert.ok(instr1.includes('ecommerce-app'));
    assert.ok(instr1.includes('Next.js'));
    assert.ok(instr1.includes('pnpm'));
    console.log('✓ Turn 1 vs Turn 2 unified token-bounded prompt passed');

    // Multi-client support
    const clients = ['claudecode', 'commandcode', 'opencode', 'agy', 'cursor'];
    for (const client of clients) {
      server.ACTIVE_CLIENT = client;
      process.env.SESSION_ID = `session-${client}-999`;

      const r1 = JSON.parse(server.runMcpAgent('jonin', { task: 'Task 1', project_path: projectDir }));
      const r2 = JSON.parse(server.runMcpAgent('jonin', { task: 'Task 1', project_path: projectDir }));

      assert.ok(r1.instructions.length < 8000, `${client} prompt must be bounded (< 8KB)`);
      assert.strictEqual(r1.instructions, r2.instructions, `${client} prompt must be deterministic`);
      assert.ok(r2.instructions.includes('Token Preservation'), `${client} Turn 2 must include Token Preservation badge`);
      assert.ok(r2.instructions.includes('ecommerce-app'), `${client} Turn 2 must retain project context`);
    }
    console.log('✓ Multi-client support passed');

    // Compact turn retains skill SOP and task authority
    const conn2 = db.getDb(testDbPath);
    conn2.prepare(`
      CREATE TABLE IF NOT EXISTS skills (
        name TEXT PRIMARY KEY,
        skill_name TEXT,
        type TEXT,
        content TEXT,
        tags TEXT,
        byte_size INTEGER DEFAULT 0
      )
    `).run();
    conn2.prepare(`
      INSERT OR REPLACE INTO skills (name, skill_name, type, content, tags, byte_size)
      VALUES ('jonin-skill', 'jonin-skill', 'skill', 'Root cause first: reproduce the bug, read the failing code, then fix. Never delete prior fixes when a new error appears.', 'ui', 120)
    `).run();
    conn2.prepare("UPDATE agents SET instructions = ? WHERE name = 'jonin'").run(
      'Step 1. Reproduce the reported bug. '.repeat(60)
    );
    conn2.close();

    process.env.ANTIGRAVITY_CONVERSATION_ID = 'conv-compact-retention';
    server.ACTIVE_CLIENT = 'agy';
    server.SESSION_TURNS.clear();

    JSON.parse(server.runMcpAgent('jonin', { task: 'Turn one task', project_path: projectDir }));
    const r2Retention = JSON.parse(server.runMcpAgent('jonin', { task: 'Fix the DB9 reload bug', project_path: projectDir }));
    const instr2Retention = r2Retention.instructions || '';

    assert.ok(instr2Retention.includes('jonin-skill'), 'Must contain skill name');
    assert.ok(instr2Retention.includes('Root cause first'), 'Must contain skill SOP preview');
    assert.ok(instr2Retention.includes('authoritative task'), 'Must contain authoritative task directive');
    assert.ok(instr2Retention.includes('Never reinterpret, narrow, or replace'), 'Must contain task invariant directive');
    assert.ok(instr2Retention.includes('Fix the DB9 reload bug'), 'Must contain full task text');
    if (instr2Retention.includes('...[truncated]')) {
      const truncatedAt = instr2Retention.indexOf('...[truncated]');
      assert.ok(instr2Retention.slice(0, truncatedAt).includes('Reproduce the reported bug.'));
    }
    console.log('✓ Compact turn retains skill SOP and task authority passed');

    // Session turn resets after idle
    delete process.env.ANTIGRAVITY_CONVERSATION_ID;
    delete process.env.CLAUDE_CONVERSATION_ID;
    delete process.env.OPENCODE_SESSION_ID;
    delete process.env.COMMANDCODE_SESSION_ID;
    delete process.env.CURSOR_SESSION_ID;
    delete process.env.SESSION_ID;

    server.SESSION_TURNS.clear();
    server.SESSION_TURN_LAST_ACCESS.clear();
    server.ACTIVE_CLIENT = 'agy';

    const cd = require('../src/mcp/client_detection');
    const sessKey = cd.getSessionKey(projectDir);
    const t1 = cd.getAndIncrementSessionTurn(sessKey);
    const t2 = cd.getAndIncrementSessionTurn(sessKey);
    assert.strictEqual(t1, 1);
    assert.strictEqual(t2, 2);

    // Simulate 31 minutes of inactivity
    server.SESSION_TURN_LAST_ACCESS.set(sessKey, server.SESSION_TURN_LAST_ACCESS.get(sessKey) - (server.SESSION_IDLE_RESET_SECONDS + 60));

    const t3 = cd.getAndIncrementSessionTurn(sessKey);
    assert.strictEqual(t3, 1, 'Turn counter must reset to 1 after 30 min idle');
    console.log('✓ Session turn resets after idle passed');

    // Cross-session and Cross-project turn isolation
    const projectDirA = path.join(tmpDir, 'project-a');
    const projectDirB = path.join(tmpDir, 'project-b');
    fs.mkdirSync(projectDirA, { recursive: true });
    fs.mkdirSync(projectDirB, { recursive: true });

    server.SESSION_TURNS.clear();
    // Same client, different projects
    const keyProjA = cd.getSessionKey(projectDirA, 'sess-common');
    const keyProjB = cd.getSessionKey(projectDirB, 'sess-common');
    assert.notStrictEqual(keyProjA, keyProjB, 'Same client in different projects must have different keys');

    const turnA = cd.getAndIncrementSessionTurn(keyProjA);
    const turnA_next = cd.getAndIncrementSessionTurn(keyProjA);
    const turnB = cd.getAndIncrementSessionTurn(keyProjB);
    assert.strictEqual(turnA, 1);
    assert.strictEqual(turnA_next, 2);
    assert.strictEqual(turnB, 1, 'Project B must not inherit Project A turn count');

    // Different client, different projects
    server.ACTIVE_CLIENT = 'cursor';
    const keyCursorB = cd.getSessionKey(projectDirB, 'sess-1');
    server.ACTIVE_CLIENT = 'agy';
    const keyAgyA = cd.getSessionKey(projectDirA, 'sess-1');
    assert.notStrictEqual(keyCursorB, keyAgyA);

    // Different client, same project
    server.ACTIVE_CLIENT = 'cursor';
    const keyCursorSame = cd.getSessionKey(projectDirA, 'sess-1');
    server.ACTIVE_CLIENT = 'claudecode';
    const keyClaudeSame = cd.getSessionKey(projectDirA, 'sess-1');
    assert.notStrictEqual(keyCursorSame, keyClaudeSame);
    console.log('✓ Cross-session and cross-project turn isolation passed');

    // Dynamic input token quota LangGraph State checkpointing, compaction & auto-continue
    const {
      AGENT_INPUT_TOKENS,
      resetAgentInputTokens,
      resolveDynamicInputQuota,
      getLatestLangGraphCompactionState
    } = require('../src/context_compaction');
    const { KonohaCheckpointSaver } = require('../src/mcp/langgraph/checkpointer');
    const prevEnvQuota = process.env.KONOHA_AGENT_INPUT_TOKEN_QUOTA;
    try {
      process.env.KONOHA_AGENT_INPUT_TOKEN_QUOTA = '120000';
      assert.strictEqual(resolveDynamicInputQuota(), 120000, 'Env variable KONOHA_AGENT_INPUT_TOKEN_QUOTA must dynamically override default');
      delete process.env.KONOHA_AGENT_INPUT_TOKEN_QUOTA;
      assert.strictEqual(resolveDynamicInputQuota(), 100000, 'Default dynamic quota must return 100000');

      const quotaTaskDir = path.join(tmpDir, 'quota-task-dir');
      fs.mkdirSync(quotaTaskDir, { recursive: true });
      fs.writeFileSync(path.join(quotaTaskDir, 'status.json'), JSON.stringify({
        task_id: 'quota_t1',
        client: 'antigravity',
        prompt: 'Implement dynamic quota checkpointing',
        plan: '1. Monitor tokens\n2. Capture LangGraph state\n3. Compact and continue',
        tasks: [{ id: 'task_1', content: 'Implement dynamic quota checkpointing', status: 'in_progress', agent: 'jonin' }]
      }, null, 2), 'utf8');

      resetAgentInputTokens();
      const belowQuotaRes = JSON.parse(server.runMcpAgent('jonin', {
        task: 'Continue implementing quota guard',
        project_path: projectDir,
        task_dir: quotaTaskDir,
        task_id: 'quota_t1',
        session_id: 'quota-sess-1',
        observedInputTokens: 900,
        agent_input_token_quota: 2000
      }));
      assert.strictEqual(belowQuotaRes.quota_compaction.triggered, false);

      const atQuotaRes = JSON.parse(server.runMcpAgent('jonin', {
        task: 'Continue implementing quota guard',
        project_path: projectDir,
        task_dir: quotaTaskDir,
        task_id: 'quota_t1',
        session_id: 'quota-sess-1',
        observedInputTokens: 1500,
        agent_input_token_quota: 2000
      }));
      assert.strictEqual(atQuotaRes.quota_compaction.triggered, true, 'Accumulated tokens >= dynamic quota must trigger compaction');
      assert.strictEqual(atQuotaRes.quota_compaction.backend, 'langgraph_state', 'Must persist compaction snapshot via LangGraph State backend');
      assert.strictEqual(atQuotaRes.quota_compaction.checkpoint_persisted, true, 'checkpoint_persisted must be true on SQLite write success');
      assert.strictEqual(atQuotaRes.quota_compaction.auto_continue, true, 'Quota compaction must signal auto_continue');
      assert.strictEqual(atQuotaRes.quota_compaction.quota_tokens, 2000);
      assert.ok(atQuotaRes.quota_compaction.checkpoint_id, 'LangGraph checkpoint_id must be returned');
      assert.strictEqual(atQuotaRes.quota_compaction.checkpoint_ns, 'agent:jonin');
      assert.ok(atQuotaRes.instructions.includes('## LATEST CONDITION CHECKPOINT (Auto-Continue)'), 'Checkpoint block must be injected for auto-continue');

      const latestState = getLatestLangGraphCompactionState({ taskId: 'quota_t1', agent: 'jonin' });
      assert.ok(latestState && latestState.state, 'LangGraph checkpoint state must exist in lg_checkpoints');
      assert.strictEqual(latestState.state.agent, 'jonin');
      assert.strictEqual(latestState.state.quota_tokens, 2000);
      assert.ok(latestState.state.observed_input_tokens >= 2000);
      assert.ok(Array.isArray(latestState.state.todo) && latestState.state.todo.length > 0, 'LangGraph state must record agent todo list');
      assert.ok(typeof latestState.state.work === 'string' && latestState.state.work.length > 0, 'LangGraph state must record agent work state');
      assert.ok(typeof latestState.state.task === 'string' && typeof latestState.state.progress === 'string' && typeof latestState.state.latest_condition === 'string');

      // Also verify async KonohaCheckpointSaver compatibility directly
      const ckConn = db.getDb(testDbPath);
      const saver = new KonohaCheckpointSaver(ckConn);
      const tuple = await saver.getTuple({ configurable: { thread_id: 'quota_t1', checkpoint_ns: 'agent:jonin' } });
      ckConn.close();
      assert.ok(tuple && tuple.checkpoint && tuple.checkpoint.channel_values.agent === 'jonin', 'KonohaCheckpointSaver.getTuple must read the compaction checkpoint');

      assert.ok((AGENT_INPUT_TOKENS.get('quota-sess-1:jonin') || 0) < 2000, 'Post-compaction baseline must reset below quota');
      const nextTurnRes = JSON.parse(server.runMcpAgent('jonin', {
        task: 'Resume from latest condition',
        project_path: projectDir,
        task_dir: quotaTaskDir,
        task_id: 'quota_t1',
        session_id: 'quota-sess-1',
        observedInputTokens: 300,
        agent_input_token_quota: 2000
      }));
      assert.strictEqual(nextTurnRes.quota_compaction.triggered, false, 'Subsequent below-quota turn after reset must not re-trigger');

      // Security: prototype-polluting agent key must sanitize safely without mutating Object.prototype
      const { resolveCompactionThreadRef } = require('../src/context_compaction');
      const protoRef = resolveCompactionThreadRef({ taskId: 'quota_t1', agent: '__proto__' });
      assert.strictEqual(protoRef.clean_agent, 'sannin');
      assert.strictEqual(protoRef.checkpoint_ns, 'agent:sannin');
      assert.strictEqual(({}).polluted, undefined);

      // Security: path-traversal task_dir must be rejected by runMcpAgent via getResolvedTaskDir
      assert.throws(() => server.runMcpAgent('jonin', {
        task: 'Attempt path traversal',
        project_path: projectDir,
        task_dir: '../../escape-root'
      }), /Invalid/i, 'runMcpAgent must reject path-traversal task_dir');

      // Security: secrets must be redacted before persisting to LangGraph compaction state
      const { captureLangGraphCompactionState } = require('../src/context_compaction');
      const secSnap = captureLangGraphCompactionState({
        taskId: 'sec_redact_t1',
        agent: 'anbu',
        task: 'Deploy with token sk-live-secret1234567890abcd',
        work: 'Authorization: Bearer my-super-secret-token-value',
        latestCondition: 'ghp_1234567890abcdef1234567890abcdef1234',
        quotaTokens: 5000,
        observedInputTokens: 5100,
        dbPath: testDbPath
      });
      assert.ok(secSnap.ok, 'Redacted security compaction checkpoint must save');
      const readSec = getLatestLangGraphCompactionState({ taskId: 'sec_redact_t1', agent: 'anbu', dbPath: testDbPath });
      const dumpedSec = JSON.stringify(readSec.state);
      assert.ok(!dumpedSec.includes('sk-live-secret1234567890abcd'), 'API key must be redacted before lg_checkpoints write');
      assert.ok(!dumpedSec.includes('my-super-secret-token-value'), 'Bearer secret must be redacted before lg_checkpoints write');
      assert.ok(!dumpedSec.includes('ghp_1234567890abcdef1234567890abcdef1234'), 'GitHub PAT must be redacted before lg_checkpoints write');
      assert.ok(dumpedSec.includes('[REDACTED]'), 'Redaction marker must be stored');

      // Security (L4/M5): compactAndBuildLatestCondition redacts status.compaction/checkpoint_block and expands bridge redactSecrets/redactPayloadKeys
      const { compactAndBuildLatestCondition } = require('../src/context_compaction');
      const { redactSecrets, redactPayloadKeys } = require('../src/bridge/utils');
      assert.strictEqual(resolveDynamicInputQuota({ explicitQuota: 100 }), 100000, 'Below-floor explicit quota (100 < 1000) must be ignored and fall back to default');
      const redactedStatusObj = { task_id: 'sec_compact_t2' };
      const compactSecRes = compactAndBuildLatestCondition({
        taskId: 'sec_compact_t2',
        agent: 'anbu',
        task: 'Connect postgres://admin:dbPass99@db.local:5432/app with Basic dXNlcjpzZWNyZXQ=',
        progress: 'Step verified Bearer progSecret88',
        work: '{"password":"pwSecret42","client_secret":"csSecret88"} https://example.com/cb?api_key=keyVal77',
        observedInputTokens: 105000,
        quotaTokens: 100000,
        status: redactedStatusObj
      });
      const serializedCompactOut = JSON.stringify({ block: compactSecRes.checkpoint_block, statusCompaction: redactedStatusObj.compaction });
      for (const secretVal of ['dbPass99', 'dXNlcjpzZWNyZXQ=', 'progSecret88', 'pwSecret42', 'csSecret88', 'keyVal77']) {
        assert.ok(!serializedCompactOut.includes(secretVal), `Compaction output/status must redact ${secretVal}`);
        assert.ok(!redactSecrets(serializedCompactOut).includes(secretVal), `redactSecrets must cover ${secretVal}`);
      }
      const redactedPayload = redactPayloadKeys({
        messages: [{ role: 'user', content: 'Auth Bearer payTok99 and sk-paySecret1234567890' }],
        arr: ['postgres://u:arrSecret33@host/db'],
        private_key: 'raw-private-key-material',
        dsn: 'mysql://u:dsnSecret11@db/app'
      });
      const serializedPayload = JSON.stringify(redactedPayload);
      for (const leak of ['payTok99', 'sk-paySecret1234567890', 'arrSecret33', 'raw-private-key-material', 'dsnSecret11']) {
        assert.ok(!serializedPayload.includes(leak), `redactPayloadKeys must redact ${leak}`);
      }

      // Security: thread isolation for basename collisions and anonymous compaction threads
      const refWsA = resolveCompactionThreadRef({ taskDir: path.join(tmpDir, 'wsA', 'default'), agent: 'anbu' });
      const refWsB = resolveCompactionThreadRef({ taskDir: path.join(tmpDir, 'wsB', 'default'), agent: 'anbu' });
      assert.notStrictEqual(refWsA.thread_id, refWsB.thread_id, 'Cross-workspace default taskDir must not collide');
      const anonA = resolveCompactionThreadRef({ agent: 'anbu' });
      const anonB = resolveCompactionThreadRef({ agent: 'anbu' });
      assert.ok(anonA.thread_id.startsWith('anon-') && anonB.thread_id.startsWith('anon-'), 'Anonymous compaction calls must use anon-*');
      assert.notStrictEqual(anonA.thread_id, anonB.thread_id, 'Anonymous compaction threads must be isolated');

      // Security: symlinked ancestor task_dir escape must be rejected
      if (process.platform !== 'win32') {
        const escapeTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_outside_'));
        const symAncestor = path.join(quotaTaskDir, 'sym_escape');
        try {
          fs.symlinkSync(escapeTarget, symAncestor, 'dir');
          assert.throws(() => server.getResolvedTaskDir(path.join(symAncestor, 'nested_task'), projectDir, 'quota-sess-1'), /symlink/i, 'Symlinked ancestor escaping root must be rejected');
        } finally {
          fs.rmSync(escapeTarget, { recursive: true, force: true });
        }
      }
      console.log('✓ Dynamic input token quota LangGraph State checkpointing, compaction & auto-continue passed');
    } finally {
      if (prevEnvQuota === undefined) delete process.env.KONOHA_AGENT_INPUT_TOKEN_QUOTA;
      else process.env.KONOHA_AGENT_INPUT_TOKEN_QUOTA = prevEnvQuota;
      resetAgentInputTokens();
    }

    console.log('\nAll test_auto_compaction tests passed!');
  } finally {
    db.DB_PATH = prevDbPath;
    server.DB_PATH = prevServerDb;
    personaMemory.DB_PATH = prevPersonaDb;
    server.ACTIVE_CLIENT = prevActiveClient;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
