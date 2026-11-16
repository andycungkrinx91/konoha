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

// Rendered under the bar so a long run says what it is doing, not just how far
// it got. `migrate` emits these; `init` adds the client wiring it does after.
const MIGRATION_PHASES = ['migrate skills', 'embeddings'];
const INIT_PHASES = [...MIGRATION_PHASES, 'configuration'];

/**
 * Builds a progress reporter to hand to `runMigration({ onProgress })`.
 *
 * Nothing renders until the first progress event, so a run that skips embedding
 * (--no-embed, --skip-embeddings) prints no bar at all.
 *
 * @param {string} title
 * @param {string[]} [phases] the run's stages, listed under the bar
 * @returns {{
 *   onProgress: (p: {done?: number, total?: number, stage?: string, phase?: string}) => void,
 *   phase: (name: string) => void,
 *   succeed: (msg?: string) => void,
 *   fail: (failureOrError: object) => object|null,
 *   abort: (reason: string) => void,
 * }}
 */
function createEmbedProgress(title = 'Embeddings', phases = []) {
  const bar = new KonohaProgressBar({ total: 100, width: 28, title, phases });
  let started = false;
  // Once the bar has reported a terminal state, nothing may paint over it. The
  // callers that reuse one reporter (doctor retries per skills directory, init's
  // fallback chain) would otherwise print a second bar or a ✓ after a ✗.
  let settled = false;
  // Whether the backfill ever told us how many skills it would touch. Without
  // that, a percentage would be invented and 100% would be a lie in the other
  // direction.
  let sawTotal = false;

  const begin = (firstPhase) => {
    if (started) return;
    started = true;
    // `startPulse` renders once; calling `start` first would paint the same 0%
    // frame twice. A first event that names a phase wins; otherwise the run
    // starts at the head of the list.
    if (bar.phases.length) bar.setPhase(firstPhase || bar.phases[0]);
    bar.startPulse();
  };

  return {
    onProgress(p) {
      if (!p || settled) return;
      begin(p.phase);
      // A phase announcement and a chunk count travel on the same channel: the
      // migration says which stage it entered, the backfill says how far in.
      if (p.phase) bar.setPhase(p.phase);
      // Until the backfill knows how many skills it will touch, a percentage
      // would be invented. Pulse with the current stage instead, then switch to
      // a real ratio the moment a total arrives.
      if (Number.isFinite(p.total) && p.total > 0) {
        bar.total = p.total;
        sawTotal = true;
        bar.stopPulse();
        bar.update(Number(p.done) || 0, p.stage || '');
      } else if (p.stage && !p.phase) {
        bar.startPulse(p.stage);
      }
    },

    /**
     * Advances the phase list. No-op before the first progress event, so a run
     * that skips embedding renders nothing at all.
     */
    phase(name) {
      if (!started || settled) return;
      bar.setPhase(name);
    },

    succeed(msg = 'embeddings ready') {
      if (!started || settled) return;
      settled = true;
      // `finish()` forces 100%. The backfill stops at its time budget, leaving
      // the alphabetical tail unembedded, so a short run must say where it got
      // to instead of claiming a completion it did not reach. The pulse has to
      // stop first or it keeps repainting over the final line.
      // A run that never reported a ratio (--no-embed, an already-embedded
      // database) had nothing to measure, so it finished what it set out to do.
      if (!sawTotal || bar.current >= bar.total) {
        bar.finish(msg);
      } else {
        bar.stopPulse();
        const percent = Math.round((bar.current / bar.total) * 100);
        log(`  ${C.yellow}↯${C.reset} ${C.bold}${title}${C.reset} ${C.yellow}${percent}%${C.reset} — ${msg}`);
      }
    },

    /**
     * Fails the bar in place and prints cause + remedies underneath. Accepts a
     * pre-classified failure (from `runMigration`) or a raw error.
     * @returns {object|null} the classification, or null if the bar had already
     *   settled (a second failure must not repaint the first diagnosis).
     */
    fail(failureOrError) {
      if (settled) return null;
      settled = true;
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
      if (settled) return;
      settled = true;
      if (started) bar.fail(reason);
      else log(`  ${C.red}✗${C.reset} ${C.bold}${title}${C.reset} — ${C.red}${reason}${C.reset}`);
    },
  };
}

module.exports = { createEmbedProgress, MIGRATION_PHASES, INIT_PHASES };
