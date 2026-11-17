'use strict';

/**
 * tests/test_embed_progress.js — the one bar `konoha init`, `konoha migrate` and
 * `konoha doctor --fix` share.
 *
 * Three defects in this module were only ever caught by throwaway probes: the
 * pulse interval pinning the event loop, a ✓ printed after a ✗ when doctor
 * retried, and a forced 100% on a run the time budget had cut short. Each is
 * pinned here so it cannot come back silently.
 */

const assert = require('assert');
const { createEmbedProgress, MIGRATION_PHASES } = require('../bin/lib/embed_progress');

/** Runs `fn` with stdout captured; returns everything it printed. */
function capture(fn) {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return chunks.join('');
}

// --- a real ratio drives the bar to 100% -------------------------------------
{
  const progress = createEmbedProgress('Embeddings');
  const out = capture(() => {
    progress.onProgress({ done: 5, total: 10, stage: 'halfway' });
    progress.onProgress({ done: 10, total: 10, stage: 'done' });
    progress.succeed('10 chunks embedded');
  });
  const half = out.indexOf('50%');
  const full = out.indexOf('100%');
  assert.ok(half >= 0, 'the 50% frame must be rendered');
  assert.ok(full > half, 'the bar must reach 100% after the last skill');
  assert.ok(out.includes('10 chunks embedded'), 'the success message must be printed');
  console.log('  ✓ onProgress drives 0 -> 100% and succeed() reports it');
}

// --- a truncated run must not claim 100% -------------------------------------
{
  const progress = createEmbedProgress('Embeddings');
  const out = capture(() => {
    progress.onProgress({ done: 3, total: 10, stage: 'skill-c' });
    progress.succeed('900 chunks embedded');
  });
  assert.ok(!out.includes('100%'), 'a budget-truncated run must not print 100%');
  assert.ok(out.includes('30%'), 'it must say where it stopped');
  assert.ok(out.includes('900 chunks embedded'), 'it must still report the chunks written');
  console.log('  ✓ a truncated run reports the real percentage, not 100%');
}

// --- nothing may repaint after a terminal state ------------------------------
{
  const progress = createEmbedProgress('Doctor embeddings');
  const failure = { id: 'model_download', summary: 'Model could not be loaded.', causes: ['c'], fixes: ['konoha doctor --fix'] };
  let afterFail;
  capture(() => {
    progress.onProgress({ done: 1, total: 4, stage: 'skill-a' });
    progress.fail(failure);
    afterFail = capture(() => {
      progress.succeed('embeddings rebuilt');
      progress.onProgress({ done: 4, total: 4, stage: 'skill-d' });
      progress.abort('second failure');
      progress.fail(failure);
    });
  });
  assert.strictEqual(afterFail, '', `a settled bar must stay silent, got: ${JSON.stringify(afterFail)}`);
  console.log('  ✓ succeed/onProgress/abort/fail are no-ops after the bar settles');
}

// --- fail() classifies and abort() does not ----------------------------------
{
  const failed = createEmbedProgress('Embeddings');
  const failureOut = capture(() => failed.fail(new Error("Failed to load embed model 'granite': fetch failed")));
  assert.ok(failureOut.includes('Reason:'), 'fail() must print the reason');
  assert.ok(failureOut.includes('How to resolve:'), 'fail() must print remedies');
  assert.ok(failureOut.includes('konoha doctor --fix'), 'every remedy set ends with doctor --fix');

  const aborted = createEmbedProgress('Embeddings');
  const abortOut = capture(() => aborted.abort('required SQLite schema is incomplete'));
  assert.ok(abortOut.includes('required SQLite schema is incomplete'), 'abort() must print the reason');
  assert.ok(!abortOut.includes('How to resolve:'), 'abort() must not invent an embed diagnosis');
  assert.ok(!abortOut.includes('Likely cause:'), 'abort() must not invent an embed cause');
  console.log('  ✓ fail() diagnoses; abort() prints only the caller\'s reason');
}

// --- a skipped run renders no bar, but a real failure still reports ----------
{
  const skipped = createEmbedProgress('Embeddings');
  const out = capture(() => skipped.succeed('embeddings ready'));
  assert.strictEqual(out, '', `a run that never reported progress must print no bar, got: ${JSON.stringify(out)}`);

  // A failure before the first progress event has no bar to fail, but the user
  // still needs the diagnosis: it degrades to a plain line.
  const early = createEmbedProgress('Embeddings');
  const earlyOut = capture(() => early.fail(new Error('Embedding dimension mismatch: expected 384, got 768')));
  assert.ok(earlyOut.includes('✗'), 'a failure with no bar still prints a ✗ line');
  assert.ok(earlyOut.includes('How to resolve:'), 'and still prints the remedies');
  console.log('  ✓ a skipped run renders no bar; an early failure still diagnoses');
}

