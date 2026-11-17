#!/usr/bin/env node
'use strict';

/**
 * Structured judgment must borrow the host model, never block a workflow, and
 * never invent a verdict. Every failure path falls back to the heuristic, which
 * is what the caller was already going to use.
 */

const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const mrPath = require.resolve(path.join(ROOT, 'src', 'mcp', 'three_asset', 'model_router'));

let reply = null;
let calls = 0;
// The module destructures these at require time, so behaviour is switched
// through `state`, not by replacing the functions.
const state = { targets: [{ target_url: 'http://127.0.0.1:1', model: 'inherit' }] };
const fakeRouter = {
  resolveChatTargets: () => state.targets,
  sendChatMessage: async () => {
    calls += 1;
    if (reply instanceof Error) throw reply;
    return { text: reply };
  }
};
require.cache[mrPath] = { id: mrPath, filename: mrPath, loaded: true, exports: fakeRouter, children: [], paths: [] };

const sj = require(path.join(ROOT, 'src', 'mcp', 'structured_judgment'));

function reset(text) {
  reply = text;
  calls = 0;
  sj.clearJudgmentCache();
}

async function main() {
  // Valid verdict is adopted.
  reset('{"agent":"anbu","confidence":0.92,"reason":"backend retry work"}');
  let r = await sj.judgeRoute({ prompt: 'add a retry to the bridge fetch', candidates: ['anbu', 'jonin'] });
  assert.strictEqual(r.source, 'model', 'valid model verdict must be adopted');
  assert.strictEqual(r.agent, 'anbu');
  assert.strictEqual(calls, 1);

  // Same question is served from cache, not re-billed.
  r = await sj.judgeRoute({ prompt: 'add a retry to the bridge fetch', candidates: ['anbu', 'jonin'] });
  assert.strictEqual(r.agent, 'anbu');
  assert.strictEqual(calls, 1, 'repeat judgment must not call the model again');

  // Fenced / chatty output still parses.
  reset('Sure.\n```json\n{"agent":"jonin","confidence":0.8,"reason":"ui"}\n```');
  r = await sj.judgeRoute({ prompt: 'tune the hover transition', candidates: ['anbu', 'jonin'] });
  assert.strictEqual(r.agent, 'jonin', 'fenced JSON must parse');

  // Low confidence falls back instead of guessing.
  reset('{"agent":"jonin","confidence":0.3,"reason":"unsure"}');
  r = await sj.judgeRoute({ prompt: 'change something', candidates: ['anbu', 'jonin'] });
  assert.strictEqual(r.source, 'heuristic', 'low confidence must not override the heuristic');

  // An agent outside the candidate set is rejected.
  reset('{"agent":"kage","confidence":0.99,"reason":"arch"}');
  r = await sj.judgeRoute({ prompt: 'change something', candidates: ['anbu', 'jonin'] });
  assert.strictEqual(r.source, 'heuristic', 'unknown agent must be rejected');

  // Transport failure is not an error for the caller.
  reset(new Error('ECONNREFUSED'));
  r = await sj.judgeRoute({ prompt: 'change something', candidates: ['anbu', 'jonin'] });
  assert.strictEqual(r.source, 'heuristic', 'model failure must degrade, not throw');

  // Fewer than two candidates is not worth a model call.
  reset('{"agent":"anbu","confidence":0.9}');
  r = await sj.judgeRoute({ prompt: 'change something', candidates: ['anbu'] });
  assert.strictEqual(r.source, 'heuristic');
  assert.strictEqual(calls, 0, 'single-candidate routing must stay free');

  // Drift verdict maps both ways.
  reset('{"drift":true,"confidence":0.9,"reason":"added unrequested dependency"}');
  let d = await sj.judgeDrift({ agent: 'anbu', goal: 'add retry', plan: 'edit bridge', summary: 'installed axios and rewrote the gateway' });
  assert.strictEqual(d.source, 'model');
  assert.strictEqual(d.drift, true);

  reset('{"drift":false,"confidence":0.85,"reason":"matches plan"}');
  d = await sj.judgeDrift({ agent: 'anbu', goal: 'add retry', plan: 'edit bridge', summary: 'added retry to bridge fetch' });
  assert.strictEqual(d.drift, false, 'model must be able to clear a drift candidate');

  // Empty summary never reaches the model.
  reset('{"drift":true,"confidence":0.9}');
  d = await sj.judgeDrift({ summary: '   ' });
  assert.strictEqual(d.source, 'heuristic');
  assert.strictEqual(calls, 0, 'empty summary must not spend a call');

  // A missing endpoint is a heuristic verdict, not a crash.
  state.targets = [];
  reset('{"agent":"anbu","confidence":0.9}');
  r = await sj.judgeRoute({ prompt: 'change something', candidates: ['anbu', 'jonin'] });
  assert.strictEqual(r.source, 'heuristic', 'no configured target must degrade');

  console.log('  route/drift judgment: fallback and cache paths verified');
  console.log('PASS test_structured_judgment.js');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
