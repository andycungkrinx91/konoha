'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  getWorkflowGraph,
  runKonohaGraph,
  buildKonohaGraph,
  KonohaCheckpointSaver,
  sanninWorkflowInit,
  sanninWorkflowNext,
  sanninWorkflowStatus,
  sanninWorkflowReset,
} = require('../src/mcp/workflow');
const Database = require('../src/sqlite_driver');
const { MemorySaver } = require('@langchain/langgraph');
const { globalCircuitRegistry } = require('../src/circuit_breaker');

async function runTests() {
  console.log('Running test_langgraph_workflow tests...');

  // Test 1: KonohaCheckpointSaver with node:sqlite driver
  {
    const db = new Database(':memory:');
    const saver = new KonohaCheckpointSaver(db);
    const config = { configurable: { thread_id: 'test-cp-1', checkpoint_ns: '' } };

    const checkpointData = {
      v: 1,
      id: 'cp_001',
      ts: new Date().toISOString(),
      channel_values: { step: 1, message: 'initial' },
      channel_versions: { step: 1, message: 1 },
      versions_seen: {},
    };

    const savedConfig = await saver.put(config, checkpointData, { author: 'test' }, {});
    assert.strictEqual(savedConfig.configurable.thread_id, 'test-cp-1');

    const tuple = await saver.getTuple(savedConfig);
    assert.ok(tuple, 'Should retrieve saved tuple');
    assert.strictEqual(tuple.checkpoint.channel_values.step, 1);
    assert.strictEqual(tuple.checkpoint.channel_values.message, 'initial');

    await saver.deleteThread('test-cp-1');
    const afterDelete = await saver.getTuple(savedConfig);
    assert.strictEqual(afterDelete, undefined, 'Tuple should be undefined after thread deletion');
    console.log('✓ Test 1: KonohaCheckpointSaver CRUD verified');
  }

  // Test 2: Graph compilation and fast-track execution
  {
    const checkpointer = new MemorySaver();
    const graph = buildKonohaGraph({ checkpointer });
    assert.ok(graph, 'Graph must compile cleanly');

    const taskDir = path.join('/tmp', `lg_fast_${Date.now()}`);
    fs.mkdirSync(taskDir, { recursive: true });

    const res = await graph.invoke({
      prompt: 'quick question',
      taskDir,
      tokenBudget: 8192,
    }, { configurable: { thread_id: 'fast-track-thread' } });

    assert.strictEqual(res.isFastTrack, true, 'Short prompt should classify as fast-track');
    assert.strictEqual(res.phase, 'done', 'Fast-track routes directly to completion');
    console.log('✓ Test 2: Fast-track intent bypasses full SDLC verified');
  }

  // Test 3: PLAN -> BRIEF -> TODO mandatory first steps
  {
    const db = new Database(':memory:');
    const saver = new KonohaCheckpointSaver(db);
    const graph = buildKonohaGraph({ checkpointer: saver });

    const taskDir = path.join('/tmp', `lg_mandatory_steps_${Date.now()}`);
    fs.mkdirSync(taskDir, { recursive: true });

    const initialStatus = {
      plan: '1. Scaffolding component\n2. Integrate API\n3. Run tests',
      plan_approved: true,
      human_signed_off: true,
      confidence: 100,
      ai_slop_clean: true,
      ai_slop_findings: 0,
      report: 'Mandatory steps proof'
    };
    fs.writeFileSync(path.join(taskDir, 'status.json'), JSON.stringify(initialStatus), 'utf8');
    const res = await graph.invoke({
      prompt: 'Implement dashboard metrics widget system architecture with responsive layout',
      taskDir,
      tokenBudget: 32768,
    }, { configurable: { thread_id: 'thread-mandatory-steps' } });

    assert.ok(res.plan, 'Plan must be present');
    assert.ok(res.brief, 'Brief must be synthesized as mandatory step 2');
    assert.strictEqual(res.brief.architecture_boundaries.zero_slop, true);
    assert.strictEqual(res.brief.architecture_boundaries.circuit_breaker_active, true);
    assert.ok(res.todos && res.todos.length >= 1, 'Todos must be generated from brief');
    console.log('✓ Test 3: PLAN -> BRIEF -> TODO mandatory first steps verified');
  }

  // Test 4: Token budget ceiling halt and resumption
  {
    const db = new Database(':memory:');
    const saver = new KonohaCheckpointSaver(db);
    const graph = buildKonohaGraph({ checkpointer: saver });

    const taskDir = path.join('/tmp', `lg_budget_${Date.now()}`);
    fs.mkdirSync(taskDir, { recursive: true });

    const config = { configurable: { thread_id: 'thread-budget-enforcement' } };

    // Invoke with very low token budget (ceiling = 50 tokens)
    const lowBudgetRes = await graph.invoke({
      prompt: 'Build comprehensive enterprise microservice suite with auth and database',
      taskDir,
      tokenBudget: 50,
    }, config);

    assert.strictEqual(lowBudgetRes.budgetExceeded, true, 'Workflow must halt when tokens exceed budget');
    assert.ok(lowBudgetRes.tokensUsed > 50, 'Tokens used should exceed 50');
    assert.strictEqual(lowBudgetRes.status.budget_exceeded, true);

    // Resume with higher token ceiling (16k)
    const resumedRes = await graph.invoke({
      taskDir,
      tokenBudget: 16384,
      budgetExceeded: false,
    }, config);

    assert.ok(resumedRes, 'Workflow should resume cleanly with increased budget');
    console.log('✓ Test 4: Token budget ceiling halt and resumption verified');
  }

  // Test 5: Circuit breaker 7-cycle remediation cap
  {
    const db = new Database(':memory:');
    const saver = new KonohaCheckpointSaver(db);
    const graph = buildKonohaGraph({ checkpointer: saver });

    const taskDir = path.join('/tmp', `lg_cb_remediate_${Date.now()}`);
    fs.mkdirSync(taskDir, { recursive: true });

    // Seed a status with 7 remediation cycles already exhausted and low confidence
    const initialStatus = {
      plan: 'Fix defects',
      plan_approved: true,
      slop_cycles: 7,
      confidence: 85,
      ai_slop_clean: false,
      ai_slop_findings: 3,
    };
    fs.writeFileSync(path.join(taskDir, 'status.json'), JSON.stringify(initialStatus), 'utf8');

    const res = await graph.invoke({
      prompt: 'Refactor defect loop',
      taskDir,
      tokenBudget: 16384,
    }, { configurable: { thread_id: 'thread-cb-remediate' } });

    assert.strictEqual(res.circuitOpen, true, 'Circuit breaker must be open after max remediation cycles');
    assert.ok(res.error.includes('Circuit breaker tripped'), 'Must report circuit breaker error');
    assert.strictEqual(res.status.circuit_broken, true);
    console.log('✓ Test 5: Circuit breaker 7-cycle remediation cap verified');
  }

  // Test 6: Two-stage HITL Gate 1 pause and resume
  {
    const db = new Database(':memory:');
    const saver = new KonohaCheckpointSaver(db);
    const graph = buildKonohaGraph({ checkpointer: saver });

    const taskDir = path.join('/tmp', `lg_hitl_gates_${Date.now()}`);
    fs.mkdirSync(taskDir, { recursive: true });

    const initialStatus = {
      plan: '1. Scaffolding\n2. Implementation\n3. Verification',
      plan_approved: false,
      human_signed_off: false,
      confidence: 100,
      ai_slop_clean: true,
      ai_slop_findings: 0,
      report: 'Ready for delivery'
    };
    fs.writeFileSync(path.join(taskDir, 'status.json'), JSON.stringify(initialStatus), 'utf8');

    const config = { configurable: { thread_id: 'thread-hitl-gates' } };

    // Stage 1: Pause at Gate 1 (plan approval)
    const stage1 = await graph.invoke({
      prompt: 'Build and implement full multi-step microservice workflow with database',
      taskDir,
      tokenBudget: 32768,
    }, config);

    assert.strictEqual(stage1.hitlPending, true, 'Gate 1 must pause workflow');
    assert.strictEqual(stage1.hitlStage, 'gate1');

    // Stage 2: Resume with Gate 1 approval -> completes to delivery
    const stage2 = await graph.invoke({
      hitlChoice: 'compact_and_approve',
      taskDir,
    }, config);

    assert.strictEqual(stage2.hitlStage, null);
    assert.strictEqual(stage2.phase, 'done');
    assert.strictEqual(stage2.gateVerdict, 'pass');
    console.log('✓ Test 6: Two-stage HITL Gate 1 pause and resume verified');
  }

  // Test 7: Zero-overlap between concurrent threads
  {
    const db = new Database(':memory:');
    const saver = new KonohaCheckpointSaver(db);
    const graph = buildKonohaGraph({ checkpointer: saver });

    const dirA = path.join('/tmp', `lg_overlap_a_${Date.now()}`);
    const dirB = path.join('/tmp', `lg_overlap_b_${Date.now()}`);
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });

    fs.writeFileSync(path.join(dirA, 'status.json'), JSON.stringify({ plan: 'Plan A', plan_approved: true, human_signed_off: true }), 'utf8');
    fs.writeFileSync(path.join(dirB, 'status.json'), JSON.stringify({ plan: 'Plan B', plan_approved: true, human_signed_off: true }), 'utf8');

    const [resA, resB] = await Promise.all([
      graph.invoke({ prompt: 'Build service architecture A', taskDir: dirA, tokenBudget: 8192 }, { configurable: { thread_id: 'thread-iso-A' } }),
      graph.invoke({ prompt: 'Build service architecture B', taskDir: dirB, tokenBudget: 8192 }, { configurable: { thread_id: 'thread-iso-B' } }),
    ]);

    assert.strictEqual(resA.brief.objective, 'Build service architecture A');
    assert.strictEqual(resB.brief.objective, 'Build service architecture B');
    assert.strictEqual(resA.taskDir, dirA);
    assert.strictEqual(resB.taskDir, dirB);

    const tupleA = await saver.getTuple({ configurable: { thread_id: 'thread-iso-A' } });
    const tupleB = await saver.getTuple({ configurable: { thread_id: 'thread-iso-B' } });
    assert.strictEqual(tupleA.checkpoint.channel_values.threadId, 'thread-iso-A');
    assert.strictEqual(tupleB.checkpoint.channel_values.threadId, 'thread-iso-B');
    console.log('✓ Test 7: Zero-overlap between concurrent threads verified');
  }

  // Test 8: Sannin workflow facade helpers
  {
    const taskDir = path.join('/tmp', `lg_facade_${Date.now()}`);
    fs.mkdirSync(taskDir, { recursive: true });

    const initialStatus = {
      plan: '1. Fast task',
      plan_approved: true,
      human_signed_off: true,
    };
    fs.writeFileSync(path.join(taskDir, 'status.json'), JSON.stringify(initialStatus), 'utf8');

    const initRes = await sanninWorkflowInit(taskDir, {
      prompt: 'Fast facade task',
      tokenBudget: 8192,
      threadId: 'facade-test-thread',
    });
    assert.ok(initRes, 'sanninWorkflowInit must return workflow result');

    const status = sanninWorkflowStatus(taskDir);
    assert.ok(status, 'sanninWorkflowStatus must read status.json');

    const resetStatus = sanninWorkflowReset(taskDir);
    assert.strictEqual(resetStatus.phase, 'route', 'sanninWorkflowReset must reset phase to route');
    console.log('✓ Test 8: Sannin workflow facade helpers verified');
  }

  console.log('\nAll test_langgraph_workflow tests passed cleanly!');
}

runTests().catch((err) => {
  console.error('test_langgraph_workflow failed:', err);
  process.exit(1);
});
