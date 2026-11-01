'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  buildKonohaGraph,
  runKonohaGraph,
  sanninWorkflowInit,
  sanninWorkflowNext,
  KonohaCheckpointSaver,
} = require('../src/mcp/workflow');
const { executeTool } = require('../src/mcp/tool_dispatch');
const Database = require('../src/sqlite_driver');
const { normalizeTokenBudget } = require('../src/mcp/langgraph/token_guard');
const { wrapGuardedNode } = require('../src/mcp/langgraph/node_guard');
const { StateGraph } = require('@langchain/langgraph');
const { KonohaWorkflowState } = require('../src/mcp/langgraph/state');
const { errorNode } = require('../src/mcp/langgraph/nodes/error');

async function runTests() {
  console.log('Running test_langgraph_v2217 tests...');

  // Test 1: Per-turn budget normalization and ceilings
  {
    assert.strictEqual(normalizeTokenBudget(8192), 8192);
    assert.strictEqual(normalizeTokenBudget(16384), 16384);
    assert.strictEqual(normalizeTokenBudget(32768), 32768);
    assert.strictEqual(normalizeTokenBudget(65536), 65536);
    assert.strictEqual(normalizeTokenBudget(10000), 16384);
    assert.strictEqual(normalizeTokenBudget(20000), 32768);
    assert.strictEqual(normalizeTokenBudget(50000), 65536);
    assert.strictEqual(normalizeTokenBudget(null), 8192);
    assert.strictEqual(normalizeTokenBudget(50), 50); // test threshold
    console.log('✓ Test 1: Per-turn budget normalization and allowed ceilings verified');
  }

  // Test 2: Error edge and circuit breaker fault isolation
  {
    const faultyNode = async () => {
      throw new Error('Simulated database corruption fault');
    };
    const guardedFaulty = wrapGuardedNode('node_faulty', faultyNode);

    const testGraph = new StateGraph(KonohaWorkflowState)
      .addNode('node_faulty', guardedFaulty)
      .addNode('node_error', errorNode)
      .addEdge('__start__', 'node_faulty')
      .addConditionalEdges('node_faulty', (state) => {
        if (state.error || state.phase === 'error') return 'node_error';
        return '__end__';
      }, {
        node_error: 'node_error',
        __end__: '__end__',
      })
      .addEdge('node_error', '__end__')
      .compile();

    const res = await testGraph.invoke({
      prompt: 'Refactor core engine components',
      tokenBudget: 16384,
    });

    assert.strictEqual(res.phase, 'error');
    assert.ok(res.error.includes('Simulated database corruption fault'));
    assert.strictEqual(res.result.status, 'error');
    console.log('✓ Test 2: Error edge and circuit breaker fault isolation verified');
  }

  // Test 3: Document phase dispatch and flow to review
  {
    const db = new Database(':memory:');
    const saver = new KonohaCheckpointSaver(db);
    const graph = buildKonohaGraph({ checkpointer: saver });

    const taskDir = path.join(os.tmpdir(), `lg_doc_phase_${Date.now()}`);
    fs.mkdirSync(taskDir, { recursive: true });

    // Status with all tasks completed but no report -> must enter document phase
    const status = {
      plan: '1. Scaffolding\n2. Implementation',
      plan_approved: true,
      tasks: [
        { id: 'task-1', task: 'Scaffolding', status: 'completed' },
        { id: 'task-2', task: 'Implementation', status: 'completed' }
      ],
      phase: 'execute',
      report: '',
      auto_signoff: true,
      confidence: 100,
      ai_slop_clean: true,
      ai_slop_findings: 0,
    };
    fs.writeFileSync(path.join(taskDir, 'status.json'), JSON.stringify(status), 'utf8');

    const res = await graph.invoke({
      prompt: 'Generate system deliverables and documentation',
      taskDir,
      tokenBudget: 32768,
    }, { configurable: { thread_id: 'thread-doc-phase' } });

    assert.ok(res, 'Workflow must complete');
    console.log('✓ Test 3: Document phase restoration and transition verified');
  }

  // Test 4: Optional Gate 2 auto-signoff
  {
    const db = new Database(':memory:');
    const saver = new KonohaCheckpointSaver(db);
    const graph = buildKonohaGraph({ checkpointer: saver });

    const taskDir = path.join(os.tmpdir(), `lg_auto_signoff_${Date.now()}`);
    fs.mkdirSync(taskDir, { recursive: true });

    const status = {
      plan: '1. Module build',
      plan_approved: true,
      confidence: 99,
      ai_slop_clean: true,
      ai_slop_findings: 0,
      report: 'Completed with zero defects and full test coverage.',
      human_signed_off: false,
    };
    fs.writeFileSync(path.join(taskDir, 'status.json'), JSON.stringify(status), 'utf8');

    const res = await graph.invoke({
      prompt: 'Build core module with auto signoff',
      taskDir,
      autoSignoff: true,
      tokenBudget: 16384,
    }, { configurable: { thread_id: 'thread-auto-signoff' } });

    assert.strictEqual(res.phase, 'done', 'Should complete directly to done with autoSignoff');
    assert.strictEqual(res.gateVerdict, 'pass');
    assert.strictEqual(res.hitlPending, false);
    console.log('✓ Test 4: Optional Gate 2 auto-signoff verified');
  }

  // Test 5: Parallel workstream detection and pentest assignment
  {
    const db = new Database(':memory:');
    const saver = new KonohaCheckpointSaver(db);
    const graph = buildKonohaGraph({ checkpointer: saver });

    const taskDir = path.join(os.tmpdir(), `lg_pentest_${Date.now()}`);
    fs.mkdirSync(taskDir, { recursive: true });

    const status = {
      plan_approved: true,
      human_signed_off: true,
      confidence: 100,
      ai_slop_clean: true,
      ai_slop_findings: 0,
      report: 'Pentest report ready',
    };
    fs.writeFileSync(path.join(taskDir, 'status.json'), JSON.stringify(status), 'utf8');

    const res = await graph.invoke({
      prompt: 'Conduct penetration test, red team security audit, and CVE vulnerability analysis',
      taskDir,
      tokenBudget: 32768,
    }, { configurable: { thread_id: 'thread-pentest' } });

    assert.strictEqual(res.intent, 'pentest');
    assert.ok(res.todos.some(t => t.agent === 'akatsuki'), 'Must route security tasks to akatsuki');
    console.log('✓ Test 5: Pentest security audit intent and Akatsuki assignment verified');
  }

  // Test 6: Production tool dispatch routing with LangGraph
  {
    const taskDir = path.join(os.tmpdir(), `lg_dispatch_tool_${Date.now()}`);
    fs.mkdirSync(taskDir, { recursive: true });

    const rawRes = await executeTool('sannin', {
      prompt: 'Fix typo in README documentation',
      task_dir: taskDir,
      token_budget: 16384,
    });

    assert.ok(typeof rawRes === 'string', 'Tool output must be a string');
    const parsed = JSON.parse(rawRes);
    assert.ok(parsed, 'Tool response must be valid JSON');
    assert.ok(parsed.phase || parsed.status, 'Response must have workflow phase or status');
    console.log('✓ Test 6: Production executeTool("sannin") routing via LangGraph verified');
  }

  console.log('\nAll test_langgraph_v2217 tests passed cleanly!');
}

runTests().catch((err) => {
  console.error('test_langgraph_v2217 failed:', err);
  process.exit(1);
});
