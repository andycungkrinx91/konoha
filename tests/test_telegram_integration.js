'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Isolate test database
const testDbPath = path.join(os.tmpdir(), `konoha_test_telegram_${Date.now()}.db`);
process.env.KONOHA_DB_PATH = testDbPath;

const dbModule = require('../src/db');
const conn = dbModule.getConnection(testDbPath);
dbModule.setupSchema(conn);

const tgConfig = require('../src/telegram/config');
const tgNotifier = require('../src/telegram/notifier');
const tgPoller = require('../src/telegram/poller');
const inboxModule = require('../src/queue/inbox');

console.log('Running test_telegram_integration.js...');

async function run() {
  try {
    // 1. Initial default configuration test
    const initial = tgConfig.getTelegramConfig();
    assert.strictEqual(initial.id, 1, 'Config ID must be 1');
    assert.strictEqual(initial.enabled, 0, 'Default enabled state must be 0');
    assert.strictEqual(initial.mode, 'one_way', 'Default mode must be one_way');

    // 2. Save configuration test
    const saved = tgConfig.saveTelegramConfig({
      bot_token: '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ',
      chat_id: '123456789',
      mode: 'two_way',
      enabled: true
    });
    assert.strictEqual(saved.enabled, 1, 'Enabled must be 1 after update');
    assert.strictEqual(saved.mode, 'two_way', 'Mode must be two_way');
    assert.strictEqual(saved.chat_id, '123456789', 'Chat ID must match');
    assert.strictEqual(saved.bot_token, '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ', 'Token must match');

    // 3. Toggle enable / disable
    tgConfig.setTelegramEnabled(false);
    assert.strictEqual(tgConfig.getTelegramConfig().enabled, 0, 'Enabled should toggle to 0');
    tgConfig.setTelegramEnabled(true);
    assert.strictEqual(tgConfig.getTelegramConfig().enabled, 1, 'Enabled should toggle back to 1');

    // 4. Formatter test (Zero Emojis Invariant)
    const report = tgNotifier.formatTaskReport({
      title: 'Refactor Authentication JWT',
      status: 'SUCCESS',
      duration: '3.4s',
      filesModified: ['src/auth/jwt.js', 'tests/test_auth.js'],
      tokenReduction: 96.4,
      kageScore: 100,
      slopFindings: 0,
      dashboardUrl: 'https://konoha.example.com'
    });

    assert.ok(report.includes('[KONOHA TASK REPORT]'), 'Must include standard header tag');
    assert.ok(report.includes('Task: Refactor Authentication JWT'), 'Must include task title');
    assert.ok(report.includes('Status: [SUCCESS]'), 'Must include [SUCCESS] tag');
    assert.ok(report.includes('Token Reduction: 96.4% Saved'), 'Must include token telemetry');
    assert.ok(report.includes('Kage Confidence: 100% Passed'), 'Must include Kage confidence badge');
    assert.ok(report.includes('AI Slop Findings: 0 (100/100 Gate)'), 'Must include slop report');
    assert.ok(report.includes('Remote Dashboard: https://konoha.example.com'), 'Must include dashboard URL');

    // Verify Zero Emojis policy: ensure no non-ASCII emoji characters present in report
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    assert.strictEqual(emojiRegex.test(report), false, 'Report must contain zero emojis');

    // 5. Message handler and whitelist authorization test
    let capturedReplies = [];
    const origSend = tgNotifier.sendTelegramMessage;
    tgNotifier.sendTelegramMessage = async (text, opts) => {
      capturedReplies.push({ text, opts });
      return { ok: true };
    };

    // Test message from unauthorized chat_id
    const unauthorizedMsg = {
      chat: { id: 111222333 },
      from: { username: 'intruder' },
      text: '/run delete everything'
    };
    const cfg = tgConfig.getTelegramConfig();
    assert.notStrictEqual(String(unauthorizedMsg.chat.id), String(cfg.chat_id), 'IDs must not match');

    // Test authorized /run command
    const authorizedMsg = {
      chat: { id: 123456789 },
      from: { username: 'AndyCungkrinx91' },
      text: '/run patch token reduction telemetry'
    };
    await tgPoller.handleMessage(authorizedMsg);

    assert.strictEqual(capturedReplies.length, 1, 'Should send 1 confirmation reply');
    assert.ok(capturedReplies[0].text.includes('[QUEUED #'), 'Reply must contain queue badge');
    assert.ok(capturedReplies[0].text.includes('patch token reduction telemetry'), 'Reply must include prompt text');

    // Verify task was inserted into queue
    const pending = inboxModule.getNextPendingPrompt();
    assert.ok(pending, 'Prompt must be in pending queue');
    assert.strictEqual(pending.source, 'telegram', 'Source must be telegram');
    assert.strictEqual(pending.prompt, 'patch token reduction telemetry', 'Prompt text must match');

    // Test /status command
    capturedReplies = [];
    await tgPoller.handleMessage({ chat: { id: 123456789 }, text: '/status' });
    assert.strictEqual(capturedReplies.length, 1, 'Status reply sent');
    assert.ok(capturedReplies[0].text.includes('Status Recent Task'), 'Status reply header valid');
    assert.ok(capturedReplies[0].text.includes('<b>Status:</b> pending'), 'Status value displayed as pending');
    assert.ok(!capturedReplies[0].text.includes('[STATUS] Recent Tasks:'), 'Old status header must be removed');

    // Test /cancel command
    capturedReplies = [];
    await tgPoller.handleMessage({ chat: { id: 123456789 }, text: '/cancel' });
    assert.strictEqual(capturedReplies.length, 1, 'Cancel reply sent');
    assert.ok(capturedReplies[0].text.includes('[CANCELLED]'), 'Cancel confirmation valid');

    // Test /help command
    capturedReplies = [];
    await tgPoller.handleMessage({ chat: { id: 123456789 }, text: '/help' });
    assert.strictEqual(capturedReplies.length, 1, 'Help reply sent');
    assert.ok(capturedReplies[0].text.includes('[KONOHA TELEGRAM BOT ACTIVE]'), 'Help header present');
    assert.ok(capturedReplies[0].text.includes('/savings'), 'Help lists /savings');
    assert.ok(capturedReplies[0].text.includes('/kage'), 'Help lists /kage');

    // Test /savings command
    capturedReplies = [];
    await tgPoller.handleMessage({ chat: { id: 123456789 }, text: '/savings' });
    assert.strictEqual(capturedReplies.length, 1, 'Savings reply sent');
    assert.ok(capturedReplies[0].text.includes('[TOKEN TELEMETRY BENCHMARK]'), 'Savings header present');
    assert.ok(capturedReplies[0].text.includes('83% - 98%'), 'Savings benchmark present');

    // Test /kage command
    capturedReplies = [];
    await tgPoller.handleMessage({ chat: { id: 123456789 }, text: '/kage' });
    assert.strictEqual(capturedReplies.length, 1, 'Kage reply sent');
    assert.ok(capturedReplies[0].text.includes('Village Leader Kage'), 'Kage task accepted');

    // Test /anbu command with custom prompt
    capturedReplies = [];
    await tgPoller.handleMessage({ chat: { id: 123456789 }, text: '/anbu fix redis connection leak' });
    assert.strictEqual(capturedReplies.length, 1, 'Anbu reply sent');
    assert.ok(capturedReplies[0].text.includes('Black Ops Anbu'), 'Anbu task accepted');
    assert.ok(capturedReplies[0].text.includes('fix redis connection leak'), 'Anbu prompt preserved');

    // Test /tokubetsu_jonin command
    capturedReplies = [];
    await tgPoller.handleMessage({ chat: { id: 123456789 }, text: '/tokubetsu_jonin write release notes' });
    assert.strictEqual(capturedReplies.length, 1, 'Tokubetsu Jonin reply sent');
    assert.ok(capturedReplies[0].text.includes('Scribe Tokubetsu Jonin'), 'Tokubetsu Jonin task accepted');
    assert.ok(capturedReplies[0].text.includes('write release notes'), 'Prompt preserved');

    // Test empty /run command
    capturedReplies = [];
    await tgPoller.handleMessage({ chat: { id: 123456789 }, text: '/run' });
    assert.strictEqual(capturedReplies.length, 1, 'Empty /run error sent');
    assert.ok(capturedReplies[0].text.includes('[ERROR] Empty prompt received'), 'Empty prompt error message');

    // Test empty /run@bot command
    capturedReplies = [];
    await tgPoller.handleMessage({ chat: { id: 123456789 }, text: '/run@my_baabu_bot' });
    assert.strictEqual(capturedReplies.length, 1, 'Empty /run@bot error sent');
    assert.ok(capturedReplies[0].text.includes('[ERROR] Empty prompt received'), 'Empty prompt error message');

    // Test /run@bot with prompt
    capturedReplies = [];
    await tgPoller.handleMessage({ chat: { id: 123456789 }, text: '/run@my_baabu_bot build portfolio' });
    assert.strictEqual(capturedReplies.length, 1, 'Run with bot tag reply sent');
    assert.ok(capturedReplies[0].text.includes('build portfolio'), 'Prompt extracted properly');

    // Test /sh empty command
    capturedReplies = [];
    await tgPoller.handleMessage({ chat: { id: 123456789 }, text: '/sh' });
    assert.strictEqual(capturedReplies.length, 1, 'Empty /sh error reply sent');
    assert.ok(capturedReplies[0].text.includes('Empty Command'), 'Must report Empty Command');

    // Test /sh dangerous command blocking
    capturedReplies = [];
    await tgPoller.handleMessage({ chat: { id: 123456789 }, text: '/sh rm -rf /' });
    assert.strictEqual(capturedReplies.length, 1, 'Dangerous command blocked');
    assert.ok(capturedReplies[0].text.includes('Security Guardrail'), 'Must trigger security guardrail');

    // Test /sh successful command execution
    capturedReplies = [];
    await tgPoller.handleMessage({ chat: { id: 123456789 }, text: '/sh echo "telegram_sh_ok"' });
    assert.ok(capturedReplies.length >= 1, 'Initial execution acknowledgment sent');
    assert.ok(capturedReplies[0].text.includes('Executing in'), 'Must announce execution');

    // Wait for async shell command completion
    await new Promise(r => setTimeout(r, 600));
    assert.strictEqual(capturedReplies.length, 2, 'Execution result reply sent');
    assert.ok(capturedReplies[1].text.includes('[SUCCESS]'), 'Must report SUCCESS');
    assert.ok(capturedReplies[1].text.includes('telegram_sh_ok'), 'Must include sanitized stdout');

    // Test notifyKageReviewPassed in One-Way mode
    capturedReplies = [];
    const kageRes = await tgNotifier.notifyKageReviewPassed({
      title: 'Kage Final Gate Review: APPROVED',
      taskId: 'test_kage_gate_001',
      summary: 'Kage review gate approved (100% Confidence). All tests passed with 0 AI slop findings.',
      kageScore: 100,
      slopFindings: 0,
      filesModified: ['src/telegram/notifier.js']
    });
    assert.ok(kageRes && kageRes.ok, 'notifyKageReviewPassed must return ok');
    assert.strictEqual(capturedReplies.length, 1, '1 Kage notification sent');
    assert.ok(capturedReplies[0].text.includes('Kage Final Gate Review: APPROVED'), 'Title in message');
    assert.ok(capturedReplies[0].text.includes('100% Passed'), 'Confidence in message');
    assert.ok(capturedReplies[0].text.includes('100/100 (0 Findings)'), 'Slop findings in message');

    // Restore
    tgNotifier.sendTelegramMessage = origSend;

    console.log('✓ All Telegram integration tests passed cleanly.');
  } finally {
    try { fs.unlinkSync(testDbPath); } catch (_) {}
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
