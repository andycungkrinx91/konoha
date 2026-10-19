'use strict';

const { assertSandbox } = require('./helpers/sandbox_guard');
assertSandbox();

const assert = require('assert');
const path = require('path');
const os = require('os');

// Isolate test database
const testDbPath = path.join(os.tmpdir(), `konoha_test_tg_no_sh_${Date.now()}.db`);
process.env.KONOHA_DB_PATH = testDbPath;

const dbModule = require('../src/db');
const conn = dbModule.getConnection(testDbPath);
dbModule.setupSchema(conn);

const tgConfig = require('../src/telegram/config');
const tgNotifier = require('../src/telegram/notifier');
const tgPoller = require('../src/telegram/poller');
const inboxModule = require('../src/queue/inbox');

async function run() {
  const origSend = tgNotifier.sendTelegramMessage;
  let capturedReplies = [];

  try {
    tgConfig.saveTelegramConfig({
      bot_token: '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ',
      chat_id: '123456789',
      mode: 'two_way',
      enabled: true
    });

    tgNotifier.sendTelegramMessage = async (text, opts) => {
      capturedReplies.push({ text, opts });
      return { ok: true };
    };

    // 1. /sh returns removal notice
    capturedReplies = [];
    await tgPoller.handleMessage({ chat: { id: 123456789 }, text: '/sh ls -la' });
    assert.strictEqual(capturedReplies.length, 1);
    assert.ok(capturedReplies[0].text.includes('/sh removed in 2.2.1'));
    assert.ok(capturedReplies[0].text.includes('security hardening'));

    // 2. /exec returns removal notice
    capturedReplies = [];
    await tgPoller.handleMessage({ chat: { id: 123456789 }, text: '/exec uname -a' });
    assert.strictEqual(capturedReplies.length, 1);
    assert.ok(capturedReplies[0].text.includes('/sh removed in 2.2.1'));

    // 3. /status escapes HTML in prompt text
    capturedReplies = [];
    inboxModule.enqueuePrompt({
      id: 'task_xss_test',
      source: 'telegram',
      prompt: '<script>alert("xss")</script> & <b>test</b>',
      sender_info: 'test'
    });

    await tgPoller.handleMessage({ chat: { id: 123456789 }, text: '/status' });
    assert.strictEqual(capturedReplies.length, 1);
    const statusText = capturedReplies[0].text;
    assert.ok(!statusText.includes('<script>'), 'Unescaped <script> tag must not be in message');
    assert.ok(statusText.includes('&lt;script&gt;'), 'Script tag must be HTML-escaped');
    assert.ok(statusText.includes('&amp;'), 'Ampersand must be HTML-escaped');

    console.log('✓ test_telegram_no_sh passed');
  } finally {
    tgNotifier.sendTelegramMessage = origSend;
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
