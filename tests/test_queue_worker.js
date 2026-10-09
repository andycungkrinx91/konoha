/**
 * Comprehensive Unit Test for Konoha Autonomous Queue Worker.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Isolate test database
const testDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-worker-test-'));
const testDbPath = path.join(testDbDir, 'konoha.db');
process.env.KONOHA_DB_PATH = testDbPath;

const dbModule = require('../src/db');
const conn = dbModule.getConnection(testDbPath);
dbModule.setupSchema(conn);

const inboxModule = require('../src/queue/inbox');
const workerModule = require('../src/queue/worker');
const notifierModule = require('../src/telegram/notifier');

async function run() {
  console.log('Running test_queue_worker.js...');

  try {
    // 1. Test Command Classification & Extraction
    assert.strictEqual(workerModule.isOperationalCommand('/sh echo 1'), true, '/sh is operational');
    assert.strictEqual(workerModule.isOperationalCommand('/exec uptime'), true, '/exec is operational');
    assert.strictEqual(workerModule.isOperationalCommand('ssh mage2user@host "ls"'), true, 'ssh is operational');
    assert.strictEqual(workerModule.isOperationalCommand('bin/magento cache:status'), true, 'magento CLI is operational');
    assert.strictEqual(workerModule.isOperationalCommand('Use command bin/magento cache:status please'), true, 'natural language command is operational');
    assert.strictEqual(workerModule.isOperationalCommand('Refactor entire UI layout to pure Tailwind v4'), false, 'coding prompt is not operational');

    assert.strictEqual(workerModule.extractCommand('/sh ls -la'), 'ls -la', 'Extracts /sh command');
    assert.strictEqual(workerModule.extractCommand('/exec df -h'), 'df -h', 'Extracts /exec command');
    assert.strictEqual(workerModule.extractCommand('Use command bin/magento cache:status please'), 'bin/magento cache:status', 'Extracts natural command');

    // Test Duration Formatter (supports 20-30 min tasks)
    assert.strictEqual(workerModule.formatDuration(3200), '3.2s', 'Formats short seconds');
    assert.strictEqual(workerModule.formatDuration(1250000), '20m 50s', 'Formats 20+ minutes duration');

    // 2. Test Worker Lifecycle
    assert.strictEqual(workerModule.isWorkerRunning(), false, 'Worker starts stopped');
    workerModule.startWorker({ intervalMs: 1000 });
    assert.strictEqual(workerModule.isWorkerRunning(), true, 'Worker is running');
    workerModule.stopWorker();
    assert.strictEqual(workerModule.isWorkerRunning(), false, 'Worker stopped cleanly');

    // 3. Test Operational Command Execution
    let capturedNotifications = [];
    const origSend = notifierModule.sendTaskCompletedNotification;
    notifierModule.sendTaskCompletedNotification = async (data) => {
      capturedNotifications.push(data);
      return { ok: true };
    };

    const task1 = inboxModule.enqueuePrompt({
      prompt: '/sh echo "autonomous execution success"',
      source: 'telegram',
      sender_info: 'test_user'
    });

    assert.ok(task1.id, 'Task 1 enqueued');
    assert.strictEqual(task1.status, 'pending', 'Task starts pending');

    await workerModule.pollAndExecute();

    const conn = dbModule.getConnection();
    const finishedTask1 = conn.prepare('SELECT * FROM prompt_queue WHERE id = ?').get(task1.id);
    assert.strictEqual(finishedTask1.status, 'completed', 'Task must be completed');
    assert.ok(finishedTask1.result_summary.includes('autonomous execution success'), 'Result summary must have output');
    assert.strictEqual(capturedNotifications.length, 1, '1 completion notification sent');
    assert.strictEqual(capturedNotifications[0].status, 'SUCCESS', 'Notification reports SUCCESS');
    assert.strictEqual(capturedNotifications[0].taskId, task1.id, 'Task ID matches in notification');
    assert.ok(capturedNotifications[0].summary.includes('autonomous execution success'), 'Summary must be passed to notification');

    // Test formatTaskReport rendering with summary and HTML escaping
    const reportWithSummary = notifierModule.formatTaskReport({
      title: 'Prompt with <enter> and <short summary>',
      summary: 'Task executed cleanly',
      icons: true
    });
    assert.ok(reportWithSummary.includes('<b>📝 Summary:</b>'), 'Must render Summary header in bold');
    assert.ok(reportWithSummary.includes('Task executed cleanly'), 'Must render summary content');
    assert.ok(reportWithSummary.includes('&lt;enter&gt;'), 'Must escape HTML tags in title');

    // 4. Test Destructive Command Guardrail
    capturedNotifications = [];
    const task2 = inboxModule.enqueuePrompt({
      prompt: 'rm -rf /',
      source: 'telegram',
      sender_info: 'malicious_user'
    });

    await workerModule.pollAndExecute();

    const finishedTask2 = conn.prepare('SELECT * FROM prompt_queue WHERE id = ?').get(task2.id);
    assert.strictEqual(finishedTask2.status, 'failed', 'Destructive task must fail');
    assert.ok(finishedTask2.result_summary.includes('Blocked: Destructive command'), 'Block message recorded');
    assert.strictEqual(capturedNotifications.length, 1, 'Failure notification sent');
    assert.strictEqual(capturedNotifications[0].status, 'FAILED', 'Notification reports FAILED');

    // 5. Test extractTaskSummary & extractKageScore
    const sampleOutput = `
      [agy] running turn...
      ### Summary of Completed Fixes
      1. Fixed timeout to 45m.
      2. Enabled proactive Telegram notification.
      Confidence score: 100%
    `;
    const extractedSum = workerModule.extractTaskSummary(sampleOutput);
    assert.ok(extractedSum.includes('Fixed timeout to 45m'), 'Summary extracts conclusion');
    const score = workerModule.extractKageScore(sampleOutput);
    assert.strictEqual(score, 100, 'Extracts 100% confidence score');

    // 6. Test deduplication in notifierModule
    notifierModule.recordNotificationSent('test_task_dup');
    assert.strictEqual(notifierModule.isRecentlyNotified('test_task_dup'), true, 'Recently notified is true');
    assert.strictEqual(notifierModule.isRecentlyNotified('unseen_task'), false, 'Unseen task is false');

    // 7. Test formatTaskReport header
    const formattedReport = notifierModule.formatTaskReport({
      title: 'Proactive Workflow Task',
      status: 'SUCCESS',
      kageScore: 100,
      icons: true
    });
    assert.ok(formattedReport.includes('<b>KONOHA REPORT</b>'), 'Must render KONOHA REPORT header');
    assert.ok(formattedReport.includes('<b>🛡️ Kage Confidence:</b> 100% Passed'), 'Must render Kage confidence');

    // Restore
    notifierModule.sendTaskCompletedNotification = origSend;
    console.log('✓ All queue worker unit tests passed cleanly.');
  } finally {
    try {
      fs.rmSync(testDbDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
