'use strict';

/**
 * Verification Suite: Component 2, 6, 8 — All 8 Specialist Subagents Spawn & Run in Parallel,
 * `@sannin` Strictly Router-Only, `/konoha` LangGraph Delegation, & Git Worktree Isolation
 */

const assert = require('assert');
const {
  SPAWNABLE_SUBAGENTS,
  isSpawnableSubagent,
  buildSpawnDirective,
  buildParallelSpawnDirective
} = require('../src/mcp/lazy_subagent');
const {
  parseKonohaCommandInvocation,
  detectParallelWorkstreams,
  runSannin
} = require('../src/mcp/workflow_sannin');

async function runTests() {
  console.log('Running test_langgraph_parallel_and_konoha.js...');

  const expectedSpecialists = [
    'genin',
    'kage',
    'chunin',
    'jonin',
    'anbu',
    'tokubetsu-jonin',
    'akatsuki',
    'yamanaka'
  ];
  for (const agent of expectedSpecialists) {
    assert.ok(SPAWNABLE_SUBAGENTS.includes(agent), `${agent} must be in SPAWNABLE_SUBAGENTS`);
    assert.strictEqual(isSpawnableSubagent(agent), true, `${agent} must be spawnable`);
  }
  assert.strictEqual(isSpawnableSubagent('sannin'), false, 'sannin must remain router-only (not spawnable as worker)');

  const clients = ['antigravity', 'claude', 'cursor', 'opencode', 'commandcode', 'codex', 'omp', 'pi'];
  for (const client of clients) {
    for (const agent of expectedSpecialists) {
      const directive = buildSpawnDirective({
        client,
        agent,
        prompt: `Execute ${agent} slice`,
        worktreePath: `/tmp/wt_${agent}`
      });
      assert.ok(directive && directive.includes('## Spawn (mandatory)'), `Missing spawn directive for ${agent} on ${client}`);
      assert.ok(directive.includes(`/tmp/wt_${agent}`), `Worktree path must be included in directive for ${agent} on ${client}`);
    }
  }

  const parsedKonoha = parseKonohaCommandInvocation('/konoha build a fullstack dashboard and audit security');
  assert.strictEqual(parsedKonoha.invocationMode, 'konoha_orchestrator');
  assert.strictEqual(parsedKonoha.cleanPrompt, 'build a fullstack dashboard and audit security');

  const streams = detectParallelWorkstreams(
    'Explore codebase with @genin, research docs with @chunin, build UI with @jonin, implement API with @anbu, audit security with @akatsuki, and write docs with @tokubetsu-jonin'
  );
  assert.ok(streams.length >= 4, `Expected >= 4 parallel workstreams, got ${streams.length}`);
  const parallelDirective = buildParallelSpawnDirective({
    client: 'claude',
    dispatches: streams.map((s, idx) => ({
      agent: s.agent,
      task: s.task,
      slice_id: `slice_${idx + 1}`,
      worktree_path: `/tmp/wt_${s.agent}_${idx + 1}`
    }))
  });
  assert.ok(parallelDirective.includes('## Parallel Spawn Wave (mandatory concurrent execution)'));
  assert.ok(parallelDirective.includes('--parallel --agents'));

  const wfRaw = runSannin('/konoha build UI with @jonin and backend API with @anbu in parallel');
  const wfInit = typeof wfRaw === 'string' ? JSON.parse(wfRaw) : wfRaw;
  assert.ok(wfInit && wfInit.task_dir, 'runSannin must return a task_dir');
  assert.strictEqual(wfInit.parallel_eligible, true, 'Must mark parallel_eligible=true');
  assert.ok(wfInit.parallel_spawn_directive && wfInit.parallel_spawn_directive.includes('Parallel Spawn Wave'), 'Must include parallel_spawn_directive');
  assert.ok(Array.isArray(wfInit.todos) && wfInit.todos.length >= 2, 'runSannin must populate todos');
  assert.ok(Array.isArray(wfInit.walkthrough_steps) && wfInit.walkthrough_steps.length >= 2, 'runSannin must populate walkthrough_steps');
  assert.ok(wfInit.client_todo_directive, 'Must include client_todo_directive');

  console.log('PASS test_langgraph_parallel_and_konoha.js');
}

runTests().catch((err) => {
  console.error('FAIL test_langgraph_parallel_and_konoha.js:', err);
  process.exit(1);
});
