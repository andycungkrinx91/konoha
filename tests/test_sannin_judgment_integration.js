#!/usr/bin/env node
'use strict';

/**
 * Routing must stay deterministic by default and only escalate to the host
 * model when keywords genuinely cannot decide. This drives the real dispatch
 * entry (`executeTool('sannin', ...)`) so the async prepare hook is exercised,
 * not just the helper functions.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
require(path.join(ROOT, 'tests', 'helpers', 'isolate_db'));

const { getDb } = require(path.join(ROOT, 'src', 'db'));
const { executeTool } = require(path.join(ROOT, 'src', 'mcp', 'tool_dispatch'));
const { runSanninAsync } = require(path.join(ROOT, 'src', 'mcp', 'workflow_sannin'));

const sjPath = require.resolve(path.join(ROOT, 'src', 'mcp', 'structured_judgment'));
const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sj-integ-'));

let judgeCalls = [];
let judgeReply = { source: 'heuristic', reason: 'test default' };

function seedAgents() {
  const conn = getDb();
  try {
    const rows = [
      ['anbu', 'retry, backoff, idempotency, resilience, failure handling'],
      ['jonin', 'transition, animation, styling, layout, hover state'],
      ['kage', 'architecture, design review']
    ];
    for (const [name, kws] of rows) {
      conn.prepare('INSERT OR REPLACE INTO agents (name, delegation_keywords) VALUES (?, ?)').run(name, kws);
    }
  } finally {
    conn.close();
  }
}

// Replace judgment with a recorder so the test proves wiring, not the network.
function installFakeJudge() {
  const real = require(sjPath);
  require.cache[sjPath] = {
    id: sjPath,
    filename: sjPath,
    loaded: true,
    children: [],
    paths: [],
    exports: {
      ...real,
      judgeRoute: async (opts) => {
        judgeCalls.push(opts);
        return judgeReply;
      }
    }
  };
}

/** The route payload, straight from the entry the workflow graph calls. */
async function dispatch(prompt) {
  const raw = await runSanninAsync(prompt, null, projectPath, 'sj-integ-sess', {});
  return JSON.parse(raw);
}

async function main() {
  seedAgents();
  installFakeJudge();

  // A clear single-keyword win never pays for a model call.
  judgeCalls = [];
  let res = await dispatch('add retry backoff to the fetch helper');
  assert.strictEqual(judgeCalls.length, 0, 'unambiguous prompt must not call the model');
  assert.strictEqual(res.selected_agent, 'anbu', `expected anbu, got ${res.selected_agent}`);
  assert.strictEqual(res.route.judgment.source, 'heuristic', 'route must report the heuristic source');

  // A prompt with no keyword signal at all also stays free.
  judgeCalls = [];
  res = await dispatch('look into the thing');
  assert.strictEqual(judgeCalls.length, 0, 'zero-signal prompt must not call the model');

  // An ambiguous prompt asks once and adopts a confident verdict.
  judgeCalls = [];
  judgeReply = { source: 'model', agent: 'jonin', confidence: 0.88, reason: 'visual work' };
  res = await dispatch('retry the transition on the card');
  assert.strictEqual(judgeCalls.length, 1, 'ambiguous prompt must ask the model exactly once');
  assert.strictEqual(res.selected_agent, 'jonin', `model verdict must win, got ${res.selected_agent}`);
  assert.strictEqual(res.route.judgment.source, 'model');
  assert.strictEqual(res.route.judgment.confidence, 0.88);

  // A heuristic fallback leaves the keyword verdict intact.
  judgeCalls = [];
  judgeReply = { source: 'heuristic', reason: 'model unavailable' };
  res = await dispatch('retry the transition on the card');
  assert.strictEqual(judgeCalls.length, 1, 'ambiguity must still be probed');
  assert.notStrictEqual(res.selected_agent, 'jonin', 'heuristic fallback must not adopt the model pick');
  assert.strictEqual(res.route.judgment.source, 'heuristic');

  // A hard signal override outranks the verdict: the model sees the same text the
  // keyword override already read, and security/systems prompts must not be
  // re-routed by a tie-breaker.
  judgeCalls = [];
  judgeReply = { source: 'model', agent: 'jonin', confidence: 0.95, reason: 'looks visual' };
  res = await dispatch('review the security audit of the login flow');
  assert.strictEqual(res.selected_agent, 'akatsuki', `security override must outrank the verdict, got ${res.selected_agent}`);

  // The override must also win when the scorer *already agreed* with it: an
  // agreeing override is still an override, and the old guard (result changed?)
  // let a model pick discard it here.
  judgeCalls = [];
  judgeReply = { source: 'model', agent: 'jonin', confidence: 0.95, reason: 'looks visual' };
  res = await dispatch('retry the animation on the memory leak');
  assert.strictEqual(judgeCalls.length, 1, 'the prompt must be ambiguous enough to probe');
  assert.strictEqual(res.selected_agent, 'anbu', `an agreeing systems override must still win, got ${res.selected_agent}`);

  // Direct slash delegation never consults the model.
  judgeCalls = [];
  res = await dispatch('/genin map the routing module');
  assert.strictEqual(judgeCalls.length, 0, 'explicit slash routing must stay deterministic');

  // The same verdict reaches the MCP tool surface.
  judgeCalls = [];
  judgeReply = { source: 'model', agent: 'jonin', confidence: 0.9, reason: 'visual work' };
  const toolRes = JSON.parse(await executeTool('sannin', { prompt: 'retry the transition on the card', project_path: projectPath, session_id: 'sj-integ-sess' }));
  assert.strictEqual(judgeCalls.length, 1, 'tool dispatch must run the async prepare hook');
  assert.strictEqual(toolRes.selected_agent, 'jonin', `tool dispatch must honour the model verdict, got ${toolRes.selected_agent}`);

  // The dispatch payload carries no duplicate tool block.
  assert(!JSON.stringify(res).includes('"tool_block"'), 'dispatch payload must not carry tool_block');

  console.log(`  ambiguity probes: ${judgeCalls.length} in the last dispatch`);
  console.log('PASS test_sannin_judgment_integration.js');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
