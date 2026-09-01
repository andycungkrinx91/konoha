#!/usr/bin/env node
/**
 * tests/test_prompt_hook.js — Regression tests for the session prompt hook.
 *
 * Covers the "original task replaced by follow-up" bug: prompt.md must be
 * append-only. A follow-up (e.g. a pasted new error) must NEVER overwrite the
 * original task section.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'src', 'prompt_hook.js');

function runHook(context) {
  const stdin = JSON.stringify(context);
  try {
    execFileSync(process.execPath, [HOOK], { input: stdin, encoding: 'utf8' });
  } catch (e) {
    // hook exits non-zero on some paths; file effects are what we assert on
  }
}

function makeTranscript(dir, inputs) {
  const transcriptPath = path.join(dir, 'transcript.jsonl');
  const lines = inputs.map(content => JSON.stringify({ type: 'USER_INPUT', content }));
  fs.writeFileSync(transcriptPath, lines.join('\n') + '\n', 'utf-8');
  return transcriptPath;
}

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// --- Test 1: first input becomes the Original Task ---
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-hook-1-'));
  const artifactDir = path.join(dir, 'artifact');
  const transcript = makeTranscript(dir, ['Fix the RxDB DB9 reload bug']);
  runHook({ transcriptPath: transcript, artifactDirectoryPath: artifactDir });
  const content = fs.readFileSync(path.join(artifactDir, 'prompt.md'), 'utf-8');
  check('first input creates Original Task section', content.includes('## Original Task') && content.includes('Fix the RxDB DB9 reload bug'));
  check('header explains original-task authority', content.includes('ORIGINAL TASK'));
}

// --- Test 2: follow-up error report must NOT overwrite the original task ---
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-hook-2-'));
  const artifactDir = path.join(dir, 'artifact');
  const t1 = makeTranscript(dir, ['Fix the RxDB DB9 reload bug']);
  runHook({ transcriptPath: t1, artifactDirectoryPath: artifactDir });
  const t2 = makeTranscript(dir, ['Fix the RxDB DB9 reload bug', 'tetep error RxError (DB9) di console']);
  runHook({ transcriptPath: t2, artifactDirectoryPath: artifactDir });
  const content = fs.readFileSync(path.join(artifactDir, 'prompt.md'), 'utf-8');
  check('original task survives follow-up', content.includes('Fix the RxDB DB9 reload bug'));
  check('follow-up appended, not replacing', content.includes('## Follow-up 1') && content.includes('tetep error RxError (DB9) di console'));
  const originalIdx = content.indexOf('## Original Task');
  const followUpIdx = content.indexOf('## Follow-up 1');
  check('original task comes first', originalIdx !== -1 && followUpIdx !== -1 && originalIdx < followUpIdx);
}

// --- Test 3: continue-style inputs are ignored ---
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-hook-3-'));
  const artifactDir = path.join(dir, 'artifact');
  const t1 = makeTranscript(dir, ['Fix the RxDB DB9 reload bug']);
  runHook({ transcriptPath: t1, artifactDirectoryPath: artifactDir });
  const before = fs.readFileSync(path.join(artifactDir, 'prompt.md'), 'utf-8');
  const t2 = makeTranscript(dir, ['Fix the RxDB DB9 reload bug', 'continue']);
  runHook({ transcriptPath: t2, artifactDirectoryPath: artifactDir });
  const after = fs.readFileSync(path.join(artifactDir, 'prompt.md'), 'utf-8');
  check('continue input does not modify prompt.md', before === after);
}

// --- Test 4: duplicate inputs are not appended twice ---
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-hook-4-'));
  const artifactDir = path.join(dir, 'artifact');
  const t1 = makeTranscript(dir, ['Fix the RxDB DB9 reload bug']);
  runHook({ transcriptPath: t1, artifactDirectoryPath: artifactDir });
  runHook({ transcriptPath: t1, artifactDirectoryPath: artifactDir });
  const content = fs.readFileSync(path.join(artifactDir, 'prompt.md'), 'utf-8');
  check('duplicate input not appended twice', (content.match(/Fix the RxDB DB9 reload bug/g) || []).length === 1);
}

// --- Test 5: multiple follow-ups increment numbering (sequential firings) ---
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-hook-5-'));
  const artifactDir = path.join(dir, 'artifact');
  // Simulate the hook firing once per submitted prompt.
  runHook({ transcriptPath: makeTranscript(dir, ['Original sync task']), artifactDirectoryPath: artifactDir });
  runHook({ transcriptPath: makeTranscript(dir, ['Original sync task', 'first follow-up error']), artifactDirectoryPath: artifactDir });
  runHook({ transcriptPath: makeTranscript(dir, ['Original sync task', 'first follow-up error', 'second follow-up error']), artifactDirectoryPath: artifactDir });
  const content = fs.readFileSync(path.join(artifactDir, 'prompt.md'), 'utf-8');
  check('follow-ups numbered incrementally', content.includes('## Follow-up 1') && content.includes('## Follow-up 2'));
  check('all follow-ups retained', content.includes('first follow-up error') && content.includes('second follow-up error'));
  check('original task still first', content.indexOf('## Original Task') < content.indexOf('## Follow-up 1'));
}

console.log(`\nprompt_hook tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  failures.forEach(f => console.error(`  FAILED: ${f}`));
  process.exit(1);
}
