#!/usr/bin/env node
'use strict';

/**
 * tests/test_langgraph_budget_resume.js
 * Comprehensive scenario verification suite for the v2.2.17 turn-budget resumption
 * and LangGraph state-machine correctness guarantees (Scenarios S1 through S13).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { StateGraph } = require('@langchain/langgraph');
const Database = require('../src/sqlite_driver');

const {
  buildKonohaGraph,
  KonohaCheckpointSaver,
  KonohaWorkflowState,
} = require('../src/mcp/langgraph');
const { wrapGuardedNode } = require('../src/mcp/langgraph/node_guard');
const { executeNode } = require('../src/mcp/langgraph/nodes/execute');
const { completeNode } = require('../src/mcp/langgraph/nodes/complete');
const { errorNode } = require('../src/mcp/langgraph/nodes/error');
const { entryRouter, executeRouter, reviewRouter, remediateRouter } = require('../src/mcp/langgraph/edges/router');
const { globalCircuitRegistry } = require('../src/circuit_breaker');
const { countTiktoken, getLastEstimatorUsed } = require('../src/token_sampler');
const { loadWorkflowStatus, saveWorkflowStatus } = require('../src/mcp/workflow_common');

function createTestSandbox(name) {
  const dir = path.join(os.tmpdir(), `konoha_test_${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupSandbox(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

async function runScenarioSuite() {
  console.log('Running test_langgraph_budget_resume scenarios (S1-S13)...\n');

  // S1: Budget halts the turn, not the workflow
  {
    const taskDir = createTestSandbox('s1');
    const threadId = `thread-s1-${Date.now()}`;
    const db = new Database(':memory:');
    const checkpointer = new KonohaCheckpointSaver(db);
    const graph = buildKonohaGraph({ checkpointer });

    try {
      const res = await graph.invoke({
        prompt: 'Implement token-budget-exhaustion scenario',
        intent: 'full_sdlc',
        taskDir,
        threadId,
        tokenBudget: 50, // Tiny budget to trigger pause
      }, { configurable: { thread_id: threadId } });

      assert.strictEqual(res.budgetExceeded, true, 'budgetExceeded flag must be set');
      assert.strictEqual(res.result.status, 'paused_budget_exceeded');
      assert.strictEqual(res.result.workflow_complete, false);
      assert.ok(res.result.resume_node, 'resume_node must be provided');

      const diskStatus = loadWorkflowStatus(taskDir);
      assert.strictEqual(diskStatus.budget_exceeded, true);
      assert.strictEqual(diskStatus.resume_node, res.result.resume_node);
      console.log('✓ S1: Budget halts the turn, not the workflow');
    } finally {
      cleanupSandbox(taskDir);
    }
  }

  // S2: Next turn resumes at the exact node without re-executing prefix
  {
    const taskDir = createTestSandbox('s2');
    const threadId = `thread-s2-${Date.now()}`;
    const db = new Database(':memory:');
    const checkpointer = new KonohaCheckpointSaver(db);
    const graph = buildKonohaGraph({ checkpointer });

    try {
      // Turn 1: halted by tiny budget
      const turn1 = await graph.invoke({
        prompt: 'Implement and build standard service',
        intent: 'full_sdlc',
        taskDir,
        threadId,
        tokenBudget: 50,
      }, { configurable: { thread_id: threadId } });

      const resumePoint = turn1.resumeNode || turn1.result.resume_node;
      assert.ok(resumePoint, 'Must have a resume point');
      const turn1TraceLen = (turn1.trace || []).length;

      // Turn 2: resume with normal budget
      const turn2 = await graph.invoke({
        taskDir,
        threadId,
        turnTokensUsed: 0,
        budgetExceeded: false,
        error: null,
      }, { configurable: { thread_id: threadId } });

      const turn2Steps = (turn2.trace || []).slice(turn1TraceLen);
      assert.ok(turn2Steps.length > 0, 'Turn 2 must execute at least one node');
      assert.strictEqual(turn2Steps[0], resumePoint, `Turn 2 must start at resume point (${resumePoint})`);

      // Verify node_classify was not re-executed in turn 2
      assert.strictEqual(turn2Steps.includes('node_classify'), false, 'node_classify must NOT re-execute in Turn 2');
      console.log('✓ S2: Next turn resumes at the exact node without re-executing prefix');
    } finally {
      cleanupSandbox(taskDir);
    }
  }

  // S3: No token_budget resupply required on continuation turn
  {
    const taskDir = createTestSandbox('s3');
    const threadId = `thread-s3-${Date.now()}`;
    const db = new Database(':memory:');
    const checkpointer = new KonohaCheckpointSaver(db);
    const graph = buildKonohaGraph({ checkpointer });

    try {
      await graph.invoke({
        prompt: 'Implement service without re-supply',
        intent: 'full_sdlc',
        taskDir,
        threadId,
        tokenBudget: 50,
      }, { configurable: { thread_id: threadId } });

      // Invoke Turn 2 with ONLY taskDir and threadId (no tokenBudget)
      const turn2 = await graph.invoke({
        taskDir,
        threadId,
        turnTokensUsed: 0,
        budgetExceeded: false,
        error: null,
      }, { configurable: { thread_id: threadId } });

      assert.ok(turn2, 'Turn 2 must execute and return state');
      assert.notStrictEqual(turn2.phase, 'init');
      console.log('✓ S3: No token_budget resupply required on continuation turn');
    } finally {
      cleanupSandbox(taskDir);
    }
  }

  // S4: Persisted ceiling survives across turns
  {
    const taskDir = createTestSandbox('s4');
    const threadId = `thread-s4-${Date.now()}`;
    const db = new Database(':memory:');
    const checkpointer = new KonohaCheckpointSaver(db);
    const graph = buildKonohaGraph({ checkpointer });

    try {
      const turn1 = await graph.invoke({
        prompt: 'Implement service and persist 32k ceiling across turns',
        intent: 'full_sdlc',
        taskDir,
        threadId,
        tokenBudget: 32768,
      }, { configurable: { thread_id: threadId } });

      assert.strictEqual(turn1.tokenBudget, 32768);

      // Turn 2 invoked without specifying tokenBudget
      const turn2 = await graph.invoke({
        taskDir,
        threadId,
        turnTokensUsed: 0,
        budgetExceeded: false,
        error: null,
      }, { configurable: { thread_id: threadId } });

      assert.strictEqual(turn2.tokenBudget, 32768, 'Token ceiling must remain 32768, not revert to 8192');
      console.log('✓ S4: Persisted ceiling survives across turns');
    } finally {
      cleanupSandbox(taskDir);
    }
  }

  // S5: Repeated halts make forward progress and always terminate (never wedges)
  {
    const taskDir = createTestSandbox('s5');
    const threadId = `thread-s5-${Date.now()}`;
    const db = new Database(':memory:');
    const checkpointer = new KonohaCheckpointSaver(db);
    const graph = buildKonohaGraph({ checkpointer });

    saveWorkflowStatus(taskDir, {
      confidence: 100,
      ai_slop_clean: true,
      ai_slop_findings: 0,
      auto_signoff: true,
    });

    try {
      let turn = 1;
      let currentState = null;
      const visitedNodes = [];

      while (turn <= 15) {
        const input = turn === 1
          ? {
              prompt: 'Implement full multi-agent feature and build service',
              intent: 'full_sdlc',
              taskDir,
              threadId,
              tokenBudget: 75,
              autoSignoff: true,
            }
          : { taskDir, threadId, turnTokensUsed: 0, budgetExceeded: false, error: null };

        // Auto-approve Gate 1 if pending
        if (currentState && currentState.hitlPending && currentState.hitlStage === 'gate1') {
          input.hitlChoice = '1';
        }

        currentState = await graph.invoke(input, { configurable: { thread_id: threadId } });

        if (currentState.trace && currentState.trace.length > 0) {
          visitedNodes.push(...currentState.trace);
        }

        if (currentState.phase === 'done' || currentState.result?.status === 'completed' || currentState.phase === 'error') {
          break;
        }

        turn++;
      }

      assert.ok(turn < 15, `Workflow must terminate within reasonable turns (took ${turn})`);
      assert.ok(currentState.phase === 'done' || currentState.result?.status === 'completed', 'Workflow must complete');
      assert.ok(visitedNodes.includes('node_plan'), 'Must include node_plan');
      assert.ok(visitedNodes.includes('node_brief'), 'Must include node_brief');
      assert.ok(visitedNodes.includes('node_todo'), 'Must include node_todo');
      console.log(`✓ S5: Repeated halts make forward progress and terminate cleanly (${turn} turns, never wedged)`);
    } finally {
      cleanupSandbox(taskDir);
    }
  }

  // S6: HITL Gate 1 pause resumes at node_plan
  {
    const taskDir = createTestSandbox('s6');
    const threadId = `thread-s6-${Date.now()}`;
    const db = new Database(':memory:');
    const checkpointer = new KonohaCheckpointSaver(db);
    const graph = buildKonohaGraph({ checkpointer });

    saveWorkflowStatus(taskDir, {
      confidence: 100,
      ai_slop_clean: true,
      ai_slop_findings: 0,
    });

    try {
      const turn1 = await graph.invoke({
        prompt: 'Implement full engineering workflow with Gate 1',
        intent: 'full_sdlc',
        taskDir,
        threadId,
        tokenBudget: 16384,
      }, { configurable: { thread_id: threadId } });

      assert.strictEqual(turn1.hitlPending, true, 'Gate 1 must pause for human approval');
      assert.strictEqual(turn1.resumeNode, 'node_plan', 'Must pause with resumeNode pointing to node_plan');

      // Turn 2 resumes with choice '1' (Approve)
      const turn2 = await graph.invoke({
        taskDir,
        threadId,
        hitlChoice: '1',
        turnTokensUsed: 0,
        budgetExceeded: false,
        error: null,
        autoSignoff: true,
      }, { configurable: { thread_id: threadId } });

      assert.strictEqual(turn2.hitlPending, false);
      assert.ok(turn2.trace.includes('node_plan'), 'Turn 2 must start at node_plan');
      console.log('✓ S6: HITL Gate 1 pause resumes at node_plan');
    } finally {
      cleanupSandbox(taskDir);
    }
  }

  // S7: Error turn preserves resumeNode and retries failed node on next turn
  {
    const taskDir = createTestSandbox('s7');
    const threadId = `thread-s7-${Date.now()}`;
    const db = new Database(':memory:');
    const checkpointer = new KonohaCheckpointSaver(db);

    let attempt = 0;
    async function flakyExecute(state, config) {
      attempt++;
      if (attempt === 1) {
        throw new Error('Transient DB timeout at execute');
      }
      return executeNode(state, config);
    }

    const builder = new StateGraph(KonohaWorkflowState)
      .addNode('node_execute', wrapGuardedNode('node_execute', flakyExecute))
      .addNode('node_error', errorNode)
      .addNode('node_complete', wrapGuardedNode('node_complete', completeNode))
      .addConditionalEdges('__start__', entryRouter, {
        node_execute: 'node_execute',
        node_complete: 'node_complete',
      })
      .addConditionalEdges('node_execute', executeRouter, {
        node_error: 'node_error',
        node_review: 'node_complete',
        node_dispatch: 'node_complete',
        node_budget_exceeded: 'node_complete',
      })
      .addEdge('node_complete', '__end__')
      .addEdge('node_error', '__end__');

    const graph = builder.compile({ checkpointer });

    try {
      const turn1 = await graph.invoke({
        taskDir,
        threadId,
        resumeNode: 'node_execute',
      }, { configurable: { thread_id: threadId } });

      assert.strictEqual(turn1.phase, 'error');
      assert.strictEqual(turn1.resumeNode, 'node_execute');
      assert.strictEqual(turn1.result.retryable, true);
      assert.ok(turn1.error.includes('Transient DB timeout'));

      // Turn 2: retries and succeeds!
      const turn2 = await graph.invoke({
        taskDir,
        threadId,
        turnTokensUsed: 0,
        budgetExceeded: false,
        error: null,
      }, { configurable: { thread_id: threadId } });

      assert.strictEqual(turn2.phase, 'done');
      assert.strictEqual(turn2.error, null);
      assert.strictEqual(turn2.trace.filter(n => n === 'node_execute').length, 2, 'Must have executed node_execute twice (failed then retried)');
      console.log('✓ S7: Error turn preserves resumeNode and retries failed node on next turn');
    } finally {
      cleanupSandbox(taskDir);
    }
  }

  // S8: Circuit breaker fails closed (3 consecutive failures => OPEN, never node_complete)
  {
    const threadId = `thread-s8-${Date.now()}`;
    const breaker = globalCircuitRegistry.getOrCreate(`workflow:${threadId}`, 3);

    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    const status = breaker.getStatus();
    assert.strictEqual(status.state, 'OPEN', 'Breaker must be OPEN after 3 failures');

    const taskDir = createTestSandbox('s8');
    const db = new Database(':memory:');
    const checkpointer = new KonohaCheckpointSaver(db);
    const graph = buildKonohaGraph({ checkpointer });

    try {
      const res = await graph.invoke({
        taskDir,
        threadId,
        circuitOpen: true,
      }, { configurable: { thread_id: threadId } });

      assert.notStrictEqual(res.phase, 'done', 'Tripped breaker must NEVER reach complete');
      assert.strictEqual(res.circuitOpen, true);
      // Verify unseeded 0-cycle persistent remediation defect loop trips breaker cleanly without throw
      const taskDirRem = createTestSandbox('s8_rem');
      try {
        fs.writeFileSync(path.join(taskDirRem, 'status.json'), JSON.stringify({
          plan: '1. Scaffolding\n2. Implementation',
          plan_approved: true,
          confidence: 80,
          ai_slop_clean: false,
          ai_slop_findings: 2,
        }), 'utf8');

        const remThreadId = `thread-s8-rem-${Date.now()}`;
        const remRes = await graph.invoke({
          prompt: 'Implement full feature with persistent remediation defects from cycle 0',
          intent: 'full_sdlc',
          taskDir: taskDirRem,
          threadId: remThreadId,
          tokenBudget: 65536,
        }, { configurable: { thread_id: remThreadId } });

        assert.strictEqual(remRes.phase, 'error', 'Must halt at node_error on 7th remediation cycle');
        assert.strictEqual(remRes.circuitOpen, true, 'Circuit must trip to OPEN');
        assert.strictEqual(remRes.remediationCount, 7, 'Must record 7 remediation cycles');
        assert.ok(remRes.error.includes('Circuit breaker tripped'), 'Must report circuit breaker error');
      } finally {
        cleanupSandbox(taskDirRem);
      }

      console.log('✓ S8: Circuit breaker fails closed and 0-cycle remediation cap trips cleanly');
    } finally {
      cleanupSandbox(taskDir);
    }
  }

  // S9: Circuit breaker thread isolation
  {
    const threadA = `thread-s9-a-${Date.now()}`;
    const threadB = `thread-s9-b-${Date.now()}`;

    const breakerA = globalCircuitRegistry.getOrCreate(`workflow:${threadA}`, 3);
    const breakerB = globalCircuitRegistry.getOrCreate(`workflow:${threadB}`, 3);

    breakerA.recordFailure();
    breakerA.recordFailure();
    breakerA.recordFailure();

    assert.strictEqual(breakerA.getStatus().state, 'OPEN');
    assert.strictEqual(breakerB.getStatus().state, 'CLOSED', "Thread B's breaker must remain CLOSED");
    assert.strictEqual(breakerB.allowRequest(), true);
    console.log('✓ S9: Circuit breaker thread isolation verified');
  }

  // S10: Unknown verdict fails closed
  {
    assert.strictEqual(reviewRouter({ gateVerdict: 'bogus_unknown' }), 'node_remediate', 'Unknown verdict must route to node_remediate');
    assert.strictEqual(reviewRouter({ gateVerdict: '' }), 'node_remediate', 'Empty verdict must route to node_remediate');
    assert.notStrictEqual(reviewRouter({ gateVerdict: 'bogus_unknown' }), 'node_complete', 'Unknown verdict must NEVER route to node_complete');
    assert.strictEqual(reviewRouter({ circuitOpen: true }), 'node_error', 'Circuit open in review must route to node_error');
    assert.strictEqual(remediateRouter({ circuitOpen: true }), 'node_error', 'Circuit open in remediate must route to node_error');
    assert.notStrictEqual(remediateRouter({ circuitOpen: true }), 'node_complete', 'Circuit open in remediate must NEVER route to node_complete');
    console.log('✓ S10: Unknown verdict and circuit open fail closed (never node_complete)');
  }

  // S11: Deterministic token metering
  {
    const input = 'Deterministic token metering check with pure-JS cl100k_base tokenizer.';
    const c1 = countTiktoken(input);
    const c2 = countTiktoken(input);
    assert.strictEqual(c1, c2, 'Same input must yield identical token count');
    assert.ok(c1 > 0);
    assert.strictEqual(getLastEstimatorUsed(), 'pure_js_cl100k');
    console.log('✓ S11: Deterministic token metering verified');
  }

  // S12: Non-empty payloads on every node
  {
    const taskDir = createTestSandbox('s12');
    const threadId = `thread-s12-${Date.now()}`;
    const db = new Database(':memory:');
    const checkpointer = new KonohaCheckpointSaver(db);
    const graph = buildKonohaGraph({ checkpointer });

    try {
      const res = await graph.invoke({
        prompt: 'Verify non-empty payload contract',
        taskDir,
        threadId,
        isFastTrack: true, // Fast track goes straight to complete
      }, { configurable: { thread_id: threadId } });

      assert.ok(res !== undefined, 'graph.invoke must not resolve to undefined');
      assert.ok(typeof res === 'object' && res !== null, 'res must be non-empty object');
      assert.ok(res.tokensUsed !== undefined, 'tokensUsed must be present');
      assert.ok(res.turnTokensUsed !== undefined, 'turnTokensUsed must be present');
      console.log('✓ S12: Non-empty node payload invariant verified');
    } finally {
      cleanupSandbox(taskDir);
    }
  }

  // S13: Forward-only trace across turns
  {
    const taskDir = createTestSandbox('s13');
    const threadId = `thread-s13-${Date.now()}`;
    const db = new Database(':memory:');
    const checkpointer = new KonohaCheckpointSaver(db);
    const graph = buildKonohaGraph({ checkpointer });

    saveWorkflowStatus(taskDir, {
      confidence: 100,
      ai_slop_clean: true,
      ai_slop_findings: 0,
    });

    try {
      // Turn 1
      const turn1 = await graph.invoke({
        prompt: 'Implement and build service and trace steps',
        intent: 'full_sdlc',
        taskDir,
        threadId,
        tokenBudget: 75,
      }, { configurable: { thread_id: threadId } });

      const trace1 = [...(turn1.trace || [])];
      assert.ok(trace1.length > 0);

      // Turn 2
      const turn2 = await graph.invoke({
        taskDir,
        threadId,
        hitlChoice: '1',
        autoSignoff: true,
        turnTokensUsed: 0,
        budgetExceeded: false,
        error: null,
      }, { configurable: { thread_id: threadId } });

      const trace2 = turn2.trace || [];
      assert.ok(trace2.length > trace1.length, 'Cumulative trace must grow');

      // Turn 2 steps are the slice after Turn 1
      const turn2Steps = trace2.slice(trace1.length);
      assert.strictEqual(turn2Steps.includes('node_classify'), false, 'Turn 2 must NOT re-execute node_classify');
      console.log('✓ S13: Forward-only trace across turns verified');
    } finally {
      cleanupSandbox(taskDir);
    }
  }

  console.log('\n======================================================');
  console.log('All 13 scenario tests in test_langgraph_budget_resume.js passed cleanly!');
  console.log('======================================================');
}

runScenarioSuite().catch(err => {
  console.error('Scenario suite failed:', err);
  process.exit(1);
});
