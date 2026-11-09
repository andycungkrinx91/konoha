#!/usr/bin/env node
// DB isolation: sannin routing reads skills + agent rows.
require('./helpers/isolate_db');
require('./helpers/seed_agents');

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const router = require('../src/mcp/sannin_router');

let passed = 0;

function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

function section(name) {
  console.log(`\n${name}`);
}

const DIRECT_PROMPT = 'read src/mcp/workflow_sannin.js lines 300-400';
const BUILD_PROMPT = 'build a sveltekit responsive landing page component';
const HEAVY_PROMPT = 'refactor the auth layer and migrate the session store so tokens rotate safely';
const LOOKUP_PROMPT = 'what does classifyExecutionTrack return?';

function run() {
  section('Signal scoring');
  check('mutation / heavy / read-only verbs are separated', () => {
    const fix = router.scoreRouteSignals('fix the typo in README');
    assert.ok(fix.mutationVerbs >= 1, 'fix is a mutation verb');
    assert.strictEqual(fix.heavyVerbs, 0, 'fix is not a heavy verb');

    const build = router.scoreRouteSignals(BUILD_PROMPT);
    assert.ok(build.heavyVerbs >= 1, 'build is a heavy verb');

    const lookup = router.scoreRouteSignals(LOOKUP_PROMPT);
    assert.ok(lookup.readonlyVerbs >= 1, 'what is a read-only verb');
    assert.strictEqual(lookup.mutationVerbs, 0, 'no mutation verbs in a lookup');
  });

  check('file and slash paths are counted once each', () => {
    const sig = router.scoreRouteSignals('compare src/mcp/workflow_sannin.js with ./src/mcp/sannin_router.js');
    assert.strictEqual(sig.filePaths, 2, `expected 2 file paths, got ${sig.filePaths}`);
    assert.ok(sig.slashPaths >= 2, `expected slash paths, got ${sig.slashPaths}`);
  });

  check('ambiguity terms lower confidence inputs', () => {
    assert.strictEqual(router.scoreRouteSignals('fix the typo in README').ambiguity, 0);
    assert.ok(router.scoreRouteSignals('maybe fix some stuff somewhere').ambiguity >= 2);
  });

  section('Explicit prefix precedence');
  const prefixed = [
    ['direct: build and refactor everything across the whole app', 'delegate'],
    ['[direct] migrate the database', 'delegate'],
    ['delegate: read lines 1-20 of package.json', 'delegate'],
    ['[delegate] what is this', 'delegate'],
    ['pipeline: ship a new onboarding flow end to end', 'pipeline'],
    ['[pipeline] fix typo', 'pipeline']
  ];
  for (const [prompt, mode] of prefixed) {
    check(`"${prompt.slice(0, 28)}…" → ${mode} at 0.99`, () => {
      const route = router.decideRoute({ prompt });
      assert.strictEqual(route.mode, mode);
      assert.strictEqual(route.confidence, 0.99);
      assert.ok(route.reasons[0].includes('explicit'), `reasons: ${route.reasons.join('; ')}`);
    });
  }

  section('Route branches');
  check('read-only lookup routes to delegate', () => {
    const route = router.decideRoute({ prompt: DIRECT_PROMPT });
    assert.strictEqual(route.mode, 'delegate');
    assert.ok(route.signals.readonlyVerbs >= 1);
  });

  check('single bounded edit routes to delegate', () => {
    const route = router.decideRoute({ prompt: 'fix the typo in README' });
    assert.strictEqual(route.mode, 'delegate');
    assert.strictEqual(route.signals.heavyVerbs, 0);
  });

  check('heavy build verb delegates instead of running inline', () => {
    const route = router.decideRoute({ prompt: BUILD_PROMPT });
    assert.strictEqual(route.mode, 'delegate');
    assert.ok(route.signals.heavyVerbs >= 1);
  });

  check('multi-surface work on the full track routes to the pipeline', () => {
    const route = router.decideRoute({
      prompt: HEAVY_PROMPT,
      executionTrack: 'full_sdlc',
      workstreams: ['carpenter', 'anbu']
    });
    assert.strictEqual(route.mode, 'pipeline');
  });

  check('pipeline gate needs the full track', () => {
    const route = router.decideRoute({ prompt: HEAVY_PROMPT, executionTrack: 'fast_track', workstreams: ['carpenter', 'anbu'] });
    assert.notStrictEqual(route.mode, 'pipeline');
  });

  check('confidence is rounded to two decimals', () => {
    for (const prompt of [DIRECT_PROMPT, BUILD_PROMPT, HEAVY_PROMPT, LOOKUP_PROMPT]) {
      const { confidence } = router.decideRoute({ prompt });
      assert.strictEqual(confidence, Math.round(confidence * 100) / 100);
      assert.ok(confidence > 0 && confidence <= 1);
    }
  });

  section('Route line');
  const routeLine = router.formatRouteLine(router.decideRoute({ prompt: DIRECT_PROMPT }));
  check('route line carries mode, confidence and reasons', () => {
    assert.ok(routeLine.startsWith('**Route Decision**: `delegate` (confidence '), routeLine);
    assert.ok(routeLine.trimEnd().split(' — ')[1].length > 0, 'reasons present');
    assert.ok(routeLine.endsWith('\n'), 'single trailing newline');
  });

  section('Delegation envelope');
  // Enough skills to exceed the cap regardless of what the cap is set to.
  const cap = router.MAX_ENVELOPE_SKILLS;
  const skills = Array.from({ length: cap + 2 }, (_, i) => `skill_${i}`);
  const envelope = router.buildDelegationEnvelope({ agentName: 'jonin', prompt: BUILD_PROMPT, routedSkills: skills });
  check('skills are capped and the overflow is reported', () => {
    assert.strictEqual(envelope.skills.length, cap);
    assert.deepStrictEqual(envelope.skills, skills.slice(0, cap));
    assert.deepStrictEqual(envelope.dropped_skills, skills.slice(cap));
  });

  const underCap = router.buildDelegationEnvelope({ agentName: 'jonin', prompt: BUILD_PROMPT, routedSkills: skills.slice(0, 2) });
  check('a short skill list is passed through undropped', () => {
    assert.deepStrictEqual(underCap.skills, skills.slice(0, 2));
    assert.deepStrictEqual(underCap.dropped_skills, []);
  });

  check('recall is capped', () => {
    assert.ok(Array.isArray(envelope.recall));
    assert.ok(envelope.recall.length <= router.MAX_RECALL_ITEMS);
    for (const item of envelope.recall) {
      assert.ok(typeof item === 'string', 'recall items are strings');
      assert.ok(item.length <= router.RECALL_SNIPPET_CHARS + 1, `recall item too long: ${item.length}`);
    }
  });

  check('envelope text names the agent and stays bounded', () => {
    assert.ok(envelope.text.includes('jonin'), 'agent named');
    assert.ok(envelope.text.includes('konoha.use_skills'), 'skill loader referenced');
    assert.ok(envelope.text.length < 2000, `envelope text ${envelope.text.length} chars`);
    assert.ok(envelope.agent === 'jonin');
  });

  check('empty skill list still produces a usable envelope', () => {
    const bare = router.buildDelegationEnvelope({ agentName: 'genin', prompt: 'explore the router', routedSkills: [] });
    assert.deepStrictEqual(bare.skills, []);
    assert.deepStrictEqual(bare.dropped_skills, []);
    assert.ok(bare.text.includes('genin'));
  });

  section('Spawn directive');
  const spawnCodex = router.buildSpawnDirective({ client: 'codex', agent: 'anbu' });
  const spawnOmp = router.buildSpawnDirective({ client: 'omp', agent: 'anbu' });
  check('builds client-specific spawn directives', () => {
    assert.ok(spawnCodex.includes('spawn_agent(agent="anbu"'));
    assert.ok(spawnOmp.includes('tasks=[{name:"anbu"'));
  });

  section('Integration with runSannin');
  const server = require('../src/server');
  const taskRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_router_'));

  function routePrompt(prompt, name) {
    const dir = path.join(taskRoot, name);
    fs.mkdirSync(dir, { recursive: true });
    return JSON.parse(server.runSannin(prompt, dir));
  }

  const readRun = routePrompt(DIRECT_PROMPT, 'readonly');
  check('lookup turn routes to delegate with envelope and spawn directive', () => {
    assert.strictEqual(readRun.status, 'routed');
    assert.strictEqual(readRun.execution_mode, 'delegate');
    assert.strictEqual(readRun.route.mode, 'delegate');
    assert.ok(readRun.instructions.includes('## Delegation Steps'));
    assert.ok(readRun.instructions.includes('## Spawn (mandatory)'));
    assert.strictEqual(readRun.phase, 'delegation', 'phase stays the lifecycle contract');
  });

  const delegatedRun = routePrompt(BUILD_PROMPT, 'delegated');
  check('delegated turn emits the bounded envelope', () => {
    assert.strictEqual(delegatedRun.execution_mode, 'delegate');
    assert.ok(delegatedRun.instructions.includes('## Delegation Steps'));
    assert.ok(!delegatedRun.instructions.includes('Direct Execution'));
    assert.ok(delegatedRun.delegation_envelope, 'envelope present');
    assert.ok(delegatedRun.delegation_envelope.skills.length <= router.MAX_ENVELOPE_SKILLS);
    assert.deepStrictEqual(Object.keys(delegatedRun.delegation_envelope).sort(), ['agent', 'skills'], 'runSannin projects the compact envelope to hold the <3KB payload contract');
    assert.strictEqual(delegatedRun.delegation_envelope.agent, delegatedRun.selected_agent);
  });

  check('route_mode is recorded in task evidence and workflow status', () => {
    const db = require('../src/db');
    const conn = db.getConnection(null, false);
    const row = conn.prepare('SELECT evidence FROM sdlc_tasks WHERE id = ?').get(delegatedRun.task_id);
    assert.ok(row, 'sdlc task row written');
    assert.strictEqual(JSON.parse(row.evidence).route_mode, 'delegate');

    const statusPath = path.join(taskRoot, 'delegated', 'status.json');
    assert.ok(fs.existsSync(statusPath), 'workflow status written');
    assert.strictEqual(JSON.parse(fs.readFileSync(statusPath, 'utf8')).route_mode, 'delegate');
  });

  console.log(`\n${passed} checks passed`);
}

try {
  run();
} catch (err) {
  console.error(`\nFAILED: ${err.message}`);
  console.error(err.stack.split('\n').slice(1, 4).join('\n'));
  process.exit(1);
}
