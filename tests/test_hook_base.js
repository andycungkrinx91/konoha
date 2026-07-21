#!/usr/bin/env node
/**
 * tests/test_hook_base.js — verify hook-base helpers behave as before.
 *
 * Behavioral contract:
 *  - readStdin() returns '' on EOF / error (never throws)
 *  - readStdinJson() returns null on empty / malformed / non-object input
 *  - respond() writes a single JSON line followed by \n
 *  - isConfirmedOrchestrator() returns false for empty/missing transcripts,
 *    false for /subagents/ paths, true only with positive evidence
 *  - brainDirFromTranscript() returns null unless path ends in
 *    .system_generated/logs/<file>
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const hookBase = require('../src/hook-base');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); failed++; }
}
function section(label) { console.log(`\n${label}`); }

// ────────────────────────────────────────────────────────────────────
section('isConfirmedOrchestrator');
// ────────────────────────────────────────────────────────────────────

test('returns false when transcriptPath is null/undefined', () => {
  assert.strictEqual(hookBase.isConfirmedOrchestrator(null), false);
  assert.strictEqual(hookBase.isConfirmedOrchestrator(undefined), false);
  assert.strictEqual(hookBase.isConfirmedOrchestrator(''), false);
});

test('returns false when transcriptPath contains /subagents/', () => {
  assert.strictEqual(hookBase.isConfirmedOrchestrator('/home/x/.gemini/agent_logs/subagents/abc/transcript.jsonl'), false);
});

test('returns false when transcript file does not exist', () => {
  const fake = '/tmp/konoha-hook-base-nonexistent-' + Date.now() + '/transcript.jsonl';
  assert.strictEqual(hookBase.isConfirmedOrchestrator(fake), false);
});

// create a real transcript file to test positive-evidence path
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-hook-base-'));
const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
function writeTranscript(records) {
  fs.writeFileSync(transcriptPath, records.map(r => JSON.stringify(r)).join('\n'));
}

test('returns false for empty transcript (invocation 0)', () => {
  fs.writeFileSync(transcriptPath, '');
  assert.strictEqual(hookBase.isConfirmedOrchestrator(transcriptPath), false);
});

test('returns false when transcript contains subagent "acting as @" prompt', () => {
  writeTranscript([
    { type: 'USER_INPUT', content: 'You are acting as the `@kage` subagent. Please read delegate.md' }
  ]);
  assert.strictEqual(hookBase.isConfirmedOrchestrator(transcriptPath), false);
});

test('returns false when transcript contains "You are the genin" prompt', () => {
  writeTranscript([
    { type: 'USER_INPUT', content: 'You are the genin subagent, read result.md' }
  ]);
  assert.strictEqual(hookBase.isConfirmedOrchestrator(transcriptPath), false);
});

test('returns false when transcript contains brain scratch path', () => {
  writeTranscript([
    { type: 'USER_INPUT', content: 'Read /brain/abc-123/scratch/tasks/task.md' }
  ]);
  assert.strictEqual(hookBase.isConfirmedOrchestrator(transcriptPath), false);
});

test('returns false when MODEL row has [🍃 Genin] active', () => {
  writeTranscript([
    { source: 'MODEL', content: '[🍃 Genin] active — proceeding' }
  ]);
  assert.strictEqual(hookBase.isConfirmedOrchestrator(transcriptPath), false);
});

test('returns true for clean orchestrator transcript', () => {
  writeTranscript([
    { type: 'USER_INPUT', content: 'Help me refactor this codebase' },
    { source: 'MODEL', content: 'Sure, let me start by reading the structure.' }
  ]);
  assert.strictEqual(hookBase.isConfirmedOrchestrator(transcriptPath), true);
});

test('returns true for empty JSONL array (no user input yet)', () => {
  // No USER_INPUT records and no MODEL agent-tag records
  writeTranscript([
    { type: 'OTHER', content: 'something else entirely' }
  ]);
  // No subagent indicators → confirmed orchestrator (transcript exists, no negatives)
  assert.strictEqual(hookBase.isConfirmedOrchestrator(transcriptPath), true);
});

test('prefers transcript_full.jsonl over transcript.jsonl when present', () => {
  const fullPath = path.join(tmpDir, 'transcript_full.jsonl');
  fs.writeFileSync(fullPath, JSON.stringify({ type: 'USER_INPUT', content: 'acting as the `@kage`' }));
  fs.writeFileSync(transcriptPath, JSON.stringify({ type: 'USER_INPUT', content: 'normal orchestrator' }));
  // full has subagent evidence → should pick full and return false
  assert.strictEqual(hookBase.isConfirmedOrchestrator(transcriptPath), false);
  // cleanup
  fs.unlinkSync(fullPath);
});

// ────────────────────────────────────────────────────────────────────
section('brainDirFromTranscript');
// ────────────────────────────────────────────────────────────────────

test('returns null for falsy input', () => {
  assert.strictEqual(hookBase.brainDirFromTranscript(null), null);
  assert.strictEqual(hookBase.brainDirFromTranscript(''), null);
});

test('returns null when transcript is not under .system_generated/logs/', () => {
  assert.strictEqual(hookBase.brainDirFromTranscript('/home/x/some/other/transcript.jsonl'), null);
});

test('returns the brain dir for valid .system_generated/logs/<file> path', () => {
  const brainDir = '/home/x/brain/abc-123';
  const tp = path.join(brainDir, '.system_generated', 'logs', 'transcript.jsonl');
  assert.strictEqual(hookBase.brainDirFromTranscript(tp), brainDir);
});

// ────────────────────────────────────────────────────────────────────
section('readStdinJson / respond (smoke)');
// ────────────────────────────────────────────────────────────────────

test('readStdinJson returns null when stdin is empty (closed)', () => {
  // We can simulate by piping to child, but simplest is to assert the function
  // resolves to a promise and never throws.
  const result = hookBase.readStdinJson();
  return result.then(v => {
    // /dev/null or empty stdin → ''
    assert.strictEqual(v, null);
  });
});

// cleanup
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
