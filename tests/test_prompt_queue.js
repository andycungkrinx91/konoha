'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Isolate test database
const testDbPath = path.join(os.tmpdir(), `konoha_test_queue_${Date.now()}.db`);
process.env.KONOHA_DB_PATH = testDbPath;

const dbModule = require('../src/db');
const conn = dbModule.getConnection(testDbPath);
dbModule.setupSchema(conn);

const inboxModule = require('../src/queue/inbox');

console.log('Running test_prompt_queue.js...');

try {
  // 1. Enqueue prompt
  const task = inboxModule.enqueuePrompt({
    prompt: 'Implement rate limiting middleware',
    source: 'web_ui',
    sender_info: 'test_runner',
    session_id: 'test_session_1'
  });

  assert.ok(task.id.startsWith('task_'), 'Task ID must have task_ prefix');
  assert.strictEqual(task.status, 'pending', 'Initial status must be pending');
  assert.strictEqual(task.prompt, 'Implement rate limiting middleware');

  // 2. Verify filesystem mirror was created
  const inboxDir = inboxModule.getInboxDir();
  const mirrorFile = path.join(inboxDir, 'test_session_1.json');
  assert.ok(fs.existsSync(mirrorFile), 'Filesystem mirror file must exist');

  const mirrorContent = JSON.parse(fs.readFileSync(mirrorFile, 'utf8'));
  assert.strictEqual(mirrorContent.id, task.id);
  assert.strictEqual(mirrorContent.prompt, 'Implement rate limiting middleware');

  // 3. Retrieve next pending prompt
  const nextPending = inboxModule.getNextPendingPrompt('test_session_1');
  assert.ok(nextPending, 'Must retrieve next pending prompt');
  assert.strictEqual(nextPending.id, task.id);

  // 4. Mark processing
  inboxModule.markPromptProcessing(task.id);
  const updated = inboxModule.getPromptById(task.id);
  assert.strictEqual(updated.status, 'processing');
  assert.ok(updated.processed_at, 'processed_at must be populated');

  // 5. Complete prompt
  inboxModule.completePrompt(task.id, {
    result_summary: 'Rate limiting implemented with 0 errors',
    token_savings_percent: 96.5,
    kage_confidence_score: 100,
    status: 'completed'
  });

  const completed = inboxModule.getPromptById(task.id);
  assert.strictEqual(completed.status, 'completed');
  assert.strictEqual(completed.result_summary, 'Rate limiting implemented with 0 errors');
  assert.strictEqual(completed.token_savings_percent, 96.5);
  assert.strictEqual(completed.kage_confidence_score, 100);

  // 6. List prompts
  const list = inboxModule.listPrompts({ limit: 10 });
  assert.ok(list.length >= 1, 'List must return at least 1 prompt');

  // 7. Empty prompt rejection validation
  assert.throws(() => {
    inboxModule.enqueuePrompt({ prompt: '' });
  }, /Prompt cannot be empty/);

  console.log('✓ All Prompt Queue & Inbox Mirror tests passed cleanly.');
} finally {
  try { fs.unlinkSync(testDbPath); } catch (_) {}
}
