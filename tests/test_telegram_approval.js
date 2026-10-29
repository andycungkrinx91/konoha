#!/usr/bin/env node
'use strict';

/**
 * tests/test_telegram_approval.js
 * Verification for Workstream C: Telegram 2-Way Interactive Approvals.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_tg_approval_'));
const dbPath = path.join(tmpDir, 'test.db');
process.env.KONOHA_DB_PATH = dbPath;

const db = require('../src/db');
db.DB_PATH = dbPath;
const initConn = db.getConnection(dbPath);
db.setupSchema(initConn);
initConn.close();

const sdlcManager = require('../src/workflow/kage-reviewer/sdlc_manager');
const notifierModule = require('../src/telegram/notifier');
const pollerModule = require('../src/telegram/poller');
const configModule = require('../src/telegram/config');

console.log('Running test_telegram_approval.js tests...');

async function run() {
  try {
    // Setup mock telegram config
    configModule.saveTelegramConfig({
      enabled: true,
      mode: 'two_way',
      bot_token: '123456:mock_token',
      chat_id: '999888'
    }, dbPath);

    // 1. Create a task in pending_plan_approval
    const task1 = sdlcManager.createTask({
      description: 'Build auth microservice',
      status: 'pending_plan_approval',
      project_path: tmpDir,
      client: 'cursor'
    }, dbPath);
    assert.strictEqual(task1.status, 'pending_plan_approval');

    // 2. Create a task in pending_human_signoff
    const task2 = sdlcManager.createTask({
      description: 'Finalize payment pipeline',
      status: 'pending_human_signoff',
      project_path: tmpDir,
      client: 'agy'
    }, dbPath);
    assert.strictEqual(task2.status, 'pending_human_signoff');

    // Mock global.fetch to intercept Telegram API calls
    const sentPayloads = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      const body = opts && opts.body ? JSON.parse(opts.body) : {};
      sentPayloads.push({ url, body });
      return {
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 12345 } })
      };
    };

    try {
      // 3. Test handleCallbackQuery for Gate 1 approval
      const cbApprove1 = {
        id: 'cb_1',
        data: `hitl:approve:${task1.id}`,
        from: { username: 'testuser' },
        message: { chat: { id: 999888 }, message_id: 101 }
      };
      await pollerModule.handleCallbackQuery(cbApprove1);
      const updated1 = sdlcManager.getTask(task1.id, dbPath);
      assert.strictEqual(updated1.status, 'in_progress');
      console.log('  ✓ Callback query approves Gate 1 task to in_progress.');

      // 4. Test handleCallbackQuery for Gate 2 approval
      const cbApprove2 = {
        id: 'cb_2',
        data: `hitl:approve:${task2.id}`,
        from: { username: 'testuser' },
        message: { chat: { id: 999888 }, message_id: 102 }
      };
      await pollerModule.handleCallbackQuery(cbApprove2);
      const updated2 = sdlcManager.getTask(task2.id, dbPath);
      assert.strictEqual(updated2.status, 'completed');
      console.log('  ✓ Callback query approves Gate 2 task to completed.');

      // 5. Test handleCallbackQuery for rejection
      const task3 = sdlcManager.createTask({
        description: 'Refactor search engine',
        status: 'pending_human_signoff',
        project_path: tmpDir
      }, dbPath);
      const cbReject = {
        id: 'cb_3',
        data: `hitl:reject:${task3.id}`,
        from: { username: 'testuser' },
        message: { chat: { id: 999888 }, message_id: 103 }
      };
      await pollerModule.handleCallbackQuery(cbReject);
      const updated3 = sdlcManager.getTask(task3.id, dbPath);
      assert.strictEqual(updated3.status, 'remediating');
      console.log('  ✓ Callback query rejects Gate 2 task to remediating.');

      // 6. Test sendInteractiveApproval helper
      sentPayloads.length = 0;
      await notifierModule.sendInteractiveApproval({
        taskId: 'task_demo_123',
        gate: 'Gate 1 (Plan Approval)',
        title: 'Demo Plan',
        planText: '1. Recon\n2. Foundation\n3. Build',
        chatId: '999888'
      });
      assert.ok(sentPayloads.length > 0);
      const payload = sentPayloads[0].body;
      assert.ok(payload.reply_markup);
      assert.strictEqual(payload.reply_markup.inline_keyboard[0][0].text, '✅ 1. Compact and approve');
      assert.strictEqual(payload.reply_markup.inline_keyboard[0][0].callback_data, 'hitl:approve:task_demo_123');
      assert.strictEqual(payload.reply_markup.inline_keyboard[0][1].text, '❌ 2. Reject / Regenerate');
      console.log('  ✓ sendInteractiveApproval formats inline keyboard buttons.');

      // 7. Test /approval list command
      sentPayloads.length = 0;
      await pollerModule.handleMessage({
        text: '/approval list',
        chat: { id: '999888' },
        from: { username: 'testuser' }
      });
      assert.ok(sentPayloads.length > 0);
      assert.ok(sentPayloads[0].body.text.includes('PENDING HITL APPROVALS') || sentPayloads[0].body.text.includes('NO PENDING APPROVALS'));
      console.log('  ✓ /approval list command responds with structured message.');

    } finally {
      global.fetch = originalFetch;
    }

  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

run().then(() => {
  console.log('\nAll test_telegram_approval tests passed cleanly!');
}).catch(err => {
  console.error(err);
  process.exit(1);
});
