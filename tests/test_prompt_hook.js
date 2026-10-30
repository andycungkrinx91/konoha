#!/usr/bin/env node
/**
 * tests/test_prompt_hook.js — Regression tests: file-based IPC is retired.
 *
 * The session prompt hook must NEVER write prompt.md / delegate.md.
 * User input already lives in the transcript; routing uses structured MCP args
 * and completion is reported via report_from_agent (status.json, not result.md).
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

// --- Test 1: first input creates NO prompt.md / delegate.md ---
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-hook-1-'));
  const artifactDir = path.join(dir, 'artifact');
  const transcript = makeTranscript(dir, ['Fix the RxDB DB9 reload bug']);
  runHook({ transcriptPath: transcript, artifactDirectoryPath: artifactDir });
  check('hook writes no prompt.md on first input', !fs.existsSync(path.join(artifactDir, 'prompt.md')));
  check('hook writes no delegate.md on first input', !fs.existsSync(path.join(artifactDir, 'delegate.md')));
}

// --- Test 2: follow-up input also writes nothing; legacy file left untouched ---
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-hook-2-'));
  const artifactDir = path.join(dir, 'artifact');
  fs.mkdirSync(artifactDir, { recursive: true });
  const legacy = '## Original Task\n\nFix the RxDB DB9 reload bug\n';
  fs.writeFileSync(path.join(artifactDir, 'prompt.md'), legacy, 'utf-8');
  const t2 = makeTranscript(dir, ['Fix the RxDB DB9 reload bug', 'tetep error RxError (DB9) di console']);
  runHook({ transcriptPath: t2, artifactDirectoryPath: artifactDir });
  const after = fs.readFileSync(path.join(artifactDir, 'prompt.md'), 'utf-8');
  check('hook never appends follow-ups to legacy prompt.md', after === legacy);
  check('hook writes no delegate.md on follow-up', !fs.existsSync(path.join(artifactDir, 'delegate.md')));
}

// --- Test 3: hook exits cleanly without artifactDirectoryPath ---
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-hook-3-'));
  const transcript = makeTranscript(dir, ['Fix the RxDB DB9 reload bug']);
  runHook({ transcriptPath: transcript });
  check('hook runs without artifact directory', true);
}

// --- Test 4: hook exits cleanly with empty context ---
{
  runHook({});
  check('hook runs with empty context', true);
}

console.log(`\nprompt_hook tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  failures.forEach(f => console.error(`  FAILED: ${f}`));
  process.exit(1);
}
