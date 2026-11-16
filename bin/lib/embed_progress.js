'use strict';

/**
 * bin/lib/embed_progress.js — one progress bar for every embedding run.
 *
 * `konoha init`, `konoha migrate` and `konoha doctor --fix` all embed skill
 * chunks, and all three used to print a line per skill and then swallow the
 * failure into a `⚠ ... skipped` warning. This renders a single 0-100% bar and,
 * when embedding fails, fails the bar in place and prints the diagnosis plus the
 * commands that fix it. The caller keeps full control of exit codes.
 */

const { C, log } = require('./format');
const { KonohaProgressBar } = require('./prompt');
const { classifyEmbedFailure, formatEmbedFailure } = require('../../src/embed_diagnostics');

/**
 * Builds a progress reporter to hand to `runMigration({ onProgress })`.
 *
 * Nothing renders until the first progress event, so a run that skips embedding
 * (--no-embed, --skip-embeddings) prints no bar at all.
 *
 * @param {string} title
 * @returns {{
 *   onProgress: (p: {done?: number, total?: number, stage?: string}) => void,
 *   succeed: (msg?: string) => void,
 *   fail: (failureOrError: object) => object|null,
 *   abort: (reason: string) => void,
 * }}
 */
function createEmbedProgress(title = 'Embeddings') {
  const bar = new KonohaProgressBar({ total: 100, width: 28, title });
  let started = false;

  const begin = (stage) => {
    if (started) return;
    started = true;
    // `startPulse` sets the status and renders once; calling `start` first would
    // paint the same 0% frame twice.
    bar.startPulse(stage || 'preparing');
  };

  return {
    onProgress(p) {
      if (!p) return;
      begin(p.stage);
      // Until the backfill knows how many skills it will touch, a percentage
      // would be invented. Pulse with the current stage instead, then switch to
      // a real ratio the moment a total arrives.
      if (Number.isFinite(p.total) && p.total > 0) {
        bar.total = p.total;
        bar.stopPulse();
        bar.update(Number(p.done) || 0, p.stage || '');
      } else if (p.stage) {
        bar.startPulse(p.stage);
      }
    },

    succeed(msg = 'embeddings ready') {
      if (!started) return;
      bar.finish(msg);
    },

    /**
     * Fails the bar in place and prints cause + remedies underneath. Accepts a
     * pre-classified failure (from `runMigration`) or a raw error.
     * @returns {object} the classification, so callers can branch on `.id`
     */
    fail(failureOrError) {
      const failure = failureOrError && failureOrError.fixes
        ? failureOrError
        : classifyEmbedFailure(failureOrError);
      if (started) bar.fail(failure.summary);
      else log(`  ${C.red}✗${C.reset} ${C.bold}${title}${C.reset} — ${C.red}${failure.summary}${C.reset}`);
      for (const line of formatEmbedFailure(failure)) log(`  ${C.dim}${line}${C.reset}`);
      return failure;
    },

    /**
     * Fails the bar without a diagnosis, for failures whose cause was already
     * printed by the caller. Classifying here would invent a remedy for an error
     * that is not an embedding error at all.
     */
    abort(reason) {
      if (started) bar.fail(reason);
      else log(`  ${C.red}✗${C.reset} ${C.bold}${title}${C.reset} — ${C.red}${reason}${C.reset}`);
    },
  };
}

module.exports = { createEmbedProgress };