// --- the summary must not contradict the diagnosis ---------------------------
{
  const { renderInitSummary } = require('../bin/commands/init_migration');
  const coverage = { canonicalPending: 5, referencePending: 2 };
  const base = { skipEmbed: false, embedCoverage: coverage };

  const failed = capture(() => renderInitSummary({ ...base, embedFailed: true }));
  assert.ok(!failed.includes('Embedding pass incomplete'),
    'an embed failure already explained itself; the coverage warning must not repeat it');
  assert.ok(!failed.includes('KONOHA_MIGRATE_TIME_BUDGET'),
    'a failed model load is not a time-budget problem, so its advice must not appear');

  const truncated = capture(() => renderInitSummary({ ...base, embedFailed: false }));
  assert.ok(truncated.includes('Embedding pass incomplete: 5 skill(s) and 2 reference doc(s) still pending.'),
    'a budget-truncated pass must still report the remainder');
  assert.ok(truncated.includes('KONOHA_MIGRATE_TIME_BUDGET'), 'and offer the budget advice');
  console.log('  ✓ the init summary stays silent after a failure and reports the remainder after a cutoff');
}

// --- the run announces the stages it passes through ------------------------
{
  const { INIT_PHASES } = require('../bin/lib/embed_progress');
  const progress = createEmbedProgress('Installing Konoha', INIT_PHASES);
  const out = capture(() => {
    progress.onProgress({ phase: 'migrate skills' });
    progress.onProgress({ phase: 'embeddings' });
    progress.onProgress({ done: 4, total: 8, stage: 'skill 4/8' });
    progress.phase('configuration');
    progress.succeed('8 chunks embedded');
  });
  assert.ok(out.includes('migrate skills'), 'the run must name the migration phase');
  assert.ok(out.includes('configuration'), 'and the client-wiring phase init runs after it');
  assert.ok(out.includes('embeddings'), 'and the embedding phase');
  assert.ok(out.includes('Installing Konoha'), 'the phases belong to the titled run');
  assert.ok(/✓.*migrate skills/.test(out), 'a finished phase is ticked off');
  assert.ok(/▸.*configuration/.test(out), 'the active phase is marked');
  // Every transition is a line of its own: the bar is the only thing that
  // repaints, so a caller logging mid-run cannot be overwritten.
  assert.ok(out.split('\n').filter((l) => l.includes('migrate skills')).length >= 2,
    'phases print as a persistent trail, not an in-place block');

  // Phases only move forward: a retry that re-announces an earlier stage must
  // not un-tick the one already finished.
  const bar = new (require('../bin/lib/prompt').KonohaProgressBar)({ phases: ['a', 'b', 'c'] });
  capture(() => {
    bar.setPhase('c');
    bar.setPhase('a');
  });
  assert.strictEqual(bar._phase, 2, 'setPhase must ignore a backwards move');
  console.log('  ✓ the run announces its phases and only moves forward');
}

// --- per-item logging folds into the bar, errors do not ----------------------
{
  const progress = createEmbedProgress('Embeddings', MIGRATION_PHASES);
  const out = capture(() => {
    progress.onProgress({ phase: 'migrate skills' });
    // The migration logs one line per reference file. Each used to get its own
    // row, which scrolled the bar off the screen.
    progress.detail('📦 Migrating: anbu-skill');
    progress.detail('  ✓ references/api-design-expert.md (10,243 → 10,239 bytes, optimized 0.0%)');
    progress.detail('  ✓ references/authentication-identity-expert.md (6,777 → 6,774 bytes, optimized 0.0%)');
  });
  assert.ok(!out.includes('api-design-expert'),
    'a per-file line must not get its own row; it belongs on the bar line');
  assert.ok(!out.includes('optimized'),
    'the byte-delta tail is noise and must be stripped');

  const bar = new (require('../bin/lib/prompt').KonohaProgressBar)({ total: 100 });
  capture(() => {
    bar.setStatus('✓ references/authentication-identity-expert.md');
  });
  assert.strictEqual(bar.status, '✓ references/authentication-identity-expert.md',
    'the newest item is the bar label, so the run still says what it is doing');
  capture(() => bar.setStatus('x'.repeat(200)));
  assert.ok(bar.status.length <= 56, 'a long label is clipped so the redraw cannot wrap');

  const withError = capture(() => {
    progress.detail('  ✗ Directory not found: /nope');
  });
  assert.ok(withError.includes('Directory not found'),
    'an error must keep a persistent line instead of scrolling past on the bar');

  const afterSettle = capture(() => {
    progress.succeed('done');
    progress.detail('  ✓ references/late.md (1 → 1 bytes, optimized 0.0%)');
    progress.detail('  ⚠ late warning');
  });
  assert.ok(!afterSettle.includes('late.md'), 'a settled bar must not print per-item noise again');
  assert.ok(afterSettle.includes('late warning'), 'but a late warning still surfaces');
  console.log('  ✓ detail() folds per-item logging into the bar and keeps errors visible');
}

console.log('\n✓ embed progress assertions passed');
